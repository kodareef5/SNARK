// The streets as lines (planning/workstreams/streets.md): a sector's part read back as it was written, the distances and
// bands a point and a chunk's samples take from it, what a wheel meets at its edges, the kerb lines with their stations,
// the map file carrying the parts, and the page's twin of the ground's cover from them.

import { expect, test } from "bun:test";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { mapHeightfield, parseMap, writeMap } from "../../shared/world/mapfile.ts";
import {
  CHUNK_SIDE, DROP_CROSSING, DROP_DRIVE, DROP_RAMP, PLANE_BYTES, StreetPoint, StreetSectors, alongByte, chunkPlanes, chunkTag, decodeStreets, encodeStreets, heldSide, kerbLines, kindsByte,
  planeMetres, streetAt, streetClass, type StreetsPart,
} from "../../shared/world/streets.ts";
import { GROUND_CLASS } from "../../shared/world/vehicle-surface.ts";
import { alongOf, streetCover } from "../../client/core/render/world-surfaces.ts";
import { surfaceIndex } from "../../content/surfaces.ts";
import { wideMap } from "../fixtures/map.ts";

const PLANTED = 1, WALK = 1, RAISED = 0, FLUSH = 1;
/** A street along x at z = 100 from x = 0 to 400, 4 m to each kerb, a 1.5 m planted verge and a 2 m walk each side. */
const side = heldSide(4, 1.5, 2, kindsByte(PLANTED, WALK, RAISED));
const along: StreetsPart = { x0: 0, z0: 0, stretches: [{ type: 3, flags: 0, seed: 77, sides: [side, side], xz: Float64Array.of(0, 100, 400, 100) }], corners: [] };

const held = (part: StreetsPart, x0 = 0, z0 = 0): StreetSectors => {
  const s = new StreetSectors();
  s.put(0, decodeStreets(encodeStreets(part), x0, z0), 0, 0, 16, 16);
  return s;
};

test("a sector's streets come back from their bytes as they were written, to a sixteenth of a metre", () => {
  const part: StreetsPart = {
    x0: 64, z0: 128,
    stretches: [
      { type: 2, flags: 3, seed: 40000, sides: [heldSide(4.3, 0, 3.5, kindsByte(0, 2, 0)), heldSide(5.1, 2.25, 1.5, kindsByte(3, 1, 2))], xz: Float64Array.of(70.03, 140.5, 300.25, 600.1, 900, 610) },
      { type: 0, flags: 0, seed: 1, sides: [side, side], xz: Float64Array.of(64, 128, 64.5, 128.25) },
    ],
    corners: [{ cx: 120.5, cz: 200.25, radius: 6, reach: 8.5, ax: 0, az: 1, bx: 1, bz: 0, stretch: 1, side: 0 }],
  };
  const bytes = encodeStreets(part), back = decodeStreets(bytes, 64, 128);
  expect(back.stretches.length).toBe(2);
  expect(back.stretches[0]!.sides[1]).toEqual(part.stretches[0]!.sides[1]);
  for (let k = 0; k < 6; k++) expect(Math.abs(back.stretches[0]!.xz[k]! - part.stretches[0]!.xz[k]!)).toBeLessThanOrEqual(1 / 32);
  expect(back.corners[0]!).toMatchObject({ radius: 6, reach: 8.5, stretch: 1, side: 0 });
  expect(Math.abs(back.corners[0]!.cx - 120.5)).toBeLessThan(1 / 32);
  // A part read against another corner moves with it; one cut short, or with a byte past its end, is refused.
  expect(decodeStreets(bytes, 0, 0).stretches[1]!.xz[0]).toBe(0);
  expect(() => decodeStreets(bytes.subarray(0, bytes.length - 1), 64, 128)).toThrow(/past its end/);
  expect(() => decodeStreets(Uint8Array.from([...bytes, 0]), 64, 128)).toThrow(/runs on/);
});

test("a point's distance is to its nearest kerb, signed, with that side's verge and walk", () => {
  const s = held(along), p = new StreetPoint();
  for (const [z, d] of [[100, -4], [97, -1], [104, 0], [105, 1], [108.5, 4.5], [92, 4]] as const) {
    expect(streetAt(s, 200, z, p)).toBe(true);
    expect(p.d).toBeCloseTo(d, 6);
    expect(p.verge).toBe(1.5);
    expect(p.walk).toBe(2);
    expect(Math.abs(p.alongX)).toBeCloseTo(1, 6);
  }
  // Past its end the carriageway is round, and far off no street is near.
  expect(streetAt(s, 403, 100, p) && p.d).toBeCloseTo(-1, 6);
  expect(streetAt(s, 200, 900, p)).toBe(false);
});

test("a corner's fill rounds the kerb between its two ends: street outside its arc, its walk inside it", () => {
  // A street along x at z = 0 and one along z at x = 0, kerbs 4 m off, the corner of the block at (4, 4) rounded on 6 m.
  const part: StreetsPart = {
    x0: 0, z0: 0,
    stretches: [{ type: 0, flags: 0, seed: 0, sides: [side, side], xz: Float64Array.of(-100, 0, 100, 0) }, { type: 0, flags: 0, seed: 0, sides: [side, side], xz: Float64Array.of(0, -100, 0, 100) }],
    corners: [{ cx: 10, cz: 10, radius: 6, reach: 6 * Math.SQRT2, ax: -1, az: 0, bx: 0, bz: -1, stretch: 0, side: 0 }],
  };
  const s = new StreetSectors();
  s.put(0, part, -2, -2, 2, 2);
  const p = new StreetPoint();
  // The sharp corner (4, 4) is now street; the arc's middle point is the kerb; a point a metre inside it, a metre off.
  expect(streetAt(s, 4.5, 4.5, p) && p.d).toBeLessThan(0);
  const m = 10 - 6 / Math.SQRT2;
  expect(streetAt(s, m, m, p) && p.d).toBeCloseTo(0, 6);
  expect(streetAt(s, m + Math.SQRT1_2, m + Math.SQRT1_2, p) && p.d).toBeCloseTo(1, 6);
  // Along a kerb past the arc's end the kerb is the street's own.
  expect(streetAt(s, 30, 5, p) && p.d).toBeCloseTo(1, 6);
});

test("a chunk's planes hold the distances to the kerb, the verge's end and the walk's end, straight between samples at any angle", () => {
  // A street at 45 degrees through chunk (2, 2).
  const diag: StreetsPart = { x0: 0, z0: 0, stretches: [{ type: 0, flags: 0, seed: 5, sides: [side, side], xz: Float64Array.of(0, 0, 400, 400) }], corners: [] };
  const s = held(diag), dist = new Uint8Array(CHUNK_SIDE * CHUNK_SIDE * PLANE_BYTES), kinds = new Uint8Array(dist.length);
  expect(chunkPlanes(s, 2, 2, dist, kinds)).toBe(true);
  const at = (i: number, j: number, c: number): number => planeMetres(dist[(j * CHUNK_SIDE + i) * PLANE_BYTES + c]!);
  // Sample (i, j) at (128 + 2i, 128 + 2j): its distance from the centre line is |x - z| / sqrt 2, less the kerb's 4 m.
  for (const [i, j] of [[5, 5], [6, 5], [7, 5], [8, 5], [9, 4]] as const) {
    const want = Math.abs(2 * i - 2 * j) / Math.SQRT2 - 4;
    if (want > 7.9) continue;
    expect(Math.abs(at(i, j, 0) - want)).toBeLessThanOrEqual(1 / 32);
    expect(Math.abs(at(i, j, 1) - (want - 1.5))).toBeLessThanOrEqual(1 / 32);
    expect(Math.abs(at(i, j, 2) - (want - 3.5))).toBeLessThanOrEqual(1 / 32);
  }
  const k = (5 * CHUNK_SIDE + 5) * PLANE_BYTES;
  expect(kinds[k]).toBe(side.kinds);
  expect(kinds[k + 1]! & 15).toBe(chunkTag(2, 2));
  expect(kinds[k + 3]).toBe(5);
  // Far from it every byte is 0: a picture of zeros is no street near.
  const far = (30 * CHUNK_SIDE + 1) * PLANE_BYTES;
  expect([...dist.subarray(far, far + 4), ...kinds.subarray(far, far + 4)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test("the way along a kerb in a byte comes back within a degree, and a way and its opposite are one", () => {
  const out = new Float64Array(2);
  for (let deg = -179; deg < 180; deg += 7) {
    const a = (deg * Math.PI) / 180, b = alongByte(Math.cos(a), Math.sin(a));
    expect(alongByte(-Math.cos(a), -Math.sin(a))).toBe(b);
    alongOf(b, out);
    expect(Math.abs(out[0]! * Math.cos(a) + out[1]! * Math.sin(a))).toBeGreaterThan(Math.cos((1 * Math.PI) / 180));
  }
});

test("a wheel meets asphalt to the kerb's line, the verge's ground and the walk's paving across their bands, and the cell's own past them", () => {
  const s = held(along);
  expect(streetClass(s, 200, 103.9, GROUND_CLASS.GROUND)).toBe(GROUND_CLASS.ASPHALT);
  expect(streetClass(s, 200, 104.5, GROUND_CLASS.ASPHALT)).toBe(GROUND_CLASS.GROUND);
  expect(streetClass(s, 200, 106.5, GROUND_CLASS.GROUND)).toBe(GROUND_CLASS.PAVING);
  // Just past the walk a cell that the stepped samples made a street's is ground; further out the cell's own.
  expect(streetClass(s, 200, 108.5, GROUND_CLASS.ASPHALT)).toBe(GROUND_CLASS.GROUND);
  expect(streetClass(s, 200, 113, GROUND_CLASS.GRAVEL)).toBe(GROUND_CLASS.GRAVEL);
  // A flooded street is still a pool, and far off the cell says.
  expect(streetClass(s, 200, 100, GROUND_CLASS.MUD)).toBe(GROUND_CLASS.MUD);
  expect(streetClass(s, 200, 300, GROUND_CLASS.SAND)).toBe(GROUND_CLASS.SAND);
});

test("each kerb line runs along its street's edge, cut where a cross street takes it, its stations from its stretch's start", () => {
  const cross = heldSide(4, 0, 2, kindsByte(0, WALK, RAISED));
  const part: StreetsPart = {
    x0: 0, z0: 0,
    stretches: [{ type: 0, flags: 0, seed: 0, sides: [side, side], xz: Float64Array.of(0, 100, 400, 100) }, { type: 0, flags: 0, seed: 0, sides: [cross, cross], xz: Float64Array.of(200, 0, 200, 300) }, { type: 0, flags: 0, seed: 0, sides: [heldSide(3, 0, 0, kindsByte(0, 0, FLUSH)), heldSide(3, 0, 0, kindsByte(0, 0, FLUSH))], xz: Float64Array.of(300, 0, 300, 90) }],
    corners: [],
  };
  const s = new StreetSectors();
  s.put(0, part, 0, 0, 16, 16);
  const lines = kerbLines(s, part);
  // The street along x: its left kerb at z = 104 cut by the cross street (x from 196 to 204), its right at z = 96 cut at
  // the cross street and at the flush lane's end; the flush lane has none.
  const left = lines.filter((l) => l.stretch === 0 && l.side === 0);
  expect(left.length).toBe(2);
  expect(left[0]!.xz[1]).toBeCloseTo(104, 6);
  expect(left[0]!.xz[left[0]!.xz.length - 2]!).toBeLessThanOrEqual(196);
  expect(left[1]!.stations[0]!).toBeGreaterThanOrEqual(204);
  expect(lines.some((l) => l.stretch === 2)).toBe(false);
  for (const l of lines) for (let k = 1; k < l.stations.length; k++) expect(l.stations[k]!).toBeGreaterThan(l.stations[k - 1]!);
});

/** The least distance from (x, z) to a centre line's segments. */
function toLine(xz: Float64Array, x: number, z: number): number {
  let best = Infinity;
  for (let q = 2; q < xz.length; q += 2) {
    const ax = xz[q - 2]!, az = xz[q - 1]!, ex = xz[q]! - ax, ez = xz[q + 1]! - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

test("a kerb line follows its street's edge round a bend in its centre line, mitred inside it and round outside, and runs on into the next stretch", () => {
  // A street that bends by 30 degrees at (200, 100), then another of the same street on from its end bending 20 more.
  const a = (30 * Math.PI) / 180, b = (50 * Math.PI) / 180;
  const p1 = [200 + 100 * Math.cos(a), 100 + 100 * Math.sin(a)] as const, p2 = [p1[0] + 80 * Math.cos(b), p1[1] + 80 * Math.sin(b)] as const;
  const part: StreetsPart = {
    x0: 0, z0: 0,
    stretches: [
      { type: 0, flags: 0, seed: 1, sides: [side, side], xz: Float64Array.of(100, 100, 200, 100, ...p1) },
      { type: 0, flags: 0, seed: 2, sides: [side, side], xz: Float64Array.of(...p1, ...p2) },
    ],
    corners: [],
  };
  const lines = kerbLines(held(part), part);
  // One line a side of each stretch, every point the kerb's 4 m from the centre line, as the ground draws the edge.
  expect(lines.length).toBe(4);
  for (const l of lines) for (let q = 0; q < l.xz.length; q += 2) {
    const d = Math.min(toLine(part.stretches[0]!.xz, l.xz[q]!, l.xz[q + 1]!), toLine(part.stretches[1]!.xz, l.xz[q]!, l.xz[q + 1]!));
    expect(Math.abs(d - 4)).toBeLessThan(1e-6);
  }
  // No step longer than a metre, and each side's two lines meet at one point where the stretches meet.
  for (const l of lines) for (let q = 2; q < l.xz.length; q += 2) expect(Math.hypot(l.xz[q]! - l.xz[q - 2]!, l.xz[q + 1]! - l.xz[q - 1]!)).toBeLessThanOrEqual(1 + 1e-9);
  for (const side of [0, 1]) {
    const [one, two] = [lines.find((l) => l.stretch === 0 && l.side === side)!, lines.find((l) => l.stretch === 1 && l.side === side)!];
    expect(Math.hypot(one.xz[one.xz.length - 2]! - two.xz[0]!, one.xz[one.xz.length - 1]! - two.xz[1]!)).toBeLessThan(1e-6);
  }
  // Its stations are its own line's length: the inside of the bends shorter than the outside.
  const length = (side: number): number => lines.filter((l) => l.side === side).reduce((n, l) => n + l.stations[l.stations.length - 1]! - l.stations[0]!, 0);
  expect(length(0)).toBeLessThan(length(1));
});

test("a stretch's kerb ends at the end of the corner's arc it comes into, the two meeting end to end", () => {
  // Along x at z = 100 to a cross street at x = 200, its left kerb (z = 104) rounding into the cross street's (x = 196)
  // on a 6 m arc about (190, 110).
  const cross = heldSide(4, 0, 2, kindsByte(0, WALK, RAISED));
  const part: StreetsPart = {
    x0: 0, z0: 0,
    stretches: [{ type: 0, flags: 0, seed: 1, sides: [side, side], xz: Float64Array.of(0, 100, 400, 100) }, { type: 0, flags: 0, seed: 2, sides: [cross, cross], xz: Float64Array.of(200, 100, 200, 300) }],
    corners: [{ cx: 190, cz: 110, radius: 6, reach: Math.hypot(6, 6), ax: 0, az: -1, bx: 1, bz: 0, stretch: 0, side: 0 }],
  };
  const lines = kerbLines(held(part), part);
  const run = lines.find((l) => l.stretch === 0 && l.side === 0 && l.corner < 0)!, arc = lines.find((l) => l.corner === 0)!;
  // The run's last point is the arc's first, and no point of the run lies past it: no metre of kerb laid twice.
  expect([run.xz[run.xz.length - 2], run.xz[run.xz.length - 1]]).toEqual([190, 104]);
  expect([arc.xz[0], arc.xz[1]]).toEqual([190, 104]);
  for (let q = 0; q < run.xz.length; q += 2) expect(run.xz[q]!).toBeLessThanOrEqual(190);
  // The cross street's left kerb (x = 196) comes out of the arc's other end.
  const out = lines.find((l) => l.stretch === 1 && l.corner < 0 && Math.abs(l.xz[0]! - 196) < 1e-6)!;
  expect(out.xz[1]).toBeCloseTo(110, 9);
});

test("a kerb's drops come back from a part's bytes and with its kerb lines, and a corner into a flush street is let down whole", () => {
  const flush = heldSide(3, 0, 0, kindsByte(0, 0, FLUSH)), cross = heldSide(4, 0, 2, kindsByte(0, WALK, RAISED));
  // Along x with a crossing at 50 m on its left kerb; a drive (flush) meets it from the north at x = 200, a corner
  // rounding its left kerb into the drive's; a cross street at x = 300 with a ramp on its corner.
  const part: StreetsPart = {
    x0: 0, z0: 0,
    stretches: [
      { type: 0, flags: 0, seed: 1, sides: [side, side], xz: Float64Array.of(0, 100, 400, 100), drops: [Float64Array.of(48, 52.25, DROP_CROSSING), null] },
      { type: 0, flags: 0, seed: 2, sides: [flush, flush], xz: Float64Array.of(200, 100, 200, 160) },
      { type: 0, flags: 0, seed: 3, sides: [cross, cross], xz: Float64Array.of(300, 100, 300, 300) },
    ],
    corners: [
      { cx: 193, cz: 110, radius: 6, reach: Math.hypot(6, 6), ax: 0, az: -1, bx: 1, bz: 0, stretch: 0, side: 0 },
      { cx: 290, cz: 110, radius: 6, reach: Math.hypot(6, 6), ax: 0, az: -1, bx: 1, bz: 0, stretch: 0, side: 0, drops: Float64Array.of(4, 5.5, DROP_RAMP) },
    ],
  };
  const back = decodeStreets(encodeStreets(part), 0, 0);
  expect(Array.from(back.stretches[0]!.drops![0]!)).toEqual([48, 52.25, DROP_CROSSING]);
  expect(back.stretches[0]!.drops![1]).toBeNull();
  expect(back.stretches[1]!.drops).toBeUndefined();
  expect(Array.from(back.corners[1]!.drops!)).toEqual([4, 5.5, DROP_RAMP]);
  // A part of the version before reads as one with no drops.
  const old = encodeStreets({ ...part, stretches: part.stretches.map(({ drops: _, ...s }) => s), corners: part.corners.map(({ drops: _, ...c }) => c) });
  const before = new Uint8Array(old.length - 3 * 2 - 2);
  // Version 1's bytes: its version, and each kerb and corner without its count of drops.
  let from = 0, to = 0;
  const copy = (n: number): void => { before.set(old.subarray(from, from + n), to); from += n; to += n; };
  copy(5);
  before[0] = 1;
  for (const s of part.stretches) { copy(14 + (s.xz.length / 2 - 1) * 4 + 8); from += 2; }
  for (const _ of part.corners) { copy(23); from += 1; }
  const v1 = decodeStreets(before, 0, 0);
  expect(v1.stretches.length).toBe(3);
  expect(v1.stretches[0]!.drops).toBeUndefined();
  const lines = kerbLines(held(part), part);
  // The street's left kerb has its crossing where its run holds it; the corner into the drive is let down its whole length.
  const left = lines.find((l) => l.stretch === 0 && l.side === 0 && l.corner < 0 && l.stations[0]! < 50)!;
  expect(Array.from(left.drops!)).toEqual([48, 52.25, DROP_CROSSING]);
  const drive = lines.find((l) => l.corner === 0)!, ramp = lines.find((l) => l.corner === 1)!;
  expect(Array.from(drive.drops!)).toEqual([0, drive.stations[drive.stations.length - 1]!, DROP_DRIVE]);
  expect(Array.from(ramp.drops!)).toEqual([4, 5.5, DROP_RAMP]);
});

test("a road of two points across the map's edge has its kerbs, from the sector it crosses", () => {
  // Held is one sector, 0 to 1,024 m; the road runs from inside it to 76 m past its edge, its end point off the map.
  const part: StreetsPart = { x0: 0, z0: 0, stretches: [{ type: 0, flags: 0, seed: 1, sides: [side, side], xz: Float64Array.of(1000, 500, 1100, 500) }], corners: [] };
  const lines = kerbLines(held(part), part);
  expect(lines.filter((l) => l.stretch === 0).length).toBe(2);
  // Given once: by a part of a sector past the edge, were one held there, it is not.
  const far: StreetsPart = { ...part, x0: 1024 };
  const both = new StreetSectors();
  both.put(0, decodeStreets(encodeStreets(part), 0, 0), 0, 0, 16, 16);
  expect(kerbLines(both, decodeStreets(encodeStreets(far), 1024, 0)).length).toBe(0);
});

test("a road whose centre line runs just past a cut's edge has the kerb that lies in the cut, as the whole map has it, each kerb once", () => {
  // A cut of one sector, 0 to 1,024 m. A road along x whose centre line is 1 m past its north edge, 5 m to each kerb: its
  // south kerb lies 4 m inside the cut, its north kerb 6 m past it. The road was asphalt inside the cut and had no kerb.
  const wide = heldSide(5, 0, 2, kindsByte(0, WALK, RAISED));
  const road = { type: 0, flags: 0, seed: 1, sides: [wide, wide] as const, xz: Float64Array.of(100, 1025, 900, 1025) };
  const south: StreetsPart = { x0: 0, z0: 0, stretches: [road], corners: [] }, north: StreetsPart = { x0: 0, z0: 1024, stretches: [road], corners: [] };
  const cut = new StreetSectors(), cutPart = decodeStreets(encodeStreets(south), 0, 0);
  cut.put(0, cutPart, 0, 0, 16, 16);
  const onLine = (l: { xz: Float64Array }): number => l.xz[1]!;
  expect(kerbLines(cut, cutPart).map(onLine)).toEqual([1020]);
  // The whole map, both sectors held: the south kerb given by the cut's sector, the north by the one past it, once each.
  const whole = new StreetSectors(), a = decodeStreets(encodeStreets(south), 0, 0), b = decodeStreets(encodeStreets(north), 0, 1024);
  whole.put(0, a, 0, 0, 16, 16);
  whole.put(1, b, 0, 16, 16, 32);
  expect([kerbLines(whole, a).map(onLine), kerbLines(whole, b).map(onLine)]).toEqual([[1020], [1030]]);
  // The cut's kerb is the whole map's to the point.
  expect(Array.from(kerbLines(cut, cutPart)[0]!.xz)).toEqual(Array.from(kerbLines(whole, a)[0]!.xz));
});

test("a map carries its streets' parts and gives them back, and its heightfield's wheels follow them", () => {
  // The fixture's south-east corner is at column 2040 and row 2050 of the lattice: its first sector's square, column 127
  // and row 128, begins 8 chunks west and 2 south of it, so its places are from (-512, -128).
  const base = wideMap();
  const bytes = encodeStreets({ ...along, x0: -512, z0: -128 });
  const map = { ...base, streets: [{ col: 127, row: 128, bytes }] };
  const back = parseMap(writeMap(map));
  expect(back.streets?.length).toBe(1);
  expect(back.streets![0]!.bytes).toEqual(bytes);
  const hf = mapHeightfield(back);
  expect(hf.streets).not.toBeNull();
  expect(hf.groundClassAt(200, 101)).toBe(GROUND_CLASS.ASPHALT);
  // A map with none is the map it was.
  expect(parseMap(writeMap(base)).streets).toBeUndefined();
  expect(CHUNK_SIZE).toBe(64);
});

test("the ground's cover from the streets: the band's tint, the one across its nearer edge, and half of it on the edge", () => {
  const finish = (t: number): number => surfaceIndex(t, true), out = new Float64Array(5);
  // Four samples of street, grass, sidewalk and open ground round a point a quarter of a metre past the kerb, in the verge.
  expect(streetCover(85, 197, 1, 101, 0.5, 0.5, [0.25, -1.25, -3.25], kindsByte(PLANTED, WALK, RAISED), 0.05, finish, out)).toBe(true);
  expect(out[0]).toBe(1);
  expect(out[1]).toBe(197);
  expect(out[2]).toBe(0);
  expect(out[3]).toBe(85);
  expect(out[4]).toBe(0);
  // On the kerb's line, half of each.
  streetCover(85, 197, 1, 101, 0.5, 0.5, [0, -1.5, -3.5], kindsByte(PLANTED, WALK, RAISED), 0.05, finish, out);
  expect(out[4]).toBeCloseTo(0.5, 6);
  // No verge: the walk meets the street at the kerb; past the walk, no sample's sidewalk or street tint is drawn.
  streetCover(85, 85, 1, 101, 0.5, 0.5, [0.5, 0.5, -1.5], kindsByte(0, WALK, RAISED), 0.05, finish, out);
  expect([out[0], out[1], out[2]]).toEqual([2, 1, 0]);
  streetCover(85, 1, 1, 101, 0.1, 0.1, [4, 4, 2], kindsByte(0, WALK, RAISED), 0.05, finish, out);
  expect(out[0]).toBe(3);
  expect(out[1]).toBe(101);
  // Past the walk with all four paved, a car park's asphalt: drawn as it is, not taken for the street's.
  streetCover(84, 84, 84, 84, 0.5, 0.5, [6, 6, 4], kindsByte(0, WALK, RAISED), 0.05, finish, out);
  expect([out[0], out[1]]).toEqual([3, 84]);
  // A footprint's tint among the four: the streets do not draw there.
  expect(streetCover(85, 104, 1, 101, 0.5, 0.5, [0.25, -1.25, -3.25], kindsByte(PLANTED, WALK, RAISED), 0.05, finish, out)).toBe(false);
});
