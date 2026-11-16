const W = 160, H = 120;
const _tmpPt = { x: 0, y: 0 };
const SQUAD_ORDERS = ['A-DOME SPLIT', 'MID PYLON PUSH', 'SITE B ANCHOR'];
function squadOrder(state) {
const o = state && state.squadOrder;
if (o == null) return { n: 1, nm: SQUAD_ORDERS[0] };
if (typeof o === 'number') {
const n = o >= 1 && o <= 3 ? o : 1;
return { n: n, nm: SQUAD_ORDERS[n - 1] };
}
if (typeof o === 'string') {
const m = /^(\d)\s*[:\-]?\s*(.*)$/.exec(o);
if (m && m[2]) return { n: +m[1], nm: m[2] };
if (m) return { n: +m[1], nm: SQUAD_ORDERS[+m[1] - 1] };
return { n: 1, nm: o };
}
const n = (o.id || o.num || o.order || 1);
const nn = n >= 1 && n <= 3 ? n : 1;
return { n: nn, nm: o.nm || o.label || o.title || SQUAD_ORDERS[nn - 1] };
}
function boundsOf(mp) {
if (mp && mp.bounds) return mp.bounds;
return { minX: -32, maxX: 32, minZ: -24, maxZ: 24 };
}
export function mkMM(canvas, mp) {
const cv = canvas || document.getElementById('minimap');
const ctx = cv ? cv.getContext('2d') : null;
if (cv) { cv.width = W; cv.height = H; }
const b = boundsOf(mp);
const walls = [];
if (mp && mp.cols) {
for (let i = 0; i < mp.cols.length; i++) {
const c = mp.cols[i];
walls.push({ x0: c.minX, z0: c.minZ, x1: c.maxX, z1: c.maxZ });
}
}
const sites = mp && mp.sites ? mp.sites : { A: { x: -22, z: 0 }, B: { x: 22, z: 0 } };
const mm = { cv, ctx, b, walls, sites, sx: W / (b.maxX - b.minX), sz: H / (b.maxZ - b.minZ) };
return mm;
}
function toMap(mm, x, z) {
_tmpPt.x = (x - mm.b.minX) * mm.sx;
_tmpPt.y = (z - mm.b.minZ) * mm.sz;
return _tmpPt;
}
export function drawMM(mm, state) {
const ctx = mm.ctx;
if (!ctx) return;
ctx.clearRect(0, 0, W, H);
ctx.save();
ctx.beginPath();
ctx.arc(80, 60, 58, 0, 6.2832);
ctx.fillStyle = 'rgba(13,27,46,0.82)';
ctx.fill();
ctx.clip();
ctx.fillStyle = '#1d3557';
for (let i = 0; i < mm.walls.length; i++) {
const w = mm.walls[i];
const a = toMap(mm, w.x0, w.z0);
const ax = a.x, ay = a.y;
const b2 = toMap(mm, w.x1, w.z1);
ctx.fillRect(ax, ay, Math.max(1, b2.x - ax), Math.max(1, b2.y - ay));
}
ctx.font = 'bold 11px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
const keys = ['A', 'B'];
for (let i = 0; i < 2; i++) {
const s = mm.sites[keys[i]];
if (!s) continue;
const p = toMap(mm, s.x, s.z);
ctx.beginPath();
ctx.arc(p.x, p.y, 8, 0, 6.2832);
ctx.strokeStyle = keys[i] === 'A' ? '#f4a261' : '#48cae4';
ctx.lineWidth = 1.5;
ctx.stroke();
ctx.fillStyle = '#ede8dc';
ctx.fillText(keys[i], p.x, p.y);
}
ctx.font = 'bold 7px system-ui, sans-serif';
ctx.textAlign = 'left';
ctx.textBaseline = 'middle';
ctx.fillStyle = '#f4a261';
ctx.fillText('SOLARIS DOME', 32, 42);
ctx.fillStyle = '#ede8dc';
ctx.fillText('SITE A', 36, 88);
ctx.textAlign = 'center';
ctx.fillStyle = '#48cae4';
ctx.fillText('ASTRAL MID', 80, 30);
const bm = state ? state.bm : null;
if (bm && (bm.state === 'planted' || bm.state === 'dropped') && bm.x != null) {
const p = toMap(mm, bm.x, bm.z);
ctx.fillStyle = '#ef476f';
ctx.beginPath();
ctx.arc(p.x, p.y, 3.5, 0, 6.2832);
ctx.fill();
}
const ts = state ? state.tripSensor : null;
if (ts && ts.active !== false && ts.x1 != null && ts.x2 != null) {
const a = toMap(mm, ts.x1, ts.z1);
const ax = a.x, ay = a.y;
const b2 = toMap(mm, ts.x2, ts.z2);
ctx.beginPath();
ctx.moveTo(ax, ay);
ctx.lineTo(b2.x, b2.y);
ctx.strokeStyle = '#48cae4';
ctx.lineWidth = 2;
ctx.stroke();
}
const ps = state ? state.plrs : null;
if (ps) {
for (let i = 0; i < ps.length; i++) {
const q = ps[i];
if (q.hp <= 0 || q.x == null) continue;
const friendly = q.tm === 'solaris';
if (!friendly && !q.visible && !q.heard && !q.detected && !q.tripDetected && !q.sensorDetected) continue;
const p = toMap(mm, q.x, q.z);
ctx.fillStyle = friendly ? '#48cae4' : '#ef476f';
ctx.beginPath();
if (q.isPlayer) {
const a = q.yaw || 0;
ctx.moveTo(p.x + Math.sin(a) * 5, p.y - Math.cos(a) * 5);
ctx.lineTo(p.x + Math.sin(a + 2.5) * 4, p.y - Math.cos(a + 2.5) * 4);
ctx.lineTo(p.x + Math.sin(a - 2.5) * 4, p.y - Math.cos(a - 2.5) * 4);
ctx.closePath();
} else { ctx.arc(p.x, p.y, 3, 0, 6.2832); }
ctx.fill();
if (friendly) { ctx.strokeStyle = '#ede8dc'; ctx.lineWidth = 1; ctx.stroke(); }
}
}
ctx.restore();
ctx.beginPath();
ctx.arc(80, 60, 58, 0, 6.2832);
ctx.strokeStyle = 'rgba(244,162,97,0.9)';
ctx.lineWidth = 2;
ctx.stroke();
const so = squadOrder(state);
ctx.fillStyle = 'rgba(13,27,46,0.95)';
ctx.fillRect(28, 3, 104, 13);
ctx.strokeStyle = '#f4a261';
ctx.lineWidth = 1;
ctx.strokeRect(28.5, 3.5, 103, 12);
ctx.font = 'bold 8px system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillStyle = '#f4a261';
ctx.fillText(so.n + ': ' + so.nm, 80, 10);
}
