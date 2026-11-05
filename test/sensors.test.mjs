import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raycast, senseEnvironment, createSensorState } from '../src/vehicle/sensors.js';
import { createCar } from '../src/vehicle/carPhysics.js';
import { generateCity } from '../src/world/cityGen.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('raycast hits boxes and circles at the right distance', () => {
  const box = [{ type: 'box', x0: -1, z0: 10, x1: 1, z1: 12 }];
  assert.ok(near(raycast(0, 0, 0, 1, 50, box), 10));
  assert.equal(raycast(0, 0, 1, 0, 50, box), Infinity, 'ray to the side misses');
  assert.equal(raycast(0, 0, 0, 1, 5, box), Infinity, 'beyond range');
  assert.equal(raycast(0, 20, 0, 1, 50, box), Infinity, 'box behind the ray');
  assert.ok(near(raycast(0, 0, 0, 1, 50, [{ type: 'circle', x: 0, z: 8, r: 2 }]), 6));
});

// A tiny hand-made world: car at the origin facing +Z (heading 0), right-hand side is -X.
const world = (extra = {}) => ({ colliders: [], markings: [], trees: [], signs: [], ...extra });

test('radar measures the obstacle ahead and computes time to collision', () => {
  const car = createCar({ x: 0, z: 0, heading: 0 });
  car.speed = 10;
  const v = senseEnvironment(car, world({ colliders: [{ type: 'box', x0: -5, z0: 22.5, x1: 5, z1: 30, tag: 'block' }] }), createSensorState());
  assert.ok(near(v.front.d, 20), `front ${v.front.d}`);
  assert.ok(near(v.front.ttc, 2));
});

test('park sensors see a wall close behind the car only with the rear sensors', () => {
  const car = createCar({ x: 0, z: 0, heading: 0 });
  const v = senseEnvironment(car, world({ colliders: [{ type: 'box', x0: -5, z0: -5, x1: 5, z1: -3.5, tag: 'block' }] }), createSensorState());
  const rear = v.ultrasonic.filter((u) => u.z < 0 && Math.abs(u.a) > Math.PI / 2 && Number.isFinite(u.d));
  const front = v.ultrasonic.filter((u) => u.z > 2 && Number.isFinite(u.d));
  assert.ok(rear.length >= 2 && rear.every((u) => u.d < 2), 'rear sensors report the wall');
  assert.equal(front.length, 0, 'front sensors see nothing');
});

test('only signs ahead, in view and facing the car are recognised', () => {
  const sign = (x, z, nz, value) => ({ type: 'limit', value, x, z, nx: 0, nz });
  const signs = [
    sign(-4, 20, -1, 30), // ahead, facing us -> recognised and adopted
    sign(-4, 40, 1, 50), // ahead, but faces away
    sign(-4, -10, -1, 50), // behind us
    sign(-40, 10, -1, 50), // far outside the camera cone
  ];
  const state = createSensorState();
  const v = senseEnvironment(createCar({ x: 0, z: 0, heading: 0 }), world({ signs }), state);
  assert.deepEqual(v.signs.map((s) => s.value), [30]);
  assert.equal(v.speedLimit, 30);
  // The limit stays active after the sign is out of view.
  assert.equal(senseEnvironment(createCar({ x: 0, z: 100, heading: 0 }), world({ signs }), state).speedLimit, 30);
});

test('sensor output is in the car frame: x to the right, z ahead', () => {
  // Facing east (+X): the right-hand side is +Z (south).
  const car = createCar({ x: 0, z: 0, heading: Math.PI / 2 });
  const v = senseEnvironment(car, world({ trees: [{ x: 10, y: 0, z: 3, s: 1 }] }), createSensorState());
  assert.ok(near(v.objects[0][0], 3) && near(v.objects[0][1], 10));
});

test('in the generated city the taxi sees lanes, edges and lidar returns at spawn', () => {
  const city = generateCity({ seed: 1989 });
  const v = senseEnvironment(createCar(city.spawn), city, createSensorState());
  assert.ok(v.markings.length > 10 && v.edges.length > 3 && v.lidar.length > 20);
});
