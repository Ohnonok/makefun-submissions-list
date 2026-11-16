// pumpfun-top5-forecast-01 entry (Node 22, standard library only): SIMPLE.
// The user asked for volume and holder count only. The snapshot rows carry
// NO volume and NO holder-count field, so this uses the closest simple
// proxies and invents nothing:
//   - VOLUME proxy = SOL inflow: the change in a coin's
//     quote_reserves_lamports between the last mark and the mark before it.
//     Buys push SOL into the curve/pool, so a rising reserve is real buying.
//   - MOMENTUM = log10 market-cap growth over the same step.
//   - HOLDER proxy: none exists in the data, so none is faked. The only
//     quality gate is graduation: complete=true and venue=pool, a coin with
//     real buyers and a real pool.
// Score (a few lines): growth = momentum * (1 + normalised SOL inflow),
// each clamped; the coin's projected size is its log10 cap in SOL grown by
// that growth, capped at +/-0.5 dex so one hot window cannot explode it.
// Coins are ranked by projected size: a large coin with modest growth still
// outranks a tiny coin with huge growth (pure momentum alone ranked a
// 547-SOL coin #1 and scored worse than the house baseline on the known
// practice read; projected size beat the baseline there). Graduated coins
// rank first; if fewer than 5 graduated coins exist, the largest
// non-graduated ones fill the rest, in the same order.
// The forecast mirrors the house baseline's shape on this ranked order:
// place k gets 0.30 on the ranked coin #k and 0.10 on #k-1 and #k+1, the
// rest left unnamed for movers and coins born after the cut; sizes are a
// normal in log10(cap in SOL) around the ranked coin's projected cap,
// sd 0.40, binned on task.json's edges. Deterministic: no clock, no random,
// ties break on the mint address, so two runs are byte-identical.
//
// Run locally: mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
/** On the ranked coin #k for place k. */
const P_STAY = 0.3;
/** On each of the ranked coins #k-1 and #k+1 for place k. */
const P_NEIGHBOUR = 0.1;
/** The sd of a place's log10(cap in SOL) around its projected cap. */
const SIZE_SD = 0.4;
/** How far one window's growth may move a projected cap, in dex. */
const GROWTH_CAP = 0.5;
const MICRO = 1_000_000;

interface Row {
  rank: number;
  mint: string;
  market_cap_lamports: string | number;
  venue: string;
  complete: boolean;
  quote_reserves_lamports: string | number;
}

const task = JSON.parse(readFileSync(join(INPUT_DIR, 'task.json'), 'utf8')) as { places: number; output: string; size: { edges: number[] } };
const lines = readFileSync(join(INPUT_DIR, 'history.ndjson'), 'utf8').split('\n').filter((l) => l !== '');
const marks = lines.map((l) => JSON.parse(l) as { ok: boolean; rows: Row[] | null }).filter((m) => m.ok === true && Array.isArray(m.rows) && m.rows.length > 0);
if (marks.length === 0) throw new Error('the history holds no ok mark with rows');
const last = [...marks[marks.length - 1]!.rows!].sort((a, b) => a.rank - b.rank);
if (last.length < task.places) throw new Error(`the last mark ranks ${last.length} coins, fewer than the ${task.places} places`);
const prev = marks.length > 1 ? marks[marks.length - 2]!.rows! : [];
const prevByMint = new Map(prev.map((r) => [r.mint, r]));
/** The earliest row a mint appears in, for a coin born inside the window. */
const firstByMint = new Map<string, Row>();
for (const m of marks) for (const r of m.rows!) if (!firstByMint.has(r.mint)) firstByMint.set(r.mint, r);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
/** log10 of a cap in SOL, as the scorer takes it: log10(lamports) - 9. */
const sizeOf = (lamports: string | number): number => Math.log10(Number(BigInt(lamports))) - 9;

interface Scored { mint: string; proj: number; graduated: boolean }
const scored: Scored[] = last.map((r) => {
  const cap = Number(BigInt(r.market_cap_lamports));
  const res = Number(BigInt(r.quote_reserves_lamports));
  const earlier = prevByMint.get(r.mint) ?? firstByMint.get(r.mint);
  let growth = 0;
  if (earlier !== undefined && earlier !== r) {
    const capE = Number(BigInt(earlier.market_cap_lamports));
    const resE = Number(BigInt(earlier.quote_reserves_lamports));
    const momentum = clamp(Math.log10(Math.max(cap, 1)) - Math.log10(Math.max(capE, 1)), -1.5, 1.5);
    const inflow = clamp((res - resE) / Math.max(resE, 1), -0.5, 3);
    growth = momentum * (1 + inflow);
  }
  return { mint: r.mint, proj: sizeOf(r.market_cap_lamports) + clamp(growth, -GROWTH_CAP, GROWTH_CAP), graduated: r.complete === true && r.venue === 'pool' };
});
const byProj = (a: Scored, b: Scored): number => (b.proj - a.proj) || (a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0);
const ranked = [
  ...scored.filter((s) => s.graduated).sort(byProj),
  ...scored.filter((s) => !s.graduated).sort(byProj),
].slice(0, task.places + 1); // one extra: the #6 coin is place 5's neighbour
if (ranked.length < task.places) throw new Error(`only ${ranked.length} candidates for ${task.places} places`);

/** erfc(x), Numerical Recipes' erfcc (fractional error under 1.2e-7 everywhere). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
/** P(X >= x) for X normal with mean `mean` and sd `sd`. */
const above = (x: number, mean: number, sd: number): number => (x === -Infinity ? 1 : x === Infinity ? 0 : 0.5 * erfc((x - mean) / (sd * Math.SQRT2)));

const probabilities: Array<{ mint: string; place: number; p: number }> = [];
const sizes: Array<{ place: number; bin: number; p: number }> = [];
const edges = task.size.edges;
for (let place = 1; place <= task.places; place++) {
  probabilities.push({ mint: ranked[place - 1]!.mint, place, p: P_STAY });
  if (place > 1) probabilities.push({ mint: ranked[place - 2]!.mint, place, p: P_NEIGHBOUR });
  if (ranked[place] !== undefined) probabilities.push({ mint: ranked[place]!.mint, place, p: P_NEIGHBOUR });
  const mean = ranked[place - 1]!.proj;
  for (let bin = 0; bin <= edges.length; bin++) {
    const lo = bin === 0 ? -Infinity : edges[bin - 1]!;
    const hi = bin === edges.length ? Infinity : edges[bin]!;
    const u = Math.floor((above(lo, mean, SIZE_SD) - above(hi, mean, SIZE_SD)) * MICRO);
    if (u > 0) sizes.push({ place, bin, p: u / MICRO });
  }
}
const top5 = ranked.slice(0, task.places).map((r) => r.mint);
writeFileSync(join(OUTPUT_DIR, task.output), `${JSON.stringify({ probabilities, top5, sizes })}\n`);
