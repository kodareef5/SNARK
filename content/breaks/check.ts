// What every form must hold to, so that it could be written as content: the limits a shape has (shared/content/kinds/shapes.ts),
// and the budgets the plan gives a break set.

import type { ShapeBox } from "../../shared/content/kinds/shapes.ts";
import { MAX_LOOK_PARTS, MAX_SHAPE_BOXES, MAX_STRUCTURE_HALF } from "../../shared/content/kinds/shapes.ts";
import { hullFault, hullOf } from "../../shared/world/convex.ts";
import type { Chunk, Look } from "./cut.ts";
import type { Form } from "./forms.ts";
import type { Corner } from "./geometry.ts";

/** The most rigid things that leave on one change of form, and the most triangles in them. */
export const MOST_FRAGMENTS = 16, MOST_TRIANGLES = 280;

/** A convex solid's volume, in cubic metres. */
export function chunkVolume(chunk: Chunk): number {
  const hull = hullOf({ corners: chunk.corners });
  if (typeof hull === "string") return 0;
  const o = chunk.corners[0]!;
  let six = 0;
  for (const ring of hull.rings) {
    for (let i = 1; i + 1 < ring.length; i++) {
      const a = chunk.corners[ring[0]!]!, b = chunk.corners[ring[i]!]!, c = chunk.corners[ring[i + 1]!]!;
      const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2], bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2], cx = c[0] - o[0], cy = c[1] - o[1], cz = c[2] - o[2];
      six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
  }
  return Math.abs(six) / 6;
}

export const boxVolume = (b: ShapeBox): number => 8 * b.half[0] * b.half[1] * b.half[2];
export const lookVolume = (look: Look): number => look.boxes.reduce((s, b) => s + boxVolume(b), 0) + look.chunks.reduce((s, c) => s + chunkVolume(c), 0);
/** The volume of everything that leaves on the way into a form, its panes too. */
export const leftVolume = (form: Form): number => form.fragments.flat().reduce((s, c) => s + chunkVolume(c), 0) + form.panes.reduce((s, b) => s + boxVolume(b), 0);

/** A chunk's triangles as it is drawn: each face fanned. */
export function chunkTriangles(chunk: Chunk): number {
  const hull = hullOf({ corners: chunk.corners });
  return typeof hull === "string" ? 0 : hull.rings.reduce((s, ring) => s + ring.length - 2, 0);
}

function reach(points: readonly Corner[]): number {
  let most = 0;
  for (let a = 0; a < 3; a++) most = Math.max(most, (Math.max(...points.map((p) => p[a]!)) - Math.min(...points.map((p) => p[a]!))) / 2);
  return most;
}

const cornersOf = (b: ShapeBox): Corner[] => [[b.at[0] - b.half[0], b.at[1] - b.half[1], b.at[2] - b.half[2]], [b.at[0] + b.half[0], b.at[1] + b.half[1], b.at[2] + b.half[2]]];

/** Why a form could not be content, each fault in words, or none. */
export function formFaults(form: Form): string[] {
  const faults: string[] = [];
  const solid = form.walked.boxes.length + form.walked.hulls.length;
  if (solid < 1 || solid > MAX_SHAPE_BOXES) faults.push(`${solid} solid parts, where a shape has 1 to ${MAX_SHAPE_BOXES}`);
  const drawn = form.look.boxes.length + form.look.chunks.length;
  if (drawn < 1 || drawn > MAX_LOOK_PARTS) faults.push(`${drawn} drawn parts, where a look has 1 to ${MAX_LOOK_PARTS}`);
  for (const h of form.walked.hulls) { const f = hullFault(h); if (f !== "") faults.push(`a solid part: ${f}`); }
  for (const c of [...form.look.chunks, ...form.fragments.flat()]) { const f = hullFault({ corners: c.corners }); if (f !== "") faults.push(`a chunk: ${f}`); }
  for (const b of [...form.walked.boxes, ...form.look.boxes]) if (b.half.some((h) => !(h > 0))) faults.push("a box with no thickness");
  const all = [...form.walked.boxes.flatMap(cornersOf), ...form.walked.hulls.flatMap((h) => h.corners), ...form.look.boxes.flatMap(cornersOf), ...form.look.chunks.flatMap((c) => c.corners)];
  if (all.length > 0 && reach(all) > MAX_STRUCTURE_HALF) faults.push(`reaches further than ${MAX_STRUCTURE_HALF} m from its middle`);
  if (form.fragments.length > MOST_FRAGMENTS) faults.push(`${form.fragments.length} things leave, where ${MOST_FRAGMENTS} may`);
  const triangles = form.fragments.flat().reduce((s, c) => s + chunkTriangles(c), 0);
  if (triangles > MOST_TRIANGLES) faults.push(`${triangles} triangles leave, where ${MOST_TRIANGLES} may`);
  return faults;
}
