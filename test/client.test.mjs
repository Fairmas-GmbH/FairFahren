// Phase 3: the net client (src/net/client.js), driven END-TO-END through
// fakeNet against the real raceState — join, roster, seed, start gate, stage,
// turn-away, clean drop, master-clock pings, finish gating, results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNet, FakeServer } from '../server/fakeNet.js';
import { createRaceState, CLOSE_FULL } from '../server/raceState.js';
import { decode, encode } from '../server/protocol.js';
import { createNetClient } from '../src/net/client.js';

// A wired server + turnkey net clients on the virtual network. The server
// remembers every client message raw (`saw(type)` counts them); each client
// records all callbacks in `c.log`.
function world({ seed = 42, latency = 0 } = {}) {
  const net = new FakeNet();
  const server = new FakeServer(net);
  const onWire = []; // raw texts exactly as the server received them
  const rejects = new Map(); // client conn → { code, reason } the server turned it away with
  const race = createRaceState({
    seed,
    now: () => net.now,
    send: (conn, type, data) => conn.send(encode(type, data)),
    close: (conn, code, reason) => {
      conn.close(code, reason);
      // fakeNet's peer side fires onClose() without the code (it is only
      // recorded on the closer); the real socket delivers it asynchronously
      // with its code. Remember it here and hand it to the client below.
      rejects.set(conn.peer, { code, reason });
    },
    schedule: (delayMs, fn) => net.schedule(delayMs, fn),
  });
  server.onConnect = (conn) => {
    race.connect(conn);
    conn.onMessage = (text) => { onWire.push(text); race.onMessage(conn, text); };
    conn.onClose = () => race.disconnect(conn);
  };
  const saw = (type) => onWire.map((t) => { try { return decode(t).type; } catch { return `raw:${t}`; } }).filter((ty) => ty === type);
  const client = (name) => {
    const conn = server.connect({ latency });
    const log = {
      roster: [], seedChange: [], stage: [], goAt: [], peerPos: [], peerGone: [],
      finishInfo: [], results: [], turnedAway: [], dropped: [], jumped: [],
    };
    const c = createNetClient({
      conn, name, now: () => net.now, every: (ms, fn) => net.schedule(ms, fn),
      on: {
        roster: (players, s) => log.roster.push({ players, seed: s }),
        seedChange: (s) => log.seedChange.push(s),
        stage: (s) => log.stage.push(s),
        goAt: (g) => log.goAt.push(g),
        peerPos: (state) => log.peerPos.push(state),
        peerGone: (id) => log.peerGone.push(id),
        finishInfo: (f) => log.finishInfo.push(f),
        jumped: (j) => log.jumped.push(j),
        results: (players) => log.results.push(players),
        turnedAway: (code, reason) => log.turnedAway.push({ code, reason }),
        dropped: (reason) => log.dropped.push(reason),
      },
    });
    c.conn = conn;
    c.log = log;
    // Replay the turn-away fakeNet fired before any client handler could
    // exist (see world.close). The real socket delivers this late, code in hand.
    const rej = rejects.get(conn);
    if (rej) conn.onClose(rej.code, rej.reason);
    return c;
  };
  return { net, race, client, saw };
}

test('two clients join → roster + seed → start gate → countdown → racing → relay', () => {
  const { net, client } = world();
  const a = client('A');
  net.advance(0);
  assert.equal(a.stage, 'lobby');
  assert.deepEqual(a.log.seedChange, [42], 'seedChange fires once for the first roster');
  assert.equal(a.canStart, false, 'a lone player cannot start a race');
  a.startRace();
  assert.equal(a.stage, 'lobby', 'start with 1 player does nothing');

  const b = client('B');
  net.advance(0);
  for (const c of [a, b]) {
    assert.deepEqual(c.players.map((p) => p.name).sort(), ['A', 'B']);
    assert.equal(c.seed, 42);
    assert.equal(c.canStart, true, 'two players open the gate');
    assert.deepEqual(c.log.seedChange, [42], 'the same seed never re-fires seedChange');
  }
  assert.ok(a.log.roster.length === 2, 'roster fired on every roster message for A');
  assert.ok(b.log.roster.length === 1, 'roster fired once for late joiner B');

  a.startRace();
  assert.equal(a.stage, 'countdown');
  assert.equal(b.stage, 'countdown', 'stage message reached B');
  assert.equal(a.goAt, b.goAt, 'one shared goAt');
  assert.equal(new Set(b.log.goAt).size, 1, 'countdown and go carry the same goAt');

  net.advance(3000);
  assert.equal(a.stage, 'racing');
  assert.equal(b.stage, 'racing');

  a.sendPos({ x: 1, z: 2, h: 0.5, s: 3 });
  net.advance(0);
  const relay = b.log.peerPos[0];
  assert.ok(relay, 'posRelay flowed through sendPos to the peer');
  assert.equal(relay.x, 1);
  assert.equal(relay.z, 2);
  assert.equal(relay.h, 0.5);
  assert.equal(relay.s, 3);
  assert.equal(relay.id, a.players.find((p) => p.name === 'A').id, 'relayed under A id');
  assert.ok(Number.isFinite(relay.t), 'receive time is attached for the interp buffer');

  // sendPos is gated: nobody races from the lobby.
  const fresh = world();
  const lone = fresh.client('Lone');
  fresh.net.advance(0);
  lone.sendPos({ x: 1, z: 2, h: 0, s: 0 });
  fresh.net.advance(0);
  assert.deepEqual(fresh.saw('pos'), [], 'no positions leave the lobby');
});

test('the fifth client is turned away: on.turnedAway(4000, ...) + stage', () => {
  const { net, client } = world();
  for (const n of ['A', 'B', 'C', 'D']) { client(n); net.advance(0); }
  const eve = client('Eve');
  net.advance(0);
  assert.deepEqual(eve.log.turnedAway, [{ code: CLOSE_FULL, reason: 'lobby full' }]);
  assert.equal(eve.stage, 'turnedAway');
  assert.equal(eve.log.roster.length, 0, 'a turned-away client never saw a lobby');
  assert.equal(eve.canStart, false);
});

test('a clean drop → on.dropped + stage dropped', () => {
  const { net, client } = world();
  const a = client('A');
  net.advance(0);
  a.conn.close();
  assert.equal(a.stage, 'dropped');
  assert.equal(a.log.dropped.length, 1, 'dropped fired with the (absent) reason');
  assert.equal(a.log.turnedAway.length, 0);
});

test('a racer dropping mid-race → peerGone on the survivor', () => {
  const { net, client } = world();
  const a = client('A');
  const b = client('B');
  net.advance(0);
  a.startRace();
  net.advance(3000);
  a.conn.close();
  net.advance(0);
  assert.deepEqual(b.log.peerGone, [a.players.find((p) => p.name === 'A').id]);
});

test('malformed or unknown frames are dropped silently; sendRaw reaches the server', () => {
  const { net, race, client } = world();
  const a = client('A');
  net.advance(0);
  a.sendRaw('not json at all');
  a.sendRaw(JSON.stringify({ type: 'bogus', data: {} }));
  assert.equal(a.stage, 'lobby', 'garbage changes nothing');
  assert.deepEqual(a.log.stage, []);
  assert.equal(race.stage, 'lobby', 'the race survived the garbage');
  assert.ok(a.log.roster.length >= 1, 'valid frames before the garbage were processed');
});

test('pings ~1 Hz and each pong feeds the clock', () => {
  const { net, client } = world();
  const a = client('A');
  net.advance(0);
  assert.equal(a.clock.synced(), false);
  net.advance(1000); // first ping at local now = 1000; the fake round trip has zero latency
  assert.equal(a.clock.synced(), true);
  assert.equal(a.clock.offset(), 0);
  net.advance(1000); // second ping → second sample, still exact
  assert.equal(a.clock.offset(), 0);
});

test('sendFinish is gated and goes on the wire exactly once', () => {
  const { net, client, saw } = world();
  const a = client('A');
  const b = client('B');
  net.advance(0);
  a.sendFinish(100); // lobby
  assert.deepEqual(saw('finish'), [], 'no finish from the lobby');
  a.startRace();
  a.sendFinish(200); // countdown
  assert.deepEqual(saw('finish'), [], 'no finish before the race');
  net.advance(3000); // racing
  a.sendFinish(1720);
  a.sendFinish(1720); // client remembers: no second send
  net.advance(0);
  assert.deepEqual(saw('finish'), ['finish'], 'exactly one finish reached the wire');
  assert.deepEqual(b.log.finishInfo, [{ id: a.players.find((p) => p.name === 'A').id, t: 1720 }]);
});

test('results drop at the winner+30 s window; DNF stays on the table', () => {
  const { net, client } = world();
  const a = client('A');
  const b = client('B');
  net.advance(0);
  a.startRace();
  net.advance(3000);
  a.sendFinish(1720);
  net.advance(30000); // B never reports → settled as DNF
  const core = (rows) => rows.map((r) => ({ id: r.id, name: r.name, t: r.t, dnf: r.dnf }));
  assert.deepEqual(a.log.results.map(core), [[
    { id: a.players.find((p) => p.name === 'A').id, name: 'A', t: 1720, dnf: false },
    { id: b.players.find((p) => p.name === 'B').id, name: 'B', t: null, dnf: true },
  ]]);
  assert.ok(a.log.stage.includes('finished'));
  net.advance(2000);
  assert.ok(a.log.stage.includes('ceremony'), 'the podium stage follows the results');
});

test('seedChange fires exactly once per distinct seed value', () => {
  const { net, client } = world();
  const a = client('A');
  net.advance(0);
  // Every further join re-broadcasts the SAME roster seed — never re-fires.
  for (const n of ['B', 'C', 'D']) { client(n); net.advance(0); }
  assert.equal(a.log.roster.length, 4, 'roster fired for every broadcast');
  assert.deepEqual(a.log.seedChange, [42], 'but seedChange only for the single distinct value');
  // A different server seed is a different value: fires there (once).
  const second = world({ seed: 7 });
  const x = second.client('X');
  second.net.advance(0);
  second.client('Y');
  second.net.advance(0);
  assert.deepEqual(x.log.seedChange, [7]);
  assert.equal(x.log.roster.length, 2, 'roster re-fired for both joins');
});

test("a 'jumped' broadcast reaches on.jumped with the id and the server's penalty", () => {
  const { net, race, client } = world();
  const a = client('A');
  net.advance(0);
  const b = client('B');
  net.advance(0);
  a.startRace();
  net.advance(0); // countdown stage, well before goAt
  a.sendRaw(encode('jump', {}));
  a.sendRaw(encode('jump', {})); // a second attempt is ignored by the server
  net.advance(0);
  assert.equal(race.stage, 'countdown');
  const aid = a.players.find((p) => p.name === 'A').id;
  assert.deepEqual(a.log.jumped, [{ id: aid, pen: 3000 }], 'exactly one penalty, own id included');
  assert.deepEqual(b.log.jumped, [{ id: aid, pen: 3000 }], 'peers hear about the jump start too');
});
