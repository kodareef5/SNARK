import { titlePoster } from "./title/poster.ts";
import { buildMapGallery } from "./title/maps.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { CORE_CONTENT } from "../content/core.ts";
import { BENT_SECTIONS } from "../content/bends.ts";
import { ORBS } from "../content/orb.ts";
import type { Def } from "../shared/content/defs.ts";
import { partHash } from "./pack/manifest.ts";
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

/** The studio's small scene has neither city buildings nor their collision shapes. */
export function studioContent(defs: readonly Def[]): Def[] {
  // An orb's collision is left out too: the page generates it, as it does the street's sections (client/core/fetched.ts).
  const omitted = new Set([...BENT_SECTIONS, ...ORBS].map((d) => d.id));
  for (const def of defs) {
    if (def.type !== "structure" || !def.breaks) continue;
    omitted.add(def.id);
    if (def.shape) omitted.add(def.shape);
  }
  return defs.filter((def) => !omitted.has(def.id));
}

/** The title has its own small initial bundle. The title, the wiki model viewer, and the admin camera studio open their native views on demand. */
export async function buildEntry(dist: string): Promise<void> {
  const source = resolve(import.meta.dir, "../client/entry"),
    assets = join(dist, "assets");
  const changelog = readFileSync(resolve(source, "../../CHANGELOG.txt"), "utf8");
  // The package's version is read, not imported: package.json is outside every zone the check knows.
  const project = JSON.parse(readFileSync(resolve(source, "../../package.json"), "utf8")) as { version: string };
  const releases = titleReleases(changelog, project.version);
  const files = readdirSync(assets).sort();
  const named = (prefix: string) => "assets/" + files.find((n) => n.startsWith(prefix) && !n.endsWith(".br"));
  const manifest = parseManifest(readFileSync(join(assets, "manifest.json"), "utf8"));
  const result = await Bun.build({
    entrypoints: [join(source, "entry.ts"), join(source, "flight.ts"), join(source, "studio.ts"), join(source, "scene-studio.ts"), join(source, "wait.ts")],
    outdir: dist,
    target: "browser",
    minify: true,
    naming: "[name].[ext]",
    define: { __TITLE_RELEASES__: JSON.stringify(releases), __SKY_FILE__: JSON.stringify(named("sky.")), __HUD_ATLAS_URL__: JSON.stringify(named("hud.")) },
  });
  if (!result.success) throw Error(result.logs.map(String).join("\n"));
  for (const name of ["entry.css", "flight.html", "studio.html", "scene-studio.css"]) cpSync(join(source, name), join(dist, name));
  // The waiting page carries its script in its HTML: once it is fetched, it asks nothing more of a server that is stopping.
  const waiting = readFileSync(join(dist, "wait.js"), "utf8").replaceAll("</script", "<\\/script");
  writeFileSync(join(dist, "wait.html"), readFileSync(join(source, "wait.html"), "utf8").replace("/* WAIT_SCRIPT */", () => waiting));
  rmSync(join(dist, "wait.js"));
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
  const studio = new TextEncoder().encode(JSON.stringify(studioContent(CORE_CONTENT)));
  const studioFile = `assets/studio-content.${partHash(studio)}.json`;
  writeFileSync(join(dist, studioFile), studio);
  writeFileSync(join(dist, studioFile + ".br"), brotliCompressSync(studio));
  const data = {
    music: existsSync(join(dist, theme)) && statSync(join(dist, theme)).size <= 2 * 1024 * 1024 ? theme : null,
    content: named("content."),
    studioContent: studioFile,
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
