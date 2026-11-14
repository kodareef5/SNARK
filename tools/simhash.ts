// Prints hashes of the fixed, seeded scenarios of shared/sim/scenarios.ts. The same file runs under Bun (JavaScriptCore)
// and Node (V8). Equal hashes mean the simulation is bit-identical across the two engines, which client prediction relies on.
// Here they get the content and the packs built from the source files. The device probe sends a browser the same packs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../content/core.ts";
import { authoredClips } from "../shared/anim/authored.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import { buildRigs, type Rig } from "../shared/anim/rigs.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import * as scenarios from "../shared/sim/scenarios.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import type { StructureStore } from "../shared/world/structures.ts";
import { SOURCE, readPacks } from "./art/source.ts";
import { buildPack } from "./pack/write.ts";

export const FIXED_TUNING = scenarios.FIXED_TUNING;

const core = (): Registry => compileContent(CORE_CONTENT).registry!;

export function tunedHash(): string {
  return scenarios.tunedHash(core());
}

/** `ground` is the proving ground from elsewhere, such as its map file. Without it the proving ground is built here. */
export function simHash(ticks = 3000, content: Registry | null = null, ground: { hf: Heightfield; structs: StructureStore } | null = null): string {
  return scenarios.simHash(content ?? core(), ticks, ground);
}

/** The converted and authored human clips in a pack of their own, built only from files and modules both engines can read. */
export function sourceClipPack(): Uint8Array {
  const converted = parsePack(new Uint8Array(readFileSync(new URL("../assets/source/core/humans/human-clips/human-clips.snpk", import.meta.url)))).clips.clips;
  return buildPack([], defaultPalette(), [...converted, ...authoredClips()]);
}

/** The clips of sourceClipPack, passed through the pack's own encoding. */
export function sourceClips(): HumanAnim {
  return new HumanAnim(parsePack(sourceClipPack()).clips);
}

export function poseHash(): string {
  return scenarios.poseHash(sourceClips());
}

export function snapHash(): string {
  return scenarios.snapHash(core());
}

/** The creature rigs and their clips, as `bun run art` wrote them, in one pack. */
export function sourceRigPack(): Uint8Array {
  const art = readPacks(join(SOURCE, "core/creatures"));
  return buildPack([], defaultPalette(), art.clips, art.rigs);
}

/** The rigs of sourceRigPack, one a creature. */
export function sourceRigs(): Map<string, Rig> {
  const pack = parsePack(sourceRigPack());
  return buildRigs(pack.header.rigs, pack.clips);
}

export function creatureHash(): string {
  return scenarios.creatureHash(sourceRigs().values());
}

if (import.meta.main) console.log(simHash() + " " + poseHash() + " " + snapHash() + " " + creatureHash() + " " + tunedHash());
