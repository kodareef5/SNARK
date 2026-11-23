// A building's envelope as break sets (content/breaks): the sheet bay, the pitched roof and the balcony, in every variant.

import { describe, expect, test } from "bun:test";
import { RUIN_SLOPES } from "../../content/ruins.ts";
import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { balcony } from "../../content/breaks/balcony.ts";
import { chunkVolume, formFaults } from "../../content/breaks/check.ts";
import type { Chunk } from "../../content/breaks/cut.ts";
import { VARIANTS, type Form } from "../../content/breaks/forms.ts";
import { pitchedRoofSample } from "../../content/breaks/roof.ts";
import { sheetBay } from "../../content/breaks/sheet-bay.ts";

const bay = sheetBay(), roof = pitchedRoofSample(), flats = balcony();
const all = [bay, roof, flats];
const variants = Array.from({ length: VARIANTS }, (_, v) => v);
/** A component's forms by name, in one variant. */
const formsOf = (c: { forms: (variant: number) => Form[] }, variant: number) => {
  const [whole, a, b, open] = c.forms(variant);
  return { whole: whole!, a: a!, b: b!, open: open! };
};
const volume = (chunks: readonly Chunk[]): number => chunks.reduce((s, c) => s + chunkVolume(c), 0);

describe("the envelope's break sets", () => {
  test("every form in every variant could be written as a shape", () => {
    for (const c of all) for (const v of variants) for (const f of c.forms(v)) expect({ form: `${c.name} ${f.name} ${v}`, faults: formFaults(f) }).toEqual({ form: `${c.name} ${f.name} ${v}`, faults: [] });
  });

  test("a form is solid the same way in every variant", () => {
    for (const c of all) {
      const first = c.forms(0);
      for (const v of variants) c.forms(v).forEach((f, i) => expect(f.walked).toEqual(first[i]!.walked));
    }
  });

  test("a variant is made the same way twice", () => {
    for (const c of all) for (const v of variants) expect(c.forms(v)).toEqual(c.forms(v));
  });

  test("two variants of a breach are not drawn alike", () => {
    for (const c of all) for (const half of ["a", "b"] as const) expect(formsOf(c, 0)[half].look).not.toEqual(formsOf(c, 1)[half].look);
  });

  test("none of them bears anything in any form", () => {
    for (const c of all) for (const v of variants) for (const f of c.forms(v)) expect(f.bears).toBe(false);
  });
});

/** The widest run along x that no solid box covers at height `y`, as where it starts and ends. Under 1 cm is no run. */
function wayThrough(boxes: readonly ShapeBox[], y: number): [number, number] {
  const spans = boxes.filter((b) => Math.abs(y - b.at[1]) < b.half[1]).map((b) => [b.at[0] - b.half[0], b.at[0] + b.half[0]] as const).sort((p, q) => p[0] - q[0]);
  let widest: [number, number] = [0, 0], reached = spans[0]![0];
  for (const [from, to] of spans) {
    if (from - reached > Math.max(0.01, widest[1] - widest[0])) widest = [reached, from];
    reached = Math.max(reached, to);
  }
  return widest;
}

describe("the sheet bay", () => {
  test("a breach leaves a way through its own half at least 1.1 m wide", () => {
    const { whole, a, b } = formsOf(bay, 0);
    expect(wayThrough(whole.walked.boxes, 1)).toEqual([0, 0]);
    const left = wayThrough(a.walked.boxes, 1), right = wayThrough(b.walked.boxes, 1);
    expect(left[1] - left[0]).toBeGreaterThanOrEqual(1.1);
    expect(left[1]).toBeLessThan(0);
    expect(right[1] - right[0]).toBeGreaterThanOrEqual(1.1);
    expect(right[0]).toBeGreaterThan(0);
    // Over the way through the bay is still closed.
    expect(wayThrough(a.walked.boxes, 3)).toEqual([0, 0]);
  });

  test("a breach bends two strips and drops one sheet at most", () => {
    const dropped = new Set<number>();
    for (const v of variants) for (const f of [formsOf(bay, v).a, formsOf(bay, v).b]) {
      expect(f.look.chunks.filter((c) => c.color === undefined).length).toBe(2);
      expect(f.fragments.length).toBeLessThanOrEqual(1);
      dropped.add(f.fragments.length);
    }
    expect([...dropped].sort()).toEqual([0, 1]);
  });

  test("opened, it sheds four to six sheets and a car passes between its posts", () => {
    for (const v of variants) {
      const { open } = formsOf(bay, v);
      expect(open.fragments.length).toBeGreaterThanOrEqual(4);
      expect(open.fragments.length).toBeLessThanOrEqual(6);
      // Each half is clear from post to post under the top girt.
      const [from, to] = wayThrough(open.walked.boxes, 1);
      expect(to - from).toBeGreaterThan(3.5);
      expect(wayThrough(open.walked.boxes, 3.45)).toEqual([0, 0]);
    }
  });
});

describe("the pitched roof", () => {
  const hulls = RUIN_SLOPES.zpitch8.hulls!;
  /** The tile left on a slope: what is drawn of it in the roof's own colour. The slope on z < 0 is -1. */
  const patches = (f: Form, side: number): Chunk[] => f.look.chunks.filter((c) => c.color === undefined && c.corners.every((p) => p[2] * side >= 0));
  const panels = (f: Form, side: number): Chunk[] => f.fragments.flat().filter((c) => c.corners.every((p) => p[2] * side >= 0));

  test("whole, it is the kit's two slopes", () => {
    const { whole } = formsOf(roof, 0);
    expect(whole.walked.hulls).toEqual(hulls);
    expect(whole.look.chunks.map((c) => c.corners)).toEqual(hulls.map((h) => h.corners));
  });

  test("a bared slope's panels and the tile left on it fill its slab", () => {
    for (const v of variants) {
      const { a, b, open } = formsOf(roof, v);
      for (const [f, side] of [[a, -1], [b, 1], [open, -1], [open, 1]] as const) {
        const slab = chunkVolume({ corners: hulls[side < 0 ? 0 : 1]!.corners });
        expect(Math.abs(volume(panels(f, side)) + volume(patches(f, side)) - slab) / slab).toBeLessThan(0.03);
      }
    }
  });

  test("a breach slides one slope off in five to seven panels and leaves the other", () => {
    for (const v of variants) {
      const { a, b } = formsOf(roof, v);
      for (const [f, side] of [[a, -1], [b, 1]] as const) {
        expect(f.fragments.length).toBeGreaterThanOrEqual(5);
        expect(f.fragments.length).toBeLessThanOrEqual(7);
        expect(panels(f, side).length).toBe(f.fragments.length);
        expect(f.walked.hulls).toEqual([hulls[side < 0 ? 1 : 0]!]);
        expect(f.look.chunks.filter((c) => c.color !== undefined).length).toBe(5);
        const left = patches(f, side).length;
        expect(left === 2 || left === 3).toBe(true);
      }
    }
  });

  test("opened, it is walked on its ridge beam and eave plates alone", () => {
    for (const v of variants) {
      const { open } = formsOf(roof, v);
      expect(open.walked.hulls).toEqual([]);
      expect(open.walked.boxes.length).toBe(3);
      expect(open.fragments.length).toBeLessThanOrEqual(14);
      expect(open.look.chunks.filter((c) => c.color !== undefined).length).toBe(10);
    }
  });
});

describe("the balcony", () => {
  /** A flat's balcony as drawn: its parts outside the wall's face on its side of the bay. The flat on x < 0 is -1. */
  const of = (f: Form, side: number) => ({
    boxes: f.look.boxes.filter((b) => b.at[2] + b.half[2] > 0.26 && (b.at[0] - side * b.half[0]) * side >= 0),
    chunks: f.look.chunks.filter((c) => !c.bare && c.corners.every((p) => p[0] * side >= 0)),
  });

  test("a breach leaves the other flat's balcony exactly as it was", () => {
    for (const v of variants) {
      const { whole, a, b } = formsOf(flats, v);
      expect(of(whole, 1).boxes.length).toBe(2);
      expect(of(whole, 1).chunks.length).toBe(1);
      expect(of(a, 1)).toEqual(of(whole, 1));
      expect(of(b, -1)).toEqual(of(whole, -1));
    }
  });

  test("a breach drops the slab's half in four to six shards, its front and return", () => {
    for (const v of variants) for (const f of [formsOf(flats, v).a, formsOf(flats, v).b]) {
      const shards = f.fragments.filter((g) => g.every((c) => c.bare));
      expect(shards.length).toBeGreaterThanOrEqual(4);
      expect(shards.length).toBeLessThanOrEqual(6);
      expect(f.fragments.length - shards.length).toBe(2);
    }
  });

  test("no tooth stands more than 0.32 m out from the wall's face or the divider", () => {
    for (const v of variants) for (const f of formsOf(flats, v).a.look.chunks.filter((c) => c.bare)) for (const [x, , z] of f.corners) expect(z <= 0.25 + 0.32 + 1e-3 || x >= -0.1 - 0.32 - 1e-3).toBe(true);
    for (const v of variants) for (const f of formsOf(flats, v).open.look.chunks.filter((c) => c.bare)) for (const p of f.corners) expect(p[2]).toBeLessThanOrEqual(0.25 + 0.32 + 1e-3);
  });

  test("a breach bares two or three bars, and the wall behind is untouched", () => {
    for (const v of variants) {
      const { whole, a, open } = formsOf(flats, v);
      const wall = (f: Form) => f.look.boxes.filter((b) => b.at[2] + b.half[2] <= 0.26 && b.at[1] - b.half[1] >= 0);
      expect(wall(a)).toEqual(wall(whole));
      expect(wall(open)).toEqual(wall(whole));
      // A bar is two boxes: its run and its hanging end.
      const bars = a.look.boxes.filter((b) => b.color === 179).length / 2;
      expect(bars === 2 || bars === 3).toBe(true);
      expect(open.walked.boxes.length).toBe(1);
    }
  });
});
