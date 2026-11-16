import * as THREE from 'three';
import { PALETTE } from './palette.js';
function buildDome() {
const g = new THREE.Group();
const gold = new THREE.MeshStandardMaterial({ color: PALETTE.domeGold, metalness: 0.85, roughness: 0.28, emissive: PALETTE.goldDeep, emissiveIntensity: 0.9 });
const cobalt = new THREE.MeshStandardMaterial({ color: PALETTE.wall, metalness: 0.3, roughness: 0.7 });
const dark = new THREE.MeshStandardMaterial({ color: 0x101c33, metalness: 0.6, roughness: 0.4 });
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(6.1, 6.5, 1, 28), cobalt);
plinth.position.y = 0.5; plinth.castShadow = plinth.receiveShadow = true; g.add(plinth);
const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2), gold);
dome.position.y = 1; dome.castShadow = true; g.add(dome);
const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, 7.5, 20), gold);
tube.position.set(1.6, 8.2, 0); tube.rotation.z = -0.62; tube.castShadow = true; g.add(tube);
const rim = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.16, 10, 24), gold);
rim.position.set(3.85, 10.9, 0); rim.rotation.set(0.62, Math.PI / 2, 0); g.add(rim);
return g;
}
function buildMonolith() {
const g = new THREE.Group();
const rock = new THREE.MeshStandardMaterial({ color: 0x2b3a55, metalness: 0.2, roughness: 0.85 });
const crystal = new THREE.MeshStandardMaterial({ color: PALETTE.crystal, emissive: PALETTE.crystalDeep, emissiveIntensity: 0.35, transparent: true, opacity: 0.82, metalness: 0.1, roughness: 0.15 });
const coreMat = new THREE.MeshStandardMaterial({ color: PALETTE.crystalCore, emissive: PALETTE.crystalDeep, emissiveIntensity: 0.55, transparent: true, opacity: 0.82, metalness: 0.1, roughness: 0.15 });
const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.4, 1.1, 8), rock);
base.position.y = 0.55; base.castShadow = base.receiveShadow = true; g.add(base);
const shards = [
[0, 0, 1.9, 11.5, 0, 0], [-2.4, 1.2, 1.3, 7.5, 0.22, 0.5],
[2.3, -1.1, 1.4, 8.2, -0.18, -0.4], [1.4, 2.2, 1, 6, 0.12, 2.2],
[-1.6, -2.1, 1.1, 6.8, -0.26, -2],
];
for (let i = 0; i < shards.length; i++) {
const s = shards[i];
const shard = new THREE.Mesh(new THREE.ConeGeometry(s[2], s[3], 6), i === 0 ? coreMat : crystal);
shard.position.set(s[0], 1.1 + s[3] / 2, s[1]);
shard.rotation.set(s[5] * 0.12, 0, s[4]); shard.castShadow = true;
g.add(shard);
}
return g;
}
function signTexture(text) {
const cv = document.createElement('canvas');
cv.width = 512; cv.height = 112;
const ctx = cv.getContext('2d');
ctx.fillStyle = '#0d1b2e'; ctx.fillRect(0, 0, 512, 112);
ctx.textAlign = 'center';
const parts = text.split(' — ');
if (parts.length > 1) {
ctx.font = 'bold 44px system-ui, sans-serif';
ctx.fillStyle = '#ede8dc'; ctx.fillText(parts[0], 256, 48);
ctx.fillStyle = '#f4a261'; ctx.fillText(parts[1], 256, 98);
} else {
ctx.font = 'bold 52px system-ui, sans-serif';
ctx.fillStyle = '#ede8dc'; ctx.fillText(text, 256, 64);
}
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
return tex;
}
export function buildLandmarks(scene) {
const dome = buildDome();
dome.position.set(-22, 0, 0); scene.add(dome);
const monolith = buildMonolith();
monolith.position.set(22, 0, 0); scene.add(monolith);
const glow = new THREE.PointLight(0xffc46b, 80, 50, 1.8);
glow.position.set(-15, 9, 7); scene.add(glow);
const signs = [
['← SITE A: SOLARIS DOME', -8, -3.4, 0], ['SITE B: ASTRAL MONOLITH →', 8, 3.4, Math.PI],
['SOLARIS DOME — SITE A', -31.9, 0, Math.PI / 2], ['ASTRAL MID', 0, -23.9, 0],
['MONOLITH — SITE B', 31.9, 0, -Math.PI / 2],
];
for (let i = 0; i < signs.length; i++) {
const sg = signs[i];
const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.1), new THREE.MeshBasicMaterial({ map: signTexture(sg[0]) }));
sign.position.set(sg[1], 3.1, sg[2]); sign.rotation.y = sg[3]; scene.add(sign);
}
const beamMat = new THREE.MeshBasicMaterial({ color: 0xf4a261, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
for (let i = 0; i < 3; i++) {
const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 14), beamMat);
beam.position.set(-22 + (i - 1) * 2.6, 7, -2 + i * 2.2);
beam.rotation.set(0.35, 0.25, 0.42 + i * 0.08); scene.add(beam);
}
return { dome, monolith };
}
