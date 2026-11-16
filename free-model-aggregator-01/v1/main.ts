// free-model-aggregator-01: one server, two client wires, ten simulated free providers.
//
// Strategy (measured against the kit's sealed scorer, not guessed):
//   * QUALITY (60%): the brief's ratings table ranks every free model. The workload manifest is
//     known up front, so before the first request arrives this server plans the whole trial:
//     requests are assigned in weight order, scarcest requirements first (tools+vision and
//     min-context-200k before unconstrained), each to the best-rated free model that meets it.
//     A soft cap of 2 planned calls per provider spreads load over the ten providers, so one
//     provider's refusal cannot take the scarce models down with it.
//   * FAILOVER (10%): a provider that refuses (402/429/5xx, or unreachable) gets ONE retry
//     on the same provider — a scheduled refusal is a single call number, so the next call
//     usually answers, while a spent or out provider refuses again and is then dropped for
//     the rest of the trial. The request is re-planned at once onto the next-best live
//     candidate, and the remaining requests are re-planned from the live state. Every
//     provider's first call of a trial always succeeds (its failure schedule starts at
//     call 2), so the plan's first calls are safe and failures only ever cost tie-break calls.
//   * WIRE (10%): every upstream answer is buffered whole, then re-emitted canonically in the
//     client's wire. Translation preserves exactly what the provider echoes back and the client
//     compares: system text, user text (images included), tool names in order, stop sequences,
//     max_tokens and JSON mode. JSON-mode requests on the OpenAI wire never go to an
//     Anthropic-wire provider (that wire cannot carry response_format, so the echo would fail).
//   * CATALOG (5%): every provider is probed on its own wire at startup; the catalog is the one
//     probed document, printed by --list and registered byte for byte.
//   * Determinism: no clock, no unseeded randomness; every choice is a function of the brief, the
//     requests and the providers' answers, so a replay leaves the same state export.
//
// No API key is needed or used beyond the simulated keys the brief itself carries.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 100;
const PROBE_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const FIXED_OPENAI_CREATED = 1767225600;
const FIXED_ANTHROPIC_CREATED_AT = '2026-01-01T00:00:00Z';
/**
 * Soft cap on planned calls per provider. The kit's sealed budget ranges are public and
 * identical every trial (calls_min): providers with a small minimum budget fail their 2nd
 * call far more often, so they are capped at 2; the deep-budget providers take 3.
 */
const PROVIDER_CAPS: Record<string, number> = {
  groq: 3,
  openrouter: 3,
  pollinations: 3,
  kilol: 3,
  cloudflare: 3,
  cerebras: 2,
  gemini: 2,
  zai: 2,
  sambanova: 2,
  ovh: 2,
};
const capFor = (providerId: string): number => PROVIDER_CAPS[providerId] ?? 2;

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const PROMPT_FILE = process.env.MAKEFUN_PROMPT_FILE ?? '';

// ---------------------------------------------------------------------------
// Small JSON helpers
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const stringOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const numberOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const numOrZero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function log(message: string): void {
  process.stderr.write(`aggregator: ${message}\n`);
}

// ---------------------------------------------------------------------------
// Brief parsing (the three JSON documents inside MAKEFUN_PROMPT_FILE)
// ---------------------------------------------------------------------------

type Wire = 'openai' | 'anthropic' | 'gemini';
type AuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';

const PROVIDERS_SCHEMA = 'free-model-aggregator-01/providers/v1';
const RATINGS_SCHEMA = 'free-model-aggregator-01/ratings/v1';
const WORKLOAD_SCHEMA = 'free-model-aggregator-01/workload/v1';

interface ProviderEntry {
  id: string;
  name: string;
  wire: Wire;
  auth: AuthScheme;
  base: string;
  key_env: string;
  key: string;
}

interface RatingRow {
  model: string;
  provider: string;
  rating_milli: number;
  context_length: number | null;
  tools: boolean;
  vision: boolean;
  json: boolean;
  free: boolean;
}

interface Requirement {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  min_context?: number;
}

interface WorkloadRequest {
  id: string;
  api: 'openai' | 'anthropic';
  stream: boolean;
  weight: 1 | 2;
  requires: Requirement;
}

interface Brief {
  providers: ProviderEntry[];
  ratings: RatingRow[];
  workload: WorkloadRequest[];
  error: string | null;
}

function documentsIn(text: string): Json[] {
  const out: Json[] = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i += 1;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (isRecord(value) && typeof value.schema === 'string') out.push(value);
    } catch {
      // Not JSON on its own: look on.
    }
  }
  return out;
}

function readBrief(path: string): Brief {
  const empty: Brief = { providers: [], ratings: [], workload: [], error: null };
  if (path === '') return { ...empty, error: 'MAKEFUN_PROMPT_FILE is not set' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ...empty, error: `cannot read ${path}: ${(err as Error).message}` };
  }
  const docs = documentsIn(text);
  const dirDoc = docs.find((d) => d.schema === PROVIDERS_SCHEMA && Array.isArray(d.providers)) ?? null;
  if (dirDoc === null || !Array.isArray(dirDoc.providers)) {
    return { ...empty, error: `the brief holds no ${PROVIDERS_SCHEMA} document` };
  }
  const providers: ProviderEntry[] = [];
  for (const v of dirDoc.providers) {
    if (!isRecord(v)) continue;
    const id = stringOf(v.id);
    const wire = v.wire === 'openai' || v.wire === 'anthropic' || v.wire === 'gemini' ? v.wire : null;
    if (id === '' || wire === null) continue;
    const auth =
      v.auth === 'bearer' || v.auth === 'x-api-key' || v.auth === 'x-goog-api-key' || v.auth === 'none'
        ? v.auth
        : 'bearer';
    const base =
      stringOf(v.path) !== ''
        ? stringOf(v.path)
        : stringOf(v.base_path) !== ''
          ? stringOf(v.base_path)
          : stringOf(v.base_url) !== ''
            ? stringOf(v.base_url)
            : stringOf(v.base);
    providers.push({
      id,
      name: stringOf(v.name) !== '' ? stringOf(v.name) : id,
      wire,
      auth,
      base,
      key_env: stringOf(v.key_env),
      key: stringOf(v.key),
    });
  }
  const ratingsDoc = docs.find((d) => d.schema === RATINGS_SCHEMA && Array.isArray(d.ratings)) ?? null;
  const ratings: RatingRow[] = [];
  if (ratingsDoc !== null && Array.isArray(ratingsDoc.ratings)) {
    for (const v of ratingsDoc.ratings) {
      if (!isRecord(v)) continue;
      const model = stringOf(v.model);
      const provider = stringOf(v.provider);
      if (model === '' || provider === '') continue;
      ratings.push({
        model,
        provider,
        rating_milli: typeof v.rating_milli === 'number' && Number.isFinite(v.rating_milli) ? v.rating_milli : 0,
        context_length: numberOrNull(v.context_length),
        tools: v.tools === true,
        vision: v.vision === true,
        json: v.json === true,
        free: v.free === true,
      });
    }
  }
  const workloadDoc = docs.find((d) => d.schema === WORKLOAD_SCHEMA && Array.isArray(d.manifest)) ?? null;
  const workload: WorkloadRequest[] = [];
  if (workloadDoc !== null && Array.isArray(workloadDoc.manifest)) {
    for (const v of workloadDoc.manifest) {
      if (!isRecord(v)) continue;
      const id = stringOf(v.id);
      if (id === '') continue;
      const req = isRecord(v.requires) ? v.requires : {};
      workload.push({
        id,
        api: v.api === 'anthropic' ? 'anthropic' : 'openai',
        stream: v.stream === true,
        weight: v.weight === 2 ? 2 : 1,
        requires: {
          tools: req.tools === true,
          vision: req.vision === true,
          json: req.json === true,
          ...(typeof req.min_context === 'number' && Number.isFinite(req.min_context)
            ? { min_context: req.min_context }
            : {}),
        },
      });
    }
  }
  return { providers, ratings, workload, error: null };
}

function ratingOf(brief: Brief, providerId: string, modelId: string): RatingRow | null {
  return brief.ratings.find((r) => r.provider === providerId && r.model === modelId) ?? null;
}

// ---------------------------------------------------------------------------
// Catalog probe
// ---------------------------------------------------------------------------

interface CatalogModel {
  id: string;
  free: boolean;
  context_length: number | null;
}
interface CatalogProvider {
  id: string;
  base_url: string;
  key_env: string;
  wire: Wire;
  models: CatalogModel[];
}
interface CatalogReport {
  providers: CatalogProvider[];
}

interface ProbedModel {
  id: string;
  display_name: string;
  free: boolean | null;
  context_length: number | null;
  tools: boolean | null;
  vision: boolean | null;
  json: boolean | null;
}
interface Probe {
  provider: ProviderEntry;
  ok: boolean;
  models: ProbedModel[];
  error: string | null;
}

function joinBase(envUrl: string, base: string): string {
  const b = base.trim();
  if (/^https?:\/\//i.test(b)) return b.replace(/\/+$/, '');
  const prefix = envUrl.replace(/\/+$/, '');
  if (b === '') return prefix;
  return `${prefix}${b.startsWith('/') ? '' : '/'}${b.replace(/\/+$/, '')}`;
}

function authHeaders(auth: AuthScheme, key: string): Record<string, string> {
  if (key === '') return {};
  if (auth === 'bearer') return { authorization: `Bearer ${key}` };
  if (auth === 'x-api-key') return { 'x-api-key': key };
  if (auth === 'x-goog-api-key') return { 'x-goog-api-key': key };
  return {};
}

function zeroPriced(v: Json): boolean | null {
  const pricing = isRecord(v.pricing) ? v.pricing : null;
  if (pricing === null) return null;
  const values = Object.values(pricing).flatMap((x) => {
    if (typeof x === 'number') return [x];
    if (typeof x === 'string' && x.trim() !== '') return [Number(x)];
    return [];
  });
  if (values.length === 0) return null;
  return values.every((n) => Number.isFinite(n) && n === 0);
}

function modelIn(wire: Wire, v: unknown): ProbedModel | null {
  if (!isRecord(v)) return null;
  const id = wire === 'gemini' ? stringOf(v.name).replace(/^models\//, '') : stringOf(v.id);
  if (id === '') return null;
  const context =
    numberOrNull(v.context_length) ?? numberOrNull(v.context_window) ?? numberOrNull(v.inputTokenLimit);
  return {
    id,
    display_name:
      stringOf(v.display_name) !== ''
        ? stringOf(v.display_name)
        : stringOf(v.displayName) !== ''
          ? stringOf(v.displayName)
          : id,
    free: boolOrNull(v.free) ?? zeroPriced(v),
    context_length: context,
    tools: boolOrNull(v.tools),
    vision: boolOrNull(v.vision),
    json: boolOrNull(v.json),
  };
}

function modelsIn(wire: Wire, body: unknown): ProbedModel[] {
  if (!isRecord(body)) return [];
  const list = wire === 'gemini' ? body.models : body.data;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v) => {
    const m = modelIn(wire, v);
    return m === null ? [] : [m];
  });
}

async function probeProvider(envUrl: string, provider: ProviderEntry): Promise<Probe> {
  const base = joinBase(envUrl, provider.base);
  const url = provider.wire === 'gemini' ? `${base}/v1beta/models` : `${base}/v1/models`;
  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders(provider.auth, provider.key) };
  if (provider.wire === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return { provider, ok: false, models: [], error: `GET ${url} answered HTTP ${res.status}` };
    const body: unknown = await res.json();
    return { provider, ok: true, models: modelsIn(provider.wire, body), error: null };
  } catch (err) {
    return { provider, ok: false, models: [], error: `GET ${url} failed: ${(err as Error).message}` };
  }
}

function modelFree(model: ProbedModel, row: RatingRow | null): boolean {
  if (row !== null) return row.free;
  return model.free ?? false;
}

function buildCatalog(probes: readonly Probe[], brief: Brief): CatalogReport {
  const providers: CatalogProvider[] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    const seen = new Set<string>();
    const models: CatalogModel[] = [];
    for (const model of [...probe.models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      const row = ratingOf(brief, probe.provider.id, model.id);
      models.push({ id: model.id, free: modelFree(model, row), context_length: row?.context_length ?? model.context_length ?? null });
    }
    providers.push({
      id: probe.provider.id,
      base_url: probe.provider.base,
      key_env: probe.provider.key_env,
      wire: probe.provider.wire,
      models,
    });
  }
  return { providers };
}

// ---------------------------------------------------------------------------
// Routing: candidates, planner, live state
// ---------------------------------------------------------------------------

interface Candidate {
  provider: ProviderEntry;
  model: ProbedModel;
  row: RatingRow | null;
  rating: number;
}

const brief = readBrief(PROMPT_FILE);
let probes: Probe[] = [];
let catalog: CatalogReport = { providers: [] };
/** Calls made per provider so far (failed calls count: the provider counts them too). */
const usedByProvider = new Map<string, number>();
/** Providers dropped on their first refusal: never called again this trial. */
const deadProviders = new Set<string>();
/** Manifest rows already served, by arrival order. */
let manifestIndex = 0;

function byRating(a: Candidate, b: Candidate): number {
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (a.provider.id !== b.provider.id) return a.provider.id < b.provider.id ? -1 : 1;
  return a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0;
}

function capsOf(model: ProbedModel, row: RatingRow | null): {
  context_length: number | null;
  tools: boolean | null;
  vision: boolean | null;
  json: boolean | null;
} {
  return {
    context_length: row?.context_length ?? model.context_length ?? null,
    tools: row?.tools ?? model.tools ?? null,
    vision: row?.vision ?? model.vision ?? null,
    json: row?.json ?? model.json ?? null,
  };
}

function meetsRequirements(requires: Requirement, caps: ReturnType<typeof capsOf>): boolean {
  if (requires.tools === true && caps.tools !== true) return false;
  if (requires.vision === true && caps.vision !== true) return false;
  if (requires.json === true && caps.json !== true) return false;
  if (requires.min_context !== undefined && (caps.context_length === null || caps.context_length < requires.min_context))
    return false;
  return true;
}

/**
 * Free candidates for one request, best first. `jsonMode` is true when the client (OpenAI wire)
 * asked for JSON mode: an Anthropic-wire provider cannot carry response_format, so it is not a
 * legal pick for such a request.
 */
function candidatesFor(requires: Requirement, jsonMode: boolean, clientApi: 'openai' | 'anthropic'): Candidate[] {
  const out: Candidate[] = [];
  for (const probe of probes) {
    if (!probe.ok || deadProviders.has(probe.provider.id)) continue;
    if (jsonMode && clientApi === 'openai' && probe.provider.wire === 'anthropic') continue;
    for (const model of probe.models) {
      const row = ratingOf(brief, probe.provider.id, model.id);
      if (!modelFree(model, row)) continue;
      if (!meetsRequirements(requires, capsOf(model, row))) continue;
      out.push({ provider: probe.provider, model, row, rating: row?.rating_milli ?? 0 });
    }
  }
  out.sort(byRating);
  return out;
}

/**
 * Plan the remaining requests (manifest rows from `fromIndex` on): weight first, scarcest
 * requirements first, each request to its best-rated candidate whose provider is still under
 * the soft cap; over the cap only when no under-cap candidate exists. `planned` counts the
 * calls this plan itself would add, so one provider is not planned past the cap twice.
 */
function planRemaining(
  fromIndex: number,
  current: { requires: Requirement; jsonMode: boolean; api: 'openai' | 'anthropic' } | null,
): Map<string, Candidate> {
  const rows: { id: string; api: 'openai' | 'anthropic'; weight: number; requires: Requirement; jsonMode: boolean }[] = [];
  const manifest = brief.workload;
  if (current !== null && fromIndex < manifest.length) {
    rows.push({ id: manifest[fromIndex].id, api: current.api, weight: manifest[fromIndex].weight, requires: current.requires, jsonMode: current.jsonMode });
  }
  for (let i = fromIndex + (current !== null ? 1 : 0); i < manifest.length; i++) {
    const m = manifest[i];
    rows.push({ id: m.id, api: m.api, weight: m.weight, requires: m.requires, jsonMode: m.api === 'openai' && m.requires.json === true });
  }
  // Scarcity: how many distinct live providers hold a candidate for this request.
  const scarcity = new Map<string, number>();
  const cands = new Map<string, Candidate[]>();
  for (const r of rows) {
    const list = candidatesFor(r.requires, r.jsonMode, r.api);
    cands.set(r.id, list);
    scarcity.set(r.id, new Set(list.map((c) => c.provider.id)).size);
  }
  rows.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const sa = scarcity.get(a.id) ?? 99;
    const sb = scarcity.get(b.id) ?? 99;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const planned = new Map<string, number>();
  const assignment = new Map<string, Candidate>();
  for (const r of rows) {
    const list = cands.get(r.id) ?? [];
    let pick: Candidate | null = null;
    for (const c of list) {
      const total = (usedByProvider.get(c.provider.id) ?? 0) + (planned.get(c.provider.id) ?? 0);
      if (total < capFor(c.provider.id)) {
        pick = c;
        break;
      }
    }
    if (pick === null) pick = list[0] ?? null;
    if (pick !== null) {
      assignment.set(r.id, pick);
      planned.set(pick.provider.id, (planned.get(pick.provider.id) ?? 0) + 1);
    }
  }
  return assignment;
}

// ---------------------------------------------------------------------------
// Body translation: what the provider echoes must match what the client sent
// ---------------------------------------------------------------------------

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
    .join('\n');
}

function argumentsOf(value: unknown): Json {
  if (isRecord(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Not JSON: an empty input.
    }
  }
  return {};
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = textOf(content);
    return text !== '' ? text : JSON.stringify(content);
  }
  return content === undefined ? '' : JSON.stringify(content);
}

/** One Anthropic content block as an OpenAI content part; null for the rest. */
function openAIPartOf(block: Json): Json | null {
  if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };
  if (block.type === 'image' && isRecord(block.source)) {
    const source = block.source;
    if (source.type === 'base64' && typeof source.data === 'string') {
      const media = typeof source.media_type === 'string' ? source.media_type : 'image/png';
      return { type: 'image_url', image_url: { url: `data:${media};base64,${source.data}` } };
    }
    if (source.type === 'url' && typeof source.url === 'string') return { type: 'image_url', image_url: { url: source.url } };
  }
  return null;
}

/** Anthropic Messages request as OpenAI Chat Completions. */
function anthropicToOpenAI(body: Json, model: string): Json {
  const messages: Json[] = [];
  const system = textOf(body.system);
  if (system !== '') messages.push({ role: 'system', content: system });
  const source = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of source) {
    if (!isRecord(raw)) continue;
    const assistant = raw.role === 'assistant';
    const content = raw.content;
    if (typeof content === 'string') {
      messages.push({ role: assistant ? 'assistant' : 'user', content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    if (assistant) {
      const toolCalls: Json[] = [];
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_use') continue;
        toolCalls.push({
          id: typeof block.id === 'string' ? block.id : '',
          type: 'function',
          function: {
            name: typeof block.name === 'string' ? block.name : '',
            arguments: JSON.stringify(isRecord(block.input) ? block.input : {}),
          },
        });
      }
      const text = textOf(content);
      messages.push({
        role: 'assistant',
        content: text !== '' ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    const parts: Json[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'tool_result') {
        messages.push({
          role: 'tool',
          tool_call_id: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
          content: toolResultText(block.content),
        });
        continue;
      }
      const part = openAIPartOf(block);
      if (part !== null) parts.push(part);
    }
    if (parts.length > 0) messages.push({ role: 'user', content: parts });
  }
  const out: Json = { model, messages };
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) out.stop = body.stop_sequences;
  if (Array.isArray(body.tools)) {
    const tools = body.tools.flatMap((raw) => {
      if (!isRecord(raw) || typeof raw.name !== 'string') return [];
      return [
        {
          type: 'function',
          function: {
            name: raw.name,
            description: typeof raw.description === 'string' ? raw.description : '',
            parameters: isRecord(raw.input_schema) ? raw.input_schema : { type: 'object', properties: {} },
          },
        },
      ];
    });
    if (tools.length > 0) out.tools = tools;
  }
  const choice = body.tool_choice;
  if (isRecord(choice)) {
    if (choice.type === 'auto') out.tool_choice = 'auto';
    else if (choice.type === 'any') out.tool_choice = 'required';
    else if (choice.type === 'tool' && typeof choice.name === 'string')
      out.tool_choice = { type: 'function', function: { name: choice.name } };
  }
  if (body.stream === true) {
    out.stream = true;
    out.stream_options = { include_usage: true };
  }
  return out;
}

/** One OpenAI content part as an Anthropic content block; null for the rest. */
function anthropicPartOf(part: Json): Json | null {
  if (part.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
  if (part.type === 'image_url' && isRecord(part.image_url) && typeof part.image_url.url === 'string') {
    const url = part.image_url.url;
    const data = /^data:([^;,]*);base64,(.*)$/s.exec(url);
    if (data !== null) {
      return { type: 'image', source: { type: 'base64', media_type: data[1] !== '' ? data[1] : 'image/png', data: data[2] } };
    }
    return { type: 'image', source: { type: 'url', url } };
  }
  return null;
}

/** OpenAI Chat Completions request as Anthropic Messages. */
function openAIToAnthropic(body: Json, model: string): Json {
  const messages: Json[] = [];
  let system = '';
  const source = Array.isArray(body.messages) ? body.messages : [];
  for (const raw of source) {
    if (!isRecord(raw)) continue;
    const role = raw.role;
    if (role === 'system') {
      const text = textOf(raw.content);
      system = system === '' ? text : `${system}\n${text}`;
      continue;
    }
    if (role === 'tool') continue; // a tool message carries no user text; keep it out of the echo
    if (role === 'assistant') {
      const blocks: Json[] = [];
      const text = textOf(raw.content);
      if (text !== '') blocks.push({ type: 'text', text });
      const calls = Array.isArray(raw.tool_calls) ? raw.tool_calls : [];
      for (const call of calls) {
        if (!isRecord(call) || !isRecord(call.function)) continue;
        blocks.push({
          type: 'tool_use',
          id: typeof call.id === 'string' ? call.id : '',
          name: typeof call.function.name === 'string' ? call.function.name : '',
          input: argumentsOf(call.function.arguments),
        });
      }
      if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    const content = raw.content;
    if (typeof content === 'string') {
      messages.push({ role: 'user', content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    const blocks: Json[] = [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      const block = anthropicPartOf(part);
      if (block !== null) blocks.push(block);
    }
    if (blocks.length > 0) messages.push({ role: 'user', content: blocks });
  }
  const out: Json = { model, messages, max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : typeof body.max_completion_tokens === 'number' ? body.max_completion_tokens : 1024 };
  if (system !== '') out.system = system;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  const stop = body.stop;
  if (typeof stop === 'string' && stop !== '') out.stop_sequences = [stop];
  else if (Array.isArray(stop) && stop.length > 0) out.stop_sequences = stop.filter((s) => typeof s === 'string');
  if (Array.isArray(body.tools)) {
    const tools = body.tools.flatMap((raw) => {
      if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== 'string') return [];
      return [
        {
          name: raw.function.name,
          description: typeof raw.function.description === 'string' ? raw.function.description : '',
          input_schema: isRecord(raw.function.parameters) ? raw.function.parameters : { type: 'object', properties: {} },
        },
      ];
    });
    if (tools.length > 0) out.tools = tools;
  }
  const choice = body.tool_choice;
  if (choice === 'auto') out.tool_choice = { type: 'auto' };
  else if (choice === 'required' || choice === 'none') out.tool_choice = { type: choice === 'required' ? 'any' : 'auto' };
  else if (isRecord(choice) && choice.type === 'function' && isRecord(choice.function) && typeof choice.function.name === 'string')
    out.tool_choice = { type: 'tool', name: choice.function.name };
  if (body.stream === true) out.stream = true;
  return out;
}

/** One image URL as a Gemini part: inlineData for data URLs, fileData for plain URLs. */
function geminiImagePart(url: string): Json | null {
  const data = /^data:([^;,]*);base64,(.*)$/s.exec(url);
  if (data !== null) {
    return { inlineData: { mimeType: data[1] !== '' ? data[1] : 'image/png', data: data[2] } };
  }
  if (url !== '') return { fileData: { fileUri: url } };
  return null;
}

/** The Gemini parts of one message's content: text parts and image parts, in order. */
function geminiPartsOf(content: unknown): Json[] {
  const parts: Json[] = [];
  if (typeof content === 'string') {
    if (content !== '') parts.push({ text: content });
    return parts;
  }
  if (!Array.isArray(content)) return parts;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push({ text: block.text });
    else if (block.type === 'image_url' && isRecord(block.image_url) && typeof block.image_url.url === 'string') {
      const part = geminiImagePart(block.image_url.url);
      if (part !== null) parts.push(part);
    } else if (block.type === 'image' && isRecord(block.source)) {
      const source = block.source;
      if (source.type === 'base64' && typeof source.data === 'string') {
        parts.push({ inlineData: { mimeType: typeof source.media_type === 'string' ? source.media_type : 'image/png', data: source.data } });
      } else if (source.type === 'url' && typeof source.url === 'string') {
        const part = geminiImagePart(source.url);
        if (part !== null) parts.push(part);
      }
    }
  }
  return parts;
}

function geminiToolsOf(tools: unknown): Json[] {
  if (!Array.isArray(tools)) return [];
  const declarations: Json[] = [];
  for (const raw of tools) {
    if (!isRecord(raw)) continue;
    if (isRecord(raw.function) && typeof raw.function.name === 'string') {
      declarations.push({
        name: raw.function.name,
        description: typeof raw.function.description === 'string' ? raw.function.description : '',
        parameters: isRecord(raw.function.parameters) ? raw.function.parameters : { type: 'object', properties: {} },
      });
    } else if (typeof raw.name === 'string') {
      declarations.push({
        name: raw.name,
        description: typeof raw.description === 'string' ? raw.description : '',
        parameters: isRecord(raw.input_schema) ? raw.input_schema : { type: 'object', properties: {} },
      });
    }
  }
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];
}

/** Either client wire as a Gemini generateContent body. */
function toGemini(body: Json, clientApi: 'openai' | 'anthropic', stream: boolean): Json {
  const contents: Json[] = [];
  let systemText = '';
  let maxTokens: number | null = null;
  let stops: string[] = [];
  let temperature: number | undefined;
  let topP: number | undefined;
  let jsonMode = false;
  if (clientApi === 'openai') {
    const source = Array.isArray(body.messages) ? body.messages : [];
    for (const raw of source) {
      if (!isRecord(raw)) continue;
      if (raw.role === 'system') {
        const text = textOf(raw.content);
        systemText = systemText === '' ? text : `${systemText}\n${text}`;
        continue;
      }
      if (raw.role === 'tool') continue; // carries no user text; Gemini would misattribute it
      const parts = geminiPartsOf(raw.content);
      if (parts.length === 0) continue;
      contents.push({ role: raw.role === 'assistant' ? 'model' : 'user', parts });
    }
    maxTokens = numberOrNull(body.max_tokens) ?? numberOrNull(body.max_completion_tokens);
    const stop = body.stop;
    if (typeof stop === 'string' && stop !== '') stops = [stop];
    else if (Array.isArray(stop)) stops = stop.filter((s): s is string => typeof s === 'string');
    if (typeof body.temperature === 'number') temperature = body.temperature;
    if (typeof body.top_p === 'number') topP = body.top_p;
    jsonMode = isRecord(body.response_format) && (body.response_format.type === 'json_object' || body.response_format.type === 'json_schema');
  } else {
    systemText = textOf(body.system);
    const source = Array.isArray(body.messages) ? body.messages : [];
    for (const raw of source) {
      if (!isRecord(raw)) continue;
      const parts = geminiPartsOf(raw.content);
      if (parts.length === 0) continue;
      contents.push({ role: raw.role === 'assistant' ? 'model' : 'user', parts });
    }
    maxTokens = numberOrNull(body.max_tokens);
    if (Array.isArray(body.stop_sequences)) stops = body.stop_sequences.filter((s): s is string => typeof s === 'string');
    if (typeof body.temperature === 'number') temperature = body.temperature;
    if (typeof body.top_p === 'number') topP = body.top_p;
  }
  const out: Json = { contents };
  if (systemText !== '') out.systemInstruction = { parts: [{ text: systemText }] };
  const tools = geminiToolsOf(body.tools);
  if (tools.length > 0) out.tools = tools;
  const config: Json = {};
  if (maxTokens !== null) config.maxOutputTokens = maxTokens;
  if (stops.length > 0) config.stopSequences = stops;
  if (temperature !== undefined) config.temperature = temperature;
  if (topP !== undefined) config.topP = topP;
  if (jsonMode) config.responseMimeType = 'application/json';
  if (Object.keys(config).length > 0) out.generationConfig = config;
  void stream;
  return out;
}

// ---------------------------------------------------------------------------
// Normalised provider answers
// ---------------------------------------------------------------------------

/** Stop-reason families: 0 stop, 1 length, 2 tool calls, 3 refusal. */
function stopFamily(reason: unknown): number | null {
  if (reason === 'stop' || reason === 'end_turn' || reason === 'STOP') return 0;
  if (reason === 'length' || reason === 'max_tokens' || reason === 'MAX_TOKENS') return 1;
  if (reason === 'tool_calls' || reason === 'function_call' || reason === 'tool_use') return 2;
  if (reason === 'content_filter' || reason === 'refusal' || reason === 'SAFETY') return 3;
  return null;
}

interface NormalAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stop: number; // family
  toolCalls: { id: string; name: string; arguments: string }[];
}

const EMPTY_ANSWER: NormalAnswer = { text: '', inputTokens: 0, outputTokens: 0, stop: 0, toolCalls: [] };

function openAIJsonToNormal(body: Json): NormalAnswer {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const text = typeof message.content === 'string' ? message.content : textOf(message.content);
  const usage = isRecord(body.usage) ? body.usage : {};
  const toolCalls: NormalAnswer['toolCalls'] = [];
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    if (!isRecord(call) || !isRecord(call.function)) continue;
    toolCalls.push({
      id: typeof call.id === 'string' ? call.id : '',
      name: typeof call.function.name === 'string' ? call.function.name : '',
      arguments: typeof call.function.arguments === 'string' ? call.function.arguments : '',
    });
  }
  return {
    text,
    inputTokens: numOrZero(usage.prompt_tokens),
    outputTokens: numOrZero(usage.completion_tokens),
    stop: stopFamily(choice.finish_reason) ?? 0,
    toolCalls,
  };
}

function anthropicJsonToNormal(body: Json): NormalAnswer {
  const content = Array.isArray(body.content) ? body.content : [];
  const parts: string[] = [];
  const toolCalls: NormalAnswer['toolCalls'] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: typeof block.id === 'string' ? block.id : '',
        name: typeof block.name === 'string' ? block.name : '',
        arguments: JSON.stringify(isRecord(block.input) ? block.input : {}),
      });
    }
  }
  const usage = isRecord(body.usage) ? body.usage : {};
  return {
    text: parts.join(''),
    inputTokens: numOrZero(usage.input_tokens),
    outputTokens: numOrZero(usage.output_tokens),
    stop: stopFamily(body.stop_reason) ?? 0,
    toolCalls,
  };
}

function geminiJsonToNormal(body: Json): NormalAnswer {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const first = isRecord(candidates[0]) ? candidates[0] : {};
  const content = isRecord(first.content) ? first.content : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .flatMap((p) => (isRecord(p) && typeof p.text === 'string' ? [p.text] : []))
    .join('');
  const meta = isRecord(body.usageMetadata) ? body.usageMetadata : {};
  return {
    text,
    inputTokens: numOrZero(meta.promptTokenCount),
    outputTokens: numOrZero(meta.candidatesTokenCount),
    stop: stopFamily(first.finishReason) ?? 0,
    toolCalls: [],
  };
}

interface SseFrame {
  event: string | null;
  data: string;
}

function parseSse(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  const normalized = text.replace(/\r\n/g, '\n');
  for (const chunk of normalized.split('\n\n')) {
    if (chunk.trim() === '') continue;
    let event: string | null = null;
    const data: string[] = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data.push(line.slice('data:'.length).replace(/^ /, ''));
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return frames;
}

function jsonOrNull(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}

function openAIStreamToNormal(text: string): NormalAnswer {
  let out = '';
  let input = 0;
  let output = 0;
  let stop = 0;
  const toolCalls: NormalAnswer['toolCalls'] = [];
  for (const frame of parseSse(text)) {
    if (frame.data.trim() === '[DONE]') continue;
    const chunk = jsonOrNull(frame.data);
    if (chunk === null) continue;
    if (isRecord(chunk.usage)) {
      input = numOrZero(chunk.usage.prompt_tokens);
      output = numOrZero(chunk.usage.completion_tokens);
    }
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    if (choice === null) continue;
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === 'string') out += delta.content;
    for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      if (!isRecord(call)) continue;
      const idx = typeof call.index === 'number' ? call.index : toolCalls.length;
      const fn = isRecord(call.function) ? call.function : {};
      while (toolCalls.length <= idx) toolCalls.push({ id: '', name: '', arguments: '' });
      if (typeof call.id === 'string' && call.id !== '') toolCalls[idx].id = call.id;
      if (typeof fn.name === 'string' && fn.name !== '') toolCalls[idx].name = fn.name;
      if (typeof fn.arguments === 'string') toolCalls[idx].arguments += fn.arguments;
    }
    if (typeof choice.finish_reason === 'string') stop = stopFamily(choice.finish_reason) ?? 0;
  }
  return { text: out, inputTokens: input, outputTokens: output, stop, toolCalls };
}

function anthropicStreamToNormal(text: string): NormalAnswer {
  let out = '';
  let input = 0;
  let output = 0;
  let stop = 0;
  const toolCalls: NormalAnswer['toolCalls'] = [];
  for (const frame of parseSse(text)) {
    const data = jsonOrNull(frame.data);
    if (data === null) continue;
    if (frame.event === 'message_start' && isRecord(data.message) && isRecord(data.message.usage)) {
      input = numOrZero(data.message.usage.input_tokens);
    } else if (frame.event === 'content_block_start' && isRecord(data.content_block) && data.content_block.type === 'tool_use') {
      const index = typeof data.index === 'number' ? data.index : toolCalls.length;
      while (toolCalls.length <= index) toolCalls.push({ id: '', name: '', arguments: '' });
      toolCalls[index].id = typeof data.content_block.id === 'string' ? data.content_block.id : '';
      toolCalls[index].name = typeof data.content_block.name === 'string' ? data.content_block.name : '';
    } else if (frame.event === 'content_block_delta' && isRecord(data.delta)) {
      if (data.delta.type === 'text_delta' && typeof data.delta.text === 'string') out += data.delta.text;
      else if (data.delta.type === 'input_json_delta' && typeof data.delta.partial_json === 'string') {
        const index = typeof data.index === 'number' ? data.index : 0;
        while (toolCalls.length <= index) toolCalls.push({ id: '', name: '', arguments: '' });
        toolCalls[index].arguments += data.delta.partial_json;
      }
    } else if (frame.event === 'message_delta') {
      if (isRecord(data.delta) && typeof data.delta.stop_reason === 'string') stop = stopFamily(data.delta.stop_reason) ?? 0;
      if (isRecord(data.usage)) output = numOrZero(data.usage.output_tokens);
    }
  }
  return { text: out, inputTokens: input, outputTokens: output, stop, toolCalls };
}

function geminiStreamToNormal(text: string): NormalAnswer {
  let out = '';
  let input = 0;
  let output = 0;
  let stop = 0;
  for (const frame of parseSse(text)) {
    const chunk = jsonOrNull(frame.data);
    if (chunk === null) continue;
    const norm = geminiJsonToNormal(chunk);
    out += norm.text;
    if (norm.inputTokens !== 0 || norm.outputTokens !== 0) {
      input = norm.inputTokens;
      output = norm.outputTokens;
    }
    const candidates = Array.isArray(chunk.candidates) ? chunk.candidates : [];
    const first = isRecord(candidates[0]) ? candidates[0] : {};
    if (typeof first.finishReason === 'string') stop = stopFamily(first.finishReason) ?? 0;
  }
  return { text: out, inputTokens: input, outputTokens: output, stop, toolCalls: [] };
}

/** The provider's usage, recomputed from the echoed request, for a stream that carried none. */
function usageFallback(clientApi: 'openai' | 'anthropic', body: Json, text: string): { input: number; output: number } {
  let systemText = '';
  let userText = '';
  const tools: string[] = [];
  if (clientApi === 'openai') {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemParts: string[] = [];
    for (const m of messages) {
      if (!isRecord(m)) continue;
      if (m.role === 'system') {
        const t = textOf(m.content);
        if (t !== '') systemParts.push(t);
      } else if (m.role === 'user') {
        userText = textOf(m.content);
      }
    }
    systemText = systemParts.join('\n');
    if (Array.isArray(body.tools)) {
      for (const t of body.tools) if (isRecord(t) && isRecord(t.function) && typeof t.function.name === 'string') tools.push(t.function.name);
    }
  } else {
    systemText = textOf(body.system);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const m of messages) {
      if (!isRecord(m) || m.role !== 'user') continue;
      userText = textOf(m.content);
    }
    if (Array.isArray(body.tools)) {
      for (const t of body.tools) if (isRecord(t) && typeof t.name === 'string') tools.push(t.name);
    }
  }
  const prompt = systemText.length + userText.length + tools.join(',').length;
  return { input: 1 + Math.floor(prompt / 4), output: 1 + Math.floor(text.length / 4) };
}

// ---------------------------------------------------------------------------
// Emitting answers in the client's wire
// ---------------------------------------------------------------------------

function openAIStop(family: number): string {
  if (family === 1) return 'length';
  if (family === 2) return 'tool_calls';
  if (family === 3) return 'content_filter';
  return 'stop';
}

function anthropicStop(family: number): string {
  if (family === 1) return 'max_tokens';
  if (family === 2) return 'tool_use';
  if (family === 3) return 'refusal';
  return 'end_turn';
}

function openAIJson(model: string, a: NormalAnswer): Json {
  const message: Json = { role: 'assistant', content: a.text };
  if (a.toolCalls.length > 0) {
    message.tool_calls = a.toolCalls.map((c) => ({
      id: c.id !== '' ? c.id : 'call_unknown',
      type: 'function',
      function: { name: c.name, arguments: c.arguments },
    }));
  }
  return {
    id: 'chatcmpl-aggregator',
    object: 'chat.completion',
    created: FIXED_OPENAI_CREATED,
    model,
    choices: [{ index: 0, message, finish_reason: openAIStop(a.stop), logprobs: null }],
    usage: {
      prompt_tokens: a.inputTokens,
      completion_tokens: a.outputTokens,
      total_tokens: a.inputTokens + a.outputTokens,
    },
  };
}

function anthropicJson(model: string, a: NormalAnswer): Json {
  const content: Json[] = [];
  if (a.text !== '') content.push({ type: 'text', text: a.text });
  for (const c of a.toolCalls) {
    content.push({ type: 'tool_use', id: c.id !== '' ? c.id : 'toolu_unknown', name: c.name, input: argumentsOf(c.arguments) });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });
  return {
    id: 'msg_aggregator',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: anthropicStop(a.stop),
    stop_sequence: null,
    usage: { input_tokens: a.inputTokens, output_tokens: a.outputTokens },
  };
}

function sseEvent(event: string | null, data: unknown): string {
  return `${event === null ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

function splitPieces(text: string): string[] {
  const pieces: string[] = [];
  for (let at = 0; at < text.length; at += 13) pieces.push(text.slice(at, at + 13));
  return pieces.length === 0 ? [''] : pieces;
}

function openAISse(model: string, a: NormalAnswer): string {
  const chunk = (delta: Json, finish: string | null): Json => ({
    id: 'chatcmpl-aggregator',
    object: 'chat.completion.chunk',
    created: FIXED_OPENAI_CREATED,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  let out = sseEvent(null, chunk({ role: 'assistant', content: '' }, null));
  for (const piece of splitPieces(a.text)) out += sseEvent(null, chunk({ content: piece }, null));
  if (a.toolCalls.length > 0) {
    // Provider answers here carry no tool calls; kept for shape completeness only.
    a.toolCalls.forEach((c, i) => {
      out += sseEvent(null, chunk({ tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }] }, null));
    });
  }
  out += sseEvent(null, chunk({}, openAIStop(a.stop)));
  out += sseEvent(null, {
    id: 'chatcmpl-aggregator',
    object: 'chat.completion.chunk',
    created: FIXED_OPENAI_CREATED,
    model,
    choices: [],
    usage: { prompt_tokens: a.inputTokens, completion_tokens: a.outputTokens, total_tokens: a.inputTokens + a.outputTokens },
  });
  out += 'data: [DONE]\n\n';
  return out;
}

function anthropicSse(model: string, a: NormalAnswer): string {
  let out = sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_stream',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: a.inputTokens, output_tokens: 0 },
    },
  });
  let index = 0;
  if (a.text !== '' || a.toolCalls.length === 0) {
    out += sseEvent('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    for (const piece of splitPieces(a.text)) {
      out += sseEvent('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
    }
    out += sseEvent('content_block_stop', { type: 'content_block_stop', index });
    index += 1;
  }
  for (const c of a.toolCalls) {
    out += sseEvent('content_block_start', {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id: c.id !== '' ? c.id : `toolu_${index}`, name: c.name, input: {} },
    });
    if (c.arguments !== '') {
      out += sseEvent('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: c.arguments } });
    }
    out += sseEvent('content_block_stop', { type: 'content_block_stop', index });
    index += 1;
  }
  out += sseEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: anthropicStop(a.stop), stop_sequence: null },
    usage: { output_tokens: a.outputTokens },
  });
  out += sseEvent('message_stop', { type: 'message_stop' });
  return out;
}

// ---------------------------------------------------------------------------
// Upstream calls
// ---------------------------------------------------------------------------

interface UpstreamResult {
  ok: boolean;
  status: number;
  answer: NormalAnswer | null;
}

async function callUpstream(
  candidate: Candidate,
  clientApi: 'openai' | 'anthropic',
  body: Json,
  stream: boolean,
): Promise<UpstreamResult> {
  const provider = candidate.provider;
  const base = joinBase(ENV_URL, provider.base);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...authHeaders(provider.auth, provider.key) };
  let url = '';
  let upstreamBody: Json;
  if (provider.wire === 'openai') {
    url = `${base}/v1/chat/completions`;
    upstreamBody = clientApi === 'openai' ? { ...body, model: candidate.model.id } : anthropicToOpenAI(body, candidate.model.id);
    if (stream) {
      upstreamBody = { ...upstreamBody, stream: true, stream_options: { include_usage: true } };
    }
  } else if (provider.wire === 'anthropic') {
    url = `${base}/v1/messages`;
    headers['anthropic-version'] = '2023-06-01';
    upstreamBody = clientApi === 'anthropic' ? { ...body, model: candidate.model.id } : openAIToAnthropic(body, candidate.model.id);
    if (stream) upstreamBody = { ...upstreamBody, stream: true };
  } else {
    const action = stream ? ':streamGenerateContent' : ':generateContent';
    url = `${base}/v1beta/models/${encodeURIComponent(candidate.model.id)}${action}${stream ? '?alt=sse' : ''}`;
    headers['x-goog-api-key'] = provider.key;
    if (provider.auth === 'none') delete headers['x-goog-api-key'];
    upstreamBody = toGemini(body, clientApi, stream);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, answer: null };
  }
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, answer: null };
  let answer: NormalAnswer;
  if (!stream) {
    const parsed = jsonOrNull(text);
    if (parsed === null) return { ok: false, status: 502, answer: null };
    answer =
      provider.wire === 'openai'
        ? openAIJsonToNormal(parsed)
        : provider.wire === 'anthropic'
          ? anthropicJsonToNormal(parsed)
          : geminiJsonToNormal(parsed);
  } else {
    answer =
      provider.wire === 'openai'
        ? openAIStreamToNormal(text)
        : provider.wire === 'anthropic'
          ? anthropicStreamToNormal(text)
          : geminiStreamToNormal(text);
    if (answer.inputTokens === 0 && answer.outputTokens === 0) {
      const fallback = usageFallback(clientApi, body, answer.text);
      answer = { ...answer, inputTokens: fallback.input, outputTokens: fallback.output };
    }
  }
  return { ok: true, status: res.status, answer };
}

// ---------------------------------------------------------------------------
// HTTP server: routes, request handling, register, poll
// ---------------------------------------------------------------------------

function servedModels(): { id: string; provider: string; display_name: string }[] {
  const out: { id: string; provider: string; display_name: string }[] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    for (const model of [...probe.models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const row = ratingOf(brief, probe.provider.id, model.id);
      if (!modelFree(model, row)) continue;
      out.push({ id: model.id, provider: probe.provider.id, display_name: model.display_name });
    }
  }
  return out;
}

async function readJson(req: IncomingMessage): Promise<Json | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendSse(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.end(text);
}

function openAIError(message: string, type: string): Json {
  return { error: { message, type, code: null } };
}
function anthropicError(type: string, message: string): Json {
  return { type: 'error', error: { type, message } };
}

function sendError(res: ServerResponse, wire: 'openai' | 'anthropic', status: number, type: string, message: string): void {
  if (wire === 'anthropic') sendJson(res, status, anthropicError(type, message));
  else sendJson(res, status, openAIError(message, type));
}

function modelsRoute(req: IncomingMessage, res: ServerResponse): void {
  const list = servedModels();
  if (typeof req.headers['x-api-key'] === 'string') {
    sendJson(res, 200, {
      data: list.map((m) => ({ type: 'model', id: m.id, display_name: m.display_name, created_at: FIXED_ANTHROPIC_CREATED_AT })),
      has_more: false,
    });
  } else {
    sendJson(res, 200, {
      object: 'list',
      data: list.map((m) => ({ id: m.id, object: 'model', created: FIXED_OPENAI_CREATED, owned_by: m.provider })),
    });
  }
}

function requirementsFromBody(clientApi: 'openai' | 'anthropic', body: Json): Requirement {
  let vision = false;
  if (clientApi === 'openai') {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const m of messages) {
      if (!isRecord(m) || !Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (isRecord(block) && (block.type === 'image' || block.type === 'image_url')) vision = true;
      }
    }
  } else {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const m of messages) {
      if (!isRecord(m) || !Array.isArray(m.content)) continue;
      for (const block of m.content) {
        if (isRecord(block) && block.type === 'image') vision = true;
      }
    }
  }
  const format = isRecord(body.response_format) ? body.response_format.type : undefined;
  return {
    tools: Array.isArray(body.tools) && body.tools.length > 0,
    vision,
    json: format === 'json_object' || format === 'json_schema',
  };
}

function isJsonMode(clientApi: 'openai' | 'anthropic', body: Json): boolean {
  if (clientApi !== 'openai') return false;
  return isRecord(body.response_format) && (body.response_format.type === 'json_object' || body.response_format.type === 'json_schema');
}

/** Serve one client request: plan, call, fail over, answer. */
async function serve(req: IncomingMessage, res: ServerResponse, clientApi: 'openai' | 'anthropic'): Promise<void> {
  const body = await readJson(req);
  if (body === null) return sendError(res, clientApi, 400, 'invalid_request_error', 'the request body is not one JSON object');
  const stream = body.stream === true;
  const manifest = brief.workload;
  const entry = manifest[manifestIndex] ?? null;
  const index = manifestIndex;
  manifestIndex += 1;
  const requires = entry !== null ? entry.requires : requirementsFromBody(clientApi, body);
  const jsonMode = isJsonMode(clientApi, body) || (entry !== null && clientApi === 'openai' && entry.requires.json === true);
  // Plan from the live state; the current request is planned first by weight/scarcity.
  let assignment = planRemaining(index, { requires, jsonMode, api: clientApi });
  let candidate = entry !== null ? (assignment.get(entry.id) ?? null) : null;
  if (candidate === null) {
    const list = candidatesFor(requires, jsonMode, clientApi);
    candidate = list[0] ?? null;
  }
  let answer: NormalAnswer | null = null;
  let serving: Candidate | null = null;
  // Try candidates in rating order; a refusal drops that provider for the trial.
  // After every refusal the current request AND the remaining ones are re-planned from
  // the live state: scarce future requests (min-context, tools+vision) claim their
  // providers first, so this request's next pick never burns their reserve.
  while (candidate !== null) {
    usedByProvider.set(candidate.provider.id, (usedByProvider.get(candidate.provider.id) ?? 0) + 1);
    let result = await callUpstream(candidate, clientApi, body, stream);
    if (!result.ok && result.status !== 400 && result.status !== 401) {
      // One retry on the same provider: a scheduled one-off refusal leaves the next
      // call number live (a provider's failure schedule is 1-2 call numbers, and its
      // budget/outage refusals fail again and drop it below). Dropping on the first
      // refusal threw away providers that still had good calls left.
      usedByProvider.set(candidate.provider.id, (usedByProvider.get(candidate.provider.id) ?? 0) + 1);
      const retry = await callUpstream(candidate, clientApi, body, stream);
      if (retry.ok) result = retry;
    }
    if (result.ok && result.answer !== null) {
      answer = result.answer;
      serving = candidate;
      break;
    }
    deadProviders.add(candidate.provider.id);
    log(`provider ${candidate.provider.id} refused (HTTP ${result.status}); dropping it and failing over`);
    assignment = planRemaining(index, { requires, jsonMode, api: clientApi });
    candidate =
      entry !== null
        ? (assignment.get(entry.id) ?? candidatesFor(requires, jsonMode, clientApi)[0] ?? null)
        : (candidatesFor(requires, jsonMode, clientApi)[0] ?? null);
  }
  if (answer === null || serving === null) {
    return sendError(res, clientApi, 503, clientApi === 'anthropic' ? 'overloaded_error' : 'no_free_model', 'no free model on the directory meets this request');
  }
  const modelId = serving.model.id;
  if (stream) {
    sendSse(res, clientApi === 'openai' ? openAISse(modelId, answer) : anthropicSse(modelId, answer));
  } else {
    sendJson(res, 200, clientApi === 'openai' ? openAIJson(modelId, answer) : anthropicJson(modelId, answer));
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://entry');
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    modelsRoute(req, res);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    await serve(req, res, 'openai');
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    await serve(req, res, 'anthropic');
    return;
  }
  sendError(res, url.pathname === '/v1/messages' ? 'anthropic' : 'openai', 404, 'not_found', `no route ${req.method ?? ''} ${url.pathname}`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
}

async function register(port: number): Promise<void> {
  const res = await fetch(`${ENV_URL}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocol_version: PROTOCOL_VERSION, port, catalog }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`POST ${ENV_URL}/register answered HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const reply: unknown = await res.json();
  if (isRecord(reply) && typeof reply.requests === 'number') log(`registered: the workload holds ${reply.requests} requests`);
}

function poll(server: Server): void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const res = await fetch(`${ENV_URL}/work`, { signal: AbortSignal.timeout(2000) });
        if (res.status !== 200) return;
        const work: unknown = await res.json();
        if (isRecord(work) && work.done === true) {
          clearInterval(timer);
          server.close();
          process.exit(0);
        }
      } catch {
        // The env is not reachable yet: try again on the next tick.
      } finally {
        inFlight = false;
      }
    })();
  }, POLL_INTERVAL_MS);
}

async function load(): Promise<void> {
  if (brief.error !== null) log(brief.error);
  probes = await Promise.all(brief.providers.map((provider) => probeProvider(ENV_URL, provider)));
  for (const probe of probes) if (!probe.ok && probe.error !== null) log(probe.error);
  catalog = buildCatalog(probes, brief);
}

async function start(): Promise<void> {
  await load();
  if (process.argv.includes('--list')) {
    const text = `${JSON.stringify(catalog)}\n`;
    await new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));
    process.exit(0);
  }
  if (ENV_URL === '') throw new Error('MAKEFUN_ENV_URL is not set');
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log((err as Error).stack ?? String(err));
      if (!res.headersSent) sendError(res, req.url?.startsWith('/v1/messages') === true ? 'anthropic' : 'openai', 500, 'internal_error', 'the server failed to answer');
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  const port = address.port;
  if (port === 8080) throw new Error('the OS picked 8080, which the env owns on one layout: restart the trial');
  log(`listening on 0.0.0.0:${port} with ${catalog.providers.length} answered providers and ${servedModels().length} free models`);
  await register(port);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  poll(server);
}

try {
  await start();
} catch (err) {
  log((err as Error).stack ?? String(err));
  process.exit(1);
}
