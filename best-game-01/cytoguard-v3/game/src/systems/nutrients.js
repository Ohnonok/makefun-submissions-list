// CYTOGUARD v2 — Bio-Nutrient Synthesis (systems/nutrients.js).
// Vitamin / Protein / Mineral, Grade 1-10 each. Grades are NOT passive
// numbers: they change projectile form (split/ricochet at 4-6, full form
// change at 7-9, Apex Form at 10), trigger cross-reaction chemistry, and
// can surge to Apex 10 for 10 s from a mid-run drop.
export const NUTRIENT_MAX_GRADE = 10;
export const SURGE_DURATION = 10; // seconds at Apex Grade 10.

export const WEAPON_FORMS = {
  lance: { name: 'Photon Lance', apex: 'Apex Photon Lance' },
  cannon: { name: 'Heavy Fibrin Cannon', apex: 'Apex Fibrin Cannon' },
  chakram: { name: 'Aegis Prism Chakram', apex: 'Apex Aegis Chakram' },
  beam: { name: 'Omega Cytokine Beam', apex: 'Omega Cytokine Beam' },
};

export function createNutrients() {
  return { vit: 8, pro: 6, min: 4, surgeTimer: 0, surgeKind: null, codon: [] };
}

/** Breakthrough tier for a grade: 1-3 basic, 4-6 split/ricochet, 7-9 form change, 10 apex. */
export function breakthroughTier(grade) {
  if (grade >= 10) return 'apex';
  if (grade >= 7) return 'form';
  if (grade >= 4) return 'split';
  return 'basic';
}
export function effectiveGrade(nutrients, kind) {
  if (nutrients.surgeTimer > 0) return NUTRIENT_MAX_GRADE;
  return nutrients[kind];
}
export function projectileCount(nutrients) {
  const g = Math.max(nutrients.vit, nutrients.pro, nutrients.min);
  const t = breakthroughTier(effectiveGrade(nutrients, 'vit'));
  if (t === 'apex') return 5;
  if (t === 'form') return 3;
  if (t === 'split') return 2;
  return 1;
}
export function weaponFormName(nutrients, weaponId) {
  const form = WEAPON_FORMS[weaponId] || WEAPON_FORMS.lance;
  const g = Math.max(effectiveGrade(nutrients, 'vit'), effectiveGrade(nutrients, 'pro'), effectiveGrade(nutrients, 'min'));
  return g >= 10 ? form.apex : form.name;
}

/** Cross-Reactions: VIT+PRO Catalytic Detonation, PRO+MIN Crystalline
 *  Shrapnel (8 shards), VIT+MIN Bio-Electric Arc to Platelet Nodes. */
export function crossReaction(nutrients, hitKind) {
  const v = effectiveGrade(nutrients, 'vit');
  const p = effectiveGrade(nutrients, 'pro');
  const m = effectiveGrade(nutrients, 'min');
  if (hitKind === 'heavy' && v >= 4 && p >= 4) return { id: 'catalytic', damage: 30 + v * 4, radius: 90 };
  if (hitKind === 'crystal' && p >= 4 && m >= 4) return { id: 'shrapnel', shards: 8, damage: 8 + m * 2 };
  if (hitKind === 'arc' && v >= 4 && m >= 4) return { id: 'arc', damage: 12 + v + m, chains: 2 };
  return null;
}

/** Live mid-run Surge drop: +2 of a nutrient, or Apex 10 for 10 s. */
export function applySurgeDrop(nutrients, kind) {
  if (kind === 'apex') { nutrients.surgeTimer = SURGE_DURATION; nutrients.surgeKind = 'apex'; return 'APEX GRADE 10 — 10 s'; }
  nutrients[kind] = Math.min(NUTRIENT_MAX_GRADE, nutrients[kind] + 2);
  return `+2 ${kind.toUpperCase()} SURGE`;
}
export function tickNutrients(nutrients, dt) {
  if (nutrients.surgeTimer > 0) {
    nutrients.surgeTimer -= dt;
    if (nutrients.surgeTimer <= 0) { nutrients.surgeTimer = 0; nutrients.surgeKind = null; }
  }
}
