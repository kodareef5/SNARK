// The near city as a mesh a chunk (client/core/render/nearcity.ts) on the Miami slice: the same picture as the instances,
// one owner a piece wherever the camera goes, a static shot away gone the frame it goes, and a border crossed within a
// frame's making.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FarStore } from "../../client/core/farcells.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { BAND_PIECES, FRAME_PIECES, LAID_SHARE, MESH_SLOT } from "../../client/core/render/nearcity.ts";
import { DRAW_RANGED, TRANSIENT_BUFFER, type FramePacket } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS, Scene } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { CityStatics } from "../../shared/world/city.ts";
import { mapHeightfield } from "../../shared/world/mapfile.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { compareShot, nearShots } from "../../tools/snap/nearcity.ts";
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

test("a downtown chunk and those round it rasterize the same as a mesh a chunk as an instance a piece, at its border with a neighbour drawn as instances and against a player's wall and foundation, on high and low poly", () => {
  const shots = nearShots();
  expect(shots.map((s) => s.name)).toEqual(["border-along-0", "border-across-1", "border-along-2", "border-across-3", "border-over", "player-wall", "player-floor"]);
  const [W, H] = [480, 270];
  const plays: [string, readonly string[]][] = [["high", shots.map((s) => s.name)], ["lowpoly", ["border-across-1", "border-over", "player-floor"]]];
  for (const [tier, names] of plays) {
    for (const shot of shots.filter((s) => names.includes(s.name))) {
      const { counts } = compareShot(shot, tier, W, H);
      // A surface off by more than a step of the lattice or of the depth buffer: single pixels along an edge where a
      // corner moved under a millimetre, and on low poly where the checker's lines moved with it.
      expect({ tier, shot: shot.name, off: counts.farther + counts.nearer <= 0.0003 * W * H }).toEqual({ tier, shot: shot.name, off: true });
      // In the same place another face of two shown: where two of the map's pieces overlap in one plane, which fight on a card either way.
      expect({ tier, shot: shot.name, same: counts.same <= 0.005 * W * H }).toEqual({ tier, shot: shot.name, same: true });
    }
  }
});

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
  scene.near!.pieces = 1000;
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
  let frames = 1;
  while (frames < 60 && [...structs.held].some((c) => !scene.near!.chunk(c)?.mesh)) {
    p = w.frame();
    raster.render(p);
    expect(w.owners(p)).toEqual([]);
    frames++;
  }
  expect(frames).toBeLessThan(60);
});

test("crossing a chunk border at the slice's densest place makes no more in a frame than a frame's pieces, what it lays out as instances counted at its share", () => {
  const w = client();
  const { cam, hf, scene } = w;
  // The window round the slice's chunk (3, 3) holds its most statics; the walk goes east from its middle over the border
  // into (4, 3), which brings a column of seven chunks.
  let x = 3.5 * CHUNK_SIZE;
  const z = 3.5 * CHUNK_SIZE;
  [cam.x, cam.z, cam.y, cam.yaw] = [x, z, hf.heightAt(x, z) + 1.7, Math.PI / 2];
  w.follow(x, z);
  for (let f = 0; f < 300 && (f < 2 || scene.near!.stats.waiting > 0); f++) w.frame();
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
  const brought = Array.from({ length: 7 }, (_, j) => j * w.dims.chunksX + 7).reduce((n, c) => n + scene.near!.chunk(c)!.mine.reduce((m, v) => m + v, 0), 0);
  expect(frames.reduce((n, f) => n + f.made, 0)).toBe(brought);
  expect(scene.near!.stats.waiting).toBe(0);
  // Each frame makes a band at most where it laid nothing out, and otherwise what is left of its pieces.
  const over = frames.filter((f) => f.made > 0 && f.made + f.laid * LAID_SHARE > FRAME_PIECES && !(f.laid === 0 && f.steps === 1));
  expect(over).toEqual([]);
  expect(Math.max(...frames.map((f) => f.made))).toBeLessThanOrEqual(BAND_PIECES);
});
