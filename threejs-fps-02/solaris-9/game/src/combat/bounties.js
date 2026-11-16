export const BOUNTIES = [
{ id: 'crouch-hs', label: 'BOUNTY: CROUCH HEADSHOT (+$800)', reward: 800 },
{ id: 'pylon-kill', label: 'BOUNTY: PYLON REFRACT KILL (+$600)', reward: 600 },
{ id: 'defuse', label: 'BOUNTY: DEFUSE UNDER FIRE (+$1000)', reward: 1000 },
];
export function pickBnty(state) {
const i = ((state.seed || 0) + (state.round || 1)) % BOUNTIES.length;
const b = BOUNTIES[i];
state.bounty = { id: b.id, label: b.label, reward: b.reward, done: false };
return state.bounty;
}
export function chkBnty(state, ev) {
const b = state && state.bounty;
if (!b || b.done || !ev) return 0;
let hit = false;
if (b.id === 'crouch-hs') hit = ev.type === 'kill' && !!ev.headshot && !!ev.crouched;
else if (b.id === 'pylon-kill') hit = ev.type === 'kill' && !!ev.viaPylon;
else if (b.id === 'defuse') hit = ev.type === 'defuse' && !!ev.underFire;
if (!hit) return 0;
b.done = true;
const ps = state.plrs;
if (ps) for (let i = 0; i < ps.length; i++) {
if (ps[i].isPlayer && typeof ps[i].cash === 'number') {
ps[i].cash = Math.min(16000, ps[i].cash + b.reward);
break;
}
}
return b.reward;
}
