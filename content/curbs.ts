// A curb return: the street's walk turning the corner where two streets meet at about a right angle, on a quarter circle
// 4, 6 or 8 m round at the curb's face, as the walk kit's own profile (content/ruins.ts street(): 0.15 m high, 2.4 m
// wide with the curb, and a gutter pan before it, drawn only). At the middle of its arc a ramp runs down to the road for
// the crossings either side of the corner. A map sets one down where two streets meet (tools/mapworld/corners.ts) and
// ends the straight walks on either side at its ends. Each is drawn as its mesh in the street pieces asset
// (assets/source/core/props/street/curb.py, which keeps these numbers) and walked as the convex parts here. Their ids
// sort after every other core id, so no index moves.

import { shapeHalf, type Def, type ShapeDef, type StructureDef } from "../shared/content/defs.ts";
import { PI, detCos, detSin } from "../shared/math/scalar.ts";
import type { HullDef } from "../shared/world/convex.ts";

/** The radii at the curb's face that returns are made in, in metres. */
export const RETURN_RADII = [4, 6, 8] as const;

export const CURB_RETURN = {
  /** The walk's height over the road, and its width with the curb's top. */
  height: 0.15,
  walk: 2.4,
  /** The gutter pan's width before the curb, on the road. */
  pan: 0.45,
  /**
   * How far each end of the return runs on straight past its arc, 6 mm under the walk's top: the straight walk's end lies
   * over the middle of it, so the two meet in a joint whatever the few centimetres the corner's angle leaves.
   */
  joint: 0.12,
  /** The ramp at the arc's middle: at the road for `flat` metres of the face either side of the middle, then up to the curb by `flare`. */
  flat: 0.8,
  flare: 1.4,
  /** How far the ramp's foot falls: to the pan's inner edge, a centimetre over the road. */
  drop: 0.14,
} as const;

/** Walked as twelve wedges round the quarter. */
const WEDGES = 12;
const HALF_PI = PI / 2;

export const curbReturnKind = (radius: number): string => `core:zzzcurb_r${radius}`;
const shapeId = (radius: number): string => `core:zzzcurbshape_r${radius}`;
/** Whether a static's kind is a curb return, and its radius at the curb's face. */
export const isCurbReturn = (kind: string): boolean => kind.startsWith("core:zzzcurb_r");
export const returnRadius = (kind: string): number => Number(kind.slice("core:zzzcurb_r".length));

/**
 * The piece's origin in its corner's frame, where the two kerbs would meet at (0, 0), the block lies at +x and +z, one
 * kerb comes in along x to (radius, 0) and the other along z to (0, radius), and the arc is centred on (radius, radius):
 * the middle of the box round it, its pans and straight ends included, and half the walk's height over the road.
 */
export function returnMiddle(radius: number): [number, number, number] {
  const m = (radius + CURB_RETURN.joint - CURB_RETURN.pan) / 2;
  return [m, CURB_RETURN.height / 2, m];
}

/** How much of the ramp's fall is taken at angle `phi` round the arc, from 0 at the kerb along x to a quarter turn. */
export function rampShare(radius: number, phi: number): number {
  const s = Math.abs(phi - PI / 4) * radius;
  const { flat, flare } = CURB_RETURN;
  return s <= flat ? 1 : s >= flat + flare ? 0 : (flat + flare - s) / flare;
}

/** The walk's top over the road at angle `phi` round the arc, `r` metres from its centre: the face at `radius`, the back a walk's width in. */
export function returnTop(radius: number, phi: number, r: number): number {
  const { height, walk, drop } = CURB_RETURN;
  const share = Math.min(1, Math.max(0, (r - (radius - walk)) / walk));
  return height - drop * rampShare(radius, phi) * share;
}

const mm = (v: number): number => Math.round(v * 1000) / 1000;

/** The walked wedges, in the piece's frame: each from one angle round the arc to the next, face to back, road to top. */
function wedges(radius: number): HullDef[] {
  const [mx, my, mz] = returnMiddle(radius);
  const inner = radius - CURB_RETURN.walk;
  const at = (phi: number, r: number, top: boolean): readonly [number, number, number] =>
    [mm(radius - r * detSin(phi) - mx), mm((top ? returnTop(radius, phi, r) : 0) - my), mm(radius - r * detCos(phi) - mz)];
  const out: HullDef[] = [];
  for (let i = 0; i < WEDGES; i++) {
    const a = (HALF_PI * i) / WEDGES, b = (HALF_PI * (i + 1)) / WEDGES;
    out.push({ corners: [a, b].flatMap((phi) => [inner, radius].flatMap((r) => [at(phi, r, false), at(phi, r, true)])) });
  }
  return out;
}

/** The straight ends drawn where no mesh is, a joint's depth under the walk: from the face to the walk's back, `joint` long. */
function ends(radius: number): HullDef[] {
  const [mx, my, mz] = returnMiddle(radius);
  const { joint, walk, height } = CURB_RETURN;
  const top = height - 0.006;
  // Along x past (radius, 0), the walk toward +z; along z past (0, radius), the walk toward +x.
  const along = (u: number, w: number, y: number, swap: boolean): readonly [number, number, number] =>
    swap ? [mm(w - mx), mm(y - my), mm(u - mz)] : [mm(u - mx), mm(y - my), mm(w - mz)];
  return [false, true].map((swap) => ({ corners: [radius, radius + joint].flatMap((u) => [0, walk].flatMap((w) => [along(u, w, 0, swap), along(u, w, top, swap)])) }));
}

const SHAPES: readonly ShapeDef[] = RETURN_RADII.map((radius) => ({
  type: "shape", id: shapeId(radius), role: "thing", boxes: [], hulls: wedges(radius), look: { hulls: [...wedges(radius), ...ends(radius)] },
}));

const STATICS: readonly StructureDef[] = RETURN_RADII.map((radius, i) => ({
  type: "structure", class: "static", id: curbReturnKind(radius), mesh: "shape", shape: shapeId(radius),
  half: shapeHalf(SHAPES[i]!.boxes, SHAPES[i]!.hulls, SHAPES[i]!.look),
  // As the walk kit's concrete (content/ruins.ts RUIN_FINISHES), drawn near only.
  color: 100, hp: 16000, material: "core:mat_stone", near: true,
}));

export const CURB_RETURNS: readonly Def[] = [...SHAPES, ...STATICS];
