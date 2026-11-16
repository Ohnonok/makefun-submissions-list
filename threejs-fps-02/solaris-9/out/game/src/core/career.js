const KEY = 'solaris9_astral_credits';
export const SPECIALIZATIONS = [
{ id: 'vanguard', nm: 'Vanguard', cost: 150 }, { id: 'recon', nm: 'Recon', cost: 250 },
{ id: 'sentinel', nm: 'Sentinel', cost: 400 }, { id: 'nova', nm: 'NOVA ORACLE', cost: 600 },
];
let credits = 0, earned = 0, active = '';
const unlocked = { vanguard: false, recon: false, sentinel: false, nova: false };
export function load() {
try {
const d = JSON.parse(localStorage.getItem(KEY) || 'null');
if (d) {
credits = (d.credits | 0) || 0; earned = (d.earned | 0) || 0;
for (const s of SPECIALIZATIONS) unlocked[s.id] = !!(d.unlocked && d.unlocked[s.id]);
active = d.active || '';
}
} catch (e) {   }
return credits;
}
export function save() {
try { localStorage.setItem(KEY, JSON.stringify({ credits, earned, unlocked, active })); }
catch (e) {   }
}
export function addCredits(n) { credits += n; earned += n; save(); return credits; }
export function setCredits(n) { credits = n; save(); return credits; }
export function isUnlocked(id) { return !!unlocked[id]; }
export function unlock(id) {
let spec = null;
for (const s of SPECIALIZATIONS) if (s.id === id) spec = s;
if (!spec || unlocked[id]) return !!unlocked[id];
if (credits < spec.cost) return false;
credits -= spec.cost; unlocked[id] = true; active = id; save();
return true;
}
export function syncState(state) {
const copy = {};
for (const s of SPECIALIZATIONS) copy[s.id] = unlocked[s.id];
state.career = { credits, earned, unlocked: copy, active, isUnlocked };
return state.career;
}
