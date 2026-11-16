// CYTOGUARD v2 — Volumetric cells, Fresnel rim-light & plasma caustics
// (render/volumetric-cells.js). Volumetric Cell Shading: a 24-point
// pulsating amoeboid membrane, transparent cytoplasm with orbiting
// mitochondria organelles, a multi-lobed glowing nucleus, and a `lighter`
// rim-glow so the hero pops at thumbnail size. Plasma caustics are a
// background-only layer at 20% brightness — the frame stays alive while
// contrast stays 100% on hero, laser and HUD.
export const CAUSTIC_BRIGHTNESS = 0.2;

/** 24-point amoeboid membrane path; returns nothing, draws into g. */
export function drawVolumetricCell(g, x, y, radius, time, rimColour, coreColour) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.beginPath();
  for (let i = 0; i <= 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    const wob = 1 + 0.08 * Math.sin(a * 3 + time * 2.1) + 0.04 * Math.sin(a * 5 - time * 1.3);
    const px = x + Math.cos(a) * radius * wob;
    const py = y + Math.sin(a) * radius * wob;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  const grad = g.createRadialGradient(x, y, radius * 0.2, x, y, radius * 1.25);
  grad.addColorStop(0, coreColour);
  grad.addColorStop(0.7, rimColour);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fill();
  g.restore();
  // Multi-lobed glowing nucleus.
  g.save();
  g.fillStyle = coreColour;
  g.globalAlpha = 0.85;
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + time * 0.4;
    g.beginPath();
    g.arc(x + Math.cos(a) * radius * 0.22, y + Math.sin(a) * radius * 0.22, radius * 0.22, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Rotating bioluminescent double helix, glowing in the nutrient colours. */
export function drawDnaHelix(g, cx, cy, size, time, colours) {
  g.save();
  g.lineWidth = 2;
  for (let s = 0; s < 2; s += 1) {
    g.strokeStyle = colours[s % colours.length];
    g.globalAlpha = 0.9;
    g.beginPath();
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      const y = cy - size / 2 + t * size;
      const x = cx + Math.sin(t * Math.PI * 2.4 + time * 0.9 + s * Math.PI) * size * 0.22;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 0.5;
  g.strokeStyle = '#e8fff9';
  for (let i = 0; i < 6; i += 1) {
    const t = i / 5;
    const y = cy - size / 2 + t * size;
    const x1 = cx + Math.sin(t * Math.PI * 2.4 + time * 0.9) * size * 0.22;
    const x2 = cx + Math.sin(t * Math.PI * 2.4 + time * 0.9 + Math.PI) * size * 0.22;
    g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke();
  }
  g.restore();
}

/** Plasma caustics: soft subsurface light refraction, background only. */
export function drawPlasmaCaustics(g, w, h, time) {
  g.save();
  g.globalAlpha = CAUSTIC_BRIGHTNESS;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i += 1) {
    const cx = w * (0.15 + 0.175 * i) + Math.sin(time * 0.23 + i * 1.7) * 40;
    const cy = h * 0.5 + Math.cos(time * 0.31 + i * 2.3) * 60;
    const r = 120 + 60 * Math.sin(time * 0.17 + i);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(0, 245, 212, 0.25)');
    grad.addColorStop(1, 'rgba(0, 245, 212, 0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** Apex Sovereign Morph adornments: cilia wings + orbiting DNA ring. */
export function drawMorphAura(g, x, y, radius, time) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = '#00f5d4'; g.lineWidth = 2; g.globalAlpha = 0.8;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + time * 0.6;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    g.lineTo(x + Math.cos(a) * (radius + 16 + 6 * Math.sin(time * 3 + i)), y + Math.sin(a) * (radius + 16 + 6 * Math.sin(time * 3 + i)));
    g.stroke();
  }
  g.strokeStyle = '#ffd166';
  g.beginPath();
  g.arc(x, y, radius + 26, time * 0.8, time * 0.8 + Math.PI * 1.5);
  g.stroke();
  g.restore();
}
