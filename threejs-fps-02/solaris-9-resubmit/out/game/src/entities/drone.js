import * as THREE from 'three';
import { losBlocked } from '../core/utils.js';
import { ROUND } from '../core/config.js';
import { fireShot } from '../combat/shooting.js';
let _cd = 0;
function nearest(list, tm, x, z, maxD2) {
let best = null, bestD2 = maxD2;
for (const p of list) {
if (!p || p.hp <= 0 || p.tm === tm) continue;
const q = p.pos || p.position || p;
const ax = (q.x || 0) - x, az = (q.z || 0) - z;
const d2 = ax * ax + az * az;
if (d2 < bestD2) { best = p; bestD2 = d2; }
}
return best;
}
export function mkDrone(tm, pos) {
const t = tm || 'voidborne';
const g = new THREE.Group();
const dark = new THREE.MeshBasicMaterial({ color: 0x1d3557 }),
sensorMat = new THREE.MeshBasicMaterial({ color: 0xef476f }),
goldMat = new THREE.MeshBasicMaterial({ color: 0xf4d35e });
const goldRing = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 6, 16), goldMat);
goldRing.position.set(0, 0, 0.32);
goldRing.visible = false;
g.add(
new THREE.Mesh(new THREE.OctahedronGeometry(0.34), dark),
new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.08).translate(0, 0.32, 0), dark),
new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8).translate(0, 0, 0.32), sensorMat),
goldRing);
g.position.set(pos.x, 1.7, pos.z);
return {
group: g, pos: g.position, eyePos: g.position, sensorMat, goldRing,
nm: 'Sentinel Drone', displayName: 'Sentinel Drone', tm: t, origTeam: t, hp: 60, alive: true,
aimDir: new THREE.Vector3(0, 0, -1), headHeight: 0.1, wId: 'smg', ax: pos.x, az: pos.z, ang: 0,
fireT: 0, overrideT: 0, overriddenUntil: 0,
};
}
export function updateDrone(d, state, dt) {
if (!d || !d.alive) return;
if (_cd > 0) _cd = Math.max(0, _cd - dt);
if (d.overrideT > 0 && (d.overrideT -= dt) <= 0) {
d.tm = d.origTeam;
d.overriddenUntil = 0;
d.nm = 'Sentinel Drone';
d.displayName = 'Sentinel Drone';
d.sensorMat.color.setHex(0xef476f);
if (d.goldRing) d.goldRing.visible = false;
}
d.ang += dt * 0.25;
d.pos.x = d.ax + Math.cos(d.ang) * 5;
d.pos.z = d.az + Math.sin(d.ang) * 5;
d.pos.y = 1.7 + Math.sin(d.ang * 8) * 0.15;
d.fireT -= dt;
const plrs = state && state.plrs;
if (d.fireT > 0 || !plrs) return;
const best = nearest(plrs, d.tm, d.pos.x, d.pos.z, 900);
if (!best) return;
const q = best.pos || best.position || best;
d.aimDir.set((q.x || 0) - d.pos.x, (q.y || 0) + 1.1 - d.pos.y, (q.z || 0) - d.pos.z).normalize();
d.fireT = 0.55;
fireShot(state, d, plrs);
}
export function tryHijack(state, playerPos) {
if (_cd > 0 || !state || !state.drones) return null;
const px = playerPos.x, py = playerPos.y || 1.55, pz = playerPos.z;
const best = nearest(state.drones, 'solaris', px, pz, 625);
const col = state.cols || (state.mp || {}).cols || [];
if (!best || losBlocked(px, py, pz, best.pos.x, best.pos.y, best.pos.z, col, [])) return null;
const now = ROUND.roundTime - (state.timeLeft == null ? ROUND.roundTime : state.timeLeft);
best.tm = 'solaris';
best.overrideT = 12;
best.overriddenUntil = now + 12;
best.nm = 'Hijacked Sentinel Drone';
best.displayName = 'Hijacked Sentinel Drone';
best.sensorMat.color.setHex(0x48cae4);
if (best.goldRing) best.goldRing.visible = true;
_cd = 20;
return best;
}
export { tryHijack as tryOverride };
