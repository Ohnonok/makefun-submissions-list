import * as THREE from 'three';
const TEAM_COLORS = {
solaris: [0xf4a261, 0xede8dc, 0x7a5a2e, 0xffb703], voidborne: [0x7b2fbe, 0x3d348b, 0x241b2e, 0x48cae4],
};
const _tmpColor = new THREE.Color();
const _hpGreen = new THREE.Color(0x52b788);
const _hpRed = new THREE.Color(0xef476f);
function at(mesh, x, y, z, rx) {
mesh.position.set(x, y, z);
if (rx) mesh.rotation.x = rx;
return mesh;
}
function makeNameSprite(nm, tm) {
const c = document.createElement('canvas');
c.width = 256; c.height = 48;
const ctx = c.getContext('2d');
ctx.font = 'bold 26px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.fillStyle = tm === 'solaris' ? '#f4a261' : '#c77dff';
ctx.fillText(nm, 128, 30);
const sp = new THREE.Sprite(new THREE.SpriteMaterial({
map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
}));
sp.scale.set(1.15, 0.22, 1);
return sp;
}
function barSprite(color, w) {
const sp = new THREE.Sprite(new THREE.SpriteMaterial({
color, transparent: true, depthWrite: false,
}));
sp.scale.set(w, 0.075, 1);
return sp;
}
export function buildHum(tm, nm) {
const tc = TEAM_COLORS[tm] || TEAM_COLORS.voidborne;
const g = new THREE.Group();
const std = (c, m, r) => new THREE.MeshStandardMaterial({ color: c, metalness: m, roughness: r });
const armor = std(tc[0], 0.55, 0.4);
const trim = std(tc[1], 0.3, 0.5);
const pants = std(tc[2], 0.2, 0.7);
const dark = std(0x1d3557, 0.6, 0.4);
const visorMat = std(tc[3], 0.2, 0.3);
visorMat.emissive.setHex(tc[3]);
visorMat.emissiveIntensity = 2.2;
const legGeo = new THREE.BoxGeometry(0.17, 0.78, 0.2);
legGeo.translate(0, -0.39, 0);
const legL = at(new THREE.Mesh(legGeo, pants), -0.11, 0.8, 0);
const legR = at(new THREE.Mesh(legGeo, pants), 0.11, 0.8, 0);
const bootGeo = new THREE.BoxGeometry(0.19, 0.1, 0.3);
const bootL = at(new THREE.Mesh(bootGeo, dark), -0.11, 0.05, 0.04);
const bootR = at(new THREE.Mesh(bootGeo, dark), 0.11, 0.05, 0.04);
const body = at(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.36), armor), 0, 1.14, 0);
const chest = at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), trim), 0, 1.2, 0.19);
const belt = at(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.09, 0.37), dark), 0, 0.84, 0);
const padGeo = new THREE.BoxGeometry(0.2, 0.12, 0.34);
const padL = at(new THREE.Mesh(padGeo, trim), -0.38, 1.44, 0);
const padR = at(new THREE.Mesh(padGeo, trim), 0.38, 1.44, 0);
const armGeo = new THREE.BoxGeometry(0.15, 0.6, 0.17);
armGeo.translate(0, -0.3, 0);
const armR = at(new THREE.Mesh(armGeo, armor), 0.36, 1.44, 0, -1.15);
const armL = at(new THREE.Mesh(armGeo, armor), -0.36, 1.44, 0, -0.85);
armL.rotation.z = 0.35;
const gun = new THREE.Group();
gun.add(
new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark),
at(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark), 0, 0.02, -0.4, Math.PI / 2),
at(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), trim), 0, -0.12, 0.05, 0.2));
gun.position.set(0.3, 1.08, 0.32);
const head = at(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), armor), 0, 1.66, 0);
const visor = at(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.05), visorMat), 0, 1.68, 0.18);
g.add(legL, legR, bootL, bootR, body, chest, belt, padL, padR,
armR, armL, gun, head, visor);
const hpBar = new THREE.Group();
const hpFg = barSprite(0x52b788, 0.9);
hpFg.position.z = 0.001;
hpBar.add(barSprite(0x0d1b2e, 0.95), hpFg);
hpBar.position.set(0, 2.12, 0);
const nameSp = at(makeNameSprite(nm || tm, tm), 0, 2.32, 0);
g.add(hpBar, nameSp);
let hpFrac = 1;
const h = {
group: g, head, body, legL, legR, armL, armR, gun, visor, visorMat,
hpBar, nameSprite: nameSp, polarity: tm === 'solaris' ? 'gold' : 'violet',
setHp(frac) {
hpFrac = frac < 0 ? 0 : (frac > 1 ? 1 : frac);
hpFg.scale.x = 0.9 * hpFrac;
hpFg.visible = hpFrac > 0;
_tmpColor.copy(_hpGreen).lerp(_hpRed, 1 - hpFrac);
hpFg.material.color.copy(_tmpColor);
},
};
return h;
}
