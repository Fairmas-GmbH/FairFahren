import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../src/world/cityGen.js';
import { createLife, lifeMesh, walkerPos, cloudPos, cloudShapes } from '../src/world/life.js';
import { buildCityMesh } from '../src/world/cityMesh.js';
import { buildLogo, logoAnchor, HQ } from '../src/world/hq.js';

const city = generateCity({ seed: 1989 });
const far = { x: 1e6, z: 1e6 }; // a taxi far away: nothing near it gets scared

test('street life is deterministic per seed', () => {
  assert.deepEqual(createLife(city), createLife(generateCity({ seed: 1989 })));
  assert.notDeepEqual(createLife(city).walkers, createLife(generateCity({ seed: 7 })).walkers);
});

test('walkers stay on the sidewalk at any time', () => {
  const { walkers } = createLife(city), cfg = city.config;
  assert.ok(walkers.length > 40);
  for (const w of walkers) {
    for (const t of [0, 13.7, 600, 98765]) {
      const [x, z] = walkerPos(w, t);
      const b = city.blocks.find((k) => x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1);
      assert.ok(b, 'inside a block');
      const inner = x > b.x0 + cfg.sidewalk && x < b.x1 - cfg.sidewalk && z > b.z0 + cfg.sidewalk && z < b.z1 - cfg.sidewalk;
      assert.ok(!inner, 'not among the buildings');
    }
  }
});

test('swans and ducks swim in the river, clear of the bridge piers', () => {
  const zm = (city.river.z0 + city.river.z1) / 2;
  for (const s of createLife(city).swans) assert.ok(s.z > city.river.z0 && s.z < city.river.z1 && Math.abs(s.z - zm) > 2);
});

test('nothing flies through the TV tower or the gate', () => {
  for (const seed of [1, 39, 126, 1989]) {
    const c = generateCity({ seed }), life = createLife(c), tw = c.landmarks.find((l) => l.kind === 'tvTower');
    const low = life.planes[0], lat = (tw.x - life.cx) * Math.cos(low.h) - (tw.z - life.cz) * Math.sin(low.h);
    assert.ok(Math.abs(lat - low.off) >= 40, `seed ${seed}: low plane line misses the tower`);
    assert.ok(life.ufos.slice(1).every((u) => u.y > 300), 'roaming UFOs fly above the antenna');
    assert.ok(!life.streets.includes(c.streetsEW.find((s) => s.kind === 'boulevard').center), 'time cars avoid the gate');
  }
});

test('clouds hang low but at least 10 m up, drift, and are seeded', () => {
  const life = createLife(city), shapes = cloudShapes(city.seed);
  assert.equal(life.clouds.length, 40);
  for (const s of shapes) {
    let minY = Infinity;
    for (let i = 1; i < s.vertices.length; i += 10) minY = Math.min(minY, s.vertices[i]);
    assert.ok(minY > -1e-6, 'every shape rests on local y = 0');
  }
  for (const c of life.clouds) {
    assert.ok(c.y >= 10 && c.y <= 50, `cloud at ${c.y} m`);
    assert.notDeepEqual(cloudPos(life, c, 0), cloudPos(life, c, 10), 'clouds move');
  }
  assert.deepEqual(cloudShapes(city.seed), cloudShapes(city.seed));
});

test('the Fairmas HQ stands next to the TV tower, inside its block, taller than everything', () => {
  for (const seed of [1, 42, 1989]) {
    const c = generateCity({ seed });
    const hq = c.landmarks.filter((l) => l.kind === 'hq'), tv = c.landmarks.find((l) => l.kind === 'tvTower');
    assert.equal(hq.length, 1, 'exactly one HQ');
    const b = c.blocks.find((k) => k.kind === 'hq');
    const plaza = c.blocks.find((k) => k.kind === 'plaza');
    assert.equal(b.iz, plaza.iz);
    assert.equal(Math.abs(b.ix - plaza.ix), 1, 'neighbour of the TV-tower plaza');
    const podium = 27.4; // half width incl. neon line (hq.js)
    assert.ok(hq[0].x - podium > b.x0 + c.config.sidewalk && hq[0].x + podium < b.x1 - c.config.sidewalk, 'podium inside the block (x)');
    assert.ok(hq[0].z - podium > b.z0 + c.config.sidewalk && hq[0].z + podium < b.z1 - c.config.sidewalk, 'podium inside the block (z)');
    assert.ok(logoAnchor(hq[0])[1] - HQ.logoR > 300 && tv.y + 290 < logoAnchor(hq[0])[1] + HQ.logoR, 'outranks the TV tower');
    assert.ok(buildCityMesh(c).vertexCount > 0);
  }
  assert.ok(buildLogo().vertexCount > 0);
});

test('a hidden taxi does not scare pigeons', () => {
  const life = createLife(city), p = life.pigeons[0];
  for (let i = 0; i < 60; i++) lifeMesh(life, i / 60, 1 / 60, { x: p.x + 3, z: p.z }, false);
  assert.equal(p.a, 0);
});

test('pigeons fly off when the taxi comes close and land again later', () => {
  const life = createLife(city), p = life.pigeons[0];
  for (let i = 0; i < 60; i++) lifeMesh(life, i / 60, 1 / 60, { x: p.x + 3, z: p.z });
  assert.equal(p.a, 1, 'fully airborne next to the taxi');
  assert.ok(p.ax < 0, 'flies away from the taxi');
  for (let i = 0; i < 600; i++) lifeMesh(life, 1 + i / 60, 1 / 60, far);
  assert.equal(p.a, 0, 'back on the ground 10 s after the taxi left');
});

test('the sky is never empty: birds, UFOs and planes show without a taxi nearby', () => {
  const life = createLife(city);
  assert.equal(life.ufos.length, 3);
  assert.equal(life.planes.length, 3);
  assert.ok(lifeMesh(life, 42, 1 / 60, far).vertexCount > 1000);
  // The first browser frame can start a hair before t = 0.
  assert.ok(lifeMesh(life, -0.004, 1 / 60, far).vertexCount > 1000, 'negative time does not crash');
});

test('time-travel cars appear and vanish on schedule', () => {
  const life = createLife(city);
  const verts = (t) => lifeMesh(life, t, 0, far).vertexCount;
  const P = life.jumps[0], base = verts(P + 20); // between appearances of both cars (20 > 8 s)
  assert.ok(verts(P + 2) > base, 'mid-flight adds geometry');
  assert.ok(verts(P + 6) > base, 'burning trails after the jump');
});
