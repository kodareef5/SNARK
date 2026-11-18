import { MAPS } from "../../content/maps.ts";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng, readPicture } from "../pack/image.ts";

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

export function buildMapGallery(maps: string, titles: string, media: string) {
  const catalogue: Record<string, { label: string; mapTile: string; cover: string; overview?: string; regions: Record<string, string> }> = {};
  for (const city of (existsSync(maps) ? readdirSync(maps).sort() : [])) {
    const views = join(maps, city, "reports/world1"),
      recipe = join(views, "views.json");
    if (!existsSync(recipe)) continue;
    const folder = join(titles, "atlas", city);
    mkdirSync(folder, { recursive: true });
    const dir = "title/atlas/" + city + "/";
    const shots = JSON.parse(readFileSync(recipe, "utf8")) as { name: string; spawn?: string }[];
    const cover =
      shots.find((v) => v.name.includes("skyline") && !v.name.startsWith("worst") && existsSync(join(views, v.name + ".png")))?.name ??
      "aerial-overhead";
    thumbnail(join(views, cover + ".png"), join(folder, "cover.png"), 720);
    const id = "core:" + city;
    const definition = MAPS.find((def) => def.id === id);
    const label = definition?.type === "map" ? (definition.label ?? city) : city;
    thumbnail(join(views, "aerial-overhead.png"), join(folder, "tile.png"), 200);
    const art: (typeof catalogue)[string] = { label, mapTile: dir + "tile.png", cover: dir + "cover.png", regions: {} };
    catalogue[id] = art;
    const overview = join(views, "mapscreen-z0-0_0.png");
    if (existsSync(join(maps, city, "tiles/z0/0_0.png"))) art.overview = "title/map-" + city + ".png";
    else if (existsSync(overview)) {
      thumbnail(overview, join(folder, "map.png"), 640);
      art.overview = dir + "map.png";
    }
    const world = JSON.parse(readFileSync(join(maps, city, "world/world.json"), "utf8")) as { spawns: { name: string }[] };
    for (const { name } of world.spawns) {
      const stem = spawnPhotoName(name);
      const webp = stem + ".webp";
      if (existsSync(join(media, "atlas", city, webp))) {
        art.regions[name] = dir + webp;
        continue;
      }
      const file = (shots.find((shot) => shot.spawn === name)?.name ?? stem) + ".png",
        src = join(views, file);
      if (!existsSync(src)) continue;
      thumbnail(src, join(folder, file), 360);
      art.regions[name] = dir + file;
    }
  }
  writeFileSync(join(titles, "maps.json"), JSON.stringify(catalogue));
}
