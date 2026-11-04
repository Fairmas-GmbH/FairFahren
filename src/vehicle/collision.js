/**
 * 2D collision on the ground plane (x, z). PURE: no DOM, no WebGL.
 *
 * Colliders: { type: 'box', x0, z0, x1, z1 } or { type: 'circle', x, z, r }.
 * The car is approximated by two circles (front and rear axle).
 * Broad phase is a plain loop — fine for the ~75 colliders of the default city.
 */

/**
 * Pushes a circle out of all colliders it overlaps.
 * Returns null when there is no contact, else { dx, dz, nx, nz } (total push and contact normal).
 */
export function pushOut(x, z, r, colliders) {
  const ox = x, oz = z;
  let nx = 0, nz = 0, hit = false;
  for (const c of colliders) {
    let px, pz, depth;
    if (c.type === 'box') {
      if (x < c.x0 - r || x > c.x1 + r || z < c.z0 - r || z > c.z1 + r) continue;
      const qx = Math.min(Math.max(x, c.x0), c.x1), qz = Math.min(Math.max(z, c.z0), c.z1);
      const dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-6) {
        [px, pz, depth] = [dx / d, dz / d, r - d];
      } else {
        // Centre is inside the box: leave through the nearest side.
        const sides = [[x - c.x0, -1, 0], [c.x1 - x, 1, 0], [z - c.z0, 0, -1], [c.z1 - z, 0, 1]];
        const [pen, sx, sz] = sides.reduce((a, b) => (b[0] < a[0] ? b : a));
        [px, pz, depth] = [sx, sz, pen + r];
      }
    } else {
      const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz);
      if (d >= r + c.r) continue;
      [px, pz, depth] = d > 1e-6 ? [dx / d, dz / d, r + c.r - d] : [1, 0, r + c.r];
    }
    x += px * depth;
    z += pz * depth;
    nx += px;
    nz += pz;
    hit = true;
  }
  if (!hit) return null;
  const n = Math.hypot(nx, nz) || 1;
  return { dx: x - ox, dz: z - oz, nx: nx / n, nz: nz / n };
}

/**
 * Resolves collisions between the car and the world. Moves the car out of
 * obstacles and reflects the velocity component into the obstacle.
 * Returns the impact speed in m/s (0 = no hit) — handy for damage or sound.
 */
export function collideCar(car, colliders, spec) {
  let impact = 0;
  for (const side of [1, -1]) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const off = side * spec.collisionOffset;
    const res = pushOut(car.x + fx * off, car.z + fz * off, spec.collisionRadius, colliders);
    if (!res) continue;
    car.x += res.dx;
    car.z += res.dz;
    const vx = fx * car.speed, vz = fz * car.speed;
    const vn = vx * res.nx + vz * res.nz;
    if (vn < 0) {
      impact = Math.max(impact, -vn);
      const k = (1 + spec.restitution) * vn;
      car.speed = (vx - k * res.nx) * fx + (vz - k * res.nz) * fz;
    }
  }
  return impact;
}
