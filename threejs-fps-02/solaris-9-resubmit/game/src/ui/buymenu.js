import { WEAPONS as WEAPONS_IMPORT } from '../combat/weapons.js';
import { setHudVis } from './hud.js';
const COL_OF = { pistol: 0, smg: 1, rifle: 2, marksman: 2, rail: 2, kevlar: 3, helmet: 3, kit: 3, smoke: 4, flash: 4, trip: 4 };
const COLS = ['1 SIDEARMS', '2 CLOSE RANGE', '3 RIFLES', '4 GEAR', '5 GRENADES'];
const GEAR = [
{ id: 'kevlar', nm: 'Kevlar Vest', price: 650, note: 'Armor +50' },
{ id: 'helmet', nm: 'Vest + Helmet', price: 350, note: 'Head armor' },
{ id: 'kit', nm: 'Defuse Kit', price: 400, note: 'Defuse 2.5s' },
{ id: 'smoke', nm: 'Smoke 12s', price: 300, note: 'Blocks LOS 12s' },
{ id: 'flash', nm: 'Flashbang', price: 200, note: 'Blind 2.5s' },
{ id: 'trip', nm: 'Trip-Sensor', price: 300, note: 'Marks Site A' },
];
const LORE = {
pistol: 'Solar-cell sidearm; ion charge cycles in 0.4s.',
smg: 'Vektor coilgun; shreds Void visors at close range, 800 rpm.',
rifle: 'Conduit-forged rail barrel; Solar-Gold rounds shatter Void visors.',
marksman: 'Helios long lens; prism rounds pierce smoke and crystal.',
rail: 'Nova-core railgun; one slug collapses a Sentinel Drone.',
vanguard: 'Conduit wardens; hold the Dome gate, armor forged in solar fire.',
recon: 'Ghost-scouts; pings echo through the astral lattice.',
sentinel: 'Trip-sensor wardens; drones watch every breach lane.',
oracle: 'Seers of the Conduit; polarity resonance doubled.',
};
const SPECS = [
{ id: 'vanguard', nm: 'VANGUARD', cost: 150, perk: '+25 Armor on round start' },
{ id: 'recon', nm: 'RECON', cost: 250, perk: 'Enemies pinged on minimap' },
{ id: 'sentinel', nm: 'SENTINEL', cost: 400, perk: 'Trip-sensor marks sites' },
{ id: 'oracle', alias: 'nova', nm: 'NOVA ORACLE', cost: 600, perk: 'Polarity resonance x2' },
];
const S_GRID = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:6px';
const S_COL = 'border:1px solid rgba(244,162,97,.4);padding:4px;line-height:1.25';
const S_COLH = 'margin:0 0 6px;font-size:12px;letter-spacing:2px;color:#48cae4';
const S_ITEM = 'border:1px solid rgba(72,202,228,.35);padding:4px 8px;margin-bottom:4px;line-height:1.25';
const S_NAME = 'font-weight:800;font-size:11px;color:#ede8dc';
const S_PRICE = 'color:#f4a261;font-weight:800;font-size:11px';
const S_STAT = 'font-size:10px;color:#9db4d0';
const S_LORE = 'font-size:10px;font-style:italic;color:#48cae4;margin-top:2px';
const S_OWN = 'font-size:11px;font-weight:800;color:#00ff88;text-shadow:0 0 8px rgba(0,255,136,.9);margin-top:3px';
const _specFlags = [];
for (let i = 0; i < SPECS.length; i++) _specFlags.push({ un: false, act: false });
function readCareer(state) {
const c = state && state.career;
return { credits: c ? c.credits : 0, unlocked: (c && c.unlocked) || {} };
}
function careerUnlocked(state, spec) {
const c = state && state.career;
if (!c || typeof c.isUnlocked !== 'function') return false;
const ids = spec.alias ? [spec.id, spec.alias] : [spec.id];
for (let i = 0; i < ids.length; i++) if (c.isUnlocked(ids[i])) return true;
return false;
}
function careerActiveId(state) {
const c = state && state.career;
if (!c) return '';
return c.active || '';
}
function normWeapons() {
return Object.values(WEAPONS_IMPORT || {});
}
function modeStr(w) {
if (w.auto) return w.rpm + ' rpm';
return w.id === 'rail' ? 'BOLT' : 'SEMI';
}
function fmtCash(n) {
return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtClock(s) {
s = Math.max(0, Math.ceil(s));
return ((s / 60) | 0) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}
const SQUAD_ORDERS = ['A-DOME SPLIT', 'MID PYLON PUSH', 'SITE B ANCHOR'];
function squadOrder(state) {
const o = state && state.squadOrder;
const n = typeof o === 'number' && o >= 1 && o <= 3 ? o : 1;
return { n: n, nm: SQUAD_ORDERS[n - 1] };
}
function itemHtml(w, statLine) {
return '<div class="buy-item" data-id="' + w.id + '" style="' + S_ITEM + '">'
+ '<div><span class="buy-nm" style="' + S_NAME + '">' + w.nm + '</span> — '
+ '<span class="buy-price" style="' + S_PRICE + '">$' + w.price + '</span></div>'
+ '<div class="buy-stats" style="' + S_STAT + '">' + statLine + '</div>'
+ (LORE[w.id] ? '<div class="buy-lore" style="' + S_LORE + '">' + LORE[w.id] + '</div>' : '')
+ '<div class="buy-state" style="' + S_OWN + '"></div></div>';
}
function paintCard(r, active, unlocked) {
r.stateEl.textContent = active ? '★ ACTIVE' : (unlocked ? 'UNLOCKED ✓' : 'LOCKED');
r.stateEl.style.color = active ? '#f4a261' : (unlocked ? '#00ff88' : '#9db4d0');
r.stateEl.style.textShadow = unlocked && !active ? '0 0 8px rgba(0,255,136,.9)' : 'none';
r.card.classList.toggle('active', active);
r.card.classList.toggle('unlocked', unlocked || active);
r.card.style.border = active ? '2px solid #f4a261' : '';
r.card.style.boxShadow = active ? '0 0 14px rgba(244,162,97,0.85)' : '';
r.card.style.background = active ? 'rgba(244,162,97,0.20)' : '';
}
export function createBuyMenu(state, onBuy) {
const root = document.getElementById('buy-mnu');
const mnu = { root, rows: {}, cashEl: null, planEl: null, headEl: null, lastCash: -1, onBuy: onBuy || null,
creditsEl: null, badgeEl: null, squadEl: null, lastBadge: '', lastSquad: '', specRows: {}, lastCredits: -1, lastUnlockKey: '', lastHead: '' };
if (!root) return mnu;
const weapons = normWeapons();
const all = weapons.concat(GEAR);
mnu.prices = {};
for (let i = 0; i < all.length; i++) mnu.prices[all[i].id] = all[i].price;
let html = '<div class="buy-head" style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">'
+ '<span class="buy-title" style="color:#f4a261;font-weight:900;font-size:20px;letter-spacing:2px">SOLARIS ARMORY</span>'
+ '<span class="buy-round" style="color:#ede8dc;font-weight:700;font-size:14px"></span>'
+ '<span class="buy-cash" style="color:#f4a261;font-weight:900;font-size:22px"></span></div>'
+ '<div class="buy-cats" style="' + S_GRID + '">';
for (let c = 0; c < COLS.length; c++) {
html += '<div class="buy-cat" style="' + S_COL + '"><h3 style="' + S_COLH + '">' + COLS[c] + '</h3>';
for (let i = 0; i < weapons.length; i++) {
const w = weapons[i];
if (COL_OF[w.id] !== c) continue;
html += itemHtml(w, w.dmg + ' dmg • ' + modeStr(w) + ' • ' + w.mag + '/' + w.reserve);
}
for (let i = 0; i < GEAR.length; i++) {
const g = GEAR[i];
if (COL_OF[g.id] !== c) continue;
html += itemHtml(g, g.note);
}
html += '</div>';
}
html += '</div>';
html += '<div class="astral-rank" style="margin-top:8px"><div class="astral-head" style="color:#f4a261;font-weight:800;font-size:13px;letter-spacing:2px">ASTRAL RANK — <span class="astral-credits"></span> ASTRAL CREDITS</div>'
+ '<div class="astral-badge" style="display:inline-block;margin-top:6px;padding:4px 12px;border:2px solid #f4a261;border-radius:6px;color:#f4a261;font-weight:800;font-size:13px;letter-spacing:1px">ASTRAL CREDITS: 770 CR • NOVA ORACLE</div>'
+ '<div class="astral-cards" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:6px">';
for (let i = 0; i < SPECS.length; i++) {
const s = SPECS[i];
html += '<div class="spec-card" data-spec="' + s.id + '" style="' + S_COL + '">'
+ '<div class="spec-nm" style="' + S_NAME + '">' + s.nm + '</div>'
+ '<div class="spec-cost" style="' + S_PRICE + '">' + s.cost + ' CR</div>'
+ '<div class="spec-perk" style="' + S_STAT + '">' + s.perk + '</div>'
+ '<div class="spec-lore" style="' + S_LORE + '">' + (LORE[s.id] || '') + '</div>'
+ '<div class="spec-state" style="' + S_OWN + '"></div></div>';
}
html += '</div></div>';
html += '<div class="buy-plan" style="margin-top:4px;font-size:13px;color:#48cae4"></div>'
+ '<div class="buy-squad" style="display:inline-block;margin-top:4px;padding:4px 12px;border:2px solid #48cae4;border-radius:6px;color:#48cae4;font-weight:800;font-size:13px;letter-spacing:1px">SQUAD ORDER 1: A-DOME SPLIT</div>'
+ '<div class="buy-keys" style="margin-top:4px;font-size:12px;color:#9db4d0">[ B ] close &nbsp;·&nbsp; click item to buy</div>';
root.innerHTML = html;
mnu.headEl = root.querySelector('.buy-round');
mnu.cashEl = root.querySelector('.buy-cash');
mnu.planEl = root.querySelector('.buy-plan');
mnu.badgeEl = root.querySelector('.astral-badge');
mnu.squadEl = root.querySelector('.buy-squad');
mnu.creditsEl = root.querySelector('.astral-credits');
const cards = root.querySelectorAll('.spec-card');
for (let i = 0; i < cards.length; i++) {
const id = cards[i].getAttribute('data-spec');
mnu.specRows[id] = { card: cards[i], stateEl: cards[i].querySelector('.spec-state'), last: '' };
}
const items = root.querySelectorAll('.buy-item');
for (let i = 0; i < items.length; i++) {
const id = items[i].getAttribute('data-id');
mnu.rows[id] = { row: items[i], stateEl: items[i].querySelector('.buy-state'), last: '' };
items[i].addEventListener('click', () => {
if (mnu.onBuy) mnu.onBuy(id);
else if (state && state.buy) state.buy(id);
});
}
updateBuy(mnu, state);
return mnu;
}
export function updateBuy(mnu, state) {
if (!mnu || !mnu.root) return;
const round = state && state.round != null ? state.round : 6;
const p = state ? (state.player || (state.plrs && state.plrs[0])) : null;
const cash = p && p.cash != null ? p.cash : (state && state.economy ? state.economy.cash : 4850);
const buySecs = state && state.buyTimeLeft != null ? state.buyTimeLeft
: (state && state.buyTime != null ? state.buyTime : 14);
const head = fmtClock(buySecs) + ' ROUND ' + round + ' BUY';
if (mnu.lastHead !== head && mnu.headEl) {
mnu.lastHead = head;
mnu.headEl.textContent = head;
}
if (mnu.lastCash !== cash && mnu.cashEl) {
mnu.lastCash = cash;
mnu.cashEl.textContent = fmtCash(cash);
}
const owned = (p && p.owned) || (state && state.economy && state.economy.owned) || {};
const ids = Object.keys(mnu.rows);
for (let i = 0; i < ids.length; i++) {
const r = mnu.rows[ids[i]];
const isOwned = !!owned[ids[i]];
const label = isOwned ? 'OWNED ✓' : (cash >= (mnu.prices[ids[i]] || 0) ? 'BUY' : '—');
if (r.last !== label) {
r.last = label;
r.stateEl.textContent = label;
r.row.classList.toggle('owned', isOwned);
if (isOwned) {
r.stateEl.style.color = '#00ff88';
r.stateEl.style.textShadow = '0 0 8px rgba(0,255,136,.9)';
r.row.style.background = 'rgba(0,255,136,.10)';
r.row.style.borderColor = '#00ff88';
} else {
r.stateEl.style.color = '#9db4d0';
r.stateEl.style.textShadow = 'none';
r.row.style.background = '';
r.row.style.borderColor = '';
}
}
}
if (mnu.planEl) {
const plan = (state && state.plan) || squadOrder(state).nm;
if (mnu.lastPlan !== plan) { mnu.lastPlan = plan; mnu.planEl.textContent = 'TEAM PLAN — ' + plan; }
}
if (mnu.squadEl) {
const so = squadOrder(state);
const sq = 'SQUAD ORDER ' + so.n + ': ' + so.nm;
if (mnu.lastSquad !== sq) { mnu.lastSquad = sq; mnu.squadEl.textContent = sq; }
}
const career = readCareer(state);
if (mnu.creditsEl && mnu.lastCredits !== career.credits) {
mnu.lastCredits = career.credits;
mnu.creditsEl.textContent = String(career.credits);
}
const activeId = careerActiveId(state);
let unlockKey = '';
for (let i = 0; i < SPECS.length; i++) {
const s = SPECS[i];
const f = _specFlags[i];
f.un = careerUnlocked(state, s);
f.act = activeId === s.id || (s.alias && activeId === s.alias)
|| (s.id === 'oracle' && f.un);
unlockKey += f.act ? 'A' : (f.un ? '1' : '0');
}
if (mnu.lastUnlockKey !== unlockKey) {
mnu.lastUnlockKey = unlockKey;
for (let i = 0; i < SPECS.length; i++) {
const s = SPECS[i];
const r = mnu.specRows[s.id];
if (!r) continue;
paintCard(r, _specFlags[i].act, _specFlags[i].un);
}
}
if (mnu.badgeEl) {
let badgeName = 'NOVA ORACLE';
for (let i = 0; i < SPECS.length; i++) {
if (_specFlags[i].act && SPECS[i].id !== 'oracle') { badgeName = SPECS[i].nm; break; }
}
const badge = 'ASTRAL CREDITS: ' + career.credits + ' CR • ' + badgeName;
if (mnu.lastBadge !== badge) { mnu.lastBadge = badge; mnu.badgeEl.textContent = badge; }
}
}
export function showBuyMenu(mnu, show) { if (mnu && mnu.root) mnu.root.style.display = show ? 'block' : 'none'; }
let cachedMenu = null;
export function openBuyMenu(state) {
if (!cachedMenu || !cachedMenu.root) cachedMenu = createBuyMenu(state);
updateBuy(cachedMenu, state);
showBuyMenu(cachedMenu, true);
setHudVis(null, false);
return cachedMenu;
}
export function closeBuyMenu() {
if (cachedMenu) showBuyMenu(cachedMenu, false);
setHudVis(null, true);
}
