// The wiki's map of each world, from the map file a server is started with (var/maps/<name>.snmap): the ground as the
// game colours it, where each kind of resource grows, the regions each creature is kept stocked in, where survivors
// arrive and vehicles stand, the landmarks it places, and from the map's world.json its obelisks and districts. A map that
// has no file is left out.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAPS } from "../../content/maps.ts";
import type { Def, MapDef, SpawnsDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { mapSizeX, mapSizeZ } from "../../shared/coords.ts";
import { mapHeightfield, mapNodes, parseMap } from "../../shared/world/mapfile.ts";
import { Base } from "../mapworld/base.ts";
import { place } from "./files.ts";
import { indexedPng } from "./quantize.ts";
import { scaled, type Picture } from "./posters.ts";

const ROOT = resolve(import.meta.dir, "../..");
const CACHE = join(ROOT, ".cache/wiki/maps");
/** The ground's picture is the largest of these along the map's longer side that PNG holds in GROUND_BYTES; a card's is CARD wide. */
const SIDES = [768, 640, 512];
const GROUND_BYTES = 240 * 1024;
const CARD = 240;
/** Squares along the longer side of a resource's picture: one for every 32 m of an 8 km map. */
const GRID = 254;
/** The overlays are drawn in a box this many units wide, and as deep as the map's proportions make it. */
export const BOX = 1000;

export interface Layer {
  id: string;
  /** What the layer is of: a node kind, a species or a vehicle kind. */
  of: string;
  picture?: Picture;
  /** For a creature, how many regions hold it; for a resource, how many grow; for a vehicle, how many stand. */
  count: number;
  colour: string;
}

export interface Mark {
  name: string;
  x: number;
  y: number;
}

export interface Region {
  x: number;
  y: number;
  /** In BOX units: a circle's radius, or a box's half width and depth. */
  r: number;
  half?: [number, number];
  species: string[];
  count: number;
}

export interface Atlas {
  id: string;
  slug: string;
  label: string;
  /** The map's extent, west to east and north to south. */
  metres: [number, number];
  ground: Picture;
  card: Picture;
  resources: Layer[];
  creatures: Layer[];
  vehicles: { kind: string; count: number; at: Mark[] }[];
  regions: Region[];
  spawns: Mark[];
  obelisks: Mark[];
  /** The landmarks the map places, by name, each where the middle of its pieces is. */
  landmarks: (Mark & { of: string })[];
  districts: { name: string; points: [number, number][]; at: Mark }[];
  /** The first column of the table in the map's SOURCES.md. */
  sources: string[];
}

/** Red, green and blue, 0 to 255, of a hue in degrees, a saturation and a lightness. */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

const hex = (palette: Uint8Array, k: number): string => `#${[0, 1, 2].map((c) => palette[k * 4 + c]!.toString(16).padStart(2, "0")).join("")}`;

/** What the wiki reads of a map's world.json. */
interface WorldPlaces {
  obelisks?: { name: string; at: [number, number] }[];
  districts?: { name: string; ring: [number, number][] }[];
}

const at1 = (n: number): number => Math.round(n * 10) / 10;

/** The species each spawn table may add, those that wait for a feature left out. */
function speciesOf(def: SpawnsDef): string[] {
  return [...new Set(def.entries.filter((e) => !e.waits).flatMap((e) => e.group))];
}

/** Pixels across and down a picture of the map whose longer side is `side`, each pixel as wide as it is deep. */
function sides(map: ReturnType<typeof parseMap>, side: number): [number, number] {
  const [w, d] = [mapSizeX(map.dims), mapSizeZ(map.dims)];
  return w >= d ? [side, Math.max(1, Math.round((side * d) / w))] : [Math.max(1, Math.round((side * w) / d)), side];
}

/** The ground as the game colours it, each pixel the mean of the samples under it, shaded by its slope; water by its depth. */
function ground(palette: Uint8Array, map: ReturnType<typeof parseMap>, side: number): { rgba: Uint8Array; width: number; height: number } {
  const hf = mapHeightfield(map);
  const [W, H] = sides(map, side);
  const out = new Uint8Array(W * H * 4);
  const step = Math.max(hf.sizeX, hf.sizeZ) / side;
  const span = Math.max(1, Math.round(step / hf.cell));
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const [x, z] = [hf.sizeX - (px + 0.5) * (hf.sizeX / W), hf.sizeZ - (py + 0.5) * (hf.sizeZ / H)];
      const h = hf.heightAt(x, z);
      const water = hf.waterAt(x, z);
      const at = (py * W + px) * 4;
      if (h < water) {
        const deep = Math.min(1, (water - h) / 12);
        out.set([Math.round(46 - 26 * deep), Math.round(96 - 40 * deep), Math.round(122 - 34 * deep), 255], at);
        continue;
      }
      const [i0, j0] = [Math.floor((x - step / 2) / hf.cell), Math.floor((z - step / 2) / hf.cell)];
      const sum = [0, 0, 0];
      let n = 0;
      for (let j = Math.max(0, j0); j < Math.min(hf.nz, j0 + span); j++) {
        for (let i = Math.max(0, i0); i < Math.min(hf.nx, i0 + span); i++) {
          const k = hf.tint[j * hf.nx + i]!;
          for (let c = 0; c < 3; c++) sum[c]! += palette[k * 4 + c]!;
          n++;
        }
      }
      // Lit from the north-west, as a map is.
      const dx = (hf.heightAt(x - step, z) - hf.heightAt(x + step, z)) / (2 * step);
      const dz = (hf.heightAt(x, z - step) - hf.heightAt(x, z + step)) / (2 * step);
      const shade = Math.max(0.6, Math.min(1.3, 1 - 1.6 * dx + 1.6 * dz));
      for (let c = 0; c < 3; c++) out[at + c] = Math.min(255, Math.round((sum[c]! / Math.max(1, n)) * shade));
      out[at + 3] = 255;
    }
  }
  return { rgba: out, width: W, height: H };
}

/** The atlas of every map whose file is in `maps`, its pictures written into `out` and named from `prefix`. */
export function buildAtlases(reg: Registry, palette: Uint8Array, maps: string, out: string, prefix: string): Atlas[] {
  mkdirSync(out, { recursive: true });
  const defs = reg.defs.filter((d): d is Def => d !== null);
  const spawns = new Map(defs.filter((d): d is SpawnsDef => d.type === "spawns").map((d) => [d.id, speciesOf(d)]));
  const colours = JSON.stringify(defs.filter((d) => d.type === "node").map((d) => [d.id, d.color]));
  const atlases: Atlas[] = [];
  for (const def of MAPS as readonly MapDef[]) {
    const slug = def.id.slice(def.id.indexOf(":") + 1);
    const file = join(maps, `${slug}.snmap`);
    if (!existsSync(file)) continue;
    const bytes = new Uint8Array(readFileSync(file));
    const map = parseMap(bytes, false);
    const [sizeX, sizeZ] = [mapSizeX(map.dims), mapSizeZ(map.dims)];
    // Box units to a metre, the same both ways.
    const scale = BOX / sizeX;
    const toBox = (x: number, z: number): [number, number] => [(sizeX - x) * scale, (sizeZ - z) * scale];
    const mark = (name: string, x: number, z: number): Mark => {
      const [bx, by] = toBox(x, z);
      return { name, x: at1(bx), y: at1(by) };
    };
    const key = createHash("sha256").update(readFileSync(import.meta.filename)).update(readFileSync(join(import.meta.dir, "quantize.ts"))).update(bytes.subarray(8, 12)).update(palette).update(colours).digest("hex").slice(0, 16);
    const cached = join(CACHE, `${slug}.${key}`);
    const picture = (name: string, make: () => { rgba: Uint8Array; width: number; height: number } | Uint8Array): Picture => {
      const file = `${slug}.${key}.${name}.png`;
      if (!existsSync(join(cached, file))) {
        mkdirSync(cached, { recursive: true });
        const p = make();
        writeFileSync(join(cached, `${file}.${process.pid}`), p instanceof Uint8Array ? p : indexedPng(p.width, p.height, p.rgba));
        renameSync(join(cached, `${file}.${process.pid}`), join(cached, file));
      }
      place(join(cached, file), join(out, file));
      const png = readFileSync(join(cached, file));
      return { file: `${prefix}${file}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };
    const groundPicture = picture("ground", () => {
      let png: Uint8Array = new Uint8Array(0);
      for (const side of SIDES) {
        const g = ground(palette, map, side);
        if ((png = indexedPng(g.width, g.height, g.rgba)).length <= GROUND_BYTES) break;
      }
      return png;
    });
    const card = picture("card", () => {
      const g = ground(palette, map, SIDES.at(-1)!);
      return scaled(g.rgba, g.width, g.height, CARD);
    });

    // Every slot of every chunk, counted by kind on a grid of squares.
    const nodes = mapNodes(map, mapHeightfield(map), reg);
    const [gridW, gridH] = sides(map, GRID);
    const counts = new Map<number, Uint16Array>();
    if (nodes) {
      const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
      const chunks = map.dims.chunksX * map.dims.chunksZ;
      for (let c = 0; c < chunks; c++) {
        for (let s = 0; s < nodes.perChunk; s++) {
          nodes.at(c, s, spot);
          if (spot.kind === 0) continue;
          let grid = counts.get(spot.kind);
          if (!grid) counts.set(spot.kind, (grid = new Uint16Array(gridW * gridH)));
          const [col, row] = [Math.floor(((sizeX - spot.x) / sizeX) * gridW), Math.floor(((sizeZ - spot.z) / sizeZ) * gridH)];
          grid[Math.max(0, Math.min(gridH - 1, row)) * gridW + Math.max(0, Math.min(gridW - 1, col))]!++;
        }
      }
    }
    // Each kind its own hue, a golden angle round from the one before, so that any two shown together are told apart.
    const resources: Layer[] = [...counts].map(([kind, grid], k) => {
      const node = reg.defs[kind]!;
      const tint = hsl((k * 137.508) % 360, 0.75, 0.55);
      const colour = `#${tint.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      const most = grid.reduce((m, n) => Math.max(m, n), 1);
      const made = (): { rgba: Uint8Array; width: number; height: number } => {
        const px = new Uint8Array(gridW * gridH * 4);
        for (let i = 0; i < grid.length; i++) if (grid[i]! > 0) px.set([...tint, Math.round(40 + 200 * Math.sqrt(grid[i]! / most))], i * 4);
        return { rgba: px, width: gridW, height: gridH };
      };
      const slugOf = node.id.slice(node.id.indexOf(":") + 1);
      return { id: slugOf, of: node.id, picture: picture(`node-${slugOf}`, made), count: grid.reduce((n, x) => n + x, 0), colour };
    });

    const regions: Region[] = (map.regions ?? []).filter((z) => z.kind === "spawn" && z.spawns).map((z) => {
      const [x, y] = toBox(z.at[0], z.at[1]);
      const half: [number, number] | undefined = z.half ? [z.half[0] * scale, z.half[1] * scale] : undefined;
      return { x: at1(x), y: at1(y), r: at1((z.radius ?? 0) * scale), ...(half ? { half } : {}), species: spawns.get(z.spawns!) ?? [], count: z.count ?? 0 };
    });
    const held = new Map<string, number>();
    for (const r of regions) for (const s of r.species) held.set(s, (held.get(s) ?? 0) + 1);
    const creatures: Layer[] = [...held].map(([id, count]) => {
      const colour = hex(palette, (reg.defs[reg.index.get(id)!] as { color?: number }).color ?? 15);
      return { id: id.slice(id.indexOf(":") + 1), of: id, count, colour };
    });

    const parked = new Map<string, Mark[]>();
    for (const v of map.vehicles ?? []) parked.set(v.kind, [...(parked.get(v.kind) ?? []), mark("", v.x, v.z)]);
    // A landmark stands where the middle of its pieces is, its definitions being of its own namespace.
    const landmarks = (map.content?.landmarks ?? []).flatMap(({ name }) => {
      const s = map.statics;
      let [x, z, n] = [0, 0, 0];
      for (let i = 0; i < s.kind.length; i++) if (s.kinds[s.kind[i]!]!.startsWith(`${name}:`)) [x, z, n] = [x + s.x[i]!, z + s.z[i]!, n + 1];
      return n ? [{ of: name, ...mark(name, x / n, z / n) }] : [];
    });

    const source = join(ROOT, "assets/source/maps", slug);
    const worldFile = join(source, "world/world.json");
    const world: WorldPlaces = existsSync(worldFile) ? JSON.parse(readFileSync(worldFile, "utf8")) : {};
    const base = new Base(source);
    // The build lays its rectangle of the earth with the map's south-east corner at the square's: x = 0 is its east edge and z = 0 its south.
    const fromLonLat = (lon: number, lat: number): [number, number] => {
      const [e, n] = base.tm.forward(lon, lat);
      const [bx, by] = toBox(base.grid.east - e, n - base.grid.south);
      return [at1(bx), at1(by)];
    };
    const districts = (world.districts ?? []).map((d) => {
      const points = d.ring.map(([lon, lat]) => fromLonLat(lon, lat));
      const at = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length], [0, 0]);
      return { name: d.name, points, at: { name: d.name, x: Math.round(at[0]), y: Math.round(at[1]) } };
    });
    const obelisks = (world.obelisks ?? []).map((o) => {
      const [x, y] = fromLonLat(o.at[0], o.at[1]);
      return { name: o.name, x, y };
    });
    const notes = existsSync(join(source, "SOURCES.md")) ? readFileSync(join(source, "SOURCES.md"), "utf8") : "";
    const table = notes.split("\n").filter((l) => /^\|(?!\s*-)/.test(l)).slice(1);
    const sources = table.map((l) => l.split("|")[1]!.trim()).filter((s) => s !== "");

    atlases.push({
      id: def.id,
      slug,
      label: def.label ?? slug,
      metres: [sizeX, sizeZ],
      ground: groundPicture,
      card,
      resources,
      creatures,
      vehicles: [...parked].map(([kind, at]) => ({ kind, count: at.length, at })),
      regions,
      spawns: map.spawns.map((s) => mark(s.name, s.x, s.z)),
      obelisks,
      landmarks,
      districts,
      sources,
    });
  }
  return atlases;
}
