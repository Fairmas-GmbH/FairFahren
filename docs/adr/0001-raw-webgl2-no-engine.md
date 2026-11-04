# ADR 0001 — Raw WebGL2 instead of a 3D engine

**Status:** accepted · **Date:** 2026-11-04

## Context
The game must ship in kilobytes (NFR-01) with zero dependencies (NFR-03), and candidates should be able to read *all* of the code. Engines like three.js (600+ KB minified), Babylon.js or Unity WebGL builds are megabytes.

## Decision
Use the browser's WebGL2 API directly with one small renderer (`src/gfx/renderer.js`, ~3.5 KB) and one shader program. Geometry is built on the CPU with `MeshBuilder`.

## Consequences
- ✅ The whole engine layer (`src/core` + `src/gfx`) is ~16 KB of commented, readable source; no build step, no `node_modules`.
- ✅ Candidates see every layer — a good test of fundamentals (matrices, buffers, shaders).
- ❌ No scene graph, materials system, shadows or picking out of the box; features like these must be written (and can be interview tasks).
- ❌ WebGL2 only — no WebGL1 fallback (acceptable: all evergreen browsers support it).
