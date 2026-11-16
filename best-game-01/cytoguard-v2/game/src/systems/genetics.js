// CYTOGUARD v2 — 3D Double-Helix DNA Codon Recombination (systems/genetics.js).
// A rotating bioluminescent double helix lives in the Bio-Armory panel and
// the Draft screen, glowing in the colours of the active VIT/PRO/MIN combo.
// Codon lock: entering a 3-codon sequence (e.g. VIT-PRO-VIT) triggers Apex
// Sovereign Morph — Leukocyte Prime grows glowing cilia wings + an orbiting
// DNA ring in the arena.
export const CODON_COLOURS = { VIT: '#ffd166', PRO: '#00f5d4', MIN: '#c77dff' };
export const APEX_CODONS = [
  ['VIT', 'PRO', 'VIT'],
  ['MIN', 'PRO', 'MIN'],
  ['PRO', 'VIT', 'PRO'],
];

export function createGenetics() {
  return { codon: [], morph: false, morphTimer: 0, helixAngle: 0 };
}
export function codonColour(codon) { return CODON_COLOURS[codon] || '#ffd166'; }

/** Enter one codon; returns 'morph' when a 3-codon Apex sequence locks. */
export function enterCodon(genetics, codon) {
  genetics.codon.push(codon);
  if (genetics.codon.length > 3) genetics.codon.shift();
  if (genetics.codon.length === 3) {
    for (const seq of APEX_CODONS) {
      if (seq[0] === genetics.codon[0] && seq[1] === genetics.codon[1] && seq[2] === genetics.codon[2]) {
        genetics.morph = true;
        genetics.morphTimer = 30; // 30 s of Apex Sovereign Morph.
        genetics.codon = [];
        return 'morph';
      }
    }
  }
  return 'codon';
}
export function tickGenetics(genetics, dt) {
  genetics.helixAngle += dt * 0.9;
  if (genetics.morph) {
    genetics.morphTimer -= dt;
    if (genetics.morphTimer <= 0) genetics.morph = false;
  }
}
export function morphActive(genetics) { return genetics.morph; }
