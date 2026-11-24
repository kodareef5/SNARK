// A street's wreck as a client draws it down its rungs (client/core/render/passes/near-store.ts, farcity.ts,
// passes/loose-entities.ts): its lesser look in the paint of the kind the map placed, a rung that lays out its chunk's
// instances and makes no mesh again, and a wreck blown apart falling whole in its paint.

import { expect, test } from "bun:test";
import { FarStore } from "../../client/core/farcells.ts";
import { FAR_SLOTS } from "../../client/core/render/far.ts";
import { MESH_SLOT, QUIET_MS, REMAKE_MS } from "../../client/core/render/nearcity.ts";
import { DRAW_RANGED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { Falling } from "../../client/core/rubble.ts";
import { ruinKind } from "../../content/ruins.ts";
import type { StructureDef } from "../../shared/content/defs.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { rungKind } from "../../shared/world/breaking.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { GONE_BLAST, StructureStore } from "../../shared/world/structures.ts";
import { flatMap } from "../fixtures/map.ts";
import { nearClient } from "../fixtures/nearclient.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const k = (id: string): number => reg.index.get(id)!;
const def = (kind: number): StructureDef => reg.defs[kind] as StructureDef;
const BLUE = "core:zzzzroad_fastback_abandoned_blue";
/** The chunk the street is in, the middle of a map of nine a side, and its corner. */
const CHUNK = 4 * 9 + 4, X0 = 4 * CHUNK_SIZE, Z0 = 4 * CHUNK_SIZE;

/** A near client over `cars` parked in a row along x in CHUNK, slot `i` holding car `i`, and `more` after them. */
function street(cars: readonly string[], more: readonly MapStatic[] = []) {
  const statics: MapStatic[] = [...cars.map((kind, i) => ({ kind, x: X0 + 8 + i * 3.5, y: 0, z: Z0 + 30, yaw: 0 })), ...more];
  const w = nearClient(flatMap(9, { id: "test:wreck-street", statics }));
  let version = 100;
  [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [X0 + 32, 8, Z0 + 4, 0, -0.25];
  w.follow(w.cam.x, w.cam.z);
  w.scene.near!.pieces = Infinity;
  const sent = new Map<number, { data: Uint8Array; slots: Uint16Array }>();
  return {
    ...w, sent,
    /** Runs `frames` frames, keeping each chunk's instances as last sent. Returns the last. */
    run(frames: number): FramePacket {
      let p: FramePacket | null = null;
      for (let f = 0; f < frames; f++) {
        p = w.frame();
        for (const u of p.uploads) sent.set(u.buffer, { data: u.data.slice(), slots: u.slots.slice() });
      }
      return p!;
    },
    /** Sets `slot` to `kind` in place at `hp`, or with 0 empties it, as a row or a removal from the server does. */
    set(slot: number, kind: number, hp = 5333): void {
      const i = w.city.first[CHUNK]! + slot;
      if (kind === 0) w.structs.put(CHUNK, slot, 0, 0, 0, 0, 0, 0, 0, ++version);
      else w.structs.put(CHUNK, slot, kind, w.city.x[i]!, w.city.y[i]!, w.city.z[i]!, w.city.yaw[i]!, 0, hp, ++version);
      w.structs.setVersion(CHUNK, version);
    },
    /** The instance of `slot` as last sent: its bytes, and the mesh frame `p` draws it with. */
    instance(p: FramePacket, slot: number): { bytes: Uint8Array; mesh: number } {
      const u = sent.get(CHUNK)!, i = u.slots.indexOf(slot);
      let mesh = -1;
      for (let d = 0; d < p.drawCount; d++) if (p.drawBuffer[d] === CHUNK && (p.drawFlags[d]! & DRAW_RANGED) === 0 && i >= p.drawFirst[d]! && i < p.drawFirst[d]! + p.drawInstances[d]!) mesh = p.drawMesh[d]!;
      return { bytes: u.data.subarray(i * INSTANCE_BYTES, (i + 1) * INSTANCE_BYTES), mesh };
    },
  };
}

test("a blue fastback stripped is still drawn blue, in its stripped look's mesh", () => {
  const w = street([BLUE, "core:zzzzroad_fastback_abandoned_red"]);
  const blue = k(BLUE), stripped = rungKind(reg, blue, 1), shell = rungKind(reg, blue, 2);
  let p = w.run(4);
  const whole = w.instance(p, 0);
  const finish = [...whole.bytes.subarray(14)];
  expect([finish[0], whole.mesh]).toEqual([def(blue).color, w.scene.meshOfKind[blue]]);
  w.set(0, stripped);
  p = w.run(1);
  // The stripped kind is one for every paint, and its own colour is the first of them.
  const now = w.instance(p, 0);
  expect(def(stripped).color).not.toBe(def(blue).color);
  expect([[...now.bytes.subarray(14)], now.mesh]).toEqual([finish, w.scene.meshOfKind[stripped]]);
  expect(now.mesh).not.toBe(whole.mesh);
  // Its shell is blue too, in the shell's mesh.
  w.set(0, shell, 2667);
  p = w.run(1);
  expect([[...w.instance(p, 0).bytes.subarray(14)], w.instance(p, 0).mesh]).toEqual([finish, w.scene.meshOfKind[shell]]);
  expect(new Set([whole.mesh, now.mesh, w.instance(p, 0).mesh]).size).toBe(3);
  // Its neighbour is as it was, and each piece has one owner.
  expect(w.instance(p, 1).bytes[14]).toBe(def(k("core:zzzzroad_fastback_abandoned_red")).color);
  expect(w.owners(p)).toEqual([]);
});

artTest("with the art, a wreck's lesser looks are drawn as its body's own meshes", () => {
  const dims = { chunksX: 1, chunksZ: 1 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs, far: { cells: new FarStore(), complete: () => true } }, reg, corePack());
  const blue = k(BLUE), find = (id: string): number => scene.assets.table.find(id);
  expect([blue, rungKind(reg, blue, 1), rungKind(reg, blue, 2)].map((kind) => scene.meshOfKind[kind])).toEqual([find("core:fastback_abandoned"), find("core:fastback_abandoned_stripped"), find("core:fastback_abandoned_shell")]);
  expect(find("core:fastback_abandoned_shell")).toBeGreaterThanOrEqual(0);
});

test("a rung lays its chunk's instances out again and makes no mesh again", () => {
  // Fourteen cars, and a row of walls a near mesh draws.
  const cars = Array.from({ length: 14 }, (_, i) => ["core:zzzzroad_fastback_abandoned_blue", "core:compact_abandoned_white", "core:zzzzroad_caravan_abandoned_red", "core:compact_wreck", "core:zzzzroad_bus_abandoned"][i % 5]!);
  const feet = new StructureStore({ chunksX: 1, chunksZ: 1 }, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts).low;
  const wall = ruinKind("wall4", "rose");
  const walls: MapStatic[] = Array.from({ length: 8 }, (_, i) => ({ kind: wall, x: X0 + 10 + i * 4, y: -feet[k(wall)]!, z: Z0 + 40, yaw: 0 }));
  const w = street(cars, walls);
  const near = w.scene.near!, far = w.scene.city!;
  w.run(8);
  const mesh = near.chunk(CHUNK)!.mesh!, gone = far.goneVersion[CHUNK]!;
  expect([mesh !== null, w.sent.get(CHUNK)!.slots.length]).toEqual([true, 15]);
  // A mesh made here (a chunk's, a far level's) has a slot past the pack's own (far.ts FAR_SLOTS).
  const made = (p: FramePacket): number => p.assetUploads.filter((u) => u.slot >= FAR_SLOTS).length;
  let uploads = 0;
  for (const slot of [0, 1, 2]) {
    const to = rungKind(reg, w.city.kind[w.city.first[CHUNK]! + slot]!, 1);
    w.set(slot, to);
    const p = w.run(1);
    // The chunk's fourteen instances and its mesh's one go up again; and the lesser look's own mesh, the first time it is drawn.
    expect(p.uploads.map((u) => [u.buffer, u.data.length])).toEqual([[CHUNK, 15 * INSTANCE_BYTES]]);
    expect([p.drops.length, p.assetDrops.length, made(p), near.stats.remade, near.chunk(CHUNK)!.mesh === mesh]).toEqual([0, 0, 0, 0, true]);
    expect(p.assetUploads.length).toBeLessThanOrEqual(1);
    expect(w.owners(p)).toEqual([]);
    for (let f = 0; f < 4; f++) uploads += made(w.run(1));
  }
  // Down to its shell is no more.
  w.set(0, rungKind(reg, w.city.kind[w.city.first[CHUNK]!]!, 2), 2667);
  const p = w.run(1);
  expect([p.uploads.map((u) => u.buffer), p.drops.length, p.assetDrops.length, made(p), near.chunk(CHUNK)!.mesh === mesh]).toEqual([[CHUNK], 0, 0, 0, true]);
  // The far layers take a salvaged wreck as standing: nothing of theirs is made again for a rung.
  expect([far.goneOf(CHUNK), far.goneVersion[CHUNK]]).toEqual([null, gone]);
  // Left quiet, its near mesh is not made again either: no wreck is in it.
  for (let f = 0; f < Math.ceil((REMAKE_MS + QUIET_MS) / (1000 / 60)) + 30; f++) uploads += made(w.frame());
  expect([uploads, near.chunk(CHUNK)!.mesh === mesh, [...w.sent.get(CHUNK)!.slots].includes(MESH_SLOT)]).toEqual([0, true, true]);
  // Cut up, it is gone for the far layers as any piece taken is.
  w.set(0, 0);
  w.run(1);
  expect([far.goneOf(CHUNK)?.[0], far.goneVersion[CHUNK]! > gone]).toEqual([1, true]);
});

test("a stripped wreck blown apart falls whole, in the paint the map placed it in", () => {
  const w = street([BLUE]);
  const blue = k(BLUE), stripped = rungKind(reg, blue, 1);
  w.run(4);
  w.set(0, 0);
  const falling = (w.scene.falling = new Falling(reg.halfY, () => 0, { reg, structs: w.structs }));
  const [x, z] = [w.city.x[w.city.first[CHUNK]!]!, w.city.z[w.city.first[CHUNK]!]!];
  falling.absorb([{ kind: stripped, x, y: 0, z, yaw: 0, tw: -1, cause: GONE_BLAST, ox: x + 2, oy: 1, oz: z, tick: 0, radius: 6, into: 0, map: blue }], w.scene.now, w.cam.x, w.cam.y, w.cam.z);
  expect([falling.count, falling.sets[0]]).toEqual([1, null]);
  const p = w.run(1);
  const whole = [...Array(p.drawCount).keys()].filter((d) => p.drawBuffer[d] === TRANSIENT_BUFFER && p.drawMesh[d] === w.scene.meshOfKind[stripped]);
  expect(whole.length).toBe(1);
  expect(p.transient[p.drawFirst[whole[0]!]! * INSTANCE_BYTES + 14]).toBe(def(blue).color);
});
