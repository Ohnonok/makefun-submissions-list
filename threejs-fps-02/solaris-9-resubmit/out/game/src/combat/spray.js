export const SPRAY = {
pistol:   { base: 0.011, climb: [0, 0.004, 0.005, 0.006], drift: [0, -0.003, 0.003, -0.004], maxClimb: 0.05, maxDrift: 0.03 },
smg:      { base: 0.020, climb: [0, 0.003, 0.004, 0.005, 0.006, 0.007], drift: [0, -0.004, 0.005, -0.005, 0.006, -0.006], maxClimb: 0.11, maxDrift: 0.05 },
rifle:    { base: 0.014, climb: [0, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.010], drift: [0, -0.004, 0.005, -0.006, 0.006, -0.007, 0.007, -0.008], maxClimb: 0.10, maxDrift: 0.045 },
marksman: { base: 0.005, climb: [0, 0.010, 0.012], drift: [0, -0.002, 0.002], maxClimb: 0.06, maxDrift: 0.02 },
rail:     { base: 0.002, climb: [0, 0.020], drift: [0, 0.001], maxClimb: 0.06, maxDrift: 0.01 },
};
export function sprayTable(wId) { return SPRAY[wId] || SPRAY.rifle; }
export function createSprayState(seed) {
return {
shots: 0, kickX: 0, kickY: 0, heat: 0, idle: 0,
lcg: ((typeof seed === 'number' ? seed : 7) ^ 0x9e3779b9) >>> 0 || 1,
};
}
function nextRand(spray) {
spray.lcg = (Math.imul(spray.lcg, 1664525) + 1013904223) >>> 0;
return spray.lcg / 4294967296;
}
export function onShot(spray, wId) {
const t = sprayTable(wId);
const i = spray.shots < t.climb.length ? spray.shots : t.climb.length - 1;
const j = spray.shots < t.drift.length ? spray.shots : t.drift.length - 1;
spray.kickY = Math.min(spray.kickY + t.climb[i], t.maxClimb);
spray.kickX = Math.max(-t.maxDrift, Math.min(t.maxDrift, spray.kickX + t.drift[j]));
spray.shots += 1;
spray.heat = Math.min(1, spray.shots / 10);
spray.idle = 0;
}
export function spreadAngle(wId, spray, move) {
const t = sprayTable(wId);
let s = t.base;
const speed = move && typeof move.speed === 'number' ? move.speed : 0;
const crouched = !!(move && move.crouched);
const airborne = !!(move && move.airborne);
s *= 1 + speed * 0.11;
if (airborne) s *= 2;
if (crouched && speed < 0.3) s *= 0.55;
else if (crouched) s *= 0.7;
else if (speed < 0.3) s *= 0.75;
s += spray.heat * t.base * 1.2;
return s;
}
export function spreadJitter(spray, magnitude, out) {
out.x = (nextRand(spray) * 2 - 1) * magnitude;
out.y = (nextRand(spray) * 2 - 1) * magnitude;
return out;
}
