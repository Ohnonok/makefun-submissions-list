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
import { predictArc } from './sound.js';
import {
  newMatch, step, player, startLive, nextRound, buyItem, DT,
  ROUND_TIME, WIN_ROUNDS, assignPostPlant, throwGrenade,
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
  fire: false, reload: false, jump: false,
  e: false, yaw: 0, pitch: 0, weapon: 0, zoom: false,
  // v3 grenades are hold-to-aim: holding G/F shows the dashed arc, releasing
  // throws. aim* is held state, throw* is the release edge (consumed per frame).
  aimSmoke: false, aimFlash: false, throwSmoke: false, throwFlash: false,
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
  if (ev.code === 'KeyG') input.aimSmoke = true;
  if (ev.code === 'KeyF') input.aimFlash = true;
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
  // Releasing a grenade key throws it (the arc was shown while held).
  if (ev.code === 'KeyG') { input.aimSmoke = false; input.throwSmoke = true; }
  if (ev.code === 'KeyF') { input.aimFlash = false; input.throwFlash = true; }
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
    // Stage the bomb live at A with defenders rotating in, the guard and
    // cross-fire in place, a smoke cloud on the site, and the player holding
    // a smoke aim (dashed arc visible) — the v3 systems in one frame.
    s.bombPlanted = true; s.bombSite = 'A'; s.bombTimer = 24;
    s.bombX = MAP.sites.A.x; s.bombZ = MAP.sites.A.z;
    assignPostPlant(s, 'A');
    advance(60 * 6);
    const site = MAP.sites.A;
    // A real smoke ON the site: a CT retaker throws the retake smoke. (A T
    // thrower staged next to the player would gun the player down before the
    // shot is taken — same side never shoots.) Stage the nearest living CT
    // bot on a clear lane north of the site, then search the pitch whose
    // predicted landing (predictArc == the real flight) is closest to the
    // site centre, and throw for real.
    const smoker = s.actors.filter((a) => a.side === 'CT' && a.alive && !a.isPlayer)
      .sort((a, b) => Math.hypot(a.x - site.x, a.z - site.z) - Math.hypot(b.x - site.x, b.z - site.z))[0];
    if (smoker) {
      smoker.x = -18; smoker.z = -4; smoker.smoke = 1;
      smoker.yaw = Math.atan2(-(site.z - smoker.z), site.x - smoker.x);
      let best = null;
      for (let p = -0.4; p <= 0.71; p += 0.1) {
        smoker.pitch = Math.round(p * 10) / 10;
        const pts = predictArc(s, smoker);
        const [lx, , lz] = pts[pts.length - 1];
        const d = Math.hypot(lx - site.x, lz - site.z);
        if (!best || d < best.d) best = { pitch: smoker.pitch, d };
      }
      smoker.pitch = best.pitch;
      throwGrenade(s, smoker, 'smoke');
    }
    advance(60 * 3);
    s.bombPlanted = true; s.bombSite = 'A'; s.bombTimer = 24;
    p.smoke = 1; input.aimSmoke = true;
    p.hp = 100;
  }
  hud.update(s, p, 0);
}
function advance(ticks) {
  const idle = { f: false, b: false, l: false, r: false, crouch: false, walk: false, fire: false, reload: false, aimSmoke: false, aimFlash: false, throwSmoke: false, throwFlash: false, jump: false, e: false, yaw: input.yaw, pitch: input.pitch, weapon: 0, zoom: false };
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
    // Grenade aim + throw (v3): the dashed arc follows the mouse while held.
    if (p.alive) {
      if (input.aimSmoke && p.smoke > 0) { p.aimKind = 'smoke'; p.aimArc = predictArc(s, p); }
      else if (input.aimFlash && p.flash > 0) { p.aimKind = 'flash'; p.aimArc = predictArc(s, p); }
      else p.aimArc = null;
      if (input.throwSmoke) { throwGrenade(s, p, 'smoke'); p.aimArc = null; }
      if (input.throwFlash) { throwGrenade(s, p, 'flash'); p.aimArc = null; }
    }
    // Consume edge triggers once per frame.
    input.reload = false; input.throwSmoke = false; input.throwFlash = false;
    input.weapon = 0; input.jump = false;
  } else if (s.phase === 'buy' || s.phase === 'roundEnd' || s.phase === 'matchEnd') {
    acc = 0;
    step(s, { ...simInput, fire: false }, DT);
    input.reload = false; input.throwSmoke = false; input.throwFlash = false; input.weapon = 0;
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
