// Made heads (client/core/render/faces.ts): the shared head first, one make a frame, each tier's cap, the least lately
// drawn let go, nothing made or allocated on a steady frame, and every made vertex inside the hit head.

import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { AssetUpload } from "../../client/core/assets/residency.ts";
import { FACE_HEADS, Faces, rowsSkin, type FaceAssets } from "../../client/core/render/faces.ts";
import { B_HEAD, B_NECK, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { FACE_COUNT, LOOK_BYTES, LOOK_FACE, defaultLook, setFace } from "../../shared/anim/look.ts";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { allowed, axisDistanceAt, encodeFaces, FACE_EYE_L, FACE_JAW, FACE_PIVOTS, headBound, type FaceTable } from "../../shared/people/faces.ts";

const MESH = 3;
const REST = Float32Array.from(HUMAN.rest);
const HEAD = [REST[B_HEAD * 3]!, REST[B_HEAD * 3 + 1]!, REST[B_HEAD * 3 + 2]!];
/** A small head: a fan of triangles round a point in front of the head's joint. */
const N = 9;
const CENTER = [HEAD[0]!, HEAD[1]! + 0.08, HEAD[2]! + 0.05];
const HALF = [0.2, 0.2, 0.2];

function headLevel(): { level: Uint8Array; surface: Uint8Array; indices: number[] } {
  const indices: number[] = [];
  for (let k = 1; k < N - 1; k++) indices.push(0, k, k + 1);
  const vertexAt = (indices.length * 2 + 3) & ~3;
  const level = new Uint8Array(vertexAt + N * VERTEX_BYTES), view = new DataView(level.buffer);
  indices.forEach((i, k) => view.setUint16(k * 2, i, true));
  for (let v = 0; v < N; v++) {
    const a = (v / (N - 1)) * Math.PI;
    const p = v === 0 ? [CENTER[0]!, CENTER[1]!, CENTER[2]! + 0.04] : [CENTER[0]! + 0.08 * Math.cos(a), CENTER[1]! + 0.08 * Math.sin(a) - 0.04, CENTER[2]!];
    for (let c = 0; c < 3; c++) view.setInt16(vertexAt + v * VERTEX_BYTES + c * 2, Math.round(((p[c]! - CENTER[c]!) / HALF[c]!) * 32767), true);
    level[vertexAt + v * VERTEX_BYTES + 7] = v === N - 1 ? B_NECK : B_HEAD;
  }
  const surface = new Uint8Array(N * (SURFACE_BYTES + SKIN_BYTES)), sv = new DataView(surface.buffer);
  for (let v = 0; v < N; v++) {
    sv.setUint32(v * SURFACE_BYTES + 4, (511 << 20) >>> 0, true);
    sv.setUint32(v * SURFACE_BYTES + 8, (511 | (1 << 30)) >>> 0, true);
    const at = N * SURFACE_BYTES + v * SKIN_BYTES;
    surface.fill(v === N - 1 ? B_NECK : B_HEAD, at, at + 4);
    surface[at + 4] = 255;
  }
  return { level, surface, indices };
}

/** Each modifier pushes every vertex out along +Z by 5 cm a side, so any two together leave the bound. */
function table(): FaceTable {
  const vertices = Uint32Array.from({ length: N - 1 }, (_, v) => v);
  const side = (dz: number) => ({ vertices, deltas: Float32Array.from({ length: (N - 1) * 3 }, (_, i) => (i % 3 === 2 ? dz : 0)) });
  return {
    vertexCount: N,
    modifiers: Array.from({ length: FACE_COUNT }, () => ({ minus: side(-0.05), plus: side(0.05) })),
    rows: { vertices: Uint32Array.of(1, 2, 3), row: Uint8Array.of(FACE_JAW, FACE_JAW, FACE_EYE_L), share: Float32Array.of(1, 0.5, 1) },
    pivots: new Float32Array(FACE_PIVOTS * 3),
    pivotMoves: new Float32Array(FACE_COUNT * 2 * FACE_PIVOTS * 3),
  };
}

/** The bytes inside a larger buffer, as a port's arrivals may be: a Buffer, whose slice is a view. */
function inside(bytes: Uint8Array): Uint8Array {
  const big = new Uint8Array(bytes.length + 20);
  big.set(bytes, 12);
  return Buffer.from(big.buffer, 12, bytes.length);
}

function fakeAssets(): FaceAssets & { spent: number; reserved: number } {
  const made = headLevel(), level = inside(made.level), surface = inside(made.surface), indices = made.indices;
  const blob = encodeFaces(table());
  return {
    spent: 0, reserved: 0,
    facesOf: (m) => m === MESH,
    wantFaces: () => {},
    faces: (m) => (m === MESH ? blob : null),
    keepBytes: () => {},
    keptBytes: (m) => (m === MESH ? { level, surface, indexCount: indices.length, indexBytes: 2, skinAt: N * SURFACE_BYTES } : null),
    bounds: () => ({ center: CENTER, half: HALF }),
    spend(b) { this.spent += b; },
    reserve(_, b) { this.reserved = b; },
  };
}

/** A look whose face bytes are all `n / 127`, its own for each n. */
function lookOf(n: number): Uint8Array {
  const look = defaultLook();
  for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, ((n % 120) + 1) / 127);
  return look;
}

const ONES = new Float32Array(3).fill(1);

/** A frame: the faces' begin, then each look asked for in rank order. Returns the uploads and drops it made. */
function frame(f: Faces, tier: string, looks: Uint8Array[]): { uploads: AssetUpload[]; drops: number[]; slots: number[] } {
  const uploads: AssetUpload[] = [], drops: number[] = [];
  f.begin(tierOf(tier), uploads, drops);
  const slots = looks.map((look, rank) => (f.ready(MESH) ? f.head(MESH, look, 0, ONES, 0, rank).slot : -1));
  return { uploads, drops, slots };
}

test("the shared head is made first, then one head a frame", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const looks = [lookOf(1), lookOf(2), lookOf(3)];
  // The first frame asks for the table and the level; the next reads them, a make of its own.
  expect(frame(f, "high", looks).slots).toEqual([-1, -1, -1]);
  const read = frame(f, "high", looks);
  expect(read.uploads.length + read.slots.filter((s) => s >= 0).length).toBe(0);
  const second = frame(f, "high", looks);
  expect(second.uploads.length).toBe(2);
  const shared = second.slots[0]!;
  expect(second.slots).toEqual([shared, shared, shared]);
  for (let k = 0; k < 3; k++) {
    const { uploads } = frame(f, "high", looks);
    expect(uploads.length).toBe(2);
    expect(f.makes).toBe(2 + k);
  }
  const done = frame(f, "high", looks);
  expect(done.uploads.length).toBe(0);
  expect(new Set(done.slots).size).toBe(3);
  expect(done.slots).not.toContain(shared);
});

test("a neutral face draws the shared head and is never made", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  for (let k = 0; k < 3; k++) frame(f, "ultra", [defaultLook()]);
  for (let k = 0; k < 4; k++) expect(frame(f, "ultra", [defaultLook()]).uploads.length).toBe(0);
  expect(f.count).toBe(0);
});

test("each tier keeps no more unique heads than its cap", () => {
  for (const tier of ["lowpoly", "medium", "high", "ultra"] as const) {
    const f = new Faces(fakeAssets());
    f.register(MESH, REST);
    let most = 0;
    // A crowd of 40 own faces, a new one in front each frame, so old heads are let go.
    for (let k = 0; k < 120; k++) {
      frame(f, tier, Array.from({ length: 40 }, (_, n) => lookOf(k + n)));
      most = Math.max(most, f.count);
    }
    expect(most).toBe(FACE_HEADS[tier]);
  }
});

test("a head drawn last frame is not let go to make another", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const cap = FACE_HEADS.medium;
  const kept = Array.from({ length: cap }, (_, n) => lookOf(n));
  for (let k = 0; k < cap + 3; k++) frame(f, "medium", kept);
  const slots = frame(f, "medium", kept).slots;
  // A nearer newcomer waits while every kept head is still drawn.
  for (let k = 0; k < 4; k++) {
    const { drops, slots: now } = frame(f, "medium", [lookOf(99), ...kept]);
    expect(drops).toEqual([]);
    expect(now.slice(1)).toEqual(slots);
  }
  // Once one is not drawn, it makes way for the newcomer.
  frame(f, "medium", [lookOf(99), ...kept.slice(1)]);
  const { drops } = frame(f, "medium", [lookOf(99), ...kept.slice(1)]);
  expect(drops.length).toBe(2);
});

test("a steady frame makes, uploads and allocates nothing", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const looks = Array.from({ length: 6 }, (_, n) => lookOf(n));
  for (let k = 0; k < 10; k++) frame(f, "high", looks);
  const uploads: AssetUpload[] = [], drops: number[] = [], tier = tierOf("high");
  const step = (): void => {
    f.begin(tier, uploads, drops);
    for (let n = 0; n < looks.length; n++) if (f.ready(MESH)) f.head(MESH, looks[n]!, 0, ONES, 0, n);
  };
  for (let k = 0; k < 200; k++) step();
  const makes = f.makes;
  Bun.gc(true);
  const before = heapStats().objectCount;
  for (let k = 0; k < 2000; k++) step();
  Bun.gc(true);
  expect(f.makes).toBe(makes);
  expect(uploads.length + drops.length).toBe(0);
  expect(heapStats().objectCount - before).toBeLessThan(50);
});

test("a made head keeps every vertex inside the hit head and its slack", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const look = defaultLook();
  for (let k = 0; k < FACE_COUNT; k++) look[LOOK_FACE + k] = 127;
  for (let k = 0; k < 3; k++) frame(f, "high", [look]);
  const made = frame(f, "high", [look]).uploads.find((u) => u.of === undefined);
  expect(made).toBeDefined();
  const bound = headBound(REST), { level } = headLevel();
  const vertexAt = (made!.indexCount * 2 + 3) & ~3;
  const box = made!.bounds ?? { center: CENTER, half: HALF };
  const view = new DataView(made!.data.buffer, made!.data.byteOffset), base = new DataView(level.buffer);
  for (let v = 0; v < N; v++) {
    const at = [0, 1, 2].map((c) => box.center[c]! + (view.getInt16(vertexAt + v * VERTEX_BYTES + c * 2, true) / 32767) * box.half[c]!);
    const was = [0, 1, 2].map((c) => CENTER[c]! + (base.getInt16(vertexAt + v * VERTEX_BYTES + c * 2, true) / 32767) * HALF[c]!);
    const q = at.map((x, c) => bound.drawn[c]! + x - bound.rig[c]!), q0 = was.map((x, c) => bound.drawn[c]! + x - bound.rig[c]!);
    // Thirty-two pushes of 5 cm would carry it 1.6 m out; held, it is no farther than it may be, to a step of the store.
    if (v < N - 1) expect(axisDistanceAt(bound, q[0]!, q[1]!, q[2]!)).toBeLessThanOrEqual(allowed(bound, axisDistanceAt(bound, q0[0]!, q0[1]!, q0[2]!)) + 1e-4);
  }
  expect(made!.data.length).toBe(level.length);
});

test("face rows take their share of the head's weight, the rest left to it", () => {
  const { level, surface, indices } = headLevel();
  const vertexAt = (indices.length * 2 + 3) & ~3;
  const skin = rowsSkin(table(), surface.subarray(N * SURFACE_BYTES), level, vertexAt, N);
  for (let v = 0; v < N; v++) {
    const w = [4, 5, 6, 7].reduce((s, k) => s + skin[v * SKIN_BYTES + k]!, 0);
    expect(w).toBe(255);
  }
  const rowWeight = (v: number, bone: number): number => [0, 1, 2, 3].reduce((s, k) => s + (skin[v * SKIN_BYTES + k] === bone ? skin[v * SKIN_BYTES + 4 + k]! : 0), 0);
  expect(rowWeight(1, HUMAN_BONES + FACE_JAW)).toBe(255);
  expect(rowWeight(2, HUMAN_BONES + FACE_JAW)).toBe(128);
  expect(rowWeight(2, B_HEAD)).toBe(127);
  expect(rowWeight(3, HUMAN_BONES + FACE_EYE_L)).toBe(255);
  // The vertex's own bone stays first.
  expect(skin[1 * SKIN_BYTES]).toBe(B_HEAD);
  expect(rowWeight(N - 1, B_NECK)).toBe(255);
});

test("look bytes are read where the look sits in a longer array", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const many = new Uint8Array(LOOK_BYTES * 3);
  many.set(defaultLook(), 0);
  many.set(lookOf(5), LOOK_BYTES);
  for (let k = 0; k < 3; k++) {
    frame(f, "high", []);
    f.ready(MESH);
  }
  frame(f, "high", []);
  expect(f.ready(MESH)).toBe(true);
  f.head(MESH, many, LOOK_BYTES, ONES, 0, 0);
  const { uploads } = frame(f, "high", []);
  expect(uploads.length).toBe(2);
});

test("a made head keeps its stored normals and tangents where the face barely moves it", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const look = defaultLook();
  setFace(look, 0, 1 / 127);
  for (let k = 0; k < 3; k++) frame(f, "high", [look]);
  const made = frame(f, "high", [look]).uploads.find((u) => u.of !== undefined)!;
  const { surface } = headLevel(), a = new DataView(surface.buffer), b = new DataView(made.data.buffer, made.data.byteOffset);
  const un = (w: number): number[] => [((w << 22) >> 22) / 511, ((w << 12) >> 22) / 511, ((w << 2) >> 22) / 511];
  for (let v = 0; v < N; v++) for (const at of [4, 8]) {
    const p = un(a.getUint32(v * SURFACE_BYTES + at, true)), q = un(b.getUint32(v * SURFACE_BYTES + at, true));
    expect(p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!).toBeGreaterThan(0.99);
    expect(b.getUint32(v * SURFACE_BYTES + at, true) >>> 30).toBe(a.getUint32(v * SURFACE_BYTES + at, true) >>> 30);
  }
});
