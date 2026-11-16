// CYTOGUARD v2 — Adaptive Bio-Director (systems/director.js).
// Pacing that never feels too easy or frustrating. Anti-Boring: Organ
// >85% + high combo accelerates Alpha Pathogen (elite) spawns worth 2x GP.
// Anti-Frustration: Organ <30% slows spawns 18% and raises Stem-Orb / Drug
// Capsule drops. Second Wind (1x/run): Organ <=5% triggers Adrenaline
// Surge — a blast pushing all pathogens away + 2.5 s invulnerability.
export const PROTOCOLS = [
  { id: 'clinical', name: 'CLINICAL', gp: 1.0, enemyHp: 1.0 },
  { id: 'virulent', name: 'VIRULENT', gp: 1.5, enemyHp: 1.25 },
  { id: 'pandemic', name: 'PANDEMIC', gp: 2.2, enemyHp: 1.6 },
];
export function protocolDef(id) {
  return PROTOCOLS.find((p) => p.id === id) || PROTOCOLS[1];
}

export function createDirector() {
  return { alphaRate: 0, spawnSlow: 0, dropBoost: 0, secondWindUsed: false, alphaSpawned: 0 };
}

/** evaluatePacing: returns {alpha, spawnMul, dropMul} for this tick. */
export function evaluatePacing(state, director) {
  const organPct = state.core.hp / state.core.maxHp;
  let alpha = 0; let spawnMul = 1; let dropMul = 1;
  if (organPct > 0.85 && state.chain >= 12) {
    alpha = 1; // Anti-Boring: elites worth 2x GP.
    director.alphaRate = 1;
  } else director.alphaRate = 0;
  if (organPct < 0.30) {
    spawnMul = 0.82; // Anti-Frustration: spawn cadence -18%.
    dropMul = 1.6;
    director.spawnSlow = 0.18; director.dropBoost = 0.6;
  } else { director.spawnSlow = 0; director.dropBoost = 0; }
  return { alpha, spawnMul, dropMul };
}

/** Last-Stand Second Wind, once per run. Returns true when it fires. */
export function triggerSecondWind(state, director) {
  if (director.secondWindUsed) return false;
  if (state.core.hp / state.core.maxHp > 0.05) return false;
  director.secondWindUsed = true;
  state.player.invuln = 2.5;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const dx = e.x - state.core.x; const dy = e.y - state.core.y;
    const d = Math.hypot(dx, dy) || 1;
    e.x += (dx / d) * 220; e.y += (dy / d) * 220;
  }
  state.events.push({ type: 'secondWind' });
  return true;
}
