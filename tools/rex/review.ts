// Render actual packed geometry and deformation with the game's material and light.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../art/assets.ts";
import { materialsOf, mipsOf } from "../art/materials.ts";
import type { Vec3 } from "../art/spec.ts";
import { decodeAstc } from "../pack/astc.ts";
import { decodeBc5, decodeBc7 } from "../pack/bc.ts";
import { eachTexture } from "../pack/encode.ts";
import { ModelView } from "../snap.ts";
import { rgbaOf } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";

const format = process.argv[2] ?? "rgba";
if (format !== "rgba" && format !== "bc" && format !== "astc") throw new Error("Use rgba, bc, or astc");
const asset = (await findAssets()).find(a => a.id === "core:rex")!;
if (asset.spec.kind !== "creature") throw new Error("Expected Rex creature");
const output = resolve("var/rex/review", format);
mkdirSync(output, { recursive: true });
const bytes = readFileSync(asset.file), pack = parsePack(bytes);
const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const view = new ModelView(pack, 1220, 780, [.80, .83, .85]);
const palette = asset.spec.regions!.map(r => r.sample);
const materials = materialsOf(asset);
const textures = (pack.header.textures ?? []).map(t => {
  const material = materials.find(m => t.id === `${m.id}/${t.role}`)!;
  return { ...t, material, mips: () => mipsOf(material, t.role, t.top) };
});
const hashes: Record<string, string> = {};
if (format === "rgba") {
  textures.forEach((t, i) => view.texture(i, t.role, rgbaOf(t.material, t.role, t.top).pictures));
} else {
  let slot = 0;
  await eachTexture(textures, { workers: 4 }, async variants => {
    const t = textures[slot]!, v = variants[format], hash = createHash("sha256");
    const kind = t.role === "normal" ? "normal" : t.role === "base" || t.role === "layer" ? "srgb" : "linear";
    const mips = v.pictures.map((p, mip) => {
      hash.update(p);
      const n = 1 << mip;
      const rgba = format === "astc" ? decodeAstc(p, n, n, kind, v.block)
        : t.role === "normal" ? decodeBc5(p, n, n) : decodeBc7(p, n, n);
      if (t.role !== "normal") return rgba;
      const y = format === "astc" ? 3 : 1;
      return Uint8Array.from({ length: n * n * 2 }, (_, k) => rgba[(k >> 1) * 4 + ((k & 1) ? y : 0)]!);
    });
    hashes[t.id] = hash.digest("hex");
    view.texture(slot++, t.role, mips);
  });
}

function pose(name: string, frame: number): void {
  sampleClip(rig.clips.get(name)!, frame, rig.a);
  solve(rig, rig.a, rig.solved);
}
function socket(name: string): number[] {
  const s = rig.sockets.get(name)!;
  const out = [0, 0, 0];
  boneToModel(rig.solved, s.bone, s.x, s.y, s.z, out);
  return out.map(n => Number(n.toFixed(4)));
}

const body = pack.meshIndex.get("core:rex")!, tack = pack.meshIndex.get("core:saddle_rex/worn")!;
function picture(name: string, clip: string, frame: number, around: number, above: number, centre: Vec3, radius: number, saddle = false, layer = 0): void {
  pose(clip, frame);
  view.draw({ mesh: body, ...(saddle ? { also: [tack] } : {}), level: 0, around, above, centre, radius, rig, colors: palette, textured: true, layer });
  writeFileSync(resolve(output, name + ".png"), encodePng(view.raster.width, view.raster.height, view.raster.color));
}
picture("profile", "idle", 0, 90, 4, [0, 2.15, -1], 4.15);
picture("quarter", "idle", 0, 56, 12, [0, 2.10, -.65], 3.90);
picture("face", "idle", 0, 65, 5, [0, 3.62, 3.96], .88);
pose("call", 25);
const mouth = socket("mouth");
picture("roar", "call", 25, 64, 7, [0, mouth[1]! + .46, mouth[2]! - .65], 1.28);
picture("stride", "run", 4, 83, 5, [0, 1.9, -1.05], 4.23);
picture("saddle", "idle", 0, 71, 21, [0, 3.48, .54], 1.16, true);
picture("paddle", "swim", 13, 64, 9, [0, 2.4, -.75], 4.16);
picture("rest", "torpor_idle", 24, 62, 23, [0, 1.2, -.7], 3.82);
picture("corpse", "death", 61, 62, 23, [0, 1.2, -.7], 3.82, false, 96);
picture("injury", "idle", 0, 82, 13, [0, 3.06, .42], 1.42, false, 48);
const attack = Array.from({ length: rig.clips.get("attack")!.frames }, (_, frame) => {
  pose("attack", frame);
  return { frame, bite: socket("bite"), mouth: socket("mouth"), head: socket("head") };
});
writeFileSync(resolve(output, "receipt.json"), JSON.stringify({
  packSha256: createHash("sha256").update(bytes).digest("hex"), textureVariant: format, textureHashes: hashes, attack,
}, null, 2) + "\n");
