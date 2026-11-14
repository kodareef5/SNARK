// Builds the assets under assets/source, one folder each. See assets/source/README.md.
//
//   bun run art -- core:raptor            build it: Blender, conversion, the check and the review sheet
//   bun run art -- --all                  every asset
//   bun run art -- core:raptor --check    measure the pack it has. No Blender.
//   bun run art -- core:raptor --sheet    draw the review sheet of the pack it has. No Blender.
//   bun run art -- --all --repack         the packs again in today's format, made from themselves
//
// --source DIR looks in another tree than assets/source. --out DIR is where sheets go (artifacts/art).
// --repack --levels also makes a creature's coarser levels afresh from its finest.
// Building the game needs none of this: the packs are committed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parsePack, type Pack } from "../shared/pack/pack.ts";
import { findAssets, type Asset } from "./art/assets.ts";
import { buildAsset, packOf, repack } from "./art/build.ts";
import { checkAsset, reportLines, type Report } from "./art/check.ts";
import { drawSheet } from "./art/sheet.ts";
import { SOURCE } from "./art/source.ts";
import { encodePng } from "./snap/png.ts";

const VALUED = ["source", "out"];

/** Returns the number of assets with faults. `say` takes what it has to tell. */
export async function main(args: readonly string[], say: (line: string) => void = console.log): Promise<number> {
  const has = (name: string): boolean => args.includes(`--${name}`);
  const value = (name: string): string | undefined => (has(name) ? args[args.indexOf(`--${name}`) + 1] : undefined);
  const source = resolve(value("source") ?? SOURCE);
  const outDir = resolve(value("out") ?? "artifacts/art");
  const ids = args.filter((a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]?.slice(2) ?? ""));
  const found = await findAssets(source);
  const chosen = has("all") ? found : ids.map((id) => {
    const asset = found.find((a) => a.id === id);
    if (!asset) throw new Error(`no asset "${id}" under ${source}. There are: ${found.map((a) => a.id).join(", ")}`);
    return asset;
  });
  if (chosen.length === 0) {
    say(`usage: bun run art -- <id>... | --all  [--check] [--sheet] [--repack [--levels]] [--source DIR] [--out DIR]\n${found.map((a) => `  ${a.id.padEnd(20)} ${a.spec.kind.padEnd(13)} ${relative(process.cwd(), a.dir)}`).join("\n")}`);
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
    const only = has("check") || has("sheet");
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

    const pack = parsePack(file);
    const report = checkAsset(asset, pack);
    report.faults.unshift(...faults);
    if (!only || has("check")) say(reportLines(report).join("\n"));
    if (!only || has("sheet")) sheet(asset, pack, report, outDir, say);
    if (report.faults.length > 0) failed++;
  }
  return failed;
}

function sheet(asset: Asset, pack: Pack, report: Report, outDir: string, say: (line: string) => void): void {
  const drawn = drawSheet(asset, pack, report);
  if (!drawn) return;
  const dir = join(outDir, asset.id.replace(":", "/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sheet.png"), encodePng(drawn.width, drawn.height, drawn.pixels));
  // The same sheet a page a file, each small enough to be read at full size.
  const pages = drawn.pages.map((p) => ({ name: p.name, file: `sheet.${p.name}.png`, y: p.y, width: p.width, height: p.height }));
  drawn.pages.forEach((p, i) => writeFileSync(join(dir, pages[i]!.file), encodePng(p.width, p.height, p.pixels)));
  writeFileSync(join(dir, "sheet.json"), JSON.stringify({ ...report, sheet: { file: "sheet.png", width: drawn.width, height: drawn.height, pages, cells: drawn.cells } }, null, 2) + "\n");
  say(`  ${join(dir, "sheet.png")} and ${pages.length} pages beside it (${pages.map((p) => p.name).join(", ")})\n  ${join(dir, "sheet.json")}`);
}

if (import.meta.main) process.exit((await main(process.argv.slice(2))) > 0 ? 1 : 0);
