// Prints hashes of the fixed, seeded scenarios of shared/sim/scenarios.ts. The same file runs under Bun (JavaScriptCore)
// and Node (V8). Equal hashes mean the simulation is bit-identical across the two engines, which client prediction relies on.
// Here the scenarios are given the clips and rigs of the source packs. The device probe gives a browser its boot pack's.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../content/core.ts";
import { authoredClips } from "../shared/anim/authored.ts";
import { HumanAnim } from "../shared/anim/pose.ts";
import { CreatureAnim, creatureAnims } from "../shared/anim/creature.ts";
import { buildRigs, type Rig } from "../shared/anim/rigs.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { parsePack } from "../shared/pack/pack.ts";
import { defaultPalette } from "../shared/pack/palette.ts";
import * as scenarios from "../shared/sim/scenarios.ts";
import type { Heightfield } from "../shared/world/heightfield.ts";
import type { StructureStore } from "../shared/world/structures.ts";
import { ART, SOURCE, readPacks } from "./art/source.ts";
import { buildPack } from "./pack/write.ts";
import { birdAnim } from "../tests/fixtures/bird.ts";
import { carChassisTrace } from "../tests/fixtures/vehicle-chassis-trace.ts";
import { boatContactTrace } from "../tests/fixtures/boat-contact-trace.ts";
import { corpseMotionTrace } from "../tests/fixtures/corpse-motion-trace.ts";

export { FIXED_TUNING } from "../shared/sim/scenarios.ts";

const core = (): Registry => compileContent(CORE_CONTENT).registry!;

export function tunedHash(): string {
  return scenarios.tunedHash(core());
}

/** `ground` is the proving ground from elsewhere, such as its map file. Without it the proving ground is built here. */
export function simHash(ticks = 3000, content: Registry | null = null, ground: { hf: Heightfield; structs: StructureStore } | null = null): string {
  return scenarios.simHash(content ?? core(), ticks, ground);
}

/**
 * Converted and authored clips, passed through the pack's own encoding. Built only from files and modules both engines can
 * read. Where the art is not here, the converted clips are the copy in tests/fixtures/art.
 */
export function sourceClips(): HumanAnim {
  const file = ART ? "../assets/source/core/humans/human-clips/human-clips.snpk" : "../tests/fixtures/art/human-clips.snpk";
  const converted = parsePack(new Uint8Array(readFileSync(new URL(file, import.meta.url)))).clips.clips;
  return new HumanAnim(parsePack(buildPack([], defaultPalette(), [...converted, ...authoredClips()])).clips);
}

export function poseHash(): string {
  return scenarios.poseHash(sourceClips());
}

export function snapHash(): string {
  return scenarios.snapHash(core());
}

/** The creature rigs and their clips, as `bun run art` wrote them, one pack a creature. */
export function sourceRigs(): Map<string, Rig> {
  const art = readPacks(join(SOURCE, "core/creatures"));
  const pack = parsePack(buildPack([], defaultPalette(), art.clips, art.rigs));
  return buildRigs(pack.header.rigs, pack.clips);
}

/** What each modelled species plays on those rigs, the pteranodon's flight among them, and the bird of the tests (tests/fixtures/bird.ts) on its own. */
export function sourceAnims(): CreatureAnim[] {
  const rigs = sourceRigs();
  return [...creatureAnims(core(), (d) => rigs.get(d.mesh)).filter((a) => a !== null), birdAnim()];
}

export function creatureHash(): string {
  return scenarios.creatureHash(sourceAnims(), core());
}

export function hullHash(): string {
  return scenarios.hullHash(core());
}

export function nodeHash(): string {
  return scenarios.nodeHash(core());
}

export function waterHash(ticks = 3000): string {
  return scenarios.waterHash(core(), ticks);
}

export function collisionHashes(): string {
  return [carChassisTrace().hash, boatContactTrace().hash, corpseMotionTrace()].join(" ");
}

if (import.meta.main) console.log(simHash() + " " + poseHash() + " " + snapHash() + " " + creatureHash() + " " + tunedHash() + " " + hullHash() + " " + nodeHash() + " " + waterHash() + " " + collisionHashes());
