// The near city as a mesh a chunk (client/core/render/nearcity.ts) on a small city of frames: one owner a piece wherever
// the camera goes, a static shot away gone the frame it goes by its state alone, what it hid and what it was merged with
// drawn, its shadow and what it hid from view let go, a mesh made again only once quiet, and a border crossed within a
// frame's making. The same on the Miami slice, and the same picture as the instances, are in nearcity.slow.test.ts.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FRAME_PIECES, KEPT_SHARE, LAID_SHARE, MESH_SLOT, NearCity, NearMaking, QUIET_MS, REMAKE_MS, SETTLED_MS, nearMeshSlot, pieceWeight } from "../../client/core/render/nearcity.ts";
import { PIECE_KEYED, PIECE_KEYS } from "../../client/core/render/pieces.ts";
import { FIXTURE_IRON, FIXTURE_PAINT, SIGN_ENAMEL, fixtureFace, fixtureKind } from "../../client/core/render/street-finish.ts";
import { VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { DRAW_RANGED, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { CityStatics } from "../../shared/world/city.ts";
import type { MapStatic } from "../../shared/world/mapfile.ts";
import { PUT_FREE } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { FLOOR, PIER, WALL } from "../fixtures/cityworld.ts";
import { farPack } from "../fixtures/farworld.ts";
import { flatMap } from "../fixtures/map.ts";
import { alike, metresOf, nearClient, shareAlike, shotOf, smallCity } from "../fixtures/nearclient.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { poseSlot } from "../fixtures/slots.ts";

test("a batched cabinet, drain and sign retain their finishes and their concrete supports", () => {
  const reg = coreRegistry();
  const dims = { chunksX: 1, chunksZ: 1 };
  const kinds = ["zutility_concrete", "zdrain_concrete", "zsign_mint", "zpipe4_concrete"];
  const city = new CityStatics(dims, kinds.map((id, i) => ({ kind: "core:zruin_" + id, x: 6 + i * 12, y: 3, z: 20, yaw: 0 })), reg);
  const trailer = reg.index.get("core:box_trailer")!;
  const defs = reg.defs.slice();
  defs[trailer] = { ...reg.defs[reg.index.get("core:zruin_zutility_concrete")!]!, id: "core:box_trailer" };
  const near = new NearCity({ ...reg, defs } as typeof reg, 0, new Uint8Array(defs.length), () => true);
  expect(near.kinds[trailer]).toBe(0);
  const labels = Uint8Array.from(reg.defs, d => d ? fixtureKind(d.id) : 0);
  const making = new NearMaking(city, 0, { heightAt: () => 0 }, new Uint8Array(kinds.length).fill(1), () => null, 4, labels);
  while (!making.done) making.step();
  const { data, faces } = making.finish();
  const finishes = kinds.map(() => new Set<number>());
  for (let f = 0; f < faces; f++) {
    const at = f * 4 * VERTEX_BYTES;
    const label = data[at + 7]! >>> 6;
    const palette = data[at + 6]!;
    for (let v = 1; v < 4; v++) expect(data[at + v * VERTEX_BYTES + 7]! >>> 6).toBe(label);
    finishes[label]!.add(fixtureFace(label, palette));
  }
  expect(finishes).toEqual([new Set([0]), new Set([0, FIXTURE_PAINT]), new Set([0, FIXTURE_IRON]), new Set([SIGN_ENAMEL])]);
});

test("a mesh made with each face's piece shows the faces one made without does, and keeps the rest after them", () => {
  const map = smallCity();
  const reg = coreRegistry();
  const city = new CityStatics(map.dims, map.statics, reg);
  const near = new NearCity(reg, 0, new Uint8Array(reg.defs.length), () => true);
  const ground = { heightAt: () => 0 };
  const standing = (c: number): Uint8Array => Uint8Array.from({ length: city.in(c) }, (_, i) => near.kinds[city.rows(c)!.kind[city.rows(c)!.from(c) + i]!]!);
  let kept = 0, groups = 0;
  for (const chunk of [0, 30, 40, 74]) {
    const [plain, keyed] = [false, true].map((keys) => {
      const m = new NearMaking(city, chunk, ground, standing(chunk), standing, 4, undefined, keys);
      while (!m.done) m.step();
      return { made: m.finish(), census: m.census() };
    });
    // The same vertices in the same order, the same cells and the same lattice: an untouched chunk draws as it did.
    expect([plain!.made.shown, keyed!.made.shown]).toEqual([plain!.made.faces, plain!.made.faces]);
    expect(Buffer.from(keyed!.made.data.subarray(0, plain!.made.data.length)).equals(Buffer.from(plain!.made.data))).toBe(true);
    expect(keyed!.made.cellFirst).toEqual(plain!.made.cellFirst);
    expect(keyed!.made.cellBox).toEqual(plain!.made.cellBox);
    expect(keyed!.made.bounds).toEqual(plain!.made.bounds);
    // Every vertex of a keyed mesh is marked, a face's four alike, and the faces kept lie by cell after those shown.
    const words = new Uint32Array(keyed!.made.piece.buffer);
    for (let f = 0; f < keyed!.made.faces; f++) expect(words[f * 4]! >= PIECE_KEYED && words[f * 4] === words[f * 4 + 3]).toBe(true);
    expect([keyed!.made.keptFirst[0], keyed!.made.keptFirst[16]]).toEqual([keyed!.made.shown, keyed!.made.faces]);
    const c = keyed!.census;
    expect(c.shown).toBe(plain!.made.faces);
    // A merged box is of two pieces or more, and each member keeps the faces it would show alone.
    expect(c.members).toBeGreaterThanOrEqual(c.groups * 2);
    expect(c.fallback).toBeGreaterThan(c.members);
    expect(keyed!.made.faces).toBe(c.shown + c.hidden + c.fallback);
    kept += c.hidden + c.fallback;
    groups += c.groups;
  }
  expect(kept).toBeGreaterThan(0);
  expect(groups).toBeGreaterThan(0);
});

test("across chunk borders each standing piece has one owner every frame", () => {
  const w = nearClient(smallCity());
  const { cam, hf } = w;
  // On foot round the city's middle, then over it at 150 m, a frame every 3 m: the window follows, chunks come and go
  // and their meshes are made a frame's pieces at a time, so some are drawn as instances and some as meshes.
  const legs: [number, number, number][] = [[200, 200, 1.7], [380, 200, 1.7], [380, 380, 1.7], [200, 380, 1.7], [200, 200, 150], [400, 400, 150]];
  let [x, z] = [legs[0]![0], legs[0]![1]];
  let frames = 0, meshed = 0;
  const broken: string[] = [];
  for (const [tx, tz, up] of legs.slice(1)) {
    const steps = Math.ceil(Math.hypot(tx - x, tz - z) / 3);
    const [x0, z0] = [x, z];
    for (let k = 1; k <= steps; k++) {
      [x, z] = [x0 + ((tx - x0) * k) / steps, z0 + ((tz - z0) * k) / steps];
      [cam.x, cam.z, cam.y, cam.yaw, cam.pitch] = [x, z, hf.heightAt(x, z) + up, Math.atan2(tx - x0, tz - z0), up > 10 ? -0.6 : 0];
      w.follow(x, z);
      const p = w.frame();
      broken.push(...w.owners(p).map((b) => `frame ${frames}: ${b}`));
      frames++;
      for (let d = 0; d < p.drawCount; d++) if ((p.drawFlags[d]! & DRAW_RANGED) !== 0 && p.drawBuffer[d]! < NODE_BUFFERS) meshed++;
    }
  }
  expect(broken.slice(0, 5)).toEqual([]);
  // Meshes were drawn along the way, and every chunk of the window had one by the end.
  expect(frames).toBeGreaterThan(200);
  expect(meshed).toBeGreaterThan(frames * 5);
  for (let f = 0; f < 120 && w.scene.near!.stats.waiting > 0; f++) w.frame();
  expect(w.scene.near!.stats.waiting).toBe(0);
});

/** The tallest piece a mesh draws of `chunk`, and the camera set 20 m over its top looking down on it. */
function overTallest(w: ReturnType<typeof nearClient>, chunk: number): { slot: number; top: number } {
  const { cam, city, scene } = w;
  let top = -Infinity, slot = -1;
  const t = city.rows(chunk)!;
  for (let s = 0; s < city.in(chunk); s++) {
    const i = t.from(chunk) + s, k = t.kind[i]!;
    if (scene.near!.kinds[k] === 1 && t.y[i]! + city.halfY[k]! > top) [top, slot] = [t.y[i]! + city.halfY[k]!, s];
  }
  const i = t.from(chunk) + slot;
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [t.x[i]!, top + 20, t.z[i]! - 0.01, 0, -Math.PI / 2 + 0.01];
  w.follow(cam.x, cam.z);
  return { slot, top };
}

test("a static shot away is gone that frame: no mesh let go in the nine chunks, nothing laid out, one state written", () => {
  const w = nearClient(smallCity());
  const { dims, structs, scene } = w;
  const near = scene.near!;
  const chunk = 3 * dims.chunksX + 1;
  const { slot } = overTallest(w, chunk);
  near.pieces = Infinity;
  const raster = new Rasterizer(64, 36, farPack(), w.hf);
  for (let f = 0; f < 10; f++) raster.render(w.frame());
  near.pieces = FRAME_PIECES / 16;
  let p = w.frame();
  raster.render(p);
  // The pixel at the middle of the picture shows the piece's top, from its chunk's mesh.
  const middle = 18 * 64 + 32;
  expect(raster.pickId[middle]).toBe(chunk * 65536 + MESH_SLOT);
  const before = raster.depth[middle]!;
  const old = new Map([...structs.held].map((c) => [c, near.chunk(c)!.mesh]));
  expect([...old.values()].every((m) => m !== null)).toBe(true);
  w.remove(chunk, slot);
  p = w.frame();
  raster.render(p);
  // Gone, and what was under it is drawn by the same mesh.
  expect([raster.pickId[middle], raster.depth[middle]! > before]).toEqual([chunk * 65536 + MESH_SLOT, true]);
  expect(w.owners(p)).toEqual([]);
  // Nothing went on or came off the card but the piece's state: no mesh, no instances.
  expect([p.assetDrops.filter(nearMeshSlot).length, p.assetUploads.filter((u) => nearMeshSlot(u.slot)).length, p.uploads.length, p.drops.length, near.stats.laid, near.stats.waiting]).toEqual([0, 0, 0, 0, 0, 0]);
  for (const [c, was] of old) expect(near.chunk(c)!.mesh).toBe(was);
  expect(near.chunk(chunk)!.drawn[slot]).toBe(0);
  expect(near.stats.states).toBeGreaterThan(0);
  expect(near.stats.states).toBeLessThanOrEqual(PIECE_KEYS * 4);
  // Once it has stood unchanged a while its chunk's mesh, and no other, is made again of what stands, and takes the
  // old one's place in the frame it goes on the card: no frame draws the chunk as instances.
  const made: number[] = [];
  for (let f = 0; f < 720; f++) {
    raster.render((p = w.frame()));
    expect(near.chunk(chunk)!.mesh).not.toBeNull();
    expect(near.stats.laid).toBe(0);
    if (near.stats.remade > 0) made.push(scene.now);
    for (const [c, was] of old) if (c !== chunk) expect(near.chunk(c)!.mesh).toBe(was);
  }
  expect(made.length).toBe(1);
  expect(made[0]!).toBeGreaterThanOrEqual(REMAKE_MS);
  const now = near.chunk(chunk)!;
  expect([now.mesh === old.get(chunk), now.stale, now.mesh!.opened, now.mesh!.has[slot]]).toEqual([false, false, 0, 0]);
  expect([raster.pickId[middle], raster.depth[middle]! > before, w.owners(p)]).toEqual([chunk * 65536 + MESH_SLOT, true, []]);
});

test("a piece that takes another kind leaves its mesh by its state and is drawn as an instance of the new kind", () => {
  const w = nearClient(smallCity());
  const { dims, structs, city, scene } = w;
  const near = scene.near!;
  const chunk = 3 * dims.chunksX + 1;
  const { slot } = overTallest(w, chunk);
  near.pieces = Infinity;
  const raster = new Rasterizer(64, 36, farPack(), w.hf);
  for (let f = 0; f < 6; f++) raster.render(w.frame());
  const t = city.rows(chunk)!, middle = 18 * 64 + 32, i = t.from(chunk) + slot;
  const old = new Map([...structs.held].map((c) => [c, near.chunk(c)!.mesh]));
  // The roof plate becomes a wall where it lay, as a piece that breaks will take its broken form.
  const wall = coreRegistry().index.get(WALL)!;
  structs.put(chunk, slot, wall, t.x[i]!, t.y[i]!, t.z[i]!, t.yaw[i]!, 0, 100, 2);
  let p = w.frame();
  raster.render(p);
  expect(raster.pickId[middle]).toBe(chunk * 65536 + slot);
  expect(w.owners(p)).toEqual([]);
  expect([near.chunk(chunk)!.drawn[slot], p.assetDrops.filter(nearMeshSlot).length, p.assetUploads.filter((u) => nearMeshSlot(u.slot)).length]).toEqual([0, 0, 0]);
  for (const [c, was] of old) expect(near.chunk(c)!.mesh).toBe(was);
  // Only its own chunk's instances were laid out again, for the one that stands in.
  expect(p.uploads.map((u) => u.buffer)).toEqual([chunk]);
  // The map's piece set down again is its mesh's again, and the instance goes.
  w.restore(chunk, slot);
  raster.render((p = w.frame()));
  expect([raster.pickId[middle], near.chunk(chunk)!.drawn[slot], w.owners(p)]).toEqual([chunk * 65536 + MESH_SLOT, 1, []]);
  for (const [c, was] of old) expect(near.chunk(c)!.mesh).toBe(was);
});

/** A client over a flat map of `statics`, its meshes made, the camera `up` metres over (x, z) looking down. */
function over(statics: MapStatic[], x: number, z: number, up: number) {
  const w = nearClient(flatMap(4, { statics }));
  w.scene.near!.pieces = Infinity;
  const raster = new Rasterizer(64, 36, farPack(), w.hf);
  raster.depthBits = 24;
  // The rasterizer is shown every frame, as it holds what each put on the card.
  const frame = (): FramePacket => {
    const p = w.frame();
    raster.render(p);
    return p;
  };
  const look = (lx: number, ly: number, lz: number, yaw = 0, pitch = -Math.PI / 2 + 0.01): { pick: number; metres: number } => {
    [w.cam.x, w.cam.y, w.cam.z, w.cam.yaw, w.cam.pitch] = [lx, ly, lz, yaw, pitch];
    w.follow(lx, lz);
    const p = frame();
    expect(w.owners(p)).toEqual([]);
    return { pick: raster.pickId[18 * 64 + 32]!, metres: metresOf(raster.depth[18 * 64 + 32]!, w.cam, tierOf("high").split) };
  };
  look(x, up, z);
  look(x, up, z);
  return { w, look, frame, mesh: (chunk: number) => w.scene.near!.chunk(chunk)!.mesh! };
}

test("what a piece that left hid is drawn that frame", () => {
  // A pier under a floor plate, whose top the plate holds: the mesh shows no such face while both stand.
  const { w, look, mesh } = over([{ kind: PIER, x: 100, y: 2, z: 100, yaw: 0 }, { kind: FLOOR, x: 100, y: 4.2, z: 100, yaw: 0 }], 100, 100, 8);
  const chunk = 1 * w.dims.chunksX + 1, m = mesh(chunk);
  expect(look(100, 8, 100 - 0.01)).toEqual({ pick: chunk * 65536 + MESH_SLOT, metres: expect.closeTo(3.6, 1) });
  expect([m.faces - m.shown, m.opened]).toEqual([1, 0]);
  w.remove(chunk, 1);
  // The pier's top, 4 m up, and not the ground through a pier with no top.
  expect(look(100, 8, 100 - 0.01)).toEqual({ pick: chunk * 65536 + MESH_SLOT, metres: expect.closeTo(4, 1) });
  expect([mesh(chunk) === m, m.opened]).toEqual([true, 1]);
  // The plate set down again hides it as before.
  w.restore(chunk, 1);
  expect(look(100, 8, 100 - 0.01).metres).toBeCloseTo(3.6, 1);
});

test("what else is written to a piece's texel stays through its neighbour leaving and its mesh made again", () => {
  const { w, look, frame, mesh } = over([{ kind: PIER, x: 100, y: 2, z: 100, yaw: 0 }, { kind: FLOOR, x: 100, y: 4.2, z: 100, yaw: 0 }], 100, 100, 8);
  const chunk = 1 * w.dims.chunksX + 1, near = w.scene.near!, m = mesh(chunk);
  // A damage stage and a scorch over bit 0, a damage, a hit point, and a hit face over the material.
  expect(near.mark(chunk, 0, 0x16, 200, 0x57, 0xe0)).toBe(true);
  const p = frame(), at = (p.pieceRowOf.get(chunk)! * PIECE_KEYS + 0) * 4;
  const texel = (): number[] => Array.from(p.pieces.subarray(at, at + 4));
  expect([texel(), near.stats.states]).toEqual([[0x17, 200, 0x57, 0xe0], 4]);
  w.remove(chunk, 1);
  for (let f = 0; f < 720; f++) frame();
  expect([mesh(chunk) === m, texel()]).toEqual([false, [0x17, 200, 0x57, 0xe0]]);
  expect(look(100, 8, 100 - 0.01).metres).toBeCloseTo(4, 1);
  // A chunk neither drawn near nor round one that is has no texel to write.
  expect(near.mark(15, 0, 2, 0, 0, 0)).toBe(false);
});

test("a piece that goes shows what it hid in the chunk beside its own, whose mesh is not touched", () => {
  // Two plates end to end across the border between chunks (0, 1) and (1, 1): each holds the other's end.
  const plates = [60, 68].map((x) => ({ kind: FLOOR, x, y: 4.2, z: 100, yaw: 0 }));
  const { w, look, mesh } = over(plates, 64, 100, 30);
  const [west, east] = [1 * w.dims.chunksX, 1 * w.dims.chunksX + 1];
  const m = mesh(west);
  expect([m.shown, m.faces - m.shown, mesh(east).faces - mesh(east).shown]).toEqual([5, 1, 1]);
  w.remove(east, 0);
  // From where the east plate was, the west one's end is a face 4 m off, drawn by the west chunk's own mesh.
  expect(look(68, 4.2, 100, -Math.PI / 2, 0)).toEqual({ pick: west * 65536 + MESH_SLOT, metres: expect.closeTo(4, 1) });
  expect([mesh(west) === m, m.opened, w.scene.near!.chunk(west)!.stale]).toEqual([true, 1, false]);
  w.restore(east, 0);
  expect(look(60, 30, 100 - 0.01).metres).toBeCloseTo(25.6, 1);
  expect(look(68, 30, 100 - 0.01).metres).toBeCloseTo(25.6, 1);
});

test("a merged box that loses a member still draws the others, each with the ends it had before they merged", () => {
  // Three plates in a row are one box of six faces.
  const plates = [100, 108, 116].map((x) => ({ kind: FLOOR, x, y: 4.2, z: 100, yaw: 0 }));
  const { w, look, mesh } = over(plates, 108, 100, 30);
  const chunk = 1 * w.dims.chunksX + 1, m = mesh(chunk), id = chunk * 65536 + MESH_SLOT;
  expect([m.shown, m.groupFirst.length - 1, Array.from(m.groupSlots)]).toEqual([6, 1, [0, 1, 2]]);
  for (const x of [100, 108, 116]) expect(look(x, 30, 100 - 0.01)).toEqual({ pick: id, metres: expect.closeTo(25.6, 1) });
  w.remove(chunk, 1);
  // The two left are drawn from the same mesh, and the ground shows between them.
  for (const x of [100, 116]) expect(look(x, 30, 100 - 0.01)).toEqual({ pick: id, metres: expect.closeTo(25.6, 1) });
  expect(look(108, 30, 100 - 0.01).metres).toBeCloseTo(30, 1);
  expect(mesh(chunk)).toBe(m);
  // From where the middle one was, each neighbour's end is a face 4 m off: +X is a quarter turn from north.
  expect(look(108, 4.2, 100, Math.PI / 2, 0)).toEqual({ pick: id, metres: expect.closeTo(4, 1) });
  expect(look(108, 4.2, 100, -Math.PI / 2, 0)).toEqual({ pick: id, metres: expect.closeTo(4, 1) });
  // Set down again, the box is whole: one top over all three.
  w.restore(chunk, 1);
  expect(look(108, 30, 100 - 0.01)).toEqual({ pick: id, metres: expect.closeTo(25.6, 1) });
  expect(look(108, 4.2, 100, Math.PI / 2, 0).pick).not.toBe(id);
});

test("an old mesh and its pieces' states draw what a mesh made of what stands does, for removals at random", () => {
  const map = smallCity(), split = tierOf("high").split;
  const rng = new Rng(7);
  const views: [number, number, number, number, number][] = [[290, 290, 1.7, 0.6, 0.05], [300, 300, 60, 2.2, -0.7], [226, 290, 12, Math.PI / 2, -0.2]];
  let least = 1;
  for (let trial = 0; trial < 4; trial++) {
    const [x, z, up, yaw, pitch] = views[trial % views.length]!;
    // One client loses pieces after its meshes are made; the other never had them.
    const [old, fresh] = [nearClient(map), nearClient(map)];
    const gone: [number, number][] = [];
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let n = 0; n < 12 + trial * 40; n++) {
      const chunk = (cz + rng.int(3) - 1) * map.dims.chunksX + cx + rng.int(3) - 1;
      gone.push([chunk, rng.int(old.city.in(chunk))]);
    }
    const shots = [old, fresh].map((w, k) => {
      [w.cam.x, w.cam.z, w.cam.y, w.cam.yaw, w.cam.pitch] = [x, z, w.hf.heightAt(x, z) + up, yaw, pitch];
      w.scene.near!.pieces = Infinity;
      w.follow(x, z);
      if (k === 1) for (const [chunk, slot] of gone) w.remove(chunk, slot);
      const raster = new Rasterizer(160, 90, farPack(), w.hf);
      raster.depthBits = 24;
      for (let f = 0; f < 4; f++) raster.render(w.frame());
      const meshes = [...w.structs.held].map((c) => w.scene.near!.chunk(c)!.mesh);
      if (k === 0) for (const [chunk, slot] of gone) w.remove(chunk, slot);
      const p = w.frame();
      raster.render(p);
      expect(w.owners(p)).toEqual([]);
      // The old client's meshes are those it had.
      if (k === 0) expect([...w.structs.held].map((c) => w.scene.near!.chunk(c)!.mesh)).toEqual(meshes);
      return shotOf(raster);
    });
    least = Math.min(least, shareAlike(shots[0]!, shots[1]!, old.cam, split));
  }
  expect(least).toBeGreaterThanOrEqual(0.995);
});

test("the shadow at a hole changes the frame the piece goes", () => {
  const w = nearClient(smallCity());
  const { dims, scene } = w;
  const chunk = 3 * dims.chunksX + 1;
  const { slot } = overTallest(w, chunk);
  scene.near!.pieces = Infinity;
  const raster = new Rasterizer(64, 36, farPack(), w.hf);
  let p = w.frame();
  raster.render(p);
  for (let f = 0; f < 6; f++) raster.render((p = w.frame()));
  expect(p.cascadeCount).toBeGreaterThan(0);
  const before = raster.cascade(p, 0, 256);
  w.remove(chunk, slot);
  raster.render((p = w.frame()));
  const after = raster.cascade(p, 0, 256);
  // What the plate shaded is lit from farther off, or not at all; nothing casts from nearer the sun than before.
  let farther = 0, nearer = 0;
  for (let i = 0; i < before.length; i++) {
    if (after[i]! > before[i]! + 1e-6) farther++;
    else if (after[i]! < before[i]! - 1e-6) nearer++;
  }
  expect(farther).toBeGreaterThan(0);
  expect(nearer).toBe(0);
});

test("a box behind a wall is hidden until a piece of the wall goes, and not in that frame", () => {
  // A wall 24 m wide and 11 m high across the view, 10 m ahead of the camera.
  const wall: MapStatic[] = [];
  for (const x of [92, 100, 108]) for (const y of [1.4, 4.2, 7, 9.8]) wall.push({ kind: WALL, x, y, z: 110, yaw: 0 });
  const w = nearClient(flatMap(4, { statics: wall }));
  const { cam, scene } = w;
  scene.near!.pieces = Infinity;
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [100, 3, 100, 0, 0];
  w.follow(100, 100);
  for (let f = 0; f < 3; f++) w.frame();
  const chunk = 1 * w.dims.chunksX + 1;
  const behind = (): boolean => scene.hiding.hides(-2, -2, 20, 2, 2, 24);
  expect(scene.near!.chunk(chunk)!.mesh!.occluders.length).toBeGreaterThan(0);
  expect(behind()).toBe(true);
  w.remove(chunk, 5);
  w.frame();
  expect(behind()).toBe(false);
  // Its chunk's mesh made again, what is left of the wall hides what it can: a box behind its standing end.
  for (let f = 0; f < 720; f++) w.frame();
  expect(scene.near!.chunk(chunk)!.stale).toBe(false);
  expect(scene.hiding.hides(-14, -2, 20, -12, 0, 24)).toBe(true);
  expect(behind()).toBe(false);
});

test("a chunk with rooms has them found again 2 s after a piece last left its mesh, and within 10 s while pieces keep leaving", () => {
  // A row of piers, and in the same chunk a player's shut hut with a box in it, which is seen only from inside.
  const piers = Array.from({ length: 40 }, (_, k) => ({ kind: PIER, x: 70 + k, y: 2, z: 80, yaw: 0 }));
  const w = nearClient(flatMap(4, { statics: piers }));
  const { cam, structs, scene } = w;
  const near = scene.near!, reg = coreRegistry(), chunk = 1 * w.dims.chunksX + 1;
  [cam.x, cam.y, cam.z, cam.yaw] = [100, 6, 70, 0];
  w.follow(100, 70);
  const k = (id: string): number => reg.index.get(`core:${id}`)!;
  const [F, W, C, BOX] = [k("foundation_wood"), k("wall_wood"), k("ceiling_wood"), k("storage_box")];
  const floor = 2 * reg.halfY[F]!, wall = floor + reg.halfY[W]!;
  const hut: [number, number, number, number, number][] = [[F, 100.5, reg.halfY[F]!, 100.5, 0], [W, 100.5, wall, 99, 0], [W, 100.5, wall, 102, 0], [W, 99, wall, 100.5, 16384], [W, 102, wall, 100.5, 16384], [C, 100.5, floor + 3 - reg.halfY[C]!, 100.5, 0], [BOX, 100.5, floor + reg.halfY[BOX]!, 100.5, 0]];
  // As a client is sent it: its base's frame, each piece by its key, the box by its pose.
  const base = structs.frames.make(99 * 512, Math.round(floor * 512), 99 * 512, 0, 1);
  const key = { fr: 0, k0: 0, k1: 0 };
  hut.forEach(([kind, x, y, z, yaw], n) => {
    const keyed = poseSlot({ structs, reg }, base.gid, kind, x, y, z, yaw, key);
    expect(keyed).toBe(kind !== BOX);
    structs.put(chunk, piers.length + n, kind, x, y, z, yaw, 1, 100, 2, keyed ? base.gid : PUT_FREE, key.k0, key.k1);
  });
  structs.setVersion(chunk, 2);
  near.pieces = Infinity;
  for (let f = 0; f < 6; f++) w.frame();
  expect(near.stats.laid).toBe(0);
  // The frames in which the chunk's instances are laid out again, which is when its rooms are found, in seconds from now.
  const start = scene.now;
  let slot = 0;
  const found = (frames: number, every = 0): number[] => {
    const at: number[] = [];
    for (let f = 0; f < frames; f++) {
      if (every > 0 && f % every === 0) w.remove(chunk, slot++);
      w.frame();
      if (near.stats.laid > 0) at.push(Math.round((scene.now - start) / 100) / 10);
    }
    return at;
  };
  // One pier goes: nothing is laid out that frame, and the rooms are found once, 2 s on.
  w.remove(chunk, slot++);
  expect(found(1)).toEqual([]);
  expect(found(239)).toEqual([2]);
  // A pier a half second for 13 s: found 10 s after the first of them left, and then 2 s after the last.
  expect(found(780, 30)).toEqual([14]);
  expect(found(240)).toEqual([18.5]);
});

test("under 50 changes a tick for 330 ticks no chunk goes without its mesh, and none is made again within 10 seconds", () => {
  const w = nearClient(smallCity());
  const { cam, hf, city, structs, scene } = w;
  const near = scene.near!;
  [cam.x, cam.z, cam.y, cam.yaw] = [290, 290, hf.heightAt(290, 290) + 1.7, 0.6];
  w.follow(290, 290);
  near.pieces = Infinity;
  for (let f = 0; f < 4; f++) w.frame();
  near.pieces = FRAME_PIECES;
  const held = [...structs.held];
  const meshes = new Map(held.map((c) => [c, near.chunk(c)!.mesh]));
  const madeAt = new Map<number, number[]>();
  const rng = new Rng(11);
  const broken: string[] = [];
  let laid = 0, states = 0, remade = 0;
  // Two frames a tick: each tick 50 pieces of the window go, or are set down again where they had gone. Two frames more
  // at the end let the last mesh made take its chunk.
  for (let f = 0; f < 662; f++) {
    for (let n = 0; f % 2 === 0 && f < 660 && n < 50; n++) {
      const chunk = held[rng.int(held.length)]!, slot = rng.int(city.in(chunk));
      if (structs.chunks[chunk]!.kind[slot] === 0) w.restore(chunk, slot);
      else w.remove(chunk, slot);
    }
    const p = w.frame();
    if (f % 20 === 0) broken.push(...w.owners(p).map((b) => `frame ${f}: ${b}`));
    if (remade === 0) laid += near.stats.laid;
    states = Math.max(states, near.stats.states);
    remade += near.stats.remade;
    for (const c of held) {
      const m = near.chunk(c)!.mesh;
      if (!m) broken.push(`frame ${f}: chunk ${c} has no mesh`);
      if (m === meshes.get(c)) continue;
      meshes.set(c, m);
      madeAt.set(c, [...(madeAt.get(c) ?? []), scene.now]);
    }
  }
  expect(broken.slice(0, 5)).toEqual([]);
  // A piece set down again where its mesh was made with it is the mesh's again: until a mesh is made without one that
  // then comes back, nothing stands in as an instance.
  expect(laid).toBe(0);
  // A frame's states are a few texels of the chunks that changed, far under a row each.
  expect(states).toBeLessThan(49 * 1024);
  // Ten seconds in, the meshes that draw too much of what they kept are made again, one chunk at a time, once each.
  expect(remade).toBeGreaterThan(0);
  expect(remade).toBe([...madeAt.values()].reduce((n, at) => n + at.length, 0));
  for (const at of madeAt.values()) expect([at.length, at[0]! >= REMAKE_MS]).toEqual([1, true]);
});

test("a chunk that loses pieces every 8 ticks has no mesh made until it has stood a second unchanged", () => {
  const w = nearClient(smallCity());
  const { cam, hf, city, structs, scene } = w;
  const near = scene.near!;
  [cam.x, cam.z, cam.y, cam.yaw] = [290, 290, hf.heightAt(290, 290) + 1.7, 0.6];
  w.follow(290, 290);
  near.pieces = Infinity;
  for (let f = 0; f < 4; f++) w.frame();
  near.pieces = FRAME_PIECES;
  // Past REMAKE_MS, so only the chunk's own changes hold a mesh back.
  while (scene.now < REMAKE_MS + 500) w.frame();
  const chunk = [...structs.held].sort((a, b) => city.in(b) - city.in(a))[0]!;
  const slots = Array.from({ length: city.in(chunk) }, (_, s) => s).filter((s) => structs.chunks[chunk]!.kind[s] !== 0);
  const per = Math.ceil(slots.length / 12);
  // A building coming down: ten waves two frames a tick apart take most of the chunk, far past what a mesh may keep.
  let remade = 0, last = 0;
  for (let wave = 0; wave < 10; wave++) {
    for (let n = 0; n < per; n++) w.remove(chunk, slots.pop()!);
    last = scene.now;
    for (let f = 0; f < 16; f++) {
      w.frame();
      remade += near.stats.remade;
    }
  }
  const m = near.chunk(chunk)!.mesh!;
  expect(m.opened).toBeGreaterThan(m.shown * KEPT_SHARE);
  expect(remade).toBe(0);
  // Then it is made once it has settled, well before the five seconds a mesh within what it may keep waits.
  while (remade === 0 && scene.now < last + QUIET_MS) {
    w.frame();
    remade += near.stats.remade;
  }
  expect([remade, scene.now - last >= SETTLED_MS, scene.now - last < QUIET_MS - 1000]).toEqual([1, true, true]);
});

test("a border crossed makes no more in a frame than a frame's pieces", () => {
  const w = nearClient(smallCity());
  const { cam, hf, scene } = w;
  // The walk goes east from the middle of chunk (3, 3) over the border into (4, 3), which brings a column of seven chunks:
  // more pieces than a frame makes. The slice's densest place is crossed in nearcity.slow.test.ts.
  let x = 3.5 * CHUNK_SIZE;
  const z = 3.5 * CHUNK_SIZE;
  [cam.x, cam.z, cam.y, cam.yaw] = [x, z, hf.heightAt(x, z) + 1.7, Math.PI / 2];
  w.follow(x, z);
  for (let f = 0; f < 400 && (f < 2 || scene.near!.stats.waiting > 0); f++) w.frame();
  expect(scene.near!.stats.waiting).toBe(0);
  const frames: { laid: number; steps: number; made: number }[] = [];
  for (let f = 0; f < 300; f++) {
    x += 0.2;
    [cam.x, cam.y] = [x, hf.heightAt(x, z) + 1.7];
    w.follow(x, z);
    w.frame();
    const { laid, steps, made } = scene.near!.stats;
    frames.push({ laid, steps, made });
  }
  // The border was crossed, the column of chunks it brought laid out as instances and then made as meshes.
  expect(Math.floor(x / CHUNK_SIZE)).toBe(4);
  const weight = (c: number, s: number): number => pieceWeight(w.city, w.city.rows(c)!.kind[w.city.rows(c)!.from(c) + s]!);
  const brought = Array.from({ length: 7 }, (_, j) => j * w.dims.chunksX + 7).reduce((n, c) => n + scene.near!.chunk(c)!.mine.reduce((m, v, s) => m + v * weight(c, s), 0), 0);
  expect(frames.reduce((n, f) => n + f.made, 0)).toBe(brought);
  expect(scene.near!.stats.waiting).toBe(0);
  // Each frame makes what is left of its pieces past what it laid out, or one band where it laid nothing out.
  const over = frames.filter((f) => f.made > 0 && f.made + f.laid * LAID_SHARE > FRAME_PIECES && !(f.laid === 0 && f.steps === 1));
  expect(over).toEqual([]);
});

test("a draw or caster is marked as the one before it only where it repeats it", () => {
  const w = nearClient(smallCity());
  const { cam, hf } = w;
  let joined = 0, cast = 0;
  const wrong: string[] = [];
  for (const [x, z, up, yaw] of [[290, 290, 1.7, 0], [290, 290, 1.7, Math.PI], [200, 380, 1.7, Math.PI / 2], [300, 300, 150, 0.7], [150, 300, 20, 4]] as const) {
    [cam.x, cam.z, cam.y, cam.yaw, cam.pitch] = [x, z, hf.heightAt(x, z) + up, yaw, up > 10 ? -0.6 : 0];
    w.follow(x, z);
    for (let f = 0; f < 120 && (f < 2 || w.scene.near!.stats.waiting > 0); f++) w.frame();
    const p = w.frame();
    for (let d = 0; d < p.drawCount; d++) {
      const run = (p.drawFlags[d]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0;
      if (p.drawJoined[d] !== (d > 0 && run && alike(p, "draw", d, d - 1) ? 1 : 0)) wrong.push(`draw ${d}`);
      joined += p.drawJoined[d]!;
    }
    for (let e = 0; e < p.casterCount; e++) {
      const run = (p.casterFlags[e]! & (DRAW_TEXTURED | DRAW_RANGED)) !== 0;
      if (p.casterJoined[e] !== (e > 0 && run && alike(p, "caster", e, e - 1) ? 1 : 0)) wrong.push(`caster ${e}`);
      cast += p.casterJoined[e]!;
    }
  }
  expect(wrong.slice(0, 5)).toEqual([]);
  // Some were marked: a chunk's mesh casts a run of its cells into each cascade. The slice's counts are in the slow file.
  expect(joined).toBeGreaterThan(0);
  expect(cast).toBeGreaterThan(0);
});
