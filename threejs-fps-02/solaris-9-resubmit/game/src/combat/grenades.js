import * as THREE from 'three';
import { ROUND } from '../core/config.js';
import { segHitsAABB } from '../core/utils.js';
export const SMOKE_DURATION = 12;
export const FLASH_DURATION = 2.5;
export const SMOKE_RADIUS = 1.3;
export const SMOKE_HEIGHT = 4.5;
const GRAVITY = 18;
const MAX_NADES = 8;
const MAX_SMOKES = 4;
const ARC_POINTS = 24;
const FLASH_RANGE = 32;
let _nades = null;
let _smokes = null;
let _smokeMeshes = null;
let _arcLine = null;
let _arcPos = null;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, h: 4 };
export function initNades(scene) {
_nades = [];
for (let i = 0; i < MAX_NADES; i++) {
_nades.push({
active: false, type: 'smoke', state: 'fly', fuse: 0,
pos: new THREE.Vector3(), vel: new THREE.Vector3(), smokeIdx: -1,
});
}
_smokes = [];
_smokeMeshes = [];
const smokeGeo = new THREE.CylinderGeometry(SMOKE_RADIUS, SMOKE_RADIUS * 1.15, SMOKE_HEIGHT, 20, 1, true);
for (let i = 0; i < MAX_SMOKES; i++) {
const m = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({
color: 0xcfc4e8, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
}));
m.visible = false;
scene.add(m);
_smokeMeshes.push(m);
}
_arcPos = new Float32Array(ARC_POINTS * 3);
const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(_arcPos, 3).setUsage(THREE.DynamicDrawUsage));
_arcLine = new THREE.Line(arcGeo, new THREE.LineDashedMaterial({
color: 0xede8dc, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.9,
}));
_arcLine.visible = false;
_arcLine.frustumCulled = false;
scene.add(_arcLine);
return true;
}
function eyeOf(t) {
if (t.eyePos) return _v1.copy(t.eyePos);
const p = t.pos || t.position;
if (p) { _v1.copy(p); _v1.y += 1.55; return _v1; }
_v1.set(0, 1.55, 0);
return _v1;
}
function aimOf(t) {
if (t.aimDir) return _v2.copy(t.aimDir).normalize();
const yaw = t.yaw || 0;
const pitch = t.pitch || 0;
_v2.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
return _v2;
}
export function throwNade(state, thrower, type) {
if (!_nades) return false;
const kind = type === 'flash' ? 'flash' : 'smoke';
for (let i = 0; i < MAX_NADES; i++) {
const n = _nades[i];
if (n.active) continue;
n.pos.copy(eyeOf(thrower));
n.vel.copy(aimOf(thrower)).multiplyScalar(13);
n.vel.y += 3.5;
n.type = kind;
n.state = 'fly';
n.fuse = 0.9;
n.smokeIdx = -1;
n.active = true;
return true;
}
return false;
}
function activateSmoke(n, state) {
for (let i = 0; i < MAX_SMOKES; i++) {
if (_smokeMeshes[i].visible) continue;
const m = _smokeMeshes[i];
m.position.set(n.pos.x, SMOKE_HEIGHT / 2, n.pos.z);
m.visible = true;
const now = state ? ROUND.roundTime - (state.timeLeft || 0) : 0;
_smokes.push({ x: n.pos.x, z: n.pos.z, r: SMOKE_RADIUS, h: SMOKE_HEIGHT, life: SMOKE_DURATION, until: now + SMOKE_DURATION, mesh: i });
return;
}
}
function detonateFlash(state, n) {
const plrs = state && state.plrs;
if (!plrs) return;
for (let i = 0; i < plrs.length; i++) {
const p = plrs[i];
if (!p || p.alive === false || p.hp <= 0) continue;
const eye = eyeOf(p);
const dx = n.pos.x - eye.x;
const dy = n.pos.y - eye.y;
const dz = n.pos.z - eye.z;
const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
if (d > FLASH_RANGE || d < 0.001) continue;
if (segmentBlockedByWalls(eye, n.pos, state)) continue;
const aim = aimOf(p);
const dot = (dx * aim.x + dy * aim.y + dz * aim.z) / d;
const facing = dot > 0.25 ? 1 : 0.35;
const blind = FLASH_DURATION * facing * (1 - d / (FLASH_RANGE * 1.6));
if (blind > (p.blinded || 0)) p.blinded = blind;
}
}
export function segmentBlockedByWalls(a, b, state) {
const col = state && (state.cols || (state.mp && state.mp.cols) || (state.world && state.world.cols));
if (!col) return false;
for (let i = 0; i < col.length; i++) {
const c = col[i];
_col.minX = c.minX; _col.maxX = c.maxX;
_col.minZ = c.minZ; _col.maxZ = c.maxZ;
_col.h = c.h || 4;
if (segHitsAABB(a.x, a.y, a.z, b.x, b.y, b.z, _col)) return true;
}
return false;
}
const _noSmokes = [];
export function getSmokes() { return _smokes || _noSmokes; }
export function hideArcPreview() { if (_arcLine) _arcLine.visible = false; }
export function updNades(state, dt) {
if (!_nades) return;
for (let i = 0; i < MAX_NADES; i++) {
const n = _nades[i];
if (!n.active) continue;
if (n.state === 'fly') {
n.vel.y -= GRAVITY * dt;
n.pos.x += n.vel.x * dt;
n.pos.y += n.vel.y * dt;
n.pos.z += n.vel.z * dt;
if (n.pos.y <= 0.05) {
n.pos.y = 0.05;
if (Math.abs(n.vel.y) > 2.5) {
n.vel.y = -n.vel.y * 0.35;
n.vel.x *= 0.6;
n.vel.z *= 0.6;
} else {
n.state = 'landed';
if (n.type === 'smoke') { activateSmoke(n, state); n.active = false; }
}
}
if (n.type === 'flash') {
n.fuse -= dt;
if (n.fuse <= 0) { detonateFlash(state, n); n.active = false; }
}
}
}
for (let i = _smokes.length - 1; i >= 0; i--) {
const s = _smokes[i];
s.life -= dt;
if (s.life <= 0) {
_smokeMeshes[s.mesh].visible = false;
_smokes.splice(i, 1);
} else if (s.life < 2) { _smokeMeshes[s.mesh].material.opacity = 0.22 * (s.life / 2); }
}
const plrs = state && state.plrs;
if (plrs) {
for (let i = 0; i < plrs.length; i++) {
const p = plrs[i];
if (p && p.blinded > 0) p.blinded = Math.max(0, p.blinded - dt);
}
}
}
export function clearNades() {
if (!_nades) return;
for (let i = 0; i < MAX_NADES; i++) _nades[i].active = false;
for (let i = 0; i < MAX_SMOKES; i++) {
_smokeMeshes[i].visible = false;
_smokeMeshes[i].material.opacity = 0.22;
}
_smokes.length = 0;
hideArcPreview();
}
