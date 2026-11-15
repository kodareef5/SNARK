// Letters a map may stand up as statics: a sign on a hillside spelled out letter by letter, as Los Angeles' Hollywood Sign
// is (tools/mapworld/signs.ts). Each capital is one piece of square-capped strokes, 13.6 m tall (the Hollywood Sign's
// 45 feet) and 0.5 m deep, white sheet metal, its face across the piece's first axis and up. Their ids sort after every
// other core id, so no index moves.

import type { Def, ShapeBox } from "../shared/content/defs.ts";
import { slopeShape, staticOf } from "../shared/content/slopes.ts";
import type { HullDef } from "../shared/world/convex.ts";

export const LETTER_HEIGHT = 13.7;
const STROKE = 2.4;
const DEPTH = 0.5;
const SHEET = { color: 10, material: "core:mat_metal", hp: 9000 } as const;

type P = readonly [number, number];
/** Centre lines are written from -1 to 1 across and up the letter's box, inside half a stroke of its edges. */
const arc = (from: number, to: number, steps: number, ry = 1, cy = 0): P[] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const a = ((from + ((to - from) * k) / steps) * Math.PI) / 180;
    return [Math.cos(a), cy + ry * Math.sin(a)] as const;
  });

/** Each letter's width in metres and the centre lines of its strokes. */
const GLYPHS: Readonly<Record<string, { wide: number; strokes: readonly (readonly P[])[] }>> = {
  A: { wide: 9.4, strokes: [[[-1, -1], [0, 1], [1, -1]], [[-0.55, -0.3], [0.55, -0.3]]] },
  B: { wide: 8.6, strokes: [[[-1, -1], [-1, 1]], [[-1, 1], [0.4, 1], [0.9, 0.65], [0.9, 0.3], [0.4, 0], [-1, 0]], [[0.4, 0], [1, -0.3], [1, -0.65], [0.45, -1], [-1, -1]]] },
  C: { wide: 8.6, strokes: [arc(40, 320, 8)] },
  D: { wide: 8.6, strokes: [[[-1, -1], [-1, 1]], [[-1, 1], [0.2, 1], [1, 0.45], [1, -0.45], [0.2, -1], [-1, -1]]] },
  E: { wide: 7.6, strokes: [[[-1, -1], [-1, 1]], [[-1, 1], [1, 1]], [[-1, 0], [0.7, 0]], [[-1, -1], [1, -1]]] },
  F: { wide: 7.6, strokes: [[[-1, -1], [-1, 1]], [[-1, 1], [1, 1]], [[-1, 0], [0.7, 0]]] },
  G: { wide: 8.6, strokes: [arc(40, 360, 8), [[1, 0], [0.1, 0]]] },
  H: { wide: 9, strokes: [[[-1, -1], [-1, 1]], [[1, -1], [1, 1]], [[-1, 0], [1, 0]]] },
  I: { wide: STROKE, strokes: [[[0, -1], [0, 1]]] },
  J: { wide: 7.6, strokes: [[[1, 1], [1, -0.4]], arc(0, -180, 5, 0.6, -0.4)] },
  K: { wide: 8.6, strokes: [[[-1, -1], [-1, 1]], [[1, 1], [-0.7, -0.15]], [[-0.1, 0.2], [1, -1]]] },
  L: { wide: 7.6, strokes: [[[-1, -1], [-1, 1]], [[-1, -1], [1, -1]]] },
  M: { wide: 11, strokes: [[[-1, -1], [-1, 1], [0, -0.3], [1, 1], [1, -1]]] },
  N: { wide: 9, strokes: [[[-1, -1], [-1, 1], [1, -1], [1, 1]]] },
  O: { wide: 8.8, strokes: [arc(0, 360, 12)] },
  P: { wide: 8.6, strokes: [[[-1, -1], [-1, 1]], [[-1, 1], [0.4, 1], [1, 0.6], [1, 0.2], [0.4, -0.15], [-1, -0.15]]] },
  Q: { wide: 8.8, strokes: [arc(0, 360, 12), [[0.2, -0.45], [1, -1]]] },
  R: { wide: 8.6, strokes: [[[-1, -1], [-1, 1]], [[-1, 1], [0.4, 1], [1, 0.6], [1, 0.2], [0.4, -0.15], [-1, -0.15]], [[0.1, -0.15], [1, -1]]] },
  S: { wide: 8.6, strokes: [[[0.95, 0.6], [0.45, 1], [-0.45, 1], [-1, 0.5], [-1, 0.27], [-0.45, 0.03], [0.45, -0.03], [1, -0.27], [1, -0.5], [0.45, -1], [-0.45, -1], [-0.95, -0.6]]] },
  T: { wide: 9, strokes: [[[-1, 1], [1, 1]], [[0, 1], [0, -1]]] },
  U: { wide: 9, strokes: [[[-1, 1], [-1, -0.35]], arc(180, 360, 6, 0.65, -0.35), [[1, -0.35], [1, 1]]] },
  V: { wide: 9.4, strokes: [[[-1, 1], [0, -1], [1, 1]]] },
  W: { wide: 11, strokes: [[[-1, 1], [-0.5, -1], [0, 1], [0.5, -1], [1, 1]]] },
  X: { wide: 9, strokes: [[[-1, 1], [1, -1]], [[1, 1], [-1, -1]]] },
  Y: { wide: 9.4, strokes: [[[-1, 1], [0, 0]], [[1, 1], [0, 0]], [[0, 0], [0, -1]]] },
  Z: { wide: 8.6, strokes: [[[-1, 1], [1, 1], [-1, -1], [1, -1]]] },
};

/** A stroke between two points, square-capped half a stroke past each: a box where it runs straight across or up. */
function segment(a: P, b: P): { box?: ShapeBox; hull?: HullDef } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const r = STROKE / 2;
  if (Math.abs(ux) < 1e-9 || Math.abs(uy) < 1e-9) {
    const x0 = Math.min(a[0], b[0]) - r;
    const x1 = Math.max(a[0], b[0]) + r;
    const y0 = Math.min(a[1], b[1]) - r;
    const y1 = Math.max(a[1], b[1]) + r;
    return { box: { at: [(x0 + x1) / 2, (y0 + y1) / 2, 0], half: [(x1 - x0) / 2, (y1 - y0) / 2, DEPTH / 2] } };
  }
  const corners: [number, number, number][] = [];
  for (const [p, s] of [[a, -1], [b, 1]] as const) {
    for (const side of [-1, 1]) {
      const x = p[0] + ux * r * s - uy * r * side;
      const y = p[1] + uy * r * s + ux * r * side;
      for (const z of [-DEPTH / 2, DEPTH / 2]) corners.push([x, y, z]);
    }
  }
  return { hull: { corners } };
}

const shapeId = (letter: string): string => `core:ztype_shape_${letter.toLowerCase()}`;
/** The static that stands up one capital letter. */
export const letterKind = (letter: string): string => `core:ztype_${letter.toLowerCase()}`;
/** How wide a letter stands, in metres, for setting a word out along a line. */
export const letterWidth = (letter: string): number => GLYPHS[letter]?.wide ?? 0;

export const LETTER_BLOCKS: readonly Def[] = Object.entries(GLYPHS).flatMap(([letter, g]) => {
  const boxes: ShapeBox[] = [];
  const hulls: HullDef[] = [];
  const [x, y] = [g.wide / 2 - STROKE / 2, LETTER_HEIGHT / 2 - STROKE / 2];
  for (const line of g.strokes) {
    const pts = line.map(([u, v]) => [u * x, v * y] as const);
    for (let k = 1; k < pts.length; k++) {
      const s = segment(pts[k - 1]!, pts[k]!);
      if (s.box) boxes.push(s.box);
      if (s.hull) hulls.push(s.hull);
    }
  }
  const shape = slopeShape(shapeId(letter), "thing", hulls, boxes);
  return [shape, staticOf(letterKind(letter), shape, SHEET)];
});
