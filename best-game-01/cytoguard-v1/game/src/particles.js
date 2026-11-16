// CYTOGUARD particles: the pooled burst / damage-number helpers, split out
// of world.js so the renderer and the simulation share one vocabulary. Every
// helper takes the pool it writes into and the seeded random generator — no
// hidden state, no wall clock. Cell lysis: when a pathogen dies, its membrane
// bursts into glowing vesicle particles (spawnLysisBurst), which the renderer
// paints with additive glow.

export function freeSlot(list) {
  for (let i = 0; i < list.length; i += 1) if (!list[i].active) return list[i];
  return null;
}

export function countActive(list) {
  let n = 0;
  for (let i = 0; i < list.length; i += 1) if (list[i].active) n += 1;
  return n;
}

/** A radial burst of fading sparks at (x, y). */
export function spawnBurst(particles, random, x, y, colour, count, speed, size) {
  for (let i = 0; i < count; i += 1) {
    const p = freeSlot(particles);
    if (!p) return;
    const a = random() * Math.PI * 2;
    const v = speed * (0.3 + random() * 0.7);
    p.active = true; p.x = x; p.y = y;
    p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
    p.life = 0.45 + random() * 0.35; p.maxLife = p.life;
    p.size = size * (0.6 + random() * 0.8); p.colour = colour; p.vesicle = false;
  }
}

/**
 * Cell lysis: a dying membrane bursts into glowing vesicles — larger, slower,
 * longer-lived glowing blobs that drift apart and fade, plus a white flash core.
 */
export function spawnLysisBurst(particles, random, x, y, colour, count) {
  for (let i = 0; i < count; i += 1) {
    const p = freeSlot(particles);
    if (!p) return;
    const a = random() * Math.PI * 2;
    const v = 40 + random() * 160;
    p.active = true; p.x = x; p.y = y;
    p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v;
    p.life = 0.7 + random() * 0.5; p.maxLife = p.life;
    p.size = 5 + random() * 7; p.colour = colour; p.vesicle = true;
  }
  const flash = freeSlot(particles);
  if (flash) {
    flash.active = true; flash.x = x; flash.y = y; flash.vx = 0; flash.vy = 0;
    flash.life = 0.18; flash.maxLife = 0.18; flash.size = 26; flash.colour = '#ffffff'; flash.vesicle = true;
  }
}

/** One gold spark for a magnetized nutrient's trail (called as the shard flies). */
export function spawnTrailSpark(particles, x, y, colour) {
  const p = freeSlot(particles);
  if (!p) return;
  p.active = true; p.x = x; p.y = y;
  p.vx = 0; p.vy = -12;
  p.life = 0.3; p.maxLife = 0.3;
  p.size = 3; p.colour = colour; p.vesicle = false;
}

/** Febrile heat: two embers rising from the bottom of the vessel (fever pulse). */
export function spawnHeatRise(particles, random) {
  for (let i = 0; i < 2; i += 1) {
    const p = freeSlot(particles);
    if (!p) return;
    p.active = true;
    p.x = random() * 1280;
    p.y = 700 + random() * 20;
    p.vx = (random() - 0.5) * 20;
    p.vy = -50 - random() * 40;
    p.life = 0.9 + random() * 0.4; p.maxLife = p.life;
    p.size = 3 + random() * 3;
    p.colour = random() < 0.5 ? '#ff8a5c' : '#ff5c5c';
    p.vesicle = false;
  }
}

/**
 * Chromatic shockwave: three expanding rings (crimson / teal / gold, slightly
 * offset radii) for the big moments — Fibrin Triangle Burst, Marrow
 * Offering, boss death. The renderer strokes them as rings; updateParticles
 * just ages them (they do not drift).
 */
export function spawnShockwave(particles, random, x, y, maxRadius) {
  const rings = [
    { colour: '#ff2e4d', r: maxRadius },
    { colour: '#2fd4c0', r: maxRadius * 0.92 },
    { colour: '#ffd166', r: maxRadius * 0.84 },
  ];
  for (const ring of rings) {
    const p = freeSlot(particles);
    if (!p) return;
    p.active = true; p.x = x; p.y = y;
    p.vx = 0; p.vy = 0;
    p.life = 0.55 + random() * 0.15; p.maxLife = p.life;
    p.size = 4; p.colour = ring.colour; p.vesicle = false;
    p.ring = true; p.maxR = ring.r;
  }
}

/** A floating damage number; crits are bigger and gold. */
export function spawnDamageNumber(numbers, x, y, text, colour, crit) {
  const n = freeSlot(numbers);
  if (!n) return;
  n.active = true; n.x = x; n.y = y; n.text = text; n.colour = colour;
  n.life = 0.8; n.maxLife = 0.8; n.crit = !!crit;
}

/** Advance all particles one step (drift + drag + fade). */
export function updateParticles(particles, dt) {
  for (let i = 0; i < particles.length; i += 1) {
    const pt = particles[i];
    if (!pt.active) continue;
    pt.life -= dt;
    if (pt.life <= 0) { pt.active = false; continue; }
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.96;
    pt.vy *= 0.96;
  }
}

/** Advance all floating numbers one step (rise + fade). */
export function updateDamageNumbers(numbers, dt) {
  for (let i = 0; i < numbers.length; i += 1) {
    const n = numbers[i];
    if (!n.active) continue;
    n.life -= dt;
    if (n.life <= 0) { n.active = false; continue; }
    n.y -= 42 * dt;
  }
}
