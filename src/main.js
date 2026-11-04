/**
 * FairFahren — entry point. Wires world generation, physics, rendering and input.
 *
 *   generateCity(seed) ──► city data ──► buildCityMesh ──► GPU (static)
 *                               │
 *   Keyboard ──► stepCar ──► collideCar(city.colliders) ──► Camera ──► Renderer
 */
import { generateCity, streetAt } from './world/cityGen.js';
import { buildCityMesh } from './world/cityMesh.js';
import { TAXI, createCar, stepCar } from './vehicle/carPhysics.js';
import { collideCar } from './vehicle/collision.js';
import { buildTaxi, wheelOffsets } from './vehicle/taxiModel.js';
import { Renderer } from './gfx/renderer.js';
import { Keyboard } from './game/input.js';
import { Camera } from './game/camera.js';
import { Hud } from './game/hud.js';
import { SensorView } from './game/sensorView.js';
import { createSensorState, senseEnvironment } from './vehicle/sensors.js';
import { compose, translation, rotationX, rotationY } from './core/math.js';

const PHYSICS_STEP = 1 / 120; // fixed timestep keeps physics deterministic
const ENV = {
  sunDir: normalize([0.35, 0.8, 0.5]),
  fogColor: [0.75, 0.79, 0.84], // hazy Berlin sky
  fogDensity: 0.0016,
  time: 0,
};

const seedParam = Number.parseInt(new URLSearchParams(location.search).get('seed') ?? '', 10);
const city = generateCity(Number.isFinite(seedParam) ? { seed: seedParam } : {});

let renderer;
try {
  renderer = new Renderer(document.querySelector('canvas'));
} catch (err) {
  document.querySelector('#error').textContent = err.message;
  throw err;
}

const cityMesh = renderer.upload(buildCityMesh(city));
const taxiParts = buildTaxi(TAXI);
const taxi = { body: renderer.upload(taxiParts.body), wheel: renderer.upload(taxiParts.wheel), shadow: renderer.upload(taxiParts.shadow) };
const wheels = wheelOffsets(TAXI);

const car = createCar(city.spawn);
const keyboard = new Keyboard(window);
const camera = new Camera();
const hud = new Hud(document);
hud.set('seed', `Seed ${city.seed}`);
const sensorState = createSensorState();
const sensorView = new SensorView(document.querySelector('#sensors'));

// Handy for debugging in the browser console and for automated checks.
window.fairfahren = { city, car, camera, TAXI, sensorState };

let last = performance.now(), accumulator = 0, fps = 60;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  ENV.time += dt;

  if (keyboard.consume('KeyR')) {
    Object.assign(car, createCar(city.spawn));
    camera.snap();
  }
  if (keyboard.consume('KeyC')) camera.next();
  if (keyboard.consume('KeyV')) sensorView.toggle();

  const input = keyboard.driving();
  for (accumulator += dt; accumulator >= PHYSICS_STEP; accumulator -= PHYSICS_STEP) {
    stepCar(car, input, TAXI, PHYSICS_STEP);
    collideCar(car, city.colliders, TAXI);
  }
  camera.update(car, dt);

  renderer.beginFrame(camera.matrices(renderer.resize()), ENV);
  renderer.draw(cityMesh);
  const carMatrix = compose(translation(car.x, 0, car.z), rotationY(car.heading));
  renderer.draw(taxi.body, carMatrix);
  for (const w of wheels) {
    const steer = rotationY(w.front ? car.steer : 0);
    renderer.draw(taxi.wheel, compose(carMatrix, translation(w.x, w.y, w.z), steer, rotationX(car.wheelSpin)));
  }
  renderer.draw(taxi.shadow, carMatrix, true);

  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  hud.set('speed', String(Math.round(Math.abs(car.speed) * 3.6)));
  hud.set('street', streetAt(city, car.x, car.z));
  hud.set('fps', `${Math.round(fps)} fps · ${camera.modeName} cam`);
  // Sensors run every frame (they remember the speed limit); drawing only when the panel is shown.
  const sensed = senseEnvironment(car, city, sensorState);
  if (sensorView.visible) sensorView.draw(sensed, car, dt);
  keyboard.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}
