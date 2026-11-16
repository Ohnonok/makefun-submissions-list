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

import { POLARITY_BIO, POLARITY_TOXIN } from '../systems/polarity.js';
import { THREAD_LIFETIME } from '../systems/constellation.js';
import { isFevered } from '../systems/overdrive.js';
import { getPhysiologyModifiers } from '../systems/physiology.js';
import { DRUG_DEFS } from '../systems/oncology.js';
import { EVOLUTIONS } from '../systems/synergies.js';
import { bossMaxHp } from '../entities/apex-boss.js';
import { WEAPON_DEFS, applyWeaponToPlayer } from '../entities/weapons.js';
import { biomeForWave, BIOMES } from '../systems/campaign.js';
import { upgradeDef } from '../systems/draft.js';
import { createAudio } from '../audio/synth.js';
import { getBiomeChronicle, VICTORY_NARRATIVE } from '../lore/codex.js';
import { spawnBurst } from '../render/effects.js';
import { SFX_BUTTON } from '../ui/hud.js';
import { createRenderer, TITLE_DEPLOY, TITLE_CLASS_RECTS, UPGRADE_CARD_RECTS, UPGRADE_SKIP, ROUTE_A, ROUTE_B, OVER_RETRY, OVER_CHANGE, WIN_AGAIN, WIN_CHANGE, WIN_ARMORY, SCREEN_TITLE, SCREEN_PLAY, SCREEN_UPGRADE, SCREEN_OVER, SCREEN_WIN, SCREEN_PAUSE } from '../render/vascular.js';
import { loadLineageBank, saveLineageBank, resolveVictoryEnding, resolveEpigeneticDefeatEnding } from './lineage.js';
import { selectOrganBranch, enterEndlessMutation, bindStartWave } from '../systems/campaign.js';
import { triggerSystolicOverdrive } from '../systems/rhythm.js';
import { enterCodon } from '../systems/genetics.js';
import { CODEX_BUTTON } from '../lore/codex.js';
import { createWorld, resetRunState, startWave, update, buyUpgrade, advanceWave } from './state.js';
import { CONFIG } from './config.js';
import { createInput, ACTION_AWAKEN, ACTION_CONFIRM, ACTION_DASH, ACTION_OFFERING, ACTION_PAUSE, ACTION_PICK_1, ACTION_PICK_2, ACTION_PICK_3, ACTION_POLARITY, ACTION_SKIP, ACTION_VALVE, ACTION_VENT } from './input.js';
import { stageShot } from '../shots.js';

/** The longest frame the loop catches up on (50 ms): a longer stall is dropped, never replayed, so pathogens never teleport on frame drops. */
const MAX_FRAME = 0.05;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
world.lineage = loadLineageBank();
world.lineageGp = world.lineage.gp;
world.codexOpen = false;
bindStartWave((s, n) => startWave(s, n));
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
  let pendingValve = false;
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
    world.lineageGp = world.lineage.gp;
    applyWeaponToPlayer(world.player, selectedWeapon);
    world.player.damage *= 1 + (world.lineage.adaptiveImmunity || 0); // Epigenetic Memory: salvaged defeats make the next lineage stronger.
    audio.setDraftMuffled(false);
    world.selectedWeapon = selectedWeapon;
    world.screen = 'play';
    startWave(world, 1);
    accumulator = 0;
    pendingDash = false;
    pendingPolarity = false;
    pendingVent = false;
    pendingAwaken = false;
    pendingOffering = false;
    pendingValve = false;
    pendingValve = false;
    screen = SCREEN_PLAY;
    announce('Playing. Protect the Organ Core for 15 waves.');
  }

  function endGame(won) {
    if (screen === SCREEN_OVER || screen === SCREEN_WIN) return;
    if (world.score > best) {
      best = world.score;
      saveBest(best);
    }
    if (won) {
      resolveVictoryEnding(world.lineage); saveLineageBank(world.lineage); world.lineageGp = world.lineage.gp;
      screen = SCREEN_WIN;
      audio.playImmunityVictory();
      announce(`Victory. ${VICTORY_NARRATIVE} Score ${world.score}. Best ${best}.`);
    } else {
      resolveEpigeneticDefeatEnding(world.lineage); saveLineageBank(world.lineage); world.lineageGp = world.lineage.gp;
      screen = SCREEN_OVER;
      audio.playDefeat();
      announce(`Game over. Score ${world.score}. Best ${best}.`);
    }
  }

  /** Back to the title / immune-class screen (CHANGE CELL button). */
  function goToTitle() {
    audio.click();
    resetRunState(world);
    world.lineageGp = world.lineage.gp; // Keep the bank badge true after victory/defeat.
    world.selectedWeapon = selectedWeapon;
    screen = SCREEN_TITLE;
    announce('Choose your immune class, Cell.');
  }

  function chooseUpgrade(index) {
    const choice = world.choices[index];
    const codon = enterCodon(world.genetics, ['VIT', 'PRO', 'MIN'][index] || 'VIT');
    if (codon === 'morph') announce('APEX SOVEREIGN MORPH — cilia wings + DNA ring!');
    audio.setDraftMuffled(false);
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
        if (inside(CODEX_BUTTON, click)) { world.codexOpen = !world.codexOpen; audio.click(); announce(world.codexOpen ? 'Bio-Codex open.' : 'Bio-Codex closed.'); return; }
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
        if (inside(ROUTE_A, click)) { selectOrganBranch(world, 'lungs'); audio.setDraftMuffled(false); advanceWave(world, null); screen = SCREEN_PLAY; announce('Route A: Alveolar Lungs.'); return; }
        if (inside(ROUTE_B, click)) { selectOrganBranch(world, 'liver'); audio.setDraftMuffled(false); advanceWave(world, null); screen = SCREEN_PLAY; announce('Route B: Hepatic Liver.'); return; }
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
      if (actions & ACTION_DASH) { pendingDash = true; if (triggerSystolicOverdrive(world.rhythm)) announce('SYSTOLIC OVERDRIVE — 2x Fibrin + 2x GP!'); }
      if (actions & ACTION_POLARITY) { pendingPolarity = true; if (triggerSystolicOverdrive(world.rhythm)) announce('SYSTOLIC OVERDRIVE — 2x Fibrin + 2x GP!'); }
      if (actions & ACTION_VENT) pendingVent = true;
      if (actions & ACTION_AWAKEN) pendingAwaken = true;
      if (actions & ACTION_OFFERING) pendingOffering = true;
      if (actions & ACTION_VALVE) pendingValve = true;
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
        if (screen === SCREEN_WIN && inside(WIN_CHANGE, click)) { enterEndlessMutation(world); screen = SCREEN_PLAY; announce('Endless Wave 16+ — double mutation every 3 waves.'); }
        else if (screen === SCREEN_WIN && inside(WIN_ARMORY, click)) goToTitle();
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
      else if (ev.type === 'opsonize') announce('OPSONIZED — dash through it to hijack!');
      else if (ev.type === 'hijack') { audio.playGeneDraft(); announce('SYMBIOTIC GUARDIAN DRONE HIJACKED — it fights for the host!'); }
      else if (ev.type === 'valve') announce('VASCULAR VALVE OPEN — flow sweeps foes into the Fibrin Triangle!');
      else if (ev.type === 'contract') { audio.playWaveChime(); announce(`${ev.text} — COMPLETE! +150 GP to the Cell Lineage Bank.`); }
      else if (ev.type === 'contractExpired') announce('Bio-Contract expired.');
      else if (ev.type === 'secondWind') { audio.playNovaBlast(); announce('SECOND WIND — Adrenaline Surge! 2.5 s invulnerable.'); }
      else if (ev.type === 'emergency') announce(`WAVE EMERGENCY: ${ev.name}`);
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
    if (pendingValve) actions |= ACTION_VALVE;
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
    if (world.screen === 'upgrade' && screen === SCREEN_PLAY) { screen = SCREEN_UPGRADE; audio.setDraftMuffled(true); }
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

export function bootstrapGame() {
  if (shot) runShot(shot);
  else runGame();
}
