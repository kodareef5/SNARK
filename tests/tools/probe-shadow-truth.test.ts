// The lit probe's shadow truth: rays against the staged boxes, grown or shrunk by the filter's reach.
import { expect, test } from "bun:test";
import { enter, surelyShaded } from "../../tools/probe-lit/shadow.ts";

const up = [0, 1, 0];
/** A wall 20 cm thick, 3 m tall, along x. */
const wall = { min: [-1.5, 0, -0.1], max: [1.5, 3, 0.1] };

test("a wall shrunk by more than half its thickness surely shades nothing", () => {
  expect(enter([0, -1, 0], up, wall, -0.05)).toBe(1.05);
  expect(enter([0, -1, 0], up, wall, -0.28)).toBe(Infinity);
  // Turned inside out it would stand 36 cm thick, past its own faces.
  expect(enter([0, -1, 0.15], up, wall, -0.28)).toBe(Infinity);
});

test("a wall grown by the filter's reach maybe shades past its faces", () => {
  expect(enter([0, -1, 0.15], up, wall, 0)).toBe(Infinity);
  expect(enter([0, -1, 0.15], up, wall, 0.28)).toBe(0.72);
});

/** A ceiling 25 cm thick over a 3 m square, in two halves that touch at x = 0. */
const halves = [{ min: [-1.5, 2.75, -1.5], max: [0, 3, 1.5] }, { min: [0, 2.75, -1.5], max: [1.5, 3, 1.5] }];

test("a ceiling thinner than the filter's reach surely shades the floor well inside it", () => {
  expect(surelyShaded(halves, [0.5, 0, 0], up, 0.28)).toBe(true);
  expect(surelyShaded(halves, [1.3, 0, 0], up, 0.28)).toBe(false);
});

test("two pieces that touch shade the seam between them together", () => {
  expect(surelyShaded(halves, [0, 0, 0], up, 0.28)).toBe(true);
  expect(surelyShaded([halves[0]!], [0, 0, 0], up, 0.28)).toBe(false);
});
