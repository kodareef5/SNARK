// The core asset pack, built once per test process, and a pack like it whose art does not change.

import { fileURLToPath } from "node:url";
import { CORE_CONTENT } from "../../content/core.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import { HumanAnim } from "../../shared/anim/pose.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { readPacks } from "../../tools/art/source.ts";
import { buildCorePack, grayboxMeshes, withArt } from "../../tools/pack/build.ts";
import { mannequinMeshes } from "../../tools/pack/mannequin.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { buildPack } from "../../tools/pack/write.ts";

let pack: Pack | null = null;
let anim: HumanAnim | null = null;
let frozen: Pack | null = null;

export function corePack(): Pack {
  return (pack ??= parsePack(buildCorePack()));
}

export function coreAnim(): HumanAnim {
  return (anim ??= new HumanAnim(corePack().clips));
}

/**
 * Built as the core pack is, but its art is copies in tests/fixtures/art of the raptor, the parasaur, the human bodies
 * and the human clips as they were on 2026-11-14. New art under assets/source does not change it; content and code do.
 */
export function frozenPack(): Pack {
  if (frozen) return frozen;
  const art = readPacks(fileURLToPath(new URL("./art", import.meta.url)));
  const made = [...grayboxMeshes(CORE_CONTENT), ...mannequinMeshes(), ...weaponMeshes()];
  return (frozen = parsePack(buildPack(withArt(made, art.meshes), defaultPalette(), [...art.clips, ...authoredClips()], art.rigs)));
}
