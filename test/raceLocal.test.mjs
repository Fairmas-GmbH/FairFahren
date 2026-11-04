// Phase 4: client-local race maths (src/net/raceLocal.js) — ampel phases off
// the shared clock, the frozen-car start gate (jump-start hook), ms-precise
// finish-line crossing, podium geometry. All pure: no DOM, no timers, no RNG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAXI, createCar, stepCar } from '../src/vehicle/carPhysics.js';
import {
  AMBER_BEFORE_MS,
  ampelState,
  createStartGate,
  crossingTime,
  podiumLayout,
} from '../src/net/raceLocal.js';

// --- Ampel: red → red+amber (1 s) → green, at the exact server boundaries ---

test('ampel goes red, red+amber at −1000 ms, green exactly at goAt', () => {
  assert.equal(AMBER_BEFORE_MS, 1000);
  const goAt = 60000;
  assert.equal(ampelState(goAt - 1001, goAt), 'red', 'before the amber window');
  assert.equal(ampelState(goAt - 1000, goAt), 'red+amber', 'amber window starts exactly 1000 ms early');
  assert.equal(ampelState(goAt - 1, goAt), 'red+amber');
  assert.equal(ampelState(goAt, goAt), 'green', 'green exactly at goAt, not one ms later');
  assert.equal(ampelState(goAt + 5000, goAt), 'green');
});

// --- Start gate: frozen pre-green, onJump exactly once, full physics green ---

test('gate freezes the car completely pre-green and fires onJump exactly once', () => {
  let green = false;
  let jumps = 0;
  const gate = createStartGate({ isGreen: () => green, onJump: () => { jumps++; } });
  const car = createCar({ x: 10, z: 20, heading: Math.PI / 2 });
  const before = { ...car };
  const press = { throttle: 1, brake: 0, steer: 0, handbrake: false };
  const release = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  // Press, release, press again — physics may not move a single field.
  for (let i = 0; i < 30; i++) {
    gate.step(car, i % 2 ? release : press, TAXI, 1 / 60);
    assert.deepEqual(car, before, 'pre-green: the car state object is untouched');
  }
  assert.equal(jumps, 1, 'many presses over many ticks, exactly one jump-start report');
});

test('green gate steps exactly like stepCar and never re-fires onJump', () => {
  const press = { throttle: 1, brake: 0, steer: 0.5, handbrake: false };
  const gate = createStartGate({ isGreen: () => true, onJump: () => assert.fail('onJump fired after green') });
  const a = createCar({ x: 10, z: 20, heading: Math.PI / 2 });
  const b = createCar({ x: 10, z: 20, heading: Math.PI / 2 });
  for (let i = 0; i < 120; i++) {
    gate.step(a, press, TAXI, 1 / 60);
    stepCar(b, press, TAXI, 1 / 60);
  }
  assert.deepEqual(a, b, 'identical input history → identical car state');
  assert.ok(a.x > 10, 'the car actually moved');
});

test('gate: after a jump, once green resumes, onJump never fires again', () => {
  let green = false;
  let jumps = 0;
  const gate = createStartGate({ isGreen: () => green, onJump: () => { jumps++; } });
  const press = { throttle: 1, brake: 0, steer: 0, handbrake: false };
  const car = createCar({ x: 0, z: 0, heading: Math.PI / 2 });
  for (let i = 0; i < 5; i++) gate.step(car, press, TAXI, 1 / 60); // jump-start
  green = true;
  for (let i = 0; i < 30; i++) gate.step(car, press, TAXI, 1 / 60); // full throttle away
  assert.equal(jumps, 1, 'the green phase steps naturally, no second report');
  assert.ok(car.x > 0, 'stepping resumed through the gate');
});

// --- Finish line: crossing at ms precision, null in every other case ---

test('crossingTime interpolates the exact local ms of the eastward crossing', () => {
  // 1 m per 100 ms, crossing the line half-way through the step.
  const t = crossingTime({ x: 99.5, t: 500 }, { x: 100.5, t: 600 }, 100);
  assert.equal(t, 550);
});

test('crossingTime returns null in every other case', () => {
  const fx = 100;
  assert.equal(crossingTime({ x: 50, t: 0 }, { x: 99.9, t: 100 }, fx), null, 'not yet at the line');
  assert.equal(crossingTime({ x: 100.1, t: 0 }, { x: 110, t: 100 }, fx), null, 'already past the line');
  assert.equal(crossingTime({ x: 110, t: 0 }, { x: 99.9, t: 100 }, fx), null, 'driving west is not a finish');
  assert.equal(crossingTime({ x: 100, t: 0 }, { x: 100, t: 50 }, fx), null, 'static car sitting on the line');
  assert.equal(crossingTime({ x: 100, t: 0 }, { x: 101, t: 50 }, fx), null, 'prev already on the line');
});

test('crossingTime: a straight eastward drive crosses exactly once', () => {
  const fx = 100;
  const found = [];
  for (let i = 0; i < 60; i++) {
    const prev = { x: 50 + i * 2, t: i * 100 };
    const cur = { x: 50 + (i + 1) * 2, t: (i + 1) * 100 };
    const t = crossingTime(prev, cur, fx);
    if (t !== null) found.push(t);
  }
  assert.deepEqual(found, [2500]);
});

// --- Podium: deterministic placement for places 1..3 and every DNF ---

test('podium: winner highest and nearest the lane, DNFs parked in a row south', () => {
  // Like the real track: z0 (laneMinZ) north of z1, the racing lane between.
  const road = { laneMinZ: 10, laneMaxZ: 20, roadCenterZ: 25 };
  const base = { x: 1200, z: 15 };
  const { steps, cars } = podiumLayout([
    { id: 2, name: 'Bob', t: 12050, dnf: false, pen: 0 },
    { id: 1, name: 'Alice', t: 12100, dnf: false, pen: 2000 },
    { id: 3, name: 'Carol', t: 13900, dnf: false },
    { id: 4, name: 'Dan', t: null, dnf: true },
  ], base, road);
  assert.deepEqual(steps, [
    { place: 1, x: 1206, z: 8, w: 2.2, d: 2.2, h: 0.4 },
    { place: 2, x: 1206, z: 5.6, w: 2.2, d: 2.2, h: 0.3 },
    { place: 3, x: 1206, z: 3.2, w: 2.2, d: 2.2, h: 0.2 },
  ]);
  for (const s of steps) assert.ok(s.z < road.laneMinZ, 'steps never block the racing lane');
  assert.deepEqual(cars, [
    { id: 2, name: 'Bob', x: 1206, z: 8, heading: Math.PI / 2, place: 1, dnf: false },
    { id: 1, name: 'Alice', x: 1206, z: 5.6, heading: Math.PI / 2, place: 2, dnf: false },
    { id: 3, name: 'Carol', x: 1206, z: 3.2, heading: Math.PI / 2, place: 3, dnf: false },
    { id: 4, name: 'Dan', x: 1206, z: 1, heading: Math.PI / 2, place: null, dnf: true },
  ]);
});

test('podium: fewer racers still give three steps, cars only for finishers', () => {
  // laneMinZ/laneMaxZ swapped in the input: the NORTH edge is still min(z0, z1).
  const { steps, cars } = podiumLayout([
    { id: 7, name: 'A', t: 1000, dnf: false },
    { id: 8, name: 'B', t: 2000, dnf: false },
  ], { x: 0, z: 0 }, { laneMinZ: -1, laneMaxZ: -5, roadCenterZ: -3 });
  assert.equal(steps.length, 3, 'the podium always stands with three steps');
  assert.deepEqual(steps.map((s) => s.z), [-7, -9.4, -11.8], 'place 1 sits nearest the lane edge (min of the two)');
  assert.deepEqual(cars, [
    { id: 7, name: 'A', x: 6, z: -7, heading: Math.PI / 2, place: 1, dnf: false },
    { id: 8, name: 'B', x: 6, z: -9.4, heading: Math.PI / 2, place: 2, dnf: false },
  ]);
  assert.deepEqual(steps.map((s) => s.h), [0.4, 0.3, 0.2], 'place 1 is the highest step');
});
