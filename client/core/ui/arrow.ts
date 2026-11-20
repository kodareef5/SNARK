// The reader's arrow on the minimap and the map screen: which way it faces, with a faint wedge of what it sees. Nodes do not
// turn, so the arrow is a sheet of pictures painted here once, one per step of heading, and a node shows the one it needs by
// its crop (as the sundial's sprites are, ui/sundial.ts). The maps are north-up, so a heading's picture points that way.

import type { UiImage, UiNode } from "./nodes.ts";

/** The sheet's index in the frame's image table, clear of the hearts' (3 on), the skin's and the touch art's. */
export const IMAGE_ARROW = 40;
/** Headings painted, a cell each, in a square grid of GRID by GRID cells of CELL pixels. */
export const ARROW_STEPS = 64;
const GRID = 8;
export const CELL = 40;

// The arrow pointing up, in shares of the cell's half-side: its tip, its wings, the notch of its tail.
const TIP = -0.5, WING_X = 0.33, WING_Y = 0.36, NOTCH = 0.16;
/** The view's wedge: its half-angle and reach. */
const WEDGE = (35 * Math.PI) / 180;
const REACH = 0.97;
/** The outline's width in pixels, and its colour and the fill's. */
const LINE = 1.5;
const INK = [16, 24, 30];
const FILL = [250, 253, 255];
const WEDGE_RGB = [166, 227, 244];
const WEDGE_ALPHA = 0.42;
/** Samples a side, per pixel. */
const SS = 4;

/** The cell, 0 to ARROW_STEPS - 1, for a heading in degrees clockwise from north. */
export function arrowCell(heading: number): number {
  const i = Math.round((((heading % 360) + 360) % 360) / (360 / ARROW_STEPS));
  return i % ARROW_STEPS;
}

/** Points `n` (a K_IMAGE) at the picture of `heading`. */
export function placeArrow(n: UiNode, heading: number): void {
  const cell = arrowCell(heading);
  n.image = IMAGE_ARROW;
  n.sx = (cell % GRID) * CELL;
  n.sy = Math.floor(cell / GRID) * CELL;
  n.sw = CELL;
  n.sh = CELL;
}

/** Distance from (px, py) to the segment (ax, ay)-(bx, by). */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** True if (px, py) is in the triangle a, b, c, either way round. */
function inTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** The sheet: every heading's arrow over its wedge, on clear pixels. */
export function arrowSheet(): UiImage {
  const side = GRID * CELL;
  const data = new Uint8ClampedArray(side * side * 4);
  const half = CELL / 2;
  // The arrow's corners in pixels about the cell's middle, pointing up (screen y runs down).
  const tip = [0, TIP * half], left = [-WING_X * half, WING_Y * half], notch = [0, NOTCH * half], right = [WING_X * half, WING_Y * half];
  const edges = [[tip, left], [left, notch], [notch, right], [right, tip]] as const;
  for (let cell = 0; cell < ARROW_STEPS; cell++) {
    const turn = (cell * 2 * Math.PI) / ARROW_STEPS;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    const ox = (cell % GRID) * CELL, oy = Math.floor(cell / GRID) * CELL;
    for (let py = 0; py < CELL; py++) {
      for (let px = 0; px < CELL; px++) {
        let fill = 0, line = 0, wedge = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const x = px + (sx + 0.5) / SS - half, y = py + (sy + 0.5) / SS - half;
            // Turned back by the heading into the arrow's own frame, where it points up.
            const ax = x * cos + y * sin, ay = -x * sin + y * cos;
            const inside = inTriangle(ax, ay, tip[0]!, tip[1]!, left[0]!, left[1]!, notch[0]!, notch[1]!) || inTriangle(ax, ay, tip[0]!, tip[1]!, notch[0]!, notch[1]!, right[0]!, right[1]!);
            if (inside) { fill++; continue; }
            let near = Infinity;
            for (const [a, b] of edges) near = Math.min(near, toSegment(ax, ay, a[0]!, a[1]!, b[0]!, b[1]!));
            if (near <= LINE) { line++; continue; }
            // The wedge: ahead, within its half-angle, fading with distance.
            const r = Math.hypot(ax, ay) / half;
            if (r < REACH && ay < 0 && Math.abs(Math.atan2(ax, -ay)) < WEDGE) wedge += 1 - r / REACH;
          }
        }
        const n = SS * SS;
        const f = fill / n, l = line / n, w = (wedge / n) * WEDGE_ALPHA;
        // The arrow over the wedge, by coverage.
        const arrow = f + l;
        const alpha = arrow + w * (1 - arrow);
        const o = ((oy + py) * side + ox + px) * 4;
        if (alpha <= 0) continue;
        for (let ch = 0; ch < 3; ch++) data[o + ch] = (FILL[ch]! * f + INK[ch]! * l + WEDGE_RGB[ch]! * w * (1 - arrow)) / alpha;
        data[o + 3] = alpha * 255;
      }
    }
  }
  return { width: side, height: side, data, version: 1, smooth: true };
}
