// CYTOGUARD organ zones: the vessel itself changes across the 15 waves, in
// gameplay AND in looks. Waves 1-3 Capillary Stream (open vessel); waves 4-7
// Alveolar Filter (tissue walls block movement and bolts, plus Silica Prisms
// that refract the cell's shots into branching beams); waves 8-10 Marrow
// Sanctuary (a moving cytokine storm ring that empowers pathogens inside it,
// plus a core shield that blocks enemy toxins). Pure data + pure helpers: no
// DOM, no clock, all randomness from the caller's seeded generator.

export const BIOME_CAPILLARY = 'capillary';
export const BIOME_ALVEOLAR = 'alveolar';
export const BIOME_MARROW = 'marrow';

/** The zone of wave n (1-based). */
export function biomeForWave(n) {
  if (n >= 13) return BIOME_MARROW;
  if (n >= 9) return BIOME_MARROW;
  if (n >= 5) return BIOME_ALVEOLAR;
  return BIOME_CAPILLARY;
}

export const BIOMES = {
  [BIOME_CAPILLARY]: {
    id: BIOME_CAPILLARY,
    name: 'Capillary Stream',
    subtitle: 'Waves 1–3 · the open bloodstream',
    plasmaTop: '#060d18', plasmaMid: '#0a1a2e', plasmaBottom: '#0d2238',
    tissue: '#0d2238', tissueDark: '#060d18', accent: '#ffd166',
  },
  [BIOME_ALVEOLAR]: {
    id: BIOME_ALVEOLAR,
    name: 'Alveolar Filter',
    subtitle: 'Waves 4–7 · tissue walls block bolts — Silica Prisms split them',
    plasmaTop: '#060d18', plasmaMid: '#0a1a2e', plasmaBottom: '#0d2238',
    tissue: '#0d2238', tissueDark: '#060d18', accent: '#00f5d4',
  },
  [BIOME_MARROW]: {
    id: BIOME_MARROW,
    name: 'Marrow Sanctuary',
    subtitle: 'Waves 8–10 · cytokine storm peak — Miasma Prime descends on the Core',
    plasmaTop: '#060d18', plasmaMid: '#0a1a2e', plasmaBottom: '#0d2238',
    tissue: '#0d2238', tissueDark: '#060d18', accent: '#c77dff',
  },
};

/** Tactical tissue walls of the Alveolar Filter (fixed, deterministic). */
export const ALVEOLAR_WALLS = [
  { x: 300, y: 190, w: 56, h: 120 },
  { x: 924, y: 190, w: 56, h: 120 },
  { x: 300, y: 410, w: 56, h: 120 },
  { x: 924, y: 410, w: 56, h: 120 },
];

/** The Silica Prisms: rotating crystals that split shots into branching beams. */
export const SILICA_PRISMS = [
  { x: 640, y: 178, radius: 34, split: 3 },
  { x: 320, y: 520, radius: 26, split: 3 },
];
/** The Silica Prism: shots that strike it split into branching beams. */
export const SILICA_PRISM = SILICA_PRISMS[0];

/** The prism whose crystal the point touches (margin = bolt radius), or null. */
export function prismHitByPoint(x, y, margin) {
  for (let i = 0; i < SILICA_PRISMS.length; i += 1) {
    const pr = SILICA_PRISMS[i];
    const dx = x - pr.x;
    const dy = y - pr.y;
    const rr = pr.radius + margin;
    if (dx * dx + dy * dy < rr * rr) return pr;
  }
  return null;
}

/** Core shield of the Marrow Sanctuary: enemy toxins die inside this circle. */
export const CORE_SHIELD_RADIUS = 150;

/** The moving cytokine storm ring: centre orbits the Core, pathogens inside it are faster. */
export const STORM_RING = { orbitRadius: 260, ringRadius: 130, speedBoost: 1.35, shotBoost: 0.75 };

/** Push a circle (x, y, radius) out of every alveolar wall; returns corrected x/y. */
export function resolveWallCollision(x, y, radius) {
  let cx = x;
  let cy = y;
  for (const p of ALVEOLAR_WALLS) {
    const nx = Math.max(p.x, Math.min(cx, p.x + p.w));
    const ny = Math.max(p.y, Math.min(cy, p.y + p.h));
    const dx = cx - nx;
    const dy = cy - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < radius * radius) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        cx = nx + (dx / d) * radius;
        cy = ny + (dy / d) * radius;
      } else {
        cx = p.x - radius;
      }
    }
  }
  return { x: cx, y: cy };
}

/** True when the point is inside any alveolar wall (bolts die on walls). */
export function pointHitsWall(x, y) {
  for (const p of ALVEOLAR_WALLS) {
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
  }
  return false;
}

/** True when the point lies inside the moving storm ring (pathogens empowered). */
export function pointInStormRing(x, y, ringX, ringY) {
  const dx = x - ringX;
  const dy = y - ringY;
  return dx * dx + dy * dy < STORM_RING.ringRadius * STORM_RING.ringRadius;
}

/** Storm ring centre for a given run time: a slow orbit around the Core. */
export function stormRingCentre(time, coreX, coreY) {
  const a = time * 0.35;
  return { x: coreX + Math.cos(a) * STORM_RING.orbitRadius, y: coreY + Math.sin(a) * STORM_RING.orbitRadius * 0.6 };
}

// --- v2 Multi-Organ Campaign (15 waves + Endless) ---
export const BIOME_HEPATIC = 'hepatic';
export const BIOME_CARDIAC = 'cardiac';
export const STAGES = [
  { id: 'capillary', name: 'Capillary Gate', waves: [1, 4] },
  { id: 'branch', name: 'Alveolar Lungs / Hepatic Liver', waves: [5, 8] },
  { id: 'cardiac', name: 'Cardiac Core', waves: [9, 12] },
  { id: 'marrow', name: 'Marrow Citadel', waves: [13, 15] },
];
export function campaignStageForWave(n) {
  if (n >= 13) return STAGES[3];
  if (n >= 9) return STAGES[2];
  if (n >= 5) return STAGES[1];
  return STAGES[0];
}
/** Stage II branch choice after Wave 4: Lungs (prism bias) or Liver (detox). */
export function selectOrganBranch(state, branch) {
  state.branch = branch === 'liver' ? 'liver' : 'lungs';
  state.biomeName = state.branch === 'liver' ? 'Hepatic Liver' : 'Alveolar Lungs';
  return state.branch;
}
/** Sudden Wave Emergencies every 3 waves. */
export function waveEmergencyForWave(n) {
  if (n === 3 || n === 11) return { id: 'nutrientRush', name: 'NUTRIENT SUPPLY RUSH' };
  if (n === 6) return { id: 'metastatic', name: 'METASTATIC OUTBREAK' };
  if (n === 9) return { id: 'arrhythmia', name: 'CARDIAC ARRHYTHMIA SURGE' };
  return null;
}
export function triggerWaveEmergency(state) {
  const em = waveEmergencyForWave(state.wave);
  if (!em) return null;
  state.emergency = em;
  state.events.push({ type: 'emergency', id: em.id, name: em.name });
  if (em.id === 'metastatic') state.metastasisSurge = true;
  return em;
}
/** Endless Mutation Mode (Wave 16+): double mutation rate every 3 waves. */
export function enterEndlessMutation(state) {
  state.endless = true;
  state.screen = 'play';
  startWaveRef(state, 16);
  return 16;
}
let startWaveRef = () => {};
export function bindStartWave(fn) { startWaveRef = fn; }
