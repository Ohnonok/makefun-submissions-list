import * as THREE from 'three';
import { getWpn } from './weapons.js';
function mat(color, opts) {
return new THREE.MeshStandardMaterial(Object.assign(
{ color, metalness: 0.65, roughness: 0.35 }, opts || {}));
}
function box(w, h, d, material, x, y, z, rx) {
const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
m.position.set(x, y, z);
if (rx) m.rotation.x = rx;
return m;
}
function cyl(rt, rb, h, material, x, y, z, rx, rz, seg) {
const m = new THREE.Mesh(
new THREE.CylinderGeometry(rt, rb, h, seg || 12), material);
m.position.set(x, y, z);
if (rx) m.rotation.x = rx;
if (rz) m.rotation.z = rz;
return m;
}
function mats(w, darkC, steelC, ae, so) {
return { dark: mat(darkC), accent: mat(w.accent, { emissive: w.accent, emissiveIntensity: ae || 0.9 }), steel: mat(steelC, so || { metalness: 0.85, roughness: 0.3 }) };
}
function addHand(g, dark) {
g.add(box(0.085, 0.07, 0.13, dark, 0, -0.055, 0.02));
g.add(box(0.025, 0.05, 0.07, dark, 0.05, -0.03, 0.0));
}
function buildPistol(w) {
const g = new THREE.Group();
const { dark, accent, steel } = mats(w, 0x1d3557, 0x8d99ae, 0, { metalness: 0.9, roughness: 0.25 });
g.add(box(0.07, 0.075, 0.26, steel, 0, 0.03, -0.05));
g.add(box(0.055, 0.02, 0.2, accent, 0, 0.072, -0.05));
g.add(box(0.06, 0.13, 0.075, dark, 0, -0.055, 0.045, 0.18));
g.add(cyl(0.016, 0.016, 0.07, steel, 0, 0.03, -0.2, Math.PI / 2));
g.add(box(0.012, 0.02, 0.012, accent, 0, 0.08, -0.17));
g.add(box(0.05, 0.015, 0.03, accent, 0, 0.075, 0.06));
addHand(g, dark);
return { group: g, muzzleZ: -0.24 };
}
function buildSmg(w) {
const g = new THREE.Group();
const { dark, accent, steel } = mats(w, 0x14213d, 0x6c757d);
g.add(box(0.09, 0.11, 0.4, steel, 0, 0.02, -0.06));
g.add(box(0.095, 0.02, 0.34, accent, 0, 0.082, -0.06));
g.add(box(0.05, 0.24, 0.075, dark, 0, -0.1, 0.02, 0.1));
g.add(box(0.055, 0.09, 0.06, dark, 0, -0.06, -0.14));
g.add(cyl(0.02, 0.02, 0.12, steel, 0, 0.02, -0.32, Math.PI / 2));
g.add(box(0.07, 0.05, 0.1, dark, 0, 0.0, 0.17));
g.add(box(0.02, 0.03, 0.02, accent, 0.035, 0.06, -0.3));
addHand(g, dark);
return { group: g, muzzleZ: -0.39 };
}
function buildRifle(w) {
const g = new THREE.Group();
const { dark, accent, steel } = mats(w, 0x1d3557, 0x495057);
const wood = mat(0x8a5a2b, { metalness: 0.1, roughness: 0.7 });
g.add(box(0.09, 0.12, 0.5, steel, 0, 0.02, -0.05));
g.add(box(0.07, 0.08, 0.3, wood, 0, 0.0, -0.32));
g.add(box(0.095, 0.018, 0.44, accent, 0, 0.088, -0.08));
g.add(box(0.055, 0.2, 0.08, dark, 0, -0.09, 0.08, 0.22));
g.add(box(0.05, 0.14, 0.06, dark, 0, -0.075, 0.14, 0.22));
g.add(cyl(0.018, 0.018, 0.24, steel, 0, 0.02, -0.55, Math.PI / 2));
g.add(box(0.05, 0.05, 0.06, accent, 0, 0.02, -0.68));
g.add(box(0.075, 0.09, 0.16, wood, 0, 0.01, 0.26));
g.add(box(0.014, 0.025, 0.014, accent, 0, 0.1, -0.5));
const fin = mat(0xf4d35e, { emissive: 0xf4d35e, emissiveIntensity: 1.6 });
g.add(box(0.1, 0.006, 0.3, fin, 0, 0.1, -0.35));
[-0.052, 0.052].forEach(function (x) { g.add(box(0.006, 0.05, 0.3, fin, x, 0.05, -0.35)); });
addHand(g, dark);
return { group: g, muzzleZ: -0.71 };
}
function buildMarksman(w) {
const g = new THREE.Group();
const { dark, accent, steel } = mats(w, 0x241b2e, 0x3a3f4b, 1, { metalness: 0.9, roughness: 0.25 });
g.add(box(0.085, 0.11, 0.46, steel, 0, 0.02, -0.02));
g.add(cyl(0.016, 0.016, 0.5, steel, 0, 0.02, -0.48, Math.PI / 2));
g.add(cyl(0.034, 0.034, 0.24, dark, 0, 0.11, -0.08, Math.PI / 2, 0, 16));
g.add(cyl(0.03, 0.03, 0.012, accent, 0, 0.11, -0.205, Math.PI / 2, 0, 16));
g.add(box(0.03, 0.05, 0.03, dark, 0, 0.055, -0.08));
g.add(box(0.05, 0.16, 0.075, dark, 0, -0.08, 0.1, 0.15));
g.add(box(0.07, 0.085, 0.2, dark, 0, 0.005, 0.26));
g.add(box(0.09, 0.015, 0.4, accent, 0, 0.08, -0.02));
g.add(box(0.02, 0.1, 0.02, steel, 0.03, -0.06, -0.55));
g.add(box(0.02, 0.1, 0.02, steel, -0.03, -0.06, -0.55));
addHand(g, dark);
return { group: g, muzzleZ: -0.74 };
}
function buildRail(w) {
const g = new THREE.Group();
const { dark, accent, steel } = mats(w, 0x2b0a12, 0x212529, 1.4, { metalness: 0.9, roughness: 0.2 });
g.add(box(0.14, 0.16, 0.58, steel, 0, 0.02, -0.04));
g.add(box(0.145, 0.03, 0.5, accent, 0, 0.108, -0.04));
g.add(cyl(0.045, 0.045, 0.5, dark, 0, 0.02, -0.5, Math.PI / 2, 0, 16));
for (let i = 0; i < 3; i++) {
const coil = new THREE.Mesh(
new THREE.TorusGeometry(0.062, 0.014, 8, 20), accent);
coil.position.set(0, 0.02, -0.38 - i * 0.14);
g.add(coil);
}
g.add(cyl(0.04, 0.04, 0.26, dark, 0, 0.13, -0.1, Math.PI / 2, 0, 16));
g.add(cyl(0.036, 0.036, 0.012, accent, 0, 0.13, -0.235, Math.PI / 2, 0, 16));
g.add(box(0.06, 0.18, 0.09, dark, 0, -0.1, 0.1, 0.15));
g.add(box(0.1, 0.12, 0.22, dark, 0, 0.0, 0.3));
g.add(box(0.02, 0.06, 0.02, accent, 0.07, 0.06, -0.28));
addHand(g, dark);
return { group: g, muzzleZ: -0.78 };
}
function drawHolo(g, mag, heatPct) {
g.clearRect(0, 0, 128, 64);
g.fillStyle = 'rgba(6,18,32,.72)';
g.fillRect(0, 0, 128, 64);
g.fillStyle = '#ede8dc';
g.font = 'bold 26px monospace';
g.fillText(String(mag), 8, 32);
g.fillStyle = '#f4a261';
g.font = 'bold 11px monospace';
g.fillText('HEAT ' + heatPct + '%', 56, 20);
g.fillStyle = '#f4d35e';
g.fillRect(8, 44, 1.12 * Math.min(100, heatPct), 6);
}
const BUILDERS = { pistol: buildPistol, smg: buildSmg, rifle: buildRifle, marksman: buildMarksman, rail: buildRail };
export function buildVM(wId) {
const w = getWpn(wId);
const made = (BUILDERS[w.id] || buildPistol)(w);
const group = made.group;
const muzzle = new THREE.Object3D();
muzzle.position.set(0, 0.02, made.muzzleZ);
group.add(muzzle);
group.position.set(0.2, -0.2, -0.5);
let holoG = null, holoTex = null;
if (w.id === 'rifle') {
const hc = document.createElement('canvas');
hc.width = 128; hc.height = 64;
holoG = hc.getContext('2d');
holoTex = new THREE.CanvasTexture(hc);
const holo = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.0425),
new THREE.MeshBasicMaterial({ map: holoTex }));
holo.position.set(0, 0.105, 0.02);
holo.rotation.x = -0.35;
group.add(holo);
}
const vm = {
group, muzzle, weapon: w, recoil: 0, recoilVel: 0, baseZ: -0.5,
lastMag: -1, lastHeat: -1,
kick(amount) { vm.recoilVel += amount; },
update(dt, state) {
vm.recoilVel += -vm.recoil * 90 * dt;
vm.recoilVel *= Math.max(0, 1 - 12 * dt);
vm.recoil += vm.recoilVel * dt;
if (vm.recoil < 0) { vm.recoil = 0; vm.recoilVel = 0; }
if (vm.recoil > 0.12) vm.recoil = 0.12;
group.position.z = vm.baseZ + vm.recoil;
group.rotation.x = vm.recoil * 1.2;
if (state && holoTex) {
const p = state.player || (state.plrs && state.plrs[0]);
const mag = p ? (p.mag ?? (p.ammo ? p.ammo.mag : 0)) : 0;
const heat = state.heat ? Math.round(state.heat.heat || 0) : 0;
if (mag !== vm.lastMag || heat !== vm.lastHeat) {
vm.lastMag = mag; vm.lastHeat = heat;
drawHolo(holoG, mag, heat);
holoTex.needsUpdate = true;
}
}
},
};
return vm;
}
