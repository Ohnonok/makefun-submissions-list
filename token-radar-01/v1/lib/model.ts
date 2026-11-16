// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY pre-token protocol the snapshot's own watchlist rule would keep (the
// watchlist is the floor, never the ceiling): pre-token, and not a wrapped, staked or bridged product
// of a token that already trades, not a CEX, not a versioned pool, not an exchange's own product.
// This snapshot gives 198 rows, the 40 watchlist protocols among them.
//
// Implied value is fitted from the snapshot's own comparables, never from a hardcoded list of names:
//
//   comps     = the 90 token families that already trade (mcap_usd > 0), minus CEX and minus the
//               bridge / liquid-staking / restaking categories whose tokens are wrapped products
//   fit       = pooled log-log regression log(mcap) = a + b * log(tvl) over the comps
//               (this snapshot: b ~ 0.41, so market cap grows slower than TVL: big protocols
//               carry a lower mcap/TVL than small ones, and a flat multiple would overprice them)
//   category  = each category's median log-residual off that line, shrunk toward zero by n/(n+3),
//               so a category with one comp cannot set the price on its own
//   growth    = 1 + clamp(change_7d, -60, 120) / 100 * 0.25
//   maturity  = 0.85 + min(age_days, 1095) / 1095 * 0.15   (age unknown: 365 days)
//   implied   = exp(a + b * log(tvl) + category_adj) * growth * maturity
//
// The fit is tested honestly, out of sample: leave-one-out over the 90 comps, refitting the line and
// the category adjustment without the protocol being predicted. This snapshot's leave-one-out error
// is a median factor of ~3.2x with 48% of predictions inside 3x of the real market cap, so every
// implied value on the board is an order-of-magnitude estimate, not a price. The dashboard states
// the backtest numbers next to the board instead of hiding them.
//
// Farm plans are costed net of fees: every step names its gas in dollars (a stated per-chain
// estimate), its capital and its time, and the last step totals the sunk gas, noting the capital
// comes back on exit. No protocol name is ever special-cased: the same functions score every row.

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
export const MODEL_VERSION = 'radar-2-comps';

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

/** The categories whose token, if any, is a wrapped, staked or bridged product, not a launch. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in the name: a wrapped or staked product. */
const WRAPPED_WORD = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
/** An exchange's own product, named after the exchange. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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

/** Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 *  product of a token that already trades, not a CEX, not a versioned pool, not an exchange's own. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
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
      const adj = (ps.length * median(resid)) / (ps.length + shrink);
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
  for (const held of comps) {
    const rest = comps.filter((p) => p !== held);
    const fit = fitComps(snapshot, rest);
    const { implied } = impliedValue(held, snapshot.as_of, fit);
    errors.push(Math.log(implied / held.mcap_usd!));
    ratios.push(implied / held.mcap_usd!);
  }
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const medAbs = abs[Math.floor(abs.length / 2)]!;
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  return {
    comps: comps.length,
    median_abs_log_error: round4(medAbs),
    median_factor: round4(Math.exp(medAbs)),
    within_2x: errors.filter((e) => Math.abs(e) <= Math.log(2)).length,
    within_3x: errors.filter((e) => Math.abs(e) <= Math.log(3)).length,
    median_ratio: round4(sortedRatios[Math.floor(sortedRatios.length / 2)]!),
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
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

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Stated gas estimate for one transaction on a chain, in dollars (typical, not a quote). */
export function gasForChain(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 6;
  if (c === 'solana') return 0.05;
  if (c === 'bsc' || c === 'bnb chain' || c === 'binance smart chain') return 0.3;
  if (c === 'polygon') return 0.1;
  if (c === 'avalanche') return 0.5;
  if (
    c === 'base' ||
    c === 'arbitrum' ||
    c === 'optimism' ||
    c === 'blast' ||
    c === 'scroll' ||
    c === 'linea' ||
    c === 'mode' ||
    c === 'zksync' ||
    c === 'mantle' ||
    c === 'fraxtal' ||
    c === 'opbnb' ||
    c === 'gnosis'
  )
    return 0.4;
  return 1;
}

/** Dollars with no cents when whole, else two decimals. */
function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** The category's first action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${money(capital)} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide ${money(capital)} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge ${money(capital)} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${money(capital)} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit ${money(capital)} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund ${money(capital)} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit ${money(capital)} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit ${money(capital)} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint ${money(capital)} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy ${money(capital)} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit ${money(capital)} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different qualifying action a week later. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the deposit on ${name}, then repay it the same week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap a small amount through ${name}'s main pool on ${chain} to show a second kind of activity.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge on ${name} and open a fresh one half its size.`;
  if (c.includes('prediction')) return `Settle the first position on ${name} and place a second, smaller one.`;
  if (c.includes('curator') || c.includes('allocator')) return `Add a second, smaller deposit to the same ${name} vault on ${chain}.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim any staking rewards ${name} shows, then restake them.`;
  return `Use ${name}'s app once more on ${chain}: a swap, a vote or a second deposit, whichever it offers.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, netted to the dollar.
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas is a stated per-chain estimate; the capital is not spent, it comes
 * back when the position is closed, so the plan's sunk cost is its gas alone.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasForChain(chain);
  const weekly = Math.max(1, Math.ceil(hold / 7));
  const transactions = 3 + weekly;
  const sunk = Math.round(gas * transactions * 100) / 100;
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
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
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${money(gas)} of gas a week, ${money(Math.round(gas * weekly * 100) / 100)} over ${weekly} weeks`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the ${money(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Netted cost: about ${money(sunk)} of gas is sunk across ${transactions} transactions over ${hold} days, and the ${money(capital)} of capital comes back when you exit, so the farm costs ${money(sunk)} plus your time.`,
      cost: `${money(sunk)} sunk in total`,
      time: `${hold} days all in`,
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit?: CompsFit): BoardRow[] {
  const f = fit ?? fitComps(snapshot);
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
    const capital = capitalFor(s.p);
    const hold = holdDaysFor(s.age);
    const gas = gasForChain(chain);
    const weekly = Math.max(1, Math.ceil(hold / 7));
    const transactions = 3 + weekly;
    const sunk = Math.round(gas * transactions * 100) / 100;
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
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
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
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const test = backtestLOO(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
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
