// What leaves a piece on its way from whole into a broken form, and how a form's convex parts are coloured. A client
// reads these to throw fragments and to draw a bared face as core. They are no part of a definition, so the content hash
// does not cover them and loading content does not make them: a shape's are made when first asked for, from the same
// cut that made its kinds.

import { BREAK_FORMS, type BreakForm } from "../../shared/content/breaks.ts";
import type { ShapeBox } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Chunk } from "./cut.ts";
import type { Form } from "./forms.ts";
import { kitOf } from "./kit.ts";

export interface Leaves {
  /** The things that leave, each rigid: its convex chunks in the whole piece's frame. A chunk may have a colour of its own, and is `bare` where it was cut from the piece's core. */
  readonly things: readonly (readonly Chunk[])[];
  /** Panes that go. They have no pieces: particles fall from their boxes. */
  readonly panes: readonly ShapeBox[];
}

/** How one convex part of a form's look is drawn: in a colour of its own, or the piece's; `bare` where a cut made it. */
export interface PartLook {
  readonly color?: number;
  readonly bare?: boolean;
}

const made = new Map<string, readonly (readonly Form[])[]>();

function formOf(shape: string, form: BreakForm, variant: number): Form | undefined {
  let all = made.get(shape);
  if (!all) {
    const kit = kitOf(shape);
    if (!kit) return undefined;
    made.set(shape, (all = kit.all()));
  }
  return all[variant]?.find((f) => f.name === form);
}

/** What leaves a piece of `shape` on the way into `form` from whole, or null where the shape has no such form. */
export function breakLeaves(shape: string, form: BreakForm, variant: number): Leaves | null {
  const f = formOf(shape, form, variant);
  return f ? { things: f.fragments, panes: f.panes } : null;
}

/** How each convex part of the look of `form` is drawn, in the order of its shape's `look.hulls`, or null. */
export function breakLook(shape: string, form: BreakForm, variant: number): readonly PartLook[] | null {
  const f = formOf(shape, form, variant);
  return f ? f.look.chunks.map((c): PartLook => ({ ...(c.color !== undefined ? { color: c.color } : {}), ...(c.bare ? { bare: true } : {}) })) : null;
}

/** The shape, form and variant a form kind is, as the functions above take them, or null for a kind that is no broken form. */
function formAt(reg: Registry, kind: number): readonly [string, BreakForm, number] | null {
  const form = reg.breakForm[kind] ?? 0;
  return form === 0 ? null : [reg.breakSets[reg.breakSet[kind]!]!, BREAK_FORMS[form]!, reg.breakVariant[kind]!];
}

/** What left a piece that is now of form kind `kind`. */
export function leavesOf(reg: Registry, kind: number): Leaves | null {
  const at = formAt(reg, kind);
  return at && breakLeaves(...at);
}

/** How the convex parts of form kind `kind` are drawn. */
export function lookOf(reg: Registry, kind: number): readonly PartLook[] | null {
  const at = formAt(reg, kind);
  return at && breakLook(...at);
}
