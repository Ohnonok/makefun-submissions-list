import * as THREE from 'three';
const POOL_N = 24, TRACER_LIFE = 0.07, FLASH_LIFE = 0.06;
export const TRACER_POOL = [];
let _next = 0, _flashSprite = null, _flashLife = 0, _light = null;
function flashTexture() {
const c = document.createElement('canvas');
c.width = c.height = 64;
const g = c.getContext('2d');
const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
grad.addColorStop(0, 'rgba(255,255,240,1)');
grad.addColorStop(0.4, 'rgba(255,210,122,0.9)');
grad.addColorStop(1, 'rgba(255,180,80,0)');
g.fillStyle = grad;
g.beginPath();
g.moveTo(63, 32);
for (let i = 1; i < 8; i++) {
const a = i * Math.PI / 4, r = i % 2 ? 7 : 31;
g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
}
g.closePath();
g.fill();
return new THREE.CanvasTexture(c);
}
export function initTr(scene) {
TRACER_POOL.length = 0;
_next = 0;
for (let i = 0; i < POOL_N; i++) {
const geo = new THREE.BufferGeometry();
const pos = new Float32Array(6);
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
color: 0xf4a261, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
}));
line.visible = false;
line.frustumCulled = false;
scene.add(line);
TRACER_POOL.push({ line, life: 0 });
}
_flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
map: flashTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
}));
_flashSprite.visible = false;
_flashSprite.scale.set(0.35, 0.35, 1);
scene.add(_flashSprite);
_light = new THREE.PointLight(0xffd27a, 0, 9, 2);
scene.add(_light);
return true;
}
export function spawnTr(from, to, color, sticky) {
if (!TRACER_POOL.length) return false;
const slot = TRACER_POOL[_next];
_next = (_next + 1) % POOL_N;
const a = slot.line.geometry.getAttribute('position');
const v = a.array;
v[0] = from.x; v[1] = from.y; v[2] = from.z;
v[3] = to.x; v[4] = to.y; v[5] = to.z;
a.needsUpdate = true;
slot.line.material.color.setHex(color || 0xf4a261);
slot.line.material.opacity = 0.95;
slot.line.visible = true;
slot.life = TRACER_LIFE;
slot.sticky = !!sticky;
return true;
}
export function muzzleFlash(pos, color) {
if (!_flashSprite) return false;
_flashSprite.position.copy(pos);
_flashSprite.material.color.setHex(color || 0xffd27a);
_flashSprite.material.opacity = 1;
_flashSprite.visible = true;
_flashLife = FLASH_LIFE;
_light.position.copy(pos);
_light.intensity = 1.5;
return true;
}
export function settleFl() {
if (_flashLife <= 0 || !_flashSprite) return;
_flashLife = FLASH_LIFE * 0.5;
const k = 0.5;
_flashSprite.material.opacity = k;
const s = 0.21 + 0.14 * k;
_flashSprite.scale.set(s, s, 1);
_light.intensity = 1.5 * k;
}
export function updateTracers(dt) {
if (!TRACER_POOL.length) return;
for (const slot of TRACER_POOL) {
if (slot.life <= 0 || slot.sticky) continue;
slot.life -= dt;
if (slot.life <= 0) { slot.line.visible = false; continue; }
slot.line.material.opacity = 0.95 * (slot.life / TRACER_LIFE);
}
if (_flashLife > 0) {
_flashLife -= dt;
if (_flashLife <= 0) {
_flashSprite.visible = false;
_light.intensity = 0;
} else {
const k = _flashLife / FLASH_LIFE;
_flashSprite.material.opacity = k;
const s = 0.21 + 0.14 * k;
_flashSprite.scale.set(s, s, 1);
_light.intensity = 1.5 * k;
}
}
}
