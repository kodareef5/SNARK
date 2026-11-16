// Static map previews are derived from the authored map grids, never from player or live-entity state.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { MAPS } from "../../content/maps.ts";
import type { GuideMap, GuidePlace } from "../../shared/pages/types.ts";
import { encodePng, readPicture, type Picture } from "../pack/image.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SIZE = 768;
const COLOURS = [[72, 88, 76], [22, 69, 91], [83, 105, 80], [45, 76, 61], [65, 92, 67], [59, 91, 79], [153, 153, 119], [98, 113, 111], [137, 150, 139], [43, 95, 113], [155, 139, 101]];
const KIND_RANK = ["city", "suburb", "quarter", "island", "attraction", "park", "beach", "neighbourhood"];
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Easting/northing in the source frame becomes a north-up point over the preview image. */
export function mapPoint(east: number, north: number, bounds: readonly number[]): { x: number; y: number } | null {
  const [west, south, right, top] = bounds;
  if (bounds.length !== 4 || ![east, north, ...bounds].every(Number.isFinite) || !(right! > west!) || !(top! > south!)) return null;
  const x = (east - west!) / (right! - west!), y = (top! - north) / (top! - south!);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function grid(path: string, size: number, mode: "point" | "max"): Float32Array {
  const p = readPicture(path);
  if (p.channels !== 1) throw new Error(`map source must be greyscale: ${path}`);
  return sampleGrid(p, size, mode);
}

/** Height and biome samples retain their positions; thin road/water features survive reduction. */
export function sampleGrid(p: Picture, size: number, mode: "point" | "max"): Float32Array {
  if (!Number.isInteger(size) || size < 2 || size > 2048 || p.channels !== 1) throw new Error("unsupported map grid");
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (mode === "point") {
      const px = Math.round(x * (p.width - 1) / (size - 1)), py = Math.round(y * (p.height - 1) / (size - 1));
      out[y * size + x] = p.data[py * p.width + px]!;
    } else {
      const x0 = Math.floor(x * p.width / size), x1 = Math.min(p.width, Math.ceil((x + 1) * p.width / size));
      const y0 = Math.floor(y * p.height / size), y1 = Math.min(p.height, Math.ceil((y + 1) * p.height / size));
      let max = 0;
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) max = Math.max(max, p.data[py * p.width + px]!);
      out[y * size + x] = max;
    }
  }
  return out;
}

export function paintMap(height: Float32Array, biomes: Float32Array, water: Float32Array, roads: Float32Array, size: number, metres: number): { terrain: Picture; biomes: Picture; roads: Picture } {
  const count = size * size;
  if ([height, biomes, water, roads].some((g) => g.length !== count) || !(metres > 0)) throw new Error("map grids must share an extent");
  const terrain = new Uint8Array(count * 4), biome = new Uint8Array(count * 4), road = new Uint8Array(count * 4);
  const pitch = metres / (size - 1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, at = i * 4;
    const wet = water[i]! > 0 || biomes[i] === 1;
    const colour = COLOURS[wet ? 1 : Math.round(biomes[i]!)] ?? COLOURS[0]!;
    const dx = (height[y * size + Math.min(size - 1, x + 1)]! - height[y * size + Math.max(0, x - 1)]!) * .01 / pitch;
    const dy = (height[Math.min(size - 1, y + 1) * size + x]! - height[Math.max(0, y - 1) * size + x]!) * .01 / pitch;
    const shade = wet ? 1 : Math.round(Math.max(.6, Math.min(1.35, .94 - dx * .38 + dy * .28)) * 16) / 16;
    for (let c = 0; c < 3; c++) {
      terrain[at + c] = Math.round(colour[c]! * shade);
      biome[at + c] = Math.min(255, Math.round(colour[c]! * 1.45));
    }
    terrain[at + 3] = 255;
    biome[at + 3] = 116;
    if (roads[i]! > 0) {
      const flooded = roads[i] === 3;
      road.set(flooded ? [82, 190, 220, 224] : [208, 218, 177, 214], at);
      if (!wet) for (let c = 0; c < 3; c++) terrain[at + c] = Math.round(terrain[at + c]! * .7 + road[at + c]! * .3);
    }
  }
  const picture = (data: Uint8Array): Picture => ({ width: size, height: size, depth: 8, channels: 4, data });
  return { terrain: picture(terrain), biomes: picture(biome), roads: picture(road) };
}

function placesOf(value: unknown, bounds: readonly number[]): GuidePlace[] {
  if (!Array.isArray(value)) return [];
  const names = new Set<string>();
  return value.map(object).filter((p) => typeof p.name === "string" && typeof p.e === "number" && typeof p.n === "number")
    .sort((a, b) => {
      const rank = (x: Record<string, unknown>): number => { const n = KIND_RANK.indexOf(String(x.kind)); return n < 0 ? 99 : n; };
      return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name));
    }).flatMap((p) => {
      const label = String(p.name).slice(0, 140);
      const point = mapPoint(p.e as number, p.n as number, bounds);
      if (!point || names.has(label)) return [];
      names.add(label);
      const id = `place-${createHash("sha256").update(`${label}:${p.e}:${p.n}`).digest("hex").slice(0, 10)}`;
      return [{ id, label, ...point, kind: typeof p.kind === "string" ? p.kind : "landmark" }];
    }).slice(0, 48);
}

/** Reuses cached derivatives when source grids, source metadata and this renderer are unchanged. */
export async function buildMaps(outDir: string): Promise<GuideMap[]> {
  const output = join(outDir, "media/maps");
  mkdirSync(output, { recursive: true });
  const maps: GuideMap[] = [];
  for (const def of MAPS) {
    if (def.type !== "map") continue;
    const slug = def.id.split(":")[1]!;
    if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("unsafe map ID");
    const source = join(ROOT, "assets/source/maps", slug);
    const files = ["map.json", "world/world.json", "blocks/places.json", "base/stats.json", "base/height.png", "base/biome.png", "base/water.png", "base/roads.png"];
    const missing = files.filter((p) => !existsSync(join(source, p)));
    if (missing.length) throw new Error(`map ${def.id} is missing preview sources: ${missing.join(", ")}`);
    const hash = createHash("sha256").update(readFileSync(import.meta.filename)).update(JSON.stringify({ id: def.id, label: def.label }));
    for (const file of files) hash.update(readFileSync(join(source, file)));
    const key = hash.digest("hex").slice(0, 20);
    const cache = join(ROOT, ".cache/pages/maps", key);
    const cached = join(cache, "map.json");
    let map: GuideMap | null = null;
    if (existsSync(cached)) {
      const known = json(cached) as GuideMap;
      if ([known.image, ...known.layers.map((l) => l.image)].every((p) => existsSync(join(cache, basename(p))))) map = known;
    }
    if (!map) {
      const frame = object(json(join(source, "map.json"))), world = object(json(join(source, "world/world.json"))), stats = object(json(join(source, "base/stats.json")));
      const metres = typeof frame.size_m === "number" ? frame.size_m : 8128;
      const bounds = Array.isArray(frame.bounds) ? frame.bounds as number[] : [-metres / 2, -metres / 2, metres / 2, metres / 2];
      const painted = paintMap(grid(join(source, "base/height.png"), SIZE, "point"), grid(join(source, "base/biome.png"), SIZE, "point"), grid(join(source, "base/water.png"), SIZE, "max"), grid(join(source, "base/roads.png"), SIZE, "max"), SIZE, metres);
      mkdirSync(cache, { recursive: true });
      const image = (kind: keyof typeof painted): string => {
        const name = `${slug}-${key}-${kind}.png`;
        writeFileSync(join(cache, name), encodePng(painted[kind]));
        return `/media/maps/${name}`;
      };
      const elevation = Array.isArray(stats.height_m_valid_min_max) ? stats.height_m_valid_min_max : [];
      const facts = [
        { label: "Map width", value: (metres / 1000).toFixed(3), unit: "km" },
        { label: "Area", value: (metres * metres / 1000000).toFixed(1), unit: "km²" },
        { label: "Source terrain spacing", value: String(frame.spacing_m ?? 2), unit: "m" },
        { label: "Authored arrival regions", value: String(Array.isArray(world.spawns) ? world.spawns.length : 0) },
      ];
      if (typeof stats.buildings === "number") facts.push({ label: "Source building footprints", value: String(stats.buildings), unit: "" });
      if (typeof stats.roads === "number") facts.push({ label: "Source road features", value: String(stats.roads), unit: "" });
      if (elevation.length === 2 && elevation.every((v) => typeof v === "number" && Number.isFinite(v))) facts.push({ label: "Source terrain elevation", value: `${Number(elevation[0]).toFixed(0)}–${Number(elevation[1]).toFixed(0)}`, unit: "m" });
      const label = def.label || slug;
      map = { id: def.id, label, description: `${label}'s authored terrain, roads and named places. This atlas is derived from source map layers; it contains no live players or player-built structures.`, image: image("terrain"), width: SIZE, height: SIZE, metres,
        layers: [{ id: "biomes", label: "Biomes", image: image("biomes") }, { id: "roads", label: "Roads", image: image("roads") }],
        places: placesOf(json(join(source, "blocks/places.json")), bounds), facts,
        credit: "Map sources: © OpenStreetMap contributors (ODbL); US Census TIGER/Line, USGS and NOAA public data; USA Structures building footprints (FEMA/ORNL, Esri-hosted CC BY 4.0). Authored terrain derivatives from this content revision. Elevations are source observations, not navigation data." };
      writeFileSync(cached, JSON.stringify(map));
    }
    for (const image of [map.image, ...map.layers.map((l) => l.image)]) copyFileSync(join(cache, basename(image)), join(output, basename(image)));
    maps.push(map);
  }
  return maps;
}
