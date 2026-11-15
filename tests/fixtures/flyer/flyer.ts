// The block-out flyer (asset.ts, pteranodon.snpk) as the game would have it once the pteranodon's art lands: its rig and
// clips, the content with the pteranodon drawn and posed on that rig, and the core pack with the block-out in it.

import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../../content/core.ts";
import { CreatureAnim } from "../../../shared/anim/creature.ts";
import { buildRig, type Rig } from "../../../shared/anim/rigs.ts";
import type { Def } from "../../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../../shared/content/registry.ts";
import { parsePack, type Pack, type PackRig } from "../../../shared/pack/pack.ts";
import { defaultPalette } from "../../../shared/pack/palette.ts";
import { sampleClip, type Clip, type ClipSet } from "../../../shared/anim/clip.ts";
import { Solved, solve } from "../../../shared/anim/skeleton.ts";
import { readPacks } from "../../../tools/art/source.ts";
import { coreClips, farMesh, grayboxMeshes, withArt } from "../../../tools/pack/build.ts";
import { mannequinMeshes } from "../../../tools/pack/mannequin.ts";
import { weaponMeshes } from "../../../tools/pack/weapons.ts";
import { buildPack, unpackMeshes } from "../../../tools/pack/write.ts";
import { corePack } from "../pack.ts";

export const FLYER = "core:pteranodon";

let own: Pack | null = null;

/** pteranodon.snpk as it was built. */
export function flyerArt(): Pack {
  return (own ??= parsePack(new Uint8Array(readFileSync(new URL("./pteranodon.snpk", import.meta.url)))));
}

/** The core content with the pteranodon drawn and posed on the block-out's rig, as PA5 will have it. */
export const FLYER_CONTENT: readonly Def[] = CORE_CONTENT.map((d) => (d.type === "species" && d.id === FLYER ? { ...d, mesh: FLYER, skeleton: "pteranodon" } : d));

let reg: Registry | null = null;

export function flyerRegistry(): Registry {
  if (reg) return reg;
  const { registry, errors } = compileContent(FLYER_CONTENT);
  if (!registry) throw new Error(errors.join("\n"));
  return (reg = registry);
}

let rig: Rig | null = null;

/** The block-out's rig, with its clips. */
export function flyerRig(): Rig {
  if (rig) return rig;
  const art = flyerArt();
  return (rig = buildRig(art.header.rigs[0]!, art.clips)!);
}

/** What the pteranodon plays on the block-out, as the server and every client make it. */
export function flyerAnim(): CreatureAnim {
  const r = flyerRegistry();
  const i = r.index.get(FLYER)!;
  return new CreatureAnim(flyerRig(), r.runAt[i]!, r.move[i]?.swimSpeed ?? 0);
}

/** Degrees between the turns of `bone` in two solved poses, in model space. */
export function turnBetween(a: Float32Array, b: Float32Array, bone: number): number {
  let d = 0;
  for (let k = 0; k < 4; k++) d += a[bone * 4 + k]! * b[bone * 4 + k]!;
  return (2 * Math.acos(Math.min(1, Math.abs(d))) * 180) / Math.PI;
}

/** The most any clip of `rig` turns each bone from one frame to the next, a loop's last frame to its first included, in degrees. */
export function clipTurns(rig: Rig): Float64Array {
  const most = new Float64Array(rig.bones);
  const was = new Solved(rig.bones);
  for (const clip of rig.clips.values()) {
    for (let f = 0; f <= (clip.loop ? clip.frames : clip.frames - 1); f++) {
      sampleClip(clip, f, rig.a);
      solve(rig, rig.a, rig.solved);
      if (f > 0) for (let b = 0; b < rig.bones; b++) most[b] = Math.max(most[b]!, turnBetween(rig.solved.rot, was.rot, b));
      was.rot.set(rig.solved.rot);
    }
  }
  return most;
}

let host: { clips: ClipSet; rigs: PackRig[] } | null = null;

/** The core pack's clips and rigs with the block-out's, for a Harness's host. */
export function flyerHost(): { clips: ClipSet; rigs: PackRig[] } {
  if (host) return host;
  const core = corePack();
  const art = flyerArt();
  const clips: Clip[] = [...core.clips.clips, ...art.clips.clips];
  const rigs = [...core.header.rigs, ...art.header.rigs];
  return (host = { clips: parsePack(buildPack([], defaultPalette(), clips, rigs)).clips, rigs });
}

/** The core pack as buildCorePack makes it, from FLYER_CONTENT and with the block-out's mesh, rig and clips: for a client to draw. */
export function flyerPackBytes(): Uint8Array {
  const art = readPacks();
  const own = flyerArt();
  const made = [...grayboxMeshes(FLYER_CONTENT), farMesh(), ...mannequinMeshes(), ...weaponMeshes()];
  return buildPack(withArt(made, [...art.meshes, ...unpackMeshes(own)]), defaultPalette(), [...coreClips(), ...own.clips.clips], [...art.rigs, ...own.header.rigs], art.details);
}
