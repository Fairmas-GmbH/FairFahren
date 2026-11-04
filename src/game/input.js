/**
 * Keyboard input. Uses KeyboardEvent.code (physical keys), so WASD works on
 * QWERTY and QWERTZ layouts alike.
 */
const CAPTURED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Keyboard {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    target.addEventListener('keydown', (e) => {
      if (CAPTURED.has(e.code)) e.preventDefault(); // no page scrolling while driving
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  any(...codes) {
    return codes.some((c) => this.down.has(c));
  }

  /** True exactly once per key press (edge-triggered). */
  consume(code) {
    return this.pressed.delete(code);
  }

  /** Call at the end of every frame so unconsumed presses do not pile up. */
  endFrame() {
    this.pressed.clear();
  }

  /** Maps keys to the input shape expected by stepCar(). */
  driving() {
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.any('KeyA', 'ArrowLeft') ? 1 : 0) - (this.any('KeyD', 'ArrowRight') ? 1 : 0),
      handbrake: this.any('Space'),
    };
  }
}
