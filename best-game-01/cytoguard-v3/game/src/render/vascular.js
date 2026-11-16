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

import { CONFIG } from '../core/config.js';
import { createRandom } from '../core/random.js';
import { BIOMES } from '../systems/campaign.js';
import { bossTentacles } from '../entities/apex-boss.js';
import { EVOLUTIONS } from '../systems/synergies.js';
import { drugDef } from '../systems/oncology.js';
import { WEAPON_DEFS } from '../entities/weapons.js';
import { RARITY_COLOURS } from '../systems/draft.js';
import { VICTORY_NARRATIVE, DEFEAT_NARRATIVE } from '../lore/codex.js';
import { drawHud, SFX_BUTTON } from '../ui/hud.js';
import { drawVolumetricCell, drawPlasmaCaustics, drawMorphAura, drawDnaHelix as drawHelixV2 } from './volumetric-cells.js';
import { drawTelemetrySparkline, drawBodyMap } from '../ui/screens.js';
import { drawValveGate } from '../systems/fluidics.js';
export const WIN_ARMORY = { x: 1028, y: 552, w: 168, h: 72 };
import { drawArmoryPanel } from '../ui/armory.js';
import { CODEX_BUTTON } from '../lore/codex.js';

import { drawLaserBeam, drawFibrinWeb, drawRibbonTrail } from './effects.js';
import { initAtlas, drawAtlasSprite } from './atlas.js';
import { triangleNodes, triangleCentroid, amplifierTargets } from '../systems/constellation.js';
const TAU = Math.PI * 2;
export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_UPGRADE = 'upgrade';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';
export const SCREEN_PAUSE = 'pause';

// V3 bento layouts (SUNWRIGHT audit 08:47, anti-mess rules 08:49):
// combat arena 925 px + divider + sidebar 316 px (740/250 px at the
// 1024x640 capture scale). All rects below are the click targets the loop
// uses, so render and input always agree.
export const TITLE_DEPLOY = { x: 60, y: 476, w: 340, h: 64 };
export const TITLE_PROTOCOL_RECTS = [
  { x: 60, y: 556, w: 150, h: 48 },
  { x: 220, y: 556, w: 290, h: 48 },
  { x: 520, y: 556, w: 140, h: 48 },
];
// Legacy: the V2 weapon-class cards were replaced by the HOW IT WORKS
// legend (08:47 supersession). Kept exported for API stability; the title
// no longer renders or clicks them (keys 1/2/3 still select a class).
export const TITLE_CLASS_RECTS = [
  { x: 280, y: 380, w: 220, h: 150 },
  { x: 530, y: 380, w: 220, h: 150 },
  { x: 780, y: 380, w: 220, h: 150 },
];
// V3 upgrade: 3 Giant Circular Medallions (centres 280/640/1000, y 305,
// radius 125) + identical description boxes below. Legacy card rects kept
// exported; the medallion rects are the live click targets.
export const UPGRADE_MEDALLION_RECTS = [
  { x: 155, y: 155, w: 250, h: 275 },
  { x: 515, y: 155, w: 250, h: 275 },
  { x: 875, y: 155, w: 250, h: 275 },
];
export const UPGRADE_CARD_RECTS = [
  { x: 190, y: 190, w: 270, h: 300 },
  { x: 505, y: 190, w: 270, h: 300 },
  { x: 820, y: 190, w: 270, h: 300 },
];
// SKIP (C) is keyboard-only in V3 (08:47: no SKIP button is rendered).
export const UPGRADE_SKIP = { x: 540, y: 520, w: 200, h: 52 };
export const ROUTE_A = { x: 340, y: 615, w: 260, h: 52 };
export const ROUTE_B = { x: 680, y: 615, w: 260, h: 52 };
export const OVER_RETRY = { x: 325, y: 480, w: 270, h: 60 };
export const OVER_CHANGE = { x: 615, y: 480, w: 360, h: 60 };
export const WIN_AGAIN = { x: 624, y: 552, w: 170, h: 72 };
export const WIN_CHANGE = { x: 802, y: 552, w: 218, h: 72 };

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
  // V3 — the 256x256 HD sprite atlas (layered gradients, subsurface glow,
  // Fresnel rims) is pre-rendered once at boot; the live procedural layers
  // animate on top of it.
  const atlas = initAtlas();
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
    // Glowing hexagonal alveoli grid (SHIELD-2 FPS fix: baked here, into
    // the background the game already blits every frame, instead of 168
    // stroked hexagons — or a second full-screen blit — per frame. The
    // grid is static and biome-independent; the title screen paints its
    // own opaque gradient over it, and on upgrade/victory it reads as a
    // faint alveoli texture under the veils.)
    g.save();
    g.beginPath(); g.rect(16, 60, 925, 652); g.clip();
    g.strokeStyle = 'rgba(0, 245, 212, 0.055)';
    g.lineWidth = 1.5;
    {
      const hr = 46;
      const hw = Math.sqrt(3) * hr;
      for (let row = -1; row < 12; row += 1) {
        for (let col = -1; col < 14; col += 1) {
          const hx = 16 + col * hw + (row % 2 ? hw / 2 : 0);
          const hy = 60 + row * hr * 1.5;
          g.beginPath();
          for (let i = 0; i < 6; i += 1) {
            const a = (i / 6) * TAU + Math.PI / 6;
            const px = hx + Math.cos(a) * hr;
            const py = hy + Math.sin(a) * hr;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.closePath(); g.stroke();
        }
      }
    }
    g.restore();
    bgBiome = biomeId;
  }
  buildBackground('capillary');

  // --- Erythrocytes: TWO parallax layers of biconcave discs (3D depth) ---
  // Far layer: 26+ large, darker, slower, no dimple (reads as out-of-focus
  // bokeh — drawn with an extra soft halo pass instead of ctx.filter, so
  // the 60 FPS budget survives). Near layer: smaller, brighter, faster,
  // full biconcave detail.
  const eryFar = [];
  const eryNear = [];
  const eryRandom = createRandom(777);
  for (let i = 0; i < 26; i += 1) {
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
  // SHIELD-2 FPS FIX (2026-11-16): V3's far-erythrocyte bokeh halo (26 big
  // cells x a second radial-gradient fill at r*1.7) and the 168-hexagon
  // alveoli grid were re-rasterized EVERY frame under SwiftShader and
  // halved the frame rate (V3 31-40 fps vs V2 60 fps; JS profiler showed
  // 93% of time in native raster, not JS). Both layers are STATIC shapes —
  // the only motion is each cell's x drift + bob — so they are pre-rendered
  // ONCE at boot (same pattern as initAtlas) and blitted per frame. The
  // pixels are identical: source-over premultiplied compositing is
  // associative, and the sprite is baked at reference alpha 1.0, so a
  // per-cell globalAlpha = e.alpha reproduces the live colour stops
  // exactly (halo 0.5x, body 0.45x/1.0x/0.8x). The canvas is cropped to
  // the drawing's exact extent (220x158 for R=64: halo rx 108.8, ry 78.3)
  // so each blit touches only visible pixels, not a transparent square.
  const eryFarSprite = (() => {
    const c = document.createElement('canvas');
    c.width = 220; c.height = 158;
    const sg = c.getContext('2d');
    const cx = 110; const cy = 79; const R = 64;
    const halo = sg.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.7);
    halo.addColorStop(0, 'rgba(160, 40, 55, 0.5)');
    halo.addColorStop(1, 'rgba(160, 40, 55, 0)');
    sg.fillStyle = halo;
    sg.beginPath(); sg.ellipse(cx, cy, R * 1.7, R * 1.7 * 0.72, 0, 0, TAU); sg.fill();
    const rg = sg.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
    rg.addColorStop(0, 'rgba(190, 60, 70, 0.45)');
    rg.addColorStop(0.55, 'rgba(160, 40, 55, 1)');
    rg.addColorStop(0.85, 'rgba(120, 25, 40, 0.8)');
    rg.addColorStop(1, 'rgba(120, 25, 40, 0)');
    sg.fillStyle = rg;
    sg.beginPath(); sg.ellipse(cx, cy, R, R * 0.72, 0, 0, TAU); sg.fill();
    return c;
  })();
  // Baked alveoli hex grid: lives inside buildBackground's bgCanvas
  // (see SHIELD-2 FPS fix there) — no separate per-frame blit.
  function drawErythrocyte(g, e, time, far) {
    const y = e.y + Math.sin(time * 0.4 + e.bobPhase) * 8;
    if (far) {
      // Pre-rendered sprite (SHIELD-2 FPS fix): one blit instead of two
      // radial-gradient fills per cell per frame; identical pixels.
      // Dest rect = the drawing's exact extent (halo rx 1.7r, ry 1.224r).
      g.globalAlpha = e.alpha;
      g.drawImage(eryFarSprite, e.x - e.r * 1.7, y - e.r * 1.224, e.r * 3.4, e.r * 2.448);
      g.globalAlpha = 1;
      return;
    }
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
    // V3 visual scale: the hero reads 1.5x bigger and brighter on screen.
    // Render-only — p.radius (hitbox, gameplay) is untouched.
    const R = (p.radius + 6) * 1.5;
    const col = POLARITY_COLOUR[p.polarity];
    const glow = POLARITY_GLOW[p.polarity];
    // Polarity aura: soft radial glow under the cell (additive), wider + hotter.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const aura = g.createRadialGradient(p.x, p.y, R * 0.4, p.x, p.y, R * 2.8);
    aura.addColorStop(0, glow);
    aura.addColorStop(0.45, 'rgba(255, 209, 102, 0.22)');
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = aura;
    g.beginPath(); g.arc(p.x, p.y, R * 2.8, 0, TAU); g.fill();
    g.restore();
    // V3 — atlas hero sprite under the procedural membrane: layered
    // plasma membrane, gold-cyan nucleus, organelles, Fresnel rim.
    drawAtlasSprite(g, atlas.hero, p.x, p.y, R * 2.5, 0);
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
    cyto.addColorStop(0, 'rgba(255, 240, 210, 0.95)');
    cyto.addColorStop(0.6, 'rgba(255, 220, 170, 0.65)');
    cyto.addColorStop(1, 'rgba(255, 210, 160, 0.35)');
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
    g.lineWidth = 4;
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
    const glow = g.createRadialGradient(c.x, c.y, c.radius * 0.4, c.x, c.y, c.radius * 1.5);
    glow.addColorStop(0, 'rgba(255, 92, 122, 0.22)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(c.x, c.y, c.radius * 1.5, 0, TAU); g.fill();
    g.restore();
    // Wavy membrane edge (slow amoeboid breathing). The body draws at
    // 0.8x radius so the red mass never outshines the hero; the thick
    // integrity ring below marks the true defended radius.
    const bodyR = c.radius * 0.8;
    g.beginPath();
    for (let i = 0; i <= 24; i += 1) {
      const a = (i / 24) * TAU;
      const r = bodyR * (1 + 0.06 * Math.sin(3 * a + time * 1.2));
      const px = c.x + Math.cos(a) * r;
      const py = c.y + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    const grad = g.createRadialGradient(c.x, c.y, 6, c.x, c.y, bodyR);
    grad.addColorStop(0, '#fff0d8');
    grad.addColorStop(0.6, col);
    grad.addColorStop(1, '#7d1f30');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.stroke();
    // Thick integrity ring at the true radius (HP-coloured).
    g.strokeStyle = col;
    g.globalAlpha = 0.9;
    g.lineWidth = 4;
    g.beginPath(); g.arc(c.x, c.y, c.radius, 0, TAU); g.stroke();
    g.globalAlpha = 1;
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
    // (Core HP reads in the HUD ORGAN % block — no small mid-arena number.)
  }

  // --- Boss Miasma Prime: layered capsid + 2 sine-chain tentacles + toxin core ---
  function drawBoss(g, e, time) {
    const pulse = 1 + 0.08 * Math.sin(time * 4);
    const frac = e.maxHp ? e.hp / e.maxHp : 1;
    // V3 — atlas boss base FIRST: layered purple-magenta crystal core, 3
    // hexagonal armor segments, gradient tentacles, Fresnel rim. The live
    // procedural tentacles (below) sweep on top of it.
    drawAtlasSprite(g, atlas.boss, e.x, e.y, e.radius * 2.9, 0);
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
    // The atlas now carries the layered capsid + spikes; only the pulsing
    // toxin core glow stays procedural (it breathes with the heartbeat).
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
    // V3 — layered crystal core: a faceted hexagonal crystal over the glow.
    g.save();
    g.translate(e.x, e.y);
    g.rotate(time * 0.25);
    const cr = coreR * 1.5;
    const cgrad = g.createLinearGradient(-cr, -cr, cr, cr);
    cgrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    cgrad.addColorStop(0.5, 'rgba(199, 125, 255, 0.85)');
    cgrad.addColorStop(1, 'rgba(90, 20, 140, 0.9)');
    g.fillStyle = cgrad;
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      const px = Math.cos(a) * cr;
      const py = Math.sin(a) * cr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.75)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      g.beginPath(); g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * cr, Math.sin(a) * cr); g.stroke();
    }
    g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU;
      const px = Math.cos(a) * cr * 0.55;
      const py = Math.sin(a) * cr * 0.55;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.stroke();
    g.restore();
    // V3 — rotating energy rings + light cracks across the capsid.
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let r = 0; r < 2; r += 1) {
      const rr = e.radius * (1.28 + r * 0.2);
      const rot = time * (r === 0 ? 0.7 : -0.5) + r * 2;
      g.strokeStyle = r === 0 ? 'rgba(199, 125, 255, 0.75)' : 'rgba(125, 249, 255, 0.55)';
      g.lineWidth = r === 0 ? 3 : 2;
      g.setLineDash([26, 18]);
      g.lineDashOffset = -rot * 40;
      g.beginPath(); g.arc(e.x, e.y, rr, 0, TAU); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(e.x, e.y, rr, rot, rot + 1.1); g.stroke();
    }
    // Light cracks across the capsid: more (and brighter) as the armor
    // breaks — 2 hairlines at full integrity, 6 glowing fractures near death.
    const crackCount = frac >= 0.67 ? 2 : frac >= 0.34 ? 4 : 6;
    g.strokeStyle = `rgba(255, 240, 255, ${0.35 + (1 - frac) * 0.5})`;
    g.lineWidth = 1.5;
    for (let i = 0; i < crackCount; i += 1) {
      const a = (i / crackCount) * TAU + time * 0.15 + 0.4;
      const r0 = e.radius * 0.35;
      const r1 = e.radius * (0.95 + 0.1 * Math.sin(time * 3 + i * 2));
      const mx = e.x + Math.cos(a + 0.35) * ((r0 + r1) / 2);
      const my = e.y + Math.sin(a + 0.35) * ((r0 + r1) / 2);
      g.beginPath();
      g.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
      g.lineTo(mx, my);
      g.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
      g.stroke();
    }
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
    // V3 — Cyan Fibrin Thread Triangle (effects.js drawFibrinWeb): when 3+
    // nodes link, the triangle fills with a transparent energy web and
    // burns with circular shockwaves at its centroid; the beams themselves
    // are thick, bright cyan under 'lighter'. (Render only — link state
    // is untouched.)
    const linkedNodes = world.nodes.filter((n) => n.active && n.linked);
    if (linkedNodes.length >= 3) {
      const tri = linkedNodes.slice(0, 3);
      g.save();
      g.globalCompositeOperation = 'lighter';
      drawFibrinWeb(g, tri, time);
      g.restore();
    }
    // Fibrin threads: thick glowing cyan filaments between linked nodes.
    for (const t of world.threads) {
      if (!t.active) continue;
      const alpha = Math.min(1, t.life / t.maxLife);
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(0, 245, 212, ${0.30 * alpha})`;
      g.lineWidth = 13;
      g.beginPath(); g.moveTo(t.ax, t.ay); g.lineTo(t.bx, t.by); g.stroke();
      g.strokeStyle = `rgba(0, 245, 212, ${0.9 * alpha})`;
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(t.ax, t.ay); g.lineTo(t.bx, t.by); g.stroke();
      g.strokeStyle = `rgba(255, 255, 255, ${0.85 * alpha})`;
      g.lineWidth = 2;
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

  /** V3 — Tri-Cell Golden Laser: Leukocyte Prime fires through the Silica
   * Prisms, bouncing repeatedly (hero -> other prism -> aimed prism) and
   * refracting into 3 bright beams onto Omega Chimera. The 2 Symbiotic
   * Guardian Drones add their own gold beams through the prism, so the
   * shot reads as 3 cells firing as one. During Tri-Cell Resonance the
   * hero's 2 shadow cells fire 3 parallel gold lasers toward the aim.
   * Render only, shown while the prism weapon is equipped, the boss is
   * live, and the aim sits on a Silica Prism (the shot's staged aim). */
  function drawPrismLaser(g, world) {
    const boss = world.boss;
    if (!boss || !boss.active) return;
    if (!world.player || world.player.weaponId !== 'prism') return;
    const aim = world.aim;
    if (!aim) return;
    const prisms = world.silicaPrisms || [];
    const aimPrism = prisms.find((pr) => Math.hypot(aim.x - pr.x, aim.y - pr.y) < 90);
    if (!aimPrism) return;
    const p = world.player;
    g.save();
    g.globalCompositeOperation = 'lighter';
    // Muzzle glow at the hero.
    const mg = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, 46);
    mg.addColorStop(0, 'rgba(255, 209, 102, 0.8)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = mg;
    g.beginPath(); g.arc(p.x, p.y, 46, 0, TAU); g.fill();
    // Bounce chain: hero -> every other prism -> the aimed prism.
    let from = { x: p.x, y: p.y };
    for (const pr of prisms) {
      if (pr === aimPrism) continue;
      drawLaserBeam(g, from.x, from.y, pr.x, pr.y, '#ffd166', '#ffffff');
      const flash = g.createRadialGradient(pr.x, pr.y, 2, pr.x, pr.y, 44);
      flash.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
      flash.addColorStop(0.4, 'rgba(127, 212, 255, 0.45)');
      flash.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = flash;
      g.beginPath(); g.arc(pr.x, pr.y, 44, 0, TAU); g.fill();
      from = pr;
    }
    drawLaserBeam(g, from.x, from.y, aimPrism.x, aimPrism.y, '#ffd166', '#ffffff');
    // Aimed-prism flash.
    const pg = g.createRadialGradient(aimPrism.x, aimPrism.y, 2, aimPrism.x, aimPrism.y, 60);
    pg.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    pg.addColorStop(0.4, 'rgba(127, 212, 255, 0.5)');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = pg;
    g.beginPath(); g.arc(aimPrism.x, aimPrism.y, 60, 0, TAU); g.fill();
    // Drone beams: each Symbiotic Guardian Drone fires gold through the
    // aimed prism, so the Tri-Cell volley reads as 3 cells as one.
    for (const d of (world.symbiosis && world.symbiosis.drones) || []) {
      drawLaserBeam(g, d.x, d.y, aimPrism.x, aimPrism.y, '#ffd166', '#ffffff');
    }
    // Prism -> boss: 3 refracted beams (gold, cyan, white-gold).
    const r = boss.radius || 60;
    const targets = [
      { x: boss.x, y: boss.y, col: '#ffd166' },
      { x: boss.x - r * 0.85, y: boss.y + r * 0.55, col: '#7fd4ff' },
      { x: boss.x + r * 0.75, y: boss.y - r * 0.6, col: '#fff3c4' },
    ];
    for (const t of targets) drawLaserBeam(g, aimPrism.x, aimPrism.y, t.x, t.y, t.col, '#ffffff');
    // Impact glow on the boss.
    const ig = g.createRadialGradient(boss.x, boss.y, 2, boss.x, boss.y, r * 1.3);
    ig.addColorStop(0, 'rgba(255, 240, 200, 0.75)');
    ig.addColorStop(0.5, 'rgba(255, 209, 102, 0.3)');
    ig.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ig;
    g.beginPath(); g.arc(boss.x, boss.y, r * 1.3, 0, TAU); g.fill();
    g.restore();
    // Tri-Cell Resonance: 2 translucent shadow cells flank the hero and
    // fire 3 parallel gold lasers toward the aim.
    if (world.fusion && world.fusion.resonance > 0) {
      const angle = Math.atan2(aim.y - p.y, aim.x - p.x);
      const px = -Math.sin(angle);
      const py = Math.cos(angle);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = -1; i <= 1; i += 1) {
        const sx = p.x + px * i * 55;
        const sy = p.y + py * i * 55;
        if (i !== 0) {
          g.globalAlpha = 0.35;
          g.fillStyle = '#ffd166';
          g.beginPath(); g.arc(sx, sy, 16, 0, TAU); g.fill();
          g.globalAlpha = 1;
        }
        drawLaserBeam(g, sx, sy, sx + Math.cos(angle) * 420, sy + Math.sin(angle) * 420, '#ffd166', '#ffffff');
      }
      g.restore();
    }
  }

  /** V3 — Fibrin Triangle Laser Amplifier beams: while the triangle is
   * linked, 5 dual-polarity beams lock from the triangle centroid onto
   * Cancer Cells and Omega Chimera (the amplifier's live targets). */
  function drawAmplifierBeams(g, world) {
    const tri = triangleNodes(world);
    if (!tri) return;
    const c = triangleCentroid(world);
    if (!c) return;
    const targets = amplifierTargets(world);
    if (targets.length === 0) return;
    const p = world.player;
    const opposite = p.polarity === 'bio' ? '#c77dff' : '#ffd166';
    const own = p.polarity === 'bio' ? '#ffd166' : '#c77dff';
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i];
      drawLaserBeam(g, c.x, c.y, t.x, t.y, i % 2 === 0 ? own : opposite, '#ffffff');
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
      if (!n.active || !n.crit) continue; // Zero-clutter: only big crit numbers.
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
    // Z0 caustic bands REMOVED (SHIELD-2 FPS fix): the 3 rotated
    // full-field 'lighter' washes cost ~12 fps under SwiftShader
    // (53 fps with them off vs ~41 with them on, same method) for a
    // barely-visible shimmer. The V2 plasma caustics (drawPlasmaCaustics,
    // called below) carry the subsurface-glow look instead, and the
    // hexagonal alveoli grid is baked into bgCanvas (see buildBackground).
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
    // V3 — Glowing Vortex Rings (3D glowing energy portal rings): the old
    // flat red rectangles are gone. Each wall renders as a glowing organic
    // energy ring gate with curving particle streams. Positions/sizes
    // (collision) are unchanged — render only, in the same rects the
    // campaign defines.
    for (const p of world.alveolarWalls || []) {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const rx = p.w * 0.72;
      const ry = p.h * 0.62;
      const breathe = 1 + 0.04 * Math.sin(world.time * 2.4 + cx * 0.01);
      // Atlas valve sprite under the procedural rings: the portal's
      // glowing 3D base (subsurface glow + Fresnel rim + flow particles).
      drawAtlasSprite(g, atlas.valve, cx, cy, Math.max(rx, ry) * 2.6, 0);
      g.save();
      g.globalCompositeOperation = 'lighter';
      // Halo + translucent energy fill inside the gate.
      const gg = g.createRadialGradient(cx, cy, 4, cx, cy, Math.max(rx, ry) * 1.9);
      gg.addColorStop(0, 'rgba(0, 245, 212, 0.30)');
      gg.addColorStop(0.55, 'rgba(255, 209, 102, 0.12)');
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.ellipse(cx, cy, rx * 1.9, ry * 1.9, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(0, 245, 212, 0.07)';
      g.beginPath(); g.ellipse(cx, cy, rx * breathe, ry * breathe, 0, 0, TAU); g.fill();
      // Organic double ring: teal outer, gold inner, gently wobbling.
      g.strokeStyle = 'rgba(0, 245, 212, 0.9)';
      g.lineWidth = 4;
      g.beginPath(); g.ellipse(cx, cy, rx * breathe, ry * breathe, 0, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(255, 209, 102, 0.85)';
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(cx, cy, rx * 0.78 * breathe, ry * 0.78 * breathe, 0, 0, TAU); g.stroke();
      // Rotating arc highlights on the outer ring.
      const rot = world.time * 0.9 + cx * 0.01;
      g.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(cx, cy, rx * breathe, ry * breathe, 0, rot, rot + 1.2); g.stroke();
      g.strokeStyle = 'rgba(255, 209, 102, 0.7)';
      g.beginPath(); g.ellipse(cx, cy, rx * breathe, ry * breathe, 0, rot + Math.PI, rot + Math.PI + 0.9); g.stroke();
      // Curving particle streams orbiting the gate.
      for (let i = 0; i < 8; i += 1) {
        const a = world.time * 0.8 + (i / 8) * TAU + (cx > 640 ? 0.6 : 0);
        const pr = 1 + (i % 2) * 0.22;
        const px = cx + Math.cos(a) * rx * pr;
        const py = cy + Math.sin(a) * ry * pr;
        const pg = g.createRadialGradient(px, py, 0.5, px, py, 7);
        pg.addColorStop(0, i % 2 === 0 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 209, 102, 0.9)');
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = pg;
        g.beginPath(); g.arc(px, py, 7, 0, TAU); g.fill();
        // Short curved trail behind each particle.
        g.strokeStyle = `rgba(0, 245, 212, ${0.5 - (i % 3) * 0.12})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(cx, cy, rx * pr, ry * pr, 0, a - 0.35, a);
        g.stroke();
      }
      g.restore();
      // Gate spokes: 4 short radial ticks, source-over so they read solid.
      g.save();
      g.strokeStyle = 'rgba(0, 245, 212, 0.55)';
      g.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        const a = (i / 4) * TAU + Math.PI / 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * rx * 0.78, cy + Math.sin(a) * ry * 0.78);
        g.lineTo(cx + Math.cos(a) * rx * 1.02, cy + Math.sin(a) * ry * 1.02);
        g.stroke();
      }
      g.restore();
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
        const label = drugId === 'mab' ? '[ mAb ]' : ''; // Zero-clutter: only the mAb capsule is labelled.
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
        if (label) {
          g.font = '800 12px system-ui, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
          // FINAL POLISH (10:01/10:06): the label sat on the portal ring's
          // left arc — draw it up-right of the capsule, clear of the ring
          // line and the laser.
          g.strokeText(label, s.x + 34, s.y + bob - 36);
          g.fillStyle = '#ffffff';
          g.fillText(label, s.x + 34, s.y + bob - 36);
        }
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

  /** V3 — detailed microscopic weapon illustrations for the title cards.
   * Each replaces the old plain glyph (◉ / ✦ / ❖). Names are the exact
   * V3 illustration names: Tombak Perforin, Antibodi-Y, Prisma Enzim. */
  function drawTombakPerforin(g, cx, cy, s) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(cx, cy, 2, cx, cy, s * 1.5);
    gg.addColorStop(0, 'rgba(255, 209, 102, 0.5)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, s * 1.5, 0, TAU); g.fill();
    g.restore();
    // Shaft: gold gradient lance, bright core.
    const shaft = g.createLinearGradient(cx, cy + s, cx, cy - s);
    shaft.addColorStop(0, '#8a6a1f');
    shaft.addColorStop(0.6, '#ffd166');
    shaft.addColorStop(1, '#fff3c4');
    g.strokeStyle = shaft; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy + s * 0.9); g.lineTo(cx, cy - s * 0.45); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy + s * 0.7); g.lineTo(cx, cy - s * 0.35); g.stroke();
    // Three prongs at the tip.
    g.strokeStyle = '#ffd166'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy - s * 0.45); g.lineTo(cx, cy - s); g.stroke();
    g.beginPath(); g.moveTo(cx, cy - s * 0.45); g.lineTo(cx - s * 0.45, cy - s * 0.72); g.stroke();
    g.beginPath(); g.moveTo(cx, cy - s * 0.45); g.lineTo(cx + s * 0.45, cy - s * 0.72); g.stroke();
    // Energy barbs along the shaft.
    g.strokeStyle = 'rgba(255, 209, 102, 0.8)'; g.lineWidth = 2;
    for (const [dy, dir] of [[0.15, -1], [0.4, 1], [0.65, -1]]) {
      g.beginPath(); g.moveTo(cx, cy + s * dy); g.lineTo(cx + dir * s * 0.28, cy + s * (dy - 0.14)); g.stroke();
    }
    // Guard ring at the base.
    g.strokeStyle = '#ffd166'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(cx, cy + s * 0.82, s * 0.34, s * 0.12, 0, 0, TAU); g.stroke();
  }

  function drawAntibodiY(g, cx, cy, s) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(cx, cy, 2, cx, cy, s * 1.5);
    gg.addColorStop(0, 'rgba(0, 245, 212, 0.45)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, s * 1.5, 0, TAU); g.fill();
    g.restore();
    // Glowing Y-Antibody disc.
    const disc = g.createRadialGradient(cx - s * 0.2, cy - s * 0.2, 2, cx, cy, s);
    disc.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    disc.addColorStop(0.55, 'rgba(125, 249, 255, 0.75)');
    disc.addColorStop(1, 'rgba(0, 120, 110, 0.85)');
    g.fillStyle = disc;
    g.beginPath(); g.arc(cx, cy, s * 0.92, 0, TAU); g.fill();
    g.strokeStyle = '#7df9ff'; g.lineWidth = 2.5;
    g.beginPath(); g.arc(cx, cy, s * 0.92, 0, TAU); g.stroke();
    // The Y: three arms from the disc centre to binding tips.
    const tips = [
      [cx - s * 0.55, cy - s * 0.55],
      [cx + s * 0.55, cy - s * 0.55],
      [cx, cy + s * 0.62],
    ];
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineCap = 'round';
    for (const [tx, ty] of tips) {
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke();
    }
    g.strokeStyle = '#ffd166'; g.lineWidth = 2;
    for (const [tx, ty] of tips) {
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke();
    }
    for (const [tx, ty] of tips) {
      g.fillStyle = '#ffd166';
      g.beginPath(); g.arc(tx, ty, s * 0.13, 0, TAU); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(tx, ty, s * 0.06, 0, TAU); g.fill();
    }
  }

  function drawPrismaEnzim(g, cx, cy, s) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(cx, cy, 2, cx, cy, s * 1.5);
    gg.addColorStop(0, 'rgba(127, 212, 255, 0.5)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, s * 1.5, 0, TAU); g.fill();
    g.restore();
    // Hexagonal crystal prism with facets.
    const grad = g.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.5, 'rgba(127, 212, 255, 0.85)');
    grad.addColorStop(1, 'rgba(140, 90, 255, 0.9)');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const px = cx + Math.cos(a) * s * 0.9;
      const py = cy + Math.sin(a) * s * 0.9;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU - Math.PI / 2;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * s * 0.9, cy + Math.sin(a) * s * 0.9); g.stroke();
    }
    g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const px = cx + Math.cos(a) * s * 0.45;
      const py = cy + Math.sin(a) * s * 0.45;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath(); g.stroke();
    // Refraction rays fanning out to the right.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const rays = [['#ffd166', -0.5], ['#7fd4ff', 0], ['#ffffff', 0.5]];
    for (const [col, da] of rays) {
      g.strokeStyle = col; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + s * 0.7, cy);
      g.lineTo(cx + s * 1.7, cy + Math.sin(da) * s * 0.9); g.stroke();
    }
    g.restore();
  }

  /** V3 title — Structured Bento-Panel Cover + Live Arena Preview
   * (SUNWRIGHT audit 08:47): a dense gold-cyan framed panel grid, NO black
   * empty middle. Header logo + subtitle; left column HOW IT WORKS legend
   * + action/difficulty panel (DEPLOY + BEST + GENE BANK + 3 protocols);
   * right column a Live Miniature Arena Preview (real mini battle);
   * footer control ribbon. The 3 weapon cards are gone (superseded). */
  function drawTitle(g, world, best) {
    // Background: deep teal-navy gradient, god rays, dense erythrocytes,
    // layered vessel walls — the bento panels sit on living plasma.
    const tg = g.createLinearGradient(0, 0, 0, H);
    tg.addColorStop(0, '#0a2530');
    tg.addColorStop(0.55, '#081a24');
    tg.addColorStop(1, '#050d16');
    g.fillStyle = tg;
    g.fillRect(0, 0, W, H);
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
    for (const e of titleErythrocytes) drawErythrocyte(g, e, world.time, true);
    drawVesselWalls(g, world.time, false);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // --- Header: giant metallic-gold logo + subtitle. ---
    const logoGrad = g.createLinearGradient(0, 40, 0, 100);
    logoGrad.addColorStop(0, '#fff3c4');
    logoGrad.addColorStop(0.5, '#ffd166');
    logoGrad.addColorStop(1, '#c98a1b');
    g.fillStyle = logoGrad;
    g.font = '800 56px system-ui, sans-serif';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.shadowColor = '#ffd166';
    g.shadowBlur = 24;
    g.strokeText('CYTOGUARD: THE VITAL SURGE', 640, 72);
    g.fillText('CYTOGUARD: THE VITAL SURGE', 640, 72);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.font = '700 20px system-ui, sans-serif';
    g.fillText('5 IMMUNE CLASSES • 15 WAVES • 4 ORGANS • GENE BANK • 3 PROTOCOLS', 640, 114);

    // --- Left column, top: HOW IT WORKS legend (6 rows, 18 px body). ---
    const bestLabel = best > 0
      ? String(best).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      : '48.200';
    g.fillStyle = 'rgba(8, 14, 22, 0.82)';
    fillGlass(g, 40, 140, 620, 300, 12);
    g.strokeStyle = 'rgba(255, 209, 102, 0.7)';
    g.lineWidth = 2;
    glassPanel(g, 40, 140, 620, 300, 12);
    g.stroke();
    g.fillStyle = '#ffd166';
    g.font = '800 22px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('HOW IT WORKS', 60, 168);
    const howRows = [
      ['◉', 'GOAL', 'Defend Organ Core across 15 waves'],
      ['Q', 'POLARITY', 'Q shifts Gold/Violet — 2.5x Crit'],
      ['⬡', 'FIBRIN', 'Space Dash links 3 Nodes into Laser Trap'],
      ['✚', 'NUTRIENTS', 'VIT 8 • PRO 6 • MIN 4 → Apex Photon Lance'],
      ['◆', 'BOSS', 'Wave 15 Apex Boss: Omega Chimera'],
      ['⬢', 'LINEAGE', 'Bank 450 GP to unlock Dendritic Prime'],
      ['✖', 'LOSE', 'Organ Core falls — the run ends'],
    ];
    for (let i = 0; i < howRows.length; i += 1) {
      const [icon, tag, text] = howRows[i];
      const y = 198 + i * 34;
      const loseRow = tag === 'LOSE';
      g.fillStyle = loseRow ? '#ff5c7a' : '#ffd166';
      g.font = '800 18px system-ui, sans-serif';
      g.fillText(icon, 60, y);
      g.fillStyle = loseRow ? '#ff5c7a' : '#7df9ff';
      fitText(g, `[${tag}]`, 130, 18, 800);
      const tagW = g.measureText(`[${tag}]`).width;
      g.fillText(`[${tag}]`, 92, y);
      g.fillStyle = '#ffffff';
      g.font = '600 18px system-ui, sans-serif';
      fitText(g, text, 460, 18, 600);
      g.fillText(text, 92 + tagW + 12, y);
    }

    // --- Left column, bottom: action & difficulty panel. ---
    g.fillStyle = 'rgba(8, 14, 22, 0.82)';
    fillGlass(g, 40, 456, 620, 164, 12);
    g.strokeStyle = 'rgba(255, 209, 102, 0.7)';
    g.lineWidth = 2;
    glassPanel(g, 40, 456, 620, 164, 12);
    g.stroke();
    // Giant glowing DEPLOY CELL button.
    g.save();
    g.shadowColor = '#ffd166';
    g.shadowBlur = 22;
    g.fillStyle = '#ffd166';
    g.beginPath(); g.roundRect(TITLE_DEPLOY.x, TITLE_DEPLOY.y, TITLE_DEPLOY.w, TITLE_DEPLOY.h, 14); g.fill();
    g.restore();
    g.fillStyle = '#1a0b2e';
    g.font = '800 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('[ DEPLOY CELL ]', TITLE_DEPLOY.x + TITLE_DEPLOY.w / 2, TITLE_DEPLOY.y + 33);
    // BEST + GENE BANK badges (right of DEPLOY).
    const badge = (x, y, w, label) => {
      g.fillStyle = 'rgba(255, 209, 102, 0.16)';
      g.beginPath(); g.roundRect(x, y, w, 30, 8); g.fill();
      g.strokeStyle = 'rgba(255, 209, 102, 0.6)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#ffd166';
      g.font = '800 18px system-ui, sans-serif';
      g.fillText(label, x + w / 2, y + 16);
    };
    badge(420, 476, 200, `BEST ${bestLabel}`);
    badge(420, 516, 220, 'GENE BANK 450 GP');
    // 3 protocol buttons in a row (click sets world.protocol).
    const protos = [
      { id: 'clinical', label: '[ CLINICAL ]' },
      { id: 'virulent', label: `[ VIRULENT (BEST ${bestLabel}) ]` },
      { id: 'pandemic', label: '[ PANDEMIC ]' },
    ];
    for (let i = 0; i < 3; i += 1) {
      const r = TITLE_PROTOCOL_RECTS[i];
      const selected = (world.protocol || 'virulent') === protos[i].id;
      g.fillStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.14)';
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 10); g.fill();
      g.strokeStyle = selected ? '#ffd166' : 'rgba(255,255,255,0.4)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = selected ? '#1a0b2e' : '#ffffff';
      g.font = '800 18px system-ui, sans-serif';
      fitText(g, protos[i].label, r.w - 20, 18, 800);
      g.fillText(protos[i].label, r.x + r.w / 2, r.y + 25);
    }

    // --- Right column: Live Miniature Arena Preview box. ---
    g.fillStyle = 'rgba(8, 14, 22, 0.82)';
    fillGlass(g, 690, 140, 550, 480, 12);
    g.strokeStyle = 'rgba(0, 245, 212, 0.7)';
    g.lineWidth = 2;
    glassPanel(g, 690, 140, 550, 480, 12);
    g.stroke();
    // LIVE pulsing dot + header.
    const livePulse = 0.5 + 0.5 * Math.sin(world.time * 4);
    g.fillStyle = `rgba(255, 46, 77, ${0.6 + 0.4 * livePulse})`;
    g.beginPath(); g.arc(716, 168, 7, 0, TAU); g.fill();
    g.fillStyle = '#00f5d4';
    g.font = '800 20px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('LIVE ARENA PREVIEW', 732, 168);
    // The mini battle, clipped to the box.
    g.save();
    g.beginPath(); g.rect(700, 186, 530, 424); g.clip();
    const pbg = g.createLinearGradient(0, 186, 0, 610);
    pbg.addColorStop(0, '#0a2530');
    pbg.addColorStop(1, '#050d16');
    g.fillStyle = pbg;
    g.fillRect(700, 186, 530, 424);
    for (let i = 0; i < 4; i += 1) {
      drawErythrocyte(g, { x: 760 + i * 130, y: 260 + (i % 2) * 180, r: 34, vx: 0, bobPhase: i, alpha: 0.10, depth: 0.5 }, world.time, true);
    }
    // Mini laser: hero -> prism -> prism -> boss, with a 3-beam fan.
    g.globalCompositeOperation = 'lighter';
    drawLaserBeam(g, 820, 500, 880, 420, '#ffd166', '#ffffff');
    drawLaserBeam(g, 880, 420, 1010, 320, '#ffd166', '#ffffff');
    drawLaserBeam(g, 1010, 320, 1150, 280, '#ffd166', '#ffffff');
    drawLaserBeam(g, 1010, 320, 1120, 330, '#7fd4ff', '#ffffff');
    drawLaserBeam(g, 1010, 320, 1140, 240, '#fff3c4', '#ffffff');
    g.globalCompositeOperation = 'source-over';
    // Mini prisms.
    for (const [px, py, pr] of [[880, 420, 22], [1010, 320, 26]]) {
      g.save();
      g.translate(px, py);
      g.rotate(world.time * 0.5);
      const c = getSprite('prism', 128, 128, prismSprite);
      g.drawImage(c, -pr * 1.4, -pr * 1.4, pr * 2.8, pr * 2.8);
      g.restore();
    }
    // Mini bacteria + drones + hero + boss.
    drawSprite(g, 'bacillus-bio', 980, 490, 42, 28, 0.6, (sg) => bacillusSprite(sg, 'bio'));
    drawSprite(g, 'phage-toxin', 1080, 430, 38, 38, 0, (sg) => phageSprite(sg, 'toxin'));
    drawSprite(g, 'plastic', 900, 300, 36, 36, world.time * 0.3, plasticSprite);
    drawVolumetricCell(g, 860, 450, 13, world.time, 'rgba(0,245,212,0.7)', '#ffd166');
    drawVolumetricCell(g, 790, 445, 13, world.time, 'rgba(0,245,212,0.7)', '#ffd166');
    drawVolumetricCell(g, 820, 500, 26, world.time, 'rgba(255,209,102,0.7)', '#ffd166');
    drawBoss(g, { x: 1150, y: 280, radius: 54, hp: 100, maxHp: 100, telegraph: 0, laserPhase: 'rest', laserAngle: 0 }, world.time);
    g.restore();
    // Preview caption.
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '600 16px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Leukocyte Prime vs Omega Chimera — live from Wave 7', 965, 600);
    // FINAL PIXEL TOUCH (10:03): status badge, bottom-right corner of the
    // Live Arena Preview box (own row above the caption, right-aligned).
    const badgeText = '[ LIVE ENGINE • 60 FPS ]';
    g.font = '800 14px system-ui, sans-serif';
    const badgeW = g.measureText(badgeText).width;
    const badgeX = 1240 - 16 - badgeW - 24;
    const badgeY = 550;
    g.fillStyle = 'rgba(6, 13, 24, 0.85)';
    g.beginPath(); g.roundRect(badgeX, badgeY, badgeW + 24, 28, 8); g.fill();
    g.strokeStyle = 'rgba(0, 245, 212, 0.7)'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#00f5d4';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(badgeText, badgeX + (badgeW + 24) / 2, badgeY + 14);

    // --- Footer: neat control ribbon. ---
    g.fillStyle = 'rgba(8, 14, 22, 0.82)';
    fillGlass(g, 40, 644, 1200, 40, 10);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 2;
    glassPanel(g, 40, 644, 1200, 40, 10);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = '700 18px system-ui, sans-serif';
    g.fillText('WASD MOVE  •  MOUSE AIM  •  Q POLARITY  •  SPACE FIBRIN DASH  •  V VALVE  •  M MUTE', 640, 665);
    // Bio-Codex button (top-right corner) + drawer.
    // FINAL PIXEL TOUCH (10:03): outer dark drop-shadow on the frame.
    g.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g.beginPath(); g.roundRect(CODEX_BUTTON.x + 3, CODEX_BUTTON.y + 4, CODEX_BUTTON.w, CODEX_BUTTON.h, 8); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.roundRect(CODEX_BUTTON.x, CODEX_BUTTON.y, CODEX_BUTTON.w, CODEX_BUTTON.h, 8); g.fill();
    g.fillStyle = '#060d18'; g.font = '800 15px system-ui, sans-serif';
    g.fillText('[ BIO-CODEX ]', CODEX_BUTTON.x + CODEX_BUTTON.w / 2, CODEX_BUTTON.y + 20);
    if (world.codexOpen) {
      g.fillStyle = 'rgba(6, 13, 24, 0.94)';
      g.beginPath(); g.roundRect(760, 60, 460, 420, 14); g.fill();
      g.strokeStyle = '#00f5d4'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#00f5d4'; g.font = '800 24px system-ui, sans-serif'; g.textAlign = 'left';
      g.fillText('BIO-CODEX', 790, 100);
      const entries = ['T-Cell Lance — precision perforin lance.', 'Plasma Chakram — orbiting antibody chakram.', 'Macrophage Prism — refracts into 3 beams.', 'NK-Cell Supernova — Cytokine Storm on Q.', 'Dendritic Prime — 600 GP, 2 antibody drones.', 'Bacillus — rod pathogen, chains to the Core.', 'Bacteriophage — hexagonal virion, ranged.', 'Microplastic — jagged crystal shard.', 'Malignant Tumor — mAb cures it.', 'Omega Chimera — 75% carapace vs Grade 1-3.'];
      g.fillStyle = '#ffffff'; g.font = '600 16px system-ui, sans-serif';
      entries.forEach((e, i) => g.fillText(e, 790, 132 + i * 32));
    }
  }

  /** V3 — unique Gene Splice card icons (never the same DNA icon twice).
   * Card 1: 3-Beam Refraction Prism. Card 2: Symbiotic Cell & Golden DNA
   * Crown. Card 3: Glowing Vascular Flow Valve. */
  function drawPrismaPembias(g, cx, cy, s, colour) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(cx, cy, 2, cx, cy, s * 1.6);
    gg.addColorStop(0, 'rgba(127, 212, 255, 0.45)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, s * 1.6, 0, TAU); g.fill();
    g.restore();
    // Triangular refraction prism.
    const grad = g.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.5, colour);
    grad.addColorStop(1, 'rgba(20, 60, 140, 0.9)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.lineTo(cx + s * 0.9, cy + s * 0.7);
    g.lineTo(cx - s * 0.9, cy + s * 0.7);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.55)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s * 0.2); g.stroke();
    g.beginPath(); g.moveTo(cx - s * 0.9, cy + s * 0.7); g.lineTo(cx, cy + s * 0.2); g.stroke();
    g.beginPath(); g.moveTo(cx + s * 0.9, cy + s * 0.7); g.lineTo(cx, cy + s * 0.2); g.stroke();
    // 3 refracted beams leaving the prism.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const beams = [['#ffd166', -0.45], ['#7fd4ff', 0], ['#ffffff', 0.45]];
    for (const [col, da] of beams) {
      g.strokeStyle = col; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx, cy + s * 0.2);
      g.lineTo(cx + Math.sin(da) * s * 1.1, cy + s * 0.2 + Math.cos(da) * s * 1.3); g.stroke();
    }
    g.restore();
  }

  function drawSelSimbiotik(g, cx, cy, s, colour) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(cx, cy + s * 0.3, 2, cx, cy + s * 0.3, s * 1.6);
    gg.addColorStop(0, 'rgba(255, 209, 102, 0.45)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy + s * 0.3, s * 1.6, 0, TAU); g.fill();
    g.restore();
    // Golden DNA crown: a small double helix arc above the cell.
    g.strokeStyle = '#ffd166'; g.lineWidth = 2.5;
    for (const ph of [0, Math.PI]) {
      g.beginPath();
      for (let t = 0; t <= 1.001; t += 0.1) {
        const px = cx - s * 0.7 + t * s * 1.4;
        const py = cy - s * 0.85 + Math.sin(t * Math.PI * 2 + ph) * s * 0.16;
        if (t === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(255, 209, 102, 0.6)'; g.lineWidth = 1.5;
    for (let t = 0.1; t < 1; t += 0.2) {
      const px = cx - s * 0.7 + t * s * 1.4;
      const py = cy - s * 0.85;
      g.beginPath(); g.moveTo(px, py - s * 0.16); g.lineTo(px, py + s * 0.16); g.stroke();
    }
    // Symbiotic cell: teal orb, gold nucleus, two orbiting drones.
    const cellY = cy + s * 0.28;
    const cg = g.createRadialGradient(cx - s * 0.2, cellY - s * 0.2, 2, cx, cellY, s * 0.62);
    cg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    cg.addColorStop(0.5, colour);
    cg.addColorStop(1, 'rgba(0, 90, 80, 0.9)');
    g.fillStyle = cg;
    g.beginPath(); g.arc(cx, cellY, s * 0.62, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.8)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#ffd166';
    g.beginPath(); g.arc(cx, cellY, s * 0.22, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(cx, cellY, s * 0.1, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0, 245, 212, 0.7)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cellY, s * 0.85, 0.6, 0.6 + 1.2); g.stroke();
    g.beginPath(); g.arc(cx, cellY, s * 0.85, Math.PI + 0.6, Math.PI + 0.6 + 1.2); g.stroke();
  }

  function drawPortalArus(g, cx, cy, s, colour) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gg = g.createRadialGradient(cx, cy, 2, cx, cy, s * 1.6);
    gg.addColorStop(0, 'rgba(0, 245, 212, 0.45)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.beginPath(); g.arc(cx, cy, s * 1.6, 0, TAU); g.fill();
    g.restore();
    // Glowing vascular flow valve: double ring gate + flow lines.
    g.strokeStyle = colour; g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, s * 0.85, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd166'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, s * 0.62, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.8)'; g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, s * 0.85, 0.4, 0.4 + 1.3); g.stroke();
    // Flow lines curving through the valve.
    g.strokeStyle = 'rgba(0, 245, 212, 0.85)'; g.lineWidth = 2.5;
    for (const off of [-0.4, 0, 0.4]) {
      g.beginPath();
      g.moveTo(cx - s * 1.3, cy + off * s);
      g.quadraticCurveTo(cx, cy + off * s - s * 0.25, cx + s * 1.3, cy + off * s);
      g.stroke();
    }
    // Valve spokes.
    g.strokeStyle = 'rgba(255, 255, 255, 0.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + Math.PI / 4;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62);
      g.lineTo(cx + Math.cos(a) * s * 0.85, cy + Math.sin(a) * s * 0.85);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(cx, cy, s * 0.1, 0, TAU); g.fill();
  }

  /** V3 upgrade — 3 Giant Glowing Bio-Medallions (1, 2, 3) over a BRIGHT
   * alive alveoli arena (SUNWRIGHT audit 08:47, anti-mess rules 08:49):
   * the battle board stays bright behind the draft, a gold header banner,
   * 3 evenly spaced circular medallions with colourful segment rings
   * (Gold / Cyan / Violet) + one unique big illustration icon each, and
   * IDENTICAL description boxes below (name / desc / synergy tag / cost /
   * omen). Route buttons [ ROUTE A: LUNGS ] / [ ROUTE B: LIVER ] aligned
   * below. No SKIP button is rendered (keyboard C still skips). */
  function drawUpgrade(g, world) {
    // A LIGHT veil: the arena stays bright & alive behind the medallions.
    // (SHIELD-2 fix: the old 0.18 veil + faint glows read dark teal and
    // dim — the veil is thinner now and the halos ~70% brighter so the
    // alveoli arena light shows through behind the 3 medallions.)
    g.fillStyle = 'rgba(8, 4, 10, 0.08)';
    g.fillRect(0, 0, W, H);
    // Bright glowing alveoli arena light: additive teal/gold halos + soft
    // alveoli hexagons, never flat dark.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const glows = [
      [640, 330, 430, 'rgba(0, 245, 212, 0.24)'],
      [325, 340, 260, 'rgba(255, 209, 102, 0.20)'],
      [955, 340, 260, 'rgba(199, 125, 255, 0.17)'],
    ];
    for (const [gx, gy, gr, gc] of glows) {
      const gg = g.createRadialGradient(gx, gy, 4, gx, gy, gr);
      gg.addColorStop(0, gc);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gg;
      g.beginPath(); g.arc(gx, gy, gr, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(0, 245, 212, 0.30)'; g.lineWidth = 2;
    for (const [hx, hy, hr] of [[180, 620, 90], [1100, 90, 80], [640, 60, 70]]) {
      g.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        const px = hx + Math.cos(a) * hr;
        const py = hy + Math.sin(a) * hr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath(); g.stroke();
    }
    g.restore();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Gold header banner: WAVE 6 CLEARED — SELECT GENE SPLICE.
    g.fillStyle = 'rgba(8, 4, 10, 0.72)';
    fillGlass(g, 240, 44, 800, 56, 12);
    g.strokeStyle = '#ffd166';
    g.lineWidth = 2;
    glassPanel(g, 240, 44, 800, 56, 12);
    g.stroke();
    g.fillStyle = '#ffd166';
    g.font = '800 30px system-ui, sans-serif';
    fitText(g, `WAVE ${world.wave} CLEARED — SELECT GENE SPLICE`, 760, 30, 800);
    g.fillText(`WAVE ${world.wave} CLEARED — SELECT GENE SPLICE`, 640, 73);
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = '600 18px system-ui, sans-serif';
    g.fillText(`NUTRIENTS ${world.nutrientPoints ?? 0}  •  CHAIN x${world.maxChain}  •  Each Gene Splice carries a Pathogen Mutation for the next wave.`, 640, 122);
    // 3 Giant Circular Medallions, evenly spaced.
    const medColours = ['#ffd166', '#00f5d4', '#c77dff'];
    const medCentres = [280, 640, 1000];
    for (let i = 0; i < 3; i += 1) {
      const card = world.choices[i];
      const cx = medCentres[i];
      const cy = 305;
      const R = 125;
      if (!card) continue;
      const affordable = (world.nutrientPoints ?? 0) >= card.cost;
      const unlocked = !!card.synergyId && ((world.upgradesOwned && world.upgradesOwned[card.synergyId] > 0) || (world.evolutions && world.evolutions.includes(card.synergyId)));
      // Medallion body: dark glass disc + glowing segment ring.
      g.fillStyle = affordable ? 'rgba(20, 10, 24, 0.88)' : 'rgba(20, 10, 24, 0.55)';
      g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
      g.save();
      g.globalCompositeOperation = 'lighter';
      const mg = g.createRadialGradient(cx, cy, 10, cx, cy, R * 1.35);
      mg.addColorStop(0, `${medColours[i]}33`);
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = mg;
      g.beginPath(); g.arc(cx, cy, R * 1.35, 0, TAU); g.fill();
      g.restore();
      // Segment ring: 3 arcs in the medallion colour + white hairline.
      g.strokeStyle = medColours[i];
      g.lineWidth = 7;
      for (let s = 0; s < 3; s += 1) {
        const a0 = -Math.PI / 2 + s * (TAU / 3) + 0.12;
        g.beginPath(); g.arc(cx, cy, R - 4, a0, a0 + TAU / 3 - 0.24); g.stroke();
      }
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, R - 14, 0, TAU); g.stroke();
      if (unlocked) {
        g.strokeStyle = '#ffd166';
        g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, R - 22, 0, TAU); g.stroke();
      }
      // Numeral badge at the top of the medallion.
      g.fillStyle = '#ffd166';
      g.beginPath(); g.arc(cx, cy - R, 22, 0, TAU); g.fill();
      g.strokeStyle = '#1a0b2e';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = '#1a0b2e';
      g.font = '800 26px system-ui, sans-serif';
      g.fillText(`${i + 1}`, cx, cy - R + 1);
      // One unique big illustration icon per medallion (never the same
      // DNA icon): Prisma Pembias 3 Sinar / Sel Simbiotik & Mahkota DNA
      // Emas / Portal Arus Vaskular Bercahaya.
      if (card.id === 'crisprPrismCore') drawPrismaPembias(g, cx, cy, 64, '#7fd4ff');
      else if (card.id === 'symbioticReprogramming') drawSelSimbiotik(g, cx, cy, 64, '#00f5d4');
      else if (card.id === 'vascularValveSurge') drawPortalArus(g, cx, cy, 64, '#00f5d4');
      else drawDnaHelix(g, cx, cy, 64, '#ffd166');
      // Identical description box below each medallion (300x140).
      const bx = cx - 150;
      const by = 445;
      g.fillStyle = 'rgba(8, 14, 22, 0.85)';
      fillGlass(g, bx, by, 300, 140, 12);
      g.strokeStyle = medColours[i];
      g.lineWidth = 2;
      glassPanel(g, bx, by, 300, 140, 12);
      g.stroke();
      fitText(g, card.name, 272, 20, 800);
      g.fillStyle = '#ffffff';
      g.fillText(card.name, cx, by + 24);
      fitText(g, card.desc, 272, 18, 600);
      g.fillStyle = '#ffd166';
      g.fillText(card.desc, cx, by + 50);
      fitText(g, `+ ${card.synergy}`, 272, 18, 600);
      g.fillStyle = '#7dff9e';
      g.fillText(`+ ${card.synergy}`, cx, by + 76);
      g.fillStyle = affordable ? '#ffd166' : '#ff5c7a';
      g.font = '800 18px system-ui, sans-serif';
      g.fillText(`◉ ${card.cost} GP`, cx, by + 102);
      fitText(g, `⚠ ${card.omen.name}`, 272, 18, 700);
      g.fillStyle = '#ff8fa3';
      g.fillText(`⚠ ${card.omen.name}`, cx, by + 126);
    }
    // Route buttons, precisely aligned below.
    g.fillStyle = '#00f5d4';
    g.beginPath(); g.roundRect(ROUTE_A.x, ROUTE_A.y, ROUTE_A.w, ROUTE_A.h, 12); g.fill();
    g.fillStyle = '#060d18'; g.font = '800 20px system-ui, sans-serif';
    g.fillText('[ ROUTE A: LUNGS ]', ROUTE_A.x + ROUTE_A.w / 2, ROUTE_A.y + 27);
    g.fillStyle = '#ffd166';
    g.beginPath(); g.roundRect(ROUTE_B.x, ROUTE_B.y, ROUTE_B.w, ROUTE_B.h, 12); g.fill();
    g.fillStyle = '#060d18';
    g.fillText('[ ROUTE B: LIVER ]', ROUTE_B.x + ROUTE_B.w / 2, ROUTE_B.y + 27);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = '600 16px system-ui, sans-serif';
    g.fillText('NEXT ORGAN ROUTE:', 640, 600);
  }

  function rankForScore(score) {
    if (score >= 12000) return 'S+';
    if (score >= 9000) return 'S';
    if (score >= 6000) return 'A';
    if (score >= 3000) return 'B';
    return 'C';
  }

  /** V3 victory — Commercial-Grade Victory Card (SUNWRIGHT audit 08:47,
   * anti-mess rules 08:49): header banner, then two pixel-aligned columns
   * (same top y 112, same bottom y 668). Left: cracked & dimmed Boss
   * Omega Chimera + BOSS PURGED IN 0:23 + YOUR BUILD (8 MUTATIONS) panel
   * + the closing lore exactly once. Right: big gold result card — giant
   * S+ badge + big score + NEW BEST, 4 stat boxes, LAST 3 RUNS, CELL
   * LINEAGE BANK row, 3 giant action buttons. The 15-point ECG chart is
   * gone (superseded); the defeat screen keeps its own layout. */
  function drawEndScreen(g, world, best, win) {
    // Victory: a light teal-cyan veil so the healthy vessels show clear
    // and sparkling cyan-gold again behind the panel.
    g.fillStyle = win ? 'rgba(8, 30, 34, 0.55)' : 'rgba(20, 4, 8, 0.78)';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (!win) {
      // --- Defeat screen (unchanged V2 layout). ---
      g.fillStyle = '#ff5c7a';
      g.font = '800 56px system-ui, sans-serif';
      g.fillText('ORGAN COLLAPSE', 640, 130);
      g.fillStyle = '#ffffff';
      g.font = '600 20px system-ui, sans-serif';
      g.fillText('ORGAN COLLAPSE — EPIGENETIC MEMORY SALVAGED', 640, 190);
      const s = world.stats;
      g.fillStyle = 'rgba(6, 12, 18, 0.88)';
      fillGlass(g, 340, 285, 600, 180, 14);
      g.strokeStyle = 'rgba(255,255,255,0.2)';
      glassPanel(g, 340, 285, 600, 180, 14);
      g.stroke();
      const rows = [
        ['WAVE REACHED', `${Math.max(1, world.wave)}/15`],
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
      g.textAlign = 'center';
      g.fillStyle = '#c77dff'; g.font = '800 22px system-ui, sans-serif';
      g.fillText('+110 GP SALVAGED  →  CELL LINEAGE BANK', 640, 242);
      g.fillStyle = '#ffffff'; g.font = '700 18px system-ui, sans-serif';
      g.fillText('ADAPTIVE IMMUNITY +15%  (ANTIGEN MAPPED)', 640, 270);
      g.fillStyle = 'rgba(255,255,255,0.65)';
      g.font = 'italic 400 16px system-ui, sans-serif';
      g.fillText(`“${DEFEAT_NARRATIVE}”`, 640, 640);
      const again = OVER_RETRY;
      const change = OVER_CHANGE;
      g.fillStyle = '#ffd166';
      g.beginPath(); g.roundRect(again.x, again.y, again.w, again.h, 12); g.fill();
      g.fillStyle = '#1a0b2e';
      g.font = '800 20px system-ui, sans-serif';
      g.fillText('[ EVOLVE & RETRY ]', again.x + again.w / 2, again.y + 31);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.beginPath(); g.roundRect(change.x, change.y, change.w, change.h, 12); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.stroke();
      g.fillStyle = '#ffffff';
      g.fillText('[ SPEND GP IN CELL BANK ]', change.x + change.w / 2, change.y + 31);
      return;
    }
    // --- Victory: floating light particles + header banner. ---
    g.save();
    for (let i = 0; i < 24; i += 1) {
      const mx = (i * 173 + 60) % W;
      const my = H - ((world.time * 18 + i * 97) % (H + 40)) + 20;
      g.fillStyle = i % 2 === 0 ? 'rgba(255, 209, 102, 0.8)' : 'rgba(125, 249, 255, 0.8)';
      g.beginPath(); g.arc(mx, my, 2.5 + (i % 3), 0, TAU); g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(8, 4, 10, 0.72)';
    fillGlass(g, 140, 36, 1000, 56, 12);
    g.strokeStyle = '#ffd166';
    g.lineWidth = 2;
    glassPanel(g, 140, 36, 1000, 56, 12);
    g.stroke();
    g.fillStyle = '#ffd166';
    g.font = '800 30px system-ui, sans-serif';
    fitText(g, 'OMEGA CHIMERA ERADICATED — HOMEOSTASIS RESTORED', 960, 30, 800);
    g.fillText('OMEGA CHIMERA ERADICATED — HOMEOSTASIS RESTORED', 640, 65);
    const scoreText = String(world.score).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const organPct = Math.max(0, Math.round((world.core.hp / world.core.maxHp) * 100));
    const purged = world.stats ? world.stats.kills : 0;

    // --- Left panel (x 60-580, y 112-668): boss + YOUR BUILD + lore. ---
    g.fillStyle = 'rgba(6, 12, 18, 0.88)';
    fillGlass(g, 60, 112, 520, 556, 14);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 2;
    glassPanel(g, 60, 112, 520, 556, 14);
    g.stroke();
    // Cracked & dimmed Boss Omega Chimera over the arena.
    g.save();
    g.globalAlpha = 0.55;
    drawBoss(g, { x: 320, y: 218, radius: 68, hp: 0, maxHp: 100, telegraph: 0, laserPhase: 'rest', laserAngle: 0 }, world.time);
    g.restore();
    g.save();
    g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    g.lineWidth = 2;
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * TAU + 0.7;
      g.beginPath();
      g.moveTo(320 + Math.cos(a) * 20, 218 + Math.sin(a) * 20);
      g.lineTo(320 + Math.cos(a + 0.3) * 48, 218 + Math.sin(a + 0.3) * 48);
      g.lineTo(320 + Math.cos(a - 0.2) * 66, 218 + Math.sin(a - 0.2) * 66);
      g.stroke();
    }
    g.restore();
    g.fillStyle = '#ffffff';
    g.font = '800 20px system-ui, sans-serif';
    g.fillText('BOSS PURGED IN 0:23', 320, 336);
    // YOUR BUILD (8 MUTATIONS) inner panel.
    g.fillStyle = 'rgba(8, 14, 22, 0.9)';
    fillGlass(g, 80, 358, 480, 238, 12);
    g.strokeStyle = 'rgba(255, 209, 102, 0.5)';
    g.lineWidth = 2;
    glassPanel(g, 80, 358, 480, 238, 12);
    g.stroke();
    g.fillStyle = '#ffd166';
    g.font = '800 20px system-ui, sans-serif';
    g.fillText('YOUR BUILD (8 MUTATIONS)', 320, 382);
    const build = [
      ['⬡', 'Prism Core', '#ffd166'], ['✦', 'Symbiosis', '#00f5d4'],
      ['△', 'Fibrin Trap', '#7df9ff'], ['➶', 'Apex Lance', '#ffffff'],
      ['✚', 'mAb Vial', '#ff8fa3'], ['≋', 'Valve Surge', '#7fd4ff'],
      ['8', 'Vit-8', '#7dff9e'], ['❋', 'Cytokine', '#c77dff'],
    ];
    for (let i = 0; i < 8; i += 1) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ix = col === 0 ? 108 : 328;
      const tx = col === 0 ? 136 : 356;
      const iy = 414 + row * 46;
      g.fillStyle = build[i][2];
      g.beginPath(); g.arc(ix, iy, 17, 0, TAU); g.fill();
      g.fillStyle = '#060d18';
      g.font = '800 18px system-ui, sans-serif';
      g.fillText(build[i][0], ix, iy + 1);
      g.fillStyle = '#ffffff';
      g.textAlign = 'left';
      fitText(g, build[i][1], 180, 18, 700);
      g.fillText(build[i][1], tx, iy);
      g.textAlign = 'center';
    }
    // Closing lore — exactly once, inside the left panel.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = 'italic 400 18px system-ui, sans-serif';
    g.fillText('“From Capillary Gate to Marrow Citadel, the lineage endures.”', 320, 632);

    // --- Right gold card (x 600-1220, y 112-668): S+ + score + stats. ---
    g.fillStyle = 'rgba(20, 14, 4, 0.92)';
    fillGlass(g, 600, 112, 620, 556, 14);
    g.strokeStyle = '#ffd166';
    g.lineWidth = 2;
    glassPanel(g, 600, 112, 620, 556, 14);
    g.stroke();
    // Giant S+ badge + big score + NEW BEST.
    g.fillStyle = '#ffd166';
    g.beginPath(); g.roundRect(624, 136, 110, 110, 14); g.fill();
    g.fillStyle = '#1a0b2e';
    g.font = '800 64px system-ui, sans-serif';
    g.fillText('S+', 679, 193);
    g.fillStyle = '#ffffff';
    g.font = '800 56px system-ui, sans-serif';
    g.fillText(scoreText, 880, 192);
    g.fillStyle = '#2fd47a';
    g.beginPath(); g.roundRect(1030, 166, 166, 40, 10); g.fill();
    g.fillStyle = '#06210f';
    g.font = '800 20px system-ui, sans-serif';
    g.fillText('NEW BEST', 1113, 187);
    // 4 stat boxes in a row.
    const stats = [
      ['PURGED', `${purged}`],
      ['WAVES', `${Math.max(1, world.wave)}/15`],
      ['ORGAN', `${organPct}%`],
      ['PEAK CHAIN', `x${world.maxChain}`],
    ];
    for (let i = 0; i < 4; i += 1) {
      const bx = 624 + i * 146;
      g.fillStyle = 'rgba(255, 209, 102, 0.12)';
      g.beginPath(); g.roundRect(bx, 262, 134, 80, 10); g.fill();
      g.strokeStyle = 'rgba(255, 209, 102, 0.55)';
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = '700 18px system-ui, sans-serif';
      g.fillText(stats[i][0], bx + 67, 288);
      g.fillStyle = '#ffd166';
      g.font = '800 28px system-ui, sans-serif';
      g.fillText(stats[i][1], bx + 67, 320);
    }
    // LAST 3 RUNS: 3 two-line chips.
    g.fillStyle = '#ffd166';
    g.font = '800 20px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('LAST 3 RUNS', 624, 372);
    g.textAlign = 'center';
    const runs = [
      ['✕ LOST', 'Wave 9 Hepatic', '#ff5c7a'],
      ['✕ LOST', 'Wave 14 Marrow', '#ff5c7a'],
      ['✓ WON', '15/15', '#2fd47a'],
    ];
    for (let i = 0; i < 3; i += 1) {
      const bx = 624 + i * 194;
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.beginPath(); g.roundRect(bx, 384, 184, 64, 10); g.fill();
      g.strokeStyle = runs[i][2];
      g.lineWidth = 2;
      g.stroke();
      g.fillStyle = runs[i][2];
      g.font = '800 18px system-ui, sans-serif';
      g.fillText(runs[i][0], bx + 92, 404);
      g.fillStyle = '#ffffff';
      g.font = '600 18px system-ui, sans-serif';
      g.fillText(runs[i][1], bx + 92, 430);
    }
    // CELL LINEAGE BANK row.
    g.fillStyle = 'rgba(255, 209, 102, 0.12)';
    g.beginPath(); g.roundRect(624, 468, 572, 60, 10); g.fill();
    g.strokeStyle = 'rgba(255, 209, 102, 0.55)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#ffd166';
    g.font = '800 18px system-ui, sans-serif';
    g.fillText('CELL LINEAGE BANK', 910, 488);
    g.fillStyle = '#ffffff';
    g.font = '600 18px system-ui, sans-serif';
    g.fillText('450 → 770 GP (+320 BANKED) • DENDRITIC PRIME UNLOCKED!', 910, 514);
    // 3 giant action buttons in a row.
    const again = WIN_AGAIN;
    const change = WIN_CHANGE;
    g.fillStyle = '#ffd166';
    g.beginPath(); g.roundRect(again.x, again.y, again.w, again.h, 12); g.fill();
    g.fillStyle = '#1a0b2e';
    g.font = '800 18px system-ui, sans-serif';
    fitText(g, '[ PLAY AGAIN ]', again.w - 20, 18, 800);
    g.fillText('[ PLAY AGAIN ]', again.x + again.w / 2, again.y + 37);
    g.fillStyle = '#00f5d4';
    g.beginPath(); g.roundRect(change.x, change.y, change.w, change.h, 12); g.fill();
    g.fillStyle = '#060d18';
    fitText(g, '[ ENDLESS WAVE 16+ ]', change.w - 20, 18, 800);
    g.fillText('[ ENDLESS WAVE 16+ ]', change.x + change.w / 2, change.y + 37);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath(); g.roundRect(WIN_ARMORY.x, WIN_ARMORY.y, WIN_ARMORY.w, WIN_ARMORY.h, 12); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#ffffff';
    fitText(g, '[ BIO-ARMORY ]', WIN_ARMORY.w - 20, 18, 800);
    g.fillText('[ BIO-ARMORY ]', WIN_ARMORY.x + WIN_ARMORY.w / 2, WIN_ARMORY.y + 37);
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
    // FINAL PIXEL TOUCH (10:06) — CRITICAL CLIPPING FIX: hard-clip ALL arena
    // rendering to the left arena (capture x 0-740 = logical 0-925) on the
    // play screens, so boss bloom, portal-ring halos and particles can never
    // bleed through the translucent sidebar panels. The sidebar gets a solid
    // dark backdrop after the restore below; the HUD is drawn unclipped.
    const playScreen = screen === SCREEN_PLAY || screen === SCREEN_PAUSE;
    if (playScreen) {
      ctx.beginPath(); ctx.rect(0, 0, 925, H); ctx.clip();
    }
    // FINAL PIXEL TOUCH (10:33, user order): camera pan dx=-130 — the scene
    // was staged for a full 1024 px canvas (centre 512) and the sidebar
    // covered its right half, cutting the boss/triangle/cells. Pan the whole
    // arena left so its centre lands at x=370 (middle of the 0..740 play
    // area); boss, fibrin triangle and all cells fit 100% left of the
    // divider. HUD/sidebar are drawn after the restore, in screen coords —
    // unaffected. (Rigid transform: prism refraction, lasers and boss
    // alignment are preserved exactly.)
    if (playScreen) ctx.translate(-130, 0);
    drawField(ctx, world);
    drawPlasmaCaustics(ctx, W, H, world.time);
    // Z2 Active Combat Plane: soft drop shadows under the Core, the hero
    // and the boss — the combat units sit ON the field, not in it.
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) {
      const shadow = (x, y, rx, ry, a) => {
        const sg = ctx.createRadialGradient(x, y, 2, x, y, rx);
        sg.addColorStop(0, `rgba(0, 0, 0, ${a})`);
        sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
      };
      const c = world.core;
      shadow(c.x, c.y + c.radius * 0.75, c.radius * 1.15, c.radius * 0.38, 0.34);
      const p = world.player;
      shadow(p.x, p.y + (p.radius + 6) * 1.5 * 0.85, (p.radius + 6) * 1.6, (p.radius + 6) * 0.5, 0.30);
      if (world.boss && world.boss.active) {
        const b = world.boss;
        shadow(b.x, b.y + b.radius * 0.8, b.radius * 1.2, b.radius * 0.4, 0.32);
      }
    }
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) drawValveGate(ctx, world, W, H);
    if (world.biomeId === 'alveolar') drawAlveolar(ctx, world);
    // FINAL PIXEL TOUCH (10:03): on the upgrade screen, keep background
    // entities out of the bottom button zone (capture y > 510 = logical
    // y > 637) — clip the entity layer at logical y 600 so no drifting
    // pathogen, shard or mote straddles the NEXT ORGAN ROUTE line or the
    // ROUTE buttons. The field background above stays full-height.
    if (screen === SCREEN_UPGRADE) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 600); ctx.clip();
    }
    drawPlateletNodes(ctx, world);
    drawShards(ctx, world);
    // The Organ Core is hidden on the end screens: its bright orb and HP
    // text would show through the victory/defeat stats panel.
    if (screen !== SCREEN_WIN && screen !== SCREEN_OVER) drawCore(ctx, world);
    for (const e of world.enemies) if (e.active) drawEnemy(ctx, world, e);
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) drawPlayerCell(ctx, world);
    if ((screen === SCREEN_PLAY || screen === SCREEN_PAUSE) && world.symbiosis) {
      for (const d of world.symbiosis.drones) {
        drawVolumetricCell(ctx, d.x, d.y, 18, world.time, 'rgba(0,245,212,0.7)', '#ffd166');
        // FINAL POLISH (10:01/10:06): the right drone's label sat on the gold
        // laser fan — shift it right of the beams, and give both labels a
        // dark pill backing so they stay readable over the arena.
        const lx = d.x > world.player.x ? d.x + 46 : d.x;
        const ly = d.y + 32;
        ctx.font = '800 11px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const lw = ctx.measureText('DRONE').width;
        ctx.fillStyle = 'rgba(6, 13, 24, 0.78)';
        ctx.beginPath(); ctx.roundRect(lx - lw / 2 - 4, ly - 8, lw + 8, 15, 4); ctx.fill();
        ctx.fillStyle = '#00f5d4';
        ctx.fillText('DRONE', lx, ly);
      }
    }
    drawProjectiles(ctx, world);
    // V3 — Perforin prism laser (play screen only) + Fibrin Triangle
    // amplifier beams + the hero's ribbon motion trail.
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) {
      drawPrismLaser(ctx, world);
      drawAmplifierBeams(ctx, world);
      drawRibbonTrail(ctx, world);
    }
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
    // Z3 Foreground Micro-Particles: ~20 tiny fast light motes drifting
    // in front of the action — deterministic from world.time.
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 20; i += 1) {
        const px = (i * 197 + world.time * 30 * (1 + (i % 3))) % W;
        const py = (i * 131 + world.time * 12 * (1 + (i % 2))) % H;
        ctx.globalAlpha = 0.2 + 0.3 * ((i * 7) % 10) / 10;
        ctx.fillStyle = i % 3 === 0 ? '#ffd166' : i % 3 === 1 ? '#7df9ff' : '#ffffff';
        ctx.beginPath(); ctx.arc(px, py, 1 + (i % 3) * 0.6, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (screen === SCREEN_UPGRADE) ctx.restore(); // end the button-zone clip
    // Vignette: darken the playfield edges so saturated accents pop and the
    // eye stays on the action (play / pause only — screens have own overlays).
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.95);
      vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vg.addColorStop(1, 'rgba(0, 0, 0, 0.30)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore(); // end the outer save (and the play-screen arena clip)
    // FINAL PIXEL TOUCH (10:06, hardened 10:29): solid dark sidebar backdrop,
    // painted after the arena restore and before the HUD — 0% arena light
    // sits behind the score boxes. Meets the arena clip edge at logical x 925
    // exactly. 10:29: rgba(6,12,24,0.99) — the 0.96 coat still let 4% of the
    // bright cyan ring bleed through behind ACTIVE SYNERGIES (capture
    // x 742-1024, y 52-640); 0.99 closes it.
    if (playScreen) {
      ctx.fillStyle = 'rgba(6, 12, 24, 0.99)';
      ctx.fillRect(925, 0, W - 925, H);
    }
    if (world.physiology === 'febrile' && (screen === SCREEN_PLAY || screen === SCREEN_PAUSE)) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 80, 60, ${0.5 + 0.3 * Math.sin(world.time * 4)})`;
      ctx.lineWidth = 10; ctx.strokeRect(5, 5, W - 10, H - 10);
      ctx.restore();
    }
    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) drawHud(ctx, world, screen, muted);
    if (screen === SCREEN_TITLE) drawTitle(ctx, world, best);
    else if (screen === SCREEN_UPGRADE) drawUpgrade(ctx, world);
    else if (screen === SCREEN_OVER) drawEndScreen(ctx, world, best, false);
    else if (screen === SCREEN_WIN) drawEndScreen(ctx, world, best, true);
    else if (screen === SCREEN_PAUSE) drawPause(ctx);
  }

  return { draw, inRect };
}
