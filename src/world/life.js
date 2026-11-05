/**
 * Street life: walkers (some with a dog), pigeons that flee the taxi, bird
 * flocks, swans and ducks on the Spree, UFOs and planes. PURE: no DOM/WebGL.
 * Positions are closed-form functions of time t; only pigeons keep state
 * (how scared they are). lifeMesh() rebuilds one small mesh per frame.
 */
import { MeshBuilder, MAT, rgb } from '../gfx/meshBuilder.js';
import { Rng, hash2 } from '../core/rng.js';

const SKIN = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69].map(rgb);
const CLOTH = [0x2b4c7e, 0x7e2b2b, 0x2f6b3a, 0x333333, 0xd9a441, 0x8a5fb8, 0xdddddd].map(rgb);
const LIGHTS = [0xff3030, 0x30ff60, 0xffe040].map(rgb);
const C = Object.fromEntries(Object.entries({ grey: 0x8c8f96, dark: 0x2a2a2a, white: 0xf4f4f0, brown: 0x7a5a3a,
  metal: 0xaab0b8, glass: 0x7fe8ff, orange: 0xe08a20, green: 0x2f7a3a, red: 0xc8302c, flash: 0xbfe6ff }).map(([k, v]) => [k, rgb(v)]));
const NEAR = 160; // walkers, pigeons and swans further than this from the taxi are skipped
const mod = (a, n) => ((a % n) + n) % n;

export function createLife(city) {
  const rng = new Rng(city.seed).fork('life'), r = (a, b) => rng.range(a, b), dir = () => (rng.chance(0.5) ? 1 : -1);
  const B = city.bounds, R = city.river;
  const sides = city.blocks.filter((b) => b.kind !== 'park');
  const parks = city.blocks.filter((b) => b.kind === 'park');
  const loop = (b) => ({ x0: b.x0 + 2, z0: b.z0 + 2, x1: b.x1 - 2, z1: b.z1 - 2 }); // middle of the sidewalk
  const tower = city.landmarks.find((l) => l.kind === 'tvTower');
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, zm = (R.z0 + R.z1) / 2;
  return {
    walkers: sides.flatMap((b) => Array.from({ length: rng.int(3, 6) }, () => ({
      loop: loop(b), s: r(0, 400), v: r(1, 1.6) * dir(), k: r(0.9, 1.1),
      skin: rng.pick(SKIN), top: rng.pick(CLOTH), legs: rng.pick(CLOTH), dog: rng.chance(0.15),
    }))),
    pigeons: Array.from({ length: 70 }, () => {
      const [x, z] = walkerPos({ loop: loop(rng.pick(sides)), s: r(0, 400), v: 0 }, 0);
      return { x: x + r(-1, 1), z: z + r(-1, 1), h: r(0, 6), a: 0, ax: 0, az: 0 };
    }),
    flocks: Array.from({ length: 3 }, (_, i) => {
      const b = parks[i % parks.length] ?? sides[i];
      return { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, y: r(22, 40), R: r(18, 35), w: r(0.25, 0.4) * dir(), n: rng.int(6, 10) };
    }),
    river: { x0: B.x0 - 100, w: B.x1 - B.x0 + 200 },
    // Swimmers keep clear of the bridge piers in mid-river.
    swans: Array.from({ length: 14 }, () => ({ s: r(0, 2000), z: zm + dir() * r(2.5, (R.z1 - R.z0) / 2 - 5), v: r(0.3, 0.8) * dir(), swan: rng.chance(0.4) })),
    // One UFO circles the TV tower's antenna, two roam the sky above it.
    ufos: [{ x: tower.x, z: tower.z, y: 238, A: 45, B: 45, a: 0.3, b: 0.3, p: 0 },
      ...[1, 2].map(() => ({ x: r(B.x0, B.x1) / 2, z: r(B.z0, B.z1) / 2, y: r(300, 360), A: r(100, 250), B: r(100, 250), a: r(0.05, 0.12), b: r(0.05, 0.12), p: r(0, 6) }))],
    // One low plane right over the city (shifted sideways if its line would hit the tower), two cruising high with contrails.
    planes: [[140, 0.06, 0, 0], [450, 0.03, r(-500, 500), 1], [650, 0.025, r(-700, 700), 1]].map(([y, v, off, trail]) => {
      const h = r(0, 6.3), lat = (tower.x - cx) * Math.cos(h) - (tower.z - cz) * Math.sin(h);
      return { y, v, trail, h, p: r(0, 1), off: y < 300 && Math.abs(lat - off) < 40 ? lat + 60 : off };
    }),
    cx, cz,
    // Two flying time-travel cars, each on its own schedule (seconds); not on the boulevard (gate).
    jumps: [23, 31], seed: city.seed, streets: city.streetsEW.filter((s) => s.kind !== 'boulevard').map((s) => s.center), x0: B.x0 + 40, x1: B.x1 - 130,
  };
}

/** Position on a rectangular loop at distance s + v·t → [x, z, dirX, dirZ]. */
export function walkerPos({ loop: q, s, v }, t) {
  const w = q.x1 - q.x0, h = q.z1 - q.z0, d = Math.sign(v) || 1;
  let u = mod(s + v * t, 2 * (w + h));
  if (u < w) return [q.x0 + u, q.z0, d, 0];
  if ((u -= w) < h) return [q.x1, q.z0 + u, 0, d];
  if ((u -= h) < w) return [q.x1 - u, q.z1, -d, 0];
  return [q.x0, q.z1 - (u - w), 0, -d];
}

/** Builds this frame's mesh around `car`. Advances pigeon fear by dt (the only state); scare=false when the taxi is hidden. */
export function lifeMesh(life, t, dt, car, scare = true) {
  const m = new MeshBuilder();
  const near = (x, z) => (x - car.x) ** 2 + (z - car.z) ** 2 < NEAR * NEAR;
  // Entity frame like rotationY: local +Z forward, +X left.
  const frame = (ox, oy, oz, h) => {
    const c = Math.cos(h), s = Math.sin(h);
    return (x, y, z) => [ox + x * c + z * s, oy + y, oz - x * s + z * c];
  };
  const box = (T, x0, y0, z0, x1, y1, z1, col, mat = MAT.PLAIN) => {
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map((p) => T(...p));
    const inside = T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 4, 7, 3], [1, 5, 6, 2], [3, 2, 6, 7], [0, 1, 5, 4]]) m.poly(f.map((i) => P[i]), col, mat, inside);
  };
  // Flapping wings, both faces, so they show from above and below.
  const wings = (T, span, flap, col) => {
    for (const s of [-1, 1]) for (const up of [-1, 1]) {
      m.poly([T(s * 0.06, 0, span * 0.25), T(s * span, Math.sin(flap) * span * 0.6, 0), T(s * 0.06, 0, -span * 0.2)], col, MAT.PLAIN, T(0, up, 0));
    }
  };

  for (const w of life.walkers) {
    const [x, z, dx, dz] = walkerPos(w, t);
    if (!near(x, z)) continue;
    const T = frame(x, 0.15, z, Math.atan2(dx, dz)), k = w.k, sw = Math.sin(t * Math.abs(w.v) * 4.5) * 0.18;
    box(T, -0.17, 0, sw - 0.06, -0.03, 0.85 * k, sw + 0.06, w.legs);
    box(T, 0.03, 0, -sw - 0.06, 0.17, 0.85 * k, 0.06 - sw, w.legs);
    box(T, -0.21, 0.85 * k, -0.12, 0.21, 1.45 * k, 0.12, w.top);
    box(T, -0.1, 1.48 * k, -0.1, 0.1, 1.72 * k, 0.12, w.skin);
    if (w.dog) {
      box(T, 0.55, 0.2, -0.9, 0.75, 0.42, -0.35, C.brown);
      box(T, 0.57, 0.35, -0.35, 0.73, 0.55, -0.12, C.brown);
    }
  }

  for (const p of life.pigeons) {
    const d = scare ? Math.hypot(p.x - car.x, p.z - car.z) : 99;
    if (d < 9 && p.a < 0.2) [p.ax, p.az] = [(p.x - car.x) / (d || 1), (p.z - car.z) / (d || 1)]; // fly away from the taxi
    p.a = d < 9 ? Math.min(1, p.a + dt * 2) : Math.max(0, p.a - dt * 0.12); // quick to flee, slow to come back
    if (!near(p.x, p.z)) continue;
    const e = p.a * p.a * (3 - 2 * p.a), fly = p.a > 0;
    const T = frame(p.x + p.ax * e * 12, 0.15 + e * 6, p.z + p.az * e * 12, fly ? Math.atan2(p.ax, p.az) : p.h);
    const peck = fly ? 0 : Math.max(0, Math.sin(t * 3 + p.h)) * 0.08;
    box(T, -0.07, 0.05, -0.14, 0.07, 0.17, 0.1, C.grey);
    box(T, -0.04, 0.14 - peck, 0.08, 0.04, 0.23 - peck, 0.17, C.grey);
    if (fly) wings(T, 0.3, t * 22 + p.h, C.grey);
  }

  for (const f of life.flocks) {
    for (let i = 0; i < f.n; i++) {
      const a = t * f.w + i * 0.35, R = f.R + Math.sin(i * 1.7) * 4;
      const T = frame(f.x + Math.cos(a) * R, f.y + Math.sin(t + i) * 1.5, f.z + Math.sin(a) * R, f.w > 0 ? -a : Math.PI - a);
      box(T, -0.1, -0.08, -0.3, 0.1, 0.08, 0.3, C.dark);
      wings(T, 0.7, t * 9 + i, C.dark);
    }
  }

  for (const s of life.swans) {
    const x = life.river.x0 + mod(s.s + s.v * t, life.river.w);
    if (!near(x, s.z)) continue;
    const k = s.swan ? 1 : 0.55, col = s.swan ? C.white : C.brown;
    const T = frame(x, -1.4 + Math.sin(t * 1.5 + s.s) * 0.04, s.z, Math.sign(s.v) * Math.PI / 2);
    box(T, -0.22 * k, 0, -0.45 * k, 0.22 * k, 0.3 * k, 0.4 * k, col);
    box(T, -0.05 * k, 0.25 * k, 0.3 * k, 0.05 * k, 0.75 * k, 0.4 * k, s.swan ? col : C.green);
    box(T, -0.05 * k, 0.7 * k, 0.4 * k, 0.05 * k, 0.8 * k, 0.6 * k, s.swan ? C.orange : C.green);
  }

  for (const u of life.ufos) {
    const x = u.x + Math.sin(t * u.a + u.p) * u.A, z = u.z + Math.cos(t * u.b + u.p) * u.B, y = u.y + Math.sin(t * 1.3 + u.p) * 2;
    m.sphere(x, y, z, 4, 12, 5, C.metal, MAT.PAINT, 0.22);
    m.sphere(x, y + 0.7, z, 1.6, 8, 4, C.glass, MAT.GLOW);
    const T = frame(x, y, z, t * 2); // spinning rim lights
    for (let i = 0; i < 8; i++) {
      const lx = Math.cos(i * 0.785) * 3.7, lz = Math.sin(i * 0.785) * 3.7;
      box(T, lx - 0.25, -0.2, lz - 0.25, lx + 0.25, 0.2, lz + 0.25, LIGHTS[mod(i + Math.floor(t * 4), 3)], MAT.GLOW); // mod: t can start slightly negative
    }
  }

  for (const p of life.planes) {
    const along = (mod(p.p + t * p.v, 1) - 0.5) * 4000, fx = Math.sin(p.h), fz = Math.cos(p.h);
    const T = frame(life.cx + fx * along + fz * p.off, p.y, life.cz + fz * along - fx * p.off, p.h);
    box(T, -1.6, -1.6, -18, 1.6, 1.6, 18, C.white, MAT.PAINT); // fuselage
    box(T, -0.25, 1.6, -18, 0.25, 7, -13, C.red); // fin
    for (const s of [-1, 1]) {
      // Swept wing and tailplane, facing down (seen from the street).
      m.poly([T(s * 1.6, 0, 4), T(s * 17, 0, -5), T(s * 17, 0, -8), T(s * 1.6, 0, -4)], C.white, MAT.PLAIN, T(0, 1, 0));
      m.poly([T(s * 1.6, 0, -13), T(s * 6, 0, -17), T(s * 6, 0, -18), T(s * 1.6, 0, -17)], C.white, MAT.PLAIN, T(0, 1, 0));
      box(T, s * 5.5 - 1, -2.6, -1, s * 5.5 + 1, -1, 3, C.grey); // engine
      if (mod(t, 1.2) < 0.15) box(T, s * 17 - 0.3, -0.3, -7, s * 17 + 0.3, 0.3, -6.4, s > 0 ? C.red : LIGHTS[1], MAT.GLOW);
      if (p.trail) box(T, s * 5.5 - 0.6, -2, -300, s * 5.5 + 0.6, -1.6, -20, C.white, MAT.GLOW); // contrail
    }
  }

  // Time-travel car: flashes in over a street, flies 5 s low along it, flashes
  // out and leaves two burning trails that shrink away. Each appearance k
  // draws its street and start from its own seeded stream.
  for (const P of life.jumps) {
    const k = Math.floor(t / P), tau = t - k * P;
    if (tau > 8 || k < 1) continue; // first appearance one cycle after load
    const g = new Rng(hash2(life.seed, k * 31 + P)), z = g.pick(life.streets) + 3.5, x0 = g.range(life.x0, life.x1);
    const x = x0 + Math.min(tau, 5) * 18, fl = Math.min(tau, Math.abs(tau - 5));
    if (fl < 0.4) m.sphere(x, 4, z, 3.5 * (1 - fl / 0.4), 10, 6, C.flash, MAT.GLOW);
    if (tau > 5) {
      const w = 0.25 * (1 - (tau - 5) / 3), T = frame(x, 4, z, Math.PI / 2);
      for (const s of [-0.8, 0.8]) box(T, s - w, -w, -30, s + w, w, 0, C.orange, MAT.GLOW);
      continue;
    }
    const T = frame(x, 4 + Math.sin(tau * 3) * 0.3, z, Math.PI / 2);
    box(T, -0.95, 0, -2.1, 0.95, 0.55, 2.1, C.metal, MAT.PAINT);
    box(T, -0.75, 0.55, -1, 0.75, 0.95, 0.5, C.dark, MAT.PAINT);
    box(T, -0.6, 0.55, -2, 0.6, 0.8, -1.2, C.grey);
    for (const s of [-1, 1]) {
      box(T, s * 0.96, 0.3, -2, s * 1.0, 0.38, 2, C.flash, MAT.GLOW); // light strips
      for (const zz of [-1.4, 1.4]) { // wheels folded flat for flight, glowing underneath
        box(T, s * 0.95, -0.1, zz - 0.35, s * 1.35, 0.05, zz + 0.35, C.dark);
        box(T, s * 1.0, -0.14, zz - 0.3, s * 1.3, -0.1, zz + 0.3, C.flash, MAT.GLOW);
      }
    }
  }
  return m;
}
