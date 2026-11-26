// Every hair and beard style as meshes for one fitted body: "<id>/hair/<style>" and its under-hat form
// "<id>/hair/<style>/under-hat", and "<id>/beard/<style>". tools/art/human.ts calls it once a sex.

import { HUMAN } from "../../../../../shared/anim/human.ts";
import { BEARD_STYLES, HAIR_STYLES } from "../../../../../shared/anim/look.ts";
import { pooled, type CookMaterial } from "../../../../../tools/pack/body.ts";
import { spanOf } from "../../../../../tools/pack/surface.ts";
import type { SourceMesh } from "../../../../../tools/pack/write.ts";
import { PART_NAMES, type FittedBody } from "../../../../../tools/makehuman/fit.ts";
import { formLevels, type Budgets, type Form } from "./build.ts";
import { anglesOf, headOf, type Head, type Vec } from "./head.ts";
import { beardStyles, hairStyles } from "./styles.ts";

/** Most triangles at each level, the finest holding the core and cards; the last is the boot file's. */
export const HAIR_BUDGETS: Budgets = { levels: [1400, 300, 64, 20], core: 0.45, flat: 2 };

/** The suffix of a style's under-hat form's mesh id. */
export const UNDER_HAT = "under-hat";

/** The polar angle of the mouth from the head's centre, in degrees: where the front teeth meet, brought out to the lips. */
function mouthOf(f: FittedBody, head: Head): number {
  const teeth = PART_NAMES.indexOf("teeth");
  const front: Vec[] = [];
  let most = -Infinity;
  for (let t = 0; t < f.indices.length / 3; t++) if (f.part[t] === teeth) for (let k = 0; k < 3; k++) most = Math.max(most, f.positions[f.indices[t * 3 + k]! * 3 + 2]!);
  for (let t = 0; t < f.indices.length / 3; t++) if (f.part[t] === teeth) for (let k = 0; k < 3; k++) {
    const v = f.indices[t * 3 + k]!;
    if (f.positions[v * 3 + 2]! > most - 0.008) front.push([f.positions[v * 3]!, f.positions[v * 3 + 1]!, f.positions[v * 3 + 2]!]);
  }
  const mean = [0, 1, 2].map((a) => front.reduce((s, p) => s + p[a]!, 0) / front.length);
  return (anglesOf(head.centre, [mean[0]!, mean[1]!, mean[2]! + 0.015])[0] * 180) / Math.PI;
}

export interface HairMade {
  meshes: SourceMesh[];
  lines: string[];
}

/**
 * The hair and beards of the body `f` is, for mesh ids under `id`, drawn with `core` and `cards`, `levels` triangles a
 * level and flat from `flat` on (asset.ts gives them; HAIR_BUDGETS where not).
 */
export function hairMeshes(f: FittedBody, sex: number, id: string, rig: string, core: CookMaterial, cards: CookMaterial, levels = HAIR_BUDGETS.levels, flat = HAIR_BUDGETS.flat): HairMade {
  const budgets: Budgets = { ...HAIR_BUDGETS, levels, flat };
  const head = headOf(f, sex);
  const { materials, textures } = pooled([core, cards]);
  const meshes: SourceMesh[] = [];
  const lines: string[] = [];
  const make = (meshId: string, form: Form): void => {
    const lods = formLevels(form, budgets, head.centre);
    const own = materials.map((m) => ({ ...m }));
    own.forEach((m, k) => {
      if (m.span === 0) m.span = spanOf(lods[0]!, k);
    });
    meshes.push({ id: meshId, lods, skeleton: HUMAN.id, rig, flat: budgets.flat, materials: own, textures });
    lines.push(`${meshId}: triangles ${lods.map((l) => l.indices.length / 3).join(" ")}`);
  };
  const hair = hairStyles(head);
  for (const style of HAIR_STYLES) {
    if (!style.drawn) continue;
    const forms = hair[style.id];
    if (!forms) throw new Error(`hair style "${style.id}" is in shared/anim/look.ts and not made in assets/source/core/humans/hair/styles.ts`);
    make(`${id}/hair/${style.id}`, forms.worn);
    make(`${id}/hair/${style.id}/${UNDER_HAT}`, forms.hat);
  }
  const beards = beardStyles(head, mouthOf(f, head));
  for (const style of BEARD_STYLES) {
    if (!style.drawn) continue;
    const form = beards[style.id];
    if (!form) throw new Error(`beard style "${style.id}" is in shared/anim/look.ts and not made in assets/source/core/humans/hair/styles.ts`);
    make(`${id}/beard/${style.id}`, form);
  }
  return { meshes, lines };
}
