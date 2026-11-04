/**
 * Deterministic random numbers.
 *
 * The whole world is derived from one 32-bit seed: same seed, same city,
 * on every machine. Never use Math.random() for anything that shapes the world.
 */

/** 32-bit FNV-1a hash of a string. Turns labels like "trees" into sub-seeds. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes two 32-bit integers into one well-distributed 32-bit integer. */
export function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ b;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** mulberry32 — float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] (both inclusive). */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Independent child stream. Each generator feature draws from its own fork,
   * so adding random calls to one feature does not reshuffle the others.
   */
  fork(label) {
    return new Rng(hash2(this.seed, hashString(label)));
  }
}
