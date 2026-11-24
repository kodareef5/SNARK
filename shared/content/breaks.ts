// How a city piece breaks, as the registry holds it: a piece is whole or in one of five broken forms, each cut in four
// variants, and each form in each variant is a kind of its own. The kinds of one shape share a break set.

import type { Registry } from "./registry.ts";

/** A piece's forms. Their order is their number in the registry's columns. */
export const BREAK_FORMS = ["whole", "breach A", "breach B", "open", "hung", "heap"] as const;
export type BreakForm = (typeof BREAK_FORMS)[number];
export const FORM_WHOLE = 0, FORM_BREACH_A = 1, FORM_BREACH_B = 2, FORM_OPEN = 3, FORM_HUNG = 4, FORM_HEAP = 5;

/** Variants a form is cut in. A piece's place picks one, so neighbours are not alike. */
export const BREAK_VARIANTS = 4;

/**
 * What a piece does in its building. Their order is their number in the registry's column, and 0 is a piece that never
 * breaks. A wreck is no building's: a street's car, which a survivor salvages (StructureDef.salvage).
 */
export const BREAK_FAMILIES = ["none", "slab", "pier", "beam", "bar", "wall", "panel", "parapet", "window", "store", "curtain", "clad", "balcony", "deck", "roof", "shell", "interior", "wreck"] as const;
export type BreakFamily = (typeof BREAK_FAMILIES)[number];

/**
 * The kind a piece of `kind` is in `form` and `variant`, or 0 where its shape has no such form. `kind` may be the kind a
 * map placed or any form of it. A form kind has no whole of its own, as every finish of a shape shares its forms: the
 * whole is the kind the map placed in the slot.
 */
export function formKind(reg: Registry, kind: number, form: number, variant: number): number {
  const table = reg.formKinds[kind];
  if (!table || !(form >= 0 && form < BREAK_FORMS.length)) return 0;
  if (form === FORM_WHOLE) return reg.breakForm[kind] === FORM_WHOLE ? kind : 0;
  return table[form * BREAK_VARIANTS + (variant & (BREAK_VARIANTS - 1))]!;
}

/** The heap a fallen piece of `kind` becomes where it stood, or 0 for a piece that leaves none. */
export const heapKind = (reg: Registry, kind: number, variant: number): number => formKind(reg, kind, FORM_HEAP, variant);
