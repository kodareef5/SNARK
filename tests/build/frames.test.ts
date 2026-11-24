// Frames, keys and occupancy in the structure store: a base's pieces as slots of its lattice, kept right as pieces come and go.

import { expect, test } from "bun:test";
import { FOUNDATION_THICK, WALL_HEIGHT } from "../../content/building.ts";
import { FORMS, PLANNED_FORMS, formBoxes } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PLACE, CMD_STRUCT, RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import type { Heightfield } from "../../shared/world/heightfield.ts";
import { formHalf, formPose, type FormDef } from "../../shared/world/lattice/forms.ts";
import { makeBlueprint, turnBlueprint, type BlueprintForms } from "../../shared/world/blueprint.ts";
import { classAxis, dirVector, yawOf } from "../../shared/world/lattice/basis.ts";
import { CLS_ROTS, ownDir, poseOf, rotsOf, twOfKey, type Frame, type LatticeKey, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_DIRS, CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, DIRS, cellOf, key0, key1, keyAnchor, keyCls, keyDir, keyLayer, keyLvl, keyRot } from "../../shared/world/lattice/module.ts";
import { Cells, NO_REF, Occupancy, cellAt, edgeFaces, elementVertices, faceEdges, formCells, vertexEdges, vertexFaces } from "../../shared/world/lattice/occupancy.ts";
import { populateProving, PROVING_DIMS, buildProvingHeightfield } from "../../shared/world/proving.ts";
import { poseAt, type Pose } from "../../shared/world/snap.ts";
import { Found, GONE_BLAST, StructureStore } from "../../shared/world/structures.ts";
import { STRUCT_PICKUP, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { NO_TARGET } from "../../server/build.ts";
import { builder } from "../fixtures/build.ts";
import { CHANGED, SOCKET_SLOTS } from "../fixtures/sockets.ts";
import { coreRegistry, flatWorld, wrap, type TestWorld } from "../fixtures/world.ts";

const U = STRUCT_UNITS;
const Q = 16384;
const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
const made: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
const cells = new Cells();
const found = new Found();

/** A row as whole lattice units: kind, x, y, z, yaw. */
function rowOf(structs: StructureStore, ref: number): number[] {
  const t = structs.chunks[Math.floor(ref / 65536)]!;
  const s = ref & 0xffff;
  return [t.kind[s]!, Math.round(t.x[s]! * U), Math.round(t.y[s]! * U), Math.round(t.z[s]! * U), t.yaw[s]!];
}

/** A row's frame and key, zeros for a row with none. */
function keyOf(structs: StructureStore, ref: number): number[] {
  return structs.keyAt(ref, key) ? [key.fr, key.k0, key.k1] : [0, 0, 0];
}

/** Sets `piece` down in socket `k` of `target` by its pose alone, as the server does today. */
function join(w: TestWorld, target: number, piece: string, k: number, turn = 0, owner = 7): number {
  const kind = w.kind(`core:${piece}_wood`);
  if (!poseAt(w.structs, w.reg, target, kind, k, turn, pose)) throw new Error(`no socket ${k} for ${piece}`);
  return w.structs.add(kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, owner, 1);
}

/** What the store holds of a keyed piece, checked against its key: its pose, its turn class and each cell it covers. Returns its gid. */
function sound(structs: StructureStore, reg: Registry, ref: number): number {
  expect(structs.keyAt(ref, key)).toBe(true);
  const [kind, x, y, z, yaw] = rowOf(structs, ref) as [number, number, number, number, number];
  const f = structs.frames.get(key.fr)!;
  poseOf(f, key.k0, key.k1, reg.forms, kind, made);
  expect([made.x, made.y, made.z, made.yaw]).toEqual([x, y, z, yaw]);
  expect(structs.chunks[Math.floor(ref / 65536)]!.tw![ref & 0xffff]).toBe(made.tw);
  expect(formCells(reg.forms, kind, key.k0, key.k1, cells)).toBe(true);
  for (let i = 0; i < cells.n; i++) {
    expect(structs.refAt(key.fr, cells.k0[i]!, cells.k1[i]!)).toBe(ref);
    for (let up = 0; up < cells.reach[i]!; up++) expect(structs.covering(key.fr, cells.k0[i]!, cellAt(cells.k1[i]!, keyLvl(cells.k1[i]!) + up, keyLayer(cells.k1[i]!)))).toBe(ref);
  }
  return key.fr;
}

/** A frame's counts and box as its rows give them. */
function recount(structs: StructureStore, reg: Registry, f: Frame): void {
  const n = structs.rowsOf(f.gid, found);
  const rows = [...found.refs.subarray(0, n)].map((ref) => [ref, ...rowOf(structs, ref)] as number[]);
  expect(f.live).toBe(n);
  expect(f.roots).toBe(rows.filter((r) => reg.forms.def[r[1]!]!.root !== undefined).length);
  const perChunk = new Map<number, number>();
  for (const r of rows) perChunk.set(Math.floor(r[0]! / 65536), (perChunk.get(Math.floor(r[0]! / 65536)) ?? 0) + 1);
  expect(f.chunks.map((c, i) => [c, f.rows[i]!]).sort((p, q) => p[0]! - q[0]!)).toEqual([...perChunk].sort((p, q) => p[0] - q[0]));
  for (const c of f.chunks) expect(structs.frames.listed(c)).toContain(f);
  // Before it is tightened the box holds every row. After, it is the least that does.
  const box = [Math.min(...rows.map((r) => r[2]!)), Math.min(...rows.map((r) => r[4]!)), Math.max(...rows.map((r) => r[2]!)), Math.max(...rows.map((r) => r[4]!))];
  expect([f.minX <= box[0]!, f.minZ <= box[1]!, f.maxX >= box[2]!, f.maxZ >= box[3]!]).toEqual([true, true, true, true]);
  structs.tighten(f);
  expect([f.minX, f.minZ, f.maxX, f.maxZ, f.loose]).toEqual([...box, false]);
}

/**
 * A house of two by two foundations and two storeys, each piece joined to one before it: a doorframe with its door, a
 * windowframe, a pillar, stairs, a floor over all four and a roof. Returns its refs, the first foundation first.
 */
function house(w: TestWorld, yaw: number, x = 100, z = 100, owner = 7): number[] {
  const refs: number[] = [];
  const put = (piece: string, target: number, k: number, turn = 0): number => refs[refs.push(join(w, target, piece, k, turn, owner)) - 1]!;
  const sw = refs[refs.push(w.structs.add(w.kind("core:foundation_wood"), x, FOUNDATION_THICK / 2, z, yaw, owner, 1)) - 1]!;
  const se = put("foundation", sw, 1);
  const nw = put("foundation", sw, 0);
  const ne = put("foundation", se, 0);
  const walls = [put("doorframe", sw, 2), put("wall", sw, 3, 1), put("wall", se, 2), put("windowframe", se, 1), put("wall", ne, 1), put("wall", ne, 0, 1), put("wall", nw, 0), put("wall", nw, 3)];
  put("door", walls[0]!, 0);
  put("pillar", sw, 0);
  put("stairs", ne, 0, 1);
  const upper = walls.map((wall) => put("wall", wall, 0));
  // A floor off the doorframe and a roof off the wall over it: each over the first foundation, and the rest beside it.
  for (const from of [walls[0]!, upper[0]!]) {
    const first = put("ceiling", from, 1);
    const east = put("ceiling", first, 3);
    put("ceiling", first, 2);
    put("ceiling", east, 2);
  }
  return refs;
}

test("a piece set down in a socket is keyed, and its key gives the socket's pose", () => {
  const sockets: string[] = [];
  let pairs = 0;
  for (const yaw of [0, 8048, 21384, 40000, 65535]) {
    const w = flatWorld(4);
    const { structs, reg } = w;
    for (const [targetName, pieceName, slots] of SOCKET_SLOTS) {
      // The target stands in a base of its own: a foundation, and what joins the target to it. A ceiling is off a wall's
      // top, away from the foundation, so that every slot it offers is free.
      const base = structs.add(w.kind("core:foundation_wood"), 100, FOUNDATION_THICK / 2, 100, yaw, 7, 1);
      const scaffold = [base];
      if (targetName === "ceiling") scaffold.push(join(w, base, "wall", 0));
      if (targetName !== "foundation") scaffold.push(join(w, scaffold[scaffold.length - 1]!, targetName, 0));
      const target = scaffold[scaffold.length - 1]!;
      const gid = sound(structs, reg, target);
      expect(gid).toBe(structs.frameAt(base));
      const targetKey = { ...key };
      const kind = w.kind(`core:${pieceName}_wood`);
      const turns = reg.forms.turns[kind]!;
      for (const [k, slot] of slots.entries()) {
        for (let turn = 0; turn < turns; turn++) {
          pairs++;
          const ref = join(w, target, pieceName, k, turn);
          const today = rowOf(structs, ref);
          if (`${targetName} ${pieceName} ${k}` === CHANGED) {
            // Hung from the foundation's underside it is on no level, so it keeps today's pose and has no key.
            expect([structs.frameAt(ref), structs.frames.count]).toEqual([0, 1]);
            structs.remove(ref);
            continue;
          }
          expect([targetName, pieceName, k, turn, sound(structs, reg, ref)]).toEqual([targetName, pieceName, k, turn, gid]);
          expect(keyLvl(key.k1) - keyLvl(targetKey.k1)).toBe(slot[2]);
          sockets.push(`${key.k0} ${cellOf(key.k1)}`);
          // Set down by that key, it is the same row bit for bit.
          const { k0, k1 } = key;
          structs.remove(ref);
          expect(structs.refAt(gid, k0, k1)).toBe(-1);
          const again = structs.place(kind, gid, k0, k1, 7, 1);
          expect(rowOf(structs, again)).toEqual(today);
          expect(structs.place(kind, gid, k0, k1, 7, 1)).toBe(-1);
          structs.remove(again);
        }
      }
      for (const ref of scaffold.reverse()) structs.remove(ref);
      expect([structs.frames.count, structs.occupied.size, structs.count]).toEqual([0, 0, 0]);
    }
  }
  expect(pairs).toBeGreaterThan(400);
  expect(new Set(sockets).size).toBeGreaterThan(20);
});

test("a two-storey house is one frame at any yaw, and is released as it comes down", () => {
  for (const yaw of [0, 7000, 16384, 30001, 54321]) {
    const w = flatWorld(4);
    const { structs, reg } = w;
    const refs = house(w, yaw);
    expect(refs.length).toBe(4 + 8 + 3 + 8 + 8);
    const gid = structs.frameAt(refs[0]!);
    for (const ref of refs) expect(sound(structs, reg, ref)).toBe(gid);
    const f = structs.frames.get(gid)!;
    expect([structs.frames.count, f.live, f.roots, f.team, f.yaw]).toEqual([1, refs.length, 5, 7, yaw]);
    // The first foundation's corner is the origin, and its top the plane of level 0.
    structs.keyAt(refs[0]!, key);
    expect([key.k0, key.k1]).toEqual([key0(CLS_SQUARE, 0, 0, 0), key1(0, 0, 0, 0, 0, 0)]);
    expect(f.oy).toBe(FOUNDATION_THICK * U);
    // One entry a piece: none here is over a storey high or wider than an edge.
    expect(structs.occupied.size).toBe(refs.length);
    recount(structs, reg, f);
    expect(structs.rowsOf(gid, found)).toBe(refs.length);
    expect([...found.refs.subarray(0, refs.length)].sort()).toEqual([...refs].sort());
    const rng = new Rng(yaw + 1);
    const order = [...refs];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    for (const [n, ref] of order.entries()) {
      structs.keyAt(ref, key);
      const { k0, k1 } = key;
      expect(structs.remove(ref)).toBe(true);
      expect([structs.refAt(gid, k0, k1), structs.frameAt(ref), structs.occupied.size]).toEqual([-1, 0, refs.length - n - 1]);
      if (n + 1 < order.length) recount(structs, reg, f);
    }
    expect([structs.frames.count, structs.frames.get(gid), f.live, f.roots]).toEqual([0, undefined, 0, 0]);
  }
});

test("two bases at other yaws are two frames; one over a chunk border is one", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  // The first base's foundations run east from x = 61 over the border at 64.
  const a = house(w, 0, 61, 100);
  const b = house(w, 5000, 61, 112);
  const [fa, fb] = [structs.frames.get(structs.frameAt(a[0]!))!, structs.frames.get(structs.frameAt(b[0]!))!];
  expect([structs.frames.count, fa === fb, fa.live, fb.live]).toEqual([2, false, a.length, b.length]);
  for (const ref of a) expect(sound(structs, reg, ref)).toBe(fa.gid);
  for (const ref of b) expect(sound(structs, reg, ref)).toBe(fb.gid);
  expect([...fa.chunks].sort()).toEqual([4, 5]);
  expect([structs.frames.listed(4).includes(fa), structs.frames.listed(5).includes(fa), structs.frames.listed(6).length]).toEqual([true, true, 0]);
  recount(structs, reg, fa);
  recount(structs, reg, fb);
  // A third at the first's yaw and off its lattice by a lattice unit is its own.
  const c = structs.add(w.kind("core:foundation_wood"), 61 + 1 / U, FOUNDATION_THICK / 2, 124, 0, 7, 1);
  expect([structs.frames.count, structs.frameAt(c) === fa.gid]).toEqual([3, false]);
  // Another tribe's foundation set exactly beside the first base is not of its frame.
  const other = structs.add(w.kind("core:foundation_wood"), 58, FOUNDATION_THICK / 2, 100, 0, 8, 1);
  expect([structs.frames.count, structs.frames.get(structs.frameAt(other))!.team]).toEqual([4, 8]);
  // The west row of the first base goes, and the frame leaves the west chunk.
  for (const ref of a) if (rowOf(structs, ref)[1]! < 64 * U) structs.remove(ref);
  expect([fa.chunks, structs.frames.listed(4).includes(fa)]).toEqual([[5], false]);
  recount(structs, reg, fa);
});

test("a door opened keeps its key, a piece taken frees its cell, a re-own keeps keys", () => {
  const w = flatWorld(4);
  const { structs, reg } = w;
  const refs = house(w, 12345);
  const gid = structs.frameAt(refs[0]!);
  const f = structs.frames.get(gid)!;
  const door = refs.find((ref) => rowOf(structs, ref)[0] === w.kind("core:door_wood"))!;
  const open = reg.opens[w.kind("core:door_wood")]!;
  structs.keyAt(door, key);
  const { k0, k1 } = key;
  for (const kind of [open, w.kind("core:door_wood"), open]) {
    expect(structs.swap(door, kind)).toBe(true);
    expect([rowOf(structs, door)[0], sound(structs, reg, door), key.k0, key.k1, f.live, structs.occupied.size]).toEqual([kind, gid, k0, k1, refs.length, refs.length]);
  }
  const before = refs.map((ref) => (structs.keyAt(ref, key), [key.fr, key.k0, key.k1]));
  expect(structs.reown(7, 31)).toBe(refs.length);
  expect(f.team).toBe(31);
  expect(refs.map((ref) => (structs.keyAt(ref, key), [key.fr, key.k0, key.k1]))).toEqual(before);
  // The new owner builds on it, and the old may not.
  const wall = refs[5]!;
  structs.keyAt(wall, key);
  const [w0, w1, wallKind] = [key.k0, key.k1, rowOf(structs, wall)[0]!];
  structs.remove(wall);
  expect([structs.refAt(gid, w0, w1), structs.fits(wallKind, gid, w0, w1), f.live]).toEqual([-1, true, refs.length - 1]);
  expect(structs.place(wallKind, gid, w0, w1, 7, 1)).toBe(-1);
  expect(sound(structs, reg, structs.place(wallKind, gid, w0, w1, 31, 1))).toBe(gid);
  // A piece broken to a heap where it stood is no piece of the lattice: the row stays, with a free pose.
  const heap = w.kind("core:storage_box");
  const broken = Uint32Array.of(refs[1]!);
  structs.keyAt(refs[1]!, key);
  expect(structs.breakMany(broken, 1, GONE_BLAST, (_ref, out) => void ((out.kind = heap), (out.hp = 1)), 0, 0, 0, 1)).toBe(1);
  expect([rowOf(structs, refs[1]!)[0], structs.frameAt(refs[1]!), structs.refAt(gid, key.k0, key.k1), f.live, f.roots]).toEqual([heap, 0, -1, refs.length - 1, 4]);
  recount(structs, reg, f);
});

test("pieces the server sets down are keyed there and on a client", () => {
  const { h, sessions, at, hold, join: send, structs } = builder();
  const s = sessions[0]!;
  const reg = h.reg;
  hold(s, "foundation");
  const ok = (piece: string, target: number, socket: number, turn = 0, variant = 0): number => {
    const r = send(s, piece, target, socket, turn, variant);
    expect([piece, r.code]).toEqual([piece, RESULT_OK]);
    return r.ref;
  };
  const act = (ref: number, action: number): number => {
    let code = -1;
    s.onResult = (_seq, c) => void (code = c);
    s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), action === STRUCT_USE ? w.u16(0xffff) : 0));
    h.run(150);
    return code;
  };
  h.say(s, `tp ${at.x.toFixed(3)} ${(at.z + 4).toFixed(3)}`);
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(at.x * U), 32), w.sbits(Math.round((at.z + 8) * U), 32), w.u16(3000), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  const sw = h.host.build.last;
  const frame = ok("wall", sw, 2, 0, 1);
  const door = ok("door", frame, 0);
  const se = ok("foundation", sw, 1);
  const pieces = [sw, se, frame, door, ok("wall", sw, 3), ok("ceiling", frame, 1), ok("wall", frame, 0), ok("pillar", se, 0)];
  const gid = structs.frameAt(sw);
  for (const ref of pieces) expect(sound(structs, reg, ref)).toBe(gid);
  const f = structs.frames.get(gid)!;
  expect([f.live, f.roots, structs.frames.count]).toEqual([pieces.length, 3, 1]);
  // The client was sent rows, not keys, and has keyed them itself in a frame of its own numbering.
  const client = s.world!.structs;
  const keysOf = (store: StructureStore): number[][] => pieces.map((ref) => (store.keyAt(ref, key) ? [key.k0, key.k1] : []));
  const shared = (): void => {
    for (const ref of pieces) if (client.frameAt(ref) !== 0) expect(sound(client, reg, ref)).toBe(client.frameAt(sw));
    expect(keysOf(client)).toEqual(keysOf(structs));
  };
  shared();
  expect(act(door, STRUCT_USE)).toBe(RESULT_OK);
  expect([rowOf(structs, door)[0], sound(structs, reg, door)]).toEqual([reg.opens[reg.index.get("core:door_wood")!]!, gid]);
  shared();
  h.say(s, "tribe create Wolves");
  h.run(100);
  expect(f.team).not.toBe(0);
  expect(f.team).toBe(structs.chunks[Math.floor(sw / 65536)]!.owner[sw & 0xffff]!);
  for (const ref of pieces) expect(sound(structs, reg, ref)).toBe(gid);
  shared();
  structs.keyAt(door, key);
  const { k0, k1 } = key;
  expect(act(door, STRUCT_PICKUP)).toBe(RESULT_OK);
  expect([structs.refAt(gid, k0, k1), f.live]).toEqual([-1, pieces.length - 1]);
  pieces.splice(pieces.indexOf(door), 1);
  expect(client.frameAt(door)).toBe(0);
  shared();
});

test("statics and free things have no key, and their chunks no key columns", () => {
  const reg = coreRegistry();
  const w = wrap(PROVING_DIMS, buildProvingHeightfield(), reg);
  populateProving(w.structs, w.hf, reg);
  const { structs } = w;
  expect(structs.count).toBeGreaterThan(100);
  expect([structs.held.every((c) => structs.chunks[c]!.fr === null), structs.frames.count, structs.occupied.size]).toEqual([true, 0, 0]);
  const empty = structs.chunks.findIndex((t, c) => t === null && c % PROVING_DIMS.chunksX > 0);
  const [x, z] = [(empty % PROVING_DIMS.chunksX) * 64 + 20, Math.floor(empty / PROVING_DIMS.chunksX) * 64 + 20];
  const box = structs.add(w.kind("core:storage_box"), x, 1, z, 0, 7, 1);
  const bed = structs.add(w.kind("core:bed"), x + 4, 1, z, 0, 7, 1);
  // A wall alone is of no base, and a foundation nobody owns is scenery.
  const wall = structs.add(w.kind("core:wall_wood"), x + 8, 1.5, z, 0, 7, 1);
  const scenery = structs.add(w.kind("core:foundation_wood"), x + 12, 1, z, 0, 0, 1);
  expect([box, bed, wall, scenery].map((ref) => structs.frameAt(ref))).toEqual([0, 0, 0, 0]);
  expect([structs.chunks[empty]!.fr, structs.frames.count]).toEqual([null, 0]);
  // A pillar is a root wherever it stands: the store does not know the ground.
  const pillar = structs.add(w.kind("core:pillar_wood"), x + 20, WALL_HEIGHT / 2, z, 0, 7, 1);
  const t = structs.chunks[empty]!;
  expect([structs.frameAt(pillar), structs.frames.count, t.fr!.length, t.k0!.length, t.k1!.length, t.tw!.length]).toEqual([1, 1, t.cap, t.cap, t.cap, t.cap]);
  // The columns grow with the table, and an emptied row's are zero.
  const more: number[] = [];
  for (let i = 0; i < 40; i++) more.push(join(w, more[i - 1] ?? pillar, "pillar", 0));
  expect([t.cap >= 45, t.fr!.length, structs.frames.get(1)!.live]).toEqual([true, t.cap, 41]);
  for (const ref of more) expect(sound(structs, reg, ref)).toBe(1);
  structs.remove(more[7]!);
  const s = more[7]! & 0xffff;
  expect([t.fr![s], t.k0![s], t.k1![s], t.tw![s]]).toEqual([0, 0, 0, 0]);
  expect(structs.held.filter((c) => structs.chunks[c]!.fr !== null)).toEqual([empty]);
});

test("rows put before their base's first piece are keyed once it has come", () => {
  const server = flatWorld(4);
  const refs = house(server, 9000, 61, 100);
  // The first foundation is taken up and a wall set down beside the base takes its slot, so a wall's row now comes first.
  server.structs.remove(refs[0]!);
  const first = join(server, refs[1]!, "wall", 3);
  expect(first).toBe(refs[0]!);
  const client = flatWorld(4);
  const send = (): void => {
    for (const chunk of server.structs.held) {
      const t = server.structs.chunks[chunk]!;
      for (let slot = 0; slot < t.high; slot++) client.structs.put(chunk, slot, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, t.owner[slot]!, t.hp[slot]!, t.mod[slot]!);
      client.structs.setVersion(chunk, t.version);
    }
  };
  send();
  const live = refs.filter((ref) => rowOf(server.structs, ref)[0] !== 0);
  const frames = new Set(live.map((ref) => sound(client.structs, client.reg, ref)));
  expect([frames.size, client.structs.frames.count, client.structs.occupied.size]).toEqual([1, 1, live.length]);
  expect(client.structs.frames.get([...frames][0]!)!.live).toBe(server.structs.frames.get(server.structs.frameAt(refs[1]!))!.live);
  // The same rows again change nothing, and an emptied slot leaves its cell.
  send();
  expect([client.structs.frames.count, client.structs.occupied.size]).toEqual([1, live.length]);
  server.structs.remove(refs[4]!);
  send();
  expect([client.structs.frameAt(refs[4]!), client.structs.occupied.size]).toEqual([0, live.length - 1]);
  // A chunk dropped takes its rows out of the frame, and the last chunk the frame with them.
  const f = client.structs.frames.get([...frames][0]!)!;
  expect(f.chunks.length).toBe(2);
  client.structs.dropChunk(f.chunks[0]!);
  expect([f.chunks.length, client.structs.frames.count]).toEqual([1, 1]);
  recount(client.structs, client.reg, f);
  client.structs.dropChunk(f.chunks[0]!);
  expect([client.structs.frames.count, client.structs.occupied.size, client.structs.count]).toEqual([0, 0, 0]);
  // A chunk's table taken out for keeping takes its rows out of the frame with their keys, and put back they are in it by them.
  const ss = server.structs;
  const base = ss.frames.get(ss.frameAt(refs[1]!))!;
  const [west, east] = [...base.chunks].sort((p, q) => p - q) as [number, number];
  const inWest = base.rows[base.chunks.indexOf(west)]!;
  const kept = ss.detach(west)!;
  expect([base.live, base.chunks, ss.occupied.size, kept.fr!.filter((gid) => gid === base.gid).length, kept.away!.map((d) => d.gid)]).toEqual([live.length - 1 - inWest, [east], live.length - 1 - inWest, inWest, [base.gid]]);
  ss.attach(west, kept);
  for (const ref of live) if (ref !== refs[4]) expect(sound(ss, server.reg, ref)).toBe(base.gid);
  expect([ss.frames.count, base.live, ss.occupied.size]).toEqual([1, live.length - 1, live.length - 1]);
  // With both tables out the frame is gone, and the first table back makes it again as it was, under its own number.
  const [origin, keys] = [[base.ox, base.oy, base.oz, base.yaw, base.team], live.map((ref) => keyOf(ss, ref))];
  const tables = [ss.detach(west)!, ss.detach(east)!];
  expect([ss.frames.count, ss.occupied.size, ss.count]).toEqual([0, 0, 0]);
  ss.attach(east, tables[1]!);
  ss.attach(west, tables[0]!);
  const again = ss.frames.get(base.gid)!;
  expect([ss.frames.count, ss.occupied.size, ss.count, again === base, tables[0]!.away]).toEqual([1, live.length - 1, live.length - 1, false, null]);
  expect([[again.ox, again.oy, again.oz, again.yaw, again.team], live.map((ref) => keyOf(ss, ref))]).toEqual([origin, keys]);
  for (const ref of live) if (ref !== refs[4]) expect(sound(ss, server.reg, ref)).toBe(base.gid);
});

test("rows put by their keys are one base in the sender's frame whatever their order, and a row put free is left free", () => {
  const server = flatWorld(4);
  const refs = house(server, 9000, 61, 100);
  const ss = server.structs;
  const base = ss.frames.get(ss.frameAt(refs[0]!))!;
  for (const order of [1, -1]) {
    const client = flatWorld(4);
    const cs = client.structs;
    // The frame is made first under the sender's number, as a definition or a save's table gives it.
    cs.frames.make(base.ox, base.oy, base.oz, base.yaw, base.team, base.gid);
    for (const ref of order > 0 ? refs : [...refs].reverse()) {
      const [chunk, slot] = [Math.floor(ref / 65536), ref & 0xffff];
      const t = ss.chunks[chunk]!;
      const [fr, k0, k1] = keyOf(ss, ref) as [number, number, number];
      if (fr === 0) {
        cs.put(chunk, slot, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 7, 1, 1, 0);
        continue;
      }
      const at = cs.keyedPose(chunk, t.kind[slot]!, fr, k0, k1)!;
      cs.put(chunk, slot, t.kind[slot]!, at.x / U, at.y / U, at.z / U, at.yaw, 7, 1, 1, fr, k0, k1);
    }
    for (const ref of refs) {
      expect([rowOf(cs, ref), keyOf(cs, ref)]).toEqual([rowOf(ss, ref), keyOf(ss, ref)]);
      if (keyOf(cs, ref)[0] !== 0) sound(cs, client.reg, ref);
    }
    const f = cs.frames.get(base.gid)!;
    expect([cs.frames.count, f.live, f.roots, cs.occupied.size]).toEqual([1, base.live, base.roots, ss.occupied.size]);
    // A foundation put with no key makes no frame, where the shim would have made it one.
    const kind = client.kind("core:foundation_wood");
    cs.put(0, 0, kind, 20, 1, 20, 77, 7, 1, 1, 0);
    expect([cs.frameAt(0), cs.frames.count]).toEqual([0, 1]);
    cs.put(0, 1, kind, 30, 1, 30, 77, 7, 1, 1);
    expect([cs.frameAt(1) > base.gid, cs.frames.count]).toEqual([true, 2]);
    // No pose for a frame that is not made, a key of another form's slot, or a place in another chunk.
    const wall = refs.find((ref) => rowOf(ss, ref)[0] === client.kind("core:wall_wood"))!;
    const [fr, k0, k1] = keyOf(ss, wall) as [number, number, number];
    const chunk = Math.floor(wall / 65536);
    expect([cs.keyedPose(chunk, rowOf(ss, wall)[0]!, fr + 50, k0, k1), cs.keyedPose(chunk, kind, fr, k0, k1), cs.keyedPose(chunk + 1, rowOf(ss, wall)[0]!, fr, k0, k1)]).toEqual([null, null, null]);
  }
});

test("a row put in a cell a stale row still has takes the cell, and the stale row loses its key", () => {
  const w = flatWorld(4);
  const refs = house(w, 0, 100, 100);
  const structs = w.structs;
  const stale = refs.find((ref) => rowOf(structs, ref)[0] === w.kind("core:wall_wood"))!;
  const [fr, k0, k1] = keyOf(structs, stale) as [number, number, number];
  const [chunk, slot] = [Math.floor(stale / 65536), stale & 0xffff];
  const t = structs.chunks[chunk]!;
  const f = structs.frames.get(fr)!;
  const [live, entries] = [f.live, structs.occupied.size];
  // As a client is told: the piece that took the place first, in a later slot, and only then that the old one went.
  const fresh = chunk * 65536 + t.high;
  structs.put(chunk, t.high, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!, t.yaw[slot]!, 7, 1, t.version, fr, k0, k1);
  expect([keyOf(structs, stale), keyOf(structs, fresh), sound(structs, w.reg, fresh), f.live, structs.occupied.size]).toEqual([[0, 0, 0], [fr, k0, k1], fr, live, entries]);
  structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, t.version);
  expect([sound(structs, w.reg, fresh), f.live, structs.occupied.size]).toEqual([fr, live, entries]);
  // The same row told again keeps its key, and told with another takes that one.
  structs.put(chunk, t.high - 1, t.kind[t.high - 1]!, t.x[t.high - 1]!, t.y[t.high - 1]!, t.z[t.high - 1]!, t.yaw[t.high - 1]!, 7, 1, t.version, fr, k0, k1);
  expect([keyOf(structs, fresh), f.live, structs.occupied.size]).toEqual([[fr, k0, k1], live, entries]);
  // The last row of a frame put out by the row that takes its cell: the frame stands, with that row.
  const lone = flatWorld(4);
  const one = lone.structs.add(lone.kind("core:foundation_wood"), 100, 1, 100, 0, 7, 1);
  const [g, a, b] = keyOf(lone.structs, one) as [number, number, number];
  const u = lone.structs.chunks[Math.floor(one / 65536)]!;
  lone.structs.put(Math.floor(one / 65536), 5, u.kind[0]!, u.x[0]!, u.y[0]!, u.z[0]!, u.yaw[0]!, 7, 1, 1, g, a, b);
  expect([keyOf(lone.structs, one), lone.structs.frames.count, lone.structs.frames.get(g)!.live, sound(lone.structs, lone.reg, Math.floor(one / 65536) * 65536 + 5)]).toEqual([[0, 0, 0], 1, 1, g]);
});

test("a table put back gives up the keys of rows whose cells were taken while it was away", () => {
  const w = flatWorld(4);
  const refs = house(w, 9000, 61, 100);
  const ss = w.structs;
  const base = ss.frames.get(ss.frameAt(refs[1]!))!;
  const [west, east] = [...base.chunks].sort((p, q) => p - q) as [number, number];
  const moved = refs.find((ref) => Math.floor(ref / 65536) === west && ss.frameAt(ref) === base.gid)!;
  const key = keyOf(ss, moved);
  const kind = rowOf(ss, moved)[0]!;
  const kept = ss.detach(west)!;
  // Its cell goes to a row of the other chunk's table while it is away: a row put there by that key, wherever it stands.
  const t = ss.chunks[east]!;
  const slot = t.high;
  ss.put(east, slot, kind, t.x[0]!, t.y[0]!, t.z[0]!, t.yaw[0]!, 7, 100, t.version, key[0]!, key[1]!, key[2]!);
  expect(ss.refAt(key[0]!, key[1]!, key[2]!)).toBe(east * 65536 + slot);
  ss.attach(west, kept);
  expect([keyOf(ss, moved), ss.refAt(key[0]!, key[1]!, key[2]!), rowOf(ss, moved)[0]]).toEqual([[0, 0, 0], east * 65536 + slot, kind]);
});

const T = FOUNDATION_THICK / 2;
const TRIANGLE: HullDef = { sixty: true, corners: [[0, -T, 0], [0, T, 0], [3, -T, 0], [3, T, 0], [0, -T, 3], [0, T, 3]] };
/** A triangle that may be turned, as a triangle roof may. */
const TURNED: FormDef = { ...PLANNED_FORMS.triangle_foundation, turns: 3 };
const PLANNED = ["half_wall", "quarter_wall", "large_wall", "double_doorway", "gateway", "gate", "quarter_foundation", "thin_pillar", "fence_foundation", "triangle_foundation", "triangle_turned"] as const;
let wide: Registry | null = null;

/** The core content, ten of the rows to come and the turned triangle as kinds `test:<row>`, each with a collider its row makes. */
function plannedRegistry(): Registry {
  if (wide) return wide;
  const defs = PLANNED.flatMap((name): Def[] => {
    const form: FormDef = name === "triangle_turned" ? TURNED : PLANNED_FORMS[name];
    return [
      { type: "shape", id: `test:shape_${name}`, role: "thing", boxes: form.cls === "triangle" ? [] : formBoxes(form), ...(form.cls === "triangle" ? { hulls: [TRIANGLE] } : {}), form },
      { type: "structure", class: "piece", id: `test:${name}`, mesh: "shape", shape: `test:shape_${name}`, half: formHalf(form), color: 5, hp: 100, material: "core:mat_stone" },
    ];
  });
  const { registry, errors } = compileContent([...CORE_CONTENT, ...defs]);
  if (!registry) throw new Error(errors.join("\n"));
  return (wide = registry);
}

function plannedWorld(): TestWorld {
  const flat = flatWorld(4);
  return wrap(flat.dims, flat.hf as Heightfield, plannedRegistry());
}

test("a tall piece and one over two edges fill every cell they cover", () => {
  const w = plannedWorld();
  const { structs, reg } = w;
  const f = structs.frames.make(100 * U, 2 * U, 100 * U, 4321, 7);
  const k = (name: string): number => reg.index.get(name.includes(":") ? name : `test:${name}`)!;
  const edge = (m0: number, lvl: number, layer = 2, m3 = 0, dir = 0): [number, number] => [key0(CLS_EDGE, m0, 0, 0), key1(m3, lvl, dir, layer, 0, 0)];
  const wall = k("core:wall_wood");
  // A large wall is four storeys on one edge.
  const large = structs.place(k("large_wall"), f.gid, ...edge(0, 0), 7, 1);
  expect([sound(structs, reg, large), structs.occupied.size]).toEqual([f.gid, 4]);
  for (let lvl = 0; lvl < 16; lvl++) expect([lvl, structs.covering(f.gid, ...edge(0, lvl)), structs.fits(wall, f.gid, ...edge(0, lvl))]).toEqual([lvl, large, false]);
  expect([structs.covering(f.gid, ...edge(0, 16)), structs.covering(f.gid, ...edge(0, -1)), structs.fits(wall, f.gid, ...edge(0, 16)), structs.fits(wall, f.gid, ...edge(0, -4)), structs.fits(wall, f.gid, ...edge(0, -3))]).toEqual([-1, -1, true, true, false]);
  // The same edge in another layer, and the next edge, are other cells.
  expect([structs.fits(k("core:door_wood"), f.gid, ...edge(0, 0, 3)), structs.fits(wall, f.gid, ...edge(2, 0))]).toEqual([true, true]);
  // A double doorway takes its edge and the next along; a gateway two edges for two storeys, and its gate their leaf cells.
  const doorway = structs.place(k("double_doorway"), f.gid, ...edge(2, 0), 7, 1);
  expect([sound(structs, reg, doorway), structs.occupied.size, structs.refAt(f.gid, ...edge(4, 0)), structs.fits(wall, f.gid, ...edge(4, 0)), structs.fits(wall, f.gid, ...edge(6, 0))]).toEqual([f.gid, 6, doorway, false, true]);
  // One that would run into it from the edge before is refused whole.
  expect([structs.fits(k("double_doorway"), f.gid, ...edge(-2, 0)), structs.place(k("double_doorway"), f.gid, ...edge(-2, 0), 7, 1), structs.occupied.size]).toEqual([false, -1, 6]);
  const gateway = structs.place(k("gateway"), f.gid, ...edge(0, 0, 2, 4, 3), 7, 1);
  const gate = structs.place(k("gate"), f.gid, ...edge(0, 0, 3, 4, 3), 7, 1);
  expect([sound(structs, reg, gateway), sound(structs, reg, gate), structs.occupied.size]).toEqual([f.gid, f.gid, 14]);
  // The gate is seven levels high: its upper cells reach three, and the level over them is free.
  expect([structs.covering(f.gid, ...edge(0, 6, 3, 6, 3)), structs.covering(f.gid, ...edge(0, 7, 3, 6, 3)), structs.covering(f.gid, ...edge(0, 7, 2, 6, 3))]).toEqual([gate, -1, gateway]);
  // Half walls stack by two levels, and a quarter wall fits only over them.
  const halves = [structs.place(k("half_wall"), f.gid, ...edge(8, 0), 7, 1), structs.place(k("half_wall"), f.gid, ...edge(8, 2), 7, 1)];
  expect([halves.every((ref) => sound(structs, reg, ref) === f.gid), structs.fits(k("quarter_wall"), f.gid, ...edge(8, 1)), structs.fits(k("quarter_wall"), f.gid, ...edge(8, 3)), structs.fits(k("quarter_wall"), f.gid, ...edge(8, 4)), structs.fits(wall, f.gid, ...edge(8, -3)), structs.fits(wall, f.gid, ...edge(8, -4))]).toEqual([true, false, false, true, false, true]);
  // A key of another class or layer, a turn the form has not, a level or a cell off the lattice, a frame not made. A flip is taken.
  const [e0, e1] = edge(20, 0);
  expect([
    structs.fits(wall, f.gid, key0(CLS_SQUARE, 20, 0, 0), e1), structs.fits(wall, f.gid, e0, key1(0, 0, 0, 3, 0, 0)), structs.fits(wall, f.gid, e0, key1(0, 0, 0, 2, 2, 0)),
    structs.fits(wall, f.gid, e0, key1(0, 0, 0, 2, 0, 1)), structs.fits(wall, f.gid, e0, key1(0, 253, 0, 2, 0, 0)), structs.fits(wall, f.gid, e0, key1(0, 252, 0, 2, 0, 0)),
    structs.fits(wall, f.gid, e0, key1(0, 0, 6, 2, 0, 0)), structs.fits(k("double_doorway"), f.gid, ...edge(510, 0)), structs.fits(k("double_doorway"), f.gid, ...edge(509, 0)),
    structs.fits(wall, f.gid + 1, e0, e1), structs.fits(k("core:storage_box"), f.gid, e0, e1), structs.fits(wall, f.gid, e0, e1),
  ]).toEqual([false, false, false, true, false, true, false, false, true, false, false, true]);
  // Each goes, and its cells with it.
  for (const ref of [large, doorway, gateway, gate, ...halves]) structs.remove(ref);
  expect([structs.occupied.size, structs.frames.count]).toEqual([0, 0]);
});

test("pieces 30 and 60 degrees from their frame take their poses from its vectors", () => {
  const w = plannedWorld();
  const { structs, reg } = w;
  const yaw = 2222;
  const f = structs.frames.make(120 * U, U, 120 * U, yaw, 7);
  const b = f.basis;
  const at = (ref: number): number[] => rowOf(structs, ref).slice(1);
  const world = (m: readonly number[]): [number, number] => [f.ox + m[0]! * b[0]! + m[1]! * b[2]! + m[2]! * b[4]! + m[3]! * b[6]!, f.oz + m[0]! * b[1]! + m[1]! * b[3]! + m[2]! * b[5]! + m[3]! * b[7]!];
  const dirs = (d: number): number[] => [...DIRS.subarray((d % 12) * 4, (d % 12) * 4 + 4)];
  const sum = (...ms: number[][]): number[] => [0, 1, 2, 3].map((i) => ms.reduce((s, m) => s + m[i]!, 0));
  const foundation = reg.index.get("core:foundation_wood")!;
  const triangle = reg.index.get("test:triangle_foundation")!;
  const wall = reg.index.get("core:wall_wood")!;
  // A frame goes with its last row, so one pillar stands throughout.
  const keeper = structs.place(reg.index.get("core:pillar_wood")!, f.gid, key0(CLS_VERTEX, 0, 0, 0), key1(0, 0, 0, 4, 3, 0), 7, 1);
  expect(at(keeper)).toEqual([f.ox, U + WALL_HEIGHT * U / 2, f.oz, (yaw + 3 * Q) & 0xffff]);
  for (let dir = 0; dir < 3; dir++) {
    // A square's centre is a half-side along each of its two directions from its corner.
    const ref = structs.place(foundation, f.gid, key0(CLS_SQUARE, 2, 1, -1), key1(3, 0, dir, 0, 1, 0), 7, 1);
    const centre = world(sum([2, 1, -1, 3], dirs(dir), dirs(dir + 3)));
    expect(at(ref)).toEqual([centre[0], U - FOUNDATION_THICK * U / 2, centre[1], (yaw + Q) & 0xffff]);
    expect([sound(structs, reg, ref), structs.chunks[Math.floor(ref / 65536)]!.tw![ref & 0xffff]]).toEqual([f.gid, dir]);
    structs.remove(ref);
  }
  for (let dir = 0; dir < 6; dir++) {
    for (let rot = 0; rot < 2; rot++) {
      const ref = structs.place(wall, f.gid, key0(CLS_EDGE, -3, 2, 0), key1(1, 4, dir, 2, rot, 0), 7, 1);
      const mid = world(sum([-3, 2, 0, 1], dirs(dir)));
      expect(at(ref)).toEqual([mid[0], U + 4 * 384 + WALL_HEIGHT * U / 2, mid[1], (yaw - Math.floor(dir / 3) * Q + rot * 2 * Q) & 0xffff]);
      expect([sound(structs, reg, ref), structs.chunks[Math.floor(ref / 65536)]!.tw![ref & 0xffff]]).toEqual([f.gid, dir % 3]);
      structs.remove(ref);
    }
  }
  for (let dir = 0; dir < 4; dir++) {
    // A triangle turned is the same cell named from another corner: its origin is the corner its +X leaves along a side.
    const corners = [[0, 0, 0, 0], dirs(dir).map((v) => 2 * v), dirs(dir + 2).map((v) => 2 * v)];
    const spots = new Set<string>();
    for (let rot = 0; rot < 3; rot++) {
      const k0 = key0(CLS_TRIANGLE, 4, 0, 2);
      const k1 = key1(-2, 0, dir, 0, rot, 0);
      const ref = structs.place(triangle, f.gid, k0, k1, 7, 1);
      const corner = world(sum([4, 0, 2, -2], corners[(3 - rot) % 3]!));
      const facing = (dir + 8 * rot) % 12;
      expect(at(ref)).toEqual([corner[0], U - FOUNDATION_THICK * U / 2, corner[1], (yaw - Math.floor(facing / 3) * Q) & 0xffff]);
      expect([sound(structs, reg, ref), twOfKey(reg.forms, triangle, k1), structs.refAt(f.gid, k0, key1(-2, 0, dir, 0, 0, 0))]).toEqual([f.gid, facing % 3, ref]);
      spots.add(at(ref).join());
      // Turned another way it is the same cell, and taken.
      expect(structs.fits(triangle, f.gid, k0, key1(-2, 0, dir, 0, (rot + 1) % 3, 0))).toBe(false);
      structs.remove(ref);
    }
    expect(spots.size).toBe(3);
  }
  expect(CLS_ROTS).toEqual([4, 2, 4, 3]);
  // A frame with a row is not dropped. One made and never built on is.
  expect([structs.frames.drop(f.gid), structs.remove(keeper), structs.frames.count]).toEqual([false, true, 0]);
  const bare = structs.frames.make(0, 0, 0, 0, 7);
  expect([bare.gid, structs.frames.drop(bare.gid), structs.frames.count]).toEqual([f.gid + 1, true, 0]);
});

test("a key's turn is formPose's: own +X is direction dir - rot * (12 / turns)", () => {
  const { reg } = plannedWorld();
  const forms = reg.forms;
  const axis = new Int32Array(4);
  const want: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const turned: [string, number, number, number][] = [["core:wall_wood", CLS_EDGE, 2, 2], ["core:stairs_wood", CLS_SQUARE, 4, 1], ["test:triangle_turned", CLS_TRIANGLE, 3, 0]];
  const anchor = [3, -1, 2, -4];
  let poses = 0;
  for (const yaw of [0, 3333, 20000, 61000]) {
    const f = new StructureStore({ chunksX: 4, chunksZ: 4 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).frames.make(130 * U, 3 * U, 130 * U, yaw, 7);
    const b = f.basis;
    const world = (m: readonly number[]): [number, number] => [f.ox + m[0]! * b[0]! + m[1]! * b[2]! + m[2]! * b[4]! + m[3]! * b[6]!, f.oz + m[0]! * b[1]! + m[1]! * b[3]! + m[2]! * b[5]! + m[3]! * b[7]!];
    const along = (d: number, n: number): number[] => [...DIRS.subarray(((d + 12) % 12) * 4, ((d + 12) % 12) * 4 + 4)].map((v) => n * v);
    const sum = (...ms: number[][]): number[] => [0, 1, 2, 3].map((i) => ms.reduce((t, m) => t + m[i]!, 0));
    for (const [name, cls, turns, layer] of turned) {
      const kind = reg.index.get(name)!;
      expect([name, forms.turns[kind], rotsOf(forms, kind)]).toEqual([name, turns, turns]);
      for (let dir = 0; dir < CLS_DIRS[cls]!; dir++) {
        const origins = new Set<string>();
        for (let rot = 0; rot < turns; rot++) {
          const k0 = key0(cls, anchor[0]!, anchor[1]!, anchor[2]!);
          const k1 = key1(anchor[3]!, 5, dir, layer, rot, 0);
          const own = (((dir - rot * (12 / turns)) % 12) + 12) % 12;
          poseOf(f, k0, k1, forms, kind, made);
          // Its yaw and its class are that direction's, so the axis its collider is turned by is the frame's vector along it.
          expect([ownDir(forms, kind, k1), made.yaw, made.tw, twOfKey(forms, kind, k1)]).toEqual([own, yawOf(yaw, own), own % 3, own % 3]);
          classAxis(made.yaw, made.tw, axis, 0);
          dirVector(b, own, axis, 2);
          expect([axis[0], axis[1]]).toEqual([axis[2], axis[3]]);
          // A wall and stairs turn about their slot's middle. A triangle turned is named from the corner its +X leaves:
          // its sides run along dir, dir + 4 and dir + 8 from its first, second and third corners.
          const corner = [[0, 0, 0, 0], along(dir, 2), along(dir + 2, 2)][((own - dir + 12) % 12) / 4]!;
          const point = world(cls === CLS_EDGE ? sum(anchor, along(dir, 1)) : cls === CLS_SQUARE ? sum(anchor, along(dir, 1), along(dir + 3, 1)) : sum(anchor, corner));
          // formPose, given the slot's reference point and facing, turns it the same way turn for turn.
          formPose(forms.def[kind]!, point[0], f.oy + 5 * 384, point[1], yawOf(yaw, cls === CLS_TRIANGLE ? own : dir), rot, want);
          expect([name, dir, rot, made.x, made.y, made.z, made.yaw]).toEqual([name, dir, rot, want.x, want.y, want.z, want.yaw]);
          origins.add(`${made.x} ${made.z}`);
          poses++;
        }
        expect(origins.size).toBe(cls === CLS_TRIANGLE ? 3 : 1);
      }
    }
  }
  expect(poses).toBe(4 * (6 * 2 + 3 * 4 + 4 * 3));
});

test("a key a blueprint turns has the pose its piece had in a frame turned back", () => {
  const { reg } = plannedWorld();
  const forms = reg.forms;
  const rows: BlueprintForms = { wall: FORMS.wall, stairs: FORMS.stairs, triangle: TURNED, ceiling: FORMS.ceiling, pillar: FORMS.pillar, double_doorway: PLANNED_FORMS.double_doorway };
  const kinds: Record<string, number> = { wall: reg.index.get("core:wall_wood")!, stairs: reg.index.get("core:stairs_wood")!, triangle: reg.index.get("test:triangle_turned")!, ceiling: reg.index.get("core:ceiling_wood")!, pillar: reg.index.get("core:pillar_wood")!, double_doorway: reg.index.get("test:double_doorway")! };
  const frames = new StructureStore({ chunksX: 4, chunksZ: 4 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).frames;
  const rng = new Rng(5);
  const there: LatticePose = { x: 0, y: 0, z: 0, yaw: 0, tw: 0 };
  let turnedKeys = 0;
  for (let n = 0; n < 600; n++) {
    const name = Object.keys(rows)[n % 6]!;
    const kind = kinds[name]!;
    const cls = forms.cls[kind]!;
    const piece = { form: name, tier: 1, k0: key0(cls, rng.int(21) - 10, rng.int(21) - 10, rng.int(21) - 10), k1: key1(rng.int(21) - 10, rng.int(9), rng.int(CLS_DIRS[cls]!), forms.layer[kind]!, rng.int(forms.turns[kind]!), 0) };
    const quarters = 1 + rng.int(3);
    const yaw = rng.int(65536);
    // The blueprint's anchor is the frame's origin, and a quarter turn toward +Z is a quarter less yaw.
    const f = frames.make(100 * U, 0, 100 * U, yaw, 7);
    const back = frames.make(100 * U, 0, 100 * U, yaw - quarters * Q, 7);
    const moved = turnBlueprint(makeBlueprint("", "", "", [piece]), rows, 3 * quarters);
    if (!moved.ok) throw new Error(`${name} could not be turned`);
    const now = moved.blueprint.pieces[0]!;
    poseOf(back, piece.k0, piece.k1, forms, kind, made);
    poseOf(f, now.k0, now.k1, forms, kind, there);
    // A form of one turn has one yaw in a cell, so its yaw is the cell's and not the piece's it was: the same solid.
    if (forms.turns[kind] === 1) expect([name, there.x, there.y, there.z, (there.yaw - made.yaw) & (Q - 1), there.tw]).toEqual([name, made.x, made.y, made.z, 0, made.tw]);
    else expect([name, there]).toEqual([name, made]);
    if (now.k0 !== piece.k0 || now.k1 !== piece.k1) turnedKeys++;
    frames.drop(f.gid);
    frames.drop(back.gid);
  }
  expect(turnedKeys).toBeGreaterThan(590);
});

test("a flipped piece fills its cell, its origin mirrored in the slot's middle", () => {
  const w = plannedWorld();
  const { structs, reg } = w;
  const forms = reg.forms;
  const f = structs.frames.make(120 * U, U, 120 * U, 7777, 7);
  const b = f.basis;
  const world = (m: readonly number[]): [number, number] => [f.ox + m[0]! * b[0]! + m[1]! * b[2]! + m[2]! * b[4]! + m[3]! * b[6]!, f.oz + m[0]! * b[1]! + m[1]! * b[3]! + m[2]! * b[5]! + m[3]! * b[7]!];
  const origin = (name: string, k0: number, k1: number): number[] => (poseOf(f, k0, k1, forms, reg.index.get(name)!, made), [made.x, made.z, made.yaw]);
  // A quarter foundation's origin is its low corner: flipped it is the next corner along its own +X, which a turn moves round.
  const quarter = (rot: number, flip: number): number[] => origin("test:quarter_foundation", key0(CLS_SQUARE, 2, 0, 0), key1(2, 0, 0, 0, rot, flip));
  expect(quarter(0, 0)).toEqual([...world([2, 0, 0, 2]), 7777]);
  expect(quarter(0, 1)).toEqual([...world([3, 0, 0, 2]), 7777]);
  expect(quarter(1, 1)).toEqual([...world([2, 0, 0, 3]), 7777 + Q]);
  expect(quarter(2, 1)).toEqual([...world([3, 0, 0, 2]), 7777 + 2 * Q]);
  // A triangle's origin is the corner its +X leaves: flipped it is the corner its +X comes to.
  const triangle = (rot: number, flip: number): number[] => origin("test:triangle_turned", key0(CLS_TRIANGLE, 0, 0, 0), key1(0, 0, 0, 0, rot, flip));
  expect([triangle(0, 0), triangle(0, 1)]).toEqual([[...world([0, 0, 0, 0]), 7777], [...world([2, 0, 0, 0]), 7777]]);
  expect(triangle(1, 1).slice(0, 2)).toEqual(triangle(0, 0).slice(0, 2));
  // A piece whose origin is its slot's middle stays where it is: a wall, stairs, a doorway over two edges.
  for (const [name, cls, layer] of [["core:wall_wood", CLS_EDGE, 2], ["core:stairs_wood", CLS_SQUARE, 1], ["test:double_doorway", CLS_EDGE, 2], ["core:pillar_wood", CLS_VERTEX, 4]] as const) {
    for (let rot = 0; rot < rotsOf(forms, reg.index.get(name)!); rot++) expect([name, rot, origin(name, key0(cls, 4, 0, 0), key1(-4, 0, 0, layer, rot, 1))]).toEqual([name, rot, origin(name, key0(cls, 4, 0, 0), key1(-4, 0, 0, layer, rot, 0))]);
  }
  // In the store a flipped piece keeps its flip, and its cell is taken whichever way the next would lie.
  const kind = reg.index.get("test:quarter_foundation")!;
  const [k0, k1] = [key0(CLS_SQUARE, 2, 0, 0), key1(2, 0, 0, 0, 3, 1)];
  const ref = structs.place(kind, f.gid, k0, k1, 7, 1);
  expect([sound(structs, reg, ref), key.k1, structs.refAt(f.gid, k0, cellOf(k1)), structs.fits(kind, f.gid, k0, cellOf(k1))]).toEqual([f.gid, k1, ref, false]);
  structs.remove(ref);
});

test("the cells next to an element are its sides, its faces and what is round it", () => {
  const rng = new Rng(77);
  const [sides, faces, round, ends] = [new Cells(), new Cells(), new Cells(), new Cells()];
  const has = (list: Cells, k0: number, k1: number): boolean => Array.from({ length: list.n }, (_, i) => list.k0[i] === k0 && list.k1[i] === k1).includes(true);
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const cls = n % 2 === 0 ? CLS_SQUARE : CLS_TRIANGLE;
    const [lvl, layer] = [rng.int(20) - 10, rng.int(6)];
    const k0 = key0(cls, rng.int(40) - 20, rng.int(40) - 20, rng.int(40) - 20);
    const k1 = key1(rng.int(40) - 20, lvl, rng.int(CLS_DIRS[cls]!), layer, 0, 0);
    faceEdges(k0, k1, lvl, 2, sides);
    expect(sides.n).toBe(cls === CLS_SQUARE ? 4 : 3);
    elementVertices(k0, k1, lvl, 4, ends);
    expect(ends.n).toBe(cls === CLS_SQUARE ? 5 : 3);
    for (let s = 0; s < sides.n; s++) {
      expect([keyCls(sides.k0[s]!), keyDir(sides.k1[s]!) < 6, keyLvl(sides.k1[s]!), keyLayer(sides.k1[s]!)]).toEqual([CLS_EDGE, true, lvl, 2]);
      // The face is one of the faces on each of its sides: among the squares or the triangles, left or right.
      edgeFaces(sides.k0[s]!, sides.k1[s]!, lvl, layer, faces);
      expect([faces.n, has(faces, k0, k1), [0, 1, 2, 3].filter((i) => faces.k0[i] === k0 && faces.k1[i] === k1).every((i) => (i >= 2) === (cls === CLS_TRIANGLE))]).toEqual([4, true, true]);
      // Each side ends at two of the face's corners, and runs through its own middle.
      elementVertices(sides.k0[s]!, sides.k1[s]!, lvl, 4, round);
      expect([round.n, has(ends, round.k0[0]!, round.k1[0]!), has(ends, round.k0[1]!, round.k1[1]!)]).toEqual([3, true, true]);
      vertexEdges(round.k0[2]!, round.k1[2]!, lvl, 2, faces);
      expect([faces.n, Array.from({ length: 6 }, (_, i) => faces.k0[12 + i] === sides.k0[s] && faces.k1[12 + i] === sides.k1[s]).filter(Boolean).length]).toEqual([18, 1]);
      checked++;
    }
    for (let c = 0; c < ends.n; c++) {
      expect([keyCls(ends.k0[c]!), keyDir(ends.k1[c]!), keyRot(ends.k1[c]!)]).toEqual([CLS_VERTEX, 0, 0]);
      vertexFaces(ends.k0[c]!, ends.k1[c]!, lvl, layer, round);
      const where = Array.from({ length: round.n }, (_, i) => i).filter((i) => round.k0[i] === k0 && round.k1[i] === k1);
      // A corner has the face among the twelve of its class there; a square's middle has it among the three it is the middle of.
      expect([round.n, where.length, where[0]! >= (c === 4 ? 24 : cls === CLS_SQUARE ? 0 : 12), where[0]! < (c === 4 ? 27 : cls === CLS_SQUARE ? 12 : 24)]).toEqual([27, 1, true, true]);
      if (c === 4) continue;
      // Two of the face's sides end at each corner.
      vertexEdges(ends.k0[c]!, ends.k1[c]!, lvl, 2, round);
      expect(Array.from({ length: 12 }, (_, i) => has(sides, round.k0[i]!, round.k1[i]!)).filter(Boolean).length).toBe(2);
    }
  }
  expect(checked).toBe(200 * 7);
  // An element past the lattice's reach is listed as no cell, and a lookup passes over it.
  faceEdges(key0(CLS_SQUARE, 510, 0, 0), key1(0, 0, 0, 0, 0, 0), 0, 2, sides);
  expect([sides.n, sides.k0[0] !== 0, sides.k0[1], sides.k0[2] !== 0, sides.k0[3] !== 0]).toEqual([4, true, 0, true, true]);
  const table = new Occupancy();
  table.put(5, sides.k0[0]!, sides.k1[0]!, 99, 4);
  const out = new Uint32Array(4);
  expect([table.among(5, sides, out), [...out]]).toEqual([1, [99, NO_REF, NO_REF, NO_REF]]);
  // A slab's own face over a wall: the cell four levels up, in the slab's layer.
  expect(cellAt(key1(7, 3, 4, 2, 1, 0), 7, 0)).toBe(key1(7, 7, 4, 0, 0, 0));
});

test("the occupancy table agrees with a plain map through 300,000 puts and takes", () => {
  const rng = new Rng(4242);
  const table = new Occupancy();
  /** Per cell: its ref and reach. A cell's name is its frame, first word and second word. */
  const model = new Map<string, [number, number]>();
  const live: [number, number, number][] = [];
  const k0s = Array.from({ length: 48 }, () => key0(rng.int(4), rng.int(9) - 4, rng.int(3) - 1, rng.int(3) - 1));
  const cell = (): [number, number, number] => [1 + rng.int(3), k0s[rng.int(k0s.length)]!, key1(rng.int(7) - 3, rng.int(48) - 24, rng.int(3), rng.int(6), 0, 0)];
  const name = (c: readonly [number, number, number], up = 0): string => `${c[0]} ${c[1]} ${cellAt(c[2], keyLvl(c[2]) + up, keyLayer(c[2]))}`;
  /** The ref whose entry covers a cell's level, by the model: the entry there, or one up to three levels under that reaches it. */
  const covers = (c: readonly [number, number, number]): number => {
    for (let down = 0; down < 4; down++) {
      const e = model.get(name(c, -down));
      if (e && e[1] > down) return e[0];
    }
    return -1;
  };
  const isFree = (c: readonly [number, number, number], reach: number): boolean => Array.from({ length: reach }, (_, up) => !model.has(name(c, up))).every(Boolean) && covers(c) < 0;
  let puts = 0;
  let most = 0;
  for (let op = 0; op < 300000; op++) {
    // Runs of puts and of takes, so the table grows through many sizes and long runs of entries are closed up.
    const filling = Math.floor(op / 6000) % 3 !== 2;
    if (rng.float() < (filling ? 0.7 : 0.25)) {
      const c = cell();
      const reach = 1 + rng.int(4);
      const free = isFree(c, reach);
      expect(table.free(c[0], c[1], c[2], reach)).toBe(free);
      // The turn and flip of the word put are no part of the cell.
      const ref = rng.u32() % NO_REF;
      expect(table.put(c[0], c[1], (c[2] | (rng.int(8) << 26)) >>> 0, ref, reach)).toBe(!model.has(name(c)));
      if (!model.has(name(c))) {
        if (!free) expect(table.take(c[0], c[1], c[2])).toBe(true);
        else {
          model.set(name(c), [ref, reach]);
          live.push(c);
          puts++;
        }
      }
    } else if (live.length > 0) {
      const i = rng.int(live.length);
      const c = live[i]!;
      live[i] = live[live.length - 1]!;
      live.pop();
      expect(table.take(c[0], c[1], c[2])).toBe(true);
      expect(table.take(c[0], c[1], c[2])).toBe(false);
      model.delete(name(c));
    }
    const probe = rng.int(3) === 0 && live.length > 0 ? live[rng.int(live.length)]! : cell();
    expect(table.at(probe[0], probe[1], probe[2])).toBe(model.get(name(probe))?.[0] ?? -1);
    expect(table.covering(probe[0], probe[1], probe[2])).toBe(covers(probe));
    most = Math.max(most, table.size);
    if (op % 20000 === 19999) {
      expect(table.size).toBe(model.size);
      for (const c of live) expect(table.at(c[0], c[1], c[2])).toBe(model.get(name(c))![0]);
    }
  }
  expect([puts > 60000, most > 2500, table.size, table.bytes >= most * 16 && table.bytes <= most * 16 * 4]).toEqual([true, true, model.size, true]);
  for (const c of live) expect(table.take(c[0], c[1], c[2])).toBe(true);
  expect(table.size).toBe(0);
});

test("pieces placed and removed at random by key agree with a plain map", () => {
  const w = plannedWorld();
  const { structs, reg } = w;
  const rng = new Rng(99);
  const kinds = [...["foundation", "wall", "doorframe", "windowframe", "ceiling", "pillar", "door", "door_open", "stairs"].map((p) => reg.index.get(`core:${p}_wood`)!), ...PLANNED.map((p) => reg.index.get(`test:${p}`)!)];
  // Frames about the corner where four chunks meet, each turned its own way.
  const origins = [[62, 62], [66, 61], [61, 67], [70, 70], [64, 64]];
  const frames: Frame[] = [];
  const make = (i: number): Frame => (frames[i] = structs.frames.make(origins[i]![0]! * U, (2 + i) * U, origins[i]![1]! * U, rng.int(65536), 7));
  origins.forEach((_, i) => make(i));
  /** Each level of each edge, face or vertex a piece covers, to its ref. */
  const taken = new Map<string, number>();
  const pieces = new Map<number, { frame: number; kind: number; k0: number; k1: number; levels: string[]; entries: number }>();
  const refs: number[] = [];
  const gone = (ref: number): void => {
    expect(structs.remove(ref)).toBe(true);
    for (const l of pieces.get(ref)!.levels) taken.delete(l);
    pieces.delete(ref);
    refs.splice(refs.indexOf(ref), 1);
  };
  const tuple = new Int32Array(4);
  /** The levels a piece of `kind` would cover by this key, from its form's own list. */
  const levelsOf = (gid: number, kind: number, k0: number, k1: number): { levels: string[]; entries: number } => {
    const def = reg.forms.def[kind]!;
    const span = Math.max(1, def.span);
    const list = def.cells ?? Array.from({ length: Math.ceil(span / 4) }, (_, s) => [0, s * 4] as const);
    keyAnchor(k0, k1, tuple, 0);
    const d = keyDir(k1);
    const levels: string[] = [];
    for (const [along, up] of list) {
      const m = [0, 1, 2, 3].map((i) => tuple[i]! + 2 * along * DIRS[d * 4 + i]!);
      for (let l = up; l < Math.min(span, up + 4); l++) levels.push(`${gid} ${keyCls(k0)} ${m.join()} ${d} ${keyLayer(k1)} ${keyLvl(k1) + l}`);
    }
    return { levels, entries: list.length };
  };
  let placed = 0;
  let refused = 0;
  let swapped = 0;
  let released = 0;
  const verify = (): void => {
    expect(structs.count).toBe(pieces.size);
    expect(structs.occupied.size).toBe([...pieces.values()].reduce((sum, p) => sum + p.entries, 0));
    for (const [ref, p] of pieces) {
      expect(sound(structs, reg, ref)).toBe(frames[p.frame]!.gid);
      expect([key.k0, key.k1]).toEqual([p.k0, p.k1]);
    }
    for (const [i, f] of frames.entries()) {
      const mine = [...pieces.values()].filter((p) => p.frame === i).length;
      expect(f.live).toBe(mine);
      if (mine === 0) continue;
      expect(structs.frames.get(f.gid)).toBe(f);
      recount(structs, reg, f);
    }
    for (const chunk of structs.held) for (const f of structs.frames.listed(chunk)) expect(f.chunks).toContain(chunk);
  };
  for (let op = 0; op < 30000; op++) {
    const roll = rng.float();
    if (op % 2000 === 1999) {
      // One whole base is taken down, and its frame goes with its last row.
      const i = (op / 2000) % frames.length | 0;
      const f = frames[i]!;
      for (const ref of refs.filter((r) => pieces.get(r)!.frame === i)) gone(ref);
      expect([f.live, f.roots, f.chunks.length, structs.frames.get(f.gid)]).toEqual([0, 0, 0, undefined]);
    }
    if (roll < 0.7) {
      const i = rng.int(frames.length);
      if (structs.frames.get(frames[i]!.gid) === undefined) {
        // Its last row went, and it with it. A gid is never used again.
        const was = frames[i]!.gid;
        expect(make(i).gid).toBeGreaterThan(was);
        released++;
      }
      const f = frames[i]!;
      const kind = kinds[rng.int(kinds.length)]!;
      const cls = reg.forms.cls[kind]!;
      // Mostly on the frame's own squares, where a base grows, and sometimes along the other two vectors.
      const skew = rng.int(3) === 0 ? 3 : 1;
      const k0 = key0(cls, rng.int(5) - 2, rng.int(skew) - (skew >> 1), rng.int(skew) - (skew >> 1));
      const k1 = key1(rng.int(5) - 2, rng.int(9) - 2, rng.int(CLS_DIRS[cls]!), reg.forms.layer[kind]!, rng.int(rotsOf(reg.forms, kind)), rng.int(2));
      const { levels, entries } = levelsOf(f.gid, kind, k0, k1);
      const free = levels.every((l) => !taken.has(l));
      expect(structs.fits(kind, f.gid, k0, k1)).toBe(free);
      const ref = structs.place(kind, f.gid, k0, k1, 7, 1);
      expect(ref >= 0).toBe(free);
      if (!free) {
        refused++;
        continue;
      }
      placed++;
      pieces.set(ref, { frame: i, kind, k0, k1, levels, entries });
      refs.push(ref);
      for (const l of levels) taken.set(l, ref);
    } else if (roll < 0.95 && refs.length > 0) gone(refs[rng.int(refs.length)]!);
    else {
      // A door opens or shuts where it stands.
      const [shut, open] = [reg.index.get("core:door_wood")!, reg.index.get("core:door_open_wood")!];
      const doors = refs.filter((ref) => pieces.get(ref)!.kind === shut || pieces.get(ref)!.kind === open);
      if (doors.length === 0) continue;
      const door = doors[rng.int(doors.length)]!;
      const p = pieces.get(door)!;
      p.kind = p.kind === shut ? open : shut;
      expect(structs.swap(door, p.kind)).toBe(true);
      swapped++;
    }
    // Who covers a level some piece has, and the two levels under and over it.
    if (refs.length > 0) {
      const of = pieces.get(refs[rng.int(refs.length)]!)!.levels;
      const [gid, cls, m, d, layer, lvl] = of[rng.int(of.length)]!.split(" ");
      const [m0, m1, m2, m3] = m!.split(",").map(Number) as [number, number, number, number];
      for (let l = Number(lvl) - 2; l <= Number(lvl) + 2; l++) expect(structs.covering(Number(gid), key0(Number(cls), m0, m1, m2), key1(m3, l, Number(d), Number(layer), 0, 0))).toBe(taken.get(`${gid} ${cls} ${m} ${d} ${layer} ${l}`) ?? -1);
    }
    if (op % 3000 === 2999) verify();
  }
  verify();
  expect([placed > 10000, refused > 2000, swapped > 500, released >= 15, structs.frames.next > frames.length + 15]).toEqual([true, true, true, true, true]);
  expect(new Set(refs.map((ref) => Math.floor(ref / 65536))).size).toBe(4);
  for (const ref of [...refs]) gone(ref);
  expect([structs.count, structs.occupied.size, structs.frames.count]).toEqual([0, 0, 0]);
});
