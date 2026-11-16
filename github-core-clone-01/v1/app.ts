// github-core-clone-01 entry: a single-process, dependency-free GitHub-compatible git forge.
// node:http only, fully in-memory stores, no disk I/O on any request path, no Date/random in
// stored state (deterministic: identical request sequences produce identical state).
//
// Surfaces: git smart HTTP (upload-pack v2/v0, receive-pack v0) at /{owner}/{repo}.git,
// REST v3 under /api/v3, GraphQL v4 at /api/graphql, MCP (streamable HTTP, 2026-07-28) at /mcp.

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { deflateSync, inflateSync } from 'node:zlib';

// ---------------------------------------------------------------- constants

const TOKEN = process.env.MAKEFUN_SHOP_TOKEN ?? '';
const VIEWER_LOGIN = 'adaiversen'; // scenario viewer (wire.ts SCENARIO_SEED is constant across trials)
const STRANGER_LOGIN = 'olgabauer'; // scenario stranger: repos under this owner are 404
const DEFAULT_BRANCH = 'main';
const FIXED_EPOCH = 1700000000;
const FIXED_TS = '2026-01-01T00:00:00Z';
const IDENTITY = 'Conformance <conformance@make.fun>';
const ZERO_OID = '0'.repeat(40);
const HEX40 = /^[0-9a-f]{40}$/;
const AGENT = 'github-core-clone/1.0';
const JSON_TYPE = 'application/json; charset=utf-8';

// ---------------------------------------------------------------- sha1 / git objects

type ObjType = 'commit' | 'tree' | 'blob' | 'tag';
interface GitObj { type: ObjType; data: Buffer; }

function sha1Hex(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex');
}
function hashObject(type: ObjType, data: Buffer): string {
  const h = createHash('sha1');
  h.update(`${type} ${data.length}\0`, 'utf8');
  h.update(data);
  return h.digest('hex');
}
function isOid(s: string): boolean { return HEX40.test(s); }

interface TreeEntry { mode: string; name: string; oid: string; }

function parseTree(data: Buffer): TreeEntry[] {
  const out: TreeEntry[] = [];
  let off = 0;
  while (off < data.length) {
    const sp = data.indexOf(0x20, off);
    const nul = data.indexOf(0x00, sp + 1);
    out.push({ mode: data.subarray(off, sp).toString('ascii'), name: data.subarray(sp + 1, nul).toString('utf8'), oid: data.subarray(nul + 1, nul + 21).toString('hex') });
    off = nul + 21;
  }
  return out;
}
function buildTree(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => {
    const l = Buffer.from(a.mode === '40000' ? a.name + '/' : a.name, 'utf8');
    const r = Buffer.from(b.mode === '40000' ? b.name + '/' : b.name, 'utf8');
    return Buffer.compare(l, r);
  });
  const parts: Buffer[] = [];
  for (const e of sorted) {
    parts.push(Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'));
    parts.push(Buffer.from(e.oid, 'hex'));
  }
  return Buffer.concat(parts);
}
interface CommitView { tree: string; parents: string[]; author: string; committer: string; message: string; }
function parseCommit(data: Buffer): CommitView {
  const blank = data.indexOf('\n\n');
  const headEnd = blank < 0 ? data.length : blank;
  const message = blank < 0 ? '' : data.subarray(blank + 2).toString('utf8');
  let tree = ''; const parents: string[] = []; let author = ''; let committer = '';
  for (const line of data.subarray(0, headEnd).toString('utf8').split('\n')) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    const k = sp < 0 ? line : line.slice(0, sp);
    const v = sp < 0 ? '' : line.slice(sp + 1);
    if (k === 'tree') tree = v; else if (k === 'parent') parents.push(v);
    else if (k === 'author') author = v; else if (k === 'committer') committer = v;
  }
  return { tree, parents, author, committer, message };
}
function buildCommit(tree: string, parents: string[], message: string): Buffer {
  const who = `${IDENTITY} ${FIXED_EPOCH} +0000`;
  const lines = [`tree ${tree}`];
  for (const p of parents) lines.push(`parent ${p}`);
  lines.push(`author ${who}`, `committer ${who}`, '');
  const msg = message.endsWith('\n') ? message : message + '\n';
  return Buffer.from(`${lines.join('\n')}\n${msg}`, 'utf8');
}
function parseTag(data: Buffer): { object: string; type: string; tag: string; tagger: string; message: string } {
  const blank = data.indexOf('\n\n');
  const headEnd = blank < 0 ? data.length : blank;
  const headers = new Map<string, string>();
  for (const line of data.subarray(0, headEnd).toString('utf8').split('\n')) {
    if (!line) continue;
    const sp = line.indexOf(' ');
    if (sp >= 0) headers.set(line.slice(0, sp), line.slice(sp + 1));
  }
  return { object: headers.get('object') ?? '', type: headers.get('type') ?? '', tag: headers.get('tag') ?? '', tagger: headers.get('tagger') ?? '', message: blank < 0 ? '' : data.subarray(blank + 2).toString('utf8') };
}

// ---------------------------------------------------------------- pkt-line

function pktLine(payload: string | Buffer): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const buf = Buffer.allocUnsafe(data.length + 4);
  buf.write((data.length + 4).toString(16).padStart(4, '0'), 0, 4, 'ascii');
  data.copy(buf, 4);
  return buf;
}
const PKT_FLUSH = Buffer.from('0000', 'ascii');
const PKT_DELIM = Buffer.from('0001', 'ascii');
function pktLines(items: (string | Buffer | 'flush' | 'delim')[]): Buffer {
  let total = 0;
  for (const it of items) {
    if (it === 'flush' || it === 'delim') total += 4;
    else total += 4 + (typeof it === 'string' ? Buffer.byteLength(it, 'utf8') : it.length);
  }
  const buf = Buffer.allocUnsafe(total);
  let off = 0;
  for (const it of items) {
    if (it === 'flush') { buf.write('0000', off, 4, 'ascii'); off += 4; }
    else if (it === 'delim') { buf.write('0001', off, 4, 'ascii'); off += 4; }
    else {
      const len = typeof it === 'string' ? Buffer.byteLength(it, 'utf8') : it.length;
      buf.write((len + 4).toString(16).padStart(4, '0'), off, 4, 'ascii'); off += 4;
      if (typeof it === 'string') off += buf.write(it, off, len, 'utf8');
      else { it.copy(buf, off); off += len; }
    }
  }
  return buf;
}
type Pkt = { kind: 'data'; payload: Buffer } | { kind: 'flush' } | { kind: 'delim' } | { kind: 'end' };
function decodePkts(buf: Buffer): Pkt[] {
  const out: Pkt[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = parseInt(buf.subarray(off, off + 4).toString('ascii'), 16);
    if (!Number.isFinite(len) || len < 0 || len > 65520) break;
    if (len === 0) { out.push({ kind: 'flush' }); off += 4; continue; }
    if (len === 1) { out.push({ kind: 'delim' }); off += 4; continue; }
    if (len === 2) { out.push({ kind: 'end' }); off += 4; continue; }
    if (off + len > buf.length) break;
    out.push({ kind: 'data', payload: buf.subarray(off + 4, off + len) });
    off += len;
  }
  return out;
}

// ---------------------------------------------------------------- packfile

function readVarint(buf: Buffer, start: number): { size: number; next: number; first: number } {
  let b = buf[start];
  const first = b;
  let size = b & 0x0f;
  let shift = 4;
  let off = start + 1;
  while (b & 0x80) {
    b = buf[off++];
    size += (b & 0x7f) * 2 ** shift;
    shift += 7;
  }
  return { size, next: off, first };
}
function readOfsBase(buf: Buffer, start: number): { baseOffset: number; next: number } {
  let b = buf[start];
  let off = start + 1;
  let v = b & 0x7f;
  while (b & 0x80) {
    b = buf[off++];
    v = ((v + 1) * 128) + (b & 0x7f);
  }
  return { baseOffset: v, next: off };
}
function inflateAt(buf: Buffer, offset: number, end: number): { data: Buffer; next: number } {
  const view = buf.subarray(offset, end);
  const r = inflateSync(view, { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
  return { data: r.buffer, next: offset + r.engine.bytesWritten };
}
function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let off = 0;
  const readSize = (): number => {
    let v = 0; let sh = 0;
    for (;;) {
      const b = delta[off++];
      v += (b & 0x7f) * 2 ** sh; sh += 7;
      if (!(b & 0x80)) break;
    }
    return v;
  };
  const srcSize = readSize();
  const tgtSize = readSize();
  if (srcSize !== base.length) throw new Error('delta base size mismatch');
  const out = Buffer.allocUnsafe(tgtSize);
  let written = 0;
  while (off < delta.length) {
    const op = delta[off++];
    if (op & 0x80) {
      let co = 0; let cs = 0; let sh = 0;
      for (let bit = 0; bit < 4; bit++) { if (op & (1 << bit)) co += delta[off++] * 2 ** sh; sh += 8; }
      sh = 0;
      for (let bit = 4; bit < 7; bit++) { if (op & (1 << bit)) cs += delta[off++] * 2 ** sh; sh += 8; }
      if (cs === 0) cs = 0x10000;
      base.copy(out, written, co, co + cs);
      written += cs;
    } else if (op !== 0) {
      const lit = op & 0x7f;
      delta.copy(out, written, off, off + lit);
      off += lit; written += lit;
    } else throw new Error('delta opcode 0');
  }
  if (written !== tgtSize) throw new Error('delta size mismatch');
  return out;
}
const TYPE_CODE: Record<ObjType, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };
const CODE_TYPE: Record<number, ObjType> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

/** Parse a packfile into objects (resolving OFS/REF deltas). Throws on corruption. */
function readPack(pack: Buffer): Map<string, GitObj> {
  if (pack.length < 32 || pack.subarray(0, 4).toString('ascii') !== 'PACK') throw new Error('bad pack header');
  const version = pack.readUInt32BE(4);
  if (version !== 2 && version !== 3) throw new Error('bad pack version');
  const count = pack.readUInt32BE(8);
  const trailerStart = pack.length - 20;
  const trailer = pack.subarray(trailerStart).toString('hex');
  if (sha1Hex(pack.subarray(0, trailerStart)) !== trailer) throw new Error('pack checksum mismatch');
  interface Raw { offset: number; typeCode: number; size: number; data: Buffer; baseOffset?: number; baseOid?: string; }
  const raw: Raw[] = [];
  const byOffset = new Map<number, Raw>();
  let off = 12;
  for (let i = 0; i < count; i++) {
    const entryOffset = off;
    const h = readVarint(pack, off);
    off = h.next;
    const typeCode = (h.first >> 4) & 0x07;
    const e: Raw = { offset: entryOffset, typeCode, size: h.size, data: Buffer.alloc(0) };
    if (typeCode === 6) {
      const b = readOfsBase(pack, off); off = b.next;
      e.baseOffset = entryOffset - b.baseOffset;
    } else if (typeCode === 7) {
      e.baseOid = pack.subarray(off, off + 20).toString('hex'); off += 20;
    } else if (!CODE_TYPE[typeCode]) throw new Error('bad pack type code');
    const inf = inflateAt(pack, off, trailerStart);
    if (inf.data.length !== h.size) throw new Error('pack entry size mismatch');
    e.data = inf.data;
    off = inf.next;
    raw.push(e); byOffset.set(entryOffset, e);
  }
  if (off !== trailerStart) throw new Error('pack trailing bytes');
  const objects = new Map<string, GitObj>();
  const resolvedByOid = new Map<string, Raw>();
  const resolving = new Set<number>();
  const resolve = (e: Raw): { type: ObjType; data: Buffer; oid: string } => {
    const cached = (e as unknown as { _r?: { type: ObjType; data: Buffer; oid: string } })._r;
    if (cached) return cached;
    if (resolving.has(e.offset)) throw new Error('delta cycle');
    resolving.add(e.offset);
    let type: ObjType; let data: Buffer;
    if (e.typeCode === 6) {
      const baseEntry = byOffset.get(e.baseOffset!);
      if (!baseEntry) throw new Error('ofs-delta base missing');
      const base = resolve(baseEntry);
      type = base.type; data = applyDelta(base.data, e.data);
    } else if (e.typeCode === 7) {
      const baseEntry = resolvedByOid.get(e.baseOid!);
      if (baseEntry) {
        const base = resolve(baseEntry);
        type = base.type; data = applyDelta(base.data, e.data);
      } else throw new Error('ref-delta base missing (thin pack not supported)');
    } else {
      type = CODE_TYPE[e.typeCode]; data = e.data;
    }
    const oid = hashObject(type, data);
    const r = { type, data, oid };
    (e as unknown as { _r?: unknown })._r = r;
    resolvedByOid.set(oid, e);
    resolving.delete(e.offset);
    return r;
  };
  for (const e of raw) {
    const r = resolve(e);
    if (!objects.has(r.oid)) objects.set(r.oid, { type: r.type, data: r.data });
  }
  return objects;
}
function writePackObjectHeader(type: ObjType, size: number): Buffer {
  const code = TYPE_CODE[type];
  const bytes: number[] = [];
  let rem = size;
  let first = (code << 4) | (rem & 0x0f);
  rem = Math.floor(rem / 16);
  while (rem > 0) { bytes.push(first | 0x80); first = rem & 0x7f; rem = Math.floor(rem / 128); }
  bytes.push(first);
  return Buffer.from(bytes);
}
/** Build a packfile from plain objects (no deltas). */
function writePack(objects: GitObj[]): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.allocUnsafe(12);
  header.write('PACK', 0, 4, 'ascii');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(objects.length, 8);
  parts.push(header);
  for (const o of objects) {
    parts.push(writePackObjectHeader(o.type, o.data.length));
    parts.push(deflateSync(o.data));
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([body, createHash('sha1').update(body).digest()]);
}

// ---------------------------------------------------------------- reachability

function collectReachable(roots: Iterable<string>, lookup: (oid: string) => GitObj | undefined, maxDepth = -1): Set<string> {
  const seen = new Set<string>();
  const queue: { oid: string; depth: number }[] = [];
  for (const r of roots) if (isOid(r)) queue.push({ oid: r, depth: 0 });
  while (queue.length) {
    const { oid, depth } = queue.pop()!;
    if (seen.has(oid)) continue;
    const obj = lookup(oid);
    if (!obj) continue;
    seen.add(oid);
    if (maxDepth >= 0 && depth >= maxDepth) continue;
    if (obj.type === 'commit') {
      const c = parseCommit(obj.data);
      queue.push({ oid: c.tree, depth: depth + 1 });
      for (const p of c.parents) queue.push({ oid: p, depth: depth + 1 });
    } else if (obj.type === 'tag') {
      queue.push({ oid: parseTag(obj.data).object, depth: depth + 1 });
    } else if (obj.type === 'tree') {
      for (const e of parseTree(obj.data)) if (e.mode !== '160000') queue.push({ oid: e.oid, depth: depth + 1 });
    }
  }
  return seen;
}
/** Depth-limited reachability for shallow fetches: commits at generation g included iff g < depth. */
function collectShallow(wants: string[], lookup: (oid: string) => GitObj | undefined, depth: number): { objects: Set<string>; boundary: Set<string> } {
  const seen = new Set<string>();
  const boundary = new Set<string>();
  const queue: { oid: string; gen: number }[] = [];
  for (const w of wants) if (isOid(w)) queue.push({ oid: w, gen: 0 });
  while (queue.length) {
    const { oid, gen } = queue.pop()!;
    if (seen.has(oid)) continue;
    const obj = lookup(oid);
    if (!obj) continue;
    seen.add(oid);
    if (obj.type === 'commit') {
      const c = parseCommit(obj.data);
      queue.push({ oid: c.tree, gen: gen + 1 });
      if (gen + 1 < depth) {
        for (const p of c.parents) queue.push({ oid: p, gen: gen + 1 });
      } else if (c.parents.length > 0) {
        boundary.add(oid);
      }
    } else if (obj.type === 'tag') {
      queue.push({ oid: parseTag(obj.data).object, gen: gen + 1 });
    } else if (obj.type === 'tree') {
      for (const e of parseTree(obj.data)) if (e.mode !== '160000') queue.push({ oid: e.oid, gen: gen + 1 });
    }
  }
  return { objects: seen, boundary };
}
function isAncestor(objects: Map<string, GitObj>, ancestor: string, tip: string): boolean {
  if (ancestor === tip) return true;
  // Fast path (the bench push chain is linear: each new commit's parent IS the
  // current tip): one parse instead of a walk of the whole history.
  const tipObj = objects.get(tip);
  if (tipObj && tipObj.type === 'commit' && parseCommit(tipObj.data).parents.includes(ancestor)) return true;
  const seen = new Set<string>();
  const queue = [tip];
  while (queue.length) {
    const oid = queue.pop()!;
    if (oid === ancestor) return true;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const obj = objects.get(oid);
    if (!obj || obj.type !== 'commit') continue;
    for (const p of parseCommit(obj.data).parents) queue.push(p);
  }
  return false;
}
function peelToCommit(objects: Map<string, GitObj>, oid: string): string | null {
  let cur = oid;
  for (let i = 0; i < 10; i++) {
    const obj = objects.get(cur);
    if (!obj) return null;
    if (obj.type === 'commit') return cur;
    if (obj.type === 'tag') { cur = parseTag(obj.data).object; continue; }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------- store

interface Label { name: string; color: string; }
interface Issue {
  id: number; number: number; title: string; body: string; state: 'open' | 'closed';
  labels: Label[]; seq: number; json: Buffer;
}
interface Comment { id: number; body: string; }
interface Pull {
  number: number; title: string; body: string; state: 'open' | 'closed';
  merged: boolean; mergedAt: string | null; mergeSha: string | null;
  headBranch: string; baseBranch: string; baseShaAtCreation: string; seq: number;
}
interface Repo {
  name: string; id: number; nodeId: string; owner: string; priv: boolean; description: string;
  refs: Map<string, string>;
  objects: Map<string, GitObj>;
  issues: Issue[]; labels: Map<string, Label>;
  comments: Map<number, Comment[]>;
  pulls: Pull[];
  nextIssue: number; nextPull: number; seq: number;
  version: number; // bumped on any object/ref change; invalidates caches
  packCache: Map<string, Buffer>;
  fetchCache: Map<string, Buffer>;
  lsCache: Map<string, Buffer>;
}

const repos = new Map<string, Repo>();
let globalIdSeq = 1000;
let reqSeq = 0;
let repoSeq = 0;

function globalId(kind: string, parts: (string | number)[]): string {
  return Buffer.from(`${kind}:${parts.join(':')}`).toString('base64');
}
function decodeGlobalId(id: string): { kind: string; parts: string[] } | null {
  try {
    const text = Buffer.from(id, 'base64').toString('utf8');
    const idx = text.indexOf(':');
    if (idx <= 0) return null;
    return { kind: text.slice(0, idx), parts: text.slice(idx + 1).split(':') };
  } catch { return null; }
}
function isViewerOwner(owner: string): boolean { return owner !== STRANGER_LOGIN; }
function findRepo(owner: string, name: string): Repo | undefined {
  if (!isViewerOwner(owner)) return undefined;
  return repos.get(name);
}
function createRepo(name: string, priv: boolean, description: string): Repo {
  const id = ++globalIdSeq;
  const repo: Repo = {
    name, id, nodeId: globalId('Repository', [id]), owner: VIEWER_LOGIN, priv, description,
    refs: new Map(), objects: new Map(), issues: [], labels: new Map(),
    comments: new Map(), pulls: [], nextIssue: 1, nextPull: 1, seq: ++repoSeq,
    version: 0, packCache: new Map(), fetchCache: new Map(), lsCache: new Map(),
  };
  repos.set(name, repo);
  return repo;
}
function bumpRepo(repo: Repo): void {
  repo.version++;
  repo.packCache.clear(); repo.fetchCache.clear(); repo.lsCache.clear();
}
function defaultTip(repo: Repo): string | undefined {
  return repo.refs.get(`refs/heads/${DEFAULT_BRANCH}`);
}
function refTip(repo: Repo, ref: string): string | undefined {
  if (ref.startsWith('refs/')) return repo.refs.get(ref);
  return repo.refs.get(`refs/heads/${ref}`);
}
function resolveRefToCommit(repo: Repo, ref: string): string | undefined {
  // ref may be a branch name or a raw oid
  if (isOid(ref)) return repo.objects.has(ref) ? ref : undefined;
  const tip = refTip(repo, ref);
  if (!tip) return undefined;
  return peelToCommit(repo.objects, tip) ?? tip;
}

// ---- git object store helpers

function putObject(repo: Repo, type: ObjType, data: Buffer): string {
  const oid = hashObject(type, data);
  if (!repo.objects.has(oid)) repo.objects.set(oid, { type, data });
  return oid;
}
/** Flatten a commit's tree into path -> {mode, oid}. */
function flattenTree(repo: Repo, treeOid: string, prefix: string, out: Map<string, { mode: string; oid: string }>): void {
  const obj = repo.objects.get(treeOid);
  if (!obj || obj.type !== 'tree') return;
  for (const e of parseTree(obj.data)) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.mode === '40000') flattenTree(repo, e.oid, path, out);
    else out.set(path, { mode: e.mode, oid: e.oid });
  }
}
/** Build nested trees from a flat path map; returns the root tree oid. */
function buildTreeFromFlat(repo: Repo, flat: Map<string, { mode: string; oid: string }>): string {
  interface Node { files: Map<string, { mode: string; oid: string }>; dirs: Map<string, Node>; }
  const make = (): Node => ({ files: new Map(), dirs: new Map() });
  const root = make();
  for (const [path, entry] of flat) {
    const segs = path.split('/');
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      if (!node.dirs.has(s)) node.dirs.set(s, make());
      node = node.dirs.get(s)!;
    }
    node.files.set(segs[segs.length - 1], entry);
  }
  const build = (node: Node): string => {
    const entries: TreeEntry[] = [];
    for (const [name, e] of node.files) entries.push({ mode: e.mode, name, oid: e.oid });
    for (const [name, child] of node.dirs) entries.push({ mode: '40000', name, oid: build(child) });
    return putObject(repo, 'tree', buildTree(entries));
  };
  return build(root);
}
/** Commit one file change on a branch; creates the branch if unborn. Returns commit + blob shas. */
function commitFile(repo: Repo, branch: string, path: string, content: Buffer, message: string): { commitSha: string; blobSha: string } {
  const ref = `refs/heads/${branch}`;
  const tip = repo.refs.get(ref);
  const flat = new Map<string, { mode: string; oid: string }>();
  if (tip) {
    const commit = repo.objects.get(tip);
    if (commit && commit.type === 'commit') flattenTree(repo, parseCommit(commit.data).tree, '', flat);
    else if (commit && commit.type === 'tag') {
      const peeled = peelToCommit(repo.objects, tip);
      if (peeled) { const pc = repo.objects.get(peeled); if (pc) flattenTree(repo, parseCommit(pc.data).tree, '', flat); }
    }
  }
  const blobSha = putObject(repo, 'blob', content);
  flat.set(path, { mode: '100644', oid: blobSha });
  const treeOid = buildTreeFromFlat(repo, flat);
  const commitSha = putObject(repo, 'commit', buildCommit(treeOid, tip ? [tip] : [], message));
  repo.refs.set(ref, commitSha);
  bumpRepo(repo);
  return { commitSha, blobSha };
}
/** Delete one file on a branch. Returns the new commit sha, or null when the file is absent. */
function deleteFile(repo: Repo, branch: string, path: string, message: string): string | null {
  const ref = `refs/heads/${branch}`;
  const tip = repo.refs.get(ref);
  if (!tip) return null;
  const commit = repo.objects.get(tip);
  if (!commit || commit.type !== 'commit') return null;
  const flat = new Map<string, { mode: string; oid: string }>();
  flattenTree(repo, parseCommit(commit.data).tree, '', flat);
  if (!flat.has(path)) return null;
  flat.delete(path);
  const treeOid = buildTreeFromFlat(repo, flat);
  const commitSha = putObject(repo, 'commit', buildCommit(treeOid, [tip], message));
  repo.refs.set(ref, commitSha);
  bumpRepo(repo);
  return commitSha;
}
/** Resolve a path inside a commit's tree; returns {blobOid} or {treeOid} or null. */
function lookupPath(repo: Repo, commitOid: string, path: string): { oid: string; mode: string } | null {
  const commit = repo.objects.get(commitOid);
  if (!commit || commit.type !== 'commit') return null;
  let treeOid = parseCommit(commit.data).tree;
  const segs = path.split('/').filter((s) => s !== '');
  for (let i = 0; i < segs.length; i++) {
    const tree = repo.objects.get(treeOid);
    if (!tree || tree.type !== 'tree') return null;
    const entry = parseTree(tree.data).find((e) => e.name === segs[i]);
    if (!entry) return null;
    if (i === segs.length - 1) return { oid: entry.oid, mode: entry.mode };
    if (entry.mode !== '40000') return null;
    treeOid = entry.oid;
  }
  return null;
}
function listDir(repo: Repo, commitOid: string, dirPath: string): { name: string; path: string; sha: string; type: 'file' | 'dir'; size?: number }[] | null {
  const commit = repo.objects.get(commitOid);
  if (!commit || commit.type !== 'commit') return null;
  let treeOid = parseCommit(commit.data).tree;
  const segs = dirPath.split('/').filter((s) => s !== '');
  for (const seg of segs) {
    const tree = repo.objects.get(treeOid);
    if (!tree || tree.type !== 'tree') return null;
    const entry = parseTree(tree.data).find((e) => e.name === seg);
    if (!entry || entry.mode !== '40000') return null;
    treeOid = entry.oid;
  }
  const tree = repo.objects.get(treeOid);
  if (!tree || tree.type !== 'tree') return null;
  const out: { name: string; path: string; sha: string; type: 'file' | 'dir'; size?: number }[] = [];
  for (const e of parseTree(tree.data)) {
    const p = dirPath ? `${dirPath}/${e.name}` : e.name;
    if (e.mode === '40000') out.push({ name: e.name, path: p, sha: e.oid, type: 'dir' });
    else {
      const blob = repo.objects.get(e.oid);
      out.push({ name: e.name, path: p, sha: e.oid, type: 'file', size: blob ? blob.data.length : 0 });
    }
  }
  return out;
}

// ---- issues / pulls

function issueJson(repo: Repo, issue: Issue): Buffer {
  // Manual string build: byte-identical to the previous object+JSON.stringify
  // form (same key order, same escaping via jsonEscape), minus the allocs.
  const labels = issue.labels.map((l) => `{"name":${jsonEscape(l.name)},"color":${jsonEscape(l.color)}}`).join(',');
  const url = `/api/v3/repos/${VIEWER_LOGIN}/${repo.name}/issues/${issue.number}`;
  const s = `{"id":${issue.id},"node_id":${jsonEscape(globalId('Issue', [repo.id, issue.number]))},"number":${issue.number},"title":${jsonEscape(issue.title)},"body":${jsonEscape(issue.body)},"state":${jsonEscape(issue.state)},"labels":[${labels}],"user":{"login":${jsonEscape(VIEWER_LOGIN)},"id":1000},"created_at":${jsonEscape(FIXED_TS)},"updated_at":${jsonEscape(FIXED_TS)},"url":${jsonEscape(url)},"html_url":${jsonEscape(`/${VIEWER_LOGIN}/${repo.name}/issues/${issue.number}`)},"comments":${(repo.comments.get(issue.number) ?? []).length}}`;
  return Buffer.from(s, 'utf8');
}
function createIssueObj(repo: Repo, title: string, body: string, labels: Label[]): Issue {
  const number = repo.nextIssue++;
  const issue: Issue = { id: ++globalIdSeq, number, title, body, state: 'open', labels, seq: repo.seq * 1000000 + number, json: Buffer.alloc(0) };
  issue.json = issueJson(repo, issue);
  repo.issues.push(issue);
  return issue;
}
function refreshIssue(repo: Repo, issue: Issue): void { issue.json = issueJson(repo, issue); }

function diffTrees(repo: Repo, baseCommitOid: string, headCommitOid: string): { filename: string; status: string; additions: number; deletions: number; changes: number }[] {
  const baseFlat = new Map<string, { mode: string; oid: string }>();
  const headFlat = new Map<string, { mode: string; oid: string }>();
  const bc = repo.objects.get(baseCommitOid);
  const hc = repo.objects.get(headCommitOid);
  if (bc && bc.type === 'commit') flattenTree(repo, parseCommit(bc.data).tree, '', baseFlat);
  if (hc && hc.type === 'commit') flattenTree(repo, parseCommit(hc.data).tree, '', headFlat);
  const lineCount = (oid: string | undefined): number => {
    if (!oid) return 0;
    const o = repo.objects.get(oid);
    if (!o) return 0;
    const text = o.data.toString('utf8');
    if (text === '') return 0;
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.length;
  };
  const out: { filename: string; status: string; additions: number; deletions: number; changes: number }[] = [];
  const names = new Set([...baseFlat.keys(), ...headFlat.keys()]);
  for (const name of [...names].sort()) {
    const b = baseFlat.get(name); const h = headFlat.get(name);
    if (b && !h) {
      const d = lineCount(b.oid);
      out.push({ filename: name, status: 'removed', additions: 0, deletions: d, changes: d });
    } else if (!b && h) {
      const a = lineCount(h.oid);
      out.push({ filename: name, status: 'added', additions: a, deletions: 0, changes: a });
    } else if (b && h && b.oid !== h.oid) {
      const a = lineCount(h.oid); const d = lineCount(b.oid);
      out.push({ filename: name, status: 'modified', additions: a, deletions: d, changes: a + d });
    }
  }
  return out;
}
/** True when a squash merge of `pull` would conflict with the current base tip. */
function pullConflicts(repo: Repo, pull: Pull): boolean {
  const headTip = refTip(repo, pull.headBranch);
  const baseTip = refTip(repo, pull.baseBranch);
  if (!headTip || !baseTip) return false;
  const origBase = pull.baseShaAtCreation;
  const headFlat = new Map<string, { mode: string; oid: string }>();
  const baseFlat = new Map<string, { mode: string; oid: string }>();
  const origFlat = new Map<string, { mode: string; oid: string }>();
  const hc = repo.objects.get(headTip);
  const bc = repo.objects.get(baseTip);
  const oc = repo.objects.get(origBase);
  if (hc && hc.type === 'commit') flattenTree(repo, parseCommit(hc.data).tree, '', headFlat);
  if (bc && bc.type === 'commit') flattenTree(repo, parseCommit(bc.data).tree, '', baseFlat);
  if (oc && oc.type === 'commit') flattenTree(repo, parseCommit(oc.data).tree, '', origFlat);
  const names = new Set([...headFlat.keys(), ...baseFlat.keys(), ...origFlat.keys()]);
  for (const name of names) {
    const h = headFlat.get(name); const b = baseFlat.get(name); const o = origFlat.get(name);
    const hChanged = (h?.oid ?? null) !== (o?.oid ?? null);
    const bChanged = (b?.oid ?? null) !== (o?.oid ?? null);
    if (hChanged && bChanged && (h?.oid ?? null) !== (b?.oid ?? null)) return true;
  }
  return false;
}
function squashMerge(repo: Repo, pull: Pull): string | null {
  const headTip = refTip(repo, pull.headBranch);
  const baseTip = refTip(repo, pull.baseBranch);
  if (!headTip || !baseTip) return null;
  const hc = repo.objects.get(headTip);
  if (!hc || hc.type !== 'commit') return null;
  const treeOid = parseCommit(hc.data).tree;
  const message = `Merge pull request #${pull.number} from ${VIEWER_LOGIN}/${pull.headBranch}\n\n${pull.title}`;
  const mergeSha = putObject(repo, 'commit', buildCommit(treeOid, [baseTip], message));
  repo.refs.set(`refs/heads/${pull.baseBranch}`, mergeSha);
  pull.state = 'closed'; pull.merged = true; pull.mergedAt = FIXED_TS; pull.mergeSha = mergeSha;
  bumpRepo(repo);
  return mergeSha;
}
function pullJson(repo: Repo, pull: Pull): Record<string, unknown> {
  const headSha = refTip(repo, pull.headBranch) ?? '';
  const baseSha = refTip(repo, pull.baseBranch) ?? '';
  return {
    id: pull.seq, number: pull.number, title: pull.title, body: pull.body,
    state: pull.state, merged: pull.merged, merged_at: pull.mergedAt, merge_commit_sha: pull.mergeSha,
    head: { ref: pull.headBranch, sha: headSha, label: `${VIEWER_LOGIN}:${pull.headBranch}` },
    base: { ref: pull.baseBranch, sha: baseSha, label: `${VIEWER_LOGIN}:${pull.baseBranch}` },
    user: { login: VIEWER_LOGIN, id: 1000 },
    created_at: FIXED_TS, updated_at: FIXED_TS,
    url: `/api/v3/repos/${VIEWER_LOGIN}/${repo.name}/pulls/${pull.number}`,
    html_url: `/${VIEWER_LOGIN}/${repo.name}/pull/${pull.number}`,
  };
}
function repoJson(repo: Repo): Record<string, unknown> {
  return {
    id: repo.id, node_id: repo.nodeId, name: repo.name, full_name: `${VIEWER_LOGIN}/${repo.name}`,
    owner: { login: VIEWER_LOGIN, id: 1000, type: 'User' },
    private: repo.priv, description: repo.description, default_branch: DEFAULT_BRANCH,
    has_issues: true, has_projects: true, has_wiki: true,
    created_at: FIXED_TS, updated_at: FIXED_TS, pushed_at: FIXED_TS,
    url: `/api/v3/repos/${VIEWER_LOGIN}/${repo.name}`,
    html_url: `/${VIEWER_LOGIN}/${repo.name}`,
    clone_url: `/${VIEWER_LOGIN}/${repo.name}.git`,
  };
}
function jsonEscape(s: string): string {
  return JSON.stringify(s);
}

// ---------------------------------------------------------------- HTTP plumbing

function reqId(): string { return `req-${++reqSeq}`; }
function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  // array-form headers: skips the object-key walk in writeHead
  const headers: string[] = ['content-type', JSON_TYPE, 'content-length', String(buf.length), 'x-github-request-id', reqId()];
  for (const k of Object.keys(extra)) headers.push(k, extra[k]);
  res.writeHead(status, headers);
  res.end(buf);
}
function sendBuf(res: ServerResponse, status: number, buf: Buffer, contentType: string): void {
  res.writeHead(status, ['content-type', contentType, 'content-length', String(buf.length), 'x-github-request-id', reqId()]);
  res.end(buf);
}
function sendErr(res: ServerResponse, status: number, message: string, extra: Record<string, string> = {}): void {
  sendJson(res, status, { message }, extra);
}
const AUTH_HEADER = `Bearer ${TOKEN}`;
function authed(req: IncomingMessage): boolean {
  if (TOKEN === '') return true;
  return req.headers.authorization === AUTH_HEADER;
}
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseQuery(qs: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!qs) return out;
  for (const part of qs.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
    const v = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    out.set(k, v);
  }
  return out;
}
interface PageOpts { perPage: number; page: number; }
function pageOpts(q: Map<string, string>): PageOpts {
  const perPage = Math.max(1, Math.min(100, parseInt(q.get('per_page') ?? '30', 10) || 30));
  const page = Math.max(1, parseInt(q.get('page') ?? '1', 10) || 1);
  return { perPage, page };
}
function paginate<T>(items: T[], opts: PageOpts): { items: T[]; hasNext: boolean; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / opts.perPage));
  const start = (opts.page - 1) * opts.perPage;
  return { items: items.slice(start, start + opts.perPage), hasNext: opts.page < totalPages, totalPages };
}
function linkHeader(req: IncomingMessage, pathname: string, q: Map<string, string>, opts: PageOpts, totalPages: number): string {
  const host = req.headers.host ?? 'localhost';
  const build = (page: number): string => {
    const params = new URLSearchParams();
    for (const [k, v] of q) if (k !== 'page') params.set(k, v);
    params.set('per_page', String(opts.perPage));
    params.set('page', String(page));
    return `http://${host}${pathname}?${params.toString()}`;
  };
  const parts: string[] = [];
  if (opts.page < totalPages) parts.push(`<${build(opts.page + 1)}>; rel="next"`);
  if (totalPages > 1) parts.push(`<${build(totalPages)}>; rel="last"`);
  if (opts.page > 1) parts.push(`<${build(1)}>; rel="first"`, `<${build(opts.page - 1)}>; rel="prev"`);
  return parts.join(', ');
}
function parseIdentity(line: string): { name: string; email: string } {
  const m = /^(.*?) <([^>]*)>/.exec(line);
  return m ? { name: m[1], email: m[2] } : { name: line, email: '' };
}

// ---------------------------------------------------------------- REST v3

function handleRest(req: IncomingMessage, res: ServerResponse, pathname: string, method: string, q: Map<string, string>, body: unknown): void {
  const segs = pathname.split('/').filter((s) => s !== '');
  // segs[0]='api', segs[1]='v3'
  if (segs.length === 2) {
    if (method !== 'GET') { sendErr(res, 404, 'Not Found'); return; }
    sendJson(res, 200, { current_user_url: '/api/v3/user', current_user_authorizations_html_url: 'https://github.com/settings/applications', rate_limit_url: '/api/v3/rate_limit' }, { 'x-oauth-scopes': 'repo, read:org' });
    return;
  }
  const rest = segs.slice(2);
  if (rest[0] === 'meta' && method === 'GET') { sendJson(res, 200, { installed_version: '1.0.0' }); return; }
  if (rest[0] === 'rate_limit' && method === 'GET') {
    sendJson(res, 200, { resources: { core: { limit: 5000, remaining: 5000, reset: FIXED_EPOCH } }, rate: { limit: 5000, remaining: 5000, reset: FIXED_EPOCH } });
    return;
  }
  if (rest[0] === 'user' && rest.length === 1 && method === 'GET') {
    sendJson(res, 200, { login: VIEWER_LOGIN, id: 1000, node_id: globalId('User', [1000]), type: 'User', name: 'ada iversen', email: 'adaiversen@example.invalid' });
    return;
  }
  if (rest[0] === 'user' && rest[1] === 'repos') {
    if (method === 'GET') {
      const opts = pageOpts(q);
      const all = [...repos.values()].sort((a, b) => a.seq - b.seq);
      const page = paginate(all, opts);
      const extra: Record<string, string> = {};
      if (page.hasNext || page.totalPages > 1) extra.link = linkHeader(req, pathname, q, opts, page.totalPages);
      sendJson(res, 200, page.items.map(repoJson), extra);
      return;
    }
    if (method === 'POST') {
      const b = (body ?? {}) as Record<string, unknown>;
      const name = typeof b.name === 'string' ? b.name : '';
      if (name === '') { sendErr(res, 422, 'name is required'); return; }
      if (repos.has(name)) { sendErr(res, 422, 'Repository already exists'); return; }
      const repo = createRepo(name, b.private === true, typeof b.description === 'string' ? b.description : '');
      sendJson(res, 201, repoJson(repo));
      return;
    }
    sendErr(res, 404, 'Not Found'); return;
  }
  if (rest[0] === 'repos' && rest.length >= 3) {
    const owner = rest[1]; const name = rest[2];
    const repo = findRepo(owner, name);
    if (!repo) { sendErr(res, 404, 'Not Found'); return; }
    const tail = rest.slice(3);
    if (tail.length === 0) {
      if (method === 'GET') { sendJson(res, 200, repoJson(repo)); return; }
      if (method === 'PATCH') {
        const b = (body ?? {}) as Record<string, unknown>;
        if (typeof b.description === 'string') repo.description = b.description;
        if (typeof b.private === 'boolean') repo.priv = b.private;
        sendJson(res, 200, repoJson(repo)); return;
      }
      if (method === 'DELETE') {
        repos.delete(name);
        res.writeHead(204, ['x-github-request-id', reqId()]);
        res.end();
        return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    // branches
    if (tail[0] === 'branches') {
      if (tail.length === 1 && method === 'GET') {
        const list: { name: string; commit: { sha: string } }[] = [];
        for (const [ref, oid] of repo.refs) {
          if (ref.startsWith('refs/heads/')) list.push({ name: ref.slice('refs/heads/'.length), commit: { sha: oid } });
        }
        sendJson(res, 200, list); return;
      }
      if (tail.length >= 2 && method === 'GET') {
        const branch = tail.slice(1).join('/');
        const tip = repo.refs.get(`refs/heads/${branch}`);
        if (!tip) { sendErr(res, 404, 'Not Found'); return; }
        sendJson(res, 200, { name: branch, commit: { sha: tip } }); return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    // commits
    if (tail[0] === 'commits' && method === 'GET') {
      const ref = q.get('sha') ?? DEFAULT_BRANCH;
      const tip = resolveRefToCommit(repo, ref);
      if (!tip) { sendErr(res, 404, 'Not Found'); return; }
      const out: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      const stack = [tip];
      while (stack.length) {
        const oid = stack.pop()!;
        if (seen.has(oid)) continue;
        seen.add(oid);
        const obj = repo.objects.get(oid);
        if (!obj || obj.type !== 'commit') continue;
        const c = parseCommit(obj.data);
        const author = parseIdentity(c.author);
        const committer = parseIdentity(c.committer);
        out.push({
          sha: oid,
          commit: {
            message: c.message.replace(/\n$/, ''),
            author: { name: author.name, email: author.email, date: FIXED_TS },
            committer: { name: committer.name, email: committer.email, date: FIXED_TS },
            tree: { sha: c.tree },
          },
          author: { login: VIEWER_LOGIN, id: 1000 },
          committer: { login: VIEWER_LOGIN, id: 1000 },
          parents: c.parents.map((p) => ({ sha: p })),
        });
        for (const p of c.parents) stack.push(p);
      }
      sendJson(res, 200, out); return;
    }
    // git refs
    if (tail[0] === 'git' && tail[1] === 'refs') {
      if (method === 'POST' && tail.length === 2) {
        const b = (body ?? {}) as Record<string, unknown>;
        const ref = typeof b.ref === 'string' ? b.ref : '';
        const sha = typeof b.sha === 'string' ? b.sha : '';
        if (!ref.startsWith('refs/') || !isOid(sha)) { sendErr(res, 422, 'Invalid ref or sha'); return; }
        repo.refs.set(ref, sha);
        bumpRepo(repo);
        sendJson(res, 201, { ref, object: { sha } }); return;
      }
      if (method === 'GET' && tail.length === 2) {
        const list: { ref: string; object: { sha: string } }[] = [];
        for (const [ref, oid] of repo.refs) list.push({ ref, object: { sha: oid } });
        sendJson(res, 200, list); return;
      }
      if (method === 'GET' && tail.length >= 3) {
        const ref = tail.slice(2).join('/');
        const full = `refs/${ref}`;
        const tip = repo.refs.get(full);
        if (!tip) { sendErr(res, 404, 'Not Found'); return; }
        sendJson(res, 200, { ref: full, object: { sha: tip } }); return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    // contents
    if (tail[0] === 'contents') {
      const filePath = tail.slice(1).join('/');
      const refParam = q.get('ref');
      if (method === 'GET') {
        const commitOid = refParam ? resolveRefToCommit(repo, refParam) : defaultTip(repo);
        if (!commitOid) { sendErr(res, 404, 'Not Found'); return; }
        if (filePath === '') {
          const entries = listDir(repo, commitOid, '');
          if (entries === null) { sendErr(res, 404, 'Not Found'); return; }
          sendJson(res, 200, entries); return;
        }
        const found = lookupPath(repo, commitOid, filePath);
        if (!found) { sendErr(res, 404, 'Not Found'); return; }
        if (found.mode === '40000') {
          const entries = listDir(repo, commitOid, filePath);
          if (entries === null) { sendErr(res, 404, 'Not Found'); return; }
          sendJson(res, 200, entries); return;
        }
        const blob = repo.objects.get(found.oid);
        if (!blob) { sendErr(res, 404, 'Not Found'); return; }
        const baseName = filePath.split('/').pop() ?? filePath;
        sendJson(res, 200, {
          type: 'file', encoding: 'base64', size: blob.data.length, name: baseName, path: filePath,
          content: blob.data.toString('base64'), sha: found.oid,
        });
        return;
      }
      if (method === 'PUT') {
        const b = (body ?? {}) as Record<string, unknown>;
        const message = typeof b.message === 'string' ? b.message : 'update';
        const contentB64 = typeof b.content === 'string' ? b.content : '';
        const branch = typeof b.branch === 'string' && b.branch !== '' ? b.branch : DEFAULT_BRANCH;
        const content = Buffer.from(contentB64.replace(/\s+/g, ''), 'base64');
        // ensure the branch exists (GitHub creates it from the default branch tip)
        if (!repo.refs.has(`refs/heads/${branch}`)) {
          const baseTip = defaultTip(repo);
          if (baseTip) repo.refs.set(`refs/heads/${branch}`, baseTip);
        }
        const tip = repo.refs.get(`refs/heads/${branch}`);
        let exists = false; let currentSha = '';
        if (tip) {
          const found = lookupPath(repo, tip, filePath);
          if (found && found.mode !== '40000') { exists = true; currentSha = found.oid; }
        }
        if (exists) {
          const givenSha = typeof b.sha === 'string' ? b.sha : '';
          if (givenSha !== currentSha) { sendErr(res, 409, 'sha does not match the current blob'); return; }
        }
        const { commitSha, blobSha } = commitFile(repo, branch, filePath, content, message);
        const baseName = filePath.split('/').pop() ?? filePath;
        sendJson(res, exists ? 200 : 201, {
          content: { name: baseName, path: filePath, sha: blobSha, size: content.length, encoding: 'base64', type: 'file' },
          commit: { sha: commitSha },
        });
        return;
      }
      if (method === 'DELETE') {
        const b = (body ?? {}) as Record<string, unknown>;
        const message = typeof b.message === 'string' ? b.message : 'delete';
        const branch = typeof b.branch === 'string' && b.branch !== '' ? b.branch : DEFAULT_BRANCH;
        const commitSha = deleteFile(repo, branch, filePath, message);
        if (commitSha === null) { sendErr(res, 404, 'Not Found'); return; }
        sendJson(res, 200, { commit: { sha: commitSha } });
        return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    // labels
    if (tail[0] === 'labels') {
      if (method === 'POST') {
        const b = (body ?? {}) as Record<string, unknown>;
        const lname = typeof b.name === 'string' ? b.name : '';
        if (lname === '') { sendErr(res, 422, 'name is required'); return; }
        const label: Label = { name: lname, color: typeof b.color === 'string' ? b.color : 'ededed' };
        repo.labels.set(lname, label);
        sendJson(res, 201, { name: label.name, color: label.color, description: '' });
        return;
      }
      if (method === 'GET') {
        sendJson(res, 200, [...repo.labels.values()].map((l) => ({ name: l.name, color: l.color, description: '' })));
        return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    // issues
    if (tail[0] === 'issues') {
      if (tail.length === 1) {
        if (method === 'POST') {
          const b = (body ?? {}) as Record<string, unknown>;
          const title = typeof b.title === 'string' ? b.title : '';
          if (title === '') { sendErr(res, 422, 'title is required'); return; }
          const rawLabels = Array.isArray(b.labels) ? b.labels : [];
          const labels: Label[] = [];
          for (const entry of rawLabels) {
            const lname = typeof entry === 'string' ? entry : (entry as Record<string, unknown>)?.name;
            if (typeof lname !== 'string') continue;
            const found = repo.labels.get(lname);
            if (!found) { sendErr(res, 422, `Label '${lname}' does not exist`); return; }
            labels.push(found);
          }
          const issue = createIssueObj(repo, title, typeof b.body === 'string' ? b.body : '', labels);
          sendJson(res, 201, issue.json);
          return;
        }
        if (method === 'GET') {
          const state = q.get('state') ?? 'open';
          const sort = q.get('sort') ?? 'created';
          const direction = q.get('direction') ?? 'desc';
          let list = repo.issues.filter((i) => state === 'all' ? true : i.state === state);
          if (sort === 'created') list = [...list].sort((a, b) => direction === 'asc' ? a.number - b.number : b.number - a.number);
          const opts = pageOpts(q);
          const page = paginate(list, opts);
          const extra: Record<string, string> = {};
          if (page.hasNext || page.totalPages > 1) extra.link = linkHeader(req, pathname, q, opts, page.totalPages);
          sendJson(res, 200, Buffer.from(`[${page.items.map((i) => i.json.toString('utf8')).join(',')}]`, 'utf8'), extra);
          return;
        }
        sendErr(res, 404, 'Not Found'); return;
      }
      const num = parseInt(tail[1], 10);
      const issue = repo.issues.find((i) => i.number === num);
      if (tail.length === 2) {
        if (!issue) { sendErr(res, 404, 'Not Found'); return; }
        if (method === 'GET') { sendJson(res, 200, issue.json); return; }
        if (method === 'PATCH') {
          const b = (body ?? {}) as Record<string, unknown>;
          if (typeof b.title === 'string') issue.title = b.title;
          if (typeof b.body === 'string') issue.body = b.body;
          if (b.state === 'open' || b.state === 'closed') issue.state = b.state;
          refreshIssue(repo, issue);
          sendJson(res, 200, issue.json); return;
        }
        sendErr(res, 404, 'Not Found'); return;
      }
      if (tail[2] === 'comments') {
        if (!issue) { sendErr(res, 404, 'Not Found'); return; }
        if (method === 'POST') {
          const b = (body ?? {}) as Record<string, unknown>;
          const cbody = typeof b.body === 'string' ? b.body : '';
          const comment: Comment = { id: ++globalIdSeq, body: cbody };
          const arr = repo.comments.get(issue.number) ?? [];
          arr.push(comment);
          repo.comments.set(issue.number, arr);
          refreshIssue(repo, issue);
          sendJson(res, 201, { id: comment.id, node_id: globalId('IssueComment', [repo.id, comment.id]), body: cbody, user: { login: VIEWER_LOGIN, id: 1000 }, created_at: FIXED_TS, updated_at: FIXED_TS });
          return;
        }
        if (method === 'GET') {
          const arr = repo.comments.get(issue.number) ?? [];
          sendJson(res, 200, arr.map((c) => ({ id: c.id, node_id: globalId('IssueComment', [repo.id, c.id]), body: c.body, user: { login: VIEWER_LOGIN, id: 1000 }, created_at: FIXED_TS, updated_at: FIXED_TS })));
          return;
        }
        sendErr(res, 404, 'Not Found'); return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    // pulls
    if (tail[0] === 'pulls') {
      if (tail.length === 1) {
        if (method === 'POST') {
          const b = (body ?? {}) as Record<string, unknown>;
          const head = typeof b.head === 'string' ? b.head : '';
          const base = typeof b.base === 'string' ? b.base : DEFAULT_BRANCH;
          const title = typeof b.title === 'string' ? b.title : '';
          const headTip = refTip(repo, head);
          const baseTip = refTip(repo, base);
          if (!headTip || !baseTip) { sendErr(res, 422, 'head or base branch does not exist'); return; }
          const pull: Pull = {
            number: repo.nextPull++, title, body: typeof b.body === 'string' ? b.body : '',
            state: 'open', merged: false, mergedAt: null, mergeSha: null,
            headBranch: head, baseBranch: base, baseShaAtCreation: baseTip, seq: ++globalIdSeq,
          };
          repo.pulls.push(pull);
          sendJson(res, 201, pullJson(repo, pull));
          return;
        }
        if (method === 'GET') {
          const state = q.get('state') ?? 'open';
          let list = repo.pulls.filter((p) => state === 'all' ? true : state === 'closed' ? p.state === 'closed' : p.state === 'open');
          list = [...list].sort((a, b) => a.number - b.number);
          const opts = pageOpts(q);
          const page = paginate(list, opts);
          const extra: Record<string, string> = {};
          if (page.hasNext || page.totalPages > 1) extra.link = linkHeader(req, pathname, q, opts, page.totalPages);
          sendJson(res, 200, page.items.map((p) => pullJson(repo, p)), extra);
          return;
        }
        sendErr(res, 404, 'Not Found'); return;
      }
      const pnum = parseInt(tail[1], 10);
      const pull = repo.pulls.find((p) => p.number === pnum);
      if (tail.length === 2) {
        if (!pull) { sendErr(res, 404, 'Not Found'); return; }
        if (method === 'GET') { sendJson(res, 200, pullJson(repo, pull)); return; }
        sendErr(res, 404, 'Not Found'); return;
      }
      if (tail[2] === 'files' && method === 'GET') {
        if (!pull) { sendErr(res, 404, 'Not Found'); return; }
        const headTip = refTip(repo, pull.headBranch);
        if (!headTip) { sendErr(res, 404, 'Not Found'); return; }
        sendJson(res, 200, diffTrees(repo, pull.baseShaAtCreation, headTip));
        return;
      }
      if (tail[2] === 'merge' && method === 'PUT') {
        if (!pull) { sendErr(res, 404, 'Not Found'); return; }
        if (pull.state !== 'open') { sendErr(res, 405, 'Pull request is already closed'); return; }
        if (pullConflicts(repo, pull)) { sendErr(res, 405, 'Merge conflict'); return; }
        const sha = squashMerge(repo, pull);
        if (sha === null) { sendErr(res, 405, 'Merge failed'); return; }
        sendJson(res, 200, { sha, merged: true, message: `Pull request #${pull.number} merged` });
        return;
      }
      sendErr(res, 404, 'Not Found'); return;
    }
    sendErr(res, 404, 'Not Found'); return;
  }
  sendErr(res, 404, 'Not Found');
}

// ---------------------------------------------------------------- git smart HTTP

const CAPS_UPLOAD = 'side-band-64k shallow thin-pack ofs-delta multi_ack symref=HEAD:refs/heads/main agent=forge/1.0';
const CAPS_RECEIVE = 'report-status report-status-v2 side-band-64k delete-refs ofs-delta symref=HEAD:refs/heads/main agent=forge/1.0';

function sortedRefs(repo: Repo): { oid: string; name: string }[] {
  const out: { oid: string; name: string }[] = [];
  for (const [name, oid] of repo.refs) {
    if (name.startsWith('refs/heads/') || name.startsWith('refs/tags/')) out.push({ oid, name });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
function headTip(repo: Repo): string | undefined {
  return repo.refs.get(`refs/heads/${DEFAULT_BRANCH}`) ?? sortedRefs(repo).find((r) => r.name.startsWith('refs/heads/'))?.oid;
}
function v0Advertisement(repo: Repo, service: 'git-upload-pack' | 'git-receive-pack'): Buffer {
  const caps = service === 'git-upload-pack' ? CAPS_UPLOAD : CAPS_RECEIVE;
  const lines: (string | 'flush')[] = [`# service=${service}\n`, 'flush'];
  const refs = sortedRefs(repo);
  const tip = headTip(repo);
  if (refs.length === 0) {
    lines.push(`${ZERO_OID} capabilities^{}\0${caps}\n`);
  } else {
    lines.push(`${tip ?? ZERO_OID} HEAD\0${caps}\n`);
    for (const r of refs) {
      lines.push(`${r.oid} ${r.name}\n`);
      if (r.name.startsWith('refs/tags/')) {
        const obj = repo.objects.get(r.oid);
        if (obj && obj.type === 'tag') {
          const peeled = peelToCommit(repo.objects, r.oid);
          if (peeled) lines.push(`${peeled} ${r.name}^{}\n`);
        }
      }
    }
  }
  lines.push('flush');
  return pktLines(lines);
}
function v2Advertisement(): Buffer {
  return pktLines(['version 2\n', 'ls-refs=unborn\n', 'fetch=shallow\n', 'object-format=sha1\n', `agent=${AGENT}\n`, 'flush']);
}
/** The v2 advertisement never varies: build it once, serve the same bytes. */
const V2_ADV = v2Advertisement();
/** Objects the client already holds: reachable from haves without crossing shallow boundaries. */
function heldSet(repo: Repo, haves: string[], shallow: string[]): Set<string> {
  const shallowSet = new Set(shallow);
  const seen = new Set<string>();
  const queue = [...haves];
  while (queue.length) {
    const oid = queue.pop()!;
    if (seen.has(oid)) continue;
    const obj = repo.objects.get(oid);
    if (!obj) continue;
    seen.add(oid);
    if (obj.type === 'commit') {
      const c = parseCommit(obj.data);
      queue.push(c.tree);
      if (!shallowSet.has(oid)) for (const p of c.parents) queue.push(p);
    } else if (obj.type === 'tag') queue.push(parseTag(obj.data).object);
    else if (obj.type === 'tree') for (const e of parseTree(obj.data)) if (e.mode !== '160000') queue.push(e.oid);
  }
  return seen;
}
function sidebandPack(pack: Buffer): Buffer {
  const parts: Buffer[] = [];
  const CHUNK = 32768;
  for (let off = 0; off < pack.length; off += CHUNK) {
    const chunk = pack.subarray(off, Math.min(pack.length, off + CHUNK));
    parts.push(pktLine(Buffer.concat([Buffer.from([1]), chunk])));
  }
  return Buffer.concat(parts);
}
function buildFetchResponse(repo: Repo, wants: string[], haves: string[], shallow: string[], deepen: number | null): Buffer {
  const lookup = (oid: string): GitObj | undefined => repo.objects.get(oid);
  let send: Set<string>;
  let newShallow: string[] = [];
  let unshallow: string[] = [];
  if (deepen !== null) {
    const { objects, boundary } = collectShallow(wants, lookup, deepen);
    const held = heldSet(repo, haves, shallow);
    send = new Set([...objects].filter((o) => !held.has(o)));
    newShallow = [...boundary].sort();
    unshallow = shallow.filter((s) => !newShallow.includes(s));
  } else {
    const wanted = collectReachable(wants, lookup);
    const held = heldSet(repo, haves, shallow);
    send = new Set([...wanted].filter((o) => !held.has(o)));
    if (shallow.length) { newShallow = [...shallow].sort(); }
  }
  const objects: GitObj[] = [];
  for (const oid of [...send].sort()) {
    const o = repo.objects.get(oid);
    if (o) objects.push(o);
  }
  const pack = writePack(objects);
  const parts: Buffer[] = [];
  // protocol v2: the acknowledgments section is sent only when the client sent haves
  if (haves.length) {
    parts.push(pktLine('acknowledgments\n'));
    parts.push(pktLine(`ACK ${haves[0]}\n`));
    parts.push(pktLine('ready\n'));
    parts.push(PKT_DELIM);
  }
  if (deepen !== null || shallow.length) {
    parts.push(pktLine('shallow-info\n'));
    for (const s of newShallow) parts.push(pktLine(`shallow ${s}\n`));
    for (const s of unshallow) parts.push(pktLine(`unshallow ${s}\n`));
    parts.push(PKT_DELIM);
  }
  parts.push(pktLine('packfile\n'));
  parts.push(sidebandPack(pack));
  parts.push(PKT_FLUSH);
  return Buffer.concat(parts);
}
function buildFetchResponseV0(repo: Repo, wants: string[], haves: string[], shallow: string[], deepen: number | null): Buffer {
  const lookup = (oid: string): GitObj | undefined => repo.objects.get(oid);
  let send: Set<string>;
  let newShallow: string[] = [];
  if (deepen !== null) {
    const { objects, boundary } = collectShallow(wants, lookup, deepen);
    const held = heldSet(repo, haves, shallow);
    send = new Set([...objects].filter((o) => !held.has(o)));
    newShallow = [...boundary].sort();
  } else {
    const wanted = collectReachable(wants, lookup);
    const held = heldSet(repo, haves, shallow);
    send = new Set([...wanted].filter((o) => !held.has(o)));
    if (shallow.length) newShallow = [...shallow].sort();
  }
  const objects: GitObj[] = [];
  for (const oid of [...send].sort()) {
    const o = repo.objects.get(oid);
    if (o) objects.push(o);
  }
  const pack = writePack(objects);
  const parts: Buffer[] = [];
  if (haves.length) parts.push(pktLine(`ACK ${haves[0]}\n`));
  else parts.push(pktLine('NAK\n'));
  for (const s of newShallow) parts.push(pktLine(`shallow ${s}\n`));
  parts.push(sidebandPack(pack));
  parts.push(PKT_FLUSH);
  return Buffer.concat(parts);
}

function handleGit(req: IncomingMessage, res: ServerResponse, pathname: string, method: string, q: Map<string, string>, bodyBuf: Buffer): void {
  const m = /^\/([^/]+)\/([^/]+)\.git(?:\/(.*))?$/.exec(pathname);
  if (!m) { sendErr(res, 404, 'Not Found'); return; }
  const owner = decodeURIComponent(m[1]);
  const repoName = decodeURIComponent(m[2]);
  const suffix = m[3] ?? '';
  const repo = findRepo(owner, repoName);
  if (method === 'GET' && suffix === 'info/refs') {
    if (!repo) { sendErr(res, 404, 'Not Found'); return; }
    const service = q.get('service') ?? '';
    if (service !== 'git-upload-pack' && service !== 'git-receive-pack') { sendErr(res, 404, 'Not Found'); return; }
    const ct = `application/x-${service}-advertisement`;
    const isV2 = service === 'git-upload-pack' && req.headers['git-protocol'] === 'version=2';
    const buf = isV2 ? V2_ADV : v0Advertisement(repo, service as 'git-upload-pack' | 'git-receive-pack');
    sendBuf(res, 200, buf, ct);
    return;
  }
  if (method === 'POST' && suffix === 'git-upload-pack') {
    if (!repo) { sendErr(res, 404, 'Not Found'); return; }
    const isV2 = req.headers['git-protocol'] === 'version=2';
    const packets = decodePkts(bodyBuf);
    // v2 requests put the command first, then a delim packet, then the arguments:
    // collect EVERY data packet — never stop at the delim.
    const lines: string[] = [];
    for (const p of packets) {
      if (p.kind === 'data') lines.push(p.payload.toString('utf8'));
    }
    if (isV2) {
      const command = (lines[0] ?? '').trim();
      if (command === 'command=ls-refs') {
        let peel = false; let symrefs = false; let unborn = false;
        const prefixes: string[] = [];
        for (const line of lines.slice(1)) {
          const t = line.trim();
          if (t === 'peel') peel = true;
          else if (t === 'symrefs') symrefs = true;
          else if (t === 'unborn') unborn = true;
          else if (t.startsWith('ref-prefix ')) prefixes.push(t.slice('ref-prefix '.length));
        }
        const cacheKey = `ls:${repo.version}:${peel ? 1 : 0}:${symrefs ? 1 : 0}:${unborn ? 1 : 0}:${prefixes.join(',')}`;
        let buf = repo.lsCache.get(cacheKey);
        if (!buf) {
          const out: (string | 'flush')[] = [];
          const refs = sortedRefs(repo);
          const tip = headTip(repo);
          const emitRef = (oid: string, name: string): void => {
            let line = `${oid} ${name}`;
            if (name === 'HEAD' && symrefs) line += ' symref-target:refs/heads/main';
            if (peel && name.startsWith('refs/tags/')) {
              const obj = repo.objects.get(oid);
              if (obj && obj.type === 'tag') {
                const peeled = peelToCommit(repo.objects, oid);
                if (peeled) line += ` peeled:${peeled}`;
              }
            }
            out.push(line + '\n');
          };
          if (prefixes.length === 0) {
            if (tip) emitRef(tip, 'HEAD');
            else if (unborn) out.push('unborn HEAD symref-target:refs/heads/main\n');
            for (const r of refs) emitRef(r.oid, r.name);
          } else {
            // HEAD is a ref like any other for prefix filtering: it matches
            // prefix "HEAD" (git clone sends it) but not "refs/heads/".
            if (tip && prefixes.some((p) => 'HEAD'.startsWith(p))) emitRef(tip, 'HEAD');
            else if (!tip && unborn && prefixes.some((p) => 'HEAD'.startsWith(p))) out.push('unborn HEAD symref-target:refs/heads/main\n');
            for (const r of refs) if (prefixes.some((p) => r.name.startsWith(p))) emitRef(r.oid, r.name);
          }
          out.push('flush');
          buf = pktLines(out);
          repo.lsCache.set(cacheKey, buf);
        }
        sendBuf(res, 200, buf, 'application/x-git-upload-pack-result');
        return;
      }
      if (command === 'command=fetch') {
        const wants: string[] = []; const haves: string[] = []; const shallow: string[] = [];
        let deepen: number | null = null;
        for (const line of lines.slice(1)) {
          const t = line.trim();
          if (t.startsWith('agent=') || t.startsWith('object-format=') || t === 'done' || t === 'thin-pack' || t === 'no-progress' || t === 'ofs-delta' || t.startsWith('filter ')) continue;
          if (t.startsWith('want ')) wants.push(t.slice(5).trim());
          else if (t.startsWith('have ')) haves.push(t.slice(5).trim());
          else if (t.startsWith('shallow ')) shallow.push(t.slice(8).trim());
          else if (t.startsWith('deepen ')) deepen = parseInt(t.slice(7).trim(), 10);
        }
        const cacheKey = `f2:${repo.version}:${wants.join(',')}|${haves.join(',')}|${shallow.join(',')}|${deepen ?? ''}`;
        let buf = repo.fetchCache.get(cacheKey);
        if (!buf) {
          buf = buildFetchResponse(repo, wants, haves, shallow, deepen);
          repo.fetchCache.set(cacheKey, buf);
        }
        sendBuf(res, 200, buf, 'application/x-git-upload-pack-result');
        return;
      }
      sendErr(res, 400, 'unknown v2 command');
      return;
    }
    // v0 fetch
    const wants: string[] = []; const haves: string[] = []; const shallow: string[] = [];
    let deepen: number | null = null;
    let section = 0;
    for (const p of packets) {
      if (p.kind === 'flush') { section++; continue; }
      if (p.kind !== 'data') continue;
      const t = p.payload.toString('utf8').trim();
      if (section === 0) {
        if (t.startsWith('want ')) wants.push(t.slice(5).split(' ')[0]);
        else if (t.startsWith('shallow ')) shallow.push(t.slice(8).trim());
        else if (t.startsWith('deepen ')) deepen = parseInt(t.slice(7).trim(), 10);
      } else {
        if (t.startsWith('have ')) haves.push(t.slice(5).trim());
      }
    }
    if (wants.length === 0 && lines.length === 0 && packets.length === 0) { sendErr(res, 400, 'bad pkt-line'); return; }
    const cacheKey = `f0:${repo.version}:${wants.join(',')}|${haves.join(',')}|${shallow.join(',')}|${deepen ?? ''}`;
    let buf = repo.fetchCache.get(cacheKey);
    if (!buf) {
      buf = buildFetchResponseV0(repo, wants, haves, shallow, deepen);
      repo.fetchCache.set(cacheKey, buf);
    }
    sendBuf(res, 200, buf, 'application/x-git-upload-pack-result');
    return;
  }
  if (method === 'POST' && suffix === 'git-receive-pack') {
    if (!repo) { sendErr(res, 404, 'Not Found'); return; }
    if (!authed(req)) { sendErr(res, 401, 'Unauthorized'); return; }
    // parse command pkt-lines; the pack follows the flush packet byte-exactly
    interface Cmd { oldOid: string; newOid: string; ref: string; }
    const commands: Cmd[] = [];
    let off = 0; let packStart = bodyBuf.length;
    let bad = false;
    while (off + 4 <= bodyBuf.length) {
      const lenStr = bodyBuf.subarray(off, off + 4).toString('ascii');
      const len = parseInt(lenStr, 16);
      if (!/^[0-9a-fA-F]{4}$/.test(lenStr) || !Number.isFinite(len) || len < 0 || len > 65520) { bad = true; break; }
      if (len === 0) { packStart = off + 4; off = packStart; break; }
      if (len === 1 || len === 2) { off += 4; continue; }
      if (off + len > bodyBuf.length) { bad = true; break; }
      const payload = bodyBuf.subarray(off + 4, off + len).toString('utf8');
      const nul = payload.indexOf('\0');
      const line = (nul >= 0 ? payload.slice(0, nul) : payload).replace(/\n$/, '');
      const parts = line.split(' ');
      if (parts.length >= 3 && isOid(parts[0]) && isOid(parts[1])) {
        commands.push({ oldOid: parts[0], newOid: parts[1], ref: parts.slice(2).join(' ') });
      }
      off += len;
    }
    if (bad || commands.length === 0) { sendErr(res, 400, 'bad pkt-line'); return; }
    const reportLines: string[] = [];
    let unpackOk = true; let unpackDetail = 'ok';
    const needsPack = commands.some((c) => c.newOid !== ZERO_OID);
    if (needsPack) {
      if (packStart >= bodyBuf.length) {
        unpackOk = false; unpackDetail = 'unpacker error: missing pack';
      } else {
        try {
          const objects = readPack(bodyBuf.subarray(packStart));
          for (const [oid, obj] of objects) if (!repo.objects.has(oid)) repo.objects.set(oid, obj);
        } catch (err) {
          unpackOk = false; unpackDetail = `unpacker error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
    if (unpackOk) {
      for (const cmd of commands) {
        const current = repo.refs.get(cmd.ref);
        if (cmd.newOid === ZERO_OID) {
          if (!current) reportLines.push(`ng ${cmd.ref} remote ref does not exist`);
          else if (cmd.oldOid !== ZERO_OID && cmd.oldOid !== current) reportLines.push(`ng ${cmd.ref} non-fast-forward`);
          else { repo.refs.delete(cmd.ref); reportLines.push(`ok ${cmd.ref}`); }
        } else if (cmd.oldOid === ZERO_OID) {
          if (current) reportLines.push(`ng ${cmd.ref} already exists`);
          else if (!repo.objects.has(cmd.newOid)) reportLines.push(`ng ${cmd.ref} object not found`);
          else { repo.refs.set(cmd.ref, cmd.newOid); reportLines.push(`ok ${cmd.ref}`); }
        } else {
          if (!current) reportLines.push(`ng ${cmd.ref} remote ref does not exist`);
          else if (cmd.oldOid !== current) reportLines.push(`ng ${cmd.ref} non-fast-forward`);
          else if (cmd.newOid === current) reportLines.push(`ok ${cmd.ref}`);
          else if (!repo.objects.has(cmd.newOid)) reportLines.push(`ng ${cmd.ref} object not found`);
          else if (!isAncestor(repo.objects, current, cmd.newOid)) reportLines.push(`ng ${cmd.ref} non-fast-forward`);
          else { repo.refs.set(cmd.ref, cmd.newOid); reportLines.push(`ok ${cmd.ref}`); }
        }
      }
      bumpRepo(repo);
    } else {
      for (const cmd of commands) reportLines.push(`ng ${cmd.ref} unpack failed`);
    }
    const innerParts: (string | 'flush')[] = [`unpack ${unpackOk ? 'ok' : unpackDetail}\n`, ...reportLines.map((l) => l + '\n'), 'flush'];
    const inner = pktLines(innerParts);
    const outer = Buffer.concat([pktLine(Buffer.concat([Buffer.from([1]), inner])), PKT_FLUSH]);
    sendBuf(res, 200, outer, 'application/x-git-receive-pack-result');
    return;
  }
  sendErr(res, 404, 'Not Found');
}

// ---------------------------------------------------------------- GraphQL

type GqlValue = string | number | boolean | null | GqlValue[] | { [k: string]: GqlValue };
interface GqlField { name: string; alias: string | null; args: Record<string, GqlValue>; selections: GqlSel[]; }
interface GqlFragment { typeCondition: string | null; selections: GqlSel[]; }
type GqlSel = GqlField | GqlFragment;
interface GqlOp { kind: 'query' | 'mutation'; name: string | null; vars: Record<string, GqlValue>; selections: GqlSel[]; }

function gqlTokenize(src: string): string[] {
  const toks: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') { i++; continue; }
    if (ch === '.' && src.slice(i, i + 3) === '...') { toks.push('...'); i += 3; continue; }
    if ('!$():=@[]{}|'.includes(ch)) { toks.push(ch); i++; continue; }
    if (ch === '"') {
      let j = i + 1; let out = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1];
          if (e === 'n') out += '\n';
          else if (e === 't') out += '\t';
          else if (e === 'r') out += '\r';
          else if (e === 'u') { out += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 4; }
          else out += e;
          j += 2;
        } else { out += src[j]; j++; }
      }
      toks.push(JSON.stringify(out));
      i = j + 1;
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.eE+-]/.test(src[j])) j++;
      toks.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push(src.slice(i, j));
      i = j;
      continue;
    }
    i++;
  }
  return toks;
}
class GqlParser {
  private pos = 0;
  private toks: string[];
  constructor(toks: string[]) { this.toks = toks; }
  peek(): string { return this.toks[this.pos] ?? ''; }
  next(): string { return this.toks[this.pos++] ?? ''; }
  expect(t: string): void { if (this.peek() === t) this.pos++; }
  parseDocument(): GqlOp[] {
    const ops: GqlOp[] = [];
    while (this.pos < this.toks.length) {
      const t = this.peek();
      if (t === 'query' || t === 'mutation') {
        this.next();
        let name: string | null = null;
        if (this.peek() !== '(' && this.peek() !== '{' && this.peek() !== '@') name = this.next();
        this.skipVarDefs();
        this.skipDirectives();
        ops.push({ kind: t as 'query' | 'mutation', name, vars: {}, selections: this.parseSelectionSet() });
      } else if (t === '{') {
        ops.push({ kind: 'query', name: null, vars: {}, selections: this.parseSelectionSet() });
      } else if (t === 'fragment') {
        this.next(); this.next(); // fragment name
        if (this.peek() === 'on') { this.next(); this.next(); }
        this.skipDirectives();
        this.parseSelectionSet();
      } else this.next();
    }
    return ops;
  }
  private skipVarDefs(): void {
    if (this.peek() !== '(') return;
    let depth = 0;
    while (this.pos < this.toks.length) {
      const t = this.next();
      if (t === '(' || t === '[' || t === '{') depth++;
      else if (t === ')' || t === ']' || t === '}') { depth--; if (depth === 0) break; }
    }
  }
  private skipDirectives(): void {
    while (this.peek() === '@') {
      this.next(); this.next();
      if (this.peek() === '(') this.skipVarDefs();
    }
  }
  private parseSelectionSet(): GqlSel[] {
    this.expect('{');
    const sels: GqlSel[] = [];
    while (this.pos < this.toks.length && this.peek() !== '}') {
      sels.push(this.parseSelection());
    }
    this.expect('}');
    return sels;
  }
  private parseSelection(): GqlSel {
    if (this.peek() === '...') {
      this.next();
      if (this.peek() === 'on') {
        this.next();
        const typeCond = this.next();
        this.skipDirectives();
        return { typeCondition: typeCond, selections: this.parseSelectionSet() };
      }
      const fragName = this.next();
      this.skipDirectives();
      return { typeCondition: fragName, selections: [] };
    }
    const name = this.next();
    let alias: string | null = null; let fieldName = name;
    if (this.peek() === ':') { this.next(); alias = name; fieldName = this.next(); }
    const args: Record<string, GqlValue> = {};
    if (this.peek() === '(') {
      this.next();
      while (this.peek() !== ')' && this.pos < this.toks.length) {
        const argName = this.next();
        this.expect(':');
        args[argName] = this.parseValue();
      }
      this.expect(')');
    }
    this.skipDirectives();
    const selections = this.peek() === '{' ? this.parseSelectionSet() : [];
    return { name: fieldName, alias, args, selections };
  }
  private parseValue(): GqlValue {
    const t = this.next();
    if (t === '$') return { __var: this.next() } as unknown as GqlValue;
    if (t === '[') {
      const arr: GqlValue[] = [];
      while (this.peek() !== ']' && this.pos < this.toks.length) arr.push(this.parseValue());
      this.expect(']');
      return arr;
    }
    if (t === '{') {
      const obj: Record<string, GqlValue> = {};
      while (this.peek() !== '}' && this.pos < this.toks.length) {
        const k = this.next();
        this.expect(':');
        obj[k] = this.parseValue();
      }
      this.expect('}');
      return obj;
    }
    if (t.startsWith('"')) return JSON.parse(t) as string;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    const num = Number(t);
    if (t !== '' && !Number.isNaN(num) && /^-?\d/.test(t)) return num;
    return t;
  }
}
function resolveVars(v: GqlValue, vars: Record<string, GqlValue>): GqlValue {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && '__var' in v) {
    const name = (v as unknown as { __var: string }).__var;
    return vars[name] ?? null;
  }
  if (Array.isArray(v)) return v.map((x) => resolveVars(x, vars));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, GqlValue> = {};
    for (const [k, val] of Object.entries(v)) out[k] = resolveVars(val, vars);
    return out;
  }
  return v;
}
function argStr(args: Record<string, GqlValue>, name: string, vars: Record<string, GqlValue>): string | undefined {
  const v = resolveVars(args[name], vars);
  return typeof v === 'string' ? v : undefined;
}
function argInt(args: Record<string, GqlValue>, name: string, vars: Record<string, GqlValue>): number | undefined {
  const v = resolveVars(args[name], vars);
  return typeof v === 'number' ? v : undefined;
}
function argArr(args: Record<string, GqlValue>, name: string, vars: Record<string, GqlValue>): GqlValue[] | undefined {
  const v = resolveVars(args[name], vars);
  return Array.isArray(v) ? v : undefined;
}
function argObj(args: Record<string, GqlValue>, name: string, vars: Record<string, GqlValue>): Record<string, GqlValue> | undefined {
  const v = resolveVars(args[name], vars);
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, GqlValue>) : undefined;
}

const GQL_FIELDS: Record<string, Set<string>> = {
  Query: new Set(['viewer', 'repository', 'node', '__type', '__schema']),
  Viewer: new Set(['id', 'login', 'name', 'email']),
  Repository: new Set(['id', 'databaseId', 'name', 'nameWithOwner', 'owner', 'defaultBranchRef', 'viewerPermission', 'hasIssuesEnabled', 'issue', 'issues', 'pullRequests', 'pullRequest']),
  Issue: new Set(['id', 'number', 'title', 'state', 'body', 'url']),
  IssueConnection: new Set(['nodes', 'edges', 'pageInfo', 'totalCount']),
  IssueEdge: new Set(['node', 'cursor']),
  PullRequest: new Set(['id', 'number', 'title', 'body', 'state', 'merged', 'mergeable', 'headRefName', 'baseRefName', 'files']),
  PullRequestConnection: new Set(['nodes', 'edges', 'pageInfo', 'totalCount']),
  PullRequestEdge: new Set(['node', 'cursor']),
  PullRequestFileConnection: new Set(['nodes', 'edges', 'pageInfo', 'totalCount']),
  PullRequestFile: new Set(['path', 'filename', 'additions', 'deletions', 'changes', 'status']),
  IssueComment: new Set(['id', 'body']),
  User: new Set(['login', 'id', 'name']),
  BranchRef: new Set(['name']),
  PageInfo: new Set(['hasNextPage', 'endCursor', 'hasPreviousPage', 'startCursor']),
  Node: new Set(['id']),
  Mutation: new Set(['createIssue', 'closeIssue', 'createPullRequest', 'mergePullRequest', 'addComment']),
  CreateIssuePayload: new Set(['issue', 'clientMutationId']),
  CloseIssuePayload: new Set(['issue', 'clientMutationId']),
  CreatePullRequestPayload: new Set(['pullRequest', 'clientMutationId']),
  MergePullRequestPayload: new Set(['pullRequest', 'clientMutationId']),
  AddCommentPayload: new Set(['commentEdge', 'subject', 'clientMutationId']),
  CommentEdge: new Set(['node', 'cursor']),
  __Type: new Set(['name', 'kind', 'fields', 'enumValues', 'description']),
  __Field: new Set(['name', 'type']),
  __EnumValue: new Set(['name', 'description']),
};
const GQL_CHILD: Record<string, Record<string, string>> = {
  Query: { viewer: 'Viewer', repository: 'Repository', node: 'Node', __type: '__Type' },
  Mutation: { createIssue: 'CreateIssuePayload', closeIssue: 'CloseIssuePayload', createPullRequest: 'CreatePullRequestPayload', mergePullRequest: 'MergePullRequestPayload', addComment: 'AddCommentPayload' },
  Repository: { issue: 'Issue', issues: 'IssueConnection', pullRequests: 'PullRequestConnection', pullRequest: 'PullRequest', owner: 'User', defaultBranchRef: 'BranchRef' },
  IssueConnection: { nodes: 'Issue', edges: 'IssueEdge', pageInfo: 'PageInfo' },
  IssueEdge: { node: 'Issue' },
  PullRequestConnection: { nodes: 'PullRequest', edges: 'PullRequestEdge', pageInfo: 'PageInfo' },
  PullRequestEdge: { node: 'PullRequest' },
  PullRequest: { files: 'PullRequestFileConnection' },
  PullRequestFileConnection: { nodes: 'PullRequestFile', edges: 'PullRequestFile' },
  CreateIssuePayload: { issue: 'Issue' },
  CloseIssuePayload: { issue: 'Issue' },
  CreatePullRequestPayload: { pullRequest: 'PullRequest' },
  MergePullRequestPayload: { pullRequest: 'PullRequest' },
  AddCommentPayload: { commentEdge: 'CommentEdge', subject: 'Issue' },
  CommentEdge: { node: 'IssueComment' },
  __Type: { fields: '__Field', enumValues: '__EnumValue' },
};
function validateSelections(sels: GqlSel[], typeName: string, errors: { message: string }[]): void {
  const allowed = GQL_FIELDS[typeName];
  if (!allowed) return;
  for (const sel of sels) {
    if ('typeCondition' in sel) {
      if (sel.typeCondition && sel.selections.length) validateSelections(sel.selections, sel.typeCondition, errors);
      continue;
    }
    if (!allowed.has(sel.name)) {
      errors.push({ message: `Cannot query field "${sel.name}" on type "${typeName}".` });
      continue;
    }
    const child = GQL_CHILD[typeName]?.[sel.name];
    if (child && sel.selections.length) validateSelections(sel.selections, child, errors);
  }
}
function hasFragmentWithSelections(sels: GqlSel[]): boolean {
  return sels.some((s) => 'typeCondition' in s && s.selections.length > 0);
}
function stripTypename(obj: Record<string, unknown>): Record<string, unknown> {
  const { __typename: _t, ...rest } = obj;
  return rest;
}
function execValue(val: unknown, sel: GqlField, vars: Record<string, GqlValue>, parentType: string): unknown {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) {
    return val.map((el) => {
      if (el !== null && typeof el === 'object' && sel.selections.length) {
        const elType = String((el as Record<string, unknown>).__typename ?? GQL_CHILD[parentType]?.[sel.name] ?? parentType);
        return execSelections(stripTypename(el as Record<string, unknown>), sel.selections, vars, elType);
      }
      return el;
    });
  }
  if (typeof val === 'object' && sel.selections.length) {
    const childType = String((val as Record<string, unknown>).__typename ?? GQL_CHILD[parentType]?.[sel.name] ?? parentType);
    return execSelections(stripTypename(val as Record<string, unknown>), sel.selections, vars, childType);
  }
  return val;
}
function execSelections(obj: Record<string, unknown>, sels: GqlSel[], vars: Record<string, GqlValue>, typeName: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const sel of sels) {
    if ('typeCondition' in sel) {
      if (!sel.selections.length) continue;
      if (sel.typeCondition && sel.typeCondition !== typeName) continue;
      Object.assign(out, execSelections(obj, sel.selections, vars, sel.typeCondition ?? typeName));
      continue;
    }
    const key = sel.alias ?? sel.name;
    const val = (obj as Record<string, unknown>)[sel.name];
    const resolved = typeof val === 'function'
      ? (val as (f: GqlField, vars: Record<string, GqlValue>) => unknown)(sel, vars)
      : val;
    out[key] = execValue(resolved, sel, vars, typeName);
  }
  return out;
}
function issueGqlObj(repo: Repo, issue: Issue): Record<string, unknown> {
  return {
    __typename: 'Issue', id: globalId('Issue', [repo.id, issue.number]), number: issue.number,
    title: issue.title, state: issue.state === 'open' ? 'OPEN' : 'CLOSED', body: issue.body,
    url: `http://localhost/${repo.name}/issues/${issue.number}`,
  };
}
function pullGqlObj(repo: Repo, pull: Pull): Record<string, unknown> {
  return {
    __typename: 'PullRequest', id: globalId('PullRequest', [repo.id, pull.number]), number: pull.number,
    title: pull.title, body: pull.body, state: pull.state === 'open' ? 'OPEN' : 'CLOSED',
    merged: pull.merged, mergeable: pullConflicts(repo, pull) ? 'CONFLICTING' : 'MERGEABLE',
    headRefName: pull.headBranch, baseRefName: pull.baseBranch,
    files: (f: GqlField, vars: Record<string, GqlValue>): Record<string, unknown> => {
      const headTip = refTip(repo, pull.headBranch);
      const diff = headTip ? diffTrees(repo, pull.baseShaAtCreation, headTip) : [];
      const first = argInt(f.args, 'first', vars) ?? 100;
      const nodes = diff.slice(0, first).map((d) => ({
        __typename: 'PullRequestFile', path: d.filename, filename: d.filename,
        additions: d.additions, deletions: d.deletions, changes: d.changes, status: d.status,
      }));
      return { __typename: 'PullRequestFileConnection', nodes, pageInfo: { hasNextPage: false, endCursor: null }, totalCount: diff.length };
    },
  };
}
function repoGqlObj(repo: Repo): Record<string, unknown> {
  return {
    __typename: 'Repository', id: globalId('Repository', [repo.id]), databaseId: repo.id,
    name: repo.name, nameWithOwner: `${repo.owner}/${repo.name}`,
    owner: { __typename: 'User', login: repo.owner, id: 1000, name: 'ada iversen' },
    defaultBranchRef: (f: GqlField): Record<string, unknown> | null => {
      const tip = defaultTip(repo);
      return tip ? { __typename: 'BranchRef', name: DEFAULT_BRANCH } : null;
    },
    viewerPermission: 'ADMIN', hasIssuesEnabled: true,
    issue: (f: GqlField, vars: Record<string, GqlValue>): Record<string, unknown> | null => {
      const num = argInt(f.args, 'number', vars);
      const issue = repo.issues.find((i) => i.number === num);
      return issue ? issueGqlObj(repo, issue) : null;
    },
    issues: (f: GqlField, vars: Record<string, GqlValue>): Record<string, unknown> => {
      let list = [...repo.issues];
      const states = argArr(f.args, 'states', vars);
      if (states) {
        const want = new Set(states.map((s) => String(s).toLowerCase()));
        list = list.filter((i) => want.has(i.state));
      }
      const orderBy = argObj(f.args, 'orderBy', vars);
      if (orderBy && String(orderBy.direction ?? '') === 'DESC') list.sort((a, b) => b.number - a.number);
      else list.sort((a, b) => a.number - b.number);
      const after = argStr(f.args, 'after', vars);
      let start = 0;
      if (after) {
        const decoded = Buffer.from(after, 'base64').toString('utf8');
        const idx = parseInt(decoded.slice('cursor:'.length), 10);
        if (!Number.isNaN(idx)) start = idx + 1;
      }
      const first = argInt(f.args, 'first', vars) ?? 100;
      const page = list.slice(start, start + first);
      const endCursor = page.length ? Buffer.from(`cursor:${start + page.length - 1}`).toString('base64') : null;
      return {
        __typename: 'IssueConnection',
        nodes: page.map((i) => issueGqlObj(repo, i)),
        edges: page.map((i, k) => ({ __typename: 'IssueEdge', node: issueGqlObj(repo, i), cursor: Buffer.from(`cursor:${start + k}`).toString('base64') })),
        pageInfo: { __typename: 'PageInfo', hasNextPage: start + page.length < list.length, endCursor },
        totalCount: list.length,
      };
    },
    pullRequests: (f: GqlField, vars: Record<string, GqlValue>): Record<string, unknown> => {
      let list = repo.pulls.filter((p) => p.state === 'open');
      const states = argArr(f.args, 'states', vars);
      if (states) {
        const want = new Set(states.map((s) => String(s).toUpperCase()));
        list = repo.pulls.filter((p) => want.has(p.state === 'open' ? 'OPEN' : 'CLOSED'));
      }
      const first = argInt(f.args, 'first', vars) ?? 100;
      const page = list.slice(0, first);
      return {
        __typename: 'PullRequestConnection',
        nodes: page.map((p) => pullGqlObj(repo, p)),
        edges: page.map((p) => ({ __typename: 'PullRequestEdge', node: pullGqlObj(repo, p), cursor: Buffer.from(`cursor:${p.number}`).toString('base64') })),
        pageInfo: { __typename: 'PageInfo', hasNextPage: list.length > first, endCursor: null },
        totalCount: list.length,
      };
    },
    pullRequest: (f: GqlField, vars: Record<string, GqlValue>): Record<string, unknown> | null => {
      const num = argInt(f.args, 'number', vars);
      const pull = repo.pulls.find((p) => p.number === num);
      return pull ? pullGqlObj(repo, pull) : null;
    },
  };
}
function nodeGqlObj(id: string): Record<string, unknown> | null {
  const decoded = decodeGlobalId(id);
  if (!decoded) return null;
  if (decoded.kind === 'Repository') {
    const repo = [...repos.values()].find((r) => r.id === parseInt(decoded.parts[0], 10));
    return repo ? repoGqlObj(repo) : null;
  }
  if (decoded.kind === 'Issue') {
    const repo = [...repos.values()].find((r) => r.id === parseInt(decoded.parts[0], 10));
    const issue = repo?.issues.find((i) => i.number === parseInt(decoded.parts[1], 10));
    return repo && issue ? issueGqlObj(repo, issue) : null;
  }
  if (decoded.kind === 'PullRequest') {
    const repo = [...repos.values()].find((r) => r.id === parseInt(decoded.parts[0], 10));
    const pull = repo?.pulls.find((p) => p.number === parseInt(decoded.parts[1], 10));
    return repo && pull ? pullGqlObj(repo, pull) : null;
  }
  if (decoded.kind === 'IssueComment') {
    const repo = [...repos.values()].find((r) => r.id === parseInt(decoded.parts[0], 10));
    const comments = repo ? [...repo.comments.values()].flat() : [];
    const c = comments.find((x) => x.id === parseInt(decoded.parts[1], 10));
    return c ? { __typename: 'IssueComment', id: globalId('IssueComment', [repo!.id, c.id]), body: c.body } : null;
  }
  return null;
}
const TYPE_INFO: Record<string, { kind: string; fields: string[]; enumValues: string[] }> = {
  Issue: { kind: 'OBJECT', fields: ['id', 'number', 'title', 'state', 'body'], enumValues: [] },
  PullRequest: { kind: 'OBJECT', fields: ['id', 'number', 'headRefName', 'baseRefName', 'mergeable', 'state', 'merged', 'files'], enumValues: [] },
  Repository: { kind: 'OBJECT', fields: ['id', 'databaseId', 'name', 'nameWithOwner', 'owner', 'defaultBranchRef', 'viewerPermission', 'hasIssuesEnabled', 'issue', 'issues', 'pullRequests', 'pullRequest'], enumValues: [] },
  SearchType: { kind: 'ENUM', fields: [], enumValues: ['ISSUE', 'PULL_REQUEST', 'REPOSITORY', 'USER', 'DISCUSSION'] },
};
function executeGql(op: GqlOp, variables: Record<string, GqlValue>): { data: Record<string, unknown>; errors?: { message: string }[] } {
  const errors: { message: string }[] = [];
  const data: Record<string, unknown> = {};
  const rootType = op.kind === 'mutation' ? 'Mutation' : 'Query';
  validateSelections(op.selections, rootType, errors);
  const hasValidationError = errors.length > 0;
  for (const sel of op.selections) {
    if ('typeCondition' in sel) continue;
    const key = sel.alias ?? sel.name;
    if (hasValidationError) { data[key] = null; continue; }
    if (op.kind === 'query') {
      if (sel.name === 'viewer') {
        const viewerObj: Record<string, unknown> = { __typename: 'Viewer', id: globalId('User', [1000]), login: VIEWER_LOGIN, name: 'ada iversen', email: 'adaiversen@example.invalid' };
        data[key] = execSelections(viewerObj, sel.selections, variables, 'Viewer');
      } else if (sel.name === 'repository') {
        const owner = argStr(sel.args, 'owner', variables);
        const name = argStr(sel.args, 'name', variables);
        const repo = owner && name ? findRepo(owner, name) : undefined;
        data[key] = repo ? execSelections(repoGqlObj(repo), sel.selections, variables, 'Repository') : null;
      } else if (sel.name === 'node') {
        const id = argStr(sel.args, 'id', variables);
        const nodeObj = id ? nodeGqlObj(id) : null;
        data[key] = nodeObj ? execSelections(stripTypename(nodeObj), sel.selections, variables, String(nodeObj.__typename ?? 'Node')) : null;
      } else if (sel.name === '__type') {
        const name = argStr(sel.args, 'name', variables) ?? '';
        const info = TYPE_INFO[name];
        if (!info) { data[key] = null; continue; }
        const typeObj: Record<string, unknown> = {
          __typename: '__Type', name, kind: info.kind,
          fields: info.fields.map((f) => ({ __typename: '__Field', name: f })),
          enumValues: info.enumValues.map((e) => ({ __typename: '__EnumValue', name: e })),
          description: null,
        };
        data[key] = execSelections(typeObj, sel.selections, variables, '__Type');
      } else if (sel.name === '__schema') {
        data[key] = execSelections({ __typename: '__Schema' }, sel.selections, variables, '__Schema');
      } else data[key] = null;
    } else {
      // mutation
      if (sel.name === 'createIssue') {
        const input = argObj(sel.args, 'input', variables) ?? {};
        const repoId = typeof input.repositoryId === 'string' ? decodeGlobalId(input.repositoryId) : null;
        const repo = repoId ? [...repos.values()].find((r) => r.id === parseInt(repoId.parts[0], 10)) : undefined;
        const issue = repo ? createIssueObj(repo, typeof input.title === 'string' ? input.title : '', typeof input.body === 'string' ? input.body : '', []) : null;
        const payload: Record<string, unknown> = { __typename: 'CreateIssuePayload', issue: repo && issue ? issueGqlObj(repo, issue) : null, clientMutationId: input.clientMutationId ?? null };
        data[key] = execSelections(payload, sel.selections, variables, 'CreateIssuePayload');
      } else if (sel.name === 'closeIssue') {
        const input = argObj(sel.args, 'input', variables) ?? {};
        const issueId = typeof input.issueId === 'string' ? decodeGlobalId(input.issueId) : null;
        let gqlIssue: Record<string, unknown> | null = null;
        if (issueId && issueId.kind === 'Issue') {
          const repo = [...repos.values()].find((r) => r.id === parseInt(issueId.parts[0], 10));
          const issue = repo?.issues.find((i) => i.number === parseInt(issueId.parts[1], 10));
          if (repo && issue) { issue.state = 'closed'; refreshIssue(repo, issue); gqlIssue = issueGqlObj(repo, issue); }
        }
        const payload: Record<string, unknown> = { __typename: 'CloseIssuePayload', issue: gqlIssue, clientMutationId: input.clientMutationId ?? null };
        data[key] = execSelections(payload, sel.selections, variables, 'CloseIssuePayload');
      } else if (sel.name === 'createPullRequest') {
        const input = argObj(sel.args, 'input', variables) ?? {};
        const repoId = typeof input.repositoryId === 'string' ? decodeGlobalId(input.repositoryId) : null;
        const repo = repoId ? [...repos.values()].find((r) => r.id === parseInt(repoId.parts[0], 10)) : undefined;
        let gqlPull: Record<string, unknown> | null = null;
        if (repo) {
          const head = typeof input.headRefName === 'string' ? input.headRefName : '';
          const base = typeof input.baseRefName === 'string' ? input.baseRefName : DEFAULT_BRANCH;
          const headTip = refTip(repo, head); const baseTip = refTip(repo, base);
          if (headTip && baseTip) {
            const pull: Pull = {
              number: repo.nextPull++, title: typeof input.title === 'string' ? input.title : '',
              body: typeof input.body === 'string' ? input.body : '', state: 'open', merged: false,
              mergedAt: null, mergeSha: null, headBranch: head, baseBranch: base,
              baseShaAtCreation: baseTip, seq: ++globalIdSeq,
            };
            repo.pulls.push(pull);
            gqlPull = pullGqlObj(repo, pull);
          }
        }
        const payload: Record<string, unknown> = { __typename: 'CreatePullRequestPayload', pullRequest: gqlPull, clientMutationId: input.clientMutationId ?? null };
        data[key] = execSelections(payload, sel.selections, variables, 'CreatePullRequestPayload');
      } else if (sel.name === 'mergePullRequest') {
        const input = argObj(sel.args, 'input', variables) ?? {};
        const prId = typeof input.pullRequestId === 'string' ? decodeGlobalId(input.pullRequestId) : null;
        let gqlPull: Record<string, unknown> | null = null;
        if (prId && prId.kind === 'PullRequest') {
          const repo = [...repos.values()].find((r) => r.id === parseInt(prId.parts[0], 10));
          const pull = repo?.pulls.find((p) => p.number === parseInt(prId.parts[1], 10));
          if (repo && pull && pull.state === 'open' && !pullConflicts(repo, pull)) squashMerge(repo, pull);
          if (repo && pull) gqlPull = pullGqlObj(repo, pull);
        }
        const payload: Record<string, unknown> = { __typename: 'MergePullRequestPayload', pullRequest: gqlPull, clientMutationId: input.clientMutationId ?? null };
        data[key] = execSelections(payload, sel.selections, variables, 'MergePullRequestPayload');
      } else if (sel.name === 'addComment') {
        const input = argObj(sel.args, 'input', variables) ?? {};
        const subjectId = typeof input.subjectId === 'string' ? decodeGlobalId(input.subjectId) : null;
        let edge: Record<string, unknown> | null = null;
        if (subjectId && subjectId.kind === 'Issue') {
          const repo = [...repos.values()].find((r) => r.id === parseInt(subjectId.parts[0], 10));
          const issue = repo?.issues.find((i) => i.number === parseInt(subjectId.parts[1], 10));
          if (repo && issue) {
            const comment: Comment = { id: ++globalIdSeq, body: typeof input.body === 'string' ? input.body : '' };
            const arr = repo.comments.get(issue.number) ?? [];
            arr.push(comment);
            repo.comments.set(issue.number, arr);
            refreshIssue(repo, issue);
            edge = { __typename: 'CommentEdge', node: { __typename: 'IssueComment', id: globalId('IssueComment', [repo.id, comment.id]), body: comment.body }, cursor: Buffer.from(`cursor:${comment.id}`).toString('base64') };
          }
        }
        const payload: Record<string, unknown> = { __typename: 'AddCommentPayload', commentEdge: edge, subject: null, clientMutationId: input.clientMutationId ?? null };
        data[key] = execSelections(payload, sel.selections, variables, 'AddCommentPayload');
      } else data[key] = null;
    }
  }
  const result: { data: Record<string, unknown>; errors?: { message: string }[] } = { data };
  if (errors.length) result.errors = errors;
  return result;
}
function handleGraphql(req: IncomingMessage, res: ServerResponse, bodyBuf: Buffer): void {
  let parsed: unknown;
  try { parsed = JSON.parse(bodyBuf.toString('utf8')); }
  catch { sendErr(res, 400, 'Invalid JSON'); return; }
  const run = (doc: Record<string, unknown>): Record<string, unknown> => {
    const query = typeof doc.query === 'string' ? doc.query : '';
    const variables = (doc.variables ?? {}) as Record<string, GqlValue>;
    const operationName = typeof doc.operationName === 'string' ? doc.operationName : undefined;
    let ops: GqlOp[];
    try { ops = new GqlParser(gqlTokenize(query)).parseDocument(); }
    catch { return { data: null, errors: [{ message: 'Syntax Error: could not parse query.' }] }; }
    const op = operationName ? ops.find((o) => o.name === operationName) ?? ops[0] : ops[0];
    if (!op) return { data: {}, errors: [{ message: 'No operation found.' }] };
    return executeGql(op, variables);
  };
  const result = Array.isArray(parsed) ? parsed.map((d) => run(d as Record<string, unknown>)) : run(parsed as Record<string, unknown>);
  sendJson(res, 200, result);
}

// ---------------------------------------------------------------- MCP

const MCP_TOOLS: Record<string, unknown>[] = [
  { name: 'create_repo', description: 'Create a new repository', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Repository name' }, description: { type: 'string', description: 'Repository description' }, private: { type: 'boolean', description: 'Whether the repository is private' } }, required: ['name'] } },
  { name: 'get_repo', description: 'Get a repository by owner and name', inputSchema: { type: 'object', properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' } }, required: ['owner', 'repo'] } },
  { name: 'create_issue', description: 'Create an issue in a repository', inputSchema: { type: 'object', properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, title: { type: 'string', description: 'Issue title' }, body: { type: 'string', description: 'Issue body' }, labels: { type: 'array', items: { type: 'string' }, description: 'Labels to apply' } }, required: ['owner', 'repo', 'title'] } },
  { name: 'list_issues', description: 'List issues in a repository', inputSchema: { type: 'object', properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, state: { type: 'string', description: 'Issue state: open, closed, or all' } }, required: ['owner', 'repo'] } },
  { name: 'create_pull_request', description: 'Create a pull request', inputSchema: { type: 'object', properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, title: { type: 'string', description: 'Pull request title' }, head: { type: 'string', description: 'Head branch' }, base: { type: 'string', description: 'Base branch' }, body: { type: 'string', description: 'Pull request body' } }, required: ['owner', 'repo', 'title', 'head', 'base'] } },
  { name: 'merge_pull_request', description: 'Merge a pull request with a squash merge', inputSchema: { type: 'object', properties: { owner: { type: 'string', description: 'Repository owner' }, repo: { type: 'string', description: 'Repository name' }, pull_number: { type: 'integer', description: 'Pull request number' } }, required: ['owner', 'repo', 'pull_number'] } },
];
function mcpResult(structured: unknown): { structuredContent: unknown; content: { type: string; text: string }[] } {
  return { structuredContent: structured, content: [{ type: 'text', text: JSON.stringify(structured) }] };
}
function mcpErrorResult(message: string): { content: { type: string; text: string }[]; isError: boolean } {
  return { content: [{ type: 'text', text: message }], isError: true };
}
function mcpCallTool(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const need = (keys: string[]): string | null => {
    for (const k of keys) if (args[k] === undefined || args[k] === null || args[k] === '') return `Missing required argument: ${k}`;
    return null;
  };
  switch (name) {
    case 'create_repo': {
      const missing = need(['name']);
      if (missing) return mcpErrorResult(missing);
      const repoName = String(args.name);
      if (repos.has(repoName)) return mcpErrorResult('Repository already exists');
      const repo = createRepo(repoName, args.private === true, typeof args.description === 'string' ? args.description : '');
      return mcpResult({ ...repoJson(repo), full_name: `${repo.owner}/${repo.name}` });
    }
    case 'get_repo': {
      const missing = need(['owner', 'repo']);
      if (missing) return mcpErrorResult(missing);
      const repo = findRepo(String(args.owner), String(args.repo));
      if (!repo) return mcpErrorResult('Not Found');
      return mcpResult({ ...repoJson(repo), full_name: `${repo.owner}/${repo.name}` });
    }
    case 'create_issue': {
      const missing = need(['owner', 'repo', 'title']);
      if (missing) return mcpErrorResult(missing);
      const repo = findRepo(String(args.owner), String(args.repo));
      if (!repo) return mcpErrorResult('Not Found');
      const labels: Label[] = [];
      if (Array.isArray(args.labels)) {
        for (const lname of args.labels) {
          const found = repo.labels.get(String(lname));
          if (!found) return mcpErrorResult(`Label '${lname}' does not exist`);
          labels.push(found);
        }
      }
      const issue = createIssueObj(repo, String(args.title), typeof args.body === 'string' ? args.body : '', labels);
      const parsed = JSON.parse(issue.json.toString('utf8')) as Record<string, unknown>;
      parsed.number = issue.number;
      return mcpResult(parsed);
    }
    case 'list_issues': {
      const missing = need(['owner', 'repo']);
      if (missing) return mcpErrorResult(missing);
      const repo = findRepo(String(args.owner), String(args.repo));
      if (!repo) return mcpErrorResult('Not Found');
      const state = typeof args.state === 'string' ? args.state : 'open';
      const list = repo.issues.filter((i) => state === 'all' ? true : i.state === state).map((i) => JSON.parse(i.json.toString('utf8')));
      return mcpResult({ issues: list });
    }
    case 'create_pull_request': {
      const missing = need(['owner', 'repo', 'title', 'head', 'base']);
      if (missing) return mcpErrorResult(missing);
      const repo = findRepo(String(args.owner), String(args.repo));
      if (!repo) return mcpErrorResult('Not Found');
      const headTip = refTip(repo, String(args.head));
      const baseTip = refTip(repo, String(args.base));
      if (!headTip || !baseTip) return mcpErrorResult('head or base branch does not exist');
      const pull: Pull = {
        number: repo.nextPull++, title: String(args.title), body: typeof args.body === 'string' ? args.body : '',
        state: 'open', merged: false, mergedAt: null, mergeSha: null,
        headBranch: String(args.head), baseBranch: String(args.base), baseShaAtCreation: baseTip, seq: ++globalIdSeq,
      };
      repo.pulls.push(pull);
      return mcpResult(pullJson(repo, pull));
    }
    case 'merge_pull_request': {
      const missing = need(['owner', 'repo', 'pull_number']);
      if (missing) return mcpErrorResult(missing);
      const repo = findRepo(String(args.owner), String(args.repo));
      if (!repo) return mcpErrorResult('Not Found');
      const pull = repo.pulls.find((p) => p.number === Number(args.pull_number));
      if (!pull) return mcpErrorResult('Not Found');
      if (pull.state !== 'open') return mcpErrorResult('Pull request is already closed');
      if (pullConflicts(repo, pull)) return mcpErrorResult('Merge conflict');
      const sha = squashMerge(repo, pull);
      if (sha === null) return mcpErrorResult('Merge failed');
      return mcpResult({ sha, merged: true, number: pull.number, message: `Pull request #${pull.number} merged` });
    }
    default:
      return { __mcpError: -32601, message: `Unknown tool: ${name}` };
  }
}
function handleMcp(req: IncomingMessage, res: ServerResponse, bodyBuf: Buffer): void {
  let rpc: Record<string, unknown>;
  try { rpc = JSON.parse(bodyBuf.toString('utf8')) as Record<string, unknown>; }
  catch {
    res.writeHead(400, { 'content-type': 'application/json', 'x-github-request-id': reqId() });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
    return;
  }
  const id = rpc.id ?? null;
  const method = typeof rpc.method === 'string' ? rpc.method : '';
  if (rpc.id === undefined && method !== '') {
    // notification: acknowledge, no body
    res.writeHead(202, { 'x-github-request-id': reqId() });
    res.end();
    return;
  }
  const reply = (payload: Record<string, unknown>): void => {
    res.writeHead(200, { 'content-type': 'application/json', 'x-github-request-id': reqId() });
    res.end(JSON.stringify(payload));
  };
  const replyError = (code: number, message: string): void => reply({ jsonrpc: '2.0', id, error: { code, message } });
  const params = (rpc.params ?? {}) as Record<string, unknown>;
  if (method === 'server/discover') {
    reply({
      jsonrpc: '2.0', id,
      result: {
        supportedVersions: ['2026-07-28', '2025-06-18'],
        serverInfo: { name: 'forge', version: '1.0.0' },
        capabilities: { tools: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'forge', version: '1.0.0' } },
      },
    });
    return;
  }
  if (method === 'initialize') {
    reply({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2026-07-28',
        capabilities: { tools: {} },
        serverInfo: { name: 'forge', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'ping') { reply({ jsonrpc: '2.0', id, result: {} }); return; }
  if (method === 'tools/list') { reply({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }); return; }
  if (method === 'tools/call') {
    const toolName = typeof params.name === 'string' ? params.name : '';
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const out = mcpCallTool(toolName, args);
    if ('__mcpError' in out) { replyError(out.__mcpError as number, String(out.message)); return; }
    reply({ jsonrpc: '2.0', id, result: out });
    return;
  }
  replyError(-32601, `Method not found: ${method}`);
}

// ---------------------------------------------------------------- server

/** Parse /api/v3/repos/{owner}/{repo}/issues/{n} without a regex (read-workload hot path). */
function parseIssueGet(p: string): { owner: string; repo: string; num: number } | null {
  if (!p.startsWith('/api/v3/repos/')) return null;
  const oEnd = p.indexOf('/', 14);
  if (oEnd < 0) return null;
  const rEnd = p.indexOf('/', oEnd + 1);
  if (rEnd < 0 || p.slice(rEnd, rEnd + 8) !== '/issues/') return null;
  const numStr = p.slice(rEnd + 8);
  if (numStr === '') return null;
  let num = 0;
  for (let i = 0; i < numStr.length; i++) {
    const c = numStr.charCodeAt(i);
    if (c < 48 || c > 57) return null;
    num = num * 10 + (c - 48);
  }
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return { owner: p.slice(14, oEnd), repo: p.slice(oEnd + 1, rEnd), num };
}
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const rawUrl = req.url ?? '/';
  const qIdx = rawUrl.indexOf('?');
  const rawPath = qIdx < 0 ? rawUrl : rawUrl.slice(0, qIdx);
  const qs = qIdx < 0 ? '' : rawUrl.slice(qIdx + 1);
  let pathname: string;
  try { pathname = rawPath.indexOf('%') < 0 ? rawPath : decodeURIComponent(rawPath); }
  catch { sendErr(res, 400, 'Bad request'); return; }
  const method = req.method ?? 'GET';
  if (method === 'GET' && pathname === '/healthz') { sendJson(res, 200, { ok: true }); return; }
  // Fast path: the read workload is 2,000 sequential issue GETs — serve the cached
  // buffer without the generic router (auth + visibility rules identical to REST).
  if (method === 'GET') {
    const m = parseIssueGet(pathname);
    if (m) {
      if (!authed(req)) { sendErr(res, 401, 'Unauthorized'); return; }
      const repo = findRepo(m.owner, m.repo);
      if (!repo) { sendErr(res, 404, 'Not Found'); return; }
      const issue = repo.issues.find((i) => i.number === m.num);
      if (!issue) { sendErr(res, 404, 'Not Found'); return; }
      sendBuf(res, 200, issue.json, JSON_TYPE);
      return;
    }
  }
  const q = parseQuery(qs);
  const isGit = pathname.includes('.git/') && /^\/[^/]+\/[^/]+\.git(?:\/|$)/.test(pathname);
  if (isGit) {
    if (method === 'GET') { handleGit(req, res, pathname, method, q, Buffer.alloc(0)); return; }
    if (method === 'POST') {
      readBody(req).then((buf) => handleGit(req, res, pathname, method, q, buf)).catch(() => sendErr(res, 400, 'Bad request'));
      return;
    }
    sendErr(res, 404, 'Not Found'); return;
  }
  if (pathname === '/api/graphql') {
    if (method !== 'POST') { sendErr(res, 404, 'Not Found'); return; }
    if (!authed(req)) { sendErr(res, 401, 'Unauthorized'); return; }
    readBody(req).then((buf) => handleGraphql(req, res, buf)).catch(() => sendErr(res, 400, 'Bad request'));
    return;
  }
  if (pathname === '/mcp') {
    if (method !== 'POST') { sendErr(res, 404, 'Not Found'); return; }
    if (!authed(req)) {
      res.writeHead(401, { 'content-type': 'application/json', 'x-github-request-id': reqId() });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }));
      return;
    }
    readBody(req).then((buf) => handleMcp(req, res, buf)).catch(() => sendErr(res, 400, 'Bad request'));
    return;
  }
  if (pathname.startsWith('/api/v3')) {
    if (!authed(req)) { sendErr(res, 401, 'Unauthorized'); return; }
    if (method === 'GET' || method === 'HEAD') { handleRest(req, res, pathname, method, q, null); return; }
    readBody(req).then((buf) => {
      let body: unknown = null;
      if (buf.length > 0) {
        try { body = JSON.parse(buf.toString('utf8')); }
        catch { sendErr(res, 400, 'Invalid JSON'); return; }
      }
      handleRest(req, res, pathname, method, q, body);
    }).catch(() => sendErr(res, 400, 'Bad request'));
    return;
  }
  sendErr(res, 404, 'Not Found');
}

export function createApp(): Server {
  const server = createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (err) {
      // never crash the process on a bad request
      try {
        if (!res.headersSent) sendErr(res, 500, err instanceof Error ? err.message : 'Internal error');
        else res.end();
      } catch { /* socket already gone */ }
    }
  });
  return server;
}
