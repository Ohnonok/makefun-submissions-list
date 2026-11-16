// KILNWORKS — an original night brickworks map. One job: the layout.
// Three lanes: Kiln Hall (A, west), Brick Yard (B, east), and the Furnace Hall mid.
// Coordinates: x east, z south, y up. Playable area roughly x -34..34, z -26..26.
// Colliders are axis-aligned boxes {x0,z0,x1,z1,h} — the sim and the bots share them,
// so collision, line-of-sight and pathing can never disagree.
export const MAP = {
  name: 'KILNWORKS',
  bounds: { x0: -36, x1: 36, z0: -28, z1: 28 },
  // Bomb sites: centre + radius of the plant zone.
  sites: {
    A: { name: 'Kiln Hall', x: -20, z: -16, r: 5.5 },
    B: { name: 'Brick Yard', x: 28, z: 22, r: 5.5 },
  },
  spawns: {
    CT: [ // Kiln Crew (defenders) start south, between the sites.
      { x: -6, z: 22 }, { x: -2, z: 23 }, { x: 2, z: 23 }, { x: 6, z: 22 }, { x: 0, z: 19 },
    ],
    T: [ // Ember Gang (attackers) start north.
      { x: -6, z: -22 }, { x: -2, z: -23 }, { x: 2, z: -23 }, { x: 6, z: -22 }, { x: 0, z: -19 },
    ],
  },
  // Waypoint graph: nodes the bots walk. Edges are implicit — a bot walks node to node
  // when the straight segment does not cross a collider (checked by losClear).
  nodes: [
    // id, x, z, tags
    ['ctSpawn', 0, 21, ['spawn']],
    ['ctMid', 0, 12, []],
    ['ctA', -12, 14, []],
    ['ctB', 12, 14, []],
    ['aDoor', -18, 4, []],
    ['aSite', -26, -16, ['siteA']],
    ['aKiln', -24, -6, []],
    ['aCorner', -14, -14, []],
    ['midTop', 0, -6, []],
    ['midLow', 0, 6, []],
    ['midKiln', -8, -2, []],
    ['midStack', 8, -2, []],
    ['bDoor', 18, -4, []],
    ['bSite', 28, 22, ['siteB']],
    ['bYard', 22, 6, []],
    ['bCorner', 14, 14, []],
    ['tSpawn', 0, -21, ['spawn']],
    ['tMid', 0, -12, []],
    ['tA', -12, -14, []],
    ['tB', 12, -14, []],
    ['aHold', -20, -10, ['holdA']],
    ['bHold', 20, 10, ['holdB']],
    ['aRetake', -16, 8, []],
    ['bRetake', 16, -8, []],
  ].map(([id, x, z, tags]) => ({ id, x, z, tags })),
  // Solid boxes. Walls first, then kilns, stacks, crates, furnace.
  colliders: [
    // Outer walls (h 6)
    { x0: -36, z0: -28, x1: 36, z1: -26.4, h: 6 },
    { x0: -36, z0: 26.4, x1: 36, z1: 28, h: 6 },
    { x0: -36, z0: -28, x1: -34.4, z1: 28, h: 6 },
    { x0: 34.4, z0: -28, x1: 36, z1: 28, h: 6 },
    // Kiln Hall (A): two big round kilns as boxes + a low wall
    { x0: -32, z0: -22, x1: -24, z1: -14, h: 4.5 },
    { x0: -32, z0: -10, x1: -26, z1: -4, h: 3.2 },
    { x0: -20, z0: -24, x1: -14, z1: -20, h: 2.2 },
    // Brick Yard (B): pallet stacks
    { x0: 22, z0: 10, x1: 30, z1: 18, h: 3.4 },
    { x0: 20, z0: 20, x1: 26, z1: 24, h: 2.4 },
    { x0: 30, z0: 6, x1: 33, z1: 12, h: 2.0 },
    // Furnace Hall mid: the furnace block and chimney base
    { x0: -4, z0: -4, x1: 4, z1: 2, h: 5.0 },
    { x0: -10, z0: 2, x1: -6, z1: 8, h: 2.6 },
    { x0: 6, z0: -8, x1: 10, z1: -2, h: 2.6 },
    // Crates / cover dotted along lanes
    { x0: -16, z0: -2, x1: -13, z1: 1, h: 1.6 },
    { x0: 13, z0: 1, x1: 16, z1: 4, h: 1.6 },
    { x0: -8, z0: 12, x1: -5, z1: 15, h: 1.4 },
    { x0: 5, z0: 12, x1: 8, z1: 15, h: 1.4 },
    { x0: -2, z0: -16, x1: 2, z1: -13, h: 1.5 },
    { x0: -28, z0: 2, x1: -24, z1: 6, h: 1.8 },
    { x0: 24, z0: -6, x1: 28, z1: -2, h: 1.8 },
    { x0: -12, z0: -22, x1: -8, z1: -18, h: 1.2 },
    { x0: 8, z0: 18, x1: 12, z1: 22, h: 1.2 },
  ],
  // Visual-only dressing (no collision): lamps, chimneys, drying racks.
  dressing: [
    { kind: 'chimney', x: -30, z: -24 }, { kind: 'chimney', x: 32, z: 22 },
    { kind: 'rack', x: -18, z: 18 }, { kind: 'rack', x: 18, z: -18 },
    { kind: 'lamp', x: 0, z: 0 }, { kind: 'lamp', x: -20, z: -16 },
    { kind: 'lamp', x: 28, z: 22 }, { kind: 'lamp', x: 0, z: 21 },
  ],
};

// --- geometry helpers shared by sim, bots and rendering --------------------
export function nodeById(id) { return MAP.nodes.find((n) => n.id === id); }

// True when the XZ segment a->b crosses no collider (checked at eye height 1.5).
export function losClear(ax, az, bx, bz) {
  for (const c of MAP.colliders) {
    if (segmentHitsBox(ax, az, bx, bz, c)) return false;
  }
  return true;
}
function segmentHitsBox(ax, az, bx, bz, c) {
  // Slab test in 2D; the segment is at a height below every collider's h.
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[ax, dx, c.x0, c.x1], [az, dz, c.z0, c.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else {
      let u = (lo - p) / d, v = (hi - p) / d;
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// Circle (radius r) vs colliders: push the point out of every box it overlaps.
export function resolveCircle(x, z, r) {
  for (const c of MAP.colliders) {
    const cx = Math.max(c.x0, Math.min(x, c.x1));
    const cz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = x - c.x0, pr = c.x1 - x, pt = z - c.z0, pb = c.z1 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.x0 - r; else if (m === pr) x = c.x1 + r;
        else if (m === pt) z = c.z0 - r; else z = c.z1 + r;
      }
    }
  }
  x = Math.max(MAP.bounds.x0 + r, Math.min(MAP.bounds.x1 - r, x));
  z = Math.max(MAP.bounds.z0 + r, Math.min(MAP.bounds.z1 - r, z));
  return { x, z };
}

// Greedy waypoint path: step toward the target node through visible nodes.
export function findPath(fromX, fromZ, toId) {
  const target = nodeById(toId);
  if (!target) return [];
  const path = [];
  let cx = fromX, cz = fromZ;
  let guard = 0;
  while (guard++ < 12) {
    if (losClear(cx, cz, target.x, target.z)) { path.push(target); return path; }
    let best = null, bestD = Infinity;
    for (const n of MAP.nodes) {
      if (path.includes(n)) continue;
      if (!losClear(cx, cz, n.x, n.z)) continue;
      const d = (n.x - target.x) ** 2 + (n.z - target.z) ** 2;
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best) return path;
    path.push(best); cx = best.x; cz = best.z;
  }
  return path;
}
