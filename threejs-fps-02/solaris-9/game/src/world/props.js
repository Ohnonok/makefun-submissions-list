import * as THREE from 'three';
import { PALETTE, CSS } from './palette.js';
const sandMat = new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 0.75 });
const sandDarkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sandDark, roughness: 0.8 });
const tealMat = new THREE.MeshStandardMaterial({ color: PALETTE.teal, roughness: 0.7 });
const pillarMat = new THREE.MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.6, metalness: 0.3 });
const goldMat = new THREE.MeshStandardMaterial({ color: PALETTE.gold, roughness: 0.35, metalness: 0.7 });
export function buildCrates(scene, spots) {
const cols = [];
for (let i = 0; i < spots.length; i++) {
const s = spots[i];
const mat = s[5] ? tealMat : i % 3 === 0 ? sandDarkMat : sandMat;
const crate = new THREE.Mesh(new THREE.BoxGeometry(s[2], s[3], s[4]), mat);
crate.position.set(s[0], s[3] / 2, s[1]);
crate.castShadow = true; crate.receiveShadow = true; scene.add(crate);
const cap = new THREE.Mesh(new THREE.BoxGeometry(s[2] + 0.08, 0.12, s[4] + 0.08), goldMat);
cap.position.set(s[0], s[3] - 0.06, s[1]); scene.add(cap);
cols.push({ minX: s[0] - s[2] / 2, maxX: s[0] + s[2] / 2, minZ: s[1] - s[4] / 2, maxZ: s[1] + s[4] / 2, h: s[3] });
}
return cols;
}
export function buildPillars(scene, spots) {
const cols = [];
for (let i = 0; i < spots.length; i++) {
const s = spots[i];
const p = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 4.4, 10), pillarMat);
p.position.set(s.x, 2.2, s.z); p.castShadow = true; scene.add(p);
const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.3, 10), goldMat);
cap.position.set(s.x, 4.5, s.z); scene.add(cap);
cols.push({ minX: s.x - 0.65, maxX: s.x + 0.65, minZ: s.z - 0.65, maxZ: s.z + 0.65, h: 4.6 });
}
return cols;
}
function letterTexture(letter, color) {
const cv = document.createElement('canvas');
cv.width = 256; cv.height = 256;
const ctx = cv.getContext('2d');
ctx.clearRect(0, 0, 256, 256);
ctx.font = 'bold 190px system-ui, sans-serif';
ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
ctx.fillStyle = color; ctx.fillText(letter, 128, 134);
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
return tex;
}
export function buildSiteMarkers(scene, sites) {
const rings = {};
const defs = [
{ key: 'A', color: PALETTE.ringA, css: CSS.letterA }, { key: 'B', color: PALETTE.ringB, css: CSS.letterB },
];
for (let i = 0; i < defs.length; i++) {
const d = defs[i], s = sites[d.key];
const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.5, 48), new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.06, s.z); scene.add(ring);
const letter = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ map: letterTexture(d.key, d.css), transparent: true, depthWrite: false }));
letter.rotation.x = -Math.PI / 2; letter.position.set(s.x, 0.07, s.z); scene.add(letter);
rings[d.key] = ring;
}
return { rings };
}
