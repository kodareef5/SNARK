import { expect, test } from "bun:test";
import { CUTS, objectLayer, objects, placeObject } from "../../tools/ui/field-art.ts";
import { extent, type Layer } from "../../tools/ui/touch-art.ts";
import { FIELD_EQUIPMENT, FIELD_ICONS, FIELD_PARTS, FIELD_TOUCH } from "../../client/core/ui/field-icons.ts";

/** A plate `w` by `h` with solid rectangles in it. */
function plate(w: number, h: number, boxes: [number, number, number, number][]): Layer {
  const data = new Float32Array(w * h * 4);
  for (const [x0, y0, bw, bh] of boxes) for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) data.set([0.5, 0.6, 0.7, 1], (y * w + x) * 4);
  return { w, h, data };
}

test("A piece that crosses a grid line stays with the object its middle belongs to", () => {
  // Two cells side by side; the right object's antenna reaches into the left cell, and a speck sits on its own.
  const l = plate(200, 100, [[20, 30, 50, 40], [120, 30, 50, 40], [95, 45, 30, 4], [60, 85, 1, 1]]);
  const o = objects(l, 2, 1);
  const left = extent(objectLayer(o, 0, "left"), 0.05), right = extent(objectLayer(o, 1, "right"), 0.05);
  expect(left.r - left.l).toBe(50);
  expect(right.r - right.l).toBe(75);
});

test("An object lands in the middle of its cell, its larger side the share asked", () => {
  const o = objects(plate(100, 100, [[10, 30, 60, 20]]), 1, 1);
  const placed = placeObject(objectLayer(o, 0, "bar"), 128, 0.75, "bar");
  const b = extent(placed, 0.5);
  expect(Math.abs(b.r - b.l - 96)).toBeLessThanOrEqual(2);
  expect(Math.abs((b.l + b.r) / 2 - 64)).toBeLessThanOrEqual(1.5);
  expect(Math.abs((b.t + b.b) / 2 - 64)).toBeLessThanOrEqual(1.5);
});

test("Every name on every field sheet has a plate to be cut from", () => {
  for (const s of [FIELD_ICONS, FIELD_EQUIPMENT, FIELD_PARTS, FIELD_TOUCH]) for (const name of s.names) expect(CUTS[name], name).toBeDefined();
});
