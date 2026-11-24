// The near city as a mesh a chunk (client/core/render/nearcity.ts) on the Miami slice: the same picture as the instances,
// and the rules nearcity.test.ts holds on a small city, walked here through a real downtown's 28,000 pieces.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FRAME_PIECES, LAID_SHARE, MESH_SLOT, nearMeshSlot, pieceWeight } from "../../client/core/render/nearcity.ts";
import { PIECE_KEYS } from "../../client/core/render/pieces.ts";
import { DRAW_RANGED, DRAW_TEXTURED } from "../../client/core/render/packet.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { compareShot, nearShots } from "../../tools/snap/nearcity.ts";
import { PICK_STRUCTURE, Rasterizer } from "../../tools/snap/raster.ts";
import { miamiSlice } from "../fixtures/cityslice.ts";
import { farPack } from "../fixtures/farworld.ts";
import { alike, nearClient, shareAlike, shotOf } from "../fixtures/nearclient.ts";

test("a downtown chunk and those round it rasterize the same as a mesh a chunk as an instance a piece, at its border with a neighbour drawn as instances and against a player's wall and foundation, on high and low poly", () => {
  const shots = nearShots();
  expect(shots.map((s) => s.name)).toEqual(["border-along-0", "border-across-1", "border-along-2", "border-across-3", "border-over", "player-wall", "player-floor"]);
  const [W, H] = [480, 270];
  const plays: [string, readonly string[]][] = [["high", shots.map((s) => s.name)], ["lowpoly", ["border-across-1", "border-over", "player-floor"]]];
  for (const [tier, names] of plays) {
    for (const shot of shots.filter((s) => names.includes(s.name))) {
      const { counts, instances, mesh } = compareShot(shot, tier, W, H);
      expect(instances.pickKind.includes(PICK_STRUCTURE)).toBe(true);
      expect(mesh.pickKind.includes(PICK_STRUCTURE)).toBe(true);
      // A surface off by more than a step of the lattice or of the depth buffer: single pixels along an edge where a
      // corner moved under a millimetre, and on low poly where the checker's lines moved with it.
      expect({ tier, shot: shot.name, off: counts.farther + counts.nearer <= 0.0003 * W * H }).toEqual({ tier, shot: shot.name, off: true });
      // In the same place another face of two shown: where two of the map's pieces overlap in one plane (a balcony laid
      // into a floor slab at its height), which fight on a card either way and of which the rasterizer shows the first drawn.
      expect({ tier, shot: shot.name, same: counts.same <= 0.05 * W * H }).toEqual({ tier, shot: shot.name, same: true });
    }
  }
});

test("across the Miami slice each standing piece has one owner every frame", () => {
  const w = nearClient(miamiSlice().map);
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

test("a static of the slice shot away is gone that frame, with no mesh let go and nothing laid out", () => {
  const w = nearClient(miamiSlice().map);
  const { cam, city, dims, structs, scene } = w;
  const near = scene.near!;
  // The tallest piece of the slice's busiest chunk, seen from 20 m over its top.
  const chunk = 3 * dims.chunksX + 1;
  let top = -Infinity, slot = -1;
  for (let s = 0; s < city.in(chunk); s++) {
    const i = city.first[chunk]! + s, k = city.kind[i]!;
    if (near.kinds[k] === 1 && city.y[i]! + city.halfY[k]! > top) [top, slot] = [city.y[i]! + city.halfY[k]!, s];
  }
  const i = city.first[chunk]! + slot;
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [city.x[i]!, top + 20, city.z[i]! - 0.01, 0, -Math.PI / 2 + 0.01];
  w.follow(cam.x, cam.z);
  near.pieces = Infinity;
  const raster = new Rasterizer(64, 36, farPack(), w.hf);
  for (let f = 0; f < 10; f++) raster.render(w.frame());
  near.pieces = FRAME_PIECES;
  let p = w.frame();
  raster.render(p);
  // The pixel at the middle of the picture shows the piece's top, from its chunk's mesh.
  const middle = 18 * 64 + 32;
  expect(raster.pickId[middle]).toBe(chunk * 65536 + MESH_SLOT);
  const before = raster.depth[middle]!;
  const old = new Map([...structs.held].map((c) => [c, near.chunk(c)!.mesh]));
  w.remove(chunk, slot);
  p = w.frame();
  raster.render(p);
  expect(raster.depth[middle]).toBeGreaterThan(before);
  expect(w.owners(p)).toEqual([]);
  // Nothing went on or came off the card but the piece's state, and every chunk draws the mesh it had.
  expect([p.assetDrops.filter(nearMeshSlot).length, p.assetUploads.filter((u) => nearMeshSlot(u.slot)).length, p.uploads.length, near.stats.laid, near.stats.waiting]).toEqual([0, 0, 0, 0, 0]);
  for (const [c, was] of old) expect(near.chunk(c)!.mesh).toBe(was);
  expect(near.stats.states).toBeGreaterThan(0);
  expect(near.stats.states).toBeLessThanOrEqual(PIECE_KEYS * 4);
  // Quiet, its chunk's mesh alone is made again, a band a frame, the old one drawn until the new is on the card.
  let remade = 0;
  for (let f = 0; f < 720; f++) {
    raster.render((p = w.frame()));
    expect(near.chunk(chunk)!.mesh).not.toBeNull();
    expect(near.stats.laid).toBe(0);
    remade += near.stats.remade;
    for (const [c, was] of old) if (c !== chunk) expect(near.chunk(c)!.mesh).toBe(was);
  }
  expect([remade, near.chunk(chunk)!.stale, near.chunk(chunk)!.mesh === old.get(chunk), w.owners(p)]).toEqual([1, false, false, []]);
  expect(raster.depth[middle]).toBeGreaterThan(before);
});

test("the slice's old meshes and their pieces' states draw what meshes made of what stands do, for removals at random", () => {
  const map = miamiSlice().map, split = tierOf("high").split;
  const rng = new Rng(5);
  const views: [number, number, number, number, number][] = [[290, 290, 1.7, 0.6, 0.05], [300, 300, 90, 2.2, -0.7], [226, 226, 30, 0.8, -0.25]];
  const shares: number[] = [];
  for (let trial = 0; trial < 3; trial++) {
    const [x, z, up, yaw, pitch] = views[trial]!;
    // One client loses pieces after its meshes are made; the other never had them.
    const [old, fresh] = [nearClient(map), nearClient(map)];
    const gone: [number, number][] = [];
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    for (let n = 0; n < 60 + trial * 300; n++) {
      const chunk = (cz + rng.int(3) - 1) * map.dims.chunksX + cx + rng.int(3) - 1;
      gone.push([chunk, rng.int(old.city.in(chunk))]);
    }
    const shots = [old, fresh].map((w, k) => {
      [w.cam.x, w.cam.z, w.cam.y, w.cam.yaw, w.cam.pitch] = [x, z, w.hf.heightAt(x, z) + up, yaw, pitch];
      w.scene.near!.pieces = Infinity;
      w.follow(x, z);
      if (k === 1) for (const [chunk, slot] of gone) w.remove(chunk, slot);
      const raster = new Rasterizer(240, 135, farPack(), w.hf);
      raster.depthBits = 24;
      for (let f = 0; f < 4; f++) raster.render(w.frame());
      const meshes = [...w.structs.held].map((c) => w.scene.near!.chunk(c)!.mesh);
      if (k === 0) for (const [chunk, slot] of gone) w.remove(chunk, slot);
      const p = w.frame();
      raster.render(p);
      expect(w.owners(p)).toEqual([]);
      if (k === 0) expect([...w.structs.held].map((c) => w.scene.near!.chunk(c)!.mesh)).toEqual(meshes);
      return shotOf(raster);
    });
    shares.push(shareAlike(shots[0]!, shots[1]!, old.cam, split));
  }
  expect(Math.min(...shares)).toBeGreaterThanOrEqual(0.995);
});

test("the slice's densest border crossed makes no more a frame than its pieces", () => {
  const w = nearClient(miamiSlice().map);
  const { cam, hf, scene } = w;
  // The window round the slice's chunk (3, 3) holds its most statics; the walk goes east from its middle over the border
  // into (4, 3), which brings a column of seven chunks. The 16 km map's slice holds 27,978 pieces, its window round (3, 3)
  // 19,557, made in 300 frames.
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

test("over the slice a draw or caster is marked only where it repeats the last", () => {
  const w = nearClient(miamiSlice().map);
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
  // in runs: here 9 draws and 23 casters could go in the call before them (7 and 25 on the slice before the ruins' broken
  // tops, rubble and growth, 8 and 24 after them until what the near meshes hide was left out, render/hide.ts, 5 and 23
  // until the street's furniture stood on its walks and tall buildings had tops, 7 and 23 on the 8 km map's slice, and 8
  // and 23 before a shop's front had its frame, sill and drip, content/ruins.ts SHOP_FRAME).
  expect([joined, cast]).toEqual([9, 23]);
});
