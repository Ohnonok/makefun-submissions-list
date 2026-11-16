// CYTOGUARD starting immune classes: three cell types picked on the title
// screen. Each one sets the cell's fire pattern (damage, rate, spread,
// pierce, bolt speed). Default is T-Cell Lance, so any flow that never picks
// still works.

export const WEAPON_LANCE = 'lance';
export const WEAPON_CHAKRAM = 'chakram';
export const WEAPON_PRISM = 'prism';

export const WEAPON_DEFS = [
  {
    id: WEAPON_LANCE, name: 'T-Cell Lance', icon: '◉',
    tagline: 'Piercing Perforin Beam',
    desc: 'Slow, heavy, pierces foes.',
    damage: 18, fireInterval: 0.38, multishot: 1, pierce: 2, bulletSpeed: 760, spread: 0.06,
  },
  {
    id: WEAPON_CHAKRAM, name: 'Plasma Chakram', icon: '✦',
    tagline: 'Ricochet Y-Antibody',
    desc: 'Fast, bounces between foes.',
    damage: 11, fireInterval: 0.15, multishot: 1, pierce: 1, bulletSpeed: 820, spread: 0.06,
  },
  {
    id: WEAPON_PRISM, name: 'Macrophage Prism', icon: '❖',
    tagline: 'Enzyme Scatter Burst',
    desc: '3-way spread, melts plastics.',
    damage: 7, fireInterval: 0.16, multishot: 3, pierce: 0, bulletSpeed: 620, spread: 0.24,
  },
];

export function weaponDef(id) {
  for (let i = 0; i < WEAPON_DEFS.length; i += 1) if (WEAPON_DEFS[i].id === id) return WEAPON_DEFS[i];
  return WEAPON_DEFS[0];
}

/** Apply an immune class to the player object (keeps upgrade bonuses on top). */
export function applyWeaponToPlayer(player, id) {
  const w = weaponDef(id);
  player.weaponId = w.id;
  player.weaponName = w.name;
  player.damage = w.damage;
  player.fireInterval = w.fireInterval;
  player.multishot = w.multishot;
  player.pierce = w.pierce;
  player.bulletSpeed = w.bulletSpeed;
  player.spread = w.spread;
  return w;
}
