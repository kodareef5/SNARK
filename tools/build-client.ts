// Builds client/dist: the bundled shell, the workers and worklets, the page, the content, and the core assets as a boot
// file, a mesh file, a page file, a texture file for each variant and a manifest. An asset file is named after its own
// hash, so a browser keeps it for good. What is fetched whole has a Brotli copy beside it. What is fetched by range is
// stored a part at a time, deflated where that is smaller, and every level is ordered for the vertex cache first, a
// flat one welded. What the first frame waits for holds the survivor's art and, of the rest of the catalogue, what the
// session starts with alone: the definitions, the rigs and a line naming each mesh and clip.

import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { Binding } from "../client/core/assets/bind.ts";
import { AssetTable } from "../client/core/assets/table.ts";
import { SKY_MATERIAL } from "../client/core/render/atmosphere.ts";
import { FAR_MESH, farColours } from "../client/core/render/far.ts";
import { skyFile, theSky } from "../client/core/render/sky.ts";
import { WATER_MATERIAL } from "../client/core/render/water.ts";
import { CORE_CONTENT } from "../content/core.ts";
import { SURFACE_MATERIAL } from "../content/surfaces.ts";
import { HUMAN } from "../shared/anim/human.ts";
import { compileContent, type Registry } from "../shared/content/registry.ts";
import { fillSlot, slotsOf } from "../shared/content/slots.ts";
import { describePack } from "../shared/pack/manifest.ts";
import { parsePack, type Pack } from "../shared/pack/pack.ts";
import { TEXTURE_FORMATS } from "../shared/pack/texture.ts";
import { soundsHeard } from "../shared/sound/reach.ts";
import { nodeForms } from "../shared/world/nodes.ts";
import { gameTextures } from "./art/materials.ts";
import { ART, LANDMARKS, SOURCE } from "./art/source.ts";
import { farMeshId } from "../shared/pack/far.ts";
import { BEAM_MESH, MISSING_MESH, WATER_MESH, buildCorePack, importedMeshes } from "./pack/build.ts";
import { writeTextures, type TextureSource } from "./pack/encode.ts";
import { landmarkArt, landmarkPack } from "./pack/far.ts";
import { gameIcons } from "./pack/icons.ts";
import { partHash } from "./pack/manifest.ts";
import { orderPack } from "./pack/order.ts";
import { SOUND_RATES, buildSounds, findSheets, type SoundReport } from "./pack/sound.ts";
import { bootManifest, splitLandmark, splitPack, writePages, type SplitFile } from "./pack/split.ts";
import { storeParts, type StoreReport } from "./pack/store.ts";
import { STRESS_CARDS, cardPicture, spoilStress, stressMeshes } from "./pack/stress.ts";
import { mapLandmarks, weigh, weighLandmarks } from "./sizes.ts";
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
 * What the boot file holds and how the rest is paged: the bodies, hair and beards of the species on the human skeleton
 * (the survivor's among them) and the meshes the client finds by name in the boot file, and the others grouped by the kind of definition that first draws them and placed in
 * the order of the content, so a page holds what is seen together: a node's living forms apart from what is left of
 * one used up. A mesh no slot names goes with the nearest name that one does.
 */
export function paging(reg: Registry, pack: Pack): { boot: (id: string) => boolean; place: (id: string) => readonly [number, number] } {
  const has = (asset: string, id: string): boolean => asset === "mesh" && pack.meshIndex.has(id);
  const boot = new Set([MISSING_MESH, WATER_MESH, BEAM_MESH, FAR_MESH]);
  const places = new Map<string, readonly [number, number]>();
  const kinds = new Map<string, number>();
  const note = (id: string, kind: string): void => {
    if (id === "" || places.has(id)) return;
    if (!kinds.has(kind)) kinds.set(kind, kinds.size);
    places.set(id, [kinds.get(kind)!, places.size]);
  };
  const kindOf = (k: number): string => `${reg.defs[k]!.type}/${(reg.defs[k] as { class?: string }).class ?? ""}`;
  for (const u of slotsOf(reg.defs.filter((d) => d !== null))) {
    if (u.asset !== "mesh") continue;
    const owner = reg.index.get(u.owner)!;
    const id = fillSlot(u, has).id;
    // A body on the human skeleton is drawn at one level for all its parts, worked out as the scene starts.
    const d = reg.defs[owner]!;
    if (d.type === "species" && d.skeleton === HUMAN.id && ["body", "hair", "beard"].includes(u.slot) && id !== "") boot.add(id);
    note(id, kindOf(owner));
  }
  const forms = nodeForms(reg);
  for (let f = 1; f < forms.count; f++) if (pack.meshIndex.has(forms.mesh[f]!)) note(forms.mesh[f]!, `${kindOf(forms.kind[f]!)}${forms.depleted[f] === 1 ? "/used" : ""}`);
  // The stress scene places its meshes by their rows as it starts (client/core/stress.ts).
  for (const id of pack.meshIndex.keys()) if (id.startsWith("stress:")) boot.add(id);
  const ids = [...pack.meshIndex.keys()].sort();
  const common = (a: string, b: string): number => {
    let n = 0;
    while (n < a.length && a[n] === b[n]) n++;
    return n;
  };
  const named = new Set(places.keys());
  ids.forEach((id, k) => {
    if (named.has(id)) return;
    let before = k - 1, after = k + 1;
    while (before >= 0 && !named.has(ids[before]!)) before--;
    while (after < ids.length && !named.has(ids[after]!)) after++;
    const near = [ids[before], ids[after]].filter((n): n is string => n !== undefined).sort((a, b) => common(id, b) - common(id, a))[0];
    places.set(id, near === undefined ? [kinds.size, 0] : places.get(near)!);
  });
  return { boot: (id) => boot.has(id), place: (id) => places.get(id) ?? [kinds.size, 0] };
}

/** The materials the client finds by name, whose rows what it reads first holds: the world's finishes, the sky's and the water's. */
export const NAMED_MATERIALS: ReadonlySet<string> = new Set([SURFACE_MATERIAL, SKY_MATERIAL, WATER_MATERIAL]);

/** The colour far blocks draw each palette colour in, from every piece's coarsest level in the whole pack, bound as a scene binds it. */
function wholeFarColours(reg: Registry, pack: Pack): number[] {
  const table = new AssetTable(describePack(pack, { name: "", bytes: 0 }), pack);
  const bind = new Binding(reg.defs, table);
  const missing = table.find(MISSING_MESH);
  const meshOf = (k: number): number => {
    const d = reg.defs[k];
    const mesh = d && "mesh" in d && !(d.type === "structure" && d.mesh === "none") ? bind.mesh(d.id, d.type === "species" ? "body" : "mesh") : -1;
    return mesh === missing ? -1 : mesh;
  };
  return [...farColours(reg, pack, meshOf)];
}

/**
 * With `stress`, the stress meshes and cards are built as well, three of the meshes listed wrongly, for the page at ?stress=1
 * to draw. With `quick`, the Brotli copies are made quickly and not as small as they can be. `dist` is where it all goes,
 * client/dist if not given.
 */
export async function buildClient(opts: { stress?: boolean; quick?: boolean; dist?: string } = {}): Promise<{ jsBytes: number; packBytes: number }> {
  if (!ART) console.log("Building with generated geometry and the built-in HUD.");
  const root = resolve(import.meta.dir, "..");
  const dist = opts.dist ?? join(root, "client/dist");
  rmSync(join(dist, "assets"), { recursive: true, force: true });
  for (const f of existsSync(dist) ? readdirSync(dist) : []) if (f.startsWith("chunk-")) rmSync(join(dist, f));
  mkdirSync(join(dist, "assets"), { recursive: true });
  const ui = buildUiAssets(dist);
  // The sky's table and the content are files of their own, not strings in the script.
  const sky = skyFile(theSky().table), skyName = `assets/sky.${partHash(sky)}.bin`;
  writeFileSync(join(dist, skyName), sky);
  const content = new TextEncoder().encode(JSON.stringify(CORE_CONTENT)), contentName = `assets/content.${partHash(content)}.json`;
  writeFileSync(join(dist, contentName), content);
  // Workers and worklets run in their own threads, so each is bundled as a separate file. The page's script is split, so
  // that the device probe is fetched only by a page that runs it.
  const bundle = async (files: string[], splitting: boolean): Promise<Bun.BuildArtifact[]> => {
    const result = await Bun.build({ entrypoints: files.map((f) => join(root, f)), outdir: dist, naming: "[name].[ext]", splitting, target: "browser", minify: true, sourcemap: "linked", define: { __HUD_ATLAS_URL__: JSON.stringify(ui.atlas), __SKY_FILE__: JSON.stringify(skyName), __CONTENT_FILE__: JSON.stringify(contentName) } });
    if (!result.success) throw new Error(result.logs.map(String).join("\n"));
    return result.outputs;
  };
  const scripts = [...(await bundle(["client/shell/main.ts"], true)), ...(await bundle(["client/voice/voice-worker.ts", "client/voice/voice-capture.ts", "client/voice/voice-playback.ts", "client/assets/assets-worker.ts", "client/sound/board.ts", "client/sound/decode-worker.ts", "client/city/city-worker.ts"], false))].filter((o) => o.path.endsWith(".js")).map((o) => o.path.slice(dist.length + 1));
  // The pieces main.js imports before it runs, which the page asks for beside it.
  const pieces = [...readFileSync(join(dist, "main.js"), "utf8").matchAll(/\bimport\s*(?:\{[^}]*\}\s*from\s*)?"\.\/([^"]+\.js)"/g)].map((m) => m[1]!);
  console.log(`ui           ${ui.bytes} bytes transferred, ${ui.decodedBytes} RGBA bytes`);
  copyFileSync(join(root, "client/sound/sounds.html"), join(dist, "sounds.html"));
  // The music as it is played: each track's layers as Opus, music.json listing them, and the lab to hear them.
  const music = join(root, "assets/source/core/music");
  if (existsSync(join(music, "music.json"))) {
    // The lab goes beside the files it plays: assets/music/listen.html on the dev server.
    cpSync(music, join(dist, "assets/music"), { recursive: true, filter: (f) => statSync(f).isDirectory() || (/\.(opus|json|js|html)$/.test(f) && !f.slice(music.length).includes(`${sep}sound${sep}`)) });
  }
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error(`Content cannot be built:\n${errors.join("\n")}`);
  const core = orderPack(buildCorePack([...importedMeshes(), ...(opts.stress ? stressMeshes() : [])]));
  const whole = parsePack(core);
  const split = splitPack(core, "core", paging(registry!, whole));
  const manifest = split.manifest;
  const pageFile = split.files.findIndex((f) => f.role === "page");
  let packBytes = 0;
  /** Writes file `i` of the manifest, named after its hash, once its bytes are final. */
  const write = (f: SplitFile, i: number): void => {
    manifest.files[i]!.name = f.name.replace(/\.(\w+)$/, `.${partHash(f.bytes)}.$1`);
    writeFileSync(join(dist, "assets", manifest.files[i]!.name), f.bytes);
    packBytes += f.bytes.length;
  };
  // The game's own textures, from its asset folders but its landmarks', and the cards, each stored and written as it is made.
  const sources: TextureSource[] = [...(await gameTextures()), ...(opts.stress ? stressCards() : [])];
  let t0 = performance.now();
  const textures = await writeTextures(manifest, sources, "core", join(dist, "assets"));
  if (textures.raw > 0) {
    const { pictures, encoded, megapixels } = textures.report;
    console.log(`textures     ${manifest.textures!.length} in ${TEXTURE_FORMATS.length} variants, ${textures.raw} bytes: ${encoded} of ${pictures} pictures encoded (${megapixels.toFixed(1)} megapixels), ${(performance.now() - t0).toFixed(0)} ms`);
  }
  t0 = performance.now();
  const first = await storeParts(split.files, manifest, { only: split.files.flatMap((f, i) => (f.role === "page" ? [] : [i])) });
  if (opts.stress) spoilStress(first.files, manifest);
  // The pages say where everything else is stored, so they are written and stored after it.
  first.files[pageFile] = { ...first.files[pageFile]!, bytes: writePages(manifest, split.blobs) };
  const { files, report: pages } = await storeParts(first.files, manifest, { only: [pageFile] });
  const parts = [first.report, pages, textures.stored];
  const report = Object.fromEntries((["parts", "raw", "stored", "deflated", "made"] as const).map((k) => [k, parts.reduce((sum, r) => sum + r[k], 0)])) as Record<keyof StoreReport, number>;
  console.log(`parts        ${report.parts} in ${manifest.files.length - 1} files, ${report.raw} bytes stored in ${report.stored}: ${report.deflated} deflated, ${report.made} of them anew, ${manifest.pages!.length} pages in ${pages.stored} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
  files.forEach(write);
  manifest.farColours = wholeFarColours(registry!, whole);
  // The inventory pictures, drawn from the meshes and the textures as written, in sheets after the other files.
  const read = (file: number, at: number, bytes: number): Uint8Array => {
    const out = new Uint8Array(bytes);
    const fd = openSync(join(dist, "assets", manifest.files[file]!.name), "r");
    try {
      readSync(fd, out, 0, bytes, at);
    } finally {
      closeSync(fd);
    }
    return out;
  };
  const sheets = manifest.files.length;
  (await gameIcons(core, manifest, read)).forEach((f, k) => write(f, sheets + k));
  // Sounds are a file of their own, fetched a sound at a time and stored as they are coded: those a cue the game fires
  // can reach. The rest go in a file of their own for the sound board, which lists them from loose.json.
  t0 = performance.now();
  const ids = findSheets().flatMap((s) => Object.keys(s.sheet.sounds).map((name) => `${s.owner}/sound/${name}`));
  const sounds = buildSounds(manifest.files.length, undefined, undefined, soundsHeard(ids, registry!));
  if (sounds) {
    manifest.files.push({ name: "core.snsd", role: "sound", bytes: sounds.bytes.length });
    manifest.sounds = sounds.sounds;
    write({ name: "core.snsd", role: "sound", bytes: sounds.bytes }, manifest.files.length - 1);
    const line = (r: SoundReport): string => `${r.sounds} with ${r.takes} takes, ${r.seconds.toFixed(1)} s in ${r.bytes} bytes (${((r.bytes * 8) / Math.max(1, r.seconds) / 1000).toFixed(0)} kbps; s at ${SOUND_RATES.map((k, i) => `${k / 1000}k ${r.rates[i]!.toFixed(0)}`).join(", ")}; ${(r.decoded / 1048576).toFixed(1)} MB decoded), ${r.made} coded anew${r.limited.length > 0 ? `, ${r.limited.length} brought under -1 dB` : ""}`;
    console.log(`sounds       ${line(sounds.report)}; loose ${line(sounds.loose!.report)}, ${(performance.now() - t0).toFixed(0)} ms`);
  }
  if (sounds?.loose) {
    const name = `loose.${partHash(sounds.loose.bytes)}.snsd`;
    writeFileSync(join(dist, "assets", name), sounds.loose.bytes);
    writeFileSync(join(dist, "assets/loose.json"), JSON.stringify({ file: name, sounds: sounds.loose.sounds }));
  }
  // The sounds' rows are read when the sound library starts, not before the first frame.
  const rows = manifest.sounds ? new TextEncoder().encode(JSON.stringify(manifest.sounds)) : null;
  if (rows) {
    manifest.soundRows = `sounds.${partHash(rows)}.json`;
    writeFileSync(join(dist, "assets", manifest.soundRows), rows);
  }
  writeFileSync(join(dist, "assets/manifest.json"), JSON.stringify(bootManifest(manifest, (id) => NAMED_MATERIALS.has(id))));
  const landmarks = await buildLandmarks(dist, opts.quick ?? false);
  // The page asks for its script and the files the first frame needs as it is read. The server names its map's file, so main.js asks for that.
  const boot = `assets/${manifest.files[manifest.boot]!.name}`;
  const modules = ["main.js", ...pieces].map((f) => `<link rel="modulepreload" href="${f}">`).join("\n");
  const html = readFileSync(join(root, "client/index.html"), "utf8")
    .replace("<!-- HUD_FONT_PRELOAD -->", ui.font ? `<link rel="preload" href="${ui.font}" as="font" type="font/ttf" crossorigin>` : "")
    .replace("HUD_FONT_SOURCE", ui.font ? `url("${ui.font}") format("truetype")` : 'local("Arial")')
    .replaceAll("HUD_ATLAS_URL", ui.atlas)
    .replace("<!-- MODULES -->", modules)
    .replace("FETCHED", JSON.stringify(["map.json", "assets/manifest.json", boot, skyName, contentName]));
  writeFileSync(join(dist, "index.html"), html);
  const fetchedWhole = ["index.html", "assets/manifest.json", boot, skyName, contentName, ...(rows ? [`assets/${manifest.soundRows}`] : []), ...scripts];
  for (const name of fetchedWhole) writeFileSync(join(dist, `${name}.br`), brotli(readFileSync(join(dist, name)), opts.quick ?? false));
  return { jsBytes: ["main.js", ...pieces].reduce((sum, f) => sum + statSync(join(dist, f)).size, 0), packBytes: packBytes + landmarks };
}

/**
 * Each landmark's files in assets/landmarks: a boot file, a mesh file, a page file and its textures as the core's are made,
 * and the manifest that names them, which a client on a map that places it joins after the core's (shared/pack/join.ts).
 * Its pieces are paged (splitLandmark). Its bytes.
 */
async function buildLandmarks(dist: string, quick: boolean): Promise<number> {
  const out = join(dist, "assets/landmarks");
  mkdirSync(out, { recursive: true });
  let bytes = 0;
  // Their content takes a second to load, so only a build loads it.
  const { LANDMARKS: PLACED } = await import("../content/landmarks/index.ts");
  for (const name of existsSync(LANDMARKS) ? readdirSync(LANDMARKS).filter((n) => statSync(join(LANDMARKS, n)).isDirectory()).sort() : []) {
    // What the core's stages and the landmark before left is collected before a landmark's art is read.
    Bun.gc(true);
    const placed = PLACED.find((l) => l.name === name);
    if (!placed) throw new Error(`assets/source/landmarks/${name} is the art of a landmark content/landmarks/index.ts does not have`);
    const art = landmarkArt(placed);
    const { files: split, manifest, blobs } = splitLandmark(orderPack(landmarkPack(art)), name);
    await writeTextures(manifest, await gameTextures(SOURCE, name), name, out);
    // As the core's: the pages say where everything else is stored, so they are written and stored after it.
    const pageFile = split.findIndex((f) => f.role === "page");
    const first = await storeParts(split, manifest, { only: split.flatMap((f, i) => (f.role === "page" ? [] : [i])) });
    if (pageFile >= 0) first.files[pageFile] = { ...first.files[pageFile]!, bytes: writePages(manifest, blobs) };
    const { files } = pageFile < 0 ? first : await storeParts(first.files, manifest, { only: [pageFile] });
    files.forEach((f, i) => {
      manifest.files[i]!.name = f.name.replace(/\.(\w+)$/, `.${partHash(f.bytes)}.$1`);
      writeFileSync(join(out, manifest.files[i]!.name), f.bytes);
    });
    bytes += manifest.files.reduce((sum, f) => sum + f.bytes, 0);
    writeFileSync(join(out, `${name}.json`), JSON.stringify(bootManifest(manifest)));
    for (const file of [`${name}.json`, manifest.files[manifest.boot]!.name]) writeFileSync(join(out, `${file}.br`), brotli(readFileSync(join(out, file)), quick));
    console.log(`landmark     ${name}: ${manifest.meshes.length} meshes, ${manifest.textures?.length ?? 0} textures, ${manifest.files.map((f) => `${f.role} ${f.bytes}`).join(", ")} bytes`);
    const far = manifest.meshes.find((m) => m.id === farMeshId(name));
    if (far && art.far) console.log(`             ${far.id}: ${art.far.row.pieces.length / 4} pieces, ${far.levels.map((l) => `${l.tris} triangles, ${l.verts} vertices at ${l.error} m`).join("; ")}${art.far.otherwise.length > 0 ? `; drawn otherwise and left out: ${art.far.otherwise.join(", ")}` : ""}`);
  }
  return bytes;
}

/**
 * buildClient in a process of its own, for a caller that goes on running: what the build held is given back when it
 * ends. Its lines go to the caller's. Throws if it fails.
 */
export async function buildClientApart(opts: { stress?: boolean; quick?: boolean; dist?: string } = {}): Promise<void> {
  const args = [...(opts.stress ? ["--stress"] : []), ...(opts.quick ? ["--quick"] : []), "--dist", opts.dist ?? resolve(import.meta.dir, "../client/dist")];
  const code = await Bun.spawn([process.execPath, import.meta.path, ...args], { stdout: "inherit", stderr: "inherit" }).exited;
  if (code !== 0) throw new Error(`the client did not build: the build ended with ${code}`);
}

if (import.meta.main) {
  const t0 = performance.now();
  const flag = (name: string): boolean => process.argv.includes(name);
  const at = process.argv.indexOf("--dist");
  const { jsBytes, packBytes } = await buildClient({ stress: flag("--stress"), quick: flag("--quick"), ...(at >= 0 ? { dist: resolve(process.argv[at + 1]!) } : {}) });
  console.log(`client/dist  main.js ${jsBytes} bytes, assets ${packBytes} bytes, ${(performance.now() - t0).toFixed(0)} ms`);
  // Only `bun run build` is weighed: a build for a caller (buildClientApart) says where it goes.
  const dist = resolve(import.meta.dir, "../client/dist");
  if (!flag("--stress") && at < 0 && ![weigh(dist), weighLandmarks(dist, mapLandmarks(SOURCE))].every(Boolean)) process.exitCode = 1;
}
