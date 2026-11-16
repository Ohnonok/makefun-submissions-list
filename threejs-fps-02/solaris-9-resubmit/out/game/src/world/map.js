import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { PALETTE, CSS } from './palette.js';
import { buildLandmarks } from './landmarks.js';
import { buildCrates, buildPillars, buildSiteMarkers } from './props.js';
import { buildPrisms } from './prisms.js';
import { setupLighting } from './lighting.js';
export const MAP_BOUNDS = { minX: -32, maxX: 32, minZ: -24, maxZ: 24 };
const WALL_H = 4;
function makeMarbleTexture() {
const cv = document.createElement('canvas');
cv.width = 512; cv.height = 512;
const ctx = cv.getContext('2d');
ctx.fillStyle = CSS.floor;
ctx.fillRect(0, 0, 512, 512);
const rng = mulberry32(7);
for (let v = 0; v < 46; v++) {
ctx.strokeStyle = v % 3 === 0 ? CSS.floorVein : CSS.floorVeinSoft;
ctx.lineWidth = 0.8 + rng() * 1.6;
ctx.beginPath();
let x = rng() * 512, y = rng() * 512;
ctx.moveTo(x, y);
for (let s = 0; s < 4; s++) {
x += (rng() - 0.5) * 220; y += (rng() - 0.5) * 220;
ctx.quadraticCurveTo(x + (rng() - 0.5) * 90, y + (rng() - 0.5) * 90, x, y);
}
ctx.stroke();
}
ctx.strokeStyle = 'rgba(201,162,39,0.45)';
ctx.fillStyle = 'rgba(201,162,39,0.7)';
ctx.lineWidth = 1.4;
for (let r = 60; r <= 210; r += 50) { ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke(); }
for (let t = 0; t < 24; t++) {
const a = t * Math.PI / 12, l = t % 6 === 0 ? 34 : 16;
ctx.beginPath(); ctx.moveTo(256 + Math.cos(a) * 210, 256 + Math.sin(a) * 210);
ctx.lineTo(256 + Math.cos(a) * (210 - l), 256 + Math.sin(a) * (210 - l)); ctx.stroke();
}
let px = 0, py = 0;
for (let k = 0; k < 10; k++) {
const a = rng() * Math.PI * 2, r = 60 + rng() * 150;
const x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r;
ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
if (k > 0) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
px = x; py = y;
}
const tex = new THREE.CanvasTexture(cv);
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(2, 2);
tex.colorSpace = THREE.SRGBColorSpace;
return tex;
}
export function mkMap(scene) {
setupLighting(scene);
const cols = [];
const sites = { A: { x: -22, z: 0 }, B: { x: 22, z: 0 } };
const floor = new THREE.Mesh(
new THREE.PlaneGeometry(64, 48),
new THREE.MeshStandardMaterial({ mp: makeMarbleTexture(), roughness: 0.55, metalness: 0.05 })
);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.65, metalness: 0.2 });
const trimMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.4, metalness: 0.6 });
function addWall(cx, cz, w, d, h, trim) {
const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
wall.position.set(cx, h / 2, cz); wall.castShadow = wall.receiveShadow = true; scene.add(wall);
if (trim) { const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.18, d + 0.12), trimMat); top.position.set(cx, h + 0.09, cz); scene.add(top); }
cols.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });
}
addWall(0, -24.5, 66, 1, WALL_H, true);
addWall(0, 24.5, 66, 1, WALL_H, true);
addWall(-32.5, 0, 1, 50, WALL_H, true);
addWall(32.5, 0, 1, 50, WALL_H, true);
const segs = [[-29, 6], [-11, 14], [11, 14], [29, 6]];
for (let i = 0; i < segs.length; i++) {
addWall(segs[i][0], -4, segs[i][1], 1, WALL_H, true);
addWall(segs[i][0], 4, segs[i][1], 1, WALL_H, true);
}
const covers = [[-10, -14], [10, -14], [-10, 14], [10, 14]];
for (let i = 0; i < covers.length; i++) addWall(covers[i][0], covers[i][1], 6, 1, WALL_H, false);
const arch = buildPillars(scene, [{ x: 0, z: -3.2 }, { x: 0, z: 3.2 }]);
for (let i = 0; i < arch.length; i++) cols.push(arch[i]);
const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 7.6), trimMat);
beam.position.set(0, 4.9, 0); beam.castShadow = true; scene.add(beam);
const crates = buildCrates(scene, [
[-16, -6, 1.4, 1.4, 1.4, 0], [-16, 6, 1.4, 1.4, 1.4, 1], [16, -6, 1.4, 1.4, 1.4, 1], [16, 6, 1.4, 1.4, 1.4, 0],
[-7, 0, 1.2, 1.2, 1.2, 0], [7, 0, 1.2, 1.2, 1.2, 1], [-14, -9, 2.2, 1.1, 1.1, 0], [14, 9, 2.2, 1.1, 1.1, 0],
[-26, 10, 1.4, 1.4, 1.4, 0], [26, -10, 1.4, 1.4, 1.4, 1],
]);
for (let i = 0; i < crates.length; i++) cols.push(crates[i]);
buildPrisms(scene, cols);
const spawns = { solaris: [[-8, 20], [-3, 21], [0, 20], [3, 21], [8, 20]], voidborne: [[-8, -20], [-3, -21], [0, -20], [3, -21], [8, -20]] };
return { cols, sites, spawns, landmarks: buildLandmarks(scene), markers: buildSiteMarkers(scene, sites), bounds: MAP_BOUNDS };
}
