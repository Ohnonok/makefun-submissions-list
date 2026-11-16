// systems/fusion.js — Tri-Cell Golden Organ Fever & DNA Helix Shockwave (V3).
// Destroying 3 opposite-polarity (Q) pathogens within 2 seconds spawns a
// Golden Stem-Catalyst Orb. Touching it during Space Dash activates
// Tri-Cell Resonance: the hero plus 2 translucent shadow cells fire 3
// parallel gold lasers for 8 seconds, a DNA Helix Shockwave harvests
// +10 GP straight into the Cell Lineage Bank, and the resonance volleys
// deal real damage through the normal projectile path.
// Tick-driven (called once per fixed step from core/loop.js), all state on
// state.fusion, deterministic. Enemy deaths are detected by scanning the
// enemy pool each tick (state.js keeps e.polarity / e.kind on pooled
// objects after killEnemy sets active=false).
import { spawnBurst, spawnHelixShockwave, spawnShockwave } from '../render/effects.js';

export const FUSION_KILLS_NEEDED = 3;
export const FUSION_KILL_WINDOW = 2; // seconds
export const FUSION_ORB_LIFETIME = 6; // seconds
export const FUSION_ORB_RADIUS = 70; // dash-touch distance
export const FUSION_RESONANCE_SECONDS = 8;
export const FUSION_RESONANCE_VOLLEY_SECONDS = 0.5;
export const FUSION_GP_REWARD = 10;

export function createFusion() {
  return {
    kills: [], // { time, polarity, kind, x, y } of opposite-polarity kills
    orb: null, // { x, y, timer }
    resonance: 0, // seconds remaining
    volleyTimer: 0,
    prevActive: null, // enemy pool activity snapshot from the previous tick
  };
}

export function resetFusion(state) {
  state.fusion = createFusion();
}

function ensureFusion(state) {
  if (!state.fusion) state.fusion = createFusion();
  return state.fusion;
}

function allocateBolt(state, x, y, angle, damage, polarity) {
  for (const b of state.projectiles) {
    if (b.active) continue;
    const speed = state.player.bulletSpeed || 620;
    b.active = true;
    b.x = x; b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.damage = damage;
    b.pierce = state.player.pierce || 0;
    b.crit = false;
    b.polarity = polarity;
    b.style = 'lance';
    b.splitDone = false;
    b.radius = 5;
    return b;
  }
  return null;
}

/** Fire one Tri-Cell Resonance volley: 3 parallel gold lasers from the
 * hero and its 2 shadow cells toward the aim point. */
function fireResonanceVolley(state) {
  const p = state.player;
  if (!p) return; // NOTE: no p.active gate — the player object has no
  // lifecycle flag (createWorld sets active:true, but the volley must
  // fire even if a future reset ever drops it; see SHIELD-2 fix).
  const aim = state.aim || { x: p.x + 100, y: p.y };
  const angle = Math.atan2(aim.y - p.y, aim.x - p.x);
  const px = -Math.sin(angle);
  const py = Math.cos(angle);
  const damage = Math.max(1, Math.round(p.damage * 0.8));
  for (let i = -1; i <= 1; i += 1) {
    allocateBolt(
      state,
      p.x + px * i * 55,
      p.y + py * i * 55,
      angle,
      damage,
      p.polarity,
    );
  }
}

/** Tick the fusion system once per fixed step.
 * Returns { events, cancerKills } — events feed loop.js handleEvents,
 * cancerKills feed the loop's momentum hit-stop. */
export function tickFusion(state, dt) {
  const f = ensureFusion(state);
  const events = [];
  const cancerKills = [];
  const time = state.time || 0;
  const p = state.player;

  // --- Death scan: compare the enemy pool with the previous tick. ---
  if (!f.prevActive) {
    f.prevActive = state.enemies.map((e) => e.active);
  } else {
    for (let i = 0; i < state.enemies.length; i += 1) {
      const e = state.enemies[i];
      if (f.prevActive[i] && !e.active) {
        // Newly dead this tick.
        if (e.kind === 'cancer') cancerKills.push({ x: e.x, y: e.y });
        if (p && e.polarity && e.polarity !== p.polarity) {
          f.kills.push({ time, polarity: e.polarity, kind: e.kind, x: e.x, y: e.y });
        }
      }
      f.prevActive[i] = e.active;
    }
    // Prune kills outside the 2-second window.
    f.kills = f.kills.filter((k) => time - k.time <= FUSION_KILL_WINDOW);
    // 3 opposite-polarity kills in the window -> Golden Stem-Catalyst Orb.
    if (!f.orb && f.resonance <= 0 && f.kills.length >= FUSION_KILLS_NEEDED) {
      const last = f.kills[f.kills.length - 1];
      f.orb = { x: last.x, y: last.y, timer: FUSION_ORB_LIFETIME };
      f.kills = [];
      events.push({ type: 'fusionOrb' });
    }
  }

  // --- Orb: lifetime + dash-touch pickup. ---
  if (f.orb) {
    f.orb.timer -= dt;
    if (f.orb.timer <= 0) {
      f.orb = null;
    } else if (p && p.dashTimer > 0) { // no p.active gate: see above.
      const d = Math.hypot(p.x - f.orb.x, p.y - f.orb.y);
      if (d < FUSION_ORB_RADIUS) {
        const ox = f.orb.x;
        const oy = f.orb.y;
        f.orb = null;
        f.resonance = FUSION_RESONANCE_SECONDS;
        f.volleyTimer = 0;
        if (state.lineage) state.lineage.gp += FUSION_GP_REWARD;
        state.lineageGp = (state.lineageGp || 450) + FUSION_GP_REWARD;
        spawnHelixShockwave(state.particles, state.rng, ox, oy);
        spawnShockwave(state.particles, state.rng, p.x, p.y, 180);
        spawnBurst(state.particles, state.rng, p.x, p.y, '#ffd166', 24, 320, 5);
        events.push({ type: 'fusionResonance' });
      }
    }
  }

  // --- Resonance: countdown + volleys every 0.5 s. ---
  if (f.resonance > 0) {
    f.resonance -= dt;
    f.volleyTimer -= dt;
    if (f.volleyTimer <= 0) {
      f.volleyTimer = FUSION_RESONANCE_VOLLEY_SECONDS;
      fireResonanceVolley(state);
    }
    if (f.resonance < 0) f.resonance = 0;
  }

  return { events, cancerKills };
}
