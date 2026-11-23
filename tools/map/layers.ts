// A map as a folder of plain layers, which is how one is made outside the engine. tools/map.ts says what goes in the folder.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE, YAW_UNITS, chunkAt, chunkCount, chunkCx, chunkCz, framed } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { Def, MapZone } from "../../shared/content/defs.ts";
import type { MapData, MapLandmark, MapSpawn, MapStatic, MapVehicle, NodeLayer as Layer } from "../../shared/world/mapfile.ts";
import { Buildings, SectorBuildings, type BuildingNames } from "../../shared/world/buildings.ts";
import { roadSamples, type MapRoad } from "../../shared/world/roadframe.ts";
import { MapWater } from "../../shared/world/water.ts";
import { readGrey, writeGrey } from "./png.ts";

/** A listed node's place in its chunk is a u16 of this many steps a metre. */
const NODE_UNITS = 65536 / CHUNK_SIZE;

interface Place {
  x: number;
  z: number;
  /** Degrees from north, turning toward +x. */
  yaw?: number;
}
/** A bent piece has its bend's eight numbers (shared/world/bends.ts packBend). */
type Piece = Place & { kind: string; y: number; bend?: number[] };
type Node = Place & { kind: string };
type Spawn = Place & { name: string };
type Vehicle = Place & Omit<MapVehicle, "yaw">;
type Zone = { kinds: Record<string, number>; bare?: number };
type NodeLayer = { seed: number; perChunk: number; kinds: Record<string, number>; allow?: string; out?: string; other?: string } | { seed: number; perChunk: number; zones: Zone[]; zone: string; out?: string; other?: string } | { list: Node[] };
type Region = { spawns: string; count: number; x: number; z: number; radius?: number; half?: [number, number] };
type Water = { squares: string; bodies: { name: string; surface: number }[] };
type Streets = { col: number; row: number; file: string }[];
type Landmarks = { landmarks: (Omit<MapLandmark, "yaw"> & { yaw: number })[]; defs: Def[] };

/** The roads' frame's planes, each a picture of its own (road-<plane>.png). */
const ROAD_PLANES = ["across", "along", "half", "lanes"] as const;

export const toYaw = (degrees = 0): number => Math.round((degrees / 360) * YAW_UNITS) & (YAW_UNITS - 1);
const toDegrees = (yaw: number): number => (yaw * 360) / YAW_UNITS;

/**
 * Reads the folder into a map. Throws, naming the file, if a layer is missing or the wrong shape. `statics`, where the
 * caller holds them already (the build, which has just written statics.json), stand for that file: read back, a city's
 * 7 to 13 M pieces were a second whole set of objects and a 1 GB string in memory at once. Every number in the file is
 * the shortest that reads back as the same double, so the map is the same to the byte either way.
 */
export function readLayers(folder: string, statics?: readonly MapStatic[]): MapData {
  const file = (name: string): Uint8Array | null => (existsSync(join(folder, name)) ? new Uint8Array(readFileSync(join(folder, name))) : null);
  const need = <T>(found: T | null, name: string): T => {
    if (found === null) throw new Error(`${folder} has no ${name}`);
    return found;
  };
  const json = <T>(name: string): T | null => {
    const bytes = file(name);
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
  };
  /** A picture, or the same values with no header, turned from north up into sample order. */
  const picture = (name: string, bits: 8 | 16, width: number, height: number): Uint8Array | Uint16Array | null => {
    const png = file(`${name}.png`);
    if (png) {
      const image = readGrey(png, `${name}.png`);
      if (image.width !== width || image.height !== height || image.data.BYTES_PER_ELEMENT * 8 !== bits) throw new Error(`${name}.png is ${image.width} by ${image.height} at ${image.data.BYTES_PER_ELEMENT * 8} bits, and must be ${width} by ${height} at ${bits}`);
      return image.data.reverse();
    }
    const raw = file(`${name}.u${bits}`);
    if (!raw) return null;
    if (raw.length !== (width * height * bits) / 8) throw new Error(`${name}.u${bits} is ${raw.length} bytes, and ${width} by ${height} takes ${(width * height * bits) / 8}`);
    return (bits === 8 ? raw : Uint16Array.from({ length: width * height }, (_, i) => raw[i * 2]! | (raw[i * 2 + 1]! << 8))).reverse();
  };

  const about = need(json<{ id: string; chunks: [number, number]; frame?: [number, number]; origin?: [number, number]; minY: number; stepY: number; tideEyes?: MapData["tideEyes"]; seaLevel?: number | null }>("map.json"), "map.json");
  const dims = framed({ chunksX: about.chunks[0], chunksZ: about.chunks[1], ...(about.frame ? { frameX: about.frame[0], frameZ: about.frame[1] } : {}), ...(about.origin ? { originX: about.origin[0], originZ: about.origin[1] } : {}) });
  const sizeX = dims.chunksX * CHUNK_SIZE;
  const sizeZ = dims.chunksZ * CHUNK_SIZE;
  const nx = sizeX / TERRAIN_CELL + 1;
  const nz = sizeZ / TERRAIN_CELL + 1;
  const heights = need(picture("heights", 16, nx, nz), "heights.png or heights.u16");

  /** An 8-bit picture of a whole number of metres a pixel, in sample order, and its metres a pixel. */
  const squares = (name: string): { cell: number; pixels: Uint8Array } => {
    const image = readGrey(need(file(name), name), name);
    const cell = sizeX / image.width;
    if (image.height * cell !== sizeZ || image.data.BYTES_PER_ELEMENT !== 1) throw new Error(`${name} is ${image.width} by ${image.height}, which is not this map at a whole number of metres a pixel in 8 bits`);
    return { cell, pixels: image.data.reverse() as Uint8Array };
  };
  const nodes = (json<NodeLayer[]>("nodes.json") ?? []).map((layer): Layer => {
    const out = { ...(!("list" in layer) && layer.out ? { out: need(file(layer.out), layer.out) } : {}), ...(!("list" in layer) && layer.other ? { other: need(file(layer.other), layer.other) } : {}) };
    if ("zones" in layer) {
      const { cell, pixels } = squares(layer.zone);
      return { seed: layer.seed, perChunk: layer.perChunk, zones: layer.zones.map((z) => ({ bare: z.bare ?? 0, kinds: Object.entries(z.kinds) })), zoneCell: cell, zone: pixels, ...out };
    }
    if (!("list" in layer)) {
      const scatter = { seed: layer.seed, perChunk: layer.perChunk, kinds: Object.entries(layer.kinds), ...out };
      if (layer.allow === undefined) return { ...scatter, allowCell: 0, allow: null };
      const { cell, pixels } = squares(layer.allow);
      const allow = new Uint8Array(Math.ceil(pixels.length / 8));
      for (let bit = 0; bit < pixels.length; bit++) if (pixels[bit]! >= 128) allow[bit >> 3]! |= 1 << (bit & 7);
      return { ...scatter, allowCell: cell, allow };
    }
    // A node's slot is its place among its chunk's rows, which keep the order they are listed in.
    const rows = layer.list.map((n) => ({ ...n, chunk: chunkAt(dims, n.x, n.z) })).sort((a, b) => a.chunk - b.chunk);
    const kinds = [...new Set(rows.map((n) => n.kind))];
    const first = new Uint32Array(chunkCount(dims) + 1);
    for (const n of rows) first[n.chunk + 1]!++;
    for (let c = 0; c < chunkCount(dims); c++) first[c + 1]! += first[c]!;
    const within = (at: number, corner: number): number => Math.min(65535, Math.max(0, Math.round((at - corner * CHUNK_SIZE) * NODE_UNITS)));
    return {
      kinds,
      first,
      kind: Uint8Array.from(rows, (n) => kinds.indexOf(n.kind)),
      x: Uint16Array.from(rows, (n) => within(n.x, chunkCx(dims, n.chunk))),
      z: Uint16Array.from(rows, (n) => within(n.z, chunkCz(dims, n.chunk))),
      yaw: Uint16Array.from(rows, (n) => toYaw(n.yaw)),
    };
  });
  const regions = json<Region[]>("regions.json");
  const vehicles = json<Vehicle[]>("vehicles.json");
  const lakes = json<Water>("water.json");
  let water: MapWater | undefined;
  if (lakes) {
    const image = readGrey(need(file(lakes.squares), lakes.squares), lakes.squares);
    const cell = sizeX / image.width;
    if (image.height * cell !== sizeZ || image.data.BYTES_PER_ELEMENT !== 2) throw new Error(`${lakes.squares} is ${image.width} by ${image.height}, which is not this map at a whole number of metres a pixel in 16 bits`);
    const bodies = lakes.bodies.map((b) => ({ name: b.name, level: Math.round((b.surface - about.minY) / about.stepY) }));
    water = MapWater.fromGrid(dims, about.minY, about.stepY, cell, bodies, (image.data as Uint16Array).reverse());
  }
  // The streets' parts as the build wrote them, the roads' frame a picture a plane, and the landmarks with their definitions.
  const streets = json<Streets>("streets.json")?.map((s) => ({ col: s.col, row: s.row, bytes: need(file(s.file), s.file) }));
  const planes = ROAD_PLANES.map((p) => picture(`road-${p}`, 8, roadSamples(nx), roadSamples(nz)) as Uint8Array | null);
  if (planes.some((p) => p) && !planes.every((p) => p)) throw new Error(`${folder} has some of the roads' frame's pictures (${ROAD_PLANES.map((p) => `road-${p}.png`).join(", ")}) and not all`);
  const road: MapRoad | null = planes[0] ? { across: planes[0], along: planes[1]!, half: planes[2]!, lanes: planes[3]! } : null;
  const marks = json<Landmarks>("landmarks.json");
  // The buildings' names and each sector's part as the build wrote it; their runs are held to the statics when the map is written.
  const built = json<{ names: BuildingNames; sectors: { col: number; row: number; file: string }[] }>("buildings.json");
  const buildings = built ? new Buildings(dims, built.names) : null;
  for (const s of built?.sectors ?? []) buildings!.set(SectorBuildings.decode(buildings!.dims, built!.names, null, s.col, s.row, need(file(s.file), s.file)));

  return {
    id: about.id,
    dims,
    minY: about.minY,
    stepY: about.stepY,
    seaLevel: about.seaLevel ?? -Infinity,
    ...(about.tideEyes?.length ? { tideEyes: about.tideEyes.map(e => ({ ...e, yaw: toYaw(e.yaw) })) } : {}),
    heights: heights as Uint16Array,
    tint: (picture("tint", 8, nx, nz) as Uint8Array | null) ?? new Uint8Array(nx * nz),
    // The ground's class each two samples a side (MapData.ground), where the folder has one: every even sample's.
    ...((g) => (g ? { ground: g as Uint8Array } : {}))(picture("ground", 8, (nx + 1) >> 1, (nz + 1) >> 1)),
    statics: statics ?? (json<Piece[]>("statics.json") ?? []).map((s): MapStatic => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: toYaw(s.yaw), ...(s.bend ? { bend: s.bend } : {}) })),
    nodes,
    spawns: need(json<Spawn[]>("spawns.json"), "spawns.json").map((s): MapSpawn => ({ name: s.name, x: s.x, z: s.z, yaw: toYaw(s.yaw) })),
    ...(regions ? { regions: regions.map((r): MapZone => ({ kind: "spawn", spawns: r.spawns, count: r.count, at: [r.x, r.z], ...(r.half ? { half: r.half } : { radius: r.radius ?? 0 }) })) } : {}),
    ...(vehicles ? { vehicles: vehicles.map((v): MapVehicle => ({ ...v, yaw: toYaw(v.yaw) })) } : {}),
    ...(water ? { water } : {}),
    ...(streets?.length ? { streets } : {}),
    ...(road ? { road } : {}),
    ...(buildings ? { buildings } : {}),
    ...(marks ? { content: { landmarks: marks.landmarks.map((l) => ({ ...l, yaw: toYaw(l.yaw) })), defs: marks.defs } } : {}),
  };
}

/**
 * Writes into `folder` what a map holds that a city's build adds after it reads its layers back (tools/mapworld/build.ts),
 * so the folder builds the same map: its streets' parts (streets.json and a file of each part's bytes), its roads' frame
 * (a picture a plane) and its landmarks with their definitions (landmarks.json). writeLayers writes them too.
 */
export function writeAttached(map: MapData, folder: string): void {
  const put = (name: string, data: Uint8Array | string): void => writeFileSync(join(folder, name), data);
  const nx = (map.dims.chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1, nz = (map.dims.chunksZ * CHUNK_SIZE) / TERRAIN_CELL + 1;
  if (map.streets?.length) {
    const list: Streets = map.streets.map((s) => ({ col: s.col, row: s.row, file: `streets-${s.col}-${s.row}.bin` }));
    map.streets.forEach((s, k) => put(list[k]!.file, s.bytes));
    put("streets.json", `[\n${list.map((s) => `  ${JSON.stringify(s)}`).join(",\n")}\n]\n`);
  }
  if (map.buildings?.sectors.some((t) => t)) {
    const sectors = map.buildings.sectors.flatMap((t) => (t ? [{ col: t.col, row: t.row, file: `buildings-${t.col}-${t.row}.bin`, bytes: t.encode() }] : []));
    for (const s of sectors) put(s.file, s.bytes);
    put("buildings.json", `${JSON.stringify({ names: map.buildings.names, sectors: sectors.map(({ col, row, file }) => ({ col, row, file })) }, null, 1)}\n`);
  }
  if (map.road) for (const p of ROAD_PLANES) put(`road-${p}.png`, writeGrey(roadSamples(nx), roadSamples(nz), map.road[p].slice().reverse()));
  if (map.content) {
    const marks: Landmarks = { landmarks: map.content.landmarks.map((l) => ({ ...l, yaw: toDegrees(l.yaw) })), defs: [...map.content.defs] };
    put("landmarks.json", `{\n  "landmarks": [\n${marks.landmarks.map((l) => `    ${JSON.stringify(l)}`).join(",\n")}\n  ],\n  "defs": [\n${marks.defs.map((d) => `    ${JSON.stringify(d)}`).join(",\n")}\n  ]\n}\n`);
  }
}

/** A map's water as the folder holds it: its bodies, and a picture of their squares north up, 16 bits, a body's number a pixel. */
export function waterLayer(dims: MapData["dims"], minY: number, stepY: number, cell: number, bodies: readonly { name: string; surface: number }[], grid: Uint16Array): { json: string; png: Uint8Array } {
  const side = (n: number): number => (n * CHUNK_SIZE) / cell;
  const doc: Water = { squares: "water.png", bodies: bodies.map((b) => ({ name: b.name, surface: Math.round((b.surface - minY) / stepY) * stepY + minY })) };
  return { json: `{\n  "squares": "water.png",\n  "bodies": [\n${doc.bodies.map((b) => `    ${JSON.stringify(b)}`).join(",\n")}\n  ]\n}\n`, png: writeGrey(side(dims.chunksX), side(dims.chunksZ), grid.slice().reverse()) };
}

/** Writes the folder `readLayers` reads the same map from. */
export function writeLayers(map: MapData, folder: string): void {
  mkdirSync(folder, { recursive: true });
  const { chunksX, chunksZ, frameX, frameZ, originX, originZ } = framed(map.dims);
  const nx = (chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const nz = (chunksZ * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const put = (name: string, data: Uint8Array | string): void => writeFileSync(join(folder, name), data);
  /** One record a line, so that a change to one shows as one line. */
  const lines = (rows: readonly unknown[]): string => `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`;
  const about = { id: map.id, chunks: [chunksX, chunksZ], frame: [frameX, frameZ], origin: [originX, originZ], minY: map.minY, stepY: map.stepY, ...(map.tideEyes?.length ? { tideEyes: map.tideEyes.map(e => ({ ...e, yaw: toDegrees(e.yaw) })) } : {}), ...(map.seaLevel === -Infinity ? {} : { seaLevel: map.seaLevel }) };
  put("map.json", `{\n${Object.entries(about).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n")}\n}\n`);
  put("heights.png", writeGrey(nx, nz, map.heights.slice().reverse()));
  put("tint.png", writeGrey(nx, nz, map.tint.slice().reverse(), defaultPalette()));
  if (map.ground) put("ground.png", writeGrey((nx + 1) >> 1, (nz + 1) >> 1, map.ground.slice().reverse()));
  if (map.statics.length > 0) put("statics.json", lines([...map.statics].map((s): Piece => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: toDegrees(s.yaw), ...(s.bend ? { bend: Array.from(s.bend) } : {}) }))));
  put("spawns.json", lines(map.spawns.map((s): Spawn => ({ name: s.name, x: s.x, z: s.z, yaw: toDegrees(s.yaw) }))));
  if (map.vehicles && map.vehicles.length > 0) put("vehicles.json", lines(map.vehicles.map((v): Vehicle => ({ ...v, yaw: toDegrees(v.yaw) }))));
  if (map.regions && map.regions.length > 0) put("regions.json", lines(map.regions.map((r): Region => ({ spawns: r.spawns!, count: r.count!, x: r.at[0], z: r.at[1], ...(r.half ? { half: [r.half[0], r.half[1]] } : { radius: r.radius! }) }))));
  const w = map.water;
  if (w) {
    const across = (chunksX * CHUNK_SIZE) / w.cell;
    const grid = new Uint16Array(across * ((chunksZ * CHUNK_SIZE) / w.cell));
    for (const c of w.chunks()) {
      const [cx, cz] = [c % chunksX, Math.floor(c / chunksX)];
      for (let j = 0; j < w.side; j++) for (let i = 0; i < w.side; i++) grid[(cz * w.side + j) * across + cx * w.side + i] = w.squares[w.block[c]! + j * w.side + i]!;
    }
    const layer = waterLayer(map.dims, map.minY, map.stepY, w.cell, w.bodies.map((b, k) => ({ name: b.name, surface: w.surface[k + 1]! })), grid);
    put("water.json", layer.json);
    put("water.png", layer.png);
  }
  writeAttached(map, folder);
  writeNodeLayers(map, folder);
}

/** Writes a map's node layers into `folder` as nodes.json and the pictures and bits it names, each slot as the map has it. */
export function writeNodeLayers(map: MapData, folder: string): void {
  const { chunksX, chunksZ } = framed(map.dims);
  const put = (name: string, data: Uint8Array | string): void => writeFileSync(join(folder, name), data);
  const lines = (rows: readonly unknown[]): string => `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`;
  if (map.nodes.length === 0) return;
  const layers = map.nodes.map((layer, i): NodeLayer => {
    const written = plain(layer, i);
    if ("first" in layer || "list" in written) return written;
    if (layer.out) put(`out-${i}.bits`, layer.out);
    if (layer.other) put(`other-${i}.bits`, layer.other);
    return { ...written, ...(layer.out ? { out: `out-${i}.bits` } : {}), ...(layer.other ? { other: `other-${i}.bits` } : {}) };
  });
  put("nodes.json", lines(layers));

  function plain(layer: Layer, i: number): NodeLayer {
    if ("first" in layer) {
      const list: Node[] = [];
      for (let c = 0; c < chunkCount(map.dims); c++) {
        for (let r = layer.first[c]!; r < layer.first[c + 1]!; r++) {
          list.push({ kind: layer.kinds[layer.kind[r]!]!, x: chunkCx(map.dims, c) * CHUNK_SIZE + layer.x[r]! / NODE_UNITS, z: chunkCz(map.dims, c) * CHUNK_SIZE + layer.z[r]! / NODE_UNITS, yaw: toDegrees(layer.yaw[r]!) });
        }
      }
      return { list };
    }
    if ("zone" in layer) {
      const wide = (chunksX * CHUNK_SIZE) / layer.zoneCell;
      const high = (chunksZ * CHUNK_SIZE) / layer.zoneCell;
      const codes = layer.codes;
      put(`zones-${i}.png`, writeGrey(wide, high, (codes ? layer.zone.map((v) => codes[v]!) : layer.zone.slice()).reverse()));
      return { seed: layer.seed, perChunk: layer.perChunk, zones: layer.zones.map((z) => ({ kinds: Object.fromEntries(z.kinds), ...(z.bare > 0 ? { bare: z.bare } : {}) })), zone: `zones-${i}.png` };
    }
    const scatter = { seed: layer.seed, perChunk: layer.perChunk, kinds: Object.fromEntries(layer.kinds) };
    if (!layer.allow) return scatter;
    const wide = (chunksX * CHUNK_SIZE) / layer.allowCell;
    const high = (chunksZ * CHUNK_SIZE) / layer.allowCell;
    const allow = layer.allow;
    put(`allow-${i}.png`, writeGrey(wide, high, Uint8Array.from({ length: wide * high }, (_, bit) => ((allow[bit >> 3]! >> (bit & 7)) & 1) * 255).reverse()));
    return { ...scatter, allow: `allow-${i}.png` };
  }
}
