// CYTOGUARD ATP & Metabolic Heat: the two mastery meters, unified. ONE ATP
// Bar on the player, fed by BOTH phagocytosis and toxin grazes; at full, E
// activates HYPER-IMMUNE FEVER (bullet-time 0.85x, Perforin Tri-Beam, +0.4 s
// per kill). Separately, the METABOLIC HEAT ring tracks weapon heat: R in the
// gold zone (75–90%) perfectly vents and fires an Interferon Shockwave; at
// 100% the weapon overheats. Pure helpers over world state: no DOM, no clock.

import { CONFIG } from '../core/config.js';

/** Add ATP to the player's bar (capped at 100). Returns the new value. */
export function addATP(state, amount) {
  const p = state.player;
  p.overdrive = Math.min(CONFIG.PLAYER.atpMax, (p.overdrive || 0) + amount);
  return p.overdrive;
}

/**
 * Graze check for one enemy toxin vs the cell: inside the graze ring
 * (outside the 65% hurtbox, inside hurtbox + 26) without hitting counts once
 * per toxin. Returns 'graze' | 'hit' | 'none'.
 */
export function checkGraze(state, bullet) {
  const p = state.player;
  const dx = bullet.x - p.x;
  const dy = bullet.y - p.y;
  const dist = Math.hypot(dx, dy);
  const hurt = p.radius * CONFIG.PLAYER.hurtboxScale + bullet.radius;
  const graze = hurt + CONFIG.PLAYER.grazeRing;
  if (dist < hurt) return 'hit';
  if (dist < graze && !bullet.grazed) {
    bullet.grazed = true;
    p.grazeCombo = (p.grazeCombo || 0) + 1;
    addATP(state, CONFIG.PLAYER.atpGrazeGain);
    return 'graze';
  }
  return 'none';
}

/** Activate HYPER-IMMUNE FEVER (only at a full bar). Returns true when it fired. */
export function activateFever(state) {
  const p = state.player;
  if ((p.overdrive || 0) < CONFIG.PLAYER.atpMax) return false;
  if (p.feverTimer > 0) return false;
  p.overdrive = 0;
  p.feverTimer = CONFIG.PLAYER.feverDuration;
  p.projectileStyle = 'tribeam';
  return true;
}

/** True while Hyper-Immune Fever is active (bullet-time + Tri-Beam + 2x damage). */
export function isFevered(state) {
  return state.player.feverTimer > 0;
}

/**
 * Vent the metabolic heat with R. 'perfect' (gold zone 75–90%: full cool +
 * Interferon Shockwave), 'partial' (outside the zone: −40 heat, no shockwave),
 * or 'cool' (already cool: nothing to vent).
 */
export function applyHeatVent(state) {
  const p = state.player;
  if (p.heat >= CONFIG.PLAYER.ventGoldMin && p.heat <= CONFIG.PLAYER.ventGoldMax) {
    p.heat = 0;
    p.overheated = false;
    return 'perfect';
  }
  if (p.heat <= 5) return 'cool';
  p.heat = Math.max(0, p.heat - CONFIG.PLAYER.ventPartialCool);
  if (p.heat <= CONFIG.PLAYER.heatClearAt) p.overheated = false;
  return 'partial';
}
