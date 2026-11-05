# Plan — Fairmas headquarters and low clouds

**Date:** 2026-11-05 · **Status:** done

## Goal
1. Low, friendly fair-weather clouds that drift between the buildings, at
   least 10 m above the ground.
2. An imposing, futuristic Fairmas headquarters skyscraper next to the TV
   tower, in Fairmas colours, with a big Fairmas "F" logo on the roof and
   glowing neon logos and "FAIRMAS" lettering.

No image files are allowed (AGENTS.md), so the logo is **rebuilt from
geometry**, using the logo the user supplied as the reference.

## Fairmas logo, rebuilt
- White disc.
- Grey swoosh hugging the left side, a thinner orange swoosh at the bottom right.
- A bold, italic, orange "F" (stem, top bar, shorter middle bar), slanted to
  the right.
- Colours: orange `#F39200`, grey `#8A8A8A`, white.
- The disc and the F glow (`MAT.GLOW`), so the logo reads from far away.

## The tower (`src/world/hq.js`)
- Sits on the block east of the TV-tower plaza (new block kind `hq`, landmark
  `{kind:'hq', x, z, y}` in `cityGen.js`).
- White podium (8 m) with a glass band and an orange neon line.
- 80 glass floors, 4 m each. The tower **twists 90°** and tapers from 40 m to
  26 m over the first 68 floors. The top 12 floors are a straight crown.
- Every floor has a white floor plate; every 10th plate is an orange neon ring.
- **Orange lights on all four corners of every floor**, so four glowing lines
  spiral up the tower.
- On each crown facade: a neon logo, with "FAIRMAS" in neon letters below it.
- On the roof: a pedestal and a **giant logo (40 m across) that slowly
  rotates**, so you can read it from every direction. It is drawn as its own
  mesh with a rotation matrix; no per-frame geometry.
- About 380 m high, so it outranks the TV tower.

## Clouds (`src/world/life.js`)
- 4 cloud shapes per seed (`cloudShapes(seed)`), each 4–7 flattened white
  puffs whose bottom sits at the cloud's own height.
- 40 clouds at 12–45 m drift east at 2–4 m/s and wrap around the city.
  Position = function of time (`cloudPos`).
- Each shape is uploaded once and each cloud is drawn with a translation, so
  there is no per-frame rebuild.

## Shared helpers
`frame()` and `MeshBuilder.obox()` move from `life.js` into `meshBuilder.js`,
plus a new `MeshBuilder.slab()` (a 2D shape given a thickness). The pixel font
gains F, R, M, S.

## Tests
- Exactly one HQ, on the block next to the plaza, with its podium inside the block.
- Cloud bottoms at least 10 m above the ground, clouds moving, deterministic.
