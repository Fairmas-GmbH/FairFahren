/** Heads-up display. Writes to the DOM only when a value actually changes. */
export class Hud {
  constructor(root) {
    this.el = Object.fromEntries([...root.querySelectorAll('[data-hud]')].map((e) => [e.dataset.hud, e]));
    this.cache = {};
  }

  set(key, text) {
    if (this.cache[key] === text || !this.el[key]) return;
    this.cache[key] = text;
    this.el[key].textContent = text;
  }
}
