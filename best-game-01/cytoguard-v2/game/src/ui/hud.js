// CYTOGUARD HUD: every number the player needs, on dark translucent panels
// with white bold text so it stays readable over the bright vascular field.
// The top bar is laid out in FIXED, non-overlapping slots, sized to the
// longest expected string, so texts can never collide at 1024x640:
//   v2: 3 big blocks only — ORGAN % / WAVE n/15 • ORGAN / CHAIN xN + [SFX].
//     measured) | CENTER [450, 830] CHAIN centered on 640 | RIGHT [850, 1268]
//     CELL HP + [SFX: ON].
//   Row 2 (y 74..108): LEFT [28, 450] ORGAN INTEGRITY bar | CENTER [450, 830]
//   NO SCORE, no ATP bar, no small stacked text.
// The metastasis alert sits below row 2 (y 116). Nothing is positioned by a
// bare fixed x that a longer string could run into.

import { CONFIG } from '../core/config.js';
import { physiologyLabel, PHYS_FEBRILE, physiologyHeartbeatMs } from '../systems/physiology.js';

const PANEL = 'rgba(8, 14, 22, 0.62)';
const PANEL_EDGE = 'rgba(255, 255, 255, 0.30)';

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
  ctx.lineWidth = 1;
  ctx.stroke();
  // Glass top edge: a bright hairline along the top chamfer.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
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

/** Draw the in-play HUD (top bar, heat ring at the cursor, boss bar, banners). */
/** v2 HUD — Fix 1 zero-clutter: exactly 3 big top blocks, NO SCORE, no small
 *  stacked text. ORGAN % | WAVE n/15 • ORGAN | CHAIN xN + [SFX]. Boss keeps
 *  3 segmented armor bars; the Systolic Pulse Ring radiates from the Core. */
export function drawHud(ctx, world, screen, muted) {
  const p = world.player;
  const core = world.core;
  const W = CONFIG.FIELD.W;
  ctx.save();
  const organPct = Math.max(0, Math.round((core.hp / core.maxHp) * 100));
  // Block 1 (left): ORGAN 78% with thick integrity bar.
  panel(ctx, 28, 12, 300, 56, 10);
  ctx.fillStyle = '#ffffff'; ctx.font = '800 26px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`ORGAN ${organPct}%`, 44, 40);
  bar(ctx, 212, 30, 100, 16, core.hp / core.maxHp, organPct > 50 ? '#00f5d4' : '#ffd166');
  // Block 2 (center): WAVE 7/15 • LUNGS (+ phase, one line only).
  const waveText = `WAVE ${Math.max(1, world.wave)}/15 • ${(world.biomeName || 'LUNGS').toUpperCase()}`;
  panel(ctx, 440, 12, 400, 56, 10);
  ctx.fillStyle = '#ffd166'; ctx.font = '800 24px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(waveText, 640, 40);
  // Block 3 (right): SCORE 31.400 • CHAIN x36 + [SFX].
  const scoreText = `${String(world.score).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} • CHAIN x${world.chain}`;
  panel(ctx, 852, 12, 300, 56, 10);
  ctx.fillStyle = '#ffffff'; ctx.font = '800 24px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(scoreText, 868, 40);
  ctx.fillStyle = muted ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.roundRect(SFX_BUTTON.x, SFX_BUTTON.y, SFX_BUTTON.w, SFX_BUTTON.h, 8); ctx.fill();
  ctx.strokeStyle = PANEL_EDGE; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(muted ? '[SFX: OFF]' : '[SFX: ON]', SFX_BUTTON.x + SFX_BUTTON.w / 2, SFX_BUTTON.y + 18);
  // Systolic Pulse Ring: tick-driven beat telegraph radiating from the Core.
  if (world.rhythm && screen === 'play') {
    const iv = 60 / (world.rhythm.bpm || 72);
    const ph = iv > 0 ? (world.rhythm.beatTimer / iv) : 0;
    ctx.strokeStyle = `rgba(0, 245, 212, ${0.55 * (1 - ph)})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(core.x, core.y, core.radius + 20 + ph * 120, 0, Math.PI * 2); ctx.stroke();
  }
  // Boss: 3 segmented armor bars, top-right (not HUD clutter).
  if (world.boss && world.boss.active) {
    const b = world.boss;
    const frac = b.hp / b.maxHp;
    panel(ctx, W - 320, 80, 292, 44, 10);
    ctx.fillStyle = '#ff5c7a'; ctx.font = '800 16px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(b.omega ? 'OMEGA CHIMERA' : 'MIASMA PRIME', W - 174, 96);
    for (let i = 0; i < 3; i += 1) {
      const seg = Math.max(0, Math.min(1, frac * 3 - i));
      ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(W - 304 + i * 94, 106, 88, 10);
      ctx.fillStyle = '#c77dff'; ctx.fillRect(W - 304 + i * 94, 106, 88 * seg, 10);
    }
  }
  // Bio-Contract line (bottom-left, one clean line).
  if (world.contracts && world.contracts.active && screen === 'play') {
    ctx.fillStyle = '#ffd166'; ctx.font = '800 20px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(world.contracts.active.text, 28, 692);
  }
  // Zone banner (first 3 s of each wave) — one line, phase included.
  if (world.phase === 'intro' && world.waveTimer < 3) {
    ctx.globalAlpha = Math.min(1, (3 - world.waveTimer) / 0.5);
    ctx.fillStyle = '#ffffff'; ctx.font = '800 34px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(world.biomeName || '', W / 2, 120);
    ctx.font = '600 20px system-ui, sans-serif'; ctx.fillStyle = '#ffd166';
    ctx.fillText(`${world.infectionPhase || ''}  •  ${world.biomeSubtitle || ''}`, W / 2, 152);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
