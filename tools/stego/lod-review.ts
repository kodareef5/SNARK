// Render neighbouring native LODs at the distance where the client first uses the coarser mesh.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TIERS, type Tier } from "../../client/core/assets/tiers.ts";
import { STEGO_DYES } from "../../content/creatures/stego.ts";
import { sampleClip } from "../../shared/anim/clip.ts";
import { buildRig } from "../../shared/anim/rigs.ts";
import { solve } from "../../shared/anim/skeleton.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../art/assets.ts";
import { levelStarts } from "../art/check.ts";
import { materialsOf } from "../art/materials.ts";
import { ModelView } from "../snap.ts";
import { rgbaOf } from "../snap/files.ts";
import { encodePng } from "../snap/png.ts";

const dir = process.argv[2] ?? "var/stego-review/lod-transitions";
mkdirSync(dir, { recursive: true });
const asset = (await findAssets(resolve("assets/source"))).find(a => a.id === "core:stego")!;
const bytes = readFileSync(process.argv[3] ?? asset.file);
const pack = parsePack(bytes);
const mesh = pack.meshIndex.get("core:stego")!;
const row = pack.header.meshes[mesh]!;
const rig = buildRig(pack.header.rigs[0]!, pack.clips)!;
const materials = materialsOf(asset);
const width = 600, height = 256;
const view = new ModelView(pack, width, height, [.80, .83, .86]);
for (const [slot, texture] of (pack.header.textures ?? []).entries()) {
  const material = materials.find(m => texture.id === `${m.id}/${texture.role}`)!;
  view.texture(slot, texture.role, rgbaOf(material, texture.role, texture.top).pictures);
}

// Crop the 1080-pixel projection from the art checker into this tile at a 1:1 pixel ratio.
const modelHalfFov = .1, gameHalfFov = 1.2217 / 2;
const zoom = Math.tan(modelHalfFov) * 1080 / (height * Math.tan(gameHalfFov));
function picture(level: number, distance: number, around: number, tier: Tier) {
  view.draw({
    mesh, level, rig, centre: [0, 1.96, -1.5], radius: distance * Math.sin(modelHalfFov),
    zoom, around, above: 6, textured: tier.texture > 0, lit: tier.lit, colors: STEGO_DYES,
  });
  const mask = Uint8Array.from(view.raster.pickDraw, draw => Number(draw >= 0));
  if (!mask.some(Boolean)) throw new Error(`Empty ${tier.name} level ${level} at ${distance} m`);
  return { mask, pixels: view.raster.color.slice() };
}

// Exact distance from a changed pixel centre to the nearest drawn pixel on the other mesh.
function nearest(mask: Uint8Array, x: number, y: number) {
  let best = Infinity;
  for (let radius = 1; radius < Math.max(width, height) && radius <= best; radius++) {
    for (let v = Math.max(0, y - radius); v <= Math.min(height - 1, y + radius); v++) {
      for (let u = Math.max(0, x - radius); u <= Math.min(width - 1, x + radius); u++) {
        if (Math.max(Math.abs(u - x), Math.abs(v - y)) === radius && mask[v * width + u]) {
          best = Math.min(best, Math.hypot(u - x, v - y));
        }
      }
    }
  }
  return best;
}

const rows = [];
const poses = [["idle", 0], ["walk", 12], ["walk", 35], ["walk", 45], ["run", 9], ["run", 32]] as const;
for (const tier of TIERS) {
  const starts = levelStarts(row.lods.map(l => l.error), row.half[1] * 2, tier);
  for (let level = 1; level < starts.length; level++) {
    const start = starts[level];
    if (!start || start.from <= 0) continue;
    for (const [name, frame] of poses) {
      sampleClip(rig.clips.get(name)!, frame, rig.a);
      solve(rig, rig.a, rig.solved);
      // Both angles keep the nose and spikes in the depth interval at the closest comparison.
      for (const around of [68, 90]) {
        const fine = picture(level - 1, start.from, around, tier);
        const coarse = picture(level, start.from, around, tier);
        let fineArea = 0, coarseArea = 0, intersection = 0, maxSilhouetteChange = 0, colorDifference = 0;
        for (let i = 0; i < fine.mask.length; i++) {
          const a = fine.mask[i]!, b = coarse.mask[i]!;
          fineArea += a;
          coarseArea += b;
          if (a && b) {
            intersection++;
            for (let c = 0; c < 3; c++) colorDifference += Math.abs(fine.pixels[4 * i + c]! - coarse.pixels[4 * i + c]!);
          } else if (a || b) {
            const distance = nearest(a ? coarse.mask : fine.mask, i % width, Math.floor(i / width));
            maxSilhouetteChange = Math.max(maxSilhouetteChange, distance);
          }
        }
        rows.push({
          tier: tier.name, level, name, frame, around, distance: start.from, nominalHeight: start.tall,
          fineArea, coarseArea, differingPixels: fineArea + coarseArea - 2 * intersection,
          maxSilhouetteChange, meanCommonPixelRgb: colorDifference / (3 * Math.max(1, intersection)),
        });
        if (name === "walk" && frame === 45 && around === 90) {
          const pair = new Uint8ClampedArray(width * height * 8);
          for (let y = 0; y < height; y++) {
            const left = y * width * 4, right = left + width * 4;
            pair.set(fine.pixels.subarray(left, right), left * 2);
            pair.set(coarse.pixels.subarray(left, right), left * 2 + width * 4);
          }
          writeFileSync(join(dir, `${tier.name}-${level - 1}-${level}.png`), encodePng(width * 2, height, pair));
        }
      }
    }
  }
}
const report = {
  sha256: createHash("sha256").update(bytes).digest("hex"),
  scope: "Native weighted or flat rendering at the client's 1080 px transition distance using 1K fallback maps on lit tiers. Left finer, right coarser. Discrete gait poses, opaque silhouettes and software pixel colours.",
  width, height, rows,
};
writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
