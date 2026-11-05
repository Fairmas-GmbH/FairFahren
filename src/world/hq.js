/**
 * Fairmas headquarters next to the TV tower: a glass skyscraper that twists
 * 90° as it rises, with orange neon floor rings and corner lights that spiral
 * up to a straight crown. Each crown facade carries a neon Fairmas logo and
 * "FAIRMAS" in neon letters. On the roof sits a giant logo that slowly turns;
 * it is its own mesh (buildLogo), placed with logoAnchor() and a rotation.
 * The logo is rebuilt from geometry: white disc, grey and orange swooshes,
 * italic orange F.
 */
import { MeshBuilder, MAT, rgb, frame } from '../gfx/meshBuilder.js';
import { pixelText, textWidth } from '../gfx/pixelFont.js';

export const HQ = { podium: 8, floors: 80, floorH: 4, crown: 68, base: 40, top: 26, logoR: 20 };
const C = { glass: rgb(0x26303b), white: rgb(0xeeeeee), orange: rgb(0xf39200), grey: rgb(0x8a8a8a) };
const roofY = (hq) => hq.y + HQ.podium + HQ.floors * HQ.floorH;

/** Centre of the rotating rooftop logo. */
export const logoAnchor = (hq) => [hq.x, roofY(hq) + 4 + HQ.logoR, hq.z];

/** The giant rooftop logo, back to back so it reads from both sides. */
export function buildLogo() {
  const m = new MeshBuilder();
  for (const h of [0, Math.PI]) addLogo(m, frame(0, 0, 0, h), HQ.logoR);
  return m;
}

/** Fairmas logo of radius r in the plane of frame T, facing local +Z (u = right, v = up). */
export function addLogo(m, T, r) {
  const arc = (a0, a1, t, col, mat) => { // swoosh: a crescent that swells in the middle
    for (let i = 0; i < 16; i++) {
      const p = (k) => {
        const a = a0 + ((a1 - a0) * k) / 16, w = 1 + t * Math.sin((Math.PI * k) / 16);
        return [[Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a) * r * w, Math.sin(a) * r * w]];
      };
      const [[ia, oa], [ib, ob]] = [p(i), p(i + 1)];
      m.slab(T, [ia, ib, ob, oa], 0.01 * r, 0.08 * r, col, mat);
    }
  };
  m.slab(T, Array.from({ length: 32 }, (_, i) => [Math.cos(i * 0.19635) * r, Math.sin(i * 0.19635) * r]), 0, 0.06 * r, C.white, MAT.GLOW);
  arc(1.9, 4.7, 0.16, C.grey, MAT.PAINT);
  arc(4.5, 5.9, 0.09, C.orange, MAT.GLOW);
  // Italic F: stem, top bar, middle bar, slanted to the right.
  for (const part of [
    [[-0.42, -0.6], [-0.12, -0.6], [-0.12, 0.6], [-0.42, 0.6]],
    [[-0.42, 0.32], [0.48, 0.32], [0.48, 0.6], [-0.42, 0.6]],
    [[-0.42, -0.1], [0.3, -0.1], [0.3, 0.15], [-0.42, 0.15]],
  ]) m.slab(T, part.map(([u, v]) => [(u + v * 0.22 + 0.04) * r, v * r]), 0.06 * r, 0.14 * r, C.orange, MAT.GLOW);
}

/** The tower itself, part of the static city mesh. */
export function addHq(m, hq) {
  const { x, y, z } = hq, P = HQ.podium, top = roofY(hq);
  m.box(x - 27, y, z - 27, x + 27, y + P, z + 27, C.white);
  m.box(x - 27.3, y + 1, z - 27.3, x + 27.3, y + 5, z + 27.3, C.glass, { mat: MAT.PAINT }); // lobby glass
  m.box(x - 27.4, y + 5.4, z - 27.4, x + 27.4, y + 5.8, z + 27.4, C.orange, { mat: MAT.GLOW });
  for (let f = 0; f < HQ.floors; f++) {
    const k = Math.min(f / HQ.crown, 1), s = (HQ.base + (HQ.top - HQ.base) * k) / 2, h = HQ.floorH;
    const T = frame(x, y + P + f * h, z, (k * Math.PI) / 2), ring = f % 10 === 9;
    m.obox(T, -s, 0, -s, s, h - 0.4, s, C.glass, MAT.PAINT);
    m.obox(T, -s - 0.4, h - 0.4, -s - 0.4, s + 0.4, h, s + 0.4, ring ? C.orange : C.white, ring ? MAT.GLOW : MAT.PLAIN);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { // corner lights: four spirals
      m.obox(T, a * s - 0.35, 0, b * s - 0.35, a * s + 0.35, h - 0.4, b * s + 0.35, C.orange, MAT.GLOW);
    }
  }
  m.box(x - 4, top, z - 4, x + 4, top + 4, z + 4, C.white); // pedestal for the rooftop logo
  // Crown facades: neon logo with FAIRMAS below.
  const px = 0.9, word = 'FAIRMAS', w = textWidth(word) * px, d = HQ.top / 2 + 0.45;
  for (let i = 0; i < 4; i++) {
    const h = (i * Math.PI) / 2, T = frame(x + Math.sin(h) * d, top - 9, z + Math.cos(h) * d, h);
    addLogo(m, T, 6.5);
    pixelText(word, (col, row) => {
      const u = -w / 2 + col * px, v = -8.5 - row * px;
      m.obox(T, u, v - px, 0, u + px, v, 0.35, C.orange, MAT.GLOW);
    });
  }
}
