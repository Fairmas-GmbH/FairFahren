import { lookAt, perspective, damp, lerp } from '../core/math.js';

/** Camera rigs relative to the car. Each returns [eye, target, smoothingRate]. */
const RIGS = {
  chase: (x, z, fx, fz) => [[x - fx * 7.5, 3.2, z - fz * 7.5], [x + fx * 3, 1.1, z + fz * 3], 7],
  hood: (x, z, fx, fz) => [[x + fx * 1.1, 1.15, z + fz * 1.1], [x + fx * 10, 1.0, z + fz * 10], Infinity],
  top: (x, z, fx, fz) => [[x - fx * 20, 70, z - fz * 20], [x, 0, z], 4],
};
const MODES = Object.keys(RIGS);

export class Camera {
  constructor() {
    this.mode = 0;
    this.eye = [0, 0, 0];
    this.target = [0, 0, 0];
    this.snapNext = true;
  }

  get modeName() {
    return MODES[this.mode];
  }

  next() {
    this.mode = (this.mode + 1) % MODES.length;
    this.snapNext = true;
  }

  /** Skip smoothing on the next update (after a reset or mode change). */
  snap() {
    this.snapNext = true;
  }

  update(car, dt) {
    const [eye, target, rate] = RIGS[this.modeName](car.x, car.z, Math.sin(car.heading), Math.cos(car.heading));
    const t = this.snapNext ? 1 : damp(rate, dt);
    this.snapNext = false;
    for (let i = 0; i < 3; i++) {
      this.eye[i] = lerp(this.eye[i], eye[i], t);
      this.target[i] = lerp(this.target[i], target[i], t);
    }
  }

  matrices(aspect) {
    const fov = this.modeName === 'hood' ? 1.2 : 1.0;
    return { proj: perspective(fov, aspect, 0.5, 1500), view: lookAt(this.eye, this.target), eye: this.eye };
  }
}
