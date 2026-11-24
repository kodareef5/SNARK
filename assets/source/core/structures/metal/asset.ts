// The metal tier's building pieces, made by the metal recipe (tools/pack/pieces/metal.ts) from the forms content places:
// `bun run art -- core:metal` builds them with no Blender and no pictures. Each replaces the grey box of the structure
// with its id. Every level is flat: the plate's faces are the piece's own colour and wear the "plate" material the card
// makes from a recipe (content/texgen/materials.ts), the frame and the bolts are palette colours.

import { FORMS } from "../../../../../content/building/forms.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { MADE_PIECE_TRIANGLES } from "../../../../../tools/art/check.ts";
import { statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { METAL, bakeMetal } from "../../../../../tools/pack/pieces/metal.ts";

export default {
  kind: "pieces",
  source: { bake: () => bakeMetal(FORMS) },
  // Each level is built for its distance and states how far it lies from the finest; the check prints what it measures.
  pieces: Object.entries(FORMS).map(([name, form]) => ({ id: `core:${name}_metal`, object: name, errors: statedErrors(METAL, name, form) })),
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most) },
} satisfies PiecesAsset;
