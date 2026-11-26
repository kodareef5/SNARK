// The cuts as the human-bodies asset cooks them: one mesh a cut on each body, "<body>/garment/<cut>", drawn with one
// material, the cut's masks on that body over its sheet's weave; and those materials as the asset names them.

import { SEX_IDS } from "../../../../../shared/anim/look.ts";
import { CUTS, cutMesh } from "../../../../../shared/people/cuts.ts";
import type { MaterialSpec } from "../../../../../tools/art/spec.ts";
import type { ScriptedBody } from "../../../../../tools/pack/body.ts";
import type { SourceMesh } from "../../../../../tools/pack/write.ts";
import { MASK_SIDE } from "./paint.ts";
import { BODY_CUTS } from "./cuts.ts";
import { cutsOn, skinLevels } from "./make.ts";

/** A cut ready for the cook. */
export interface GarmentPiece {
  id: string;
  material: string;
  body: ScriptedBody;
  triangles: readonly number[];
  /** Its first flat level, where not the body's. */
  flat?: number;
  /** Where its print lies until moved, which its flat levels show a print's swatch on. */
  print: readonly [number, number, number, number];
  lines: string[];
}

/** A cut's material on a body, by the name asset.ts gives it. */
export const garmentMaterial = (cut: string, sex: string): string => `${cut}_${sex}`;

/** Every cut on the cooked body `id` ("core:human_m"), whose joints rest at `rest`. */
export function garmentPieces(meshes: readonly SourceMesh[], id: string, rest: ArrayLike<number>): GarmentPiece[] {
  const sex = id.slice(id.lastIndexOf("_") + 1);
  const made = cutsOn(skinLevels(meshes, id), rest);
  return BODY_CUTS.map((def) => {
    const m = made.get(def.name)!;
    const reach = Object.entries(m.reach).map(([hem, r]) => `${hem} ${r.map((x) => (x * 100).toFixed(1)).join("/")}`).join(", ");
    return { id: cutMesh(id, def.name), material: garmentMaterial(def.name, sex), body: m.body, triangles: CUTS[def.name]!.levels, flat: CUTS[def.name]!.flat, print: CUTS[def.name]!.print, lines: [...m.report, `${def.name}: past the hidden zones by, in cm at each body level: ${reach}`] };
  });
}

/** Every cut's material on each body: its masks, and its sheet's maps, which the first cut of the sheet owns and the others borrow. */
export function garmentMaterials(): Record<string, MaterialSpec> {
  const out: Record<string, MaterialSpec> = {};
  const owner = new Map<string, string>();
  for (const def of BODY_CUTS) for (const sex of SEX_IDS) {
    const sheet = CUTS[def.name]!.sheet;
    const name = garmentMaterial(def.name, sex);
    const lender = owner.get(sheet);
    if (!lender) owner.set(sheet, name);
    out[name] = {
      base: `garments/${sheet}-base.png`, normal: `garments/${sheet}-normal.png`, packed: `garments/${sheet}-orm.png`,
      regions: { mask: `garments/${def.name}-${sex}-mask.png`, mask2: `garments/${def.name}-${sex}-mask2.png` },
      tops: { mro: 512, mask: MASK_SIDE },
      ...(lender ? { borrows: { from: lender, roles: ["base", "normal", "mro"] as const } } : {}),
    };
  }
  return out;
}
