import { expect, test } from "bun:test";
import { spansOf } from "../../client/core/render/street-wires.ts";
import { wireOf } from "../../client/core/render/detailtext.ts";
import { DETAIL_POOL, DETAIL_WIRE } from "../../client/core/render/packet.ts";

/**
 * A pole at (x, z), its crossarm across a line that runs at `heading` radians from +x toward +z: x, y, z, yaw and whether
 * it stands.
 */
const pole = (x: number, z: number, heading: number, turned = false, down = false): number[] => {
  // A pole's local x is (cos yaw, -sin yaw): along the line, either way.
  const yaw = -heading + (turned ? Math.PI : 0);
  return [x, 0, z, yaw, down ? 0 : 1];
};
const pairs = (spans: number[]): string[] => {
  const out: string[] = [];
  for (let s = 0; s < spans.length; s += 2) out.push(`${Math.min(spans[s]!, spans[s + 1]!)}-${Math.max(spans[s]!, spans[s + 1]!)}`);
  return out.sort();
};

test("poles down one side of a street are strung each to the next, and nothing else is", () => {
  // Five poles 40 m apart along x, the second of them turned the other way, as a pole may be.
  const row = [0, 40, 80, 120, 160].flatMap((x, i) => pole(x, 0, 0, i === 1));
  expect(pairs(spansOf(row))).toEqual(["0-1", "1-2", "2-3", "3-4"]);

  // A pole that is down leaves a gap no wire spans, though the poles either side are near enough to string; a pole
  // missing where a junction is lets the run go on across it.
  const broken = [0, 40, 80, 120, 160].flatMap((x, i) => pole(x, 0, 0, false, i === 2));
  expect(pairs(spansOf(broken))).toEqual(["0-1", "3-4"]);
  const across = [0, 40, 120, 160, 250].flatMap((x) => pole(x, 0, 0));
  expect(pairs(spansOf(across))).toEqual(["0-1", "1-2", "2-3"]);

  // A row across the street, 14 m off, and a cross street's poles at the corner are left to themselves.
  const sides = [0, 40, 80].flatMap((x) => pole(x, 0, 0)).concat([20, 60].flatMap((x) => pole(x, 14, 0)), pole(100, 20, Math.PI / 2), pole(100, 60, Math.PI / 2));
  expect(pairs(spansOf(sides))).toEqual(["0-1", "1-2", "3-4", "5-6"]);

  // Round a bend of 150 m radius, a pole every 40 m along it.
  const bend: number[] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * 40) / 150;
    bend.push(...pole(150 * Math.sin(a), 150 - 150 * Math.cos(a), a));
  }
  expect(pairs(spansOf(bend))).toEqual(["0-1", "1-2", "2-3"]);
});

test("a wire's card is solid across its middle and soft to nothing at its edges, and is told from a pool by its shape", () => {
  const out = [0, 0, 0];
  wireOf(0, out);
  expect(out).toEqual([1, 0, 1]);
  wireOf(0.35, out);
  expect(out[0]).toBe(1);
  wireOf(1, out);
  expect(out[0]).toBe(0);
  wireOf(0.675, out);
  expect(out[0]).toBeCloseTo(0.5, 6);
  expect(DETAIL_WIRE & DETAIL_POOL).toBe(DETAIL_POOL);
  expect(DETAIL_WIRE & 7).not.toBe(0);
});
