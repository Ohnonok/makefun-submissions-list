// CYTOGUARD fibrin traps: Platelet Nodes stand in the vessel (fixed positions
// per zone, deterministic). Dashing past nodes links them with FIBRIN THREADS
// (world.threads: {active, ax, ay, bx, by, life, maxLife}) that burn pathogens
// crossing them for 4 s; linking three nodes into a Cytokine Triangle charges
// an OXIDATIVE BURST that clears every pathogen inside the triangle. Pure
// geometry + pure helpers: no DOM, no clock.

import { spawnBurst } from '../render/effects.js';

/** Fixed Platelet Node positions per zone (deterministic). */
export const PLATELET_NODES = {
  capillary: [
    { x: 220, y: 200, radius: 22 },
    { x: 1060, y: 200, radius: 22 },
    { x: 640, y: 580, radius: 22 },
  ],
  alveolar: [
    { x: 200, y: 160, radius: 22 },
    { x: 1080, y: 160, radius: 22 },
    { x: 200, y: 560, radius: 22 },
    { x: 1080, y: 560, radius: 22 },
  ],
  marrow: [
    { x: 240, y: 180, radius: 22 },
    { x: 1040, y: 180, radius: 22 },
    { x: 640, y: 600, radius: 22 },
  ],
};

/** The thread's burn time, in seconds. */
export const THREAD_LIFETIME = 4;

/** Distance from point (px, py) to segment (ax, ay)-(bx, by). */
export function segmentPointDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Node indices within `radius` of the dash segment (start -> end). */
export function nodesPassedByDash(nodes, x0, y0, x1, y1, radius) {
  const hit = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (segmentPointDistance(nodes[i].x, nodes[i].y, x0, y0, x1, y1) < radius + nodes[i].radius) hit.push(i);
  }
  return hit;
}

/** Find a free thread slot in the world's pooled threads, or null. */
function freeThread(state) {
  for (let i = 0; i < state.threads.length; i += 1) if (!state.threads[i].active) return state.threads[i];
  return null;
}

/** True when a live thread already joins nodes a and b. */
function hasThread(state, a, b) {
  for (let i = 0; i < state.threads.length; i += 1) {
    const t = state.threads[i];
    if (!t.active) continue;
    const na = t.nodeA;
    const nb = t.nodeB;
    if ((na === a && nb === b) || (na === b && nb === a)) return true;
  }
  return false;
}

/**
 * Link the passed nodes in dash order with Fibrin Threads (no duplicates;
 * re-linking refreshes the 4 s burn). Marks each linked node. Returns true
 * when at least one thread was created or refreshed.
 */
export function linkPlateletThread(state, passed, time) {
  let linked = false;
  for (let k = 0; k + 1 < passed.length; k += 1) {
    const a = passed[k];
    const b = passed[k + 1];
    if (a === b) continue;
    state.nodes[a].linked = true;
    state.nodes[b].linked = true;
    if (hasThread(state, a, b)) {
      for (const t of state.threads) {
        if (!t.active) continue;
        if ((t.nodeA === a && t.nodeB === b) || (t.nodeA === b && t.nodeB === a)) {
          t.life = THREAD_LIFETIME;
          t.maxLife = THREAD_LIFETIME;
        }
      }
      linked = true;
      continue;
    }
    const t = freeThread(state);
    if (!t) continue;
    t.active = true;
    t.nodeA = a;
    t.nodeB = b;
    t.ax = state.nodes[a].x;
    t.ay = state.nodes[a].y;
    t.bx = state.nodes[b].x;
    t.by = state.nodes[b].y;
    t.life = THREAD_LIFETIME;
    t.maxLife = THREAD_LIFETIME;
    linked = true;
  }
  return linked;
}

/**
 * The Cytokine Triangle: any three linked nodes form it. Fires the Oxidative
 * Burst FX — a lysis flash at the centroid, hit-stop and screen shake — and
 * returns the three node indices so the caller can purge the pathogens inside
 * through its own damage path. Returns null when no triangle is linked yet.
 */
export function checkTriangleBurst(state, time) {
  const linked = [];
  for (let i = 0; i < state.nodes.length; i += 1) if (state.nodes[i].linked) linked.push(i);
  if (linked.length < 3) return null;
  const [a, b, c] = linked;
  const na = state.nodes[a];
  const nb = state.nodes[b];
  const nc = state.nodes[c];
  spawnBurst(state.particles, state.rng, (na.x + nb.x + nc.x) / 3, (na.y + nb.y + nc.y) / 3, '#ffd166', 30, 320, 5);
  state.hitStop = 0.12;
  state.shake = Math.max(state.shake, 0.5);
  return [a, b, c];
}

/** True when point (px, py) lies inside triangle (ax,ay)-(bx,by)-(cx,cy). */
export function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (d === 0) return false;
  const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  const c = 1 - a - b;
  return a >= 0 && b >= 0 && c >= 0;
}
