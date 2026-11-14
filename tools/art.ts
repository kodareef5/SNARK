// Builds the assets under assets/source, one folder each. See assets/source/README.md.
//
//   bun run art -- core:raptor            build it: Blender, conversion and the check
//   bun run art -- --all                  every asset
//   bun run art -- core:raptor --check    measure the pack it has. No Blender.
//   bun run art -- --all --repack         the packs again in today's format, made from themselves
//
// --source DIR looks in another tree than assets/source.
// --repack --levels also makes a creature's coarser levels afresh from its finest.
// Building the game needs none of this: the packs are committed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parsePack } from "../shared/pack/pack.ts";
import { findAssets } from "./art/assets.ts";
import { buildAsset, packOf, repack } from "./art/build.ts";
import { checkAsset, reportLines } from "./art/check.ts";
import { SOURCE } from "./art/source.ts";

const VALUED = ["source"];

/** Returns the number of assets with faults. `say` takes what it has to tell. */
export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<number> {
  const has = (name: string): boolean => args.includes(`--${name}`);
  const value = (name: string): string | undefined => (has(name) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const source = resolve(value("source") ?? SOURCE);
  const ids = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]?.slice(2) ?? ""));
  const found = await findAssets(source);
  const chosen = has("all") ? found : ids.map((id) => {
    const asset = found.find((a) => a.id === id);
    if (!asset) throw new Error(`no asset "${id}" under ${source}. There are: ${found.map((a) => a.id).join(", ")}`);
    return asset;
  });
  if (chosen.length === 0) {
    say(`usage: bun run art -- <id>... | --all  [--check] [--repack [--levels]] [--source DIR]\n${found.map((a) => `  ${a.id.padEnd(20)} ${a.spec.kind.padEnd(13)} ${relative(process.cwd(), a.dir)}`).join("\n")}`);
    return 0;
  }

  let failed = 0;
  for (const asset of chosen) {
    const t0 = performance.now();
    if (has("repack")) {
      const again = repack(new Uint8Array(readFileSync(asset.file)), has("levels"));
      writeFileSync(asset.file, again);
      say(`${asset.id}: ${asset.file}, ${again.length} bytes`);
      continue;
    }
    const only = has("check");
    let file: Uint8Array | null = null;
    const faults: string[] = [];
    if (!only) {
      const built = buildAsset(asset);
      say(`${asset.id}\n${built.lines.map((l) => `  ${l}`).join("\n")}`);
      for (const w of built.warnings) say(`  warning: ${w}`);
      file = packOf(built);
      faults.push(...built.faults);
      // What conversion refuses is never written, so a pack that is committed has passed it.
      if (faults.length === 0) {
        writeFileSync(asset.file, file);
        say(`  ${relative(process.cwd(), asset.file)}, ${file.length} bytes, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      } else say(`  not written: ${relative(process.cwd(), asset.file)} is as it was`);
    } else if (existsSync(asset.file)) file = new Uint8Array(readFileSync(asset.file));
    else throw new Error(`${asset.id}: no ${asset.file}. Build it first.`);

    const report = checkAsset(asset, parsePack(file));
    report.faults.unshift(...faults);
    say(reportLines(report).join("\n"));
    if (report.faults.length > 0) failed++;
  }
  return failed;
}

if (import.meta.main) process.exit((await main(process.argv.slice(2))) > 0 ? 1 : 0);
