# 05 — Interviewer guide (CONFIDENTIAL — do not share with candidates)

## Formats

| Format | Duration | Suggested task |
|---|---|---|
| Live pairing | 60–90 min | B (traffic lights) reduced to the state machine + one crossing, or a bonus item. 15 min reading, 50 min building, 15 min discussion. |
| Take-home | 3–4 h (ask candidates to cap it) | A, C, D, E or F. Follow-up call of 45 min walking through the commits. |
| Senior / lead | take-home + review exercise | Any ★★★ task plus: "Review the existing codebase. What would you change before a team of 5 works on it?" |

## Evaluation rubric (score 1–4 each)

| Dimension | 1 — weak | 4 — strong |
|---|---|---|
| Code comprehension | Works around existing code, duplicates helpers. | Reuses `MeshBuilder`, `Rng.fork`, collider format; follows conventions. |
| Design | Logic mixed into rendering / `main.js` grows into a blob. | New pure modules, clear data flow, small API surface. |
| Constraints | Adds assets/deps, uses `Math.random()` for world content, breaks the budget. | Procedural, deterministic, budget checked, reasons about bytes. |
| Correctness & testing | No tests, edge cases ignored. | Tests for the logic, invariants extended, handles river dead-ends etc. |
| Maths / 3D | Magic numbers, trial and error. | Correct use of the coordinate system, vectors, matrices; can explain them. |
| Performance | Allocates per frame in hot loops, extra draw call per object. | Merges static geometry, considers broad phase, measures FPS. |
| Communication | Can't explain choices. | Clear NOTES.md, honest about trade-offs and shortcuts. |

## Probing questions

- Why does each feature use its own `rng.fork()`? What breaks if you don't?
- How would you make the city infinite? (chunks keyed by `hash2(seed, chunkX, chunkZ)`, streaming, unloading)
- `collideCar` is O(n) per circle. When does that hurt and what would you do?
- How does `MeshBuilder.poly()` decide which way a face points?
- What does the fixed physics timestep buy you? What's the cost?
- The size check measures gzip of the concatenated source. Is that the right metric? What would a minifier change?
- Where would multiplayer state live, and what would you sync?

## Known weak spots in the base code (good discussion material)

- No broad phase in collision; colliders are re-scanned every physics step.
- Curbs are walls (the taxi cannot climb onto a sidewalk).
- The chase camera can clip into buildings.
- Facade windows use a world-space grid, so they can straddle parcel boundaries.
- Matrices allocate a new `Float32Array` per call (fine at this scale, but GC churn).
- No render-state abstraction beyond one program; adding a second shader needs refactoring.
- `streetAt` scans arrays linearly.

## Red flags

- Ships a PNG "just for the sign" or pulls in three.js.
- Rewrites large parts of the base without being asked.
- Turns off tests or the size check to get green.
