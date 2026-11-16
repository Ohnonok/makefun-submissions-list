// CYTOGUARD v2 — Pathogen Infection Lifecycle (systems/infection.js).
// Three clinical phases that change enemy behaviour AND visuals.
// Phase I Incubation (W1-4): thin membranes, straight chain formation.
// Phase II Proliferation (W5-8): Quorum-Sensing Biofilm shields clusters
// of 4+, Binary Fission splits long-lived bacteria. Phase III Acute Sepsis
// (W13-15): toxin spikes, Cancer appearances, Toxin Endospores on death
// that must be absorbed with the SAME Q polarity or they hurt the Core.
export const PHASE_INCUBATION = 'INCUBATION';
export const PHASE_PROLIFERATION = 'PROLIFERATION';
export const PHASE_SEPSIS = 'ACUTE SEPSIS';
export const QUORUM_CLUSTER = 4;
export const QUORUM_RADIUS = 110;
export const FISSION_AGE = 14; // seconds alive before a bacterium divides.

export function infectionPhaseForWave(wave) {
  if (wave >= 13) return PHASE_SEPSIS;
  if (wave >= 5) return PHASE_PROLIFERATION;
  return PHASE_INCUBATION;
}
export function updateInfectionPhase(state) {
  state.infectionPhase = infectionPhaseForWave(state.wave);
  return state.infectionPhase;
}

/** Quorum-Sensing Biofilm: clusters of 4+ bacteria within 110 px gain a
 *  shield (damage halved) and glowing signal lines between them. Returns
 *  the list of shielded enemies. */
export function applyQuorumSensing(state) {
  const live = state.enemies.filter((e) => e.active && (e.kind === 'bacillus' || e.kind === 'leaper'));
  const shielded = [];
  for (const e of live) {
    let neighbours = 0;
    for (const o of live) {
      if (o === e) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) < QUORUM_RADIUS) neighbours += 1;
    }
    e.biofilm = neighbours >= QUORUM_CLUSTER - 1;
    if (e.biofilm) shielded.push(e);
  }
  state.biofilmCount = shielded.length;
  return shielded;
}

/** Binary Fission: a bacterium alive too long pulses and splits in two. */
export function triggerBinaryFission(state, spawnEnemy) {
  if (state.infectionPhase !== PHASE_PROLIFERATION) return 0;
  let splits = 0;
  for (const e of state.enemies) {
    if (!e.active || e.kind !== 'bacillus' || e.biofilm) continue;
    e.age = (e.age || 0) + state.stepDt;
    if (e.age >= FISSION_AGE) {
      e.age = 0;
      const child = spawnEnemy(state, 'bacillus', e.x + 24, e.y + 18);
      if (child) { child.spawnAnim = 0; splits += 1; }
    }
  }
  return splits;
}

/** Acute Sepsis: a killed pathogen releases a Toxin Endospore that drifts
 *  to the Core unless absorbed with the SAME Q polarity. */
export function spawnToxinEndospore(state, x, y, polarity) {
  if (state.infectionPhase !== PHASE_SEPSIS) return null;
  const s = state.shards.find((sh) => !sh.active);
  if (!s) return null;
  s.active = true; s.kind = 'endospore'; s.x = x; s.y = y;
  s.polarity = polarity; s.timer = 6;
  return s;
}
