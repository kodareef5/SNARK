import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { parseManifest } from "../shared/pack/manifest.ts";

/** The title has its own small initial bundle. The native scene is requested only when it is shown. */
export async function buildEntry(dist: string): Promise<void> {
  const source = resolve(import.meta.dir, "../client/entry"),
    assets = join(dist, "assets");
  const files = readdirSync(assets);
  const named = (prefix: string) => "assets/" + files.find((n) => n.startsWith(prefix) && !n.endsWith(".br"));
  const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
  const result = await Bun.build({
    entrypoints: [join(source, "entry.ts"), join(source, "flight.ts")],
    outdir: dist,
    target: "browser",
    minify: true,
    naming: "[name].[ext]",
    define: { __SKY_FILE__: JSON.stringify(named("sky.")), __HUD_ATLAS_URL__: JSON.stringify(named("hud.")) },
  });
  if (!result.success) throw Error(result.logs.map(String).join("\n"));
  for (const name of ["entry.css", "flight.html"]) cpSync(join(source, name), join(dist, name));
  const media = join(source, "media");
  if (existsSync(media)) {
    mkdirSync(join(dist, "title"), { recursive: true });
    cpSync(media, join(dist, "title"), { recursive: true });
  }
  const font = files.find((n) => n.endsWith(".ttf"));
  const titles = join(dist, "title");
  mkdirSync(titles, { recursive: true });
  if (font) cpSync(join(assets, font), join(titles, "barlow.ttf"));
  const maps = resolve(import.meta.dir, "../assets/source/maps");
  for (const name of readdirSync(maps)) {
    const tile = join(maps, name, "tiles/z0/0_0.png");
    if (existsSync(tile)) cpSync(tile, join(titles, "map-" + name + ".png"));
  }
  const data = {
    content: named("content."),
    sky: named("sky."),
    boot: "assets/" + manifest.files[manifest.boot]!.name,
    font: font ? "assets/" + font : null,
  };
  writeFileSync(join(dist, "entry-media.json"), JSON.stringify(data));
  for (const name of ["entry.js", "flight.js", "entry.css"])
    writeFileSync(join(dist, name + ".br"), brotliCompressSync(readFileSync(join(dist, name))));
}
if (import.meta.main) await buildEntry(resolve(process.argv[2] ?? "client/dist"));
