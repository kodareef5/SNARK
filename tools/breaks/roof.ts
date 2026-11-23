// The kit's pitched roof (zpitch8) as tile on timber. Whole, a slope is the kit's slab. Broken, its skin slides off as a few
// panels and bares five rafters between a ridge beam and an eave plate, with a patch or two of tile left on them.

import { RUIN_FINISHES, RUIN_SLOPES } from "../../content/ruins.ts";
import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { Rng } from "../../shared/rng.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import type { Chunk } from "./cut.ts";
import { seedOf, type Component, type Form } from "./forms.ts";
import { grid, type Corner, type Pt } from "./geometry.ts";

const NAME = "zpitch8";
/** A dark timber. */
const TIMBER = 118;
/** The kit's `pitchedRoof(8, 8, 2.5, 0.3)`: half its width, an eave's distance from the ridge, its rise and its thickness. */
const HALF = 4, RUN = 4, RISE = 2.5, THICK = 0.3;
/** How far from the ridge a rafter starts, which is the ridge beam's half width, and where the eave plate starts. */
const BEAM = 0.08, PLATE = 3.8;

/** A slope's top at `t` metres from the ridge, as the kit writes it. */
const top = (t: number): number => (RISE + THICK) / 2 - (t * RISE) / RUN;

/**
 * A convex part in a slope's plane: a polygon written along the ridge and out from it toward the eave, from `under` below
 * the slope's top to `over` below it, straight up. The slope on z < 0 is -1.
 */
function onSlope(side: number, poly: readonly Pt[], under: number, over: number, color?: number): Chunk {
  const corners = poly.flatMap(([x, t]): Corner[] => [[x, top(t) - under, side * t], [x, top(t) - over, side * t]]);
  return { corners, ...(color !== undefined ? { color } : {}) };
}

/** A point of a skin's cut, on a grid that keeps the slope's top flat: its rise is 5 in 8. */
const snap = ([x, t]: Pt): Pt => [grid(x), Math.round(t * 512) / 512];
const between = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

/**
 * A slope's skin cut into panels in two rows, with `left` of them cut again: the part at the ridge or the eave stays as a
 * patch. Panels and patches fill the slope.
 */
function skin(rng: Rng, left: number): { panels: Pt[][]; patches: Pt[][] } {
  const l = rng.range(1.6, 2.4), r = rng.range(1.6, 2.4);
  const mid = (x: number): number => l + ((r - l) * (x + HALF)) / (2 * HALF);
  const cells: { cell: Pt[]; eave: boolean }[] = [];
  const rows: [number, (x: number) => number, (x: number) => number][] = [[2 + rng.int(2), () => 0, mid], [3 + rng.int(2), mid, () => RUN]];
  rows.forEach(([n, near, far], row) => {
    // Each cut between two panels leans: it meets the row's two edges at different places.
    const cut = (k: number): number => (k === 0 || k === n ? -HALF + (2 * HALF * k) / n : -HALF + (2 * HALF * (k + rng.range(-0.2, 0.2))) / n);
    const a = Array.from({ length: n + 1 }, (_, k) => cut(k)), b = Array.from({ length: n + 1 }, (_, k) => cut(k));
    const on = (x: number, line: (x: number) => number): Pt => snap([x, line(x)]);
    for (let k = 0; k < n; k++) cells.push({ cell: [on(a[k]!, near), on(a[k + 1]!, near), on(b[k + 1]!, far), on(b[k]!, far)], eave: row === 1 });
  });
  const panels: Pt[][] = [], patches: Pt[][] = [];
  // The first cells in a seeded order keep a patch, ragged: shallow at one end and deep at the other.
  const order = cells.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  const kept = new Set(order.slice(0, left));
  cells.forEach(({ cell, eave }, i) => {
    if (!kept.has(i)) { panels.push(cell); return; }
    const [c0, c1, c2, c3] = cell as [Pt, Pt, Pt, Pt];
    const shallow = rng.range(0.08, 0.25), deep = rng.range(0.3, 0.55), [f0, f1] = rng.float() < 0.5 ? [shallow, deep] : [deep, shallow];
    const p0 = snap(eave ? between(c3, c0, f0) : between(c0, c3, f0)), p1 = snap(eave ? between(c2, c1, f1) : between(c1, c2, f1));
    patches.push(eave ? [p0, p1, c2, c3] : [c0, c1, p1, p0]);
    panels.push(eave ? [c0, c1, p1, p0] : [p0, p1, c2, c3]);
  });
  return { panels, patches };
}

const timber = (at: readonly [number, number, number], half: readonly [number, number, number]): ShapeBox => ({ at, half });
const ridge = timber([0, 1.15, 0], [HALF, 0.15, BEAM]);
const plate = (side: number): ShapeBox => timber([0, grid(top(RUN) - THICK + 0.09), side * (PLATE + 0.09)], [HALF, 0.09, 0.09]);
const painted = (b: ShapeBox): ShapeBox => ({ ...b, color: TIMBER });

/** A slope's five rafters, inside the slab the skin was. */
const rafters = (side: number): Chunk[] => [-3.6, -1.8, 0, 1.8, 3.6].map((x) => onSlope(side, [[x - 0.05, BEAM], [x + 0.05, BEAM], [x + 0.05, RUN], [x - 0.05, RUN]], THICK - 0.02, 0.08, TIMBER));

/** A slope opened: what stands of it and what leaves. */
function bared(side: number, rng: Rng, left: number): { chunks: Chunk[]; fragments: Chunk[][] } {
  const { panels, patches } = skin(rng, left);
  return { chunks: [...rafters(side), ...patches.map((p) => onSlope(side, p, THICK, 0))], fragments: panels.map((p) => [onSlope(side, p, THICK, 0)]) };
}

export function pitchedRoofSample(): Component {
  const hulls = RUIN_SLOPES.zpitch8.hulls as readonly HullDef[];
  const slope = (side: number): HullDef => hulls[side < 0 ? 0 : 1]!;
  const finish = RUIN_FINISHES.clay;
  const forms = (variant: number): Form[] => {
    const breach = (name: "breach A" | "breach B", side: -1 | 1): Form => {
      // Two patches are left or three, by the variant, and not the same number on both slopes.
      const { chunks, fragments } = bared(side, new Rng(seedOf(NAME, name, variant)), side < 0 ? 2 + (variant & 1) : 3 - (variant & 1));
      const timbers = [ridge, plate(side)];
      return { name, note: "one slope bared to its rafters", look: { boxes: timbers.map(painted), chunks: [{ corners: slope(-side).corners }, ...chunks] }, walked: { boxes: timbers, hulls: [slope(-side)] }, fragments, panes: [], bears: false };
    };
    const rng = new Rng(seedOf(NAME, "open", variant));
    // Opened, a patch is left on one slope or on each.
    const lefts = [[1, 0], [0, 1], [1, 1], [1, 1]][variant % 4]!;
    const a = bared(-1, rng, lefts[0]!), b = bared(1, rng, lefts[1]!);
    const timbers = [ridge, plate(-1), plate(1)];
    return [
      { name: "whole", note: "", look: { boxes: [], chunks: hulls.map((h) => ({ corners: h.corners })) }, walked: { boxes: [], hulls }, fragments: [], panes: [], bears: false },
      breach("breach A", -1),
      breach("breach B", 1),
      { name: "open", note: "both slopes bared", look: { boxes: timbers.map(painted), chunks: [...a.chunks, ...b.chunks] }, walked: { boxes: timbers, hulls: [] }, fragments: [...a.fragments, ...b.fragments], panes: [], bears: false },
    ];
  };
  return { name: NAME, family: "pitched roof", material: "tile on timber", finish: [finish.color, finish.under], skin: [], eye: [35, 46], apart: [0, 2.2, 0], forms };
}
