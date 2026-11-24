import { closeSync, fstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { paperPalette } from "../../client/core/admin/ground.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Heightfield } from "../../shared/world/heightfield.ts";
import { readHead, type MapHead, type MapSpawn } from "../../shared/world/mapfile.ts";
import { paintRelief } from "../../shared/world/relief.ts";
import { MapWater } from "../../shared/world/water.ts";
import { indexedPng } from "../wiki/quantize.ts";

export function mapHeader(path: string): MapHead {
  const fd = openSync(path, "r");
  try {
    const prefix = new Uint8Array(16);
    if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) throw Error("Map header is truncated.");
    const length = new DataView(prefix.buffer).getUint32(12, true);
    if (length < prefix.length || length > fstatSync(fd).size) throw Error("Map header length is invalid.");
    const bytes = new Uint8Array(length);
    bytes.set(prefix);
    for (let at = prefix.length; at < bytes.length;) {
      const read = readSync(fd, bytes, at, bytes.length - at, at);
      if (!read) throw Error("Map header is truncated.");
      at += read;
    }
    return readHead(bytes);
  } finally {
    closeSync(fd);
  }
}

export interface Relief {
  width: number;
  height: number;
  pixels: Uint32Array<ArrayBuffer>;
}

const paper = paperPalette(defaultPalette());

/** Both axes span the whole map, matching the spawn chart's percentage coordinates. */
export function overviewRelief(head: MapHead, side: number): Relief {
  const { dims, minY, stepY, coarse, water } = head;
  const hf = new Heightfield(dims, CHUNK_SIZE, minY, stepY, coarse.heights, coarse.tint);
  hf.seaLevel = head.seaLevel;
  if (water && coarse.bodies) {
    const { chunksX, chunksZ } = dims;
    const bodies = coarse.bodies;
    const cells = Uint16Array.from({ length: chunksX * chunksZ }, (_, i) => bodies[(Math.floor(i / chunksX) + 1) * (chunksX + 1) + i % chunksX + 1]!);
    hf.water = MapWater.fromGrid(dims, minY, stepY, CHUNK_SIZE, water.bodies, cells);
  }
  const relief = { width: side, height: side, pixels: new Uint32Array(side * side) };
  paintRelief(hf, paper, 0, 0, 0, side, relief.pixels);
  if (hf.sizeX === hf.sizeZ) return relief;
  const span = Math.max(hf.sizeX, hf.sizeZ);
  const width = side * hf.sizeX / span, height = side * hf.sizeZ / span;
  return cutRelief(relief, side, side, (side - width) / 2, (side - height) / 2, width, height);
}

export function cutRelief(source: Relief, width: number, height: number, x = 0, y = 0, spanX = source.width, spanY = source.height): Relief {
  const pixels = new Uint32Array(width * height);
  for (let row = 0; row < height; row++) {
    const offset = Math.floor(y + (row + .5) * spanY / height) * source.width;
    for (let col = 0; col < width; col++) pixels[row * width + col] = source.pixels[offset + Math.floor(x + (col + .5) * spanX / width)]!;
  }
  return { width, height, pixels };
}

export function spawnRelief(source: Relief, map: MapHead, point: MapSpawn): Relief {
  const px = (1 - point.x / (map.dims.chunksX * CHUNK_SIZE)) * source.width;
  const py = (1 - point.z / (map.dims.chunksZ * CHUNK_SIZE)) * source.height;
  const spanX = source.width * .24, spanY = spanX * 9 / 16;
  const x = Math.max(0, Math.min(source.width - spanX, px - spanX / 2));
  const y = Math.max(0, Math.min(source.height - spanY, py - spanY / 2));
  const tile = cutRelief(source, 240, 135, x, y, spanX, spanY);
  const cx = Math.round((px - x) * tile.width / spanX), cy = Math.round((py - y) * tile.height / spanY);
  for (let row = Math.max(0, cy - 6); row <= Math.min(tile.height - 1, cy + 6); row++) {
    for (let col = Math.max(0, cx - 6); col <= Math.min(tile.width - 1, cx + 6); col++) {
      const d = (row - cy) ** 2 + (col - cx) ** 2;
      if (d <= 36) tile.pixels[row * tile.width + col] = d <= 16 ? 0xff3549ae : 0xffffffff;
    }
  }
  return tile;
}

export function writeRelief(path: string, { width, height, pixels }: Relief): void {
  writeFileSync(path, indexedPng(width, height, new Uint8Array(pixels.buffer)));
}
