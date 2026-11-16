/** Native sail build; all six levels are authored on the same measured hinge rig. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { findAssets } from "../../../../../tools/art/assets.ts";
import { buildAsset, packOf } from "../../../../../tools/art/build.ts";
import { checkAsset } from "../../../../../tools/art/check.ts";
import { parsePack } from "../../../../../shared/pack/pack.ts";
const root = resolve(import.meta.dir, "../../../../..");
const assets = (await findAssets(resolve(root, "assets/source"))).filter((a) => a.id.startsWith("core:koru_sail_"));
for (const asset of assets) {
  const start = performance.now();
  const built = buildAsset(asset);
  console.log(asset.id, built.lines, built.warnings);
  if (built.faults.length) throw new Error(built.faults.join("\n"));
  const bytes = packOf(built);
  const report = checkAsset(asset, parsePack(bytes), true);
  writeFileSync(resolve(import.meta.dir, `ref/native-${asset.name.slice(10)}.json`), JSON.stringify(report, null, 2) + "\n");
  if (report.faults.length) throw new Error(report.faults.join("\n"));
  writeFileSync(asset.file, bytes);
  console.log(`${asset.id}: ${bytes.length} bytes, ${((performance.now() - start) / 1000).toFixed(1)}s`);
}
await import("./audit.ts");
