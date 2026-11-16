// CYTOGUARD shot staging + autopilot: deterministic scenes for the four
// screenshots (shots.json) and for scripted play-tests. stageShot(name, world)
// puts the world into the named scene and returns what the scene measured
// (screen, live enemies, chain, wave) for window.__shotInfo. The autopilot
// plays like a careful cell — orbit the Core, flee close foes, aim at the
// most dangerous pathogen, mind the heat — so the combat shot shows a real
// fight, not a posed still. Everything here is deterministic: same seed,
// same scene.

import { CONFIG } from './core/config.js';
import { createRandom } from './core/random.js';
import { resetRunState, startWave, spawnEnemy, update } from './core/state.js';
import { applyWeaponToPlayer } from './entities/weapons.js';
import { linkPlateletThread } from './systems/constellation.js';
import { updatePhysiologyState } from './systems/physiology.js';
import { spawnDormantCells, triggerMetastasis } from './systems/oncology.js';
import { rollUpgradeChoices, upgradeDef, OMEN_DEFS } from './systems/draft.js';
import { spawnDamageNumber } from './render/effects.js';

function countAlive(world) {
  let n = 0;
  for (const e of world.enemies) if (e.active) n += 1;
  return n;
}

/** The autopilot's input for one step: orbit, flee, aim, fire, mind the heat. */
export function autopilotInput(world) {
  const p = world.player;
  const core = world.core;
  let nearest = null;
  let nearestD = Infinity;
  for (const e of world.enemies) {
    if (!e.active) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < nearestD) { nearestD = d; nearest = e; }
  }
  const aim = nearest ? { x: nearest.x, y: nearest.y } : { x: core.x, y: core.y };
  // Orbit the Core at ~220 px, tangential; flee when a foe gets too close.
  const dx = p.x - core.x;
  const dy = p.y - core.y;
  const dist = Math.hypot(dx, dy) || 1;
  let mx = (-dy / dist) * 0.8 + (dx / dist) * ((220 - dist) / 220) * 0.6;
  let my = (dx / dist) * 0.8 + (dy / dist) * ((220 - dist) / 220) * 0.6;
  if (nearest && nearestD < 90) {
    mx += ((p.x - nearest.x) / nearestD) * 1.2;
    my += ((p.y - nearest.y) / nearestD) * 1.2;
  }
  const len = Math.hypot(mx, my) || 1;
  return {
    move: { x: mx / len, y: my / len },
    aim,
    firing: !p.overheated && p.heat < 85,
    actions: 0,
  };
}

/** Stage one screenshot scene. Returns {screen, enemies, combo, wave, best, selectedWeapon, aim}. */
export function stageShot(name, world) {
  const rng = createRandom(7);
  if (name === 'start') {
    resetRunState(world);
    world.selectedWeapon = 'lance';
    world.screen = 'title';
    return { screen: 'title', enemies: 0, combo: 0, wave: 0, best: 0, selectedWeapon: 'lance', aim: { x: 640, y: 300 } };
  }
  if (name === 'combat') {
    resetRunState(world);
    applyWeaponToPlayer(world.player, 'prism');
    world.selectedWeapon = 'prism';
    startWave(world, 7); // Wave 7/15 Alveolar Lungs, Phase II Proliferation.
    world.branch = 'lungs'; world.biomeName = 'Alveolar Lungs'; world.infectionPhase = 'PROLIFERATION';
    world.screen = 'play';
    world.player.x = 640;
    world.player.y = 400;
    world.player.heat = 82; // Gold zone: the PERFECT VENT label shows.
    world.player.overdrive = 100; // E READY.
    // Homeostasis: Organ Integrity 78% — Deep Midnight Indigo, no Febrile tag.
    world.core.hp = 78;
    world.nutrientPoints = 120;
    world.score = 2450;
    world.chain = 36;
    world.maxChain = 36;
    // A dense, mixed pathogen field: 38 live foes around the Core.
    const kinds = ['bacillus', 'bacillus', 'phage', 'plastic', 'leaper', 'warder'];
    for (let i = 0; i < 38; i += 1) {
      const kind = kinds[i % kinds.length];
      const a = rng() * Math.PI * 2;
      const r = 90 + rng() * 280;
      const x = Math.max(40, Math.min(1240, 640 + Math.cos(a) * r));
      const y = Math.max(90, Math.min(660, 360 + Math.sin(a) * r * 0.8));
      const e = spawnEnemy(world, kind, x, y);
      if (e) {
        e.polarity = i % 2 === 0 ? 'bio' : 'toxin';
        e.spawnAnim = 0;
      }
    }
    world.spawned = world.enemiesToSpawn;
    // A live Fibrin Triangle: three linked platelet nodes, threads glowing.
    // (Linked only — no burst yet, so the dense field survives for the shot.)
    linkPlateletThread(world, [0, 1, 2], world.time);
    // Play 150 real steps with the autopilot: bolts, lysis, numbers, chain.
    for (let i = 0; i < 150; i += 1) {
      const events = update(world, autopilotInput(world), CONFIG.STEP);
      events.length = 0;
      if (world.screen !== 'play') break;
    }
    // Prism refraction, staged deterministically: clear the vertical
    // corridor to the top Silica Prism (640,178), aim the hero straight up
    // it, and fire until the bolt splits into 3 beams (1 gold + 2 cyan
    // prism beams). The corridor is wall-free (walls sit at x 300/924).
    // The aim point sits BELOW the prism (y 230, not 178) so the
    // "R — PERFECT VENT" label clears the metastasis alert pill.
    for (const e of world.enemies) {
      if (e.active && Math.abs(e.x - 640) < 70 && e.y > 150 && e.y < 440) e.active = false;
    }
    world.player.x = 300; // Bottom-left hero anchor (Rule of 3 focal points).
    world.player.y = 540;
    world.score = 31400; // HUD block 3: 31.400 • CHAIN x36.
    world.player.heat = 40;
    world.player.overheated = false;
    world.player.fireTimer = 0;
    world.player.invuln = 2; // staging shield: the hero stands still to aim.
    for (let i = 0; i < 58; i += 1) {
      const events = update(world, { move: { x: 0, y: 0 }, aim: { x: 640, y: 178 }, firing: true, actions: 0 }, CONFIG.STEP);
      events.length = 0;
      if (world.screen !== 'play') break;
    }
    // Restage the hero numbers AFTER the loop (the loop spends them):
    // Febrile Crisis (Core 44%), CHAIN x32, gold-zone heat, full ATP.
    world.core.hp = 78;
    updatePhysiologyState(world);
    world.chain = 36;
    world.maxChain = 36;
    world.chainTimer = 2.5;
    world.player.hp = world.player.maxHp; // CELL HP 100/100 for the shot.
    world.player.heat = 82; // Gold zone: the PERFECT VENT label shows.
    world.player.overdrive = 100; // E READY.
    // Top the field back up to a dense 38+ live foes.
    let alive = countAlive(world);
    while (alive < 38) {
      const kind = kinds[alive % kinds.length];
      const a = rng() * Math.PI * 2;
      const r = 90 + rng() * 280;
      const x = Math.max(40, Math.min(1240, 640 + Math.cos(a) * r));
      const y = Math.max(90, Math.min(660, 360 + Math.sin(a) * r * 0.8));
      const e = spawnEnemy(world, kind, x, y);
      if (e) { e.polarity = alive % 2 === 0 ? 'bio' : 'toxin'; e.spawnAnim = 0; }
      alive += 1;
    }
    // Oncology climax, staged readable: 2 dormant cells at the edges, 2
    // malignant tumors with parasitic tethers to the Core, metastasis surge
    // active with all three Targeted Therapeutics capsules dropped. One
    // tumor sits right next to the brightly glowing mAb IMMUNOTHERAPY
    // capsule, so the cure and the cancer read in a single glance.
    spawnDormantCells(world, 2);
    triggerMetastasis(world);
    const mab = world.shards.find((s) => s.active && s.kind === 'drug-mab');
    if (mab) {
      const tumor = spawnEnemy(world, 'cancer', Math.min(1200, mab.x + 95), Math.min(660, mab.y + 60));
      if (tumor) {
        tumor.polarity = 'bio'; // same as the cell: ordinary bolts bounce off (IMMUNE)
        tumor.spawnAnim = 0;
        tumor.tether = true;
        tumor.tetherTimer = 0;
      }
    }
    const tumor2 = spawnEnemy(world, 'cancer', 850, 430);
    if (tumor2) {
      tumor2.polarity = 'bio';
      tumor2.spawnAnim = 0;
      tumor2.tether = true;
      tumor2.tetherTimer = 0;
    }
    // V3 bento restage (08:47/08:49): the Right Sidebar's INCOMING box
    // counts live enemies by kind, so the field is restaged to EXACTLY
    // 11 Bacillus + 4 Phage + 2 Tumor + 1 Boss (= 18 LEFT), all inside
    // the 925 px arena (x <= 900) — nothing spawns under the sidebar.
    for (const e of world.enemies) e.active = false;
    const arenaKinds = [];
    for (let i = 0; i < 11; i += 1) arenaKinds.push('bacillus');
    for (let i = 0; i < 4; i += 1) arenaKinds.push('phage');
    for (const kind of arenaKinds) {
      const a = rng() * Math.PI * 2;
      const r = 90 + rng() * 280;
      const x = Math.max(60, Math.min(900, 480 + Math.cos(a) * r));
      const y = Math.max(100, Math.min(640, 360 + Math.sin(a) * r * 0.8));
      const e = spawnEnemy(world, kind, x, y);
      if (e) { e.polarity = rng() < 0.5 ? 'bio' : 'toxin'; e.spawnAnim = 0; }
    }
    // The 2 malignant tumors: tethered to the Core, inside the arena.
    for (const [tx, ty] of [[700, 430], [850, 430]]) {
      const t = spawnEnemy(world, 'cancer', tx, ty);
      if (t) { t.polarity = 'bio'; t.spawnAnim = 0; t.tether = true; t.tetherTimer = 0; }
    }
    // Sidebar Box 4: all 3 evolutions lit + 2 drones = 4 active badges.
    world.evolutions = ['perforinTriBeam', 'immuneSurge', 'primeLanceMastery'];
    // APEX staging: 2 Symbiotic Guardian Drones by the hero, the Bio-Contract
    // line, and the Vascular Valve Gate open mid-sweep (center focus).
    world.player.x = 300; world.player.y = 540;
    world.score = 31400; // Restaged: HUD reads exactly 31.400 • CHAIN x36.
    world.symbiosis.drones = [
      { x: 220, y: 470, angle: 0, fireTimer: 0.4, kind: 'bacillus', hp: 60 },
      { x: 390, y: 490, angle: 0, fireTimer: 0.4, kind: 'phage', hp: 60 },
    ];
    world.symbiosis.hijacked = 2;
    world.contracts.active = { id: 'hijack2', stage: 'lungs', text: 'CONTRACT: HIJACK 2 (+150 GP)', target: 'hijack', count: 2, progress: 2, timer: 60 };
    world.fluidics.open = true; world.fluidics.timer = 4;
    // A big gold floating damage number, fresh for the capture.
    spawnDamageNumber(world.damageNumbers, 760, 230, '+450 CRIT x36', '#ffd166', true);
    // Omega Chimera focal point, left-of-centre of the ARENA (FINAL PIXEL
    // TOUCH 10:06: moved from 850,150 to 615,165 so its white-magenta bloom
    // and rings stay clear of the sidebar divider and its HP bar.
    // TOUCH 10:29 (user order): down +35 px to 510,195 — clear dark gap
    // under the top header, glow no longer brushes the WAVE 7/15 line).
    const omega = spawnEnemy(world, 'boss', 510, 195);
    if (omega) { omega.omega = true; omega.polarity = 'bio'; omega.polarityTimer = 5; omega.spawnAnim = 0; world.boss = omega; }
    return { screen: 'play', enemies: countAlive(world), combo: world.chain, wave: 7, best: 0, selectedWeapon: 'prism', aim: world.aim };
  }
  if (name === 'upgrade') {
    resetRunState(world);
    world.wave = 6;
    world.score = 1890;
    world.nutrientPoints = 96;
    world.maxChain = 14;
    world.chain = 14;
    rollUpgradeChoices(world, world.rng);
    // Locked APEX draft: CRISPR PRISM CORE (RARE) / SYMBIOTIC HIJACKING
    // (SOLAR MYTHIC, synergy unlocked) / VASCULAR VALVE SURGE (COMMON).
    const mkCard = (id, omen) => {
      const def = upgradeDef(id);
      if (!def) return null;
      const shortInscription = { crisprPrismCore: 'Cut the genome, keep the cell.', symbioticReprogramming: 'Opsonized pathogens defend the host.', vascularValveSurge: 'The vessel turns; the current obeys.' }[id];
      return { id: def.id, name: def.name, desc: def.desc, cost: def.base, level: 0,
        rarity: def.rarity, icon: def.icon, synergy: def.synergy,
        synergyId: def.synergyId, inscription: shortInscription || def.inscription, omen };
    };
    world.choices[0] = mkCard('crisprPrismCore', { id: 'omenFission', name: 'BINARY FISSION +25%', desc: 'Next wave: bacteria divide 25% faster', icon: '✺' });
    world.choices[1] = mkCard('symbioticReprogramming', OMEN_DEFS[Math.floor(world.rng() * OMEN_DEFS.length)]);
    world.choices[2] = mkCard('vascularValveSurge', { id: 'omenEndospore', name: 'TOXIC ENDOSPORES', desc: 'Next wave: slain pathogens release endospores', icon: '☾' });
    world.upgradesOwned.nk = 1; // SYMBIOTIC HIJACKING synergy pair owned.
    // A living arena behind the draft: 14 pathogens drifting in the glow.
    const bgKinds = ['bacillus', 'phage', 'plastic', 'leaper'];
    for (let i = 0; i < 14; i += 1) {
      const a = rng() * Math.PI * 2;
      const r = 120 + rng() * 260;
      const x = Math.max(40, Math.min(1240, 640 + Math.cos(a) * r));
      const y = Math.max(90, Math.min(660, 360 + Math.sin(a) * r * 0.8));
      const e = spawnEnemy(world, bgKinds[i % bgKinds.length], x, y);
      if (e) { e.polarity = i % 2 === 0 ? 'bio' : 'toxin'; e.spawnAnim = 0; }
    }
    world.screen = 'upgrade';
    return { screen: 'upgrade', enemies: countAlive(world), combo: 14, wave: 6, best: 0, selectedWeapon: 'lance', aim: { x: 640, y: 300 } };
  }
  if (name === 'victory') {
    resetRunState(world);
    world.wave = 15;
    world.score = 48200;
    world.maxChain = 36;
    world.chain = 36;
    world.stats.kills = 412;
    world.stats.tumors = 6;
    world.stats.damage = 18200;
    world.stats.waves = 15;
    world.core.hp = 78; // ORGAN 78% in the stat boxes.
    world.lineageGp = 770;
    world.symbiosis.hijacked = 9;
    world.contracts.completed = 4; world.contracts.active = null;
    world.telemetry = [100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 81, 80, 79, 78, 78].map((organ, i) => ({ wave: i + 1, organ, chain: 4 + i * 2 }));
    // Two Awakened Cell Evolutions mastered, for the mutation recap.
    world.evolutions = ['perforinTriBeam', 'immuneSurge'];
    world.screen = 'win';
    return { screen: 'win', enemies: 0, combo: 36, wave: 15, best: 40200, selectedWeapon: 'prism', aim: { x: 640, y: 300 } };
  }
  if (name === 'loss') {
    // ORGAN COLLAPSE: the Core fell on wave 8 — for the RETRY VIGIL test.
    resetRunState(world);
    world.wave = 8;
    world.score = 7420;
    world.maxChain = 19;
    world.chain = 19;
    world.stats.kills = 148;
    world.stats.tumors = 3;
    world.stats.damage = 12100;
    world.core.hp = 0;
    world.screen = 'over';
    return { screen: 'over', enemies: 0, combo: 19, wave: 8, best: 0, selectedWeapon: 'prism', aim: { x: 640, y: 300 } };
  }
  resetRunState(world);
  world.screen = 'title';
  return { screen: 'title', enemies: 0, combo: 0, wave: 0, best: 0, selectedWeapon: 'lance', aim: { x: 640, y: 300 } };
}
