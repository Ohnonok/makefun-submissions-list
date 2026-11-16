// CYTOGUARD v2+ APEX — Dynamic Vascular Flow Valve (systems/fluidics.js).
// Laminar blood-flow lines cross the arena. The player opens the Vascular
// Valve Gate (V): the diverted flow sweeps Bacillus (Quorum-Sensing green
// lines) and Microplastic into the Cyan Fibrin Triangle for the Oxidative
// Burst. Tick-driven: the valve stays open 4 s, then closes for 6 s.
export const VALVE_OPEN_SECONDS = 4;
export const VALVE_COOLDOWN_SECONDS = 6;
export const FLOW_SPEED = 260; // px/s sweep along the flow lane.

export function createFluidics() {
  return { open: false, timer: 0, cooldown: 0, phase: 0 };
}

/** Open the Vascular Valve Gate (V key). False while cooling down. */
export function activateValve(state) {
  const f = state.fluidics;
  if (f.open || f.cooldown > 0) return false;
  f.open = true;
  f.timer = VALVE_OPEN_SECONDS;
  state.events.push({ type: 'valve' });
  return true;
}

export function tickFluidics(state, dt) {
  const f = state.fluidics;
  f.phase += dt;
  if (f.open) {
    f.timer -= dt;
    // The diverted flow sweeps Bacillus + Microplastic toward the triangle.
    for (const e of state.enemies) {
      if (!e.active || (e.kind !== 'bacillus' && e.kind !== 'plastic')) continue;
      e.x += FLOW_SPEED * dt * 0.6;
      e.y += Math.sin(f.phase * 2 + e.x * 0.01) * 24 * dt;
      if (e.x > 1240) e.x = 40;
    }
    if (f.timer <= 0) { f.open = false; f.cooldown = VALVE_COOLDOWN_SECONDS; }
  } else if (f.cooldown > 0) f.cooldown -= dt;
}

/** Draw the laminar flow lines + the Valve Gate (center focus). */
export function drawValveGate(g, state, W, H) {
  const f = state.fluidics;
  g.save();
  g.globalAlpha = 0.35;
  g.strokeStyle = '#00f5d4'; g.lineWidth = 1.5;
  for (let i = 0; i < 5; i += 1) {
    const y = H * (0.2 + i * 0.15);
    g.beginPath();
    for (let x = 0; x <= W; x += 32) {
      const yy = y + Math.sin(x * 0.008 + f.phase * 1.4 + i) * 10;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
  // The Valve Gate: a ringed gate at the flow's heart.
  const gx = W / 2; const gy = H * 0.42;
  g.strokeStyle = f.open ? '#ffd166' : 'rgba(0,245,212,0.8)';
  g.lineWidth = f.open ? 5 : 3;
  g.beginPath(); g.arc(gx, gy, 44 + (f.open ? 6 * Math.sin(f.phase * 6) : 0), 0, Math.PI * 2); g.stroke();
  g.fillStyle = f.open ? '#ffd166' : '#00f5d4';
  g.font = '800 13px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(f.open ? 'VALVE OPEN' : 'VALVE [V]', gx, gy + 62);
  g.restore();
}
