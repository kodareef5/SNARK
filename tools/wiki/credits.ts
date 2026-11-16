// Who made a model and its motion, from what its asset records: an asset converted from a pack under assets/raw is
// credited to that pack's author under the licence its folder carries, and any other was made for the game.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findAssets, type Asset } from "../art/assets.ts";

const RAW = resolve(import.meta.dir, "../../assets/raw");
const MADE = "Made for the game";

/** Every `raw` an asset's spec names, at any depth. */
function raws(spec: unknown): string[] {
  if (Array.isArray(spec)) return spec.flatMap(raws);
  if (!spec || typeof spec !== "object") return [];
  return Object.entries(spec).flatMap(([k, v]) => (k === "raw" && typeof v === "string" ? [v] : raws(v)));
}

/** The author and licence of a path under assets/raw: its first folder, and CC0 where every licence file under it says so. */
function creditOf(raw: string): string {
  const author = raw.charAt(0).toUpperCase() + raw.slice(1, raw.indexOf("/") < 0 ? undefined : raw.indexOf("/"));
  let dir = join(RAW, raw);
  while (!existsSync(dir) || !statSync(dir).isDirectory()) dir = dirname(dir);
  const texts = readdirSync(dir, { recursive: true }).map(String).filter((f) => /(^|\/)licen[cs]e[^/]*$/i.test(f)).map((f) => readFileSync(join(dir, f), "utf8"));
  return texts.length > 0 && texts.every((t) => t.includes("CC0")) ? `${author}, CC0 1.0` : author;
}

/** The ids of the meshes in a pack, from its header alone. */
function headerMeshes(file: string): string[] {
  if (!existsSync(file)) return [];
  const fd = openSync(file, "r");
  const head = Buffer.alloc(12);
  readSync(fd, head, 0, 12, 0);
  const json = Buffer.alloc(head.readUInt32LE(8));
  readSync(fd, json, 0, json.length, 12);
  closeSync(fd);
  return (JSON.parse(json.toString("utf8")) as { meshes: { id: string }[] }).meshes.map((m) => m.id);
}

/**
 * What the game's assets say of each mesh they make: its credit, by mesh id and by "human" for the human clips, and the
 * palette colours its regions are drawn in on its review sheet, the art's own look.
 */
export async function fromAssets(): Promise<{ credits: Map<string, string>; colours: Map<string, number[]> }> {
  const credits = new Map<string, string>();
  const colours = new Map<string, number[]>();
  const assets: Asset[] = await findAssets();
  for (const a of assets) {
    const found = [...new Set(raws(a.spec).map(creditOf))];
    const credit = found.length ? found.join("; ") : MADE;
    if (a.spec.kind === "human-clips") credits.set("human", credit);
    const samples = a.spec.kind === "creature" ? a.spec.regions.map((r) => r.sample) : null;
    for (const id of headerMeshes(a.file)) {
      credits.set(id, credit);
      if (samples) colours.set(id, samples);
    }
  }
  return { credits, colours };
}

/** An entry's credit: its model's, and its motion's where it moves. A body's motion is its own asset's, a human's the clips'. */
export function entryCredit(credits: ReadonlyMap<string, string>, meshes: readonly string[], moves: boolean, human: boolean): string {
  const model = [...new Set(meshes.map((m) => credits.get(m) ?? MADE))].join("; ");
  const motion = human ? (credits.get("human") ?? MADE) : model;
  if (!moves) return `Model: ${model}.`;
  return motion !== model ? `Model: ${model}. Motion: ${motion}.` : `Model and motion: ${model}.`;
}
