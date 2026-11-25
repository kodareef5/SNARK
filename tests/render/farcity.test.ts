// A map's own buildings past the near rows (shared/world/city.ts, client/core/render/farcity.ts), held to the near
// drawing by the software rasterizer.

import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { slopeKind } from "../../content/slopes.ts";
import { TIERS, tierOf } from "../../client/core/assets/tiers.ts";
import { ladder } from "../../client/core/governor.ts";
import { FAR_BUFFER, fadeKeeps } from "../../client/core/render/far.ts";
import { ThreadedCityMaker, cityJob, cityKinds, cityThreads, makeLevel, type CityJob, type CityKinds, type CityMade, type CityMaker, type CityThread } from "../../client/core/render/citymake.ts";
import { CITY_BUFFER } from "../../client/core/render/farcity.ts";
import { zoomed } from "../../client/core/optics.ts";
import { doSweep, type SweepJob, type SweepMade } from "../../client/core/render/farshadow.ts";
import { FRAME, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { PICK_STRUCTURE } from "../../tools/snap/raster.ts";
import type { ShapeBox, ShapeDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { slopeShape, staticOf } from "../../shared/content/slopes.ts";
import { CHUNK_SIZE, YAW_UNITS, chunkAt, chunkCx, chunkCz } from "../../shared/coords.ts";
import { TAU, detCos, detSin } from "../../shared/math/scalar.ts";
import { VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import { CityStatics, cellPart, cityReach, cityTops, goneByCells, goneByRows, landmarkKinds, mergedPart, type CityPart } from "../../shared/world/city.ts";
import { hullOf, hullPoint, type HullDef } from "../../shared/world/convex.ts";
import { HeightWindow } from "../../shared/world/heightfield.ts";
import { MapStatics, mapHeightfield, parseMap, placeStatics, writeMap, type MapStatic } from "../../shared/world/mapfile.ts";
import { Found, StructureStore } from "../../shared/world/structures.ts";
import { Summary, bakeChunk, pieceShapes } from "../../shared/world/tactical.ts";
import { BEAM, FLOOR, PIER, SLOPE_SLAB30, STEP, WALL, asWritten, building, cityWorld, slopes } from "../fixtures/cityworld.ts";
import { farPack, farRegistry } from "../fixtures/farworld.ts";
import { flatMap } from "../fixtures/map.ts";

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

test("near pieces are drawn alike on every tier at one camera, whatever frames came before: no near draw takes a far draw's fade", () => {
  // A bus wreck 10 m off as Miami's ruins lay one (hull, windows each side, wheel blocks under), a frame building beside
  // it, all held near; and a street of towers drawn far from 250 m to 2.6 km, across every tier's fade into the mass.
  const [bx, bz] = [300, 2048];
  const bus: MapStatic[] = [{ kind: "core:zruin_zbus_clay", x: bx, y: 1, z: bz, yaw: 0 }];
  for (const u of [-3, 0, 3]) for (const v of [-1.3, 1.3]) bus.push({ kind: "core:zruin_zsign_blue", x: bx + v, y: 1.5, z: bz + u, yaw: 16384 });
  for (const u of [-3, 3]) bus.push({ kind: "core:zruin_zcover_steel", x: bx, y: 0.05, z: bz + u, yaw: 16384 });
  const near = [...bus, ...building(bx + 14, bz + 16, 0, 2)];
  const statics = [...near];
  for (let d = 250, k = 0; d <= 2600; d += CHUNK_SIZE, k++) statics.push(...building(bx + d, bz + (k % 2 === 0 ? 40 : -40), 0, 4 + ((k * 7) % 9), 2, (k * 3100) % 16384));
  const w = cityWorld({ chunks: 64, statics, width: 480, height: 270 });
  // Pieces are counted by the pixels each is picked in, which a chunk's mesh does not tell apart (nearcity.ts).
  w.scene.nearMesh = false;
  for (const s of near) w.rows(w.chunkOf(s.x, s.z));
  w.look(bx, 1.2, bz, 10, Math.PI / 2, 4.1);
  // Each near piece's pixels in the last frame, by its pick id.
  const seen = (): Map<number, number> => {
    const out = new Map<number, number>();
    w.raster.pickKind.forEach((k, at) => k === PICK_STRUCTURE && out.set(w.raster.pickId[at]!, (out.get(w.raster.pickId[at]!) ?? 0) + 1));
    return out;
  };
  const nearFades = (p: FramePacket): number[] => [...p.drawBuffer.subarray(0, p.drawCount).keys()].filter((d) => p.drawBuffer[d]! < NODE_BUFFERS && p.drawFade[d] !== 0).map((d) => p.drawFade[d]!);
  const shots: { name: string; pieces: Map<number, number>; fades: number[] }[] = [];
  for (const tier of TIERS) {
    w.scene.assets.tier = tier;
    // As the picture tools settle a view (tools/snap.ts settle): frames they do not keep are cut to no draws, then drawn.
    for (let k = 0; k < 3; k++) {
      w.scene.now += 1000 / 60;
      const p = w.scene.build(w.cam, null);
      p.drawCount = p.tileCount = 0;
      w.raster.render(p);
    }
    const p = w.frame();
    expect(cityDraws(p).length).toBeGreaterThan(0);
    expect(p.drawFade.subarray(0, p.drawCount).some((f) => f < 0)).toBe(true);
    shots.push({ name: `${tier.name}, settled`, pieces: seen(), fades: nearFades(p) });
    // As the client draws: every frame whole.
    w.frame();
    shots.push({ name: `${tier.name}, every frame drawn`, pieces: seen(), fades: nearFades(w.frame()) });
  }
  const drawn = shots[1]!.pieces;
  const kindOf = (id: number): string => w.reg.defs[w.structs.chunks[Math.floor(id / 65536)]!.kind[id % 65536]!]!.id;
  // The hull, the windows and wheel blocks on the near side, and the building's pieces are in view.
  const kinds = [...drawn.keys()].map(kindOf);
  expect(kinds.filter((k) => k === "core:zruin_zsign_blue").length).toBeGreaterThanOrEqual(3);
  expect(kinds).toContain("core:zruin_zcover_steel");
  expect(kinds).toContain(WALL);
  expect(drawn.get([...drawn.keys()].find((id) => kindOf(id) === "core:zruin_zbus_clay") ?? -1) ?? 0).toBeGreaterThan(2000);
  // The same pieces on every tier and either way, each to a pixel in fifty where a window meets the hull: low poly's one
  // depth range parts them a little otherwise than the lit tiers' two.
  for (const s of shots) {
    expect({ shot: s.name, fades: s.fades }).toEqual({ shot: s.name, fades: [] });
    const off = [...drawn].filter(([id, n]) => Math.abs((s.pieces.get(id) ?? 0) - n) > n * 0.02).map(([id]) => kindOf(id));
    expect({ shot: s.name, pieces: s.pieces.size, off }).toEqual({ shot: s.name, pieces: drawn.size, off: [] });
  }
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
  // Sloped pieces among them: the feed, and so this, sees each by the box that holds it.
  const kinds = [FLOOR, PIER, BEAM, WALL, "core:zruin_container_rust", "core:zruin_floor16_concrete", ...SLOPED.map(slopeKind)];
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
  const blocks = (q: FramePacket): number => q.drawBuffer.subarray(0, q.drawCount).filter((b) => b === FAR_BUFFER).length;
  expect(blocks(p)).toBe(0);
  // A player's wall on the roof: the feed's top over that cell rises past the city's.
  w.server.add(w.reg.index.get(WALL)!, x, 12 + 1.4, z, 0, 1, 1000);
  w.send(chunk);
  const q = w.frame();
  expect(blocks(q)).toBeGreaterThan(0);
});

test("statics that come after the first frame start the far city then, and the far blocks made before leave its cells to it", () => {
  const [x, z] = mid(6, 6);
  const w = cityWorld({ chunks: 16, statics: building(x, z, 0, 3), late: true });
  const blocks = (p: FramePacket): number => p.drawBuffer.subarray(0, p.drawCount).filter((b) => b === FAR_BUFFER).length;
  w.send(w.chunkOf(x, z));
  w.look(x, 6, z, 500, 0.3, 40);
  const before = w.frame();
  expect([w.scene.city, cityDraws(before).length, blocks(before) > 0]).toEqual([null, 0, true]);
  w.arrive();
  const started = w.frame();
  expect([w.scene.city !== null, blocks(started)]).toEqual([true, 0]);
  w.scene.city!.makeMs = Infinity;
  expect(cityDraws(w.frame()).length).toBeGreaterThan(0);
});

test("statics handed over round the body and then whole: the far city of the whole draws the tiles that are the same from its first frame, and makes again only those that differ", () => {
  const near: MapStatic[] = [];
  const far: MapStatic[] = [];
  for (let cx = 1; cx < 6; cx += 2) for (let cz = 1; cz < 6; cz += 2) near.push(...building(...mid(cx, cz), 0, 4));
  for (let cx = 9; cx < 15; cx += 2) for (let cz = 9; cz < 15; cz += 2) far.push(...building(...mid(cx, cz), 0, 4));
  // A building the whole has in a tile of those round the body, which that tile is made again for.
  const edge = building(...mid(7, 1), 0, 2);
  const w = cityWorld({ chunks: 16, statics: [...near, ...far, ...edge], late: true });
  w.look(...mid(3, 3), 10, 900, 2.4, 60);
  w.frame();
  w.arrive(new CityStatics(w.dims, asWritten(near), w.reg));
  w.frame();
  const first = w.scene.city!;
  first.makeMs = Infinity;
  for (let k = 0; k < 20 && (first.stats.behind > 0 || first.stats.missing > 0); k++) w.frame();
  const shown = cityDraws(w.frame()).length;
  expect(shown).toBeGreaterThan(0);
  w.arrive();
  const p = w.frame();
  const then = w.scene.city!;
  expect(then).not.toBe(first);
  // Its first frame draws what was shown but for the tile that differs, and lets go of that tile's levels alone.
  expect(cityDraws(p).length).toBeGreaterThan(0);
  expect(p.assetDrops.length).toBeGreaterThan(0);
  expect(p.assetDrops.length).toBeLessThan(shown);
  then.makeMs = Infinity;
  for (let k = 0; k < 20 && (then.stats.behind > 0 || then.stats.missing > 0); k++) w.frame();
  expect(cityDraws(w.frame()).length).toBeGreaterThanOrEqual(shown);
});

test("a city made a step at a time is the one made at once, the reach of its chunks made with it, and its far city draws the same picture", () => {
  const statics = [...building(...mid(3, 3), 0, 4), ...building(...mid(9, 9), 0, 3), ...building(...mid(12, 4), 0, 2)];
  const drawn = (stepped: boolean) => {
    const w = cityWorld({ chunks: 16, statics, late: true });
    let city: CityStatics | null = null;
    if (!stepped) city = new CityStatics(w.dims, asWritten(statics), w.reg);
    else for (let s = CityStatics.steps(w.dims, MapStatics.of(w.dims, asWritten(statics)), w.reg), r = s.next(); !(r.done && (city = r.value)); r = s.next());
    w.look(...mid(3, 3), 10, 900, 2.4, 60);
    w.frame();
    w.arrive(city!);
    w.frame();
    w.scene.city!.makeMs = Infinity;
    for (let k = 0; k < 20 && (w.scene.city!.stats.behind > 0 || w.scene.city!.stats.missing > 0); k++) w.frame();
    const p = w.frame();
    const kinds = landmarkKinds(w.reg);
    return { city: city!, draws: cityDraws(p).length, far: [...w.covered().far], reach: cityReach(city!, kinds), kept: cityReach(city!, kinds) === cityReach(city!, kinds) };
  };
  const once = drawn(false), stepped = drawn(true);
  expect([stepped.city.first, stepped.city.kind, stepped.city.yaw, stepped.city.x, stepped.city.y, stepped.city.z]).toEqual([once.city.first, once.city.kind, once.city.yaw, once.city.x, once.city.y, once.city.z]);
  expect([stepped.city.color, stepped.city.plain, stepped.city.walked, stepped.city.look]).toEqual([once.city.color, once.city.plain, once.city.walked, once.city.look]);
  // The reach steps made is kept and given each time it is asked for; the one made at once is worked out alike when asked.
  expect([stepped.kept, once.kept]).toEqual([true, false]);
  expect([stepped.reach.reach, [...stepped.reach.landmarks]]).toEqual([once.reach.reach, [...once.reach.landmarks]]);
  expect(stepped.draws).toBeGreaterThan(0);
  expect([stepped.draws, sum(Uint8Array.from(stepped.far))]).toEqual([once.draws, sum(Uint8Array.from(once.far))]);
  expect(stepped.far).toEqual(once.far);
});

test("the bare level fades out over the end of its reach exactly where the mass fades in", () => {
  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let d = 800; d <= 1000; d += 0.5) expect(fadeKeeps(d, 900, 0.1, x, y)).toBe(!fadeKeeps(d, -900, 0.1, x, y));
    }
  }
  const statics: MapStatic[] = [];
  for (let k = 0; k < 6; k++) statics.push(...building(...mid(10 + k * 3, 30), 0, 6, 2, k * 2000));
  const w = cityWorld({ chunks: 48, statics, width: 480, height: 270 });
  w.look(16 * CHUNK_SIZE, 10, 30 * CHUNK_SIZE + 32, 1430, Math.PI / 2, 30);
  const p = w.frame();
  // The tower 1,462 m off, in the fade at the end of medium's bare level, is drawn twice: the bare level fading out and
  // the mass fading in.
  const fades = cityDraws(p).map((d) => p.drawFade[d]!);
  expect(fades.some((f) => f === 1500)).toBe(true);
  expect(fades.some((f) => f === -1500)).toBe(true);
});

test("across a fade between levels a chunk wholly past the one's end draws none of it and one wholly short of the fade none of the other, for the picture both drawn whole give", () => {
  // Rows of towers in three rows of tiles, one in every chunk across the fade: the bare level into the mass on medium
  // from 1,350 to 1,500 m, and the mass in 4 m cells into that in 8 m cells on high from 2,070 to 2,300 m.
  for (const { tier, end, from, off } of [{ tier: "medium", end: 1500, from: 10, off: 1420 }, { tier: "high", end: 2300, from: 26, off: 2200 }]) {
    const statics: MapStatic[] = [];
    for (let k = 0; k < 18; k++) for (const cz of [27, 31, 35]) statics.push(...building(...mid(from + k, cz), 0, 4 + ((k * 5) % 7), 2, (k * 2300 + cz * 700) % 16384));
    const w = cityWorld({ chunks: 64, statics, width: 480, height: 270, tier: tierOf(tier) });
    w.look((from + 6) * CHUNK_SIZE, 10, 31 * CHUNK_SIZE, off, Math.PI / 2, 30);
    // Each level's indices on the card, by its slot.
    const whole = new Map<number, number>();
    let p = w.frame();
    for (let f = 0; f < 3; f++, p = w.frame()) for (const u of p.assetUploads) whole.set(u.slot, u.indexCount);
    const picture = w.raster.color.slice();
    const draws = cityDraws(p);
    const drawn = draws.reduce((n, d) => n + p.drawIndexCount[d]!, 0);
    // Each tile drawn at both levels draws each of them whole, the one fading out and the other in. A tile's draws
    // share its origin, and a level drawn in the fade at all tells which it is.
    const tiles = new Map<string, number[]>();
    for (const d of draws) {
      const at = [0, 1, 2].map((a) => p.drawOffset[d * 3 + a]).join();
      tiles.set(at, [...(tiles.get(at) ?? []), d]);
    }
    let both = 0;
    for (const list of tiles.values()) {
      const sign = new Map<number, number>();
      for (const d of list) if (p.drawFade[d] === end || p.drawFade[d] === -end) sign.set(p.drawSlot[d]!, Math.sign(p.drawFade[d]!));
      const slots = new Set(list.map((d) => p.drawSlot[d]!));
      // A tile in the fade between two other levels, nearer or farther, is left as drawn.
      if (slots.size < 2 || sign.size === 0) continue;
      expect(slots.size).toBe(2);
      both++;
      const finer = [...slots].find((s) => sign.get(s) === 1 || (!sign.has(s) && [...sign.values()][0] === -1))!;
      for (const d of list) [p.drawFirstIndex[d], p.drawIndexCount[d], p.drawFade[d]] = [0, whole.get(p.drawSlot[d]!)!, p.drawSlot[d] === finer ? end : -end];
    }
    // Drawn again as the world's frames are, without the ground.
    p.tileCount = 0;
    w.raster.render(p);
    expect({ tier, both: both >= 3 }).toEqual({ tier, both: true });
    // Every tile in a fade drawing both levels whole draws more: over a tenth more here, with fades a quarter of their reach.
    expect(cityDraws(p).reduce((n, d) => n + p.drawIndexCount[d]!, 0)).toBeGreaterThan(drawn * 1.1);
    let differ = 0;
    for (let i = 0; i < picture.length; i++) if (picture[i] !== w.raster.color[i]) differ++;
    expect({ tier, differ }).toEqual({ tier, differ: 0 });
  }
});

test("a tile wholly short of the last tenth of its reach draws with no fade, and one reaching into it fades there", () => {
  // Two towers in line, one 300 m off and one 2,412 m off, on medium (reach 2,500 m, its last level from 2,000 m).
  const statics = [...building(...mid(2, 30), 0, 6), ...building(...mid(2, 63), 0, 6)];
  const w = cityWorld({ chunks: 64, statics, width: 320, height: 180 });
  const [x, z] = mid(2, 30);
  w.look(x, 10, z, 300, 0, 2);
  const p = w.frame();
  const at = (d: number): number => Math.hypot(p.drawOffset[d * 3]! + 160, p.drawOffset[d * 3 + 2]! + 160);
  const fades = cityDraws(p).map((d) => [at(d) < 1000, p.drawFade[d]!] as const);
  expect(fades.filter(([near]) => near).map(([, f]) => f)).toEqual([0]);
  expect(fades.filter(([near]) => !near).map(([, f]) => f)).toEqual([Math.fround(w.scene.alongGround(2500))]);
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

test("levels are held by their form: other levels in the same forms remake nothing, and the governor's nearer distances make only the forms tiles come to", () => {
  // Towers in three rows of tiles from 150 m to 1,900 m off, on medium.
  const statics: MapStatic[] = [];
  for (let k = 0; k < 28; k++) for (const cz of [27, 30, 32, 35]) statics.push(...building(...mid(4 + k, cz), 0, 4 + (k % 5), 2, k * 1700));
  const w = cityWorld({ chunks: 48, statics, width: 320, height: 180 });
  w.look(16 * CHUNK_SIZE, 10, 31 * CHUNK_SIZE, 950, Math.PI / 2, 40);
  const city = w.scene.city!;
  /** Frames until nothing is left to make: the levels put on the card and let go meanwhile, and the most tiles in view with none. */
  const settle = (): { made: number; dropped: number; unseen: number } => {
    const out = { made: 0, dropped: 0, unseen: 0 };
    for (let f = 0; f < 600; f++) {
      const p = w.frame();
      out.made += p.assetUploads.length;
      out.dropped += p.assetDrops.length;
      out.unseen = Math.max(out.unseen, city.stats.unseen);
      if (f > 2 && city.stats.behind === 0 && p.assetUploads.length === 0) return out;
    }
    throw new Error("still making");
  };
  const medium = tierOf("medium");
  const first = settle();
  expect(first.made).toBeGreaterThan(8);
  // The same levels in a list of their own: nothing made again or let go.
  w.scene.assets.tier = { ...medium, city: { levels: medium.city.levels.map((l) => ({ ...l })) } };
  expect(settle()).toEqual({ made: 0, dropped: 0, unseen: 0 });
  // The governor's step: a tile whose nearest point the nearer distances move to another level makes that level, and
  // lets go of the one it leaves once it is there; the rest keep theirs. A level at a time, no tile goes undrawn.
  const step = ladder(medium, 3).find((l) => l.city)!.tier;
  w.scene.assets.tier = step;
  city.makeMs = 0;
  const nearer = settle();
  expect(nearer.made).toBeGreaterThan(0);
  expect(nearer.made).toBeLessThan(first.made * 0.6);
  expect(nearer.unseen).toBe(0);
  // Back to the tier: only those tiles again.
  w.scene.assets.tier = medium;
  const back = settle();
  expect(back.made).toBeLessThanOrEqual(nearer.dropped);
  expect(back.unseen).toBe(0);
});

test("through a sight the tiles in its window are made at the levels their distance over the zoom asks, kept a while once it is lowered, and the rest untouched", () => {
  // A row of towers 1,500 m ahead, and another to the side, out of the window; on medium.
  const statics: MapStatic[] = [];
  for (let k = 0; k < 6; k++) statics.push(...building(...mid(20 + k, 40), 0, 6, 2, k * 1700), ...building(...mid(40, 14 + k), 0, 6, 2, k * 1900));
  const w = cityWorld({ chunks: 64, statics, width: 320, height: 180 });
  w.scene.assets.tier = tierOf("medium");
  w.look(22.5 * CHUNK_SIZE, 20, 40.5 * CHUNK_SIZE, 1500, 0, 6);
  const city = w.scene.city!;
  const cityIndices = (p: FramePacket): number => cityDraws(p).reduce((n, d) => n + p.drawIndexCount[d]!, 0);
  const settle = (): { made: number; dropped: number; unseen: number; indices: number } => {
    const out = { made: 0, dropped: 0, unseen: 0, indices: 0 };
    for (let f = 0; f < 600; f++) {
      const p = w.frame();
      out.made += p.assetUploads.length;
      out.dropped += p.assetDrops.length;
      out.unseen = Math.max(out.unseen, city.stats.unseen);
      out.indices = cityIndices(p);
      if (f > 2 && city.stats.behind === 0 && p.assetUploads.length === 0) return out;
    }
    throw new Error("still making");
  };
  const base = w.cam.fovY;
  const plain = settle();
  expect(plain.indices).toBeGreaterThan(0);
  // The same narrow view as if nothing magnified it, for the levels the distances alone ask in it.
  w.cam.fovY = zoomed(base, 8);
  w.cam.window.set([-0.25, -1, 0.25, 1]);
  const narrow = cityIndices(w.frame());
  expect(narrow).toBeGreaterThan(0);
  // Eight times, the window a quarter of the view's width: the row ahead comes to finer levels, and nothing goes undrawn.
  w.cam.zoom = 8;
  const scoped = settle();
  expect(scoped.made).toBeGreaterThan(0);
  expect(scoped.unseen).toBe(0);
  expect(scoped.indices).toBeGreaterThan(narrow);
  // The levels its own distance asks are kept beside them: lowered, nothing is made and the view is whole at once.
  w.cam.fovY = base;
  w.cam.zoom = 1;
  w.cam.window.set([-1, -1, 1, 1]);
  const lowered = { made: 0, dropped: 0 };
  for (let f = 0; f < 60; f++) {
    const p = w.frame();
    lowered.made += p.assetUploads.length;
    lowered.dropped += p.assetDrops.length;
    expect(city.stats.unseen).toBe(0);
  }
  expect(lowered).toEqual({ made: 0, dropped: 0 });
  expect(cityIndices(w.frame())).toBe(plain.indices);
  // Raised again within the while: nothing to make.
  w.cam.fovY = zoomed(base, 8);
  w.cam.zoom = 8;
  w.cam.window.set([-0.25, -1, 0.25, 1]);
  for (let f = 0; f < 30; f++) expect(w.frame().assetUploads.length).toBe(0);
  // Lowered for longer than the while, the finer levels are let go and nothing is made again.
  w.cam.fovY = base;
  w.cam.zoom = 1;
  w.cam.window.set([-1, -1, 1, 1]);
  const after = { made: 0, dropped: 0 };
  for (let f = 0; f < 240; f++) {
    const p = w.frame();
    after.made += p.assetUploads.length;
    after.dropped += p.assetDrops.length;
  }
  expect(after).toEqual({ made: 0, dropped: scoped.made });
  expect(cityIndices(w.frame())).toBe(plain.indices);
});

test("through a sight a chunk held whole far off in its window has its near mesh made before one near the body; without, the near one first", () => {
  const made = (zoom: number): number[] => {
    // A tower 400 m off to the side and one 1,500 m ahead, both held whole as the server sends them.
    // Big enough that each takes frames of the near city's making.
    const statics = [...building(...mid(26, 23), 0, 30, 6, 0), ...building(...mid(20, 43), 0, 30, 6, 0)];
    const w = cityWorld({ chunks: 64, statics, width: 320, height: 180 });
    w.scene.assets.tier = tierOf("medium");
    const near = w.chunkOf(...mid(26, 23)), far = w.chunkOf(...mid(20, 43));
    w.rows(near);
    w.rows(far);
    w.look(20.5 * CHUNK_SIZE, 10, 43.5 * CHUNK_SIZE, 1500 - 64, 0, 6);
    w.cam.fovY = zoomed(w.cam.fovY, zoom);
    w.cam.zoom = zoom;
    if (zoom > 1) w.cam.window.set([-0.3, -0.3, 0.3, 0.3]);
    const order: number[] = [];
    for (let f = 0; f < 400 && order.length < 2; f++) {
      w.frame();
      for (const c of [near, far]) if (!order.includes(c) && w.scene.near!.chunk(c)?.mesh) order.push(c);
    }
    return order.map((c) => (c === near ? 0 : 1));
  };
  expect(made(16)[0]).toBe(1);
  expect(made(1)[0]).toBe(0);
});

test("through a sight a tile past the tier's reach in its window is made and drawn, and kept a while once the sight is lowered", () => {
  // A row of towers 3.4 km ahead, past medium's 2.5 km of far city.
  const statics: MapStatic[] = [];
  for (let k = 0; k < 4; k++) statics.push(...building(...mid(20 + k, 60), 0, 8, 3, k * 1700));
  const w = cityWorld({ chunks: 64, statics, width: 320, height: 180 });
  w.scene.assets.tier = tierOf("medium");
  w.look(21.5 * CHUNK_SIZE, 20, 60.5 * CHUNK_SIZE, 3400, 0, 6);
  const indices = (p: FramePacket): number => cityDraws(p).reduce((n, d) => n + p.drawIndexCount[d]!, 0);
  for (let f = 0; f < 60; f++) w.frame();
  expect(indices(w.frame())).toBe(0);
  const base = w.cam.fovY;
  w.cam.fovY = zoomed(base, 16);
  w.cam.zoom = 16;
  w.cam.window.set([-0.4, -0.4, 0.4, 0.4]);
  let drawn = 0;
  for (let f = 0; f < 600 && drawn === 0; f++) drawn = indices(w.frame());
  expect(drawn).toBeGreaterThan(0);
  // Lowered: kept a while, then let go.
  w.cam.fovY = base;
  w.cam.zoom = 1;
  w.cam.window.set([-1, -1, 1, 1]);
  for (let f = 0; f < 30; f++) w.frame();
  expect(indices(w.frame())).toBeGreaterThan(0);
  for (let f = 0; f < 240; f++) w.frame();
  expect(indices(w.frame())).toBe(0);
});

test("through a sight the near trees' hand-over band is its zoom times the tier's, and the tier's at one times", () => {
  const w = cityWorld({ chunks: 16, statics: [], width: 160, height: 90 });
  w.scene.assets.tier = tierOf("medium");
  w.look(8 * CHUNK_SIZE, 0, 8 * CHUNK_SIZE, 100, 0, 6);
  const band = tierOf("medium").nodes.band;
  let p = w.frame();
  expect([p.frame[FRAME.handFrom], p.frame[FRAME.handTo]]).toEqual([band[0], band[1]]);
  w.cam.zoom = 8;
  p = w.frame();
  expect([p.frame[FRAME.handFrom], p.frame[FRAME.handTo]]).toEqual([band[0] * 8, band[1] * 8]);
});

test("levels made on threads are each asked of the one with the fewest in hand, three ahead a thread, and are the levels the page makes", async () => {
  // A thread as a worker running client/city/city-worker.ts is, here on this one a turn later, and those each was asked of.
  const asked: number[] = [];
  let started = 0;
  class Turn implements CityThread {
    onmessage: ((m: { data: CityMade | SweepMade }) => void) | null = null;
    private kinds: CityKinds | null = null;
    private readonly n = started++;
    postMessage(m: { kinds: CityKinds | null } | { job: CityJob } | { sweep: SweepJob }): void {
      if ("kinds" in m) this.kinds = m.kinds;
      else if ("sweep" in m) {
        // The far shadow's map (farshadow.ts) is swept where levels are made.
        const made = doSweep(m.sweep);
        setTimeout(() => this.onmessage!({ data: made }));
      } else {
        asked.push(this.n);
        const made = makeLevel(this.kinds!, m.job);
        setTimeout(() => this.onmessage!({ data: made }));
      }
    }
  }
  const statics: MapStatic[] = [];
  for (let cx = 2; cx < 30; cx += 3) for (let cz = 2; cz < 30; cz += 5) statics.push(...building(...mid(cx, cz), 0, 3 + ((cx + cz) % 6), 2, cx * 900 + cz * 300));
  const shot = async (maker?: CityMaker): Promise<Uint8ClampedArray> => {
    const w = cityWorld({ chunks: 32, statics, width: 320, height: 180, ...(maker ? { maker } : {}) });
    w.look(16 * CHUNK_SIZE, 10, 16 * CHUNK_SIZE, 600, 0.7, 120);
    for (let f = 1; f < 200; f++) {
      w.frame();
      if (f > 1 && w.scene.city!.stats.behind === 0 && w.scene.city!.stats.missing === 0) return w.raster.color.slice();
      await new Promise((go) => setTimeout(go));
    }
    throw new Error("still making");
  };
  const maker = new ThreadedCityMaker(() => new Turn(), 3);
  expect([maker.flights, cityThreads(1), cityThreads(4), cityThreads(10)]).toEqual([9, 1, 2, 3]);
  expect(await shot(maker)).toEqual(await shot());
  // Three started, and each asked for a third of the levels, give or take its share of the last few.
  expect(started).toBe(3);
  const each = [0, 1, 2].map((n) => asked.filter((k) => k === n).length);
  expect(Math.max(...each) - Math.min(...each)).toBeLessThanOrEqual(3);
  expect(asked.length).toBeGreaterThan(20);
});

test("a map's statics written, read back and set down give the rows and far city faces their list did, held once", () => {
  const reg = farRegistry();
  const rng = new Rng(9);
  // Buildings in several chunks, one across a border with piers on it, and a piece the far city does not draw.
  const pieces = [...building(...mid(3, 2), 0, 3), ...building(128, 64, 0, 2, 2, 7000), ...building(...mid(0, 0), 0, 4, 1), ...building(...mid(1, 3), 0.3, 2)];
  pieces.push({ kind: "core:rock", x: 70.1, y: 0.5, z: 3.3, yaw: 100 });
  // Listed out of chunk order, so that the file's order and the chunks' differ.
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pieces[i], pieces[j]] = [pieces[j]!, pieces[i]!];
  }
  const listed = asWritten(pieces);
  const dims = { chunksX: 4, chunksZ: 4 };
  const head = (a: ArrayLike<number>, n: number): number[] => Array.from({ length: n }, (_, i) => a[i]!);
  const rowsOf = (store: StructureStore): unknown[] => {
    const found = new Found();
    const n = store.query(0, 0, 256, 256, found);
    return [...store.chunks.map((t) => t && [t.high, t.version, t.live, ...[t.kind, t.x, t.y, t.z, t.yaw, t.owner, t.hp, t.mod].map((a) => head(a, t.high))]), head(found.refs, n)];
  };
  for (const drawn of [listed.filter((s) => s.kind !== "core:rock"), listed]) {
    const map = parseMap(writeMap(flatMap(4, { statics: drawn })));
    // As placeStatics set down the pieces of a file read as a list: one by one in its order.
    const before = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    for (const s of drawn) {
      const kind = reg.index.get(s.kind)!;
      const def = reg.defs[kind]!;
      before.add(kind, s.x, s.y, s.z, s.yaw, 0, def.type === "structure" ? def.hp : 0);
    }
    const after = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    placeStatics(map, after, reg);
    expect(rowsOf(after)).toEqual(rowsOf(before));

    // As CityStatics made its columns from that list: the structures by chunk, in the list's order within one.
    const of = drawn.map((s) => reg.index.get(s.kind)!).map((k) => (reg.defs[k]!.type === "structure" ? k : 0));
    const chunkOf = drawn.map((s) => chunkAt(dims, s.x, s.z));
    const order = [...drawn.keys()].filter((i) => of[i] !== 0).sort((a, b) => chunkOf[a]! - chunkOf[b]! || a - b);
    const old = Object.assign(new CityStatics(dims, [], reg), {
      first: Uint32Array.from({ length: 17 }, (_, c) => order.filter((i) => chunkOf[i]! < c).length),
      kind: Uint16Array.from(order, (i) => of[i]!),
      yaw: Uint16Array.from(order, (i) => drawn[i]!.yaw),
      x: Float32Array.from(order, (i) => drawn[i]!.x),
      y: Float32Array.from(order, (i) => drawn[i]!.y),
      z: Float32Array.from(order, (i) => drawn[i]!.z),
    });
    const city = new CityStatics(dims, map.statics, reg);
    expect([city.first, city.kind, city.yaw, city.x, city.y, city.z]).toEqual([old.first, old.kind, old.yaw, old.x, old.y, old.z]);
    expect(head(old.first, 17).filter((n, c) => c > 0 && n > old.first[c - 1]!).length).toBeGreaterThanOrEqual(5);
    // With every piece drawn the map's columns are the city's; a piece left out is left out of a copy.
    expect([city.x === map.statics.x, city.first === map.statics.first]).toEqual(drawn === listed ? [false, false] : [true, true]);
    const hf = mapHeightfield(map);
    for (let c = 0; c < 16; c++) {
      const forms = [(s: CityStatics) => mergedPart(s, c, hf, none, 0.01, 0), (s: CityStatics) => mergedPart(s, c, hf, none, 0.5, 2.1), (s: CityStatics) => cellPart(s, c, hf, null, 4, 4)];
      for (const make of forms) expect(make(city)).toEqual(make(old));
      expect(cityTops(city, c, hf, null)).toEqual(cityTops(old, c, hf, null));
    }
  }
});

test("a level made from what a worker is sent, its tile's statics, those round it and the ground under them, is the level made from the whole map", () => {
  const reg = farRegistry();
  const rng = new Rng(11);
  const kinds = [FLOOR, PIER, BEAM, WALL, "core:zruin_container_rust", ...SLOPED.map(slopeKind)];
  // A tile of 3 by 3 chunks, pieces across its edges, on rolling ground.
  const statics: MapStatic[] = Array.from({ length: 700 }, () => ({ kind: kinds[Math.floor(rng.float() * kinds.length)]!, x: 150 + rng.float() * 280, y: 2 + rng.float() * 30, z: 150 + rng.float() * 280, yaw: Math.floor(rng.float() * 65536) }));
  const w = cityWorld({ chunks: 8, statics, ground: (x, z) => 4 * Math.sin(x / 17) + 3 * Math.cos(z / 11) });
  const city = new CityStatics(w.dims, asWritten(statics), reg);
  const window = new HeightWindow({ cell: w.hf.cell, nx: w.hf.nx, nz: w.hf.nz, minY: w.hf.minY, stepY: w.hf.stepY, i0: 30, j0: 40, w: 140, heights: w.hf.window(30, 40, 169, 189) });
  for (let k = 0; k < 2000; k++) {
    const [x, z] = [60 + rng.float() * 276, 80 + rng.float() * 296];
    expect(window.heightAt(x, z)).toBe(w.hf.heightAt(x, z));
  }
  expect(() => window.heightAt(20, 200)).toThrow();
  const pack = farPack();
  const bounds = pack.header.meshes[pack.header.meshes.findIndex((m) => m.id === "core:far")]!;
  const chunks = [9, 10, 11, 17, 18, 19, 25, 26, 27].filter((c) => city.in(c) > 0);
  const lost = new Map(chunks.map((c) => [c, Uint8Array.from({ length: city.in(c) }, () => (rng.float() < 0.2 ? 1 : 0))]));
  const goneOf = (c: number): Uint8Array | null => lost.get(c) ?? null;
  // The bare lattice's pieces under 1.3 m across, the piers and beams here, are left out as gone ones are.
  const across = (k: number): number => [w.reg.halfX[k]!, w.reg.halfY[k]!, w.reg.halfZ[k]!].sort((a, b) => a - b)[1]! * 2;
  const thinOf = (c: number): Uint8Array => Uint8Array.from({ length: city.in(c) }, (_, i) => (goneOf(c)?.[i] === 1 || across(city.kind[city.first[c]! + i]!) < 1.3 ? 1 : 0));
  expect(chunks.map(thinOf).flatMap((g) => [...g]).filter((g) => g === 1).length).toBeGreaterThan(30);
  for (const level of [{ gap: 0.01, least: 0, cell: 0, tall: 0 }, { gap: 0.5, least: 2.1, cell: 0, tall: 0 }, { gap: 0.5, least: 2.1, cell: 0, tall: 0, thin: 1.3 }, { gap: -1, least: 0, cell: 4, tall: 4 }]) {
    const made = makeLevel(cityKinds(city, w.hf, bounds), cityJob(0, city, w.hf, goneOf, chunks, level, 32, -8, 32));
    // The same faces, chunk by chunk, made from the whole map and stored as the level stores them.
    let faces = 0;
    chunks.forEach((c, r) => {
      const part = level.cell > 0 ? cellPart(city, c, w.hf, goneOf(c), level.cell, level.tall) : mergedPart(city, c, w.hf, "thin" in level ? thinOf : goneOf, level.gap, level.least);
      expect([made.first[r], made.count[r]]).toEqual([faces * 6, part.faces * 6]);
      const view = new DataView(made.data.buffer);
      for (let v = 0; v < part.faces * 4; v++) {
        const o = (faces * 4 + v) * VERTEX_BYTES;
        const got = [0, 1, 2].map((a) => bounds.center[a]! + (view.getInt16(o + a * 2, true) / 32767) * bounds.half[a]!);
        const want = [part.pos[v * 3]! + chunkCx(w.dims, c) * CHUNK_SIZE - 32, part.pos[v * 3 + 1]! + 8, part.pos[v * 3 + 2]! + chunkCz(w.dims, c) * CHUNK_SIZE - 32];
        for (let a = 0; a < 3; a++) expect(Math.abs(got[a]! - want[a]!)).toBeLessThan(bounds.half[a]! / 32767);
        expect(view.getUint8(o + 6)).toBe(part.color[v >> 2]!);
      }
      faces += part.faces;
    });
    expect(faces).toBeGreaterThan(200);
  }
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

// Sloped statics (content/slopes.ts), worked out here from the shapes themselves.

type V3 = [number, number, number];
const SLOPED = ["ramp", "rubble", "stairs", "stairs_solid", "slab30", "slab60", "roof"] as const;
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A polygon's normal times its area, by Newell's sum: out of a face whose corners go round it counter-clockwise. */
function areaOf(q: readonly V3[]): V3 {
  const n: V3 = [0, 0, 0];
  for (let i = 0; i < q.length; i++) {
    const [a, b] = [q[i]!, q[(i + 1) % q.length]!];
    n[0] += ((a[1] - b[1]) * (a[2] + b[2])) / 2;
    n[1] += ((a[2] - b[2]) * (a[0] + b[0])) / 2;
    n[2] += ((a[0] - b[0]) * (a[1] + b[1])) / 2;
  }
  return n;
}

/** A part's quads in the world, a triangle's repeated last corner dropped. `side` is the map's chunks along x. */
function quadsOf(p: CityPart, chunk: number, side = 4): V3[][] {
  const [x0, z0] = [(chunk % side) * CHUNK_SIZE, Math.floor(chunk / side) * CHUNK_SIZE];
  return Array.from({ length: p.faces }, (_, f) => {
    const q: V3[] = [];
    for (let k = 0; k < 4; k++) {
      const v: V3 = [p.pos[f * 12 + k * 3]! + x0, p.pos[f * 12 + k * 3 + 1]!, p.pos[f * 12 + k * 3 + 2]! + z0];
      if (!(k === 3 && v.every((c, a) => c === q[2]![a]))) q.push(v);
    }
    return q;
  });
}

/** Each part of a static as drawn near (`look`) or as walked: its faces as polygons in the world, and their planes. */
function partsOf(reg: Registry, s: MapStatic, look: boolean): { faces: V3[][]; planes: [V3, number][] }[] {
  const d = reg.defs[reg.index.get(s.kind)!]!;
  if (d.type !== "structure") throw new Error(s.kind);
  const shape = d.shape !== undefined ? (reg.defs[reg.index.get(d.shape)!] as ShapeDef) : null;
  const form = !shape ? { boxes: [{ at: [0, 0, 0], half: d.half }] as ShapeBox[], hulls: [] } : look && shape.look ? { boxes: shape.look.boxes ?? [], hulls: shape.look.hulls ?? [] } : { boxes: shape.boxes, hulls: shape.hulls ?? [] };
  const boxHull = (b: ShapeBox): HullDef => ({ corners: Array.from({ length: 8 }, (_, k) => [b.at[0] + (k & 1 ? 1 : -1) * b.half[0], b.at[1] + (k & 2 ? 1 : -1) * b.half[1], b.at[2] + (k & 4 ? 1 : -1) * b.half[2]] as [number, number, number]) });
  const a = (s.yaw / YAW_UNITS) * TAU;
  const [c, sn] = [detCos(a), detSin(a)];
  return [...form.boxes.map(boxHull), ...form.hulls].map((h) => {
    const made = hullOf(h);
    if (typeof made === "string") throw new Error(made);
    const faces = made.rings.map((r) => r.map((i): V3 => {
      const [u, y, v] = hullPoint(h.corners[i]!, h.sixty === true);
      return [s.x + c * u + sn * v, s.y + y, s.z + c * v - sn * u];
    }));
    return { faces, planes: faces.map((f): [V3, number] => [unit(areaOf(f)), dot(unit(areaOf(f)), f[0]!)]) };
  });
}

/**
 * What a box level should show of `statics` on flat ground at 0: every face of every part, as drawn near or walked, but
 * those another part holds whole (each corner within 2 cm of it) and those under the ground; as quads, fanned, and in area.
 */
function shown(reg: Registry, statics: readonly MapStatic[], look: boolean): { quads: number; area: number; faces: { face: V3[]; normal: V3; plane: number }[] } {
  const parts = statics.flatMap((s) => partsOf(reg, s, look));
  const out = { quads: 0, area: 0, faces: [] as { face: V3[]; normal: V3; plane: number }[] };
  parts.forEach((p, i) => {
    p.faces.forEach((f, k) => {
      const [n, d] = p.planes[k]!;
      if (f.every((v) => v[1] <= 0.05) || (n[1] < -0.9999 && f[0]![1] <= 0.1)) return;
      out.faces.push({ face: f, normal: n, plane: d });
      if (parts.some((q, j) => j !== i && f.every((v) => q.planes.every(([m, e]) => dot(m, v) - e <= 0.02)))) return;
      // A corner on the line between its neighbours, as a flight's bend is, is no corner of the face drawn.
      const corners = f.filter((v, m) => {
        const [a, b] = [f[(m + f.length - 1) % f.length]!, f[(m + 1) % f.length]!];
        const [u, w] = [[0, 1, 2].map((k) => v[k]! - a[k]!), [0, 1, 2].map((k) => b[k]! - v[k]!)];
        return Math.hypot(u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!) > 1e-6;
      }).length;
      out.quads += Math.ceil((corners - 2) / 2);
      out.area += Math.hypot(...areaOf(f));
    });
  });
  return out;
}

/** Whether every quad of `p` lies on a face of `faces`, looking the same way, and their area all told. */
function onFaces(p: CityPart, chunk: number, faces: { normal: V3; plane: number }[]): { on: boolean; area: number } {
  let on = true;
  let area = 0;
  for (const q of quadsOf(p, chunk)) {
    const a = areaOf(q);
    area += Math.hypot(...a);
    const n = unit(a);
    const mid = [0, 1, 2].map((k) => q.reduce((t, v) => t + v[k]!, 0) / q.length);
    on &&= faces.some((f) => dot(n, f.normal) > 0.9999 && Math.abs(dot(f.normal, mid) - f.plane) < 0.005);
  }
  return { on, area };
}

/** The volume a closed part encloses, by the divergence theorem, measured from `o`. */
function volumeOf(p: CityPart, chunk: number, o: readonly number[]): number {
  let v = 0;
  for (const q of quadsOf(p, chunk)) {
    const r = q.map((c): V3 => [c[0] - o[0]!, c[1] - o[1]!, c[2] - o[2]!]);
    for (let k = 1; k + 1 < r.length; k++) {
      const [a, b, c] = [r[0]!, r[k]!, r[k + 1]!];
      v += dot(a, [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]]) / 6;
    }
  }
  return v;
}

test("each sloped kind alone and turned shows its faces at every level: as drawn near in every box, as walked in the lattice, and cells cut to its top in the mass", () => {
  const reg = farRegistry();
  const { hf, dims } = cityWorld({ chunks: 4, statics: [] });
  // Quads of each kind in the air: as the near store draws it and as it is walked. A face of a part is fanned, a triangle
  // is one; a roof's slopes hold each other's ends at the ridge; a solid flight's treads are blocks that hold the backs of
  // those below; a flight on a slab, walked, is six faces, its bend lying on its top's edges, and drawn near it is ten
  // treads on a soffit of six faces that holds their undersides and backs.
  const quads: Record<(typeof SLOPED)[number], [number, number]> = { ramp: [6, 6], rubble: [5, 5], stairs: [46, 6], stairs_solid: [46, 5], slab30: [6, 6], slab60: [6, 6], roof: [10, 10] };
  for (const name of SLOPED) {
    for (const yaw of [5000, 5000 + 3 * 16384]) {
      const statics = asWritten([{ kind: slopeKind(name), x: 96, y: 20, z: 96, yaw }]);
      const city = new CityStatics(dims, statics, reg);
      const chunk = 5;
      for (const [gap, least] of [[-1, 0], [0.01, 0], [0.5, 2.1]] as const) {
        const look = least === 0;
        const want = shown(reg, statics, look);
        const part = mergedPart(city, chunk, hf, none, gap, least);
        expect([name, yaw, gap, part.faces]).toEqual([name, yaw, gap, quads[name][look ? 0 : 1]]);
        expect(want.quads).toBe(part.faces);
        const got = onFaces(part, chunk, want.faces);
        expect(got.on).toBe(true);
        expect(got.area).toBeCloseTo(want.area, 3);
      }
      // The mass is cells in the frame, its tops cut to the kind's own within half a metre, closed, of the kind's colour.
      const colour = (reg.defs[reg.index.get(slopeKind(name))!] as { color: number }).color;
      const a = ((yaw % 16384) / YAW_UNITS) * TAU;
      const axes: V3[] = [[detCos(a), 0, -detSin(a)], [0, 1, 0], [detSin(a), 0, detCos(a)]];
      const top = Math.max(...shown(reg, statics, false).faces.flatMap((f) => f.face.map((v) => v[1])));
      for (const size of [4, 8]) {
        const mass = cellPart(city, chunk, hf, null, size, 4);
        const quads = quadsOf(mass, chunk);
        const rise = Math.max(...quads.flatMap((q) => q.map((v) => v[1]))) - top;
        expect([name, size, rise >= -1e-3 && rise <= 0.5]).toEqual([name, size, true]);
        const sum = quads.reduce((s, q) => s.map((v, k) => v + areaOf(q)[k]!), [0, 0, 0]);
        expect(sum.every((v) => Math.abs(v) < 1e-6)).toBe(true);
        expect(volumeOf(mass, chunk, [96, 20, 96])).toBeGreaterThan(0);
        expect(quadsOf(mass, chunk).every((q) => axes.some((x) => Math.abs(dot(unit(areaOf(q)), x)) > 0.9999))).toBe(true);
        expect(mass.color.every((c) => c === colour)).toBe(true);
      }
    }
  }
});

test("a ramp on a deck, a leaning slab and heaped rubble drop only held faces", () => {
  const reg = farRegistry();
  const yaw = 5000;
  const scene = slopes(160, 160, 0, yaw);
  // Each group alone: a ramp's high end held by the deck's side, its foot under the ground, and the step under its high
  // end, in the air its holding box spans, showing its five faces above the ground; a slab's low end held in the floor
  // under it; rubble's back held by the wall it is heaped against and its floor on the ground, and the step in it held
  // whole by it. The lattice leaves out the steps.
  const want = { ramp: [15, 10], slab: [10, 10], rubble: [8, 8] } as const;
  for (const group of ["ramp", "slab", "rubble"] as const) {
    const statics = asWritten(scene[group]);
    const w = cityWorld({ chunks: 8, statics });
    const city = new CityStatics(w.dims, statics, reg);
    const chunks = [...new Set(statics.map((s) => w.chunkOf(s.x, s.z)))];
    expect(chunks.length).toBe(1);
    const chunk = chunks[0]!;
    for (const [gap, least] of [[-1, 0], [0.01, 0], [0.5, 2.1]] as const) {
      const part = mergedPart(city, chunk, w.hf, none, gap, least);
      expect([group, gap, part.faces]).toEqual([group, gap, want[group][least === 0 ? 0 : 1]]);
      if (least === 0) expect(shown(reg, statics, true).quads).toBe(part.faces);
      if (group === "ramp" && least === 0) {
        // The step's faces, found by their middles being in its box.
        const step = statics.find((s) => s.kind === STEP)!;
        const a = (step.yaw / YAW_UNITS) * TAU;
        const inStep = quadsOf(part, chunk, 8).filter((q) => {
          const [mx, my, mz] = [0, 1, 2].map((k) => q.reduce((t, v) => t + v[k]!, 0) / q.length) as V3;
          const [dx, dz] = [mx - step.x, mz - step.z];
          return Math.abs(detCos(a) * dx - detSin(a) * dz) <= 1.01 && Math.abs(my - step.y) <= 0.21 && Math.abs(detSin(a) * dx + detCos(a) * dz) <= 0.26;
        });
        expect(inStep.length).toBe(5);
      }
    }
  }
});

test("sloped pieces drawn far are the near store's picture, from one side", () => {
  // The three sides at twice the size are in farcity.slow.test.ts; this is one, small, so a broken far level shows here.
  const scene = slopes(160, 160, 0, 5000);
  const w = cityWorld({ chunks: 8, statics: scene.all });
  const chunks = [...new Set(scene.all.map((s) => w.chunkOf(s.x, s.z)))];
  w.cam.fovY = (14 * Math.PI) / 180;
  w.look(160, 2, 160, 150, 0.4, 25);
  w.frame(true);
  w.frame(true);
  // The sky's openness and what stands overhead all on the card, so that the light is the same in both pictures.
  while (!w.scene.farShadow!.whole) w.frame(true);
  const drawnFar = w.covered().far;
  const colours = w.raster.color.slice();
  // The share of the picture the slow test asks for, at a quarter of its pixels.
  expect(sum(drawnFar)).toBeGreaterThan(1250);
  for (const c of chunks) w.rows(c);
  w.frame(true);
  const { far, near } = w.covered();
  expect(sum(far)).toBe(0);
  let differ = 0;
  for (let i = 0; i < near.length; i++) if (Math.max(...[0, 1, 2].map((k) => Math.abs(w.raster.color[i * 4 + k]! - colours[i * 4 + k]!))) > 6) differ++;
  expect(differ / sum(drawnFar)).toBeLessThan(0.01);
});

test("the mass of a leaning slab is the cells it crosses, not its box's, and its faces are coloured as boxes' are", () => {
  const reg = farRegistry();
  const yaw = 5000;
  const a = (yaw / YAW_UNITS) * TAU;
  const [c, s] = [detCos(a), detSin(a)];
  const [x, z] = [96, 96];
  const put = (kind: string, u: number, y: number, v: number): MapStatic => ({ kind, x: x + c * u + s * v, y, z: z + c * v - s * u, yaw });
  // A floor plate 10 m up sets the grid, its layers 4 m tall from 10 m. The slab leans across the layer at 14 m from 12 m
  // to 16.4 m, and from 2.6 m behind the plate's middle to 4.6 m before it.
  const statics = asWritten([put(FLOOR, 0, 10.2, 0), put(SLOPE_SLAB30, 0, 14.2, 1)]);
  const w = cityWorld({ chunks: 4, statics });
  const city = new CityStatics(w.dims, statics, reg);
  const chunk = w.chunkOf(x, z);
  const mass = cellPart(city, chunk, w.hf, null, 4, 4);
  // Into the frame, and the cells filled found by how many faces lie ahead along +x of each cell's middle.
  const frame = (v: V3): V3 => [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
  const qs = quadsOf(mass, chunk).map((q) => q.map(frame));
  const lo = [0, 1, 2].map((k) => Math.min(...qs.flatMap((q) => q.map((v) => v[k]!))));
  const hi = [0, 1, 2].map((k) => Math.max(...qs.flatMap((q) => q.map((v) => v[k]!))));
  const filled = new Set<string>();
  for (let k = 0; lo[2]! + k * 4 < hi[2]!; k++) {
    for (let j = 0; lo[1]! + j * 4 < hi[1]!; j++) {
      for (let i = 0; lo[0]! + i * 4 < hi[0]!; i++) {
        const m = [lo[0]! + i * 4 + 2, lo[1]! + j * 4 + 2, lo[2]! + k * 4 + 2];
        const ahead = qs.filter((q) => {
          const r = [0, 1, 2].map((e) => [Math.min(...q.map((v) => v[e]!)), Math.max(...q.map((v) => v[e]!))]);
          return r[0]![1]! - r[0]![0]! < 1e-3 && r[0]![0]! > m[0]! && m[1]! > r[1]![0]! && m[1]! < r[1]![1]! && m[2]! > r[2]![0]! && m[2]! < r[2]![1]!;
        }).length;
        if (ahead % 2 === 1) filled.add(`${i},${j},${k}`);
      }
    }
  }
  // The plate fills a layer of two by two cells. The slab, sampled every 5 cm, fills each cell it covers 0.3 of along
  // each axis: two across, in the plate's layer where it rises from it and in the next layer where it leans on up, not
  // the eight its box takes.
  const slab = partsOf(reg, statics[1]!, false)[0]!;
  const slabLo = [0, 1, 2].map((k) => Math.min(...slab.faces.flat().map((v) => frame(v)[k]!)));
  const slabHi = [0, 1, 2].map((k) => Math.max(...slab.faces.flat().map((v) => frame(v)[k]!)));
  const span = new Map<string, number[]>();
  for (let px = slabLo[0]!; px <= slabHi[0]!; px += 0.05) {
    for (let py = slabLo[1]!; py <= slabHi[1]!; py += 0.05) {
      for (let pz = slabLo[2]!; pz <= slabHi[2]!; pz += 0.05) {
        // Back from the frame into the world, to test against the slab's planes.
        const p: V3 = [c * px + s * pz, py, c * pz - s * px];
        if (!slab.planes.every(([n, d]) => dot(n, p) <= d)) continue;
        const key = [px, py, pz].map((v, e) => Math.floor((v - lo[e]!) / 4)).join(",");
        const b = span.get(key) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        [px, py, pz].forEach((v, e) => {
          b[e] = Math.min(b[e]!, v);
          b[e + 3] = Math.max(b[e + 3]!, v);
        });
        span.set(key, b);
      }
    }
  }
  const crossed = [...span].filter(([, b]) => [0, 1, 2].every((e) => b[e + 3]! - b[e]! + 0.05 >= 0.3 * 4)).map(([k]) => k);
  // No cell is near enough the line for the sampling to matter.
  expect([...span].every(([, b]) => [0, 1, 2].every((e) => Math.abs(b[e + 3]! - b[e]! + 0.05 - 1.2) > 0.15))).toBe(true);
  const plate = ["0,0,0", "1,0,0", "0,0,1", "1,0,1"];
  expect(crossed.sort()).toEqual(["0,0,0", "0,1,1", "1,0,0", "1,1,1"]);
  expect([...filled].sort()).toEqual([...new Set([...plate, ...crossed])].sort());
  const boxCells = [0, 1, 2].map((e) => {
    let n = 0;
    for (let i = 0; i * 4 + lo[e]! < slabHi[e]!; i++) if (Math.min(slabHi[e]!, lo[e]! + i * 4 + 4) - Math.max(slabLo[e]!, lo[e]! + i * 4) >= 1.2) n++;
    return n;
  });
  expect(boxCells[0]! * boxCells[1]! * boxCells[2]!).toBe(8);
  // A pitched roof over walls: its mass's top is the roof's colour and its sides below the eaves the walls'.
  const roofed = asWritten(slopes(96, 96, 0, yaw).roof);
  const r = new CityStatics(w.dims, roofed, reg);
  const roofMass = cellPart(r, w.chunkOf(roofed[0]!.x, roofed[0]!.z), w.hf, null, 4, 4);
  const roofQuads = quadsOf(roofMass, w.chunkOf(roofed[0]!.x, roofed[0]!.z));
  const roofTop = Math.max(...roofQuads.flatMap((q) => q.map((v) => v[1])));
  const colours = { up: new Set<number>(), side: new Set<number>() };
  roofQuads.forEach((q, f) => {
    const n = unit(areaOf(q));
    if (n[1] > 0.99 && q[0]![1] === roofTop) colours.up.add(roofMass.color[f]!);
    else if (Math.abs(n[1]) < 0.01 && Math.min(...q.map((v) => v[1])) < 2) colours.side.add(roofMass.color[f]!);
  });
  expect([...colours.up]).toEqual([(reg.defs[reg.index.get(slopeKind("roof"))!] as { color: number }).color]);
  expect([...colours.side]).toEqual([(reg.defs[reg.index.get(WALL)!] as { color: number }).color]);
});

test("a static of several boxes is drawn by its boxes, not by the one box that holds them", () => {
  // Two blocks side by side on one origin, the lower one's end against the taller one's side.
  const shape = slopeShape("test:shape_two", "thing", [], [
    { at: [-2, 0, 0], half: [2, 2, 2] },
    { at: [3, -1, 0], half: [3, 1, 2] },
  ]);
  const { registry } = compileContent([...CORE_CONTENT, shape, staticOf("test:two", shape, { color: 100, hp: 1000 })]);
  const reg = registry!;
  const statics = asWritten([{ kind: "test:two", x: 96, y: 20, z: 96, yaw: 5000 }]);
  const w = cityWorld({ chunks: 4, statics: [] });
  const city = new CityStatics(w.dims, statics, reg);
  // Six faces of the taller, five of the lower, whose end the taller holds; the box round them would be six.
  for (const [gap, least] of [[-1, 0], [0.01, 0], [0.5, 2.1]] as const) {
    const part = mergedPart(city, 5, w.hf, none, gap, least);
    expect(part.faces).toBe(11);
    expect(onFaces(part, 5, shown(reg, statics, true).faces).on).toBe(true);
  }
  // In 4 m cells the taller takes one and the lower two, cut to its top, 2 m up its row: two cells' worth.
  expect(volumeOf(cellPart(city, 5, w.hf, null, 4, 4), 5, [96, 20, 96]) / 64).toBeCloseTo(2, 3);
});

test("the mass keeps a building's top at its own heights, not its cells': a parapet, a lift overrun and a storey set back, its sides closed", () => {
  // A tower 40 m square of 8 m blocks on a 1.5 m plinth of ground, five blocks high but for its west row, four; a parapet
  // along its north edge and a lift overrun 4 m tall in its middle; and a step on the ground beside it, which starts its
  // cells' layers at 0, so its roof at 41.5 m falls 1.5 m into a layer and its overrun 1.5 m into the next.
  const [x, z] = mid(1, 1);
  const statics: MapStatic[] = [{ kind: "core:zruin_step_concrete", x: x + 23, y: 0.2, z, yaw: 0 }];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) for (let k = 0; k < (i === 0 ? 4 : 5); k++) statics.push({ kind: "core:zruin_zmass8_concrete", x: x - 16 + i * 8, y: 5.5 + k * 8, z: z - 16 + j * 8, yaw: 0 });
    if (i > 0) statics.push({ kind: "core:zruin_zparapet8_concrete", x: x - 16 + i * 8, y: 41.975, z: z + 19.75, yaw: 0 });
  }
  statics.push({ kind: "core:zruin_zcore_concrete", x, y: 43.5, z, yaw: 0 });
  const w = cityWorld({ chunks: 4, statics });
  const city = new CityStatics(w.dims, asWritten(statics), farRegistry());
  const chunk = w.chunkOf(x, z);
  for (const size of [4, 8]) {
    const quads = quadsOf(cellPart(city, chunk, w.hf, null, size, 4), chunk);
    // The highest face looking up over a point, and the faces' areas summed: a closed shell's sides sum to nothing.
    const roof = (dx: number, dz: number): number => Math.max(...quads.filter((q) => unit(areaOf(q))[1] > 0.99 && q.some((v) => v[0] <= x + dx) && q.some((v) => v[0] >= x + dx) && q.some((v) => v[2] <= z + dz) && q.some((v) => v[2] >= z + dz)).map((q) => Math.round(q[0]![1] * 100) / 100));
    expect({ size, overrun: roof(0, 0), roof: roof(8, 0), parapet: roof(8, 18), setback: roof(-16, 0) }).toEqual({ size, overrun: 45.5, roof: 41.5, parapet: 42.5, setback: 33.5 });
    const sum = quads.reduce((s, q) => s.map((v, a) => v + areaOf(q)[a]!), [0, 0, 0]);
    expect([Math.abs(sum[0]!) < 1e-6, Math.abs(sum[2]!) < 1e-6]).toEqual([true, true]);
  }
});
