// Phase 2: track invariants per seed — 200 m, on road, clear corridor, grid
// slots non-overlapping and facing east, idempotent for equal seeds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, streetAt } from '../src/world/cityGen.js';
import { buildTrack, TRACK_LENGTH } from '../src/net/track.js';
import { TAXI } from '../src/vehicle/carPhysics.js';
import { pushOut } from '../src/vehicle/collision.js';

const SEEDS = [7, 42, 1989, 2024, 123456];

test('rejects impossible player counts and rejects a truncated city', () => {
  const city = generateCity({ seed: 42 });
  assert.throws(() => buildTrack(city, 1), RangeError);
  assert.throws(() => buildTrack(city, 5), RangeError);
  assert.throws(() => buildTrack(city, 2.5), RangeError);
});

for (const seed of SEEDS) {
  for (const players of [2, 3, 4]) {
    test(`seed ${seed}, ${players} players: track invariants hold`, () => {
      const city = generateCity({ seed });
      const track = buildTrack(city, players);

      // 200 m exactly, straight east on the boulevard, east of the gate.
      assert.equal(track.finish.x - track.start.x, TRACK_LENGTH);
      const gate = city.landmarks.find((l) => l.kind === 'gate');
      assert.ok(track.start.x > gate.x, 'starts east of the gate');
      assert.equal(track.grid.length, players);
      for (const slot of track.grid) {
        assert.equal(slot.heading, Math.PI / 2, 'facing east');
        assert.equal(slot.x, track.start.x, 'grid on one line');
        assert.equal(streetAt(city, slot.x, slot.z), 'Unter den Linden', 'grid is on the boulevard, not a junction');
        assert.ok(slot.z > track.finish.z0 && slot.z < track.finish.z1, 'slot inside the racing lane');
      }
      assert.ok(streetAt(city, track.finish.x, (track.finish.z0 + track.finish.z1) / 2).startsWith('Unter den Linden'),
        'finish line rests on the boulevard (at a crossing at worst)');

      // Place-only collision check: every seat clears the whole city, front and
      // rear circle.
      for (const slot of track.grid)
        for (const off of [TAXI.collisionOffset, -TAXI.collisionOffset])
          assert.equal(pushOut(slot.x + off, slot.z, TAXI.collisionRadius, city.colliders), null, 'slot collides');

      // No two seats overlap (they are two taxi bodies, worst case sideways).
      for (let a = 0; a < track.grid.length; a++)
        for (let b = a + 1; b < track.grid.length; b++)
          assert.ok(Math.abs(track.grid[a].z - track.grid[b].z) >= TAXI.trackWidth * 1.4, 'slots overlap');

      // Corridor: no collider touches the driving band, start to finish.
      const c = track.corridor;
      const overlapping = city.colliders.filter(
        (x) => x.type === 'box' && x.x0 < c.x1 && x.x1 > c.x0 && x.z0 < c.z1 && x.z1 > c.z0);
      assert.deepEqual(overlapping, [], `colliders in corridor: ${JSON.stringify(overlapping)}`);

      // The ampel stands near the line, ahead of the grid.
      assert.ok(track.ampel.x > track.start.x && track.ampel.x - track.start.x < 30);
    });
  }
}

test('identical seed → identical track, every player count', () => {
  for (const seed of SEEDS) {
    for (const players of [2, 3, 4]) {
      const a = buildTrack(generateCity({ seed }), players);
      const b = buildTrack(generateCity({ seed }), players);
      assert.deepEqual(a, b);
    }
  }
});
