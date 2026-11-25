// The thatch tier's building pieces, made by the thatch recipe (tools/pack/pieces/thatch.ts) from the forms content
// places and its share of the forms to come, and its trims: the pole at a corner, the skirt and the ridge's roll.
// `bun run art -- core:thatch` builds them with no Blender. Each replaces the grey box of the structure with its id; a
// form no kind uses yet and a trim are in the pack for the lanes that draw them.
// model.py, pieces.py and kit.py are what the recipe was ported from, kept until every tier is made this way.

import { FORMS, PLANNED_FORMS } from "../../../../../content/building/forms.ts";
import type { FormDef } from "../../../../../shared/world/lattice/forms.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../../../../tools/art/check.ts";
import type { MaterialSpec, PiecesAsset } from "../../../../../tools/art/spec.ts";
import { errorOf, statedErrors } from "../../../../../tools/pack/pieces/lod.ts";
import { THATCH, THATCH_FORMS, THATCH_PLANNED, THATCH_POSTED, THATCH_SOLIDS } from "../../../../../tools/pack/pieces/thatch.ts";
import { bakeTier } from "../../../../../tools/pack/pieces/tier.ts";
import type { SourceMesh } from "../../../../../tools/pack/write.ts";

/** A whole layer set under tex/<name>/. */
const picture = (name: string, more: Partial<MaterialSpec> = {}): MaterialSpec => ({
  base: `tex/${name}/${name}_base.png`,
  normal: `tex/${name}/${name}_normal.png`,
  packed: `tex/${name}/${name}_orm.png`,
  height: `tex/${name}/${name}_height.png`,
  ...more,
});

// By the names the recipe gives them. The wall and door pictures are painted to their pieces and wrap only across, and
// the wood is a sheet of bands, each wrapping on itself, so those three say nothing of tiling. Thatch and door are cut
// out where their alpha says and drawn from one side: the recipe gives every sheet of tips a back of its own.
const MATERIALS = {
  thatch: picture("thatch", { cutout: true }),
  door: picture("door", { cutout: true }),
  // Drawn flat in bark, which most poles wear: the sheet's mean takes in its pale cord and peeled bands.
  wood: picture("wood", { flat: [116, 72, 42] }),
  roof: picture("roof", { tiles: 3 }),
  // The mats' mean lands on an olive tone; this is the tan straw nearest it.
  floor: picture("floor", { tiles: 3, flat: [176, 130, 81] }),
  earth: picture("earth", { tiles: 1.5 }),
};
const TOP = 2048;
const THATCHED: Readonly<Record<string, FormDef>> = Object.fromEntries([...THATCH_FORMS.map((name) => [name, FORMS[name]] as const), ...THATCH_PLANNED.map((name) => [name, PLANNED_FORMS[name]] as const)]);

/**
 * The tier's meshes for `forms`, and its trims with them where asked; with `posts`, as its walls were before joints
 * were drawn. The bodies of thatch and of the door are their
 * cut-out pictures drawn whole: each is a material of its own that names its twin's textures, so a pack holds the
 * pictures once and only the tips are drawn cut out.
 */
export function bakeThatch(forms: Readonly<Record<string, FormDef>>, trims = false, posts = false): SourceMesh[] {
  const solids = Object.fromEntries(Object.entries(THATCH_SOLIDS).map(([solid, twin]) => [solid, { ...MATERIALS[twin as keyof typeof MATERIALS], cutout: false }]));
  const meshes = bakeTier(posts ? THATCH_POSTED : THATCH, forms, import.meta.dir, { ...MATERIALS, ...solids }, TOP, trims);
  for (const mesh of meshes) {
    for (const t of mesh.textures ?? []) for (const [solid, twin] of Object.entries(THATCH_SOLIDS)) t.id = t.id.replace(`core:thatch/${solid}/`, `core:thatch/${twin}/`);
  }
  return meshes;
}

export default {
  kind: "pieces",
  source: { bake: () => bakeThatch(THATCHED, true) },
  // Each level is built for its distance and states how far it lies from the finest; the check prints what it measures.
  pieces: [
    ...Object.entries(THATCHED).map(([name, form]) => ({ id: `core:${name}_thatch`, object: name, errors: statedErrors(THATCH, name, form) })),
    ...Object.entries(THATCH.trims!()).map(([name, shapes]) => ({ id: `core:${name}_thatch`, object: name, errors: shapes.slice(1).map((shape, k) => errorOf(shape, k + 1)), triangles: TRIM_TRIANGLES[name]!, ...(shapes[3]!.triangles < 4 ? { open: 3 } : {}) })),
  ],
  materials: MATERIALS,
  // Six materials, since each piece is made of its own thing: 13.3 MB each at the top size, a quarter of that on medium.
  budgets: { triangles: MADE_PIECE_TRIANGLES.map(([, most]) => most), texture: { top: TOP, megabytes: 80 } },
} satisfies PiecesAsset;
