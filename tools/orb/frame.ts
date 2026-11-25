// A test frame for the orb's screen scene (client/core/render/orb.ts): a grid of numbered cells, each its own colour, with
// a white arrow up the middle, so a picture is seen to be upright, centred and whole. Tests and the contact sheet read it.
//
// A cell's colour says where it is: red grows to the right, green to the top and blue to the bottom.

import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphPixel } from "../snap/font.ts";

export const FRAME_COLUMNS = 4;
export const FRAME_ROWS = 3;

/** The sRGB colour of cell (column, row), row 0 at the top, as bytes. */
export function cellColour(column: number, row: number): [number, number, number] {
  return [40 + Math.round((175 * column) / (FRAME_COLUMNS - 1)), 200 - Math.round((150 * row) / (FRAME_ROWS - 1)), 50 + Math.round((150 * row) / (FRAME_ROWS - 1))];
}

/** Whether (x, y), from 0 to 1 across and down the frame, is on the arrow: a shaft up the middle and its head at the top. */
export function onArrow(x: number, y: number): boolean {
  const dx = Math.abs(x - 0.5);
  return (y > 0.42 && y < 0.62 && dx < 0.02) || (y >= 0.32 && y <= 0.42 && dx < (y - 0.32) * 0.6);
}

/** The frame `width` by `height`, RGBA sRGB bytes, top row first. */
export function screenFrame(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const cw = width / FRAME_COLUMNS, ch = height / FRAME_ROWS, scale = Math.max(1, Math.floor(Math.min(cw, ch) / 24));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.min(FRAME_COLUMNS - 1, Math.floor(x / cw)), row = Math.min(FRAME_ROWS - 1, Math.floor(y / ch));
    let [r, g, b] = cellColour(column, row);
    // A dark line between cells, and the cell's number at its corner.
    if (x % cw < 1 || y % ch < 1) r = g = b = 20;
    const label = String(row * FRAME_COLUMNS + column + 1), gx = Math.floor((x - column * cw - 2 * scale) / scale), gy = Math.floor((y - row * ch - 2 * scale) / scale);
    if (gy >= 0 && gy < GLYPH_HEIGHT && gx >= 0 && gx < label.length * (GLYPH_WIDTH + 1) && gx % (GLYPH_WIDTH + 1) < GLYPH_WIDTH && glyphPixel(label.charCodeAt(Math.floor(gx / (GLYPH_WIDTH + 1))), gx % (GLYPH_WIDTH + 1), gy)) r = g = b = 250;
    if (onArrow((x + 0.5) / width, (y + 0.5) / height)) r = g = b = 255;
    const o = (y * width + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}

/** A colour track (shared/video/clip.ts) of `samples` samples, every part the same sRGB colour. */
export function flatTrack(samples: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(samples * 5 * 3);
  for (let i = 0; i < out.length; i += 3) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
  }
  return out;
}
