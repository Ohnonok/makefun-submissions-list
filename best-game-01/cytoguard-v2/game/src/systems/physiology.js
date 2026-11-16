// CYTOGUARD dual physiological state: the body itself is a system. Organ
// Integrity >= 50% is HOMEOSTASIS (healthy body: precision and web mechanics
// rewarded); below 50% the body enters FEBRILE CRISIS / ACUTE FEVER (a
// risk-reward surge: +50% damage and fire rate, Graze Overdrive charges 2x
// faster, fallen pathogens drop Vital Stem-Orbs that restore the Organ Core —
// but pathogens move 20% more aggressively). The phase flips live, mid-wave,
// from the Core's integrity alone; visuals (vascular tint, erythrocyte flow,
// rising heat particles) and audio (heartbeat 72 -> 140 BPM) follow it.
// Pure helpers over world state: no DOM, no clock. The two modifier objects
// are frozen constants — getPhysiologyModifiers allocates nothing.

export const PHYS_HOMEOSTASIS = 'homeostasis';
export const PHYS_FEBRILE = 'febrile';

/** The integrity fraction where the body tips from healthy into febrile crisis. */
export const FEBRILE_THRESHOLD = 0.5;

const HOMEOSTASIS_MODS = Object.freeze({
  dashRegen: 1.35, triangleRange: 1.25, scoreGain: 1.25,
  damage: 1, fireRate: 1, grazeCharge: 1, enemySpeed: 1, stemOrbs: false,
});

const FEBRILE_MODS = Object.freeze({
  dashRegen: 1, triangleRange: 1, scoreGain: 1,
  damage: 1.5, fireRate: 1.5, grazeCharge: 2, enemySpeed: 1.2, stemOrbs: true,
});

/**
 * Recompute the body's phase from Organ Integrity. Returns {phase, changed}
 * so the caller can fire the transition event (and the audio + HUD follow).
 */
export function updatePhysiologyState(state) {
  const phase = state.core.hp >= state.core.maxHp * FEBRILE_THRESHOLD ? PHYS_HOMEOSTASIS : PHYS_FEBRILE;
  const changed = state.physiology !== phase;
  state.physiology = phase;
  return { phase, changed };
}

/** The active modifier set for the body's current phase (a frozen constant). */
export function getPhysiologyModifiers(state) {
  return state.physiology === PHYS_FEBRILE ? FEBRILE_MODS : HOMEOSTASIS_MODS;
}

/** The HUD badge text for the body's current phase. */
export function physiologyLabel(state) {
  return state.physiology === PHYS_FEBRILE
    ? 'STATE: FEBRILE SURGE (+50% ATK)'
    : 'STATE: HOMEOSTASIS';
}

/** Heartbeat tempo for the phase: 72 BPM healthy, 140 BPM in febrile crisis. */
export function physiologyHeartbeatMs(state) {
  return state.physiology === PHYS_FEBRILE ? 429 : 833;
}
