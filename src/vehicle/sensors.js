/**
 * Simulated driver-assistance sensors: 360° lidar, ultrasonic park sensors,
 * forward radar, and camera-based lane and traffic-sign recognition.
 * PURE: no DOM, no WebGL — runs in Node for tests.
 *
 * Results are in the car's local frame: [lx, lz] = metres to the right, metres ahead.
 */
import { DASH } from '../world/cityGen.js';

const DEG = Math.PI / 180;

export const SENSOR_SPEC = {
  range: 60, // world features beyond this radius are ignored
  lidarRays: 90,
  ultrasonicRange: 4.5,
  radarRange: 80,
  signRange: 45,
  signFov: 0.7, // camera half-angle as |lx| / lz (≈ 35°)
  adoptLimitAt: 30, // a recognised speed-limit sign closer than this becomes the active limit
};

/** Park sensors: mount point (x right, z ahead) and beam angle a (0 = ahead, + = right). */
export const ULTRASONIC = [
  ...[-0.7, -0.25, 0.25, 0.7].map((x, i) => ({ x, z: 2.5, a: (-30 + i * 20) * DEG })),
  ...[-0.7, -0.25, 0.25, 0.7].map((x, i) => ({ x, z: -2.5, a: Math.PI + (30 - i * 20) * DEG })),
  ...[1.2, -1.2].flatMap((z) => [{ x: 0.95, z, a: 90 * DEG }, { x: -0.95, z, a: -90 * DEG }]),
];

/** Distance along the unit ray (dx, dz) to the first collider, or Infinity beyond max. */
export function raycast(ox, oz, dx, dz, max, colliders) {
  let best = max;
  for (const c of colliders) {
    let t;
    if (c.type === 'box') {
      let t0 = 0, t1 = best;
      for (const [o, d, lo, hi] of [[ox, dx, c.x0, c.x1], [oz, dz, c.z0, c.z1]]) {
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) t0 = Infinity;
          continue;
        }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 <= t1) t = t0;
    } else {
      const fx = ox - c.x, fz = oz - c.z, b = fx * dx + fz * dz, k = fx * fx + fz * fz - c.r * c.r, disc = b * b - k;
      if (disc >= 0) t = k < 0 ? 0 : -b - Math.sqrt(disc);
    }
    if (t >= 0 && t < best) best = t;
  }
  return best < max ? best : Infinity;
}

/** Memory between frames (the active speed limit persists after the sign is passed). */
export function createSensorState() {
  return { speedLimit: null };
}

export function senseEnvironment(car, city, state, spec = SENSOR_SPEC) {
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = -fz, rz = fx;
  const R = spec.range, R2 = R * R;
  const local = (x, z) => [(x - car.x) * rx + (z - car.z) * rz, (x - car.x) * fx + (z - car.z) * fz];
  const near = city.colliders.filter((c) => (c.type === 'box'
    ? Math.max(c.x0 - car.x, 0, car.x - c.x1) ** 2 + Math.max(c.z0 - car.z, 0, car.z - c.z1) ** 2 < R2
    : (c.x - car.x) ** 2 + (c.z - car.z) ** 2 < (R + c.r) ** 2));
  // Ray from a mount point (lx, lz) on the car, beam angle a in the car frame.
  const ray = (lx, lz, a, max) => raycast(
    car.x + rx * lx + fx * lz, car.z + rz * lx + fz * lz,
    rx * Math.sin(a) + fx * Math.cos(a), rz * Math.sin(a) + fz * Math.cos(a), max, near,
  );

  const lidar = [];
  for (let i = 0; i < spec.lidarRays; i++) {
    const a = (i / spec.lidarRays) * Math.PI * 2, d = ray(0, 0, a, R);
    if (d < R) lidar.push([Math.sin(a) * d, Math.cos(a) * d]);
  }

  const ultrasonic = ULTRASONIC.map((s) => {
    const d = ray(s.x, s.z, s.a, spec.ultrasonicRange);
    return { ...s, d, hit: [s.x + Math.sin(s.a) * d, s.z + Math.cos(s.a) * d] };
  });

  // Radar: three parallel beams across the car's width, from the front bumper.
  const frontD = Math.min(...[-0.8, 0, 0.8].map((x) => ray(x, 2.5, 0, spec.radarRange)));
  const front = { d: frontD, ttc: car.speed > 0.5 ? frontD / car.speed : Infinity };

  const edges = near.filter((c) => c.type === 'box').map((c) => ({
    tag: c.tag,
    pts: [[c.x0, c.z0], [c.x1, c.z0], [c.x1, c.z1], [c.x0, c.z1]].map(([x, z]) => local(x, z)),
  }));

  const markings = [];
  for (const m of city.markings) {
    if (car.x < Math.min(m.x0, m.x1) - R || car.x > Math.max(m.x0, m.x1) + R) continue;
    if (car.z < Math.min(m.z0, m.z1) - R || car.z > Math.max(m.z0, m.z1) + R) continue;
    const len = Math.hypot(m.x1 - m.x0, m.z1 - m.z0), dx = (m.x1 - m.x0) / len, dz = (m.z1 - m.z0) / len;
    for (let t = 0; t + DASH.length <= len; t += DASH.period) {
      const x = m.x0 + dx * t, z = m.z0 + dz * t;
      if ((x - car.x) ** 2 + (z - car.z) ** 2 < R2) markings.push([local(x, z), local(x + dx * DASH.length, z + dz * DASH.length)]);
    }
  }

  const objects = city.trees.filter((t) => (t.x - car.x) ** 2 + (t.z - car.z) ** 2 < R2).map((t) => local(t.x, t.z));

  const signs = [];
  for (const s of city.signs) {
    const [lx, lz] = local(s.x, s.z), d = Math.hypot(lx, lz);
    if (d > spec.signRange || lz < 1 || Math.abs(lx) > lz * spec.signFov) continue; // outside the camera view
    if (s.nx * fx + s.nz * fz > -0.7) continue; // facing other traffic
    signs.push({ type: s.type, value: s.value, lx, lz, d });
    if (s.type === 'limit' && d < spec.adoptLimitAt) state.speedLimit = s.value;
  }
  signs.sort((a, b) => a.d - b.d);

  return { lidar, ultrasonic, front, edges, markings, objects, signs, speedLimit: state.speedLimit };
}
