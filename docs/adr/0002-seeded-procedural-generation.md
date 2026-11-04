# ADR 0002 — Everything is generated from one seed

**Status:** accepted · **Date:** 2026-11-04

## Context
No asset files are allowed (NFR-02), yet the city must look like Berlin and be the same for every player and every test run (NFR-05).

## Decision
- One 32-bit seed drives a mulberry32 PRNG (`src/core/rng.js`).
- Features draw from **forked** streams (`rng.fork('trees')`, `fork('block:3,2')`) so that changing one feature does not reshuffle the rest of the world.
- Generation produces **plain data** (`generateCity`) that is separately turned into geometry (`buildCityMesh`) and colliders — so it is testable in Node.
- Surface detail (windows, water, asphalt) is generated in the fragment shader from world position instead of textures.
- `Math.random()` is banned for world content.

## Consequences
- ✅ A city costs 4 bytes of "content"; any seed is shareable via `?seed=`.
- ✅ World invariants can be unit-tested across many seeds.
- ❌ "Berlin" is approximated by rules (block structure, river, landmarks, names), not by real map data.
- ❌ Designers cannot hand-place things; any hand-made feature must be expressed as a rule.
