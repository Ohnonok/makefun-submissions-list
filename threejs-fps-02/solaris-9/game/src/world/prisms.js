import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { segmentVsAABB } from './collision.js';
const _tmpVec1 = new THREE.Vector3(), _tmpVec2 = new THREE.Vector3(), _tmpRay = new THREE.Raycaster(), _tmpQuat = new THREE.Quaternion(), _tmpMat4 = new THREE.Matrix4();
const SPOTS = [[-18, -8], [-18, 8], [0, -10], [0, 10]];
const PR = 0.9, PH = 3.6, RAY_LEN = 40, EMPTY = [];
const pylons = [];
const CORE = { x: 0, z: 0, r: 1.5, h: 4.2, mesh: null };
const _rays = [];
for (let i = 0; i < 3; i++) _rays.push({ origin: new THREE.Vector3(), dir: new THREE.Vector3(), bounce: new THREE.Vector3(), bounceDir: new THREE.Vector3(), hasBounce: false });
let _scene = null, _colliders = null, _sensor = null;
function circleHit(ox, oz, ux, uz, cx, cz, r) {
const dx = cx - ox, dz = cz - oz, t = dx * ux + dz * uz;
if (t < 0) return -1;
const perp2 = dx * dx + dz * dz - t * t, r2 = r * r;
if (perp2 >= r2) return -1;
return t - Math.sqrt(r2 - perp2);
}
function box(cx, cz, r, h) { return { minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r, h }; }
export function buildPrisms(scene, cols) {
_scene = scene; _colliders = cols || null;
const crystal = new THREE.MeshStandardMaterial({ color: PALETTE.crystal, emissive: PALETTE.crystalDeep, emissiveIntensity: 0.45, transparent: true, opacity: 0.6, roughness: 0.15 });
for (let i = 0; i < SPOTS.length; i++) {
const s = SPOTS[i];
const col = new THREE.Mesh(new THREE.CylinderGeometry(PR, PR + 0.25, PH, 6), crystal);
col.position.set(s[0], PH / 2, s[1]); col.castShadow = true; scene.add(col);
pylons.push({ x: s[0], z: s[1], r: PR, h: PH, mesh: col });
if (cols) cols.push(box(s[0], s[1], PR, PH));
}
const core = new THREE.Mesh(new THREE.ConeGeometry(CORE.r, CORE.h, 6), crystal);
core.position.set(0, CORE.h / 2, 0); core.castShadow = true; scene.add(core);
CORE.mesh = core;
if (cols) cols.push(box(0, 0, CORE.r, CORE.h));
return { pylons, core: CORE };
}
export function refractRay(origin, dir, wId) {
if (wId !== 'rifle' && wId !== 'rail') return EMPTY;
const hl = Math.hypot(dir.x, dir.z);
if (hl < 0.0001) return EMPTY;
const ux = dir.x / hl, uz = dir.z / hl;
let bestT = 61;
for (let i = 0; i < pylons.length; i++) {
const p = pylons[i], t = circleHit(origin.x, origin.z, ux, uz, p.x, p.z, p.r);
if (t >= 0 && t < bestT) bestT = t;
}
if (bestT > 60) return EMPTY;
_tmpVec1.copy(origin).addScaledVector(dir, bestT / hl);
for (let i = 0; i < 3; i++) {
const ray = _rays[i];
ray.origin.copy(_tmpVec1);
_tmpQuat.setFromAxisAngle(_tmpVec2.set(0, 1, 0), (i - 1) * 18 * Math.PI / 180);
ray.dir.copy(dir).applyQuaternion(_tmpQuat).normalize();
ray.hasBounce = false;
if (_colliders) bounceRay(ray);
}
return _rays;
}
function bounceRay(ray) {
const ox = ray.origin.x, oz = ray.origin.z;
const bx = ox + ray.dir.x * RAY_LEN, bz = oz + ray.dir.z * RAY_LEN;
let bt = 1e9, bc = null;
for (let i = 0; i < _colliders.length; i++) {
const c = _colliders[i], t = segmentVsAABB(ox, oz, bx, bz, c);
if (t < 0.001 || t >= bt) continue;
if (ray.origin.y + ray.dir.y * t * RAY_LEN >= c.h) continue;
bt = t; bc = c;
}
if (!bc) return;
const hx = ox + ray.dir.x * bt * RAY_LEN, hz = oz + ray.dir.z * bt * RAY_LEN;
ray.bounce.set(hx, ray.origin.y + ray.dir.y * bt * RAY_LEN, hz);
const xFace = Math.abs(hx - bc.minX) < 0.05 || Math.abs(hx - bc.maxX) < 0.05;
ray.bounceDir.set(xFace ? -ray.dir.x : ray.dir.x, ray.dir.y, xFace ? ray.dir.z : -ray.dir.z);
ray.hasBounce = true;
}
export function checkPrismCoreHit(ray) {
const o = ray.origin || ray.ray.origin, d = ray.dir || ray.direction || ray.ray.direction;
const hl = Math.hypot(d.x, d.z);
if (hl < 0.0001) return false;
const t = circleHit(o.x, o.z, d.x / hl, d.z / hl, CORE.x, CORE.z, CORE.r);
if (t < 0 || t > 60) return false;
const y = o.y + d.y * (t / hl);
return y >= 0 && y <= CORE.h;
}
export function placeTrip(pos) {
const x = Math.max(-28, Math.min(28, pos.x)), z = pos.z;
if (!_sensor) {
const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: PALETTE.visor }));
_sensor = { x1: 0, z1: 0, x2: 0, z2: 0, active: true, mesh };
if (_scene) _scene.add(mesh);
}
_sensor.x1 = x - 4; _sensor.x2 = x + 4; _sensor.z1 = z; _sensor.z2 = z; _sensor.active = true;
_sensor.mesh.position.set(x, 1, z); _sensor.mesh.visible = true;
return _sensor;
}
export function getTrip() { return _sensor; }
