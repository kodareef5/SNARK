// The near city as a mesh a chunk (client/core/render/nearcity.ts) on a small city of frames: one owner a piece wherever
// the camera goes, a static shot away gone the frame it goes, and a border crossed within a frame's making. The same on
// the Miami slice, and the same picture as the instances, are in nearcity.slow.test.ts.

import { expect, test } from "bun:test";
import { FRAME_PIECES, LAID_SHARE, MESH_SLOT, NearCity, NearMaking, pieceWeight } from "../../client/core/render/nearcity.ts";
import { FIXTURE_IRON, FIXTURE_PAINT, SIGN_ENAMEL, fixtureFace, fixtureKind } from "../../client/core/render/street-finish.ts";
import { VERTEX_BYTES } from "../../shared/pack/pack.ts";
import { DRAW_RANGED, DRAW_TEXTURED } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { farPack } from "../fixtures/farworld.ts";
import { alike, nearClient, smallCity } from "../fixtures/nearclient.ts";
import { coreRegistry } from "../fixtures/world.ts";

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

test("a mesh made with each face's piece draws the faces one made without does", () => {
  const map = smallCity();
  const reg = coreRegistry();
  const city = new CityStatics(map.dims, map.statics, reg);
  const near = new NearCity(reg, 0, new Uint8Array(reg.defs.length), () => true);
  const ground = { heightAt: () => 0 };
  const standing = (c: number): Uint8Array => Uint8Array.from({ length: city.in(c) }, (_, i) => near.kinds[city.kind[city.first[c]! + i]!]!);
  let kept = 0, groups = 0;
  for (const chunk of [0, 30, 40, 74]) {
    const [plain, keyed] = [false, true].map((keys) => {
      const m = new NearMaking(city, chunk, ground, standing(chunk), standing, 4, undefined, keys);
      while (!m.done) m.step();
      return { made: m.finish(), census: m.census() };
    });
    expect(keyed!.made.faces).toBe(plain!.made.faces);
    expect(Buffer.from(keyed!.made.data).equals(Buffer.from(plain!.made.data))).toBe(true);
    expect(keyed!.made.cellFirst).toEqual(plain!.made.cellFirst);
    const c = keyed!.census;
    expect(c.shown).toBe(plain!.made.faces);
    // A merged box is of two pieces or more, and each member keeps the faces it would show alone.
    expect(c.members).toBeGreaterThanOrEqual(c.groups * 2);
    expect(c.fallback).toBeGreaterThan(c.members);
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

test("a static shot away is gone that frame, its chunk a mesh again in a second", () => {
  const w = nearClient(smallCity());
  const { cam, city, dims, structs, scene } = w;
  // The tallest piece of chunk (1, 3), seen from 20 m over its top.
  const chunk = 3 * dims.chunksX + 1;
  let top = -Infinity, slot = -1;
  for (let s = 0; s < city.in(chunk); s++) {
    const i = city.first[chunk]! + s, k = city.kind[i]!;
    if (scene.near!.kinds[k] === 1 && city.y[i]! + city.halfY[k]! > top) [top, slot] = [city.y[i]! + city.halfY[k]!, s];
  }
  const i = city.first[chunk]! + slot;
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [city.x[i]!, top + 20, city.z[i]! - 0.01, 0, -Math.PI / 2 + 0.01];
  w.follow(cam.x, cam.z);
  scene.near!.pieces = Infinity;
  const raster = new Rasterizer(64, 36, farPack(), w.hf);
  for (let f = 0; f < 10; f++) raster.render(w.frame());
  // A sixteenth of a frame's pieces, so that these small chunks take frames to make, as downtown's do at the whole.
  scene.near!.pieces = FRAME_PIECES / 16;
  let p = w.frame();
  raster.render(p);
  // The pixel at the middle of the picture shows the piece's top, from its chunk's mesh.
  const middle = 18 * 64 + 32;
  expect(raster.pickId[middle]).toBe(chunk * 65536 + MESH_SLOT);
  const before = raster.depth[middle]!;
  const old = new Map([...structs.held].map((c) => [c, scene.near!.chunk(c)?.mesh?.slot]));
  structs.put(chunk, slot, 0, 0, 0, 0, 0, 0, 0, 2);
  p = w.frame();
  raster.render(p);
  expect(raster.depth[middle]).toBeGreaterThan(before);
  expect(w.owners(p)).toEqual([]);
  // Its chunk and each round it is drawn as instances, the meshes made with the piece let go of.
  const cx = chunkCx(dims, chunk), cz = chunkCz(dims, chunk);
  for (const [c, was] of old) {
    if (Math.abs(chunkCx(dims, c) - cx) > 1 || Math.abs(chunkCz(dims, c) - cz) > 1 || was === undefined || was < 0) continue;
    expect({ chunk: c, dropped: p.assetDrops.includes(was), mesh: scene.near!.chunk(c)?.mesh ?? null }).toEqual({ chunk: c, dropped: true, mesh: null });
  }
  // Its chunk, the nearest, is made first and drawn as its mesh again within a second, the floor under the piece in the
  // middle; the rest follow a frame's pieces at a time.
  let frames = 1, again = -1;
  while (frames < 600 && [...structs.held].some((c) => !scene.near!.chunk(c)?.mesh)) {
    p = w.frame();
    raster.render(p);
    expect(w.owners(p)).toEqual([]);
    if (again < 0 && [...p.drawBuffer.subarray(0, p.drawCount)].some((b, d) => b === chunk && (p.drawFlags[d]! & DRAW_RANGED) !== 0)) {
      again = frames;
      expect([raster.pickId[middle], raster.depth[middle]! > before]).toEqual([chunk * 65536 + MESH_SLOT, true]);
    }
    frames++;
  }
  expect(again).toBeGreaterThan(0);
  expect(again).toBeLessThan(60);
  expect(frames).toBeLessThan(600);
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
  const weight = (c: number, s: number): number => pieceWeight(w.city, w.city.kind[w.city.first[c]! + s]!);
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
