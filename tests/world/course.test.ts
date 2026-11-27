// Places in an order, and the plain pick among several (shared/world/course.ts).
import { expect, test } from "bun:test";
import { COURSE_BACK, COURSE_LOOP, COURSE_ONCE, advance, course, current, pickPlain, type Waypoint } from "../../shared/world/course.ts";

const at = (x: number, z: number, priority = 0): Waypoint => ({ x, z, radius: 1, kind: 0, priority, pull: 0 });

/** The points a course makes for over `steps` arrivals, by their x. */
function walk(mode: number, n: number, steps: number): number[] {
  const c = course(Array.from({ length: n }, (_, i) => at(i, 0)), mode);
  const seen: number[] = [];
  for (let i = 0; i < steps; i++) {
    seen.push(current(c)?.x ?? -1);
    advance(c);
  }
  return seen;
}

test("a course walked once ends at its last point", () => {
  expect(walk(COURSE_ONCE, 3, 5)).toEqual([0, 1, 2, -1, -1]);
  expect(current(course([]))).toBeNull();
  expect(advance(course([]))).toBe(false);
});

test("a loop goes round again and a course walked back returns the way it came", () => {
  expect(walk(COURSE_LOOP, 3, 7)).toEqual([0, 1, 2, 0, 1, 2, 0]);
  expect(walk(COURSE_BACK, 3, 7)).toEqual([0, 1, 2, 1, 0, 1, 2]);
  // One point is all there is of either.
  expect(walk(COURSE_LOOP, 1, 3)).toEqual([0, 0, 0]);
  expect(walk(COURSE_BACK, 1, 3)).toEqual([0, -1, -1]);
});

test("the plain pick is the highest priority, then the nearest, and never a detour", () => {
  const choices = [at(50, 0, 1), at(5, 0, 1), at(1, 0, 0), at(2, 0, 3)].map((place, i) => ({ place, detour: i === 3 }));
  expect(pickPlain({ choices }, 0, 0)).toBe(1);
  expect(pickPlain({ choices }, 60, 0)).toBe(0);
  expect(pickPlain({ choices: [choices[3]!] }, 0, 0)).toBe(-1);
});
