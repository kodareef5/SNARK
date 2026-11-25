// A tier's pieces level by level. A recipe builds each level of a form for what it is seen as from its distance, and
// says how far it lies from the finest; no level is made by thinning another.

import { nearestColour } from "../../../shared/pack/palette.ts";
import { formBounds, outlineBox, type FormDef } from "../../../shared/world/lattice/forms.ts";
import type { SourceLod } from "../write.ts";
import { slice, tidy, uprightPlane, planeMoved, type Flat, type Plane, type Shape } from "./kit.ts";

/**
 * Metres each level after the finest may lie from it. On medium a level is drawn from 3,505 times its error, so these
 * begin at 19, 60, 147 and 386 m: inside the 20, 60, 150 and 400 m the piece budget is counted from.
 */
export const LEVEL_ERRORS = [0.0055, 0.017, 0.042, 0.11] as const;
/** Levels drawn with materials. The first flat one begins past the 80 m a piece keeps its pictures to. */
export const TEXTURED = 3;

export interface TierRecipe {
  readonly name: string;
  /** thatch 0, wood 1, stone 2, metal 3: the higher tier's joint stands at a mixed vertex. */
  readonly rank: number;
  /** A post stands in a straight run (wood, thatch), or the pattern bridges it (stone, metal). */
  readonly runPost: boolean;
  /** Half the width of the tier's square joint, in metres. */
  readonly jointHalf: number;
  /** The colour of each material where it is drawn flat, and of the tones only flat levels have. */
  readonly tones: Readonly<Record<string, readonly [number, number, number]>>;
  /** Level `level` of a form, or null past its last. */
  split(name: string, form: FormDef, level: number): Shape | null;
  /**
   * What is drawn where its pieces meet and is no piece, each by its name with every level: `joint_sq`, `joint_r15`,
   * `joint_r21`, `skirt`, `ridge`, `eave`, `hip` and `saddle`, as client/core/render/trims.ts finds them. A trim is cut nowhere.
   */
  trims?(): Record<string, Shape[]>;
}

/** Where a form yields: the planes, as an axis of the recipe's frame and a place on it, a ring of vertices lies in. */
export function yieldPlanes(form: FormDef): [axis: number, at: number][] {
  if (!(form.yieldBand > 0)) return [];
  const [u0, v0, u1, v1] = outlineBox(form);
  // A recipe's x is the form's, about its collider's origin; its y is the form's z turned about.
  if (form.plane === "upright") return [[0, u0 - form.at[0] + form.yieldBand], [0, u1 - form.at[0] - form.yieldBand]];
  if (form.plane === "across" || form.outline.length !== 4) return [];
  return [[0, u0 - form.at[0] + form.yieldBand], [0, u1 - form.at[0] - form.yieldBand], [1, -(v0 - form.at[2] + form.yieldBand)], [1, -(v1 - form.at[2] - form.yieldBand)]];
}

/** A flat form's outline in the recipe's frame, about its collider's origin: (x, y) corners going round against the clock as seen from above. */
export const planOf = (form: FormDef): Flat[] => form.outline.map(([u, v]): Flat => [u - form.at[0], -(v - form.at[2])]);

/**
 * Where a flat form that is no rectangle yields: the upright plane a ring lies in, the yield band in from each side of
 * its outline, side k from corner k to the next. A triangle's three, which run along no axis.
 */
export function yieldSlants(form: FormDef): Plane[] {
  if (!(form.yieldBand > 0) || form.plane !== "flat" || form.outline.length === 4) return [];
  const plan = planOf(form);
  return plan.map((a, k) => planeMoved(uprightPlane(a, plan[(k + 1) % plan.length]!), -form.yieldBand));
}

/** Every level of a form as the recipe builds it, the textured ones cut where the form yields. */
export function levelsOf(recipe: TierRecipe, name: string, form: FormDef): Shape[] {
  const out: Shape[] = [];
  for (let level = 0; ; level++) {
    const shape = recipe.split(name, form, level);
    if (!shape) break;
    if (level < TEXTURED) for (const [axis, at] of yieldPlanes(form)) shape.cut(axis, at);
    const slants = level < TEXTURED ? yieldSlants(form) : [];
    for (const plane of slants) slice(shape, plane);
    // Rings that cross a hair apart near a corner leave points a hair apart: a fifth of a millimetre is one point.
    if (slants.length > 0) tidy(shape, 2e-4, slants);
    out.push(shape);
  }
  if (out.length < 2 || out.length > LEVEL_ERRORS.length + 1) throw new Error(`${recipe.name} ${name}: ${out.length} levels`);
  return out;
}

/** Metres a form's level after the finest is stated to lie from it: the recipe's own word for it, or the level's usual. */
export const errorOf = (shape: Shape, level: number): number => shape.error ?? LEVEL_ERRORS[level - 1]!;

/** What each of a form's levels after the finest states, for a tier's asset to tell the check. */
export function statedErrors(recipe: TierRecipe, name: string, form: FormDef): number[] {
  return levelsOf(recipe, name, form).slice(1).map((shape, k) => errorOf(shape, k + 1));
}

/** The levels with no materials, each face in its tone: what a test of shape needs, and no pictures. */
export function flatLevels(recipe: TierRecipe, name: string, form: FormDef, palette: Uint8Array): SourceLod[] {
  const colour = (mat: string): number => nearestColour(palette, ...(recipe.tones[mat] ?? recipe.tones[mat.replace(/_b$/, "")]!) as [number, number, number]);
  return levelsOf(recipe, name, form).map((shape, level) => ({ ...shape.lod(null, colour), ...(level > 0 ? { error: errorOf(shape, level) } : {}) }));
}

/** The box a form's collider fills about its own origin, in the engine's frame: least x, y, z and most. */
export function colliderBox(form: FormDef): [number, number, number, number, number, number] {
  const b = formBounds(form);
  return [b[0] - form.at[0], b[1] - form.at[1], b[2] - form.at[2], b[3] - form.at[0], b[4] - form.at[1], b[5] - form.at[2]];
}
