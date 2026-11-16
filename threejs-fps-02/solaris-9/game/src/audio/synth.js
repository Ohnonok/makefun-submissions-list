import { sfx } from './sound.js';
import { sting } from './music.js';
export function mkSynth() {
const synth = {
beepRate: 1.1, comp: null, ready: false,
init() {
sfx.init();
if (!sfx.ctx || synth.comp) return;
try {
const c = sfx.ctx.createDynamicsCompressor();
c.threshold.value = -18; c.knee.value = 22; c.ratio.value = 8;
c.attack.value = 0.003; c.release.value = 0.18;
sfx.master.disconnect();
sfx.master.connect(c);
c.connect(sfx.ctx.destination);
synth.comp = c;
synth.ready = true;
} catch (e) {   }
},
shot(id) { sfx.shot(id); },
playBeep(final) { sfx.plantBeep(final); },
setBombBeepRate(r) { synth.beepRate = r < 0.5 ? 0.5 : r > 6 ? 6 : r; },
sting(kind) { sting(kind); },
resume() { sfx.resume(); },
};
return synth;
}
