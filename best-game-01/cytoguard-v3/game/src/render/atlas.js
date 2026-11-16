// render/atlas.js — pre-rendered volumetric HD sprite atlas (V3, Operation 95%).
// initAtlas() renders each entity ONCE to a 256x256 offscreen canvas with
// layered multi-stop radial gradients, subsurface scattering glow and
// specular Fresnel rim-lights. NO thin vector lines, NO plain boxes — the
// atlas sprites are the rich 2.5D base the live procedural layers animate
// on top of. All sprites are pure functions of geometry (deterministic);
// initAtlas() is called once at renderer boot from createRenderer.
// Top level is DOM-free (document only inside initAtlas) so Node imports
// still work for the dossier builder.
const TAU = Math.PI * 2;

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  return c;
}

// Fresnel rim: a bright crescent on the light side plus a soft halo —
// the specular edge that makes a volume read as 3D instead of flat.
function drawFresnelRim(g, cx, cy, r, colour, arcFrom, arcTo) {
  g.save();
  g.strokeStyle = colour;
  g.lineCap = 'round';
  g.lineWidth = 5;
  g.shadowColor = colour;
  g.shadowBlur = 18;
  g.beginPath(); g.arc(cx, cy, r, arcFrom, arcTo); g.stroke();
  g.lineWidth = 2;
  g.shadowBlur = 8;
  g.beginPath(); g.arc(cx, cy, r, arcFrom, arcTo); g.stroke();
  g.restore();
}

function drawHeroAtlas(c) {
  const g = c.getContext('2d');
  const cx = 128; const cy = 128;
  // Subsurface glow: a wide warm halo behind the membrane.
  let glow = g.createRadialGradient(cx, cy, 10, cx, cy, 128);
  glow.addColorStop(0, 'rgba(255, 200, 90, 0.38)');
  glow.addColorStop(0.5, 'rgba(255, 170, 60, 0.14)');
  glow.addColorStop(1, 'rgba(255, 170, 60, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  // Bioluminescent cilia wings: long soft spikes around the rim.
  g.save();
  g.translate(cx, cy);
  for (let i = 0; i < 26; i += 1) {
    const a = (i / 26) * TAU;
    const len = 96 + (i % 3) * 10;
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, 'rgba(255, 210, 110, 0.55)');
    grad.addColorStop(1, 'rgba(255, 210, 110, 0)');
    g.strokeStyle = grad;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(Math.cos(a) * 78, Math.sin(a) * 78);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
  }
  g.restore();
  // Layered transparent plasma membrane: 3 shells, outer faint, inner bright.
  const shell = (r, a0, a1) => {
    const rg = g.createRadialGradient(cx, cy, r * 0.4, cx, cy, r);
    rg.addColorStop(0, `rgba(255, 240, 200, ${a0})`);
    rg.addColorStop(0.75, `rgba(255, 200, 110, ${a1})`);
    rg.addColorStop(1, 'rgba(255, 190, 90, 0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  };
  shell(112, 0.10, 0.16);
  shell(96, 0.16, 0.26);
  shell(82, 0.30, 0.42);
  // Glowing gold-cyan multi-lobe nucleus (3 lobes).
  const lobe = (ox, oy, r, c0, c1) => {
    const rg = g.createRadialGradient(cx + ox, cy + oy, r * 0.1, cx + ox, cy + oy, r);
    rg.addColorStop(0, c0);
    rg.addColorStop(1, c1);
    g.fillStyle = rg;
    g.beginPath(); g.arc(cx + ox, cy + oy, r, 0, TAU); g.fill();
  };
  lobe(-18, -8, 30, 'rgba(255, 235, 170, 0.95)', 'rgba(255, 170, 60, 0.75)');
  lobe(20, -10, 26, 'rgba(120, 240, 225, 0.95)', 'rgba(47, 212, 192, 0.75)');
  lobe(0, 22, 28, 'rgba(255, 250, 220, 0.95)', 'rgba(255, 190, 90, 0.75)');
  // Orbiting organelles: small gold/cyan granules on tilted orbits.
  g.save();
  g.translate(cx, cy);
  for (let i = 0; i < 10; i += 1) {
    const a = i * 0.628 + 0.4;
    const rx = 58 + (i % 3) * 8;
    const x = Math.cos(a) * rx; const y = Math.sin(a) * rx * 0.62;
    const rg = g.createRadialGradient(x, y, 0.5, x, y, 5);
    rg.addColorStop(0, i % 2 ? 'rgba(255, 240, 190, 0.95)' : 'rgba(150, 245, 230, 0.95)');
    rg.addColorStop(1, 'rgba(255, 190, 90, 0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill();
  }
  g.restore();
  drawFresnelRim(g, cx, cy, 82, 'rgba(255, 235, 180, 0.9)', -2.4, 0.9);
  return c;
}

function drawBossAtlas(c) {
  const g = c.getContext('2d');
  const cx = 128; const cy = 128;
  // Deep purple-magenta ambient glow.
  let glow = g.createRadialGradient(cx, cy, 10, cx, cy, 128);
  glow.addColorStop(0, 'rgba(190, 90, 255, 0.42)');
  glow.addColorStop(0.55, 'rgba(150, 60, 220, 0.16)');
  glow.addColorStop(1, 'rgba(150, 60, 220, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  // Gradient tentacles: 8 thick sine-struck arms radiating outward.
  g.save();
  g.translate(cx, cy);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU + 0.2;
    const len = 108;
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, 'rgba(200, 100, 255, 0.85)');
    grad.addColorStop(1, 'rgba(120, 40, 190, 0.05)');
    g.strokeStyle = grad;
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(Math.cos(a) * 52, Math.sin(a) * 52);
    const mx = Math.cos(a + 0.35) * 84;
    const my = Math.sin(a + 0.35) * 84;
    g.quadraticCurveTo(mx, my, Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
  }
  g.restore();
  // Layered 3D purple-magenta crystal core: 3 concentric shells.
  const shell = (r, c0, c1) => {
    const rg = g.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    rg.addColorStop(0, c0);
    rg.addColorStop(0.7, c1);
    rg.addColorStop(1, 'rgba(120, 40, 190, 0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
  };
  shell(96, 'rgba(230, 160, 255, 0.5)', 'rgba(150, 60, 220, 0.35)');
  shell(78, 'rgba(240, 190, 255, 0.65)', 'rgba(170, 80, 235, 0.45)');
  shell(58, 'rgba(255, 230, 255, 0.9)', 'rgba(200, 110, 255, 0.6)');
  // Hexagonal crystal armor segments (3 facets) + inner crystal core.
  const hex = (r, rot, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = rot + (i / 6) * TAU;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
  };
  hex(66, 0, 'rgba(140, 60, 200, 0.35)');
  hex(46, 0.5, 'rgba(190, 110, 255, 0.5)');
  hex(30, 0.25, 'rgba(255, 240, 255, 0.95)');
  // Facet lines on the armor.
  g.strokeStyle = 'rgba(255, 220, 255, 0.5)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * TAU;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46);
    g.stroke();
  }
  drawFresnelRim(g, cx, cy, 66, 'rgba(240, 200, 255, 0.85)', -2.2, 1.1);
  return c;
}

function drawValveAtlas(c) {
  const g = c.getContext('2d');
  const cx = 128; const cy = 128;
  // Wide teal-gold energy halo behind the portal.
  let glow = g.createRadialGradient(cx, cy, 10, cx, cy, 128);
  glow.addColorStop(0, 'rgba(47, 212, 192, 0.35)');
  glow.addColorStop(0.5, 'rgba(255, 200, 90, 0.14)');
  glow.addColorStop(1, 'rgba(47, 212, 192, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 256, 256);
  // Glowing 3D energy portal ring: outer teal shell, inner gold shell.
  const ring = (r0, r1, c0, c1) => {
    const rg = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
    rg.addColorStop(0, c0);
    rg.addColorStop(0.5, c1);
    rg.addColorStop(1, 'rgba(47, 212, 192, 0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(cx, cy, r1, 0, TAU); g.fill();
  };
  ring(88, 108, 'rgba(47, 212, 192, 0.10)', 'rgba(47, 212, 192, 0.55)');
  ring(68, 88, 'rgba(255, 210, 110, 0.12)', 'rgba(255, 200, 90, 0.5)');
  // Energy fill: soft radial plasma inside the portal.
  const fill = g.createRadialGradient(cx, cy, 2, cx, cy, 68);
  fill.addColorStop(0, 'rgba(120, 240, 225, 0.30)');
  fill.addColorStop(0.7, 'rgba(47, 212, 192, 0.14)');
  fill.addColorStop(1, 'rgba(47, 212, 192, 0.02)');
  g.fillStyle = fill;
  g.beginPath(); g.arc(cx, cy, 68, 0, TAU); g.fill();
  // Curving blood-flow particle streams: dots spiralling along the ring.
  for (let i = 0; i < 22; i += 1) {
    const a = (i / 22) * TAU * 2 + (i % 2) * 0.4;
    const r = 78 + ((i * 7) % 26);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.9;
    const rg = g.createRadialGradient(x, y, 0.5, x, y, 4);
    rg.addColorStop(0, i % 2 ? 'rgba(255, 220, 140, 0.95)' : 'rgba(120, 245, 230, 0.95)');
    rg.addColorStop(1, 'rgba(47, 212, 192, 0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill();
  }
  drawFresnelRim(g, cx, cy, 100, 'rgba(150, 245, 230, 0.9)', -2.6, 0.7);
  return c;
}

/** Pre-render the 256x256 HD sprite atlas once. Call at renderer boot. */
export function initAtlas() {
  return {
    hero: drawHeroAtlas(makeCanvas()),
    boss: drawBossAtlas(makeCanvas()),
    valve: drawValveAtlas(makeCanvas()),
  };
}

/** Draw an atlas sprite centered at (x, y) with the given pixel size
 * (width = height = size) and optional rotation. */
export function drawAtlasSprite(g, sprite, x, y, size, rotation) {
  if (!sprite) return;
  g.save();
  g.translate(x, y);
  if (rotation) g.rotate(rotation);
  g.drawImage(sprite, -size / 2, -size / 2, size, size);
  g.restore();
}
