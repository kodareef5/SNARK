// The wiki: bun run wiki, after building the game and any maps to include. It writes client/dist/wiki for /wiki/.
// Pictures are kept under .cache/wiki, so a second build draws only what changed.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CORE_CONTENT } from "../content/core.ts";
import { LANDMARKS } from "../content/landmarks/index.ts";
import type { EngramDef, LevelsDef } from "../shared/content/defs.ts";
import type { ManifestSound } from "../shared/pack/sound.ts";
import { compileContent } from "../shared/content/registry.ts";
import { vehicleFamilies } from "../shared/sound/cues.ts";
import { partHash } from "./pack/manifest.ts";
import { assetFraming } from "./pack/icons.ts";
import { buildAtlases } from "./wiki/atlas.ts";
import { readBuilt } from "./wiki/built.ts";
import { buildCatalogue, itemPortraitEntries, namesOf, sentence } from "./wiki/catalogue.ts";
import { entryCredit, fromAssets } from "./wiki/credits.ts";
import { controlGroups } from "./wiki/controls.ts";
import { coverage, leftOut } from "./wiki/coverage.ts";
import { GUIDES, guidePath } from "./wiki/guides.ts";
import { wikiModels } from "./wiki/models.ts";
import { checkLinks } from "./wiki/links.ts";
import { itemShots } from "./wiki/item-shots.ts";
import { preparePhotos } from "./wiki/photo-cache.ts";
import { buildPlaceShots } from "./wiki/places-shots.ts";
import { buildWikiScenes } from "./wiki/scenes.ts";
import { BASE, slug } from "./wiki/html.ts";
import { cataloguePortraits, drawPosters } from "./wiki/posters.ts";
import { commands, consoleLine, publicSettings } from "./wiki/reference.ts";
import { commandId, entryPath, renderWiki, settingId, type Sound, type Track } from "./wiki/render.ts";
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

export async function buildWiki(dist = join(ROOT, "client/dist"), maps = join(ROOT, "var/maps"), photoCache?: string): Promise<WikiReport> {
  const photos = await preparePhotos(dist, maps, photoCache);
  const out = join(dist, "wiki");
  const media = join(out, "media");
  const built = readBuilt(dist);
  try {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(media, { recursive: true });
    const reg = compileContent(CORE_CONTENT).registry!;
    const list = commands();
    const framing = await assetFraming();
    const meshes = new Set(built.manifest.meshes.map((m) => m.id));
    const entries = buildCatalogue({ console: consoleLine(list), framing, meshes, landmarks: LANDMARKS });
    const art = await fromAssets();
    // A creature whose content gives no colours is drawn in its art's own.
    for (const e of entries) if (e.picture?.body && e.picture.colors.length === 0) e.picture.colors = art.colours.get(e.picture.meshes[0]!) ?? [];
    const items = itemShots(itemPortraitEntries(entries, CORE_CONTENT, built.manifest.meshes), CORE_CONTENT, meshes);
    const keyOf = (id: string): string => id.replace(/[:/]/g, "-");
    const subjects = cataloguePortraits(entries);
    const posters = drawPosters(built, [...subjects, ...items.subjects], media, `${BASE}media/`);
    const pictures = new Map(entries.flatMap((entry) => {
      const shot = posters.drawn.get(items.byItem.get(entry.id) ?? keyOf(entry.id));
      if (!shot) return [];
      const views = [{ ...shot.views[0]!, small: shot.card }, ...shot.views.slice(1)];
      return [[entry.id, { ...shot, views }] as const];
    }));
    const itemGroups = new Map([...items.groups].map(([group, { key, members }]) => {
      const shot = posters.drawn.get(key)!;
      return [group, { picture: { ...shot.views[0]!, small: shot.card }, members }];
    }));
    const scenes = buildWikiScenes(photos.scenes, media, `${BASE}media/`, photos.withMiami);
    const models = wikiModels(entries, CORE_CONTENT, LANDMARKS, built.manifest.meshes);
    for (const model of models.values()) writeText(join(out, model.file), model.data);
    const credits = new Map<string, string>();
    const itemMeshes = new Map(items.subjects.map(({ key, meshes }) => [key, meshes]));
    for (const e of entries) {
      const models = e.kind === "items" ? itemMeshes.get(items.byItem.get(e.id) ?? "") : e.picture?.meshes;
      if (models?.length) credits.set(e.id, entryCredit(art.credits, models, e.kind === "creatures" || e.kind === "characters", e.kind === "characters"));
    }
    const atlases = buildAtlases(reg, built.boot.palette, maps, media, `${BASE}media/`);
    const places = buildPlaceShots(photos.places, media, `${BASE}media/`);
    const left = leftOut(coverage({ defs: CORE_CONTENT, landmarks: LANDMARKS, has: (m) => meshes.has(m), maps: new Set(atlases.map((a) => a.id)) }));
    const controls = controlGroups();

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
        const def = CORE_CONTENT.find((d) => d.id === e.id);
        const own = e.kind === "vehicles" ? vehicleFamilies(e.id, def && "aliases" in def ? (def.aliases ?? []) : []) : [];
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
    const fontFile = built.asset(/^hud-font\.\w+\.ttf$/, true);
    const font = fontFile ? `/assets/${fontFile}` : "";
    const css = readFileSync(join(import.meta.dir, "wiki/wiki.css"), "utf8");
    const cssName = `wiki.${partHash(new TextEncoder().encode(css))}.css`;
    writeText(join(out, cssName), css);
    const levels = CORE_CONTENT.find((d): d is LevelsDef => d.type === "levels") ?? null;
    // Each control is found by what it does, as each entry and map by its name.
    const actions = controls.flatMap((g) => [...new Set([...g.keys, ...g.pad].map((c) => c.title))].map((title) => [title, `${BASE}controls/#${slug(g.name.toLowerCase())}`, `${g.name} control`, ""]));
    const settings = publicSettings();
    const aliases = new Map(CORE_CONTENT.flatMap((d) => "aliases" in d && d.aliases?.length ? [[d.id, d.aliases.join(" ")] as const] : []));
    const names = namesOf(entries);
    const soundOwners = [...new Set(sounds.map((s) => s.owner))];
    const search = JSON.stringify([
      ...entries.map((e) => [e.label, entryPath(e), e.group, pictures.get(e.id)?.card.file ?? "", e.id, aliases.get(e.id) ?? ""]),
      ...atlases.map((a) => [a.label, `${BASE}maps/${a.slug}/`, "Map", places.get(a.slug)?.find((shot) => shot.card)?.card?.file ?? a.card.file, a.id]),
      ...GUIDES.map((g) => [g.title, guidePath(g.slug), "Guide", "", "", g.summary]),
      ...list.map((c) => [c.name, `${BASE}commands/#${commandId(c.name)}`, "Console command", "", "", `${c.family} ${c.usage}`]),
      ...settings.map((s) => [s.name, `${BASE}settings/#${settingId(s.name)}`, "Server setting", "", "", s.group]),
      ...soundOwners.map((owner) => [`${names.get(owner) ?? sentence(owner.slice(owner.indexOf(":") + 1).replace(/[_/-]+/g, " "))} sounds`, `${BASE}sounds/${slug(owner)}/`, "Sounds", ""]),
      ...actions,
    ]);
    const searchName = `search.${partHash(new TextEncoder().encode(search))}.json`;
    writeText(join(out, searchName), search);

    const rev = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: ROOT });
    const revision = rev.exitCode === 0 ? new TextDecoder().decode(rev.stdout).trim() : "";
    const engrams = CORE_CONTENT.filter((d): d is EngramDef => d.type === "engram").map((d) => ({ item: d.item, level: d.level, cost: d.cost }));
    const pages = renderWiki({
      assets: {
        css: `${BASE}${cssName}`, js, search: `${BASE}${searchName}`, font, revision,
        ...(existsSync(join(dist, "title/snark-emblem.webp")) ? { logo: { file: "/title/snark-emblem.webp", width: 480, height: 480 } } : {}),
      },
      entries,
      pictures,
      itemGroups,
      itemSwatches: items.swatches,
      scenes,
      places,
      models,
      credits,
      atlases,
      sounds,
      heard,
      music,
      commands: list,
      settings,
      engrams,
      levels: levels ? { xp: levels.xp, points: levels.engramPoints } : null,
      controls,
      left,
      names,
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
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    maps: { type: "string", default: join(ROOT, "var/maps") }, "photo-cache": { type: "string" },
  } });
  if (positionals.length > 1) throw new Error("bun run wiki [client/dist] [--maps var/maps]");
  const dist = resolve(positionals[0] ?? join(ROOT, "client/dist"));
  const t0 = performance.now();
  const r = await buildWiki(dist, resolve(values.maps!), values["photo-cache"] && resolve(values["photo-cache"]));
  const kinds = Object.entries(r.counts).map(([k, n]) => `${n} ${k}`).join(", ");
  console.log(`wiki         ${r.pages} pages (${kinds}), ${r.files} files, ${(r.bytes / 1048576).toFixed(1)} MB, ${r.drawn} pictures drawn, ${(performance.now() - t0).toFixed(0)} ms`);
  if (!weighWiki(dist)) process.exitCode = 1;
}
