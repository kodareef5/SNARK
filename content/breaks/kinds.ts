// The kit's broken forms as content: for each breaking shape, each form but whole in each variant is a shape and a static
// kind. A form has no finish: every finish of a shape shares its forms, and a broken piece keeps the finish and material
// of the kind the map placed in its slot. A form is written in its whole piece's own frame, so a swap in place moves nothing.

import { BREAK_FORMS } from "../../shared/content/breaks.ts";
import { shapeHalf, type Def, type ShapeDef, type StructureDef } from "../../shared/content/defs.ts";
import { RUIN_FINISHES, RUIN_SHAPES, type RuinShape } from "../ruins.ts";
import { shapeBreaks, type FormName } from "./families.ts";
import type { Form } from "./forms.ts";
import { KIT } from "./kit.ts";

/** A form's word in an id. */
const WORDS: Readonly<Record<FormName, string>> = { whole: "whole", "breach A": "a", "breach B": "b", open: "open", hung: "hung", heap: "heap" };

// These ids sort after every id there was, so no index moves and a map built before them keeps its kinds.
/** The kind a breaking shape is in `form` (not whole) and `variant`. */
export const breakKind = (shape: string, form: FormName, variant: number): string => `core:zzzzzzbreak_${shape}_${WORDS[form]}_${variant}`;
const breakShape = (shape: string, form: FormName, variant: number): string => `core:zzzzzzbreakshape_${shape}_${WORDS[form]}_${variant}`;

/** A form's own colour, before a piece's finish dyes it: a break's bared core. */
const CORE = RUIN_FINISHES.fracture;

/** Whether a form is drawn as exactly what is solid of it: the same plain boxes. Then its shape needs no look. */
function drawnAsSolid(form: Form): boolean {
  const { look, walked } = form;
  if (look.chunks.length > 0 || walked.hulls.length > 0 || look.boxes.length !== walked.boxes.length || look.boxes.some((b) => b.color !== undefined)) return false;
  const solid = new Set(walked.boxes.map((b) => [...b.at, ...b.half].join(" ")));
  return look.boxes.every((b) => solid.has([...b.at, ...b.half].join(" ")));
}

function defsOf(shape: string, form: Form, variant: number): [ShapeDef, StructureDef] {
  const hulls = form.look.chunks.map((c) => ({ corners: c.corners }));
  const made: ShapeDef = {
    type: "shape", id: breakShape(shape, form.name, variant), role: "thing", boxes: form.walked.boxes,
    ...(form.walked.hulls.length > 0 ? { hulls: form.walked.hulls } : {}),
    ...(drawnAsSolid(form) ? {} : { look: { ...(form.look.boxes.length > 0 ? { boxes: form.look.boxes } : {}), ...(hulls.length > 0 ? { hulls } : {}) } }),
  };
  const { family, halves } = shapeBreaks(shape, RUIN_SHAPES[shape as RuinShape]);
  const kind: StructureDef = {
    // A form's health is its row's, which a swap keeps: a form kind has none of its own, nor a material.
    type: "structure", class: "static", id: breakKind(shape, form.name, variant), mesh: "shape", shape: made.id, half: shapeHalf(made.boxes, made.hulls, made.look),
    color: CORE.color, under: CORE.under, hp: 1, breaks: { set: shape, form: form.name, variant, family, halves, bears: form.bears },
  };
  return [made, kind];
}

/** Every form's shape and kind, made from the kit. What leaves a piece is not made here (leaves.ts makes it when asked). */
export const breakBlocks = (): Def[] => KIT.flatMap((kit) => kit.all(true).flatMap((forms, variant) => forms.filter((f) => f.name !== BREAK_FORMS[0]).flatMap((f) => defsOf(kit.name, f, variant))));

/** Made once, when content is loaded. */
export const BREAK_BLOCKS: readonly Def[] = breakBlocks();
