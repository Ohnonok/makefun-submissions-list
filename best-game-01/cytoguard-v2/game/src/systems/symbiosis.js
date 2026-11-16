// CYTOGUARD v2+ APEX — Cellular Symbiosis Hijacking (systems/symbiosis.js).
// Opsonize an elite pathogen below 25% HP with a Resonance Crit (Q), then
// touch it with a Space Fibrin Dash: it becomes a Symbiotic Guardian Drone
// (cyan-gold aura) that fights for the host and fires Perforin Laser
// refracted 3-way through Silica Prisms. Tick-driven, deterministic.
export const SYMBIOTE_MAX = 3;
export const OPSONIZE_HP_FRAC = 0.25;

export function createSymbiosis() {
  return { drones: [], hijacked: 0, opsonized: 0 };
}

/** A Resonance Crit on an elite below 25% HP opsonizes it (marked). */
export function tryOpsonize(state, enemy, resonance, crit) {
  if (!enemy || !enemy.elite || !resonance || !crit) return false;
  if (enemy.hp / enemy.maxHp > OPSONIZE_HP_FRAC) return false;
  if (enemy.opsonized) return false;
  enemy.opsonized = true;
  enemy.opsonizeTimer = 6; // 6 s capture window: bolt-immune until hijacked or expired.
  state.symbiosis.opsonized += 1;
  state.events.push({ type: 'opsonize', x: enemy.x, y: enemy.y });
  return true;
}

/** A Fibrin Dash touching an opsonized elite hijacks it into a drone. */
export function hijackOnDash(state, x0, y0, x1, y1) {
  const sym = state.symbiosis;
  if (sym.drones.length >= SYMBIOTE_MAX) return null;
  for (const e of state.enemies) {
    if (!e.active || !e.opsonized) continue;
    const d = segmentPointDistance(e.x, e.y, x0, y0, x1, y1);
    if (d > 60) continue;
    e.active = false;
    const drone = { x: e.x, y: e.y, angle: 0, fireTimer: 0.4, kind: e.kind, hp: 60 };
    sym.drones.push(drone);
    sym.hijacked += 1;
    state.events.push({ type: 'hijack', x: e.x, y: e.y });
    return drone;
  }
  return null;
}
export function segmentPointDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Drones orbit the hero and fire Perforin at the nearest foe (3-way
 *  refraction happens when a bolt crosses a Silica Prism, as for the hero). */
export function updateSymbiotes(state, dt, fireDroneBolt) {
  const sym = state.symbiosis;
  const p = state.player;
  for (let i = sym.drones.length - 1; i >= 0; i -= 1) {
    const d = sym.drones[i];
    const orbit = (state.time * 0.7) + (i * Math.PI * 2 / Math.max(1, sym.drones.length));
    d.x += ((p.x + Math.cos(orbit) * 90) - d.x) * Math.min(1, dt * 4);
    d.y += ((p.y + Math.sin(orbit) * 90) - d.y) * Math.min(1, dt * 4);
    d.fireTimer -= dt;
    if (d.fireTimer <= 0) {
      d.fireTimer = 0.8;
      let target = null; let best = Infinity;
      for (const e of state.enemies) {
        if (!e.active) continue;
        const dd = Math.hypot(e.x - d.x, e.y - d.y);
        if (dd < best) { best = dd; target = e; }
      }
      if (target) fireDroneBolt(state, d, Math.atan2(target.y - d.y, target.x - d.x));
    }
  }
}
