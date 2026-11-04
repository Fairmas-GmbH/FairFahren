/**
 * Remote-car interpolation buffer: push({t, x, z, h, s}) peer snapshots in
 * local receive time, sample(renderNow, delayMs) reads ~100 ms behind the
 * render clock, so uneven arrival times (jitter) never show on screen.
 * PURE and deterministic — no timers, no randomness, no DOM.
 *
 * Never teleports backwards: a snapshot whose t is not newer than the stored
 * newest is ignored. Past the newest snapshot the car simply holds (clamp);
 * the peer's next update catches it back up. Heading glides along the SHORTEST
 * arc between snapshots (track convention: 0 = facing +z, east = +π/2).
 * Counts toward the size budget — kept tight.
 */

const TAU = Math.PI * 2;

// Angle aliases into the −π..π branch.
const norm = (h) => { const a = (h % TAU + TAU) % TAU; return a > Math.PI ? a - TAU : a; };

// Snapshot state minus the bookkeeping field t: exactly what a renderer wants.
const pick = (q) => ({ x: q.x, z: q.z, h: q.h, s: q.s });

/** One interpolation buffer for one remote car. */
export function createInterp() {
  const buf = []; // {t, x, z, h, s}, oldest first, newest last
  return {
    /** Store one peer snapshot in receive order; older/equal t is ignored. */
    push(st) {
      if (buf.length && st.t <= buf[buf.length - 1].t) return;
      buf.push({ t: st.t, x: st.x, z: st.z, h: st.h, s: st.s });
      if (buf.length > 64) buf.shift(); // ~4 s at 15 Hz is plenty of history
    },
    /**
     * Interpolated car state at renderNow − delayMs (linear position/speed,
     * shortest-arc heading), or null before any snapshot. Before the first /
     * past the newest snapshot the earliest/newest state is returned as-is.
     */
    sample(renderNow, delayMs = 100) {
      if (!buf.length) return null;
      const rT = renderNow - delayMs;
      if (rT <= buf[0].t) return pick(buf[0]); // play has not begun: hold the car where it first appeared
      let i = buf.length - 1;
      if (rT >= buf[i].t) return pick(buf[i]); // clamp: no extrapolation past the newest
      for (i = 0; buf[i + 1].t <= rT; i++); // slide to the segment [i, i+1] surrounding rT
      const a = buf[i], b = buf[i + 1];
      const f = (rT - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        h: norm(a.h + norm(b.h - a.h) * f), // shortest arc, back into −π..π
        s: a.s + (b.s - a.s) * f,
      };
    },
  };
}
