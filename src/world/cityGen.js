/**
 * Procedural Berlin-style city generator.
 *
 * PURE DATA: no DOM, no WebGL. Takes a seed, returns a plain object that the
 * mesh builder turns into geometry and the physics uses for collisions.
 * Runs in Node too, which is how the tests exercise it.
 *
 * Layout (top view, north = -Z):
 *
 *   |  park  | altbau | altbau | ...   <- block rows separated by streets
 *   ===[gate]==== Unter den Linden ===   <- boulevard with a linden-tree median
 *   |  park  | altbau | plaza(TV tower)
 *   ~~~~~~~~~~~~~~ Spree ~~~~~~~~~~~~~~   <- river row, crossed by bridges
 *   | altbau | platte | altbau | ...
 */
import { Rng } from '../core/rng.js';

export const DEFAULT_CITY = {
  seed: 1989,
  blocksX: 8, // block columns (west -> east)
  blocksZ: 7, // block rows (north -> south), one of them becomes the river
  blockMin: 70, // block edge length range in metres
  blockMax: 105,
  streetWidth: 14,
  boulevardWidth: 36,
  medianWidth: 8,
  riverWidth: 46,
  sidewalk: 4,
  curbHeight: 0.15,
};

const NAMES_NS = ['Friedrichstraße', 'Schönhauser Allee', 'Kastanienallee', 'Rosenthaler Straße', 'Chausseestraße', 'Brunnenstraße', 'Wilhelmstraße', 'Mehringdamm', 'Kottbusser Damm', 'Prenzlauer Allee', 'Greifswalder Straße', 'Warschauer Straße'];
const NAMES_EW = ['Torstraße', 'Invalidenstraße', 'Oranienstraße', 'Kantstraße', 'Bernauer Straße', 'Skalitzer Straße', 'Gneisenaustraße', 'Danziger Straße', 'Leipziger Straße', 'Kochstraße', 'Wiener Straße', 'Pappelallee'];
const NAMES_UFER = ['Reichpietschufer', 'Schiffbauerdamm', 'Märkisches Ufer', 'Fraenkelufer', 'Paul-Lincke-Ufer', 'Maybachufer'];

/** Colors are stored as 0xRRGGBB so the data stays renderer-agnostic. */
const PALETTE = {
  altbau: [0xe8dcc0, 0xd9b77e, 0xd99a82, 0xc9b79c, 0xbdbdb5, 0xe5d38f, 0xa9b8a6, 0x9fb0bf, 0xedebe4, 0xa65e46],
  roof: [0x8a4b3a, 0x55575c, 0x7c8085, 0x6b3f33],
  platte: [0xc8c4b8, 0xb5b9b5, 0xd2c7a8, 0xbfae95],
};

export function generateCity(options = {}) {
  const cfg = { ...DEFAULT_CITY, ...options };
  if (cfg.blocksX < 4 || cfg.blocksZ < 5) throw new RangeError('City needs at least 4x5 blocks.');
  const root = new Rng(cfg.seed);
  const layoutRng = root.fork('layout');
  const nameRng = root.fork('names');
  const treeRng = root.fork('trees');

  // 1. Pick the special rows: the river replaces one block row, the boulevard is one E-W street.
  const riverRow = layoutRng.int(Math.ceil(cfg.blocksZ / 2), cfg.blocksZ - 2);
  const boulevard = layoutRng.int(2, riverRow - 1);

  // 2. Lay out streets and blocks along both axes.
  const blockSize = () => layoutRng.range(cfg.blockMin, cfg.blockMax);
  const xs = layoutAxis(cfg.blocksX, blockSize, () => cfg.streetWidth);
  const zs = layoutAxis(
    cfg.blocksZ,
    (r) => (r === riverRow ? cfg.riverWidth : blockSize()),
    (k) => (k === boulevard ? cfg.boulevardWidth : cfg.streetWidth),
  );
  const bounds = { x0: -xs.extent / 2, z0: -zs.extent / 2, x1: xs.extent / 2, z1: zs.extent / 2 };

  // 3. Street names.
  const ns = nameRng.shuffle(NAMES_NS), ew = nameRng.shuffle(NAMES_EW), ufer = nameRng.shuffle(NAMES_UFER);
  const streetsNS = xs.streets.map((s, i) => ({ ...s, kind: 'street', name: ns[i % ns.length] }));
  const streetsEW = zs.streets.map((s, k) => {
    const bank = k === riverRow || k === riverRow + 1;
    const kind = k === boulevard ? 'boulevard' : bank ? 'ufer' : 'street';
    const name = k === boulevard ? 'Unter den Linden' : bank ? ufer[k - riverRow] : ew[k % ew.length];
    return { ...s, kind, name };
  });

  // 4. River with bridges where N-S streets cross it (some streets dead-end at the water).
  const bridges = [];
  streetsNS.forEach((s, i) => {
    const forced = i === 2 || i === Math.floor(cfg.blocksX / 2) + 1;
    if (forced || layoutRng.chance(0.6)) bridges.push({ street: i, x0: s.center - s.width / 2, x1: s.center + s.width / 2 });
  });
  const river = { name: 'Spree', z0: zs.blocks[riverRow].start, z1: zs.blocks[riverRow].end, bridges };

  // 5. Landmarks: a city gate on the boulevard, a TV tower on a plaza.
  const bz = streetsEW[boulevard].center;
  const gateCol = xs.blocks[1];
  const gateWidth = cfg.boulevardWidth - 2;
  const gate = {
    kind: 'gate',
    x: (gateCol.start + gateCol.end) / 2,
    z: bz,
    width: gateWidth,
    pillars: Array.from({ length: 6 }, (_, i) => bz - gateWidth / 2 + 0.9 + (i * (gateWidth - 1.8)) / 5),
  };
  const landmarks = [gate];
  const plaza = { ix: Math.round((cfg.blocksX - 1) * 0.65), iz: boulevard };

  // 6. Blocks. Each block gets its own RNG stream so blocks are independent of each other.
  const trees = [];
  const blocks = [];
  for (let iz = 0; iz < cfg.blocksZ; iz++) {
    if (iz === riverRow) continue;
    for (let ix = 0; ix < cfg.blocksX; ix++) {
      const rng = root.fork(`block:${ix},${iz}`);
      const b = { ix, iz, x0: xs.blocks[ix].start, x1: xs.blocks[ix].end, z0: zs.blocks[iz].start, z1: zs.blocks[iz].end, buildings: [] };
      if (ix === plaza.ix && iz === plaza.iz) b.kind = 'plaza';
      else if (ix === 0 && (iz === boulevard - 1 || iz === boulevard)) b.kind = 'park'; // "Tiergarten" next to the gate
      else {
        const east = ix / (cfg.blocksX - 1), r = rng.next();
        b.kind = r < 0.1 ? 'park' : r < 0.18 + 0.35 * east ? 'platte' : 'altbau';
      }
      FILL[b.kind](b, rng, cfg, trees, landmarks);
      blocks.push(b);
    }
  }

  // 7. Boulevard median with linden trees, interrupted at crossings and around the gate.
  const medians = [];
  for (const col of xs.blocks) {
    const segs = col === gateCol ? [[col.start + 2, gate.x - 14], [gate.x + 14, col.end - 2]] : [[col.start + 2, col.end - 2]];
    for (const [x0, x1] of segs) {
      if (x1 - x0 < 4) continue;
      medians.push({ x0, z0: bz - cfg.medianWidth / 2, x1, z1: bz + cfg.medianWidth / 2 });
      for (let x = x0 + 4; x <= x1 - 4; x += 11) trees.push({ x, y: cfg.curbHeight, z: bz, s: treeRng.range(0.85, 1.1) });
    }
  }

  // 8. Lane markings as line segments (the mesh builder dashes them).
  const markings = [];
  streetsNS.forEach((s, i) => {
    zs.blocks.forEach((row, r) => {
      if (r === riverRow && !bridges.some((b) => b.street === i)) return;
      markings.push({ x0: s.center, z0: row.start + 3, x1: s.center, z1: row.end - 3 });
    });
  });
  for (const s of streetsEW) {
    const lane = cfg.medianWidth / 2 + (s.width - cfg.medianWidth) / 4;
    const offsets = s.kind === 'boulevard' ? [-lane, lane] : [0];
    for (const col of xs.blocks) {
      for (const o of offsets) markings.push({ x0: col.start + 3, z0: s.center + o, x1: col.end - 3, z1: s.center + o });
    }
  }

  // 9. Forest around the city.
  for (let i = 0; i < 260; i++) {
    const x = treeRng.range(bounds.x0 - 150, bounds.x1 + 150), z = treeRng.range(bounds.z0 - 150, bounds.z1 + 150);
    const inCity = x > bounds.x0 - 8 && x < bounds.x1 + 8 && z > bounds.z0 - 8 && z < bounds.z1 + 8;
    const inRiver = z > river.z0 - 4 && z < river.z1 + 4;
    if (!inCity && !inRiver) trees.push({ x, y: 0, z, s: treeRng.range(0.9, 1.5) });
  }

  // 10. Colliders: curbs of every block, medians, the river (minus bridges), gate pillars, world border.
  const box = (x0, z0, x1, z1, tag) => ({ type: 'box', x0, z0, x1, z1, tag });
  const colliders = [
    ...blocks.map((b) => box(b.x0, b.z0, b.x1, b.z1, 'block')),
    ...medians.map((m) => box(m.x0, m.z0, m.x1, m.z1, 'median')),
    ...gate.pillars.map((z) => box(gate.x - 4.3, z - 0.9, gate.x + 4.3, z + 0.9, 'gate')),
  ];
  let cursor = bounds.x0;
  for (const b of [...bridges].sort((a, c) => a.x0 - c.x0)) {
    if (b.x0 > cursor) colliders.push(box(cursor, river.z0, b.x0, river.z1, 'river'));
    cursor = b.x1;
  }
  if (cursor < bounds.x1) colliders.push(box(cursor, river.z0, bounds.x1, river.z1, 'river'));
  const t = 10;
  colliders.push(
    box(bounds.x0 - t, bounds.z0 - t, bounds.x1 + t, bounds.z0, 'border'),
    box(bounds.x0 - t, bounds.z1, bounds.x1 + t, bounds.z1 + t, 'border'),
    box(bounds.x0 - t, bounds.z0, bounds.x0, bounds.z1, 'border'),
    box(bounds.x1, bounds.z0, bounds.x1 + t, bounds.z1, 'border'),
  );

  // 11. Spawn: right-hand lane of the boulevard, just east of the gate, heading east.
  const spawn = { x: gate.x + 30, z: bz + cfg.medianWidth / 2 + 3.5, heading: Math.PI / 2 };

  return { seed: cfg.seed, config: cfg, bounds, streetsNS, streetsEW, river, blocks, medians, markings, trees, landmarks, colliders, spawn };
}

/** Returns a human-readable location like "Torstraße / Friedrichstraße". */
export function streetAt(city, x, z) {
  const on = (s, v) => Math.abs(v - s.center) <= s.width / 2;
  const ns = city.streetsNS.find((s) => on(s, x));
  const ew = city.streetsEW.find((s) => on(s, z));
  if (ns && ew) return `${ew.name} / ${ns.name}`;
  if (ns && z > city.river.z0 && z < city.river.z1) return `${ns.name} · ${city.river.name}brücke`;
  return ns?.name ?? ew?.name ?? '';
}

/** Lays out alternating streets and blocks along one axis, centred on 0. blocks[k] lies between streets[k] and streets[k+1]. */
function layoutAxis(count, blockSize, streetWidth) {
  const streets = [], blocks = [];
  let pos = 0;
  for (let k = 0; k <= count; k++) {
    const w = streetWidth(k);
    streets.push({ center: pos + w / 2, width: w });
    pos += w;
    if (k < count) {
      const size = blockSize(k);
      blocks.push({ start: pos, end: pos + size });
      pos += size;
    }
  }
  const shift = pos / 2;
  for (const s of streets) s.center -= shift;
  for (const b of blocks) { b.start -= shift; b.end -= shift; }
  return { streets, blocks, extent: pos };
}

/** Block fillers by kind. Each one adds buildings to the block and may add trees/landmarks. */
const FILL = {
  // "Berliner Block": perimeter buildings around a courtyard (Hinterhof).
  altbau(b, rng, cfg, trees) {
    b.ground = 'courtyard';
    const { x0, z0, x1, z1 } = inner(b, cfg);
    const d = rng.range(12, 16);
    const rows = [
      [x0, z0, x1, z0 + d, true], [x0, z1 - d, x1, z1, true],
      [x0, z0 + d, x0 + d, z1 - d, false], [x1 - d, z0 + d, x1, z1 - d, false],
    ];
    for (const [ax0, az0, ax1, az1, alongX] of rows) {
      const len = alongX ? ax1 - ax0 : az1 - az0;
      for (let t = 0; t < len - 0.5;) {
        let w = rng.range(12, 22);
        if (len - t - w < 10) w = len - t; // no slivers at the end of a row
        const floors = rng.int(4, 6);
        const building = {
          kind: 'altbau',
          x0: alongX ? ax0 + t : ax0, x1: alongX ? ax0 + t + w : ax1,
          z0: alongX ? az0 : az0 + t, z1: alongX ? az1 : az0 + t + w,
          y0: cfg.curbHeight, height: floors * 3.6 + 0.4,
          color: rng.pick(PALETTE.altbau), roofColor: rng.pick(PALETTE.roof),
          roof: rng.chance(0.75) ? 'gable' : 'flat', roofHeight: d * rng.range(0.25, 0.4), ridgeAlongX: alongX,
        };
        if (!rng.chance(0.06)) b.buildings.push(building); // ~6 % vacant lots ("Baulücken")
        t += w;
      }
    }
    for (let i = rng.int(0, 2); i > 0; i--) {
      trees.push({ x: rng.range(x0 + d + 4, x1 - d - 4), y: cfg.curbHeight, z: rng.range(z0 + d + 4, z1 - d - 4), s: rng.range(0.8, 1.2) });
    }
  },

  // Prefab panel slabs ("Plattenbau") on a lawn.
  platte(b, rng, cfg, trees) {
    b.ground = 'lawn';
    const { x0, z0, x1, z1 } = inner(b, cfg);
    const alongX = x1 - x0 >= z1 - z0;
    const [l0, l1, s0, s1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    const count = s1 - s0 > 55 ? 2 : 1;
    const slabs = [];
    for (let k = 0; k < count; k++) {
      const mid = s0 + ((s1 - s0) * (k + 1)) / (count + 1), m = rng.range(5, 12);
      const [a0, a1, c0, c1] = [l0 + m, l1 - m, mid - 6, mid + 6];
      const slab = alongX ? { x0: a0, x1: a1, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: a0, z1: a1 };
      slabs.push(slab);
      b.buildings.push({
        kind: 'platte', ...slab, y0: cfg.curbHeight, height: rng.int(8, 11) * 2.8 + 0.6,
        color: rng.pick(PALETTE.platte), roofColor: 0x6f7275, roof: 'flat',
      });
    }
    scatterTrees(trees, rng, { x0, z0, x1, z1 }, 6, cfg, slabs);
  },

  park(b, rng, cfg, trees) {
    b.ground = 'park';
    const r = inner(b, cfg);
    scatterTrees(trees, rng, r, Math.floor(((r.x1 - r.x0) * (r.z1 - r.z0)) / 220), cfg, []);
  },

  // Paved square with the TV tower in the middle.
  plaza(b, rng, cfg, trees, landmarks) {
    b.ground = 'plaza';
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    landmarks.push({ kind: 'tvTower', x: cx, z: cz, y: cfg.curbHeight });
    const rad = Math.min(b.x1 - b.x0, b.z1 - b.z0) * 0.34;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      trees.push({ x: cx + Math.cos(a) * rad, y: cfg.curbHeight, z: cz + Math.sin(a) * rad, s: rng.range(0.8, 1) });
    }
  },
};

const inner = (b, cfg) => ({ x0: b.x0 + cfg.sidewalk, z0: b.z0 + cfg.sidewalk, x1: b.x1 - cfg.sidewalk, z1: b.z1 - cfg.sidewalk });

/** Random trees inside rect r, at least 6 m apart and 3 m away from any `avoid` rect. */
function scatterTrees(trees, rng, r, count, cfg, avoid) {
  const placed = [];
  for (let tries = 0; placed.length < count && tries < count * 15; tries++) {
    const x = rng.range(r.x0 + 3, r.x1 - 3), z = rng.range(r.z0 + 3, r.z1 - 3);
    if (avoid.some((a) => x > a.x0 - 3 && x < a.x1 + 3 && z > a.z0 - 3 && z < a.z1 + 3)) continue;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 36)) continue;
    placed.push({ x, y: cfg.curbHeight, z, s: rng.range(0.8, 1.3) });
  }
  trees.push(...placed);
}
