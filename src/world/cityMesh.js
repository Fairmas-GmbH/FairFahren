/**
 * Turns the city data from cityGen.js into one static mesh (one draw call).
 */
import { MeshBuilder, MAT, rgb } from '../gfx/meshBuilder.js';
import { pixelText, textWidth } from '../gfx/pixelFont.js';
import { DASH } from './cityGen.js';

const C = {
  asphalt: rgb(0x4a4c50), grass: rgb(0x6e8f4e), sidewalk: rgb(0xa29f97), curb: rgb(0x8c8a85),
  courtyard: rgb(0x8f8b80), lawn: rgb(0x7a9a58), plaza: rgb(0xb8b2a4),
  water: rgb(0x2f5566), quay: rgb(0x8a8070), railing: rgb(0x3b4a45), marking: rgb(0xe6e6dc),
  sandstone: rgb(0xd8c9a3), copper: rgb(0x5e8c78),
  concrete: rgb(0xdcdcd8), steel: rgb(0xb8bec6), red: rgb(0xc8302c), white: rgb(0xeeeeea),
  trunk: rgb(0x5a4632), leaves: [rgb(0x4f7a3a), rgb(0x5d8a40), rgb(0x46703a)],
  pole: rgb(0x8a8f96), yellow: rgb(0xf2c230), black: rgb(0x151515),
};
// [sides, start angle, outer radius, inner radius, border color, face color]
const SIGN_SHAPES = {
  limit: [16, 0, 0.42, 0.33, C.red, C.white],
  priority: [4, 0, 0.45, 0.3, C.white, C.yellow],
  yield: [3, -Math.PI / 2, 0.5, 0.3, C.red, C.white],
};
const SIGN_Y = 2.3;
const GROUND = { courtyard: C.courtyard, lawn: C.lawn, park: C.grass, plaza: C.plaza };
const MARGIN = 600; // countryside around the city, faded out by fog
const WATER_Y = -1.4;

export function buildCityMesh(city) {
  const m = new MeshBuilder();
  addGround(m, city);
  addRiver(m, city);
  for (const b of city.blocks) addBlock(m, b, city.config);
  for (const md of city.medians) m.box(md.x0, 0, md.z0, md.x1, city.config.curbHeight, md.z1, C.curb, { top: C.grass });
  for (const mk of city.markings) addDashes(m, mk);
  for (const t of city.trees) addTree(m, t);
  for (const l of city.landmarks) LANDMARKS[l.kind](m, l);
  for (const s of city.signs) addSign(m, s);
  return m;
}

/** Pole with a sign plate facing (nx, nz). Signs face an axis direction, so digit boxes stay axis-aligned. */
function addSign(m, s) {
  const { x, z, nx, nz } = s, rx = nz, rz = -nx; // (rx, rz) = viewer's right when looking at the sign
  m.frustum(x, 0.15, z, 0.045, SIGN_Y, 0.045, 5, C.pole);
  const [sides, a0, outer, inner, border, face] = SIGN_SHAPES[s.type];
  const plate = (r, w) => Array.from({ length: sides }, (_, i) => {
    const a = a0 + (i / sides) * Math.PI * 2, u = Math.cos(a) * r;
    return [x + rx * u + nx * w, SIGN_Y + Math.sin(a) * r, z + rz * u + nz * w];
  });
  const front = [x + nx, SIGN_Y, z + nz], behind = [x - nx, SIGN_Y, z - nz];
  m.poly(plate(outer, 0.07), C.pole, MAT.PLAIN, front); // back side
  m.poly(plate(outer, 0.09), border, MAT.PLAIN, behind);
  m.poly(plate(inner, 0.11), face, MAT.PLAIN, behind);
  if (s.type !== 'limit') return;
  const px = 0.07, text = String(s.value), width = textWidth(text) * px;
  const hx = (Math.abs(rx) * px) / 2 + Math.abs(nx) * 0.01, hz = (Math.abs(rz) * px) / 2 + Math.abs(nz) * 0.01;
  pixelText(text, (col, row) => {
    const u = -width / 2 + (col + 0.5) * px, y = SIGN_Y + 1.5 * px - row * px;
    const cx = x + rx * u + nx * 0.12, cz = z + rz * u + nz * 0.12;
    m.box(cx - hx, y, cz - hz, cx + hx, y + px, cz + hz, C.black);
  });
}

/** Asphalt inside the city, grass around it; leaves a gap for the river. */
function addGround(m, { bounds: B, river: R }) {
  const O = { x0: B.x0 - MARGIN, z0: B.z0 - MARGIN, x1: B.x1 + MARGIN, z1: B.z1 + MARGIN };
  for (const [z0, z1] of [[O.z0, R.z0], [R.z1, O.z1]]) {
    const iz0 = Math.max(z0, B.z0), iz1 = Math.min(z1, B.z1);
    m.rect(B.x0, iz0, B.x1, iz1, 0, C.asphalt, MAT.ASPHALT);
    m.rect(O.x0, iz0, B.x0, iz1, 0, C.grass);
    m.rect(B.x1, iz0, O.x1, iz1, 0, C.grass);
    if (z0 < B.z0) m.rect(O.x0, z0, O.x1, B.z0, 0, C.grass);
    if (z1 > B.z1) m.rect(O.x0, B.z1, O.x1, z1, 0, C.grass);
  }
}

function addRiver(m, { bounds: B, river: R }) {
  const x0 = B.x0 - MARGIN, x1 = B.x1 + MARGIN;
  m.rect(x0, R.z0, x1, R.z1, WATER_Y, C.water, MAT.WATER);
  for (const z of [R.z0, R.z1]) {
    const land = [0, 0, z + (z === R.z0 ? -1 : 1)];
    m.poly([[x0, WATER_Y, z], [x1, WATER_Y, z], [x1, 0, z], [x0, 0, z]], C.quay, MAT.PLAIN, land);
  }
  for (const br of R.bridges) {
    const zm = (R.z0 + R.z1) / 2;
    m.box(br.x0, -0.8, R.z0, br.x1, 0, R.z1, C.quay, { top: C.asphalt, topMat: MAT.ASPHALT });
    m.box(br.x0 - 0.35, 0, R.z0, br.x0, 1, R.z1, C.railing);
    m.box(br.x1, 0, R.z0, br.x1 + 0.35, 1, R.z1, C.railing);
    m.box(br.x0 + 1, WATER_Y, zm - 1.2, br.x1 - 1, -0.8, zm + 1.2, C.quay); // pier
  }
}

function addBlock(m, b, cfg) {
  const h = cfg.curbHeight, s = cfg.sidewalk;
  m.box(b.x0, 0, b.z0, b.x1, h, b.z1, C.curb, { top: C.sidewalk });
  m.box(b.x0 + s, h, b.z0 + s, b.x1 - s, h + 0.02, b.z1 - s, GROUND[b.ground]);
  for (const bd of b.buildings) addBuilding(m, bd);
}

function addBuilding(m, b) {
  const wall = rgb(b.color), roof = rgb(b.roofColor), top = b.y0 + b.height;
  const mat = b.kind === 'platte' ? MAT.PLATTE : MAT.ALTBAU;
  m.box(b.x0, b.y0, b.z0, b.x1, top, b.z1, wall, { mat, top: roof, topMat: MAT.PLAIN });
  if (b.roof === 'gable') addGable(m, b, top, wall, roof);
}

/** Pitched roof with its ridge parallel to the street. */
function addGable(m, b, y, wall, roof) {
  const h = b.roofHeight, { x0, z0, x1, z1 } = b;
  const inside = [(x0 + x1) / 2, y + h / 3, (z0 + z1) / 2];
  // Work in (along, across) coordinates and map back to (x, z).
  const P = b.ridgeAlongX ? (u, yy, v) => [u, yy, v] : (u, yy, v) => [v, yy, u];
  const [u0, u1, v0, v1] = b.ridgeAlongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const vm = (v0 + v1) / 2;
  for (const v of [v0, v1]) m.poly([P(u0, y, v), P(u1, y, v), P(u1, y + h, vm), P(u0, y + h, vm)], roof, MAT.PLAIN, inside);
  for (const u of [u0, u1]) m.poly([P(u, y, v0), P(u, y, v1), P(u, y + h, vm)], wall, MAT.PLAIN, inside);
}

/** Dashed line along an axis-aligned segment. */
function addDashes(m, { x0, z0, x1, z1 }) {
  const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len, w = 0.08;
  for (let t = 0; t + DASH.length <= len; t += DASH.period) {
    const ax = x0 + dx * t, az = z0 + dz * t, bx = ax + dx * DASH.length, bz = az + dz * DASH.length;
    const ox = Math.abs(dz) * w, oz = Math.abs(dx) * w;
    m.rect(Math.min(ax, bx) - ox, Math.min(az, bz) - oz, Math.max(ax, bx) + ox, Math.max(az, bz) + oz, 0.02, C.marking);
  }
}

function addTree(m, t) {
  const s = t.s, trunk = 2.4 * s;
  m.frustum(t.x, t.y, t.z, 0.22 * s, t.y + trunk, 0.16 * s, 5, C.trunk);
  const leaf = C.leaves[Math.abs(Math.floor(t.x * 7 + t.z * 13)) % 3];
  m.sphere(t.x, t.y + trunk + 2.4 * s, t.z, 2.4 * s, 7, 4, leaf, MAT.PLAIN, 1.2);
}

const LANDMARKS = {
  // Six pillar pairs joined by walls, entablature, attic and a copper quadriga on top.
  gate(m, g) {
    const half = g.width / 2 + 1;
    for (const z of g.pillars) {
      for (const dx of [-3.4, 3.4]) m.frustum(g.x + dx, 0, z, 0.85, 13, 0.75, 10, C.sandstone);
      m.box(g.x - 3.4, 0, z - 0.5, g.x + 3.4, 13, z + 0.5, C.sandstone);
    }
    m.box(g.x - 4.4, 13, g.z - half, g.x + 4.4, 15.6, g.z + half, C.sandstone);
    m.box(g.x - 3.2, 15.6, g.z - half * 0.5, g.x + 3.2, 18.2, g.z + half * 0.5, C.sandstone);
    m.box(g.x - 1.4, 18.2, g.z - 2.6, g.x + 1.4, 20.6, g.z + 2.6, C.copper);
  },

  // Concrete shaft, steel sphere, red-and-white antenna.
  tvTower(m, { x, y, z }) {
    m.frustum(x, y, z, 5.5, y + 195, 3.4, 14, C.concrete);
    m.sphere(x, y + 207, z, 16, 18, 12, C.steel, MAT.PAINT);
    m.frustum(x, y + 218, z, 4, y + 228, 2.4, 12, C.concrete);
    for (let i = 0; i < 7; i++) {
      const a = y + 228 + i * 9;
      m.frustum(x, a, z, 1.6 - i * 0.15, a + 9, 1.6 - (i + 1) * 0.15, 8, i % 2 ? C.white : C.red);
    }
  },
};
