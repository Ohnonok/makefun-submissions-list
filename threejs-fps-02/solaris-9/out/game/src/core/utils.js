export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export function angleLerp(a, b, t) {
let d = (b - a) % (Math.PI * 2);
if (d > Math.PI) d -= Math.PI * 2;
if (d < -Math.PI) d += Math.PI * 2;
return a + d * t;
}
let _t0 = 0;
let _t1 = 1;
function slab(p, d, mn, mx) {
if (Math.abs(d) < 1e-9) return p >= mn && p <= mx;
let ta = (mn - p) / d;
let tb = (mx - p) / d;
if (ta > tb) { const t = ta; ta = tb; tb = t; }
if (ta > _t0) _t0 = ta;
if (tb < _t1) _t1 = tb;
return _t0 <= _t1;
}
export function segHitsAABB(ax, ay, az, bx, by, bz, c) {
_t0 = 0; _t1 = 1;
return slab(ax, bx - ax, c.minX, c.maxX)
&& slab(ay, by - ay, 0, c.h)
&& slab(az, bz - az, c.minZ, c.maxZ);
}
export function segHitsCylinder(ax, ay, az, bx, by, bz, c) {
const y0 = Math.min(ay, by);
const y1 = Math.max(ay, by);
if (y1 < 0 || y0 > c.h) return false;
const dx = bx - ax;
const dz = bz - az;
const fx = ax - c.x;
const fz = az - c.z;
const a = dx * dx + dz * dz;
if (a < 1e-12) return fx * fx + fz * fz <= c.r * c.r;
let t = -(fx * dx + fz * dz) / a;
t = t < 0 ? 0 : t > 1 ? 1 : t;
const cx = ax + dx * t - c.x;
const cz = az + dz * t - c.z;
return cx * cx + cz * cz <= c.r * c.r;
}
export function losBlocked(ax, ay, az, bx, by, bz, cols, smokes) {
for (let i = 0; i < cols.length; i++) { if (segHitsAABB(ax, ay, az, bx, by, bz, cols[i])) return true; }
for (let i = 0; i < smokes.length; i++) { if (segHitsCylinder(ax, ay, az, bx, by, bz, smokes[i])) return true; }
return false;
}
