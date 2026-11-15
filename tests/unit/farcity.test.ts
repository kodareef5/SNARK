// A map's own buildings past the near rows (shared/world/city.ts, client/core/render/farcity.ts), held to the near
// drawing by the software rasterizer.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { fadeKeeps } from "../../client/core/render/far.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { CityStatics, cellPart, cityTops, goneByCells, goneByRows, mergedPart } from "../../shared/world/city.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { Summary, bakeChunk, pieceShapes } from "../../shared/world/tactical.ts";
import { BEAM, FLOOR, PIER, WALL, asWritten, building, cityWorld } from "../fixtures/cityworld.ts";
import { farRegistry } from "../fixtures/farworld.ts";

const sum = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0);
const cityDraws = (p: FramePacket): number[] => [...p.drawBuffer.subarray(0, p.drawCount).keys()].filter((d) => p.drawBuffer[d] === CITY_BUFFER);
const none = (): null => null;

/** The middle of chunk (cx, cz). */
const mid = (cx: number, cz: number): [number, number] => [cx * CHUNK_SIZE + 32, cz * CHUNK_SIZE + 32];

test("two touching plates and a pier on them show only the faces nothing holds, the ground hiding their feet", () => {
  const reg = farRegistry();
  const dims = { chunksX: 4, chunksZ: 4 };
  const [x, z] = mid(1, 1);
  const statics: MapStatic[] = [
    { kind: FLOOR, x, y: 0.2, z, yaw: 0 },
    { kind: FLOOR, x: x + 8, y: 0.2, z, yaw: 0 },
    { kind: PIER, x: x + 2, y: 2.4, z: z + 4 - 0.35, yaw: 0 },
  ];
  const w = cityWorld({ chunks: 4, statics });
  const city = new CityStatics(dims, asWritten(statics), reg);
  const chunk = w.chunkOf(x, z);
  // Plates: top and four sides each, less the two sides they share and their undersides on the ground. Pier: its four
  // sides and top, its foot held by the plate it stands on.
  expect(mergedPart(city, chunk, w.hf, none, -1, 0).faces).toBe(2 * 5 - 2 + 5);
  // Merged, the plates are one: its top and four sides, and the pier's five.
  expect(mergedPart(city, chunk, w.hf, none, 0.01, 0).faces).toBe(5 + 5);
});

test("a chunk's statics are drawn far until the near store holds it whole, then near, never both or neither, and alike either way", () => {
  // A street of towers 250 m off, in the chunk ahead and the ones beside it.
  const statics: MapStatic[] = [];
  for (let k = 0; k < 3; k++) statics.push(...building(...mid(4 + k, 8), 0, 6, 2, (k * 4100) % 16384));
  const w = cityWorld({ chunks: 16, statics, width: 960, height: 540 });
  const chunks = [...new Set(statics.map((s) => w.chunkOf(s.x, s.z)))];
  w.look(5 * CHUNK_SIZE + 32, 12, 8 * CHUNK_SIZE + 32, 250, Math.PI, 30);
  const far = w.frame();
  const drawnFar = w.covered().far;
  const colours = w.raster.color.slice();
  expect(cityDraws(far).length).toBeGreaterThan(0);
  expect(sum(drawnFar)).toBeGreaterThan(2500);
  // Held whole one at a time: each frame every pixel of the street is drawn, by one store or the other.
  for (let n = 1; n <= chunks.length; n++) {
    w.rows(chunks[n - 1]!);
    const p = w.frame();
    const { far: f, near } = w.covered();
    expect(sum(f.map((v, i) => v & near[i]!))).toBe(0);
    expect(sum(f) + sum(near)).toBeGreaterThan(sum(drawnFar) * 0.995);
    expect(cityDraws(p).length > 0).toBe(n < chunks.length);
  }
  // Every box near and every box far are the same picture, give or take a pixel along an edge here and there.
  const near = w.raster.color;
  let differ = 0;
  for (let i = 0; i < near.length; i += 4) if (Math.abs(near[i]! - colours[i]!) + Math.abs(near[i + 1]! - colours[i + 1]!) + Math.abs(near[i + 2]! - colours[i + 2]!) > 6) differ++;
  expect(differ / sum(drawnFar)).toBeLessThan(0.01);
});

test("the lattice leaves out steps and rubble and changes 1% of a street's pixels or fewer; the mass is the buildings' solid shape", () => {
  const statics: MapStatic[] = [];
  for (let k = 0; k < 3; k++) statics.push(...building(...mid(4 + k, 8), 0, 8, 2, k * 3000));
  const w = cityWorld({ chunks: 16, statics, width: 480, height: 270 });
  w.look(5 * CHUNK_SIZE + 32, 14, 8 * CHUNK_SIZE + 32, 700, Math.PI * 0.9, 40);
  const shot = (levels: string): Uint8Array => {
    const l = levels === "box" ? { to: Infinity, gap: 0.01, least: 0, cell: 0, tall: 0 } : levels === "lattice" ? { to: Infinity, gap: 0.5, least: 2.1, cell: 0, tall: 0 } : { to: Infinity, gap: -1, least: 0, cell: 8, tall: 4 };
    w.scene.assets.tier = { ...tierOf("medium"), city: { levels: [l] } };
    w.frame();
    w.frame();
    return w.covered().far;
  };
  const box = shot("box");
  const lattice = shot("lattice");
  const mass = shot("mass");
  expect(sum(box.map((v, i) => v ^ lattice[i]!)) / sum(box)).toBeLessThan(0.01);
  // The mass fills the frames: it covers what the boxes do, and more, and stands no taller than a cell above them.
  expect(sum(box.map((v, i) => v & mass[i]!)) / sum(box)).toBeGreaterThan(0.97);
  expect(sum(mass)).toBeGreaterThan(sum(box));
  const top = (m: Uint8Array): number => Math.floor(m.indexOf(1) / w.W);
  expect(Math.abs(top(mass) - top(box))).toBeLessThanOrEqual(2);
});

test("the cell rule of what the far feed shows gone is the far feed's own: a city as it stands shows nothing gone, and its tops are the feed's", () => {
  const reg = farRegistry();
  const rng = new Rng(7);
  const dims = { chunksX: 4, chunksZ: 4 };
  const kinds = [FLOOR, PIER, BEAM, WALL, "core:zruin_container_rust", "core:zruin_floor16_concrete"];
  const statics: MapStatic[] = Array.from({ length: 400 }, () => ({ kind: kinds[Math.floor(rng.float() * kinds.length)]!, x: 64 + rng.float() * 128, y: 1 + rng.float() * 30, z: 64 + rng.float() * 128, yaw: Math.floor(rng.float() * 65536) }));
  const w = cityWorld({ chunks: 4, statics, ground: (x, z) => 3 * Math.sin(x / 20) + 2 * Math.cos(z / 13) });
  const city = new CityStatics(dims, asWritten(statics), reg);
  const shapes = pieceShapes(reg);
  for (let chunk = 0; chunk < 16; chunk++) {
    if (city.in(chunk) === 0) continue;
    const s = new Summary();
    bakeChunk(w.server.chunks[chunk] ?? null, chunkCx(dims, chunk) * CHUNK_SIZE, chunkCz(dims, chunk) * CHUNK_SIZE, shapes, w.hf, s);
    expect(cityTops(city, chunk, w.hf, null)).toEqual(s.far.top);
    const gone = new Uint8Array(city.in(chunk));
    expect(goneByCells(city, chunk, w.hf, s.far.top, gone)).toBe(0);
  }
});

test("pieces gone are left out of every level: as last seen near, and where the far feed's tops fall short of them", () => {
  const [x, z] = mid(6, 6);
  const statics = building(x, z, 0, 10, 2, 5000);
  const w = cityWorld({ chunks: 16, statics, width: 320, height: 180 });
  const chunk = w.chunkOf(x, z);
  const table = w.server.chunks[chunk]!;
  // The top three storeys blown off, and a wall low down.
  const doomed: number[] = [];
  for (let s = 0; s < table.high; s++) if (table.y[s]! > 28 || (w.reg.defs[table.kind[s]!]!.id === WALL && table.y[s]! < 4)) doomed.push(s);
  const tops = doomed.filter((s) => table.y[s]! > 28).length;
  w.look(x, 20, z, 600, 0.4, 2);
  w.frame();
  const before = w.covered().far;
  for (const s of doomed) w.server.remove(chunk * 65536 + s);
  // Seen from afar: the feed's tops show the top storeys gone, not the wall under them.
  w.send(chunk);
  w.frame();
  const gone = w.scene.city!.goneOf(chunk)!;
  expect(sum(gone)).toBe(tops);
  const after = w.covered().far;
  expect(sum(after)).toBeLessThan(sum(before) * 0.85);
  // Seen near and let go: exactly what went.
  w.rows(chunk);
  w.frame();
  w.drop(chunk);
  w.frame();
  expect(sum(w.scene.city!.goneOf(chunk)!)).toBe(doomed.length);
  // A row matched exactly is what the near store holds.
  const g = new Uint8Array(w.statics.in(chunk));
  w.rows(chunk);
  expect(goneByRows(w.statics, chunk, w.structs.chunks[chunk]!, g)).toBe(doomed.length);
});

test("far blocks draw only what players built above the city: none for a chunk of statics, a block above a roof", () => {
  const [x, z] = mid(6, 6);
  const statics = building(x, z, 0, 3);
  const w = cityWorld({ chunks: 16, statics });
  const chunk = w.chunkOf(x, z);
  w.send(chunk);
  w.look(x, 6, z, 500, 0.3, 40);
  const p = w.frame();
  const blocks = p.drawFade.subarray(0, p.drawCount).filter((f, d) => f > 0 && p.drawBuffer[d] !== CITY_BUFFER).length;
  expect(blocks).toBe(0);
  // A player's wall on the roof: the feed's top over that cell rises past the city's.
  w.server.add(w.reg.index.get(WALL)!, x, 12 + 1.4, z, 0, 1, 1000);
  w.send(chunk);
  const q = w.frame();
  expect(q.drawFade.subarray(0, q.drawCount).filter((f, d) => f > 0 && q.drawBuffer[d] !== CITY_BUFFER).length).toBeGreaterThan(0);
});

test("the lattice fades out over the end of its reach exactly where the mass fades in", () => {
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let d = 800; d <= 1000; d += 0.5) expect(fadeKeeps(d, 900, 0.1, x, y)).toBe(!fadeKeeps(d, -900, 0.1, x, y));
    }
  }
  const statics: MapStatic[] = [];
  for (let k = 0; k < 6; k++) statics.push(...building(...mid(10 + k * 3, 30), 0, 6, 2, k * 2000));
  const w = cityWorld({ chunks: 48, statics, width: 480, height: 270 });
  w.look(16 * CHUNK_SIZE, 10, 30 * CHUNK_SIZE + 32, 880, Math.PI / 2, 30);
  const p = w.frame();
  // Tiles across the fade are drawn twice, the lattice fading out and the mass fading in.
  const fades = cityDraws(p).map((d) => p.drawFade[d]!);
  expect(fades.some((f) => f === 900)).toBe(true);
  expect(fades.some((f) => f === -900)).toBe(true);
});

test("tiles with nothing on the card are made first, a chunk at a time within the frame's budget", () => {
  const statics: MapStatic[] = [];
  for (let cx = 2; cx < 14; cx += 2) for (let cz = 2; cz < 14; cz += 2) statics.push(...building(...mid(cx, cz), 0, 4));
  const w = cityWorld({ chunks: 16, statics });
  w.look(8 * CHUNK_SIZE, 10, 8 * CHUNK_SIZE, 300, 0.2, 30);
  const city = w.scene.city!;
  city.makeMs = 0;
  w.frame();
  // One chunk's piece a frame: tiles come in one by one, and none is drawn before its every chunk is made.
  expect(city.stats.made).toBeLessThanOrEqual(1);
  let frames = 1;
  while (city.stats.behind > 0 || city.stats.missing > 0) {
    w.frame();
    if (++frames > 400) break;
  }
  expect(frames).toBeLessThan(400);
  expect(city.stats.unseen).toBe(0);
});

test("a far form is a pure function of the chunk: the same statics give the same faces, cells included", () => {
  const reg = farRegistry();
  const statics = building(...mid(1, 1), 0, 6, 2, 7000);
  const dims = { chunksX: 4, chunksZ: 4 };
  const w = cityWorld({ chunks: 4, statics });
  const [a, b] = [new CityStatics(dims, asWritten(statics), reg), new CityStatics(dims, asWritten([...statics]), reg)];
  const chunk = w.chunkOf(statics[0]!.x, statics[0]!.z);
  expect(cellPart(a, chunk, w.hf, null, 4, 4).pos).toEqual(cellPart(b, chunk, w.hf, null, 4, 4).pos);
  expect(mergedPart(a, chunk, w.hf, none, 0.5, 2.1).pos).toEqual(mergedPart(b, chunk, w.hf, none, 0.5, 2.1).pos);
});

