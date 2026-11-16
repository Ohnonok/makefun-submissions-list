// Boot, input and the render loop. One job: glue.
// The sim runs at a fixed 60 Hz (accumulator, max 4 steps/frame) while rendering
// runs free; the two never share mutable state except the sim object itself.
// Screenshot mode (?shot=start|play|buy|plant) stages a deterministic scene from
// the seeded match so the dossier screenshots are real renders of this code.
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { SoundBank } from './audio.js';
import { WEAPONS, ECONOMY } from './weapons.js';
import { MAP } from './map.js';
import {
  newMatch, step, player, startLive, nextRound, buyItem, DT,
  ROUND_TIME, WIN_ROUNDS,
} from './sim.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '7', 10) || 7;
const shot = params.get('shot');
const shotSeed = parseInt(params.get('shotSeed') || '7', 10) || 7;

const sounds = new SoundBank();
let s = newMatch(seed, 'CT');
const renderer = new Renderer(document.getElementById('game'));
const hud = new Hud(
  (id) => { const p = player(s); if (p && buyItem(s, p, id)) { if (['mp5', 'ak47', 'awp', 'deagle'].includes(id)) p._owned.add(id); sounds.reload(); } },
  () => closeBuy(),
);

// --- input ---------------------------------------------------------------
const input = {
  f: false, b: false, l: false, r: false, crouch: false, walk: false,
  fire: false, reload: false, smoke: false, flash: false, jump: false,
  e: false, yaw: 0, pitch: 0, weapon: 0, zoom: false,
};
let recoil = 0; // visual kick, decays every frame; the sim owns real spread.
let locked = false;
let firing = false;

const KEYMAP = {
  KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r',
  ControlLeft: 'crouch', ControlRight: 'crouch', ShiftLeft: 'walk', ShiftRight: 'walk',
  KeyE: 'e', Space: 'jump',
};
window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  const k = KEYMAP[ev.code];
  if (k) { input[k] = true; if (k === 'jump') ev.preventDefault(); }
  if (ev.code === 'KeyR') input.reload = true;
  if (ev.code === 'KeyG') input.smoke = true;
  if (ev.code === 'KeyF') input.flash = true;
  if (ev.code === 'KeyB') toggleBuy();
  if (ev.code.startsWith('Digit')) {
    // In the buy menu the number keys buy; in the round they switch weapons.
    if (s.buyOpen) {
      const item = ['mp5', 'ak47', 'awp', 'deagle', 'armor', 'smoke', 'flash', 'kit'][parseInt(ev.code.slice(5), 10) - 1];
      if (item) { const p = player(s); if (p && buyItem(s, p, item)) { if (['mp5', 'ak47', 'awp', 'deagle'].includes(item)) p._owned.add(item); sounds.reload(); } }
    } else input.weapon = parseInt(ev.code.slice(5), 10);
  }
  if (ev.code === 'Escape') closeBuy();
});
window.addEventListener('keyup', (ev) => {
  const k = KEYMAP[ev.code];
  if (k) input[k] = false;
});
document.addEventListener('mousemove', (ev) => {
  if (!locked) return;
  input.yaw -= ev.movementX * 0.0021;
  input.pitch -= ev.movementY * 0.0021;
  input.pitch = Math.max(-1.5, Math.min(1.5, input.pitch));
});
document.addEventListener('mousedown', (ev) => {
  if (ev.button === 0) {
    if (!locked && s.phase === 'live') lockPointer();
    else if (locked) firing = true;
  }
  if (ev.button === 2) input.zoom = true;
});
document.addEventListener('mouseup', (ev) => {
  if (ev.button === 0) firing = false;
  if (ev.button === 2) input.zoom = false;
});
document.addEventListener('contextmenu', (ev) => ev.preventDefault());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.renderer.domElement;
});
function lockPointer() {
  sounds.ensure();
  renderer.renderer.domElement.requestPointerLock();
}
function toggleBuy() {
  if (s.phase !== 'buy' && s.phase !== 'live') return;
  if (s.buyOpen) closeBuy();
  else { s.buyOpen = true; hud.showBuy(true); if (document.pointerLockElement) document.exitPointerLock(); }
}
function closeBuy() {
  s.buyOpen = false;
  hud.showBuy(false);
  if (s.phase === 'buy') startLive(s);
  else if (s.phase === 'live') lockPointer();
}
function openBuyPhase() {
  s.buyOpen = true;
  hud.showBuy(true);
}

document.getElementById('play').addEventListener('click', () => startGame('CT'));
document.getElementById('play-t').addEventListener('click', () => startGame('T'));
document.getElementById('again').addEventListener('click', () => {
  s = newMatch(seed, s.playerSide);
  hud.showEnd(false);
  startGame(s.playerSide);
});
function startGame(side) {
  s = newMatch(seed, side);
  const p = player(s);
  p._owned = new Set(['p250']);
  input.yaw = side === 'CT' ? Math.PI : 0;
  input.pitch = 0;
  hud.showMenu(false);
  hud.showEnd(false);
  s.phase = 'buy';
  openBuyPhase();
  sounds.ensure();
}

// --- sim events -> sound / HUD cues ---------------------------------------
let lastEventCount = 0;
function drainEvents() {
  const p = player(s);
  for (let i = lastEventCount; i < s.events.length; i++) {
    const e = s.events[i];
    switch (e.kind) {
      case 'shot':
        if (!e.quiet) sounds.shot(e.weapon === 'awp' ? 'sniper' : WEAPONS[e.weapon]?.kind || 'rifle',
          e.player ? 0 : Math.hypot(e.x - p.x, e.z - p.z));
        if (e.player) recoil = Math.min(0.06, recoil + 0.012);
        break;
      case 'dry': sounds.dryFire(); break;
      case 'reload': sounds.reload(); break;
      case 'hit':
        if (e.shooter.isPlayer) { hud.hitmarker(false); sounds.hit(); }
        if (e.victim.isPlayer) { hud.damageFlash(); sounds.hurt(); }
        break;
      case 'kill':
        if (e.killer.isPlayer) { hud.hitmarker(true); sounds.kill(); }
        break;
      case 'step': if (Math.hypot(e.x - p.x, e.z - p.z) < 12) sounds.step(e.run); break;
      case 'radio': sounds.radio(); break;
      case 'planted': sounds.plantBeep(); break;
      case 'bombBeep': sounds.bombTick(e.final); break;
      case 'explode': sounds.explode(); break;
      case 'flashPop': sounds.flashPop(); break;
      case 'smokePop': sounds.smokePop(); break;
      case 'playerFlash': break;
      case 'roundEnd': {
        const won = e.playerWon;
        if (won) sounds.roundWin(); else sounds.roundLose();
        const reasonText = {
          elimination: 'elimination', time: 'time expired',
          defuse: 'charge defused', detonation: 'charge detonated',
        }[e.reason] || e.reason;
        hud.banner(won ? 'ROUND WON' : 'ROUND LOST',
          `${e.winner === 'CT' ? 'Kiln Crew' : 'Ember Gang'} take it — ${reasonText}. Score ${s.score.CT}–${s.score.T}.`,
          won);
        break;
      }
      case 'roundStart': hud.banner(`ROUND ${e.round}`, s.round === 1 ? 'First to 5 rounds takes the yard.' : '', null); break;
      case 'buyPhase': openBuyPhase(); break;
      case 'playerDead':
        hud.banner('YOU ARE DOWN', 'Your crew fights on — next round in a moment.', false);
        break;
      default: break;
    }
  }
  lastEventCount = s.events.length;
  // Bound the event log so a long match cannot grow it without limit.
  if (s.events.length > 400) { s.events.splice(0, s.events.length - 400); lastEventCount = s.events.length; }
}

// --- screenshot staging ----------------------------------------------------
// Deterministic staged views for the dossier: the same seeded match, advanced
// a fixed number of ticks, camera posed by the shot name. No pointer lock.
function stageShot(name) {
  const p = player(s);
  p._owned = new Set(['p250', 'mp5', 'ak47']);
  hud.showMenu(false);
  if (name === 'start') {
    // Cover view: just behind the CT spawn, looking north down the mid lane
    // as the crew moves out — bots ahead in frame, not on top of the camera.
    s.phase = 'live';
    input.yaw = Math.PI / 2; input.pitch = 0.02;
    p.x = 0; p.z = 25; p.yaw = input.yaw;
    advance(60 * 4);
    p.hp = 100;
  } else if (name === 'buy') {
    s.phase = 'buy';
    p.money = 5000; s.money = 5000;
    buyItem(s, p, 'ak47'); p._owned.add('ak47');
    p.money = 1250; s.money = 1250;
    hud.showBuy(true);
    input.yaw = Math.PI / 2; input.pitch = 0;
    p.x = -2; p.z = 20; p.yaw = input.yaw;
  } else if (name === 'play') {
    s.phase = 'live';
    p.money = 5000; s.money = 5000;
    buyItem(s, p, 'ak47'); p._owned.add('ak47');
    p.x = 0; p.z = 18; p.yaw = Math.PI / 2; input.yaw = p.yaw; input.pitch = 0.02;
    // Advance the fight so bots are mid-lane and tracers fly.
    advance(60 * 14);
    p.hp = 100;
  } else if (name === 'plant') {
    s.phase = 'live';
    p.x = -16; p.z = -11; p.yaw = Math.PI * 0.75; input.yaw = p.yaw; input.pitch = -0.08;
    // Stage the bomb live at A with defenders rotating in.
    s.bombPlanted = true; s.bombSite = 'A'; s.bombTimer = 24;
    s.bombX = MAP.sites.A.x; s.bombZ = MAP.sites.A.z;
    advance(60 * 6);
    s.bombPlanted = true; s.bombSite = 'A'; s.bombTimer = 24;
    p.hp = 100;
  }
  hud.update(s, p, 0);
}
function advance(ticks) {
  const idle = { f: false, b: false, l: false, r: false, crouch: false, walk: false, fire: false, reload: false, smoke: false, flash: false, jump: false, e: false, yaw: input.yaw, pitch: input.pitch, weapon: 0, zoom: false };
  for (let i = 0; i < ticks; i++) step(s, idle, DT);
  drainEvents();
  // Staging is a photo shoot, not a death: revive the player if a bot
  // dropped them mid-advance so the shot shows a live first-person view.
  const p = player(s);
  if (!p.alive) { p.alive = true; p.hp = 100; }
}

// --- main loop -------------------------------------------------------------
let last = performance.now();
let acc = 0;
let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  elapsed += dtMs / 1000;
  const p = player(s);
  // Feed live input into the sim (edge-triggered keys consumed each step).
  const simInput = {
    ...input, fire: firing && !s.buyOpen,
    yaw: input.yaw, pitch: input.pitch,
  };
  if (s.phase === 'live' && !s.buyOpen) {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= DT && n < 4) { step(s, simInput, DT); acc -= DT; n++; }
    if (n === 4) acc = 0;
    // Consume edge triggers once per frame.
    input.reload = false; input.smoke = false; input.flash = false;
    input.weapon = 0; input.jump = false;
  } else if (s.phase === 'buy' || s.phase === 'roundEnd' || s.phase === 'matchEnd') {
    acc = 0;
    step(s, { ...simInput, fire: false }, DT);
    input.reload = false; input.smoke = false; input.flash = false; input.weapon = 0;
  }
  drainEvents();
  // Buy phase lasts 20 s at most, then the round starts whether or not the
  // player closed the menu.
  if (s.phase === 'buy' && s.phaseT > 20) closeBuy();
  // Match end overlay.
  if (s.phase === 'matchEnd' && document.getElementById('end').hidden) {
    const won = s.matchWinner === p.side;
    hud.showEnd(true,
      won ? 'Kiln Crew takes the yard' : 'Ember Gang takes the yard',
      `Final score Kiln Crew ${s.score.CT} — ${s.score.T} Ember Gang. You: ${s.kills} kills, ${s.deaths} deaths, ${s.plants} plants, ${s.defuses} defuses.`);
  }
  // Recoil decay + flash overlay.
  recoil *= 0.86;
  p._zoom = input.zoom && p.weapon === 'awp' && locked;
  const flashA = p.blindT > 0 ? Math.min(1, p.blindT) : 0;
  hud.setFlash(flashA);
  hud.update(s, p, recoil);
  renderer.render(s, p, elapsed, recoil, flashA);
}

if (shot) {
  // Screenshot mode: stage, then render continuously (the capture tool screenshots).
  s = newMatch(shotSeed, 'CT');
  stageShot(shot);
  document.title = `KILNWORKS — ${shot}`;
} else {
  hud.showMenu(true);
}
requestAnimationFrame(frame);
