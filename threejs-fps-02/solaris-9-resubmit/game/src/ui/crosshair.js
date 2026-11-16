const BASE = 6;
export function mkCross() {
const root = document.getElementById('crosshair');
if (!root) return null;
let lines = root.children;
if (lines.length < 4) {
for (let i = lines.length; i < 4; i++) {
const d = document.createElement('div');
d.className = 'ch-line';
root.appendChild(d);
}
lines = root.children;
}
return { root, top: lines[0], right: lines[1], bottom: lines[2], left: lines[3], gap: BASE, len: 9 };
}
function spreadOf(state) {
const p = state.player || (state.plrs && state.plrs[0]);
if (!p) return 0;
if (p.spread != null) return p.spread;
let s = 0;
const v = p.speed || 0;
s += v * 2.2;
if (p.inAir) s += 6;
if (p.firing) s += 7;
if (p.crouching) s -= 4;
if (v < 0.2) s -= 3;
return Math.max(0, s);
}
export function updCross(ch, state) {
if (!ch) return;
const gap = BASE + spreadOf(state);
if (Math.abs(gap - ch.gap) < 0.25) return;
ch.gap = gap;
const g = gap.toFixed(1) + 'px';
const l = ch.len + 'px';
ch.top.style.transform = 'translate(-50%,0)';
ch.top.style.left = '50%'; ch.top.style.top = 'calc(50% - ' + g + ' - ' + l + ')';
ch.top.style.width = '2px'; ch.top.style.height = l;
ch.bottom.style.left = '50%'; ch.bottom.style.top = 'calc(50% + ' + g + ')';
ch.bottom.style.width = '2px'; ch.bottom.style.height = l;
ch.left.style.top = '50%'; ch.left.style.left = 'calc(50% - ' + g + ' - ' + l + ')';
ch.left.style.height = '2px'; ch.left.style.width = l;
ch.right.style.top = '50%'; ch.right.style.left = 'calc(50% + ' + g + ')';
ch.right.style.height = '2px'; ch.right.style.width = l;
}
