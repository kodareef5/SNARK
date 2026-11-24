import { MAPS } from "../../content/maps.ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MapHead } from "../../shared/world/mapfile.ts";
import { encodePng, readPicture } from "../pack/image.ts";
import { cutRelief, mapHeader, overviewRelief, spawnRelief, writeRelief } from "./map-card.ts";

// These are the map teams' saved native camera views. Keep the entry catalogue small enough for browsing.
function thumbnail(source: string, dest: string, width: number) {
  const image = readPicture(source);
  const w = Math.min(width, image.width),
    ratio = image.width / w,
    h = Math.max(1, Math.round(image.height / ratio)),
    rgb = new Uint8Array(w * h * 3);
  const scale = image.depth === 16 ? 257 : 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const left = Math.floor((x * image.width) / w),
        right = Math.floor(((x + 1) * image.width) / w);
      const top = Math.floor((y * image.height) / h),
        bottom = Math.floor(((y + 1) * image.height) / h);
      let r = 0,
        g = 0,
        b = 0;
      for (let row = top; row < bottom; row++)
        for (let col = left; col < right; col++) {
          const at = (row * image.width + col) * image.channels;
          r += image.data[at]!;
          g += image.data[at + (image.channels < 3 ? 0 : 1)]!;
          b += image.data[at + (image.channels < 3 ? 0 : 2)]!;
        }
      const samples = (right - left) * (bottom - top) * scale;
      const at = 3 * (y * w + x);
      rgb[at] = Math.round(r / samples);
      rgb[at + 1] = Math.round(g / samples);
      rgb[at + 2] = Math.round(b / samples);
    }
  writeFileSync(dest, encodePng({ width: w, height: h, channels: 3, depth: 8, data: rgb }));
}
export function spawnPhotoName(name: string) {
  return (
    "spawn-" +
    name
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

interface MapArt {
  label: string;
  mapTile: string;
  cover: string;
  overview?: string;
  regions: Record<string, string>;
}

function json<T>(file: string, otherwise: T): T {
  if (!existsSync(file)) return otherwise;
  try { return JSON.parse(readFileSync(file, "utf8")) as T; }
  catch (error) { console.warn(`Map gallery could not read ${file}.`, String(error)); return otherwise; }
}

function builtHead(path: string, city: string): MapHead | null {
  if (!existsSync(path)) return null;
  try {
    const head = mapHeader(path);
    if (head.id !== `core:${city}`) throw Error(`Expected core:${city}, found ${head.id}.`);
    return head;
  } catch (error) {
    console.warn(`Map gallery could not read ${path}.`, String(error));
    return null;
  }
}

const entries = (folder: string): string[] => existsSync(folder) ? readdirSync(folder) : [];
const citySlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildMapGallery(maps: string, titles: string, media: string, builtMaps = resolve(import.meta.dir, "../../var/maps")) {
  const catalogue: Record<string, MapArt> = {};
  const cities = new Set([...entries(maps), ...entries(join(media, "atlas")),
    ...entries(builtMaps).filter((file) => file.endsWith(".snmap")).map((file) => file.slice(0, -6))]);
  mkdirSync(titles, { recursive: true });
  for (const city of [...cities].filter((name) => citySlug.test(name)).sort()) {
    const source = join(maps, city), views = join(source, "reports/world1");
    const report = json<{ name: string; spawn?: string }[] | null>(join(views, "views.json"), null);
    const shots = Array.isArray(report) ? report : [];
    const authored = json<{ spawns?: { name: string }[] } | null>(join(source, "world.json"), null)
      ?? json<{ spawns?: { name: string }[] }>(join(source, "world/world.json"), {});
    const head = builtHead(join(builtMaps, `${city}.snmap`), city);
    const spawnNames = new Set([...(head?.spawns ?? []), ...(authored.spawns ?? [])].map(({ name }) => name));
    const spawns = new Map(head?.spawns.map((point) => [point.name, point]));
    const relief = head ? overviewRelief(head, 512) : null;
    const folder = join(titles, "atlas", city), dir = `title/atlas/${city}/`;
    const regions: Record<string, string> = Object.create(null);
    let firstPhoto: string | undefined;
    function legacy(name: string, file: string, width: number): string | undefined {
      const path = join(views, name);
      if (!existsSync(path)) return undefined;
      mkdirSync(folder, { recursive: true });
      try {
        thumbnail(path, join(folder, file), width);
        return dir + file;
      } catch (error) {
        console.warn(`Map gallery could not read ${path}.`, String(error));
        return undefined;
      }
    }
    for (const name of spawnNames) {
      const stem = spawnPhotoName(name), webp = `${stem}.webp`;
      const photo = join(media, "atlas", city, webp);
      if (existsSync(photo)) {
        mkdirSync(folder, { recursive: true });
        copyFileSync(photo, join(folder, webp));
        regions[name] = dir + webp;
        firstPhoto ??= regions[name];
        continue;
      }
      const saved = shots.find((shot) => shot.spawn === name && citySlug.test(shot.name));
      const native = `${saved?.name ?? stem}.png`;
      const shot = legacy(native, native, 360);
      if (shot) {
        regions[name] = shot;
        firstPhoto ??= shot;
        continue;
      }
      const point = spawns.get(name);
      if (head && relief && point) {
        mkdirSync(folder, { recursive: true });
        writeRelief(join(folder, `${stem}.png`), spawnRelief(relief, head, point));
        regions[name] = dir + stem + ".png";
      }
    }
    let overview: string | undefined;
    if (relief) {
      mkdirSync(folder, { recursive: true });
      writeRelief(join(folder, "map.png"), relief);
      overview = dir + "map.png";
    } else {
      const tile = join(source, "tiles/z0/0_0.png");
      if (existsSync(tile)) {
        const name = `map-${city}.png`;
        copyFileSync(tile, join(titles, name));
        overview = "title/" + name;
      } else overview = legacy("mapscreen-z0-0_0.png", "map.png", 640);
    }
    let mapTile = legacy("aerial-overhead.png", "tile.png", 200);
    if (!mapTile && relief) {
      mapTile = dir + "tile.png";
      writeRelief(join(folder, "tile.png"), cutRelief(relief, 192, 192));
    }
    const skyline = shots.find((shot) => citySlug.test(shot.name) && shot.name.includes("skyline") && !shot.name.startsWith("worst") && existsSync(join(views, `${shot.name}.png`)));
    const cover = legacy(`${skyline?.name ?? "aerial-overhead"}.png`, "cover.png", 720) ?? firstPhoto ?? overview;
    if (!cover) continue;
    const id = `core:${city}`, definition = MAPS.find((def) => def.id === id);
    const label = definition?.type === "map" ? (definition.label ?? city) : city;
    catalogue[id] = { label, mapTile: mapTile ?? overview ?? cover, cover, overview, regions };
  }
  writeFileSync(join(titles, "maps.json"), JSON.stringify(catalogue));
}
