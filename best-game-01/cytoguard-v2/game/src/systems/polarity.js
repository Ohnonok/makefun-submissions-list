// CYTOGUARD dual antigen polarity: BIO-GOLD and TOXIN-VIOLET. The cell, the
// enemy toxins and the elite pathogens each carry one polarity. Absorbing a
// toxin of the SAME polarity (phagocytosis) fills the shared ATP bar and
// restores Organ Integrity (0 damage taken); attacking a pathogen of the
// OPPOSITE polarity triggers a 2.5x Cytolytic Critical. Pure helpers: no DOM,
// no clock, deterministic.

export const POLARITY_BIO = 'bio';
export const POLARITY_TOXIN = 'toxin';

/** Flip the cell's polarity; stamps a shockwave the renderer draws. */
export function togglePolarity(state) {
  const p = state.player;
  p.polarity = p.polarity === POLARITY_BIO ? POLARITY_TOXIN : POLARITY_BIO;
  state.polarityShockwave = { timer: 0.4, polarity: p.polarity };
  return p.polarity;
}

/**
 * Phagocytosis of a same-polarity toxin: +ATP, +2 Organ Integrity, no damage.
 * Returns true when the toxin was absorbed (the caller deactivates it).
 */
export function absorbMatchingOrb(state, bullet) {
  const p = state.player;
  if (bullet.polarity !== p.polarity) return false;
  p.overdrive = Math.min(100, (p.overdrive || 0) + 12);
  state.core.hp = Math.min(state.core.maxHp, state.core.hp + 2);
  return true;
}

/** Cytolytic multiplier: 2.5x when attacker and target polarities oppose. */
export function calcResonanceCrit(attackerPolarity, targetPolarity) {
  if (!attackerPolarity || !targetPolarity) return 1;
  return attackerPolarity === targetPolarity ? 1 : 2.5;
}

/** True when the two polarities are opposite (a cytolytic hit). */
export function isResonance(attackerPolarity, targetPolarity) {
  return calcResonanceCrit(attackerPolarity, targetPolarity) > 1;
}
