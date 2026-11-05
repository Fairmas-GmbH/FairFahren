# Plan — moving life in the streets

**Date:** 2026-11-05 · **Status:** done

## Goal
Make the city feel alive: people, animals, plants that move — plus, on
request, little UFOs, planes passing near and far, and flying time-travel
cars. Stay procedural and deterministic per seed.

## What moves
| Thing | Where | How it moves |
|---|---|---|
| Pedestrians (some with a dog) | Sidewalks, 3–6 per block, looping around it | Walk at 1.0–1.6 m/s, legs swing |
| Pigeons (70) | Sidewalks and the TV-tower plaza | Peck on the ground; flap up and away when the taxi comes within 9 m, land again ~8 s after it left |
| Bird flocks (3) | Circling above parks | Wide circles, flapping wings |
| Swans and ducks (14) | On the Spree | Drift slowly, bob on the waves |
| Trees | Everywhere | Sway in the wind (vertex shader) |
| UFOs (3) | One circles the TV tower's antenna, two roam the sky | Wobbling saucers with a glowing dome and spinning chase lights |
| Planes (3) | One low (140 m) right over the city, two high (450/650 m) with contrails | Straight lines across the sky, blinking wing lights |
| Time-travel cars (2) | Over a random street, every 23 s / 31 s | Flash in, fly low for 5 s, flash out, leave two burning trails. A generic homage (silver gull-wing wedge, wheels folded flat, blue light strips), not a copy of the film car or its name. |

## Design
- `src/world/life.js` (pure): `createLife(city)` builds the cast from
  `rng.fork('life')`. `lifeMesh(life, t, dt, car)` positions everything.
  Walkers, flocks, swimmers, UFOs and planes are **closed-form functions of
  time** (no stepping). Pigeons keep a little state (how scared they are).
  Each time-car appearance `k` draws its street and start from
  `Rng(hash2(seed, k·31 + period))`.
- One `MeshBuilder` per frame for everything near the taxi (walkers, pigeons,
  swans within 160 m) plus the whole sky. `Renderer.upload(builder, mesh)`
  refills the same GPU buffers, so it is 1 extra draw call and no leak.
  Cost ≈ 1 ms per frame (Node, laptop).
- Shapes use an entity frame (`frame(x, y, z, heading)`) and oriented boxes;
  wings are double-sided triangles so they show from above and below.
- New materials: `MAT.GLOW` (unlit: UFO lights, plane lights, flashes, fire
  trails) and `MAT.LEAF` (wind sway in the vertex shader, used by tree crowns).
- Life is cosmetic and local: not synced in multiplayer, no collisions (the
  curb already keeps the taxi off the sidewalk). `window.fairfahren.life`
  and `.ENV` expose it for debugging.

## Dropped
Flower beds in parks — cut for size.

## Size
The game went to ~41 KB gzip, over the 40 KB budget. Decision (user): raise
the budget to 160 KB raw / 52 KB gzip (ADR 0003, revision 2).

## Tests (`test/life.test.mjs`)
Determinism; walkers always on a sidewalk; swimmers in the river; pigeons flee
from the taxi and land again; the sky is never empty; time-travel cars appear
and leave trails on schedule.
