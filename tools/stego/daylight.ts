// Matched Stego material views with the game's midday light and a 70-degree gameplay lens.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { STEGO_DYES } from "../../content/creatures/stego.ts";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { nearestColour } from "../../shared/pack/palette.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../art/assets.ts";
import { bindBuiltTextures } from "../art/built-textures.ts";
import { materialsOf } from "../art/materials.ts";
import { ModelView, type ModelShot } from "../snap.ts";
import { rgbaOf } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";

const [source, dist, out] = process.argv.slice(2);
if (!source || !dist || !out) throw new Error("Give a source tree, prepared client directory and output directory");
const asset = (await findAssets(resolve(source))).find(a => a.id === "core:stego")!;
const bytes = readFileSync(asset.file), pack = parsePack(bytes);
const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const mesh = pack.meshIndex.get("core:stego")!;
const materials = materialsOf(asset);
const lens = (distance: number) => ({ distance, fovY: 1.2217 });
const tail = process.argv.includes("--tail");
const cameras = tail ? {
  tail: { around: 90, above: 9, centre: [0, 1.33, -5.15], radius: 1 },
  thagomizer: { around: 145, above: 29, centre: [0, 1.32, -5.28], radius: 1.15 },
  tailQuarter: { around: 115, above: 13, centre: [0, 1.55, -3.74], radius: 2.75 },
  tailGameplay: { around: 145, above: 13, centre: [0, 1.75, -2.4], radius: 4.5, perspective: lens(11) },
} as const : {
  side: { around: 90, above: 4, centre: [0, 1.87, -1.45], radius: 4.5, perspective: lens(11) },
  quarter: { around: 60, above: 9, centre: [0, 1.87, -1.45], radius: 4.5, perspective: lens(11) },
  shoulder: { around: 74, above: 7, centre: [.69, 1.76, .46], radius: 1.20 },
  roots: { around: 80, above: 19, centre: [.45, 3.02, -.68], radius: 1.0 },
  nape: { around: 78, above: 9, centre: [.35, 1.54, 1.78], radius: .96 },
} as const;
mkdirSync(out, { recursive: true });
const rows = [];
for (const format of ["native", "bc", "astc"] as const) {
  if (process.argv.includes("--native") && format !== "native") continue;
  const width = 1280, height = 720;
  const view = new ModelView(pack, width, height, [.80, .83, .86]);
  let textures;
  if (format === "native") {
    for (const [slot, texture] of (pack.header.textures ?? []).entries()) {
      const material = materials.find(m => texture.id === `${m.id}/${texture.role}`)!;
      view.texture(slot, texture.role, rgbaOf(material, texture.role, texture.top).pictures);
    }
  } else textures = bindBuiltTextures(view, pack, resolve(dist), format);
  for (const [name, camera] of Object.entries(cameras)) {
    const poses = name === "side" ? ["idle", "plate_heavy", "plate_sharpened"] : ["idle"];
    for (const clip of poses) {
      sampleClip(rig.clips.get(clip)!, 0, rig.a);
      solve(rig, rig.a, rig.solved);
      const shot: ModelShot = { ...camera, mesh, level: 0, rig, colors: STEGO_DYES, textured: true };
      const alternates = clip === "idle" && (name === "side" || name === "roots" || name === "thagomizer");
      const palettes = [{ label: "", dyes: STEGO_DYES }];
      if (alternates) {
        const swatches = [[93, 49, 72], [122, 103, 76], [171, 145, 101], [71, 94, 113], [48, 62, 80], [173, 156, 121]] as const;
        palettes.push({ label: "-dyed", dyes: swatches.map(([r, g, b]) => nearestColour(pack.palette, r, g, b)) });
      }
      for (const palette of palettes) {
        view.draw({ ...shot, colors: palette.dyes });
        const png = encodePng(width, height, view.raster.color);
        const file = `${format}-${name}-${clip}${palette.label}.png`;
        writeFileSync(join(out, file), png);
        rows.push({ file, width, height, format, clip, frame: 0, camera, dyes: palette.dyes,
          sha256: createHash("sha256").update(png).digest("hex") });
      }
    }
  }
  if (textures) writeFileSync(join(out, `${format}-textures.json`), JSON.stringify(textures, null, 2) + "\n");
}
writeFileSync(join(out, "views.json"), JSON.stringify({
  packSha256: createHash("sha256").update(bytes).digest("hex"), colors: STEGO_DYES,
  lighting: "ModelView standard midday game material and sky, software renderer", rows,
}, null, 2) + "\n");
