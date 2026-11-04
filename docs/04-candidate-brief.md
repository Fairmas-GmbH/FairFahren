# 04 — Candidate brief

> This is the document handed to candidates, together with the repository.
> (Interviewers: remove `docs/05-interviewer-guide.md` before sharing.)

## Welcome to FairFahren 🚕

You have a tiny 3D driving game: a Berlin taxi in a procedurally generated city. The whole game is about 50 KB of plain JavaScript — **no assets, no libraries, no build step**. Every building, tree and street comes from one seed number.

Your job is to **extend it**.

## Ground rules

1. **Stay procedural.** Do not add image, model, audio, font or data files. Generate what you need in code.
2. **Stay small.** `npm run size` must pass (≤ 96 KB raw, ≤ 32 KB gzip for `index.html` + `src/`).
3. **No dependencies.** No npm packages, no CDN scripts — on the client and on any server you write.
4. **Stay deterministic.** World content must come from the seeded `Rng`, never from `Math.random()`.
5. **Keep it green.** `npm test` passes, and new logic comes with tests where it makes sense.
6. Small, focused commits with meaningful messages. We will read your history.

## Getting started (≈ 30 min)

1. Read [03-prerequisites.md](03-prerequisites.md), run `npm start`, drive around.
2. Read [02-technical-specification.md](02-technical-specification.md) and skim `src/main.js` — everything is wired there.
3. Try `?seed=7` and the `window.fairfahren` console object.

## Tasks

Pick **one main task** (or the one your interviewer gave you). Bonus tasks are optional.

### A — Taxi missions (game loop) ★★
Turn the sandbox into a game. Spawn a waiting passenger (procedural figure + marker) at a random sidewalk spot, drive there and stop next to them to pick up, then deliver them to a destination shown on screen. Fare depends on distance and time; show money earned.
*Acceptance:* pickup only below 5 km/h within 4 m; destination reachable by road; fares and positions deterministic per seed + mission number; logic unit-tested without WebGL.

### B — Traffic lights ★★
Add traffic lights at crossings (a pole with red/amber/green; bonus: the East-Berlin *Ampelmännchen* built from boxes). Cycle them per crossing so perpendicular directions never show green at the same time. Detect and display red-light violations.
*Acceptance:* state machine is a pure, tested module; lights are visible and readable at 50 m; violation is detected when crossing the stop line on red.

### C — Minimap & navigation ★★★
Draw a minimap (2D canvas overlay) of streets, river and the taxi. Build a road graph from the city data and show the shortest route to a clicked destination (A* or Dijkstra).
*Acceptance:* the graph respects dead-ends at the river; route updates when the taxi leaves it; graph construction and pathfinding are tested.

### D — AI traffic ★★★
Add 10–30 other cars that drive along the streets in the right-hand lane, turn at crossings and stop for obstacles in front of them (including the taxi).
*Acceptance:* no car drives through buildings or into the river; stays at ≥ 50 FPS; behaviour deterministic per seed.

### E — A new district ★★
Add a new procedural block type with Berlin character — e.g. an elevated U-Bahn line (*Hochbahn*) on a viaduct along one street with stations, or a Kreuzberg-style street with *Spätis* and coloured awnings, or the Berlin Wall remnant with a strip of land.
*Acceptance:* integrated into `generateCity` via its own RNG fork; colliders where needed; invariant tests extended.

### F — Better physics & feel ★★
Replace the kinematic model with a simple dynamic model: tyre slip, understeer/oversteer, handbrake drifts; body roll and pitch visible on the model; impact speed shakes the camera.
*Acceptance:* existing physics tests still pass or are consciously updated; new tests for slip behaviour.

### G — Multiplayer race over the intranet ★★★★
Turn FairFahren into a short multiplayer race for **2–4 players** on different machines in the same network.

**Flow**

1. **Lobby.** One player starts the game server; the others open `http://<host-ip>:<port>/` and enter a name. Everyone sees who has joined (2–4 players, a fifth is turned away). Any player can press "Start" once at least two are in.
2. **Track.** A straight **200 m** race on a road of the city, e.g. eastwards along *Unter den Linden* from the gate. All clients derive the same track from the shared seed (the server picks the seed). Start grid with one slot per player, no taxi overlapping another.
3. **Start light (*Ampel*).** A traffic light above or beside the start line runs the German sequence **red → red + amber → green**. Cars are frozen until green. Every client must switch to green at the same moment (± 100 ms), regardless of network delay. Bonus: a jump start (moving before green) gets a time penalty.
4. **Race.** All players see all taxis moving in real time, smoothly, with a name tag. Each taxi is distinguishable (e.g. the player number on the roof sign or a coloured stripe — procedural, no textures).
5. **Finish line.** A visible chequered line across the road. Crossing it records the finish time (ms precision). The server, not the client, decides the official order.
6. **Siegerehrung.** When all players have finished (or 30 s after the winner), show the award ceremony to everyone: a podium with steps 1–2–3 built from geometry, the taxis placed on it, a camera orbit, and a results table with names and times. Then "Nochmal" returns everyone to the start grid.

**Rules for this task**

- The server is plain Node (`server/`), **zero dependencies** like the rest. Use the built-in `node:http`. You choose the transport — e.g. WebSocket via the HTTP `upgrade` handshake (RFC 6455, a few dozen lines), or Server-Sent Events plus `fetch` POSTs — and justify the choice in `NOTES.md`.
- The server serves the game files too, so players only need one URL. It listens on all network interfaces, not only `localhost`.
- The size budget still applies to the client (`index.html` + `src/`). Server code does not count.
- Single-player mode keeps working without a server.

**Acceptance criteria**

- Two browser windows on one machine **and** two machines in the intranet can race each other.
- The race state machine (lobby → countdown → racing → finished → ceremony) is a **pure module with unit tests**, including: start rejected with fewer than 2 players, fifth player rejected, finish order by time, a player disconnecting mid-race does not block the ceremony.
- The track (start grid, finish line) is generated from the seed and tested: 200 m long, straight, fully on road, no collider in the way.
- Other taxis move smoothly at 60 FPS even though network updates arrive at ~10–20 Hz (interpolation).
- The message protocol is documented (message types, fields, who sends what, at which rate).

**Scoping.** This is the biggest task. In a time-boxed take-home, a solid result for steps 1–5 with two players beats a shaky all-in version; note in `NOTES.md` what you left out and how you would add it.

### Bonus (small, any time)
- Headlights toggle (`L`) and a day/night cycle in the shader.
- Horn (WebAudio, synthesised — no audio files).
- Spatial grid for collision queries + a micro-benchmark.
- Gamepad support.
- Camera that does not clip into buildings.

## What we look for

Clean, readable code that fits the existing style; sensible decomposition (pure logic vs. rendering); tests for logic; respecting the constraints; and being able to **explain your trade-offs**. A smaller, solid result beats a large, fragile one.

## Hand-in

A Git repository (or bundle) with your commits, plus a short `NOTES.md`: what you built, what you'd do next, what you'd change in the existing code, how long you spent.
