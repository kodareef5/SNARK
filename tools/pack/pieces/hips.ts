// What a hip and a saddle are laid along and on (client/core/render/trims.ts), for each tier's trims to build to. A hip
// lies on a sloped side two roofs share, from the side's middle at its top's height, +x up the slope; a saddle on
// the high corner hips end at, at its top's height. Both in a recipe's frame: z up.
//
// Every sloped side rises the roofs' one rise over a side's length. Across it a square's face is level, and a
// triangle's falls by half its rise over its height, so one mesh for a hip is made to that fall each side: where a
// square lies beside it the mesh sinks further into the square's face.

import { ALL_FORMS } from "../../../content/building/forms.ts";
import { HALF_SIDE_M } from "../../../shared/world/lattice/forms.ts";
import type { Shape, Uv, Vec } from "./kit.ts";

const H = HALF_SIDE_M;
const ROOF = ALL_FORMS.triangle_roof;
const RISE = Math.max(...ROOF.corner!) - Math.min(...ROOF.corner!);
/** Metres a hip's line rises to a level metre along it, and a triangle's face falls to a level metre across it. */
export const HIP_PITCH = RISE / (2 * H);
export const HIP_FALL = RISE / 2 / (2 * H * (Math.sqrt(3) / 2));
/** Where a hip's low end lies along it: past the low corner to the eaves' corner, as a hip's own roll runs, less 2 cm. */
export const HIP_FROM = -H - 0.28;

/** The point of a hip's line `x` along it, `y` across and `z` over it. */
export const onHip = (x: number, y = 0, z = 0): Vec => [x, y, HIP_PITCH * x + z];

/**
 * A solid along a hip's line from `x0` to `x1`, its section (y across, z over the line) upright at every point: each
 * section is the same over the line, so a face of it meets a roof's face along the line's whole length. `side(k, i, j)`
 * gives the material and coordinates of strip k's point j at end i, `cap` those of an end's points.
 */
export function alongHip(p: Shape, section: readonly (readonly [number, number])[], x0: number, x1: number, side: (k: number, i: number, q: Vec) => readonly [string, Uv], cap: (q: Vec) => readonly [string, Uv]): Shape {
  const rings = [x0, x1].map((x) => section.map(([y, z]) => onHip(x, y, z)));
  return p.loft(rings, (k, i, j) => side(k, i, rings[i]![j]!), (i, j) => cap(rings[i]![j]!));
}

/**
 * A solid of revolution about the z axis: `rings` from the foot up, each (radius, height), `sides` round, a flat face
 * across its foot and its head. `side(q, around)` gives a point's material and coordinates, `around` its metres round.
 */
export function revolve(p: Shape, rings: readonly (readonly [number, number])[], sides: number, side: (q: Vec, around: number) => readonly [string, Uv], cap: (q: Vec) => readonly [string, Uv], turn = Math.PI / sides): Shape {
  const loops = rings.map(([r, z]) => Array.from({ length: sides }, (_, k): Vec => [Math.cos(turn + (2 * Math.PI * k) / sides) * r, Math.sin(turn + (2 * Math.PI * k) / sides) * r, z]));
  return p.loft(loops, (k, i, j) => side(loops[i]![j]!, (rings[i]![0] * 2 * Math.PI * (j === k ? k : k + 1)) / sides), (i, j) => cap(loops[i]![j]!));
}

/** The underside of a saddle at `r` from its corner: under the steepest face beside it, a triangle's down its fall, and no lower. */
export const SADDLE_FOOT = (r: number): number => -(HIP_FALL * 2) * r - 0.018;
