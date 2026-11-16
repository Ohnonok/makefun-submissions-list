import { ROUND } from '../core/config.js';
import { dist2D, angleLerp, segHitsAABB } from '../core/utils.js';
export const SOUND_RADIUS = {
shot: 34, step: 9, plant: 26, defuse: 20, reload: 7, explosion: 60, bounce: 12, override: 20,
};
export const WALL_DAMPEN = 0.35;
export const HEAR_WINDOW = 0.5;
const MAX_EVENTS = 16;
export function createHearing() {
const bus = { events: [], head: 0 };
for (let i = 0; i < MAX_EVENTS; i++) {
bus.events.push({ type: '', x: 0, z: 0, radius: 0, t: -100 });
}
return bus;
}
export function emitSound(bus, type, x, z, now) {
const e = bus.events[bus.head];
bus.head = (bus.head + 1) % MAX_EVENTS;
e.type = type;
e.x = x;
e.z = z;
e.radius = SOUND_RADIUS[type] || 10;
e.t = now;
}
export function segmentHitsBox(ax, az, bx, bz, c) { return segHitsAABB(ax, 0, az, bx, 0, bz, c); }
function heardRadius(e, bot, cols) {
for (let i = 0; i < cols.length; i++) { if (segmentHitsBox(bot.x, bot.z, e.x, e.z, cols[i])) return e.radius * WALL_DAMPEN; }
return e.radius;
}
export function segmentThroughSmoke(ax, az, bx, bz, smokes, now) {
for (let i = 0; i < smokes.length; i++) {
const s = smokes[i];
if (now > s.until) continue;
const dx = bx - ax, dz = bz - az;
const len2 = dx * dx + dz * dz;
let t = len2 === 0 ? 0 : ((s.x - ax) * dx + (s.z - az) * dz) / len2;
if (t < 0) t = 0;
else if (t > 1) t = 1;
const px = ax + dx * t - s.x, pz = az + dz * t - s.z;
if (px * px + pz * pz < s.r * s.r) return true;
}
return false;
}
export function updateHearing(bus, bot, cols, smokes, state, dt) {
if (!bot.alive) return;
if (state.phase !== 'live' && state.phase !== 'planted') return;
const now = ROUND.roundTime - state.timeLeft;
let best = null, bestLoud = 0, bestSmoke = false;
for (let i = 0; i < MAX_EVENTS; i++) {
const e = bus.events[i];
if (now - e.t > HEAR_WINDOW || e.t < 0) continue;
const r = heardRadius(e, bot, cols);
const d = dist2D(bot.x, bot.z, e.x, e.z);
if (d > r) continue;
const loud = 1 - d / r;
if (loud > bestLoud) {
bestLoud = loud;
best = e;
bestSmoke = segmentThroughSmoke(bot.x, bot.z, e.x, e.z, smokes, now);
}
}
if (!best) return;
bot.heardYaw = Math.atan2(-(best.x - bot.x), -(best.z - bot.z));
bot.heardType = best.type;
bot.heardThroughSmoke = bestSmoke;
bot.alertUntil = now + 1.2;
bot.yaw = angleLerp(bot.yaw, bot.heardYaw, Math.min(1, dt * 6));
}
