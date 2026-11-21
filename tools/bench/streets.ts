// What the streets' lines cost on the processor and in memory (planning/workstreams/streets.md), read from a built map:
//
//   bun tools/bench/streets.ts <file.snmap> [--around x,z]
//
// Says the map's streets parts (count, bytes raw and as the build's Brotli copies beside it), how long a page takes to
// read one and index it (holdStreets), how long it takes to work out one chunk's planes for the card (chunkPlanes) over
// the chunks round a place (the map's middle unless --around), and so a whole region round the camera, how long a
// wheel's look takes (Heightfield.groundClassAt with and without the streets), and the bytes held.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { holdStreets, mapHeightfield, parseMap, partsFolder, readHead, readPart, type StreetsPiece } from "../../shared/world/mapfile.ts";
import { CHUNK_SIDE, PLANE_BYTES, StreetSectors, chunkPlanes } from "../../shared/world/streets.ts";
import { STREET_CHUNKS } from "../../client/core/render/streets.ts";

const [file] = process.argv.slice(2);
if (!file) throw new Error("bun tools/bench/streets.ts <file.snmap> [--around x,z]");
const bytes = new Uint8Array(readFileSync(file));
const head = readHead(bytes, false);
const parts = head.parts.filter((p) => p.kind === "streets");
const folder = partsFolder(file);
const brotli = existsSync(folder) ? readdirSync(folder).filter((f) => f.startsWith("streets.") && f.endsWith(".br")).reduce((n, f) => n + statSync(join(folder, f)).size, 0) : 0;
console.log(`streets parts: ${parts.length}, ${(parts.reduce((n, p) => n + p.length, 0) / 1048576).toFixed(2)} MB raw, ${(brotli / 1048576).toFixed(2)} MB of Brotli copies`);

// Reading and indexing each part as a page does, a few times over for a steady time.
const held = new StreetSectors();
let t0 = performance.now();
for (let round = 0; round < 3; round++) for (const p of parts) holdStreets(held, readPart(head, p, bytes.subarray(p.at, p.at + p.length), false) as StreetsPiece);
const readMs = (performance.now() - t0) / 3;
console.log(`read and index: ${(readMs / Math.max(1, parts.length)).toFixed(2)} ms a part, ${readMs.toFixed(1)} ms for all`);

// A region's chunks round a place.
const around = process.argv.includes("--around") ? process.argv[process.argv.indexOf("--around") + 1]!.split(",").map(Number) : [(head.dims.chunksX * CHUNK_SIZE) / 2, (head.dims.chunksZ * CHUNK_SIZE) / 2];
const cx0 = Math.floor(around[0]! / CHUNK_SIZE), cz0 = Math.floor(around[1]! / CHUNK_SIZE), half = STREET_CHUNKS / 2;
const dist = new Uint8Array(CHUNK_SIDE * CHUNK_SIDE * PLANE_BYTES), kinds = new Uint8Array(dist.length);
const times: number[] = [];
let near = 0;
for (let round = 0; round < 3; round++) {
  for (let dz = -half + 1; dz < half; dz++) for (let dx = -half + 1; dx < half; dx++) {
    const cx = cx0 + dx, cz = cz0 + dz;
    if (cx < 0 || cz < 0 || cx >= head.dims.chunksX || cz >= head.dims.chunksZ) continue;
    t0 = performance.now();
    chunkPlanes(held, cx, cz, dist, kinds);
    if (round === 2) {
      times.push(performance.now() - t0);
      for (let k = 0; k < dist.length; k += PLANE_BYTES) if (dist[k] !== 0 || dist[k + 2] !== 0) near++;
    }
  }
}
times.sort((a, b) => a - b);
const sum = times.reduce((a, b) => a + b, 0);
console.log(`chunk planes round ${around.map((v) => v.toFixed(0)).join(", ")}: ${times.length} chunks, median ${times[times.length >> 1]!.toFixed(3)} ms, most ${times.at(-1)!.toFixed(3)} ms, all ${sum.toFixed(1)} ms; ${((near / (times.length * CHUNK_SIDE * CHUNK_SIDE)) * 100).toFixed(0)}% of samples near a street`);
console.log(`card: two pictures of ${STREET_CHUNKS * CHUNK_SIDE} samples a side, ${((2 * (STREET_CHUNKS * CHUNK_SIDE) ** 2 * PLANE_BYTES) / 1048576).toFixed(1)} MB`);

// A wheel's look: the ground's class at many places, with the streets held and without.
const map = parseMap(bytes, false, false);
const hf = mapHeightfield(map);
const n = 400000;
const places = Float64Array.from({ length: n * 2 }, (_, k) => (k % 2 ? around[1]! : around[0]!) + ((k * 7919) % 1000) - 500);
for (const withStreets of [false, true]) {
  const keep = hf.streets;
  if (!withStreets) hf.streets = null;
  let s = 0;
  t0 = performance.now();
  for (let k = 0; k < n; k++) s += hf.groundClassAt(places[k * 2]!, places[k * 2 + 1]!);
  console.log(`groundClassAt ${withStreets ? "with" : "without"} the streets: ${(((performance.now() - t0) * 1000) / n).toFixed(3)} us a look (${s})`);
  hf.streets = keep;
}
const sectors = head.parts.filter((p) => p.kind === "ground").length;
console.log(`held for every sector (a server's): ${parts.length} of ${sectors} sectors; a page holds those within ${SECTOR_CHUNKS * CHUNK_SIZE} m and more of its body`);
