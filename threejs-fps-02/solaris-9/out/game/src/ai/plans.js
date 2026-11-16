import { ROUND } from '../core/config.js';
import { makeRng } from '../core/rng.js';
export const PLANS = [
{ id: 'a-rush', nm: 'A-rush', si: 'A', radio: 'Plan: A-rush — hit the Golden Dome, fast.', lanes: ['A', 'A', 'A', 'M', 'A'] },
{ id: 'a-split', nm: 'A-split', si: 'A', radio: 'Plan: A-split — Dome from two sides.', lanes: ['A', 'A', 'M', 'M', 'AF'] },
{ id: 'b-rush', nm: 'B-rush', si: 'B', radio: 'Plan: B-rush — hit Monolith.', lanes: ['B', 'B', 'B', 'M', 'B'] },
{ id: 'b-split', nm: 'B-split', si: 'B', radio: 'Plan: B-split — Monolith from two sides.', lanes: ['B', 'B', 'M', 'M', 'BF'] },
{ id: 'mid-fake', nm: 'mid-fake', si: 'B', radio: 'Plan: mid-fake — noise Mid, hit Monolith.', lanes: ['M', 'M', 'A', 'B', 'BF'] },
];
const OTHER = { solaris: 'voidborne', voidborne: 'solaris' };
const W = [0, 0, 0, 0, 0];
export function planRng(state) { return makeRng(state.seed * 31 + state.round); }
export function lanePoints(key, mp, tm) {
const A = mp.sites.A, B = mp.sites.B;
const flip = tm === 'voidborne' ? -1 : 1;
const z = (v) => v * flip;
const pts = [];
if (key === 'A') {
pts.push({ x: -16, z: z(14) }, { x: A.x - 2, z: z(8) }, { x: A.x - 2, z: z(2) }, { x: A.x, z: A.z });
} else if (key === 'B') {
pts.push({ x: 16, z: z(14) }, { x: B.x + 2, z: z(8) }, { x: B.x + 2, z: z(2) }, { x: B.x, z: B.z });
} else if (key === 'M') {
pts.push({ x: 0, z: z(14) }, { x: 0, z: z(6) }, { x: 0, z: z(0) });
} else if (key === 'AF') {
pts.push({ x: -28, z: z(14) }, { x: -30, z: z(0) }, { x: -28, z: z(-8) }, { x: A.x, z: A.z - 4 * flip });
} else {
pts.push({ x: 28, z: z(14) }, { x: 30, z: z(0) }, { x: 28, z: z(-8) }, { x: B.x, z: B.z - 4 * flip });
}
return pts;
}
export function laneWaypoints(key, mp, tm, siteId) {
const wps = lanePoints(key, mp, tm);
if (key === 'M') wps.push({ x: mp.sites[siteId].x, z: mp.sites[siteId].z });
return wps;
}
export function pickPlan(state, rng, tm) {
const diff = state.score[tm] - state.score[OTHER[tm]];
const late = state.round >= ROUND.maxRounds - 1;
W[0] = 3; W[1] = 2; W[2] = 3; W[3] = 2; W[4] = 2;
if (diff <= -2 || late) { W[0] += 2; W[2] += 2; W[4] -= 1; }
if (diff >= 2) { W[1] += 1; W[3] += 1; W[4] += 1; }
let total = 0;
for (let i = 0; i < 5; i++) total += W[i];
let roll = rng.next() * total;
for (let i = 0; i < 5; i++) {
roll -= W[i];
if (roll <= 0) return PLANS[i];
}
return PLANS[2];
}
export function applyPlan(state, mp, tm, rng) {
const plan = pickPlan(state, rng, tm);
const spawn = mp.spawns[tm];
let slot = 0;
for (let i = 0; i < state.plrs.length; i++) {
const p = state.plrs[i];
if (!p.isBot || p.tm !== tm || !p.alive) continue;
const key = plan.lanes[slot % 5];
const wps = laneWaypoints(key, mp, tm, plan.si);
const s = spawn[slot % spawn.length];
p.waypoints = [{ x: s[0], z: s[1] }].concat(wps);
p.wpIndex = 0;
p.planLane = key;
p.planSite = plan.si;
p.state = 'move';
slot++;
}
if (tm === 'solaris') state.plan = plan.nm;
announcePlan(state, plan);
return plan;
}
export function announcePlan(state, plan) { if (Array.isArray(state.radioLog)) state.radioLog.push(plan.radio); }
