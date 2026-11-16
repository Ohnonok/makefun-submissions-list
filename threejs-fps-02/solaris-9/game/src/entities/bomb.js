import * as THREE from 'three';
import * as Config from '../core/config.js';
const roundNum = (k, f) => {
const r = Config.ROUND || {};
return typeof r[k] === 'number' ? r[k] : f;
};
const BOMB_TIME = roundNum('bombTime', 35);
const DEFUSE_TIME = roundNum('defuseTime', 5);
const DEFUSE_KIT_TIME = roundNum('defuseKitTime', 2.5);
function makeBombMesh() {
const g = new THREE.Group();
const dark = new THREE.MeshStandardMaterial({
color: 0x1d3557, metalness: 0.7, roughness: 0.35 });
const shell = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.34), dark);
const stripMat = new THREE.MeshStandardMaterial({
color: 0xef476f, emissive: 0xef476f, emissiveIntensity: 0.4 });
const strip = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.36), stripMat);
strip.position.y = 0.06;
const antenna = new THREE.Mesh(
new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), dark);
antenna.position.set(0.18, 0.24, -0.08);
const light = new THREE.PointLight(0xef476f, 0, 9, 1.6);
light.position.set(0, 0.5, 0);
g.add(shell, strip, antenna, light);
return { group: g, stripMat, light };
}
export function mkBomb(opts) {
const mesh = makeBombMesh();
const bm = {
status: 'carried', si: null,
carrier: null, timer: BOMB_TIME,
blinkT: 0, lightOn: false,
beepT: 0, defuseT: 0,
mesh: mesh.group, stripMat: mesh.stripMat,
light: mesh.light, sitePos: { x: 0, z: 0 },
};
bm.plant = function (siteId, x, z, planter) {
if (bm.status !== 'carried') return false;
bm.status = 'planted';
bm.si = siteId;
bm.sitePos.x = x;
bm.sitePos.z = z;
bm.carrier = null;
bm.timer = BOMB_TIME;
bm.blinkT = 0;
bm.beepT = 0;
bm.defuseT = 0;
bm.mesh.position.set(x, 0.14, z);
bm.mesh.visible = true;
return true;
};
bm.drop = function (x, z) {
if (bm.status !== 'carried') return false;
bm.status = 'dropped';
bm.carrier = null;
bm.mesh.position.set(x, 0.14, z);
bm.mesh.visible = true;
bm.light.intensity = 0;
bm.stripMat.emissiveIntensity = 0.4;
return true;
};
bm.tryPickup = function (entity, radius) {
if (bm.status !== 'dropped' || !entity.alive) return false;
const dx = entity.pos.x - bm.mesh.position.x;
const dz = entity.pos.z - bm.mesh.position.z;
const r = radius || 1.1;
if (dx * dx + dz * dz > r * r) return false;
bm.status = 'carried';
bm.carrier = entity;
bm.mesh.visible = false;
return true;
};
bm.updateDefuse = function (dt, defusing, hasKit) {
if (bm.status !== 'planted') return null;
if (!defusing) {
bm.defuseT = 0;
return null;
}
bm.defuseT += dt;
const need = hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
if (bm.defuseT >= need) {
bm.status = 'defused';
bm.light.intensity = 0;
bm.stripMat.emissiveIntensity = 0.1;
return 'defused';
}
return null;
};
bm.defuseProgress = function (hasKit) {
const need = hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME;
return Math.min(1, bm.defuseT / need);
};
bm.update = function (dt) {
if (bm.status !== 'planted') return null;
bm.timer -= dt;
if (bm.timer <= 0) {
bm.timer = 0;
bm.status = 'exploded';
bm.light.intensity = 0;
return 'explode';
}
bm.blinkT += dt;
const iv = 0.9 - (1 - bm.timer / BOMB_TIME) * 0.72;
if (bm.blinkT >= iv) {
bm.blinkT -= iv;
bm.lightOn = !bm.lightOn;
bm.light.intensity = bm.lightOn ? 14 : 0;
bm.stripMat.emissiveIntensity = bm.lightOn ? 2.4 : 0.4;
}
bm.beepT += dt;
if (bm.beepT >= iv) {
bm.beepT -= iv;
return 'beep';
}
return null;
};
bm.resetRd = function (carrier) {
bm.status = 'carried';
bm.si = null;
bm.carrier = carrier || null;
bm.timer = BOMB_TIME;
bm.blinkT = 0;
bm.beepT = 0;
bm.defuseT = 0;
bm.light.intensity = 0;
bm.stripMat.emissiveIntensity = 0.4;
bm.mesh.visible = false;
};
return bm;
}
