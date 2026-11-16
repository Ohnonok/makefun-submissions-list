export const sfx = {
ctx: null, master: null, noiseBuf: null,
init() {
if (this.ctx) return;
try {
const AC = window.AudioContext || window.webkitAudioContext;
if (!AC) return;
this.ctx = new AC();
this.master = this.ctx.createGain();
this.master.gain.value = 0.35;
this.master.connect(this.ctx.destination);
const len = this.ctx.sampleRate;
const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
const d = buf.getChannelData(0);
let s = 0xACE1;
for (let i = 0; i < len; i++) {
s = (s >> 1) ^ (s & 1 ? 0xB400 : 0);
d[i] = (s / 0x8000) - 1;
}
this.noiseBuf = buf;
} catch (e) { this.ctx = null; }
},
resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
_osc(type, f0, f1, dur, vol, when) {
if (!this.ctx) return;
const t = this.ctx.currentTime + (when || 0);
const o = this.ctx.createOscillator();
const g = this.ctx.createGain();
o.type = type;
o.frequency.setValueAtTime(f0, t);
if (f1 != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
g.gain.setValueAtTime(vol, t);
g.gain.exponentialRampToValueAtTime(0.001, t + dur);
o.connect(g); g.connect(this.master);
o.start(t); o.stop(t + dur + 0.02);
},
_noise(dur, vol, freq, when) {
if (!this.ctx) return;
const t = this.ctx.currentTime + (when || 0);
const src = this.ctx.createBufferSource();
src.buffer = this.noiseBuf;
const flt = this.ctx.createBiquadFilter();
flt.type = 'lowpass'; flt.frequency.value = freq;
const g = this.ctx.createGain();
g.gain.setValueAtTime(vol, t);
g.gain.exponentialRampToValueAtTime(0.001, t + dur);
src.connect(flt); flt.connect(g); g.connect(this.master);
src.start(t); src.stop(t + dur + 0.02);
},
shot(id) {
if (!this.ctx) return;
switch (id) {
case 'pistol': this._noise(0.09, 0.7, 3200); this._osc('square', 420, 90, 0.08, 0.25); break;
case 'smg': this._noise(0.07, 0.55, 4200); this._osc('square', 520, 140, 0.06, 0.2); break;
case 'rifle': this._noise(0.12, 0.85, 2600); this._osc('sawtooth', 240, 60, 0.11, 0.3); break;
case 'marksman': this._noise(0.16, 0.9, 2000); this._osc('sawtooth', 180, 45, 0.15, 0.35); break;
case 'rail': this._noise(0.28, 1.0, 1500); this._osc('sawtooth', 120, 30, 0.26, 0.45); this._osc('sine', 900, 1800, 0.12, 0.15); break;
default: this._noise(0.1, 0.7, 2800); break;
}
},
plantBeep(final) {
if (!this.ctx) return;
this._osc('sine', final ? 1400 : 880, null, 0.09, 0.3);
},
};
