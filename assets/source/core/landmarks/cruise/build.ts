/** Ordinary native piece conversion and six-level checks; complete assembly review uses tools/cruise/review.ts. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { buildAsset, packOf } from "../../../../../tools/art/build.ts";
import { checkAsset } from "../../../../../tools/art/check.ts";
import { surfaceError } from "../../../../../tools/pack/error.ts";
import type { PiecesAsset } from "../../../../../tools/art/spec.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";

const root = resolve(import.meta.dir, "../../../../..");
const asset = (await findAssets(resolve(root, "assets/source"))).find(a => a.id === "core:cruise")!;
const started = performance.now();
const built = buildAsset(asset);
if (built.faults.length) throw new Error(built.faults.join("\n"));
const errors: Record<string, number[]> = {};
for (const mesh of built.meshes) {
  let previous = .008;
  errors[mesh.id] = mesh.lods.slice(1).map(lod => {
    previous = Math.max(previous, surfaceError(mesh.lods[0]!, lod));
    lod.error = previous;
    return previous;
  });
}
const reviewed = { ...asset, spec: { ...asset.spec, pieces: (asset.spec as PiecesAsset).pieces.map(p => ({ ...p, errors: errors[p.id] })) } as PiecesAsset };
const bytes = packOf(built);
const report = checkAsset(reviewed, parsePack(bytes), true);
if (report.faults.length) throw new Error(report.faults.join("\n"));
writeFileSync(asset.file, bytes);
writeFileSync(resolve(import.meta.dir, "lod-errors.json"), JSON.stringify(errors, null, 2) + "\n");
writeFileSync(resolve(import.meta.dir, "ref/native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Cruise production: ${built.meshes.length} meshes, ${bytes.length} bytes, zero native faults, ${((performance.now() - started) / 1000).toFixed(1)}s`);
