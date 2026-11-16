// btc-cent-forecast-01: walk-forward LAD-ridge median BTC forecaster, shrunk,
// with mean-reversion (480-min demeaned-shape k-NN).
//
// Forecast: the price 240 minutes after the checkpoint, from the 4,320
// one-minute closes up to it. The score is the mean absolute error in cents,
// so the honest point forecast is the conditional MEDIAN of the 240-minute
// move, and every component below is median-based and shrunk toward
// persistence (no move), because BTC's 4h moves are heavy-tailed and the
// raw model outputs overshoot.
//
// Components (all predict the 240-minute log-return, then combined):
//   A. LAD-ridge: ridge regression (lambda 10) of the 240-min forward
//      log-return on 12 features (past returns at 5/15/60/240/480/720/1440
//      min, deviations from the 240/480/1440-min means, 60/240-min realized
//      volatility), fitted walk-forward on the case's own history
//      (samples t in [1440, tau-240]), with 3 IRLS reweighting passes so
//      the fit is least-absolute-deviation (median-seeking) rather than
//      least-squares.
//   B. k-NN shape, k=30: the last 480 minutes of log-prices, demeaned,
//      matched by Euclidean distance against every 480-min window in the
//      case whose 240-min forward return is known; the median of the 30
//      nearest neighbours' forward returns.
//   C. Same k-NN with k=50.
// Forecast log-return = 0.6 * median(A, B, C), capped at +-0.03.
// Price = last close * exp(forecast), on the 5-decimal grid.
//
// Node 22, standard library only, no network, deterministic: no randomness,
// no clock, no environment-dependent order (files sorted, distance ties
// broken by index). Runs in well under a second per case.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const MIN_PRICE = 0.00001;
const MAX_PRICE = 9_999_999.99999;

const HORIZON = 240;
const LAMBDA = 10;
const SHRINK = 0.6;
const CAP = 0.03;
const KNN_W = 480;
const KNN_MIN_T = 1440 + KNN_W; // earliest candidate end index

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

const price5 = (x: number): number =>
  Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

const median3 = (a: number, b: number, c: number): number => {
  // median of three, branch-free-ish and exact.
  if ((a - b) * (c - a) >= 0) return a;
  if ((b - a) * (c - b) >= 0) return b;
  return c;
};

/** Solve A x = b (small dense system) by Gaussian elimination with pivoting. */
function solve(Ain: number[][], b: number[]): number[] {
  const n = b.length;
  const A = Ain.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) {
      const tmp = A[piv];
      A[piv] = A[col];
      A[col] = tmp;
    }
    const d = A[col][col];
    if (d === 0) continue;
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / d;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) A[r][k] -= f * A[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = A[r][r] === 0 ? 0 : s / A[r][r];
  }
  return x;
}

interface RidgeModel {
  w: number[];
  mu: number[];
  sd: number[];
  ym: number;
}

function ridgeFit(X: number[][], y: number[], lam: number, weights?: number[]): RidgeModel {
  const n = X.length;
  const p = X[0].length;
  const mu = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(0);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    mu[j] = s / n;
  }
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i][j] - mu[j];
      s += d * d;
    }
    sd[j] = Math.sqrt(s / n) || 1;
  }
  let ym = 0;
  if (weights) {
    let sw = 0;
    for (let i = 0; i < n; i++) {
      ym += weights[i] * y[i];
      sw += weights[i];
    }
    ym /= sw;
  } else {
    for (let i = 0; i < n; i++) ym += y[i];
    ym /= n;
  }
  // Normal equations on standardized, (weighted) features.
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const b = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = weights ? Math.sqrt(weights[i]) : 1;
    const yc = (y[i] - ym) * wi;
    for (let j = 0; j < p; j++) {
      const xj = ((X[i][j] - mu[j]) / sd[j]) * wi;
      b[j] += xj * yc;
      for (let k = j; k < p; k++) {
        const xk = ((X[i][k] - mu[k]) / sd[k]) * wi;
        A[j][k] += xj * xk;
      }
    }
  }
  for (let j = 0; j < p; j++) {
    A[j][j] += lam;
    for (let k = j + 1; k < p; k++) A[k][j] = A[j][k];
  }
  return { w: solve(A, b), mu, sd, ym };
}

const ridgePred = (m: RidgeModel, x: number[]): number => {
  let s = m.ym;
  for (let j = 0; j < m.w.length; j++) s += m.w[j] * ((x[j] - m.mu[j]) / m.sd[j]);
  return s;
};

/** LAD-ridge: ridge, then 3 IRLS passes reweighting by 1/max(|resid|, delta). */
function ladRidge(X: number[][], y: number[], lam: number): RidgeModel {
  let m = ridgeFit(X, y, lam);
  for (let it = 0; it < 3; it++) {
    const res = new Array<number>(X.length);
    for (let i = 0; i < X.length; i++) res[i] = Math.abs(y[i] - ridgePred(m, X[i]));
    const sorted = [...res].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const delta = Math.max(med * 1.4826 * 0.5, 1e-6);
    const wgt = res.map((r) => 1 / Math.max(r, delta));
    m = ridgeFit(X, y, lam, wgt);
  }
  return m;
}

/** The 12 features at index t of log-price array lp, using prefix sums. */
function makeFeatures(lp: number[], pre: number[], pre2: number[], dPre: number[], dPre2: number[]) {
  const mean = (a: number, b: number): number => (pre[b + 1] - pre[a]) / (b - a + 1); // lp[a..b]
  const vol = (a: number, b: number): number => {
    // std of 1-min diffs d[a..b], d[i] = lp[i] - lp[i-1]
    const cnt = b - a + 1;
    const s = dPre[b + 1] - dPre[a];
    const s2 = dPre2[b + 1] - dPre2[a];
    const m = s / cnt;
    const v = s2 / cnt - m * m;
    return Math.sqrt(v > 0 ? v : 0);
  };
  return (t: number): number[] => {
    const r = (h: number): number => lp[t] - lp[t - h];
    const ma = (h: number): number => lp[t] - mean(t - h, t - 1);
    return [
      r(5), r(15), r(60), r(240), r(480), r(720), r(1440),
      ma(240), ma(480), ma(1440),
      vol(t - 59, t), vol(t - 239, t),
    ];
  };
}

function forecast(prices: number[]): number {
  const n = prices.length;
  const last = prices[n - 1];
  // Fallback: not enough history for the model (should not happen: 4,320).
  if (n < 2000 || !Number.isFinite(last)) return price5(last);
  const lp = prices.map((p) => Math.log(p));
  for (let i = 0; i < n; i++) if (!Number.isFinite(lp[i]) || lp[i] <= 0) return price5(last);
  const tau = n - 1;

  // Prefix sums of lp, lp^2, and of 1-min diffs d, d^2.
  const pre = new Array<number>(n + 1).fill(0);
  const pre2 = new Array<number>(n + 1).fill(0);
  const dPre = new Array<number>(n + 1).fill(0);
  const dPre2 = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    pre[i + 1] = pre[i] + lp[i];
    pre2[i + 1] = pre2[i] + lp[i] * lp[i];
    const d = i === 0 ? 0 : lp[i] - lp[i - 1];
    dPre[i + 1] = dPre[i] + d;
    dPre2[i + 1] = dPre2[i] + d * d;
  }
  const feat = makeFeatures(lp, pre, pre2, dPre, dPre2);

  // --- Component A: LAD-ridge on samples t in [1440, tau-240]. ---
  const tEnd = tau - HORIZON;
  const rows: number[][] = [];
  const ys: number[] = [];
  for (let t = 1440; t <= tEnd; t++) {
    rows.push(feat(t));
    ys.push(lp[t + HORIZON] - lp[t]);
  }
  const model = ladRidge(rows, ys, LAMBDA);
  const compA = ridgePred(model, feat(tau));

  // --- Components B/C: 480-min demeaned-shape k-NN, k=30 and k=50. ---
  const W = KNN_W;
  const shape = new Array<number>(W);
  let sMean = 0;
  for (let i = 0; i < W; i++) sMean += lp[tau - W + 1 + i];
  sMean /= W;
  for (let i = 0; i < W; i++) shape[i] = lp[tau - W + 1 + i] - sMean;
  // Distances to every candidate window, then one sort serves both k.
  const scored: Array<{ d: number; fwd: number; t: number }> = [];
  for (let t = KNN_MIN_T; t <= tEnd; t++) {
    // Candidate window's mean via the prefix sums (same value as the
    // explicit loop, ~480x fewer operations per candidate).
    const m = (pre[t + 1] - pre[t - W + 1]) / W;
    let dist = 0;
    for (let i = 0; i < W; i++) {
      const dd = lp[t - W + 1 + i] - m - shape[i];
      dist += dd * dd;
    }
    scored.push({ d: dist, fwd: lp[t + HORIZON] - lp[t], t });
  }
  scored.sort((a, b) => (a.d - b.d) || (a.t - b.t));
  const medOf = (k: number): number => {
    const vals = scored.slice(0, k).map((s) => s.fwd).sort((a, b) => a - b);
    const m = vals.length;
    return m % 2 === 1 ? vals[(m - 1) / 2] : (vals[m / 2 - 1] + vals[m / 2]) / 2;
  };
  const compB = medOf(30);
  const compC = medOf(50);

  // Median of the three components, shrunk toward persistence, capped.
  let d = SHRINK * median3(compA, compB, compC);
  if (d > CAP) d = CAP;
  if (d < -CAP) d = -CAP;
  return price5(last * Math.exp(d));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  const m = c.markets[0] as CaseMarket;
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  writeFileSync(
    join(OUTPUT_DIR, `${id}.out`),
    `${JSON.stringify({ forecasts: [{ case: id, price: forecast(m.prices) }] })}\n`,
  );
}
