// The wood tier's building pieces, made by the wood recipe (tools/pack/pieces/wood.ts) from the forms content places:
// `bun run art -- core:wood` builds them with no Blender. Each replaces the grey box of the structure with its id.
// model.py and parts.py are what the recipe was ported from, kept until every tier is made this way.

import { FORMS } from "../../../../../content/building/forms.ts";
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import { MADE_PIECE_TRIANGLES } from "../../../../../tools/art/check.ts";
import { statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
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

export default {
  kind: "pieces",
  source: { bake: () => bakeTier(WOOD, FORMS, import.meta.dir, MATERIALS, TOP) },
  // Each level is built for its distance and states how far it lies from the finest; the check prints what it measures.
  pieces: Object.entries(FORMS).map(([name, form]) => ({ id: `core:${name}_wood`, object: name, errors: statedErrors(WOOD, name, form) })),
  materials: MATERIALS,
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most), texture: { top: TOP, megabytes: 64 } },
} satisfies PiecesAsset;
