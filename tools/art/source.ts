// Finds and reads the packs under assets/source. Bun and Node both run this (tools/simhash.ts), so it uses nothing
// only one of them has.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clip } from "../../shared/anim/clip.ts";
import { detailsAtlas, parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { unpackMeshes, type SourceDetails, type SourceMesh } from "../pack/write.ts";

export const SOURCE = fileURLToPath(new URL("../../assets/source", import.meta.url));

/** Every file under `dir` whose name ends in `ending`, in name order, so every machine finds them in the same order. */
export function filesUnder(dir: string, ending: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesUnder(p, ending, out);
    else if (name.endsWith(ending)) out.push(p);
  }
  return out;
}

export interface SourceArt {
  meshes: SourceMesh[];
  rigs: PackRig[];
  clips: Clip[];
  /** The pack of small details (core:details), where one is built. */
  details: SourceDetails | null;
}

/** What every pack under `dir` holds, together. Two packs may not hold the same mesh, rig or clip. */
export function readPacks(dir: string = SOURCE): SourceArt {
  const out: SourceArt = { meshes: [], rigs: [], clips: [], details: null };
  const from = new Map<string, string>();
  const claim = (what: string, id: string, file: string): void => {
    const key = `${what} ${id}`;
    if (from.has(key)) throw new Error(`${what} "${id}" is in both ${from.get(key)} and ${file}`);
    from.set(key, file);
  };
  for (const file of filesUnder(dir, ".snpk")) {
    const pack = parsePack(new Uint8Array(readFileSync(file)));
    for (const m of pack.header.meshes) claim("mesh", m.id, file);
    for (const r of pack.header.rigs) claim("rig", r.id, file);
    for (const c of pack.clips.clips) claim("clip", c.id, file);
    out.meshes.push(...unpackMeshes(pack));
    out.rigs.push(...pack.header.rigs);
    out.clips.push(...pack.clips.clips);
    if (pack.header.details) {
      claim("details", "", file);
      out.details = { header: pack.header.details, atlas: detailsAtlas(pack).slice() };
    }
  }
  return out;
}
