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

/** Additive bioluminescent laser beam (V3): glow pass, mid pass, white
 * core. Call with globalCompositeOperation already set to 'lighter'. */
export function drawLaserBeam(g, x0, y0, x1, y1, colour, coreColour) {
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = colour;
  g.globalAlpha = 0.28; g.lineWidth = 15;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.globalAlpha = 0.75; g.lineWidth = 6;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.strokeStyle = coreColour || '#ffffff';
  g.globalAlpha = 1; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.restore();
}

/** Cyan Fibrin Thread Triangle web (V3): transparent energy-web fill,
 * inner triangle, expanding circular shockwaves, hot centroid glow.
 * Call with globalCompositeOperation already set to 'lighter'. */
export function drawFibrinWeb(g, tri, time) {
  if (!tri || tri.length < 3) return;
  const [a, b, c] = tri;
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  g.save();
  // Transparent energy-web fill.
  g.fillStyle = 'rgba(47, 212, 192, 0.10)';
  g.beginPath();
  g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y);
  g.closePath(); g.fill();
  // Inner triangle (half scale toward centroid).
  g.strokeStyle = 'rgba(47, 212, 192, 0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx + (a.x - cx) * 0.5, cy + (a.y - cy) * 0.5);
  g.lineTo(cx + (b.x - cx) * 0.5, cy + (b.y - cy) * 0.5);
  g.lineTo(cx + (c.x - cx) * 0.5, cy + (c.y - cy) * 0.5);
  g.closePath(); g.stroke();
  // Web spokes: centroid to each vertex.
  g.strokeStyle = 'rgba(120, 245, 230, 0.35)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(cx, cy); g.lineTo(a.x, a.y);
  g.moveTo(cx, cy); g.lineTo(b.x, b.y);
  g.moveTo(cx, cy); g.lineTo(c.x, c.y);
  g.stroke();
  // Two expanding circular shockwaves from the centroid.
  const pulse = (time * 0.8) % 1;
  for (let i = 0; i < 2; i += 1) {
    const p = (pulse + i * 0.5) % 1;
    const r = 20 + p * 130;
    g.strokeStyle = `rgba(47, 212, 192, ${0.55 * (1 - p)})`;
    g.lineWidth = 3 * (1 - p) + 1;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  }
  // Hot centroid glow.
  const glow = g.createRadialGradient(cx, cy, 2, cx, cy, 34);
  glow.addColorStop(0, 'rgba(220, 255, 250, 0.9)');
  glow.addColorStop(0.5, 'rgba(47, 212, 192, 0.35)');
  glow.addColorStop(1, 'rgba(47, 212, 192, 0)');
  g.fillStyle = glow;
  g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** Ribbon motion trail (V3): a tapered 'lighter' arc hugging the hero's
 * orbit around the organ core — a pure function of world state
 * (hero pos, core pos, world.time), so it stays deterministic. */
export function drawRibbonTrail(g, world) {
  const p = world.player;
  const core = world.organCore || { x: 640, y: 360 };
  if (!p || !p.active) return;
  const dx = p.x - core.x;
  const dy = p.y - core.y;
  const r = Math.hypot(dx, dy);
  if (r < 20) return;
  const a0 = Math.atan2(dy, dx);
  g.save();
  g.globalCompositeOperation = 'lighter';
  const passes = [
    { w: 11, a: 0.10, col: '255, 200, 90' },
    { w: 5, a: 0.22, col: '255, 215, 130' },
    { w: 2, a: 0.5, col: '255, 255, 255' },
  ];
  for (const pass of passes) {
    g.strokeStyle = `rgba(${pass.col}, ${pass.a})`;
    g.lineWidth = pass.w;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(core.x, core.y, r, a0 - 0.85, a0 - 0.05);
    g.stroke();
  }
  g.restore();
}

/** DNA Helix Shockwave (V3): a double-helix ring of golden sparks plus a
 * wide shockwave — the Tri-Cell Resonance harvest burst. */
export function spawnHelixShockwave(particles, random, x, y) {
  for (let i = 0; i < 24; i += 1) {
    const n = freeSlot(particles);
    if (!n) break;
    const a = (i / 24) * Math.PI * 2;
    const strand = i % 2 === 0 ? 1 : -1;
    const r = 26 + ((i * 13) % 34);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r * 0.42 + strand * Math.sin(a * 3) * 10;
    const spd = 60 + random() * 120;
    n.active = true;
    n.x = px; n.y = py;
    n.vx = Math.cos(a) * spd; n.vy = Math.sin(a) * spd * 0.5;
    n.life = 0.7 + random() * 0.4; n.maxLife = 1.1;
    n.size = 3 + random() * 3;
    n.colour = i % 3 === 0 ? '#ffffff' : '#ffd166';
  }
  spawnShockwave(particles, random, x, y, 210);
}
