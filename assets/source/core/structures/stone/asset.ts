// The stone tier's building pieces, made by the stone recipe (tools/pack/pieces/stone.ts) from the forms content places
// and the forms to come, and its trims: the quoin and the piers at corners, the skirt, the ridge, the hip and its saddle. `bun run art --
// core:stone` builds them with no Blender. Each replaces the grey box of the structure with its id; a form no kind
// uses yet and a trim are in the pack for the lanes that draw them.
// layout.py, parts.py and model.py are what the recipe was ported from, kept until every tier is made this way; the
// textures in tex/ are painted to layout.py's patterns, which the recipe lays joint for joint.

import { ALL_FORMS } from "../../../../../content/building/forms.ts";
import type { FormDef } from "../../../../../shared/world/lattice/forms.ts";
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../../../../tools/art/check.ts";
import { errorOf, statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { STONE } from "../../../../../tools/pack/pieces/stone.ts";
import { bakeTier } from "../../../../../tools/pack/pieces/tier.ts";

/** Each of the tier's materials is a whole layer set under tex/, and spans one building span, 3 m, on the grid. */
const material = (name: string): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  tiles: 3,
});

// By the names the recipe gives them. The first three levels are drawn with them, the rest flat.
const MATERIALS = { masonry: material("masonry"), flags: material("flags"), dressed: material("dressed"), timber: material("timber"), iron: material("iron") };
const TOP = 2048;

// Every row by its name: the nine, the 25 past them, and the leaves stood open with the double door.
const ALL: Readonly<Record<string, FormDef>> = ALL_FORMS;

export default {
  kind: "pieces",
  source: { bake: () => bakeTier(STONE, ALL, import.meta.dir, MATERIALS, TOP, true) },
  // Each level is built for its distance and states how far it lies from the finest; the check prints what it measures.
  pieces: [
    ...Object.entries(ALL).map(([name, form]) => ({ id: `core:${name}_stone`, object: name, errors: statedErrors(STONE, name, form) })),
    ...Object.entries(STONE.trims!()).map(([name, shapes]) => ({ id: `core:${name}_stone`, object: name, errors: shapes.slice(1).map((shape, k) => errorOf(shape, k + 1)), triangles: TRIM_TRIANGLES[name]!, ...(shapes[3]!.triangles < 4 ? { open: 3 } : {}) })),
  ],
  materials: MATERIALS,
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most), texture: { top: TOP, megabytes: 80 } },
} satisfies PiecesAsset;
