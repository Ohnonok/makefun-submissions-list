const $ = (id) => document.getElementById(id);
function fmtTime(s) {
s = Math.max(0, Math.ceil(s));
const m = (s / 60) | 0;
const r = s - m * 60;
return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}
function localPlayer(state) {
if (state.player) return state.player;
const ps = state.plrs;
if (!ps || !ps.length) return null;
for (let i = 0; i < ps.length; i++) if (ps[i].isPlayer) return ps[i];
return ps[0];
}
export function createHud(state) {
const el = {
root: $('hd'), health: $('health-num'), armor: $('armor-num'), mag: $('ammo-mag'), reserve: $('ammo-reserve'),
timer: $('timer'), score: $('score'), cash: $('cash-num'), alive: $('alive'), roundLabel: $('round-label'),
popup: $('headshot-popup'), flash: $('damage-flash'), hit: $('hitmarker'), prompt: $('plant-prompt'),
progress: $('plant-progress'), minimap: $('minimap'),
};
const mkLine = (id, css, anchor) => {
let n = $(id);
if (n || !el.root) return n;
n = document.createElement('div');
n.id = id;
n.style.cssText = css;
if (anchor) el.root.insertBefore(n, anchor);
else el.root.appendChild(n);
return n;
};
const base = 'position:absolute;left:12px;max-width:560px;padding:3px 8px;font:11px ui-monospace,Menlo,Consolas,monospace;background:rgba(13,27,46,0.82);border-radius:4px;white-space:nowrap;display:none;letter-spacing:0.5px;';
el.cmd = mkLine('cmd-line', base + 'top:12px;color:#48cae4;border:1px solid rgba(72,202,228,0.5);', el.minimap);
el.plan = mkLine('plan-line', base + 'top:12px;font-weight:700;color:#f4d35e;border:1px solid rgba(244,211,94,0.5);', el.cmd || el.minimap);
el.bounty = mkLine('bounty-line', base + 'top:485px;font-weight:700;color:#f4d35e;border:1px solid rgba(244,211,94,0.5);', null);
const hd = {
el, state,
last: { hp: -1, armor: -1, mag: -1, reserve: -1, time: '', score: '', cash: -1, alive: '', round: '', phase: '', cmd: '', bounty: '', plan: '', shift: -1 },
popupT: 0,
};
if (el.flash) el.flash.style.opacity = '0';
if (el.popup) el.popup.style.opacity = '0';
if (el.progress) el.progress.style.width = '0%';
return hd;
}
export function setHudVis(hd, v) {
const r = (hd && hd.el && hd.el.root) || document.getElementById('hd');
if (r) r.style.display = v ? '' : 'none';
}
function setText(node, value, last, key, hd) {
if (!node) return;
if (hd.last[key] !== value) { hd.last[key] = value; node.textContent = value; }
}
export function updateHud(hd, state, dt) {
const p = localPlayer(state);
const L = hd.last;
if (p) {
setText(hd.el.health, String(Math.max(0, Math.ceil(p.hp == null ? 100 : p.hp))), L, 'hp', hd);
setText(hd.el.armor, String(Math.max(0, Math.ceil(p.armor == null ? 0 : p.armor))) + (p.hasHelmet ? '+H' : ''), L, 'armor', hd);
const mag = p.mag != null ? p.mag : (p.ammo ? p.ammo.mag : 0);
const res = p.reserve != null ? p.reserve : (p.ammo ? p.ammo.reserve : 0);
setText(hd.el.mag, String(mag), L, 'mag', hd);
setText(hd.el.reserve, String(res), L, 'reserve', hd);
const cash = p.cash != null ? p.cash : (state.economy ? state.economy.cash : 0);
setText(hd.el.cash, '$' + cash, L, 'cash', hd);
}
setText(hd.el.timer, fmtTime(state.timeLeft == null ? 100 : state.timeLeft), L, 'time', hd);
const sc = state.score || { solaris: 0, voidborne: 0 };
setText(hd.el.score, 'SOLARIS ' + sc.solaris + ' — ' + sc.voidborne + ' ECLIPSE', L, 'score', hd);
if (state.plrs) {
let s = 0, v = 0;
for (let i = 0; i < state.plrs.length; i++) {
const q = state.plrs[i];
if (q.hp > 0) { if (q.tm === 'solaris') s++; else v++; }
}
setText(hd.el.alive, s + ' v ' + v, L, 'alive', hd);
}
const round = state.round == null ? 1 : state.round;
setText(hd.el.roundLabel, 'ROUND ' + round + ' OF 15', L, 'round', hd);
const planTxt = state && state.plan ? 'PLAN: ' + String(state.plan) : '';
if (hd.el.plan) {
if (L.plan !== planTxt) {
L.plan = planTxt;
hd.el.plan.textContent = planTxt;
hd.el.plan.style.display = planTxt ? 'block' : 'none';
if (hd.el.cmd) hd.el.cmd.style.top = planTxt ? '38px' : '12px';
}
}
if (hd.el.cmd) {
const raw = state && state.cmdLine ? String(state.cmdLine) : '';
const cmd = raw ? (raw.indexOf('[CMD]') === 0 ? raw : '[CMD]: ' + raw) : '';
if (L.cmd !== cmd) {
L.cmd = cmd;
hd.el.cmd.textContent = cmd;
hd.el.cmd.style.display = cmd ? 'block' : 'none';
}
const shift = (planTxt ? 26 : 0) + (cmd ? 26 : 0);
if (L.shift !== shift) {
L.shift = shift;
if (hd.el.minimap) hd.el.minimap.style.top = shift ? (12 + shift) + 'px' : '';
if (hd.el.alive) hd.el.alive.style.top = shift ? (140 + shift) + 'px' : '';
if (hd.el.bounty) hd.el.bounty.style.top = '485px';
}
}
if (hd.el.bounty) {
const b = state && state.bounty;
const txt = b && !b.done ? String(b.label || '') : '';
if (L.bounty !== txt) {
L.bounty = txt;
hd.el.bounty.textContent = txt;
hd.el.bounty.style.display = txt ? 'block' : 'none';
}
}
const b = state.bm;
if (hd.el.prompt) {
let msg = '';
if (state.phase === 'planted') msg = b && b.defusing ? 'Defusing the charge (Hold E)' : 'BOMB PLANTED — DEFEND THE SITE';
else if (b && b.canPlant) msg = 'HOLD E — PLANT THE SPIKE';
else if (b && b.canDefuse) msg = 'HOLD E — DEFUSE THE SPIKE';
if (hd.last.prompt !== msg) { hd.last.prompt = msg; hd.el.prompt.textContent = msg; hd.el.prompt.style.display = msg ? 'block' : 'none'; }
}
if (hd.el.progress) {
const prog = b && b.progress != null ? b.progress : 0;
const pct = Math.round(Math.max(0, Math.min(1, prog)) * 100);
if (hd.last.prog !== pct) { hd.last.prog = pct; hd.el.progress.style.width = pct + '%'; }
}
if (hd.popupT > 0) {
hd.popupT -= dt;
if (hd.popupT <= 0 && hd.el.popup) hd.el.popup.style.opacity = '0';
}
if (hd.hitT > 0) {
hd.hitT -= dt;
if (hd.hitT <= 0 && hd.el.hit) hd.el.hit.style.opacity = '0';
}
}
export function popup(hd, text) {
if (!hd.el.popup) return;
hd.el.popup.textContent = text;
hd.el.popup.style.opacity = '1';
hd.popupT = 1.1;
}
export function hitmark(hd, kill) {
if (!hd.el.hit) return;
hd.el.hit.style.opacity = '1';
hd.el.hit.className = kill ? 'hit kill' : 'hit';
hd.hitT = 0.18;
}
export function setPhase(hd, phase) {
if (!hd) return;
if (hd.last.phase !== phase) {
hd.last.phase = phase;
if (hd.el.root) hd.el.root.setAttribute('data-phase', phase);
if (hd.el.roundLabel && hd.state) {
const r = hd.state.round == null ? 1 : hd.state.round;
hd.el.roundLabel.textContent = phase === 'buy'
? 'ROUND ' + r + ' — BUY PHASE'
: 'ROUND ' + r + ' OF 15';
hd.last.round = hd.el.roundLabel.textContent;
}
}
}
