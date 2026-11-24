// Fits an orb's shell into courses (shared/world/orb.ts ORB_SIZES): for a radius and a centre's height, tries each count
// of facets round the equator and prints the courses that cut it into the fewest pieces, as a size's row takes them.
//
//   bun tools/orb/shell.ts <radius> <centre> [from] [to]
import { orbCourse, orbRows } from "../../shared/world/orb.ts";

/**
 * The courses of that shell from the top down, each its last row, its pieces round and how far from the axis a piece's
 * origin is: each course the choice of fewest pieces a row, as many rows as fit cut as few times as fit. Null where
 * some row fits no piece.
 */
export function fitCourses(radius: number, centre: number, round: number): [number, number, number][] | null {
  const rows = orbRows(radius, centre, round);
  const courses: [number, number, number][] = [];
  for (let a = 0; a < rows.length - 1; ) {
    let best = 0, to = a, out = 0;
    const points = rows[Math.max(a, 1)]!;
    // Not a count that leaves a facet cut.
    for (let count = 1; count <= points; count++) {
      if (points % count !== 0) continue;
      for (let b = a + 1; b < rows.length; b++) {
        const at = orbCourse(radius, centre, round, a, b, count);
        if (at === null) break;
        if (best === 0 || count * (to - a) < best * (b - a)) [best, to, out] = [count, b, at];
      }
    }
    if (best === 0) return null;
    courses.push([to, best, out]);
    a = to;
  }
  return courses;
}

export const pieces = (courses: readonly (readonly [number, number, number])[]): number => courses.reduce((n, c) => n + c[1], 0);

if (import.meta.main) {
  const [radius, centre, from = 60, to = 96] = process.argv.slice(2).map(Number);
  if (!radius || centre === undefined || Number.isNaN(centre)) throw new Error("bun tools/orb/shell.ts <radius> <centre> [from] [to]");
  let least = Infinity;
  for (let round = from; round <= to; round += 4) {
    const courses = fitCourses(radius, centre, round);
    console.log(`${round} round: ${courses ? `${pieces(courses)} pieces, courses ${JSON.stringify(courses)}` : "does not fit"}`);
    if (courses) least = Math.min(least, pieces(courses));
  }
  console.log(`fewest: ${least}`);
}
