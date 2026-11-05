/**
 * Builds triangle meshes on the CPU from primitive shapes.
 *
 * Every vertex carries: position(3) normal(3) color(3) material(1).
 * The material id tells the fragment shader which procedural pattern to paint
 * (windows, water, asphalt ...), so no textures are needed.
 *
 * Shapes are flat-shaded (one normal per face) for a clean low-poly look.
 * Faces are oriented automatically: pass a point that lies inside the solid
 * and the face will point away from it (correct normal + CCW winding).
 */

export const FLOATS_PER_VERTEX = 10;

export const MAT = {
  PLAIN: 0,
  ALTBAU: 1, // pre-war facade: tall windows, shop fronts on the ground floor
  PLATTE: 2, // prefab panel building: panel joints, dense window grid
  WATER: 3,
  ASPHALT: 4,
  PAINT: 5, // glossy (car paint, glass, metal)
  SHADOW: 6, // soft blob shadow, color.xy carries the uv
  GLOW: 7, // unlit lights (UFOs, planes, flashes)
  LEAF: 8, // sways in the wind (vertex shader)
};

/** 0xRRGGBB -> [r, g, b] in 0..1 */
export const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** Local→world mapper at (ox, oy, oz) turned by h, like rotationY: local +Z → (sin h, 0, cos h), +X → (cos h, 0, −sin h). */
export const frame = (ox, oy, oz, h) => {
  const c = Math.cos(h), s = Math.sin(h);
  return (x, y, z) => [ox + x * c + z * s, oy + y, oz - x * s + z * c];
};
const BOX_FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 4, 7, 3], [1, 5, 6, 2], [3, 2, 6, 7], [0, 1, 5, 4]];

export class MeshBuilder {
  constructor() {
    this.vertices = [];
    this.indices = [];
  }

  get vertexCount() {
    return this.vertices.length / FLOATS_PER_VERTEX;
  }

  /** Convex planar polygon. `inside` is a point the normal should point away from. */
  poly(pts, color, mat = MAT.PLAIN, inside = null) {
    // Newell's method: robust normal for any planar polygon.
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return; // degenerate
    nx /= len; ny /= len; nz /= len;
    if (inside) {
      const n = pts.length;
      const dot = nx * (cx / n - inside[0]) + ny * (cy / n - inside[1]) + nz * (cz / n - inside[2]);
      if (dot < 0) {
        pts = pts.slice().reverse();
        nx = -nx; ny = -ny; nz = -nz;
      }
    }
    const base = this.vertexCount;
    for (const p of pts) this.vertices.push(p[0], p[1], p[2], nx, ny, nz, color[0], color[1], color[2], mat);
    for (let i = 1; i < pts.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
  }

  /** Horizontal rectangle facing up. */
  rect(x0, z0, x1, z1, y, color, mat = MAT.PLAIN) {
    this.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], color, mat, [x0, y - 1, z0]);
  }

  /** Axis-aligned box. opts: { mat, top (color), topMat, bottom (bool) } */
  box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
    const mat = opts.mat ?? MAT.PLAIN;
    const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], color, mat, c);
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, mat, c);
    this.poly([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color, mat, c);
    this.poly([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], color, mat, c);
    this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], opts.top ?? color, opts.topMat ?? mat, c);
    if (opts.bottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], color, mat, c);
  }

  /** Box given in a local frame T (see frame()), so it can be turned to any heading. */
  obox(T, x0, y0, z0, x1, y1, z1, color, mat = MAT.PLAIN) {
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map((p) => T(...p));
    const inside = T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    for (const f of BOX_FACES) this.poly(f.map((i) => P[i]), color, mat, inside);
  }

  /** Convex 2D outline [[u, v], …] given thickness from w0 to w1, in local frame T (u → x, v → y, w → z). */
  slab(T, pts, w0, w1, color, mat = MAT.PLAIN) {
    const n = pts.length, at = (w) => pts.map(([u, v]) => T(u, v, w)), a = at(w0), b = at(w1);
    const inside = T(pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n, (w0 + w1) / 2);
    this.poly(a, color, mat, inside);
    this.poly(b, color, mat, inside);
    for (let i = 0; i < n; i++) this.poly([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]], color, mat, inside);
  }

  /** Vertical cone stump around (cx, cz). r1 === r0 gives a cylinder, r1 === 0 a cone. */
  frustum(cx, y0, cz, r0, y1, r1, segs, color, mat = MAT.PLAIN) {
    const inside = [cx, (y0 + y1) / 2, cz];
    const ring = (r, y) => Array.from({ length: segs }, (_, i) => {
      const a = (i / segs) * Math.PI * 2;
      return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    });
    const lo = ring(r0, y0), hi = ring(r1, y1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.poly(r1 > 0 ? [lo[i], lo[j], hi[j], hi[i]] : [lo[i], lo[j], [cx, y1, cz]], color, mat, inside);
    }
    if (r1 > 0) this.poly(hi, color, mat, inside);
  }

  /** Cylinder lying along the X axis (wheels). */
  cylinderX(x0, x1, cy, cz, r, segs, color, mat = MAT.PLAIN) {
    const inside = [(x0 + x1) / 2, cy, cz];
    const ring = (x) => Array.from({ length: segs }, (_, i) => {
      const a = (i / segs) * Math.PI * 2;
      return [x, cy + Math.cos(a) * r, cz + Math.sin(a) * r];
    });
    const a = ring(x0), b = ring(x1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.poly([a[i], a[j], b[j], b[i]], color, mat, inside);
    }
    this.poly(a, color, mat, inside);
    this.poly(b, color, mat, inside);
  }

  /** Low-poly (ellipsoid) sphere. stretchY scales the vertical radius. */
  sphere(cx, cy, cz, r, segs, rings, color, mat = MAT.PLAIN, stretchY = 1) {
    const p = (t, a) => [
      cx + r * Math.sin(t) * Math.cos(a),
      cy + r * stretchY * Math.cos(t),
      cz + r * Math.sin(t) * Math.sin(a),
    ];
    for (let j = 0; j < rings; j++) {
      const t0 = (Math.PI * j) / rings, t1 = (Math.PI * (j + 1)) / rings;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const pts = j === 0 ? [p(t0, a0), p(t1, a1), p(t1, a0)]
          : j === rings - 1 ? [p(t0, a0), p(t0, a1), p(t1, a0)]
          : [p(t0, a0), p(t0, a1), p(t1, a1), p(t1, a0)];
        this.poly(pts, color, mat, [cx, cy, cz]);
      }
    }
  }
}
