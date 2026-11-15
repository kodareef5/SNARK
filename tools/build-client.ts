// Builds client/dist: the bundled shell, the workers and worklets, the page, and the core assets as a boot file, a mesh
// file, a texture file for each variant and a manifest. An asset file is named after its own hash, so a browser keeps
// it for good. What is fetched whole has a Brotli copy beside it. What is fetched by range is stored a part at a time,
// deflated where that is smaller, and the levels drawn with materials are ordered for the vertex cache first.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { gameTextures } from "./art/materials.ts";
import { buildCorePack, importedMeshes } from "./pack/build.ts";
import { buildTextures, type TextureSource } from "./pack/encode.ts";
import { partHash } from "./pack/manifest.ts";
import { orderPack } from "./pack/order.ts";
import { buildSounds } from "./pack/sound.ts";
import { splitPack } from "./pack/split.ts";
import { storeParts } from "./pack/store.ts";
import { STRESS_CARDS, cardPicture, spoilStress, stressMeshes } from "./pack/stress.ts";

/** The stress cards as textures to build: every picture of each, from one pixel across up to its top. */
function stressCards(): TextureSource[] {
  return STRESS_CARDS.map((card) => ({ ...card, mips: () => Array.from({ length: Math.log2(card.top) + 1 }, (_, i) => cardPicture(card, 1 << i)) }));
}

/**
 * A file's Brotli copy. The best takes a second or more of every build. `quick` is a tenth larger and takes a few
 * hundredths of that, for a rebuild while developing.
 */
export function brotli(bytes: Uint8Array, quick: boolean): Uint8Array {
  return quick ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : brotliCompressSync(bytes);
}

/**
 * With `stress`, the stress meshes and cards are built as well, three of the meshes listed wrongly, for the page at ?stress=1
 * to draw. With `quick`, the Brotli copies are made quickly and not as small as they can be. `dist` is where it all goes,
 * client/dist if not given.
 */
export async function buildClient(opts: { stress?: boolean; quick?: boolean; dist?: string } = {}): Promise<{ jsBytes: number; packBytes: number }> {
  const root = resolve(import.meta.dir, "..");
  const dist = opts.dist ?? join(root, "client/dist");
  rmSync(join(dist, "assets"), { recursive: true, force: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  // Workers and worklets run in their own threads, so each is bundled as a separate file.
  const entrypoints = ["client/shell/main.ts", "client/voice/voice-worker.ts", "client/voice/voice-capture.ts", "client/voice/voice-playback.ts", "client/assets/assets-worker.ts", "client/sound/board.ts", "client/sound/decode-worker.ts"].map((f) => join(root, f));
  const result = await Bun.build({ entrypoints, outdir: dist, naming: "[name].[ext]", target: "browser", minify: true, sourcemap: "linked" });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  copyFileSync(join(root, "client/index.html"), join(dist, "index.html"));
  copyFileSync(join(root, "client/sound/sounds.html"), join(dist, "sounds.html"));
  const split = splitPack(orderPack(buildCorePack([...importedMeshes(), ...(opts.stress ? stressMeshes() : [])])), "core");
  const manifest = split.manifest;
  // The game's own textures, from its asset folders, and the cards.
  const sources: TextureSource[] = [...(await gameTextures()), ...(opts.stress ? stressCards() : [])];
  let t0 = performance.now();
  const textures = await buildTextures(manifest, sources, "core");
  if (textures.files.length > 0) {
    const { pictures, encoded, megapixels } = textures.report;
    console.log(`textures     ${manifest.textures!.length} in ${textures.files.length} variants, ${textures.files.reduce((sum, f) => sum + f.bytes.length, 0)} bytes: ${encoded} of ${pictures} pictures encoded (${megapixels.toFixed(1)} megapixels), ${(performance.now() - t0).toFixed(0)} ms`);
  }
  t0 = performance.now();
  const { files, report } = await storeParts([...split.files, ...textures.files], manifest);
  console.log(`parts        ${report.parts} in ${files.length - 1} files, ${report.raw} bytes stored in ${report.stored}: ${report.deflated} deflated, ${report.made} of them anew, ${(performance.now() - t0).toFixed(0)} ms`);
  if (opts.stress) spoilStress(files, manifest);
  // Sounds are a file of their own, fetched a sound at a time and stored as they are coded.
  t0 = performance.now();
  const sounds = buildSounds(files.length);
  if (sounds) {
    files.push({ name: "core.snsd", role: "sound", bytes: sounds.bytes });
    manifest.files.push({ name: "core.snsd", role: "sound", bytes: sounds.bytes.length });
    manifest.sounds = sounds.sounds;
    const r = sounds.report;
    console.log(`sounds       ${r.sounds} with ${r.takes} takes, ${r.seconds.toFixed(1)} s in ${r.bytes} bytes (${Math.round((100 * r.bytes) / Math.max(1, r.raw))}% of 16-bit), ${r.made} coded anew${r.limited.length > 0 ? `, ${r.limited.length} brought under -1 dB` : ""}, ${(performance.now() - t0).toFixed(0)} ms`);
  }
  files.forEach((f, i) => {
    manifest.files[i]!.name = f.name.replace(/\.(\w+)$/, `.${partHash(f.bytes)}.$1`);
    writeFileSync(join(dist, "assets", manifest.files[i]!.name), f.bytes);
  });
  writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
  const whole = ["index.html", "assets/manifest.json", `assets/${manifest.files[manifest.boot]!.name}`, ...result.outputs.filter((o) => o.path.endsWith(".js")).map((o) => o.path.slice(dist.length + 1))];
  for (const name of whole) writeFileSync(join(dist, `${name}.br`), brotli(readFileSync(join(dist, name)), opts.quick ?? false));
  return { jsBytes: result.outputs.find((o) => o.path.endsWith("main.js"))!.size, packBytes: files.reduce((sum, f) => sum + (f.role === "tex" ? 0 : f.bytes.length), 0) };
}

if (import.meta.main) {
  const t0 = performance.now();
  const { jsBytes, packBytes } = await buildClient({ stress: process.argv.includes("--stress") });
  console.log(`client/dist  main.js ${jsBytes} bytes, assets ${packBytes} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
}
