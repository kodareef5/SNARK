// A built piece that falls or breaks leaves from where it stood (client/core/rubble.ts, fragments.ts): on its base's own
// vectors and at its turn class, by the rule its row was drawn by (render/piece-fit.ts). A removal names slots only, so
// the client reads the row's class before it empties the row.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { POSE, fragmentPose, type BreakSet, type Broken } from "../../client/core/fragments.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_PIECE, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { PIECE_FRAMED, PIECE_STATE_AT, PieceFit } from "../../client/core/render/piece-fit.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { Falling } from "../../client/core/rubble.ts";
import type { Rubble } from "../../client/core/session.ts";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { INSTANCE_BYTES, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { CLS_EDGE, CLS_SQUARE } from "../../shared/world/lattice/module.ts";
import { GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { baseAt, drawn, putAt, turnedBy, type Drawn } from "../fixtures/trims.ts";
import { Base, mixedHouse, turnedRegistry, turnedWorld } from "../fixtures/turned.ts";
import type { TestWorld } from "../fixtures/world.ts";

let gray: { pack: Pack; meshes: Map<string, SourceMesh> } | null = null;
/** The turned fixtures' kinds as the grey boxes and prisms of their colliders. */
function grayPack(): { pack: Pack; meshes: Map<string, SourceMesh> } {
  if (gray) return gray;
  const pack = parsePack(buildPack(grayboxMeshes(turnedRegistry().defs.flatMap((d) => (d ? [d] : []))), defaultPalette()));
  return (gray = { pack, meshes: new Map(unpackMeshes(pack).map((m) => [m.id, m] as const)) });
}

/** Yaws of a base: 17 degrees, and some through each quarter turn. */
const YAWS = [turnedBy(3095).yaw, 5461, 12345, 40000, 61234];

/** A mixed house of all three turn classes at `yaw`, drawn standing, and what falls of it. */
function house(yaw: number) {
  const w: TestWorld = turnedWorld(4);
  const built = mixedHouse(new Base(w, 128, 128, yaw));
  const { pack, meshes } = grayPack();
  const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, w.reg, pack);
  scene.assets.tier = { ...tierOf("lowpoly"), split: 0 };
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [128, 12, 150, Math.PI, -0.4];
  const falling = (scene.falling = new Falling(w.reg.halfY, () => 0));
  const frame = (): FramePacket => scene.build(cam, null);
  frame();
  const standing = new Map(drawn(scene, w.dims, pack, meshes).map((d) => [d.ref, d] as const));
  /** The row as a removal's rubble tells of it, read as the session reads it: before the row is emptied. */
  const gone = (ref: number, cause: number): Rubble => {
    const t = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!;
    const r: Rubble = { kind, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: w.reg.forms?.def[kind] ? t.twAt(s) : -1, cause, ox: 126, oy: 0, oz: 126, tick: 10, radius: 0, into: 0, map: 0 };
    w.structs.remove(ref);
    return r;
  };
  return { w, built, scene, cam, falling, frame, standing, gone, meshes };
}

/** Each whole falling piece of a frame as it is drawn: whether its instance is framed, and its vertices in the world. */
function fallen(h: ReturnType<typeof house>, p: FramePacket): { framed: boolean; x: number; z: number; points: Float64Array }[] {
  const fit = new PieceFit(), table = p.frameTables.get(TRANSIENT_BUFFER), out: { framed: boolean; x: number; z: number; points: Float64Array }[] = [];
  const view = new DataView(p.transient.buffer, p.transient.byteOffset, p.transient.byteLength);
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_PIECE) === 0) continue;
    const lod = h.meshes.get(grayPack().pack.header.meshes[p.drawMesh[d]!]!.id)!.lods[0]!;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const at = i * INSTANCE_BYTES;
      fit.begin(table, p.transient, at);
      const [ix, iy, iz] = [h.cam.x + view.getFloat32(at, true), h.cam.y + view.getFloat32(at + 4, true), h.cam.z + view.getFloat32(at + 8, true)];
      const points = new Float64Array(lod.positions.length);
      for (let v = 0; v < points.length; v += 3) {
        fit.vertex(lod.positions[v]!, lod.positions[v + 1]!, lod.positions[v + 2]!);
        points.set([ix + fit.c * fit.x + fit.s * fit.z, iy + fit.y, iz - fit.s * fit.x + fit.c * fit.z], v);
      }
      out.push({ framed: (p.transient[at + PIECE_STATE_AT]! & PIECE_FRAMED) !== 0, x: ix, z: iz, points });
    }
  }
  return out;
}

/** The farthest a vertex of `points` lies from the same vertex of the standing piece `d`. */
function apart(points: Float64Array, d: Drawn): number {
  let worst = 0;
  for (let v = 0; v < points.length; v += 3) worst = Math.max(worst, Math.hypot(points[v]! - d.points[v]!, points[v + 1]! - d.points[v + 1]!, points[v + 2]! - d.points[v + 2]!));
  return worst;
}

test("a turned piece falling whole is drawn where it stood until it lets go", () => {
  let worst = 0, pieces = 0, plain = 0;
  const classes = new Set<number>();
  for (const yaw of YAWS) {
    for (const cause of [GONE_FELL, GONE_DESTROYED]) {
      const h = house(yaw);
      const refs = [...h.built.walls, ...h.built.ceilings, ...h.built.floors].map(([ref]) => ref);
      for (const ref of refs) classes.add(h.w.structs.chunks[Math.floor(ref / 65536)]!.twAt(ref & 0xffff));
      const at = new Map(refs.map((ref) => [ref, h.standing.get(ref)!] as const));
      h.falling.absorb(refs.map((ref) => h.gone(ref, cause)), 1000, h.cam.x, h.cam.y, h.cam.z);
      h.falling.step(1000);
      const first = fallen(h, h.frame());
      expect(first.length).toBe(refs.length);
      for (const f of first) {
        expect(f.framed, "it stands on its base's vectors").toBe(true);
        // Its own standing piece is the one whose vertices it lies on: no other is within a wall's thickness.
        let least = Infinity;
        for (const d of at.values()) if (d.points.length === f.points.length) least = Math.min(least, apart(f.points, d));
        worst = Math.max(worst, least);
        pieces++;
      }
      // A destroyed piece lets go at once. A millisecond on it turns by the yaw nearest its class: off by the vectors' stretch and no more.
      if (cause !== GONE_DESTROYED) continue;
      h.falling.step(1001);
      const later = fallen(h, h.frame());
      expect(later.length).toBe(refs.length);
      for (const f of later) {
        expect(f.framed).toBe(false);
        let least = Infinity;
        for (const d of at.values()) if (d.points.length === f.points.length) least = Math.min(least, apart(f.points, d));
        plain = Math.max(plain, least);
      }
    }
  }
  expect([...classes].sort()).toEqual([0, 1, 2]);
  expect(pieces).toBe(YAWS.length * 2 * 17);
  expect(worst).toBeLessThan(1e-4);
  expect(plain).toBeGreaterThan(0.001);
  expect(plain).toBeLessThan(0.006);
  if (process.env.SNARK_DRAW_TABLE) console.log(`falling whole, first frame to standing, worst over ${pieces} pieces at ${YAWS.length} yaws: ${worst.toExponential(2)} m; ${plain.toExponential(2)} m a millisecond after letting go`);
});

/** A set of one group: the box of a mesh's own vertices. */
function boxSet(lod: { positions: Float32Array }): BreakSet {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < lod.positions.length; v++) {
    lo[v % 3] = Math.min(lo[v % 3]!, lod.positions[v]!);
    hi[v % 3] = Math.max(hi[v % 3]!, lod.positions[v]!);
  }
  const box = [0, 1, 2].map((a) => (lo[a]! + hi[a]!) / 2).concat([0, 1, 2].map((a) => (hi[a]! - lo[a]!) / 2));
  const corners = Array.from({ length: 8 }, (_, k) => [0, 1, 2].map((a) => box[a]! + ((k >> a) & 1 ? 1 : -1) * box[3 + a]!) as [number, number, number]);
  const set: { key: number; groups: BreakSet["groups"]; boxes: Float32Array; lump: BreakSet | null } = { key: 0, groups: [[{ corners, color: 0, core: 0 }]], boxes: Float32Array.from([...box, ...box]), lump: null };
  set.lump = set as BreakSet;
  return set as BreakSet;
}

test("a turned wall's fragments begin where the wall stood", () => {
  const pose = new Float64Array(POSE.length);
  let worst = 0, byYaw = 0, walls = 0;
  const classes = new Set<number>();
  for (const yaw of YAWS) {
    const h = house(yaw);
    for (const [ref] of h.built.walls) {
      const t = h.w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, d = h.standing.get(ref)!;
      const lod = h.meshes.get(d.id)!.lods[0]!;
      const e: Broken = { cause: GONE_DESTROYED, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: t.twAt(s), ox: t.x[s]! - 2, oy: 1, oz: t.z[s]! - 1, radius: 0, wait: 0, under: 0, set: boxSet(lod) };
      const off = (): number => {
        let far = 0;
        for (const g of [0, 1]) {
          fragmentPose(e, g, 0, 0, pose);
          for (let v = 0; v < lod.positions.length; v += 3) {
            const [x, y, z] = [lod.positions[v]!, lod.positions[v + 1]!, lod.positions[v + 2]!];
            far = Math.max(far, Math.hypot(pose[0]! * x + pose[1]! * y + pose[2]! * z + pose[3]! - d.points[v]!, pose[4]! * x + pose[5]! * y + pose[6]! * z + pose[7]! - d.points[v + 1]!, pose[8]! * x + pose[9]! * y + pose[10]! * z + pose[11]! - d.points[v + 2]!));
          }
        }
        return far;
      };
      worst = Math.max(worst, off());
      // A hair after it lets go it has not jumped: the pose goes on from the one it stood in.
      fragmentPose(e, 0, 0, 1e-4, pose);
      const [x, y, z] = [lod.positions[0]!, lod.positions[1]!, lod.positions[2]!];
      expect(Math.hypot(pose[0]! * x + pose[1]! * y + pose[2]! * z + pose[3]! - d.points[0]!, pose[4]! * x + pose[5]! * y + pose[6]! * z + pose[7]! - d.points[1]!, pose[8]! * x + pose[9]! * y + pose[10]! * z + pose[11]! - d.points[2]!)).toBeLessThan(0.01);
      // The same break of a piece turned by its yaw alone, as a city piece is: its class is not read.
      e.tw = -1;
      byYaw = Math.max(byYaw, off());
      classes.add(t.twAt(s));
      walls++;
    }
  }
  expect([...classes].sort()).toEqual([0, 1, 2]);
  expect(walls).toBe(YAWS.length * 9);
  expect(worst).toBeLessThan(1e-4);
  expect(byYaw).toBeGreaterThan(0.7);
  if (process.env.SNARK_DRAW_TABLE) console.log(`fragments before they let go to standing, worst over ${walls} walls: ${worst.toExponential(2)} m; by yaw alone ${byYaw.toFixed(3)} m`);
});

test("a watcher told of a removal reads each row's turn class before the row is emptied", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const bob = h.join("bob");
  h.run(600);
  h.say(bob, "enablecheats");
  const g = flatGround(h, 40, 40);
  h.say(bob, `tp ${(g.x + 20).toFixed(3)} ${(g.z + 3).toFixed(3)}`);
  const structs = h.world.structs, O = [0, 0, 0, 0];
  // A foundation on the ground, and from its corner a wall along its side and two that stand 30 and 60 degrees round.
  const f = baseAt(structs, g.x + 20, g.y + FOUNDATION_THICK, g.z + 14, turnedBy(3095).yaw);
  const floor = putAt(structs, h.reg, f, "core:foundation_stone", CLS_SQUARE, O, 0, 0);
  const walls = [0, 7, 8].map((d) => putAt(structs, h.reg, f, "core:wall_stone", CLS_EDGE, O, d, 0));
  const rows = walls.map((ref) => {
    const t = structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff;
    return { kind: t.kind[s]!, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: t.twAt(s) };
  });
  expect(rows.map((r) => r.tw)).toEqual([0, 1, 2]);
  h.run(1000);
  const theirs = (ref: number) => bob.world!.structs.chunks[Math.floor(ref / 65536)]!;
  expect(walls.map((ref) => theirs(ref).twAt(ref & 0xffff))).toEqual([0, 1, 2]);
  expect(bob.rubble.length).toBe(0);
  expect(structs.chunks[Math.floor(floor / 65536)]!.kind[floor & 0xffff]).not.toBe(0);
  for (const ref of walls) structs.damage(ref, 1e9, h.world.tick);
  h.run(1500);
  expect(walls.map((ref) => theirs(ref).kind[ref & 0xffff])).toEqual([0, 0, 0]);
  const told = rows.map((r) => bob.rubble.find((q) => q.kind === r.kind && q.x === r.x && q.y === r.y && q.z === r.z));
  expect(told.map((q) => [q?.yaw, q?.tw])).toEqual(rows.map((r) => [r.yaw, r.tw]));
});
