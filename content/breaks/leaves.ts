// What leaves a piece on its way from whole into a broken form, and how a form's convex parts are coloured. A client
// reads these to throw fragments and to draw a bared face as core. They are no part of a definition, so the content hash
// does not cover them and loading content does not make them: a shape's are made when first asked for, from the same
// cut that made its kinds.

import { BREAK_FORMS, type BreakForm } from "../../shared/content/breaks.ts";
import type { ShapeBox } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { hullOf } from "../../shared/world/convex.ts";
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
  return form === 0 ? null : [reg.breakShape[kind]!, BREAK_FORMS[form]!, reg.breakVariant[kind]!];
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

/** The whole piece's solid boxes of `shape`, in its own frame, by which a bared face is told from skin; null for a shape that does not break. */
export const skinOf = (shape: string): readonly ShapeBox[] | null => kitOf(shape)?.skin ?? null;

/** How near a box's surface a point is taken to be on it, in metres. */
const ON_SKIN = 0.003;

/** Whether (x, y, z) is on the surface of one of the whole piece's boxes `skin`. */
export function onSkin(x: number, y: number, z: number, skin: readonly ShapeBox[]): boolean {
  for (const b of skin) {
    const dx = Math.abs(x - b.at[0]) - b.half[0], dy = Math.abs(y - b.at[1]) - b.half[1], dz = Math.abs(z - b.at[2]) - b.half[2];
    if (dx <= ON_SKIN && dy <= ON_SKIN && dz <= ON_SKIN && (Math.abs(dx) <= ON_SKIN || Math.abs(dy) <= ON_SKIN || Math.abs(dz) <= ON_SKIN)) return true;
  }
  return false;
}

/**
 * Which faces of `chunk` show the bared core, a bit a face in the order hullOf gives its rings: those of a bared chunk
 * whose middle is not on the whole piece's surface `skin`. 0 for a chunk that is not bared.
 */
export function coreFaces(chunk: Chunk, skin: readonly ShapeBox[]): number {
  if (!chunk.bare) return 0;
  const hull = hullOf({ corners: chunk.corners });
  if (typeof hull === "string") return 0;
  let bits = 0;
  hull.rings.forEach((ring, f) => {
    let x = 0, y = 0, z = 0;
    for (const c of ring) {
      const p = chunk.corners[c]!;
      x += p[0] / ring.length;
      y += p[1] / ring.length;
      z += p[2] / ring.length;
    }
    if (!onSkin(x, y, z, skin)) bits |= 1 << f;
  });
  return bits >>> 0;
}

/** How a form's convex parts are painted, in the order of its shape's `look.hulls`: a colour of its own or 0, and its faces that show the core (coreFaces). */
export interface Paint {
  readonly color: Uint8Array;
  readonly core: Uint32Array;
}

/** The paint of the look of `shape` in `form` and `variant`, or null where the shape has no such form. */
export function breakPaint(shape: string, form: BreakForm, variant: number): Paint | null {
  const f = formOf(shape, form, variant), skin = skinOf(shape);
  if (!f || !skin) return null;
  return { color: Uint8Array.from(f.look.chunks, (c) => c.color ?? 0), core: Uint32Array.from(f.look.chunks, (c) => coreFaces(c, skin)) };
}

/** The paint of form kind `kind`'s look, or null for a kind that is no broken form. */
export function paintOf(reg: Registry, kind: number): Paint | null {
  const at = formAt(reg, kind);
  return at && breakPaint(...at);
}
