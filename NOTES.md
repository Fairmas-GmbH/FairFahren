# NOTES.md

Working notes for the multiplayer task (task G, `docs/04-candidate-brief.md`):
what was built, what was cut and why, how to test it. The work follows the
phased plan in `docs/plans/g-multiplayer/02-implementation-phases.md`; this
file grows with the phases and is completed at hand-in.

## Transport: WebSocket, hand-rolled (RFC 6455)

The race needs traffic both ways constantly: every player streams their taxi at
~15 Hz while the server pushes everyone else's positions, the lobby roster and
the shared start-gate moment. WebSocket is one open phone line per player —
either side talks whenever it wants, a few bytes of overhead per message.

The alternative considered was Server-Sent Events (a server→client radio) plus
one `fetch` POST per client message. Less code, but every position update from
every player becomes its own HTTP request: more latency noise, more churn per
tick, and no clean way to push "the other taxi moved" at 15 Hz. On top of that,
the project's zero-dependency rule takes a WebSocket library off the table — so
the handshake (SHA-1 accept key) and the framing live in `server/ws.js`,
unit-tested against the RFC's own example bytes.

## Wire protocol

JSON text frames tagged with `type`. Messages are tiny and the intranet is
fast, so readable beats compact. All times are milliseconds in the shared
server clock; clients learn their offset from the app-level `ping`/`pong` pair
(the browser's WebSocket API hides the protocol-level ping/pong from
JavaScript, so RTT measuring has to live in the application messages).

A join into a full lobby is not a message: the server closes the socket with
close code 4000 and reason "lobby full". A connection arriving while a race is
already running is closed with 4001 "race already started". The client shows
its turn-away screen from the close code (groundwork for the lobby UI in
phase 3).

<!-- protocol-table:start -->
| type | from | fields | rate |
|---|---|---|---|
| join | client → server | name | once, on entering the lobby |
| name | client → server | name | on change, in lobby |
| start | client → server | — | user-triggered |
| pos | client → server | x z h s | 15 Hz while racing |
| finish | client → server | t | once per race |
| jump | client → server | — | user-triggered, before green |
| again | client → server | — | user-triggered, in ceremony |
| ping | client → server | t | about 1 Hz while syncing |
| roster | server → client | players seed | on change |
| countdown | server → client | goAt | once per race |
| go | server → client | goAt | once per race |
| posRelay | server → client | id x z h s | per player, 15 Hz |
| stage | server → client | stage | on change |
| disconnect | server → client | id | on player leaving |
| pong | server → client | t s | on ping |
| finishInfo | server → client | id t | per finisher, once |
| jumped | server → client | id pen | per jump, once |
| results | server → client | players | once, when the race is settled |
<!-- protocol-table:end -->

The table is generated from the definitions in `server/protocol.js`
(`node tools/protocol-table.mjs`); a unit test fails if this file and the code
drift apart. `finishInfo` announces each finish as it happens (for a live
position HUD); `results` is the settled, ordered table
`[{id, name, t, dnf, pen}]` — finished players first in official order (time +
penalty, ties to the earliest report; `pen` is the server-settled jump-start
penalty in ms, `0` when clean), DNFs last with `t: null, pen: null`.

## Phase 2 — the rules, all pure

Every rule of the race lives in `server/raceState.js`: a pure module that
gets its clock (`now`), its transport (`send`/`close`) and its timers
(`schedule`) injected, so the tests drive whole races — joins, start gate,
position relay, finishes, results, ceremony — over `fakeNet` pairs with a
virtual clock, no sockets and no real time. Key decisions:

- **The server settles everything.** A finish report carries the client's
  crossing time, but the official order is the server's sort: by reported
  time, ties to the earliest report. A lying or lagging client can shuffle
  itself but not the podium.
- **Disconnects never block the ceremony.** A racer that drops is marked DNF
  and stays on the results table (`t: null`); when the 30 s window after the
  winner expires, anyone still on the road is settled as DNF too.
- **One shared `goAt`.** The countdown and the go message both carry the same
  server timestamp; clients compare it against the master clock (`src/net/clock.js`)
  and flip green when *it* arrives, not when the packet does.
- **The track is pure data** (`src/net/track.js`): 200 m east on Unter den
  Linden from just past the gate's first crossing, grid seats side by side in
  the racing lane, chequered line, ampel position — all validated against the
  city colliders at build time, and identical for equal seeds.
- Found and fixed while wiring: `conn.onClose(...)` in `main.mjs` *called*
  the callback slot (always null on a fresh socket) instead of assigning to
  it — the real-socket path would have died on the first disconnect. The
  review pass added the remaining hardening: a race where everyone quits
  before any finish settles at once (no winner was coming), late finish
  reports after the results are out are ignored (they would contradict the
  podium clients already received), negative finish times are dropped, and
  the main.mjs port argument survives `--seed` in either order.

## Where the multiplayer code lives

- `server/main.mjs` — the game server: serves the static game exactly like
  `npm start`, speaks WebSocket on `/ws`, listens on all interfaces (`0.0.0.0`).
- `server/static.mjs` — static file serving, extracted so the dev server
  (`tools/serve.mjs`) and the game server share one implementation.
- `server/ws.js` — pure RFC 6455: handshake, frame encode/decode, masking,
  ping/pong, close. Small unfragmented frames only (our messages are tiny).
- `server/protocol.js` — the message language: one entry (direction, fields,
  rate) per message type, one shared encode/decode pair driven by the entries.
- `server/fakeNet.js` — in-memory server/client pairs with controllable
  latency and drop, so the race rules (phase 2) are testable without sockets.
- `server/raceState.js` — the rules as one pure state machine: lobby →
  countdown → racing → finished → ceremony, roster and start gate, finish
  order, ceremony trigger, DNF handling.
- `src/net/clock.js` — master-clock maths: offset from pong samples,
  min-rtt-of-N filtering, `serverNow()`. Pure, DOM-free.
- `src/net/track.js` — pure `buildTrack(city, playerCount)`: the 200 m start
  straight, grid seats (validated place-only against colliders), finish line,
  ampel position.

## Phase 3 — players on each other's screens

The online presence layer: `?online` in the URL opts a browser into net mode
(solo `npm start` never opens a socket and looks exactly as before — the lobby
panel and overlays stay hidden). The browser wiring lives in `src/main.js` +
`index.html`, the pure parts stay in `src/net/`:

- **Lobby.** `createNetClient` joins immediately on construction — the join
  button press builds the client (that IS the connection trigger, plus name):
  a wrapped `WebSocket` with `{send, close, onMessage, onClose}` slots. The
  index.html overlay shows the join form while connecting, then roster (with
  per-player colour dots), a start button that is disabled until `canStart`,
  and a status line. The whole lobby hides once the race starts; while waiting
  the local taxi is parked, not drawn and never stepped.
- **Self id by join order.** The server never names us in a roster, but we
  only receive rosters once *our* join is subscribed, and in that first
  broadcast we sit last in join order — the client takes the last row of its
  first roster as its own id. Duplicate names cannot break this (it is order-
  based, not name-based).
- **Seed handoff.** `seedChange` (fired exactly once per distinct seed) →
  `generateCity` + `buildCityMesh` + re-upload happen synchronously. The
  "Warming up…" full-screen overlay was cut: the whole rebuild is ~1–2 ms
  (~23 ms for the city build was our upper-bound estimate), less than a paint,
  so a flashing overlay would only add a visible glitch.
- **Remote taxis.** Every `posRelay` is pushed into a per-peer
  `createInterp` buffer (t = local receive time); each frame samples ~100 ms
  behind the render clock and draws the *same* `buildTaxi` meshes again with a
  per-player matrix. Distinguishing riders is a thin coloured skirt under the
  ivory body plus the lobby legend dots (roster index → one fixed 4-colour
  palette, identical on every client). Peer drop → interp removed.
- **Track.** `buildTrack(city, playerCount)` runs client-side, re-keyed by
  `seed/rosterLength` so a roster-size change (or a new city) rebuilds before
  the next countdown, and only for 2–4 players.
- **Cut:** in-world name tags — 15 extra mini-boxes per rider ×4 players was
  more mesh + draw calls than the size budget wanted to carry for something
  the colour stripes + roster legend already answer; also no auto-reconnect
  (turn-away/drop shows a clean "Reload" screen instead).

## Phase 4 — race day

- **Grid + freeze.** First sight of stage `countdown` wipes the last race's
  bookkeeping (remotes, jumps, finishes, results), rebuilds the track and
  regrids: local car `Object.assign(car, createCar(gridSlot))` on
  `rosterIndex(selfId)`, camera snapped, `R` keeps respawn (to the slot once
  one exists). Physics runs through `createStartGate` around `stepCar` — a
  pure freeze, not an input hack; pressing the throttle pre-green reports
  `jump` once via `sendRaw`, the server settles `+3000 ms` and broadcasts
  `jumped` (client.js now has the `jumped` case → `on.jumped`, shown live as a
  HUD chip and a ⚡-style sentence in the results).
- **Ampel.** A static mesh (dark pole, housing, dim lamp sockets) plus ONE
  mesh per light state at `track.ampel`; each frame only the active state is
  drawn, driven by `ampelState(clock.serverNow(), goAt)`. While red the HUD
  chip counts down the seconds to the shared `goAt`.
- **Finish.** Each physics step in `racing` compares prev/current (x, localT)
  via `crossingTime(…, track.finish.x)`; on a crossing the local time is
  converted with `clock.serverNow()` (falls back to local now while unsynced)
  and reported once through `sendFinish`. Live position HUD: `P1 + count of
  others who crossed before you`, replaced by the settled order once `results`
  arrive.
- **Results + ceremony.** `results` rows display `((t − goAt)/1000).toFixed(2) s`
  (t is an absolute server stamp) plus ` +{pen/1000} s` when the server
  penalised a jump start; DNF rows stay as "DNF". Stage `ceremony` builds the
  three podium steps from `podiumLayout`, parks the settled taxis on their
  steps (DNF-row taxis on the ground row), and the camera orbits the step
  centroid (radius 14 m, height 6 m). The **Nochmal** button sends `again`
  (only legal in ceremony) — the server bumps its seed by one, everyone gets
  `roster` + `stage countdown` again and the same loop regrids onto the NEXT
  world. `client.js` got one extra line for this: `finishSent` resets when a
  fresh `countdown` arrives, so the rematched race can report a finish again.
- **Turn-away / drop.** Close codes reach `on.turnedAway(code)`: 4000 →
  "Stadt voll — versuch es später wieder", 4001 → "Rennen läuft schon — versuch
  es gleich nochmal", any drop → "Verbindung verloren." — each with a Reload
  button (`location.reload()`).

## How to test on two machines

1. `node server/main.mjs --seed 42 8081` on one machine (serves the game AND
   the WebSocket on the same port, listening on `0.0.0.0` — `ipconfig` for the
   LAN IPv4).
2. Every player opens `http://<host-ip>:8081/?online` (the port from step 1),
   types a name and presses
   **Mitfahren**. Rosters match on all screens, and every screen regenerates
   the same city (same seed + street names in the HUD).
3. Someone presses **Start** (needs ≥ 2 riders) → everyone's ampel counts down
   from the shared `goAt` and flips red+amber → green "at once". Holding the
   throttle before green costs that player +3 s in the results.
4. Race east along Unter den Linden (~200 m), watch each other's taxis drive
   smoothly, cross the line → live position, then the results table and the
   podium orbit; **Nochmal** throws everyone onto the next seed's grid.
5. Closing a tab mid-race settles that rider as DNF on the podium; a fifth
   tab gets the turned-away screen (4000/4001); killing the server shows the
   "Verbindung verloren" screen.
6. Regression: plain `http://<host-ip>:8080` (no `?online`, no server needed)
   must drive exactly like `npm start` did before phase 1.

## Status

Phase 1 (server foundation) and phase 2 (game rules) done as described below.
Phase 3 (client online core) and phase 4 (race day) done and wired: the lobby
with roster and start button, the shared-city seed handoff, remote taxis with
colour stripes, the ampel on the shared clock, the frozen start gate with
server-settled jump penalties, ms-precise finish reporting, results table and
podium ceremony with the Nochmal rematch — opt in per window with `?online`;
without it, solo mode drives exactly as before all of this. `npm run check`
green (88 tests); the client budget is the size check's `src/` + `index.html`
(86.7 / 31.1 KB of 96 / 32 KB).

## How to try phase 2 by hand (zero browsers)

`npm test` owns the rules; for the real socket path:

- `node server/main.mjs --seed 42 8081` in one terminal, then two or three
  `node tools/smokeClient.mjs Alice 8081` (name + port) in others. Watch:
  rosters appear on everyone's side, the race refuses to start with one
  player, positions flow once green, finishes are ordered by reported time,
  and the results table drops — with a disconnected player still on it as
  DNF. A race where *everyone* disconnects also settles (all-DNF podium).
- A fifth player running `node tools/smokeClient.mjs Eve 8081` after the race
  starts gets `closed 4001 race already started`; connecting a fifth before
  the race gets `4000 lobby full`.

## How to try phase 1 by hand

- `node server/main.mjs`, then open `http://localhost:8080` in two tabs — the
  game must load and drive exactly like `npm start` does.
- From another machine on the same LAN: `http://<host-ip>:8080`
  (host IP: `ipconfig`, IPv4 address).
- Handshake check in any terminal, with the RFC 6455 example key:
  `curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" http://localhost:8080/ws`
  → expect `HTTP/1.1 101` and `Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=`.
  (Unit tests cover the frame bytes; curl only proves the handshake path.)
