/**
 * Arcade car physics using a kinematic bicycle model.
 * PURE: no DOM, no WebGL — runs in Node for tests.
 *
 * Car state: position (x, z), heading (rad, 0 = facing +Z / south), speed (m/s,
 * negative when reversing), steer (front wheel angle in rad, + = left).
 */
import { approach } from '../core/math.js';

/** Tuning for a typical German taxi (mid-size saloon). */
export const TAXI = {
  wheelBase: 2.9, // m between axles
  trackWidth: 1.64, // m between left and right wheels
  wheelRadius: 0.34,
  maxSteer: 0.6, // rad at standstill
  steerRate: 2.5, // rad/s the steering wheel can turn
  maxLateralAccel: 14, // m/s² — arcade grip (a real saloon manages ~9)
  engineAccel: 6.5, // m/s² at standstill, fades out towards maxSpeed
  brakeDecel: 14,
  reverseAccel: 4,
  maxSpeed: 36, // m/s ≈ 130 km/h
  maxReverse: 8,
  rollingResistance: 0.4, // m/s²
  airDrag: 0.0022, // m/s² per (m/s)²
  handbrakeDecel: 9,
  collisionRadius: 0.95, // the body is approximated by two circles
  collisionOffset: 1.45, // their distance from the centre along the car axis
  restitution: 0.25, // bounce on impact
};

export function createCar({ x, z, heading }) {
  return { x, z, heading, speed: 0, steer: 0, wheelSpin: 0 };
}

/**
 * Advances the car by dt seconds.
 * input = { throttle: 0..1, brake: 0..1, steer: -1..1 (+ = left), handbrake: bool }
 */
export function stepCar(car, input, spec, dt) {
  // Grip-limited steering: never ask the tyres for more than maxLateralAccel (v²/L·tan δ ≤ a).
  const steerLimit = Math.min(spec.maxSteer, Math.atan((spec.maxLateralAccel * spec.wheelBase) / (car.speed * car.speed + 1e-6)));
  car.steer = approach(car.steer, input.steer * steerLimit, spec.steerRate * dt);

  // Throttle accelerates forward (or brakes while rolling backwards), brake does the opposite.
  const v = car.speed;
  let accel = 0;
  if (input.throttle) accel += v < -0.5 ? spec.brakeDecel : input.throttle * spec.engineAccel * (1 - Math.max(v, 0) / spec.maxSpeed);
  if (input.brake) accel -= v > 0.5 ? spec.brakeDecel : input.brake * spec.reverseAccel * (1 + Math.min(v, 0) / spec.maxReverse);
  car.speed += accel * dt;

  // Resistances oppose motion but never reverse it on their own.
  let drag = spec.rollingResistance + spec.airDrag * car.speed * car.speed;
  if (input.handbrake) drag += spec.handbrakeDecel;
  car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), drag * dt);

  // Bicycle model: yaw rate follows from speed, wheel base and steering angle.
  const yawRate = (car.speed / spec.wheelBase) * Math.tan(car.steer) * (input.handbrake ? 1.4 : 1);
  car.heading += yawRate * dt;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  car.wheelSpin = (car.wheelSpin + (car.speed / spec.wheelRadius) * dt) % (Math.PI * 2);
  return car;
}
