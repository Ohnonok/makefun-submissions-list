const KNEE = 0.5;
const EPS = 0.000001;
export function moveWithCollision(pos, vel, dt, cols, bounds, radius) {
const r = radius === undefined ? 0.4 : radius;
let prev = pos.x;
pos.x += vel.x * dt;
resolveAxis(pos, prev, vel.x, r, cols, 0);
prev = pos.z;
pos.z += vel.z * dt;
resolveAxis(pos, prev, vel.z, r, cols, 2);
if (pos.x < bounds.minX + r) pos.x = bounds.minX + r;
if (pos.x > bounds.maxX - r) pos.x = bounds.maxX - r;
if (pos.z < bounds.minZ + r) pos.z = bounds.minZ + r;
if (pos.z > bounds.maxZ - r) pos.z = bounds.maxZ - r;
}
function resolveAxis(pos, prev, v, r, cols, axis) {
if (v === 0) return;
for (let i = 0; i < cols.length; i++) {
const c = cols[i];
if (c.h <= KNEE || pos.y > c.h) continue;
if (pos.x + r <= c.minX + EPS || pos.x - r >= c.maxX - EPS) continue;
if (pos.z + r <= c.minZ + EPS || pos.z - r >= c.maxZ - EPS) continue;
const mn = axis === 0 ? c.minX : c.minZ, mx = axis === 0 ? c.maxX : c.maxZ;
const p = axis === 0 ? pos.x : pos.z;
let np;
if (prev + r <= mn) np = mn - r;
else if (prev - r >= mx) np = mx + r;
else np = p - (mn - r) < mx + r - p ? mn - r : mx + r;
if (axis === 0) pos.x = np; else pos.z = np;
}
}
export function pushOut(pos, radius, cols) {
let pushed = false;
for (let i = 0; i < cols.length; i++) {
const c = cols[i];
if (c.h <= KNEE || pos.y > c.h) continue;
const cx = pos.x < c.minX ? c.minX : pos.x > c.maxX ? c.maxX : pos.x;
const cz = pos.z < c.minZ ? c.minZ : pos.z > c.maxZ ? c.maxZ : pos.z;
const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
if (d2 >= radius * radius) continue;
if (d2 > 0.000001) {
const d = Math.sqrt(d2);
pos.x = cx + (dx / d) * radius;
pos.z = cz + (dz / d) * radius;
} else {
const l = pos.x - c.minX, rr = c.maxX - pos.x, t = pos.z - c.minZ, b = c.maxZ - pos.z;
const m = Math.min(l, rr, t, b);
if (m === l) pos.x = c.minX - radius;
else if (m === rr) pos.x = c.maxX + radius;
else if (m === t) pos.z = c.minZ - radius;
else pos.z = c.maxZ + radius;
}
pushed = true;
}
return pushed;
}
export function segmentVsAABB(ax, az, bx, bz, c) {
let t0 = 0, t1 = 1;
for (let k = 0; k < 2; k++) {
const a = k === 0 ? ax : az, d = (k === 0 ? bx : bz) - a;
const mn = k === 0 ? c.minX : c.minZ, mx = k === 0 ? c.maxX : c.maxZ;
if (d === 0) { if (a < mn || a > mx) return -1; continue; }
let ta = (mn - a) / d, tb = (mx - a) / d;
if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
if (ta > t0) t0 = ta;
if (tb < t1) t1 = tb;
if (t0 > t1) return -1;
}
return t0;
}
