import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, streetAt } from '../src/world/cityGen.js';
import { pushOut } from '../src/vehicle/collision.js';
import { TAXI } from '../src/vehicle/carPhysics.js';

const SEEDS = [1, 7, 42, 1989, 2024, 123456];

test('generation is deterministic', () => {
  assert.deepEqual(generateCity({ seed: 42 }), generateCity({ seed: 42 }));
});

test('different seeds give different cities', () => {
  assert.notDeepEqual(generateCity({ seed: 1 }).blocks, generateCity({ seed: 2 }).blocks);
});

for (const seed of SEEDS) {
  test(`seed ${seed}: world invariants hold`, () => {
    const city = generateCity({ seed });
    const { bounds, river, config: cfg } = city;

    // Every building sits inside its block, behind the sidewalk.
    for (const b of city.blocks) {
      for (const h of b.buildings) {
        assert.ok(h.x0 >= b.x0 + cfg.sidewalk - 1e-6 && h.x1 <= b.x1 - cfg.sidewalk + 1e-6, 'building leaves block (x)');
        assert.ok(h.z0 >= b.z0 + cfg.sidewalk - 1e-6 && h.z1 <= b.z1 - cfg.sidewalk + 1e-6, 'building leaves block (z)');
        assert.ok(h.x1 > h.x0 && h.z1 > h.z0 && h.height > 0, 'building has positive size');
      }
      // Blocks never overlap the river.
      assert.ok(b.z1 <= river.z0 || b.z0 >= river.z1, 'block overlaps river');
    }

    assert.ok(river.bridges.length >= 2, 'at least two bridges');
    assert.equal(city.landmarks.filter((l) => l.kind === 'tvTower').length, 1, 'exactly one TV tower');
    assert.equal(city.landmarks.filter((l) => l.kind === 'gate').length, 1, 'exactly one gate');

    // The taxi spawns on the road, inside the city, not touching anything.
    const { x, z, heading } = city.spawn;
    assert.ok(x > bounds.x0 && x < bounds.x1 && z > bounds.z0 && z < bounds.z1);
    for (const off of [TAXI.collisionOffset, -TAXI.collisionOffset]) {
      const hit = pushOut(x + Math.sin(heading) * off, z + Math.cos(heading) * off, TAXI.collisionRadius, city.colliders);
      assert.equal(hit, null, 'spawn collides');
    }
    assert.equal(streetAt(city, x, z), 'Unter den Linden');

    // Traffic signs stand on a sidewalk (inside a block, outside its inner area) and face along an axis.
    assert.ok(city.signs.length > 30, 'enough signs');
    for (const s of city.signs) {
      const b = city.blocks.find((k) => s.x > k.x0 && s.x < k.x1 && s.z > k.z0 && s.z < k.z1);
      assert.ok(b, 'sign is inside a block');
      const inner = s.x > b.x0 + cfg.sidewalk && s.x < b.x1 - cfg.sidewalk && s.z > b.z0 + cfg.sidewalk && s.z < b.z1 - cfg.sidewalk;
      assert.ok(!inner, 'sign is on the sidewalk, not among buildings');
      assert.equal(Math.abs(s.nx) + Math.abs(s.nz), 1, 'sign faces an axis direction');
      if (s.type === 'limit') assert.ok([30, 50].includes(s.value));
    }
  });
}

test('the whole city is a few hundred KB of data at most, but generated from 4 bytes', () => {
  const json = JSON.stringify(generateCity({ seed: 5 }));
  assert.ok(json.length < 1_000_000);
});
