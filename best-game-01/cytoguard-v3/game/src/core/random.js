// A small seeded random number generator (mulberry32): the same seed gives
// the same game, which is what makes the screenshot scenes repeatable and the
// simulation deterministic. Game logic never calls unseeded randomness, Date
// or the wall clock — only this generator.

export function createRandom(seed) {
  let state = (seed | 0) || 1;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] from the seeded generator. */
export function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** Pick one element of an array from the seeded generator. */
export function randomPick(random, list) {
  return list[Math.floor(random() * list.length)];
}
