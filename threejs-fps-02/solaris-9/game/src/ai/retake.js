import { ROUND } from '../core/config.js';
import { dist2D } from '../core/utils.js';
const CLEAR_RADIUS = 14;
const DEFUSE_RANGE = 1.4;
const COVER_RANGE = 8;
export function createRetake() {
return { active: false, si: null, dfu: null, covers: [], phase: 'idle', startedAt: 0 };
}
function steerTo(bot, x, z) {
const t = bot.moveTarget;
if (!t) return;
t.x = x;
t.z = z;
t.active = true;
}
function siteClear(state, si, tm) {
for (let i = 0; i < state.plrs.length; i++) {
const p = state.plrs[i];
if (!p.alive || p.tm === tm) continue;
if (dist2D(p.x, p.z, si.x, si.z) < CLEAR_RADIUS) return false;
}
return true;
}
export function startRetake(state, mp, retake, bots, siteId) {
const si = mp.sites[siteId];
let dfu = null, bestScore = 1e9;
for (let i = 0; i < bots.length; i++) {
const b = bots[i];
if (!b.alive) continue;
const score = dist2D(b.x, b.z, si.x, si.z) - (b.hasKit ? 20 : 0);
if (score < bestScore) { bestScore = score; dfu = b; }
}
if (!dfu) return false;
retake.active = true;
retake.si = siteId;
retake.dfu = dfu;
retake.covers.length = 0;
for (let i = 0; i < bots.length; i++) {
const b = bots[i];
if (!b.alive || b === dfu) continue;
retake.covers.push(b);
if (retake.covers.length >= 2) break;
}
retake.phase = 'rotating';
retake.startedAt = ROUND.roundTime - state.timeLeft;
dfu.state = 'retake';
dfu.defuseT = 0;
dfu.isDefusing = false;
for (let i = 0; i < retake.covers.length; i++) retake.covers[i].state = 'retake-cover';
return true;
}
function promoteDefuser(mp, retake) {
const si = mp.sites[retake.si];
let next = null, bestD = 1e9;
for (let i = 0; i < retake.covers.length; i++) {
const c = retake.covers[i];
if (!c.alive) continue;
const d = dist2D(c.x, c.z, si.x, si.z);
if (d < bestD) { bestD = d; next = c; }
}
if (!next) return false;
retake.dfu = next;
retake.covers.splice(retake.covers.indexOf(next), 1);
next.state = 'retake';
next.defuseT = 0;
next.isDefusing = false;
return true;
}
export function stopRetake(retake) {
retake.active = false;
retake.phase = 'idle';
if (retake.dfu && retake.dfu.moveTarget) retake.dfu.moveTarget.active = false;
for (let i = 0; i < retake.covers.length; i++) {
const c = retake.covers[i];
if (c.moveTarget) c.moveTarget.active = false;
}
}
export function updateRetake(state, mp, retake, dt) {
if (!retake.active) return 'idle';
const bm = state.bm;
if (!bm || bm.state !== 'planted') { stopRetake(retake); return 'idle'; }
const si = mp.sites[retake.si];
if (!retake.dfu || !retake.dfu.alive) {
if (!promoteDefuser(mp, retake)) { stopRetake(retake); return 'idle'; }
}
const dfu = retake.dfu;
const dist = dist2D(dfu.x, dfu.z, si.x, si.z);
const clear = siteClear(state, si, dfu.tm);
const need = dfu.hasKit ? ROUND.defuseKitTime : ROUND.defuseTime;
if (dist > DEFUSE_RANGE) {
dfu.isDefusing = false;
dfu.defuseT = 0;
retake.phase = 'rotating';
steerTo(dfu, si.x, si.z);
for (let i = 0; i < retake.covers.length; i++) {
const c = retake.covers[i];
if (!c.alive) continue;
const ang = i === 0 ? 0.9 : -0.9;
steerTo(c, si.x + Math.sin(ang) * COVER_RANGE, si.z + Math.cos(ang) * COVER_RANGE);
}
} else if (!clear) {
dfu.isDefusing = false;
dfu.defuseT = 0;
retake.phase = 'clearing';
} else {
dfu.isDefusing = true;
dfu.defuseT += dt;
retake.phase = 'defusing';
if (dfu.defuseT >= need) {
stopRetake(retake);
retake.phase = 'done';
dfu.isDefusing = false;
return 'done';
}
}
return retake.phase;
}
