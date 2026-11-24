// The atlas photographs use the game's native renderer and fixed cameras.
// bun tools/wiki/places-shots.ts <city> [--dist client/dist] [--out folder] [--only image,image]

import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CHUNK_SIZE, FRAME_MIDDLE, type FramedDims } from "../../shared/coords.ts";
import { serverWire } from "../../server/wire.ts";
import { TransverseMercator } from "../mapworld/geo.ts";
import { partHash } from "../pack/manifest.ts";
import type { Image } from "./html.ts";
import { encodePhoto, readPhotoMap, WIKI_PHOTOS } from "./photo-files.ts";

export interface PlaceShot extends Image {
  name?: string;
  alt: string;
  caption: string;
  kind: "city" | "obelisk";
  card?: Image;
}

type Point = readonly [longitude: number, latitude: number, metresUp: number];
type Camera = { at: Point; towards: Point; hour: number; eyeSeconds?: number };
type InstrumentCamera = { view: string; hour: number; over?: number; x?: number; z?: number; look?: [number, number, number] };

interface Shot {
  kind: PlaceShot["kind"];
  caption: string;
  alt: string;
  name: string;
  camera: Camera | InstrumentCamera;
}

const ROOT = resolve(import.meta.dir, "../..");
const SIZE = [1440, 810] as const;
const SMALL = [640, 360] as const;
const CARD = [384, 216] as const;

const city = (name: string, caption: string, alt: string, camera: Camera): Shot => ({ kind: "city", name, caption, alt, camera });
const obelisk = (name: string, caption: string, alt: string, camera: InstrumentCamera): Shot => ({ kind: "obelisk", name, caption, alt, camera });

const PHOTOS: Readonly<Record<string, readonly Shot[]>> = {
  miami: [
    city("biscayne-bay", "The Miami waterfront from Biscayne Bay", "Koru and the Miami waterfront seen across the bay", { at: [-80.18310, 25.77309, 6.4], towards: [-80.18494, 25.77374, 17], hour: 17.68 }),
    city("causeways", "PortMiami and the MacArthur Causeway", "The cruise terminal and the causeway crossing the water", { at: [-80.15525, 25.78160, 25], towards: [-80.15924, 25.77361, 18], hour: 17.25 }),
    city("miami-river", "Miami River at Brickell", "The Miami River between the waterfront towers and a bridge", { at: [-80.184223, 25.769239, 61], towards: [-80.190703, 25.768877, 18], hour: 7.75 }),
    obelisk("sextant", "Red Sextant above Wynwood", "Wynwood’s red Sextant with the waterfront below", { view: "red-sextant", hour: 17.82, over: 340, look: [37, 53, 432] }),
    obelisk("lantern", "Green Louver Lantern above Miami Beach Golf Club", "The Lantern’s green lights above the channels around Miami Beach", { view: "green-lantern", hour: 17.97, over: 380, look: [0, 0, 444] }),
    obelisk("tide-eye", "Blue Tide Eye above Virginia Key", "The blue Tide Eye suspended above Virginia Key and Biscayne Bay", { view: "blue-instrument", hour: 8.08, over: 350, look: [0, 0, 440] }),
  ],
  tampa: [
    city("downtown", "Downtown Tampa across the Hillsborough River", "Sunlit downtown buildings and palms along the Hillsborough River", { at: [-82.463, 27.9485, 15], towards: [-82.4574, 27.9500, 37], hour: 17.21 }),
    city("ybor-city", "Seventh Avenue in Ybor City", "Shopfronts and palm-lined streets in Tampa’s Ybor City", { at: [-82.43772, 27.96051, 27], towards: [-82.4400, 27.96056, 5], hour: 8.95 }),
    obelisk("sextant", "Red Sextant near Raymond James Stadium", "Tampa’s red Sextant against the sunset above the stadium district", { view: "red-near", hour: 17.6, over: 340, look: [0, 0, 410] }),
    obelisk("lantern", "Green Louver Lantern above Ybor City", "Ybor City beneath the Lantern’s green tiers", { view: "green-near", hour: 17.86, over: 310, look: [0, 0, 404] }),
    obelisk("tide-eye", "Blue Tide Eye above Davis Islands", "The Tide Eye glows over Davis Islands and the bay", { view: "blue-near", hour: 18.08, over: 300, look: [0, 0, 409] }),
  ],
  "san-francisco": [
    city("downtown", "Golden Gate Bridge from the bay", "The Golden Gate Bridge framed by the headlands across the water", { at: [-122.4716, 37.81435, 16], towards: [-122.4772, 37.8172, 50], hour: 17.15 }),
    city("marina", "San Francisco’s Embarcadero", "Piers and the city skyline along the Embarcadero waterfront", { at: [-122.3893, 37.80111, 22], towards: [-122.39934, 37.79652, 42], hour: 8.2 }),
    obelisk("sextant", "Red Sextant above the Embarcadero", "The red Sextant above the bay with San Francisco behind it", { view: "red-near", hour: 8.44, x: -470, z: 130, over: 319, look: [0, 0, 421] }),
    obelisk("lantern", "Green Louver Lantern above the Panhandle", "The green Louver Lantern floating above rows of houses and city hills", { view: "green-near", hour: 17.57, over: 340, look: [0, 0, 426] }),
    obelisk("tide-eye", "Blue Tide Eye above Marina Green", "The blue Tide Eye and the Marina’s shoreline seen over the bay", { view: "blue-near", hour: 16.95, over: 330, look: [0, 0, 421] }),
  ],
  "los-angeles": [
    city("hollywood", "The Hollywood Sign on Mount Lee", "Letters of the Hollywood Sign on a green hillside", { at: [-118.32198, 34.13256, 65], towards: [-118.321639, 34.13406, 9], hour: 10.45 }),
    city("los-feliz", "Griffith Observatory above Los Feliz", "Griffith Observatory on its ridge above Los Feliz", { at: [-118.29863, 34.11597, 64], towards: [-118.30040, 34.11843, 16], hour: 8.9 }),
    obelisk("sextant", "Red Sextant above Griffith Observatory", "The red Sextant and the ridges of Griffith Park", { view: "red-near", hour: 17.72, over: 320, look: [0, 0, 406] }),
    obelisk("lantern", "Green Louver Lantern above Hollywood and Highland", "The green Louver Lantern above the rows of streets in Hollywood", { view: "green-near", hour: 17.98, over: 335, look: [0, 0, 426] }),
    obelisk("tide-eye", "Blue Tide Eye above Lake Hollywood Park", "The blue Tide Eye suspended over the Hollywood Hills", { view: "blue-near", hour: 8.32, over: 340, look: [0, 0, 425] }),
  ],
  "las-vegas": [
    city("sphere", "The Sphere and the Strip", "The Sphere and the High Roller against the Las Vegas skyline", { at: [-115.15757, 36.12083, 36], towards: [-115.16156, 36.12093, 58], hour: 17.01 }),
    city("strip", "The Strip from the Bellagio", "The Eiffel Tower and obelisk beams over the Strip at dusk", { at: [-115.17612, 36.11155, 22], towards: [-115.16714, 36.11545, 38], hour: 18.02 }),
    obelisk("sextant", "Red Sextant above the Strat", "The red Sextant glowing near the Strat’s observation tower", { view: "red-near", hour: 17.6, over: 340, look: [0, 0, 413] }),
    obelisk("lantern", "Green Louver Lantern at the Welcome sign", "The green Louver Lantern above the dry southern end of the Strip", { view: "green-near", hour: 17.56, over: 330, look: [0, 0, 413] }),
    obelisk("tide-eye", "Blue Tide Eye above the Sphere", "The blue Tide Eye and the Sphere with the Strip behind them", { view: "blue-near", hour: 17.24, over: 310, look: [0, 0, 411] }),
  ],
};

export function buildPlaceShots(sources: ReadonlyMap<string, string>, media: string, base: string): ReadonlyMap<string, PlaceShot[]> {
  function copy(slug: string, source: string, name: string, [width, height]: readonly [number, number], limit: number): Image {
    const path = join(source, `${name}.webp`);
    const bytes = readFileSync(path);
    if (bytes.length > limit) throw new Error(`the wiki's ${slug}/${name} is over ${limit / 1024} KB`);
    const file = `place-${slug}-${name}.${partHash(bytes)}.webp`;
    writeFileSync(join(media, file), bytes);
    return { file: base + file, width, height };
  }

  const shots = new Map<string, PlaceShot[]>();
  for (const [slug, source] of sources) {
    const photos = PHOTOS[slug];
    if (!photos) continue;
    shots.set(slug, photos.map(({ name, alt, kind, caption }, index) => ({
      ...copy(slug, source, name, SIZE, 320 * 1024), name, alt, kind, caption,
      small: copy(slug, source, `${name}.small`, SMALL, 100 * 1024),
      ...(index === 0 ? { card: copy(slug, source, "cover", CARD, 64 * 1024) } : {}),
    })));
  }
  return shots;
}

export const placeCities = Object.keys(PHOTOS);

export function projectCityCamera([lon0, lat0]: readonly [number, number], dims: FramedDims): (point: Point) => [number, number, number] {
  const tm = new TransverseMercator(lat0, lon0);
  // The city's south-east corner at the lattice middle is 4,064 m east and south, as in tools/maps/city.ts.
  const east = 4064 - (dims.frameX - FRAME_MIDDLE) * CHUNK_SIZE;
  const south = -4064 + (dims.frameZ - FRAME_MIDDLE) * CHUNK_SIZE;
  return ([lon, lat, up]) => {
    const [e, n] = tm.forward(lon, lat);
    return [east - e, n - south, up];
  };
}

export async function retakePlaceShots(slug: string, dist: string, map: string, destination: string, names: readonly string[] = []): Promise<void> {
  const all = PHOTOS[slug];
  if (!all) throw new Error(`no wiki cameras for ${slug}`);
  if (names.some((name) => !all.some((shot) => shot.name === name))) throw new Error(`unknown wiki camera for ${slug}: ${names.join(", ")}`);
  const photos = names.length ? all.filter((shot) => names.includes(shot.name)) : all;
  const cwebp = Bun.which("cwebp");
  if (!cwebp) throw new Error("retaking atlas pictures requires cwebp");
  if (serverWire(dist, ROOT).stale) throw new Error(`The client in ${dist} needs a rebuild before taking atlas photos (bun run build).`);
  const head = await readPhotoMap(map, slug);
  for (const { name } of head.landmarks ?? []) {
    if (!existsSync(join(dist, "assets/landmarks", `${name}.json`))) {
      throw new Error(`${slug} needs the ${name} landmark pack. Install the game's art and rebuild the client.`);
    }
  }
  const authoredDir = join(ROOT, "assets/source/maps", slug);
  const cameraPath = join(authoredDir, "look/tide-eye.json");
  const authored = JSON.parse(readFileSync(cameraPath, "utf8")) as { hour: number; views: ({ name: string } & Record<string, unknown>)[] };
  const city = JSON.parse(readFileSync(join(authoredDir, "city.json"), "utf8")) as { centre: [number, number] };
  const project = projectCityCamera(city.centre, head.dims);
  const views = photos.map(({ camera, name }) => {
    if ("at" in camera) {
      const [x, z, up] = project(camera.at);
      return { name, x, z, up, look: project(camera.towards), hour: camera.hour, eyeSeconds: camera.eyeSeconds };
    }
    const { view: authoredName, ...settings } = camera;
    const view = authored.views.find((v) => v.name === authoredName);
    if (!view) throw new Error(`no camera ${authoredName} in ${cameraPath}`);
    return { ...view, ...settings, name };
  });
  const work = mkdtempSync(join(tmpdir(), "snark-atlas-photos-"));
  try {
    const recipe = join(work, "cameras.json");
    writeFileSync(recipe, JSON.stringify({ hour: authored.hour, views }));
    const capture = Bun.spawn([
      process.execPath, join(ROOT, "tools/mapworld/gpu-views.ts"), map, recipe, work, "--dist", resolve(dist),
      "--tiers", "high", "--seconds", "18", "--canvas", "1600x900@1", "--hide-hud", "--page", "scale=1",
    ], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
    if (await capture.exited !== 0) throw new Error(`could not capture ${slug}`);
    const captures = JSON.parse(readFileSync(join(work, "views.json"), "utf8")) as { pictures: { renderer: string | null }[] };
    if (captures.pictures.length !== photos.length || captures.pictures.some((shot) => !shot.renderer)) {
      throw new Error(`${slug} has missing WebGL frames. Check the game build and graphics driver.`);
    }
    mkdirSync(destination, { recursive: true });
    const encode = (shot: Shot, name: string, size: readonly [number, number], limit: number): void => {
      const source = join(work, `${shot.name}-high.png`);
      encodePhoto(cwebp, source, join(destination, `${name}.webp`), size, limit * 1024, [86, 80, 74, 65]);
    };
    for (const shot of photos) {
      encode(shot, shot.name, SIZE, 320);
      encode(shot, `${shot.name}.small`, SMALL, 100);
    }
    if (photos.includes(all[0]!)) encode(all[0]!, "cover", CARD, 64);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { dist: { type: "string", default: "client/dist" }, out: { type: "string", default: join(WIKI_PHOTOS, "retakes/places") },
      map: { type: "string" }, only: { type: "string" } },
  });
  const [slug] = positionals;
  if (!slug) throw new Error("bun tools/wiki/places-shots.ts <city> [--dist client/dist] [--map file.snmap] [--out folder] [--only image,image]");
  const map = resolve(values.map ?? join(ROOT, "var/maps", `${slug}.snmap`));
  await retakePlaceShots(slug, resolve(values.dist!), map, join(resolve(values.out!), slug), values.only?.split(","));
}
