// The kit's pitched roofs as tile on timber. Whole, a slope is the kit's slab. Broken, its skin slides off as a few panels
// and bares rafters between a ridge beam and an eave plate, with a patch or two of tile left on them.

import { RUIN_FINISHES, RUIN_SLOPES } from "../ruins.ts";
import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { Rng } from "../../shared/rng.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import type { Chunk } from "./cut.ts";
import { seedOf, type Component, type Form } from "./forms.ts";
import { grid, type Corner, type Pt } from "./geometry.ts";
import { heapForm } from "./heap.ts";

/** A dark timber. */
const TIMBER = 118;
/** Each roof as the kit writes it (`pitchedRoof` in content/ruins.ts): its width, an eave's distance from the ridge, its rise. */
const ROOFS = { zpitch4: [4, 2, 1.25], zpitch8: [8, 4, 2.5], zpitch16: [16, 8, 4] } as const;
const THICK = 0.3;
/** How far from the ridge a rafter starts, which is the ridge beam's half width, and how far a rafter is from the next. */
const BEAM = 0.08, APART = 1.8;

export type RoofName = keyof typeof ROOFS;

export function pitchedRoof(name: RoofName = "zpitch8"): Component {
  const [WIDE, RUN, RISE] = ROOFS[name], HALF = WIDE / 2;
  /** Where the eave plate starts. */
  const PLATE = RUN - 0.2;

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

  /** A point of a skin's cut, on a grid that keeps the slope's top flat: its rise is 5 in 8, or 1 in 2. */
  const snap = ([x, t]: Pt): Pt => [grid(x), Math.round(t * 512) / 512];
  const between = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

  /**
   * A slope's skin cut into panels in two rows, with `left` of them cut again: the part at the ridge or the eave stays as a
   * patch. Panels and patches fill the slope.
   */
  function skin(rng: Rng, left: number): { panels: Pt[][]; patches: Pt[][] } {
    const l = RUN * rng.range(0.4, 0.6), r = RUN * rng.range(0.4, 0.6);
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
    const kept = order.slice(0, left);
    cells.forEach(({ cell, eave }, i) => {
      if (!kept.includes(i)) { panels.push(cell); return; }
      const [c0, c1, c2, c3] = cell as [Pt, Pt, Pt, Pt];
      const shallow = rng.range(0.08, 0.25), deep = rng.range(0.3, 0.55), [f0, f1] = rng.float() < 0.5 ? [shallow, deep] : [deep, shallow];
      const p0 = snap(eave ? between(c3, c0, f0) : between(c0, c3, f0)), p1 = snap(eave ? between(c2, c1, f1) : between(c1, c2, f1));
      patches.push(eave ? [p0, p1, c2, c3] : [c0, c1, p1, p0]);
      panels.push(eave ? [c0, c1, p1, p0] : [p0, p1, c2, c3]);
    });
    return { panels, patches };
  }

  const ridge: ShapeBox = { at: [0, grid(top(0) - 0.25), 0], half: [HALF, 0.15, BEAM] };
  const plate = (side: number): ShapeBox => ({ at: [0, grid(top(RUN) - THICK + 0.09), side * (PLATE + 0.09)], half: [HALF, 0.09, 0.09] });
  const painted = (b: ShapeBox): ShapeBox => ({ ...b, color: TIMBER });

  /** A slope's rafters, inside the slab the skin was: one at the middle and the rest each side of it, a small roof's closer. */
  const apart = Math.min(APART, HALF - 0.4), each = Math.floor((HALF - 0.3) / apart);
  const rafters = (side: number): Chunk[] => Array.from({ length: 2 * each + 1 }, (_, k) => (k - each) * apart).map((x) => onSlope(side, [[x - 0.05, BEAM], [x + 0.05, BEAM], [x + 0.05, RUN], [x - 0.05, RUN]], THICK - 0.02, 0.08, TIMBER));

  /** A slope opened: what stands of it and what leaves. */
  function bared(side: number, rng: Rng, left: number): { chunks: Chunk[]; fragments: Chunk[][] } {
    const { panels, patches } = skin(rng, left);
    return { chunks: [...rafters(side), ...patches.map((p) => onSlope(side, p, THICK, 0))], fragments: panels.map((p) => [onSlope(side, p, THICK, 0)]) };
  }

  const hulls = RUIN_SLOPES[name].hulls as readonly HullDef[];
  const slope = (side: number): HullDef => hulls[side < 0 ? 0 : 1]!;
  const finish = RUIN_FINISHES.clay;
  const forms = (variant: number): Form[] => {
    const breach = (form: "breach A" | "breach B", side: -1 | 1): Form => {
      // Two patches are left or three, by the variant, and not the same number on both slopes.
      const { chunks, fragments } = bared(side, new Rng(seedOf(name, form, variant)), side < 0 ? 2 + (variant & 1) : 3 - (variant & 1));
      const timbers = [ridge, plate(side)];
      return { name: form, note: "one slope bared to its rafters", look: { boxes: timbers.map(painted), chunks: [{ corners: slope(-side).corners }, ...chunks] }, walked: { boxes: timbers, hulls: [slope(-side)] }, fragments, panes: [], bears: false };
    };
    const rng = new Rng(seedOf(name, "open", variant));
    // Opened, a patch is left on one slope or on each.
    const lefts = [[1, 0], [0, 1], [1, 1], [1, 1]][variant % 4]!;
    const a = bared(-1, rng, lefts[0]!), b = bared(1, rng, lefts[1]!);
    const timbers = [ridge, plate(-1), plate(1)];
    return [
      { name: "whole", note: "", look: { boxes: [], chunks: hulls.map((h) => ({ corners: h.corners })) }, walked: { boxes: [], hulls }, fragments: [], panes: [], bears: false },
      breach("breach A", -1),
      breach("breach B", 1),
      { name: "open", note: "both slopes bared", look: { boxes: timbers.map(painted), chunks: [...a.chunks, ...b.chunks] }, walked: { boxes: timbers, hulls: [] }, fragments: [...a.fragments, ...b.fragments], panes: [], bears: false },
      // What fell lies at the eaves' level, under where the roof was.
      heapForm({ name, variant, kind: "slab", footprint: [-HALF, HALF, -RUN, RUN], floor: top(RUN) - THICK, volume: WIDE * 2 * RUN * THICK }),
    ];
  };
  return { name, family: "roof", material: "tile on timber", finish: [finish.color, finish.under], skin: [], eye: [35, 46], apart: [0, 2.2, 0], forms };
}
