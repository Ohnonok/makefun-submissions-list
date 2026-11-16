import { sfx } from './sound.js';
const STINGER = [
[0, 0, 0.5], [7, 0.5, 0.5], [12, 1, 0.75], [7, 1.75, 0.25], [12, 2, 1],
];
const VICTORY = [
[0, 0, 0.5], [4, 0.5, 0.5], [7, 1, 0.5], [12, 1.5, 0.5], [16, 2, 0.75], [12, 2.75, 0.25], [19, 3, 1.5],
];
function noteFreq(semi) { return 440 * Math.pow(2, semi / 12); }
function playPhrase(notes, beatLen, type, vol) {
if (!sfx.ctx) return;
const t0 = sfx.ctx.currentTime + 0.02;
for (let i = 0; i < notes.length; i++) {
const n = notes[i];
const t = t0 + n[1] * beatLen;
const dur = n[2] * beatLen;
const o = sfx.ctx.createOscillator();
const g = sfx.ctx.createGain();
o.type = type;
o.frequency.value = noteFreq(n[0]);
g.gain.setValueAtTime(0.0001, t);
g.gain.linearRampToValueAtTime(vol, t + 0.02);
g.gain.exponentialRampToValueAtTime(0.001, t + dur);
o.connect(g); g.connect(sfx.master);
o.start(t); o.stop(t + dur + 0.02);
}
}
export function roundStinger() { playPhrase(STINGER, 0.22, 'triangle', 0.22); }
export function victorySting() { playPhrase(VICTORY, 0.26, 'triangle', 0.28); }
export function defeatSting() { playPhrase([[0, 0, 1], [-5, 1, 1.5]], 0.3, 'sine', 0.2); }
export function sting(kind) {
if (kind === 'victory') victorySting();
else if (kind === 'lose') defeatSting();
else roundStinger();
}
