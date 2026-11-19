// The near city as a mesh a chunk (client/core/render/nearcity.ts) on the Miami slice: one owner a piece wherever the
// camera goes, a static shot away gone the frame it goes, and a border crossed within a frame's making. The same picture
// as the instances is in nearcity.slow.test.ts.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FRAME_PIECES, LAID_SHARE, MESH_SLOT, pieceWeight } from "../../client/core/render/nearcity.ts";
import { DRAW_CUTOUT, DRAW_RANGED, DRAW_TEXTURED, MAX_CASTERS, MAX_DRAWS, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";
import { farPack } from "../fixtures/farworld.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** Chunks either side of the camera's that a client holds whole (server/game.ts structRadius). */
const RADIUS = 3;

/** The slice as a client on high holds it: the window round the camera's chunk whole, its statics put as a client puts the map's. */
function client() {
  const slice = miamiSlice();
  const reg = coreRegistry();
  const pack = farPack();
  const dims = slice.map.dims;
  const hf = mapHeightfield(slice.map);
  const city = new CityStatics(dims, slice.map.statics, reg);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const held = new Uint8Array(dims.chunksX * dims.chunksZ);
  const complete = (c: number): boolean => held[c] === 1;
  const scene = new Scene({ mapId: slice.map.id, dims, hf, structs, far: { cells: new FarStore(), complete }, city: { statics: city, complete } }, reg, pack);
  scene.assets.tier = tierOf("high");
  scene.viewHeight = 540;
  scene.city!.makeMs = Infinity;
  const cam = new Camera();
  cam.aspect = 16 / 9;
  // What the card holds: each chunk's instances as last sent, and the levels of meshes on it.
  const slots = new Map<number, Uint16Array>();
  const onCard = new Set<number>();
  let now = 0;
  return {
    dims, hf, city, structs, scene, cam,
    /** Holds the chunks round (x, z) whole and lets go of the rest, as the server sends and drops them. */
    follow(x: number, z: number): void {
      const [cx, cz] = [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
      for (const c of [...structs.held]) {
        if (Math.abs(chunkCx(dims, c) - cx) <= RADIUS && Math.abs(chunkCz(dims, c) - cz) <= RADIUS) continue;
        structs.dropChunk(c);
        held[c] = 0;
      }
      for (let j = Math.max(0, cz - RADIUS); j <= Math.min(dims.chunksZ - 1, cz + RADIUS); j++) {
        for (let i = Math.max(0, cx - RADIUS); i <= Math.min(dims.chunksX - 1, cx + RADIUS); i++) {
          const c = j * dims.chunksX + i;
          if (held[c] === 1) continue;
          held[c] = 1;
          for (let s = city.first[c]!; s < city.first[c + 1]!; s++) structs.put(c, s - city.first[c]!, city.kind[s]!, city.x[s]!, city.y[s]!, city.z[s]!, city.yaw[s]!, 0, reg.maxHp[city.kind[s]!]!, 1);
          structs.setVersion(c, 1);
        }
      }
    },
    frame(): FramePacket {
      scene.now = now += 1000 / 60;
      const p = scene.build(cam, null);
      for (const u of p.uploads) slots.set(u.buffer, u.slots);
      for (const id of p.drops) slots.delete(id);
      for (const s of p.assetDrops) onCard.delete(s);
      for (const u of p.assetUploads) onCard.add(u.slot);
      return p;
    },
    /** Where a frame breaks the rule of one owner a piece: a standing piece of a chunk it draws near that is in neither its instances nor its mesh, or in both; a mesh drawn that is not its chunk's or not on the card; a chunk drawn both near and far. */
    owners(p: FramePacket): string[] {
      const out: string[] = [];
      const drawn = new Set<number>();
      const ranged = (buffer: number, slot: number, flags: number): void => {
        if (buffer === TRANSIENT_BUFFER || buffer >= NODE_BUFFERS) return;
        drawn.add(buffer);
        if ((flags & DRAW_RANGED) === 0) return;
        if (slot !== scene.near!.chunk(buffer)?.mesh?.slot || !onCard.has(slot) || !slots.get(buffer)?.includes(MESH_SLOT)) out.push(`chunk ${buffer} draws a mesh not its own`);
      };
      for (let d = 0; d < p.drawCount; d++) ranged(p.drawBuffer[d]!, p.drawSlot[d]!, p.drawFlags[d]!);
      for (let e = 0; e < p.casterCount; e++) ranged(p.casterBuffer[e]!, p.casterSlot[e]!, p.casterFlags[e]!);
      for (const c of drawn) {
        if (scene.city!.isFar(c)) out.push(`chunk ${c} is drawn near and far`);
        const t = structs.chunks[c]!, given = slots.get(c)!, mine = scene.near!.chunk(c)?.mine;
        const meshed = given.includes(MESH_SLOT);
        const count = new Uint8Array(t.high);
        for (const s of given) if (s !== MESH_SLOT) count[s]!++;
        for (let s = 0; s < t.high; s++) {
          if (t.kind[s] === 0) continue;
          const n = count[s]! + (meshed && mine?.[s] === 1 ? 1 : 0);
          if (n !== 1) out.push(`chunk ${c} slot ${s} has ${n} owners`);
        }
      }
      return out;
    },
  };
}

test("walking and flying across chunk borders through the slice, each standing piece has one owner at every frame: its chunk's instances or its chunk's mesh", () => {
  const w = client();
  const { cam, hf } = w;
  // On foot round the slice's middle, then over it at 150 m, a frame every 3 m: the window follows, chunks come and go
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

test("a static shot away is gone from the picture the frame it goes, its chunk and those whose faces it may hold drawn as instances, and they are meshes again within a second", () => {
  const w = client();
  const { cam, city, dims, structs, scene } = w;
  // The tallest piece of the slice's busiest chunk, seen from 20 m over its top.
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
  scene.near!.pieces = FRAME_PIECES;
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

test("crossing a chunk border at the slice's densest place makes no more in a frame than a frame's pieces, what it lays out as instances counted at its share", () => {
  const w = client();
  const { cam, hf, scene } = w;
  // The window round the slice's chunk (3, 3) holds its most statics; the walk goes east from its middle over the border
  // into (4, 3), which brings a column of seven chunks. The 16 km map's slice holds 27,448 pieces, its window round (3, 3)
  // 19,162, made in 304 frames.
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

/** Whether rows `a` and `b` agree in every column of the packet named for `kind` but their runs of indices, the marks, a caster's cascades, and the material a row does not read. */
function alike(p: FramePacket, kind: "draw" | "caster", a: number, b: number): boolean {
  const flags = kind === "draw" ? p.drawFlags : p.casterFlags;
  const unread = kind === "draw" ? (flags[a]! & DRAW_TEXTURED) === 0 : (flags[a]! & DRAW_CUTOUT) === 0;
  for (const [name, column] of Object.entries(p)) {
    if (!name.startsWith(kind) || !ArrayBuffer.isView(column) || /FirstIndex|IndexCount|Joined|Cascades/.test(name) || (unread && name.endsWith("Material"))) continue;
    const values = column as unknown as ArrayLike<number>, width = values.length / (kind === "draw" ? MAX_DRAWS : MAX_CASTERS);
    for (let k = 0; k < width; k++) if (values[a * width + k] !== values[b * width + k]) return false;
  }
  return true;
}

test("on foot and over the slice, a draw or caster is marked as the one before it exactly where it differs from it only in its run of indices", () => {
  const w = client();
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
  // A chunk's mesh casts a run of its cells into each cascade, and a view that leaves out cells within a chunk draws it
  // in runs: here 7 draws and 23 casters could go in the call before them (7 and 25 on the slice before the ruins' broken
  // tops, rubble and growth, 8 and 24 after them until what the near meshes hide was left out, render/hide.ts, and 5 and
  // 23 until the street's furniture stood on its walks and tall buildings had tops, and 7 and 23 on the 8 km map's slice).
  expect([joined, cast]).toEqual([8, 23]);
});
