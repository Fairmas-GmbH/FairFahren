import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAXI, createCar, stepCar } from '../src/vehicle/carPhysics.js';
import { collideCar, pushOut } from '../src/vehicle/collision.js';

const DT = 1 / 120;
const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const drive = (car, input, seconds) => {
  for (let t = 0; t < seconds; t += DT) stepCar(car, { ...IDLE, ...input }, TAXI, DT);
  return car;
};

test('throttle accelerates forward along the heading', () => {
  const car = drive(createCar({ x: 0, z: 0, heading: 0 }), { throttle: 1 }, 3);
  assert.ok(car.speed > 10, `speed ${car.speed}`);
  assert.ok(car.z > 10 && Math.abs(car.x) < 1e-6, 'heading 0 drives towards +Z');
});

test('top speed is capped', () => {
  const car = drive(createCar({ x: 0, z: 0, heading: 0 }), { throttle: 1 }, 60);
  assert.ok(car.speed <= TAXI.maxSpeed);
});

test('brake stops the car and then reverses', () => {
  const car = drive(createCar({ x: 0, z: 0, heading: 0 }), { throttle: 1 }, 3);
  drive(car, { brake: 1 }, 6);
  assert.ok(car.speed < 0 && car.speed >= -TAXI.maxReverse);
});

test('coasting comes to a full stop', () => {
  const car = drive(createCar({ x: 0, z: 0, heading: 0 }), { throttle: 1 }, 2);
  drive(car, {}, 60);
  assert.equal(car.speed, 0);
});

test('steering left turns left (heading increases)', () => {
  const car = drive(createCar({ x: 0, z: 0, heading: 0 }), { throttle: 1, steer: 1 }, 2);
  assert.ok(car.heading > 0.1);
  assert.ok(car.x > 0, 'facing +Z, left is +X');
});

test('car cannot drive through a wall', () => {
  const wall = [{ type: 'box', x0: -10, z0: 20, x1: 10, z1: 25 }];
  const car = createCar({ x: 0, z: 0, heading: 0 });
  for (let t = 0; t < 10; t += DT) {
    stepCar(car, { ...IDLE, throttle: 1 }, TAXI, DT);
    collideCar(car, wall, TAXI);
  }
  assert.ok(car.z + TAXI.collisionOffset + TAXI.collisionRadius <= 20 + 1e-3, `car at z=${car.z}`);
});

test('head-on impact bounces back and reports impact speed', () => {
  const wall = [{ type: 'box', x0: -10, z0: 3, x1: 10, z1: 5 }];
  const car = createCar({ x: 0, z: 0, heading: 0 });
  car.speed = 10;
  car.z = 3 - TAXI.collisionOffset - TAXI.collisionRadius + 0.1;
  const impact = collideCar(car, wall, TAXI);
  assert.ok(impact > 9);
  assert.ok(car.speed < 0);
});

test('pushOut handles circles and centres inside boxes', () => {
  assert.equal(pushOut(0, 0, 1, [{ type: 'circle', x: 5, z: 0, r: 1 }]), null);
  const c = pushOut(1.5, 0, 1, [{ type: 'circle', x: 0, z: 0, r: 1 }]);
  assert.ok(Math.abs(c.dx - 0.5) < 1e-9 && c.nx === 1);
  const b = pushOut(0.9, 0, 0.5, [{ type: 'box', x0: -1, z0: -1, x1: 1, z1: 1 }]);
  assert.ok(Math.abs(0.9 + b.dx - 1.5) < 1e-9, 'leaves through the nearest side');
});
