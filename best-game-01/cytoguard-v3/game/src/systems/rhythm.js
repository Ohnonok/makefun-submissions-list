// CYTOGUARD v2 — Cardiac Systolic Rhythm Sync (systems/rhythm.js).
// The ambient heartbeat is driven by game ticks (fixed 1/60 s), never wall
// clock. A Systolic Pulse Ring radiates from the Organ Core; pressing Space
// (Fibrin Dash) or Q (Polarity Shift) exactly on the beat triggers Systolic
// Overdrive: 2x Fibrin blast radius + 2x Gene Points. The ring is the beat
// telegraph — visible and fair.
export const BEAT_WINDOW = 0.12; // seconds either side of the beat.
export const OVERDRIVE_DURATION = 6; // seconds of Systolic Overdrive.

export function createRhythm(bpm) {
  return { bpm: bpm || 72, beat: 0, beatTimer: 0, overdriveTimer: 0, beatsHit: 0 };
}
export function beatInterval(rhythm) { return 60 / rhythm.bpm; }

/** Advance by fixed dt; returns true on the tick a beat lands. */
export function tickRhythm(rhythm, dt, febrile) {
  rhythm.bpm = febrile ? 140 : 72;
  rhythm.beatTimer += dt;
  const iv = beatInterval(rhythm);
  if (rhythm.beatTimer >= iv) {
    rhythm.beatTimer -= iv;
    rhythm.beat = (rhythm.beat + 1) % 4;
    return true;
  }
  if (rhythm.overdriveTimer > 0) rhythm.overdriveTimer -= dt;
  return false;
}

/** True when an action lands on the beat (within BEAT_WINDOW). */
export function onBeat(rhythm) {
  const iv = beatInterval(rhythm);
  const d = Math.min(rhythm.beatTimer, iv - rhythm.beatTimer);
  return d <= BEAT_WINDOW;
}

/** Space/Q on the beat: Systolic Overdrive (2x Fibrin radius + 2x GP). */
export function triggerSystolicOverdrive(rhythm) {
  if (!onBeat(rhythm)) return false;
  rhythm.overdriveTimer = OVERDRIVE_DURATION;
  rhythm.beatsHit += 1;
  return true;
}
export function systolicMultiplier(rhythm) {
  return rhythm.overdriveTimer > 0 ? 2 : 1;
}
export function pulseRingPhase(rhythm) {
  return rhythm.beatTimer / beatInterval(rhythm); // 0..1, ring expands.
}
