import { expect, test } from "bun:test";
import { ASPHALT, COMPACT } from "../../content/vehicles/compact.ts";
import { CHUNK_SIZE, TICK_DT } from "../../shared/coords.ts";
import { Body, stepBody } from "../../shared/sim/character.ts";
import { createVehicle, stepVehicle } from "../../shared/sim/vehicle.ts";
import { BEND_SHORTS, MODEL_HALF, arcLength, bendVertex, curveAt, packBend, placeKerb, underPiece, unpackBend, wrapped, type BentPiece, type KerbLine, type Section } from "../../shared/world/bends.ts";
import { bendOf, blankStatics, parseMap, readHead, readPart, setStatics, writeMap, type StaticsPiece } from "../../shared/world/mapfile.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
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
  expect(pieces.length).toBe(4);
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

test("a map holds its bent pieces' bends, by chunk and slot, read whole and read in parts", () => {
  const map = flatMap(4);
  const line = arc(128, 128, 30, 0, Math.PI, 2);
  const pieces = placeKerb(line, 1, SECTION);
  const bends = pieces.map((p) => {
    const b = new Int16Array(BEND_SHORTS);
    packBend(b, 0, p.bend);
    return b;
  });
  const statics = [
    { kind: "core:rock", x: 10, y: 33, z: 10, yaw: 0 },
    ...pieces.map((p, i) => ({ kind: p.kind, x: p.x, y: p.y + 32, z: p.z, yaw: Math.round((p.yaw / 360) * 65536) & 0xffff, bend: bends[i]! })),
    { kind: "core:rock", x: 200, y: 33, z: 200, yaw: 0 },
  ];
  const file = writeMap({ ...map, statics });
  const back = parseMap(file).statics;
  expect([...back].map((s) => (s.bend ? Array.from(s.bend) : null))).toEqual(statics.map((s) => ("bend" in s && s.bend ? Array.from(s.bend) : null)));
  // Read a sector at a time, as a page does, the chunks hold the same bends.
  const head = readHead(file);
  const t = blankStatics(head, false);
  for (const part of head.parts.filter((p) => p.kind === "statics")) {
    const piece = readPart(head, part, file.subarray(part.at, part.at + part.length)) as StaticsPiece;
    [...setStatics(head, t, piece)];
  }
  expect([...t.bends.keys()].sort()).toEqual([...back.bends.keys()].sort());
  for (const [c, b] of back.bends) for (let k = 0; k < b.slot.length; k++) expect(bendOf(t.bends.get(c), b.slot[k]!)).toEqual(b.bend.subarray(k * 8, k * 8 + 8));
  // Every bent piece's chunk is where its chord's middle is.
  for (const [c] of back.bends) expect(c).toBeLessThan((map.dims.chunksX * map.dims.chunksZ * CHUNK_SIZE) / CHUNK_SIZE);
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
