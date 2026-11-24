// Render the catalogue in isolation and write review sheets beside the photographs.

import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { LANDMARKS } from "../../content/landmarks/index.ts";
import { assetFraming } from "../pack/icons.ts";
import { readBuilt } from "./built.ts";
import { buildCatalogue, itemPortraitEntries } from "./catalogue.ts";
import { fromAssets } from "./credits.ts";
import { esc } from "./html.ts";
import { itemShots } from "./item-shots.ts";
import { cataloguePortraits, drawPosters } from "./posters.ts";

const ROOT = resolve(import.meta.dir, "../..");

async function retake(args: readonly string[]): Promise<void> {
  let dist = join(ROOT, "client/dist"), out = join(ROOT, ".cache/wiki/retakes");
  const filters: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i]!;
    if (value === "--dist" || value === "--out") {
      const next = args[++i];
      if (!next || next.startsWith("--")) throw new Error(`${value} needs a directory`);
      if (value === "--dist") dist = resolve(next);
      else out = resolve(next);
    } else if (value.startsWith("--")) throw new Error(`Unknown option ${value}`);
    else filters.push(value.toLowerCase());
  }
  const built = readBuilt(dist);
  try {
    const [framing, art] = await Promise.all([assetFraming(), fromAssets()]);
    const meshes = new Set(built.manifest.meshes.map((m) => m.id));
    const entries = buildCatalogue({ framing, meshes, landmarks: LANDMARKS });
    for (const e of entries) if (e.picture?.body && e.picture.colors.length === 0) e.picture.colors = art.colours.get(e.picture.meshes[0]!) ?? [];
    const { subjects: items, byItem, groups } = itemShots(itemPortraitEntries(entries, CORE_CONTENT, built.manifest.meshes), CORE_CONTENT, meshes);
    const subjects = [...cataloguePortraits(entries), ...items];
    const entriesByKey = new Map(entries.map((e) => [byItem.get(e.id) ?? e.id.replace(/[:/]/g, "-"), e]));
    const groupsByKey = new Map([...groups].map(([name, v]) => [v.key, name]));
    const selected = subjects.filter(({ key }) => filters.length === 0 || filters.some((f) =>
      key.includes(f) || entriesByKey.get(key)?.id.toLowerCase().includes(f) || groupsByKey.get(key)?.toLowerCase().includes(f)));
    if (selected.length === 0) throw new Error(`No photos matched ${filters.join(", ")}`);
    const photos = drawPosters(built, selected, out, "");
    const sheets = new Map<string, string[]>();
    for (const subject of selected) {
      const { key } = subject;
      const group = groupsByKey.get(key);
      const e = entriesByKey.get(key);
      const label = group ?? e?.label ?? key;
      const category = group ? "Item groups" : e?.kind === "items" ? e.group : e?.kind ?? "Models";
      const { views } = photos.drawn.get(key)!;
      const images = views.map((image, i) => `<a href="${esc(image.file)}"><img loading="lazy" src="${esc(image.file)}" width="${image.width}" height="${image.height}" alt="${esc(label)}, angle ${i + 1}"></a>`).join("");
      const list = sheets.get(category) ?? [];
      list.push(`<figure>${images}<figcaption>${esc(label)}</figcaption></figure>`);
      sheets.set(category, list);
    }
    const body = [...sheets].map(([name, plates]) => `<section><h2>${esc(name)}</h2><div>${plates.join("")}</div></section>`).join("");
    writeFileSync(join(out, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catalogue photographs</title>
<style>body{margin:2rem;background:#eef0ec;color:#1d2b27;font:16px system-ui}section>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem}figure{align-self:start;margin:0;padding:.6rem;background:#fff}img{display:block;width:100%;height:auto}figure a+a img{margin-top:.4rem}figcaption{padding:.55rem .2rem .15rem}</style>
<h1>Catalogue photographs</h1>${body}</html>`);
    console.log(`Catalogue: ${photos.made} retaken, ${selected.length - photos.made} from cache. ${join(out, "index.html")}`);
  } finally {
    built.close();
  }
}

if (import.meta.main) await retake(process.argv.slice(2));
