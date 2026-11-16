import * as THREE from 'three';
import { MAP } from './config.js';
import { moveWithCollision, pushOut } from '../world/collision.js';
const ACCEL = 40;
const FRICTION = 9;
const WALK_SPEED = 4.4;
const CROUCH_SPEED = 2.2;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.15;
const GRAVITY = 14;
const JUMP_VEL = 5.0;
const PLAYER_RADIUS = 0.35;
const _tmpVec1 = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _vel = { x: 0, y: 0, z: 0 };
function collidersOf(state) {
if (!state) return null;
return state.cols || (state.mp && state.mp.cols)
|| (state.world && state.world.cols) || null;
}
function boundsOf(state) {
if (state && state.mp && state.mp.bounds) return state.mp.bounds;
if (state && state.world && state.world.bounds) return state.world.bounds;
return MAP;
}
export function resolveCircle(pos, radius, cols) {
if (typeof pushOut === 'function') { pushOut(pos, radius, cols); return; }
}
export function moveBody(body, wishX, wishZ, dt, maxSpeed) {
_tmpVec1.set(wishX, 0, wishZ);
const wl = _tmpVec1.length();
if (wl > 0.001) {
_tmpVec1.multiplyScalar(1 / Math.max(wl, 1));
body.vel.x += _tmpVec1.x * ACCEL * dt;
body.vel.z += _tmpVec1.z * ACCEL * dt;
const sp = Math.sqrt(body.vel.x * body.vel.x + body.vel.z * body.vel.z);
if (sp > maxSpeed) {
const k = maxSpeed / sp;
body.vel.x *= k; body.vel.z *= k;
}
} else {
const f = Math.max(0, 1 - FRICTION * dt);
body.vel.x *= f; body.vel.z *= f;
if (Math.abs(body.vel.x) < 0.01) body.vel.x = 0;
if (Math.abs(body.vel.z) < 0.01) body.vel.z = 0;
}
body.pos.x += body.vel.x * dt;
body.pos.z += body.vel.z * dt;
}
export function updPlayer(state, input, dt) {
const p = state && state.plrs ? state.plrs[0] : null;
if (!p || !p.alive) return;
if (input.lookDX) p.yaw -= input.lookDX * 0.0022;
if (input.lookDY) {
p.pitch -= input.lookDY * 0.0022;
if (p.pitch > 1.45) p.pitch = 1.45;
if (p.pitch < -1.45) p.pitch = -1.45;
}
p.crouched = !!input.crouch;
p.crouching = p.crouched;
const maxSpeed = p.crouched ? CROUCH_SPEED : WALK_SPEED;
const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
const ix = (input.r ? 1 : 0) - (input.l ? 1 : 0);
const iz = (input.f ? 1 : 0) - (input.b ? 1 : 0);
_tmpVec2.set(-sy, 0, -cy);
_tmpVec1.set(0, 0, 0).addScaledVector(_tmpVec2, iz);
_tmpVec1.x += cy * ix; _tmpVec1.z += -sy * ix;
const wl = _tmpVec1.length();
if (wl > 1) _tmpVec1.multiplyScalar(1 / wl);
if (wl > 0.001) {
p.vx += _tmpVec1.x * ACCEL * dt;
p.vz += _tmpVec1.z * ACCEL * dt;
const sp = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
if (sp > maxSpeed) { const k = maxSpeed / sp; p.vx *= k; p.vz *= k; }
} else {
const f = Math.max(0, 1 - FRICTION * dt);
p.vx *= f; p.vz *= f;
if (Math.abs(p.vx) < 0.01) p.vx = 0;
if (Math.abs(p.vz) < 0.01) p.vz = 0;
}
p.speed = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
p.walkPhase += p.speed * dt * 1.6;
if (input.jump && p.grounded) { p.vy = JUMP_VEL; p.grounded = false; }
if (!p.grounded) {
p.vy -= GRAVITY * dt;
p.pos.y += p.vy * dt;
if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.grounded = true; }
}
p.inAir = !p.grounded;
p.pos.x = p.x; p.pos.z = p.z;
_vel.x = p.vx; _vel.y = 0; _vel.z = p.vz;
moveWithCollision(p.pos, _vel, dt, collidersOf(state), boundsOf(state), PLAYER_RADIUS);
p.x = p.pos.x; p.z = p.pos.z;
const targetEye = p.crouched ? EYE_CROUCH : EYE_STAND;
p.eyeHeight += (targetEye - p.eyeHeight) * Math.min(1, 10 * dt);
}
