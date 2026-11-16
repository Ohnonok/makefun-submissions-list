// CYTOGUARD evolutions: picking certain gene-splice pairs triggers an
// AWAKENED CELL EVOLUTION — a real evolved effect, not a label.
// checkGeneAwakenings runs after every purchase and grants each completed
// pair once, stamping a banner (state.evolution) the renderer shows and the
// audio answers.

export const EVOLUTIONS = [
  {
    id: 'perforinTriBeam',
    name: 'Perforin Tri-Beam',
    pair: ['twinBeam', 'prismCore'],
    banner: '✦ AWAKENED CELL — PERFORIN TRI-BEAM ✦',
    desc: 'Twin Perforin + Silica Core: +1 shot beam, prism splits +1 beam, +20% damage',
    apply(state) {
      const p = state.player;
      p.multishot = Math.min(6, p.multishot + 1);
      p.prismSplit = Math.min(4, (p.prismSplit || 0) + 1);
      p.damage = Math.round(p.damage * 1.2);
      // Awakened attack form: fat gold tri-beams (the renderer reads this).
      p.projectileStyle = 'tribeam';
    },
  },
  {
    id: 'immuneSurge',
    name: 'Immune Surge',
    pair: ['firerate', 'speed'],
    banner: '✦ AWAKENED CELL — IMMUNE SURGE ✦',
    desc: 'Rapid Mitosis + Swift Chemotaxis: +15% fire rate, +15% move speed, dash cools 30% faster',
    apply(state) {
      const p = state.player;
      p.fireInterval = Math.max(0.08, p.fireInterval * 0.85);
      p.speed *= 1.15;
      p.dashCooldown = Math.max(1.2, (p.dashCooldown || 2.5) * 0.7);
      // Awakened attack form: pale surge streaks (the renderer reads this).
      p.projectileStyle = 'surge';
    },
  },
  {
    id: 'primeLanceMastery',
    name: 'T-Cell Prime Mastery',
    pair: ['damage', 'pierce'],
    banner: '✦ AWAKENED CELL — T-CELL PRIME MASTERY ✦',
    desc: 'Perforin Rounds + Piercing Antibody: +8 damage, +1 pierce, crit chance +10%',
    apply(state) {
      const p = state.player;
      p.damage += 8;
      p.pierce = Math.min(4, p.pierce + 1);
      p.critChance = Math.min(0.5, (p.critChance || 0.15) + 0.1);
      // Awakened attack form: white-hot perforin bolts (the renderer reads this).
      p.projectileStyle = 'prime';
    },
  },
];

/**
 * Grant every newly completed evolution. Returns the evolution granted this
 * call (or null). Idempotent: an evolution already in state.evolutions never
 * fires twice.
 */
export function checkGeneAwakenings(state) {
  if (!state.evolutions) state.evolutions = [];
  for (const evo of EVOLUTIONS) {
    if (state.evolutions.includes(evo.id)) continue;
    if (!evo.pair.every((id) => (state.upgradesOwned[id] || 0) > 0)) continue;
    evo.apply(state);
    state.evolutions.push(evo.id);
    state.evolution = { name: evo.name, banner: evo.banner, desc: evo.desc, timer: 3.2 };
    return evo;
  }
  return null;
}
