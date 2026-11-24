import { expect, test } from "bun:test";
import { compare } from "../../tools/vehicle-traces.ts";

type Line = [string, number, Record<string, string>];
const row = (tick: number, fields: Record<string, string>): Line => ["hover", tick, fields];

test("two versions of a course that agree on every tick and field are the same", () => {
  const course = [row(0, { "b.x": "1" }), row(1, { "b.x": "2" })];
  expect(compare(course, course.map((l) => [l[0], l[1], { ...l[2] }]))).toEqual([]);
});

test("a field that first appears on a later tick is compared there, with different values on each side", () => {
  const was = [row(0, { "b.x": "1" }), row(1, { "b.x": "2", "b.liftCharge": "5" })];
  const now = [row(0, { "b.x": "1" }), row(1, { "b.x": "2", "b.liftCharge": "6" })];
  expect(compare(was, now)).toEqual(["hover: first differs at tick 1, b.liftCharge: 5 before, 6 now"]);
});

test("rows of the same values at different ticks differ", () => {
  const was = [row(0, { "b.x": "1" }), row(1, { "b.x": "1" })];
  const now = [row(0, { "b.x": "1" }), row(2, { "b.x": "1" })];
  expect(compare(was, now)).toEqual(["hover: row 1 is tick 1 before, 2 now"]);
});

test("a field only one side has on a tick, where both have it on others, differs there", () => {
  const was = [row(0, { "b.x": "1", "b.lift": "3" }), row(1, { "b.x": "1", "b.lift": "3" })];
  const now = [row(0, { "b.x": "1", "b.lift": "3" }), row(1, { "b.x": "1" })];
  expect(compare(was, now)).toEqual(["hover: first differs at tick 1, b.lift: 3 before, (none) now"]);
});

test("a field one side never has is named once", () => {
  const was = [row(0, { "b.x": "1" })], now = [row(0, { "b.x": "1", "b.lift": "3" })];
  expect(compare(was, now)).toEqual(["hover: fields new: b.lift"]);
});
