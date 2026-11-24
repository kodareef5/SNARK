// How a built piece is drawn (client/core/render/piece-fit.ts, piece-state.ts): where collision has it, at any yaw of its
// base and 30 or 60 degrees round in it; with its damage stage, which reaches the card as its own bytes; and before it
// is a row, where it will stand. The placing is measured by the rule the rasterizer shares with the vertex programs.

import { expect, test } from "bun:test";
import { forTouch, tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FLAT_MESH_VERTEX } from "../../client/core/render/glsl.ts";
import { DRAW_PIECE, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { FIT_CLASS_SHIFT, FIT_SIZE_SHIFT, FIT_SQUARE, FIT_TRIANGLE, FIT_WALL, FrameTable, PIECE_FIT_AT, PIECE_FIT_GLSL, PIECE_FIT_PLACE, PIECE_FRAMED, PIECE_FRAMES, PIECE_STAGE, PIECE_STATE_AT, PieceFit, pieceWord, plainYaw } from "../../client/core/render/piece-fit.ts";
import { stageOfHealth } from "../../client/core/render/piece-state.ts";
import { WEAR_SHADE } from "../../client/core/render/pieces.ts";
import { PROGRAMS } from "../../client/core/render/programs.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { DEPTH_VERTEX } from "../../client/core/render/shadowtext.ts";
import { PIECE_SPALL_TEXT, SURFACE_VERTEX } from "../../client/core/render/surface.ts";
import { SPALL_GLSL } from "../../client/core/render/world-surfaces.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { INSTANCE_BYTES, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { STAGE_CRACKED, STAGE_FAILING, STAGE_WHOLE, STAGE_WORN, stageOf } from "../../shared/world/breaking.ts";
import { Solid, partSolid } from "../../shared/world/convex.ts";
import { frame, frameAxes, frameOf } from "../../shared/world/frame.ts";
import { CLS_EDGE, CLS_SQUARE } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { boxBase } from "../../tools/bench/base.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { JointBench, SIDE, piecesPack } from "../../tools/pieces/joints.ts";
import { PICK_ENTITY, PICK_STRUCTURE } from "../../tools/snap/raster.ts";
import { Stage, squareMesh } from "../fixtures/stage.ts";
import { baseAt, batchesOf, drawn, layJunction, putAt, turnedBy, type Drawn } from "../fixtures/trims.ts";
import { Base, mixedHouse, row, turnedRegistry, turnedWorld } from "../fixtures/turned.ts";
import type { TestWorld } from "../fixtures/world.ts";

const O = [0, 0, 0, 0];
const solid = new Solid();
const axes = new Int32Array(4);

let gray: { pack: Pack; meshes: Map<string, SourceMesh> } | null = null;
/** The turned fixtures' kinds as the grey boxes and prisms of their colliders: a mesh's vertices are its collider's corners. */
function grayPack(): { pack: Pack; meshes: Map<string, SourceMesh> } {
  if (gray) return gray;
  const pack = parsePack(buildPack(grayboxMeshes(turnedRegistry().defs.flatMap((d) => (d ? [d] : []))), defaultPalette()));
  return (gray = { pack, meshes: new Map(unpackMeshes(pack).map((m) => [m.id, m] as const)) });
}

function sceneOf(w: TestWorld, reg: Registry = turnedRegistry()): { scene: Scene; cam: Camera; frame: () => FramePacket } {
  const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, reg, grayPack().pack);
  scene.assets.tier = { ...tierOf("lowpoly"), split: 0 };
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [128, 12, 150, Math.PI, -0.4];
  return { scene, cam, frame: () => scene.build(cam, null) };
}

/** Where a row's collider has its corners, in metres: its boxes' by the frame collision turns them by, its convex parts' as placed. */
function colliderCorners(w: TestWorld, ref: number): [number, number][] {
  const t = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!, parts = w.reg.parts, out: [number, number][] = [];
  frameOf(t.yaw[s]!, t.twAt(s));
  const { cos, sin, stretch } = frame;
  for (let p = parts.start[kind]! * 6; p < parts.start[kind + 1]! * 6; p += 6) {
    for (let k = 0; k < 4; k++) {
      const lx = parts.box[p]! + (k & 1 ? 1 : -1) * parts.box[p + 3]!, lz = parts.box[p + 2]! + (k & 2 ? 1 : -1) * parts.box[p + 5]!;
      out.push([t.x[s]! + (cos * lx + sin * lz) * stretch, t.z[s]! + (-sin * lx + cos * lz) * stretch]);
    }
  }
  const hulls = parts.hulls!;
  for (let p = hulls.start[kind]!; p < hulls.start[kind + 1]!; p++) {
    partSolid(hulls, p, t.yaw[s]!, t.twAt(s), t.x[s]!, t.y[s]!, t.z[s]!, solid);
    for (let c = 0; c < solid.corners; c++) out.push([solid.at[c * 3]!, solid.at[c * 3 + 2]!]);
  }
  return out;
}

/** The farthest any drawn vertex of `d` lies from the nearest corner of its row's collider, in plan, in metres. */
function strays(w: TestWorld, d: Drawn): number {
  const want = colliderCorners(w, d.ref);
  let worst = 0;
  for (let v = 0; v < d.points.length; v += 3) worst = Math.max(worst, Math.min(...want.map(([x, z]) => Math.hypot(d.points[v]! - x, d.points[v + 2]! - z))));
  return worst;
}

/** Yaws of a base: 17 degrees, spread over the quarter and through each quarter turn, and the two whose vectors are furthest from true. */
function oddYaws(): number[] {
  const yaws = [turnedBy(3095).yaw, 1, 5461, 8191, 12345, 16383, 20001, 40000, 61234];
  let short = 0, long = 0;
  const length = (yaw: number): number => (frameAxes(yaw, axes), Math.hypot(axes[0]!, axes[1]!));
  for (let within = 0; within < 16384; within++) {
    if (length(within) < length(short)) short = within;
    if (length(within) > length(long)) long = within;
  }
  return [...yaws, short, long];
}

test("a base at an odd yaw is drawn where it is collided: a mixed house of all three turn classes to a ten-thousandth of a metre", () => {
  const { pack, meshes } = grayPack();
  let worst = 0, plain = 0, pieces = 0;
  const classes = new Set<number>();
  for (const yaw of oddYaws()) {
    const w = turnedWorld(4);
    const b = new Base(w, 128, 128, yaw);
    const house = mixedHouse(b);
    row(new Base(w, 100, 100, yaw), 1, 3);
    const { scene, frame } = sceneOf(w);
    frame();
    for (const d of drawn(scene, w.dims, pack, meshes)) {
      const t = w.structs.chunks[Math.floor(d.ref / 65536)]!, s = d.ref & 0xffff;
      classes.add(t.twAt(s));
      expect(d.bytes[PIECE_STATE_AT]! & PIECE_FRAMED, "every piece has its basis").toBe(PIECE_FRAMED);
      worst = Math.max(worst, strays(w, d));
      // The same vertices turned by the yaw alone, as they were drawn: off by the vectors' stretch.
      const a = (t.yaw[s]! / 65536) * Math.PI * 2 - (t.twAt(s) * Math.PI) / 6, lod = meshes.get(d.id)!.lods[0]!, want = colliderCorners(w, d.ref);
      for (let v = 0; v < lod.positions.length; v += 3) {
        const [x, z] = [t.x[s]! + Math.cos(a) * lod.positions[v]! + Math.sin(a) * lod.positions[v + 2]!, t.z[s]! - Math.sin(a) * lod.positions[v]! + Math.cos(a) * lod.positions[v + 2]!];
        plain = Math.max(plain, Math.min(...want.map(([cx, cz]) => Math.hypot(x - cx, z - cz))));
      }
      pieces++;
    }
    expect(house.refs.length).toBe(17);
  }
  expect([...classes].sort()).toEqual([0, 1, 2]);
  expect(pieces).toBe(oddYaws().length * 23);
  // Drawn by its yaw alone a corner was up to 3 mm from its collider's; by its base's vectors, a float's rounding.
  expect(plain).toBeGreaterThan(0.002);
  expect(worst).toBeLessThan(1e-4);
  if (process.env.SNARK_DRAW_TABLE) console.log(`drawn to collided, worst over ${pieces} pieces at ${oddYaws().length} yaws: ${worst.toExponential(2)} m; by yaw alone ${plain.toExponential(2)} m`);
});

test("a piece's instance holds its basis slot and direction, its state and its fit", () => {
  const w = turnedWorld(4);
  const b = new Base(w, 128, 128, 3095);
  const made = row(b, 0, 1);
  const side = putAt(w.structs, w.reg, b.f, "core:wall_stone", CLS_EDGE, O, 3, 0);
  const slant = putAt(w.structs, w.reg, b.f, "core:wall_stone", CLS_EDGE, O, 8, 0);
  const { scene, frame } = sceneOf(w);
  const p = frame();
  const all = drawn(scene, w.dims, grayPack().pack, grayPack().meshes);
  const word = (ref: number): number => {
    const d = all.find((q) => q.ref === ref)!;
    return d.bytes[12]! | (d.bytes[13]! << 8);
  };
  const of = (ref: number): Drawn => all.find((q) => q.ref === ref)!;
  // One base, so one slot: each word is the piece's own +X among the base's twelve directions.
  expect([word(made.walls[0]![0]), word(side), word(slant)]).toEqual([0, 3, 8]);
  expect([of(made.walls[0]![0]), of(side), of(made.floors[0]![0])].map((d) => d.bytes[PIECE_FIT_AT]! >> FIT_CLASS_SHIFT)).toEqual([FIT_WALL, FIT_WALL, FIT_SQUARE]);
  expect(all.every((d) => (d.bytes[PIECE_STATE_AT]! & PIECE_FRAMED) !== 0)).toBe(true);
  // Its draws say so, and are given the chunk's table: the base's three axes, a half-side long as collision has them.
  const draws = Array.from({ length: p.drawCount }, (_, d) => d).filter((d) => (p.drawFlags[d]! & DRAW_PIECE) !== 0);
  expect(draws.length).toBeGreaterThan(0);
  const table = p.frameTables.get(p.drawBuffer[draws[0]!]!)!;
  frameAxes(3095, axes);
  expect([table.count, table.axes[0], table.axes[1]]).toEqual([1, Math.fround(axes[0]! / 768), Math.fround(axes[1]! / 768)]);
});

test("a chunk's table holds its eight most used bases, and a piece of any other is drawn by the yaw nearest its turn", () => {
  const w = turnedWorld(4);
  const refs: number[] = [];
  // Nine bases in one chunk, each at a yaw of its own: the first has two pieces, the rest three.
  for (let k = 0; k < PIECE_FRAMES + 1; k++) {
    const f = baseAt(w.structs, 70 + (k % 3) * 16, 0.375, 70 + Math.floor(k / 3) * 16, 1000 + k * 777);
    refs.push(putAt(w.structs, w.reg, f, "core:foundation_stone", CLS_SQUARE, O, 0, 0), putAt(w.structs, w.reg, f, "core:wall_stone", CLS_EDGE, O, 1, 0));
    if (k > 0) putAt(w.structs, w.reg, f, "core:wall_stone", CLS_EDGE, O, 3, 0);
  }
  expect(new Set(refs.map((r) => Math.floor(r / 65536))).size).toBe(1);
  const { scene, frame } = sceneOf(w);
  frame();
  const all = drawn(scene, w.dims, grayPack().pack, grayPack().meshes);
  const t = w.structs.chunks[Math.floor(refs[0]! / 65536)]!;
  const framed = all.filter((d) => (d.bytes[PIECE_STATE_AT]! & PIECE_FRAMED) !== 0);
  const out = all.filter((d) => (d.bytes[PIECE_STATE_AT]! & PIECE_FRAMED) === 0);
  // The base with the fewest pieces is the one left out. Its wall is 30 degrees round, and takes the yaw a twelfth of a turn on.
  expect([all.length, framed.length, out.map((d) => d.ref).sort()]).toEqual([26, 24, [refs[0]!, refs[1]!].sort()]);
  for (const d of out) {
    const s = d.ref & 0xffff;
    expect(d.bytes[12]! | (d.bytes[13]! << 8)).toBe(plainYaw(t.yaw[s]!, t.twAt(s)));
    // By its yaw it is still within the stretch of where it is collided: millimetres, as every piece was.
    expect(strays(w, d)).toBeLessThan(0.006);
  }
  expect(out.map((d) => t.twAt(d.ref & 0xffff)).sort()).toEqual([0, 1]);
  for (const d of framed) expect(strays(w, d)).toBeLessThan(1e-4);
});

test("a base at 17 degrees shows through nowhere at its corners", () => {
  const turn = turnedBy(3095);
  const cases: [string, [number, boolean][]][] = [["walls 90", [[0, false], [90, true]]], ["tee", [[0, false], [180, true], [90, true]]], ["cross", [[0, false], [90, true], [180, true], [270, false]]], ["walls 120", [[0, false], [120, true]]]];
  const laid: ReturnType<typeof layJunction>[] = [];
  const bench = new JointBench(piecesPack([]), [], SIDE, (structs, reg) => {
    cases.forEach(([name, ends], k) => {
      const [vx, vz] = [64 + k * 32, 64];
      laid.push(layJunction(structs, reg, baseAt(structs, vx, 0, vz, turn.yaw), name, vx, vz, turn.degrees, ends.map(([way, left]) => ({ form: "wall", tier: "metal", way, left }))));
    });
  });
  expect(laid.map((j) => bench.measure(j).leak)).toEqual([0, 0, 0, 0]);
});

test("the rule cuts a trim to its height, and pulls a triangle's side straight in or along the side beside it", () => {
  const fit = new PieceFit();
  const data = new Uint8Array(INSTANCE_BYTES);
  const at = (byte: number, x: number, y: number, z: number): number[] => {
    data[PIECE_FIT_AT] = byte;
    fit.begin(undefined, data, 0);
    fit.vertex(x, y, z);
    return [fit.x, fit.y, fit.z].map((v) => Math.round(v * 1e4) / 1e4);
  };
  // A joint of a half wall: its top two quarter storeys up and a centimetre.
  expect([at(2, 0.1, 3.01, 0.1), at(2, 0.1, 1, 0.1), at(0, 0.1, 3.01, 0.1)]).toEqual([[0.1, 1.51, 0.1], [0.1, 1, 0.1], [0.1, 3.01, 0.1]]);
  // A wall two edges long gives way 0.10 m from each of its ends, 3 m from its middle.
  const wide = (FIT_WALL << FIT_CLASS_SHIFT) | (1 << FIT_SIZE_SHIFT);
  expect([at(wide | 3, -3.05, 1, 0)[0], at(wide | 3, 3, 1, 0)[0], at(wide | 1, 3, 1, 0)[0]]).toEqual([-2.9, 2.9, 3]);
  // A triangle whose side along its first axis yields: its middle straight in, its first corner along the side it is also on.
  const tri = FIT_TRIANGLE << FIT_CLASS_SHIFT, third = Math.round((0.1 / Math.sqrt(3)) * 1e4) / 1e4;
  expect([at(tri | 4, 1.5, 0, 0), at(tri | 4, 0, 0, 0), at(tri | 4, 1.5, 0, 1)]).toEqual([[1.5, 0, 0.1], [third, 0, 0.1], [1.5, 0, 1]]);
  // Both sides at that corner: it goes to where the two rings cross.
  expect(at(tri | 5, 0, 0, 0)).toEqual([Math.round((0.15 / Math.cos(Math.PI / 6)) * 1e4) / 1e4, 0, 0.1]);
});

test("the three rigid vertex texts place a piece by the one rule", () => {
  for (const text of [FLAT_MESH_VERTEX, SURFACE_VERTEX, DEPTH_VERTEX]) {
    expect(text).toContain(PIECE_FIT_GLSL);
    expect(text).toContain(PIECE_FIT_PLACE);
    // The rule is called once the yaw's sine and cosine are in hand and before they turn the vertex.
    expect(text.indexOf(PIECE_FIT_PLACE)).toBeGreaterThan(text.indexOf("float s = sin("));
  }
});

test("a piece's stage is by the cuts a map piece's is, and only an owned piece shows one", () => {
  const reg = turnedRegistry();
  const kind = reg.index.get("core:wall_stone")!, max = reg.maxHp[kind]!;
  for (const share of [1, 0.67, 0.66, 0.34, 0.33, 0.17, 0.16, 0.01]) expect(stageOfHealth(max * share, max), `${share}`).toBe(stageOf(reg, kind, max * share));
  expect([1, 0.6, 0.3, 0.1].map((share) => stageOfHealth(max * share, max))).toEqual([STAGE_WHOLE, STAGE_WORN, STAGE_CRACKED, STAGE_FAILING]);
  const w = turnedWorld(4);
  const owned = w.structs.add(kind, 100, 1.5, 100, 0, 7, max * 0.3), unowned = w.structs.add(kind, 110, 1.5, 100, 0, 0, max * 0.3);
  const { scene, frame } = sceneOf(w);
  frame();
  const all = drawn(scene, w.dims, grayPack().pack, grayPack().meshes);
  expect([owned, unowned].map((ref) => all.find((d) => d.ref === ref)!.bytes[PIECE_STATE_AT]! & PIECE_STAGE)).toEqual([STAGE_CRACKED, 0]);
});

/** A chunk of 20,000 owned stone pieces at full health, and the scene that draws it. */
function siege(): { structs: StructureStore; scene: Scene; cam: Camera; chunk: number; reg: Registry } {
  let held: StructureStore | null = null;
  const bench = new JointBench(piecesPack([]), [], 64, (structs, reg) => {
    held = structs;
    for (const [kind, x, y, z, yaw] of boxBase(reg, "stone", 64 * 3 + 0.5, 0, 64 * 3 + 0.5, 21, 1, 20000)) structs.add(kind, x, y, z, yaw, 7, reg.maxHp[kind]!);
  });
  [bench.cam.x, bench.cam.y, bench.cam.z, bench.cam.yaw] = [64 * 3 + 32, 4, 64 * 4 + 30, Math.PI];
  return { structs: held!, scene: bench.scene, cam: bench.cam, chunk: 3 * 8 + 3, reg: bench.reg };
}

test("50 pieces of a 20,000-piece chunk crossing a stage send 20 bytes each, and a hit that crosses none sends nothing", () => {
  const { structs, scene, cam, chunk, reg } = siege();
  const t = structs.chunks[chunk]!;
  expect(t.live).toBe(20000);
  const of = (p: FramePacket) => p.uploads.filter((u) => u.buffer === chunk);
  expect(of(scene.build(cam, null)).map((u) => [u.data.length, u.bytes])).toEqual([[20000 * INSTANCE_BYTES, undefined]]);
  expect(of(scene.build(cam, null)).length).toBe(0);
  const batch = batchesOf(scene).get(chunk)!;
  const data = batch.data;
  // Fifty pieces through the chunk, each hit down to 60% of its health, which is worn.
  const hit = Array.from({ length: 50 }, (_, k) => 3 + k * 397);
  for (const slot of hit) structs.damage(chunk * 65536 + slot, reg.maxHp[t.kind[slot]!]! * 0.4);
  const sent = of(scene.build(cam, null));
  // What goes up is those instances and no more: 20 bytes each, of the 400,000 the card holds.
  expect(sent.reduce((sum, u) => sum + u.bytes!, 0)).toBe(50 * INSTANCE_BYTES);
  const instances = sent.flatMap((u) => Array.from({ length: u.bytes! / INSTANCE_BYTES }, (_, k) => u.from! / INSTANCE_BYTES + k));
  expect(instances.sort((a, b) => a - b)).toEqual(hit.map((slot) => batch.at[slot]!).sort((a, b) => a - b));
  // Nothing was laid out again: the buffer is the one the card was given, and each upload is of it.
  expect([batchesOf(scene).get(chunk)!.data === data, sent.every((u) => u.data === data)]).toEqual([true, true]);
  for (const slot of hit) expect(data[batch.at[slot]! * INSTANCE_BYTES + PIECE_STATE_AT]! & PIECE_STAGE).toBe(STAGE_WORN);
  // A hit inside a stage changes nothing drawn; a piece mended to full health is drawn whole again.
  for (const slot of hit) structs.damage(chunk * 65536 + slot, 1);
  expect(of(scene.build(cam, null)).length).toBe(0);
  structs.mend(chunk * 65536 + hit[0]!, reg.maxHp[t.kind[hit[0]!]!]!);
  expect(of(scene.build(cam, null)).map((u) => [u.from! / INSTANCE_BYTES, u.bytes])).toEqual([[batch.at[hit[0]!]!, INSTANCE_BYTES]]);
});

test("each stage draws a piece seven hundredths darker", () => {
  let ref = -1, held: StructureStore | null = null;
  const bench = new JointBench(piecesPack([]), [], SIDE, (structs, reg) => {
    held = structs;
    ref = putAt(structs, reg, baseAt(structs, 64, 0.375, 64, 0), "core:foundation_metal", CLS_SQUARE, O, 0, 0);
  });
  const structs = held!, max = bench.reg.maxHp[bench.reg.index.get("core:foundation_metal")!]!;
  // Low poly, whose light is the palette's colour times the sun's: straight down on the foundation's top, the same pixel each time.
  bench.scene.assets.tier = { ...tierOf("lowpoly"), split: 0 };
  [bench.cam.x, bench.cam.y, bench.cam.z, bench.cam.yaw, bench.cam.pitch] = [65.5, 6, 65.5, 0, -Math.PI / 2 + 0.001];
  const seen = (): number => {
    bench.raster.take(bench.scene.build(bench.cam, null));
    bench.raster.render(bench.scene.build(bench.cam, null));
    const at = Math.floor(bench.raster.height / 2) * bench.raster.width + Math.floor(bench.raster.width / 2);
    expect(bench.raster.pickKind[at]).toBe(PICK_STRUCTURE);
    return bench.raster.color[at * 4]! + bench.raster.color[at * 4 + 1]! + bench.raster.color[at * 4 + 2]!;
  };
  const light = [seen()];
  // Down to 60%, 30% and 10% of its health: worn, cracked, failing. Each reaches the picture as its instance's bytes.
  for (const share of [0.6, 0.3, 0.1]) {
    structs.mend(ref, max * share);
    light.push(seen());
  }
  for (let stage = 1; stage < 4; stage++) expect(Math.abs(light[stage]! / light[0]! - (1 - WEAR_SHADE * stage)), `stage ${stage}`).toBeLessThan(0.03);
});

test("a piece about to be built, and one set down and awaited, are drawn where their rows will be collided", () => {
  const w = turnedWorld(4);
  const b = new Base(w, 128, 128, 3095);
  const house = mixedHouse(b);
  const { scene, cam, frame } = sceneOf(w);
  const { meshes } = grayPack();
  // Each wall and floor of the house in turn as the ghost and as an awaited piece, at its row's own pose.
  let worst = 0, shown = 0;
  const classes = new Set<number>();
  for (const [ref] of [...house.walls, ...house.floors]) {
    const t = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff;
    const pose = { kind: t.kind[s]!, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: t.twAt(s) };
    Object.assign(scene.ghost, pose, { color: 9 });
    Object.assign(scene.predicted.pieces[0]!, pose, { fade: 0 });
    scene.predicted.predicted = 1;
    const p = frame();
    const table = p.frameTables.get(TRANSIENT_BUFFER)!;
    const want = colliderCorners(w, ref);
    const fit = new PieceFit();
    for (let d = 0; d < p.drawCount; d++) {
      if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_PIECE) === 0) continue;
      const at = p.drawFirst[d]! * INSTANCE_BYTES, view = new DataView(p.transient.buffer, p.transient.byteOffset + at, INSTANCE_BYTES);
      fit.begin(table, p.transient, at);
      const lod = meshes.get(w.reg.defs[pose.kind]!.id)!.lods[0]!;
      for (let v = 0; v < lod.positions.length; v += 3) {
        fit.vertex(lod.positions[v]!, lod.positions[v + 1]!, lod.positions[v + 2]!);
        const [x, z] = [cam.x + view.getFloat32(0, true) + fit.c * fit.x + fit.s * fit.z, cam.z + view.getFloat32(8, true) - fit.s * fit.x + fit.c * fit.z];
        worst = Math.max(worst, Math.min(...want.map(([cx, cz]) => Math.hypot(x - cx, z - cz))));
      }
      shown++;
    }
    classes.add(pose.tw);
  }
  expect([...classes].sort()).toEqual([0, 1, 2]);
  expect(shown).toBe((house.walls.length + house.floors.length) * 2);
  // The camera-relative place is a float's: a hundredth of a millimetre at this range.
  expect(worst).toBeLessThan(1e-4);
});

test("a framed instance's word is its slot and its own +X among the basis's twelve directions", () => {
  const table = new FrameTable();
  expect([table.add(1000), table.add(1000 + 16384), table.add(2000), table.slotOf(1000 + 3 * 16384), table.slotOf(3000)]).toEqual([0, 0, 1, 0, -1]);
  // A quarter turn more of yaw is three directions less; a turn class is one more.
  expect([pieceWord(0, 1000, 0), pieceWord(0, 1000 + 16384, 0), pieceWord(1, 2000 + 3 * 16384, 2), pieceWord(0, 1000, 1)]).toEqual([0, 9, 16 + 5, 1]);
  expect([plainYaw(1000, 0), plainYaw(6000, 1), plainYaw(100, 2)]).toEqual([1000, 6000 - 5461, 65536 + 100 - 10923]);
});

test("drawn with its materials a piece is darker a stage, and past worn it is lost to its core in patches where the tier reads the finishes in full", () => {
  // A square 3 m across with a base colour of one grey, drawn as a piece at each stage: unframed, so by its yaw.
  const pack = parsePack(buildPack([squareMesh("test:slab", 3, ["base"])], defaultPalette()));
  const stage = new Stage(pack, 96, 96);
  [stage.cam.x, stage.cam.y, stage.cam.z, stage.cam.yaw] = [0, 1.5, 2.2, Math.PI];
  stage.sun = [0, 0, 1];
  const full = tierOf("high"), phone = forTouch(tierOf("high"), true);
  const draw = (tier: typeof full, wear: number): number[] => {
    stage.begin();
    stage.packet.tier = tier;
    stage.texture(0, "base", [Uint8Array.from([150, 150, 150, 255])]);
    // Its last three regions are no colours: a material, its state, its fit.
    stage.add("test:slab", 0, { x: 0, y: 0, z: 0, flags: DRAW_PIECE, regions: [0, 0, 0, 0, wear, 0] });
    const px = stage.render();
    const seen: number[] = [];
    for (let i = 0; i < 96 * 96; i++) if (stage.raster.pickKind[i] === PICK_ENTITY) seen.push(px[i * 4]!);
    return seen;
  };
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
  const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
  expect([full.finish, phone.finish]).toEqual(["full", "light"]);
  for (const tier of [full, phone]) {
    const [whole, worn, failing] = [draw(tier, 0), draw(tier, 1), draw(tier, 3)];
    expect(whole.length).toBeGreaterThan(3000);
    // Whole and worn are one grey each, the worn the darker.
    expect([spread(whole) <= 2, spread(worn) <= 2, mean(worn) < mean(whole) - 2]).toEqual([true, true, true]);
    // Failing: darker again everywhere, and on the full finish in two greys, its own and its core's.
    expect(mean(failing)).toBeLessThan(mean(worn) - 2);
    expect(spread(failing) > 8).toBe(tier === full);
  }
  // The programs say the same: the mask's text is in the textured fragment where the finishes are read in full, and nowhere else.
  for (const [tier, has] of [[full, true], [phone, false], [tierOf("medium"), true]] as const) {
    const text = PROGRAMS.surface!(tier, "bc");
    expect([text.defines.includes("#define PIECE_SPALL\n"), text.fragment.includes(SPALL_GLSL), text.fragment.includes(PIECE_SPALL_TEXT)]).toEqual([has, has, false]);
  }
});
