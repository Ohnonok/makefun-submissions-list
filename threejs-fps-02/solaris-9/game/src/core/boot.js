import * as THREE from 'three';
import { PALETTE } from './config.js';
export function mkBoot({ staging = false } = {}) {
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, 45, 150);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';
const keys = Object.create(null);
const mouse = { dx: 0, dy: 0 };
const input = {
keys,
mouse, locked: false,
resetMouse() { mouse.dx = 0; mouse.dy = 0; },
};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('mousemove', (e) => {
if (document.pointerLockElement !== renderer.domElement) return;
mouse.dx += e.movementX;
mouse.dy += e.movementY;
});
document.addEventListener('pointerlockchange', () => {
input.locked = document.pointerLockElement === renderer.domElement;
});
window.addEventListener('resize', () => {
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
renderer.setSize(window.innerWidth, window.innerHeight);
});
function lockPointer() {
if (staging) return;
renderer.domElement.requestPointerLock();
}
return { renderer, scene, camera, input, lockPointer };
}
