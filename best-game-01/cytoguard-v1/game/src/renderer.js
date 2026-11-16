// CYTOGUARD renderer: confocal-microscopy & SEM visual language, drawn 100%
// procedurally — no images, no assets, no network. Five standards:
//  1. Immune cell anatomy — a dynamic amoeboid plasma membrane (24 harmonic
//     sine-wave contour points that morph with the WASD direction), a glowing
//     multi-lobed polymorphonuclear nucleus in the active polarity colour,
//     orbiting mitochondria organelles, fine pseudopodia / cilia at the edge.
//  2. Accurate pathogen morphology — segmented rod Bacillus with a waving
//     flagella tail; icosahedral Bacteriophage head with 6 tail fibers that
//     STRETCH during the attack telegraph; jagged black-purple Microplastic
//     shard with a synthetic edge glint; pulsing dendritic-star Platelet Nodes
//     that emit glowing fibrin filaments when linked; Boss Miasma Prime with a
//     layered capsid, 2 sine-chain tentacles and a pulsing toxin core.
//  3. Vascular space depth — endothelial vessel walls & alveoli tissue baked
//     to an offscreen canvas at init (rebuilt per zone), plus large dim
//     biconcave-disc erythrocytes drifting slowly behind the action (parallax).
//  4. Bioluminescent rim-lighting & cell lysis FX — radial gradients +
//     'lighter' for fluorescence rim-glow on membrane edges, Perforin lasers,
//     Silica Prism refraction and the Oxidative Burst triangle explosion;
//     death = cell lysis (membrane bursting into glowing vesicle particles)
//     + white hit-flash + bold floating damage numbers.
//  5. 60 FPS & crystal readability — complex shapes cached to an offscreen
//     sprite cache; high-contrast HUD panels and buttons over the dark
//     vascular field; screenshots render at 1024x640 JPEG.

import { CONFIG } from './config.js';
import { createRandom } from './random.js';
import { BIOMES } from './biomes.js';
import { bossTentacles } from './boss.js';
import { EVOLUTIONS } from './synergies.js';
import { drugDef } from './oncology.js';
import { WEAPON_DEFS } from './weapons.js';
import { RARITY_COLOURS } from './upgrades.js';
import { VICTORY_NARRATIVE, DEFEAT_NARRATIVE } from './lore.js';
import { drawHud, SFX_BUTTON } from './hud.js';

const TAU = Math.PI * 2;
export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_UPGRADE = 'upgrade';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';
export const SCREEN_PAUSE = 'pause';

export const TITLE_DEPLOY = { x: 490, y: 560, w: 300, h: 64 };
export const TITLE_CLASS_RECTS = [
  { x: 280, y: 380, w: 220, h: 150 },
  { x: 530, y: 380, w: 220, h: 150 },
  { x: 780, y: 380, w: 220, h: 150 },
];
export const UPGRADE_CARD_RECTS = [
  { x: 190, y: 190, w: 270, h: 300 },
  { x: 505, y: 190, w: 270, h: 300 },
  { x: 820, y: 190, w: 270, h: 300 },
];
export const UPGRADE_SKIP = { x: 540, y: 520, w: 200, h: 52 };
export const OVER_RETRY = { x: 440, y: 480, w: 200, h: 60 };
export const OVER_CHANGE = { x: 660, y: 480, w: 200, h: 60 };
export const WIN_AGAIN = { x: 440, y: 500, w: 200, h: 60 };
export const WIN_CHANGE = { x: 660, y: 500, w: 200, h: 60 };

const POLARITY_COLOUR = { bio: '#ffd166', toxin: '#c77dff' };
const POLARITY_GLOW = { bio: 'rgba(255, 209, 102, 0.55)', toxin: 'rgba(199, 125, 255, 0.55)' };

function inRect(x, y, r) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function createRenderer(canvas) {
  // Backing resolution: the fixed 1280x720 logical field. CSS scales it to
  // the window; without this the bitmap stays 300x150 and every screenshot
  // comes out a blurry 5 KiB smear.
  canvas.width = CONFIG.FIELD.W;
  canvas.height = CONFIG.FIELD.H;
  const ctx = canvas.getContext('2d');
  const W = CONFIG.FIELD.W;
  const H = CONFIG.FIELD.H;
  const bgRandom = createRandom(424242);
  // --- Offscreen background: vessel walls + alveoli tissue (rebuilt per zone) ---
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = W; bgCanvas.height = H;
  let bgBiome = '';
  function buildBackground(biomeId) {
    const b = BIOMES[biomeId];
    const g = bgCanvas.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, b.plasmaTop);
    grad.addColorStop(0.55, b.plasmaMid);
    grad.addColorStop(1, b.plasmaBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // Endothelial vessel walls: dark tissue bands along the top and bottom.
    g.fillStyle = b.tissueDark;
    g.beginPath();
    g.moveTo(0, 0);
    for (let x = 0; x <= W; x += 80) g.lineTo(x, 26 + Math.sin(x * 0.008) * 14);
    g.lineTo(W, 0);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 80) g.lineTo(x, H - 26 - Math.sin(x * 0.009 + 2) * 14);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    // Alveoli tissue: soft translucent bubbles drifting in the plasma.
    for (let i = 0; i < 26; i += 1) {
      const x = bgRandom() * W;
      const y = bgRandom() * H;
      const r = 18 + bgRandom() * 46;
      const rg = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      rg.addColorStop(0, 'rgba(255, 200, 190, 0.05)');
      rg.addColorStop(1, 'rgba(255, 200, 190, 0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    // Tissue speckle: fine darker grains for the SEM texture.
    g.fillStyle = 'rgba(0, 0, 0, 0.10)';
    for (let i = 0; i < 420; i += 1) {
      g.fillRect(bgRandom() * W, bgRandom() * H, 2, 2);
    }
    bgBiome = biomeId;
  }
  buildBackground('capillary');

  // --- Erythrocytes: TWO parallax layers of biconcave discs (3D depth) ---
  // Far layer: larger, darker, slower, no dimple (reads as out-of-focus).
  // Near layer: smaller, brighter, faster, full biconcave detail.
  const eryFar = [];
  const eryNear = [];
  const eryRandom = createRandom(777);
  for (let i = 0; i < 10; i += 1) {
    eryFar.push({
      x: eryRandom() * W, y: eryRandom() * H,
      r: 44 + eryRandom() * 34, vx: 4 + eryRandom() * 6,
      bobPhase: eryRandom() * TAU, alpha: 0.04 + eryRandom() * 0.04,
      depth: 0.25 + eryRandom() * 0.2,
    });
  }
  for (let i = 0; i < 8; i += 1) {
    eryNear.push({
      x: eryRandom() * W, y: eryRandom() * H,
      r: 28 + eryRandom() * 22, vx: 9 + eryRandom() * 12,
      bobPhase: eryRandom() * TAU, alpha: 0.10 + eryRandom() * 0.08,
      depth: 0.7 + eryRandom() * 0.3,
    });
  }
  // Floating plasma particles: tiny drifting motes for deep 3D volume.
  const plasmaDots = [];
  const plasmaRandom = createRandom(4242);
  for (let i = 0; i < 36; i += 1) {
    plasmaDots.push({
      x: plasmaRandom() * W, y: plasmaRandom() * H,
      r: 1 + plasmaRandom() * 2, vx: 3 + plasmaRandom() * 9,
      alpha: 0.12 + plasmaRandom() * 0.25, phase: plasmaRandom() * TAU,
    });
  }
  function drawErythrocyte(g, e, time, far) {
    const y = e.y + Math.sin(time * 0.4 + e.bobPhase) * 8;
    const rg = g.createRadialGradient(e.x, y, e.r * 0.15, e.x, y, e.r);
    rg.addColorStop(0, `rgba(190, 60, 70, ${e.alpha * 0.45})`);
    rg.addColorStop(0.55, `rgba(160, 40, 55, ${e.alpha})`);
    rg.addColorStop(0.85, `rgba(120, 25, 40, ${e.alpha * 0.8})`);
    rg.addColorStop(1, 'rgba(120, 25, 40, 0)');
    g.fillStyle = rg;
    g.beginPath(); g.ellipse(e.x, y, e.r, e.r * 0.72, 0, 0, TAU); g.fill();
    // Biconcave dimple: a darker centre (near layer only — far reads blurred).
    if (!far) {
      g.fillStyle = `rgba(90, 15, 28, ${e.alpha * 0.9})`;
      g.beginPath(); g.ellipse(e.x, y, e.r * 0.42, e.r * 0.28, 0, 0, TAU); g.fill();
    }
  }

  /**
   * Living endothelial vessel walls: organic tissue-fiber bands along the top
   * and bottom arena edges, pulsing gently with the heartbeat — calm
   * Teal-Gold in HOMEOSTASIS, pulsing Crimson-Coral in FEBRILE CRISIS.
   * Drawn live (not baked) so the pulse and the physiology colour breathe.
   */
  function drawVesselWalls(g, time, febrile) {
    const bpm = febrile ? 140 : 72;
    const beat = 0.55 + 0.45 * Math.sin(time * (bpm * Math.PI / 30));
    const fill = febrile ? `rgba(255, 46, 77, ${0.10 + 0.06 * beat})` : `rgba(47, 212, 192, ${0.08 + 0.05 * beat})`;
    const fiber = febrile ? `rgba(255, 90, 110, ${0.30 + 0.25 * beat})` : `rgba(47, 212, 192, ${0.28 + 0.22 * beat})`;
    const rim = febrile ? 'rgba(255, 120, 140, 0.55)' : 'rgba(255, 209, 102, 0.5)';
    for (const top of [true, false]) {
      const base = top ? 0 : H;
      const dir = top ? 1 : -1;
      // Tissue band: wavy organic edge.
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(0, base);
      g.lineTo(W, base);
      for (let x = W; x >= 0; x -= 64) {
        g.lineTo(x, base + dir * (30 + Math.sin(x * 0.008 + (top ? 0 : 2)) * 12 + beat * 4));
      }
      g.closePath();
      g.fill();
      // Tissue fibers: wavy strands running along the band.
      g.strokeStyle = fiber;
      g.lineWidth = 1.5;
      for (let f = 0; f < 4; f += 1) {
        const off = 8 + f * 8;
        g.beginPath();
        for (let x = 0; x <= W; x += 32) {
          const y = base + dir * (off + Math.sin(x * 0.01 + f * 1.7 + (top ? 0 : 1)) * 5);
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      // Bright rim on the inner edge (the wall's living lip).
      g.strokeStyle = rim;
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= W; x += 32) {
        const y = base + dir * (30 + Math.sin(x * 0.008 + (top ? 0 : 2)) * 12 + beat * 4);
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  // --- Sprite cache: complex static shapes baked once, drawn cheaply ---
  const spriteCache = new Map();
  function getSprite(key, w, h, drawFn) {
    let c = spriteCache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.translate(w / 2, h / 2);
      drawFn(g);
      spriteCache.set(key, c);
    }
    return c;
  }
  function drawSprite(g, key, x, y, w, h, angle, drawFn) {
    const c = getSprite(key, 128, 128, drawFn);
    g.save();
    g.translate(x, y);
    if (angle) g.rotate(angle);
    g.drawImage(c, -w / 2, -h / 2, w, h);
    g.restore();
  }

  // Bacillus body sprite: segmented rod capsule (flagella drawn live, animated).
  function bacillusSprite(g, polarity) {
    const col = POLARITY_COLOUR[polarity];
    const grad = g.createLinearGradient(-34, 0, 34, 0);
    grad.addColorStop(0, '#7a9a2e');
    grad.addColorStop(0.5, '#b8d94a');
    grad.addColorStop(1, '#7a9a2e');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(-34, -13, 68, 26, 13);
    g.fill();
    // Segmentation: 4 capsule rings across the rod.
    g.strokeStyle = 'rgba(40, 60, 10, 0.65)';
    g.lineWidth = 2;
    for (let i = -2; i <= 2; i += 1) {
      g.beginPath();
      g.moveTo(i * 13, -12);
      g.quadraticCurveTo(i * 13 + 4, 0, i * 13, 12);
      g.stroke();
    }
    // Polarity rim: a glowing dot pair marking the antigen colour.
    g.fillStyle = col;
    g.beginPath(); g.arc(-22, 0, 4, 0, TAU); g.fill();
    g.beginPath(); g.arc(22, 0, 4, 0, TAU); g.fill();
  }
  // Bacteriophage head sprite: sharp icosahedral crystal (fibers drawn live).
  function phageSprite(g, polarity) {
    const col = POLARITY_COLOUR[polarity];
    g.fillStyle = '#8e6fd8';
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const px = Math.cos(a) * 26;
      const py = Math.sin(a) * 26;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.stroke();
    // Inner facets: crystal cross-lines.
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-26, 0); g.lineTo(26, 0); g.stroke();
    g.beginPath(); g.moveTo(0, -26); g.lineTo(0, 26); g.stroke();
    g.fillStyle = col;
    g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
  }
  // Microplastic sprite: sharp asymmetric jagged polygon, black-purple metallic.
  function plasticSprite(g) {
    const pts = [[-26, -8], [-10, -26], [8, -20], [28, -12], [20, 8], [26, 22], [2, 26], [-18, 16]];
    const grad = g.createLinearGradient(-26, -26, 26, 26);
    grad.addColorStop(0, '#3a1a5e');
    grad.addColorStop(0.5, '#14082a');
    grad.addColorStop(1, '#5e2a8e');
    g.fillStyle = grad;
    g.beginPath();
    pts.forEach(([x, y], i) => { if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
    g.closePath();
    g.fill();
    g.strokeStyle = '#c77dff';
    g.lineWidth = 1.5;
    g.stroke();
    // Synthetic edge glint: a bright diagonal facet line.
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-10, -26); g.lineTo(20, 8); g.stroke();
  }
  // Leaper sprite: spiky spore ball.
  function leaperSprite(g) {
    g.fillStyle = '#d94a6a';
    g.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU;
      const r1 = 20;
      const r2 = 12;
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.lineTo(Math.cos(a + TAU / 16) * r2, Math.sin(a + TAU / 16) * r2);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#ff8fa3';
    g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();
  }
  // Warder sprite: biofilm blob with shield ring.
  function warderSprite(g) {
    const grad = g.createRadialGradient(0, 0, 4, 0, 0, 30);
    grad.addColorStop(0, '#7fd4ff');
    grad.addColorStop(1, '#2f6fd6');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, 28, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(127, 212, 255, 0.9)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 34, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(-8, -8, 5, 0, TAU); g.fill();
  }
  // Silica prism sprite: rotating crystal.
  function prismSprite(g) {
    const grad = g.createLinearGradient(-24, -24, 24, 24);
    grad.addColorStop(0, 'rgba(127, 212, 255, 0.9)');
    grad.addColorStop(0.5, 'rgba(47, 111, 214, 0.75)');
    grad.addColorStop(1, 'rgba(127, 212, 255, 0.9)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      const px = Math.cos(a) * 26;
      const py = Math.sin(a) * 26;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.stroke();
  }

  // --- Player cell: dynamic amoeboid membrane (24 harmonic contour points) ---
  function drawPlayerCell(g, world) {
    const p = world.player;
    const time = world.time;
    const R = p.radius + 6;
    const col = POLARITY_COLOUR[p.polarity];
    const glow = POLARITY_GLOW[p.polarity];
    // Polarity aura: soft radial glow under the cell (additive).
    g.save();
    g.globalCompositeOperation = 'lighter';
    const aura = g.createRadialGradient(p.x, p.y, R * 0.4, p.x, p.y, R * 2.4);
    aura.addColorStop(0, glow);
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = aura;
    g.beginPath(); g.arc(p.x, p.y, R * 2.4, 0, TAU); g.fill();
    g.restore();
    // Amoeboid contour: 24 points, harmonic morphing + stretch along movement.
    const pts = [];
    const stretch = 0.14 * Math.min(1, p.moveSpeed);
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * TAU;
      let r = R * (1 + 0.16 * Math.sin(3 * a + time * 3 + p.moveAngle) + 0.09 * Math.sin(5 * a - time * 2.1));
      r *= 1 + stretch * Math.cos(a - p.moveAngle);
      pts.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r]);
    }
    g.save();
    g.beginPath();
    g.moveTo((pts[0][0] + pts[23][0]) / 2, (pts[0][1] + pts[23][1]) / 2);
    for (let i = 0; i < 24; i += 1) {
      const cur = pts[i];
      const nxt = pts[(i + 1) % 24];
      g.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2);
    }
    g.closePath();
    const cyto = g.createRadialGradient(p.x, p.y, R * 0.2, p.x, p.y, R * 1.15);
    cyto.addColorStop(0, 'rgba(255, 240, 210, 0.85)');
    cyto.addColorStop(0.6, 'rgba(255, 220, 170, 0.45)');
    cyto.addColorStop(1, 'rgba(255, 210, 160, 0.18)');
    g.fillStyle = cyto;
    g.fill();
    // Volumetric inner shadow: the cytoplasm is deeper on the far side
    // (light comes from the upper-left), so the cell reads as a 3D volume.
    g.save();
    g.clip();
    const shade = g.createRadialGradient(
      p.x + R * 0.45, p.y + R * 0.5, R * 0.2,
      p.x + R * 0.45, p.y + R * 0.5, R * 1.3,
    );
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(20, 4, 16, 0.30)');
    g.fillStyle = shade;
    g.fillRect(p.x - R * 1.4, p.y - R * 1.4, R * 2.8, R * 2.8);
    g.restore();
    // Fluorescence rim-glow on the membrane edge (additive).
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = glow;
    g.lineWidth = 3;
    g.stroke();
    // Fresnel rim highlight: a bright arc on the light-facing side of the
    // membrane (upper-left), fading where the surface turns away — the cell
    // is never drawn flat.
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(p.x, p.y, R * 1.02, -2.5, -0.7);
    g.stroke();
    g.strokeStyle = glow;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p.x, p.y, R * 1.06, -2.5, -0.7);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.stroke();
    // Pseudopodia / cilia: fine hairs at the membrane edge, pulsing.
    g.strokeStyle = 'rgba(255, 230, 190, 0.75)';
    g.lineWidth = 1;
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * TAU + time * 0.6;
      const r0 = R * (1 + 0.12 * Math.sin(3 * a + time * 3));
      const len = 5 + 3 * Math.sin(time * 6 + i * 1.7);
      g.beginPath();
      g.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
      g.lineTo(p.x + Math.cos(a) * (r0 + len), p.y + Math.sin(a) * (r0 + len));
      g.stroke();
    }
    // Multi-lobed polymorphonuclear nucleus: 3 glowing lobes in polarity colour.
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + time * 0.5;
      const nx = p.x + Math.cos(a) * 5;
      const ny = p.y + Math.sin(a) * 5;
      const ng = g.createRadialGradient(nx, ny, 1, nx, ny, 10);
      ng.addColorStop(0, col);
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = ng;
      g.beginPath(); g.arc(nx, ny, 10, 0, TAU); g.fill();
    }
    g.restore();
    g.fillStyle = col;
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * TAU + time * 0.5;
      g.beginPath(); g.arc(p.x + Math.cos(a) * 5, p.y + Math.sin(a) * 5, 5.5, 0, TAU); g.fill();
    }
    // Orbiting mitochondria: small warm organelles circling the nucleus.
    for (let i = 0; i < 5; i += 1) {
      const a = time * 1.4 + (i / 5) * TAU;
      const mx = p.x + Math.cos(a) * (R * 0.62);
      const my = p.y + Math.sin(a) * (R * 0.62);
      g.fillStyle = '#ff9a3c';
      g.beginPath(); g.ellipse(mx, my, 3.4, 2.2, a, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255, 200, 120, 0.8)';
      g.beginPath(); g.arc(mx, my, 1.2, 0, TAU); g.fill();
    }
    // Hit-flash: white flash while invulnerable.
    if (p.invuln > 0 && Math.floor(time * 16) % 2 === 0) {
      g.globalAlpha = 0.35;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(p.x, p.y, R, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // --- Organ Core: layered, wavy-edged, HP-coloured ---
  function drawCore(g, world) {
    const c = world.core;
    const time = world.time;
    const frac = c.hp / c.maxHp;
    const col = frac > 0.5 ? '#ff5c7a' : frac > 0.25 ? '#ff8a3c' : '#ff2e4d';
    // Marrow shield ring.
    if (world.biomeId === 'marrow') {
      g.save();
      g.strokeStyle = 'rgba(181, 55, 242, 0.5)';
      g.lineWidth = 3;
      g.setLineDash([14, 10]);
      g.lineDashOffset = -time * 20;
      g.beginPath(); g.arc(c.x, c.y, 150, 0, TAU); g.stroke();
      g.restore();
    }
    // Outer glow (additive).
    g.save();
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(c.x, c.y, c.radius * 0.4, c.x, c.y, c.radius * 2.2);
    glow.addColorStop(0, 'rgba(255, 92, 122, 0.35)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(c.x, c.y, c.radius * 2.2, 0, TAU); g.fill();
    g.restore();
    // Wavy membrane edge (slow amoeboid breathing).
    g.beginPath();
    for (let i = 0; i <= 24; i += 1) {
      const a = (i / 24) * TAU;
      const r = c.radius * (1 + 0.06 * Math.sin(3 * a + time * 1.2));
      const px = c.x + Math.cos(a) * r;
      const py = c.y + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    const grad = g.createRadialGradient(c.x, c.y, 6, c.x, c.y, c.radius);
    grad.addColorStop(0, '#fff0d8');
    grad.addColorStop(0.6, col);
    grad.addColorStop(1, '#7d1f30');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.stroke();
    // Inner nucleus.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(c.x, c.y, 12 + Math.sin(time * 2) * 2, 0, TAU); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.arc(c.x, c.y, 7, 0, TAU); g.fill();
    // HP text.
    g.fillStyle = '#ffffff';
    g.font = '800 15px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`${Math.ceil(c.hp)}`, c.x, c.y + c.radius + 18);
  }

  // --- Boss Miasma Prime: layered capsid + 2 sine-chain tentacles + toxin core ---
  function drawBoss(g, e, time) {
    const pulse = 1 + 0.08 * Math.sin(time * 4);
    // Tentacles: 8-segment sine chains, sweeping. Phase 2 destroys one.
    const tentacles = bossTentacles(e);
    for (let side = -1; side <= 1; side += 2) {
      if (tentacles === 1 && side === 1) continue; // right tentacle destroyed in phase 2
      let x = e.x + side * 30;
      let y = e.y + 20;
      let ang = Math.PI / 2 + side * 0.5 + Math.sin(time * 1.6 + (side > 0 ? 0 : 2)) * 0.5;
      g.strokeStyle = '#7d2b8e';
      g.lineWidth = 9;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 8; s += 1) {
        ang += Math.sin(time * 2.2 + s * 0.9 + side) * 0.28;
        x += Math.cos(ang) * 16;
        y += Math.sin(ang) * 16;
        g.lineTo(x, y);
      }
      g.stroke();
      // Tentacle tip: glowing toxin bulb.
      g.fillStyle = '#c77dff';
      g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill();
    }
    // Layered capsid: 3 concentric rings.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(e.x, e.y, 10, e.x, e.y, e.radius * 1.6);
    glow.addColorStop(0, 'rgba(199, 125, 255, 0.4)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(e.x, e.y, e.radius * 1.6, 0, TAU); g.fill();
    g.restore();
    for (let layer = 0; layer < 3; layer += 1) {
      const r = e.radius * (1 - layer * 0.22) * pulse;
      g.fillStyle = layer === 0 ? '#4a1e6e' : layer === 1 ? '#6e2a9e' : '#8e3ec2';
      g.beginPath(); g.arc(e.x, e.y, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    // Capsid spikes.
    g.strokeStyle = '#c77dff';
    g.lineWidth = 2;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU + time * 0.3;
      g.beginPath();
      g.moveTo(e.x + Math.cos(a) * e.radius * 0.9, e.y + Math.sin(a) * e.radius * 0.9);
      g.lineTo(e.x + Math.cos(a) * e.radius * 1.15, e.y + Math.sin(a) * e.radius * 1.15);
      g.stroke();
    }
    // Pulsing toxin core.
    const coreR = 16 * (1 + 0.18 * Math.sin(time * 4));
    g.save();
    g.globalCompositeOperation = 'lighter';
    const cg = g.createRadialGradient(e.x, e.y, 2, e.x, e.y, coreR * 2);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.4, '#c77dff');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg;
    g.beginPath(); g.arc(e.x, e.y, coreR * 2, 0, TAU); g.fill();
    g.restore();
    // Telegraph ring (radial burst warning).
    if (e.telegraph > 0) {
      g.strokeStyle = `rgba(255, 46, 77, ${0.4 + 0.6 * (1 - e.telegraph / 0.8)})`;
      g.lineWidth = 4;
      g.beginPath(); g.arc(e.x, e.y, e.radius + 18, 0, TAU); g.stroke();
    }
    // Sweeping laser.
    if (e.laserPhase === 'warn') {
      g.save();
      g.strokeStyle = 'rgba(255, 46, 77, 0.5)';
      g.lineWidth = 3;
      g.setLineDash([10, 8]);
      g.beginPath(); g.moveTo(e.x, e.y);
      g.lineTo(e.x + Math.cos(e.laserAngle) * 520, e.y + Math.sin(e.laserAngle) * 520);
      g.stroke();
      g.restore();
    } else if (e.laserPhase === 'sweep') {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255, 80, 120, 0.9)';
      g.lineWidth = 10;
      g.beginPath(); g.moveTo(e.x, e.y);
      g.lineTo(e.x + Math.cos(e.laserAngle) * 520, e.y + Math.sin(e.laserAngle) * 520);
      g.stroke();
      g.restore();
    }
  }

  function drawEnemy(g, world, e) {
    const time = world.time;
    if (e.flash > 0) {
      // White hit-flash: draw the sprite, then a white silhouette over it.
      g.save();
      g.globalAlpha = Math.min(1, e.flash / 0.12);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(e.x, e.y, e.radius + 4, 0, TAU); g.fill();
      g.restore();
    }
    if (e.kind === 'bacillus') {
      // Waving flagella tail (live, animated) behind the cached rod body.
      const tailA = e.angle + Math.PI;
      g.strokeStyle = 'rgba(184, 217, 74, 0.85)';
      g.lineWidth = 2;
      for (let f = -1; f <= 1; f += 1) {
        g.beginPath();
        const bx = e.x + Math.cos(tailA) * 30;
        const by = e.y + Math.sin(tailA) * 30;
        g.moveTo(bx, by);
        const wob = Math.sin(time * 10 + e.seed + f * 2) * 8;
        const px = Math.cos(tailA + Math.PI / 2) * wob;
        const py = Math.sin(tailA + Math.PI / 2) * wob;
        g.quadraticCurveTo(bx + Math.cos(tailA) * 16 + px, by + Math.sin(tailA) * 16 + py, bx + Math.cos(tailA) * 30 + px * 1.4, by + Math.sin(tailA) * 30 + py * 1.4);
        g.stroke();
      }
      drawSprite(g, `bacillus-${e.polarity}`, e.x, e.y, e.radius * 2.4, e.radius * 1.6, e.angle, (sg) => bacillusSprite(sg, e.polarity));
    } else if (e.kind === 'phage') {
      // 6 tail fibers: spider legs that STRETCH during the attack telegraph.
      const stretch = e.shootTimer < 0.5 ? 1.6 : 1;
      g.strokeStyle = 'rgba(142, 111, 216, 0.9)';
      g.lineWidth = 2;
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU + time * 0.4;
        const len = 22 * stretch;
        g.beginPath();
        g.moveTo(e.x + Math.cos(a) * 14, e.y + Math.sin(a) * 14);
        g.lineTo(e.x + Math.cos(a) * (14 + len), e.y + Math.sin(a) * (14 + len));
        g.stroke();
      }
      drawSprite(g, `phage-${e.polarity}`, e.x, e.y, e.radius * 2.2, e.radius * 2.2, 0, (sg) => phageSprite(sg, e.polarity));
    } else if (e.kind === 'plastic') {
      drawSprite(g, 'plastic', e.x, e.y, e.radius * 2.2, e.radius * 2.2, time * 0.4 + e.seed, plasticSprite);
      // Synthetic edge glint: a bright sparkle that sweeps the shard.
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gx = e.x + Math.cos(time * 2 + e.seed) * e.radius * 0.5;
      const gy = e.y + Math.sin(time * 2 + e.seed) * e.radius * 0.5;
      const gg = g.createRadialGradient(gx, gy, 1, gx, gy, 12);
      gg.addColorStop(0, 'rgba(255,255,255,0.9)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(gx, gy, 12, 0, TAU); g.fill();
      g.restore();
    } else if (e.kind === 'leaper') {
      // Telegraph: stretches along the dash direction + red warning ring.
      const telegraphing = e.dashState === 1;
      if (telegraphing) {
        g.strokeStyle = 'rgba(255, 46, 77, 0.8)';
        g.lineWidth = 3;
        g.beginPath(); g.arc(e.x, e.y, e.radius + 10, 0, TAU); g.stroke();
      }
      g.save();
      g.translate(e.x, e.y);
      g.rotate(telegraphing ? e.dashAngle : time * 0.8);
      g.scale(telegraphing ? 1.4 : 1, telegraphing ? 0.7 : 1);
      const c = getSprite('leaper', 128, 128, leaperSprite);
      g.drawImage(c, -e.radius * 1.2, -e.radius * 1.2, e.radius * 2.4, e.radius * 2.4);
      g.restore();
    } else if (e.kind === 'warder') {
      drawSprite(g, 'warder', e.x, e.y, e.radius * 2.6, e.radius * 2.6, 0, warderSprite);
    } else if (e.kind === 'dormant') {
      // Dormant Dysplastic Cell: a pale irregular blob, asleep — with a small
      // polarity dot so the player can read which shot would wake it.
      g.save();
      g.globalAlpha = 0.75 + 0.2 * Math.sin(time * 2 + e.seed);
      g.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * TAU;
        const r = e.radius * (0.85 + 0.25 * Math.sin(e.seed + i * 2.3));
        const px = e.x + Math.cos(a) * r;
        const py = e.y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.fillStyle = '#8a7a9a';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
      // Polarity dot: a same-polarity shot is the WRONG shot (it mutates).
      g.fillStyle = POLARITY_COLOUR[e.polarity];
      g.beginPath(); g.arc(e.x, e.y, 5, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(e.x, e.y, e.radius + 4 + Math.sin(time * 2) * 2, 0, TAU); g.stroke();
    } else if (e.kind === 'cancer') {
      // Angiogenesis tether: parasitic capillary vessels to the Organ Core.
      if (e.tether) {
        g.save();
        g.strokeStyle = 'rgba(255, 46, 77, 0.55)';
        g.lineWidth = 3;
        g.setLineDash([8, 6]);
        g.lineDashOffset = -time * 30;
        for (const off of [-8, 8]) {
          g.beginPath();
          g.moveTo(e.x, e.y);
          g.quadraticCurveTo(
            (e.x + world.core.x) / 2 + off + Math.sin(time * 2 + e.seed) * 10,
            (e.y + world.core.y) / 2 + off,
            world.core.x, world.core.y,
          );
          g.stroke();
        }
        g.restore();
      }
      // Malignant Tumor Cell: dark-red irregular spiky mass, pulsing core.
      const pulse = 1 + 0.1 * Math.sin(time * 3 + e.seed);
      g.save();
      g.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * TAU;
        const r = e.radius * (i % 2 === 0 ? 1.3 : 0.9) * (0.9 + 0.2 * Math.sin(e.seed + i * 1.7)) * pulse;
        const px = e.x + Math.cos(a) * r;
        const py = e.y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      const cg = g.createRadialGradient(e.x, e.y, 2, e.x, e.y, e.radius * 1.3);
      cg.addColorStop(0, '#a31226');
      cg.addColorStop(0.6, '#5a0a14');
      cg.addColorStop(1, '#2a0409');
      g.fillStyle = cg;
      g.fill();
      g.strokeStyle = '#ff2e4d';
      g.lineWidth = 2;
      g.stroke();
      // Glowing malignant core.
      g.globalCompositeOperation = 'lighter';
      const coreG = g.createRadialGradient(e.x, e.y, 1, e.x, e.y, 12 * pulse);
      coreG.addColorStop(0, 'rgba(255, 80, 100, 0.9)');
      coreG.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = coreG;
      g.beginPath(); g.arc(e.x, e.y, 12 * pulse, 0, TAU); g.fill();
      g.restore();
      // mAb: gold target marks while the evasion shield is collapsed.
      if (world.mabTimer > 0) {
        g.save();
        g.strokeStyle = '#ffd166';
        g.lineWidth = 2.5;
        g.beginPath(); g.arc(e.x, e.y, e.radius + 8, 0, TAU); g.stroke();
        g.beginPath();
        g.moveTo(e.x - e.radius - 14, e.y); g.lineTo(e.x - e.radius - 4, e.y);
        g.moveTo(e.x + e.radius + 4, e.y); g.lineTo(e.x + e.radius + 14, e.y);
        g.moveTo(e.x, e.y - e.radius - 14); g.lineTo(e.x, e.y - e.radius - 4);
        g.moveTo(e.x, e.y + e.radius + 4); g.lineTo(e.x, e.y + e.radius + 14);
        g.stroke();
        g.restore();
      }
    } else if (e.kind === 'boss') {
      drawBoss(g, e, time);
    }
    // Shield shimmer on warder-protected pathogens.
    if (e.shielded && e.kind !== 'warder') {
      g.strokeStyle = 'rgba(127, 212, 255, 0.6)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(e.x, e.y, e.radius + 5, 0, TAU); g.stroke();
    }
    // Spawn-in scale.
    if (e.spawnAnim > 0) {
      g.save();
      g.globalAlpha = 1 - e.spawnAnim / 0.4;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath(); g.arc(e.x, e.y, e.radius + 6, 0, TAU); g.stroke();
      g.restore();
    }
  }

  function drawPlateletNodes(g, world) {
    const time = world.time;
    for (const n of world.nodes) {
      if (!n.active) continue;
      const pulse = 1 + 0.14 * Math.sin(n.pulse * 3);
      // Dendritic star: 8 arms with small branches.
      g.save();
      g.translate(n.x, n.y);
      g.scale(pulse, pulse);
      g.strokeStyle = n.linked ? '#ffd166' : 'rgba(255, 180, 120, 0.85)';
      g.lineWidth = n.linked ? 3 : 2;
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * TAU + time * 0.2;
        const len = 16;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        g.stroke();
        g.beginPath();
        g.moveTo(Math.cos(a) * len * 0.6, Math.sin(a) * len * 0.6);
        g.lineTo(Math.cos(a + 0.5) * len * 0.9, Math.sin(a + 0.5) * len * 0.9);
        g.stroke();
      }
      g.fillStyle = n.linked ? '#ffd166' : '#ffb478';
      g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
      g.restore();
      // Glow when linked.
      if (n.linked) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        const gg = g.createRadialGradient(n.x, n.y, 2, n.x, n.y, 30);
        gg.addColorStop(0, 'rgba(255, 209, 102, 0.5)');
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gg;
        g.beginPath(); g.arc(n.x, n.y, 30, 0, TAU); g.fill();
        g.restore();
      }
    }
    // Fibrin threads: glowing filaments between linked nodes.
    for (const t of world.threads) {
      if (!t.active) continue;
      const alpha = Math.min(1, t.life / t.maxLife);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255, 209, 102, ${0.85 * alpha})`;
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(t.ax, t.ay); g.lineTo(t.bx, t.by); g.stroke();
      g.strokeStyle = `rgba(255, 255, 255, ${0.7 * alpha})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(t.ax, t.ay); g.lineTo(t.bx, t.by); g.stroke();
      g.restore();
    }
  }

  function drawProjectiles(g, world) {
    const time = world.time;
    // Player Perforin bolts: elongated capsules, additive glow, with a
    // motion trail behind each bolt (the beam's path stays readable).
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of world.projectiles) {
      if (!b.active) continue;
      const col = b.style === 'prism' ? '#7fd4ff' : POLARITY_COLOUR[b.polarity];
      const ang = Math.atan2(b.vy, b.vx);
      const tx = b.x - b.vx * 0.035;
      const ty = b.y - b.vy * 0.035;
      g.strokeStyle = col;
      g.globalAlpha = 0.30;
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = '#ffffff';
      g.globalAlpha = 0.35;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(b.x, b.y); g.stroke();
      g.globalAlpha = 1;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(ang);
      const grad = g.createLinearGradient(-16, 0, 16, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, col);
      grad.addColorStop(1, '#ffffff');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(-16, -3, 32, 6, 3);
      g.fill();
      g.restore();
    }
    // Enemy toxin orbs: glowing spheres with a pulsing ring.
    for (const b of world.enemyProjectiles) {
      if (!b.active) continue;
      const col = POLARITY_COLOUR[b.polarity];
      const gg = g.createRadialGradient(b.x, b.y, 1, b.x, b.y, 14);
      gg.addColorStop(0, '#ffffff');
      gg.addColorStop(0.4, col);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(b.x, b.y, 14, 0, TAU); g.fill();
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(b.x, b.y, 8 + Math.sin(time * 6) * 2, 0, TAU); g.stroke();
    }
    g.restore();
  }

  function drawParticlesAndNumbers(g, world) {
    // Vesicle particles: glowing blobs (additive); sparks: small dots.
    // Rings: chromatic shockwave rings, expanding and fading.
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const pt of world.particles) {
      if (!pt.active) continue;
      const alpha = Math.max(0, pt.life / pt.maxLife);
      if (pt.ring) {
        const radius = pt.maxR * (1 - pt.life / pt.maxLife);
        g.globalAlpha = alpha;
        g.strokeStyle = pt.colour;
        g.lineWidth = 4;
        g.beginPath(); g.arc(pt.x, pt.y, radius, 0, TAU); g.stroke();
        g.globalAlpha = alpha * 0.7;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(pt.x, pt.y, radius * 0.85, 0, TAU); g.stroke();
        continue;
      }
      if (pt.vesicle) {
        const gg = g.createRadialGradient(pt.x, pt.y, 0.5, pt.x, pt.y, pt.size * 2);
        gg.addColorStop(0, pt.colour);
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = alpha;
        g.fillStyle = gg;
        g.beginPath(); g.arc(pt.x, pt.y, pt.size * 2, 0, TAU); g.fill();
      } else {
        g.globalAlpha = alpha;
        g.fillStyle = pt.colour;
        g.beginPath(); g.arc(pt.x, pt.y, pt.size, 0, TAU); g.fill();
      }
    }
    g.restore();
    g.globalAlpha = 1;
    // Floating damage numbers: bold, dark-outlined, crits bigger and gold.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const n of world.damageNumbers) {
      if (!n.active) continue;
      const alpha = Math.max(0, n.life / n.maxLife);
      g.globalAlpha = alpha;
      g.font = n.crit ? '800 22px system-ui, sans-serif' : '700 16px system-ui, sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      g.strokeText(n.text, n.x, n.y);
      g.fillStyle = n.colour;
      g.fillText(n.text, n.x, n.y);
    }
    g.globalAlpha = 1;
  }

  function drawField(g, world) {
    if (bgBiome !== world.biomeId) buildBackground(world.biomeId);
    g.drawImage(bgCanvas, 0, 0);
    // Erythrocytes drift slowly behind everything (two parallax layers).
    // Calm flow in homeostasis; twice as fast while the body burns.
    const flow = world.physiology === 'febrile' ? 2 : 1;
    const drift = (list, far) => {
      for (const e of list) {
        e.x += e.vx * e.depth * 0.016 * flow;
        if (e.x - e.r > W) { e.x = -e.r; e.y = 40 + ((e.y * 7 + 130) % (H - 80)); }
        drawErythrocyte(g, e, world.time, far);
      }
    };
    drift(eryFar, true);
    drift(eryNear, false);
    // Floating plasma particles: tiny additive motes for deep 3D volume.
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const d of plasmaDots) {
      const dx = (d.x + world.time * d.vx) % (W + 20);
      const tw = 0.6 + 0.4 * Math.sin(world.time * 2 + d.phase);
      g.globalAlpha = d.alpha * tw;
      g.fillStyle = '#ffd9a0';
      g.beginPath(); g.arc(dx < 0 ? dx + W + 20 : dx, d.y, d.r, 0, TAU); g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
    // Living endothelial vessel walls over the baked tissue (pulse + colour
    // follow the heartbeat and the physiological phase).
    drawVesselWalls(g, world.time, world.physiology === 'febrile');
    // Physiological tint: warm Teal-Gold wash while healthy; a pulsing
    // red-coral vascular fever pulse at the edges while febrile.
    if (world.physiology === 'febrile') {
      const pulse = 0.14 + 0.08 * Math.sin(world.time * 3);
      const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
      vg.addColorStop(0, 'rgba(255, 70, 90, 0)');
      vg.addColorStop(1, `rgba(255, 70, 90, ${pulse})`);
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = 'rgba(47, 212, 192, 0.05)';
      g.fillRect(0, 0, W, H);
    }
    // Storm ring (Marrow Sanctuary).
    if (world.biomeId === 'marrow') {
      g.save();
      g.strokeStyle = 'rgba(181, 55, 242, 0.55)';
      g.lineWidth = 6;
      g.setLineDash([18, 12]);
      g.lineDashOffset = -world.time * 30;
      g.beginPath(); g.arc(world.stormX, world.stormY, 130, 0, TAU); g.stroke();
      g.restore();
    }
    // Alveolar walls + Silica Prisms are drawn from world state (drawAlveolar).
  }

  function drawAlveolar(g, world) {
    // Tissue walls.
    for (const p of world.alveolarWalls || []) {
      g.fillStyle = '#5c1f30';
      g.strokeStyle = '#8e2f3c';
      g.lineWidth = 2;
      g.beginPath(); g.roundRect(p.x, p.y, p.w, p.h, 10); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.roundRect(p.x + 6, p.y + 6, p.w - 12, 18, 8); g.fill();
    }
    // Silica Prisms: rotating crystals + refraction glow.
    for (const pr of world.silicaPrisms || []) {
      g.save();
      g.translate(pr.x, pr.y);
      g.rotate(world.time * 0.5);
      const c = getSprite('prism', 128, 128, prismSprite);
      g.drawImage(c, -pr.radius * 1.4, -pr.radius * 1.4, pr.radius * 2.8, pr.radius * 2.8);
      g.restore();
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gg = g.createRadialGradient(pr.x, pr.y, 4, pr.x, pr.y, pr.radius * 2);
      gg.addColorStop(0, 'rgba(127, 212, 255, 0.4)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(pr.x, pr.y, pr.radius * 2, 0, TAU); g.fill();
      g.restore();
    }
  }

  function drawShards(g, world) {
    for (const s of world.shards) {
      if (!s.active) continue;
      const bob = Math.sin(world.time * 5 + s.x * 0.1) * 2;
      if (s.kind && s.kind.startsWith('drug-')) {
        // Targeted Therapeutic capsule: glowing pill + short label.
        const drugId = s.kind.slice(5);
        const def = drugDef(drugId);
        const col = def ? def.colour : '#ffd166';
        const label = def ? (def.label || def.short) : 'DRUG';
        g.save();
        g.globalCompositeOperation = 'lighter';
        const gg = g.createRadialGradient(s.x, s.y + bob, 1, s.x, s.y + bob, 20);
        gg.addColorStop(0, col);
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalAlpha = 0.7;
        g.fillStyle = gg;
        g.beginPath(); g.arc(s.x, s.y + bob, 20, 0, TAU); g.fill();
        g.restore();
        g.save();
        g.translate(s.x, s.y + bob);
        g.rotate(-0.5);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.roundRect(-9, -5, 18, 10, 5); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.roundRect(-9, -5, 9, 10, 5); g.fill();
        g.restore();
        g.font = '800 12px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        g.strokeText(label, s.x, s.y + bob + 18);
        g.fillStyle = '#ffffff';
        g.fillText(label, s.x, s.y + bob + 18);
        continue;
      }
      if (s.kind === 'stem') {
        // Vital Stem-Orb: teal-green glow with a white medical cross.
        g.save();
        g.globalCompositeOperation = 'lighter';
        const gg = g.createRadialGradient(s.x, s.y + bob, 1, s.x, s.y + bob, 16);
        gg.addColorStop(0, 'rgba(47, 212, 160, 0.9)');
        gg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gg;
        g.beginPath(); g.arc(s.x, s.y + bob, 16, 0, TAU); g.fill();
        g.restore();
        g.fillStyle = '#2fd4a0';
        g.beginPath(); g.arc(s.x, s.y + bob, 6, 0, TAU); g.fill();
        g.fillStyle = '#ffffff';
        g.fillRect(s.x - 1, s.y + bob - 4, 2, 8);
        g.fillRect(s.x - 4, s.y + bob - 1, 8, 2);
        continue;
      }
      g.save();
      g.globalCompositeOperation = 'lighter';
      const gg = g.createRadialGradient(s.x, s.y + bob, 1, s.x, s.y + bob, 12);
      gg.addColorStop(0, 'rgba(255, 209, 102, 0.8)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(s.x, s.y + bob, 12, 0, TAU); g.fill();
      g.restore();
      g.fillStyle = '#ffd166';
      g.beginPath(); g.arc(s.x, s.y + bob, 4, 0, TAU); g.fill();
    }
  }

  /** Shrink-to-fit: set the font for `text` so it fits `maxW` (min 10 px). */
  /** Custom DNA double-helix vector icon: two sine strands + base rungs. */
  function drawDnaHelix(g, cx, cy, size, colour) {
    const half = size / 2;
    const amp = size * 0.22;
    g.save();
    g.strokeStyle = colour;
    g.lineWidth = 3;
    g.lineCap = 'round';
    // Two strands, one full sine period each way.
    for (const phase of [0, Math.PI]) {
      g.beginPath();
      for (let y = -half; y <= half; y += 3) {
        const x = cx + Math.sin((y / half) * Math.PI + phase) * amp;
        if (y === -half) g.moveTo(x, cy + y); else g.lineTo(x, cy + y);
      }
      g.stroke();
    }
    // Base-pair rungs (4).
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    for (let k = 0; k < 4; k += 1) {
      const y = -half + 8 + k * ((size - 16) / 3);
      const off = Math.sin((y / half) * Math.PI) * amp;
      g.beginPath();
      g.moveTo(cx - off, cy + y);
      g.lineTo(cx + off, cy + y);
      g.stroke();
    }
    g.restore();
  }

  function fitText(g, text, maxW, baseSize, weight) {
    let size = baseSize;
    g.font = `${weight} ${size}px system-ui, sans-serif`;
    while (size > 10 && g.measureText(text).width > maxW) {
      size -= 1;
      g.font = `${weight} ${size}px system-ui, sans-serif`;
    }
  }

  /** Medical Bio-Scanner glass panel: chamfered corners, dark glass fill,
   * bright top edge. Use for cards and banners (never a flat roundRect). */
  function glassPanel(g, x, y, w, h, chamfer) {
    const c = Math.min(chamfer, w / 4, h / 2);
    g.beginPath();
    g.moveTo(x + c, y);
    g.lineTo(x + w - c, y);
    g.lineTo(x + w, y + c);
    g.lineTo(x + w, y + h - c);
    g.lineTo(x + w - c, y + h);
    g.lineTo(x + c, y + h);
    g.lineTo(x, y + h - c);
    g.lineTo(x, y + c);
    g.closePath();
  }

  /** Fill a glass panel + its bright top edge (call after setting fillStyle). */
  function fillGlass(g, x, y, w, h, chamfer) {
    glassPanel(g, x, y, w, h, chamfer);
    g.fill();
    g.save();
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + chamfer, y + 0.5);
    g.lineTo(x + w - chamfer, y + 0.5);
    g.stroke();
    g.restore();
  }

  // Title diorama: precomputed seeded positions for the dense erythrocyte
  // field and the demo pathogens (deterministic, no per-frame allocation).
  const titleErythrocytes = [];
  const titleRandom = createRandom(20261116);
  for (let i = 0; i < 18; i += 1) {
    titleErythrocytes.push({
      x: titleRandom() * W, y: titleRandom() * H,
      r: 30 + titleRandom() * 34, alpha: 0.06 + titleRandom() * 0.08,
      bobPhase: titleRandom() * TAU, depth: 0.5,
    });
  }
  const titleDemo = [
    { kind: 'bacillus', x: 400, y: 245, pol: 'bio', drift: 0 },
    { kind: 'phage', x: 880, y: 235, pol: 'toxin', drift: 1.3 },
    { kind: 'plastic', x: 920, y: 330, pol: 'bio', drift: 2.1 },
    { kind: 'leaper', x: 360, y: 330, pol: 'toxin', drift: 2.9 },
    { kind: 'phage', x: 250, y: 260, pol: 'bio', drift: 3.7 },
    { kind: 'bacillus', x: 1020, y: 250, pol: 'toxin', drift: 4.4 },
  ];

  function drawTitle(g, world, best) {
    // --- Layered diorama (own background — the biome plasma never shows
    // here): deep teal-navy gradient, god-ray light, dense erythrocyte
    // field, layered vessel walls, glowing leukocyte hero, demo pathogens.
    const tg = g.createLinearGradient(0, 0, 0, H);
    tg.addColorStop(0, '#0a2530');
    tg.addColorStop(0.55, '#081a24');
    tg.addColorStop(1, '#050d16');
    g.fillStyle = tg;
    g.fillRect(0, 0, W, H);
    // God rays: translucent gold shafts from the top, swaying gently.
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i += 1) {
      const rx = 300 + i * 240 + Math.sin(world.time * 0.3 + i * 1.7) * 18;
      const rg = g.createLinearGradient(rx, 0, rx + 90, H * 0.7);
      rg.addColorStop(0, 'rgba(255, 220, 150, 0.10)');
      rg.addColorStop(1, 'rgba(255, 220, 150, 0)');
      g.fillStyle = rg;
      g.beginPath();
      g.moveTo(rx - 26, 0);
      g.lineTo(rx + 26, 0);
      g.lineTo(rx + 90, H * 0.7);
      g.lineTo(rx + 10, H * 0.7);
      g.closePath();
      g.fill();
    }
    g.restore();
    // Dense erythrocyte field (far layer: dim, no dimple).
    for (const e of titleErythrocytes) drawErythrocyte(g, e, world.time, true);
    // Layered vessel walls, calm Teal-Gold (the title is homeostasis).
    drawVesselWalls(g, world.time, false);
    // Demo pathogens drifting around the hero (live sprites, slow sway).
    for (const d of titleDemo) {
      const dx = d.x + Math.sin(world.time * 0.5 + d.drift) * 12;
      const dy = d.y + Math.cos(world.time * 0.4 + d.drift) * 8;
      if (d.kind === 'bacillus') drawSprite(g, `bacillus-${d.pol}`, dx, dy, 42, 28, d.drift, (sg) => bacillusSprite(sg, d.pol));
      else if (d.kind === 'phage') drawSprite(g, `phage-${d.pol}`, dx, dy, 38, 38, 0, (sg) => phageSprite(sg, d.pol));
      else if (d.kind === 'plastic') drawSprite(g, 'plastic', dx, dy, 36, 36, world.time * 0.3 + d.drift, plasticSprite);
      else drawSprite(g, 'leaper', dx, dy, 36, 36, 0, leaperSprite);
    }
    // Glowing leukocyte hero: dual rotating auras — Bio-Gold and
    // Toxin-Violet — pulsing at the Organ Core altar.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(640, 278, 10, 640, 278, 130);
    halo.addColorStop(0, 'rgba(255, 209, 102, 0.35)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(640, 278, 130, 0, TAU); g.fill();
    const haloV = g.createRadialGradient(640, 278, 20, 640, 278, 150);
    haloV.addColorStop(0, 'rgba(199, 125, 255, 0.22)');
    haloV.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = haloV;
    g.beginPath(); g.arc(640, 278, 150, 0, TAU); g.fill();
    // Two aura arcs rotating in opposite directions around the hero.
    const rt = world.time * 0.5;
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255, 209, 102, 0.8)';
    g.beginPath(); g.arc(640, 278, 108, rt, rt + 1.3); g.stroke();
    g.strokeStyle = 'rgba(199, 125, 255, 0.8)';
    g.beginPath(); g.arc(640, 278, 118, -rt, -rt + 1.3); g.stroke();
    g.restore();
    // Demo cell (amoeboid, gold polarity, larger than in play).
    const demo = { player: { x: 640, y: 278, radius: 34, polarity: 'bio', moveAngle: -0.6, moveSpeed: 0.6, invuln: 0 }, time: world.time };
    drawPlayerCell(g, demo);
    // The Organ Core altar below the hero: a small glowing layered orb
    // with a gold ring and two fibrin threads linking hero to Core.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const altar = g.createRadialGradient(640, 348, 2, 640, 348, 46);
    altar.addColorStop(0, 'rgba(255, 92, 122, 0.55)');
    altar.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = altar;
    g.beginPath(); g.arc(640, 348, 46, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255, 209, 102, 0.7)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(640, 348, 30, 0, TAU); g.stroke();
    g.fillStyle = '#ff5c7a';
    g.beginPath(); g.arc(640, 348, 18, 0, TAU); g.fill();
    g.fillStyle = '#ffd166';
    g.beginPath(); g.arc(640, 348, 8, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(125, 249, 255, 0.6)';
    g.lineWidth = 1.5;
    for (const off of [-14, 14]) {
      g.beginPath();
      g.moveTo(640 + off, 300);
      g.quadraticCurveTo(640 + off * 1.6, 324, 640 + off * 0.8, 336);
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '800 64px system-ui, sans-serif';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.shadowColor = '#ffd166';
    g.shadowBlur = 24;
    g.strokeText('CYTOGUARD', 640, 88);
    g.fillText('CYTOGUARD', 640, 88);
    g.shadowBlur = 0;
    g.fillStyle = '#ffd166';
    g.font = '700 30px system-ui, sans-serif';
    g.fillText('THE VITAL SURGE', 640, 128);
    g.fillStyle = '#ffffff';
    g.font = '600 20px system-ui, sans-serif';
    g.fillText('MICROSCOPIC IMMUNE DEFENSE • 10 WAVES TO HOMEOSTASIS', 640, 162);
    // Objective banner (glass, chamfered).
    g.fillStyle = 'rgba(8, 4, 10, 0.72)';
    fillGlass(g, 190, 180, 900, 44, 10);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    glassPanel(g, 190, 180, 900, 44, 10);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 21px system-ui, sans-serif';
    g.fillText('PROTECT THE ORGAN CORE • PURGE 10 WAVES OF PATHOGENS', 640, 202);
    // 3 immune-class cards (glass, chamfered).
    for (let i = 0; i < 3; i += 1) {
      const w = WEAPON_DEFS[i];
      const r = TITLE_CLASS_RECTS[i];
      const selected = world.selectedWeapon === w.id;
      g.fillStyle = selected ? 'rgba(255, 209, 102, 0.25)' : 'rgba(8, 4, 10, 0.72)';
      fillGlass(g, r.x, r.y, r.w, r.h, 12);
      g.strokeStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.3)';
      g.lineWidth = selected ? 3 : 1.5;
      glassPanel(g, r.x, r.y, r.w, r.h, 12);
      g.stroke();
      g.fillStyle = '#ffd166';
      g.font = '400 44px system-ui, sans-serif';
      g.fillText(w.icon, r.x + r.w / 2, r.y + 40);
      // Card text shrinks to fit the 220 px card — never overflows the edge.
      fitText(g, w.name, r.w - 20, 20, 800);
      g.fillStyle = '#ffffff';
      g.fillText(w.name, r.x + r.w / 2, r.y + 84);
      fitText(g, w.tagline, r.w - 20, 15, 600);
      g.fillStyle = '#ffd166';
      g.fillText(w.tagline, r.x + r.w / 2, r.y + 112);
      fitText(g, w.desc, r.w - 20, 13, 400);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillText(w.desc, r.x + r.w / 2, r.y + 132);
    }
    // Controls line (clear gap above the DEPLOY button).
    g.fillStyle = '#ffffff';
    g.font = '700 20px system-ui, sans-serif';
    g.fillText('WASD • MOUSE • Q POLARITY • SPACE FIBRIN DASH • R VENT • E FEVER • F OFFER', 640, 540);
    // DEPLOY CELL button.
    g.fillStyle = '#ffd166';
    g.beginPath(); g.roundRect(TITLE_DEPLOY.x, TITLE_DEPLOY.y, TITLE_DEPLOY.w, TITLE_DEPLOY.h, 14); g.fill();
    g.fillStyle = '#1a0b2e';
    g.font = '800 26px system-ui, sans-serif';
    g.fillText('[ DEPLOY CELL ]', 640, TITLE_DEPLOY.y + 33);
    // Best score.
    if (best > 0) {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.font = '600 18px system-ui, sans-serif';
      g.fillText(`BEST SCORE ${best}`, 640, 660);
    }
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '400 14px system-ui, sans-serif';
    g.fillText('Leukocyte Prime, the last smart immune cell, guards the Organ Core through ten waves of infection.', 640, 690);
  }

  function drawUpgrade(g, world) {
    // A lighter veil than the end screens: the battle arena stays alive
    // and glowing behind the draft cards.
    g.fillStyle = 'rgba(8, 4, 10, 0.55)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '800 36px system-ui, sans-serif';
    g.fillText('GENE SPLICE — DRAFT 3', 640, 90);
    g.fillStyle = '#ffd166';
    g.font = '600 20px system-ui, sans-serif';
    g.fillText(`WAVE ${world.wave} CLEARED  •  NUTRIENTS ${world.nutrients}  •  CHAIN x${world.maxChain}`, 640, 128);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '400 16px system-ui, sans-serif';
    g.fillText('Each Gene Splice carries a Pathogen Mutation for the next wave. Choose wisely.', 640, 156);
    for (let i = 0; i < 3; i += 1) {
      const card = world.choices[i];
      const r = UPGRADE_CARD_RECTS[i];
      if (!card) continue;
      const affordable = world.nutrients >= card.cost;
      // SYNERGY UNLOCKED: the card's paired gene (or evolution) is already
      // owned, so the frame turns gold and the tag pill shows.
      const unlocked = !!card.synergyId && ((world.upgradesOwned && world.upgradesOwned[card.synergyId] > 0) || (world.evolutions && world.evolutions.includes(card.synergyId)));
      g.fillStyle = affordable ? 'rgba(20, 10, 24, 0.9)' : 'rgba(20, 10, 24, 0.55)';
      fillGlass(g, r.x, r.y, r.w, r.h, 14);
      if (unlocked) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        const ug = g.createRadialGradient(r.x + r.w / 2, r.y + 90, 10, r.x + r.w / 2, r.y + 90, 150);
        ug.addColorStop(0, 'rgba(255, 209, 102, 0.22)');
        ug.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = ug;
        g.fillRect(r.x, r.y, r.w, r.h);
        g.restore();
      }
      g.strokeStyle = unlocked ? '#ffd166' : (RARITY_COLOURS[card.rarity] || '#ffffff');
      g.lineWidth = unlocked ? 3.5 : 2.5;
      glassPanel(g, r.x, r.y, r.w, r.h, 14);
      g.stroke();
      // Rarity badge.
      g.fillStyle = RARITY_COLOURS[card.rarity] || '#ffffff';
      g.beginPath(); g.roundRect(r.x + 14, r.y + 14, 86, 26, 8); g.fill();
      g.fillStyle = '#0a0410';
      g.font = '800 14px system-ui, sans-serif';
      g.fillText(card.rarity.toUpperCase(), r.x + 57, r.y + 28);
      // [ SYNERGY UNLOCKED ] tag (top-right) when the pair is owned.
      if (unlocked) {
        const tag = '[ SYNERGY UNLOCKED ]';
        g.font = '800 12px system-ui, sans-serif';
        const tagW = g.measureText(tag).width + 16;
        g.fillStyle = '#ffd166';
        g.beginPath(); g.roundRect(r.x + r.w - 14 - tagW, r.y + 14, tagW, 26, 8); g.fill();
        g.fillStyle = '#1a0b2e';
        g.fillText(tag, r.x + r.w - 14 - tagW / 2, r.y + 28);
      }
      // Custom DNA-strand vector icon (double helix + rungs), rarity colour.
      drawDnaHelix(g, r.x + r.w / 2, r.y + 86, 46, unlocked ? '#ffd166' : (RARITY_COLOURS[card.rarity] || '#ffd166'));
      fitText(g, card.name, r.w - 20, 22, 800);
      g.fillStyle = '#ffffff';
      g.fillText(card.name, r.x + r.w / 2, r.y + 132);
      fitText(g, card.desc, r.w - 20, 16, 600);
      g.fillStyle = '#ffd166';
      g.fillText(card.desc, r.x + r.w / 2, r.y + 162);
      fitText(g, card.synergy, r.w - 20, 14, 400);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillText(card.synergy, r.x + r.w / 2, r.y + 188);
      fitText(g, `“${card.inscription}”`, r.w - 20, 14, 400);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = 'italic 400 14px system-ui, sans-serif';
      g.fillText(`“${card.inscription}”`, r.x + r.w / 2, r.y + 214);
      // Pathogen Mutation (the risk half).
      fitText(g, `⚠ ${card.omen.name}`, r.w - 20, 15, 700);
      g.fillStyle = '#ff8fa3';
      g.fillText(`⚠ ${card.omen.name}`, r.x + r.w / 2, r.y + 244);
      fitText(g, card.omen.desc, r.w - 20, 13, 400);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(card.omen.desc, r.x + r.w / 2, r.y + 264);
      // Cost.
      g.fillStyle = affordable ? '#ffd166' : '#ff5c7a';
      g.font = '800 20px system-ui, sans-serif';
      g.fillText(`◉ ${card.cost}`, r.x + r.w / 2, r.y + 288);
    }
    // SKIP button.
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.roundRect(UPGRADE_SKIP.x, UPGRADE_SKIP.y, UPGRADE_SKIP.w, UPGRADE_SKIP.h, 12); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '700 20px system-ui, sans-serif';
    g.fillText('SKIP (C)', 640, UPGRADE_SKIP.y + 27);
  }

  /** Victory rank from the final score: S+ is the mastery bar. */
  function rankForScore(score) {
    if (score >= 12000) return 'S+';
    if (score >= 9000) return 'S';
    if (score >= 6000) return 'A';
    if (score >= 3000) return 'B';
    return 'C';
  }

  function drawEndScreen(g, world, best, win) {
    // Victory: a light teal-cyan veil so the healthy vessels show clear
    // and sparkling cyan-gold again behind the panel.
    g.fillStyle = win ? 'rgba(8, 30, 34, 0.55)' : 'rgba(20, 4, 8, 0.78)';
    g.fillRect(0, 0, W, H);
    if (win) {
      // Floating victory light particles: gold + cyan motes rising.
      g.save();
      for (let i = 0; i < 24; i += 1) {
        const mx = (i * 173 + 60) % W;
        const my = H - ((world.time * 18 + i * 97) % (H + 40)) + 20;
        g.fillStyle = i % 2 === 0 ? 'rgba(255, 209, 102, 0.8)' : 'rgba(125, 249, 255, 0.8)';
        g.beginPath(); g.arc(mx, my, 2.5 + (i % 3), 0, TAU); g.fill();
      }
      g.restore();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (win) {
      // Victory gold glow: a soft radial halo behind the title and stars.
      g.save();
      g.globalCompositeOperation = 'lighter';
      const vg = g.createRadialGradient(640, 165, 10, 640, 165, 260);
      vg.addColorStop(0, 'rgba(255, 209, 102, 0.28)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = vg;
      g.beginPath(); g.arc(640, 165, 260, 0, TAU); g.fill();
      g.restore();
      g.fillStyle = '#ffd166';
      fitText(g, 'HOMEOSTASIS RESTORED — VICTORY', 1100, 52, 800);
      g.shadowColor = '#ffd166';
      g.shadowBlur = 20;
      g.fillText('HOMEOSTASIS RESTORED — VICTORY', 640, 130);
      g.shadowBlur = 0;
      g.font = '400 64px system-ui, sans-serif';
      g.fillText('★★★', 640, 200);
      g.fillStyle = '#ffffff';
      g.font = '600 20px system-ui, sans-serif';
      g.fillText(VICTORY_NARRATIVE, 640, 252);
    } else {
      g.fillStyle = '#ff5c7a';
      g.font = '800 56px system-ui, sans-serif';
      g.fillText('ORGAN COLLAPSE', 640, 130);
      g.fillStyle = '#ffffff';
      g.font = '600 20px system-ui, sans-serif';
      g.fillText('The Organ Core has fallen. The body waits for another cell.', 640, 190);
    }
    // Full stats.
    const s = world.stats;
    // Stats backdrop: a near-opaque dark glass panel behind the rows so
    // the Organ Core (and its HP text) never shows through the numbers.
    g.fillStyle = 'rgba(6, 12, 18, 0.88)';
    fillGlass(g, 340, 285, 600, 180, 14);
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    glassPanel(g, 340, 285, 600, 180, 14);
    g.stroke();
    const rows = [
      ['WAVE REACHED', `${Math.max(1, world.wave)}/10`],
      ['SCORE', `${world.score}`],
      ['PATHOGENS PURGED', `${s.kills}`],
      ['TUMORS NEUTRALIZED', `${s.tumors || 0}`],
      ['PEAK CHAIN', `x${world.maxChain}`],
      ['RANK', rankForScore(world.score)],
    ];
    g.font = '700 20px system-ui, sans-serif';
    let y = 300;
    for (const [label, value] of rows) {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.textAlign = 'right';
      g.fillText(label, 600, y);
      g.fillStyle = '#ffd166';
      g.textAlign = 'left';
      g.fillText(value, 660, y);
      y += 30;
    }
    // Mutation recap (victory): every Awakened Cell Evolution mastered.
    if (win && world.evolutions && world.evolutions.length > 0) {
      const names = world.evolutions.map((id) => {
        const evo = EVOLUTIONS.find((e) => e.id === id);
        return evo ? evo.name : id;
      });
      g.fillStyle = '#ffd166';
      g.font = '700 20px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(`✦ MUTATIONS MASTERED: ${names.join(' • ')} ✦`, 640, 472);
    }
    // One lore inscription at the bottom of the end screen.
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.font = 'italic 400 16px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(win ? `“${VICTORY_NARRATIVE}”` : `“${DEFEAT_NARRATIVE}”`, 640, 640);
    // Buttons.
    const again = win ? WIN_AGAIN : OVER_RETRY;
    const change = win ? WIN_CHANGE : OVER_CHANGE;
    g.fillStyle = '#ffd166';
    g.beginPath(); g.roundRect(again.x, again.y, again.w, again.h, 12); g.fill();
    g.fillStyle = '#1a0b2e';
    g.font = '800 22px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(win ? '[ PLAY AGAIN ]' : '▶ RETRY VIGIL', again.x + again.w / 2, again.y + 31);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.roundRect(change.x, change.y, change.w, change.h, 12); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.stroke();
    g.fillStyle = '#ffffff';
    g.fillText(win ? '[ CHANGE CELL ]' : 'CHANGE CELL', change.x + change.w / 2, change.y + 31);
  }

  function drawPause(g) {
    g.fillStyle = 'rgba(8, 4, 10, 0.7)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.font = '800 48px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PAUSED', 640, 330);
    g.font = '600 20px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillText('Press P to resume', 640, 380);
  }

  /** The frame: field + entities + HUD + screen overlays. */
  function draw(world, screen, best, opts) {
    const muted = opts && opts.muted;
    ctx.save();
    // Screen shake.
    if (world.shake > 0) {
      const s = world.shake * 8;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    drawField(ctx, world);
    if (world.biomeId === 'alveolar') drawAlveolar(ctx, world);
    drawPlateletNodes(ctx, world);
    drawShards(ctx, world);
    // The Organ Core is hidden on the end screens: its bright orb and HP
    // text would show through the victory/defeat stats panel.
    if (screen !== SCREEN_WIN && screen !== SCREEN_OVER) drawCore(ctx, world);
    for (const e of world.enemies) if (e.active) drawEnemy(ctx, world, e);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) drawPlayerCell(ctx, world);
    drawProjectiles(ctx, world);
    // Nanobot chain beam: precision tumor-destroying light from the cell.
    if (world.nanobotBeam && world.nanobotBeam.timer > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [tx, ty] of world.nanobotBeam.points) {
        ctx.strokeStyle = 'rgba(232, 180, 255, 0.9)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(world.player.x, world.player.y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(world.player.x, world.player.y); ctx.lineTo(tx, ty); ctx.stroke();
        const bg = ctx.createRadialGradient(tx, ty, 1, tx, ty, 22);
        bg.addColorStop(0, 'rgba(232, 180, 255, 0.9)');
        bg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(tx, ty, 22, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    drawParticlesAndNumbers(ctx, world);
    // Vignette: darken the playfield edges so saturated accents pop and the
    // eye stays on the action (play / pause only — screens have own overlays).
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.30)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) drawHud(ctx, world, screen, muted);
    if (screen === SCREEN_TITLE) drawTitle(ctx, world, best);
    else if (screen === SCREEN_UPGRADE) drawUpgrade(ctx, world);
    else if (screen === SCREEN_OVER) drawEndScreen(ctx, world, best, false);
    else if (screen === SCREEN_WIN) drawEndScreen(ctx, world, best, true);
    else if (screen === SCREEN_PAUSE) drawPause(ctx);
  }

  return { draw, inRect };
}
