# G — Multiplayer race: phased plan (4 phases)

Task: **G — Multiplayer race over the intranet** (`docs/04-candidate-brief.md`).
Decisions are locked as recommended in [01-brainstorm.md](01-brainstorm.md)
(Q1–Q15): WebSocket, server-owns-rules/clients-own-physics, server master clock
with pings, ~100 ms interpolation, ghost cars, track on Unter den Linden with
invariant tests, opt-in net mode, additive `src/net/`, fake-network testing,
server seed at lobby, protocol table in `NOTES.md`.

Rules that apply to every phase: red/green TDD (failing test first for each new
behaviour), `npm run check` green at the end of every phase, solo mode never
broken, size budget watched as we go. Each phase is self-contained: it ends
with committed, working, tested code that does not depend on later phases.

---

## Phase 1 — Server foundation (server shell + wire protocol + fake network)

**Goal:** a real server that serves the game and speaks WebSocket, plus the
message language and the in-memory network all later tests run on. No game
logic yet.

**Deliverables**
- `server/main.mjs` — static file serving (extract the logic from
  `tools/serve.mjs`, shared, no copy-paste), listening on all interfaces
  (`0.0.0.0`).
- `server/ws.js` — pure RFC 6455 module: handshake (accept-key SHA-1), frame
  encode/decode, masking, close/ping/pong (small unfragmented frames only).
- `server/protocol.js` — one encode/decode pair per message type (join, name,
  roster update, start request, countdown, go, position tick, finish, stage,
  disconnect), with explicit direction + rate constants.
- `server/fakeNet.js` — `FakeServer` + `FakeConnection` pairs that call
  handlers directly with controllable timestamps (deliver now / after N ms /
  drop).
- Protocol table (`type | from | fields | rate`) written from these
  definitions into `NOTES.md`.

**Tests (red first):** RFC handshake accept-key vectors; decode of masked and
unmasked client frames; encode of server frames; close/ping/pong; static
server serves `index.html` and JS modules; every message round-trips unchanged;
unknown/malformed packets rejected; fake pairs deliver in order and honour
injected delays.

**Acceptance:** `node server/main.mjs` loads the game exactly like `npm start`
(solo via `npm start` still works untouched); `npm run check` green.

---

## Phase 2 — Game rules (state machine + master clock + track, all pure)

**Goal:** every rule of the race as pure, unit-tested modules — the brief's
hard requirement — driven end-to-end through the fake network, with zero
browser involvement.

**Deliverables**
- `server/raceState.js` — stages lobby → countdown → racing → finished →
  ceremony; roster management (2–4, fifth rejected); start gate (≥2 required);
  finish order by server-settled times; ceremony trigger (all finished OR 30 s
  after winner); disconnect → DNF that never blocks the ceremony.
- `server/main.mjs` wires real sockets into `raceState`.
- `src/net/clock.js` — master-clock math: offset = serverTime − (localTime +
  rtt/2), min-rtt over N pings, re-sync at lobby; shared `goAt` timestamp.
- `src/net/track.js` — pure `buildTrack(city, playerCount)`: 200 m straight on
  Unter den Linden east of the gate; one non-overlapping grid slot per player
  (place-only collision checks); finish line segment; ampel position.

**Tests (red first):** start rejected with 1 player; 5th join rejected; finish
order equals time order (tie → earliest report wins, deterministic); winner +
30 s forces ceremony with a DNF still on the podium; invalid transitions
rejected exhaustively (e.g. finish before racing); clock offset math for known
rtt/offset, min-over-N beats noisy samples, re-sync updates the estimate;
per seed: track = 200 m, fully on road, no collider in the corridor, slots
non-overlapping and facing east, identical seed → identical track (seeds 42,
1989, 7 …).

**Acceptance:** every rule-level acceptance line of the brief passes as a unit
test (joins → start → positions → finishes → podium via `fakeNet`, no real
socket); `npm run check` green.

---

## Phase 3 — Client online core (lobby + shared city + seeing each other)

**Goal:** two windows are "in the same city, seeing each other drive" — the
whole online presence, before any race rules on screen.

**Deliverables**
- `src/net/client.js` — connection + lobby flow: join with name, roster HUD,
  start button, 2–4 cap message, fifth-player turn-away screen; opt-in
  activation (solo flow untouched when no server).
- Seed handoff: server sends seed in lobby → client regenerates city + mesh
  ("Warming up…", ~23 ms build) before racing; "Nochmal" seed reuse/re-roll
  decision recorded here.
- `src/net/remoteCar.js` — snapshot buffer + interpolation (position, heading,
  speed; ~100 ms delay; never teleports backwards); reuses `taxiModel.js` via
  fresh draws with per-player transform/costume (player number/colour stripe,
  name tag); local car streams its state ~15 Hz.

**Tests (red first):** client state on join/roster/start/turn-away driven via
`fakeNet` against `raceState`; regeneration triggered exactly on seed change;
interpolation between snapshots is continuous and time-monotonic; clamps at
buffer end (no extrapolation); pure and DOM-free.

**Acceptance:** manual two-window test: both windows reach the lobby with
matching rosters, share the same city, and both taxis drive around smoothly at
~60 FPS; `npm run check` green.

---

## Phase 4 — Race day (countdown → race → finish → ceremony → polish → hand-in)

**Goal:** complete the race loop on top of phase 3 and close every remaining
brief bullet.

**Deliverables**
- Ampel (red → red+amber → green) beside the track, driven by the shared clock
  to one server `goAt` timestamp (±100 ms); cars physics-frozen until green
  (pure gate around `stepCar`, not an input hack) — hook for the jump-start
  penalty (bonus: moving before green → time penalty, settled by the server).
- Finish line: local crossing detection at ms precision, reported as
  server-time T; server settles the order; live position HUD.
- Ceremony: podium steps 1–2–3 from geometry, taxis placed on steps (pure
  placement math), orbit camera, results table with names/times, DNF taxi
  still placed; "Nochmal" → everyone back on a fresh grid, loop restarts.
- `NOTES.md` completed: what built, what cut + why, protocol table, how to
  test on two machines.

**Tests (red first):** frozen-car gate logic; crossing detection on a
synthetic straight drive; server-settled order with out-of-order reports;
jump-start penalty; podium placement math; "Nochmal" resets `raceState` to
grid and the client observes the transition.

**Acceptance:** full loop with two windows: lobby → race → ceremony →
Nochmal → race; `npm run check` green; brief acceptance list walked line by
line; two-machine (intranet) and solo regression re-tested.

---

## Manual testing per phase (no code — what a human can try)

Phase 1 — How to tell the pipe works, by eye:
- Two tabs, one machine: start `node server/main.mjs`, open
  `http://localhost:8080` in two tabs — the game must load and drive exactly
  like `npm start` does.
- Second device: from another PC/phone on the same LAN, open
  `http://<host-ip>:8080` (host IP: `ipconfig`, IPv4 address). Must load too.
- Handshake by hand (any terminal), the RFC 6455 example key:
  `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" http://localhost:8080/ws`
  → expect `HTTP/1.1 101` and `Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`.
  (Unit tests cover frame bytes; curl only proves the handshake.)

Phase 2 — Zero browsers. Run `npm test`; for a real-server smoke, keep a tiny
throwaway "smoke player" script (`node tools/smokeClient.mjs <name>`) that
connects, joins, and prints everything the server says. Run two smoke players:
watch roster appear, start refused with one, accepted with two, fake positions
flow, finishes get ordered, podium is announced even with a disconnected player.
This exercises the real socket path that `fakeNet` only mirrors.

Phase 3 — First human-visible moment, two windows side by side
(Win+← / Win+→ to split):
1. Tab A joins as "A", tab B as "B" → both rosters show both names.
2. Watch the city be *the same*: identical street name HUD + seed in both.
3. Drive A; B's window shows A's taxi moving smoothly (HUD FPS ≥ 60; the
   ~100 ms visual delay should not be noticeable).
4. Leave and rejoin → back in lobby, roster updates both sides.
5. Five tabs at once → the fifth sees the turn-away screen.
(Visual smoothness is the one thing unit tests cannot see — judge it here.)

Phase 4 — The full run-through, per session:
1. Both tabs on the start grid → two windows show the ampel; press Start in
   one.
2. Green: count along the ampel; on two windows of one machine both turn
   green "at once" (unit tests own the maths; eyes check no visible skew).
3. Jump start: tap W just before green in one tab → notice the penalty
   applied to that player's result.
4. Race to the line → results table drops, podium shows, order matches who
   crossed first (eye + HUD digits).
5. Nochmal → both windows back on the grid with a fresh round.
6. Mid-race, close tab B → race still completes, B shows as DNF on the
   podium.
7. On two separate machines once: verify nothing else needed solo verbs.
8. Regression: `npm start` alone (no race server involved) still spawns and
   drives exactly as before this work.

Overall helpers: the HUD already shows FPS and seed; `window.fairfahren` in
the console exposes `{ city, car, camera }` for poking positions manually.

---

## Dependencies

Strictly linear: 1 → 2 → 3 → 4. Phase 1 carries all protocol work; 2 adds the
rules (still no browser UI); 3 brings players onto the screen; 4 runs actual
races and hands in.
