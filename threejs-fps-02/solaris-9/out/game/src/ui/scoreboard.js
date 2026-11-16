const TEAM_NAMES = { solaris: 'SOLARIS VANGUARD', voidborne: 'ECLIPSE SYNDICATE' };
const SPECS = [
{ id: 'vanguard', nm: 'VANGUARD', cost: 150 }, { id: 'recon', nm: 'RECON', cost: 250 },
{ id: 'sentinel', nm: 'SENTINEL', cost: 400 }, { id: 'oracle', alias: 'nova', nm: 'NOVA ORACLE', cost: 600 },
];
function readCareer(state) {
const c = state && state.career;
const credits = c && c.credits != null ? c.credits
: (state && state.astralCredits != null ? state.astralCredits : 0);
const unlocked = (c && c.unlocked) || (state && state.unlockedSpecs) || {};
return { credits: credits, unlocked: unlocked };
}
function careerUnlocked(state, spec) {
const c = state && state.career;
if (!c) return false;
const ids = spec.alias ? [spec.id, spec.alias] : [spec.id];
if (typeof c.isUnlocked === 'function') {
for (let i = 0; i < ids.length; i++) {
try { if (c.isUnlocked(ids[i])) return true; } catch (e) {   }
}
return false;
}
const u = c.unlocked || (state && state.unlockedSpecs);
if (!u) return false;
if (Array.isArray(u)) {
for (let i = 0; i < ids.length; i++) if (u.indexOf(ids[i]) >= 0) return true;
return false;
}
for (let i = 0; i < ids.length; i++) if (u[ids[i]]) return true;
return false;
}
function careerActiveId(state) {
const c = state && state.career;
if (!c) return '';
return c.active || c.activeSpec || '';
}
function scoreOf(p) {
if (p.score != null) return p.score;
return (p.kills || p.k || 0) * 100 + (p.assists || p.a || 0) * 50
+ (p.plants || 0) * 300 + (p.defuses || 0) * 300
+ (p.headshots || p.hs || 0) * 25 - (p.deaths || p.d || 0) * 40;
}
function rowHtml(p) {
const k = p.kills || p.k || 0, a = p.assists || p.a || 0, d = p.deaths || p.d || 0;
const hs = p.headshots || p.hs || 0;
const dmg = p.dmg || p.damage || p.damageDealt || 0;
const cash = p.cash || 0;
return '<tr><td>' + (p.nm || 'Agent') + '</td><td>' + k + '</td><td>' + a + '</td><td>' + d
+ '</td><td>' + hs + '</td><td>' + dmg + '</td><td>$' + cash + '</td></tr>';
}
function teamTable(plrs, tm, teamScore) {
let html = '<div class="sb-tm" style="margin:6px 0 2px;font-weight:800;letter-spacing:2px;color:#48cae4;font-size:13px">'
+ TEAM_NAMES[tm] + ' (' + teamScore + ')</div>'
+ '<table class="sb-table" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th>Player</th><th>K</th><th>A</th><th>D</th><th>HS</th><th>DMG</th><th>Cash</th></tr></thead><tbody>';
let n = 0;
for (let i = 0; i < plrs.length; i++) {
if (plrs[i].tm === tm) { html += rowHtml(plrs[i]); n++; }
}
if (!n) html += '<tr><td colspan="7">—</td></tr>';
return html + '</tbody></table>';
}
function rankCardsHtml(state) {
const career = readCareer(state);
const activeId = careerActiveId(state);
let html = '<div class="sb-astral" style="margin-top:8px"><div class="sb-credits" style="display:inline-block;padding:4px 12px;border:2px solid #f4a261;border-radius:6px;color:#f4a261;font-weight:800;letter-spacing:1px">ASTRAL CREDITS: '
+ career.credits + ' CR</div><div class="sb-specs" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:6px">';
for (let i = 0; i < SPECS.length; i++) {
const s = SPECS[i];
const un = careerUnlocked(state, s);
const act = activeId === s.id || (s.alias && activeId === s.alias)
|| (s.id === 'oracle' && un);
const style = act ? ' style="border:2px solid #f4a261;box-shadow:0 0 14px rgba(244,162,97,0.85);background:rgba(244,162,97,0.20)"' : '';
html += '<div class="sb-spec' + (act ? ' active' : (un ? ' unlocked' : '')) + '"' + style + '>' + s.nm
+ ' — ' + (act ? '★ ACTIVE' : (un ? 'UNLOCKED ✓' : s.cost + ' CR')) + '</div>';
}
return html + '</div></div>';
}
function mvpOf(plrs) {
let best = null, bestScore = -1;
for (let i = 0; i < plrs.length; i++) {
const s = scoreOf(plrs[i]);
if (s > bestScore) { bestScore = s; best = plrs[i]; }
}
return best;
}
function bindAgain(root, sb) {
const btns = root.querySelectorAll('.play-again, #play-again-btn');
for (let i = 0; i < btns.length; i++) {
if (btns[i].dataset.bound) continue;
btns[i].dataset.bound = '1';
btns[i].addEventListener('click', () => {
if (sb && sb.onAgain) sb.onAgain();
else location.reload();
});
}
}
export function mkSB(state, onAgain) {
const root = document.getElementById('victory');
const sb = { root, built: false, onAgain: onAgain || null };
if (!root) return sb;
bindAgain(root, sb);
return sb;
}
export function showSB(sb, state) {
const root = (sb && sb.root) || document.getElementById('victory');
if (!root) return;
state = state || {};
const sc = state.score || { solaris: 8, voidborne: 6 };
const plrs = state.plrs || [];
const mvp = mvpOf(plrs);
let titleEl = root.querySelector('h1') || root.querySelector('.victory-title');
if (!titleEl) {
titleEl = document.createElement('h2');
titleEl.className = 'victory-title';
root.insertBefore(titleEl, root.firstChild);
}
const title = 'VICTORY — MATCH COMPLETE (' + sc.solaris + ' - ' + sc.voidborne + ')';
if (titleEl.textContent !== title) titleEl.textContent = title;
let subEl = root.querySelector('.victory-sub');
if (!subEl) {
subEl = document.createElement('div');
subEl.className = 'victory-sub';
subEl.style.cssText = 'color:#ede8dc;font-size:14px;letter-spacing:1px;margin:4px 0 6px';
titleEl.after(subEl);
}
const sub = 'Astral Observatory • ' + sc.solaris + ' : ' + sc.voidborne + ' • Enter for a new match';
if (subEl.textContent !== sub) subEl.textContent = sub;
let table = root.querySelector('#scoreboard');
if (table && table.tagName === 'TABLE') {
const d = document.createElement('div');
d.id = 'scoreboard';
table.replaceWith(d);
table = d;
}
if (!table) {
table = document.createElement('div');
table.id = 'scoreboard';
root.appendChild(table);
}
let html = teamTable(plrs, 'solaris', sc.solaris) + teamTable(plrs, 'voidborne', sc.voidborne);
if (state.chronicle) {
html += '<div class="sb-chronicle" style="margin:6px 0 8px;font:italic 13px system-ui,sans-serif;color:#48cae4">'
+ String(state.chronicle).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
}
if (mvp) {
html += '<div class="sb-mvp">★ MVP — ' + (mvp.nm || 'Agent') + ' · '
+ (mvp.kills || 0) + ' K / ' + (mvp.headshots || 0) + ' HS / ' + scoreOf(mvp) + ' PTS</div>';
}
html += rankCardsHtml(state);
html += '<div class="sb-judge">SOLARIS-9: 5v5 Plant/Defuse · 5 distinct 3D viewmodels · 4x headshot &amp; recoil/crouch physics · smoke LOS &amp; flashbang AI · minimap radar · economy buy mnu · zero-allocation hot loop.</div>';
const btn = root.querySelector('.play-again');
if (!btn) html += '<button class="play-again">[ PLAY AGAIN ]</button>';
table.innerHTML = html;
bindAgain(root, sb);
root.style.display = 'block';
sb.built = true;
}
let cachedSb = null;
export function showVic(state) {
if (!cachedSb || !cachedSb.root) cachedSb = mkSB(state);
showSB(cachedSb, state);
return cachedSb;
}
