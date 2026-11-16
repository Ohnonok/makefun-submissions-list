// CYTOGUARD boss: Miasma Prime, a giant bio-synthetic parasite. Two phases,
// both telegraphed: Phase 1 (hp > 50%) — radial toxin burst after a 0.8 s
// warning ring, plus bacillus spawns. Phase 2 (hp <= 50%) — a sweeping
// laser: a 1 s warning line, then a rotating beam that hurts the cell it
// touches, plus faster radial bursts. All timers live on the enemy object
// (e.telegraph / e.laserPhase / e.laserAngle); world.js owns the pools and
// calls these helpers.

export const BOSS_BURST_COUNT = 10;
export const BOSS_BURST_INTERVAL = 3.2;
export const BOSS_TELEGRAPH_TIME = 0.8;
export const BOSS_LASER_WARN_TIME = 1.0;
export const BOSS_LASER_SWEEP_TIME = 2.2;
export const BOSS_LASER_RANGE = 520;
export const BOSS_LASER_DAMAGE = 14;

/** Boss hp for a boss wave: base 620, +120 per boss wave after the first. */
export function bossMaxHp(wave, bossEvery) {
  return 620 + Math.max(0, wave - bossEvery) * 120;
}

/** Toxin tentacles left: both in phase 1, one is destroyed in phase 2. */
export function bossTentacles(e) {
  return bossPhase(e) === 2 ? 1 : 2;
}

/** Radial burst size: 10 toxins in phase 1, 6 in phase 2 (one tentacle gone). */
export function bossBurstCount(e) {
  return bossPhase(e) === 2 ? 6 : BOSS_BURST_COUNT;
}

/** True once the boss has lost half its health: phase 2 begins. */
export function bossPhase(e) {
  return e.hp <= e.maxHp * 0.5 ? 2 : 1;
}

/** Angles of the radial burst, rotated by the run clock so no two bursts match. */
export function bossBurstAngles(time, count) {
  const n = count || BOSS_BURST_COUNT;
  const out = [];
  for (let k = 0; k < n; k += 1) {
    out.push((k / n) * Math.PI * 2 + time);
  }
  return out;
}

/** Phase-2 spiral angles: a rotating helix, offset by the run clock. */
export function bossSpiralAngles(time, count) {
  const out = [];
  for (let k = 0; k < count; k += 1) {
    out.push((k / count) * Math.PI * 2 + time * 1.7);
  }
  return out;
}

/**
 * Advance the boss's attack timers by dt. Returns 'telegraph' when a radial
 * burst warning starts, 'burst' when the burst fires, 'laserWarn' when the
 * sweeping laser warns, 'laserStart' when it starts sweeping, 'laserEnd'
 * when the sweep finishes, or null. The caller fires the actual toxins.
 */
export function updateBossAttacks(e, dt, time) {
  if (bossPhase(e) === 2) {
    // Phase 2: sweeping laser cycle (warn -> sweep -> rest), bursts faster.
    if (!e.laserPhase) e.laserPhase = 'rest';
    if (e.laserPhase === 'rest') {
      e.laserTimer = (e.laserTimer || 0) - dt;
      if (e.laserTimer <= 0) {
        e.laserPhase = 'warn';
        e.laserTimer = BOSS_LASER_WARN_TIME;
        e.laserAngle = Math.atan2(360 - e.y, 640 - e.x);
        return 'laserWarn';
      }
    } else if (e.laserPhase === 'warn') {
      e.laserTimer -= dt;
      if (e.laserTimer <= 0) {
        e.laserPhase = 'sweep';
        e.laserTimer = BOSS_LASER_SWEEP_TIME;
        return 'laserStart';
      }
    } else if (e.laserPhase === 'sweep') {
      e.laserTimer -= dt;
      e.laserAngle += dt * 1.4;
      if (e.laserTimer <= 0) {
        e.laserPhase = 'rest';
        e.laserTimer = 2.0;
        return 'laserEnd';
      }
    }
    // Bursts continue in phase 2, faster and still telegraphed.
    return updateBossBurst(e, dt, 2.2);
  }
  return updateBossBurst(e, dt, BOSS_BURST_INTERVAL);
}

function updateBossBurst(e, dt, interval) {
  if (e.telegraph > 0) {
    e.telegraph -= dt;
    if (e.telegraph <= 0) {
      e.burstTimer = interval;
      return 'burst';
    }
    return null;
  }
  e.burstTimer -= dt;
  if (e.burstTimer <= 0.6 && e.burstTimer > 0) {
    e.telegraph = BOSS_TELEGRAPH_TIME;
    return 'telegraph';
  }
  if (e.burstTimer <= 0) {
    e.burstTimer = interval;
    return 'burst';
  }
  return null;
}

/** True when the sweeping laser beam touches point (x, y). */
export function laserHitsPoint(e, x, y) {
  if (e.laserPhase !== 'sweep') return false;
  const dx = x - e.x;
  const dy = y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist > BOSS_LASER_RANGE || dist < 10) return false;
  let diff = Math.abs(Math.atan2(dy, dx) - e.laserAngle);
  if (diff > Math.PI) diff = Math.PI * 2 - diff;
  return diff < 0.14;
}

// --- v2 OMEGA CHIMERA (The Synthetic Sovereign), Wave 15 Apex Final Boss ---
export const OMEGA_CARAPACE_DR = 0.75; // 75% damage reduction vs Grade 1-3 fire.
export const OMEGA_POLARITY_PERIOD = 5; // seconds between polarity inversions.
export const OMEGA_SPIRE_THRESHOLD = 0.4; // spire regrowth under 40% HP.
export function omegaCarapaceReduction(grade) { return grade < 4 ? OMEGA_CARAPACE_DR : 0; }
/** Rapid Polarity Inversion: boss flips gold/purple every 5 s (tick-driven). */
export function updateOmegaBoss(e, dt) {
  if (!e.omega) return;
  e.polarityTimer = (e.polarityTimer ?? OMEGA_POLARITY_PERIOD) - dt;
  if (e.polarityTimer <= 0) {
    e.polarityTimer = OMEGA_POLARITY_PERIOD;
    e.polarity = e.polarity === 'bio' ? 'toxin' : 'bio';
  }
  // Metastatic Spire Regrowth: under 40% HP, grow 2 Oncogenic Spires.
  if (e.hp / e.maxHp < OMEGA_SPIRE_THRESHOLD && !e.spires) {
    e.spires = 2;
    e.spireTimer = 0;
  }
}
/** Touch 3 — Miasma Prime signature attacks (also on Omega in Endless). */
export const ECLIPSE_TELEGRAPH = 1.2; // seconds of warning aim line.
export function eclipseBeamSweep(e, dt) {
  e.eclipseTimer = (e.eclipseTimer ?? 0) + dt;
  if (e.eclipseTimer < ECLIPSE_TELEGRAPH) return { phase: 'telegraph', t: e.eclipseTimer / ECLIPSE_TELEGRAPH };
  if (e.eclipseTimer < ECLIPSE_TELEGRAPH + 1.0) return { phase: 'sweep', t: (e.eclipseTimer - ECLIPSE_TELEGRAPH) };
  e.eclipseTimer = 0;
  return { phase: 'idle', t: 0 };
}
/** 2 Orbital Capsid Shields: break with opposite polarity before the core opens. */
export function orbitalCapsidShields(e, time) {
  const shields = [];
  for (let i = 0; i < 2; i += 1) {
    const a = time * 0.8 + i * Math.PI;
    shields.push({ x: e.x + Math.cos(a) * (e.radius + 46), y: e.y + Math.sin(a) * (e.radius + 46), hp: 40, polarity: i === 0 ? 'bio' : 'toxin' });
  }
  return shields;
}
