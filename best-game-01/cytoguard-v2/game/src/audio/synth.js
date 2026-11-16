// CYTOGUARD bio-audio: studio-class procedural Web Audio, zero external
// assets, 100% offline, zero extra bytes. Master bus: gain ->
// DynamicsCompressorNode (no clipping when dozens of pathogens lyse at
// once) -> gentle low-pass (softens square/saw edges) -> destination. Every
// SFX carries a 25 ms per-sound cooldown and deterministic pitch variation
// (±8%, seeded RNG only). A soft organic ambient pulse — a warm low pad —
// runs under the game; its low-pass intensity RISES when Boss Miasma Prime
// appears (main.js drives setBossPresence from world state). The context is
// created lazily on the first user gesture (browsers block audio before
// that), and every call is a no-op until then.

import { createRandom } from '../core/random.js';

export function createAudio() {
  let ctx = null;
  let master = null;
  let lowpass = null;
  let compressor = null;
  let muted = false;
  let musicTimer = null;
  let heartbeatTimer = null;
  /** Heartbeat tempo: 833 ms = 72 BPM (homeostasis), 429 ms = 140 BPM (febrile). */
  let heartbeatMs = 833;
  let musicStep = 0;
  let bossIntensity = 0;
  let padOscs = null;
  let padGain = null;
  let padFilter = null;
  // 25 ms cooldown per SFX key: 30 pathogens lysing at once never clips.
  const lastSfxAt = {};
  const pendingTimeouts = [];
  function sfxReady(key) {
    const now = performance.now();
    if (lastSfxAt[key] !== undefined && now - lastSfxAt[key] < 25) return false;
    lastSfxAt[key] = now;
    return true;
  }
  function later(fn, ms) {
    const id = setTimeout(() => { fn(); }, ms);
    pendingTimeouts.push(id);
  }
  // Seeded pitch variation: ±8% around the written note, deterministic.
  const pitchRandom = createRandom(20261116);
  function pitchVar() { return 0.92 + pitchRandom() * 0.16; }

  /** Bright pentatonic arpeggio, one note per step, in C major pentatonic. */
  const MUSIC_NOTES = [523.25, 587.33, 659.25, 783.99, 880.0, 783.99, 659.25, 587.33];
  /** The ambient pad chord: C major, warm and low. */
  const PAD_NOTES = [261.63, 329.63, 392.0];

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      // Master chain: gain -> DynamicsCompressor -> gentle low-pass -> out.
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 4200;
      lowpass.Q.value = 0.4;
      compressor.connect(lowpass);
      lowpass.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(compressor);
      startAmbientPad();
      return true;
    } catch {
      return false;
    }
  }

  /** The organic ambient pulse: a soft warm pad chord under everything. */
  function startAmbientPad() {
    if (!ctx || padOscs) return;
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 500;
    padGain = ctx.createGain();
    padGain.gain.value = 0.03;
    padFilter.connect(padGain);
    padGain.connect(master);
    padOscs = PAD_NOTES.map((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(padFilter);
      osc.start();
      return osc;
    });
  }

  function tone(freq, dur, type, vol, slideTo, key) {
    if (!ctx || muted) return;
    if (key && !sfxReady(key)) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pitchVar(), now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + dur);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function noiseBurst(dur, vol, filterFreq, key) {
    if (!ctx || muted) return;
    if (key && !sfxReady(key)) return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic white noise (a tiny LCG): the same burst every time, so
    // even the sound effects carry no unseeded randomness.
    let s = 123456789;
    for (let i = 0; i < len; i += 1) {
      s = (Math.imul(s, 1103515245) + 12345) | 0;
      data[i] = (((s >>> 0) / 4294967296) * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(now);
  }

  /** (Re)start the heartbeat loop at the current tempo. */
  function restartHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (muted || !ctx) return;
      tone(55, 0.14, 'sine', 0.14);
      later(() => tone(48, 0.12, 'sine', 0.11), 160);
    }, heartbeatMs);
  }

  return {
    /** Call from any user gesture so later sounds are allowed. */
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() { return muted; },
    /** Body phase drives the heartbeat: 72 BPM healthy, 140 BPM febrile. */
    setPhysiology(phase) {
      const ms = phase === 'febrile' ? 429 : 833;
      if (ms === heartbeatMs) return;
      heartbeatMs = ms;
      if (heartbeatTimer) restartHeartbeat();
    },
    getHeartbeatMs() { return heartbeatMs; },
    setBossPresence(on) {
      const target = on ? 1 : 0;
      if (target === bossIntensity) return;
      bossIntensity = target;
      if (!ctx || !padFilter || !padGain) return;
      const now = ctx.currentTime;
      padFilter.frequency.setTargetAtTime(on ? 1500 : 500, now, 0.4);
      padGain.gain.setTargetAtTime(on ? 0.07 : 0.03, now, 0.4);
    },
    getBossIntensity() { return bossIntensity; },
    /** Touch 4: Gene Splice Draft muffles the ambient audio (low-pass dip),
     *  restored when combat resumes. */
    setDraftMuffled(on) {
      if (!ctx || !lowpass) return;
      lowpass.frequency.setTargetAtTime(on ? 400 : 4200, ctx.currentTime, 0.3);
    },
    /** Clear every pending scheduled note + the music loop (restart hygiene). */
    resetAudioNodes() {
      for (let i = 0; i < pendingTimeouts.length; i += 1) clearTimeout(pendingTimeouts[i]);
      pendingTimeouts.length = 0;
      this.stopMusic();
      this.setBossPresence(false);
      heartbeatMs = 833;
    },
    /** The T-Cell Lance fires: a bright searing zap. */
    playPerforinLance() { tone(880, 0.09, 'square', 0.08, 440, 'lance'); },
    /** The Plasma Chakram spins out: a bouncing antibody chime. */
    playAntibodyBounce() { tone(1046, 0.08, 'triangle', 0.09, 1568, 'chakram'); tone(784, 0.07, 'sine', 0.07, 1175, 'chakram2'); },
    /** A shot refracts off a Silica Prism: a crystalline shimmer. */
    playPrismRefract() { tone(1318, 0.14, 'sine', 0.12, 1976, 'prism'); tone(988, 0.12, 'triangle', 0.08, 1480, 'prism2'); },
    /** Fibrin Dash + parry: a whoosh and a reversed-toxin chime. */
    playDashParry() { noiseBurst(0.18, 0.10, 1600, 'dash'); tone(1175, 0.12, 'sine', 0.10, 1568, 'dash2'); },
    /** A pathogen lyses: a bright pop + falling vesicles. */
    playCellLysis() { tone(660, 0.16, 'sawtooth', 0.12, 110, 'lysis'); noiseBurst(0.12, 0.09, 1200, 'lysisN'); },
    /** A Gene Splice is drafted: a rising two-note chime. */
    playGeneDraft() { tone(784, 0.1, 'sine', 0.13, undefined, 'gene'); later(() => tone(1046, 0.16, 'sine', 0.13, undefined, 'gene2'), 90); },
    /** Miasma Prime descends: a low two-note alarm. */
    playBossWarning() { tone(98, 0.7, 'sawtooth', 0.16, 49, 'boss'); tone(147, 0.7, 'square', 0.08, 73, 'boss2'); },
    /** Immunity restored: the full victory fanfare. */
    playImmunityVictory() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => later(() => tone(f, 0.3, 'sine', 0.15), i * 130));
    },
    /** A toxin is grazed: a chime whose pitch rises with the graze combo. */
    playGrazeChime(step) {
      const base = 880 + Math.min(12, step || 0) * 60;
      tone(base, 0.1, 'sine', 0.1, base * 1.5, 'graze');
    },
    /** A chain lysis: ascending pentatonic chimes per chain step. */
    playChainChime(step) {
      const f = MUSIC_NOTES[(step || 0) % MUSIC_NOTES.length];
      tone(f, 0.16, 'sine', 0.13, f * 1.2, 'chain');
    },
    /** A same-polarity toxin is phagocytosed: a warm harmonic swell. */
    playAbsorbChime() { tone(659, 0.14, 'sine', 0.11, 988, 'absorb'); tone(880, 0.12, 'triangle', 0.08, 1318, 'absorb2'); },
    /** A perfect Metabolic Vent fires the Interferon Shockwave: a deep boom + shimmer. */
    playNovaBlast() { tone(220, 0.3, 'sawtooth', 0.14, 55, 'nova'); noiseBurst(0.25, 0.12, 900, 'novaN'); },
    /** The Marrow Offering cleansing wave: a rising chord. */
    playCleansingWave() { tone(523, 0.2, 'sine', 0.13, 784, 'cleanse'); later(() => tone(1046, 0.3, 'sine', 0.13, 1568, 'cleanse2'), 120); },
    /** A wave is cleared: a soft chord. */
    playWaveChime() { tone(523, 0.12, 'sine', 0.13, undefined, 'wave'); later(() => tone(784, 0.18, 'sine', 0.13, undefined, 'wave2'), 110); },
    /** A nutrient is picked up: a bright plink. */
    playShardPickup() { tone(1046, 0.08, 'sine', 0.11, 1568, 'pickup'); },
    /** The cell is hurt: a low thud. */
    playCellHurt() { tone(180, 0.22, 'sawtooth', 0.15, 70, 'hurt'); noiseBurst(0.15, 0.10, 700, 'hurtN'); },
    /** The Organ Core is hurt: a deep groan. */
    playCoreHurt() { tone(140, 0.3, 'sawtooth', 0.14, 55, 'corehurt'); },
    /** Defeat: a falling phrase. */
    playDefeat() {
      [392, 330, 262, 196].forEach((f, i) => later(() => tone(f, 0.35, 'triangle', 0.13), i * 160));
    },
    click() { tone(1200, 0.05, 'sine', 0.09, 900, 'click'); },
    startMusic() {
      if (!ensure() || musicTimer) return;
      musicTimer = setInterval(() => {
        if (muted || !ctx) return;
        tone(MUSIC_NOTES[musicStep % MUSIC_NOTES.length], 0.5, 'sine', 0.04);
        musicStep += 1;
      }, 420);
      // Soft heartbeat drone: a low lub-dub under the pad, 72 BPM healthy.
      if (!heartbeatTimer) restartHeartbeat();
    },
    stopMusic() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    },
  };
}
