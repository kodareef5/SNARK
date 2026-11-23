// What each shape of the ruin kit does in a building, and so how it breaks: its family, its halves, how tough it is and
// which of its forms still bear. This file reads no shape, so content/ruins.ts may read it.

import { BREAK_VARIANTS, type BreakFamily, type BreakForm } from "../../shared/content/breaks.ts";
import type { RuinShape } from "../ruins.ts";

export type Family = BreakFamily;
export type FormName = BreakForm;
export const VARIANTS = BREAK_VARIANTS;

interface Rule {
  /** Health is a material's for one half, times the halves, times this. */
  readonly tough: number;
  /** Whether it holds up what rests on it when whole, with a half breached, and opened. Hung or heaped, nothing does. */
  readonly bears: readonly [whole: boolean, breached: boolean, open: boolean];
}

const NEVER = [false, false, false] as const, TO_OPEN = [true, true, false] as const, ALWAYS = [true, true, true] as const;

export const FAMILY_RULES: Readonly<Record<Family, Rule>> = {
  slab: { tough: 1.5, bears: TO_OPEN }, pier: { tough: 3, bears: TO_OPEN }, beam: { tough: 2, bears: TO_OPEN }, wall: { tough: 1.5, bears: TO_OPEN },
  bar: { tough: 1, bears: NEVER }, panel: { tough: 1, bears: NEVER }, window: { tough: 1, bears: NEVER }, curtain: { tough: 1, bears: NEVER },
  clad: { tough: 1, bears: NEVER }, balcony: { tough: 1, bears: NEVER }, roof: { tough: 1, bears: NEVER }, interior: { tough: 1, bears: NEVER },
  parapet: { tough: 0.5, bears: NEVER },
  // A shop's half piers and head, and a garage deck's columns, stand whatever is broken between them.
  store: { tough: 1, bears: ALWAYS }, deck: { tough: 1.5, bears: ALWAYS },
  // Four storeys of wall in one piece, which stays solid when opened.
  shell: { tough: 4, bears: ALWAYS },
  none: { tough: 1, bears: NEVER },
};

const each = <F extends Family>(family: F, names: readonly RuinShape[]): Partial<Record<RuinShape, Family>> => Object.fromEntries(names.map((n) => [n, family]));

/** The family of every shape that breaks. A stair, a ramp, a road, the street, a plant, a wreck and the hand-made breaks are "none". */
const BREAKING: Partial<Record<RuinShape, Family>> = {
  ...each("slab", ["floor4", "floor8", "floor16", "zroof8", "zroof16", "zbalcony"]),
  ...each("pier", ["pier4", "pier8", "pier16"]),
  ...each("beam", ["beam4", "beam8", "beam16", "zheader"]),
  ...each("bar", ["sill4", "sill8", "fin4", "fin8", "fin16", "trim4", "trim8"]),
  // A ground floor of flats is a wall its building stands on.
  ...each("wall", ["wall4", "wall8", "zlobby"]),
  ...each("panel", ["zpanel8", "zpanel16", "zpaneltop"]),
  ...each("parapet", ["zparapet8", "zattic", "zstepup", "zscreen"]),
  ...each("window", ["zwin", "zwintop", "zbalcbare"]),
  ...each("store", ["zstore", "zstorecut", "zstorecutl", "zshutter", "zgate", "zentry"]),
  ...each("curtain", ["zcurt", "zcurttop"]),
  ...each("clad", ["zclad", "zcladl", "zcladc", "zplant", "zplanttop"]),
  ...each("balcony", ["zbalc", "zbalctop", "zbalcrail"]),
  ...each("deck", ["zdeck", "zdecktop"]),
  ...each("roof", ["zpitch4", "zpitch8", "zpitch16"]),
  ...each("shell", ["zshaft8", "zshaft16", "zshafttop", "zwin4", "zwin4top", "zcurt4", "zcurt4top", "zclad4", "zclad4l", "zclad4c", "zclad4top", "zbalc4", "zbalc4top"]),
  ...each("interior", ["zpartition", "zdoorpost", "zcover", "zcounter", "zbed"]),
};

export const familyOf = (shape: string): Family => BREAKING[shape as RuinShape] ?? "none";
export const BREAKING_SHAPES = Object.keys(BREAKING) as readonly RuinShape[];

/**
 * How many halves a shape of `size` (full metres) has. A piece longer than 4 m has two; a pier has its lower and its upper,
 * and a pitched roof its two slopes, whatever their size.
 */
export function halvesOf(family: Family, size: readonly [number, number, number]): 1 | 2 {
  return family === "pier" || family === "roof" || Math.max(size[0], size[1], size[2]) > 4.01 ? 2 : 1;
}

export interface ShapeBreaks {
  readonly family: Family;
  readonly halves: 1 | 2;
  readonly tough: number;
  readonly bears: Rule["bears"];
}

/** What the family table says of a shape of `size`. */
export function shapeBreaks(shape: string, size: readonly [number, number, number]): ShapeBreaks {
  const family = familyOf(shape);
  return { family, halves: halvesOf(family, size), ...FAMILY_RULES[family] };
}

/** Whether `form` of a family still bears. */
export function formBears(family: Family, form: FormName): boolean {
  const [whole, breached, open] = FAMILY_RULES[family].bears;
  return form === "whole" ? whole : form === "open" ? open : form === "hung" || form === "heap" ? false : breached;
}
