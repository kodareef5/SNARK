// The metal tier's building pieces, made by the metal recipe (tools/pack/pieces/metal.ts) from the forms content places
// and the forms to come, and its trims: the joints at corners, the skirt and the ridge. `bun run art -- core:metal`
// builds them with no Blender and no pictures. Each replaces the grey box of the structure with its id; a form no kind
// uses yet and a trim are in the pack for the lanes that draw them. Every level is flat: the plate's faces are the
// piece's own colour and wear the "plate" material the card makes from a recipe (content/texgen/materials.ts), the
// frame and the bolts are palette colours.

import { FORMS, PLANNED_FORMS } from "../../../../../content/building/forms.ts";
import type { FormDef } from "../../../../../shared/world/lattice/forms.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../../../../tools/art/check.ts";
import { errorOf, statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { METAL, bakeMetal } from "../../../../../tools/pack/pieces/metal.ts";

const ALL: Readonly<Record<string, FormDef>> = { ...FORMS, ...PLANNED_FORMS };

export default {
  kind: "pieces",
  source: { bake: () => bakeMetal(ALL, true) },
  // Each level is built for its distance and states how far it lies from the finest; the check prints what it measures.
  pieces: [
    ...Object.entries(ALL).map(([name, form]) => ({ id: `core:${name}_metal`, object: name, errors: statedErrors(METAL, name, form) })),
    // A trim's last level is a sheet of two triangles where it is one, open where nothing sees it.
    ...Object.entries(METAL.trims!()).map(([name, shapes]) => ({ id: `core:${name}_metal`, object: name, errors: shapes.slice(1).map((shape, k) => errorOf(shape, k + 1)), triangles: TRIM_TRIANGLES[name]!, ...(shapes[3]!.triangles < 4 ? { open: 3 } : {}) })),
  ],
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most) },
} satisfies PiecesAsset;
