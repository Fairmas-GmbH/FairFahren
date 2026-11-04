# 05 — Interviewer guide (CONFIDENTIAL — do not share with candidates)

## Formats

| Format | Duration | Suggested task |
|---|---|---|
| Live pairing | 60–90 min | B (traffic lights) reduced to the state machine + one crossing, or a bonus item. 15 min reading, 50 min building, 15 min discussion. |
| Take-home | 3–4 h (ask candidates to cap it) | A, C, D, E or F. Follow-up call of 45 min walking through the commits. |
| Senior / lead | take-home + review exercise | Any ★★★ task plus: "Review the existing codebase. What would you change before a team of 5 works on it?" |
| Senior, distributed systems focus | take-home 6–8 h, or two sessions | G (multiplayer race). Live demo on two machines in the follow-up call. |

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

## Task G — multiplayer race: what to look for

**Running the demo.** Ask the candidate to start their server on their laptop; join from your machine via `http://<their-ip>:<port>/`. Windows may ask to allow Node through the firewall (private networks only). Try: join with 2, then 4 players; a fifth player; close one tab mid-race; reload a tab during the countdown.

**Good solutions usually have**

- **Server authority for race state.** The server owns the lobby, the seed, the countdown and the official finish order. Clients may simulate their own taxi (client authority for movement is acceptable in an intranet game — but the candidate should *say* it is cheatable and what they would change).
- **A shared start time instead of a "go!" message.** The server sends "green at server time T"; clients estimate their clock offset (ping/pong, NTP-style: offset = server time − (send + receive) / 2) and switch locally. A plain "green now" message makes the start unfair by each player's latency.
- **Interpolation of remote taxis.** Render others ~100 ms in the past between two received snapshots (or extrapolate briefly); no teleporting at 10–20 Hz updates.
- **A pure, tested race state machine** shared by server and client (or at least server-side), with explicit states and transitions.
- **Deterministic track from the seed** — reusing `generateCity` and `Rng.fork('race')`, not hard-coded coordinates for seed 1989.
- **Disconnect handling** with timeouts / `close` events, so a dropped player never blocks the ceremony.
- **A written protocol** (message types, direction, rate) — a strong signal for team communication.

**Probing questions**

- Who decides who won? What happens if two players finish within 5 ms of each other?
- How do you make the green light fair across players with 5 ms and 80 ms latency?
- Why WebSocket (or SSE, or polling)? What would change over the internet instead of the intranet?
- A player edits `TAXI.maxSpeed` in the console. How would you detect or prevent it?
- How would you add collisions *between* taxis? Whose simulation wins?
- How many messages per second does a 4-player race produce? Where is the bottleneck at 100 players?

**Red flags (task G)**

- Pulls in `ws`, `socket.io` or a hosted service instead of building on `node:http`.
- Each client decides its own finish position, so screens disagree on the winner.
- The start is triggered by message arrival — players with lower latency start earlier.
- Remote taxis jump around; no notion of interpolation.
- Hard-coded host IP or `localhost` in the client.

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
