// CYTOGUARD HUD: every number the player needs, on dark translucent panels
// with white bold text so it stays readable over the bright vascular field.
// The top bar is laid out in FIXED, non-overlapping slots, sized to the
// longest expected string, so texts can never collide at 1024x640:
//   Row 1 (bar y 12..68): LEFT [28, 450] SCORE / WAVE / gold (sequential,
//     measured) | CENTER [450, 830] CHAIN centered on 640 | RIGHT [850, 1268]
//     CELL HP + [SFX: ON].
//   Row 2 (y 74..108): LEFT [28, 450] ORGAN INTEGRITY bar | CENTER [450, 830]
//     physiology badge | RIGHT [850, 1268] ATP bar (+ E READY).
// The metastasis alert sits below row 2 (y 116). Nothing is positioned by a
// bare fixed x that a longer string could run into.

import { CONFIG } from './config.js';
import { physiologyLabel, PHYS_FEBRILE, physiologyHeartbeatMs } from './physiology.js';

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
export function drawHud(ctx, world, screen, muted) {
  const p = world.player;
  const core = world.core;
  const W = CONFIG.FIELD.W;
  ctx.save();
  ctx.textBaseline = 'middle';

  // --- Top bar, row 1 ---
  panel(ctx, 12, 12, 1256, 56, 10);
  // LEFT slot [28, 450]: SCORE / WAVE / gold, laid out sequentially from
  // measured widths (longest: SCORE 99999 + WAVE 10/10 + gold 9999 ≈ 410 px).
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  let lx = 28;
  ctx.fillStyle = '#ffffff';
  const scoreText = `SCORE ${world.score}`;
  ctx.fillText(scoreText, lx, 42);
  lx += ctx.measureText(scoreText).width + 16;
  const waveText = `WAVE ${Math.max(1, world.wave)}/10`;
  ctx.fillText(waveText, lx, 42);
  lx += ctx.measureText(waveText).width + 16;
  ctx.fillStyle = '#ffd166';
  const goldText = `◉ ${world.nutrients}`;
  ctx.fillText(goldText, lx, 42);
  // CENTER slot [450, 830]: CHAIN, centered on 640 (longest CHAIN x99 ≈ 150 px).
  ctx.font = '800 24px system-ui, sans-serif';
  ctx.fillStyle = '#ffd166';
  ctx.textAlign = 'center';
  ctx.fillText(`CHAIN x${world.chain}`, 640, 42);
  // RIGHT slot [850, 1268]: CELL HP, right-aligned against the SFX button.
  // Main text is 20 px bold so it reads on the 768x480 contact sheet.
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const cellVal = `${Math.ceil(p.hp)}/${p.maxHp}`;
  const cellValW = ctx.measureText(cellVal).width;
  const cellLabelW = ctx.measureText('CELL HP').width;
  const cellBarW = 110;
  const cellX = SFX_BUTTON.x - 12 - (cellLabelW + 8 + cellBarW + 8 + cellValW);
  ctx.fillStyle = '#7dffb0';
  ctx.fillText('CELL HP', cellX, 34);
  bar(ctx, cellX + cellLabelW + 8, 44, cellBarW, 12, p.hp / p.maxHp, '#37d67a');
  ctx.fillStyle = '#ffffff';
  ctx.fillText(cellVal, cellX + cellLabelW + 8 + cellBarW + 8, 50);

  // --- Top bar, row 2 (y 74..108) ---
  // LEFT slot [28, 450]: ORGAN INTEGRITY (the lose condition — biggest bar).
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ff8fa3';
  ctx.fillText('ORGAN INTEGRITY', 28, 80);
  bar(ctx, 28, 90, 220, 14, core.hp / core.maxHp, core.hp > 40 ? '#ff5c7a' : '#ff2e4d');
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${Math.ceil(core.hp)}/${core.maxHp}`, 256, 97);
  // LIVE ECG heartbeat trace inside the Organ Integrity bar: the trace
  // scrolls at the heartbeat tempo (72 BPM homeostasis, 140 BPM febrile).
  const bpm = 60000 / physiologyHeartbeatMs(world);
  ctx.save();
  ctx.beginPath();
  ctx.rect(28, 90, 220, 14);
  ctx.clip();
  ctx.strokeStyle = '#7df9ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let px = 28; px <= 248; px += 2) {
    const ph = (((px - 28) / 220) * 3 + world.time / (60 / bpm)) % 1;
    const py = 97 - ecgValue(ph) * 5;
    if (px === 28) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
  // RIGHT slot [850, 1268]: ATP (fever) bar, right-aligned to the panel edge.
  ctx.font = '700 20px system-ui, sans-serif';
  const atpLabelW = ctx.measureText('ATP').width;
  const atpBarW = 150;
  const eReadyText = p.overdrive >= 100 ? 'E READY' : '';
  const eReadyW = eReadyText ? ctx.measureText(eReadyText).width + 8 : 0;
  const atpX = 1268 - (atpLabelW + 8 + atpBarW + eReadyW);
  ctx.fillStyle = '#ffd166';
  ctx.fillText('ATP', atpX, 97);
  bar(ctx, atpX + atpLabelW + 8, 90, atpBarW, 14, p.overdrive / 100, p.overdrive >= 100 ? '#ffd166' : '#c9a227');
  if (eReadyText) {
    ctx.fillStyle = '#ffd166';
    ctx.fillText(eReadyText, atpX + atpLabelW + 8 + atpBarW + 8, 97);
  }

  // --- Body-status badge: HOMEOSTASIS vs FEBRILE SURGE (prominent, top HUD) ---
  const febrile = world.physiology === PHYS_FEBRILE;
  const badgeText = physiologyLabel(world);
  ctx.font = '800 20px system-ui, sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 36;
  const badgeX = W / 2 - badgeW / 2;
  const badgeY = 74;
  ctx.fillStyle = febrile ? `rgba(255, 60, 80, ${0.82 + 0.1 * Math.sin(world.time * 3)})` : 'rgba(16, 70, 66, 0.85)';
  ctx.strokeStyle = febrile ? '#ff8fa3' : '#2fd4c0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, 28, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, W / 2, badgeY + 15);

  // --- Metastasis alert: flashing red pill while tumor cells hold tethers ---
  if (world.metastasisSurge) {
    let tumors = 0;
    for (const e of world.enemies) if (e.active && e.kind === 'cancer') tumors += 1;
    const alertText = `⚠ ALERT: METASTASIS SURGE — ${tumors} TUMOR CELL${tumors === 1 ? '' : 'S'}`;
    ctx.font = '800 20px system-ui, sans-serif';
    const alertW = ctx.measureText(alertText).width + 36;
    const blink = 0.75 + 0.25 * Math.sin(world.time * 6);
    ctx.fillStyle = `rgba(180, 10, 30, ${blink})`;
    ctx.strokeStyle = '#ff2e4d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(W / 2 - alertW / 2, 116, alertW, 28, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(alertText, W / 2, 131);
  }

  // --- SFX toggle ---
  ctx.fillStyle = muted ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.roundRect(SFX_BUTTON.x, SFX_BUTTON.y, SFX_BUTTON.w, SFX_BUTTON.h, 8);
  ctx.fill();
  ctx.strokeStyle = PANEL_EDGE;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(muted ? '[SFX: OFF]' : '[SFX: ON]', SFX_BUTTON.x + SFX_BUTTON.w / 2, SFX_BUTTON.y + 18);

  // --- Zone banner (first 3 s of each wave) ---
  if (world.phase === 'intro' && world.waveTimer < 3) {
    ctx.globalAlpha = Math.min(1, (3 - world.waveTimer) / 0.5);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(world.biomeName || '', W / 2, 120);
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillStyle = '#ffd166';
    ctx.fillText(world.biomeSubtitle || '', W / 2, 152);
    ctx.globalAlpha = 1;
  }

  // --- Evolution banner ---
  if (world.evolution && world.evolution.timer > 0) {
    ctx.globalAlpha = Math.min(1, world.evolution.timer);
    ctx.fillStyle = '#ffd166';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(world.evolution.banner, W / 2, 200);
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(world.evolution.desc, W / 2, 228);
    ctx.globalAlpha = 1;
  }

  // --- Boss bar ---
  if (world.boss && world.boss.active) {
    const b = world.boss;
    panel(ctx, W / 2 - 260, 668, 520, 40, 10);
    ctx.fillStyle = '#ff5c7a';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MIASMA PRIME', W / 2, 682);
    bar(ctx, W / 2 - 240, 692, 480, 10, b.hp / b.maxHp, '#b537f2');
  }

  // --- Metabolic Heat ring at the cursor (only while firing builds heat) ---
  if (screen === 'play' && p.heat > 1) {
    const a = world.aim || { x: 640, y: 300 };
    const frac = p.heat / 100;
    const perfect = frac >= 0.75 && frac <= 0.9;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 26, 0, Math.PI * 2);
    ctx.strokeStyle = perfect ? '#ffd166' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = perfect ? 5 : 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.y, 26, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.strokeStyle = perfect ? '#ffd166' : '#ff7a3c';
    ctx.lineWidth = 5;
    ctx.stroke();
    if (perfect) {
      ctx.fillStyle = '#ffd166';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('R — PERFECT VENT', a.x, a.y - 38);
    }
  }

  // --- Fever active indicator (bottom-left, clear of the top bar + banners) ---
  if (p.feverTimer > 0) {
    ctx.fillStyle = '#ffd166';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`HYPER-IMMUNE FEVER ${p.feverTimer.toFixed(1)}s`, 28, 692);
  }
  ctx.restore();
}
