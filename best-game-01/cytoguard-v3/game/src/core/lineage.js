// CYTOGUARD v2 — Cell Lineage Bank & Gene Points (core/lineage.js).
// Persistent progression across runs: GP is earned every run (win +320,
// defeat +110 salvaged) and spent on 5 immune classes + 3 permanent organ
// systems. Deterministic in-game: the bank starts at the starter state
// TIER III • 450 GP so progression reads as real in every screenshot and
// preview; localStorage only persists the player's own bank between visits.
export const LINEAGE_STARTER_GP = 450;
export const LINEAGE_STARTER_TIER = 3;
export const GP_VICTORY = 320;
export const GP_DEFEAT = 110;
export const GP_KEY = 'cytoguard.lineage.gp.v2';
export const ADAPTIVE_IMMUNITY_KEY = 'cytoguard.lineage.adaptive.v2';

export const IMMUNE_CLASSES = [
  { id: 'tcell', name: 'T-Cell Lance', cost: 0, weapon: 'lance', desc: 'Starter precision lance.', unlocked: true },
  { id: 'plasma', name: 'Plasma Chakram', cost: 0, weapon: 'chakram', desc: 'Starter orbiting chakram.', unlocked: true },
  { id: 'macrophage', name: 'Macrophage Prism', cost: 200, weapon: 'prism', desc: 'Prism refraction, unlocked.', unlocked: true },
  { id: 'nk', name: 'NK-Cell Supernova', cost: 350, weapon: 'supernova', desc: 'Cytokine Storm on every Polarity Shift.', unlocked: true },
  { id: 'dendritic', name: 'Dendritic Sentinel Prime', cost: 600, weapon: 'dendritic', desc: 'LOCKED — summons 2 Autonomous Antibody Drones.', unlocked: false },
];

export const ORGAN_SYSTEMS = [
  { id: 'membrane', name: 'MEMBRANE', level: 3, max: 5, desc: '+max Organ Integrity per level.' },
  { id: 'fibrin', name: 'FIBRIN', level: 2, max: 5, desc: '+Fibrin Triangle radius & damage.' },
  { id: 'nutrient', name: 'NUTRIENT CAP', level: 2, max: 5, desc: '+2 Nutrient Grade capacity.' },
];

export function createLineage() {
  return {
    gp: LINEAGE_STARTER_GP,
    tier: LINEAGE_STARTER_TIER,
    earnedThisRun: 0,
    adaptiveImmunity: 0, // +15% per salvaged defeat, from Epigenetic Memory.
    classes: IMMUNE_CLASSES.map((c) => ({ ...c })),
    systems: ORGAN_SYSTEMS.map((s) => ({ ...s })),
    telemetry: [], // {wave, organ, chain} recorded at every wave end.
  };
}

export function lineageTierForGp(gp) {
  if (gp >= 1500) return 5;
  if (gp >= 900) return 4;
  if (gp >= 450) return 3;
  if (gp >= 150) return 2;
  return 1;
}

/** Bank Gene Points from a finished run; returns the new total. */
export function bankGenePoints(lineage, amount) {
  lineage.gp += amount;
  lineage.earnedThisRun = amount;
  lineage.tier = lineageTierForGp(lineage.gp);
  return lineage.gp;
}

/** Victory ending: +320 GP banked. Defeat ending: +110 GP salvaged. */
export function resolveVictoryEnding(lineage) {
  return bankGenePoints(lineage, GP_VICTORY);
}
export function resolveEpigeneticDefeatEnding(lineage) {
  lineage.adaptiveImmunity = Math.min(0.6, lineage.adaptiveImmunity + 0.15);
  return bankGenePoints(lineage, GP_DEFEAT);
}

/** Spend GP on a class or organ system; false when unaffordable/locked. */
export function unlockImmuneSystem(lineage, id) {
  const cls = lineage.classes.find((c) => c.id === id);
  if (!cls || cls.unlocked || lineage.gp < cls.cost) return false;
  lineage.gp -= cls.cost;
  cls.unlocked = true;
  lineage.tier = lineageTierForGp(lineage.gp);
  return true;
}
export function getUnlockedArmory(lineage) {
  return lineage.classes.filter((c) => c.unlocked);
}
export function organSystemLevel(lineage, id) {
  const s = lineage.systems.find((x) => x.id === id);
  return s ? s.level : 0;
}

/** Touch 1: record Organ Integrity + Combo at the end of every wave. */
export function recordWaveTelemetry(lineage, wave, organPct, chain) {
  lineage.telemetry.push({ wave, organ: Math.round(organPct), chain });
  if (lineage.telemetry.length > 15) lineage.telemetry.shift();
}

export function loadLineageBank() {
  try {
    const gp = Number.parseInt(window.localStorage.getItem(GP_KEY) ?? '', 10);
    const ad = Number.parseFloat(window.localStorage.getItem(ADAPTIVE_IMMUNITY_KEY) ?? '');
    const l = createLineage();
    if (Number.isFinite(gp) && gp > 0) { l.gp = gp; l.tier = lineageTierForGp(gp); }
    if (Number.isFinite(ad) && ad > 0) l.adaptiveImmunity = ad;
    return l;
  } catch { return createLineage(); }
}
export function saveLineageBank(lineage) {
  try {
    window.localStorage.setItem(GP_KEY, String(lineage.gp));
    window.localStorage.setItem(ADAPTIVE_IMMUNITY_KEY, String(lineage.adaptiveImmunity));
  } catch { /* storage off: bank lasts this visit only */ }
}
