// Made heads (client/core/render/faces.ts): the shared head first, one make a frame, each tier's cap, the least lately
// drawn let go, nothing made or allocated on a steady frame, and every made vertex inside the hit head; and the hair and
// beard made with a head, which follow its face, its jaw and long hair's guides.

import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { AssetUpload } from "../../client/core/assets/residency.ts";
import { FACE_HEADS, Faces, rowsSkin, type FaceAssets } from "../../client/core/render/faces.ts";
import { B_HEAD, B_NECK, B_UPPER_CHEST, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { HAIR_ROW } from "../../client/core/render/hair-motion.ts";
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

/** Frames of `looks` until nothing is read, made or put on the card for five frames; every frame's result, in order. */
function settled(f: Faces, tier: string, looks: Uint8Array[], most = 2000): ReturnType<typeof frame>[] {
  const out: ReturnType<typeof frame>[] = [];
  for (let k = 0, quiet = 0; k < most; k++) {
    const r = frame(f, tier, looks);
    out.push(r);
    quiet = !f.busy && r.uploads.length === 0 ? quiet + 1 : 0;
    if (quiet >= 5) return out;
  }
  throw new Error("the faces never settled");
}

test("the shared head is made first, then one head at a time, nothing else made meanwhile", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const looks = [lookOf(1), lookOf(2), lookOf(3)];
  const frames = settled(f, "high", looks);
  // Each frame puts at most one head on the card, the shared head first and drawn by all until theirs comes.
  const made = frames.filter((r) => r.uploads.length > 0);
  expect(made.every((r) => r.uploads.length === 2)).toBe(true);
  expect(made.length).toBe(4);
  const shared = frames.find((r) => r.slots[0]! >= 0)!.slots[0]!;
  expect(frames.find((r) => r.slots[0]! >= 0)!.slots).toEqual([shared, shared, shared]);
  expect(f.makes).toBe(4);
  const done = frame(f, "high", looks);
  expect(new Set(done.slots).size).toBe(3);
  expect(done.slots).not.toContain(shared);
});

test("a neutral face draws the shared head and is never made", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  settled(f, "ultra", [defaultLook()]);
  for (let k = 0; k < 4; k++) expect(frame(f, "ultra", [defaultLook()]).uploads.length).toBe(0);
  expect(f.count).toBe(0);
});

test("each tier keeps no more unique heads than its cap", () => {
  for (const tier of ["lowpoly", "medium", "high", "ultra"] as const) {
    const f = new Faces(fakeAssets());
    f.register(MESH, REST);
    let most = 0;
    // A crowd of 40 own faces, a new one in front every so often, so old heads are let go.
    for (let k = 0; k < 2400; k++) {
      frame(f, tier, Array.from({ length: 40 }, (_, n) => lookOf((k >> 4) + n)));
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
  settled(f, "medium", kept);
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
  expect(f.busy).toBe(true);
});

test("a steady frame makes, uploads and allocates nothing", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const looks = Array.from({ length: 6 }, (_, n) => lookOf(n));
  settled(f, "high", looks);
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
  const made = settled(f, "high", [look]).flatMap((r) => r.uploads).findLast((u) => u.of === undefined);
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
  for (let k = 0; k < 200 && !f.ready(MESH); k++) frame(f, "high", []);
  expect(f.ready(MESH)).toBe(true);
  let uploads = 0;
  for (let k = 0; k < 200; k++) {
    f.head(MESH, many, LOOK_BYTES, ONES, 0, 0);
    uploads += frame(f, "high", []).uploads.length;
  }
  expect(uploads).toBe(2);
  expect(f.count).toBe(1);
});

test("a made head keeps its stored normals and tangents where the face barely moves it", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const look = defaultLook();
  setFace(look, 0, 1 / 127);
  const made = settled(f, "high", [look]).flatMap((r) => r.uploads).findLast((u) => u.of !== undefined)!;
  const { surface } = headLevel(), a = new DataView(surface.buffer), b = new DataView(made.data.buffer, made.data.byteOffset);
  const un = (w: number): number[] => [((w << 22) >> 22) / 511, ((w << 12) >> 22) / 511, ((w << 2) >> 22) / 511];
  for (let v = 0; v < N; v++) for (const at of [4, 8]) {
    const p = un(a.getUint32(v * SURFACE_BYTES + at, true)), q = un(b.getUint32(v * SURFACE_BYTES + at, true));
    expect(p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!).toBeGreaterThan(0.99);
    expect(b.getUint32(v * SURFACE_BYTES + at, true) >>> 30).toBe(a.getUint32(v * SURFACE_BYTES + at, true) >>> 30);
  }
});

const HAIR = 4, BEARD = 5;

/** A worn mesh of `points`, each on `bones` (one bone each, all its weight), in triangles (0, 1, 2), (1, 2, 3) and so on. */
function wornLevel(points: number[][], bones: number[]): { level: Uint8Array; surface: Uint8Array; count: number } {
  const n = points.length, indices: number[] = [];
  for (let k = 0; k + 2 < n; k++) indices.push(k, k + 1, k + 2);
  const vertexAt = (indices.length * 2 + 3) & ~3;
  const level = new Uint8Array(vertexAt + n * VERTEX_BYTES), view = new DataView(level.buffer);
  indices.forEach((i, k) => view.setUint16(k * 2, i, true));
  points.forEach((p, v) => {
    for (let c = 0; c < 3; c++) view.setInt16(vertexAt + v * VERTEX_BYTES + c * 2, Math.round(((p[c]! - CENTER[c]!) / HALF[c]!) * 32767), true);
    level[vertexAt + v * VERTEX_BYTES + 7] = bones[v]!;
  });
  const surface = new Uint8Array(n * (SURFACE_BYTES + SKIN_BYTES));
  bones.forEach((b, v) => {
    const at = n * SURFACE_BYTES + v * SKIN_BYTES;
    surface.fill(b, at, at + 4);
    surface[at + 4] = 255;
  });
  return { level, surface, count: indices.length };
}

/** The head's fan vertex `v` at rest. */
const fanPoint = (v: number): number[] => {
  const a = (v / (N - 1)) * Math.PI;
  return [CENTER[0]! + 0.08 * Math.cos(a), CENTER[1]! + 0.08 * Math.sin(a) - 0.04, CENTER[2]!];
};

/** The fake head, with hair: two points 1 and 2 mm over fan vertices 1 and 4, one far off it, one hanging behind on the upper chest; and a beard over 1 and 2. */
function wornAssets(): ReturnType<typeof fakeAssets> {
  const a = fakeAssets();
  const hair = wornLevel([fanPoint(1).map((x, c) => x + (c === 2 ? 0.001 : 0)), fanPoint(4).map((x, c) => x + (c === 2 ? 0.002 : 0)), [CENTER[0]!, CENTER[1]! + 0.19, CENTER[2]!], [HEAD[0]!, HEAD[1]! - 0.1, HEAD[2]! - 0.08]], [B_HEAD, B_HEAD, B_HEAD, B_UPPER_CHEST]);
  const beard = wornLevel([fanPoint(1).map((x, c) => x + (c === 2 ? 0.001 : 0)), fanPoint(2).map((x, c) => x + (c === 2 ? 0.001 : 0)), [CENTER[0]!, CENTER[1]! + 0.19, CENTER[2]!]], [B_HEAD, B_HEAD, B_HEAD]);
  const kept = a.keptBytes;
  return {
    ...a,
    keptBytes: (m, l) => (m === HAIR ? { level: inside(hair.level), surface: inside(hair.surface), indexCount: hair.count, indexBytes: 2, skinAt: 4 * SURFACE_BYTES } : m === BEARD ? { level: inside(beard.level), surface: inside(beard.surface), indexCount: beard.count, indexBytes: 2, skinAt: 3 * SURFACE_BYTES } : kept(m, l)),
  };
}

/** Points of an upload's level, decoded within its bounds. */
function pointsOf(u: AssetUpload, n: number): number[][] {
  const vertexAt = (u.indexCount * 2 + 3) & ~3, box = u.bounds ?? { center: CENTER, half: HALF }, view = new DataView(u.data.buffer, u.data.byteOffset);
  return Array.from({ length: n }, (_, v) => [0, 1, 2].map((c) => box.center[c]! + (view.getInt16(vertexAt + v * VERTEX_BYTES + c * 2, true) / 32767) * box.half[c]!));
}

/** Frames enough for the head, hair and beard to be read, their shared meshes made and `look`'s head; every upload, in order. */
function wornFrames(f: Faces, look: Uint8Array, hair = HAIR, beard = BEARD): AssetUpload[] {
  const uploads: AssetUpload[] = [];
  for (let k = 0; k < 200; k++) {
    f.begin(tierOf("high"), uploads, []);
    f.groomed(hair);
    if (f.ready(MESH)) f.head(MESH, look, 0, ONES, 0, 0, hair, beard);
  }
  return uploads;
}

test("hair near the skin moves as the face moves it; hair far off stays", () => {
  const f = new Faces(wornAssets());
  f.register(MESH, REST);
  f.wear(MESH, HAIR, false);
  f.wear(MESH, BEARD, true);
  const look = lookOf(40);
  const uploads = wornFrames(f, look);
  const head = uploads.findLast((u) => u.mesh === MESH && u.of === undefined)!, hair = uploads.findLast((u) => u.mesh === HAIR && u.of === undefined)!;
  expect(head.slot + 2).toBe(hair.slot);
  const skin = pointsOf(head, N), worn = pointsOf(hair, 4);
  for (const [w, v, lift] of [[0, 1, 0.001], [1, 4, 0.002]] as const) {
    const moved = skin[v]!.map((x, c) => x - fanPoint(v)[c]!);
    expect(Math.hypot(...moved)).toBeGreaterThan(0.005);
    for (let c = 0; c < 3; c++) expect(worn[w]![c]!).toBeCloseTo(fanPoint(v)[c]! + (c === 2 ? lift : 0) + moved[c]!, 3);
  }
  expect(worn[2]![1]!).toBeCloseTo(CENTER[1]! + 0.19, 3);
  // Drawn: the made head's hair and beard slots follow its own.
  const drawn = f.head(MESH, look, 0, ONES, 0, 0, HAIR, BEARD);
  expect([drawn.hair, drawn.beard]).toEqual([drawn.slot + 2, drawn.slot + 4]);
});

test("hair hanging on the upper chest takes the guide rows; a beard the jaw's", () => {
  const f = new Faces(wornAssets());
  f.register(MESH, REST);
  f.wear(MESH, HAIR, false);
  f.wear(MESH, BEARD, true);
  wornFrames(f, defaultLook());
  expect(f.groomed(HAIR)).toBe(true);
  expect(f.groomed(BEARD)).toBe(false);
  // A neutral face draws the shared head with shared hair and beard of their own, as both read rows.
  const drawn = f.head(MESH, defaultLook(), 0, ONES, 0, 0, HAIR, BEARD);
  expect(drawn.hair).toBeGreaterThan(0);
  expect(drawn.beard).toBeGreaterThan(0);
  const g = new Faces(wornAssets());
  g.register(MESH, REST);
  g.wear(MESH, HAIR, false);
  g.wear(MESH, BEARD, true);
  const uploads = wornFrames(g, defaultLook());
  const weight = (u: AssetUpload, n: number, v: number, bone: number): number => [0, 1, 2, 3].reduce((s, k) => s + (u.data[n * SURFACE_BYTES + v * SKIN_BYTES + k] === bone ? u.data[n * SURFACE_BYTES + v * SKIN_BYTES + 4 + k]! : 0), 0);
  const hairSkin = uploads.find((u) => u.mesh === HAIR && u.of !== undefined)!, beardSkin = uploads.find((u) => u.mesh === BEARD && u.of !== undefined)!;
  // Straight behind the head it hangs between the guides at 150 and 210 degrees.
  expect(weight(hairSkin, 4, 3, HAIR_ROW + 1) + weight(hairSkin, 4, 3, HAIR_ROW + 2)).toBe(255);
  expect(Math.abs(weight(hairSkin, 4, 3, HAIR_ROW + 1) - weight(hairSkin, 4, 3, HAIR_ROW + 2))).toBeLessThanOrEqual(1);
  expect(weight(hairSkin, 4, 0, B_HEAD)).toBe(255);
  // Over the skin the jaw row takes all of, and half of, it takes the same.
  expect(weight(beardSkin, 3, 0, HUMAN_BONES + FACE_JAW)).toBe(255);
  expect(Math.abs(weight(beardSkin, 3, 1, HUMAN_BONES + FACE_JAW) - 128)).toBeLessThanOrEqual(1);
  expect(weight(beardSkin, 3, 2, B_HEAD)).toBe(255);
});

test("a refused head lets go at once, is made again after a wait, and keeps its bytes counted", () => {
  const f = new Faces(fakeAssets());
  f.register(MESH, REST);
  const look = lookOf(9);
  settled(f, "high", [look]);
  const made = frame(f, "high", [look]).slots[0]!, shared = f.head(MESH, defaultLook(), 0, ONES, 0, 0).slot;
  expect(made).not.toBe(shared);
  const bytes = f.bytes;
  expect(f.refused(made + 1)).toBe(true);
  expect(f.refused(5)).toBe(false);
  expect(Number.isFinite(f.bytes) && f.bytes < bytes).toBe(true);
  // The next frame lets its slots go and draws the shared head; none is made while it waits.
  const next = frame(f, "high", [look]);
  expect(next.drops.sort()).toEqual([made, made + 1]);
  expect(next.slots[0]).toBe(shared);
  let back = -1;
  for (let k = 0; k < 400 && back < 0; k++) {
    const { uploads, slots } = frame(f, "high", [look]);
    if (uploads.length > 0) back = k;
    else expect(slots[0]).toBe(shared);
    if (k < 100) expect(f.busy).toBe(false);
  }
  expect(back).toBeGreaterThan(100);
  expect(frame(f, "high", [look]).slots[0]).not.toBe(shared);
  // Refused again and again, it stops making heads and draws the pack's.
  for (let k = 0; k < 5; k++) f.refused(shared);
  for (let k = 0; k < 2000; k++) frame(f, "high", [look]);
  expect(f.ready(MESH)).toBe(false);
  expect(Number.isFinite(f.bytes)).toBe(true);
});

test("a body is short of its look until its own head, hair and beard are drawn", () => {
  const f = new Faces(wornAssets());
  f.register(MESH, REST);
  f.wear(MESH, HAIR, false);
  f.wear(MESH, BEARD, true);
  const look = lookOf(7);
  let shared = -1, frames = 0;
  for (; frames < 400; frames++) {
    f.begin(tierOf("high"), [], []);
    f.groomed(HAIR);
    const drawn = f.ready(MESH) ? f.head(MESH, look, 0, ONES, 0, 0, HAIR, BEARD) : null;
    if (drawn && shared < 0) shared = drawn.slot;
    // Drawn whole only on its own head with the hair and beard made on it.
    const whole = drawn !== null && drawn.slot !== shared && drawn.hair === drawn.slot + 2 && drawn.beard === drawn.slot + 4;
    expect(f.short, `frame ${frames}`).toBe(whole ? 0 : 1);
    if (whole) break;
  }
  expect(frames).toBeGreaterThan(2);
  expect(frames).toBeLessThan(400);
  // A neutral face is whole on the shared head once its hair and beard are.
  f.begin(tierOf("high"), [], []);
  f.head(MESH, defaultLook(), 0, ONES, 0, 0, HAIR, BEARD);
  expect(f.short).toBe(0);
  // A tier that makes no heads is never short of one.
  f.begin(tierOf("lowpoly"), [], []);
  f.head(MESH, lookOf(9), 0, ONES, 0, 0, HAIR, BEARD);
  expect(f.short).toBe(0);
});
