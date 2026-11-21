import project from "../package.json";
import { titlePoster } from "./title/poster.ts";
import { buildMapGallery } from "./title/maps.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { parseManifest } from "../shared/pack/manifest.ts";

/** The title and the downloadable archive use the same releases, newest first. */
export function titleReleases(text: string, version: string) {
  const releases = text.trim().replaceAll("\r\n", "\n").split(/\n(?=v\d+\.\d+\.\d+ — )/).map((edition) => {
    const [header, ...blocks] = edition.trim().split(/\n\s*\n/);
    const match = /^(v\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/.exec(header ?? "");
    if (!match || !blocks.length) throw Error("Each changelog release needs a version, date and feature groups.");
    const groups = blocks.map((block) => {
      const [feature, ...lines] = block.split("\n");
      if (!feature || !lines.length || lines.some(line => !/^- \S/.test(line)))
        throw Error("Each changelog group needs a feature name and one or more '- ' bullets.");
      return { feature, bullets: lines.map(line => line.slice(2)) };
    });
    return { version: match[1]!, date: match[2]!, groups };
  });
  if (releases[0]!.version !== "v" + version) throw Error("The first changelog release must match the package version.");
  return releases;
}

/** The title has its own small initial bundle. The title, the wiki model viewer, and the admin camera studio open their native views on demand. */
export async function buildEntry(dist: string): Promise<void> {
  const source = resolve(import.meta.dir, "../client/entry"),
    assets = join(dist, "assets");
  const changelog = readFileSync(resolve(source, "../../CHANGELOG.txt"), "utf8");
  const releases = titleReleases(changelog, project.version);
  const files = readdirSync(assets).sort();
  const named = (prefix: string) => "assets/" + files.find((n) => n.startsWith(prefix) && !n.endsWith(".br"));
  const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
  const result = await Bun.build({
    entrypoints: [join(source, "entry.ts"), join(source, "flight.ts"), join(source, "studio.ts"), join(source, "scene-studio.ts")],
    outdir: dist,
    target: "browser",
    minify: true,
    naming: "[name].[ext]",
    define: { __TITLE_RELEASES__: JSON.stringify(releases), __SKY_FILE__: JSON.stringify(named("sky.")), __HUD_ATLAS_URL__: JSON.stringify(named("hud.")) },
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
