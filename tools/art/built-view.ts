// bun tools/art/built-view.ts core:trike --dist client/dist --format bc --out var/trike-bc.png
// Native source geometry, source sample dyes and a named clip, with the actual prepared build's texture bytes.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { TEXTURE_FORMATS, type TextureFormat } from "../../shared/pack/texture.ts";
import { ModelView } from "../snap.ts";
import { encodePng } from "../snap/png.ts";
import { findAssets } from "./assets.ts";
import { bindBuiltTextures } from "./built-textures.ts";
import { SOURCE } from "./source.ts";

const args = process.argv.slice(2);
const option = (key: string, fallback: string): string => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1] ?? ""; };
const numeric = (key: string, fallback: number): number => {
  const n = Number(option(key, String(fallback))); if (!Number.isFinite(n)) throw new Error(`${key} must be finite`); return n;
};
const id = args[0];
if (!id || id.startsWith("--")) throw new Error("Give an asset id, followed by --dist, --format, --out and optional --clip/--frame/--level/--centre/--radius/--around/--above/--layer");
const source = resolve(option("--source", SOURCE)), dist = resolve(option("--dist", "client/dist"));
const format = option("--format", "bc") as TextureFormat;
if (!TEXTURE_FORMATS.includes(format)) throw new Error("--format must be bc, astc or rgba");
const asset = (await findAssets(source)).find(a => a.id === id);
if (!asset) throw new Error(`${id} is absent from ${source}`);
const bytes = new Uint8Array(readFileSync(asset.file)), pack = parsePack(bytes);
const meshName = option("--mesh", id), mesh = pack.meshIndex.get(meshName);
if (mesh === undefined) throw new Error(`${meshName} is absent from ${asset.file}`);
const row = pack.header.meshes[mesh]!, width = numeric("--width", 1600), height = numeric("--height", 1100);
if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error("Picture dimensions must be integers from 1 to 8192");
const view = new ModelView(pack, width, height, [.80, .83, .86]), textures = bindBuiltTextures(view, pack, dist, format);
const level = numeric("--level", 0), frame = numeric("--frame", 0), layer = numeric("--layer", 0);
if (!Number.isInteger(level) || !row.lods[level]) throw new Error(`Missing LOD ${level}`);
if (!Number.isInteger(layer) || layer < 0 || layer > 96) throw new Error("--layer must be an integer from 0 to 96");
const centre = option("--centre", row.center.join(",")).split(",").map(Number);
if (centre.length !== 3 || !centre.every(Number.isFinite)) throw new Error("--centre must be three finite comma-separated coordinates");
const radius = numeric("--radius", Math.hypot(...row.half)); if (radius <= 0) throw new Error("--radius must be positive");
const rigSpec = row.rig === undefined ? pack.header.rigs?.find(r => r.skeleton === row.skeleton) : pack.header.rigs?.[row.rig];
if (row.skeleton && (!rigSpec || rigSpec.skeleton !== row.skeleton)) throw new Error(`${meshName} has no matching native rig`);
const rig = row.skeleton && rigSpec ? buildRig(rigSpec, pack.clips) : null;
if (row.skeleton && !rig) throw new Error(`${meshName} could not build its native rig`);
const clip = option("--clip", "idle");
if (rig) {
  const animation = rig.clips.get(clip); if (!animation) throw new Error(`${id} has no ${clip} clip`);
  sampleClip(animation, frame, rig.a); solve(rig, rig.a, rig.solved);
}
const shot = { mesh, level, around: numeric("--around", 58), above: numeric("--above", 14), centre: centre as [number, number, number], radius, layer, colors: asset.spec.kind === "creature" ? asset.spec.regions.map(r => r.sample) : [15], textured: true, rig };
view.draw(shot);
const output = resolve(option("--out", `var/built-materials/${id.replaceAll(":", "-")}-${format}.png`)); mkdirSync(dirname(output), { recursive: true });
const png = encodePng(width, height, view.raster.color); writeFileSync(output, png);
const { rig: ignored, ...settings } = shot;
writeFileSync(`${output}.json`, JSON.stringify({ sourcePack: asset.file, sourcePackSha256: createHash("sha256").update(bytes).digest("hex"), imageSha256: createHash("sha256").update(png).digest("hex"), width, height, clip, frame, settings, textures, limitation: "Source geometry with decoded compiled textures. Verify source/build matching separately. This image does not measure GPU residency or performance." }, null, 2) + "\n");
console.log(`${output}: ${format}, ${textures.textures.length} bound textures, largest ${Math.max(...textures.textures.map(t => t.top), 0)} pixels`);
