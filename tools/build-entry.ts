import project from "../package.json";
import { titlePoster } from "./title/poster.ts";
import { buildMapGallery } from "./title/maps.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { parseManifest } from "../shared/pack/manifest.ts";

/** Only the newest edition travels in the opening bundle. The archive is served byte for byte beside it. */
export function titleRelease(text: string, version: string) {
  const [latest] = text.trim().replaceAll("\r\n", "\n").split(/\n(?=v\d+\.\d+\.\d+ — )/, 1);
  const [header, ...entries] = latest!.trimEnd().split(/\n\s*\n/);
  const label = /^(v\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/.exec(header ?? "")?.[1];
  if (label !== "v" + version || !entries.length)
    throw Error("Start CHANGELOG.txt with the package version, an em dash and the release date, then a blank line before the notes.");
  const notes = entries.map((entry) => {
    const [title, ...lines] = entry.split("\n");
    if (!title || !lines.length) throw Error("Each changelog note needs a title and a paragraph.");
    return { title, body: lines.join(" ") };
  });
  return { version: label, notes };
}

/** The title has its own small initial bundle. The title, the wiki model viewer, and the admin camera studio open their native views on demand. */
export async function buildEntry(dist: string): Promise<void> {
  const source = resolve(import.meta.dir, "../client/entry"),
    assets = join(dist, "assets");
  const changelog = readFileSync(resolve(source, "../../CHANGELOG.txt"), "utf8");
  const release = titleRelease(changelog, project.version);
  const files = readdirSync(assets).sort();
  const named = (prefix: string) => "assets/" + files.find((n) => n.startsWith(prefix) && !n.endsWith(".br"));
  const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
  const result = await Bun.build({
    entrypoints: [join(source, "entry.ts"), join(source, "flight.ts"), join(source, "studio.ts"), join(source, "scene-studio.ts")],
    outdir: dist,
    target: "browser",
    minify: true,
    naming: "[name].[ext]",
    define: { __TITLE_RELEASE__: JSON.stringify(release), __SKY_FILE__: JSON.stringify(named("sky.")), __HUD_ATLAS_URL__: JSON.stringify(named("hud.")) },
  });
  if (!result.success) throw Error(result.logs.map(String).join("\n"));
  for (const name of ["entry.css", "flight.html", "studio.html", "scene-studio.css"]) cpSync(join(source, name), join(dist, name));
  mkdirSync(join(dist, "admin"), { recursive: true });
  cpSync(join(source, "scene-studio.html"), join(dist, "admin/scene-studio.html"));
  const media = join(source, "media");
  if (existsSync(media)) {
    mkdirSync(join(dist, "title"), { recursive: true });
    cpSync(media, join(dist, "title"), { recursive: true });
  }
  const font = files.find((n) => n.endsWith(".ttf"));
  const titles = join(dist, "title");
  mkdirSync(titles, { recursive: true });
  writeFileSync(join(titles, "changelog.txt"), changelog);
  if (font) cpSync(join(assets, font), join(titles, "barlow.ttf"));
  const maps = resolve(import.meta.dir, "../assets/source/maps");
  for (const name of existsSync(maps) ? readdirSync(maps).sort() : []) {
    const tile = join(maps, name, "tiles/z0/0_0.png");
    if (existsSync(tile)) cpSync(tile, join(titles, "map-" + name + ".png"));
  }
  buildMapGallery(maps, titles, media);
  const theme = "assets/music/dawn/theme.opus";
  const data = {
    music: existsSync(join(dist, theme)) && statSync(join(dist, theme)).size <= 2 * 1024 * 1024 ? theme : null,
    content: named("content."),
    sky: named("sky."),
    boot: "assets/" + manifest.files[manifest.boot]!.name,
    font: font ? "assets/" + font : null,
  };
  writeFileSync(join(dist, "entry-media.json"), JSON.stringify(data));
  for (const name of ["entry.js", "flight.js", "studio.js", "entry.css", "title/wynwood-shore.json", "scene-studio.js", "scene-studio.css"])
    writeFileSync(join(dist, name + ".br"), brotliCompressSync(readFileSync(join(dist, name))));
  await titlePoster(dist);
}
if (import.meta.main) await buildEntry(resolve(process.argv[2] ?? "client/dist"));
