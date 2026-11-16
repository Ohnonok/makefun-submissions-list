export const ARMOR_ABSORB = 0.5;
export const HEADSHOT_MULT = 4;
export function applyDamage(target, rawDamage, part, hsMult, opts) {
const out = { damage: 0, hpDamage: 0, absorbed: 0, killed: false, headshot: false };
if (!target || target.alive === false) return out;
const hp0 = typeof target.hp === 'number' ? target.hp : 100;
if (hp0 <= 0) return out;
const mult = typeof hsMult === 'number' && hsMult > 0 ? hsMult : HEADSHOT_MULT;
const headshot = part === 'head';
const dealt = Math.round(rawDamage * (headshot ? mult : 1));
let absorbed = 0;
if (!opts || !opts.ignoreArmor) {
if (target.armor > 0 && dealt > 0) {
absorbed = Math.min(target.armor, Math.round(dealt * ARMOR_ABSORB));
target.armor = Math.max(0, target.armor - absorbed);
}
}
const hpDamage = Math.max(0, dealt - absorbed);
target.hp = Math.max(0, hp0 - hpDamage);
const killed = target.hp <= 0;
if (killed) target.alive = false;
if (typeof target.setHp === 'function') target.setHp();
out.damage = dealt;
out.hpDamage = hpDamage;
out.absorbed = absorbed;
out.killed = killed;
out.headshot = headshot;
return out;
}
