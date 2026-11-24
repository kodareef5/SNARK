import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { serverWire } from "../../server/wire.ts";
import { readPhotoMap, WIKI_PHOTOS } from "./photo-files.ts";
import { placeCities, retakePlaceShots } from "./places-shots.ts";

const ROOT = resolve(import.meta.dir, "../..");

function photoKey(files: readonly string[], map?: string): string {
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(file)).update("\0");
  return hash.update(map ?? "").digest("hex").slice(0, 16);
}

async function capture(cache: string, name: string, key: string, take: (path: string) => Promise<void>): Promise<string> {
  const saved = join(cache, `${name}.${key}`);
  if (existsSync(saved)) return saved;
  mkdirSync(cache, { recursive: true });
  const work = mkdtempSync(join(cache, `${name}-`));
  try {
    console.log(`wiki         photographing ${name}`);
    await take(work);
    try {
      renameSync(work, saved);
    } catch (error) {
      if (!existsSync(saved)) throw error;
    }
    return saved;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function preparePhotos(dist: string, maps: string, cache = WIKI_PHOTOS) {
  const entry = join(dist, "entry-media.json");
  if (!existsSync(entry)) throw new Error(`${entry} is missing. Build the game first (bun run build).`);
  const cityMap = (city: string): string => join(maps, `${city}.snmap`);
  const cities = placeCities.filter((city) => existsSync(cityMap(city)));
  if (cities.length && serverWire(dist, ROOT).stale) {
    throw new Error(`The client in ${dist} needs a rebuild before taking atlas photos (bun run build).`);
  }
  const client = (files: readonly string[]): string[] => files.map((file) => join(dist, file));
  const source = (files: readonly string[]): string[] => files.map((file) => join(ROOT, file));
  const landmarkDir = join(dist, "assets/landmarks");
  const landmarks = existsSync(landmarkDir) ? readdirSync(landmarkDir).filter((name) => name.endsWith(".json")).sort() : [];
  const art = client(["assets/manifest.json", ...landmarks.map((name) => `assets/landmarks/${name}`)]);
  const common = [...art, ...source(["tools/wiki/photo-files.ts", "tools/chrome.ts"])];
  const miami = cityMap("miami");
  const withMiami = existsSync(miami);
  const miamiHash = withMiami ? (await readPhotoMap(miami, "miami")).name : undefined;
  const sectionKey = photoKey([...common, ...client(["entry-media.json", "flight.js", "title/wynwood-shore.json", "page.js", "city-worker.js"]),
    ...source(["tools/wiki/photos.ts", "tools/wiki/photo-recipes.ts", "tools/wiki/photo-recipe.ts", "tools/wiki/photo-stage.ts", "shared/title-scene.ts"])], miamiHash);
  const scenes = await capture(cache, "sections", sectionKey, async (out) => {
    const args = withMiami ? ["--map", miami] : ["--only", "home,footer"];
    const task = Bun.spawn([process.execPath, join(ROOT, "tools/wiki/photos.ts"), "--dist", dist, "--out", out, ...args], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
    if (await task.exited !== 0) throw new Error("Could not take the wiki's section photos.");
  });
  const places = new Map<string, string>();
  for (const city of cities) {
    const map = cityMap(city);
    const authored = `assets/source/maps/${city}`;
    const key = photoKey([...common, ...client(["page.js", "main.js", "city-worker.js"]), ...source([
      "tools/wiki/places-shots.ts", "tools/mapworld/gpu-views.ts", "tools/mapworld/geo.ts", "tools/mapworld/obelisk-cameras.ts",
      `${authored}/city.json`, `${authored}/look/tide-eye.json`,
    ])], (await readPhotoMap(map, city)).name);
    places.set(city, await capture(cache, city, key, (out) => retakePlaceShots(city, dist, map, out)));
  }
  return { scenes, withMiami, places };
}
