// The cloth and hide sets cooked again onto the bodies of a built human-bodies pack, alone: the rest of the pack as it
// was. A quick way to try a change to the refit before the whole cook (bun run art -- core:human-bodies), and to measure
// it (cloth-fit.ts --pack). Its grips and soles are the old pack's.
//
//   bun tools/art/armor-quick.ts [--pack FILE] [--out FILE]

import { readFileSync, writeFileSync } from "node:fs";
import { SEX_IDS } from "../../shared/anim/look.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { LAST_STEP, stepSize } from "../../shared/pack/texture.ts";
import { shiftAt } from "../pack/refit.ts";
import { buildPack, unpackMeshes } from "../pack/write.ts";
import { findAssets } from "./assets.ts";
import { armorField, armorSets, dressTailored, suitInMotion, suitLining } from "./human.ts";
import { describe, materialsOf } from "./materials.ts";
import type { HumanBodiesAsset } from "./spec.ts";

export async function armorQuick(pack: Uint8Array): Promise<{ pack: Uint8Array; lines: string[] }> {
  const asset = (await findAssets()).find((a) => a.id === "core:human-bodies")!;
  const spec = asset.spec as HumanBodiesAsset;
  const palette = defaultPalette();
  const wanted = new Set([...Object.values(spec.dressed), spec.tailored!.material]);
  const described = new Map(materialsOf(asset).filter((m) => wanted.has(m.name)).map((m) => [m.name, describe(m, stepSize(LAST_STEP), palette)]));
  const was = parsePack(pack);
  let meshes = unpackMeshes(was);
  const lines: string[] = [], warnings: string[] = [];
  const sets = spec.outfits.sets.map((s) => s.id);
  for (let sex = 0; sex < SEX_IDS.length; sex++) {
    const id = `core:human_${SEX_IDS[sex]}`;
    const body = meshes.filter((m) => /^core:human_[mf]\/(head|torso|hands|legs|feet)$/.test(m.id) && m.id.startsWith(id + "/"));
    const rest = was.header.rigs.find((r) => r.id === `human_${SEX_IDS[sex]}`)!.rest;
    const field = armorField(spec, sex, body, palette);
    const made = armorSets(spec, sex, rest, field, described, palette, lines, warnings, body);
    // The suit, its materials as the pack has them.
    const rig = was.header.rigs.find((r) => r.id === `human_${SEX_IDS[sex]}`)!;
    const made2 = spec.tailored!.make(suitLining(body), rig, (p) => shiftAt(field, p));
    suitInMotion(made2, body, rest, lines);
    const suit = made2.map((mesh) => dressTailored(spec, mesh, described.get(spec.tailored!.material)!));
    const ours = new Set([...made, ...suit].map((m) => m.id));
    meshes = meshes.filter((m) => !ours.has(m.id) && !sets.some((s) => m.id.startsWith(`${id}/armor/${s}/`))).concat(made, suit);
  }
  const span = new Map<string, number>();
  for (const m of meshes.flatMap((mesh) => mesh.materials ?? [])) span.set(m.id, Math.max(span.get(m.id) ?? 0, m.span));
  for (const mesh of meshes) if (mesh.materials) mesh.materials = mesh.materials.map((m) => ({ ...m, span: span.get(m.id)! }));
  return { pack: buildPack(meshes, palette, [], was.header.rigs), lines: [...lines, ...warnings] };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const from = arg("pack") ?? new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url).pathname;
  const made = await armorQuick(new Uint8Array(readFileSync(from)));
  writeFileSync(arg("out") ?? "var/armor-quick.snpk", made.pack);
  for (const l of made.lines) console.log(l);
}
