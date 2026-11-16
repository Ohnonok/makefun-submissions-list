// CYTOGUARD HUD (V3 bento — SUNWRIGHT audit 08:47, anti-mess rules 08:49):
// Top bar (full width): 10 glowing organ indicator cells + ORGAN
// INTEGRITY % (left), WAVE n/15 • ORGAN [PHASE] (center), [SFX] (right).
// Right sidebar (x 956-1272, 316 px, firm vertical divider at x 948):
// Box 1 SCORE & CHAIN, Box 2 NUTRIENT MATRIX, Box 3 INCOMING — N LEFT
// (live counts by kind + BOSS with a mini HP bar), Box 4 ACTIVE
// SYNERGIES (4 badges + 1 legend line each). Every box: 2 px border,
// dark contrast background, inner padding >= 14 px, body text >= 18 px
// bold (14+ px at the 1024x640 capture scale). The arena is 925 px wide
// (x 16-941); no enemy or laser may spill into sidebar text — the sidebar
// panels are opaque and painted last. The old bottom-left CONTRACT line is
// gone (08:47 supersession); contract completion still announces +150 GP.

import { CONFIG } from '../core/config.js';
import { physiologyLabel, PHYS_FEBRILE, physiologyHeartbeatMs } from '../systems/physiology.js';
import { EVOLUTIONS } from '../systems/synergies.js';

const PANEL = 'rgba(8, 14, 22, 0.82)';
const PANEL_EDGE = 'rgba(255, 209, 102, 0.55)';

/** Medical Bio-Scanner glass panel: chamfered corners, dark glass fill,
 * bright top edge. All HUD panels use this (never a flat roundRect). */
function panel(ctx, x, y, w, h, r) {
  const c = Math.min(r || 10, w / 4, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + c, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h - c);
  ctx.lineTo(x + w - c, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
  ctx.lineTo(x, y + c);
  ctx.closePath();
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Glass top edge: a bright hairline along the top chamfer.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + c, y + 0.5);
  ctx.lineTo(x + w - c, y + 0.5);
  ctx.stroke();
}

/** ECG waveform value at phase ph in [0,1): QRS spike + T wave. */
function ecgValue(ph) {
  let v = 0;
  v += Math.exp(-Math.pow((ph - 0.15) / 0.03, 2)) * 1.0; // R peak
  v -= Math.exp(-Math.pow((ph - 0.12) / 0.015, 2)) * 0.25; // Q dip
  v -= Math.exp(-Math.pow((ph - 0.19) / 0.015, 2)) * 0.3; // S dip
  v += Math.exp(-Math.pow((ph - 0.55) / 0.09, 2)) * 0.28; // T wave
  return v;
}

function bar(ctx, x, y, w, h, frac, fill, bg) {
  ctx.fillStyle = bg || 'rgba(255,255,255,0.16)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
}

export const SFX_BUTTON = { x: 1172, y: 12, w: 96, h: 34 };

// Sidebar geometry (logical 1280x720 field; 740/250 px at 1024x640 capture).
export const SIDEBAR_X = 956;
export const SIDEBAR_W = 316;
export const ARENA_RIGHT = 941;
export const DIVIDER_X = 948;

function formatScore(score) {
  return String(score).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function phaseRoman(world) {
  const ph = (world.infectionPhase || 'INCUBATION').toUpperCase();
  if (ph.includes('PROLIFERATION')) return 'II';
  if (ph.includes('SEPSIS') || ph.includes('ACUTE')) return 'III';
  return 'I';
}

/** Live enemy counts by kind for the INCOMING box. */
function countByKind(world) {
  let bacillus = 0; let phage = 0; let tumor = 0; let other = 0;
  for (const e of world.enemies) {
    if (!e.active || e.boss) continue;
    if (e.kind === 'bacillus') bacillus += 1;
    else if (e.kind === 'phage') phage += 1;
    else if (e.kind === 'cancer') tumor += 1;
    else other += 1;
  }
  return { bacillus, phage, tumor, other };
}

/** Draw the in-play HUD: top bar + right sidebar + divider. */
export function drawHud(ctx, world, screen, muted) {
  const p = world.player;
  const core = world.core;
  const W = CONFIG.FIELD.W;
  ctx.save();
  const organFrac = Math.max(0, Math.min(1, core.hp / core.maxHp));
  const organPct = Math.round(organFrac * 100);

  // --- Top bar (full width, y 8-54). ---
  panel(ctx, 8, 8, W - 16, 46, 10);
  // 10 glowing organ indicator cells, top-left.
  const litCells = Math.round(organFrac * 10);
  for (let i = 0; i < 10; i += 1) {
    const cx = 22 + i * 18;
    ctx.fillStyle = i < litCells ? (organPct > 50 ? '#00f5d4' : '#ffd166') : 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.roundRect(cx, 20, 15, 22, 3); ctx.fill();
    if (i < litCells) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const organText = `ORGAN INTEGRITY: ${organPct}%`;
  ctx.fillText(organText, 212, 31);
  // FINAL POLISH (10:01/10:06): 28 capture px (= 35 logical px) gap + '|'
  // separator between ORGAN INTEGRITY and the WAVE text (they sat touching).
  // The wave text is left-anchored after the gap instead of centered.
  const organW = ctx.measureText(organText).width;
  const headerGap = 35;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.textAlign = 'center';
  ctx.fillText('|', 212 + organW + headerGap / 2, 31);
  const waveText = `WAVE ${Math.max(1, world.wave)}/15 • ${(world.biomeName || 'LUNGS').toUpperCase()} [PHASE ${phaseRoman(world)}]`;
  ctx.fillStyle = '#ffd166';
  ctx.font = '800 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(waveText, 212 + organW + headerGap, 31);
  // SFX toggle (right end of the top bar).
  ctx.fillStyle = muted ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.roundRect(SFX_BUTTON.x, SFX_BUTTON.y, SFX_BUTTON.w, SFX_BUTTON.h, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(muted ? '[SFX: OFF]' : '[SFX: ON]', SFX_BUTTON.x + SFX_BUTTON.w / 2, SFX_BUTTON.y + 18);

  // --- Firm vertical divider between arena and sidebar. ---
  ctx.fillStyle = 'rgba(255, 209, 102, 0.55)';
  ctx.fillRect(DIVIDER_X, 60, 3, 652);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(DIVIDER_X + 4, 60, 1, 652);

  // --- Sidebar Box 1: SCORE & CHAIN (y 60-168). ---
  panel(ctx, SIDEBAR_X, 60, SIDEBAR_W, 108, 10);
  ctx.fillStyle = '#ffd166';
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SCORE & CHAIN', SIDEBAR_X + 16, 84);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 36px system-ui, sans-serif';
  ctx.fillText(formatScore(world.score), SIDEBAR_X + 16, 122);
  ctx.fillStyle = '#ffd166';
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillText(`CHAIN x${world.chain}`, SIDEBAR_X + 16, 154);

  // --- Sidebar Box 2: NUTRIENT MATRIX (y 180-268). ---
  panel(ctx, SIDEBAR_X, 180, SIDEBAR_W, 88, 10);
  ctx.fillStyle = '#ffd166';
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.fillText('NUTRIENT MATRIX', SIDEBAR_X + 16, 204);
  const n = world.nutrients || { vit: 8, pro: 6, min: 4 };
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 22px system-ui, sans-serif';
  ctx.fillText(`VIT ${n.vit} • PRO ${n.pro} • MIN ${n.min}`, SIDEBAR_X + 16, 234);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 18px system-ui, sans-serif';
  const formName = n.vit >= 10 ? 'APEX PHOTON LANCE' : n.vit >= 7 ? 'PHOTON LANCE — FORM' : 'PHOTON LANCE';
  ctx.fillText(formName, SIDEBAR_X + 16, 258);

  // --- Sidebar Box 3: INCOMING — N LEFT (y 280-460). ---
  const counts = countByKind(world);
  const bossAlive = !!(world.boss && world.boss.active);
  const leftTotal = counts.bacillus + counts.phage + counts.tumor + counts.other + (bossAlive ? 1 : 0);
  panel(ctx, SIDEBAR_X, 280, SIDEBAR_W, 180, 10);
  ctx.fillStyle = '#ffd166';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText(`INCOMING — ${leftTotal} LEFT`, SIDEBAR_X + 16, 306);
  ctx.font = '600 18px system-ui, sans-serif';
  const rows = [
    ['●', '#b8d94a', `Bacillus: ${counts.bacillus}`],
    ['⬡', '#8e6fd8', `Phage: ${counts.phage}`],
    ['✚', '#ff5c7a', `Tumor: ${counts.tumor}`],
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const y = 336 + i * 28;
    ctx.fillStyle = rows[i][1];
    ctx.fillText(rows[i][0], SIDEBAR_X + 16, y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(rows[i][2], SIDEBAR_X + 44, y);
  }
  // BOSS row, no HP bar. (SHIELD-2 fix: label was 600/18 px and washed out
  // at contact-sheet size — now 800/20 px. FINAL PIXEL TOUCH 10:33, user
  // order: the mini HP bar is removed — it read as an empty purple bar
  // floating at the box bottom. Icon + text only, neat inside the box.)
  ctx.fillStyle = '#c77dff';
  ctx.fillText('◆', SIDEBAR_X + 16, 420);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText(bossAlive ? 'BOSS: OMEGA CHIMERA' : 'BOSS: —', SIDEBAR_X + 44, 420);

  // --- Sidebar Box 4: ACTIVE SYNERGIES (y 472-712). ---
  panel(ctx, SIDEBAR_X, 472, SIDEBAR_W, 240, 10);
  ctx.fillStyle = '#ffd166';
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.fillText('ACTIVE SYNERGIES', SIDEBAR_X + 16, 496);
  const evoById = {};
  for (const e of EVOLUTIONS) evoById[e.id] = e;
  const owned = (world.evolutions || []).filter((id) => evoById[id]);
  const badges = [
    { name: 'Perforin Tri-Beam', legend: 'Tri-Beam: +1 beam, +20% dmg', colour: '#ffd166', lit: owned.includes('perforinTriBeam') },
    { name: 'Immune Surge', legend: 'Surge: +15% fire & speed', colour: '#7df9ff', lit: owned.includes('immuneSurge') },
    { name: 'T-Cell Prime Mastery', legend: 'Prime: +8 dmg, +1 pierce', colour: '#ffffff', lit: owned.includes('primeLanceMastery') },
    { name: 'Symbiotic Drones', legend: '2 Guardian Drones fight', colour: '#00f5d4', lit: !!((world.symbiosis && world.symbiosis.drones && world.symbiosis.drones.length > 0)) },
  ];
  for (let i = 0; i < badges.length; i += 1) {
    const b = badges[i];
    const ry = 520 + i * 44;
    ctx.globalAlpha = b.lit ? 1 : 0.35;
    ctx.fillStyle = b.colour;
    ctx.beginPath(); ctx.arc(SIDEBAR_X + 30, ry + 12, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#060d18';
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✦', SIDEBAR_X + 30, ry + 13);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(b.name, SIDEBAR_X + 54, ry + 6);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(b.legend, SIDEBAR_X + 54, ry + 28);
    ctx.globalAlpha = 1;
  }

  // Systolic Pulse Ring: tick-driven beat telegraph radiating from the Core.
  if (world.rhythm && screen === 'play') {
    const iv = 60 / (world.rhythm.bpm || 72);
    const ph = iv > 0 ? (world.rhythm.beatTimer / iv) : 0;
    ctx.strokeStyle = `rgba(0, 245, 212, ${0.55 * (1 - ph)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(core.x, core.y, core.radius + 20 + ph * 120, 0, Math.PI * 2); ctx.stroke();
  }
  // Zone banner (first 3 s of each wave) — one line, phase included.
  if (world.phase === 'intro' && world.waveTimer < 3) {
    ctx.globalAlpha = Math.min(1, (3 - world.waveTimer) / 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(world.biomeName || '', W / 2, 120);
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillStyle = '#ffd166';
    ctx.fillText(`${world.infectionPhase || ''}  •  ${world.biomeSubtitle || ''}`, W / 2, 152);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
