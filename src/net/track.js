/**
 * Pure track layout for the multiplayer race: a 200 m straight run eastwards
 * along *Unter den Linden*, starting just past the Brandenburger-Tor-style
 * gate (the solo mode's own spawn road). Derived ONLY from the shared city
 * data, so every client computing it from the same seed gets the same track.
 *
 * Coordinates: the city generator's plane — north = −z, so east = +x and
 * "facing east" = heading Math.PI / 2 (like cityGen's spawn).
 *
 * Pure data in, pure data out, runs in Node for the tests. Grid slots are
 * validated "place-only" against the city colliders: every seat must clear
 * buildings, medians, gate pillars and the world border before the race uses
 * it. Counts toward the size budget — kept tight.
 */
import { TAXI } from '../vehicle/carPhysics.js';
import { pushOut } from '../vehicle/collision.js';

export const TRACK_LENGTH = 200;
const SLOT_GAP = 3.4; // grid spacing in the lane, north→south
const GRID_MARGIN = 1.5; // corridor clear of the colliders on both sides

/**
 * buildTrack(city, playerCount) →
 *   { street, start, grid, finish, ampel, corridor, laneZ }
 *
 * - start   {x, z, heading}: the line the grid stands on
 * - grid    [{x, z, heading}]: exactly playerCount seats, pole position first
 * - finish  {x, z0, z1}: the chequered line segment across the racing lane
 * - ampel   {x, z, heading}: the start light pole, on the central line ahead
 * - corridor {x0, z0, x1, z1}: rect that must stay free of colliders, used
 *   by the invariant tests ("track is fully on road, nothing in the way")
 */
export function buildTrack(city, playerCount) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4)
    throw new RangeError('track: needs 2–4 players');
  const gate = city.landmarks.find((l) => l.kind === 'gate');
  const boulevard = city.streetsEW.find((s) => s.kind === 'boulevard');
  if (!gate || !boulevard) throw new RangeError('track: city has no boulevard or gate');
  const cfg = city.config;

  // Start past the first north-south crossing east of the gate, so the grid
  // stands on an ordinary stretch of the boulevard, not across a junction.
  // (The solo mode's spawn is gate.x + 30 — at least that far east.)
  const crossing = city.streetsNS.find((s) => s.center + s.width / 2 > gate.x + 10);
  const start = {
    x: Math.max(gate.x + 30, (crossing ? crossing.center + crossing.width / 2 : gate.x) + 8),
    z: boulevard.center + cfg.medianWidth / 2 + 3.5,
    heading: Math.PI / 2,
  };
  const finish = {
    x: start.x + TRACK_LENGTH,
    z0: boulevard.center + cfg.medianWidth / 2 + GRID_MARGIN,
    z1: boulevard.center + cfg.boulevardWidth / 2 - GRID_MARGIN,
  };
  if (finish.x + GRID_MARGIN > city.bounds.x1 - 10)
    throw new RangeError('track: 200 m do not fit east of the gate');

  // Seats side by side across the racing lane, starting just inside the clear band.
  const grid = Array.from({ length: playerCount }, (_, i) => ({
    x: start.x,
    z: start.z - 1.5 + i * SLOT_GAP,
    heading: Math.PI / 2,
  }));
  for (const slot of grid) {
    for (const off of [TAXI.collisionOffset, -TAXI.collisionOffset]) {
      if (pushOut(slot.x + off, slot.z, TAXI.collisionRadius, city.colliders))
        throw new RangeError('track: grid slot collides with the city');
    }
  }
  for (let a = 0; a < grid.length; a++)
    for (let b = a + 1; b < grid.length; b++)
      if (Math.hypot(grid[a].x - grid[b].x, grid[a].z - grid[b].z) < SLOT_GAP - 0.2)
        throw new RangeError('track: grid slots overlap');

  const corridor = {
    x0: start.x - GRID_MARGIN * 1.5,
    z0: boulevard.center + cfg.medianWidth / 2 + 0.5,
    x1: finish.x + GRID_MARGIN,
    z1: boulevard.center + cfg.boulevardWidth / 2 - 0.5,
  };
  for (const c of city.colliders) {
    if (c.type === 'box') {
      if (c.x0 < corridor.x1 && c.x1 > corridor.x0 && c.z0 < corridor.z1 && c.z1 > corridor.z0)
        throw new RangeError('track: something box-shaped is standing in the corridor');
    } else if (Math.max(corridor.x0 - c.x, c.x - corridor.x1, 0) ** 2 + Math.max(corridor.z0 - c.z, c.z - corridor.z1, 0) ** 2 < c.r * c.r)
      throw new RangeError('track: something round is standing in the corridor');
  }

  return {
    street: 'Unter den Linden',
    start,
    grid,
    finish,
    ampel: { x: start.x + 12, z: boulevard.center, heading: -Math.PI / 2 },
    corridor,
    laneZ: start.z,
  };
}
