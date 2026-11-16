// The wiki: bun run wiki, after bun run build. It reads the game's build in client/dist and the map files in
// var/maps, and writes plain files to client/dist/wiki, which the game's server serves at /wiki/ as it serves the rest
// of client/dist. Its pictures are kept under .cache/wiki, so a second build draws only what changed.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { GLASS_SIZE, GLASS_X, GLASS_Y, SKIN_HEIGHT, SKIN_WIDTH } from "../client/core/ui/skin.ts";
import { CORE_CONTENT } from "../content/core.ts";
import type { EngramDef } from "../shared/content/defs.ts";
import type { ManifestSound } from "../shared/pack/sound.ts";
import { compileContent } from "../shared/content/registry.ts";
import { vehicleFamilies } from "../shared/sound/cues.ts";
import { partHash } from "./pack/manifest.ts";
import { assetFraming } from "./pack/icons.ts";
import { buildAtlases } from "./wiki/atlas.ts";
import { readBuilt } from "./wiki/built.ts";
import { buildCatalogue, namesOf, sentence } from "./wiki/catalogue.ts";
import { entryCredit, fromAssets } from "./wiki/credits.ts";
import { checkLinks } from "./wiki/links.ts";
import { BASE } from "./wiki/html.ts";
import { drawPosters, type Subject } from "./wiki/posters.ts";
import { commands, consoleLine, publicSettings } from "./wiki/reference.ts";
import { entryPath, renderWiki, type Sound, type Track } from "./wiki/render.ts";
import { writeText } from "./wiki/files.ts";
import { weighWiki } from "./sizes.ts";

const ROOT = resolve(import.meta.dir, "..");

export interface WikiReport {
  pages: number;
  files: number;
  bytes: number;
  drawn: number;
  counts: Record<string, number>;
}

export async function buildWiki(dist = join(ROOT, "client/dist"), maps = join(ROOT, "var/maps")): Promise<WikiReport> {
  const out = join(dist, "wiki");
  const media = join(out, "media");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(media, { recursive: true });
  const built = readBuilt(dist);
  try {
    const reg = compileContent(CORE_CONTENT).registry!;
    const list = commands();
    const framing = await assetFraming();
    const entries = buildCatalogue({ console: consoleLine(list), framing, meshes: new Set(built.manifest.meshes.map((m) => m.id)) });
    const art = await fromAssets();
    // A creature whose content gives no colours is drawn in its art's own.
    for (const e of entries) if (e.picture?.body && e.picture.colors.length === 0) e.picture.colors = art.colours.get(e.picture.meshes[0]!) ?? [];
    const subjects: Subject[] = entries.flatMap((e) => (e.picture ? [{ key: e.id.replace(/[:/]/g, "-"), ...e.picture }] : []));
    const posters = drawPosters(built, subjects, media, `${BASE}media/`);
    const pictures = new Map(entries.flatMap((e) => (e.picture ? [[e.id, posters.drawn.get(e.id.replace(/[:/]/g, "-"))!] as const] : [])));
    const credits = new Map<string, string>();
    for (const e of entries) if (e.picture) credits.set(e.id, entryCredit(art.credits, e.picture.meshes, e.picture.body && e.kind !== "vehicles", e.kind === "characters"));
    const atlases = buildAtlases(reg, built.boot.palette, maps, media, `${BASE}media/`);

    const soundRow = (file: string, game: boolean) => (s: ManifestSound): Sound => {
      const name = s.id.slice(s.id.indexOf("/sound/") + 7);
      const owner = s.id.slice(0, s.id.indexOf("/sound/"));
      return { id: s.id, owner, name: sentence(name.replace(/[_/]+/g, " ")), file, at: s.at, rate: s.rate, takes: s.takes.map((t) => [t.samples, t.bytes] as const), game };
    };
    const sounds = [
      ...(built.manifest.sounds ?? []).map((s) => soundRow(built.manifest.files[s.file]!.name, true)(s)),
      ...(built.loose?.sounds ?? []).map((s) => soundRow(built.loose!.file, false)(s)),
    ];
    // What the game plays for each entry: its definitions' own sounds, a family's sounds named for it, and a vehicle's families'.
    const heard = new Map(
      entries.map((e) => {
        const def = CORE_CONTENT.find((d) => d.id === e.id)!;
        const own = e.kind === "vehicles" ? vehicleFamilies(e.id, "aliases" in def ? (def.aliases ?? []) : []) : [];
        // A vehicle of no family of its own sounds as the shared car does.
        const families = e.kind === "vehicles" && own.length === 0 ? ["core:vehicle"] : own;
        const name = e.id.slice(e.id.indexOf(":") + 1);
        const ours = (s: Sound): boolean => e.owners.includes(s.owner) || families.includes(s.owner) || s.id.endsWith(`/${name}`) || s.id.includes(`/${name}/`);
        return [e.id, sounds.filter((s) => s.game && ours(s)).map((s) => s.id)] as const;
      }),
    );
    const musicFile = join(dist, "assets/music/music.json");
    const music: Track[] = existsSync(musicFile)
      ? (JSON.parse(readFileSync(musicFile, "utf8")) as { tracks: (Omit<Track, "layers"> & { layers: string[] })[] }).tracks.map((t) => ({
          ...t,
          layers: t.layers.map((name) => ({ name, file: `${name}.opus` })),
        }))
      : [];

    // The script and the stylesheet, named by their bytes: the chunks first, then what imports them.
    const bundle = await Bun.build({ entrypoints: [join(ROOT, "client/wiki/wiki.ts")], target: "browser", format: "esm", splitting: true, minify: true });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const named = new Map<string, string>();
    let js = "";
    for (const o of [...bundle.outputs].sort((a, b) => Number(a.kind === "entry-point") - Number(b.kind === "entry-point"))) {
      let text = await o.text();
      for (const [from, to] of named) text = text.replaceAll(from, to);
      const base = o.path.replace(/^\.\//, "").replace(/(-\w+)?\.js$/, "");
      const name = `${base}.${partHash(new TextEncoder().encode(text))}.js`;
      named.set(o.path.replace(/^\.\//, ""), name);
      writeText(join(out, name), text);
      if (o.kind === "entry-point") js = `${BASE}${name}`;
    }
    const font = `/assets/${built.asset(/^hud-font\.\w+\.ttf$/)}`;
    const sheet = `/assets/${built.asset(/^hud\.\w+\.png$/)}`;
    const glass = `${(GLASS_X / (SKIN_WIDTH - GLASS_SIZE)) * 100}% ${(GLASS_Y / (SKIN_HEIGHT - GLASS_SIZE)) * 100}% / ${(SKIN_WIDTH / GLASS_SIZE) * 100}% ${(SKIN_HEIGHT / GLASS_SIZE) * 100}%`;
    const css = readFileSync(join(import.meta.dir, "wiki/wiki.css"), "utf8").replace('url("HUD_FONT")', `url("${font}")`).replace('url("HUD_SHEET") GLASS', `url("${sheet}") ${glass}`);
    const cssName = `wiki.${partHash(new TextEncoder().encode(css))}.css`;
    writeText(join(out, cssName), css);
    const search = JSON.stringify([
      ...entries.map((e) => [e.label, entryPath(e), e.group, pictures.get(e.id)?.card.file ?? ""]),
      ...atlases.map((a) => [a.label, `${BASE}maps/${a.slug}/`, "Map", a.card.file]),
    ]);
    const searchName = `search.${partHash(new TextEncoder().encode(search))}.json`;
    writeText(join(out, searchName), search);

    const rev = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT });
    const revision = rev.exitCode === 0 ? new TextDecoder().decode(rev.stdout).trim() : "";
    const engrams = CORE_CONTENT.filter((d): d is EngramDef => d.type === "engram").map((d) => ({ item: d.item, level: d.level, cost: d.cost }));
    const pages = renderWiki({
      assets: { css: `${BASE}${cssName}`, js, search: `${BASE}${searchName}`, font, revision },
      entries,
      pictures,
      credits,
      atlases,
      sounds,
      heard,
      music,
      commands: list,
      settings: publicSettings(),
      engrams,
      names: namesOf(entries),
    });
    for (const [path, html] of pages) {
      mkdirSync(join(out, path), { recursive: true });
      writeText(join(out, path, "index.html"), html);
    }
    checkLinks(pages, dist);
    const counts: Record<string, number> = { maps: atlases.length };
    for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    const files = [...new Bun.Glob("**/*").scanSync({ cwd: out, onlyFiles: true })];
    return { pages: pages.size, files: files.length, bytes: files.reduce((n, f) => n + Bun.file(join(out, f)).size, 0), drawn: posters.made, counts };
  } finally {
    built.close();
  }
}

if (import.meta.main) {
  const dist = resolve(process.argv[2] ?? join(ROOT, "client/dist"));
  const t0 = performance.now();
  const r = await buildWiki(dist);
  const kinds = Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(", ");
  console.log(`wiki         ${r.pages} pages (${kinds}), ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB, ${r.drawn} pictures drawn, ${(performance.now() - t0).toFixed(0)} ms`);
  if (!weighWiki(dist)) process.exitCode = 1;
}
