// A map as a folder of plain layers, which is how one is made outside the engine. tools/map.ts says what goes in the folder.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE, YAW_UNITS, chunkAt, chunkCount, chunkCx, chunkCz } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapZone } from "../../shared/content/defs.ts";
import type { MapData, MapSpawn, MapStatic, NodeLayer as Layer } from "../../shared/world/mapfile.ts";
import { readGrey, writeGrey } from "./png.ts";

/** A listed node's place in its chunk is a u16 of this many steps a metre. */
const NODE_UNITS = 65536 / CHUNK_SIZE;

interface Place {
  x: number;
  z: number;
  /** Degrees from north, turning toward +x. */
  yaw?: number;
}
type Piece = Place & { kind: string; y: number };
type Node = Place & { kind: string };
type Spawn = Place & { name: string };
type Zone = { kinds: Record<string, number>; bare?: number };
type NodeLayer = { seed: number; perChunk: number; kinds: Record<string, number>; allow?: string } | { seed: number; perChunk: number; zones: Zone[]; zone: string } | { list: Node[] };
type Region = { spawns: string; count: number; x: number; z: number; radius?: number; half?: [number, number] };

const toYaw = (degrees = 0): number => Math.round((degrees / 360) * YAW_UNITS) & (YAW_UNITS - 1);
const toDegrees = (yaw: number): number => (yaw * 360) / YAW_UNITS;

/** Reads the folder into a map. Throws, naming the file, if a layer is missing or the wrong shape. */
export function readLayers(folder: string): MapData {
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

  const about = need(json<{ id: string; chunks: [number, number]; minY: number; stepY: number; seaLevel?: number | null }>("map.json"), "map.json");
  const dims = { chunksX: about.chunks[0], chunksZ: about.chunks[1] };
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
    if ("zones" in layer) {
      const { cell, pixels } = squares(layer.zone);
      return { seed: layer.seed, perChunk: layer.perChunk, zones: layer.zones.map((z) => ({ bare: z.bare ?? 0, kinds: Object.entries(z.kinds) })), zoneCell: cell, zone: pixels };
    }
    if (!("list" in layer)) {
      const scatter = { seed: layer.seed, perChunk: layer.perChunk, kinds: Object.entries(layer.kinds) };
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

  return {
    id: about.id,
    dims,
    minY: about.minY,
    stepY: about.stepY,
    seaLevel: about.seaLevel ?? -Infinity,
    heights: heights as Uint16Array,
    tint: (picture("tint", 8, nx, nz) as Uint8Array | null) ?? new Uint8Array(nx * nz),
    statics: (json<Piece[]>("statics.json") ?? []).map((s): MapStatic => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: toYaw(s.yaw) })),
    nodes,
    spawns: need(json<Spawn[]>("spawns.json"), "spawns.json").map((s): MapSpawn => ({ name: s.name, x: s.x, z: s.z, yaw: toYaw(s.yaw) })),
    ...(regions ? { regions: regions.map((r): MapZone => ({ kind: "spawn", spawns: r.spawns, count: r.count, at: [r.x, r.z], ...(r.half ? { half: r.half } : { radius: r.radius ?? 0 }) })) } : {}),
  };
}

/** Writes the folder `readLayers` reads the same map from. */
export function writeLayers(map: MapData, folder: string): void {
  mkdirSync(folder, { recursive: true });
  const { chunksX, chunksZ } = map.dims;
  const nx = (chunksX * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const nz = (chunksZ * CHUNK_SIZE) / TERRAIN_CELL + 1;
  const put = (name: string, data: Uint8Array | string): void => writeFileSync(join(folder, name), data);
  /** One record a line, so that a change to one shows as one line. */
  const lines = (rows: readonly unknown[]): string => `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n")}\n]\n`;
  const about = { id: map.id, chunks: [chunksX, chunksZ], minY: map.minY, stepY: map.stepY, ...(map.seaLevel === -Infinity ? {} : { seaLevel: map.seaLevel }) };
  put("map.json", `{\n${Object.entries(about).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(",\n")}\n}\n`);
  put("heights.png", writeGrey(nx, nz, map.heights.slice().reverse()));
  put("tint.png", writeGrey(nx, nz, map.tint.slice().reverse(), defaultPalette()));
  if (map.statics.length > 0) put("statics.json", lines([...map.statics].map((s): Piece => ({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: toDegrees(s.yaw) }))));
  put("spawns.json", lines(map.spawns.map((s): Spawn => ({ name: s.name, x: s.x, z: s.z, yaw: toDegrees(s.yaw) }))));
  if (map.regions && map.regions.length > 0) put("regions.json", lines(map.regions.map((r): Region => ({ spawns: r.spawns!, count: r.count!, x: r.at[0], z: r.at[1], ...(r.half ? { half: [r.half[0], r.half[1]] } : { radius: r.radius! }) }))));
  if (map.nodes.length === 0) return;
  const layers = map.nodes.map((layer, i): NodeLayer => {
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
      put(`zones-${i}.png`, writeGrey(wide, high, layer.zone.slice().reverse()));
      return { seed: layer.seed, perChunk: layer.perChunk, zones: layer.zones.map((z) => ({ kinds: Object.fromEntries(z.kinds), ...(z.bare > 0 ? { bare: z.bare } : {}) })), zone: `zones-${i}.png` };
    }
    const scatter = { seed: layer.seed, perChunk: layer.perChunk, kinds: Object.fromEntries(layer.kinds) };
    if (!layer.allow) return scatter;
    const wide = (chunksX * CHUNK_SIZE) / layer.allowCell;
    const high = (chunksZ * CHUNK_SIZE) / layer.allowCell;
    const allow = layer.allow;
    put(`allow-${i}.png`, writeGrey(wide, high, Uint8Array.from({ length: wide * high }, (_, bit) => ((allow[bit >> 3]! >> (bit & 7)) & 1) * 255).reverse()));
    return { ...scatter, allow: `allow-${i}.png` };
  });
  put("nodes.json", lines(layers));
}
