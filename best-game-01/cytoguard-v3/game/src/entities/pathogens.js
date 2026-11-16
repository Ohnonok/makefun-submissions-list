// CYTOGUARD pathogen kinds: the roster, their roles and their spawn weights
// per wave. Bacillus (fast rod chaser), Bacteriophage (ranged spitter),
// Microplastic Shard (slow Core-marcher), Spore Leaper (telegraphed dash
// attacker) and Biofilm Warder (shields nearby pathogens until destroyed).
// Stats live in config.js ENEMY; this module owns roles, polarities and
// spawn weights.

import { CONFIG } from '../core/config.js';

export const KIND_BACILLUS = 'bacillus';
export const KIND_PHAGE = 'phage';
export const KIND_PLASTIC = 'plastic';
export const KIND_LEAPER = 'leaper';
export const KIND_WARDER = 'warder';
export const KIND_DORMANT = 'dormant';
export const KIND_CANCER = 'cancer';
export const KIND_BOSS = 'boss';

export const ENEMY_ROLES = {
  bacillus: { role: 'chaser', loreName: 'Bacillus Rod' },
  phage: { role: 'shooter', loreName: 'Bacteriophage' },
  plastic: { role: 'core-marcher', loreName: 'Microplastic Shard' },
  leaper: { role: 'dash-attacker', loreName: 'Spore Leaper' },
  warder: { role: 'shield-bearer', loreName: 'Biofilm Warder' },
  dormant: { role: 'dysplastic', loreName: 'Dormant Dysplastic Cell' },
  cancer: { role: 'tumor', loreName: 'Malignant Tumor Cell' },
  boss: { role: 'parasite', loreName: 'Miasma Prime' },
};

/** Fixed polarity per kind; bacilli / phages / plastics roll theirs at spawn. */
export const ENEMY_POLARITY = {
  leaper: 'toxin',
  warder: 'bio',
  boss: 'toxin',
};

/**
 * Pick the next spawn kind for a wave (seeded random). Leapers join from
 * wave 3, Warders from wave 5 (more often under the Elite Mutation omen).
 */
export function pickEnemyKind(random, wave, omenElite) {
  const roll = random();
  const warderChance = wave >= 5 ? (omenElite ? 0.2 : 0.1) : 0;
  if (roll < warderChance) return KIND_WARDER;
  const leaperChance = wave >= 3 ? 0.12 : 0;
  if (roll < warderChance + leaperChance) return KIND_LEAPER;
  const r2 = random();
  if (r2 < CONFIG.WAVE.plasticChance(wave)) return KIND_PLASTIC;
  if (r2 < CONFIG.WAVE.plasticChance(wave) + CONFIG.WAVE.phageChance(wave)) return KIND_PHAGE;
  return KIND_BACILLUS;
}
