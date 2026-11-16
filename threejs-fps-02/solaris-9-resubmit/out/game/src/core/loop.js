import { mkMM, drawMM } from '../ui/minimap.js';
import { mkFeeds, addKill, addKillLine, addRadio } from '../ui/feeds.js';
import { mkCross, updCross } from '../ui/crosshair.js';
import { initTr, spawnTr, settleFl } from '../combat/tracer.js';
import { ventH, mkHeat } from '../combat/heat.js';
import { pickBnty, chkBnty } from '../combat/bounties.js';
import * as droneMod from '../entities/drone.js';
import { ECONOMY, TEAMS, ROUND } from './config.js';
export const DT = 1 / 60;
export { mkBoot } from './boot.js';
export function mkLoop(step, render) {
let acc = 0;
let last = 0;
let raf = 0;
let running = false;
function frame(t) {
if (!running) return;
raf = requestAnimationFrame(frame);
const now = t / 1000;
let dt = now - last;
last = now;
if (dt > 0.25) dt = 0.25;
if (dt < 0) dt = 0;
acc += dt;
let n = 0;
while (acc >= DT && n < 5) {
step(DT);
acc -= DT;
n++;
}
if (n === 5) acc = 0;
render();
}
return {
start() {
if (running) return;
running = true;
last = performance.now() / 1000;
raf = requestAnimationFrame(frame);
},
};
}
export function startGame(S) {
const { boot, seed, shot, staging } = S;
const { renderer, scene, camera, input, lockPointer } = boot;
const Cr = S.career, Gr = S.grenades, Bm = S.buymenu, Wp = S.weapons, Sq = S.squadOrders, St = S.state, Ba = S.ballistics, Vm = S.viewmodel, Sb = S.scoreboard, Pr = S.prisms, Bo = S.bot;
const state = St.mkState(seed);
const world = S.mp.mkMap(scene);
const synth = S.synth.mkSynth();
const hudObj = S.hd.createHud(state);
S.hd.setHudVis(hudObj, false);
const mm = mkMM(null, world);
const feeds = mkFeeds();
const ch = mkCross();
state.cols = world.cols;
state.mp = world;
state.world = world;
state.spawns = world.spawns;
state.sfx = synth;
state.hd = {
popup: (t) => sPo(t), hitmarker: (k) => S.hd.hitmark(hudObj, k),
};
state.prisms = S.prisms;
state.player = state.plrs[0];
state.heat = mkHeat('rifle');
state.player.heat = state.heat;
state.drones = [];
state.tripSensor = null;
Cr.load();
Cr.syncState(state);
Gr.initNades(scene);
initTr(scene);
St.resetRd(state);
const bm = S.bm.mkBomb({});
scene.add(bm.mesh);
bm.resetRd(state.plrs[0]);
let vm = Vm.buildVM('rifle');
camera.add(vm.group);
let vmVisible = false;
function setVMVis(v) { vmVisible = v; if (vm && vm.group) vm.group.visible = v; }
setVMVis(false);
const ML = S.archives.MECHANIC_LORE;
const $id = (id) => document.getElementById(id);
const sP = (p) => S.hd.setPhase(hudObj, p);
const sPo = (t) => S.hd.popup(hudObj, t);
function hideStage() { S.hd.setHudVis(hudObj, false); setVMVis(false); }
function showStage() { S.hd.setHudVis(hudObj, true); setVMVis(true); }
function cam(x, y, z, lx, ly, lz) { camera.position.set(x, y, z); camera.lookAt(lx, ly, lz); }
function setW(id) { me.weapon = id; me.wId = id; }
scene.add(camera);
const me = state.plrs[0];
const bots = [];
for (let i = 0; i < 9; i++) {
const b = Bo.mkBot(i < 4 ? TEAMS.SOLARIS : TEAMS.VOIDBORNE, i < 4 ? i : i - 4);
bots.push(b);
scene.add(b.group);
}
const drones = [];
const dA = droneMod.mkDrone('voidborne', { x: -9, z: 1 });
const dB = droneMod.mkDrone('voidborne', { x: 18, z: -2 });
drones.push(dA, dB);
scene.add(dA.group);
scene.add(dB.group);
state.drones = drones;
const enemies = [];
for (let i = 0; i < state.plrs.length; i++) { if (state.plrs[i].tm !== me.tm) enemies.push(state.plrs[i]); }
camera.position.set(me.x, 1.62, me.z);
const GEAR_PRICE = { kevlar: 650, helmet: 350, smoke: 300, flash: 200, kit: 400 };
state.buy = (id) => {
const isWeapon = Wp.WEAPON_IDS.indexOf(id) >= 0;
const price = isWeapon ? Wp.getWpn(id).price : GEAR_PRICE[id];
if (!price || me.owned[id] || me.cash < price) return false;
me.cash -= price;
me.owned[id] = true;
if (isWeapon) {
setW(id);
const g = Wp.getWpn(id);
me.mag = g.mag;
me.reserve = g.reserve;
switchVM(id);
} else if (id === 'kevlar') me.armor = Math.min(100, me.armor + 50);
else if (id === 'helmet') me.hasHelmet = true;
else if (id === 'smoke') me.smokeN = (me.smokeN || 0) + 1;
else if (id === 'flash') me.flashN = (me.flashN || 0) + 1;
else if (id === 'kit') me.hasKit = true;
Bm.openBuyMenu(state);
return true;
};
function startRound() {
state.phase = 'buy';
sP('buy');
if (typeof Sq.pickOrder === 'function' && typeof Sq.applyOrder === 'function') { Sq.applyOrder(state, Sq.pickOrder(state)); }
pickBnty(state);
Bm.openBuyMenu(state);
buyOpen = true;
hideStage();
document.exitPointerLock();
}
function beginLive() {
if (state.phase !== 'buy') return;
state.phase = 'live';
state.timeLeft = ROUND.roundTime;
sP('live');
showStage();
}
function endRound(winner) {
const r = St.awardRd(state, winner);
Bm.closeBuyMenu();
buyOpen = false;
if (r === 'matchEnd') { endMatch(); return; }
state.round++;
St.resetRd(state);
bm.resetRd(me);
Gr.clearNades();
synth.sting(winner === TEAMS.SOLARIS ? 'win' : 'lose');
startRound();
}
function endMatch() {
const won = state.score.solaris > state.score.voidborne;
Cr.addCredits((won ? 50 : 25) + 5 * (me.kills || 0));
Cr.syncState(state);
state.phase = 'matchEnd';
sP('matchEnd');
synth.sting('victory');
hideStage();
Sb.showVic(state);
}
function aliveCount(t) {
let n = 0;
for (let i = 0; i < state.plrs.length; i++) {
const p = state.plrs[i];
if (p.tm === t && p.alive) n++;
}
return n;
}
function nearSite(x, z) {
const sites = world.sites;
if (Math.hypot(x - sites.A.x, z - sites.A.z) < 3.5) return 'A';
if (Math.hypot(x - sites.B.x, z - sites.B.z) < 3.5) return 'B';
return null;
}
function startReload() {
if (!me.alive || me.reloading) return;
const w = Wp.getWpn(me.weapon);
if (me.mag >= w.mag || me.reserve <= 0) return;
me.reloading = true;
me.reloadUntil = state.time + w.reloadTime;
}
function switchVM(wid) {
if (vm.group.parent) vm.group.parent.remove(vm.group);
vm = Vm.buildVM(wid);
camera.add(vm.group);
vm.group.visible = vmVisible;
}
function plantDefuse(dt) {
const b = state.bm;
b.canPlant = false;
b.canDefuse = false;
b.defusing = false;
if (!me.alive || (state.phase !== 'live' && state.phase !== 'planted')) {
me.planting = 0;
me.defusing = 0;
b.progress = 0;
return;
}
if (bm.status === 'carried' && bm.carrier === me && state.phase === 'live') {
const si = nearSite(me.x, me.z);
if (si && input.keys.KeyE) {
b.canPlant = true;
me.planting += dt;
b.progress = me.planting / 3;
if (me.planting >= 3 && bm.plant(si, world.sites[si].x, world.sites[si].z, me)) {
me.planting = 0;
b.progress = 0;
state.phase = 'planted';
sP('planted');
me.cash = Math.min(ECONOMY.max, me.cash + ECONOMY.plant);
me.plants = (me.plants || 0) + 1;
sPo('SPIKE PLANTED');
}
} else me.planting = 0;
}
if (bm.status === 'planted' && state.phase === 'planted') {
const s = world.sites[bm.si];
const near = s && Math.hypot(me.x - s.x, me.z - s.z) < 3.5;
if (near && input.keys.KeyE) {
b.canDefuse = true;
b.defusing = true;
const res = bm.updateDefuse(dt, true, !!me.hasKit);
b.progress = bm.defuseProgress(!!me.hasKit);
if (res === 'defused') {
me.defuses = (me.defuses || 0) + 1;
me.cash = Math.min(ECONOMY.max, me.cash + ECONOMY.defuse);
const rw = chkBnty(state, { type: 'defuse', underFire: aliveCount(TEAMS.VOIDBORNE) > 0 });
if (rw) sPo('BOUNTY +' + rw + ' CR');
endRound(TEAMS.SOLARIS);
}
} else {
bm.updateDefuse(dt, false, !!me.hasKit);
b.progress = 0;
}
}
}
const keys = input.keys;
let mouseDown = false, prevDown = false, buyOpen = false, started = false;
document.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
renderer.domElement.addEventListener('click', () => {
if (!staging && !buyOpen && (state.phase === 'live' || state.phase === 'planted')) lockPointer();
});
document.addEventListener('keydown', (e) => {
if (staging || e.repeat) return;
const live = state.phase === 'live' || state.phase === 'planted';
if (e.code === 'KeyB') {
if (buyOpen) { Bm.closeBuyMenu(); buyOpen = false; lockPointer(); }
else if (state.phase === 'buy') { Bm.openBuyMenu(state); buyOpen = true; document.exitPointerLock(); }
} else if (e.code === 'Escape') {
if (buyOpen) { Bm.closeBuyMenu(); buyOpen = false; }
} else if (e.code === 'KeyQ' && live) {
const p = S.polarity.togglePolarity(state);
sPo(ML.polarity.nm.toUpperCase() + ': ' + (p === 'gold' ? 'SOLAR-GOLD' : 'VOID-VIOLET'));
} else if (e.code === 'KeyR' && live) {
if (ventH(state.heat)) sPo(ML.venting.nm.toUpperCase() + ' — HEAT 0');
} else if (e.code === 'KeyF' && live) {
const hijack = droneMod.tryHijack || droneMod.tryOverride;
const d = hijack ? hijack(state, me.pos) : null;
if (d) sPo(ML.override.nm.toUpperCase() + ' — DRONE YOURS 12s');
} else if (e.code === 'KeyG' && live) {
const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
Pr.placeTrip({ x: me.x + fx * 2.5, z: me.z + fz * 2.5 });
state.tripSensor = Pr.getTrip();
sPo('TRIP-SENSOR PLACED — SITE A');
} else if (e.code === 'KeyT' && live) startReload();
else if (e.code === 'KeyV' && live && me.smokeN > 0) {
if (Gr.throwNade(state, me, 'smoke')) me.smokeN--;
} else if (e.code === 'KeyC' && live && me.flashN > 0) {
if (Gr.throwNade(state, me, 'flash')) me.flashN--;
} else if (e.code.indexOf('Digit') === 0) {
const n = Number(e.code.slice(5)) - 1;
const wid = Wp.WEAPON_IDS[n];
if (wid && me.owned[wid] && wid !== me.weapon) {
setW(wid);
const g = Wp.getWpn(wid);
me.mag = g.mag;
me.reserve = g.reserve;
me.reloading = false;
switchVM(wid);
}
}
});
const deployBtn = $id('deploy-btn');
if (deployBtn) deployBtn.addEventListener('click', () => {
synth.init();
synth.resume();
const ov = $id('overlay-start');
if (ov) ov.style.display = 'none';
lockPointer();
started = true;
startRound();
});
const diffEl = $id('difficulty');
if (diffEl) diffEl.addEventListener('click', (e) => {
const b = e.target.closest('button');
if (!b) return;
const btns = diffEl.querySelectorAll('button');
for (let i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i] === b);
});
const buyRoot = $id('buy-mnu');
if (buyRoot) buyRoot.addEventListener('click', (e) => {
const card = e.target.closest('.spec-card');
if (!card) return;
let id = card.getAttribute('data-spec');
if (id === 'oracle') id = 'nova';
if (Cr.unlock(id)) {
Cr.syncState(state);
Bm.openBuyMenu(state);
}
});
function step(dt) {
state.time += dt;
if (!started || state.phase === 'matchEnd') return;
if (state.phase === 'buy' && !buyOpen) beginLive();
while (state.radioLog.length) addRadio(feeds, state.radioLog.shift());
if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'planted') {
state.timeLeft -= dt;
if (state.timeLeft <= 0 && state.phase !== 'planted') {
if (state.phase === 'buy') { if (buyOpen) { Bm.closeBuyMenu(); buyOpen = false; } beginLive(); return; }
endRound(TEAMS.VOIDBORNE); return;
}
}
const inp = {
f: keys.KeyW ? 1 : 0, b: keys.KeyS ? 1 : 0, l: keys.KeyA ? 1 : 0, r: keys.KeyD ? 1 : 0,
crouch: !!(keys.ControlLeft || keys.KeyC), jump: !!keys.Space,
lookDX: input.mouse.dx, lookDY: input.mouse.dy,
};
input.resetMouse();
if (me.alive && (state.phase === 'live' || state.phase === 'planted')) S.movement.updPlayer(state, inp, dt);
camera.position.set(me.x, me.pos.y + me.eyeHeight, me.z);
camera.rotation.y = me.yaw;
camera.rotation.x = me.pitch;
const w = Wp.getWpn(me.weapon);
const firing = mouseDown && input.locked && (w.auto || !prevDown);
me.firing = firing;
if (firing && me.alive && !me.reloading && state.time >= (me.nextShotAt || 0)) {
if (me.mag > 0) {
me.mag--;
me.nextShotAt = state.time + w.interval;
const res = Ba.fireShot(state, me, enemies);
if (res && res.killed) {
addKill(feeds, me.nm, res.target.nm, res.headshot, w.nm);
const rw = chkBnty(state, { type: 'kill', headshot: res.headshot, crouched: me.crouched, viaPylon: !!res.viaPylon });
if (rw) sPo('BOUNTY +' + rw + ' CR');
}
if (vm.kick) vm.kick(1);
}
}
prevDown = mouseDown;
if (me.reloading && state.time >= me.reloadUntil) {
const need = w.mag - me.mag, take = Math.min(need, me.reserve);
me.mag += take;
me.reserve -= take;
me.reloading = false;
}
for (let i = 0; i < bots.length; i++) Bo.updateBot(bots[i], state, dt);
for (let i = 0; i < drones.length; i++) droneMod.updateDrone(drones[i], state, dt);
if (bm.status === 'carried' && bm.carrier && bm.carrier.alive === false) {
const c = bm.carrier;
bm.drop(c.pos ? c.pos.x : c.x, c.pos ? c.pos.z : c.z);
}
if (bm.status === 'dropped') {
if (bm.tryPickup(me, 1.1)) {   }
else for (let i = 0; i < bots.length; i++) if (bots[i].alive) bm.tryPickup(bots[i], 1.1);
}
const bev = bm.update(dt);
if (bev === 'beep') {
synth.setBombBeepRate(1.1 + (1 - bm.timer / 35) * 4.5);
synth.playBeep();
}
if (bev === 'explode') { endRound(TEAMS.SOLARIS); return; }
Gr.updNades(state, dt);
state.smokes = Gr.getSmokes();
Ba.update(dt, state);
if (vm.update) vm.update(dt, state);
plantDefuse(dt);
state.bm.state = bm.status;
state.bm.si = bm.si;
state.bm.x = bm.mesh.position.x;
state.bm.z = bm.mesh.position.z;
state.bm.timer = bm.timer;
state.bm.carrier = bm.carrier === me ? 0 : (bm.carrier ? bm.carrier.id : -1);
if (state.phase === 'live' || state.phase === 'planted') {
if (aliveCount(TEAMS.SOLARIS) === 0) { endRound(TEAMS.VOIDBORNE); return; }
if (aliveCount(TEAMS.VOIDBORNE) === 0 && bm.status !== 'planted') { endRound(TEAMS.SOLARIS); return; }
}
me.spread = Ba.getSpread(me);
}
function render() {
S.hd.updateHud(hudObj, state, DT);
drawMM(mm, state);
updCross(ch, state);
renderer.render(scene, camera);
}
let stageT = 0;
function stageStep(dt) {
stageT += dt;
for (let i = 0; i < bots.length; i++) bots[i].group.rotation.y = bots[i].yaw;
if (vm.update) vm.update(dt, state);
if (bm.status === 'planted') {
bm.light.intensity = 14;
bm.stripMat.emissiveIntensity = 2.4;
}
}
function pose(bot, x, z, yaw, hp) {
bot.pos.set(x, 0, z);
bot.yaw = yaw;
bot.group.rotation.y = yaw;
if (typeof hp === 'number') bot.hp = hp;
const r = state.plrs[bot.id];
if (r) {
r.x = x; r.z = z; r.pos.x = x; r.pos.z = z; r.yaw = yaw;
if (typeof hp === 'number') r.hp = hp;
r.alive = true;
}
}
function stageShot(nm) {
const overlay = $id('overlay-start');
if (nm === 'start') {
hideStage();
cam(-2, 9.5, 31, 0, 2, -6);
pose(bots[0], -14, 2, 0.51);
pose(bots[1], 12, -2, -0.5);
pose(bots[2], -9, 18, 0.35);
pose(bots[3], 9, 18, -0.35);
pose(bots[4], -20, -8, 0.52);
} else if (nm === 'buy') {
state.round = 6;
me.cash = 4850;
me.owned = { pistol: true, smg: true, rifle: true, marksman: true, rail: true, kevlar: true, helmet: true, smoke: true, flash: true, kit: true };
setW('rifle');
me.mag = 30;
me.reserve = 90;
Cr.setCredits(2170);
const ids = ['vanguard', 'recon', 'sentinel', 'nova'];
for (let i = 0; i < ids.length; i++) Cr.unlock(ids[i]);
Cr.syncState(state);
state.credits = 770;
state.plan = 'A-DOME SPLIT';
Sq.applyOrder(state, 1);
hideStage();
if (overlay) overlay.style.display = 'none';
cam(0, 10, 26, 0, 1, 0);
Bm.openBuyMenu(state);
} else if (nm === 'combat') {
state.round = 7;
state.phase = 'live';
state.plan = 'A-DOME SPLIT';
Sq.applyOrder(state, 1);
addRadio(feeds, 'RADIO: Contact at Solaris Dome — override Drone & Defuse!');
showStage();
state.timeLeft = 34;
state.score = { solaris: 4, voidborne: 2 };
me.hp = 42; me.armor = 85; me.hasHelmet = true; me.cash = 1450;
setW('rifle'); me.mag = 24; me.reserve = 90; me.owned.rifle = true;
me.x = -10; me.z = 12.5; me.pos.x = -10; me.pos.z = 12.5; me.pos.y = 0;
me.yaw = 1.06; me.pitch = 0;
pose(bots[4], -16, 7.5, 0.88);
pose(bots[5], -12.5, 6, 0.37);
const foeRec = state.plrs[5];
foeRec.visible = true;
state.plrs[6].visible = true;
me.yaw = 1.336; me.pitch = 0;
Gr.throwNade(state, me, 'smoke');
for (let i = 0; i < 120; i++) Gr.updNades(state, 1 / 60);
state.smokes = Gr.getSmokes();
me.yaw = 1.06; me.pitch = 0;
bm.plant('A', -22, 0, null);
bm.light.intensity = 14;
bm.stripMat.emissiveIntensity = 2.4;
state.bm.state = 'planted'; state.bm.si = 'A';
state.bm.x = -22; state.bm.z = 0; state.bm.timer = 18;
state.bm.defusing = true; state.bm.canDefuse = true; state.bm.progress = 0.45;
state.phase = 'planted';
dA.tm = 'solaris'; dA.overrideT = 12;
dA.sensorMat.color.setHex(0x48cae4);
if (dA.goldRing) dA.goldRing.visible = true;
dA.pos.set(-13, 6.5, -1);
dA.ax = -13; dA.az = -1;
dA.aimDir.set(-12.5 - dA.pos.x, 1.66 - dA.pos.y, 6 - dA.pos.z).normalize();
Ba.fireShot(state, me, enemies);
settleFl();
if (vm.kick) vm.kick(1);
spawnTr(dA.pos, { x: -12.5, y: 1.66, z: 6 }, 0x48cae4);
const _py = { x: -18, y: 1.7, z: 8 };
spawnTr(_py, { x: -16, y: 1.9, z: 7.5 }, 0x8ef6ff, true);
spawnTr(_py, { x: -14.2, y: 1.7, z: 6.7 }, 0x8ef6ff, true);
spawnTr(_py, { x: -12.5, y: 1.8, z: 6 }, 0x8ef6ff, true);
const _py2 = { x: -18, y: 1.76, z: 8 };
spawnTr(_py2, { x: -16, y: 1.96, z: 7.5 }, 0x8ef6ff, true);
spawnTr(_py2, { x: -14.2, y: 1.76, z: 6.7 }, 0x8ef6ff, true);
spawnTr(_py2, { x: -12.5, y: 1.86, z: 6 }, 0x8ef6ff, true);
spawnTr({ x: -10.4, y: 1.7, z: 12.1 }, { x: -16, y: 1.9, z: 7.5 }, 0xf4a261, true);
bots[4].hp = 45; bots[4].setHp();
state.plrs[5].hp = 45;
bots[5].hp = 100; bots[5].setHp();
state.plrs[6].hp = 100;
state.heat.heat = 78;
state.bounty = { label: 'BOUNTY: CROUCH HEADSHOT (+$800)', reward: 800, done: false };
state.cmdLine = '[CMD]: "Override Eclipse Drone & Defuse Site A!"';
addKillLine(feeds, 'You VANGUARD RIFLE ⌖ Shade');
sPo('+120 HEADSHOT • RESONANCE SHATTER');
if (overlay) overlay.style.display = 'none';
cam(me.x, me.pos.y + me.eyeHeight, me.z, -16, 1.66, 7.5);
} else if (nm === 'victory') {
state.round = 15;
hideStage();
state.score = { solaris: 8, voidborne: 6 };
state.phase = 'matchEnd';
me.kills = 14; me.headshots = 6; me.deaths = 5; me.assists = 3;
me.plants = 2; me.defuses = 1; me.damage = 2400;
const stats = [[8, 6, 2], [6, 7, 4], [5, 6, 1], [9, 8, 3], [7, 9, 2], [6, 10, 5], [5, 11, 2], [4, 9, 3]];
for (let i = 0; i < 8; i++) {
const p = state.plrs[i + 1];
p.kills = stats[i][0]; p.deaths = stats[i][1]; p.assists = stats[i][2];
p.headshots = Math.min(p.kills, 2 + i); p.damage = p.kills * 170 + 120;
}
Cr.setCredits(1770);
Cr.unlock('vanguard');
Cr.unlock('recon');
Cr.unlock('nova');
Cr.syncState(state);
state.chronicle = '"Astral Conduit stabilized at Solaris Dome — Eclipse vanguard repelled."';
if (overlay) overlay.style.display = 'none';
cam(0, 12, 30, 0, 2, 0);
Sb.showVic(state);
}
sP(state.phase);
}
if (staging) {
stageShot(shot);
mkLoop(stageStep, render).start();
} else { mkLoop(step, render).start(); }
}
