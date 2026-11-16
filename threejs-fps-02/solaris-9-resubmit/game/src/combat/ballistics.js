import * as THREE from 'three';
import { fireShot } from './shooting.js';
import { spreadAngle } from './spray.js';
import { updateTracers } from './tracer.js';
import { getShooterHeat, addHeat, updateHeat, isOverheated, HEAT_PER_SHOT } from './heat.js';
export const _scratchOrigin = new THREE.Vector3(), _scratchDir = new THREE.Vector3();
export const _scratchRay = new THREE.Raycaster(), _tmpRay = new THREE.Raycaster();
export const _tmpVec1 = new THREE.Vector3(), _tmpVec2 = new THREE.Vector3();
export const _tmpQuat = new THREE.Quaternion(), _tmpMat4 = new THREE.Matrix4();
const _heats = [];
export const ballistics = {
fireShot(state, shooter, targets) {
const wid = (shooter && shooter.wId) || 'rifle';
const h = getShooterHeat(shooter, wid);
if (h && _heats.indexOf(h) < 0) _heats.push(h);
if (h && shooter && shooter.isPlayer && state) state.heat = h;
if (h && isOverheated(h)) return fireShot(state, { alive: false }, targets);
const ns0 = shooter ? shooter.nextShotAt : 0;
const res = fireShot(state, shooter, targets);
if (h && shooter && shooter.nextShotAt !== ns0) addHeat(h, HEAT_PER_SHOT[wid]);
return res;
},
getSpread(s) {
return s ? spreadAngle(s.wId || 'rifle', s.spray || { heat: 0 }, s) : 0;
},
update(dt, state) {
updateTracers(dt);
for (let i = 0; i < _heats.length; i++) updateHeat(_heats[i], dt);
const h = state && state.heat;
if (h && _heats.indexOf(h) < 0) updateHeat(h, dt);
},
};
