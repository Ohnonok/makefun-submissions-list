import { ROUND } from '../core/config.js';
import { dist2D } from '../core/utils.js';
import { laneWaypoints } from './plans.js';
const LURK_PUSH_AFTER = 18;
const FLANK_PUSH_AFTER = 24;
export function assignRoles(bots, plan, mp) {
const order = plan && plan.id === 'mid-fake'
? ['entry', 'entry', 'support', 'flank', 'lurk']
: ['entry', 'entry', 'support', 'lurk', 'flank'];
const sorted = bots.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
for (let i = 0; i < sorted.length; i++) {
const b = sorted[i];
b.role = order[i % order.length];
b.roleState = 'push';
b.guardSlot = i % 2;
b.holdUntil = 0;
b.follow = null;
}
for (let i = 0; i < sorted.length; i++) {
const b = sorted[i];
if (b.role === 'lurk' || b.role === 'flank') {
b.roleState = 'stage';
const st = { x: 0, z: 0 };
flankStaging(b, st);
const si = mp.sites[b.planSite || plan.si];
b.waypoints = [st, { x: si.x, z: si.z }];
b.wpIndex = 0;
b.state = 'move';
}
}
const entry = sorted[0];
for (let i = 0; i < sorted.length; i++) { if (sorted[i].role === 'support') sorted[i].follow = entry; }
return sorted;
}
export function guardSpots(si, out) {
out[0].x = si.x - 7;
out[0].z = si.z + 5;
out[1].x = si.x + 7;
out[1].z = si.z + 5;
return out;
}
export function flankStaging(bot, out) {
const side = bot.planLane === 'BF' || bot.x > 0 ? 1 : -1;
out.x = 28 * side;
out.z = bot.tm === 'voidborne' ? -14 : 14;
return out;
}
function pushFromStaging(bot, mp) {
bot.roleState = 'push';
bot.waypoints = laneWaypoints(bot.planLane || 'M', mp, bot.tm, bot.planSite || 'A');
bot.wpIndex = 0;
bot.state = 'move';
}
function toGuard(bot, state, mp) {
bot.roleState = 'guard';
const si = mp.sites[(state.bm && state.bm.si) || bot.planSite || 'A'];
const spots = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
guardSpots(si, spots);
const pick = spots[bot.guardSlot || 0];
bot.waypoints = [pick];
bot.wpIndex = 0;
bot.state = 'move';
bot.guardSite = si;
}
export function updateRole(bot, state, mp, dt) {
if (!bot.alive) return;
const now = ROUND.roundTime - state.timeLeft;
const planted = state.phase === 'planted';
if (planted) {
if (bot.state !== 'retake' && bot.state !== 'retake-cover' && bot.roleState !== 'guard') toGuard(bot, state, mp);
return;
}
if (bot.roleState === 'guard') bot.roleState = 'push';
const pushAt = bot.role === 'lurk' ? LURK_PUSH_AFTER : bot.role === 'flank' ? FLANK_PUSH_AFTER : -1;
if (pushAt >= 0 && bot.roleState === 'stage' && now >= pushAt) pushFromStaging(bot, mp);
if (bot.role === 'support' && bot.follow) {
const e = bot.follow;
if (e.alive && dist2D(bot.x, bot.z, e.x, e.z) < 3) bot.holdUntil = now + 0.4;
}
}
