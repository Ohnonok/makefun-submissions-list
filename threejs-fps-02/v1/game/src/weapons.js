// Weapons, spray patterns and the buy catalogue. One job: what a gun is.
// Damage is per-hit at close range; falloff starts past falloffStart and bottoms at
// falloffMin. Headshots multiply by 4. Spread is in radians; moving, airborne and
// firing fast all widen it — stopping to aim pays, per the bounty.
export const WEAPONS = {
  p250: {
    name: 'P250 Sidearm', short: 'P250', price: 0, kind: 'pistol',
    damage: 34, headMult: 4, rpm: 400, mag: 12, reserve: 36, reload: 1.4,
    spread: 0.011, moveSpread: 0.030, airSpread: 0.055, recoil: 0.006,
    falloffStart: 18, falloffMin: 0.6, auto: false, zoom: 1,
    desc: 'Free sidearm. Reliable, light, weak at range.',
  },
  mp5: {
    name: 'VK-9 “Kiln” SMG', short: 'VK-9', price: 1500, kind: 'smg',
    damage: 26, headMult: 4, rpm: 750, mag: 30, reserve: 120, reload: 2.1,
    spread: 0.014, moveSpread: 0.022, airSpread: 0.05, recoil: 0.008,
    falloffStart: 14, falloffMin: 0.55, auto: true, zoom: 1,
    desc: 'Fast close-quarters SMG. Spray climbs hard past shot 6.',
  },
  ak47: {
    name: 'BR-47 “Brick” Rifle', short: 'BR-47', price: 2700, kind: 'rifle',
    damage: 36, headMult: 4, rpm: 600, mag: 30, reserve: 90, reload: 2.5,
    spread: 0.008, moveSpread: 0.034, airSpread: 0.06, recoil: 0.011,
    falloffStart: 22, falloffMin: 0.7, auto: true, zoom: 1,
    desc: 'The workhorse rifle. One-tap headshot, honest recoil.',
  },
  awp: {
    name: 'L-90 “Long Kiln” Sniper', short: 'L-90', price: 4750, kind: 'sniper',
    damage: 110, headMult: 2.5, rpm: 48, mag: 5, reserve: 30, reload: 3.6,
    spread: 0.002, moveSpread: 0.09, airSpread: 0.12, recoil: 0.05,
    falloffStart: 30, falloffMin: 0.9, auto: false, zoom: 2.4,
    desc: 'Scoped one-shot body killer. Useless on the move.',
  },
  deagle: {
    name: 'D-50 “Furnace” Heavy Pistol', short: 'D-50', price: 700, kind: 'pistol',
    damage: 53, headMult: 4, rpm: 267, mag: 7, reserve: 35, reload: 2.2,
    spread: 0.012, moveSpread: 0.04, airSpread: 0.06, recoil: 0.02,
    falloffStart: 16, falloffMin: 0.6, auto: false, zoom: 1,
    desc: 'Slow, loud, deletes heads. Seven rounds of argument.',
  },
};
// Learnable spray: each weapon's recoil climbs in a fixed per-shot pattern
// (alternating left/right drift after the first shots) so bursts can be learned.
export function sprayOffset(weapon, shotIndex, rng) {
  const w = WEAPONS[weapon];
  const n = Math.min(shotIndex, 12);
  const climb = w.recoil * n * 0.9;
  const drift = n < 3 ? 0 : (n % 2 === 0 ? 1 : -1) * w.recoil * 0.35 * (n - 2);
  // A whisper of seeded jitter so no two bursts are pixel-identical.
  const jx = (rng() - 0.5) * w.recoil * 0.3;
  return { pitch: climb, yaw: drift + jx };
}
export function damageAt(weapon, dist, head) {
  const w = WEAPONS[weapon];
  let d = w.damage;
  if (dist > w.falloffStart) {
    const t = Math.min(1, (dist - w.falloffStart) / 24);
    d *= 1 - (1 - w.falloffMin) * t;
  }
  if (head) d *= w.headMult;
  return d;
}
export const BUY_ITEMS = [
  { id: 'mp5', key: '1', label: 'VK-9 SMG', price: 1500, desc: '30-round SMG, close quarters' },
  { id: 'ak47', key: '2', label: 'BR-47 Rifle', price: 2700, desc: '30-round rifle, one-tap heads' },
  { id: 'awp', key: '3', label: 'L-90 Sniper', price: 4750, desc: 'Scoped, one-shot body kill' },
  { id: 'deagle', key: '4', label: 'D-50 Heavy Pistol', price: 700, desc: '7-round hand cannon' },
  { id: 'armor', key: '5', label: 'Kevlar + Helmet', price: 1000, desc: 'Halves damage, blocks headshot bonus' },
  { id: 'smoke', key: '6', label: 'Smoke Grenade', price: 300, desc: 'Blocks sight for 12 s (G to throw)' },
  { id: 'flash', key: '7', label: 'Flash Grenade', price: 200, desc: 'Blinds looking enemies 2.5 s (F)' },
  { id: 'kit', key: '8', label: 'Defuse Kit', price: 400, desc: 'Defuse in 2.5 s instead of 5 s' },
];
export const ECONOMY = {
  start: 800, roundWin: 3250, roundLoss: 1900, lossStreakBonus: 500,
  kill: 300, plant: 300, defuse: 300, maxMoney: 16000,
};
