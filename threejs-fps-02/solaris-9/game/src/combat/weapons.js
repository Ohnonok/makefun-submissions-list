// Weapon table: [id, nm, dmg, hsMult, mag, reserve, auto, rpm, interval, price, accent, reloadTime, range, kick]
const ROWS = [
['pistol', 'Pulse Pistol', 34, 4, 12, 48, false, 0, 0.16, 300, 0x48cae4, 1.1, 40, 0.012],
['smg', 'Vektor SMG', 26, 4, 32, 96, true, 800, 0.075, 1200, 0x2a9d8f, 1.9, 35, 0.009],
['rifle', 'Vanguard Rifle', 30, 4, 30, 90, true, 600, 0.1, 2700, 0xf4a261, 2.2, 55, 0.014],
['marksman', 'Helios Marksman', 55, 4, 10, 30, false, 0, 0.3, 3800, 0x7b2fbe, 2.6, 90, 0.03],
['rail', 'Nova Rail-Sniper', 110, 2.5, 5, 15, false, 0, 1.15, 4750, 0xef476f, 3.0, 120, 0.06],
];
const KEYS = ['id', 'nm', 'dmg', 'hsMult', 'mag', 'reserve', 'auto', 'rpm', 'interval', 'price', 'accent', 'reloadTime', 'range', 'kick'];
export const WEAPONS = {};
for (const r of ROWS) {
const w = {};
for (let i = 0; i < KEYS.length; i++) w[KEYS[i]] = r[i];
WEAPONS[w.id] = w;
}
export const WEAPON_IDS = ['pistol', 'smg', 'rifle', 'marksman', 'rail'];
export function getWpn(id) { return WEAPONS[id] || WEAPONS.pistol; }
