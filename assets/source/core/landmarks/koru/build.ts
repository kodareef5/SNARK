/** Native build/check without an enormous per-part catalogue sheet; tools/koru/review.ts reviews the whole yacht. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { buildAsset, packOf } from "../../../../../tools/art/build.ts";
import { checkAsset } from "../../../../../tools/art/check.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";

const root = resolve(import.meta.dir, "../../../../..");
const asset = (await findAssets(resolve(root, "assets/source"))).find((a) => a.id === "core:koru")!;
const start = performance.now();
const built = buildAsset(asset);
if (built.faults.length) throw new Error(built.faults.join("\n"));
const bytes = packOf(built);
const report = checkAsset(asset, parsePack(bytes), true);
if (report.faults.length) throw new Error(report.faults.join("\n"));
writeFileSync(asset.file, bytes);
writeFileSync(resolve(import.meta.dir, "ref/native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`Koru: ${built.meshes.length} meshes, ${bytes.length} bytes, zero native conversion/surface/material faults, ${((performance.now() - start) / 1000).toFixed(1)}s`);
