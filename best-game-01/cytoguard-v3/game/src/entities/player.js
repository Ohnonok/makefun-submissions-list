// CYTOGUARD v2 — Leukocyte Prime (entities/player.js).
// The hero cell: 2x focal-point size with Fresnel rim-glow, a sharp laser
// aim line, forgiving 65% hurtbox, micro-recoil per shot, and the Apex
// Sovereign Morph (glowing cilia wings + orbiting DNA ring) from a codon
// lock. Movement is diagonal-normalized; the sim never uses wall clock.
export const HERO_RADIUS = 32; // 2x the v1 hero: the first focal point.
export const HURTBOX_SCALE = 0.65;

export function createPlayer() {
  return {
    x: 640, y: 520, vx: 0, vy: 0, radius: HERO_RADIUS, hp: 100, maxHp: 100,
    speed: 300, damage: 18, fireInterval: 0.38, multishot: 1, pierce: 2,
    bulletSpeed: 760, spread: 0.06, critChance: 0.15,
    weaponId: 'lance', weaponName: 'T-Cell Lance', projectileStyle: 'lance',
    prismSplit: 0, dashCooldown: 0, dashTimer: 0, invuln: 0, fireTimer: 0,
    heat: 0, overheated: false, overdrive: 0, feverTimer: 0, feverActive: false,
    feverStartX: 0, feverStartY: 0, offeringUsed: false,
    grazesThisWave: 0, grazeCombo: 0, moveAngle: -Math.PI / 2, moveSpeed: 0,
    polarity: 'bio', recoil: 0, morph: false, drones: 0,
  };
}

/** Diagonal-normalized movement: WASD diagonals move at the same speed. */
export function normalizedMove(mx, my) {
  const len = Math.hypot(mx, my);
  if (len <= 0) return { x: 0, y: 0 };
  if (len > 1) return { x: mx / len, y: my / len };
  return { x: mx, y: my };
}
export function hurtboxRadius(player) { return player.radius * HURTBOX_SCALE; }

/** Micro-recoil: a tiny kick opposite the aim on every shot. */
export function applyRecoil(player, angle) {
  player.recoil = 6;
  player.vx -= Math.cos(angle) * 40;
  player.vy -= Math.sin(angle) * 40;
}

/** Apex Sovereign Morph: cilia wings + orbiting DNA ring on the hero. */
export function applyMorph(player, active) {
  player.morph = active;
  if (active) { player.damage = 26; player.multishot = Math.max(player.multishot, 2); }
  else { player.damage = 18; }
}
