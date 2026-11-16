import { makeRng } from '../core/rng.js';
export const ORDERS = { 1: 'A-DOME SPLIT', 2: 'MID PYLON PUSH', 3: 'SITE B ANCHOR' };
export const ORDER_PLANS = {
1: { si: 'A', lanes: ['A', 'A', 'M', 'M', 'AF'] }, 2: { si: 'A', lanes: ['M', 'M', 'M', 'M', 'M'] },
3: { si: 'B', lanes: ['B', 'B', 'M', 'M', 'BF'] },
};
let _current = 1;
export function pickOrder(state) {
const seed = (state && state.seed) || 7;
const round = (state && state.round) || 1;
return makeRng(seed * 31 + round * 7).int(1, 3);
}
export function applyOrder(state, order) {
const id = ORDERS[order] ? order : 1;
_current = id;
if (state) state.squadOrder = id;
return { id, nm: ORDERS[id], si: ORDER_PLANS[id].si, lanes: ORDER_PLANS[id].lanes };
}
