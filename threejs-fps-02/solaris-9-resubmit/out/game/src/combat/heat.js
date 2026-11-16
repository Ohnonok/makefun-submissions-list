export const HEAT_PER_SHOT = { pistol: 4, smg: 3, rifle: 6, marksman: 12, rail: 22 };
export const HEAT_COOL_RATE = 26;
export const HEAT_MAX = 100;
export const HEAT_REARM = 30;
export const VENT_TIME = 1.2;
export const GOLD_ZONE_MIN = 70;
export const GOLD_ZONE_MAX = 90;
export const HYPER_VELOCITY_SECS = 3;
export const HYPER_DMG_MULT = 1.5;
export const GOLD_TRACER = 0xf4d35e;
export function mkHeat(wId) {
return { wId: wId || 'rifle', heat: 0, overheated: false, venting: 0, lockout: 0, clock: 0, hvUntil: 0 };
}
export function getShooterHeat(s, wid) {
if (!s) return null;
wid = wid || s.wId || 'rifle';
let h = s.heat;
if (!h || h.wId !== wid) {
const o = h;
h = mkHeat(wid);
if (o) { h.clock = o.clock || 0; h.hvUntil = o.hvUntil || 0; }
s.heat = h;
}
return h;
}
export function addHeat(h, n) {
if (!h) return 0;
const gain = typeof n === 'number' ? n : (HEAT_PER_SHOT[h.wId] || 6);
h.heat = Math.min(HEAT_MAX, h.heat + gain);
if (h.heat >= HEAT_MAX) h.overheated = true;
return h.heat;
}
export function updateHeat(h, dt) {
if (!h) return;
h.clock = (h.clock || 0) + dt;
if (h.lockout > 0) h.lockout = Math.max(0, h.lockout - dt);
if (h.venting > 0) { h.venting = Math.max(0, h.venting - dt); return; }
if (h.heat > 0) h.heat = Math.max(0, h.heat - HEAT_COOL_RATE * dt);
if (h.overheated && h.heat <= HEAT_REARM) h.overheated = false;
}
function nowOf(s) {
if (s && typeof s.time === 'number') return s.time;
const h = s && s.heat;
return h ? (h.clock || 0) : 0;
}
export function ventH(h, now) {
if (!h || h.venting > 0 || h.lockout > 0) return false;
let t = h.clock || 0;
if (typeof now === 'number') t = now;
else if (now && typeof now === 'object') t = nowOf(now);
const gold = h.heat >= GOLD_ZONE_MIN && h.heat <= GOLD_ZONE_MAX;
h.heat = 0;
h.overheated = false;
h.venting = VENT_TIME;
h.lockout = VENT_TIME;
h.hvUntil = gold ? t + HYPER_VELOCITY_SECS : 0;
if (now && typeof now === 'object') now.hvUntil = h.hvUntil;
return true;
}
export function isHyperVelocity(state, shooter) {
if (!state) return false;
const t = nowOf(state);
if (shooter && typeof shooter === 'object') {
const h = getShooterHeat(shooter, shooter.wId || 'rifle');
const u = (h && h.hvUntil) || 0;
return u > 0 && t < u;
}
const h = state.heat;
const u = state.hvUntil || (h && h.hvUntil) || 0;
return u > 0 && t < u;
}
export function isOverheated(h) { return !!h && (h.overheated || h.venting > 0 || h.lockout > 0); }
