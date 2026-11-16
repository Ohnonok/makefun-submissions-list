import { ECONOMY, ROUND, TEAMS } from './config.js';
const NAMES = {
solaris: ['NOVA', 'HELIX', 'ORION', 'VEGA'], voidborne: ['UMBRA', 'NULL', 'HEX', 'VEX', 'NOCT'],
};
function makePlayer(id, nm, tm, isPlayer) {
return {
id, nm, tm, isPlayer, hp: 100, armor: 0, alive: true,
cash: ECONOMY.start, kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, plants: 0, defuses: 0,
weapon: 'pistol', wId: 'pistol', mag: 12, reserve: 48, owned: { pistol: true },
x: 0, z: 0, yaw: 0, pitch: 0, pos: { x: 0, y: 0, z: 0 },
vx: 0, vz: 0, vy: 0, grounded: true, eyeHeight: 1.62,
speed: 0, walkPhase: 0, inAir: false, crouched: false, crouching: false, firing: false, spread: 0, blinded: 0,
nextShotAt: 0, reloading: false, reloadUntil: 0, smokeN: 0, flashN: 0, hasHelmet: false, hasKit: false,
planting: 0, defusing: 0,
};
}
export function mkState(seed = 7) {
const plrs = [];
plrs.push(makePlayer(0, 'YOU', TEAMS.SOLARIS, true));
for (let i = 0; i < 4; i++) plrs.push(makePlayer(1 + i, NAMES.solaris[i], TEAMS.SOLARIS, false));
for (let i = 0; i < 5; i++) plrs.push(makePlayer(5 + i, NAMES.voidborne[i], TEAMS.VOIDBORNE, false));
return {
seed, time: 0,
round: 1, score: { solaris: 0, voidborne: 0 },
lossStreak: { solaris: 0, voidborne: 0 }, phase: 'buy',
timeLeft: ROUND.roundTime,
plrs,
bm: { state: 'carried', carrier: 0, si: null, x: 0, z: 0, timer: ROUND.bombTime, canPlant: false, canDefuse: false, progress: 0, defusing: false },
plan: '', spawns: null,
polarity: 'gold', radioLog: [],
cmdLine: '', chronicle: '',
bounty: null, tripSensor: null,
credits: 0, heat: null,
hvUntil: 0,
};
}
export function resetRd(state) {
state.phase = 'buy';
state.timeLeft = ROUND.roundTime;
state.bm = { state: 'carried', carrier: 0, si: null, x: 0, z: 0, timer: ROUND.bombTime, canPlant: false, canDefuse: false, progress: 0, defusing: false };
state.plan = '';
for (const p of state.plrs) {
p.hp = 100; p.alive = true; p.planting = 0; p.defusing = 0;
p.blinded = 0; p.firing = false; p.reloading = false;
p.vx = 0; p.vz = 0; p.vy = 0; p.grounded = true; p.speed = 0; p.inAir = false;
}
if (state.spawns) {
for (const p of state.plrs) {
const list = p.tm === TEAMS.SOLARIS ? state.spawns.solaris : state.spawns.voidborne;
const s = list[p.id % list.length];
p.x = s[0]; p.z = s[1];
p.pos.x = s[0]; p.pos.y = 0; p.pos.z = s[1];
p.yaw = p.tm === TEAMS.SOLARIS ? 0 : Math.PI;
}
}
}
export function awardRd(state, winner) {
const loser = winner === TEAMS.SOLARIS ? TEAMS.VOIDBORNE : TEAMS.SOLARIS;
state.score[winner]++;
state.lossStreak[winner] = 0;
state.lossStreak[loser]++;
for (const p of state.plrs) {
if (!p.alive) continue;
const w = p.tm === winner
? ECONOMY.win
: ECONOMY.lose + (state.lossStreak[p.tm] - 1) * ECONOMY.lossStreak;
p.cash = Math.min(ECONOMY.max, p.cash + w);
}
if (state.score.solaris >= ROUND.firstTo || state.score.voidborne >= ROUND.firstTo
|| state.round >= ROUND.maxRounds) return 'matchEnd';
return 'roundEnd';
}
