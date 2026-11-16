// CYTOGUARD oncology: Oncogenic Rogue Cells & Targeted Therapeutic Drops.
// Dormant Dysplastic Cells sleep at the tissue edges from wave 4. A stray
// shot of the WRONG polarity (same polarity as the cell) wakes one: it
// mutates into a Malignant Tumor Cell. Active cancer divides by Mitosis
// every 6 s and grows an Angiogenesis Tether that drains the Organ Core,
// triggering ALERT: METASTASIS SURGE. Immune Evasion Armor makes cancer
// immune to ordinary shots — only the 2.5x Resonance Crit (opposite
// polarity), the Platelet Fibrin Triangle, or Drug Assistance can destroy it.
// When the metastasis warning appears, three Targeted Therapeutics capsules
// drop into the arena: Monoclonal Antibody (shield down 8 s), Angiogenesis
// Inhibitor (severs tethers, stops Mitosis), Nanobot Apoptosis Catalyst
// (chain beam destroys every tumor). Cancer threat is FIXED (40 / 120 HP, no
// wave scaling) so the player can learn it. Pure helpers over world state:
// no DOM, no clock. This module never imports world.js (acyclic by design);
// the world calls it, never the reverse.

import { CONFIG } from '../core/config.js';
import { spawnBurst, spawnLysisBurst } from '../render/effects.js';

export const KIND_DORMANT = 'dormant';
export const KIND_CANCER = 'cancer';

export const DRUG_MAB = 'mab';
export const DRUG_INHIBITOR = 'inhibitor';
export const DRUG_NANOBOT = 'nanobot';

export const DRUG_DEFS = [
  { id: DRUG_MAB, name: 'Monoclonal Antibody', short: 'mAb', label: 'mAb IMMUNOTHERAPY', desc: 'Collapses the Immune Evasion shield of ALL cancer cells for 8 s', colour: '#ffd166' },
  { id: DRUG_INHIBITOR, name: 'Angiogenesis Inhibitor', short: 'INH', label: 'INH', desc: 'Severs all parasitic tethers and stops Mitosis division', colour: '#7fd4ff' },
  { id: DRUG_NANOBOT, name: 'Nanobot Apoptosis Catalyst', short: 'NANO', label: 'NANO', desc: 'Precision tumor-destroying chain beam', colour: '#e8b4ff' },
];

export function drugDef(id) {
  for (let i = 0; i < DRUG_DEFS.length; i += 1) if (DRUG_DEFS[i].id === id) return DRUG_DEFS[i];
  return undefined;
}

export const DORMANT_HP = 40;
export const CANCER_HP = 120;
export const MITOSIS_INTERVAL = 6;
export const MAX_CANCER_CELLS = 6;
export const TETHER_ATTACH_DELAY = 1.5;
export const TETHER_DRAIN_PER_SEC = 1;
export const MAB_DURATION = 8;

/** Dormant cells per wave (from wave 4): 2, +1 every 2 waves, cap 4. */
export function dormantCountForWave(n) {
  if (n < 4) return 0;
  return Math.min(4, 2 + Math.floor((n - 4) / 2));
}

function freeEnemySlot(state) {
  for (let i = 0; i < state.enemies.length; i += 1) if (!state.enemies[i].active) return state.enemies[i];
  return null;
}

function freeShardSlot(state) {
  for (let i = 0; i < state.shards.length; i += 1) if (!state.shards[i].active) return state.shards[i];
  return null;
}

/** Spawn one oncology cell (dormant or cancer) at (x, y). Fixed threat, no wave scaling. */
export function spawnOncologyCell(state, kind, x, y) {
  const e = freeEnemySlot(state);
  if (!e) return null;
  const cfg = CONFIG.ENEMY[kind];
  e.active = true; e.kind = kind; e.x = x; e.y = y; e.vx = 0; e.vy = 0;
  e.maxHp = kind === KIND_CANCER ? CANCER_HP : DORMANT_HP;
  e.hp = e.maxHp;
  e.radius = cfg.radius; e.speed = cfg.speed; e.damage = cfg.damage;
  e.polarity = state.rng() < 0.5 ? 'bio' : 'toxin';
  e.shootTimer = 0; e.telegraph = 0; e.dashState = 0; e.dashTimer = 0; e.dashAngle = 0;
  e.shielded = false; e.boss = false;
  e.burstTimer = 3; e.laserPhase = 'rest'; e.laserTimer = 2; e.laserAngle = 0;
  e.spawnAnim = 0.4; e.flash = 0; e.seed = state.rng() * Math.PI * 2; e.angle = 0; e.wobble = 0;
  e.mitosisTimer = kind === KIND_CANCER ? MITOSIS_INTERVAL : 0;
  e.tether = false; e.tetherTimer = kind === KIND_CANCER ? TETHER_ATTACH_DELAY : 0;
  return e;
}

/** Spawn `count` Dormant Dysplastic Cells at tissue edges (waves 4+). */
export function spawnDormantCells(state, count) {
  const spawned = [];
  for (let i = 0; i < count; i += 1) {
    const side = Math.floor(state.rng() * 4);
    const m = 40;
    let x;
    let y;
    if (side === 0) { x = m + state.rng() * (CONFIG.FIELD.W - 2 * m); y = m; }
    else if (side === 1) { x = m + state.rng() * (CONFIG.FIELD.W - 2 * m); y = CONFIG.FIELD.H - m; }
    else if (side === 2) { x = m; y = m + state.rng() * (CONFIG.FIELD.H - 2 * m); }
    else { x = CONFIG.FIELD.W - m; y = m + state.rng() * (CONFIG.FIELD.H - 2 * m); }
    const e = spawnOncologyCell(state, KIND_DORMANT, x, y);
    if (e) spawned.push(e);
  }
  return spawned;
}

/** A dormant cell hit by a WRONG-polarity (same-polarity) shot mutates into a Malignant Tumor Cell. */
export function mutateDormantCell(state, e) {
  e.kind = KIND_CANCER;
  e.maxHp = CANCER_HP; e.hp = CANCER_HP;
  e.radius = CONFIG.ENEMY.cancer.radius;
  e.speed = CONFIG.ENEMY.cancer.speed;
  e.damage = CONFIG.ENEMY.cancer.damage;
  e.mitosisTimer = MITOSIS_INTERVAL;
  e.tether = false; e.tetherTimer = TETHER_ATTACH_DELAY;
  e.flash = 0.2;
  spawnLysisBurst(state.particles, state.rng, e.x, e.y, '#ff2e4d', 16);
  return e;
}

/** Count live cells of a kind. */
export function countActiveCells(state, kind) {
  let n = 0;
  for (const e of state.enemies) if (e.active && e.kind === kind) n += 1;
  return n;
}

/** Mitosis: one cancer cell divides into two (capped at 6 active). Returns the child or null. */
export function divideCancerCell(state, parent) {
  if (countActiveCells(state, KIND_CANCER) >= MAX_CANCER_CELLS) return null;
  const a = state.rng() * Math.PI * 2;
  const child = spawnOncologyCell(state, KIND_CANCER,
    Math.max(30, Math.min(CONFIG.FIELD.W - 30, parent.x + Math.cos(a) * 44)),
    Math.max(30, Math.min(CONFIG.FIELD.H - 30, parent.y + Math.sin(a) * 44)));
  if (child) spawnBurst(state.particles, state.rng, parent.x, parent.y, '#ff2e4d', 10, 140, 4);
  return child;
}

/**
 * Trigger the metastasis surge: the first parasitic tether attaches, the
 * ALERT goes up, and three Targeted Therapeutics capsules drop into the
 * arena (one of each). Returns true when newly triggered.
 */
export function triggerMetastasis(state) {
  if (state.metastasisSurge) return false;
  state.metastasisSurge = true;
  const spots = [
    { x: 320, y: 200 }, { x: 960, y: 200 }, { x: 640, y: 540 },
  ];
  const drugs = [DRUG_MAB, DRUG_INHIBITOR, DRUG_NANOBOT];
  for (let i = 0; i < 3; i += 1) {
    const s = freeShardSlot(state);
    if (!s) break;
    s.active = true;
    s.x = spots[i].x + (state.rng() - 0.5) * 60;
    s.y = spots[i].y + (state.rng() - 0.5) * 60;
    s.vx = 0; s.vy = 0; s.value = 0; s.magnet = false;
    s.kind = 'drug-' + drugs[i];
  }
  return true;
}

/**
 * Apply a Targeted Therapeutic drug. Returns a summary for the event.
 * mAb: evasion shield down 8 s for ALL cancer cells (gold targets).
 * Inhibitor: severs all tethers, stops Mitosis for the rest of the wave.
 * Nanobot: a precision chain beam destroys every active cancer cell.
 */
export function applyTherapeuticDrug(state, drug) {
  if (drug === DRUG_MAB) {
    state.mabTimer = MAB_DURATION;
    return { drug, affected: countActiveCells(state, KIND_CANCER) };
  }
  if (drug === DRUG_INHIBITOR) {
    let severed = 0;
    for (const e of state.enemies) {
      if (!e.active || e.kind !== KIND_CANCER) continue;
      if (e.tether) severed += 1;
      e.tether = false; e.tetherTimer = 9999;
    }
    state.mitosisBlocked = true;
    return { drug, affected: severed };
  }
  // Nanobot Apoptosis Catalyst: chain beam destroys every active tumor.
  const points = [];
  let killed = 0;
  for (const e of state.enemies) {
    if (!e.active || e.kind !== KIND_CANCER) continue;
    points.push([e.x, e.y]);
    spawnLysisBurst(state.particles, state.rng, e.x, e.y, '#e8b4ff', 20);
    e.active = false;
    killed += 1;
    state.kills += 1; state.stats.kills += 1;
    state.score += 40;
  }
  state.nanobotBeam = { timer: 0.6, points };
  return { drug, affected: killed };
}
