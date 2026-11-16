// CYTOGUARD lore: the chronicle "The Last Vigil of Solis / Vitalis". You are
// Leukocyte Prime, the body's last defense against the synthetic Miasma Prime
// plague. Three eras, one premise, one line per zone, one line per pathogen,
// one inscription per gene splice — concise on purpose, so the dossier
// outline stays lean. Every display string in the game (HUD, cards, banners,
// victory, defeat) comes from here; internal kind keys (bacillus / phage /
// plastic) never leak to the player.

export const CELL_NAME = 'Leukocyte Prime';
export const CHRONICLE_TITLE = 'The Last Vigil of Solis / Vitalis';
export const WORLD_PREMISE = 'Leukocyte Prime, the last smart immune cell, guards the Organ Core against the synthetic Miasma Prime plague through ten waves of infection before immunity is restored.';

export const LORE_CHRONICLES = {
  capillary: {
    era: 'ERA I — CAPILLARY STREAM', name: 'Capillary Stream',
    line: 'The open bloodstream; red cells drift past like slow moons.',
  },
  alveolar: {
    era: 'ERA II — ALVEOLAR FILTER', name: 'Alveolar Filter',
    line: 'Silica prisms rise from the tissue, splitting light into killing beams.',
  },
  marrow: {
    era: 'ERA III — MARROW SANCTUARY', name: 'Marrow Sanctuary',
    line: 'The cytokine storm peaks; Miasma Prime descends to devour the Core.',
  },
};

/** The chronicle (era label + name + one line) of a zone id. */
export function getBiomeChronicle(biomeId) {
  return LORE_CHRONICLES[biomeId] || LORE_CHRONICLES.capillary;
}

export const ENEMY_BESTIARY = {
  bacillus: { name: 'Bacillus Rod', line: 'A segmented rod that swims fast, flagella whipping.' },
  phage: { name: 'Bacteriophage', line: 'A hexagonal crystal head on six spider legs; it spits toxins.' },
  plastic: { name: 'Microplastic Shard', line: 'A jagged black-purple fragment — not alive, and harder to kill.' },
  dormant: { name: 'Dormant Dysplastic Cell', line: 'A pale irregular cell asleep at the tissue edge. Wrong polarity wakes it.' },
  cancer: { name: 'Malignant Tumor Cell', line: 'A dark-red spiky mass that divides and drinks from the Core.' },
  boss: { name: 'Miasma Prime', line: 'Layered capsid, two toxin tentacles, one pulsing core.' },
};

/** The bestiary entry (lore name + one line) of a pathogen kind. */
export function getEnemyBestiaryEntry(kind) {
  return ENEMY_BESTIARY[kind] || ENEMY_BESTIARY.bacillus;
}

/** One poetic inscription per Gene Splice (shown on its draft card). */
export const GENE_INSCRIPTIONS = {
  damage: 'The first perforin still remembers the first infection.',
  firerate: 'Mitosis hurries for the cell that guards.',
  speed: 'Chemotaxis pulls toward every wound.',
  pierce: 'One antibody, a hundred binding sites.',
  repair: 'The Core forgives those who guard it.',
  vitality: 'Leukocyte Prime beats with the whole body.',
  twinBeam: 'One beam, split by a faithful membrane.',
  prismCore: 'The crystal that first caught the light.',
  solarMythic: 'The sun the marrow kept for the last day.',
};

export const VICTORY_NARRATIVE = 'Miasma Prime purged. Cellular harmony restored across all 10 waves.';
export const DEFEAT_NARRATIVE = 'The vigil ends in darkness — but the marrow remembers, and another cell will rise.';
