// photo-geolocator-01 entry: a two-pass vision-model geolocator.
//
// Pass 1 asks claude-sonnet-5-5 once per photo, with a GeoGuessr-style reasoning
// prompt, for country, region, coordinates and a self-reported confidence.
// Pass 2 asks claude-opus-5-5 to verify and refine only the least confident
// photos (confidence < 0.65, or no coordinates parsed), at most 10, showing it
// the first pass's guess and reasoning. Every photo gets an answer: when both
// passes fail a photo, a fixed fallback coordinate is posted rather than
// leaving it unanswered (an unanswered photo counts the maximum 20,015 km).
//
// Runs as the grader runs an entry, `node /bot/main.ts` on Node 22 (erasable
// TypeScript, the standard library only), with the trial's variables:
// MAKEFUN_ENV_URL (the env), ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY (the
// gateway and the key it swaps for the real one). With no Anthropic key the
// model calls are refused and every photo takes the fallback.
//
// Deterministic given the model's answers: every request is a function of the
// photo's bytes, the fixed prompts and the answers before it; calls run in
// parallel but answers are collected by photo index and posted in photo
// order; no wall clock, no unseeded randomness. Retries use a fixed backoff.
// A gateway refusal (4xx) is final for that call.

const MODEL_1 = 'claude-sonnet-5-5';
const MODEL_2 = 'claude-opus-5-5';
const MAX_TOKENS_1 = 768;
const MAX_TOKENS_2 = 512;
const CONCURRENCY_1 = 3;
const CONCURRENCY_2 = 2;
const LOW_CONFIDENCE = 0.65;
const MAX_REFINEMENTS = 10;
/** Fallback when no model answer yields coordinates: northern Africa, roughly
 *  central to the populated world. Any fixed land point beats leaving a photo
 *  unanswered (20,015 km). */
const FALLBACK = { lat: 25.0, lon: 10.0 };

const PROMPT_1 =
  'You are a GeoGuessr expert. Look at this street-level photo and determine where on Earth it was taken. ' +
  'Reason briefly (2-4 sentences) about the visible clues: language and script on signs, driving side, ' +
  'road markings and signs, license plates, architecture, vegetation, terrain, climate, vehicles, street ' +
  'furniture. Then give your best estimate as one line of JSON: ' +
  '{"country": "<country name>", "region": "<region or city>", "lat": <degrees north>, "lon": <degrees east>, "confidence": <0-1>}. ' +
  'Latitude -90 to 90, longitude -180 to 180. Be as precise as you can: city or street level when the clues allow it.';

const PROMPT_2 =
  'You are a GeoGuessr expert verifying a colleague\'s guess. This street-level photo was provisionally placed at ' +
  'latitude {lat}, longitude {lon} ({country}, {region}), with this reasoning: {reasoning} ' +
  'Look carefully at the photo yourself. If the guess is wrong, correct it; if it is right, confirm it or refine it. ' +
  'Reason briefly (2-4 sentences), then give your best estimate as one line of JSON: ' +
  '{"country": "<country name>", "region": "<region or city>", "lat": <degrees north>, "lon": <degrees east>, "confidence": <0-1>}.';

/** Retried with a fixed backoff: a provider's transient errors. A gateway refusal (4xx) is final. */
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504, 529];
const RETRIES = 3;

interface Photo {
  id: string;
  url: string;
  answered: boolean;
}

interface Guess {
  id: string;
  lat: number;
  lon: number;
  confidence: number;
  country: string;
  region: string;
  reasoning: string;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

function need(name: string): string {
  const v = env(name);
  if (v === undefined) throw new Error(`${name} is not set`);
  return v;
}

const envUrl = need('MAKEFUN_ENV_URL').replace(/\/+$/, '');
const anthropicUrl = env('ANTHROPIC_BASE_URL')?.replace(/\/+$/, '');
const apiKey = env('ANTHROPIC_API_KEY');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The model's answer to one photo, as text; null when no model is configured or the gateway refused the call (final). */
async function ask(jpeg: Buffer, model: string, maxTokens: number, prompt: string): Promise<string | null> {
  if (anthropicUrl === undefined || apiKey === undefined) return null;
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`${anthropicUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body,
    });
    if (res.ok) {
      const msg = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (msg.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n');
    }
    const text = await res.text();
    // A 502 naming an unreachable/no-model upstream will never succeed on
    // retry (proven 2026-11-12: 35 calls x 4 attempts = 140 wasted
    // requests); fail fast to the fallback instead of burning the budget.
    const deadUpstream = /upstream_unreachable|no[-_ ]model|model_unavailable/i.test(text);
    if (!deadUpstream && RETRY_STATUSES.includes(res.status) && res.headers.get('x-should-retry') !== 'false' && attempt < RETRIES) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    process.stderr.write(`geolocator: the model call was refused (HTTP ${res.status}): ${text.slice(0, 300)}\n`);
    return null;
  }
}

const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLon = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
const isConf = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** The guess an answer gives: its first JSON object with lat and lon, else its first two numbers in range. */
function parseGuess(id: string, text: string): Guess | null {
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]) as Record<string, unknown>;
      const lat = o.lat ?? o.latitude;
      const lon = o.lon ?? o.lng ?? o.longitude;
      if (isLat(lat) && isLon(lon)) {
        const conf = o.confidence ?? o.conf ?? 0.5;
        return {
          id,
          lat,
          lon,
          confidence: isConf(conf) ? conf : 0.5,
          country: typeof o.country === 'string' ? o.country : '',
          region: typeof o.region === 'string' ? o.region : '',
          reasoning: text.slice(0, 600),
        };
      }
    } catch {
      // Not JSON: the next one, or the numbers below.
    }
  }
  const nums = [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  for (let i = 0; i + 1 < nums.length; i += 1) {
    if (isLat(nums[i]) && isLon(nums[i + 1])) {
      return { id, lat: nums[i]!, lon: nums[i + 1]!, confidence: 0.5, country: '', region: '', reasoning: text.slice(0, 600) };
    }
  }
  return null;
}

async function main(): Promise<number> {
  const listed = (await (await fetch(`${envUrl}/photos`)).json()) as { photos: Photo[] };
  const photos = listed.photos.filter((p) => !p.answered);
  if (photos.length === 0) {
    process.stdout.write('geolocator: no unanswered photos\n');
    return 0;
  }
  const jpegs = new Map<string, Buffer>();
  const fetchJpeg = async (p: Photo): Promise<Buffer> => {
    const hit = jpegs.get(p.id);
    if (hit !== undefined) return hit;
    const buf = Buffer.from(await (await fetch(`${envUrl}${p.url}`)).arrayBuffer());
    jpegs.set(p.id, buf);
    return buf;
  };

  // Pass 1: one Sonnet call per photo.
  const guesses: (Guess | null)[] = new Array(photos.length).fill(null);
  let refused = 0;
  let next = 0;
  const worker1 = async (): Promise<void> => {
    while (next < photos.length) {
      const i = next;
      next += 1;
      const p = photos[i]!;
      const jpeg = await fetchJpeg(p);
      const text = await ask(jpeg, MODEL_1, MAX_TOKENS_1, PROMPT_1);
      if (text === null) {
        refused += 1;
        continue;
      }
      const g = parseGuess(p.id, text);
      if (g === null) process.stderr.write(`geolocator: no coordinates in the pass-1 answer for ${p.id}: ${text.slice(0, 200)}\n`);
      else guesses[i] = g;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY_1 }, () => worker1()));

  // Pass 2: Opus refines the least confident photos, lowest confidence first,
  // in photo order among ties (deterministic given the pass-1 answers).
  const refineIdx = photos
    .map((p, i) => ({ i, g: guesses[i] }))
    .filter(({ g }) => g === null || g.confidence < LOW_CONFIDENCE)
    .sort((a, b) => (a.g?.confidence ?? 0) - (b.g?.confidence ?? 0) || a.i - b.i)
    .slice(0, MAX_REFINEMENTS)
    .map(({ i }) => i);
  let next2 = 0;
  const worker2 = async (): Promise<void> => {
    while (next2 < refineIdx.length) {
      const i = refineIdx[next2]!;
      next2 += 1;
      const p = photos[i]!;
      const prev = guesses[i];
      const prompt = PROMPT_2.replace('{lat}', String(prev?.lat ?? FALLBACK.lat))
        .replace('{lon}', String(prev?.lon ?? FALLBACK.lon))
        .replace('{country}', prev?.country ?? 'unknown')
        .replace('{region}', prev?.region ?? 'unknown')
        .replace('{reasoning}', prev === null ? 'no first-pass answer' : prev.reasoning);
      const jpeg = await fetchJpeg(p);
      const text = await ask(jpeg, MODEL_2, MAX_TOKENS_2, prompt);
      if (text === null) {
        refused += 1;
        continue;
      }
      const g = parseGuess(p.id, text);
      if (g === null) process.stderr.write(`geolocator: no coordinates in the pass-2 answer for ${p.id}: ${text.slice(0, 200)}\n`);
      else guesses[i] = g;
    }
  };
  if (refineIdx.length > 0) {
    await Promise.all(Array.from({ length: CONCURRENCY_2 }, () => worker2()));
  }

  const answers = photos.map((p, i) => {
    const g = guesses[i];
    return g !== null ? { id: p.id, lat: g.lat, lon: g.lon } : { id: p.id, lat: FALLBACK.lat, lon: FALLBACK.lon };
  });
  const res = await fetch(`${envUrl}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  });
  const body = await res.text();
  process.stdout.write(`geolocator: ${answers.length} of ${photos.length} photos answered (${guesses.filter(Boolean).length} from models, ${refused} calls refused): HTTP ${res.status} ${body}`);
  return res.ok ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (err) {
  process.stderr.write(`geolocator: ${(err as Error).stack ?? String(err)}\n`);
  process.exitCode = 1;
}
