// Procedural sound, no audio files: every effect is synthesised with WebAudio.
// One job: gunshots, footsteps, radio blips, plant beeps and round stingers.
// The module never touches the network and degrades silently when audio is blocked.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  _noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  _tone(freq, dur, gain, type = 'square', slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // kind: 'pistol' | 'smg' | 'rifle' | 'sniper'; distant shots are muffled.
  shot(kind, dist = 0) {
    const muffle = Math.max(0.25, 1 - dist / 60);
    if (kind === 'sniper') { this._noise(0.28, 900 * muffle + 300, 0.9 * muffle); this._tone(140, 0.12, 0.3, 'sawtooth', 60); }
    else if (kind === 'rifle') this._noise(0.14, 1600 * muffle + 400, 0.7 * muffle);
    else if (kind === 'smg') this._noise(0.09, 2200 * muffle + 500, 0.5 * muffle);
    else this._noise(0.11, 1800 * muffle + 400, 0.6 * muffle);
  }
  dryFire() { this._tone(1200, 0.03, 0.12, 'square'); }
  reload() { this._tone(500, 0.05, 0.15, 'square'); setTimeout(() => this._tone(700, 0.05, 0.15, 'square'), 180); }
  step(run) { this._noise(0.05, 500, run ? 0.10 : 0.06); }
  hit() { this._tone(1900, 0.05, 0.2, 'sine'); }
  kill() { this._tone(1500, 0.07, 0.22, 'sine'); setTimeout(() => this._tone(2100, 0.08, 0.22, 'sine'), 70); }
  hurt() { this._tone(220, 0.15, 0.25, 'sawtooth', 120); }
  radio() { this._tone(880, 0.04, 0.1, 'square'); setTimeout(() => this._tone(880, 0.04, 0.1, 'square'), 90); }
  plantBeep() { this._tone(1250, 0.08, 0.25, 'sine'); }
  bombTick(final) { this._tone(final ? 1600 : 1000, 0.06, 0.2, 'sine'); }
  explode() { this._noise(1.2, 300, 1.0); this._tone(70, 0.9, 0.5, 'sine', 30); }
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 0.2, 'triangle'), i * 120)); }
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 0.2, 'triangle'), i * 130)); }
  flashPop() { this._noise(0.2, 4000, 0.4, 'highpass'); }
  smokePop() { this._noise(0.5, 800, 0.3); }
}
