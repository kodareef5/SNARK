// Every cut on both bodies of a cooked pack: what the painter paints masks from and the cook cooks.

import { SEX_IDS } from "../../../../../shared/anim/look.ts";
import type { PackRig } from "../../../../../shared/pack/pack.ts";
import type { SourceMesh } from "../../../../../tools/pack/write.ts";
import { buildCut, type CutDef, type MadeCut, type Panel, type Rest } from "./build.ts";
import { BODY_CUTS, CLEAR, PANELS } from "./cuts.ts";
import { skinAt, type Skin } from "./skin.ts";

/** A body's skin at each of its levels. */
export const skinLevels = (meshes: readonly SourceMesh[], id: string): Skin[] => [0, 1, 2, 3].map((level) => skinAt(meshes, id, level));

/** The cuts made on one body, by name. */
export function cutsOn(levels: readonly Skin[], rest: Rest, defs: readonly CutDef[] = BODY_CUTS): Map<string, MadeCut> {
  const panels = new Map<string, Panel[]>();
  const out = new Map<string, MadeCut>();
  for (const def of defs) {
    if (!panels.has(def.sheet)) panels.set(def.sheet, PANELS[def.sheet](rest, levels[0]!));
    out.set(def.name, buildCut(def, rest, levels, panels.get(def.sheet)!, CLEAR));
  }
  return out;
}

/** Every cut on each body of `meshes`, by sex id ("m", "f") and cut. */
export function madeCuts(meshes: readonly SourceMesh[], rigs: readonly PackRig[]): Map<string, Map<string, MadeCut>> {
  const out = new Map<string, Map<string, MadeCut>>();
  for (const sex of SEX_IDS) {
    const rig = rigs.find((r) => r.id === `human_${sex}`);
    if (!rig) continue;
    out.set(sex, cutsOn(skinLevels(meshes, `core:human_${sex}`), rig.rest));
  }
  return out;
}
