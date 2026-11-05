// Phase 3: the remote-car interpolation buffer (src/net/remoteCar.js) —
// pure unit coverage plus one end-to-end test fed by fakeNet posRelay frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeNet, FakeServer } from '../server/fakeNet.js';
import { createRaceState } from '../server/raceState.js';
import { encode } from '../server/protocol.js';
import { createNetClient } from '../src/net/client.js';
import { createInterp } from '../src/net/remoteCar.js';

test('sample is null before any snapshot', () => {
  assert.equal(createInterp().sample(1000), null);
});

test('sampling before the first snapshot returns the earliest snapshot', () => {
  const i = createInterp();
  i.push({ t: 500, x: 1, z: 2, h: 0.5, s: 4 });
  assert.deepEqual(i.sample(0), { x: 1, z: 2, h: 0.5, s: 4 });
  assert.deepEqual(i.sample(400), { x: 1, z: 2, h: 0.5, s: 4 }, 'default 100 ms delay still misses t=500');
  assert.deepEqual(i.sample(600), { x: 1, z: 2, h: 0.5, s: 4 }, 'renderT hits t exactly: the snapshot itself');
});

test('position, speed and heading interpolate linearly between snapshots', () => {
  const i = createInterp();
  i.push({ t: 0, x: 0, z: 0, h: 0, s: 0 });
  i.push({ t: 100, x: 10, z: -4, h: 1, s: 2 });
  assert.deepEqual(i.sample(150), { x: 5, z: -2, h: 0.5, s: 1 }, 'halfway between, at default 100 ms delay');
  assert.deepEqual(i.sample(200), { x: 10, z: -4, h: 1, s: 2 }, 'exactly the second snapshot');
});

test('heading follows the shortest arc, normalized to −π..π', () => {
  // 2.8 rad → −3.0 rad wraps through +π (0.483 rad), not backwards via north.
  const wrap = createInterp();
  wrap.push({ t: 0, x: 0, z: 0, h: 2.8, s: 1 });
  wrap.push({ t: 100, x: 0, z: 0, h: -3.0, s: 1 });
  const mid = wrap.sample(150).h;
  assert.ok(Math.abs(mid - 3.041592653589793) < 1e-9, 'midway through the short +π crossing');
  assert.ok(mid > 0, 'not the long way round');
  // Stepping past +π re-emerges on the −π branch.
  const over = createInterp();
  over.push({ t: 0, x: 0, z: 0, h: 3.1, s: 1 });
  over.push({ t: 100, x: 0, z: 0, h: 3.2, s: 1 });
  const h = over.sample(150).h;
  assert.ok(Math.abs(h - (3.15 - 2 * Math.PI)) < 1e-9, 'output normalized: 3.15 rad reads −3.133 rad');
});

test('clamps at the newest snapshot — no extrapolation', () => {
  const i = createInterp();
  i.push({ t: 0, x: 0, z: 0, h: 0, s: 0 });
  i.push({ t: 100, x: 10, z: 0, h: 0, s: 2 });
  assert.deepEqual(i.sample(10 ** 6), { x: 10, z: 0, h: 0, s: 2 }, 'long past the buffer: hold the newest');
  assert.equal(i.sample(200).x, 10, 'exactly at the newest t: settled, not extrapolated');
});

test('out-of-order pushes are ignored — never teleports backwards', () => {
  const i = createInterp();
  i.push({ t: 100, x: 10, z: 0, h: 0, s: 0 });
  i.push({ t: 50, x: 5, z: 0, h: 0, s: 0 }); // too old: ignored
  i.push({ t: 100, x: 7, z: 0, h: 0, s: 0 }); // equals the newest: ignored too
  assert.equal(i.sample(0).x, 10, 'earliest snapshot is still t=100 (the 50 ms one never landed)');
  i.push({ t: 200, x: 20, z: 0, h: 0, s: 1 });
  assert.equal(i.sample(250).x, 15, 'a fresh newest is accepted and interpolates (renderT=150: halfway)');
});

// End-to-end: another player streams at 10 Hz over fakeNet while the winner
// side samples; the stream must read continuous, time-monotonic and clamped.
test('interpolation fed by fakeNet posRelay is continuous, monotonic and clamped', () => {
  const net = new FakeNet();
  const server = new FakeServer(net);
  const race = createRaceState({
    seed: 7,
    now: () => net.now,
    send: (conn, type, data) => conn.send(encode(type, data)),
    close: (conn, code, reason) => conn.close(code, reason),
    schedule: (delayMs, fn) => net.schedule(delayMs, fn),
  });
  server.onConnect = (conn) => {
    race.connect(conn);
    conn.onMessage = (text) => race.onMessage(conn, text);
    conn.onClose = () => race.disconnect(conn);
  };
  const watcherLog = [];
  const mk = (name, peerPos) => {
    const conn = server.connect();
    return createNetClient({
      conn, name, now: () => net.now, every: (ms, fn) => net.schedule(ms, fn),
      on: { peerPos: (st) => peerPos(st) },
    });
  };
  const jumper = mk('B', () => {});
  const watcher = mk('A', (st) => watcherLog.push(st));
  net.advance(0);
  jumper.startRace();
  net.advance(3000); // racing
  for (let k = 0; k <= 5; k++) net.schedule(k * 100, () => jumper.sendPos({ x: 10 * k, z: 0, h: 0, s: k }));
  net.advance(600);
  // The relay hook plays the buffered feed, exactly like the integration wiring.
  const interp = createInterp();
  for (const st of watcherLog) interp.push({ t: st.t, x: st.x, z: st.z, h: st.h, s: st.s });

  let prev = interp.sample(150);
  for (let r = 160; r <= 600; r += 10) {
    const st = interp.sample(r);
    assert.ok(st.x - prev.x >= -1e-9, `position never moves backwards at r=${r}`);
    assert.ok(st.x - prev.x <= 1 + 1e-9, `no jump at r=${r} (10 m per 100 ms stream)`);
    assert.ok(Math.abs(st.s - prev.s) <= 0.1 + 1e-9, `speed just as smooth at r=${r}`);
    prev = st;
  }
  assert.equal(interp.sample(1e6).x, 50, 'clamped: holds the newest snapshot forever');
  let before = interp.sample(100); // before the first snapshot (t=0 at delay 100)
  assert.equal(before.x, 0, 'renders the earliest snapshot before play begins');
});
