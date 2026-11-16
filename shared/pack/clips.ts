// Every clip a build made, as its server poses with them: the boot pack's, and each creature skeleton's from the clip
// file, where a client takes them only as it meets the creature.

import { joinClips, type ClipSet } from "../anim/clip.ts";
import { skeletonClips, storedBytes, type Manifest } from "./manifest.ts";
import type { Pack } from "./pack.ts";
import { unfilterPart } from "./stored.ts";

/** `read` gives a file's bytes as served and `inflate` undoes raw deflate. Throws where they are not the clips the manifest's hash names. */
export function allClips(m: Manifest, boot: Pack, read: (file: number) => Uint8Array, inflate: (stored: Uint8Array) => Uint8Array): ClipSet {
  const sets = [boot.clips];
  const files = new Map<number, Uint8Array>();
  for (const e of m.clips ?? []) {
    if (!files.has(e.file)) files.set(e.file, read(e.file));
    const stored = files.get(e.file)!.subarray(e.at, e.at + storedBytes(e.part));
    const part = e.part.stored === undefined ? stored : unfilterPart(inflate(stored), e.part.bytes);
    if (!part || part.length !== e.part.bytes) throw new Error(`clips: those of ${e.rig} do not come back from their file`);
    sets.push(skeletonClips(e, part));
  }
  const all = joinClips(sets);
  if (all.hash !== m.clipHash) throw new Error("clips: they are not those the manifest's hash names");
  return all;
}
