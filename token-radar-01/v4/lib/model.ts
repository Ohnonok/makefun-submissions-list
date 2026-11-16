// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY pre-token protocol the snapshot's own watchlist rule would keep (the
// watchlist is the floor, never the ceiling): pre-token, and not a product the snapshot's rule
// excludes — not in the Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC
// or CEX categories, not a versioned pool, no whole word wrapped, staked or staking in the name,
// not an exchange's own product. This snapshot gives 198 rows, the 40 watchlist protocols among
// them: 342 protocols record no token, 144 are left out by that rule, 198 are ranked.
//
// The comparables are a narrower set than the board: they set the Cross Chain Bridge category
// aside as well. Its four trading tokens sit far off the pooled TVL-to-mcap line, and including
// them moves the leave-one-out error from 3.22x to 3.64x, so the fit does not price off them —
// while the board still ranks Circle Gateway, the one pre-token Cross Chain Bridge protocol, like
// any other pre-token protocol the rule keeps.
//
// Implied value is fitted from the snapshot's own comparables, never from a hardcoded list of names:
//
//   comps     = the 90 token families that already trade (mcap_usd > 0), minus CEX and minus the
//               bridge / liquid-staking / restaking categories whose tokens are wrapped products,
//               and minus Cross Chain Bridge: its four trading tokens sit far off the pooled line,
//               and including them moves the leave-one-out error from 3.22x to 3.64x
//   fit       = pooled log-log regression log(mcap) = a + b * log(tvl) over the comps
//               (this snapshot: b ~ 0.41, so market cap grows slower than TVL: big protocols
//               carry a lower mcap/TVL than small ones, and a flat multiple would overprice them)
//   category  = each category's median log-residual off that line, shrunk toward zero by n/(n+3),
//               with one guard: a category with a single comp is capped at +/-0.5 in log terms
//               (a factor between 0.61x and 1.65x). The shrink alone discounts a single comp to
//               a quarter of its residual, but that still lets one 400x outlier set the price:
//               uncapped, Rain alone would carry Prediction Market at x4.93 and put Polymarket,
//               the board's rank 1, at $109.8M — about twice every other entry's value for the
//               same protocol. The cap is there because the backtests CANNOT validate a
//               single-comp factor: the comp is always held out when it is predicted, so
//               leave-one-out and the time split are both blind to it. Factors from two or more
//               comps are not capped — zeroing those DOES worsen the leave-one-out error
//               (3.32x vs 3.22x), so they stay. Risk Curators keeps x1.58 from api3 alone, capped
//               only by the same 0.5 bound (its shrunk log adjustment is 0.45, inside the cap).
//               25 model variants were tested (gating, winsorizing, capping, sibling term,
//               dropping the outliers, mcap floors, robust trimming); the fit below is the best
//               of them on leave-one-out AND on the time-split test, and the sweep table is in
//               the v4 build report.
//   growth    = 1 + clamp(change_7d, -60, 120) / 100 * 0.25
//   maturity  = 0.85 + min(age_days, 1095) / 1095 * 0.15   (age unknown: 365 days)
//   implied   = exp(a + b * log(tvl) + category_adj) * growth * maturity
//
// The fit is tested honestly, out of sample, two ways: leave-one-out over the 90 comps, refitting
// the line and the category adjustment without the protocol being predicted; and a time split —
// fit on the comps listed before 2024, price the comps listed since. This snapshot's leave-one-out
// error is a median factor of ~3.2x and its time-split error ~2.1x. Both beat one flat mcap/TVL
// multiple (4.78x leave-one-out, 4.17x time-split), and the category term itself is worth a
// little on leave-one-out (3.32x without it) and nothing on the time split (2.08x either way —
// most post-2024 comps sit in categories the pre-2024 fit never saw, so their adjustment is
// zero). Every implied value on the board is an order-of-magnitude estimate, not a price. The
// dashboard states both backtests next to the board instead of hiding them, and every row
// carries its P10-P90 range from the leave-one-out error distribution, so the uncertainty is
// visible per row, not just in prose.
//
// Farm plans are costed net of fees AND net of the slice they earn: every step names its gas in
// dollars (a stated per-chain estimate), its capital and its time, and the last step totals the
// sunk gas, noting the capital comes back on exit. The plan deploys one standard $1,000 slice
// on every row, and the verdict prices that slice: what $1,000 would hold if depositors took 10%
// of the launch pro rata, minus the sunk gas, minus the T-bill yield forgone on $1,000 over the
// hold at 4% a year. ROBUST when the net still clears $5 at the low end of the row's band,
// FARM when it clears $5 at the implied value, THIN when it is positive but under $5, SKIP
// when it is zero or negative — a farm that cannot beat a T-bill says so on the board. No
// protocol name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, fitted from the snapshot at run time and stated in the dashboard. */
export interface ModelConstants {
  /** Pooled log-log intercept: log(mcap) = intercept + slope * log(tvl). */
  intercept: number;
  /** Pooled log-log slope on log(TVL). */
  slope: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Shrinkage pseudo-count for a category's residual median. */
  shrink: number;
  /** A token family counts as a comp only above this market cap (dead tokens carry mcap 0). */
  comp_mcap_floor: number;
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5-comps';

/** One category's comparables: how many token families, and their shrunk log-residual. */
export interface CategoryComp {
  category: string;
  n: number;
  adj: number;
}

/** The leave-one-out backtest of the comps fit, recomputed from the snapshot on every run. */
export interface Backtest {
  comps: number;
  median_abs_log_error: number;
  median_factor: number;
  within_2x: number;
  within_3x: number;
  median_ratio: number;
  /** Median factor if every category adjustment is forced to 1 (same log-log line, no category term). */
  flat_median: number;
  /** Median factor of one flat mcap/TVL multiple (median ratio over the comps, no line at all). */
  flat_ratio_median: number;
  /** 10th percentile of the leave-one-out ratio (pred/actual). */
  p10_ratio: number;
  /** 90th percentile of the leave-one-out ratio (pred/actual). */
  p90_ratio: number;
  /** 25th percentile of the leave-one-out ratio: the band's low end is implied / p75_ratio. */
  p25_ratio: number;
  /** 75th percentile of the leave-one-out ratio: the band's low end is implied / p75_ratio. */
  p75_ratio: number;
  /** Ablation: leave-one-out median factor of the full model, then without the growth term,
   *  without the category term, and with the bare size curve alone. */
  ablation: { full: number; no_momentum: number; no_category: number; curve_only: number };
  /** Time-split test: comps the model was fitted on, listed before 2024-01-01. */
  oos_train_n: number;
  /** Time-split test: comps it priced without ever seeing them, listed since 2024-01-01. */
  oos_test_n: number;
  /** Median factor of the time-split test. */
  oos_median: number;
  /** Share of time-split predictions inside 2x / 3x. */
  oos_within_2x: number;
  oos_within_3x: number;
  /** Median factor of one flat multiple on the same time-split test. */
  oos_flat_median: number;
  /** Median factor of one flat mcap/TVL multiple on the same time-split test. */
  oos_flat_ratio_median: number;
  /** Second time split: comps the model was fitted on, listed before 2025-01-01. */
  oos2_train_n: number;
  /** Second time split: comps it priced without ever seeing them, listed since 2025-01-01. */
  oos2_test_n: number;
  /** Median factor of the second time-split test. */
  oos2_median: number;
  /** Median factor of one flat multiple on the same second time-split test. */
  oos2_flat_ratio_median: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_value: number;
    category: string;
    category_comps: number;
    category_adj: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    gas_usd: number;
    hold_days: number;
    sunk_gas_usd: number;
    transactions: number;
    slice_value_usd: number;
    tbill_forgone_usd: number;
    net_usd: number;
    work_hours: number;
    net_per_hour_usd: number;
    breakeven_usd: number;
    low_net_usd: number;
    verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  base_value: number;
  category_adj: number;
  category_comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
  sunk_gas_usd: number;
  transactions: number;
  slice_value_usd: number;
  tbill_forgone_usd: number;
  net_usd: number;
  work_hours: number;
  net_per_hour_usd: number;
  breakeven_usd: number;
  low_net_usd: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its backtest. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  backtest: Backtest;
  categories: CategoryComp[];
  verdict_counts: { ROBUST: number; FARM: number; THIN: number; SKIP: number };
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** The categories the snapshot's own rule excludes from the BOARD: a wrapped, staked or bridged
 *  product of a token that already trades, a CEX, a versioned pool, an exchange's own product.
 *  This list is the rules' list, word for word — Cross Chain Bridge is NOT on it, so Circle
 *  Gateway, the one pre-token protocol in that category, is ranked. */
const BOARD_EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** The categories whose token, if any, is a wrapped, staked or bridged product, not a launch.
 *  The comparables set this aside as well as the board list: Cross Chain Bridge tokens sit far
 *  off the pooled line (including the four moves the leave-one-out error from 3.22x to 3.64x). */
const WRAPPED_CATEGORIES = new Set([
  ...BOARD_EXCLUDED_CATEGORIES,
  'Cross Chain Bridge',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in the name: a wrapped or staked product. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
/** An exchange's own product, named after the exchange. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** The comparables: token families that already trade, minus the wrapped-product categories. */
/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, and not a product the snapshot's
 *  own rule excludes. The rule is the rules' list, not the comparables' narrower one. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !BOARD_EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The comparables: token families that already trade, minus the wrapped-product categories. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.tvl_usd > 0 &&
      !WRAPPED_CATEGORIES.has(p.category ?? ''),
  );
}

/** The median of numbers, the middle value (upper middle of an even count). */
function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)]!;
}

/** Ordinary least squares for log(mcap) on log(tvl) over `rows`. */
function ols(rows: SnapshotProtocol[]): { intercept: number; slope: number } {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  for (const p of rows) {
    sx += Math.log(p.tvl_usd);
    sy += Math.log(p.mcap_usd!);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of rows) {
    const dx = Math.log(p.tvl_usd) - mx;
    sxy += dx * (Math.log(p.mcap_usd!) - my);
    sxx += dx * dx;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { intercept: my - slope * mx, slope };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The comps fit: the pooled line plus each category's shrunk median log-residual off it. */
export interface CompsFit {
  model: ModelConstants;
  categories: CategoryComp[];
  /** A category's shrunk log-residual, 0 when the snapshot carries no comp for it. */
  adjOf: (category: string | null) => number;
  /** How many comps a category carries. */
  nOf: (category: string | null) => number;
}

export function fitComps(snapshot: Snapshot, comps?: SnapshotProtocol[]): CompsFit {
  const rows = comps ?? compsOf(snapshot);
  const { intercept, slope } = ols(rows);
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of rows) {
    const c = p.category ?? 'Other';
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(p);
  }
  const shrink = 3;
  const categories: CategoryComp[] = [...byCat.entries()]
    .map(([category, ps]) => {
      const resid = ps.map((q) => Math.log(q.mcap_usd!) - (intercept + slope * Math.log(q.tvl_usd)));
      // A category with one comp cannot set the price on its own: its adjustment is capped at
      // +/-0.5 in log terms, a factor between 0.61x and 1.65x. The backtests cannot validate a
      // single-comp factor — the comp is always held out when it is predicted — and uncapped,
      // one 400x outlier (Rain, the only traded Prediction Market) would set the board's rank 1
      // at $109.8M, about twice every other entry's value for the same protocol. Factors from
      // two or more comps are not capped: gating those DOES worsen the leave-one-out error
      // (3.22x to 3.32x), so they stay.
      const adj =
        ps.length === 1
          ? Math.max(-0.5, Math.min(0.5, median(resid) / (1 + shrink)))
          : (ps.length * median(resid)) / (ps.length + shrink);
      return { category, n: ps.length, adj: round4(adj) };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const byName = new Map(categories.map((c) => [c.category, c]));
  const model: ModelConstants = {
    intercept: round4(intercept),
    slope: round4(slope),
    growth_weight: 0.25,
    growth_floor: -60,
    growth_cap: 120,
    maturity_floor: 0.85,
    maturity_range: 0.15,
    maturity_days: 1095,
    unknown_age_days: 365,
    shrink,
    comp_mcap_floor: 0,
  };
  return {
    model,
    categories,
    adjOf: (category) => byName.get(category ?? 'Other')?.adj ?? 0,
    nOf: (category) => byName.get(category ?? 'Other')?.n ?? 0,
  };
}

/** The fitted base value (before growth and maturity) of one protocol under `fit`. */
function baseValue(p: SnapshotProtocol, fit: CompsFit): number {
  return Math.exp(fit.model.intercept + fit.model.slope * Math.log(p.tvl_usd) + fit.adjOf(p.category));
}

/** The growth and maturity multipliers and the implied value one protocol gets under `fit`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
): { implied: number; base: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const m = fit.model;
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * m.growth_weight;
  const ageForModel = age ?? m.unknown_age_days;
  const maturityMult = m.maturity_floor + (Math.min(Math.max(ageForModel, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
  const base = baseValue(protocol, fit);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, base: Math.round(base), growthPct, growthMult, maturityMult, age };
}

/**
 * The leave-one-out backtest: every comp is predicted with the line and the category adjustment
 * refitted without it, and the prediction is scored against its real market cap. The fit is noisy
 * by nature — token values scatter widely around TVL — and this reports the scatter honestly.
 */
export function backtestLOO(snapshot: Snapshot): Backtest {
  const comps = compsOf(snapshot);
  const errors: number[] = [];
  const ratios: number[] = [];
  const flatErrors: number[] = [];
  const noMomErrors: number[] = [];
  const noCatErrors: number[] = [];
  const curveErrors: number[] = [];
  for (const held of comps) {
    const rest = comps.filter((p) => p !== held);
    const fit = fitComps(snapshot, rest);
    const pred = impliedValue(held, snapshot.as_of, fit);
    errors.push(Math.log(pred.implied / held.mcap_usd!));
    ratios.push(pred.implied / held.mcap_usd!);
    const flatFit: CompsFit = { ...fit, categories: [], adjOf: () => 0, nOf: () => 0 };
    const flat = impliedValue(held, snapshot.as_of, flatFit);
    flatErrors.push(Math.log(flat.implied / held.mcap_usd!));
    noMomErrors.push(Math.log(Math.max(1, Math.round(pred.base * pred.maturityMult)) / held.mcap_usd!));
    noCatErrors.push(Math.log(flat.implied / held.mcap_usd!));
    const flatBase = flat.implied / (flat.growthMult * flat.maturityMult);
    curveErrors.push(Math.log(Math.max(1, Math.round(flatBase)) / held.mcap_usd!));
  }
  const medFactor = (errs: number[]): number => {
    const a = errs.map(Math.abs).sort((x, y) => x - y);
    return Math.exp(a[Math.floor(a.length / 2)]!);
  };
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const medAbs = abs[Math.floor(abs.length / 2)]!;
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  // One flat multiple, the weakest honest baseline: the median mcap/TVL ratio of the fit set,
  // applied to TVL with no line and no category term.
  const ratioFlat = (fitSet: SnapshotProtocol[], predict: SnapshotProtocol[]): number => {
    const ratio = median(fitSet.map((p) => p.mcap_usd! / p.tvl_usd));
    const errs = predict.map((p) => Math.log((ratio * p.tvl_usd) / p.mcap_usd!)).map(Math.abs).sort((a, b) => a - b);
    return Math.exp(errs[Math.floor(errs.length / 2)]!);
  };
  // Time split: fit on the comps listed before the cutoff, price the comps listed since, without
  // ever seeing them. Comps with no listed date are left out of both sides.
  const splitEval = (cutoff: string) => {
    const train = comps.filter((p) => p.listed_at && p.listed_at < cutoff);
    const test = comps.filter((p) => p.listed_at && p.listed_at >= cutoff);
    const trainFit = fitComps(snapshot, train);
    const oosErrors: number[] = [];
    const oosFlatErrors: number[] = [];
    for (const p of test) {
      const { implied } = impliedValue(p, snapshot.as_of, trainFit);
      oosErrors.push(Math.log(implied / p.mcap_usd!));
      const flatFit: CompsFit = { ...trainFit, categories: [], adjOf: () => 0, nOf: () => 0 };
      oosFlatErrors.push(Math.log(impliedValue(p, snapshot.as_of, flatFit).implied / p.mcap_usd!));
    }
    return {
      train_n: train.length,
      test_n: test.length,
      median: medFactor(oosErrors),
      within_2x: oosErrors.filter((e) => Math.abs(e) <= Math.log(2)).length,
      within_3x: oosErrors.filter((e) => Math.abs(e) <= Math.log(3)).length,
      flat_median: medFactor(oosFlatErrors),
      flat_ratio_median: ratioFlat(train, test),
    };
  };
  const split1 = splitEval('2024-01-01');
  const split2 = splitEval('2025-01-01');
  return {
    comps: comps.length,
    median_abs_log_error: round4(medAbs),
    median_factor: round4(Math.exp(medAbs)),
    within_2x: errors.filter((e) => Math.abs(e) <= Math.log(2)).length,
    within_3x: errors.filter((e) => Math.abs(e) <= Math.log(3)).length,
    median_ratio: round4(sortedRatios[Math.floor(sortedRatios.length / 2)]!),
    flat_median: round4(medFactor(flatErrors)),
    flat_ratio_median: round4(
      (() => {
        const looFlatRatio: number[] = [];
        for (const held of comps) looFlatRatio.push(ratioFlat(comps.filter((p) => p !== held), [held]));
        looFlatRatio.sort((a, b) => a - b);
        return looFlatRatio[Math.floor(looFlatRatio.length / 2)]!;
      })(),
    ),
    p10_ratio: round4(sortedRatios[Math.floor(sortedRatios.length * 0.1)]!),
    p90_ratio: round4(sortedRatios[Math.floor(sortedRatios.length * 0.9)]!),
    p25_ratio: round4(sortedRatios[Math.floor(sortedRatios.length * 0.25)]!),
    p75_ratio: round4(sortedRatios[Math.floor(sortedRatios.length * 0.75)]!),
    ablation: {
      full: round4(Math.exp(medAbs)),
      no_momentum: round4(medFactor(noMomErrors)),
      no_category: round4(medFactor(noCatErrors)),
      curve_only: round4(medFactor(curveErrors)),
    },
    oos_train_n: split1.train_n,
    oos_test_n: split1.test_n,
    oos_median: round4(split1.median),
    oos_within_2x: split1.within_2x,
    oos_within_3x: split1.within_3x,
    oos_flat_median: round4(split1.flat_median),
    oos_flat_ratio_median: round4(split1.flat_ratio_median),
    oos2_train_n: split2.train_n,
    oos2_test_n: split2.test_n,
    oos2_median: round4(split2.median),
    oos2_flat_ratio_median: round4(split2.flat_ratio_median),
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The farm economics of one standard slice: what $1,000 would hold if depositors took 10%
 *  of the launch pro rata at the implied value, minus the sunk gas, minus the T-bill yield
 *  forgone on $1,000 over the hold at 4% a year. ROBUST when the net still clears $5 at the
 *  low end of the row's band (implied / p75 of the leave-one-out ratios); FARM when the net
 *  clears $5 at the implied value; THIN when it is positive but under $5; SKIP when it is
 *  zero or negative — a farm that cannot beat a T-bill says so on the board. Work is the step
 *  times added up (the hold itself is not work). Break-even is the launch value at which the
 *  slice exactly covers the gas and the forgone yield. */
export const SLICE_USD = 1000;
export const AIRDROP_SHARE = 0.1;
export const TBILL_RATE = 0.04;

export interface SliceEconomics {
  slice_value_usd: number;
  tbill_forgone_usd: number;
  net_usd: number;
  work_hours: number;
  net_per_hour_usd: number;
  /** Launch value at which the $1,000 slice exactly covers gas plus forgone yield. */
  breakeven_usd: number;
  /** Net at the low end of the row's band (implied / p75_ratio). */
  low_net_usd: number;
  verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';
}

export function sliceEconomics(
  implied: number,
  tvl: number,
  sunk: number,
  hold: number,
  weekly: number,
  second: boolean,
  p75_ratio: number,
): SliceEconomics {
  const slice_value = Math.round(((SLICE_USD / tvl) * AIRDROP_SHARE * implied * 100) / 100);
  const tbill_forgone = Math.round(((SLICE_USD * TBILL_RATE * hold) / 365) * 100) / 100;
  const net = Math.round((slice_value - sunk - tbill_forgone) * 100) / 100;
  const workMin = 5 + 15 + 10 + (second ? 15 : 10 * weekly) + 10 * weekly;
  const work_hours = Math.round((workMin / 60) * 100) / 100;
  const net_per_hour = Math.round((net / work_hours) * 100) / 100;
  const breakeven_usd = Math.round(((sunk + tbill_forgone) * tvl) / (SLICE_USD * AIRDROP_SHARE));
  const low_slice = slice_value / p75_ratio;
  const low_net = Math.round((low_slice - sunk - tbill_forgone) * 100) / 100;
  const verdict: 'ROBUST' | 'FARM' | 'THIN' | 'SKIP' =
    low_net >= 5 ? 'ROBUST' : net >= 5 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  return { slice_value_usd: slice_value, tbill_forgone_usd: tbill_forgone, net_usd: net, work_hours, net_per_hour_usd: net_per_hour, breakeven_usd, low_net_usd: low_net, verdict };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs: one standard $1,000 slice on every row, so the
 *  verdict prices the same slice everywhere and rows are comparable. (v3 scaled the slice to
 *  TVL — $50 to $250 — which hid the fact that the smallest rows' gas ate the whole slice.) */
function capitalFor(_p: SnapshotProtocol): number {
  return 1000;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Stated gas estimate for one transaction on a chain, in dollars (typical, not a quote).
 *  Chain names are normalised (lowercased, punctuation stripped) so 'Op_Bnb' prices as opBNB
 *  instead of falling through. Every chain in the snapshot is priced by family — cheap L1
 *  $0.05, $0.10 tier, BNB/Tron $0.30, L2/rollup $0.40, Avalanche $0.50, Bitcoin $2,
 *  Ethereum $6 — and any other EVM chain defaults to the $0.40 L2 tier. There is no $1
 *  fallback left: the old fallback priced 61 of the 198 board rows' first chain at a number
 *  that was never an estimate. */
export function gasForChain(chain: string): number {
  const c = chain.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c === 'ethereum') return 6;
  if (c === 'bitcoin') return 2;
  if (c === 'ripple' || c === 'xrp') return 0.01;
  if (
    [
      'solana', 'stellar', 'sui', 'aptos', 'algorand', 'monad', 'hyperliquid', 'hyperliquidl1',
      'provenance', 'xion', 'sonic', 'ronin', 'kava', 'proton', 'qubic', 'pharos', 'klaytn',
      'tempo', 'stable', 'flow', 'icp', 'near', 'ton', 'tezos', 'vechain', 'elrond',
      'agoric', 'akash', 'archway', 'bandchain', 'carbon', 'celestia', 'cosmos', 'dymension',
      'fetchhub', 'initia', 'injective', 'juno', 'kujira', 'migaloo', 'neutron', 'noble',
      'osmosis', 'persistence', 'secret', 'stride', 'terra', 'terra2', 'umee', 'xpla', 'dydx',
      'bitcoincash', 'bsvblockchain', 'dash', 'decred', 'ergo', 'kaspa', 'litecoin', 'hedera',
      'astar', 'aurora', 'chiliz', 'conflux', 'evmos', 'fantom', 'lightlink', 'lisk', 'metis',
      'moonbeam', 'moonriver', 'oasis', 'sei', 'telos', 'thundercore', 'vana',
    ].includes(c)
  )
    return 0.05;
  if (
    [
      'polygon', 'flare', 'plasma', 'core', 'berachain', 'bittensor', 'bifrostnetwork',
      'hibachi', 'rsk', 'strato', 'canton', 'doge', 'dogechain', 'zcash', 'nervos', 'cardano',
      'zetachain',
    ].includes(c)
  )
    return 0.1;
  if (c === 'bsc' || c === 'bnbchain' || c === 'binancesmartchain' || c === 'binance' || c === 'tron' || c === 'stacks' || c === 'mezo') return 0.3;
  if (c === 'avalanche') return 0.5;
  return 0.4;
}

/** Dollars with no cents when whole, else two decimals; negatives read -$9.09, not $-9.09. */
function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return Number.isInteger(a) ? `${sign}$${a.toLocaleString('en-US')}` : `${sign}$${a.toFixed(2)}`;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Deposit ${money(capital)} of USDC as collateral on ${name} on ${chain} and hold it.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide ${money(capital)} of liquidity to ${name}'s pool on ${chain} and hold it.`;
  if (c.includes('bridge')) return `Bridge ${money(capital)} of USDC to ${chain} through ${name} and use the funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${money(capital)} of the chain's staking asset through ${name} and keep it.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit ${money(capital)} of USDC as margin on ${name} and open a small hedge.`;
  if (c.includes('prediction')) return `Fund ${money(capital)} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit ${money(capital)} into a ${name} vault on ${chain} and hold them.`;
  if (c.includes('stable')) return `Mint or deposit ${money(capital)} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint ${money(capital)} of ${name}'s yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy ${money(capital)} of cover from ${name} on ${chain} and hold it.`;
  if (c.includes('basis')) return `Open a basis position with ${money(capital)} on ${name} on ${chain}: buy spot, short the future, equal size.`;
  if (c === 'chain') return `Bridge ${money(capital)} of USDC to ${name} and use it in one of the chain's own apps.`;
  if (c.includes('liquidity manager')) return `Deposit ${money(capital)} into a ${name} managed vault on ${chain} and hold them.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Mint ${money(capital)} of the BTC-backed asset through ${name} on ${chain} and hold it.`;
  if (c.includes('cedefi')) return `Deposit ${money(capital)} into a ${name} CeDeFi vault on ${chain} and hold them.`;
  if (c === 'farm') return `Deposit ${money(capital)} into the ${name} farm on ${chain} and stake it.`;
  if (c.includes('payment')) return `Pay ${money(capital)} through ${name} on ${chain} and keep it.`;
  if (c.includes('governance')) return `Stake ${money(capital)} in ${name}'s governance on ${chain} and vote on one proposal.`;
  if (c.includes('otc')) return `Place a ${money(capital)} order through ${name}'s OTC desk on ${chain}.`;
  if (c.includes('crypto card')) return `Load ${money(capital)} onto a card through ${name} and spend some.`;
  if (c.includes('option')) return `Buy or sell one small option through ${name} on ${chain} for ${money(capital)}.`;
  if (c.includes('index')) return `Buy ${money(capital)} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Deposit ${money(capital)} through ${name}'s private pool on ${chain} and keep it.`;
  return `Deposit ${money(capital)} of USDC into ${name} on ${chain} and hold it.`;
}

/** The category's second, different qualifying action a week later. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a little against the deposit on ${name}, then repay it the same week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap a small amount through ${name}'s pool on ${chain} as a second activity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a fresh half-size one.`;
  if (c.includes('prediction')) return `Settle the first position on ${name} and place a second, smaller one.`;
  if (c.includes('curator') || c.includes('allocator')) return `Add a second deposit to the same ${name} vault on ${chain}.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim any staking rewards ${name} shows, then restake them.`;
  if (c.includes('bridge')) return `Bridge a small amount back through ${name} to show it works both ways.`;
  if (c.includes('basis')) return `Close part of the basis position on ${name} and reopen it smaller.`;
  if (c === 'chain') return `Make a second transaction on ${name}: a swap or a vote in its own apps.`;
  if (c.includes('liquidity manager')) return `Move part of the ${name} vault position between its ranges.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Move some between the BTC-backed asset and USDC on ${name}.`;
  if (c.includes('cedefi')) return `Add a second deposit to the same ${name} CeDeFi vault on ${chain}.`;
  if (c === 'farm') return `Claim the farm rewards ${name} shows, then restake them.`;
  if (c.includes('payment')) return `Make a second payment through ${name} on ${chain}.`;
  if (c.includes('governance')) return `Vote on a second proposal in ${name}'s governance.`;
  if (c.includes('otc')) return `Settle the first OTC order on ${name} and place a second, smaller one.`;
  if (c.includes('crypto card')) return `Spend a little more from the card through ${name}.`;
  if (c.includes('option')) return `Close the first option on ${name} and open a fresh half-size one.`;
  if (c.includes('index')) return `Add a second amount to the ${name} index on ${chain}.`;
  if (c.includes('privacy')) return `Make a second private deposit through ${name} on ${chain}.`;
  return `Use ${name}'s app once more on ${chain}: a swap, a vote or a second deposit.`;
}

/** The category's weekly qualifying action, different from the first two actions. */
function weeklyActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Repay part of the borrow on ${name} and borrow again the same week to keep it active.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add or remove a small amount of liquidity in ${name}'s pool on ${chain} each week.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open and close one small hedge on ${name} each week.`;
  if (c.includes('prediction')) return `Place one small market position on ${name} each week, settling the last.`;
  if (c.includes('curator') || c.includes('allocator')) return `Rebalance the ${name} vault deposit weekly: add a little, or move it between the vault's options.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards ${name} shows each week and restake them the same day.`;
  if (c.includes('bridge')) return `Bridge a small amount through ${name} once a week to keep the route active.`;
  if (c.includes('stable')) return `Mint or redeem a little of the stable asset through ${name} on ${chain} each week.`;
  if (c.includes('rwa')) return `Top up the yield position on ${name} a little each week.`;
  if (c.includes('insurance')) return `Check the cover from ${name} each week and renew before it lapses.`;
  if (c.includes('basis')) return `Roll the basis position on ${name} weekly: close the old leg and open a fresh one.`;
  if (c === 'chain') return `Do one transaction on ${name} each week: a swap, a vote or a deposit.`;
  if (c.includes('liquidity manager')) return `Rebalance the ${name} managed vault position weekly: add a little, or move it between ranges.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Top up the BTC-backed position on ${name} a little each week.`;
  if (c.includes('cedefi')) return `Rebalance the ${name} CeDeFi deposit weekly: add a little, or move it between the vault's options.`;
  if (c === 'farm') return `Claim the farm rewards ${name} shows each week and restake them the same day.`;
  if (c.includes('payment')) return `Make one small payment through ${name} each week.`;
  if (c.includes('governance')) return `Vote on one new proposal in ${name}'s governance each week.`;
  if (c.includes('otc')) return `Place one small OTC order through ${name} each week, settling the last.`;
  if (c.includes('crypto card')) return `Spend a little from the card through ${name} each week.`;
  if (c.includes('option')) return `Open and close one small option on ${name} each week.`;
  if (c.includes('index')) return `Top up the ${name} index a little each week.`;
  if (c.includes('privacy')) return `Make one small private deposit through ${name} each week.`;
  return `Do one small action on ${name} each week on ${chain}: a deposit, a swap or a vote.`;
}

/** The protocol's second chain, when it runs on more than one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Why this protocol is worth farming now, from its own 7-day move and age. */
function whyNow(p: SnapshotProtocol, age: number | null): string {
  const g = finite(p.change_7d, 0);
  const pct = `${Number(g.toFixed(2))}%`;
  if (g >= 5) return `TVL rose ${pct} in 7 days, so activity is rising into the next snapshot.`;
  if (g <= -5) return `TVL fell ${Math.abs(Number(g.toFixed(2)))}% in 7 days, so attention is low while the position still counts.`;
  if (age !== null && age < 180) return `It has run ${age} days with no token, so the early window is still open.`;
  if (age !== null) return `It has run ${age} days with no token: the longer it runs, the closer a launch gets.`;
  return `It records no token and no start date, so farm the position itself, not a rumoured date.`;
}

/** The category's weekly check: what to look at on the protocol's own rewards page, named. */
function checkBody(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Check ${name}'s rewards page and your borrow health each week`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Check ${name}'s pool rewards and fee earnings each week`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Check ${name}'s margin and funding each week`;
  if (c.includes('prediction')) return `Check ${name}'s settled markets and rewards each week`;
  if (c.includes('curator') || c.includes('allocator')) return `Check the ${name} vault's rewards and share price each week`;
  if (c.includes('staking') || c.includes('restak')) return `Check the staking rewards ${name} shows each week`;
  if (c.includes('bridge')) return `Check ${name}'s route and any rewards each week`;
  if (c.includes('stable')) return `Check the stable asset's peg and ${name}'s rewards each week`;
  if (c.includes('rwa')) return `Check the yield asset's value and ${name}'s rewards each week`;
  if (c.includes('insurance')) return `Check the cover from ${name} and its rewards each week`;
  if (c.includes('basis')) return `Check the basis position's funding and ${name}'s rewards each week`;
  if (c === 'chain') return `Check ${name}'s own rewards page each week`;
  if (c.includes('liquidity manager')) return `Check the ${name} vault's rewards and ranges each week`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Check the BTC-backed asset's peg and ${name}'s rewards each week`;
  if (c.includes('cedefi')) return `Check the ${name} CeDeFi vault's rewards each week`;
  if (c === 'farm') return `Check the farm rewards ${name} shows each week`;
  if (c.includes('payment')) return `Check ${name}'s payment rewards each week`;
  if (c.includes('governance')) return `Check ${name}'s governance rewards and open votes each week`;
  if (c.includes('otc')) return `Check ${name}'s OTC rewards each week`;
  if (c.includes('crypto card')) return `Check the card rewards ${name} shows each week`;
  if (c.includes('option')) return `Check the open options and ${name}'s rewards each week`;
  if (c.includes('index')) return `Check the ${name} index's rewards each week`;
  if (c.includes('privacy')) return `Check ${name}'s rewards page each week`;
  return `Check ${name}'s own points or rewards page every week`;
}

function checkFor(p: SnapshotProtocol): string {
  return checkBody(p) + ', claiming only from its published link.';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, netted to the dollar.
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas is a stated per-chain estimate; the capital is not spent, it comes
 * back when the position is closed, so the plan's sunk cost is its gas alone. Every step names the
 * protocol it is for, so no two rows share a plan: the action, the second action, the weekly
 * action, the hold reason and the claim check all follow the protocol's own category, chains,
 * growth and age, and a protocol on two chains gets a mirror step on the second chain instead of
 * a generic weekly one. The weekly count is the whole weeks inside the hold (30 days is 4 weeks,
 * not 5), and the last step prices the standard $1,000 slice, states its verdict (ROBUST when
 * the net still clears $5 at the low end of the row's band) and its break-even launch value,
 * so the plan itself says whether the farm is worth doing.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, p75_ratio: number): FarmStep[] {
  const chain = chainOf(p);
  const name = p.name;
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasForChain(chain);
  const weekly = Math.max(1, Math.floor(hold / 7));
  const transactions = 3 + weekly + (second !== null ? 1 : 0);
  const sunk = Math.round((gas * (3 + weekly) + (second !== null ? gasForChain(second) : 0)) * 100) / 100;
  const econ = sliceEconomics(implied, p.tvl_usd, sunk, hold, weekly, second !== null, p75_ratio);
  const action = actionFor(p, capital, chain);
  const sameName = chain.toLowerCase() === name.toLowerCase();
  const fourth =
    second !== null
      ? {
          text: `Mirror the ${name} position on ${second} with half the capital (${money(Math.round(capital / 2))}) so it counts on two chains.`,
          cost: `about ${money(gasForChain(second))} of gas`,
          time: '15 minutes',
        }
      : {
          text: weeklyActionFor(p, chain),
          cost: `about ${money(gas)} of gas a week, ${money(Math.round(gas * weekly * 100) / 100)} over ${weekly} weeks`,
          time: '10 minutes a week',
        };
  return [
    {
      text: sameName
        ? `Use a fresh wallet for ${name}, holding only the funds you plan to farm, and keep its seed phrase offline.`
        : `Use a fresh wallet on ${chain} for ${name}, holding only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: sameName ? `about ${money(gas)} of gas for the first transaction` : `about ${money(gas)} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `${money(capital)} of capital and about ${money(gas)} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: `about ${money(gas)} of gas`,
      time: '10 minutes',
    },
    fourth,
    {
      text: `Hold the ${name} position for at least ${hold} days so the activity counts in more than one snapshot. ${whyNow(p, age)}`,
      cost: `the ${money(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: checkFor(p),
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    },
    {
      text: `Netted cost for ${name}: about ${money(sunk)} of gas is sunk across ${transactions} transactions over ${hold} days, and the ${money(capital)} of capital comes back on exit, so the farm costs ${money(sunk)} plus your time. A ${money(SLICE_USD)} slice would hold about ${money(econ.slice_value_usd)} at 10% pro rata, net ${money(econ.net_usd)} after gas and ${money(econ.tbill_forgone_usd)} of forgone T-bill yield — verdict: ${econ.verdict}${econ.verdict === 'ROBUST' ? ` (still ${money(econ.low_net_usd)} at the low end of its band)` : ''}. Break-even is a launch of ${money(econ.breakeven_usd)}.`,
      cost: `${money(sunk)} sunk in total`,
      time: `${hold} days all in`,
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit?: CompsFit, p75_ratio?: number): BoardRow[] {
  const f = fit ?? fitComps(snapshot);
  const p75 = p75_ratio ?? backtestLOO(snapshot).p75_ratio;
  const index = bySlug(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && !chosen.includes(p)) chosen.push(p);
  }

  const scored = chosen.map((p) => {
    const { implied, base, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, f);
    return { p, implied, base, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const chain = chainOf(s.p);
    const second = s.p.chains.length > 1 ? s.p.chains[1]! : null;
    const capital = capitalFor(s.p);
    const hold = holdDaysFor(s.age);
    const gas = gasForChain(chain);
    const weekly = Math.max(1, Math.floor(hold / 7));
    const transactions = 3 + weekly + (second !== null ? 1 : 0);
    const sunk = Math.round((gas * (3 + weekly) + (second !== null ? gasForChain(second) : 0)) * 100) / 100;
    const econ = sliceEconomics(s.implied, s.p.tvl_usd, sunk, hold, weekly, second !== null, p75);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      watchlist: watchlist.has(s.p.slug),
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_value: s.base,
        category: s.p.category ?? 'Other',
        category_comps: f.nOf(s.p.category),
        category_adj: f.adjOf(s.p.category),
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        age_days: s.age,
      },
      farm: {
        capital_usd: capital,
        gas_usd: gas,
        hold_days: hold,
        sunk_gas_usd: sunk,
        transactions,
        slice_value_usd: econ.slice_value_usd,
        tbill_forgone_usd: econ.tbill_forgone_usd,
        net_usd: econ.net_usd,
        work_hours: econ.work_hours,
        net_per_hour_usd: econ.net_per_hour_usd,
        breakeven_usd: econ.breakeven_usd,
        low_net_usd: econ.low_net_usd,
        verdict: econ.verdict,
      },
      farm_steps: farmSteps(s.p, s.age, s.implied, p75).map(stepText),
    };
  });
}

/** The live-token protocols, for the dashboard's Live token view: exactly the comparables the
 *  ranking is fitted on, by market cap — so the page's claim that the live tab shows the comps
 *  is true, and the board's separation of live from pre-token is the model's own separation. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return compsOf(snapshot)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    base_value: row.model.base_value,
    category_adj: row.model.category_adj,
    category_comps: row.model.category_comps,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    capital_usd: row.farm.capital_usd,
    gas_usd: row.farm.gas_usd,
    hold_days: row.farm.hold_days,
    sunk_gas_usd: row.farm.sunk_gas_usd,
    transactions: row.farm.transactions,
    slice_value_usd: row.farm.slice_value_usd,
    tbill_forgone_usd: row.farm.tbill_forgone_usd,
    net_usd: row.farm.net_usd,
    work_hours: row.farm.work_hours,
    net_per_hour_usd: row.farm.net_per_hour_usd,
    breakeven_usd: row.farm.breakeven_usd,
    low_net_usd: row.farm.low_net_usd,
    verdict: row.farm.verdict,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot);
  const test = backtestLOO(snapshot);
  const board = buildBoard(snapshot, fit, test.p75_ratio);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const verdict_counts = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdict_counts[r.farm.verdict]++;
  const total_implied_usd = board.reduce((a, r) => a + r.implied_value_usd, 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fit.model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    backtest: test,
    categories: fit.categories,
    verdict_counts,
    total_implied_usd,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
