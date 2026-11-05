/** Tiny 3x5 pixel font for text built from geometry (taxi sign, traffic signs). */
const GLYPHS = {
  T: '111010010010010', A: '010101111101101', X: '101101010101101', I: '111010010010111',
  F: '111100110100100', R: '110101110101101', M: '101111111101101', S: '111100111001111',
  0: '111101101101111', 3: '111001111001111', 5: '111100111001111',
};

/** Width of `text` in pixels (3 px per glyph, 1 px spacing). */
export const textWidth = (text) => text.length * 4 - 1;

/** Calls fn(x, y) for every lit pixel; x grows to the right, y grows downwards. */
export function pixelText(text, fn) {
  [...text].forEach((ch, i) => {
    for (let p = 0; p < 15; p++) if (GLYPHS[ch][p] === '1') fn(i * 4 + (p % 3), Math.floor(p / 3));
  });
}
