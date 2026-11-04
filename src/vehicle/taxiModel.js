/**
 * Procedural German taxi: light-ivory saloon with the yellow "TAXI" roof sign.
 * Local space: +Z forward, +X left, Y up, origin on the ground between the axles.
 */
import { MeshBuilder, MAT, rgb } from '../gfx/meshBuilder.js';

const IVORY = rgb(0xe8dcb0); // RAL 1015 "Hellelfenbein", the classic German taxi colour
const GLASS = rgb(0x1d252d), TRIM = rgb(0x2a2a2a), SIGN = rgb(0xf5c400), INK = rgb(0x111111);
const HEADLIGHT = rgb(0xfff4d6), TAILLIGHT = rgb(0xb3121b), TIRE = rgb(0x1b1b1b), RIM = rgb(0xb9bcc0);

// 3x5 pixel font, rows top to bottom. All four letters are mirror-symmetric,
// so the sign reads correctly from the front and from behind.
const FONT = { T: '111010010010010', A: '010101111101101', X: '101101010101101', I: '111010010010111' };

/** Returns three MeshBuilders: body, one wheel (centred on its axle) and the blob shadow. */
export function buildTaxi(spec) {
  return { body: buildBody(), wheel: buildWheel(spec), shadow: buildShadow() };
}

/** Wheel hub positions in local space. Front wheels steer. */
export function wheelOffsets(spec) {
  const x = spec.trackWidth / 2, z = spec.wheelBase / 2, y = spec.wheelRadius;
  return [
    { x, y, z, front: true }, { x: -x, y, z, front: true },
    { x, y, z: -z, front: false }, { x: -x, y, z: -z, front: false },
  ];
}

function buildBody() {
  const m = new MeshBuilder();
  const paint = { mat: MAT.PAINT };
  m.box(-0.92, 0.28, -2.45, 0.92, 0.82, 2.45, IVORY, paint); // lower body
  m.box(-0.8, 0.82, -1.45, 0.8, 1.42, 0.9, IVORY, paint); // cabin
  m.box(-0.7, 0.9, 0.9, 0.7, 1.36, 0.93, GLASS, paint); // windscreen
  m.box(-0.7, 0.9, -1.48, 0.7, 1.36, -1.45, GLASS, paint); // rear window
  for (const x of [-0.83, 0.8]) {
    m.box(x, 0.92, -1.3, x + 0.03, 1.36, 0.8, GLASS, paint); // side windows
    m.box(x - 0.01, 0.92, -0.32, x + 0.04, 1.38, -0.2, IVORY, paint); // B-pillar
  }
  for (const s of [-1, 1]) m.box(s > 0 ? 0.92 : -1.02, 1.0, 0.68, s > 0 ? 1.02 : -0.92, 1.1, 0.82, IVORY, paint); // mirrors
  m.box(-0.94, 0.25, 2.4, 0.94, 0.45, 2.55, TRIM); // bumpers
  m.box(-0.94, 0.25, -2.55, 0.94, 0.45, -2.4, TRIM);
  m.box(-0.4, 0.5, 2.45, 0.4, 0.74, 2.47, TRIM); // grille
  for (const [a, b] of [[-0.86, -0.5], [0.5, 0.86]]) {
    m.box(a, 0.6, 2.45, b, 0.74, 2.48, HEADLIGHT, paint);
    m.box(a, 0.6, -2.48, b, 0.74, -2.45, TAILLIGHT, paint);
  }

  // Roof sign with "TAXI" built from tiny boxes on both faces.
  m.box(-0.3, 1.42, -0.5, 0.3, 1.64, -0.25, SIGN, paint);
  const px = 0.032, word = 'TAXI', width = (word.length * 4 - 1) * px;
  [...word].forEach((ch, li) => {
    for (let i = 0; i < 15; i++) {
      if (FONT[ch][i] !== '1') continue;
      const x = -width / 2 + (li * 4 + (i % 3)) * px, y = 1.6 - (Math.floor(i / 3) + 1) * px;
      m.box(x, y, -0.25, x + px, y + px, -0.24, INK); // front face, reads along +X
      m.box(-x - px, y, -0.51, -x, y + px, -0.5, INK); // back face, mirrored
    }
  });
  return m;
}

function buildWheel(spec) {
  const m = new MeshBuilder(), r = spec.wheelRadius;
  m.cylinderX(-0.11, 0.11, 0, 0, r, 14, TIRE);
  m.cylinderX(-0.115, 0.115, 0, 0, r * 0.6, 10, RIM, MAT.PAINT);
  m.box(-0.12, -0.03, 0.05, 0.12, 0.03, 0.17, TRIM); // hub marker, makes the spin visible
  return m;
}

/** Soft shadow: one quad whose vertex colors carry uv coordinates for the shader. */
function buildShadow() {
  const m = new MeshBuilder();
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    m.vertices.push(u * 1.15, 0.03, v * 2.7, 0, 1, 0, u, v, 0, MAT.SHADOW);
  }
  m.indices.push(0, 2, 1, 0, 3, 2);
  return m;
}
