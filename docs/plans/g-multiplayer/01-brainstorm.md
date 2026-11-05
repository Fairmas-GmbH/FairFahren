# G — Multiplayer race: brainstorm (questions to answer before planning)

Task: **G — Multiplayer race over the intranet** (`docs/04-candidate-brief.md`).
This is a working document: the questions we must answer, with "for dummies"
explanations, pros/cons, and a recommendation for each. No decisions are final
until the plan (02-implementation-phases.md) records them.

## How to read this

For each open question: what the question means in plain words, the realistic
options, what each costs/gains, and what we'd recommend — plus why.

---

## Q1 — Transport: how do the server and browsers talk?

The browser can't just "call" the server whenever it wants in both directions.
HTTP is like asking a question and getting an answer — every reactive bit
("taxi moved") needs a new question. We need something that can push.

**Option A — WebSocket, hand-rolled (RFC 6455 over `node:http` upgrade).**
Like a phone call that stays open: both sides can talk any time, tiny overhead.

- ✅ Full duplex: server pushes at 10–20 Hz easily, cheap small messages.
- ✅ One persistent connection per player; simple mental model.
- ✅ Brief even suggests it; it shows internet-mechanics understanding (handshake +
  framing in a few dozen lines).
- ❌ We must implement the handshake (SHA-1 of the response key) and
  encode/decode frames ourselves — the trickiest bit is masking and fragmentation.
- ❌ Test coverage of raw byte handling takes effort.

**Option B — Server-Sent Events (SSE) + `fetch` POSTs.**
Like a radio broadcast (server → client) plus letters mailed back (client → server).

- ✅ Almost no protocol code: SSE is basic HTTP with `text/event-stream`.
- ✅ Easy to test with plain HTTP knowledge.
- ❌ Not really duplex: every input/position from the client is its own HTTP
  POST (new TCP or keep-alive request) — more latency noise and server churn.
- ❌ Messier mapping to "everyone sees everyone at 10–20 Hz".

**Recommendation:** A (WebSocket). The race needs both directions constantly;
one phone line beats a radio + a stack of letters. Keep the frame code as one
small pure file (`server/ws.js`-style) that can be unit-tested with byte buffers.

---

## Q2 — Who is the boss? (Authority model)

Someone must have the final say. Points to watch: simultaneous green light,
official finish order, what happens if a player lies (lag, even).

**Option A — Server relays + owns the rules, clients own their taxi.**
Each machine simulates its own car with the existing physics (they already do,
single-player style). Every ~50–100 ms it sends "I'm at x, z, heading h, speed v".
The server just forwards these and additionally owns the *game state machine*:
who is in the lobby, when green shows, who crossed the line when, the podium.

- ✅ Cheap: physics code already exists and works at 120 Hz locally.
- ✅ No fighting "two simulators, one car" (rubber-banding, prediction correctness).
- ✅ Small race: the race is 200 m straight — precise enemy simulation barely matters.
- ❌ Server cannot stop cheating (impossible to fix in scope anyway).
- ❌ Finish order depends on trusting client-reported crossing times (mitigate
  with Q3's shared clock).

**Option B — Server-authoritative physics.**
Server simulates ALL cars; clients send only steering inputs; clients predict.

- ✅ One truth, no cheating problem.
- ❌ Requires client prediction + re-reconciliation of 120 Hz physics. This is
  the classic netcode rabbit hole and can eat the whole budget. Way too big here.

**Option C — Client-authoritative relay, server is just a dumb pipe.**
The server forwards everything but knows nothing about the game.

- ✅ Simplest server code, almost zero game logic on the server.
- ❌ The brief *requires* the server to decide the official order and host the
  lobby — a dumb pipe can't do either.
- ❌ Disconnected players can't be detected and handled as game events
  (server wouldn't know a finish line exists).

**Recommendation:** A. The rule "the server *decides* the official order" fits
nicely: the server owns the *meta* rules, the physics stays local, exactly like
the single-player game today. Cheating is out of scope (brief says solid > complete).

---

## Q3 — Clocks: how do 2–4 different machines agree on "now"?

Problems: different machines' clocks differ; network travel takes time; the brief
demands the green light at the same moment ±100 ms on every screen, and ms-grade
finish ordering.

**Option A — Master clock on the server, measured with pings.**
The server sends "it is t = 12345.6 now"; the client measures round-trip time
(send ping → get pong), estimates offset = serverTime − (localTime + rtt/2).
Client uses offset for green-light rendering and finish timestamps.

- ✅ Simple; the ±100 ms tolerance is generous vs. a typical intranet RTT of 1–5 ms.
- ✅ Same mechanism times the finish: client reports "crossed at server-time T",
  server orders by T. Laggard networks only mistime their own finish a few ms.
- ❌ Offset estimate is noisy (jitter). Fixed by taking the minimum over several
  pings, and by re-pinging during the lobby/countdown.

**Option B — Server broadcast "GO" and everything starts on receipt.**

- ✅ No math needed.
- ❌ Whoever's packet arrives last starts last — up to a network jiffy of unfairness;
  brief demands ±100 ms *at the same instant*, so this doesn't meet the mark.

**Option C — Countdown with big numbers (3, 2, 1, GO) broadcast repeatedly.**

- ✅ Human-slow correction ability; viewers can handle several hundred ms.
- ❌ Still imprecise for ms-grade finish ties and needs more protocol.

**Recommendation:** A, with the ping repeating while everyone is parked in the
lobby so the offset is stable before the countdown. GO moment = one server
timestamp ("green at server-time T"), clients countdown to T−(offset+rtt/2).

---

## Q4 — Making remote taxis look smooth

Updates arrive ~10–20 Hz; we must render at 60 FPS. Showing only the latest
value means the other taxis jump at only 10-20 frames per second.

**Option A — Buffer + interpolate (+ maybe extrapolate).**
Keep a few snapshots around; render "where was (car) between snapshot 100 ms
ago and now" (an interpolation delay like 100–150 ms is standard).

- ✅ Constant smoothness for everyone; simple math (lerp + heading interpolation).
- ✅ Tests: interpolate between two known snapshots, verify continuity.
- ❌ A sneaky constant lag (~1/10 of a second) in what everyone sees.
- ❌ Speed/heading must be interpolated too or cars look like they slide sideways.

**Option B — Extrapolate predict one car ahead (dead reckoning).**

- ✅ Lower perceived lag.
- ❌ Walls/bends can cause obvious wrong guesses; needs snap-forgiveness. This
  "car will keep going" guess only works in situations where fields/turns are
  mild — over a 200 m straight line with a *straight* track it's actually
  mostly fine, but each added branch adds logic risk.

**Recommendation:** A. On a straight 200 m line, 100 ms of visual lag is
invisible relative to racing fairness, and it's more testable.

---

## Q5 — Race state machine: where does it live and what does it own?

Lobby → countdown → racing → finished → ceremony must be a pure, tested module.

**Split:**

- A pure module `raceState` (no DOM/network): stage + roster + config in,
  allowed transitions + facts out. Examples: "start below 2 players" is
  rejected, "5th player joins" is rejected, "winner known → moving to podium
  when all finish OR 30 s after winner".
- A thin `serverMain` that feeds real sockets into `raceState`.
- A thin client that renders `raceState` facts into the HUD/UI.

- ✅ All the exclusions in the brief (fewer than 2, fifth rejection, a
  disconnecter not blocking the podium) become table-stakes unit tests.
- ❌ None. This split is the single must-have.

**Open sub-questions:**

- Does the *client* also mirror the state machine, or does it only display what
  the server says? Recommendation: client displays server-decided stage + local
  lobby UI; no duplicated client-side machine (less drift).

---

## Q6 — Track and seed handling

- **Who picks the seed?** The server picks it in the lobby (any new race cancels
  the old) — single-player mode falls back to URL `?seed=`.
- **Where does the 200 m straight track come from?** We must find, from the city
  data, one 200 m straight road, put a start grid (one slot per player, no cars
  overlapping) and a finish line there, all *on road with no collider in the way*.
  This must be a pure function from the seed/testable.

**Options for where the grid sits:**

- **A — On "Unter den Linden" east of the gate** (like the normal spawn).
- **B — Find generically any long-enough EW/NS street without crossers.**

A is simpler (the boulevard is guaranteed long and wide), B is more "engineered".
Recommendation: A with a generic helper whose *constraints* are unit-tested
(200 m long, on road, no collider) so it survives `generateCity` changes.

---

## Q7 — Do taxis collide with each other, or pass through (ghosts)?

- **Collide (bump).** Realistic racing feel; but it needs an agreed rule: whose
  sim moves whom? Requires cross-sim message and a swap of authority.
- **Pass through.** Cheap and fair: everyone owns their world, remote feelings
  aside, remote cars are ghosts.
- **Resolve-at-server / resolve-at-client with precedence rule.**

Recommendation: pass-through (ghost) for the solid core; note as "next" step.
The brief's grid rule ("starting slots so no taxi overlaps another") is easy
with placement-only collision checks.

---

## Q8 — Single-player compatibility + serving the game from the server

- `src/main.js` must keep working standalone with `npm start` (no server).
- The new server *serves the same static files*. If we point it at a directory
  and it uses the same `http` module, we can (a) keep `tools/serve.mjs` and
  (b) grow the server (`server/main.mjs`) by extracting a shared static file
  utility, so there's no copy-paste logic. Strictly, `npm run check`'s size
  check must exclude `server/` from `src/` accounting (it already does — only
  `index.html` + `src/**` count).
- Any shared *client* modules that talk about "am I in a race" must not break the
  solo flow (a multiplayer feature gate, off by default, URL-activated).

**Recommendation:** Server `/` serves the game; `src/net/` is only imported in
main.js when the URL has a `?net=...`-style flag or when connection detection
succeeds; everything else is unchanged.

---

## Q9 — Client size budget

The budget is ≤96 KB raw / ~32 KB gzip for `index.html` + `src/**` — server
code is free. The MVP is ~52 KB raw / ~19 KB gzip, so there's ~40% headroom.

Players on the client need: the lobby UI, the shared clock, the interpolation,
remote-taxi rendering (name tags, roof number, podium geometry), plus the HUD
for race positions. Rough guess: 15–25 KB raw / 5–9 KB gzip. We must verify
against the budget early, not at the end.

**Options:**

- **A — One `src/net/` folder, additive only.**
- **B — Feature flag with two builds.** No build step is a hard rule → not on the table.

**Recommendation:** A, with the size check run as part of TDD red/green so
overruns scream immediately (add a size guard comment listing "budget consumed
so far" in a feature file header).

---

## Q10 — Testing multiplayer logic without a network

We can't spin browsers in unit tests. What we *can* do:

- Pure modules for: race state machine, WS frame encoding/decoding, clock math,
  interpolated remote-car smoothing, track selection.
- Fake the network: an in-memory `FakeConnection` pair + `FakeServer` that calls
  handlers directly with fixed timestamps — this tests race logic end-to-end
  (two joined players, countdown, finish order, a disconnect during the race)
  without any real socket.
- Physics of *local* cars is already tested; remote cars need their own tests
  (interpolation, never teleporting backwards).

---

## Q11 — Scoping: what could be cut on a time-boxed budget?

Rough tiers.

- **Must (solid 2-player core):** lobby UI + server, 2–4 cap, start grid,
  green light ±100 ms, send own position ~15 Hz, smooth remote taxis, finish
  line + server-ordered times, shared seed/track test.
- **Should:** jump-start penalty (bonus in brief), name tags, podium ceremony.
- **Could:** full 3-step podium with orbit camera, "Nochmal" restart loop.
- **Won't (document why in NOTES.md):** taxi-vs-taxi collision, cheating
  defense, internet (WAN) play, spectator mode.

---

## Q12 — Edge cases worth deciding upfront

- A player's browser tab closes / network dies mid-race → show them as DNF
  and let the podium complete anyway (brief requirement).
- Two players share one Wi-Fi, each with a tab: IP-less identity is fine —
  the server just needs `connectionId + displayName`.
- The server restarts mid-race → out of scope; document.
- The race mode is re-entered → "Nochmal" resets to fresh grid (a new seed can
  be re-rolled or reused — decide in the plan).

---

## Q13 — How do we draw the *other* players' taxis? (new, session 2)

Follow-up from looking at `renderer.js`: every mesh is its own draw call. One
remote taxi = body (1) + wheels (4) + shadow (1) = **6 draw calls**. With 2–4
players that's up to 3 × 6 = ~18 extra draws, on top of the city's single big
draw (~87k vertices). Wheels also spin and front wheels steer, so the wheels
are *dynamic* per car.

**Option A — Re-draw the existing taxi meshes with a different model matrix.**
Same VAO, different transform + a "player number / colour" uniform.

- ✅ Nearly zero new code and zero new memory; reuse of `taxiModel.js`.
- ❌ Renderer needs a small "draw this mesh with this transform" loop — it may
  already only know the fixed set of game meshes (needs a closer look in the plan).

**Option B — Build one merged mesh per remote car each frame.**

- ✅ Fewer draw calls (1–2 per car).
- ❌ Rebuilding geometry every frame is wasteful CPU work; more code.

**Recommendation:** A. 18 extra draw calls is nothing for a 60 FPS budget;
per-frame geometry building would be wasted effort.

Open detail for the plan: how the roof sign shows the player number / colour
strip procedurally (shader uniform vs. mesh variant), and name tags in the HUD.

---

## Q14 — Server seed vs. the seed the client already loaded (new, session 2)

A player loads `http://<host-ip>:<port>/`, the game boots and immediately
generates a city — but the *race* seed comes from the server and may be
different. So some point in the flow the client must **throw away its city and
regenerate from the server's seed**.

Timing facts: generation is ~3 ms + mesh building ~20 ms (spec §5), so the
regeneration hitch is tiny — but it still needs a defined moment.

**Option A — Server assigns the seed when the lobby opens; client regenerates
immediately on join, shows a "Warming up…" moment, then the lobby.**

- ✅ All hitching happens before anyone races; the countdown is smooth.
- ❌ Re-generation also happens for returning players on "Nochmal" if the seed
  is re-rolled (cheap anyway).

**Option B — Keep the client's URL seed; only players with the same seed can
race.**

- ✅ Zero re-generation.
- ❌ Breaks the brief: "the server picks the seed" and players must not have to
  type anything but their name.

**Recommendation:** A, with the plan deciding whether "Nochmal" re-rolls the
seed (fresher city) or reuses it (faster restart, identical track).

---

## Q15 — Protocol documentation as a deliverable (new, session 2)

The brief *requires* a documented protocol: message types, fields, who sends
what, at which rate. Decision for the plan: it lives in `NOTES.md` (and the
message type names live next to the code that encodes them), with a small table
like `type | from | fields | rate`. This should be written from the code, not
the other way around — the pure protocol module (one `encode`/`decode` per
message type) can generate or at least verify the table.

---

## TL;DR — the decisions we need before planning

| # | Question | Recommendation |
|---|---|---|
| 1 | Transport | Hand-rolled WebSocket over `node:http` upgrade |
| 2 | Authority | Server relays positions + owns race rules; clients own own-car physics |
| 3 | Clocks | Server master clock + repeated pings; GO = one server timestamp |
| 4 | Remote smoothing | Interpolation with ~100 ms buffer (no dead reckoning) |
| 5 | State machine | Pure module + unit tests, real sockets injected around it |
| 6 | Seed/track | Server picks seed; grid on Unter den Linden, generically validated |
| 7 | Taxi collisions | Pass-through (ghosts), colliding documented as future work |
| 8 | Solo compatibility | Solo keeps working; net mode is opt-in |
| 9 | Size budget | Additive `src/net/` folder; check after each feature |
| 10 | Testing | Pure modules + in-memory fake network (FakeServer / FakeConnection) |
| 11 | Scoping | Solid 2-player core first; podium is second; WAN never |
| 12 | Edge cases | Disconnecter = DNF; server restart out of scope |
| 13 | Remote taxi rendering | Re-draw existing taxi mesh per remote car (transforms, not new geometry) |
| 14 | Seed sync | Server seed assigned at lobby; client regenerates before racing |
| 15 | Protocol doc | Table in NOTES.md, written from/with the pure protocol module |
