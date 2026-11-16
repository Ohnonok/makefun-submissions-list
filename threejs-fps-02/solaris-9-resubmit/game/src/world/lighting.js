import * as THREE from 'three';
import { PALETTE, CSS } from './palette.js';
function makeSkyTexture() {
const cv = document.createElement('canvas');
cv.width = 16; cv.height = 256;
const ctx = cv.getContext('2d');
const g = ctx.createLinearGradient(0, 0, 0, 256);
g.addColorStop(0, CSS.skyZenith);
g.addColorStop(0.45, CSS.skyMid);
g.addColorStop(0.75, CSS.skyHorizon);
g.addColorStop(1, '#ffd9a0');
ctx.fillStyle = g;
ctx.fillRect(0, 0, 16, 256);
const tex = new THREE.CanvasTexture(cv);
tex.colorSpace = THREE.SRGBColorSpace;
return tex;
}
export function setupLighting(scene) {
scene.fog = new THREE.Fog(PALETTE.fog, 70, 190);
scene.background = new THREE.Color(PALETTE.skyMid);
const sky = new THREE.Mesh(
new THREE.SphereGeometry(220, 24, 16),
new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false })
);
scene.add(sky);
const hemi = new THREE.HemisphereLight(PALETTE.sunWarm, PALETTE.floor, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
sun.position.set(38, 46, 26);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -42; sc.right = 42; sc.top = 34; sc.bottom = -34;
sc.near = 5; sc.far = 160;
sun.shadow.bias = -0.0004;
scene.add(sun);
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);
return { hemi, sun, ambient, sky };
}
