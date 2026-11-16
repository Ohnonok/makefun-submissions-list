import * as THREE from 'three';
import { spawnTr } from './tracer.js';
const _burstA = new THREE.Vector3();
const _burstB = new THREE.Vector3();
export const POLARITY_COLORS = { gold: 0xf4a261, violet: 0x7b2fbe };
export const ARMOR_BONUS = 25;
export function getPolarity(state) {
if (state && (state.polarity === 'gold' || state.polarity === 'violet')) return state.polarity;
return 'gold';
}
export function setPolarity(state, p) {
const v = p === 'violet' ? 'violet' : 'gold';
if (state) state.polarity = v;
return v;
}
export function togglePolarity(state) { return setPolarity(state, getPolarity(state) === 'gold' ? 'violet' : 'gold'); }
function opposite(a, b) { return a && b && a !== b; }
export function checkHit(hit, shooterPolarity, state) {
const res = { shatter: false, armorBonus: 0, ignoreArmor: false };
if (!hit) return res;
if (hit.prismCore) {
const corePol = hit.corePolarity
|| (state && state.prisms && typeof state.prisms.getPrismCorePolarity === 'function'
? state.prisms.getPrismCorePolarity() : null);
if (corePol && shooterPolarity === corePol) res.armorBonus = ARMOR_BONUS;
return res;
}
const t = hit.target;
if (!t || hit.part !== 'head') return res;
const tp = t.polarity || t.visorPolarity
|| (t.tm === 'solaris' ? 'gold' : t.tm === 'voidborne' ? 'violet' : null);
if (!opposite(tp, shooterPolarity)) return res;
res.shatter = true;
res.ignoreArmor = true;
if (hit.point) {
const a = hit.point;
_burstA.set(a.x + 0.4, a.y + 0.3, a.z);
_burstB.set(a.x - 0.4, a.y - 0.3, a.z);
spawnTr(a, _burstA, POLARITY_COLORS[shooterPolarity]);
spawnTr(a, _burstB, POLARITY_COLORS[tp]);
}
return res;
}
