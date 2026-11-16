// Builds client/dist: the bundled shell, the workers and worklets, the page, and the core assets as a boot file, a mesh
// file, a texture file for each variant and a manifest. An asset file is named after its own hash, so a browser keeps
// it for good. What is fetched whole has a Brotli copy beside it. What is fetched by range is stored a part at a time,
// deflated where that is smaller, and every level is ordered for the vertex cache first, a flat one welded.

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { skyFile, theSky } from "../client/core/render/sky.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { compileContent } from "../shared/content/registry.ts";
import { soundsHeard } from "../shared/sound/reach.ts";
import { gameTextures } from "./art/materials.ts";
import { buildCorePack, importedMeshes } from "./pack/build.ts";
import { buildTextures, type TextureSource } from "./pack/encode.ts";
import { gameIcons } from "./pack/icons.ts";
import { partHash } from "./pack/manifest.ts";
import { orderPack } from "./pack/order.ts";
import { SOUND_RATES, buildSounds, findSheets, type SoundReport } from "./pack/sound.ts";
import { splitPack } from "./pack/split.ts";
import { storeParts } from "./pack/store.ts";
import { STRESS_CARDS, cardPicture, spoilStress, stressMeshes } from "./pack/stress.ts";
import { buildUiAssets } from "./ui/assets.ts";

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
  for (const f of existsSync(dist) ? readdirSync(dist) : []) if (f.startsWith("chunk-")) rmSync(join(dist, f));
  mkdirSync(join(dist, "assets"), { recursive: true });
  const ui = buildUiAssets(dist);
  // The sky's table is a file of its own, not a string in the script.
  const sky = skyFile(theSky().table), skyName = `assets/sky.${partHash(sky)}.bin`;
  writeFileSync(join(dist, skyName), sky);
  // Workers and worklets run in their own threads, so each is bundled as a separate file. The page's script is split, so
  // that the device probe is fetched only by a page that runs it.
  const bundle = async (files: string[], splitting: boolean): Promise<Bun.BuildArtifact[]> => {
    const result = await Bun.build({ entrypoints: files.map((f) => join(root, f)), outdir: dist, naming: "[name].[ext]", splitting, target: "browser", minify: true, sourcemap: "linked", define: { __HUD_ATLAS_URL__: JSON.stringify(ui.atlas), __SKY_FILE__: JSON.stringify(skyName) } });
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    return result.outputs;
  };
  const scripts = [...(await bundle(["client/shell/main.ts"], true)), ...(await bundle(["client/voice/voice-worker.ts", "client/voice/voice-capture.ts", "client/voice/voice-playback.ts", "client/assets/assets-worker.ts", "client/sound/board.ts", "client/sound/decode-worker.ts"], false))].filter((o) => o.path.endsWith(".js")).map((o) => o.path.slice(dist.length + 1));
  // The pieces main.js imports before it runs, which the page asks for beside it.
  const pieces = [...readFileSync(join(dist, "main.js"), "utf8").matchAll(/\bimport\s*(?:\{[^}]*\}\s*from\s*)?"\.\/([^"]+\.js)"/g)].map((m) => m[1]!);
  console.log(`ui           ${ui.bytes} bytes transferred with compressed font, ${ui.decodedBytes} RGBA bytes`);
  copyFileSync(join(root, "client/sound/sounds.html"), join(dist, "sounds.html"));
  // The music as it is played: each track's layers as Opus, music.json listing them, and the lab to hear them.
  const music = join(root, "assets/source/core/music");
  if (existsSync(join(music, "music.json"))) {
    // The lab goes beside the files it plays: assets/music/listen.html on the dev server.
    cpSync(music, join(dist, "assets/music"), { recursive: true, filter: (f) => statSync(f).isDirectory() || (/\.(opus|json|js|html)$/.test(f) && !f.slice(music.length).includes(`${sep}sound${sep}`)) });
  }
  const core = orderPack(buildCorePack([...importedMeshes(), ...(opts.stress ? stressMeshes() : [])]));
  const split = splitPack(core, "core");
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
  // The inventory pictures, drawn from the meshes and the textures as stored, in sheets after the other files.
  files.push(...(await gameIcons(core, manifest, files)));
  if (opts.stress) spoilStress(files, manifest);
  // Sounds are a file of their own, fetched a sound at a time and stored as they are coded: those a cue the game fires
  // can reach. The rest go in a file of their own for the sound board, which lists them from loose.json.
  t0 = performance.now();
  const { registry } = compileContent(CORE_CONTENT);
  const ids = findSheets().flatMap((s) => Object.keys(s.sheet.sounds).map((name) => `${s.owner}/sound/${name}`));
  const sounds = buildSounds(files.length, undefined, undefined, soundsHeard(ids, registry!));
  if (sounds) {
    files.push({ name: "core.snsd", role: "sound", bytes: sounds.bytes });
    manifest.files.push({ name: "core.snsd", role: "sound", bytes: sounds.bytes.length });
    manifest.sounds = sounds.sounds;
    const line = (r: SoundReport): string => `${r.sounds} with ${r.takes} takes, ${r.seconds.toFixed(1)} s in ${r.bytes} bytes (${((r.bytes * 8) / Math.max(1, r.seconds) / 1000).toFixed(0)} kbps; s at ${SOUND_RATES.map((k, i) => `${k / 1000}k ${r.rates[i]!.toFixed(0)}`).join(", ")}; ${(r.decoded / 1048576).toFixed(1)} MB decoded), ${r.made} coded anew${r.limited.length > 0 ? `, ${r.limited.length} brought under -1 dB` : ""}`;
    console.log(`sounds       ${line(sounds.report)}; loose ${line(sounds.loose!.report)}, ${(performance.now() - t0).toFixed(0)} ms`);
  }
  files.forEach((f, i) => {
    manifest.files[i]!.name = f.name.replace(/\.(\w+)$/, `.${partHash(f.bytes)}.$1`);
    writeFileSync(join(dist, "assets", manifest.files[i]!.name), f.bytes);
  });
  if (sounds?.loose) {
    const name = `loose.${partHash(sounds.loose.bytes)}.snsd`;
    writeFileSync(join(dist, "assets", name), sounds.loose.bytes);
    writeFileSync(join(dist, "assets/loose.json"), JSON.stringify({ file: name, sounds: sounds.loose.sounds }));
  }
  writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(manifest));
  // The page asks for its script and the files the first frame needs as it is read. The server names its map's file, so main.js asks for that.
  const boot = `assets/${manifest.files[manifest.boot]!.name}`;
  const modules = ["main.js", ...pieces].map((f) => `<link rel="modulepreload" href="${f}">`).join("\n");
  writeFileSync(join(dist, "index.html"), readFileSync(join(root, "client/index.html"), "utf8").replaceAll("HUD_FONT_URL", ui.font).replaceAll("HUD_ATLAS_URL", ui.atlas).replace("<!-- MODULES -->", modules).replace("FETCHED", JSON.stringify(["map.json", "assets/manifest.json", boot, skyName])));
  const whole = ["index.html", "assets/manifest.json", boot, skyName, ...scripts];
  for (const name of whole) writeFileSync(join(dist, `${name}.br`), brotli(readFileSync(join(dist, name)), opts.quick ?? false));
  return { jsBytes: ["main.js", ...pieces].reduce((sum, f) => sum + statSync(join(dist, f)).size, 0), packBytes: files.reduce((sum, f) => sum + (f.role === "tex" ? 0 : f.bytes.length), 0) };
}

if (import.meta.main) {
  const t0 = performance.now();
  const { jsBytes, packBytes } = await buildClient({ stress: process.argv.includes("--stress") });
  console.log(`client/dist  main.js ${jsBytes} bytes, assets ${packBytes} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
}
