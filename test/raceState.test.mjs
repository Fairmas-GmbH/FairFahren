// Phase 2: every rule of the race, driven END-TO-END through fakeNet pairs —
// joins → start → positions → finishes → results → ceremony, no real socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNet, FakeServer } from '../server/fakeNet.js';
import { createRaceState, CLOSE_FULL, CLOSE_STARTED, JUMP_PENALTY_MS } from '../server/raceState.js';
import { decode, encode } from '../server/protocol.js';

// A wired-up server + client handles on the virtual network. Each client
// records every message it is sent as {type, data}; `client.send(type, data)`
// encodes + delivers with the client's injected latency.
function world({ latency = 0 } = {}) {
  const net = new FakeNet();
  const server = new FakeServer(net);
  const rejected = []; // every { code, reason } the server turned someone away with
  const race = createRaceState({
    seed: 42,
    now: () => net.now,
    send: (conn, type, data) => conn.send(encode(type, data)),
    close: (conn, code, reason) => {
      rejected.push({ code, reason }); // visible even though the reject fires before any client handler exists
      conn.close(code, reason);
    },
    schedule: (delayMs, fn) => net.schedule(delayMs, fn),
  });
  server.onConnect = (conn) => {
    race.connect(conn);
    conn.onMessage = (text) => race.onMessage(conn, text);
    conn.onClose = () => race.disconnect(conn);
  };
  const client = (opts) => {
    const conn = server.connect({ latency });
    const me = { conn, messages: [], id: null, closedWith: null };
    conn.onMessage = (text) => {
      const m = decode(text);
      me.messages.push(m);
      if (m.type === 'roster') me.id = m.data.players.find((p) => p.name === me.name)?.id ?? me.id;
    };
    conn.onClose = () => { me.closedWith = conn.closedWith; };
    me.name = null;
    me.join = (name) => {
      me.name = name;
      conn.send(encode('join', { name }));
      return me;
    };
    me.send = (type, data) => conn.send(encode(type, data));
    me.saw = (type) => me.messages.filter((m) => m.type === type);
    return me;
  };
  return { net, race, client, rejected };
}

test('start is rejected with fewer than 2 players', () => {
  const { race, client } = world();
  const a = client().join('A');
  a.send('start');
  assert.equal(race.stage, 'lobby');
  assert.deepEqual(a.saw('countdown'), []);
});

test('the 5th connection is turned away, the 4 play', () => {
  const { race, client, net, rejected } = world();
  const four = ['A', 'B', 'C', 'D'].map((n) => client().join(n));
  net.advance(0);
  assert.equal(race.stage, 'lobby');
  client();
  net.advance(0);
  assert.deepEqual(rejected, [{ code: CLOSE_FULL, reason: 'lobby full' }]);
  assert.ok(four.every((c) => c.saw('roster').at(-1).data.players.length === 4), 'roster has four players');
});

test('start gate opens with 2: lobby → countdown → go with one shared goAt', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  assert.equal(race.stage, 'countdown');
  const countdown = a.saw('countdown');
  assert.equal(countdown.length, 1);
  assert.ok(Number.isFinite(countdown[0].data.goAt));
  net.advance(3000);
  assert.equal(race.stage, 'racing');
  for (const c of [a, b]) {
    assert.deepEqual(c.saw('go')[0].data, { goAt: countdown[0].data.goAt });
    assert.ok(c.saw('stage').some((m) => m.data.stage === 'racing'));
  }
});

test('positions relay to everyone but the sender, only while the race runs', () => {
  const { client, net } = world();
  const [a, b, c] = [client().join('A'), client().join('B'), client().join('C')];
  net.advance(0);
  a.send('start');
  a.send('pos', { x: 1, z: 2, h: 0, s: 0 }); // during countdown: relayed (pre-green sanity), stage gate allows
  net.advance(0);
  assert.ok(b.saw('posRelay').some((m) => m.data.id === a.id && m.data.x === 1));
  net.advance(3000);
  b.send('pos', { x: 5, z: 6, h: 1, s: 3 });
  c.send('pos', { x: 7, z: 8, h: 1, s: 2 });
  net.advance(0);
  const got = a.saw('posRelay');
  assert.equal(got.filter((m) => m.data.id === a.id).length, 0, 'sender never receives own relay');
  assert.ok(got.some((m) => m.data.id === b.id && m.data.z === 6), 'b reaches a');
  assert.ok(got.some((m) => m.data.id === c.id && m.data.z === 8), 'c reaches a');
  assert.ok(!b.saw('posRelay').some((m) => m.data.id === b.id), 'b does not receive own relay');
  // After the results are settled, positions still relay, but in the lobby,
  // never: check stage gate by rewinding — fresh world instead.
  const fresh = world();
  const [x, y] = [fresh.client().join('X'), fresh.client().join('Y')];
  fresh.net.advance(0);
  x.send('pos', { x: 1, z: 2, h: 0, s: 0 });
  fresh.net.advance(0);
  assert.deepEqual(y.saw('posRelay'), [], 'no position relay in the lobby');
});

test('finish order equals time order; a tie goes to the earliest report', () => {
  const { race, client, net } = world();
  const [a, b, c] = [client().join('A'), client().join('B'), client().join('C')];
  net.advance(0);
  a.send('start');
  net.advance(3000);
  c.send('finish', { t: 5000 }); // reports first, but the slowest time
  b.send('finish', { t: 4000 });
  a.send('finish', { t: 4000 }); // equal times: b wins the tie by report order
  assert.equal(race.stage, 'finished', 'everyone home → results immediately');
  const results = a.saw('results')[0].data.players;
  assert.deepEqual(results.map((p) => ({ name: p.name, t: p.t, dnf: p.dnf })), [
    { name: 'B', t: 4000, dnf: false },
    { name: 'A', t: 4000, dnf: false },
    { name: 'C', t: 5000, dnf: false },
  ]);
  // Deterministic: an identical report sequence on a fresh world.
  const again = world();
  const [a2, b2] = [again.client().join('A'), again.client().join('B')];
  again.net.advance(0);
  a2.send('start');
  again.net.advance(3000);
  b2.send('finish', { t: 1000 });
  a2.send('finish', { t: 1000 });
  const r2 = a2.saw('results')[0].data.players;
  assert.deepEqual(r2.map((p) => p.name), ['B', 'A']);
});

test('DNF: disconnect mid-race never blocks the ceremony', () => {
  const { race, client, net } = world();
  const [a, b, c] = [client().join('A'), client().join('B'), client().join('C')];
  net.advance(0);
  a.send('start');
  net.advance(3000);
  c.conn.close(); // C drops out mid-race
  net.advance(0);
  assert.ok(a.saw('disconnect').some((m) => m.data.id === c.id));
  a.send('finish', { t: 6000 });
  b.send('finish', { t: 7000 });
  net.advance(0);
  assert.equal(race.stage, 'finished', 'A + B home, C is DNF → settle at once');
  net.advance(2000);
  assert.equal(race.stage, 'ceremony');
  const results = a.saw('results')[0].data.players;
  assert.equal(results.length, 3, 'DNF stays on the podium');
  assert.deepEqual(results[2], { id: c.id, name: 'C', t: null, dnf: true, pen: null });
});

test('everyone quitters: a race where all players DNF before any finish still settles', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  net.advance(3000);
  a.conn.close();
  b.conn.close();
  net.advance(0);
  assert.equal(race.stage, 'finished', 'no winner is coming — settle at once');
  net.advance(2000);
  assert.equal(race.stage, 'ceremony');
  // And nobody can sneak in: the race is over for late arrivals too.
  client();
  net.advance(0);
  assert.equal(race.stage, 'ceremony');
});

test('a second finish report from the same player is silent', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  net.advance(3000);
  a.send('finish', { t: 5000 });
  a.send('finish', { t: 4000 }); // cheat attempt: later, faster
  net.advance(0);
  assert.deepEqual(a.saw('finishInfo'), [{ type: 'finishInfo', data: { id: a.id, t: 5000 } }], 'report kept, not replaced');
  b.send('finish', { t: 5001 });
  net.advance(0);
  const results = a.saw('results')[0].data.players;
  assert.equal(results[0].t, 5000, 'first report stands, no re-ordering');
});

test('winner + 30 s forces the ceremony even with a straggler still driving', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  net.advance(3000);
  a.send('finish', { t: 6000 }); // winner
  net.advance(29999);
  assert.equal(race.stage, 'racing', 'still racing inside the 30 s window');
  net.advance(1);
  assert.equal(race.stage, 'finished', 'forced after 30 s');
  // A straggler finishing after the results are settled changes nothing:
  // the podium already said DNF, and a second finishInfo would lie.
  const infos = a.saw('finishInfo').length;
  b.send('finish', { t: 28000 });
  net.advance(0);
  assert.equal(a.saw('finishInfo').length, infos, 'post-settle finish report ignored');
  assert.equal(race.stage, 'finished');
  net.advance(2000);
  assert.equal(race.stage, 'ceremony');
  const results = a.saw('results')[0].data.players;
  assert.equal(results[1].dnf, true, 'straggler recorded as DNF');
});

test('invalid transitions are rejected exhaustively', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('finish', { t: 1 }); // finish in the lobby
  assert.equal(race.stage, 'lobby');
  assert.deepEqual(a.saw('finishInfo'), []);
  a.send('start');
  const goAt = a.saw('countdown')[0].data.goAt;
  b.send('start'); // second press while counting down
  net.advance(0);
  assert.equal(a.saw('countdown').length, 1, 'no second countdown');
  assert.equal(a.saw('countdown')[0].data.goAt, goAt);
  net.advance(3000);
  a.send('start'); // while racing
  assert.equal(race.stage, 'racing');
  assert.equal(a.saw('countdown').length, 1);
  // Malformed junk changes nothing and crashes nothing.
  for (const junk of ['{', 'not json', '{"type":"spawn"}', '{"type":"finish","t":"early"}', '{"type":"pos"}']) {
    a.conn.send(junk);
    net.advance(0);
    assert.equal(race.stage, 'racing', `junk ${junk} ignored`);
  }
  // Late joiner once the race runs: turned away with its own code.
  const lateWorld = world();
  const w1 = lateWorld.client().join('W1');
  const w2 = lateWorld.client().join('W2');
  lateWorld.net.advance(0);
  w1.send('start');
  lateWorld.net.advance(3000);
  lateWorld.client();
  lateWorld.net.advance(0);
  assert.deepEqual(lateWorld.rejected, [{ code: CLOSE_STARTED, reason: 'race already started' }]);
});

test('name changes and lobby disconnects update the roster for everyone', () => {
  const { client, net } = world();
  const a = client().join('A');
  const b = client().join('B');
  net.advance(0);
  a.send('name', { name: 'Auerbach' });
  net.advance(0);
  assert.deepEqual(b.saw('roster').at(-1).data.players[0].name, 'Auerbach');
  b.conn.close();
  net.advance(0);
  assert.deepEqual(a.saw('roster').at(-1).data.players.map((p) => p.name), ['Auerbach']);
  assert.ok(a.saw('disconnect').some((m) => m.data.id === b.id));
});

test('ping gets ponged with the echo and the server clock reading', () => {
  const { client, net } = world();
  const a = client().join('A');
  net.advance(0);
  net.now = 5000;
  a.send('ping', { t: 4970 });
  net.advance(0);
  assert.deepEqual(a.saw('pong')[0]?.data, { t: 4970, s: 5000 });
});

test('wire latency: rosters, countdown and go all arrive through the pipe', () => {
  const { race, client, net } = world({ latency: 40 });
  const a = client().join('A');
  const b = client().join('B');
  net.advance(80); // joins take 40, the roster another 40
  assert.ok(a.saw('roster').some((r) => r.data.players.length === 2));
  a.send('start');
  net.advance(3080); // start takes 40, countdown 3000, the wire another 40
  assert.equal(race.stage, 'racing');
  assert.ok(a.saw('go').length === 1 && b.saw('go').length === 1);
  assert.deepEqual(a.saw('go')[0].data, b.saw('go')[0].data, 'same goAt on both wires');
});

// --- Phase 4 server: the jump-start penalty + the 'Nochmal' rematch ---

test('a jump start adds the penalty to the official time and can flip the order', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  net.advance(2000); // still counting down (green is 3000)
  a.send('jump');
  net.advance(0);
  assert.deepEqual(a.saw('jumped')[0]?.data, { id: a.id, pen: JUMP_PENALTY_MS }, 'the announcement carries id and penalty');
  assert.equal(b.saw('jumped').length, 1, 'every window can flag a jump live');
  net.advance(1000); // green
  assert.equal(race.stage, 'racing');
  a.send('finish', { t: 300 }); // A crosses first — but jumped the start
  b.send('finish', { t: 900 });
  net.advance(0);
  assert.equal(race.stage, 'finished');
  const results = a.saw('results')[0].data.players;
  assert.deepEqual(results, [
    { id: b.id, name: 'B', t: 900, dnf: false, pen: 0 },
    { id: a.id, name: 'A', t: 300, dnf: false, pen: JUMP_PENALTY_MS },
  ], 'A pays 3000 on top of its time: the clean finisher leads');
});

test('jump settles once per player and only before the green', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  const ownJumps = (me) => me.saw('jumped').filter((m) => m.data.id === me.id); // everyone hears every penalty
  net.advance(0);
  b.send('jump'); // lobby: nothing there to punish
  net.advance(0);
  assert.deepEqual(b.saw('jumped'), []);
  a.send('start');
  a.send('jump'); // first press pre-green: accepted
  a.send('jump'); // second press: one crime, one penalty
  net.advance(0);
  assert.equal(ownJumps(a).length, 1);
  net.advance(2999); // 1 ms before the green — still pre-green
  b.send('jump');
  a.send('jump'); // A again, later in the countdown: still ignored
  net.advance(0);
  assert.deepEqual(ownJumps(b)[0]?.data, { id: b.id, pen: JUMP_PENALTY_MS });
  assert.equal(ownJumps(a).length, 1);
  net.advance(1); // green
  a.send('jump');
  b.send('jump');
  net.advance(0);
  assert.equal(ownJumps(a).length + ownJumps(b).length, 2, 'no jump settles after the go');
});

test("'again' does nothing until the ceremony is on screen", () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('again'); // lobby
  net.advance(0);
  assert.equal(race.stage, 'lobby');
  a.send('start');
  assert.equal(race.stage, 'countdown');
  b.send('again');
  net.advance(0);
  assert.equal(a.saw('countdown').length, 1, 'no restart while counting down');
  net.advance(3000);
  a.send('again'); // racing
  net.advance(0);
  assert.equal(race.stage, 'racing');
  a.send('finish', { t: 400 });
  b.send('finish', { t: 700 });
  net.advance(0);
  assert.equal(race.stage, 'finished');
  b.send('again'); // the table is out, but the podium is not up yet
  net.advance(0);
  assert.equal(race.stage, 'finished');
  assert.equal(a.saw('countdown').length, 1);
  net.advance(2000);
  assert.equal(race.stage, 'ceremony');
  b.send('again'); // any player may press Nochmal
  net.advance(0);
  assert.equal(race.stage, 'countdown', 'the rematch restarts the shared clock');
  const roster = a.saw('roster').at(-1).data;
  assert.equal(roster.seed, 43, 'the rematch re-rolls to exactly seed + 1');
  assert.deepEqual(roster.players.map((p) => p.name).sort(), ['A', 'B'], 'ids and names survive');
  net.advance(3000);
  assert.equal(race.stage, 'racing');
  a.send('finish', { t: 600 }); // the fresh race accepts reports again
  b.send('finish', { t: 800 });
  net.advance(0);
  assert.equal(race.stage, 'finished', 'settle runs once more');
  const results = a.saw('results').at(-1).data.players;
  assert.deepEqual(results.map((p) => p.name), ['A', 'B']);
});

test('the 30 s force applies to the NEW winner after a rematch', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  net.advance(3000);
  a.send('finish', { t: 500 });
  b.send('finish', { t: 600 });
  net.advance(2000); // ceremony
  b.send('again');
  net.advance(0);
  assert.equal(race.stage, 'countdown');
  net.advance(3000);
  a.send('finish', { t: 300 }); // winner of the restarted race
  net.advance(29999);
  assert.equal(race.stage, 'racing', 'the window counts from the new winner');
  net.advance(1);
  assert.equal(race.stage, 'finished');
});

test('a rematch wipes the penalty: the restarted race starts clean', () => {
  const { race, client, net } = world();
  const [a, b] = [client().join('A'), client().join('B')];
  net.advance(0);
  a.send('start');
  net.advance(2000);
  a.send('jump');
  net.advance(1000);
  a.send('finish', { t: 300 });
  b.send('finish', { t: 900 });
  net.advance(0);
  const race1 = a.saw('results')[0].data.players;
  assert.equal(race1.find((p) => p.id === a.id).pen, JUMP_PENALTY_MS, 'race 1 carried the penalty');
  net.advance(2000); // ceremony
  a.send('again');
  net.advance(3000); // green again
  a.send('finish', { t: 300 }); // same fast driving, no jump this time
  b.send('finish', { t: 900 });
  net.advance(0);
  const race2 = a.saw('results').at(-1).data.players;
  assert.deepEqual(race2, [
    { id: a.id, name: 'A', t: 300, dnf: false, pen: 0 },
    { id: b.id, name: 'B', t: 900, dnf: false, pen: 0 },
  ], 'the penalty did not survive the rematch');
});
