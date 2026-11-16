// KILNWORKS v3 — Hearing Bus + grenade ballistics. One job: sound and throws.
// The bus is typed, team-filtered and wall-attenuated, and it runs on sim time
// only: every event carries {type, x, z, radius, team, t} with t = s.time, and
// events older than SOUND_AGE are pruned, so the bus never grows across a match.
// Determinism: no Math.random, no wall clock — every decision draws on s.rng,
// every timestamp is s.time or dt. (The pasted SoundBus sketch used
// performance.now() and an unbounded array; neither is copied here.)
import { losClear, resolveCircle } from './map.js';

export const SOUND_AGE = 1.2; // seconds an event stays on the bus
const WALL_MUFFLE = 0.35; // a wall between ear and source shrinks the radius
const GRAVITY = 12; // matches stepGrenades: the arc preview is the real flight
const THROW_SPEED = 13;

// --- hearing bus ------------------------------------------------------------
// Bots poll the bus every tick (pollSoundBus, called from stepBot). Friendly
// noise never pulls an investigation: a CT anchor does not abandon its hold
// because a teammate fired. Enemy noise through a wall is muffled to 35% of
// its radius — a gunshot two rooms away is a rumour, not a call to rotate.
export function emitNoise(s, x, z, radius, team, type) {
  (s.soundBus ??= []).push({ type, x, z, radius, team, t: s.time });
  pruneSoundBus(s);
}
export function pruneSoundBus(s) {
  const bus = s.soundBus;
  if (!bus || !bus.length) return;
  const cut = s.time - SOUND_AGE;
  let i = 0;
  while (i < bus.length && bus[i].t < cut) i++;
  if (i) bus.splice(0, i);
}
// Newest audible enemy event for this bot, or null. Effective radius is full
// with a clear sound path, muffled through walls. hearT is only (re)set when
// the bot is not already investigating, so a fresh loud event cannot yank a
// bot off a trail it is already following.
export function pollSoundBus(s, a) {
  const bus = s.soundBus;
  if (!bus || !bus.length) return null;
  for (let i = bus.length - 1; i >= 0; i--) {
    const e = bus[i];
    if (e.team === a.side) continue;
    const d = Math.hypot(a.x - e.x, a.z - e.z);
    const heard = losClear(a.x, a.z, e.x, e.z) ? d < e.radius : d < e.radius * WALL_MUFFLE;
    if (heard) {
      if (a.hearT <= 0) { a.hearX = e.x; a.hearZ = e.z; a.hearT = 3; a.hearType = e.type; }
      return e;
    }
  }
  return null;
}

// --- smoke vs line of sight -------------------------------------------------
// v2 tested smoke only at the midpoint between viewer and target, so a cloud
// sitting on the line of sight but off the midpoint did not block. This tests
// the whole segment against every live smoke circle.
export function segCircleHit(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((cx - ax) * dx + (cz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t, pz = az + dz * t;
  const ddx = px - cx, ddz = pz - cz;
  return ddx * ddx + ddz * ddz < r * r;
}
export function smokeBlocks(s, ax, az, bx, bz) {
  for (const sm of s.smokes) {
    if (sm.t > 0 && segCircleHit(ax, az, bx, bz, sm.x, sm.z, sm.r)) return true;
  }
  return false;
}

// --- grenade ballistics -----------------------------------------------------
// One launch computation shared by the real throw and the arc preview, so the
// dashed preview can never drift from where the grenade actually lands.
export function grenadeLaunch(a) {
  const dir = {
    x: Math.cos(a.yaw) * Math.cos(a.pitch),
    y: Math.sin(a.pitch) + 0.45,
    z: -Math.sin(a.yaw) * Math.cos(a.pitch),
  };
  const eyeY = 1.55 - (a.crouch ? 0.35 : 0);
  return {
    x: a.x, y: eyeY, z: a.z,
    vx: dir.x * THROW_SPEED, vy: dir.y * THROW_SPEED, vz: dir.z * THROW_SPEED,
  };
}
// Simulate the flight stepGrenades will run (same dt, gravity, wall bounce,
// floor stop) and return the path as [x, y, z] points, sampled every 2nd step,
// plus the landing point. Pure function of the actor's pose — deterministic.
export function predictArc(s, a) {
  const g = grenadeLaunch(a);
  const pts = [[g.x, g.y, g.z]];
  const dt = 1 / 60;
  for (let i = 0; i < 100; i++) {
    g.vy -= GRAVITY * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const p = resolveCircle(g.x, g.z, 0.2);
    if (p.x !== g.x || p.z !== g.z) { g.vx *= -0.3; g.vz *= -0.3; g.x = p.x; g.z = p.z; }
    if (i % 2 === 0) pts.push([g.x, g.y, g.z]);
    if (g.y <= 0.15) { pts.push([g.x, 0.15, g.z]); break; }
  }
  return pts;
}
