import * as THREE from 'three';
import { getWpn } from './weapons.js';
import { applyDamage } from './damage.js';
import { createSprayState, onShot, spreadAngle, spreadJitter } from './spray.js';
import { spawnTr, muzzleFlash } from './tracer.js';
import { checkHit, getPolarity } from './polarity.js';
import { isHyperVelocity, HYPER_DMG_MULT, GOLD_TRACER } from './heat.js';
const _scratchOrigin = new THREE.Vector3();
const _scratchDir = new THREE.Vector3();
const _scratchRay = new THREE.Raycaster();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _headC = new THREE.Vector3();
const _hitP = new THREE.Vector3();
const _rOrigin = new THREE.Vector3();
const _rDir = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _head = new THREE.Sphere(new THREE.Vector3(), 0.22);
const _box = new THREE.Box3();
const _jit = { x: 0, y: 0 };
_scratchRay.far = 120;
function eyeOf(s, out) {
if (s.eyePos) return out.copy(s.eyePos);
const p = s.pos || s.position;
if (p) return (out.copy(p), out.y += 1.55, out);
return out.set(0, 1.55, 0);
}
function aimOf(s, out) {
if (s.aimDir) return out.copy(s.aimDir).normalize();
const yaw = s.yaw || 0, pitch = s.pitch || 0;
out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
return out;
}
function headCenter(t, out) {
if (t.headPos) return out.copy(t.headPos);
if (t.head && t.head.getWorldPosition) return t.head.getWorldPosition(out);
const p = t.pos || t.position || (t.group && t.group.position) || _zero;
return (out.copy(p), out.y += t.headHeight ?? 1.52, out);
}
function bodyBox(t, out) {
if (t.bodyBox) return out.copy(t.bodyBox);
const p = t.pos || t.position || (t.group && t.group.position) || _zero;
const h = t.crouched ? 1 : (t.bodyHeight ?? 1.42);
out.min.set(p.x - 0.34, p.y, p.z - 0.34);
out.max.set(p.x + 0.34, p.y + h, p.z + 0.34);
return out;
}
function trace(state, s, list, origin, dir, start, w, flash) {
const col = state && (state.cols || (state.mp || state.world || {}).cols);
_scratchRay.set(origin, dir);
let wallD = Infinity;
if (col) {
for (const c of col) {
_box.min.set(c.minX, 0, c.minZ);
_box.max.set(c.maxX, c.h || 4, c.maxZ);
if (_scratchRay.ray.intersectBox(_box, _hitP)) {
const d = origin.distanceTo(_hitP);
if (d > 0.001 && d < wallD) wallD = d;
}
}
}
let best = null;
let bestDist = Infinity;
let bestPart = null;
if (list) {
for (let i = 0; i < list.length; i++) {
const t = list[i];
if (!t || t === s || t.alive === false) continue;
if (t.hp <= 0) continue;
if (s.tm && t.tm && t.tm === s.tm) continue;
headCenter(t, _headC);
_head.center.copy(_headC);
_head.radius = t.headRadius || 0.22;
if (_scratchRay.ray.intersectSphere(_head, _hitP)) {
const d = origin.distanceTo(_hitP);
if (d < bestDist && d < wallD) { best = t; bestDist = d; bestPart = 'head'; }
continue;
}
bodyBox(t, _box);
if (_scratchRay.ray.intersectBox(_box, _hitP)) {
const d = origin.distanceTo(_hitP);
if (d < bestDist && d < wallD) { best = t; bestDist = d; bestPart = 'body'; }
}
}
}
_end.copy(origin).addScaledVector(dir, best ? bestDist : Math.min(wallD, 60));
const hv = isHyperVelocity(state, s);
const tcol = hv ? GOLD_TRACER : w.accent;
spawnTr(start, _end, tcol);
if (flash) muzzleFlash(start, tcol);
if (w.id === 'rifle' || w.id === 'rail') {
_hitP.copy(start).addScaledVector(_right, 0.035);
_headC.copy(_end).addScaledVector(_right, 0.035);
spawnTr(_hitP, _headC, tcol);
}
if (!best) return null;
_hitP.copy(origin).addScaledVector(dir, bestDist);
const falloff = bestDist <= 25 ? 1 : Math.max(0.6, 1 - 0.4 * (bestDist - 25) / 25);
const pol = checkHit({ part: bestPart, target: best, point: _hitP }, getPolarity(state), state);
const res = applyDamage(best, w.dmg * falloff * (hv ? HYPER_DMG_MULT : 1), bestPart, w.hsMult, pol.ignoreArmor ? { ignoreArmor: true } : null);
s.damageDealt = (s.damageDealt || 0) + res.damage;
if (res.headshot) s.headshots = (s.headshots || 0) + 1;
if (res.killed) {
s.kills = (s.kills || 0) + 1;
best.deaths = (best.deaths || 0) + 1;
if (typeof s.cash === 'number') s.cash = Math.min(16000, s.cash + 300);
}
const hd = state && state.hd;
if (hd) {
if (res.headshot && hd.popup) { hd.popup(pol.shatter ? '+' + res.damage + ' HEADSHOT • RESONANCE SHATTER' : '+' + res.damage + ' HEADSHOT'); }
if (hd.hitmarker) hd.hitmarker(res.headshot);
}
return { hit: true, part: bestPart, damage: res.damage, killed: res.killed, headshot: res.headshot, target: best, dist: bestDist };
}
export function fireShot(state, s, list) {
const miss = { hit: false, part: null, damage: 0, killed: false, headshot: false, target: null, dist: 0 };
if (!s || s.alive === false) return miss;
const wid = s.wId || 'rifle';
const w = getWpn(wid);
const now = state && typeof state.time === 'number' ? state.time : -1;
if (now >= 0 && s.nextShotAt && now < s.nextShotAt) return miss;
if (s.ammoMag <= 0) return miss;
if (typeof s.ammoMag === 'number') s.ammoMag -= 1;
s.nextShotAt = now >= 0 ? now + w.interval : 0;
if (!s.spray) s.spray = createSprayState(s.seed ?? 7);
const spray = s.spray;
onShot(spray, wid);
const ang = spreadAngle(wid, spray, s);
spreadJitter(spray, ang, _jit);
eyeOf(s, _scratchOrigin);
aimOf(s, _scratchDir);
_right.set(-_scratchDir.z, 0, _scratchDir.x).normalize();
if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
_up.crossVectors(_right, _scratchDir).normalize();
_scratchDir.addScaledVector(_right, spray.kickX + _jit.x);
_scratchDir.addScaledVector(_up, spray.kickY + _jit.y);
_scratchDir.normalize();
_muzzle.copy(_scratchOrigin).addScaledVector(_scratchDir, 0.6).addScaledVector(_right, 0.12);
if (s.muzzle) _muzzle.copy(s.muzzle);
const sfx = state && state.sfx;
if (sfx && sfx.shot) sfx.shot(wid);
let out = trace(state, s, list, _scratchOrigin, _scratchDir, _muzzle, w, true);
const prisms = state && state.prisms;
_scratchRay.set(_scratchOrigin, _scratchDir);
if (!out && prisms && prisms.checkPrismCoreHit && prisms.checkPrismCoreHit(_scratchRay)) {
const pol = checkHit({ prismCore: true }, getPolarity(state), state);
if (pol.armorBonus > 0 && typeof s.armor === 'number') {
s.armor = Math.min(100, s.armor + pol.armorBonus);
miss.armorBonus = pol.armorBonus;
}
}
if ((wid === 'rifle' || wid === 'rail') && prisms && prisms.refractRay) {
const rays = prisms.refractRay(_scratchOrigin, _scratchDir, wid);
if (rays && rays.length) {
for (let i = 0; i < rays.length; i++) {
const r = rays[i];
if (!r || !r.origin || !r.dir) continue;
_rOrigin.copy(r.origin);
_rDir.copy(r.dir).normalize();
const rr = trace(state, s, list, _rOrigin, _rDir, _rOrigin, w, false);
if (!out && rr) { out = rr; out.viaPylon = true; }
}
}
}
if (out) { out.armorBonus = miss.armorBonus; return out; }
return miss;
}
