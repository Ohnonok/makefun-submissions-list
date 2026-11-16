// CYTOGUARD world: the whole simulation in one place. A fixed timestep loop
// (1/60 s, dt clamped to 0.05) drives the cell, the Organ Core, the pathogens,
// the platelets and the waves. Everything the renderer draws comes from this
// state; every number the judge reads comes from this state. Deterministic:
// the only randomness is the seeded generator created by createWorld(seed),
// so two runs with the same seed and the same inputs produce the same run.
// The update step returns a list of events (shoot, lysis, absorb, waveCleared,
// gameover, victory, ...) that main.js turns into sound and screen changes.

import { CONFIG } from './config.js';
import { createRandom } from './random.js';
import { togglePolarity, absorbMatchingOrb, calcResonanceCrit } from '../systems/polarity.js';
import { PLATELET_NODES, linkPlateletThread, checkTriangleBurst, pointInTriangle } from '../systems/constellation.js';
import { addATP, checkGraze, activateFever, isFevered, applyHeatVent } from '../systems/overdrive.js';
import { updatePhysiologyState, getPhysiologyModifiers, PHYS_FEBRILE } from '../systems/physiology.js';
import { KIND_DORMANT, KIND_CANCER, spawnDormantCells, dormantCountForWave, mutateDormantCell, divideCancerCell, countActiveCells, triggerMetastasis, applyTherapeuticDrug, MITOSIS_INTERVAL, TETHER_DRAIN_PER_SEC } from '../systems/oncology.js';
import { checkGeneAwakenings } from '../systems/synergies.js';
import { bossMaxHp, bossPhase, bossTentacles, bossBurstCount, bossBurstAngles, bossSpiralAngles, updateBossAttacks, laserHitsPoint, BOSS_LASER_DAMAGE } from '../entities/apex-boss.js';
import { applyWeaponToPlayer } from '../entities/weapons.js';
import { biomeForWave, BIOMES, ALVEOLAR_WALLS, SILICA_PRISMS, prismHitByPoint, resolveWallCollision, pointHitsWall, pointInStormRing, stormRingCentre, CORE_SHIELD_RADIUS, STORM_RING } from '../systems/campaign.js';
import { pickEnemyKind, ENEMY_POLARITY } from '../entities/pathogens.js';
import { rollUpgradeChoices, applyUpgradeToState } from '../systems/draft.js';
import { spawnBurst, spawnLysisBurst, spawnShockwave, spawnTrailSpark, spawnHeatRise, spawnDamageNumber, updateParticles, updateDamageNumbers } from '../render/effects.js';
import { createNutrients, tickNutrients } from '../systems/nutrients.js';
import { updateInfectionPhase, applyQuorumSensing, triggerBinaryFission, spawnToxinEndospore } from '../systems/infection.js';
import { createDirector, evaluatePacing, triggerSecondWind } from '../systems/director.js';
import { createRhythm, tickRhythm, systolicMultiplier } from '../systems/rhythm.js';
import { createGenetics, tickGenetics, morphActive } from '../systems/genetics.js';
import { triggerWaveEmergency } from '../systems/campaign.js';
import { createSymbiosis, tryOpsonize, hijackOnDash, updateSymbiotes } from '../systems/symbiosis.js';
import { createFluidics, activateValve, tickFluidics } from '../systems/fluidics.js';
import { createContracts, startContractForStage, updateContracts } from '../systems/contracts.js';
import { ACTION_VALVE } from './input.js';

const TAU = Math.PI * 2;

function makeEnemy() {
  return { active: false, kind: 'bacillus', x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: 1, radius: 14, speed: 60, damage: 8, polarity: 'bio', shootTimer: 0, telegraph: 0, dashState: 0, dashTimer: 0, dashAngle: 0, shielded: false, boss: false, burstTimer: 3, laserPhase: 'rest', laserTimer: 2, laserAngle: 0, spawnAnim: 0, flash: 0, seed: 0, angle: 0, wobble: 0, mitosisTimer: 0, tether: false, tetherTimer: 0 };
}
function makeProjectile() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 0, pierce: 0, crit: false, polarity: 'bio', style: 'lance', splitDone: false, radius: 5 };
}
function makeEnemyProjectile() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 0, polarity: 'toxin', radius: 6, grazed: false };
}
function makeParticle() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 3, colour: '#ffffff', vesicle: false, ring: false, maxR: 0 };
}
function makeDamageNumber() {
  return { active: false, x: 0, y: 0, text: '', colour: '#ffffff', life: 0, maxLife: 0, crit: false };
}
function makeShard() {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, value: 0, magnet: false, kind: 'nutrient' };
}
function makeThread() {
  return { active: false, ax: 0, ay: 0, bx: 0, by: 0, life: 0, maxLife: 0, nodeA: -1, nodeB: -1 };
}
function makeNode() {
  return { x: 0, y: 0, linked: false, pulse: 0, active: false };
}

export function createWorld(seed, opts) {
  const rng = createRandom(seed);
  const state = {
    seed, rng, time: 0, timeScale: 1, hitStop: 0, shake: 0,
    screen: 'title',
    player: {
      x: 640, y: 520, vx: 0, vy: 0, radius: 16, hp: 100, maxHp: 100,
      speed: 300, damage: 18, fireInterval: 0.38, multishot: 1, pierce: 2,
      bulletSpeed: 760, spread: 0.06, critChance: 0.15,
      weaponId: 'lance', weaponName: 'T-Cell Lance', projectileStyle: 'lance',
      prismSplit: 0, dashCooldown: 0, dashTimer: 0, invuln: 0, fireTimer: 0,
      heat: 0, overheated: false, overdrive: 0, feverTimer: 0, feverActive: false,
      feverStartX: 0, feverStartY: 0, offeringUsed: false,
      grazesThisWave: 0, grazeCombo: 0, moveAngle: -Math.PI / 2, moveSpeed: 0,
      polarity: 'bio',
    },
    core: { x: 640, y: 360, hp: 100, maxHp: 100, radius: 46 },
    wave: 0, phase: 'intro', waveTimer: 0, enemiesToSpawn: 0, spawnTimer: 0, spawned: 0,
    enemies: [], projectiles: [], enemyProjectiles: [], particles: [], damageNumbers: [], shards: [], threads: [],
    nodes: [], nutrientPoints: 0, score: 0, kills: 0, chain: 0, chainTimer: 0, maxChain: 0,
    upgradesOwned: {}, evolutions: [], evolution: null, choices: [], pendingMythic: false,
    omens: { swift: false, swarm: false, elite: false, drain: false },
    boss: null, bossWarned: false, bossDefeated: 0,
    stormX: 640, stormY: 100, aim: { x: 640, y: 300 },
    physiology: 'homeostasis', heatTimer: 0,
    metastasisSurge: false, mabTimer: 0, mitosisBlocked: false, nanobotBeam: null,
    stats: { shots: 0, hits: 0, damage: 0, kills: 0, tumors: 0, waves: 0, offering: 0 },
    best: (opts && opts.best) || 0,
    events: [], biomeId: 'capillary', biomeName: '', biomeSubtitle: '',
    nutrients: createNutrients(), infectionPhase: 'INCUBATION', director: createDirector(),
    rhythm: createRhythm(72), genetics: createGenetics(), branch: 'lungs', protocol: 'virulent',
    endless: false, emergency: null, telemetry: [], killCam: 0, stepDt: 1 / 60, biofilmCount: 0,
    lineageGp: 450, adaptiveImmunity: 0,
    symbiosis: createSymbiosis(), fluidics: createFluidics(), contracts: createContracts(),
    waveStartTime: 0, lastWaveStats: null,
  };
  for (let i = 0; i < 160; i += 1) state.enemies.push(makeEnemy());
  for (let i = 0; i < 128; i += 1) state.projectiles.push(makeProjectile());
  for (let i = 0; i < 96; i += 1) state.enemyProjectiles.push(makeEnemyProjectile());
  for (let i = 0; i < 320; i += 1) state.particles.push(makeParticle());
  for (let i = 0; i < 48; i += 1) state.damageNumbers.push(makeDamageNumber());
  for (let i = 0; i < 64; i += 1) state.shards.push(makeShard());
  for (let i = 0; i < 8; i += 1) state.threads.push(makeThread());
  for (let i = 0; i < 4; i += 1) state.nodes.push(makeNode());
  resetRunState(state);
  return state;
}

/** Full run reset: wave 1, fresh cell, fresh Core, no leftovers. */
export function resetRunState(state) {
  state.time = 0; state.timeScale = 1; state.hitStop = 0; state.shake = 0;
  state.screen = 'title';
  const p = state.player;
  p.x = 640; p.y = 520; p.vx = 0; p.vy = 0; p.hp = 100; p.maxHp = 100;
  p.heat = 0; p.overheated = false; p.overdrive = 0; p.feverTimer = 0; p.feverActive = false;
  p.offeringUsed = false; p.grazesThisWave = 0; p.grazeCombo = 0;
  p.dashCooldown = 0; p.dashTimer = 0; p.invuln = 0; p.fireTimer = 0;
  p.polarity = 'bio'; p.projectileStyle = 'lance'; p.prismSplit = 0;
  applyWeaponToPlayer(p, 'lance');
  state.core.hp = 100; state.core.maxHp = 100;
  state.wave = 0; state.phase = 'intro'; state.waveTimer = 0;
  state.enemiesToSpawn = 0; state.spawnTimer = 0; state.spawned = 0;
  for (const e of state.enemies) e.active = false;
  for (const b of state.projectiles) b.active = false;
  for (const b of state.enemyProjectiles) b.active = false;
  for (const pt of state.particles) pt.active = false;
  for (const n of state.damageNumbers) n.active = false;
  for (const s of state.shards) s.active = false;
  state.alveolarWalls = [];
  state.silicaPrisms = [];
  for (const t of state.threads) t.active = false;
  state.nutrientPoints = 0; state.score = 0; state.kills = 0;
  state.chain = 0; state.chainTimer = 0; state.maxChain = 0;
  state.upgradesOwned = {}; state.evolutions = []; state.evolution = null;
  state.choices = []; state.pendingMythic = false;
  state.omens = { swift: false, swarm: false, elite: false, drain: false };
  state.boss = null; state.bossWarned = false; state.bossDefeated = 0;
  state.physiology = 'homeostasis'; state.heatTimer = 0;
  state.metastasisSurge = false; state.mabTimer = 0; state.mitosisBlocked = false; state.nanobotBeam = null;
  state.stats = { shots: 0, hits: 0, damage: 0, kills: 0, tumors: 0, waves: 0, offering: 0 };
  state.events = []; state.biomeId = 'capillary';
  state.nutrients = createNutrients(); state.infectionPhase = 'INCUBATION';
  state.director = createDirector(); state.rhythm = createRhythm(72); state.genetics = createGenetics();
  state.branch = 'lungs'; state.endless = false; state.emergency = null; state.telemetry = [];
  state.killCam = 0; state.biofilmCount = 0; state.lineageGp = 450;
  state.symbiosis = createSymbiosis(); state.fluidics = createFluidics(); state.contracts = createContracts();
  state.lastWaveStats = null;
}

/** Start wave n: set the zone, the spawn budget, the platelets, the omens. */
export function startWave(state, n) {
  state.wave = n;
  state.phase = 'intro';
  state.waveTimer = 0;
  state.waveStartTime = state.time;
  state.spawned = 0;
  state.enemiesToSpawn = CONFIG.WAVE.count(n) + (state.omens.swarm ? 8 : 0);
  state.spawnTimer = 0.6;
  state.biomeId = biomeForWave(n);
  if (n >= 5 && n <= 8) state.biomeName = state.branch === 'liver' ? 'Hepatic Liver' : 'Alveolar Lungs';
  triggerWaveEmergency(state);
  startContractForStage(state.contracts, n >= 13 ? 'marrow' : n >= 9 ? 'cardiac' : n >= 5 ? (state.branch === 'liver' ? 'liver' : 'lungs') : 'lungs');
  const bio = BIOMES[state.biomeId];
  state.biomeName = bio.name;
  state.biomeSubtitle = bio.subtitle;
  // Fresh platelet nodes for this zone (zones have 3 or 4 nodes; extras sleep).
  const defs = PLATELET_NODES[state.biomeId];
  for (let i = 0; i < state.nodes.length; i += 1) {
    if (i < defs.length) {
      state.nodes[i].x = defs[i].x;
      state.nodes[i].y = defs[i].y;
      state.nodes[i].linked = false;
      state.nodes[i].pulse = 0;
      state.nodes[i].active = true;
    } else {
      state.nodes[i].linked = false;
      state.nodes[i].active = false;
    }
  }
  // Alveolar walls + Silica Prisms are drawn by the renderer from world state.
  if (state.biomeId === 'alveolar') {
    state.alveolarWalls = ALVEOLAR_WALLS;
    state.silicaPrisms = SILICA_PRISMS;
  } else {
    state.alveolarWalls = [];
    state.silicaPrisms = [];
  }
  for (const t of state.threads) t.active = false;
  state.player.offeringUsed = false;
  state.player.grazesThisWave = 0;
  state.player.grazeCombo = 0;
  state.bossWarned = false;
  // A new wave resets the mitosis block (the Inhibitor's effect ends here).
  state.mitosisBlocked = false;
  // Dormant Dysplastic Cells sleep at the tissue edges from wave 4.
  if (n >= 4) spawnDormantCells(state, dormantCountForWave(n));
  if (n === 13 || n % CONFIG.BOSS_EVERY === 0) {
    state.events.push({ type: 'bossWarn' });
    state.bossWarned = true;
  }
}

function freeEnemy(state) {
  for (const e of state.enemies) if (!e.active) return e;
  return null;
}
function freeProjectile(state) {
  for (const b of state.projectiles) if (!b.active) return b;
  return null;
}
function freeEnemyProjectile(state) {
  for (const b of state.enemyProjectiles) if (!b.active) return b;
  return null;
}
function freeShard(state) {
  for (const s of state.shards) if (!s.active) return s;
  return null;
}

/** Spawn one pathogen at (x, y). Exported for shot staging and play-tests. */
export function spawnEnemy(state, kind, x, y) {
  const e = freeEnemy(state);
  if (!e) return null;
  const cfg = CONFIG.ENEMY[kind === 'boss' ? 'bacillus' : kind];
  const wave = state.wave;
  // Oncology threat is fixed (40 / 120 HP, no wave scaling) so it stays learnable.
  const hpMul = (kind === KIND_DORMANT || kind === KIND_CANCER) ? 1 : 1 + (wave - 1) * CONFIG.WAVE.hpScale(wave);
  e.active = true; e.kind = kind; e.x = x; e.y = y; e.vx = 0; e.vy = 0;
  e.maxHp = Math.round((kind === 'boss' ? bossMaxHp(wave, 5) : cfg.hp) * (kind === 'boss' ? 1 : hpMul));
  e.hp = e.maxHp;
  e.radius = kind === 'boss' ? 58 : cfg.radius;
  e.speed = cfg.speed * (1 + (wave - 1) * 0.04) * (state.omens.swift ? 1.25 : 1);
  e.damage = cfg.damage;
  e.polarity = ENEMY_POLARITY[kind] || (state.rng() < 0.5 ? 'bio' : 'toxin');
  e.shootTimer = 1.5 + state.rng() * 1.5;
  e.telegraph = 0; e.dashState = 0; e.dashTimer = 0; e.dashAngle = 0;
  e.shielded = false; e.boss = kind === 'boss';
  e.elite = state.director && state.director.alphaRate === 1 && state.rng() < 0.2; e.opsonized = false;
  e.burstTimer = 3; e.laserPhase = 'rest'; e.laserTimer = 2; e.laserAngle = 0;
  e.spawnAnim = 0.4; e.flash = 0; e.seed = state.rng() * TAU; e.angle = 0; e.wobble = 0;
  e.mitosisTimer = kind === KIND_CANCER ? MITOSIS_INTERVAL : 0;
  e.tether = false; e.tetherTimer = kind === KIND_CANCER ? 1.5 : 0;
  if (kind === 'boss') state.boss = e;
  return e;
}

function spawnEdgePosition(state) {
  const side = Math.floor(state.rng() * 4);
  const m = 30;
  if (side === 0) return { x: m + state.rng() * (CONFIG.FIELD.W - 2 * m), y: m };
  if (side === 1) return { x: m + state.rng() * (CONFIG.FIELD.W - 2 * m), y: CONFIG.FIELD.H - m };
  if (side === 2) return { x: m, y: m + state.rng() * (CONFIG.FIELD.H - 2 * m) };
  return { x: CONFIG.FIELD.W - m, y: m + state.rng() * (CONFIG.FIELD.H - 2 * m) };
}

/** Symbiotic Guardian Drone fire: a Perforin bolt from the drone's position. */
function fireDroneBolt(state, drone, angle) {
  const b = freeProjectile(state);
  if (!b) return;
  b.active = true;
  b.x = drone.x + Math.cos(angle) * 20;
  b.y = drone.y + Math.sin(angle) * 20;
  b.vx = Math.cos(angle) * 760;
  b.vy = Math.sin(angle) * 760;
  b.damage = 14; b.pierce = 1; b.crit = false;
  b.polarity = state.player.polarity; b.style = 'lance'; b.splitDone = false;
  b.radius = 5;
}
function firePlayerBolt(state, angle, damage, crit) {
  const p = state.player;
  const b = freeProjectile(state);
  if (!b) return;
  b.active = true;
  b.x = p.x + Math.cos(angle) * 22;
  b.y = p.y + Math.sin(angle) * 22;
  b.vx = Math.cos(angle) * p.bulletSpeed;
  b.vy = Math.sin(angle) * p.bulletSpeed;
  b.damage = damage; b.pierce = p.pierce; b.crit = crit;
  b.polarity = p.polarity; b.style = p.projectileStyle; b.splitDone = false;
  b.radius = 5;
  state.stats.shots += 1;
}

function damageEnemy(state, e, amount, crit, fromBolt, resonance) {
  if (!e.active) return;
  // Tagged for capture: an opsonized elite takes no further bolt damage
  // while its 6 s capture window runs (AoE can still finish it).
  if (e.opsonized && fromBolt) return;
  // Immune Evasion Armor: a cancer cell shrugs off ordinary shots. Only a
  // 2.5x Resonance Crit, a mAb-collapsed shield, or AoE (Triangle / Nova /
  // Offering / Drugs, which arrive with fromBolt=false) can hurt it.
  if (e.kind === KIND_CANCER && fromBolt && !resonance && (state.mabTimer || 0) <= 0) {
    spawnDamageNumber(state.damageNumbers, e.x, e.y - e.radius - 6, 'IMMUNE', '#8a8a9a', false);
    return;
  }
  const opsonizedNow = tryOpsonize(state, e, resonance, crit);
  let dmg = amount;
  if (e.shielded) dmg = Math.round(dmg * 0.5);
  if (e.omega && state.nutrients && Math.max(state.nutrients.vit, state.nutrients.pro, state.nutrients.min) < 4) dmg = Math.round(dmg * 0.25); // Adaptive Biofilm Carapace: 75% DR vs Grade 1-3.
  if (e.omega) dmg = Math.round(dmg * systolicMultiplier(state.rhythm));
  if (opsonizedNow) dmg = Math.min(dmg, Math.max(0, e.hp - 1)); // The opsonizing hit never kills: the elite survives at 1 HP to be dash-hijacked.
  e.hp -= dmg;
  e.flash = 0.12;
  state.stats.damage += dmg;
  spawnDamageNumber(state.damageNumbers, e.x + (state.rng() - 0.5) * 20, e.y - e.radius - 6, String(Math.round(dmg)), crit ? '#ffd166' : '#ffffff', crit);
  if (e.hp <= 0) killEnemy(state, e, fromBolt);
}

function killEnemy(state, e, fromBolt) {
  e.active = false;
  state.kills += 1;
  state.stats.kills += 1;
  // Tumors Neutralized: the victory stat counts malignant cells destroyed.
  if (e.kind === KIND_CANCER) state.stats.tumors += 1;
  const mods = getPhysiologyModifiers(state);
  // Chain: kills inside the 2.5 s window stack; the bar pays bonus nutrients.
  if (state.chainTimer > 0) state.chain += 1;
  else state.chain = 1;
  state.chainTimer = 2.5;
  if (state.chain > state.maxChain) state.maxChain = state.chain;
  const colour = e.polarity === 'bio' ? '#ffd166' : '#c77dff';
  spawnLysisBurst(state.particles, state.rng, e.x, e.y, colour, e.boss ? 46 : 12);
  state.events.push({ type: 'lysis', boss: e.boss, x: e.x, y: e.y });
  if (e.boss) {
    if (e.omega) { state.killCam = 90; state.hitStop = 0.12; } // Apex Kill-Cam: 120 ms hit-stop + 90 ticks (1.5 s) 0.25x slow-mo, tick-driven.
    state.boss = null;
    state.bossDefeated += 1;
    state.score += Math.round(500 * mods.scoreGain);
    state.shake = 0.6;
    // Boss death: a huge chromatic shockwave rings the arena.
    spawnShockwave(state.particles, state.rng, e.x, e.y, 260);
    for (let i = 0; i < 6; i += 1) {
      const s = freeShard(state);
      if (s) { s.active = true; s.x = e.x + (state.rng() - 0.5) * 80; s.y = e.y + (state.rng() - 0.5) * 80; s.vx = 0; s.vy = 0; s.value = 8; s.magnet = false; s.kind = 'nutrient'; }
    }
  } else {
    state.score += Math.round((10 + state.chain * 2) * mods.scoreGain);
    const s = freeShard(state);
    if (s) {
      s.active = true; s.x = e.x; s.y = e.y;
      s.vx = (state.rng() - 0.5) * 60; s.vy = (state.rng() - 0.5) * 60;
      s.value = e.kind === 'plastic' ? 8 : 4;
      s.magnet = false;
      s.kind = 'nutrient';
    }
    // Febrile crisis: fallen pathogens drop Vital Stem-Orbs (+6 Organ Integrity).
    if (mods.stemOrbs && state.rng() < 0.35) {
      const stem = freeShard(state);
      if (stem) {
        stem.active = true; stem.x = e.x; stem.y = e.y;
        stem.vx = (state.rng() - 0.5) * 40; stem.vy = -30;
        stem.value = 0; stem.magnet = false; stem.kind = 'stem';
      }
    }
  }
  if (state.infectionPhase === 'ACUTE SEPSIS') spawnToxinEndospore(state, e.x, e.y, e.polarity || 'bio');
  // Fever: every kill extends the fever by 0.4 s.
  if (state.player.feverTimer > 0) state.player.feverTimer += 0.4;
  // Chain chime every 5th chain step.
  if (state.chain % 5 === 0) state.events.push({ type: 'chain', step: state.chain });
}

function fireEnemyOrb(state, e, angle, speed, damage) {
  const b = freeEnemyProjectile(state);
  if (!b) return;
  b.active = true;
  b.x = e.x + Math.cos(angle) * (e.radius + 6);
  b.y = e.y + Math.sin(angle) * (e.radius + 6);
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
  b.damage = damage;
  b.polarity = e.polarity;
  b.radius = 6;
  b.grazed = false;
}

/** The Organ Core takes a hit: integrity falls, the screen shakes. */
function damageCore(state, amount) {
  state.core.hp -= amount;
  state.shake = Math.max(state.shake, 0.25);
  state.events.push({ type: 'coreHurt' });
  if (state.core.hp <= 0) {
    state.core.hp = 0;
    state.screen = 'over';
    state.events.push({ type: 'gameover' });
  }
}

function damagePlayer(state, amount) {
  const p = state.player;
  if (p.invuln > 0 || p.dashTimer > 0) return;
  p.hp -= amount;
  p.invuln = 0.9;
  state.shake = Math.max(state.shake, 0.3);
  spawnBurst(state.particles, state.rng, p.x, p.y, '#ff5c7a', 10, 160, 4);
  state.events.push({ type: 'hurt' });
  if (p.hp <= 0) {
    p.hp = 0;
    state.screen = 'over';
    state.events.push({ type: 'gameover' });
  }
}

/** Fibrin Dash: a 220 px dash that parries toxins and links platelet nodes. */
function doDash(state, moveX, moveY, aimX, aimY) {
  const p = state.player;
  if (p.dashCooldown > 0) return;
  let dx = moveX;
  let dy = moveY;
  if (dx === 0 && dy === 0) { dx = aimX - p.x; dy = aimY - p.y; }
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  p.dashTimer = 0.16;
  p.dashCooldown = 2.5;
  p.invuln = Math.max(p.invuln, 0.25);
  const nx = p.x + dx * 220;
  const ny = p.y + dy * 220;
  // The dash path links every platelet node it passes (range +25% in homeostasis).
  const linkRange = 34 * getPhysiologyModifiers(state).triangleRange;
  const passed = [];
  for (let i = 0; i < state.nodes.length; i += 1) {
    const n = state.nodes[i];
    if (!n.active) continue;
    const px = n.x - p.x;
    const py = n.y - p.y;
    const t = Math.max(0, Math.min(220, px * dx + py * dy));
    const cx = p.x + dx * t;
    const cy = p.y + dy * t;
    if (Math.hypot(n.x - cx, n.y - cy) < linkRange) passed.push(i);
  }
  const ox = p.x; const oy = p.y;
  p.x = Math.max(p.radius, Math.min(CONFIG.FIELD.W - p.radius, nx));
  p.y = Math.max(p.radius, Math.min(CONFIG.FIELD.H - p.radius, ny));
  state.events.push({ type: 'dash' });
  hijackOnDash(state, ox, oy, p.x, p.y); // Symbiosis: dash through an opsonized elite hijacks it.
  if (passed.length > 0) {
    const linked = linkPlateletThread(state, passed, state.time);
    if (linked) {
      state.events.push({ type: 'triangle' });
      const triangle = checkTriangleBurst(state, state.time);
      if (triangle) {
        // Oxidative Burst: 60 damage to every pathogen inside the triangle.
        const [a, b, c] = triangle;
        const na = state.nodes[a];
        const nb = state.nodes[b];
        const nc = state.nodes[c];
        // Chromatic shockwave rings from the triangle centroid.
        spawnShockwave(state.particles, state.rng, (na.x + nb.x + nc.x) / 3, (na.y + nb.y + nc.y) / 3, 200);
        for (const e of state.enemies) {
          if (!e.active || e.boss) continue;
          if (pointInTriangle(e.x, e.y, na.x, na.y, nb.x, nb.y, nc.x, nc.y)) {
            spawnLysisBurst(state.particles, state.rng, e.x, e.y, '#ffd166', 8);
            damageEnemy(state, e, 60, false, false);
          }
        }
        state.events.push({ type: 'triangleBurst' });
      }
    }
  }
}

/** Marrow Offering: at the Core, sacrifice 15% integrity for a cleansing wave. */
function doOffering(state) {
  const p = state.player;
  if (p.offeringUsed) return;
  const d = Math.hypot(p.x - state.core.x, p.y - state.core.y);
  if (d > state.core.radius + 60) return;
  p.offeringUsed = true;
  state.stats.offering += 1;
  state.core.hp = Math.max(1, state.core.hp - state.core.maxHp * 0.15);
  state.pendingMythic = true;
  state.events.push({ type: 'offering' });
  // Cytokine Cleansing Wave: 40 damage to every pathogen on the field.
  for (const e of state.enemies) {
    if (!e.active) continue;
    spawnBurst(state.particles, state.rng, e.x, e.y, '#7dffb0', 6, 120, 4);
    damageEnemy(state, e, 40, false, false);
  }
  spawnBurst(state.particles, state.rng, state.core.x, state.core.y, '#7dffb0', 40, 320, 5);
  // Chromatic shockwave rings from the Core.
  spawnShockwave(state.particles, state.rng, state.core.x, state.core.y, 230);
  state.shake = Math.max(state.shake, 0.4);
}

/** One fixed-timestep simulation step. input: {move, aim, firing, actions}. */
export function update(state, input, dt) {
  const p = state.player;
  const events = state.events;
  state.time += dt;
  // Dual physiological state: the body's phase follows Organ Integrity live.
  const phys = updatePhysiologyState(state);
  if (phys.changed) events.push({ type: phys.phase === PHYS_FEBRILE ? 'febrile' : 'homeostasis' });
  const mods = getPhysiologyModifiers(state);
  state.stepDt = dt;
  updateInfectionPhase(state);
  applyQuorumSensing(state);
  tickNutrients(state.nutrients, dt);
  tickRhythm(state.rhythm, dt, state.physiology === PHYS_FEBRILE);
  tickGenetics(state.genetics, dt);
  triggerBinaryFission(state, spawnEnemy);
  state.spawnMul = evaluatePacing(state, state.director).spawnMul;
  triggerSecondWind(state, state.director);
  for (const e of state.enemies) {
    if (e.active && e.opsonized) {
      e.opsonizeTimer = (e.opsonizeTimer ?? 6) - dt;
      if (e.opsonizeTimer <= 0) { e.opsonized = false; e.opsonizeTimer = 0; }
    }
  }
  tickFluidics(state, dt);
  updateSymbiotes(state, dt, fireDroneBolt);
  updateContracts(state, dt);
  if (state.killCam > 0) { state.killCam -= 1; state.timeScale = 0.25; } // Kill-Cam: tick-driven 0.25x slow-mo.
  if (morphActive(state.genetics)) state.player.damage = 26;
  if (state.hitStop > 0) { state.hitStop -= dt; return events; }
  state.timeScale += ((isFevered(state) ? CONFIG.PLAYER.feverSlow : 1) - state.timeScale) * Math.min(1, dt * 6);
  const sdt = dt * state.timeScale;
  state.aim = input.aim;

  // --- timers ---
  if (p.invuln > 0) p.invuln -= dt;
  // Space Dash energy regenerates 35% faster in a healthy body (homeostasis).
  if (p.dashCooldown > 0) p.dashCooldown -= dt * mods.dashRegen;
  if (p.dashTimer > 0) p.dashTimer -= dt;
  if (p.feverTimer > 0) {
    p.feverTimer -= dt;
    if (p.feverTimer <= 0) { p.feverTimer = 0; p.feverActive = false; }
  }
  if (state.chainTimer > 0) {
    state.chainTimer -= dt;
    if (state.chainTimer <= 0) state.chain = 0;
  }
  if (state.evolution && state.evolution.timer > 0) state.evolution.timer -= dt;
  if (state.mabTimer > 0) state.mabTimer -= dt;
  if (state.nanobotBeam) {
    state.nanobotBeam.timer -= dt;
    if (state.nanobotBeam.timer <= 0) state.nanobotBeam = null;
  }
  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 1.4);
  if (state.waveTimer !== undefined) state.waveTimer += dt;

  // --- one-shot actions ---
  const a = input.actions || 0;
  if (a & 128) { // ACTION_POLARITY
    togglePolarity(state);
    events.push({ type: 'polarity', polarity: p.polarity });
  }
  if (a & 1024) { // ACTION_VENT
    const res = applyHeatVent(state);
    if (res === 'perfect') {
      events.push({ type: 'vent' });
      for (const e of state.enemies) {
        if (!e.active) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < CONFIG.PLAYER.novaRadius) damageEnemy(state, e, CONFIG.PLAYER.novaDamage, false, false);
      }
      spawnBurst(state.particles, state.rng, p.x, p.y, '#ffd166', 30, 300, 5);
      state.shake = Math.max(state.shake, 0.3);
    } else if (res === 'partial') {
      events.push({ type: 'ventWeak' });
    }
  }
  if (a & 256) { // ACTION_AWAKEN (Fever)
    if (activateFever(state)) {
      p.feverStartX = p.x; p.feverStartY = p.y;
      events.push({ type: 'fever' });
    }
  }
  if (a & 512) doOffering(state); // ACTION_OFFERING
  if (a & ACTION_VALVE) activateValve(state); // V: Vascular Valve Gate.
  if (a & 64) doDash(state, input.move.x, input.move.y, input.aim.x, input.aim.y); // ACTION_DASH

  // --- movement (normalized diagonal, wall-aware) ---
  let mx = input.move.x;
  let my = input.move.y;
  const mlen = Math.hypot(mx, my);
  if (mlen > 1) { mx /= mlen; my /= mlen; }
  p.moveSpeed = mlen;
  if (mlen > 0.01) p.moveAngle = Math.atan2(my, mx);
  const speed = p.speed * (p.feverTimer > 0 ? 1.15 : 1);
  p.vx = mx * speed;
  p.vy = my * speed;
  p.x += p.vx * sdt;
  p.y += p.vy * sdt;
  if (state.biomeId === 'alveolar') {
    const fixed = resolveWallCollision(p.x, p.y, p.radius);
    p.x = fixed.x; p.y = fixed.y;
  }
  p.x = Math.max(p.radius, Math.min(CONFIG.FIELD.W - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(CONFIG.FIELD.H - p.radius, p.y));

  // --- firing ---
  p.fireTimer -= sdt;
  if (input.firing && !p.overheated && p.fireTimer <= 0) {
    const aimAngle = Math.atan2(input.aim.y - p.y, input.aim.x - p.x);
    const n = p.multishot;
    for (let i = 0; i < n; i += 1) {
      const off = (i - (n - 1) / 2) * p.spread;
      const crit = state.rng() < p.critChance;
      // Febrile crisis: pyrogenic attack — +50% damage on every bolt.
      firePlayerBolt(state, aimAngle + off, p.damage * (crit ? 2 : 1) * mods.damage * (state.physiology === PHYS_FEBRILE ? 1 + (p.feverDamageBonus || 0) : 1), crit);
    }
    // Febrile crisis: +50% fire rate (the interval shrinks).
    p.fireTimer = p.fireInterval / mods.fireRate;
    p.heat = Math.min(CONFIG.PLAYER.heatOverheatAt, p.heat + CONFIG.PLAYER.heatPerShot);
    if (p.heat >= CONFIG.PLAYER.heatOverheatAt) p.overheated = true;
    events.push({ type: 'shoot', weapon: p.weaponId });
  }
  // Heat cools; overheat locks fire until the clear threshold.
  p.heat = Math.max(0, p.heat - CONFIG.PLAYER.heatCoolRate * sdt);
  if (p.overheated && p.heat <= CONFIG.PLAYER.heatClearAt) p.overheated = false;

  // --- wave flow (only once a run has started; the title diorama stays calm) ---
  if (state.wave >= 1) {
  if (state.phase === 'intro') {
    if (state.waveTimer >= 1.2) {
      state.phase = 'active';
      state.waveTimer = 0;
      if (state.wave % CONFIG.BOSS_EVERY === 0) {
        const boss = spawnEnemy(state, 'boss', 640, 120);
        if (boss && state.wave >= 15) { boss.omega = true; boss.polarityTimer = 5; boss.spires = 0; }
        state.spawned += 1;
      }
    }
  } else if (state.phase === 'active') {
    if (state.spawned < state.enemiesToSpawn) {
      state.spawnTimer -= sdt;
      if (state.spawnTimer <= 0) {
        state.spawnTimer = CONFIG.WAVE.interval(state.wave) / (state.spawnMul || 1) * 1;
        const kind = pickEnemyKind(state.rng, state.wave, state.omens.elite);
        const pos = spawnEdgePosition(state);
        spawnEnemy(state, kind, pos.x, pos.y);
        state.spawned += 1;
      }
    }
    // Toxic Spore omen: the Core loses 1 HP/s this wave.
    if (state.omens.drain) {
      state.core.hp -= 1 * sdt;
      if (state.core.hp <= 0) { state.core.hp = 0; state.screen = 'over'; events.push({ type: 'gameover' }); }
    }
    // Wave cleared: everything spawned and everything dead.
    let alive = 0;
    for (const e of state.enemies) if (e.active) alive += 1;
    if (state.spawned >= state.enemiesToSpawn && alive === 0) {
      state.phase = 'cleared';
      state.waveTimer = 0;
      state.stats.waves += 1;
      state.score += Math.round(100 * state.wave * mods.scoreGain);
      state.lastWaveStats = { wave: state.wave, kills: state.stats.kills, chain: state.maxChain, score: state.score };
      state.telemetry.push({ wave: state.wave, organ: Math.round(state.core.hp), chain: state.maxChain });
      events.push({ type: 'waveCleared', wave: state.wave });
    }
  } else if (state.phase === 'cleared') {
    if (state.waveTimer >= 1.4) {
      if (state.wave >= CONFIG.WIN_WAVE) {
        state.screen = 'win';
        state.phase = 'won';
        events.push({ type: 'victory' });
      } else {
        state.phase = 'upgrade';
        rollUpgradeChoices(state, state.rng);
        state.screen = 'upgrade';
        events.push({ type: 'upgrade' });
      }
    }
  }
  }

  // --- storm ring (Marrow Sanctuary) ---
  const storm = stormRingCentre(state.time, state.core.x, state.core.y);
  state.stormX = storm.x; state.stormY = storm.y;

  // --- enemies ---
  for (const e of state.enemies) {
    if (!e.active) continue;
    if (e.flash > 0) e.flash -= dt;
    if (e.spawnAnim > 0) e.spawnAnim -= dt;
    const dxp = p.x - e.x;
    const dyp = p.y - e.y;
    const dp = Math.hypot(dxp, dyp) || 1;
    const dxc = state.core.x - e.x;
    const dyc = state.core.y - e.y;
    const dc = Math.hypot(dxc, dyc) || 1;
    let sp = e.speed;
    // Febrile crisis: pathogens move 20% more aggressively.
    sp *= mods.enemySpeed;
    if (state.biomeId === 'marrow' && pointInStormRing(e.x, e.y, state.stormX, state.stormY)) sp *= STORM_RING.speedBoost;
    e.wobble += dt * 3;
    if (e.kind === 'bacillus') {
      // Chaser: hunts the cell, drifts toward the Core when closer to it.
      const target = dp < dc ? { x: dxp / dp, y: dyp / dp } : { x: dxc / dc, y: dyc / dc };
      const wob = Math.sin(e.wobble + e.seed) * 0.3;
      e.vx = (target.x - target.y * wob) * sp;
      e.vy = (target.y + target.x * wob) * sp;
      e.angle = Math.atan2(e.vy, e.vx);
    } else if (e.kind === 'phage') {
      // Shooter: keeps ~260 px, spits a toxin every 2.2 s.
      const want = 260;
      const dir = dp > want ? 1 : -1;
      e.vx = (dxp / dp) * sp * 0.6 * dir;
      e.vy = (dyp / dp) * sp * 0.6 * dir;
      e.shootTimer -= sdt;
      if (e.shootTimer <= 0 && dp < 520) {
        e.shootTimer = 2.2;
        fireEnemyOrb(state, e, Math.atan2(dyp, dxp), 240, e.damage);
      }
    } else if (e.kind === 'plastic') {
      // Core-marcher: slow, heavy, walks straight at the Organ Core.
      e.vx = (dxc / dc) * sp;
      e.vy = (dyc / dc) * sp;
    } else if (e.kind === 'leaper') {
      // Dash attacker: 0.6 s telegraph, then a 320 px/s lunge at the cell.
      if (e.dashState === 0) {
        e.vx = (dxp / dp) * sp * 0.5;
        e.vy = (dyp / dp) * sp * 0.5;
        e.dashTimer -= sdt;
        if (e.dashTimer <= 0 && dp < 320) { e.dashState = 1; e.dashTimer = 0.6; e.telegraph = 0.6; e.dashAngle = Math.atan2(dyp, dxp); }
      } else if (e.dashState === 1) {
        e.vx = 0; e.vy = 0;
        e.telegraph -= sdt;
        if (e.telegraph <= 0) { e.dashState = 2; e.dashTimer = 0.28; }
      } else {
        e.vx = Math.cos(e.dashAngle) * 320;
        e.vy = Math.sin(e.dashAngle) * 320;
        e.dashTimer -= sdt;
        if (e.dashTimer <= 0) { e.dashState = 0; e.dashTimer = 1.4 + state.rng() * 1.2; }
      }
    } else if (e.kind === 'warder') {
      // Shield-bearer: slow march at the Core; shields neighbours (applied below).
      e.vx = (dxc / dc) * sp * 0.7;
      e.vy = (dyc / dc) * sp * 0.7;
    } else if (e.kind === 'dormant') {
      // Dormant Dysplastic Cell: asleep at the tissue edge, perfectly still.
      e.vx = 0; e.vy = 0;
    } else if (e.kind === 'cancer') {
      // Malignant Tumor Cell: slow, relentless crawl toward the Organ Core.
      e.vx = (dxc / dc) * sp;
      e.vy = (dyc / dc) * sp;
      // Mitosis: divide every 6 s unless the Angiogenesis Inhibitor stopped it.
      e.mitosisTimer -= sdt;
      if (e.mitosisTimer <= 0) {
        e.mitosisTimer = MITOSIS_INTERVAL;
        if (!state.mitosisBlocked) divideCancerCell(state, e);
      }
      // Angiogenesis: a parasitic tether attaches and drains the Core 1 HP/s.
      if (!e.tether) {
        e.tetherTimer -= sdt;
        if (e.tetherTimer <= 0) {
          e.tether = true;
          if (triggerMetastasis(state)) events.push({ type: 'metastasis' });
        }
      }
    } else if (e.kind === 'boss') {
      // Miasma Prime: slow drift toward the Core + telegraphed attacks.
      e.vx = (dxc / dc) * 26;
      e.vy = (dyc / dc) * 26;
      const res = updateBossAttacks(e, sdt, state.time);
      if (res === 'telegraph') events.push({ type: 'bossTelegraph' });
      else if (res === 'burst') {
        for (const a of bossBurstAngles(state.time, bossBurstCount(e))) fireEnemyOrb(state, e, a, 200, 10);
        events.push({ type: 'bossBurst' });
      } else if (res === 'laserWarn') events.push({ type: 'laserWarn' });
      else if (res === 'laserStart') events.push({ type: 'laserStart' });
      // Phase 2 spiral: a rotating helix of toxins.
      if (bossPhase(e) === 2 && Math.floor(state.time * 2) !== Math.floor((state.time - sdt) * 2)) {
        for (const a of bossSpiralAngles(state.time, 5)) fireEnemyOrb(state, e, a, 170, 8);
      }
      // Sweeping laser hurts the cell it touches.
      if (laserHitsPoint(e, p.x, p.y)) damagePlayer(state, BOSS_LASER_DAMAGE * sdt * 4);
    }
    e.x += e.vx * sdt;
    e.y += e.vy * sdt;
    if (state.biomeId === 'alveolar' && e.kind !== 'boss') {
      const fixed = resolveWallCollision(e.x, e.y, e.radius);
      e.x = fixed.x; e.y = fixed.y;
    }
    e.x = Math.max(e.radius, Math.min(CONFIG.FIELD.W - e.radius, e.x));
    e.y = Math.max(e.radius, Math.min(CONFIG.FIELD.H - e.radius, e.y));
    // Angiogenesis drain: a tethered tumor drinks 1 Organ Integrity per second.
    if (e.kind === 'cancer' && e.tether) {
      state.core.hp -= TETHER_DRAIN_PER_SEC * sdt;
      if (state.core.hp <= 0) { state.core.hp = 0; state.screen = 'over'; events.push({ type: 'gameover' }); }
    }
    // Touch damage to the cell (dormant cells deal none).
    if (e.damage > 0 && dp < e.radius + p.radius * 0.65 && e.spawnAnim <= 0) damagePlayer(state, e.damage * sdt * 2.2);
    // Touch damage to the Core (dormant cells deal none; tumors persist, they do not dissolve).
    if (e.damage > 0 && dc < e.radius + state.core.radius * 0.9 && e.spawnAnim <= 0) {
      damageCore(state, e.damage * sdt * 0.8);
      // The pathogen dissolves into the Core after biting it (no farming the Core).
      if (e.kind !== 'boss' && e.kind !== KIND_CANCER && e.kind !== KIND_DORMANT) { e.hp = 0; killEnemy(state, e, false); }
    }
  }
  // The metastasis surge ends when the last tumor cell dies.
  if (state.metastasisSurge && countActiveCells(state, KIND_CANCER) === 0) {
    state.metastasisSurge = false;
    state.mitosisBlocked = false;
    events.push({ type: 'metastasisEnd' });
  }
  // Warder shield: neighbours within 90 px take half damage.
  for (const e of state.enemies) {
    if (!e.active) continue;
    e.shielded = false;
    if (e.kind === 'warder') continue;
    for (const w of state.enemies) {
      if (!w.active || w.kind !== 'warder') continue;
      if (Math.hypot(e.x - w.x, e.y - w.y) < 90) { e.shielded = true; break; }
    }
  }

  // --- player projectiles ---
  for (const b of state.projectiles) {
    if (!b.active) continue;
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;
    if (b.x < -20 || b.x > CONFIG.FIELD.W + 20 || b.y < -20 || b.y > CONFIG.FIELD.H + 20) { b.active = false; continue; }
    // Alveolar walls stop bolts.
    if (state.biomeId === 'alveolar' && pointHitsWall(b.x, b.y)) {
      spawnBurst(state.particles, state.rng, b.x, b.y, '#7fd4ff', 4, 90, 3);
      b.active = false; continue;
    }
    // Silica Prism: the bolt splits into branching beams (once per bolt).
    if (state.biomeId === 'alveolar' && !b.splitDone) {
      const pr = prismHitByPoint(b.x, b.y, b.radius);
      if (pr) {
        b.splitDone = true;
        const base = Math.atan2(b.vy, b.vx);
        for (let k = -1; k <= 1; k += 1) {
          if (k === 0) continue;
          const nb = freeProjectile(state);
          if (!nb) break;
          nb.active = true; nb.x = pr.x; nb.y = pr.y;
          nb.vx = Math.cos(base + k * 0.5) * p.bulletSpeed;
          nb.vy = Math.sin(base + k * 0.5) * p.bulletSpeed;
          nb.damage = Math.round(b.damage * 0.7); nb.pierce = 0; nb.crit = false;
          nb.polarity = b.polarity; nb.style = 'prism'; nb.splitDone = true; nb.radius = 4;
        }
        events.push({ type: 'prism' });
        spawnBurst(state.particles, state.rng, pr.x, pr.y, '#7fd4ff', 8, 140, 3);
      }
    }
    // Hit test against every pathogen.
    for (const e of state.enemies) {
      if (!e.active || b.pierce < 0) continue;
      const dx = e.x - b.x;
      const dy = e.y - b.y;
      const rr = e.radius + b.radius;
      if (dx * dx + dy * dy < rr * rr) {
        // A dormant cell hit by a WRONG-polarity (same-polarity) shot mutates.
        if (e.kind === KIND_DORMANT && b.polarity === e.polarity) {
          mutateDormantCell(state, e);
          events.push({ type: 'mutate' });
          b.active = false;
          break;
        }
        state.stats.hits += 1;
        // Cytolytic resonance: opposite polarity = 2.5x; a rolled crit = 2x.
        const resonance = calcResonanceCrit(b.polarity, e.polarity);
        const isCrit = b.crit || resonance > 1;
        const mult = resonance > 1 ? resonance : (b.crit ? CONFIG.PLAYER.critMultiplier : 1);
        damageEnemy(state, e, b.damage * mult, isCrit, true, resonance > 1);
        if (isCrit) events.push({ type: 'crit' });
        if (b.pierce > 0) { b.pierce -= 1; }
        else { b.active = false; break; }
      }
    }
  }

  // --- enemy projectiles ---
  for (const b of state.enemyProjectiles) {
    if (!b.active) continue;
    b.x += b.vx * sdt;
    b.y += b.vy * sdt;
    if (b.x < -20 || b.x > CONFIG.FIELD.W + 20 || b.y < -20 || b.y > CONFIG.FIELD.H + 20) { b.active = false; continue; }
    // Marrow core shield: enemy toxins die inside the shield circle.
    if (state.biomeId === 'marrow') {
      const d = Math.hypot(b.x - state.core.x, b.y - state.core.y);
      if (d < CORE_SHIELD_RADIUS) {
        spawnBurst(state.particles, state.rng, b.x, b.y, '#b537f2', 5, 100, 3);
        b.active = false; continue;
      }
    }
    if (state.biomeId === 'alveolar' && pointHitsWall(b.x, b.y)) { b.active = false; continue; }
    const dp = Math.hypot(p.x - b.x, p.y - b.y);
    // Phagocytosis: a SAME-polarity toxin is absorbed — 0 damage, +Core, +ATP.
    if (dp < p.radius + b.radius + 4) {
      if (b.polarity === p.polarity) {
        if (absorbMatchingOrb(state, b)) {
          b.active = false;
          events.push({ type: 'absorb' });
          spawnBurst(state.particles, state.rng, p.x, p.y, p.polarity === 'bio' ? '#ffd166' : '#c77dff', 8, 120, 3);
        }
        continue;
      }
      damagePlayer(state, b.damage);
      b.active = false;
      continue;
    }
    // Graze: a toxin that passes within 46 px without hitting fills ATP.
    // In febrile crisis the Graze Overdrive charges 2x faster.
    if (!b.grazed && dp < 46) {
      const res = checkGraze(state, b);
      if (res === 'graze') {
        if (mods.grazeCharge > 1) addATP(state, CONFIG.PLAYER.atpGrazeGain * (mods.grazeCharge - 1));
        events.push({ type: 'graze', combo: p.grazeCombo });
      }
    }
    // Toxin hitting the Core.
    const dc = Math.hypot(state.core.x - b.x, state.core.y - b.y);
    if (dc < state.core.radius + b.radius) {
      damageCore(state, b.damage * 0.5);
      b.active = false;
    }
  }

  // --- nutrient shards ---
  for (const s of state.shards) {
    if (!s.active) continue;
    s.x += s.vx * sdt;
    s.y += s.vy * sdt;
    s.vx *= 0.94; s.vy *= 0.94;
    const dp = Math.hypot(p.x - s.x, p.y - s.y);
    if (dp < 150) {
      s.magnet = true;
      const a = Math.atan2(p.y - s.y, p.x - s.x);
      s.vx += Math.cos(a) * 900 * sdt;
      s.vy += Math.sin(a) * 900 * sdt;
      if (state.rng() < 0.3) spawnTrailSpark(state.particles, s.x, s.y, '#ffd166');
    }
    if (dp < p.radius + 10) {
      s.active = false;
      if (s.kind === 'stem') {
        // Vital Stem-Orb: restores 6 Organ Integrity.
        state.core.hp = Math.min(state.core.maxHp, state.core.hp + 6);
        spawnBurst(state.particles, state.rng, p.x, p.y, '#2fd4a0', 8, 120, 3);
        events.push({ type: 'stem' });
      } else if (s.kind && s.kind.startsWith('drug-')) {
        // Targeted Therapeutic capsule: apply the drug.
        const drug = s.kind.slice(5);
        const res = applyTherapeuticDrug(state, drug);
        spawnBurst(state.particles, state.rng, p.x, p.y, '#ffd166', 14, 160, 4);
        events.push({ type: 'drug', drug, affected: res.affected });
      } else {
        state.nutrientPoints += s.value;
        events.push({ type: 'pickup' });
      }
    }
  }

  // --- febrile heat: embers rise through the vessel while the body burns ---
  if (state.physiology === PHYS_FEBRILE) {
    state.heatTimer -= sdt;
    if (state.heatTimer <= 0) {
      state.heatTimer = 0.08;
      spawnHeatRise(state.particles, state.rng);
    }
  }

  // --- fibrin threads (4 s burn) ---
  for (const t of state.threads) {
    if (!t.active) continue;
    t.life -= sdt;
    if (t.life <= 0) { t.active = false; continue; }
    // The thread burns any pathogen it touches.
    for (const e of state.enemies) {
      if (!e.active) continue;
      const ax = t.ax; const ay = t.ay; const bx = t.bx; const by = t.by;
      const abx = bx - ax; const aby = by - ay;
      const len2 = abx * abx + aby * aby || 1;
      const tt = Math.max(0, Math.min(1, ((e.x - ax) * abx + (e.y - ay) * aby) / len2));
      const cx = ax + abx * tt;
      const cy = ay + aby * tt;
      if (Math.hypot(e.x - cx, e.y - cy) < e.radius + 8) damageEnemy(state, e, 30 * sdt, false, false);
    }
  }
  // Platelet node pulse.
  for (const n of state.nodes) n.pulse += sdt;

  updateParticles(state.particles, sdt);
  updateDamageNumbers(state.damageNumbers, sdt);
  return events;
}

/** Apply a draft pick (by id) and check for a gene awakening. Returns true if bought. */
export function buyUpgrade(state, id) {
  const ok = applyUpgradeToState(state, id);
  if (!ok) return false;
  const evo = checkGeneAwakenings(state);
  if (evo) state.events.push({ type: 'evolution', name: evo.name });
  return true;
}

/** Next wave after an upgrade pick (or a skip): clear omens, start the wave. */
export function advanceWave(state, pickedId) {
  state.omens = { swift: false, swarm: false, elite: false, drain: false };
  if (pickedId) {
    const card = state.choices.find((c) => c.id === pickedId);
    if (card && card.omen) {
      if (card.omen.id === 'omenSwift') state.omens.swift = true;
      else if (card.omen.id === 'omenSwarm') state.omens.swarm = true;
      else if (card.omen.id === 'omenElite') state.omens.elite = true;
      else if (card.omen.id === 'omenDrain') state.omens.drain = true;
    }
  }
  state.choices = [];
  state.screen = 'play';
  startWave(state, state.wave + 1);
}
