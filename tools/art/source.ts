// Finds and reads the packs under assets/source. Bun and Node both run this (tools/simhash.ts), so it uses nothing
// only one of them has.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Clip } from "../../shared/anim/clip.ts";
import { detailsAtlas, parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { artInstalled } from "./installed.ts";
import { unpackMeshes, type SourceDetails, type SourceMesh } from "../pack/write.ts";

export const SOURCE = fileURLToPath(new URL("../../assets/source", import.meta.url));

/** Whether every art archive the manifest pins is installed in this checkout. */
export const ART = artInstalled();

/**
 * A module of an art folder's own (its builder's shapes and finishes), by its path under assets/source. The art is
 * outside every zone, so nothing may import it by name; a test that checks a builder loads it through here.
 */
export async function artModule(path: string): Promise<Record<string, any>> {
  return import(join(SOURCE, path));
}

/** Every file under `dir` whose name ends in `ending`, in name order, so every machine finds them in the same order. */
export function filesUnder(dir: string, ending: string, out: string[] = []): string[] {
  if ((dir === SOURCE && !ART) || !existsSync(dir)) return out;
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
  /** A landmark's finishes, where its art states them (shared/pack/finish.ts). */
  finishes?: number[];
}

/** Where a landmark's assets are (tools/art/assets.ts landmarkOf). The core pack reads none of them. */
export const LANDMARKS = join(SOURCE, "landmarks");

/**
 * What every pack under `dir` holds, together. Two packs may not hold the same mesh, rig or clip. Under the whole source
 * tree a landmark's packs are left out: each is read under its own folder.
 */
export function readPacks(dir: string = SOURCE): SourceArt {
  const out: SourceArt = { meshes: [], rigs: [], clips: [], details: null };
  const from = new Map<string, string>();
  const claim = (what: string, id: string, file: string): void => {
    const key = `${what} ${id}`;
    if (from.has(key)) throw new Error(`${what} "${id}" is in both ${from.get(key)} and ${file}`);
    from.set(key, file);
  };
  for (const file of filesUnder(dir, ".snpk")) {
    if (dir === SOURCE && file.startsWith(LANDMARKS + sep)) continue;
    const pack = parsePack(new Uint8Array(readFileSync(file)));
    for (const m of pack.header.meshes) claim("mesh", m.id, file);
    for (const r of pack.header.rigs) claim("rig", r.id, file);
    for (const c of pack.clips.clips) claim("clip", c.id, file);
    out.meshes.push(...unpackMeshes(pack));
    out.rigs.push(...pack.header.rigs);
    out.clips.push(...pack.clips.clips);
    if (pack.header.finishes) {
      claim("finishes", "", file);
      out.finishes = pack.header.finishes;
    }
    if (pack.header.details) {
      claim("details", "", file);
      out.details = { header: pack.header.details, atlas: detailsAtlas(pack).slice() };
    }
  }
  return out;
}
