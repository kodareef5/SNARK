// Builds client/dist: the bundled shell, the workers and worklets, the page, and the core assets as a boot file, a mesh
// file and a manifest. An asset file is named after its own hash, so a browser keeps it for good. What is fetched whole
// has a Brotli copy beside it.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { buildCorePack, importedMeshes } from "./pack/build.ts";
import { partHash } from "./pack/manifest.ts";
import { splitPack } from "./pack/split.ts";
import { spoilStress, stressMeshes } from "./pack/stress.ts";

/**
 * A file's Brotli copy. The best takes a second or more of every build. `quick` is a tenth larger and takes a few
 * hundredths of that, for a rebuild while developing.
 */
export function brotli(bytes: Uint8Array, quick: boolean): Uint8Array {
  return quick ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : brotliCompressSync(bytes);
}

/**
 * With `stress`, the stress meshes go into the pack as well, three of them listed wrongly, for the page at ?stress=1 to draw.
 * With `quick`, the Brotli copies are made quickly and not as small as they can be.
 */
export async function buildClient(opts: { stress?: boolean; quick?: boolean } = {}): Promise<{ jsBytes: number; packBytes: number }> {
  const root = resolve(import.meta.dir, "..");
  const dist = join(root, "client/dist");
  rmSync(join(dist, "assets"), { recursive: true, force: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  // Workers and worklets run in their own threads, so each is bundled as a separate file.
  const entrypoints = ["client/shell/main.ts", "client/voice/voice-worker.ts", "client/voice/voice-capture.ts", "client/voice/voice-playback.ts", "client/assets/assets-worker.ts"].map((f) => join(root, f));
  const result = await Bun.build({ entrypoints, outdir: dist, naming: "[name].[ext]", target: "browser", minify: true, sourcemap: "linked" });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  copyFileSync(join(root, "client/index.html"), join(dist, "index.html"));
  const { files, manifest } = splitPack(buildCorePack([...importedMeshes(), ...(opts.stress ? stressMeshes() : [])]), "core");
  if (opts.stress) spoilStress(files, manifest);
  files.forEach((f, i) => {
    manifest.files[i]!.name = f.name.replace(/\.snpk$/, `.${partHash(f.bytes)}.snpk`);
    writeFileSync(join(dist, "assets", manifest.files[i]!.name), f.bytes);
  });
  writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
  const whole = ["index.html", "assets/manifest.json", `assets/${manifest.files[manifest.boot]!.name}`, ...result.outputs.filter((o) => o.path.endsWith(".js")).map((o) => o.path.slice(dist.length + 1))];
  for (const name of whole) writeFileSync(join(dist, `${name}.br`), brotli(readFileSync(join(dist, name)), opts.quick ?? false));
  return { jsBytes: result.outputs.find((o) => o.path.endsWith("main.js"))!.size, packBytes: files.reduce((sum, f) => sum + f.bytes.length, 0) };
}

if (import.meta.main) {
  const t0 = performance.now();
  const { jsBytes, packBytes } = await buildClient();
  console.log(`client/dist  main.js ${jsBytes} bytes, assets ${packBytes} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
}
