// The full race loop, browser-free, over the REAL modules: two net clients
// (src/net/client.js) paired through fakeNet against the real raceState, with
// physics cars placed on a track derived from the shared world. One test runs
// lobby → shared countdown → jump start → finishes → settled results →
// ceremony → Nochmal rematch → a second clean race. Everything runs on
// fakeNet's virtual clock (net.advance) — no timers, fully deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNet, FakeServer } from '../server/fakeNet.js';
import { createRaceState, JUMP_PENALTY_MS } from '../server/raceState.js';
import { decode, encode } from '../server/protocol.js';
import { createNetClient } from '../src/net/client.js';
import { ampelState, createStartGate, crossingTime } from '../src/net/raceLocal.js';
import { createCar, stepCar, TAXI } from '../src/vehicle/carPhysics.js';
import { buildTrack } from '../src/net/track.js';
import { generateCity } from '../src/world/cityGen.js';

const DT = 1 / 60; // physics slice, like the browser game loop
const STEP = 1000 / 60; // the same slice on the virtual network clock
const WIRE = 10; // symmetric latency in ms — gives the pings a real round trip

// A wired server + turnkey net clients on the virtual network. Each client
// records every on.* callback in `c.log` and every incoming frame in `c.raw`.
function wiredNet({ seed = 42, latency = WIRE } = {}) {
  const net = new FakeNet();
  const server = new FakeServer(net);
  const race = createRaceState({
    seed,
    now: () => net.now,
    send: (conn, type, data) => conn.send(encode(type, data)),
    close: (conn, code, reason) => conn.close(code, reason),
    schedule: (ms, fn) => net.schedule(ms, fn),
  });
  server.onConnect = (conn) => {
    race.connect(conn);
    conn.onMessage = (text) => race.onMessage(conn, text);
    conn.onClose = () => race.disconnect(conn);
  };
  const client = (name) => {
    const conn = server.connect({ latency });
    const log = {
      roster: [], seedChange: [], stage: [], goAt: [], peerPos: [],
      finishInfo: [], results: [], turnedAway: [], dropped: [],
    };
    const c = createNetClient({
      conn, name, now: () => net.now, every: (ms, fn) => net.schedule(ms, fn),
      on: {
        roster: (players, s) => log.roster.push({ players, seed: s }),
        seedChange: (s) => log.seedChange.push(s),
        stage: (s) => log.stage.push(s),
        goAt: (g) => log.goAt.push(g),
        peerPos: (p) => log.peerPos.push(p),
        finishInfo: (f) => log.finishInfo.push(f),
        results: (rows) => log.results.push(rows),
        turnedAway: (code, reason) => log.turnedAway.push({ code, reason }),
        dropped: (reason) => log.dropped.push(reason),
      },
    });
    // Tee every arriving frame for wire-level assertions ('jumped' has no
    // client handler — it is observed here and in the results only).
    const inner = conn.onMessage;
    c.raw = [];
    c.log = log;
    conn.onMessage = (text) => { c.raw.push(decode(text)); inner(text); };
    return c;
  };
  return { net, race, client };
}

// One whole race on the virtual clock: waits through the German ampel, holds
// the grid frozen behind the start gate (optionally one jump-start press by B
// while the light is still red+amber), then runs 60 Hz physics eastwards,
// streams 15 Hz positions and reports each crossing as elapsed race time on
// the master clock. Returns the track plus per-side { t } report times.
function driveRace({ net, a, b, press = false }) {
  const track = buildTrack(generateCity({ seed: a.seed }), 2);
  const serverNow = (c) => c.clock.serverNow(net.now); // master-clock view
  const ampel = (c) => ampelState(serverNow(c), c.goAt);
  assert.ok(a.clock.synced() && b.clock.synced(), 'both clocks are pong-synced before the light turns amber');
  assert.equal(a.goAt, b.goAt, 'one shared start moment');

  // A side of the grid: a fresh car behind a fresh start gate on its client's
  // own clock. Pre-green the gate freezes the car — physics never runs early.
  const side = (c, throttle, slot) => {
    const s = { client: c, car: createCar(track.grid[slot]), throttle, jumped: 0, t: null, last: null };
    s.gate = createStartGate({
      isGreen: () => serverNow(c) >= c.goAt,
      onJump: () => { s.jumped += 1; c.sendRaw(encode('jump', {})); },
    });
    return s;
  };
  const A = side(a, 0.8, 0); // throttled just enough for B's penalty to decide
  const B = side(b, 1, 1);

  assert.equal(ampel(B.client), 'red', 'solid red while the countdown runs');
  while (ampel(B.client) === 'red') net.advance(STEP);
  assert.equal(ampel(B.client), 'red+amber', 'red+amber precedes the green');
  if (press) {
    const press1 = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    B.gate.step(B.car, press1, TAXI, DT); // frozen: car untouched, onJump fires
    assert.equal(B.jumped, 1, 'the frozen gate reports a jump start exactly once');
  }
  while (ampel(B.client) === 'red+amber') net.advance(STEP);
  assert.equal(ampel(B.client), 'green', 'the shared light turns green on every client');
  assert.equal(ampel(A.client), 'green');

  // The race: fixed timestep, positions into the relay, crossings interpolated.
  const sides = [A, B];
  let frame = 0;
  while (sides.some((s) => s.t === null) && frame++ < 6000) {
    net.advance(STEP);
    for (const s of sides) {
      if (s.t !== null) continue; // crossed: parked until the race settles
      const prev = s.last ?? { x: s.car.x, t: net.now };
      s.gate.step(s.car, { throttle: s.throttle, brake: 0, steer: 0, handbrake: false }, TAXI, DT);
      const cur = { x: s.car.x, t: net.now };
      s.last = cur;
      const hit = crossingTime(prev, cur, track.finish.x);
      if (hit !== null) s.t = Math.round(s.client.clock.serverNow(hit) - s.client.goAt);
      else if (frame % 6 === 0) s.client.sendPos({ x: s.car.x, z: s.car.z, h: s.car.heading, s: s.car.speed });
    }
  }
  assert.ok(sides.every((s) => Number.isFinite(s.t) && s.t > 0), 'both sides crossed inside the sim window');
  return { track, A, B };
}

test('lobby → jump start → settled results → ceremony → Nochmal rematch → clean second race', () => {
  const { net, client } = wiredNet({ seed: 42 });
  const a = client('Anna');
  const b = client('Ben');
  const idOf = (c) => c.players.find((p) => p.name === (c === a ? 'Anna' : 'Ben')).id;
  const saw = (c, type) => c.raw.filter((m) => m.type === type);

  // a) two joins on the wire → one lobby, same seed, start gate open
  net.advance(2 * WIRE + 5); // joins hop over, rosters come back
  for (const c of [a, b]) {
    assert.equal(c.stage, 'lobby');
    assert.equal(c.players.length, 2);
    assert.equal(c.seed, 42, 'the shared world arrives with the roster');
    assert.ok(c.canStart, 'two players open the start gate');
  }
  assert.deepEqual(a.seed, b.seed);

  // b) one start press → shared countdown on both clients, roster unchanged
  a.startRace();
  net.advance(WIRE * 2 + 10);
  for (const c of [a, b]) {
    assert.equal(c.stage, 'countdown');
    assert.ok(Number.isFinite(c.goAt) && c.goAt > net.now, 'green lies ahead on the server clock');
    assert.equal(c.players.length, 2, 'the roster did not change at the start');
  }
  assert.equal(a.goAt, b.goAt, 'one shared goAt');

  // i) master-clock sync: the lobby pings echoed back before any green
  net.advance(1000);
  for (const c of [a, b]) assert.ok(c.clock.synced() && c.clock.offset() !== null, 'pong-fed clock offset available');

  // c) B jumps the light: frozen gate reports exactly once, the server fixes
  // the penalty itself (the jump press carries no size, only the report).
  const r1 = driveRace({ net, a, b, press: true });
  assert.deepEqual(saw(a, 'jumped'), [{ type: 'jumped', data: { id: idOf(b), pen: JUMP_PENALTY_MS } }],
    'exactly one jumped broadcast, penalty set by the server alone');
  assert.ok(r1.B.t < r1.A.t, 'raw times: clean B crossed first');
  assert.ok(r1.B.t + JUMP_PENALTY_MS > r1.A.t, 'the penalty is what flips the podium');
  let mark = a.log.peerPos.length;
  const relaysA = a.log.peerPos.filter((p) => p.id === idOf(b));
  assert.ok(relaysA.length > 10, 'B streamed positions into A\'s interp buffer');
  for (let i = 1; i < relaysA.length; i++) assert.ok(relaysA[i].x > relaysA[i - 1].x, 'relayed x never goes back');

  // d/e) finish reports while racing → settled order = reported time + penalty
  a.sendFinish(r1.A.t);
  b.sendFinish(r1.B.t);
  net.advance(WIRE * 2 + 5);
  const rows = (c) => c.log.results[c.log.results.length - 1];
  assert.deepEqual(rows(a), rows(b), 'both clients saw the same settled table');
  assert.deepEqual(rows(a).map((r) => r.id), [idOf(a), idOf(b)], 'server reorders: penalty time beats raw time');
  assert.deepEqual(rows(a).map((r) => r.t), [r1.A.t, r1.B.t]);
  assert.deepEqual(rows(a).map((r) => r.pen), [0, JUMP_PENALTY_MS]);
  assert.deepEqual(rows(a).map((r) => r.dnf), [false, false]);
  assert.deepEqual(new Set(b.log.finishInfo.map((f) => f.id)), new Set([idOf(a), idOf(b)]), 'both finishes echoed');
  assert.ok(a.log.stage.includes('finished'));

  // f) podium: the ceremony stage follows the results pause
  net.advance(2000 + WIRE * 2);
  for (const c of [a, b]) assert.equal(c.stage, 'ceremony');

  // g) Nochmal from the ceremony: seed +1, fresh countdown, same racers
  mark = a.log.peerPos.length;
  a.sendRaw(encode('again', {}));
  net.advance(WIRE * 2 + 10);
  for (const c of [a, b]) {
    assert.equal(c.stage, 'countdown', 'one press throws the race away and re-grids everyone');
    assert.equal(c.seed, 43, 'the rematch drives the NEXT generated world');
    assert.ok(c.goAt > net.now, 'a fresh countdown is running');
    assert.equal(c.players.length, 2, 'ids and names survive the rematch');
  }
  assert.deepEqual(a.log.seedChange, [42, 43], 'the new world reached the clients exactly once');
  assert.deepEqual(saw(a, 'jumped').length, 1, 'the rematch started clean');

  // h) the rematch race, no foul: clean B also wins here — on raw pace, place 1
  const r2 = driveRace({ net, a, b });
  assert.notStrictEqual(r2.track.start.x, r1.track.start.x, 'seed + 1 laid out a different stretch of track');
  assert.ok(r2.B.t < r2.A.t, 'B wins the rematch on raw pace');
  const relays2 = a.log.peerPos.slice(mark).filter((p) => p.id === idOf(b));
  assert.ok(relays2.length > 10, 'the second race streamed positions again');
  for (let i = 1; i < relays2.length; i++) assert.ok(relays2[i].x > relays2[i - 1].x, 'relay x never goes back (race 2)');
  a.sendFinish(r2.A.t); // the roster reset per-race reporting: no stale penalty
  b.sendFinish(r2.B.t);
  net.advance(WIRE * 2 + 5);
  const rows2 = (c) => c.log.results[c.log.results.length - 1];
  assert.deepEqual(rows2(a), rows2(b), 'same settled table after the rematch');
  assert.deepEqual(rows2(a).map((r) => r.id), [idOf(b), idOf(a)], 'clean winner first, no stale penalty');
  assert.deepEqual(rows2(a).map((r) => r.t), [r2.B.t, r2.A.t]);
  assert.deepEqual(rows2(a).map((r) => r.pen), [0, 0]);
  assert.deepEqual(rows2(a).map((r) => r.dnf), [false, false]);

  net.advance(2000 + WIRE * 2);
  for (const c of [a, b]) assert.equal(c.stage, 'ceremony', 'the rematch ends on the podium too');
  assert.deepEqual(a.log.stage, ['countdown', 'racing', 'finished', 'ceremony', 'countdown', 'racing', 'finished', 'ceremony'],
    'the full stage sequence, once per race');
  for (const c of [a, b]) assert.deepEqual([...c.log.turnedAway, ...c.log.dropped], [], 'nobody was turned away or dropped');
});
