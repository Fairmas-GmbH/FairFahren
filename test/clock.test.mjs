// Phase 2: master-clock maths (src/net/clock.js) — pure, given known rtt/offset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/net/clock.js';

test('offset math for a known rtt and clock difference', () => {
  const clock = createClock(8);
  assert.equal(clock.synced(), false);
  assert.equal(clock.offset(), null);
  assert.equal(clock.serverNow(0), null, 'unsynced → no server time');
  // Server runs 500 ms ahead. Local sends at 0; 50 ms each way, so the server
  // stamps its clock at 550 (real 50 + skew 500) and the reply lands at 100.
  clock.onPong(0, 550, 100);
  assert.equal(clock.synced(), true);
  assert.equal(clock.serverNow(100), 600, 'local 100 ↔ server 600 (skew 500)');
  assert.equal(clock.serverNow(1100), 1600, 'relative reading stays stable');
});

test('min-rtt over N samples beats noisy ones', () => {
  const clock = createClock(8);
  // Same server (skew +500), but the request leg queues extra milliseconds Q
  // (asymmetric wire): the pong is stamped late, so estimate error = Q / 2.
  // Send at local 100, base legs 10 ms each: server stamps 610 + Q, arrives at 120 + Q.
  const pong = (q) => clock.onPong(100, 610 + q, 120 + q);
  pong(500); // heavy queueing: estimate 750, badly off
  pong(400);
  pong(300);
  pong(0); // clean round trip: exact
  assert.equal(clock.serverNow(0), 500, 'min-rtt sample wins: exact skew');
});

test('re-sync replaces a stale estimate once better samples arrive', () => {
  const clock = createClock(4);
  // Old world: server 500 ahead, wire symmetric but dragging 100 ms total.
  for (let i = 0; i < 4; i++) clock.onPong(0, 550, 100);
  assert.equal(clock.serverNow(0), 500, 'initial (delayed) estimate');
  // Server drifts to 750 ahead; the wire improves to 20 ms total.
  for (let i = 0; i < 4; i++) clock.onPong(0, 760, 20);
  assert.equal(clock.serverNow(0), 750, 'new samples pushed the old estimate out of the window');
});
