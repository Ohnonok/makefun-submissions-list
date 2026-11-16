import * as THREE from 'three';
import { MAP, ROUND } from '../core/config.js';
import { makeRng } from '../core/rng.js';
import { dist2D, losBlocked } from '../core/utils.js';
import { getWpn } from '../combat/weapons.js';
import { buildHum } from '../entities/humanoid.js';
import { moveBody, resolveCircle } from '../core/movement.js';
import { ballistics } from '../combat/ballistics.js';
import { applyPlan, planRng, laneWaypoints } from './plans.js';
import { ORDER_PLANS, ORDERS } from './squad-orders.js';
import { createHearing, updateHearing, emitSound } from './hearing.js';
import { assignRoles, updateRole } from './roles.js';
import { createRetake, startRetake, updateRetake } from './retake.js';
const _scratchDir = new THREE.Vector3();
const _tmpVec1 = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
const BOT_RADIUS = 0.35, FOV_DOT = 0.643, TURN_RATE = 6, EYE = 1.55, HEAD_Y = 1.52;
const NAMES = { solaris: ['NOVA', 'HELIX', 'ORION', 'VEGA'], voidborne: ['UMBRA', 'NULL', 'HEX', 'VEX', 'NOCT'] };
const BOTS = [];
const _bus = createHearing();
const _retakes = { solaris: createRetake(), voidborne: createRetake() };
const _enemies = [];
const _noCol = [];
const _fbMap = { sites: { A: MAP.siteA, B: MAP.siteB }, spawns: null, cols: _noCol };
let _setupRound = 0;
const _setupDone = {};
let _retakeStamp = -1, _droneStamp = -1;
const _droneSeen = {};
function teamBots(tm) {
const out = [];
for (let i = 0; i < BOTS.length; i++) if (BOTS[i].tm === tm) out.push(BOTS[i]);
return out;
}
function turnToward(b, want, dt) {
let dy = want - b.yaw;
dy = ((dy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const s = TURN_RATE * dt;
b.yaw += dy > s ? s : dy < -s ? -s : dy;
return dy;
}
function syncRec(b) {
const r = b._rec;
if (!r) return;
r.x = b.pos.x; r.z = b.pos.z; r.yaw = b.yaw; r.pitch = b.pitch; r.pos = b.pos;
r.hp = Math.max(0, Math.round(b.hp)); r.armor = Math.max(0, Math.round(b.armor || 0));
r.alive = b.alive; r.cash = b.cash;
r.kills = b.kills || 0; r.deaths = b.deaths || 0; r.headshots = b.headshots || 0;
r.damage = Math.round(b.damageDealt || 0);
}
function setupTeam(b, s, mp) {
if (!mp || !mp.spawns || !mp.sites) return;
if (s.round !== _setupRound) { _setupRound = s.round; for (const k in _setupDone) delete _setupDone[k]; }
if (_setupDone[b.tm]) return;
_setupDone[b.tm] = 1;
const plan = applyPlan({ seed: s.seed, round: s.round, score: s.score, plrs: BOTS, radioLog: s.radioLog }, mp, b.tm, planRng(s));
const mates = teamBots(b.tm), sp = mp.spawns[b.tm];
const soId = s.squadOrder || 1;
const so = ORDER_PLANS[soId];
if (so) {
for (let i = 0; i < mates.length; i++) {
const m = mates[i], key = so.lanes[i % 5], s0 = sp[i % sp.length];
m.waypoints = [{ x: s0[0], z: s0[1] }].concat(laneWaypoints(key, mp, b.tm, so.si));
m.wpIndex = 0; m.planLane = key; m.planSite = so.si;
}
if (Array.isArray(s.radioLog)) s.radioLog.push('Order: ' + ORDERS[soId]);
}
s.plan = ORDERS[soId] || plan.nm;
assignRoles(mates, plan, mp);
}
function droneScan(s, now, dt) {
const drones = s.drones;
if (!drones) return;
const stamp = s.round * 100000 + ((now * 60) | 0);
if (_droneStamp === stamp) return;
_droneStamp = stamp;
for (let i = 0; i < drones.length; i++) {
const d = drones[i];
if (!d || d.alive === false) continue;
const key = d.id ?? ('d' + i);
const ov = d.tm === 'solaris' && (d.overrideT > 0 || d.overriddenUntil > now);
if (ov && _droneSeen[key] !== 'solaris') {
let nb = null, nd = 1e9;
for (let j = 0; j < BOTS.length; j++) {
const eb = BOTS[j];
if (eb.alive && eb.tm !== 'solaris') {
const dd = dist2D(eb.pos.x, eb.pos.z, d.pos.x, d.pos.z);
if (dd < nd) { nd = dd; nb = eb; }
}
}
if (nb) {
nb.heardYaw = Math.atan2(-(d.pos.x - nb.pos.x), -(d.pos.z - nb.pos.z));
nb.heardType = 'override'; nb.alertUntil = now + 1.2;
turnToward(nb, nb.heardYaw, dt);
}
emitSound(_bus, 'override', d.pos.x, d.pos.z, now);
}
_droneSeen[key] = d.tm;
}
}
function pickTarget(b, s, col, smokes, now) {
_enemies.length = 0;
for (let i = 0; i < BOTS.length; i++) { const e = BOTS[i]; if (e.tm !== b.tm && e.alive) _enemies.push(e); }
const pl = s.player;
if (pl && pl.pos && pl.tm && pl.tm !== b.tm && pl.alive !== false) _enemies.push(pl);
const drones = s.drones;
if (drones) for (let i = 0; i < drones.length; i++) {
const d = drones[i];
if (d && d.alive !== false && (d.tm === 'solaris') !== (b.tm === 'solaris')) _enemies.push(d);
}
const w = getWpn(b.wId);
let best = null, bestD = 1e9;
for (let i = 0; i < _enemies.length; i++) {
const e = _enemies[i];
if (e === b || !e.alive) continue;
const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
const d = Math.hypot(dx, dz);
if (d > w.range || d < 0.5 || d >= bestD) continue;
const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
if ((fx * dx + fz * dz) / d < FOV_DOT) continue;
if (losBlocked(b.pos.x, EYE, b.pos.z, e.pos.x, e.pos.y + (e.headHeight || HEAD_Y), e.pos.z, col, smokes)) continue;
best = e; bestD = d;
}
if (best) {
if (best !== b.target) b.reaction = 0.25 + b.rng.next() * 0.35;
b.target = best; b.mode = 'engage';
b.aimError = 0.02 + bestD * 0.0016;
}
return best;
}
export function mkBot(tm, idx, opts) {
const o = opts || {};
const slot = typeof idx === 'number' ? idx : 0;
const nm = o.nm || (NAMES[tm] && NAMES[tm][slot]) || 'BOT-' + slot;
const sp0 = tm === 'solaris' ? MAP.spawnSolaris : MAP.spawnVoidborne;
const spawn = o.spawn || [sp0.x + (slot - 2) * 1.6, sp0.z];
const seed = o.seed ?? ((tm === 'solaris' ? 101 : 201) + slot * 77);
const humanoid = buildHum(tm, nm);
humanoid.group.position.set(spawn[0], 0, spawn[1]);
const b = {
isBot: true, id: tm === 'solaris' ? 1 + slot : 5 + slot, tm, nm, seed,
humanoid, group: humanoid.group, pos: humanoid.group.position,
vel: new THREE.Vector3(), x: spawn[0], z: spawn[1], yaw: o.yaw || 0, hp: 100, maxHp: 100, alive: true,
weapons: {}, wId: o.wId || 'rifle', lastShot: -9, reloading: false, reloadUntil: 0,
mode: 'move', waypoints: [], wpIndex: 0, moveTarget: { x: 0, z: 0, active: false },
reaction: 0, aimError: 0, fireTimer: 0, burstLeft: 0, burstPause: 0,
stuckTimer: 0, walkPhase: 0, rng: makeRng(seed), _stepT: 0,
};
const w0 = getWpn(b.wId);
b.weapons[b.wId] = { mag: w0.mag, reserve: w0.reserve };
b.weapon = () => getWpn(b.wId);
b.ammo = () => b.weapons[b.wId];
b.setHp = () => { humanoid.setHp(Math.max(0, b.hp / b.maxHp)); };
b.tryFire = (now) => {
const w = b.weapon(), a = b.ammo();
if (!b.alive || b.reloading || now - b.lastShot < w.interval) return false;
if (a.mag <= 0) { b.startReload(now); return false; }
a.mag -= 1; b.lastShot = now; return true;
};
b.startReload = (now) => {
const a = b.ammo(), w = b.weapon();
if (b.reloading || a.mag >= w.mag || a.reserve <= 0) return false;
b.reloading = true; b.reloadUntil = now + w.reloadTime; return true;
};
BOTS.push(b);
return b;
}
export function updateBot(b, s, dt) {
if (!b || !s) return;
const now = ROUND.roundTime - s.timeLeft;
if (!b._rec && s.plrs) {
for (let i = 0; i < s.plrs.length; i++) if (s.plrs[i].id === b.id) { b._rec = s.plrs[i]; break; }
}
if (b._rec) b.cash = b._rec.cash;
if (b._round !== s.round) {
b._round = s.round;
const p = b._rec ? [b._rec.x, b._rec.z] : [b.pos.x, b.pos.z];
b.pos.set(p[0], 0, p[1]); b.vel.set(0, 0, 0);
b.hp = b.maxHp; b.armor = 0; b.alive = true; b._dead = false;
b.target = null; b.mode = 'move'; b.state = 'move';
b.reaction = 0; b.burstLeft = 0; b.fireTimer = 0; b.reloading = false;
b.isDefusing = false; b.defuseT = 0; b.moveTarget.active = false;
if (b._rec) b.yaw = b._rec.yaw || 0;
b.group.rotation.set(0, b.yaw, 0); b.group.position.y = 0;
b.humanoid.hpBar.visible = true; b.humanoid.nameSprite.visible = true;
b.humanoid.setHp(1);
const w = getWpn(b.wId);
b.weapons[b.wId] = { mag: w.mag, reserve: w.reserve };
}
if (!b.alive) {
if (!b._dead) {
b._dead = true; b.target = null;
b.group.rotation.x = -Math.PI / 2; b.group.position.y = 0.25;
b.humanoid.hpBar.visible = false; b.humanoid.nameSprite.visible = false;
}
syncRec(b); return;
}
const mp = s.mp || s.world || _fbMap;
if (mp === _fbMap) { _fbMap.spawns = s.spawns || null; _fbMap.cols = s.cols || _noCol; }
const col = mp.cols || _noCol, smokes = s.smokes || _noCol;
if (s.phase !== 'live' && s.phase !== 'planted') { syncRec(b); return; }
if (b.reloading && now >= b.reloadUntil) {
const a = b.ammo(), w = b.weapon(), take = Math.min(w.mag - a.mag, a.reserve);
a.mag += take; a.reserve -= take; b.reloading = false;
}
setupTeam(b, s, mp);
updateHearing(_bus, b, col, smokes, s, dt);
droneScan(s, now, dt);
const bm = s.bm;
if (s.phase === 'planted' && bm && bm.state === 'planted' && bm.si) {
const c = s.plrs && bm.carrier >= 0 ? s.plrs[bm.carrier] : null;
if (c && c.tm && c.tm !== b.tm) {
const rt = _retakes[b.tm];
if (!rt.active) startRetake(s, mp, rt, teamBots(b.tm), bm.si);
const stamp = s.round * 100000 + ((now * 60) | 0);
if (rt.active && _retakeStamp !== stamp) { _retakeStamp = stamp; updateRetake(s, mp, rt, dt); }
}
}
updateRole(b, s, mp, dt);
pickTarget(b, s, col, smokes, now);
let wx = 0, wz = 0, ms = 4.4;
if (b.mode === 'engage' && b.target && b.target.alive) {
_scratchDir.copy(b.target.pos).sub(b.pos);
const d = Math.hypot(_scratchDir.x, _scratchDir.z);
const wy = Math.atan2(-_scratchDir.x, -_scratchDir.z);
const dy = turnToward(b, wy, dt);
b.pitch = Math.atan2((b.target.pos.y + 1.3) - (b.pos.y + EYE), Math.max(d, 0.5));
if (b.reaction > 0) b.reaction -= dt;
else if (Math.abs(dy) < 0.35 + b.aimError) {
b.fireTimer -= dt;
if (b.burstLeft <= 0) {
b.burstPause -= dt;
if (b.burstPause <= 0) { b.burstLeft = 3 + (b.rng.next() * 3 | 0); b.burstPause = 0.45 + b.rng.next() * 0.5; }
} else if (b.fireTimer <= 0) {
b.fireTimer = b.weapon().interval; b.burstLeft -= 1;
if (b.tryFire(now)) { ballistics.fireShot(s, b, _enemies); emitSound(_bus, 'shot', b.pos.x, b.pos.z, now); }
}
}
if (d > 26) { wx = _scratchDir.x / d; wz = _scratchDir.z / d; }
else if (d < 6) { wx = -_scratchDir.x / d; wz = -_scratchDir.z / d; }
else ms = 2;
} else {
b.target = null;
if (b.mode === 'engage') b.mode = 'move';
let dest = null;
if (!b.isDefusing) {
if (b.moveTarget.active) dest = b.moveTarget;
else if (b.mode === 'move' && b.waypoints.length) dest = b.waypoints[b.wpIndex % b.waypoints.length];
}
if (dest) {
_tmpVec1.set(dest.x - b.pos.x, 0, dest.z - b.pos.z);
const d = _tmpVec1.length();
if (d < 1.2 && dest !== b.moveTarget) b.wpIndex += 1;
else if (d > 0.6) { wx = _tmpVec1.x / d; wz = _tmpVec1.z / d; turnToward(b, Math.atan2(-_tmpVec1.x, -_tmpVec1.z), dt); }
} else if (b.mode === 'hold' && now >= b.holdUntil) b.mode = b.waypoints.length ? 'move' : 'hold';
if (now < b.holdUntil) { wx = 0; wz = 0; }
}
moveBody(b, wx, wz, dt, ms);
b.speed = Math.hypot(b.vel.x, b.vel.z);
resolveCircle(b.pos, BOT_RADIUS, col);
if (b.pos.x < MAP.minX) b.pos.x = MAP.minX;
if (b.pos.x > MAP.maxX) b.pos.x = MAP.maxX;
if (b.pos.z < MAP.minZ) b.pos.z = MAP.minZ;
if (b.pos.z > MAP.maxZ) b.pos.z = MAP.maxZ;
b.x = b.pos.x; b.z = b.pos.z;
b.stuckTimer += dt;
if (b.stuckTimer > 2) {
const moved = Math.abs(b.pos.x - b.lastX) + Math.abs(b.pos.z - b.lastZ);
if (moved < 0.3 && b.mode === 'move' && b.waypoints.length) b.wpIndex += 1;
b.lastX = b.pos.x; b.lastZ = b.pos.z; b.stuckTimer = 0;
}
b._stepT -= dt;
if (b.speed > 0.5 && b._stepT <= 0) { b._stepT = 0.4; emitSound(_bus, 'step', b.pos.x, b.pos.z, now); }
b.walkPhase += b.speed * dt * 1.6;
const swing = b.speed > 0.4 ? Math.sin(b.walkPhase) * 0.45 : 0;
b.humanoid.legL.rotation.x = swing;
b.humanoid.legR.rotation.x = -swing;
_tmpQuat.setFromAxisAngle(_UP, b.yaw);
b.group.quaternion.copy(_tmpQuat);
syncRec(b);
}
