// The wood tier's building pieces, made by the wood recipe (tools/pack/pieces/wood.ts) from the forms content places
// and the forms to come, and its trims: the joints at corners, the skirt and the ridge. `bun run art -- core:wood`
// builds them with no Blender. Each replaces the grey box of the structure with its id; a form no kind uses yet and
// a trim are in the pack for the lanes that draw them.
// model.py and parts.py are what the recipe was ported from, kept until every tier is made this way.

import { FORMS, PLANNED_FORMS } from "../../../../../content/building/forms.ts";
import type { FormDef } from "../../../../../shared/world/lattice/forms.ts";
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../../../../tools/art/check.ts";
import { errorOf, statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { bakeTier } from "../../../../../tools/pack/pieces/tier.ts";
import { WOOD } from "../../../../../tools/pack/pieces/wood.ts";

/** A whole layer set under tex/<name>/, made by the image model from the briefs beside it. */
const material = (name: string, tiles?: number): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  ...(tiles ? { tiles } : {}),
});

// By the names the recipe gives them. Boards, deck and timber tile every 3 m; fittings is a sheet of parts laid one by
// one, 1 m across, so its span is measured on the meshes. The first three levels are drawn with them, the rest flat.
const MATERIALS = { boards: material("boards", 3), deck: material("deck", 3), timber: material("timber", 3), fittings: material("fittings") };
const TOP = 2048;

const ALL: Readonly<Record<string, FormDef>> = { ...FORMS, ...PLANNED_FORMS };

export default {
  kind: "pieces",
  source: { bake: () => bakeTier(WOOD, ALL, import.meta.dir, MATERIALS, TOP, true) },
  // Each level is built for its distance and states how far it lies from the finest; the check prints what it measures.
  pieces: [
    ...Object.entries(ALL).map(([name, form]) => ({ id: `core:${name}_wood`, object: name, errors: statedErrors(WOOD, name, form) })),
    ...Object.entries(WOOD.trims!()).map(([name, shapes]) => ({ id: `core:${name}_wood`, object: name, errors: shapes.slice(1).map((shape, k) => errorOf(shape, k + 1)), triangles: TRIM_TRIANGLES[name]!, ...(shapes[3]!.triangles < 4 ? { open: 3 } : {}) })),
  ],
  materials: MATERIALS,
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most), texture: { top: TOP, megabytes: 64 } },
} satisfies PiecesAsset;
