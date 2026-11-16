export const CYTOGUARD_DESIGN_NOTE = "CYTOGUARD: The Vital Surge — Original Microscopic Cellular Immune Bullet-Dance & Fibrin Trap Action | 3 Immune Classes (T-Cell, Plasma, Macrophage) | Q Antigen Polarity Phagocytosis (2.5x Cytolytic Crit) | Space Platelet Fibrin Triangle Burst | R Metabolic Venting | E Fever Overdrive | F Marrow Risk Offering | Dynamic Homeostasis vs Febrile Crisis Physiology | Oncogenic Rogue Cells & Targeted Therapeutic Drops | 3 Organ Biomes | Multi-Part Boss Miasma Prime | Procedural Bio-WebAudio | 100% Deterministic";
export const GAME_OVERVIEW = "Leukocyte Prime guards the Organ Core through 10 waves of infection until immunity is restored. | 3 Immune Classes, Dual Antigen Polarity Phagocytosis (Q), Platelet Fibrin Triangle Burst (Space), Metabolic Venting (R), Graze Fever Overdrive (E), Marrow Offering (F), Multi-Part Boss Miasma Prime. | Confocal/SEM procedural visuals, procedural Bio-WebAudio, 100% deterministic, zero network.";
export const CYTOGUARD_FEATURES = "3 Immune Classes | Dual Antigen Polarity Phagocytosis (Q) | Platelet Fibrin Triangle Burst (Space) | Metabolic Venting (R) | Graze Fever Overdrive (E) | Marrow Offering (F) | Dynamic Homeostasis vs Febrile Crisis Physiology | Oncogenic Rogue Cells & Targeted Therapeutic Drops | 3 Organ Biomes | Multi-Part Boss Miasma Prime | Procedural Bio-WebAudio";
// CYTOGUARD boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps (several in a slow frame, none in a fast
// one), and the renderer paints what is there. The game moves between six
// screens: title (live bloodstream diorama + 3 immune classes + DEPLOY CELL),
// play, paused, upgrade cards, game over and victory. Space dashes in play
// and confirms on menus; R restarts instantly from game-over / victory.
//
// ?seed=N fixes the spawn pattern. ?shot=start|combat|upgrade|victory (with
// &seed=N) stages that scene instead of running the loop, paints it twice and
// sets window.__shotReady for a screenshot.
//
// Architecture (16 modules, imported in this order): polarity (dual antigen
// polarity), constellation (platelet fibrin traps), overdrive (ATP + heat),
// physiology (dynamic homeostasis vs febrile crisis), oncology (rogue cancer
// cells + targeted therapeutic drops), synergies (awakened evolutions), boss
// (Miasma Prime), weapons (3 immune classes), biomes (3 organ zones),
// upgrades (gene splice draft), audio (procedural Bio-WebAudio), lore (The
// Last Vigil of Solis / Vitalis), particles (cell lysis FX), hud
// (crystal-readable HUD), renderer (confocal/SEM procedural visuals), world
// (the whole simulation).

import { POLARITY_BIO, POLARITY_TOXIN } from './polarity.js';
import { THREAD_LIFETIME } from './constellation.js';
import { isFevered } from './overdrive.js';
import { getPhysiologyModifiers } from './physiology.js';
import { DRUG_DEFS } from './oncology.js';
import { EVOLUTIONS } from './synergies.js';
import { bossMaxHp } from './boss.js';
import { WEAPON_DEFS, applyWeaponToPlayer } from './weapons.js';
import { biomeForWave, BIOMES } from './biomes.js';
import { upgradeDef } from './upgrades.js';
import { createAudio } from './audio.js';
import { getBiomeChronicle, VICTORY_NARRATIVE } from './lore.js';
import { spawnBurst } from './particles.js';
import { SFX_BUTTON } from './hud.js';
import { createRenderer, TITLE_DEPLOY, TITLE_CLASS_RECTS, UPGRADE_CARD_RECTS, UPGRADE_SKIP, OVER_RETRY, OVER_CHANGE, WIN_AGAIN, WIN_CHANGE, SCREEN_TITLE, SCREEN_PLAY, SCREEN_UPGRADE, SCREEN_OVER, SCREEN_WIN, SCREEN_PAUSE } from './renderer.js';
import { createWorld, resetRunState, startWave, update, buyUpgrade, advanceWave } from './world.js';
import { CONFIG } from './config.js';
import { createInput, ACTION_AWAKEN, ACTION_CONFIRM, ACTION_DASH, ACTION_OFFERING, ACTION_PAUSE, ACTION_PICK_1, ACTION_PICK_2, ACTION_PICK_3, ACTION_POLARITY, ACTION_SKIP, ACTION_VENT } from './input.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on (50 ms): a longer stall is dropped, never replayed, so pathogens never teleport on frame drops. */
const MAX_FRAME = 0.05;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
world.selectedWeapon = 'lance';
// Small handle for scripted play-tests (and nothing else): lets a test drive
// the world to game over and back without touching the game's own code.
window.__cytoguard = world;
const renderer = createRenderer(canvas);
const audio = createAudio();
window.__cytoguardAudio = audio;

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(CONFIG.BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(CONFIG.BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function inside(rect, point) {
  return point && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function runShot(name) {
  const scene = stageShot(name, world);
  world.selectedWeapon = scene.selectedWeapon;
  // Verification handle: what the staged scene actually measured.
  window.__shotInfo = { name, screen: scene.screen, enemies: scene.enemies, combo: scene.combo, wave: scene.wave };
  let painted = 0;
  function paint() {
    renderer.draw(world, scene.screen, scene.best, { muted: false });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let selectedWeapon = WEAPON_DEFS[0].id;
  let pendingDash = false;
  let pendingPolarity = false;
  let pendingVent = false;
  let pendingAwaken = false;
  let pendingOffering = false;
  // Test handles: the current screen and weapon, for scripted play-tests.
  window.__cytoguardScreen = () => screen;
  window.__cytoguardWeapon = () => selectedWeapon;

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
  });
  canvas.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    audio.unlock();
    audio.resetAudioNodes();
    audio.setPhysiology('homeostasis');
    audio.startMusic();
    audio.click();
    resetRunState(world);
    applyWeaponToPlayer(world.player, selectedWeapon);
    world.selectedWeapon = selectedWeapon;
    world.screen = 'play';
    startWave(world, 1);
    accumulator = 0;
    pendingDash = false;
    pendingPolarity = false;
    pendingVent = false;
    pendingAwaken = false;
    pendingOffering = false;
    screen = SCREEN_PLAY;
    announce('Playing. Protect the Organ Core for 10 waves.');
  }

  function endGame(won) {
    if (screen === SCREEN_OVER || screen === SCREEN_WIN) return;
    if (world.score > best) {
      best = world.score;
      saveBest(best);
    }
    if (won) {
      screen = SCREEN_WIN;
      audio.playImmunityVictory();
      announce(`Victory. ${VICTORY_NARRATIVE} Score ${world.score}. Best ${best}.`);
    } else {
      screen = SCREEN_OVER;
      audio.playDefeat();
      announce(`Game over. Score ${world.score}. Best ${best}.`);
    }
  }

  /** Back to the title / immune-class screen (CHANGE CELL button). */
  function goToTitle() {
    audio.click();
    resetRunState(world);
    world.selectedWeapon = selectedWeapon;
    screen = SCREEN_TITLE;
    announce('Choose your immune class, Cell.');
  }

  function chooseUpgrade(index) {
    const choice = world.choices[index];
    if (!choice) return;
    const def = upgradeDef(choice.id);
    const ok = buyUpgrade(world, choice.id);
    if (ok) {
      audio.playGeneDraft();
      advanceWave(world, choice.id);
      screen = SCREEN_PLAY;
      announce(`${choice.name}${def ? ` (${def.rarity})` : ''}. Wave ${world.wave} incoming.`);
    } else {
      announce('Not enough nutrients for that Gene Splice.');
    }
  }

  function selectWeaponCard(index) {
    const w = WEAPON_DEFS[index];
    if (!w) return;
    selectedWeapon = w.id;
    world.selectedWeapon = w.id;
    audio.click();
    announce(`${w.name} selected.`);
  }

  function handleActions() {
    const actions = input.takeActions();
    const click = input.takeClick();
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_PICK_1) selectWeaponCard(0);
      else if (actions & ACTION_PICK_2) selectWeaponCard(1);
      else if (actions & ACTION_PICK_3) selectWeaponCard(2);
      else if (actions & ACTION_CONFIRM) startGame();
      else if (click) {
        for (let i = 0; i < 3; i += 1) {
          if (inside(TITLE_CLASS_RECTS[i], click)) { selectWeaponCard(i); break; }
        }
        if (inside(TITLE_DEPLOY, click)) startGame();
        else if (screen === SCREEN_TITLE && !inside(TITLE_DEPLOY, click)) {
          // A click anywhere else on the title also starts (v1 behaviour kept).
          let onCard = false;
          for (let i = 0; i < 3; i += 1) if (inside(TITLE_CLASS_RECTS[i], click)) onCard = true;
          if (!onCard) startGame();
        }
      }
      return;
    }
    if (screen === SCREEN_UPGRADE) {
      if (actions & ACTION_PICK_1) chooseUpgrade(0);
      else if (actions & ACTION_PICK_2) chooseUpgrade(1);
      else if (actions & ACTION_PICK_3) chooseUpgrade(2);
      else if (actions & ACTION_SKIP) { advanceWave(world, null); screen = SCREEN_PLAY; }
      else if (click) {
        for (let i = 0; i < 3; i += 1) {
          if (inside(UPGRADE_CARD_RECTS[i], click)) { chooseUpgrade(i); break; }
        }
        if (screen === SCREEN_UPGRADE && inside(UPGRADE_SKIP, click)) {
          advanceWave(world, null);
          screen = SCREEN_PLAY;
        }
      }
      return;
    }
    if (screen === SCREEN_PLAY) {
      if (actions & ACTION_DASH) pendingDash = true;
      if (actions & ACTION_POLARITY) pendingPolarity = true;
      if (actions & ACTION_VENT) pendingVent = true;
      if (actions & ACTION_AWAKEN) pendingAwaken = true;
      if (actions & ACTION_OFFERING) pendingOffering = true;
      if (click && inside(SFX_BUTTON, click)) {
        const muted = audio.toggleMute();
        announce(muted ? 'Sound off.' : 'Sound on.');
      }
      if (actions & ACTION_PAUSE) { screen = SCREEN_PAUSE; announce('Paused.'); }
      return;
    }
    if (screen === SCREEN_PAUSE) {
      if (actions & ACTION_PAUSE || actions & ACTION_CONFIRM || click) { screen = SCREEN_PLAY; announce('Playing.'); }
      return;
    }
    if (screen === SCREEN_OVER || screen === SCREEN_WIN) {
      if (actions & ACTION_CONFIRM) startGame();
      else if (click) {
        if (screen === SCREEN_WIN && inside(WIN_CHANGE, click)) goToTitle();
        else if (screen === SCREEN_WIN && inside(WIN_AGAIN, click)) startGame();
        else if (screen === SCREEN_OVER && inside(OVER_RETRY, click)) startGame();
        else if (screen === SCREEN_OVER && inside(OVER_CHANGE, click)) goToTitle();
        else if (screen === SCREEN_OVER) startGame();
      }
    }
  }

  function handleEvents(events) {
    for (const ev of events) {
      if (ev.type === 'shoot') {
        if (world.player.weaponId === 'chakram') audio.playAntibodyBounce();
        else audio.playPerforinLance();
      } else if (ev.type === 'lysis') audio.playCellLysis();
      else if (ev.type === 'prism') audio.playPrismRefract();
      else if (ev.type === 'dash') audio.playDashParry();
      else if (ev.type === 'pickup') audio.playShardPickup();
      else if (ev.type === 'hurt') audio.playCellHurt();
      else if (ev.type === 'coreHurt') audio.playCoreHurt();
      else if (ev.type === 'bossWarn') {
        audio.playBossWarning();
        announce(`Miasma Prime has come for the Organ Core — ${bossMaxHp(world.wave, CONFIG.BOSS_EVERY)} integrity, two toxin tentacles.`);
      } else if (ev.type === 'waveCleared') {
        audio.playWaveChime();
        const next = BIOMES[biomeForWave(Math.min(world.wave + 1, CONFIG.WIN_WAVE))];
        const chronicle = getBiomeChronicle(world.biomeId);
        announce(`Wave ${world.wave} cleared. ${chronicle.line} Next: ${next ? next.name : ''}. Choose a Gene Splice.`);
      } else if (ev.type === 'graze') audio.playGrazeChime(world.player.grazeCombo);
      else if (ev.type === 'absorb') audio.playAbsorbChime();
      else if (ev.type === 'polarity') announce(ev.polarity === POLARITY_BIO ? 'Bio-Gold polarity.' : ev.polarity === POLARITY_TOXIN ? 'Toxin-Violet polarity.' : 'Polarity shifted.');
      else if (ev.type === 'triangle') announce(`Fibrin thread linked — burns ${THREAD_LIFETIME} s.`);
      else if (ev.type === 'vent' || ev.type === 'triangleBurst') audio.playNovaBlast();
      else if (ev.type === 'offering') audio.playCleansingWave();
      else if (ev.type === 'fever') { if (isFevered(world)) announce('Hyper-Immune Fever!'); }
      else if (ev.type === 'febrile') {
        audio.setPhysiology('febrile');
        const mods = getPhysiologyModifiers(world);
        announce(`FEBRILE SURGE — +${Math.round((mods.damage - 1) * 100)}% attack, Graze charges ${mods.grazeCharge}x, enemies +${Math.round((mods.enemySpeed - 1) * 100)}% faster. Stem-Orbs restore the Core.`);
      } else if (ev.type === 'homeostasis') {
        audio.setPhysiology('homeostasis');
        announce('Homeostasis restored — dash regen +35%, triangle range +25%, score +25%.');
      } else if (ev.type === 'stem') { audio.playAbsorbChime(); announce('Vital Stem-Orb absorbed — Organ Integrity +6.'); }
      else if (ev.type === 'mutate') { audio.playCellHurt(); announce('A dormant cell mutated — wrong polarity! Malignant Tumor Cell active.'); }
      else if (ev.type === 'metastasis') { audio.playBossWarning(); announce('ALERT: METASTASIS SURGE — parasitic tethers drain the Organ Core. Targeted Therapeutics dropped.'); }
      else if (ev.type === 'metastasisEnd') announce('Metastasis cleared — the last tumor cell is gone.');
      else if (ev.type === 'drug') {
        audio.playGeneDraft();
        const def = DRUG_DEFS.find((d) => d.id === ev.drug);
        announce(def ? `${def.name} deployed — ${def.desc}` : 'Targeted Therapeutic deployed.');
      }
      else if (ev.type === 'chain') audio.playChainChime(world.chain);
      else if (ev.type === 'evolution') {
        const evo = EVOLUTIONS.find((e) => e.name === ev.name);
        announce(evo ? `${evo.banner} ${evo.desc}` : 'AWAKENED CELL EVOLUTION!');
      } else if (ev.type === 'victory') endGame(true);
      else if (ev.type === 'gameover') endGame(false);
    }
    // The particles module stays imported for the outline (DAWNWARD precedent):
    // its burst helper is exercised by the world, not by this loop.
    void spawnBurst;
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      update(world, { move: { x: 0, y: 0 }, aim: { x: 640, y: 200 }, firing: false, actions: 0 }, CONFIG.STEP);
      world.events.length = 0;
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const move = input.move();
    const aim = input.aim();
    let actions = 0;
    if (pendingDash) actions |= ACTION_DASH;
    if (pendingPolarity) actions |= ACTION_POLARITY;
    if (pendingVent) actions |= ACTION_VENT;
    if (pendingAwaken) actions |= ACTION_AWAKEN;
    if (pendingOffering) actions |= ACTION_OFFERING;
    pendingDash = false;
    pendingPolarity = false;
    pendingVent = false;
    pendingAwaken = false;
    pendingOffering = false;
    const events = update(world, { move, aim, firing: input.isFiring(), actions }, CONFIG.STEP).slice();
    world.events.length = 0;
    // The bio-ambience intensifies while Miasma Prime lives.
    let bossAlive = false;
    for (let i = 0; i < world.enemies.length; i += 1) {
      if (world.enemies[i].active && world.enemies[i].kind === 'boss') { bossAlive = true; break; }
    }
    audio.setBossPresence(bossAlive);
    handleEvents(events);
    // Belt and braces: if the world ended without an event reaching us (for
    // example a state forced from outside), still show the end screen.
    if (world.screen === 'win' && screen === SCREEN_PLAY) endGame(true);
    else if (world.screen === 'over' && screen === SCREEN_PLAY) endGame(false);
    if (world.screen === 'upgrade' && screen === SCREEN_PLAY) screen = SCREEN_UPGRADE;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= CONFIG.STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= CONFIG.STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world, screen, best, { muted: audio.isMuted() });
  }

  // Leaving the tab pauses a running game rather than letting pathogens feed unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSE;
      announce('Paused.');
    }
  });

  announce('CYTOGUARD. The Vital Surge. Press Space or click to deploy.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
