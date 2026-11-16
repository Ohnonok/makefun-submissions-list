// CYTOGUARD Gene Splices: the draft pool. Eight splices, each a mutation of
// the Organ Core: a rarity (Common / Rare / Mythic), a procedural vector icon
// (drawn by the renderer), a synergy tag naming what it pairs with, and ONE
// poetic inscription line from lore.js. rollUpgradeChoices /
// applyUpgradeToState hold the draft logic; world.js delegates to them so the
// simulation stays the single owner of state.

import { GENE_INSCRIPTIONS } from '../lore/codex.js';

export const RARITY_COMMON = 'Common';
export const RARITY_RARE = 'Rare';
export const RARITY_MYTHIC = 'Solar Mythic';

export const RARITY_COLOURS = {
  [RARITY_COMMON]: '#c98a92',
  [RARITY_RARE]: '#2f6fd6',
  [RARITY_MYTHIC]: '#d7263d',
};

export const UPGRADE_DEFS = [
  { id: 'damage', name: 'Perforin Rounds', desc: '+6 bolt damage', base: 12, step: 6, rarity: RARITY_COMMON, icon: '◉', synergy: 'Pairs with Antibody Choir', inscription: GENE_INSCRIPTIONS.damage },
  { id: 'firerate', name: 'Rapid Mitosis', desc: '+18% fire rate', base: 12, step: 5, rarity: RARITY_COMMON, icon: '⚡', synergy: 'Pairs with Swift Chemotaxis', inscription: GENE_INSCRIPTIONS.firerate },
  { id: 'speed', name: 'Swift Chemotaxis', desc: '+12% move speed', base: 10, step: 4, rarity: RARITY_COMMON, icon: '➤', synergy: 'Pairs with Rapid Mitosis', inscription: GENE_INSCRIPTIONS.speed },
  { id: 'pierce', name: 'Antibody Choir', desc: 'Bolts pierce +1 pathogen (max 3)', base: 24, step: 14, rarity: RARITY_RARE, icon: '↗', synergy: 'Pairs with Perforin Rounds', inscription: GENE_INSCRIPTIONS.pierce },
  { id: 'repair', name: 'Mend of the Core', desc: 'Restore 30 Organ Integrity', base: 14, step: 6, rarity: RARITY_COMMON, icon: '✚', synergy: 'Pairs with Vital Marrow', inscription: GENE_INSCRIPTIONS.repair },
  { id: 'vitality', name: 'Vital Marrow', desc: '+25 max HP and heal 25', base: 16, step: 7, rarity: RARITY_RARE, icon: '♥', synergy: 'Pairs with Mend of the Core', inscription: GENE_INSCRIPTIONS.vitality },
  { id: 'twinBeam', name: 'Twin Perforin', desc: '+1 beam per shot, +10% damage', base: 34, step: 20, rarity: RARITY_RARE, icon: '⫽', synergy: 'Pairs with Silica Core → Perforin Tri-Beam', inscription: GENE_INSCRIPTIONS.twinBeam },
  { id: 'prismCore', name: 'Silica Core', desc: 'Shots refract: +1 prism split beam', base: 36, step: 20, rarity: RARITY_MYTHIC, icon: '⬡', synergy: 'Pairs with Twin Perforin → Perforin Tri-Beam', inscription: GENE_INSCRIPTIONS.prismCore },
  { id: 'solarMythic', name: 'Solar Mythic', desc: '+25% bolt damage, +50% in Fever', base: 40, step: 20, rarity: RARITY_MYTHIC, icon: '☀', synergy: 'Pairs with Twin Perforin', synergyId: 'twinBeam', inscription: GENE_INSCRIPTIONS.solarMythic },
  { id: 'crisprPrismCore', name: 'CRISPR PRISM CORE', desc: 'Refracts laser into 3 beams', base: 36, step: 18, rarity: RARITY_RARE, icon: '⬡', synergy: 'Pairs with Silica Core', inscription: GENE_INSCRIPTIONS.crispr },
  { id: 'symbioticReprogramming', name: 'SYMBIOTIC REPROGRAMMING', desc: 'Opsonized elites become Guardian Drones', base: 44, step: 22, rarity: RARITY_MYTHIC, icon: '✦', synergy: 'Pairs with NK-Cell Supernova', synergyId: 'nk', inscription: GENE_INSCRIPTIONS.symbiotic },
  { id: 'vascularValveSurge', name: 'VASCULAR VALVE SURGE', desc: 'Valve Gate sweeps foes into the Triangle', base: 18, step: 8, rarity: RARITY_COMMON, icon: '≋', synergy: 'Pairs with Fibrin Triangle', inscription: GENE_INSCRIPTIONS.valveSurge },
];

export function upgradeDef(id) {
  for (let i = 0; i < UPGRADE_DEFS.length; i += 1) if (UPGRADE_DEFS[i].id === id) return UPGRADE_DEFS[i];
  return undefined;
}

/** Pathogen Mutations: the risk half of every draft card (next-wave challenge). */
export const OMEN_DEFS = [
  { id: 'omenSwift', name: 'Mutation: Swift Strain', desc: 'Next wave: pathogens +25% speed', icon: '☄' },
  { id: 'omenSwarm', name: 'Mutation: Biofilm Armor', desc: 'Next wave: +8 pathogens', icon: '✺' },
  { id: 'omenElite', name: 'Mutation: Elite Strain', desc: 'Next wave: Biofilm Warders spawn', icon: '⬢' },
  { id: 'omenDrain', name: 'Mutation: Toxic Spore', desc: 'Next wave: the Core loses 1 HP/s', icon: '☾' },
];

/** Roll 3 draft cards from the pool, skipping maxed / useless ones. */
export function rollUpgradeChoices(state, random) {
  // Zero-GC pool copy: a plain index loop only.
  const pool = [];
  for (let i = 0; i < UPGRADE_DEFS.length; i += 1) pool.push(UPGRADE_DEFS[i]);
  const picks = [];
  while (picks.length < 3 && pool.length > 0) {
    const index = Math.floor(random() * pool.length);
    const def = pool.splice(index, 1)[0];
    const owned = state.upgradesOwned[def.id] || 0;
    if (def.id === 'twinBeam' && state.player.multishot >= 5) continue;
    if (def.id === 'pierce' && state.player.pierce >= 3) continue;
    if (def.id === 'repair' && state.core.hp >= state.core.maxHp) continue;
    picks.push({
      id: def.id, name: def.name, desc: def.desc,
      cost: def.base + owned * def.step, level: owned,
      rarity: def.rarity, icon: def.icon, synergy: def.synergy, synergyId: def.synergyId, inscription: def.inscription,
      // Every card pairs its Gene Splice with a Pathogen Mutation (risk-reward).
      omen: OMEN_DEFS[Math.floor(random() * OMEN_DEFS.length)],
    });
  }
  // Marrow Offering guarantee: the next draft holds a Mythic gene splice.
  if (state.pendingMythic) {
    state.pendingMythic = false;
    const mythic = UPGRADE_DEFS.find((d) => d.id === 'prismCore');
    const hasMythic = picks.some((c) => c.id === 'prismCore');
    if (mythic && !hasMythic && (state.player.prismSplit || 0) < 3) {
      picks[0] = {
        id: mythic.id, name: mythic.name, desc: mythic.desc,
        cost: mythic.base + (state.upgradesOwned.prismCore || 0) * mythic.step, level: state.upgradesOwned.prismCore || 0,
        rarity: mythic.rarity, icon: mythic.icon, synergy: mythic.synergy, inscription: mythic.inscription,
        omen: OMEN_DEFS[Math.floor(random() * OMEN_DEFS.length)],
      };
    }
  }
  while (picks.length < 3) {
    picks.push({ id: 'repair', name: 'Mend of the Core', desc: 'Restore 30 Organ Integrity', cost: 14, level: 0, rarity: RARITY_COMMON, icon: '✚', synergy: 'Pairs with Vital Marrow', inscription: GENE_INSCRIPTIONS.repair, omen: OMEN_DEFS[Math.floor(random() * OMEN_DEFS.length)] });
  }
  state.choices = picks;
}

/** Buy one draft card: deduct nutrients, apply the effect, clear the draft. */
export function applyUpgradeToState(state, id) {
  const def = upgradeDef(id);
  if (!def) return false;
  const owned = state.upgradesOwned[id] || 0;
  const cost = def.base + owned * def.step;
  if (state.nutrientPoints < cost) return false;
  state.nutrientPoints -= cost;
  state.upgradesOwned[id] = owned + 1;
  const p = state.player;
  if (id === 'damage') p.damage += 6;
  else if (id === 'firerate') p.fireInterval = Math.max(0.09, p.fireInterval * 0.85);
  else if (id === 'speed') p.speed *= 1.12;
  else if (id === 'twinBeam') { p.multishot = Math.min(5, p.multishot + 1); p.damage = Math.round(p.damage * 1.1); }
  else if (id === 'prismCore') p.prismSplit = Math.min(3, (p.prismSplit || 0) + 1);
  else if (id === 'pierce') p.pierce = Math.min(3, p.pierce + 1);
  else if (id === 'solarMythic') { p.damage = Math.round(p.damage * 1.25); p.feverDamageBonus = (p.feverDamageBonus || 0) + 0.5; }
  else if (id === 'repair') state.core.hp = Math.min(state.core.maxHp, state.core.hp + 30);
  else if (id === 'vitality') { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); }
  state.choices = [];
  return true;
}
