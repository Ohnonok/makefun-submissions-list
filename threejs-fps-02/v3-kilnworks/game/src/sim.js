// Fixed-step simulation (60 Hz), kept apart from rendering. One job: the match.
// State lives in one place: this object. Rendering reads it, never mutates it.
// Phases: 'menu' -> 'buy' -> 'live' -> 'roundEnd' -> 'buy' ... -> 'matchEnd'.
// Sides: CT = Kiln Crew (defend), T = Ember Gang (attack, carry the charge).
import { MAP, resolveCircle, losClear, findPath, nodeById } from './map.js';
import { WEAPONS, ECONOMY, damageAt, sprayOffset } from './weapons.js';
import { makeRng, pick, range, shuffle } from './rng.js';
import { emitNoise, pollSoundBus, smokeBlocks, predictArc, grenadeLaunch, pruneSoundBus } from './sound.js';

export const DT = 1 / 60;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const DEFUSE_KIT_TIME = 2.5;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;

export function newMatch(seed, playerSide = 'CT') {
  const rng = makeRng(seed);
  const s = {
    seed, rng, time: 0, phase: 'menu', phaseT: 0,
    round: 1, score: { CT: 0, T: 0 }, losses: { CT: 0, T: 0 }, streak: { CT: 0, T: 0 },
    roundTimer: ROUND_TIME, bombTimer: 0, bombSite: null, bombPlanted: false,
    bombX: 0, bombZ: 0, plantProgress: 0, defuseProgress: 0, planter: null, defuser: null,
    playerSide, winner: null, winReason: '', matchWinner: null,
    money: ECONOMY.start, kills: 0, deaths: 0, plants: 0, defuses: 0,
    actors: [], smokes: [], flashes: [], tracers: [], soundBus: [],
    radio: [], feed: [], events: [], // events: transient render cues {kind,...}
    buyOpen: false, roundLog: [],
  };
  spawnRound(s);
  return s;
}

function makeActor(s, side, idx, isPlayer) {
  const spawn = MAP.spawns[side][idx % 5];
  // Names are drawn without replacement per side, so the kill feed never
  // shows the same name killing itself.
  const pool = s._namePools ??= { CT: shuffle(s.rng, BOT_NAMES.CT), T: shuffle(s.rng, BOT_NAMES.T) };
  return {
    id: `${side}${idx}`, side, isPlayer: !!isPlayer, alive: true,
    name: isPlayer ? 'You' : pool[side][idx % pool[side].length],
    x: spawn.x + range(s.rng, -0.8, 0.8), z: spawn.z + range(s.rng, -0.8, 0.8),
    y: 0, yaw: side === 'CT' ? Math.PI : 0, pitch: 0,
    hp: 100, armor: 0, hasHelmet: false, hasKit: false,
    weapon: 'p250', mag: 12, reserve: 36, reloading: 0, shotIdx: 0,
    cooldown: 0, speed: 4.4, crouch: false, moving: false, airborne: false,
    vy: 0, flashT: 0, blindT: 0, smoke: 0, flash: 0,
    role: 'rifle', plan: null, path: [], pathI: 0, holdT: 0, holdNode: null,
    target: null, aimErr: 0.02, lastSeen: null, hearX: 0, hearZ: 0, hearT: 0, hearType: null,
    plantT: 0, defuseT: 0, kills: 0, money: ECONOMY.start, reactT: 0,
    hasBomb: false, stepT: 0, burstLeft: 0, burstPause: 0, strafeDir: 1, strafeT: 0,
    // v3 tactical state: aim window for a grenade throw (arc preview + throw),
    // radio throttle, hold-angle aim, flank staging. All flags reset per round
    // because makeActor runs fresh in spawnRound.
    state: 'plan', aimT: 0, aimKind: null, aimTx: 0, aimTz: 0, aimArc: null,
    callT: 0, angleYaw: 0,
    // Addendum state: dead-air clock (last enemy contact, sim time), per-bot
    // quiet threshold drawn from s.rng, cover point for reload/low-HP.
    lastContactT: s.time, deadAirT: 8 + s.rng() * 4, coverX: 0, coverZ: 0, coverT: 0,
  };
}
const BOT_NAMES = {
  CT: ['Ash', 'Brick', 'Mara', 'Furnace', 'Soot', 'Kiln', 'Pete', 'Rosa'],
  T: ['Ember', 'Cinder', 'Flint', 'Spark', 'Coal', 'Ashen', 'Vex', 'Torch'],
};

export function spawnRound(s) {
  s.actors = [];
  for (let i = 0; i < 5; i++) s.actors.push(makeActor(s, 'CT', i, s.playerSide === 'CT' && i === 0));
  for (let i = 0; i < 5; i++) s.actors.push(makeActor(s, 'T', i, s.playerSide === 'T' && i === 0));
  // The charge goes to a random Ember Gang bot (never the player on T side round 1
  // unless the player is the only carrier — keep it on a bot for clarity).
  const carriers = s.actors.filter((a) => a.side === 'T' && !a.isPlayer);
  pick(s.rng, carriers).hasBomb = true;
  s.bombPlanted = false; s.bombSite = null; s.plantProgress = 0; s.defuseProgress = 0;
  s.planter = null; s.defuser = null; s.roundTimer = ROUND_TIME; s.bombTimer = 0;
  s.smokes = []; s.flashes = []; s.tracers = [];
  assignPlans(s);
  s.roundLog.push(`Round ${s.round} — ${s.score.CT}-${s.score.T}`);
}

export function player(s) { return s.actors.find((a) => a.isPlayer); }
export function aliveOf(s, side) { return s.actors.filter((a) => a.side === side && a.alive); }
export function enemiesOf(s, a) { return s.actors.filter((o) => o.side !== a.side && o.alive); }

// --- team plans -------------------------------------------------------------
// Attackers pick one plan per round; defenders split 2/2/1 with a rotator.
// Plans are announced on the radio so the player can play around them.
export function assignPlans(s) {
  const plan = pick(s.rng, ['A-split', 'A-rush', 'B-rush', 'B-split', 'mid-fake']);
  const attackers = s.actors.filter((a) => a.side === 'T');
  const defenders = s.actors.filter((a) => a.side === 'CT');
  const site = plan.startsWith('A') ? 'A' : plan.startsWith('B') ? 'B' : pick(s.rng, ['A', 'B']);
  const routes = {
    'A-split': ['aDoor', 'aSite', 'aKiln'],
    'A-rush': ['aDoor', 'aSite', 'aSite'],
    'B-rush': ['bDoor', 'bSite', 'bSite'],
    'B-split': ['bDoor', 'bSite', 'bYard'],
    'mid-fake': ['midTop', 'aDoor', 'aSite'],
  }[plan];
  attackers.forEach((a, i) => {
    a.plan = plan; a.role = i === 0 ? 'carrier' : i === 1 ? 'entry' : i === 2 ? 'support' : i === 3 ? 'lurk' : 'flank';
    // Lurk and flank do NOT take the plan's door route: they swing wide through
    // the opposite corner (aCorner for A, bCorner for B) and come at the site
    // from the side. _flankStage 0 walks to the corner, 1 walks on to the site.
    if (a.role === 'lurk' || a.role === 'flank') {
      const corner = site === 'A' ? 'aCorner' : 'bCorner';
      a.path = findPath(a.x, a.z, corner);
      a.pathI = 0; a._flankStage = 0; a._flankSite = site; a.holdNode = null;
    } else {
      a.path = findPath(a.x, a.z, routes[Math.min(i, routes.length - 1)]);
      a.pathI = 0; a.holdT = 0;
      // Attackers hold their route's end (the site) once the path is walked,
      // pre-aimed at the retake entry the defenders must come through.
      a.holdNode = routes[routes.length - 1];
      const retakeNode = nodeById(site === 'A' ? 'aRetake' : 'bRetake');
      const holdSpot = nodeById(a.holdNode);
      a.angleYaw = Math.atan2(-(retakeNode.z - holdSpot.z), retakeNode.x - holdSpot.x);
    }
  });
  const defSpots = shuffle(s.rng, ['aHold', 'aHold', 'bHold', 'bHold', 'midLow']);
  // Hold angles: each anchor pre-aims the lane its spot guards (the door the
  // attackers must come through), so the hold is a real angle, not a drift.
  const holdAim = { aHold: 'aDoor', bHold: 'bDoor', midLow: 'midTop' };
  defenders.forEach((a, i) => {
    a.plan = 'hold'; a.role = i === 4 ? 'rotate' : 'anchor';
    a.path = findPath(a.x, a.z, defSpots[i]); a.pathI = 0; a.holdNode = defSpots[i];
    const spot = nodeById(defSpots[i]), aim = nodeById(holdAim[defSpots[i]]);
    a.angleYaw = Math.atan2(-(aim.z - spot.z), aim.x - spot.x);
  });
  radio(s, 'sys', `Plan: ${plan} — hit ${site === 'A' ? 'Kiln Hall' : 'Brick Yard'}.`);
  if (plan === 'mid-fake') radio(s, 'sys', 'Mid noise first, then commit — watch both sites.');
}

export function radio(s, who, text) {
  s.radio.push({ who, text, t: s.time });
  if (s.radio.length > 5) s.radio.shift();
  s.events.push({ kind: 'radio' });
}
export function feed(s, killer, victim, head) {
  s.feed.push({ killer, victim, head, t: s.time });
  if (s.feed.length > 5) s.feed.shift();
}

// --- noise / hearing --------------------------------------------------------
// The hearing bus lives in sound.js (typed, team-filtered, wall-attenuated,
// pruned on sim time). Bots poll it every tick in stepBot; friendly noise
// never pulls an investigation, and a wall muffles a sound to 35% of its radius.
export function canSee(s, a, b) {
  if (!a.alive || !b.alive) return false;
  if (a.blindT > 0) return false;
  const d = Math.hypot(a.x - b.x, a.z - b.z);
  if (d > 46) return false;
  // Smoke blocks the whole sight segment, not just its midpoint (v2 bug).
  if (smokeBlocks(s, a.x, a.z, b.x, b.z)) return false;
  if (!losClear(a.x, a.z, b.x, b.z)) return false;
  // Field of view: bots see ~100 degrees ahead; the player sees everything.
  if (!a.isPlayer) {
    const want = Math.atan2(-(b.z - a.z), b.x - a.x);
    let diff = want - a.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) > 1.05 && d > 6) return false;
  }
  return true;
}

// --- shooting ---------------------------------------------------------------
export function fireWeapon(s, a) {
  const w = WEAPONS[a.weapon];
  if (!a.alive || a.reloading > 0 || a.cooldown > 0 || a.mag <= 0) {
    if (a.mag <= 0 && a.isPlayer) s.events.push({ kind: 'dry' });
    return false;
  }
  a.mag--; a.cooldown = 60 / w.rpm; a.shotIdx++;
  const spread = w.spread
    + (a.moving ? w.moveSpread : 0)
    + (a.airborne ? w.airSpread : 0)
    + (a.crouch ? -0.003 : 0)
    + Math.min(0.03, a.shotIdx * 0.0016);
  const sp = sprayOffset(a.weapon, a.shotIdx, s.rng);
  const yaw = a.yaw + (s.rng() - 0.5) * 2 * spread + sp.yaw * 0.02;
  const pitch = a.pitch + sp.pitch * 0.35 + (s.rng() - 0.5) * 2 * spread;
  const dir = { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.sin(yaw) * Math.cos(pitch) };
  const eyeY = 1.55 - (a.crouch ? 0.35 : 0);
  const origin = { x: a.x, y: eyeY, z: a.z };
  const hit = traceShot(s, a, origin, dir);
  s.tracers.push({ x0: origin.x, y0: origin.y, z0: origin.z, x1: hit.x, y1: hit.y, z1: hit.z, t: 0.08, shooter: a.side });
  s.events.push({ kind: 'shot', weapon: a.weapon, x: a.x, z: a.z, side: a.side, player: a.isPlayer });
  emitNoise(s, a.x, a.z, a.weapon === 'awp' ? 42 : 30, a.side, 'gunshot');
  return true;
}

function traceShot(s, shooter, o, d) {
  let bestT = 60, best = null, bestHead = false;
  for (const o2 of s.actors) {
    if (o2 === shooter || !o2.alive) continue;
    const eyeY = 1.55 - (o2.crouch ? 0.35 : 0);
    // Body capsule: vertical segment y 0.15..eyeY at (x,z), radius 0.42.
    const tBody = rayCapsule(o, d, o2.x, o2.z, 0.15, eyeY, 0.42);
    // Head sphere at eyeY + 0.10, radius 0.16 — a real head is small; the old
    // 0.24 radius made nearly every near-miss a headshot.
    const tHead = raySphere(o, d, o2.x, eyeY + 0.10, o2.z, 0.16);
    if (tHead !== null && tHead < bestT) { bestT = tHead; best = o2; bestHead = true; }
    else if (tBody !== null && tBody < bestT) { bestT = tBody; best = o2; bestHead = false; }
  }
  // Walls stop bullets: clamp the tracer at the first collider hit.
  const wallT = rayWalls(o, d);
  const endT = Math.min(bestT, wallT);
  const end = { x: o.x + d.x * endT, y: o.y + d.y * endT, z: o.z + d.z * endT };
  if (best && bestT <= wallT) {
    const dist = Math.hypot(best.x - shooter.x, best.z - shooter.z);
    let dmg = damageAt(shooter.weapon, dist, bestHead);
    // Bots deal 75% damage: without it, five bots crossing mid wipe a team
    // in ~15 s and rounds never reach the objective.
    if (!shooter.isPlayer) dmg *= 0.75;
    if (best.hasHelmet && bestHead) dmg = Math.min(dmg, WEAPONS[shooter.weapon].damage);
    if (best.armor > 0) dmg *= 0.5;
    best.hp -= dmg;
    s.events.push({ kind: 'hit', shooter, victim: best, head: bestHead, dmg });
    if (best.hp <= 0) killActor(s, shooter, best, bestHead);
  }
  return end;
}
function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
function rayCapsule(o, d, x, z, y0, y1, r) {
  // 2D ray vs circle in XZ, then check the hit height is inside the segment.
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const y = o.y + d.y * t;
  return y >= y0 - 0.05 && y <= y1 + 0.25 ? t : null;
}
function rayWalls(o, d) {
  let best = 60;
  for (const c of MAP.colliders) {
    // Slab test in 3D (box top at h).
    let t0 = 0, t1 = best;
    const slabs = [[o.x, d.x, c.x0, c.x1], [o.z, d.z, c.z0, c.z1], [o.y, d.y, 0, c.h]];
    let ok = true;
    for (const [p, dd, lo, hi] of slabs) {
      if (Math.abs(dd) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } }
      else {
        let u = (lo - p) / dd, v = (hi - p) / dd;
        if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 > 0.01 && t0 < best) best = t0;
  }
  return best;
}

function killActor(s, killer, victim, head) {
  victim.alive = false; victim.hp = 0;
  feed(s, killer.name, victim.name, head);
  s.events.push({ kind: 'kill', killer, victim, head });
  if (killer.isPlayer) {
    s.kills++; s.money = Math.min(ECONOMY.maxMoney, s.money + ECONOMY.kill);
  }
  if (victim.isPlayer) { s.deaths++; s.events.push({ kind: 'playerDead' }); }
  if (victim.hasBomb) {
    // The charge drops where the carrier fell; a living teammate can pick it up.
    s.events.push({ kind: 'bombDrop', x: victim.x, z: victim.z });
    const mate = s.actors.find((a) => a.side === 'T' && a.alive && !a.isPlayer);
    if (mate) mate.hasBomb = true;
  }
  // Radio the death.
  if (victim.isPlayer) radio(s, victim.side, `You are down at ${areaName(victim.x, victim.z)}.`);
  else if (victim.side === 'CT') radio(s, 'CT', `${victim.name} is down at ${areaName(victim.x, victim.z)}.`);
  else radio(s, 'T', `${victim.name} dropped.`);
  checkRoundEnd(s);
}
export function areaName(x, z) {
  if (Math.hypot(x - MAP.sites.A.x, z - MAP.sites.A.z) < 8) return 'Kiln Hall A';
  if (Math.hypot(x - MAP.sites.B.x, z - MAP.sites.B.z) < 8) return 'Brick Yard B';
  if (Math.abs(z) < 8 && Math.abs(x) < 12) return 'Furnace Hall mid';
  return z < 0 ? 'north lanes' : 'south lanes';
}

// --- grenades ---------------------------------------------------------------
export function throwGrenade(s, a, kind) {
  if (kind === 'smoke' && a.smoke <= 0) return false;
  if (kind === 'flash' && a.flash <= 0) return false;
  if (kind === 'smoke') a.smoke--; else a.flash--;
  // Launch shares grenadeLaunch with the arc preview (sound.js), so the
  // preview and the real flight are the same computation.
  const l = grenadeLaunch(a);
  const g = { kind, x: l.x, y: l.y, z: l.z, vx: l.vx, vy: l.vy, vz: l.vz, t: 0, landed: false, r: 0, team: a.side };
  s.events.push({ kind: 'throw', grenade: g, thrower: a });
  (s._grenades ??= []).push(g);
  s.events.push({ kind: 'shot', weapon: 'pistol', x: a.x, z: a.z, side: a.side, player: a.isPlayer, quiet: true });
  emitNoise(s, a.x, a.z, 16, a.side, 'throw');
  return true;
}
function stepGrenades(s, dt) {
  const list = s._grenades ?? [];
  for (const g of list) {
    if (g.landed) continue;
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const p = resolveCircle(g.x, g.z, 0.2);
    if (p.x !== g.x || p.z !== g.z) { g.vx *= -0.3; g.vz *= -0.3; g.x = p.x; g.z = p.z; }
    if (g.y <= 0.15) {
      g.y = 0.15; g.landed = true; g.t = 0;
      if (g.kind === 'smoke') {
        s.smokes.push({ x: g.x, z: g.z, r: 4.2, t: 12 });
        s.events.push({ kind: 'smokePop', x: g.x, z: g.z });
        emitNoise(s, g.x, g.z, 12, g.team, 'smoke');
      } else {
        s.flashes.push({ x: g.x, y: 1.2, z: g.z, t: 0.1 });
        s.events.push({ kind: 'flashPop', x: g.x, z: g.z });
        emitNoise(s, g.x, g.z, 20, g.team, 'flash');
        for (const a of s.actors) {
          if (!a.alive) continue;
          const d = Math.hypot(a.x - g.x, a.z - g.z);
          if (d > 26) continue;
          // v2 bug: the blind check used facing + distance only, so a flash
          // behind a wall blinded bots through it. Line of sight is required.
          if (!losClear(a.x, a.z, g.x, g.z)) continue;
          // Blind only if the actor is roughly facing the pop.
          const want = Math.atan2(-(g.z - a.z), g.x - a.x);
          let diff = want - a.yaw;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          if (a.isPlayer || Math.abs(diff) < 1.6) {
            a.flashT = 2.5 * Math.max(0.3, 1 - d / 30);
            a.blindT = a.flashT;
            if (a.isPlayer) s.events.push({ kind: 'playerFlash', t: a.flashT });
          }
        }
      }
    }
  }
  s._grenades = list.filter((g) => !g.landed || g.kind === 'smoke');
  for (const sm of s.smokes) sm.t -= dt;
  s.smokes = s.smokes.filter((sm) => sm.t > 0);
  for (const fl of s.flashes) fl.t -= dt;
  s.flashes = s.flashes.filter((fl) => fl.t > 0);
}

// --- buy --------------------------------------------------------------------
export function buyItem(s, a, id) {
  const price = { mp5: 1500, ak47: 2700, awp: 4750, deagle: 700, armor: 1000, smoke: 300, flash: 200, kit: 400 }[id];
  if (price === undefined) return false;
  if (a.money < price) return false;
  if (id === 'armor' && a.armor >= 100) return false;
  if (id === 'kit' && a.hasKit) return false;
  a.money -= price;
  if (id === 'armor') { a.armor = 100; a.hasHelmet = true; }
  else if (id === 'smoke') a.smoke++;
  else if (id === 'flash') a.flash++;
  else if (id === 'kit') a.hasKit = true;
  else {
    a.weapon = id;
    const w = WEAPONS[id];
    a.mag = w.mag; a.reserve = w.reserve;
  }
  if (a.isPlayer) s.money = a.money;
  s.events.push({ kind: 'buy', item: id });
  return true;
}
export function reloadWeapon(s, a) {
  const w = WEAPONS[a.weapon];
  if (a.reloading > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  a.reloading = w.reload;
  s.events.push({ kind: 'reload', actor: a });
  emitNoise(s, a.x, a.z, 14, a.side, 'reload');
  return true;
}

// --- plant / defuse ---------------------------------------------------------
function nearSite(s, a) {
  for (const [key, site] of Object.entries(MAP.sites)) {
    if (Math.hypot(a.x - site.x, a.z - site.z) < site.r) return key;
  }
  return null;
}
export function playerAction(s, p, dt, holdingE) {
  // Plant: T player with the charge, standing in a site, holding E.
  if (p.side === 'T' && p.hasBomb && !s.bombPlanted) {
    const site = nearSite(s, p);
    if (site && holdingE) {
      s.plantProgress += dt / PLANT_TIME;
      s.planter = p;
      if (s.plantProgress >= 1) {
        s.bombPlanted = true; s.bombSite = site;
        s.bombTimer = BOMB_TIME;
        s.bombX = MAP.sites[site].x; s.bombZ = MAP.sites[site].z;
        p.hasBomb = false; s.plants++;
        s.money = Math.min(ECONOMY.maxMoney, s.money + ECONOMY.plant);
        radio(s, 'sys', `Charge planted at ${site === 'A' ? 'Kiln Hall' : 'Brick Yard'}!`);
        s.events.push({ kind: 'planted', site });
        emitNoise(s, s.bombX, s.bombZ, 45, 'T', 'plant');
        assignPostPlant(s, site);
      }
    } else s.plantProgress = 0;
  }
  // Defuse: CT player standing on the planted bomb, holding E.
  if (p.side === 'CT' && s.bombPlanted) {
    const d = Math.hypot(p.x - s.bombX, p.z - s.bombZ);
    if (d < 3 && holdingE) {
      s.defuseProgress += dt / (p.hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME);
      s.defuser = p;
      if (s.defuseProgress >= 1) {
        s.defuses++;
        s.events.push({ kind: 'defused' });
        endRound(s, 'CT', 'defuse');
      }
    } else s.defuseProgress = 0;
  }
}

// --- round flow -------------------------------------------------------------
function checkRoundEnd(s) {
  if (s.phase !== 'live') return;
  const ct = aliveOf(s, 'CT').length, t = aliveOf(s, 'T').length;
  if (s.bombPlanted) {
    // Bomb live: defenders wiped out ends it for the attackers at once;
    // attackers wiped out leaves the bomb ticking — defenders must still defuse.
    if (ct === 0) endRound(s, 'T', 'elimination');
    return;
  }
  if (ct === 0) endRound(s, 'T', 'elimination');
  else if (t === 0) endRound(s, 'CT', 'elimination');
}
export function endRound(s, winner, reason) {
  if (s.phase !== 'live') return;
  s.phase = 'roundEnd'; s.phaseT = 0;
  s.winner = winner; s.winReason = reason;
  s.score[winner]++;
  if (winner === 'T') s.losses.CT++; else s.losses.T++;
  // Consecutive-loss streak (losses never resets, so it cannot be the streak):
  // the winner's streak clears, the loser's grows. nextRound's team buy reads it.
  s.streak[winner] = 0; s.streak[winner === 'T' ? 'CT' : 'T']++;
  const p = player(s);
  const pWon = p.side === winner;
  const streak = s.losses[p.side];
  const reward = pWon ? ECONOMY.roundWin : ECONOMY.roundLoss + Math.min(2, streak - 1) * ECONOMY.lossStreakBonus;
  p.money = Math.min(ECONOMY.maxMoney, p.money + reward);
  s.money = p.money;
  for (const a of s.actors) {
    if (!a.isPlayer) a.money = Math.min(ECONOMY.maxMoney, a.money + (a.side === winner ? ECONOMY.roundWin : ECONOMY.roundLoss));
    if (a.alive && a.side === winner) a.money += 0;
  }
  s.events.push({ kind: 'roundEnd', winner, reason, playerWon: pWon });
  if (s.score[winner] >= WIN_ROUNDS || s.round >= MAX_ROUNDS) {
    s.matchWinner = s.score.CT > s.score.T ? 'CT' : s.score.T > s.score.CT ? 'T' : 'CT';
  }
}
export function nextRound(s) {
  if (s.matchWinner) { s.phase = 'matchEnd'; s.phaseT = 0; return; }
  s.round++;
  spawnRound(s);
  s.phase = 'buy'; s.phaseT = 0;
  const p = player(s);
  // Synchronized team economy (v3): ONE buy plan per side per round, drawn
  // from s.rng — the team buys coherently instead of each bot rolling alone.
  // After a win the team full-buys rifles + utility; after 2+ straight losses
  // the team ecos together and saves; otherwise it forces. Per-bot money still
  // gates every purchase (buyItem refuses what a bot cannot afford).
  const buyPlan = { CT: teamBuyPlan(s, 'CT'), T: teamBuyPlan(s, 'T') };
  radio(s, 'sys', buyPlan[p.side] === 'full' ? 'Team buy: full — rifles and utility.'
    : buyPlan[p.side] === 'force' ? 'Team buy: force — SMGs and what we can afford.'
    : 'Team buy: eco — save for next round.');
  const buyOdds = {
    full: { awp: 0.12, rifle: 1, smg: 1, armor: 0.7, smoke: 0.7, flash: 0.6, kit: 0.5 },
    force: { awp: 0, rifle: 0.5, smg: 1, armor: 0.4, smoke: 0.4, flash: 0.3, kit: 0.3 },
    eco: { awp: 0, rifle: 0, smg: 0, armor: 0.15, smoke: 0.25, flash: 0.2, kit: 0.15 },
  };
  for (const a of s.actors) {
    if (a.isPlayer) continue;
    const odds = buyOdds[buyPlan[a.side]];
    if (a.money >= 4750 && odds.awp > 0 && s.rng() < odds.awp) buyItem(s, a, 'awp');
    else if (a.money >= 2700 && s.rng() < odds.rifle) buyItem(s, a, 'ak47');
    else if (a.money >= 1500 && s.rng() < odds.smg) buyItem(s, a, 'mp5');
    if (a.money >= 1000 && s.rng() < odds.armor) buyItem(s, a, 'armor');
    if (a.money >= 300 && s.rng() < (a.role === 'support' ? Math.min(0.9, odds.smoke + 0.15) : odds.smoke)) buyItem(s, a, 'smoke');
    if (a.money >= 200 && s.rng() < (a.role === 'entry' ? Math.min(0.9, odds.flash + 0.15) : odds.flash)) buyItem(s, a, 'flash');
    if (a.side === 'CT' && a.money >= 400 && s.rng() < odds.kit) buyItem(s, a, 'kit');
  }
  s.events.push({ kind: 'buyPhase', round: s.round });
}
export function startLive(s) {
  s.phase = 'live'; s.phaseT = 0; s.buyOpen = false;
  s.events.push({ kind: 'roundStart', round: s.round });
}

// --- per-tick update --------------------------------------------------------
export function step(s, input, dt) {
  s.time += dt;
  pruneSoundBus(s);
  for (const t of s.tracers) t.t -= dt;
  s.tracers = s.tracers.filter((t) => t.t > 0);
  for (const a of s.actors) {
    if (a.cooldown > 0) a.cooldown -= dt;
    if (a.reloading > 0) {
      a.reloading -= dt;
      if (a.reloading <= 0) {
        const w = WEAPONS[a.weapon];
        const need = w.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }
    if (a.flashT > 0) a.flashT -= dt;
    if (a.blindT > 0) a.blindT -= dt;
    if (a.hearT > 0) a.hearT -= dt;
  }
  stepGrenades(s, dt);
  if (s.phase === 'buy') { s.phaseT += dt; return; }
  if (s.phase === 'roundEnd') {
    s.phaseT += dt;
    if (s.phaseT > 3.2) nextRound(s);
    return;
  }
  if (s.phase !== 'live') return;
  s.phaseT += dt;
  // Timers.
  if (s.bombPlanted) {
    s.bombTimer -= dt;
    if (Math.ceil(s.bombTimer * 2) !== Math.ceil((s.bombTimer + dt) * 2)) {
      s.events.push({ kind: 'bombBeep', final: s.bombTimer < 8 });
    }
    if (s.bombTimer <= 0) {
      s.events.push({ kind: 'explode' });
      // Blast kills everyone near the site; the round goes to the attackers.
      for (const a of s.actors) {
        if (a.alive && Math.hypot(a.x - s.bombX, a.z - s.bombZ) < 12) { a.alive = false; a.hp = 0; }
      }
      endRound(s, 'T', 'detonation');
      return;
    }
  } else {
    s.roundTimer -= dt;
    if (s.roundTimer <= 0) endRound(s, 'CT', 'time');
  }
  const p = player(s);
  if (p && p.alive) {
    movePlayer(s, p, input, dt);
    playerAction(s, p, dt, !!input.e);
  }
  for (const a of s.actors) {
    if (!a.isPlayer && a.alive) stepBot(s, a, dt);
  }
  // Bomb pickup: a living T walking over a dropped charge takes it.
  for (const a of s.actors) {
    if (a.side === 'T' && a.alive && !a.hasBomb && !s.bombPlanted) {
      const carrier = s.actors.find((o) => o.side === 'T' && o.hasBomb);
      if (!carrier) a.hasBomb = true;
    }
  }
}

function movePlayer(s, p, input, dt) {
  const w = WEAPONS[p.weapon];
  p.yaw = input.yaw; p.pitch = input.pitch;
  const crouch = !!input.crouch;
  p.crouch = crouch;
  const speed = (crouch ? 2.2 : input.walk ? 2.6 : p.speed) * (p.weapon === 'awp' && input.zoom ? 0.5 : 1);
  const fwd = (input.f ? 1 : 0) - (input.b ? 1 : 0);
  const str = (input.r ? 1 : 0) - (input.l ? 1 : 0);
  const len = Math.hypot(fwd, str) || 1;
  const mx = (Math.cos(p.yaw) * fwd + Math.sin(p.yaw) * str) / len;
  const mz = (-Math.sin(p.yaw) * fwd + Math.cos(p.yaw) * str) / len;
  p.moving = fwd !== 0 || str !== 0;
  if (p.moving) {
    p.x += mx * speed * dt; p.z += mz * speed * dt;
    const r = resolveCircle(p.x, p.z, 0.42);
    p.x = r.x; p.z = r.z;
    p.stepT += dt * (input.walk ? 0.7 : 1.4);
    if (p.stepT > 0.45) { p.stepT = 0; s.events.push({ kind: 'step', x: p.x, z: p.z, run: !input.walk }); emitNoise(s, p.x, p.z, input.walk ? 4 : 9, p.side, 'step'); }
  }
  if (input.jump && p.y <= 0.01) { p.vy = 5.2; p.airborne = true; }
  if (p.y > 0 || p.vy !== 0) {
    p.vy -= 14 * dt; p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.airborne = false; }
  }
  if (input.fire) fireWeapon(s, p);
  if (input.reload) reloadWeapon(s, p);
  // Grenade throws are hold-to-aim now: main.js aims the arc while G/F is held
  // and throws on release (throwGrenade is called from the frame loop).
  if (input.weapon) {
    const map = { 1: 'p250', 2: 'mp5', 3: 'ak47', 4: 'awp', 5: 'deagle' };
    const want = map[input.weapon];
    if (want && p.weapon !== want) {
      // Only switch to weapons actually owned (buy menu owns them; slots map to buys).
      const owned = p._owned ?? (p._owned = new Set(['p250']));
      if (owned.has(want)) { p.weapon = want; const ww = WEAPONS[want]; p.mag = ww.mag; p.reserve = ww.reserve; p.shotIdx = 0; }
    }
  }
}

// --- v3 bot helpers ---------------------------------------------------------
// Team buy plan: one draw per side per round (see nextRound). Full after a win,
// eco after 2+ straight losses, force otherwise.
function teamBuyPlan(s, side) {
  if (s.winner === side) return 'full';
  if (s.streak[side] >= 2) return 'eco';
  return 'force';
}
// Nearest waypoint that breaks line of sight to the last known enemy position.
// Cover is picked from the existing waypoint graph — no new nav system. Falls
// back to backing straight off from the enemy when no breaking node is near.
function pickCoverNode(s, a) {
  const e = a.lastSeen;
  if (!e) return null;
  let best = null, bestD = Infinity;
  for (const n of MAP.nodes) {
    const d = Math.hypot(a.x - n.x, a.z - n.z);
    if (d < 1 || d > 14 || d >= bestD) continue;
    if (losClear(n.x, n.z, e.x, e.z)) continue;
    best = n; bestD = d;
  }
  if (best) return { x: best.x, z: best.z };
  const dx = a.x - e.x, dz = a.z - e.z, d = Math.hypot(dx, dz) || 1;
  const p = resolveCircle(a.x + (dx / d) * 3, a.z + (dz / d) * 3, 0.42);
  return { x: p.x, z: p.z };
}
function startReloadWithCover(s, a) {
  const c = pickCoverNode(s, a);
  if (c) { a.coverX = c.x; a.coverZ = c.z; }
  reloadWeapon(s, a);
}
// Start a grenade aim window: face the target point, lob up, keep the arc
// preview fresh. The throw fires when aimT runs out (handled in stepBot).
function startAim(s, a, kind, tx, tz) {
  a.aimT = 0.35; a.aimKind = kind; a.aimTx = tx; a.aimTz = tz;
  a.yaw = Math.atan2(-(tz - a.z), tx - a.x);
  // Pick the pitch whose predicted landing is closest to the aim point.
  // The launch has a +0.45 vertical bias, so a fixed 0.3 lobs every throw
  // ~20 units — fine for a long execute, useless for a close one. The search
  // spans a downward aim (-0.4, ~7 units) to a high lob (0.7, ~22 units).
  let best = null;
  for (let p = -0.4; p <= 0.71; p += 0.1) {
    a.pitch = Math.round(p * 10) / 10;
    const pts = predictArc(s, a);
    const [lx, , lz] = pts[pts.length - 1];
    const d = Math.hypot(lx - tx, lz - tz);
    if (!best || d < best.d) best = { pitch: a.pitch, d };
  }
  a.pitch = best.pitch; a.aimPitch = best.pitch;
  a.aimArc = predictArc(s, a);
}
function nearestNodeNear(x, z, maxD, seeNode) {
  let best = null, bestD = Infinity;
  for (const n of MAP.nodes) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d > maxD || d >= bestD) continue;
    if (seeNode && !losClear(n.x, n.z, seeNode.x, seeNode.z)) continue;
    best = n; bestD = d;
  }
  if (best) return best;
  for (const n of MAP.nodes) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d <= maxD && d < bestD) { best = n; bestD = d; }
  }
  return best ?? nodeById('midLow');
}
// Bomb guard + cross-fire: once the charge is down, the living T bot nearest
// the bomb guards it facing the most likely retake entry, and the rest spread
// across different angles around the site instead of stacking on one spot.
export function assignPostPlant(s, site) {
  const st = MAP.sites[site];
  const alive = s.actors.filter((a) => a.side === 'T' && a.alive);
  if (!alive.length) return;
  const entryNode = nodeById(site === 'A' ? 'aRetake' : 'bRetake');
  let guard = alive[0], gd = Infinity;
  for (const a of alive) {
    const d = Math.hypot(a.x - st.x, a.z - st.z);
    if (d < gd) { gd = d; guard = a; }
  }
  guard.role = 'guard';
  const guardSpot = nearestNodeNear(st.x, st.z, 8, entryNode);
  guard.path = findPath(guard.x, guard.z, guardSpot.id);
  guard.pathI = 0; guard.holdNode = guardSpot.id;
  guard.angleYaw = Math.atan2(-(entryNode.z - guardSpot.z), entryNode.x - guardSpot.x);
  radio(s, 'T', `${guard.name}: Guarding the charge — watch the doors.`);
  const spots = site === 'A' ? ['aKiln', 'aCorner', 'aDoor'] : ['bYard', 'bCorner', 'bDoor'];
  let si = 0;
  for (const a of alive) {
    if (a === guard) continue;
    const spot = nodeById(spots[si++ % spots.length]);
    a.role = 'crossfire';
    a.path = findPath(a.x, a.z, spot.id);
    a.pathI = 0; a.holdNode = spot.id;
    a.angleYaw = Math.atan2(-(st.z - spot.z), st.x - spot.x);
  }
}

// --- bot brains -------------------------------------------------------------
// Bots run a tiny state machine: follow the team plan path, hold a node, fight
// what they see, investigate noise, plant when they carry the charge, defuse
// when the bomb is down and the site looks clear. Accuracy is deliberately
// human-ish: aim error shrinks while they stand still and grows with distance.
function stepBot(s, a, dt) {
  if (a.callT > 0) a.callT -= dt;
  // Poll the hearing bus: enemy noise within (possibly muffled) radius sets an
  // investigation point. Friendly noise is ignored by the bus itself.
  pollSoundBus(s, a);
  // Grenade aim window: stand still, face the target, keep the arc fresh; the
  // throw fires when the window closes.
  if (a.aimT > 0) {
    a.aimT -= dt;
    a.yaw = Math.atan2(-(a.aimTz - a.z), a.aimTx - a.x);
    a.pitch = a.aimPitch ?? 0.3;
    a.aimArc = predictArc(s, a);
    if (a.aimT <= 0) {
      throwGrenade(s, a, a.aimKind);
      a.aimKind = null; a.aimArc = null;
    }
    return;
  }
  // Reloading: keep moving to the cover picked when the reload started.
  if (a.reloading > 0) {
    if (a.coverX !== 0 || a.coverZ !== 0) moveBotToward(s, a, a.coverX, a.coverZ, dt, 3.6);
    return;
  }
  // Pick the nearest visible enemy.
  let target = null, targetD = Infinity;
  for (const o of enemiesOf(s, a)) {
    if (!canSee(s, a, o)) continue;
    const d = Math.hypot(a.x - o.x, a.z - o.z);
    if (d < targetD) { targetD = d; target = o; }
  }
  a.target = target;
  if (target) {
    a.lastContactT = s.time;
    if (a._lastTarget !== target) {
      a._lastTarget = target; a.reactT = 0.45; a.burstLeft = 0;
      // Target-acquired callout, throttled so the radio never floods.
      if (a.callT <= 0) {
        radio(s, a.side, `${a.name}: Contact ${areaName(target.x, target.z)}!`);
        a.callT = 8;
      }
    }
    if (a.reactT > 0) { a.reactT -= dt; a.yaw = Math.atan2(-(target.z - a.z), target.x - a.x); return; }
    a.lastSeen = { x: target.x, z: target.z, t: s.time };
    a.yaw = Math.atan2(-(target.z - a.z), target.x - a.x);
    const dist = targetD;
    const w = WEAPONS[a.weapon];
    // Aim error: worse at range, better when the bot is still and the target is close.
    const errBase = 0.05 + dist * 0.002 + (a.moving ? 0.03 : 0) + (a.blindT > 0 ? 0.2 : 0);
    a.aimErr = errBase;
    // Aim at the chest, not the eyes: bots that aimed at eye height scored
    // headshots on nearly every burst. Chest height keeps fights human-paced.
    const chestY = 1.05 - (target.crouch ? 0.3 : 0);
    a.pitch = (chestY - 1.55) / Math.max(6, dist);
    // Burst discipline: 3-round bursts with pauses, longer pauses at range.
    if (a.burstPause > 0) a.burstPause -= dt;
    else if (a.burstLeft > 0) {
      a.yaw += (s.rng() - 0.5) * errBase * 2;
      a.pitch += (s.rng() - 0.5) * errBase;
      if (fireWeapon(s, a)) a.burstLeft--;
      if (a.burstLeft <= 0) a.burstPause = dist > 18 ? 0.75 : 0.5;
    } else {
      a.burstLeft = dist > 20 ? 2 : 3 + Math.floor(s.rng() * 2);
    }
    // Strafe while fighting, but stop to shoot straight at close range.
    a.strafeT -= dt;
    if (a.strafeT <= 0) { a.strafeDir *= -1; a.strafeT = 0.8 + s.rng() * 0.8; }
    if (dist > 8) moveBotToward(s, a, a.x + Math.sin(a.yaw) * a.strafeDir * 2, a.z + Math.cos(a.yaw) * a.strafeDir * 2, dt, 2.4);
    // Reloading in the open is a death sentence: break to cover first.
    if (a.mag === 0) startReloadWithCover(s, a);
    return;
  }
  // Low HP, no target in sight: break to cover once per round, hold the angle
  // for a few seconds, then re-engage. (Fighting while hurt happens above.)
  if (a.hp < 35 && a.lastSeen && !a._lowCoverUsed) {
    if (!a._lowCover) {
      const c = pickCoverNode(s, a);
      if (c) { a.coverX = c.x; a.coverZ = c.z; a._lowCover = true; a.coverT = 4; }
    }
    if (a._lowCover) {
      if (a.coverT > 0) {
        a.coverT -= dt;
        if (Math.hypot(a.x - a.coverX, a.z - a.coverZ) > 1.2) moveBotToward(s, a, a.coverX, a.coverZ, dt, 3.6);
        else a.yaw = Math.atan2(-(a.lastSeen.z - a.z), a.lastSeen.x - a.x);
        return;
      }
      a._lowCover = false; a._lowCoverUsed = true;
    }
  }
  // Bot utility: bots finally throw what they buy. Each trigger is decided
  // once per round (the _*Tried flag) with a seeded roll, then the bot aims
  // for 0.35 s (arc visible) and throws. This runs BEFORE investigation: a
  // support that hears the enemy must still smoke the execute, not spend the
  // whole approach walking at the noise instead of throwing.
  if (a.side === 'T' && (a.role === 'support' || a.role === 'entry')) {
    const site = a.plan && a.plan.startsWith('B') ? 'B' : 'A';
    const st = MAP.sites[site];
    const dSite = Math.hypot(a.x - st.x, a.z - st.z);
    if (a.role === 'support' && a.smoke > 0 && !a._smokeTried && dSite < 15) {
      a._smokeTried = true;
      if (s.rng() < 0.8) { startAim(s, a, 'smoke', st.x, st.z); return; }
    }
    if (a.role === 'entry' && a.flash > 0 && !a._flashTried && dSite < 12) {
      a._flashTried = true;
      if (s.rng() < 0.7) { startAim(s, a, 'flash', st.x, st.z); return; }
    }
  }
  if (a.side === 'CT' && a.flash > 0 && !a._flashTried && a.hearT > 0) {
    const dHear = Math.hypot(a.x - a.hearX, a.z - a.hearZ);
    if (dHear < 18) {
      a._flashTried = true;
      if (s.rng() < 0.7) { startAim(s, a, 'flash', a.hearX, a.hearZ); return; }
    }
  }
  if (a.side === 'CT' && a.smoke > 0 && !a._smokeTried && s.bombPlanted) {
    const dBomb = Math.hypot(a.x - s.bombX, a.z - s.bombZ);
    if (dBomb < 16) {
      a._smokeTried = true;
      if (s.rng() < 0.8) { startAim(s, a, 'smoke', s.bombX, s.bombZ); return; }
    }
  }
  // No target: investigate heard noise first.
  if (a.hearT > 0) {
    moveBotToward(s, a, a.hearX, a.hearZ, dt, 3.6);
    if (Math.hypot(a.x - a.hearX, a.z - a.hearZ) < 1.2) a.hearT = 0;
    return;
  }
  // Plant / defuse duties.
  if (a.side === 'T' && a.hasBomb && !s.bombPlanted) {
    const site = a.plan && a.plan.startsWith('B') ? 'B' : a.plan === 'mid-fake' ? (s.rng() < 0.5 ? 'A' : 'B') : 'A';
    const st = MAP.sites[site];
    if (Math.hypot(a.x - st.x, a.z - st.z) < st.r - 1) {
      a.plantT += dt;
      if (a.plantT > PLANT_TIME) {
        s.bombPlanted = true; s.bombSite = site; s.bombTimer = BOMB_TIME;
        s.bombX = st.x; s.bombZ = st.z; a.hasBomb = false;
        radio(s, 'T', `Charge planted at ${site === 'A' ? 'Kiln Hall' : 'Brick Yard'}!`);
        s.events.push({ kind: 'planted', site });
        emitNoise(s, s.bombX, s.bombZ, 45, 'T', 'plant');
        assignPostPlant(s, site);
      }
      return;
    }
    moveBotToward(s, a, st.x, st.z, dt, 4.2);
    return;
  }
  if (a.side === 'CT' && s.bombPlanted) {
    const d = Math.hypot(a.x - s.bombX, a.z - s.bombZ);
    if (d < 2.5) {
      a.defuseT += dt;
      if (a.defuseT > (a.hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME)) {
        s.defuses++;
        s.events.push({ kind: 'defused' });
        endRound(s, 'CT', 'defuse');
      }
      return;
    }
    // Rotate role converges IMMEDIATELY on the plant: v2 waited for a second
    // teammate or 12 s on the clock while the bomb ticked.
    if (a.role === 'rotate') {
      if (!a._rotated) {
        radio(s, 'CT', `${a.name}: Rotating to ${s.bombSite} — charge down!`);
        a._rotated = true;
      }
      moveBotToward(s, a, s.bombX, s.bombZ, dt, 4.6);
      return;
    }
    // Anchors stage at the retake node at once (they no longer hold the empty
    // site), then push in once a teammate is near or the clock forces it.
    const retakeId = s.bombSite === 'A' ? 'aRetake' : 'bRetake';
    if (a._staged !== s.bombSite) {
      if (!a._rotated) {
        radio(s, 'CT', `${a.name}: Rotating to ${s.bombSite} — charge down!`);
        a._rotated = true;
      }
      const rn = nodeById(retakeId);
      if (Math.hypot(a.x - rn.x, a.z - rn.z) > 1.5) {
        moveBotToward(s, a, rn.x, rn.z, dt, 4.4);
        return;
      }
      a._staged = s.bombSite;
    }
    const matesNear = aliveOf(s, 'CT').filter((o) => Math.hypot(o.x - s.bombX, o.z - s.bombZ) < 14).length;
    if (matesNear >= 2 || s.bombTimer < 12) moveBotToward(s, a, s.bombX, s.bombZ, dt, 4.4);
    else { a.holdT += dt; if (a.holdT > 2) { a.holdT = 0; moveBotToward(s, a, s.bombX + range(s.rng, -6, 6), s.bombZ + range(s.rng, -6, 6), dt, 3); } }
    return;
  }
  // Follow the plan path, then hold. Entry moves a step faster; lurk/flank
  // swing on to the site from their corner once they reach it.
  if (a.pathI < a.path.length) {
    const node = a.path[a.pathI];
    moveBotToward(s, a, node.x, node.z, dt, a.role === 'entry' ? 4.6 : 4.2);
    if (Math.hypot(a.x - node.x, a.z - node.z) < 1.0) a.pathI++;
    if (a.pathI >= a.path.length && (a.role === 'lurk' || a.role === 'flank') && a._flankStage === 0) {
      a._flankStage = 1;
      const siteNode = a._flankSite === 'A' ? 'aSite' : 'bSite';
      const retakeNode = nodeById(a._flankSite === 'A' ? 'aRetake' : 'bRetake');
      a.path = findPath(a.x, a.z, siteNode);
      a.pathI = 0; a.holdNode = siteNode;
      a.angleYaw = Math.atan2(-(retakeNode.z - nodeById(siteNode).z), retakeNode.x - nodeById(siteNode).x);
      if (!a._flanked && a.callT <= 0) {
        radio(s, a.side, `${a.name}: Flanking ${a._flankSite} — coming around.`);
        a._flanked = true; a.callT = 8;
      }
    }
  } else if (a.holdNode) {
    const n = nodeById(a.holdNode);
    if (n) {
      if (Math.hypot(a.x - n.x, a.z - n.z) > 1.5) moveBotToward(s, a, n.x, n.z, dt, 3);
      else {
        // HOLD_ANGLE: pre-aim the guarded lane with a narrow sweep.
        a.yaw = a.angleYaw + Math.sin(s.time * 0.4 + a.x) * 0.12;
        // NO-DEAD-AIR: quiet too long — push the objective (T) or take a mid
        // angle (CT) instead of holding a dead lane. Guards and cross-fire
        // hold the planted site no matter what.
        if (a.role !== 'guard' && a.role !== 'crossfire' && s.time - a.lastContactT > a.deadAirT) {
          a.deadAirT = 8 + s.rng() * 4;
          if (a.side === 'T') {
            const siteNode = a.plan && a.plan.startsWith('B') ? 'bSite' : 'aSite';
            const retakeNode = nodeById(siteNode === 'aSite' ? 'aRetake' : 'bRetake');
            a.path = findPath(a.x, a.z, siteNode); a.pathI = 0; a.holdNode = siteNode;
            a.angleYaw = Math.atan2(-(retakeNode.z - nodeById(siteNode).z), retakeNode.x - nodeById(siteNode).x);
            if (a.callT <= 0) { radio(s, a.side, `${a.name}: Pushing ${siteNode === 'aSite' ? 'A' : 'B'} — dead air.`); a.callT = 8; }
          } else {
            const midNode = a.holdNode === 'bHold' ? 'midLow' : 'midTop';
            const farNode = nodeById(midNode === 'midLow' ? 'midTop' : 'midLow');
            a.path = findPath(a.x, a.z, midNode); a.pathI = 0; a.holdNode = midNode;
            a.angleYaw = Math.atan2(-(farNode.z - nodeById(midNode).z), farNode.x - nodeById(midNode).x);
            if (a.callT <= 0) { radio(s, a.side, `${a.name}: Pushing mid — quiet here.`); a.callT = 8; }
          }
        }
      }
    }
  }
}
function moveBotToward(s, a, tx, tz, dt, speed) {
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return;
  a.moving = true;
  a.yaw = Math.atan2(-dz, dx);
  const step = Math.min(d, speed * dt);
  a.x += (dx / d) * step; a.z += (dz / d) * step;
  const r = resolveCircle(a.x, a.z, 0.42);
  a.x = r.x; a.z = r.z;
  a.stepT += dt * 1.4;
  if (a.stepT > 0.5) { a.stepT = 0; emitNoise(s, a.x, a.z, 5, a.side, 'step'); }
}
