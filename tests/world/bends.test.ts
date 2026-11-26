import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { CHUNK_SIZE, FRAME_MIDDLE, SECTOR_CHUNKS, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { BEND_SHORTS, HIT_PREFIX, MODEL_HALF, arcLength, bendVertex, curveAt, packBend, placeKerb, underPiece, unpackBend, wrapped, type BentPiece, type KerbLine, type Section } from "../../shared/world/bends.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { MapStatics, bendOf, blankStatics, parseMap, readHead, readPart, setStatics, squareOf, writeMap, type MapData, type MapStatic, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { HeldStatics } from "../../client/core/map-statics.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry, flatWorld } from "../fixtures/world.ts";

const SECTION: Section = { kerb: "raised", walk: 3, panel: 1.5, seed: 77, wear: 0.4 };

/** Where a piece's vertex at the kerb's face, `u` along it, stands in the world, as its static's turn and place put it. */
function faceAt(p: BentPiece, u: number, z = 0): [number, number, number] {
  const out = new Float64Array(11);
  bendVertex(out, p.bend, (u - 0.5) * 2 * MODEL_HALF, 0, z, 0, 1, 0, 1, 0, 0);
  const a = (p.yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [p.x + c * out[0]! + s * out[2]!, p.y + out[1]!, p.z - s * out[0]! + c * out[2]!];
}

/** A kerb line round an arc of `radius` about (cx, cz) from angle a0 to a1, a point every `step` metres. */
function arc(cx: number, cz: number, radius: number, a0: number, a1: number, step: number): KerbLine {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * radius) / step) + 1);
  const x: number[] = [], z: number[] = [], dx: number[] = [], dz: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = a0 + ((a1 - a0) * k) / (n - 1), sense = Math.sign(a1 - a0);
    x.push(cx + radius * Math.cos(a));
    z.push(cz + radius * Math.sin(a));
    dx.push(-Math.sin(a) * sense);
    dz.push(Math.cos(a) * sense);
  }
  return { x, z, y: x.map(() => 1), dx, dz };
}

test("a bend is eight 16-bit numbers that come back as they went, its station within the wrap", () => {
  const out = new Int16Array(BEND_SHORTS);
  packBend(out, 0, { half: 6.25, turn0: -0.3, turn1: 0.41, station: 1234.56, rise: -0.031, panel: 1.5, walk: 3.25, seed: 201, wear: 0.5 });
  const b = unpackBend(out);
  expect(b.half).toBe(6.25);
  expect(b.turn0).toBeCloseTo(-0.3, 3);
  expect(b.turn1).toBeCloseTo(0.41, 3);
  expect(b.station).toBeCloseTo(wrapped(1234.56), 2);
  expect([b.rise, b.panel, b.walk, b.seed]).toEqual([-0.031, 1.5, 3.25, 201]);
  expect(b.wear).toBeCloseTo(0.5, 2);
});

test("a straight kerb is a few long pieces end to end on its line, each a straight", () => {
  // 50 m at 44 degrees, a point every 2 m.
  const a = (44 * Math.PI) / 180, x: number[] = [], z: number[] = [];
  for (let d = 0; d <= 50; d += 2) [x[x.length], z[z.length]] = [100 + d * Math.cos(a), 200 + d * Math.sin(a)];
  const pieces = placeKerb({ x, z, y: x.map(() => 2) }, 1, SECTION);
  // Up to 32 m a straight, where the line runs straight and rises evenly.
  expect(pieces.length).toBe(2);
  expect(pieces.every((p) => p.kind === "core:zzzzzbend_raised_s")).toBe(true);
  for (let k = 0; k < pieces.length; k++) {
    const [sx, , sz] = faceAt(pieces[k]!, 0), [ex, , ez] = faceAt(pieces[k]!, 1);
    // On the line, and each starting where the one before ends.
    for (const [px, pz] of [[sx, sz], [ex, ez]] as const) expect(Math.abs((px - 100) * Math.sin(a) - (pz - 200) * Math.cos(a))).toBeLessThan(0.002);
    if (k > 0) {
      const [px, , pz] = faceAt(pieces[k - 1]!, 1);
      expect(Math.hypot(px - sx, pz - sz)).toBeLessThan(0.002);
    }
  }
  // The walk is on the left: a point 2 m across stands a quarter counter-clockwise from the way the line runs.
  const [wx, , wz] = faceAt(pieces[0]!, 0.5, 2), [fx, , fz] = faceAt(pieces[0]!, 0.5);
  // The model's walk's back, 2 m across, is the section's 3 m.
  expect((wx - fx) * -Math.sin(a) + (wz - fz) * Math.cos(a)).toBeCloseTo(SECTION.walk, 3);
  // On the other side the walk is on the right.
  const right = placeKerb({ x, z, y: x.map(() => 2) }, -1, SECTION);
  const [rx, , rz] = faceAt(right[0]!, 0.5, 1), [qx, , qz] = faceAt(right[0]!, 0.5);
  expect((rx - qx) * -Math.sin(a) + (rz - qz) * Math.cos(a)).toBeLessThan(0);
});

test("a corner's arc is curved pieces whose kerb's face keeps within a few millimetres of the arc, and they meet end to end", () => {
  for (const radius of [4, 6, 40]) {
    const line = arc(0, 0, radius, -Math.PI / 2, Math.PI / 4, 0.5);
    const pieces = placeKerb(line, 1, SECTION);
    expect(pieces.every((p) => p.kind === "core:zzzzzbend_raised_c")).toBe(true);
    let worst = 0, gap = 0;
    for (let k = 0; k < pieces.length; k++) {
      for (let q = 0; q <= 16; q++) {
        const [px, , pz] = faceAt(pieces[k]!, q / 16);
        worst = Math.max(worst, Math.abs(Math.hypot(px, pz) - radius));
      }
      if (k > 0) {
        const [ax, , az] = faceAt(pieces[k - 1]!, 1), [bx, , bz] = faceAt(pieces[k]!, 0);
        gap = Math.max(gap, Math.hypot(ax - bx, az - bz));
      }
    }
    expect(worst).toBeLessThan(0.004);
    expect(gap).toBeLessThan(0.002);
    // A curve turning toward the walk, which lies inside the arc.
    expect(pieces.every((p) => p.bend.turn1 > p.bend.turn0)).toBe(true);
  }
});

test("a piece's stations run on from the last, and its curve's length is the arc's", () => {
  const line = arc(0, 0, 10, 0, Math.PI / 2, 1);
  const pieces = placeKerb(line, 1, SECTION, 30);
  expect(pieces[0]!.bend.station).toBeCloseTo(30, 3);
  let s = 30;
  for (const p of pieces) {
    expect(p.bend.station).toBeCloseTo(s, 1);
    s += arcLength(p.bend.half, p.bend.turn1 - p.bend.turn0);
  }
  expect(s - 30).toBeCloseTo((10 * Math.PI) / 2, 1);
  const at = [0, 0, 0, 0];
  curveAt(at, 2, -0.3, 0.3, 0.5);
  expect(at[0]).toBeCloseTo(0, 6);
  expect(at[2]).toBeCloseTo(1, 6);
});

test("the collision pieces under a bent piece lie within it, along its curve, at the kerb's height", () => {
  for (const line of [arc(0, 0, 6, 0, Math.PI / 2, 0.5), { x: [0, 13], z: [0, 0], y: [1, 1] }]) {
    for (const p of placeKerb(line, 1, SECTION)) {
      const hits = underPiece(p);
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.kind.startsWith("core:zzzzzbendhit_box_300_")).toBe(true);
        expect(h.y).toBeCloseTo(1.075, 3);
      }
    }
  }
  // A 13 m straight is two 8 m boxes, overlapping in it and reaching neither end past it.
  const [p] = placeKerb({ x: [0, 13], z: [0, 0], y: [1, 1] }, 1, SECTION);
  const hits = underPiece(p!);
  expect(hits.map((h) => h.kind)).toEqual(["core:zzzzzbendhit_box_300_800", "core:zzzzzbendhit_box_300_800"]);
  expect(hits[0]!.x).toBeCloseTo(4, 6);
  expect(hits[1]!.x).toBeCloseTo(9, 6);
  const reg = coreRegistry();
  for (const h of hits) expect(reg.index.has(h.kind)).toBe(true);
  expect(reg.index.has(p!.kind)).toBe(true);
});

/** A flat map of 4 by 4 chunks whose middle is a corner of four sectors, with an arc of raised kerb round it and a rock either side. */
function bentMap(): { map: MapData; statics: MapStatic[] } {
  const map = flatMap(4, { dims: { chunksX: 4, chunksZ: 4, frameX: FRAME_MIDDLE - 2, frameZ: FRAME_MIDDLE - 2 } });
  const pieces = placeKerb(arc(128, 128, 30, 0, Math.PI, 2), 1, SECTION);
  const statics: MapStatic[] = [
    { kind: "core:rock", x: 10, y: 33, z: 10, yaw: 0 },
    ...pieces.map((p) => {
      const b = new Int16Array(BEND_SHORTS);
      packBend(b, 0, p.bend);
      return { kind: p.kind, x: p.x, y: p.y + 32, z: p.z, yaw: Math.round((p.yaw / 360) * 65536) & 0xffff, bend: b };
    }),
    { kind: "core:rock", x: 200, y: 33, z: 200, yaw: 0 },
  ];
  return { map, statics };
}

/** A sector's statics read alone, one at a time, into a table laid out from the head, as a page reads them. */
function readInParts(file: Uint8Array): MapStatics {
  const head = readHead(file);
  const t = blankStatics(head, false);
  for (const part of head.parts.filter((p) => p.kind === "statics")) [...setStatics(head, t, readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece)];
  return t;
}

/** Every row of a table, chunk by chunk and slot by slot, as text. */
const rowsOf = (t: MapStatics): string[] => Array.from({ length: t.kind.length }, (_, r) => `${t.kinds[t.kind[r]!]} ${t.x[r]} ${t.y[r]} ${t.z[r]} ${t.yaw[r]}`);

test("a median keeps distinct collision boxes and its neighbours keep their slots", () => {
  const map = flatMap(4);
  const x = 71784 / 512, z = 392152 / 512 - 640;
  const median = { kind: "core:zzzzzbend_median_c", x, y: 509 / 512, z, yaw: 40539, bend: [483, 0, 4133, 1545, 6, 0, 300, 8246] };
  const rock = { kind: "core:rock", x, y: 0, z, yaw: 0 };
  const file = writeMap({ ...map, statics: [median, rock] });
  const head = readHead(file), whole = parseMap(file).statics;
  const rows = rowsOf(whole);
  expect(rows).toEqual(rowsOf(readInParts(file)));
  expect(rows).toEqual(rowsOf(MapStatics.of(map.dims, [median, rock])));
  expect(rows.slice(0, 2).map((r) => r.split(" ")[0])).toEqual([median.kind, rock.kind]);
  expect(new Set(rows).size).toBe(rows.length);
  const part = head.parts.find((p) => p.kind === "statics")!;
  const old = readPart({ ...head, version: 15 }, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece;
  expect(old.id.length).toBe(rows.length + 1);
});

test("a map holds its bent pieces' bends, by chunk and slot, read whole and read in parts", () => {
  const { map, statics } = bentMap();
  const file = writeMap({ ...map, statics });
  const back = parseMap(file).statics;
  // A map lists its pieces sector by sector.
  const bends = (list: Iterable<MapStatic>): string[] => [...list].filter((s) => !s.kind.startsWith(HIT_PREFIX)).map((s) => `${s.kind} ${s.bend ? Array.from(s.bend) : null}`).sort();
  expect(bends(back)).toEqual(bends(statics));
  // Read a sector at a time, as a page does, the chunks hold the same bends.
  const t = readInParts(file);
  expect([...t.bends.keys()].sort()).toEqual([...back.bends.keys()].sort());
  for (const [c, b] of back.bends) for (let k = 0; k < b.slot.length; k++) expect(bendOf(t.bends.get(c), b.slot[k]!)).toEqual(b.bend.subarray(k * 8, k * 8 + 8));
  // Every bent piece's chunk is where its chord's middle is.
  for (const [c] of back.bends) expect(c).toBeLessThan((map.dims.chunksX * map.dims.chunksZ * CHUNK_SIZE) / CHUNK_SIZE);
  // A page holds a sector at a time (map-statics.ts): the table of those it holds keeps their bends, which the near store
  // draws a bent piece by, so that a city made of it draws its kerbs and none of a sector not held.
  const head = readHead(file), sectors = head.parts.filter((p) => p.kind === "statics");
  // The sector of the first chunk with bends, alone.
  const first = [...t.bends.keys()][0]!, [cx, cz] = [first % map.dims.chunksX, Math.floor(first / map.dims.chunksX)];
  const one = sectors.find((p) => {
    const sq = squareOf(head.dims, SECTOR_CHUNKS, p.col, p.row)!;
    return sq.cx0 <= cx && cx < sq.cx1 && sq.cz0 <= cz && cz < sq.cz1;
  })!;
  const held = new HeldStatics(head);
  const set = held.set(one, readPart(head, one, file.subarray(one.at, one.at + one.length)) as StaticsPiece);
  while (!set.next().done);
  const steps = held.table();
  let s = steps.next();
  while (!s.done) s = steps.next();
  const near = s.value, city = new CityStatics(map.dims, near, coreRegistry());
  expect(city.squareOf(0)!.map).toBe(near);
  const kept = [...near.bends.keys()];
  expect([kept.length > 0, kept.length < t.bends.size, kept.every((c) => near.first[c + 1]! > near.first[c]!)]).toEqual([true, true, true]);
  for (const c of kept) expect(near.bends.get(c)).toEqual(t.bends.get(c)!);
});

test("a map stores no collision piece of a bent one but makes them where it is read: the same boxes, read whole or a sector at a time", () => {
  const { map, statics } = bentMap();
  // As the build lays them, the collision pieces in the list (bent-walks.ts), from the pieces' own places.
  const listed = statics.flatMap((s) => [s, ...(s.bend ? underPiece({ kind: s.kind, x: s.x, y: s.y, z: s.z, yaw: (s.yaw * 360) / 65536, bend: unpackBend(s.bend), kerb: "raised" }).map((h) => ({ kind: h.kind, x: h.x, y: h.y, z: h.z, yaw: Math.round((h.yaw / 360) * 65536) & 0xffff })) : [])]);
  const file = writeMap({ ...map, statics: listed });
  // The list's collision pieces are not what the file holds: it is the same with them or without them.
  expect(writeMap({ ...map, statics })).toEqual(file);
  const whole = parseMap(file).statics, parts = readInParts(file);
  // The arc crosses the corner of four sectors: some of its pieces' boxes stand in another sector than the piece, which
  // that sector stores; the rest are made as each sector is read.
  const hits = [...whole].filter((s) => s.kind.startsWith(HIT_PREFIX));
  expect(hits.length).toBe(listed.length - statics.length);
  // The same rows in every chunk's slots, to the bit, read whole as a server does and a sector at a time as a page does,
  // and the same as a table made from the list (MapStatics.of, as the build's).
  expect(rowsOf(parts)).toEqual(rowsOf(whole));
  const of = MapStatics.of(map.dims, listed);
  const sorted = (t: MapStatics): string[] => {
    const out: string[] = [];
    for (let c = 0; c + 1 < t.first.length; c++) out.push(...rowsOf(t).slice(t.first[c]!, t.first[c + 1]!).sort());
    return out;
  };
  expect(sorted(of)).toEqual(sorted(whole));
  // Each made box within a few millimetres of where the build laid it from the pieces' own places, off the lattice.
  const near = (h: MapStatic): number => Math.min(...listed.filter((l) => l.kind === h.kind).map((l) => Math.hypot(l.x - h.x, l.y - h.y, l.z - h.z)));
  expect(Math.max(...hits.map(near))).toBeLessThan(0.004);
  const reg = coreRegistry();
  for (const h of hits) expect(reg.index.has(h.kind)).toBe(true);
});

/** A kerb's face along z = 100 from x = 70 to 94, round a 6 m arc about (94, 106) to (100, 106), then up x = 100 to z = 130, its walk inside the corner. */
function corner(): KerbLine {
  const x: number[] = [], z: number[] = [], dx: number[] = [], dz: number[] = [];
  const put = (px: number, pz: number, wx: number, wz: number): void => {
    x.push(px);
    z.push(pz);
    dx.push(wx);
    dz.push(wz);
  };
  for (let d = 70; d < 94; d += 4) put(d, 100, 1, 0);
  for (let k = 0; k <= 24; k++) {
    const a = -Math.PI / 2 + ((Math.PI / 2) * k) / 24;
    put(94 + 6 * Math.cos(a), 106 + 6 * Math.sin(a), -Math.sin(a), Math.cos(a));
  }
  for (let d = 110; d <= 130; d += 4) put(100, d, 0, 1);
  return { x, z, y: x.map(() => 0), dx, dz };
}

test("a corner's walk is under its collision pieces all along it, from just behind the kerb's face to its back", () => {
  const pieces = placeKerb(corner(), 1, SECTION);
  const hits = pieces.flatMap(underPiece);
  const covered = (x: number, z: number): boolean => hits.some((h) => {
    // Its width and length, in centimetres, from its kind's id (bends.ts hitKind).
    const [w, l] = /_(\d+)_(\d+)$/.exec(h.kind)!.slice(1).map(Number) as [number, number];
    const a = (h.yaw * Math.PI) / 180, dx = x - h.x, dz = z - h.z;
    // In the box's frame: x along (cos a, -sin a), z across (sin a, cos a).
    return Math.abs(dx * Math.cos(a) - dz * Math.sin(a)) <= l / 200 + 1e-3 && Math.abs(dx * Math.sin(a) + dz * Math.cos(a)) <= w / 200 + 1e-3;
  });
  let missed = 0, tried = 0;
  for (const p of pieces) for (let q = 0; q <= 8; q++) for (const across of [0.05, 0.6, 1.2, 1.8]) {
    // A point of the walk, `across` of the model's 2 m (the section's 3 m stretched from the kerb's back).
    const [x, , z] = faceAt(p, q / 8, across);
    tried++;
    if (!covered(x, z)) missed++;
  }
  expect([tried, missed]).toEqual([tried, 0]);
});

/** A flat world with a bent kerb's collision pieces laid as the build lays them. */
function kerbWorld(section: Section): ReturnType<typeof flatWorld> {
  const w = flatWorld(4);
  for (const p of placeKerb(corner(), 1, section)) for (const h of underPiece(p)) w.structs.add(w.kind(h.kind), h.x, h.y, h.z, Math.round((h.yaw / 360) * 65536) & 0xffff, 0, 1);
  return w;
}

test("a body steps up a bent kerb and walks round its curved walk on top of it, and a car mounts it as a walk's", () => {
  for (const walker of ["core:survivor", "core:trike", "core:raptor"]) {
    const w = kerbWorld(SECTION), params = w.reg.move[w.kind(walker)]!, b = new Body();
    // Up the kerb from the road, onto the walk.
    [b.x, b.z, b.y, b.grounded] = [84, 97, 0, true];
    for (let tick = 0; tick < 200 && b.z < 101.5; tick++) stepBody(w, b, 0, 90, 0, 0, 0, params, TICK_DT);
    expect([walker, b.z >= 101.5, Math.abs(b.y - 0.15) < 0.02]).toEqual([walker, true, true]);
    // Round the corner along the walk's middle, 1.5 m behind the face: never off the top.
    const route: [number, number][] = [[90, 101.5]];
    for (let k = 1; k <= 8; k++) {
      const a = -Math.PI / 2 + ((Math.PI / 2) * k) / 8;
      route.push([94 + 4.5 * Math.cos(a), 106 + 4.5 * Math.sin(a)]);
    }
    route.push([98.5, 120]);
    let lowest = Infinity;
    for (const [px, pz] of route) {
      for (let tick = 0; tick < 400 && Math.hypot(b.x - px, b.z - pz) > 0.3; tick++) {
        const yaw = Math.round((Math.atan2(px - b.x, pz - b.z) * 65536) / (2 * Math.PI)) & 65535;
        stepBody(w, b, 0, 90, yaw, 0, 0, params, TICK_DT);
        lowest = Math.min(lowest, b.y);
      }
    }
    expect([walker, Math.hypot(b.x - 98.5, b.z - 120) < 0.5, lowest > 0.13]).toEqual([walker, true, true]);
  }
  // A car over the kerb square on, slantwise, and over the arc.
  const coast = { throttle: 0.3, steer: 0, brake: 0, handbrake: false, neutral: false };
  // Each over the kerb onto its walk: past the straight's face, or inside the arc's walk, 4.5 m from its centre.
  const cases: [number, number, number, (c: { x: number; z: number }) => boolean][] = [
    [82, 88, 0, (c) => c.z > 103.5],
    [78, 88, Math.PI / 8, (c) => c.z > 103.5],
    [108, 92, -Math.PI / 4, (c) => Math.hypot(c.x - 94, c.z - 106) < 4.5],
  ];
  for (const [x, z, yaw, over] of cases) {
    const w = kerbWorld(SECTION), world = new StaticVehicleWorld({ hf: w.hf, structs: w.structs }, () => ASPHALT);
    const car = createVehicle(COMPACT, x, 0, z, yaw);
    car.vx = 8 * Math.sin(yaw);
    car.vz = 8 * Math.cos(yaw);
    let mounted = false;
    for (let tick = 0; tick < 150; tick++) {
      stepVehicle(car, coast, COMPACT, world);
      mounted ||= over(car);
    }
    expect([x, z, mounted]).toEqual([x, z, true]);
  }
});

test("a walk let down to the ground at its end: its top falls to the road along the piece, the kerb stands, and its collision is a slope", () => {
  const out = new Int16Array(BEND_SHORTS);
  for (const sink of [1, -1, 0] as const) for (const tactile of [true, false]) {
    packBend(out, 0, { half: 0.75, turn0: 0, turn1: 0, station: 12, rise: 0, panel: 1.5, walk: 3.25, seed: 9, wear: 0.3, sink, tactile });
    const b = unpackBend(out);
    expect([b.sink, b.tactile, b.walk, b.panel]).toEqual([sink, tactile, 3.25, 1.5]);
  }
  const [p] = placeKerb({ x: [0, 1.5], z: [0, 0], y: [1, 1] }, 1, SECTION);
  const down: BentPiece = { ...p!, bend: { ...p!.bend, sink: 1 } };
  const at = (b: BentPiece, u: number, z: number, y: number): number => {
    const o = new Float64Array(11);
    bendVertex(o, b.bend, (u - 0.5) * 2 * MODEL_HALF, y, z, 0, 1, 0, 1, 0, 0);
    return o[1]!;
  };
  // The walk's top, 0.15 m over the road, at its start and down on the road at its end (each with the walk's sag of a
  // few millimetres); the kerb's top stays.
  expect(at(down, 0, 1, 0.15)).toBeCloseTo(0.15, 2);
  expect(at(down, 1, 1, 0.15)).toBeCloseTo(0, 2);
  expect(at(down, 1, 0.1, 0.15)).toBeCloseTo(0.15, 6);
  // Nothing under the road moves but by the sag.
  expect(at(down, 1, 1, -0.06)).toBeCloseTo(-0.06, 2);
  // Its collision: the kerb's box 0.3 m wide, and behind it a slope as long as the piece, falling toward its end.
  const hits = underPiece(down);
  expect(hits.map((h) => h.kind).sort()).toEqual(["core:zzzzzbendhit_box_30_100", "core:zzzzzbendhit_box_30_100", "core:zzzzzbendhit_slope_275_150"].sort());
  const reg = coreRegistry();
  for (const h of hits) expect(reg.index.has(h.kind)).toBe(true);
  // A survivor walks down it from the walk to the road and does not step off a ledge.
  const w = flatWorld(4);
  for (const h of underPiece({ ...down, x: 100.75, z: 100, y: 0 })) w.structs.add(w.kind(h.kind), h.x, h.y, h.z, Math.round((h.yaw / 360) * 65536) & 0xffff, 0, 1);
  const body = new Body(), params = w.reg.move[w.kind("core:survivor")]!;
  [body.x, body.z, body.y, body.grounded] = [99.5, 101.8, 0.15, true];
  let worst = 0, last = body.y;
  for (let tick = 0; tick < 200 && body.x < 103; tick++) {
    stepBody(w, body, 0, 90, 16384, 0, 0, params, TICK_DT);
    worst = Math.max(worst, last - body.y);
    last = body.y;
  }
  expect(body.x).toBeGreaterThan(102.5);
  expect(body.y).toBeLessThan(0.03);
});

test("a bent walk's grain is laid across by the concrete strip's own rows, as the street atlas lays them out", async () => {
  const { CONCRETE_ROWS, CONCRETE_METRES, STRIP_METRES } = await import("../../client/core/render/bend.ts");
  // The street atlas's layout, read where it lies (it is in git, outside every zone).
  const layout = JSON.parse(readFileSync(join(import.meta.dir, "../../assets/source/core/props/street/layout.json"), "utf8")) as { street: { side: number; tiles: number; gutter: number; strips: string[]; strip: number } };
  const s = layout.street, k = s.strips.indexOf("concrete");
  expect([...CONCRETE_ROWS]).toEqual([(k * s.strip + s.gutter) / s.side, ((k + 1) * s.strip - s.gutter) / s.side]);
  // As many rows a metre across as along.
  expect((CONCRETE_ROWS[1] - CONCRETE_ROWS[0]) * s.side / CONCRETE_METRES).toBe(s.side / STRIP_METRES);
  expect(STRIP_METRES).toBe(s.tiles);
});

test("a piece across the stations' wrap is laid along it straight: its stations run on past 600 m, and what reads them wraps them", async () => {
  const { BEND_GLSL, BENT_WEAR_GLSL, bentWear } = await import("../../client/core/render/bend.ts");
  // A 10 m straight from station 595: its texture along and its wear's station went 595 to 5 across its triangles, so
  // they ran back over the whole 600 m in its 10 m.
  const [p] = placeKerb({ x: [0, 10], z: [0, 0], y: [1, 1] }, 1, SECTION, 595);
  const out = new Float64Array(11), at = (u: number): number => (bendVertex(out, p!.bend, (u - 0.5) * 2 * MODEL_HALF, 0, 0, 0, 1, 0, 1, 0, 0), out[9]!);
  expect([at(0), at(0.5), at(1)].map((s) => Number(s.toFixed(3)))).toEqual([595, 600, 605]);
  // The wear reads a station wrapped: the same 600 m on.
  for (const s of [3.25, 5, 299.9]) {
    const a = [0.5, 0.5, 0.5], b = [0.5, 0.5, 0.5], ma = [0.5, 0, 1], mb = [0.5, 0, 1];
    bentWear(a, ma, s, 1, 0.15, 1, 77 + 256 * 60, 1.5, 3, 0.01);
    bentWear(b, mb, s + 600, 1, 0.15, 1, 77 + 256 * 60, 1.5, 3, 0.01);
    expect([b, mb]).toEqual([a, ma]);
  }
  // The vertex text leaves the station as it is, and the fragment's wear wraps it.
  expect([BEND_GLSL.includes("gBent = vec3(s, z, l.y)"), BENT_WEAR_GLSL.includes("along = mod(at.x, 600.0)")]).toEqual([true, true]);
});

test("a straight runs to 32 m where its line rises evenly, and past 16 m no further where it does not", () => {
  const x = Array.from({ length: 31 }, (_, k) => k), z = x.map(() => 0);
  expect(placeKerb({ x, z, y: x.map((k) => 1 + k * 0.01) }, 1, SECTION).length).toBe(1);
  // A hump of 6 cm at 24 m: a straight to 16 m whatever, then on only where it keeps to an even rise.
  const humped = placeKerb({ x, z, y: x.map((k) => 1 + (k === 24 ? 0.06 : 0)) }, 1, SECTION);
  expect(humped.length).toBeGreaterThan(1);
  expect(humped[0]!.bend.half * 2).toBeGreaterThanOrEqual(16);
  expect(humped.every((p) => p.kind.endsWith("_s"))).toBe(true);
  // A way in graded 40 cm below the street across 6 m of it: the kerb goes down into it and up again, straights all, and
  // no point of the line is more than 5 cm off its piece's rise, where one straight bridged it in the air.
  const dip = (k: number): number => 1 - (k >= 8 && k <= 13 ? 0.4 : k === 7 || k === 14 ? 0.2 : 0);
  const graded = placeKerb({ x: x.slice(0, 22), z: z.slice(0, 22), y: x.slice(0, 22).map(dip) }, 1, SECTION);
  expect(graded.every((p) => p.kind.endsWith("_s"))).toBe(true);
  for (let k = 0; k < 22; k++) {
    const p = graded.find((q) => Math.abs(q.x - k) <= q.bend.half + 1e-9)!;
    expect(Math.abs(p.y + (p.bend.rise * (k - p.x)) / p.bend.half - dip(k))).toBeLessThan(0.05 + 1e-9);
  }
});
