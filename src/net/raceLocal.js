/**
 * Phase 4 client-local race maths: ampel light phases, the frozen-car start
 * gate, ms-precise finish crossing and podium placement. PURE: no DOM, no
 * timers, no RNG — time is injected (local ms), physics only borrowed.
 * Counts toward the size budget — kept tight.
 */
import { stepCar } from '../vehicle/carPhysics.js';

/** How long before goAt the ampel shows red+amber (German sequence). */
export const AMBER_BEFORE_MS = 1000;

/**
 * ampelState(serverNow, goAt) → 'red' | 'red+amber' | 'green'.
 * German sequence: solid red until the last AMBER_BEFORE_MS before the shared
 * goAt, then red+amber, then green the instant serverNow reaches goAt.
 */
export function ampelState(serverNow, goAt) {
  if (serverNow >= goAt) return 'green';
  if (serverNow >= goAt - AMBER_BEFORE_MS) return 'red+amber';
  return 'red';
}

/**
 * createStartGate({ isGreen, onJump }) → { step(car, input, spec, dt) }.
 * A pure wrapper around stepCar, not an input hack: pre-green the car is
 * physics-frozen — stepCar is never called and car is not touched. Pressing
 * throttle while frozen fires onJump() EXACTLY once for the whole gate
 * lifetime (jump-start hook; the server settles the penalty). Once green,
 * every step goes straight through physics.
 */
export function createStartGate({ isGreen, onJump }) {
  let jumped = false;
  return {
    step(car, input, spec, dt) {
      if (isGreen()) return stepCar(car, input, spec, dt);
      if (!jumped && input.throttle > 0) {
        jumped = true;
        onJump();
      }
      return car;
    },
  };
}

/**
 * crossingTime(prev, cur, finishX) → interpolated local ms at which the car's
 * centre crossed finish.x moving EAST, else null (before the line, past it,
 * west, or static on the line). prev/cur = { x, t } of consecutive physics
 * steps; precision is exactly the linear interpolation of the two samples —
 * no finer. Caller converts to server time T with the clock offset.
 */
export function crossingTime(prev, cur, finishX) {
  if (!(prev.x < finishX && cur.x >= finishX)) return null;
  const f = (finishX - prev.x) / (cur.x - prev.x); // cur.x > prev.x is implied
  return prev.t + f * (cur.t - prev.t);
}

/**
 * podiumLayout(results, base, road) → { steps, cars } — decided, documented,
 * deterministic ground plan (the renderer lifts taxi models by step.h itself):
 *
 * - minZ = min(laneMinZ, laneMaxZ) is the NORTH edge of the racing lane;
 *   north = −z, east = +x, racing direction = heading Math.PI / 2.
 * - Three steps (ALWAYS three, even with fewer racers) in a row NORTH of that
 *   edge — behind the line, clear of the racing lane, no track danger: one
 *   column x = base.x + 6, place 1 nearest the lane at z = minZ − 2, then 2
 *   and 3 a further 2.4 m north. Boxes 2.2 × 2.2 m, heights 0.4/0.3/0.2 —
 *   place 1 highest.
 * - Cars: each of the top-3 finishers sits on its own step (x, step z), facing
 *   the camera as the taxis on the grid do (heading EAST). Everyone else
 *   (DNFs, or a 4th finisher beyond the podium) parks further north at
 *   x = base.x + 6, z = place-3 step − 2.2 × (i + 1), in results order, each
 *   keeping its own dnf flag, place null.
 * - `results` is the settled server order (finishers first): podium place =
 *   index within the non-DNF finishers; extra fields (pen) are ignored.
 */
export function podiumLayout(results, base, road) {
  const minZ = Math.min(road.laneMinZ, road.laneMaxZ);
  const x = base.x + 6;
  const OFF = [2, 4.4, 6.8]; // north of the lane edge, per place
  const H = [0.4, 0.3, 0.2]; // step height, per place
  const EAST = Math.PI / 2;
  const steps = [1, 2, 3].map((p) => ({
    place: p, x, z: minZ - OFF[p - 1], w: 2.2, d: 2.2, h: H[p - 1],
  }));
  const cars = [];
  const podium = results.filter((r) => !r.dnf).slice(0, 3);
  for (const r of podium) {
    const p = podium.indexOf(r) + 1;
    cars.push({ id: r.id, name: r.name, x, z: steps[p - 1].z, heading: EAST, place: p, dnf: false });
  }
  const extra = results.filter((r) => r.dnf || !podium.includes(r));
  extra.forEach((r, i) => cars.push({
    id: r.id, name: r.name, x, z: steps[2].z - 2.2 * (i + 1), heading: EAST, place: null, dnf: !!r.dnf,
  }));
  return { steps, cars };
}
