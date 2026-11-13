import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_BLEND, FramePacket } from "../../client/core/render/packet.ts";
import { UNDERWATER_VIEW } from "../../client/core/render/shading.ts";
import { NODE_BUFFERS } from "../../client/core/render/scene.ts";
import { TerrainLod } from "../../client/core/render/terrain.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL } from "../../shared/world/proving.ts";
import { provingView } from "../../tools/snap.ts";
import { PICK_ENTITY, PICK_SKY, PICK_STRUCTURE, PICK_TERRAIN } from "../../tools/snap/raster.ts";

const W = 320;
const H = 180;

/** Ref of the structure centred exactly at (x, z). */
function refAt(view: ReturnType<typeof provingView>, x: number, z: number): number {
  const refs = new Uint32Array(16);
  const n = view.structs.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, refs);
  for (let i = 0; i < n; i++) {
    const t = view.structs.chunks[Math.floor(refs[i]! / 65536)]!;
    if (t.x[refs[i]! & 0xffff] === x && t.z[refs[i]! & 0xffff] === z) return refs[i]!;
  }
  throw new Error(`no structure at ${x}, ${z}`);
}

function pixelOf(view: ReturnType<typeof provingView>, x: number, y: number, z: number): number {
  const out = [0, 0, 0];
  expect(view.cam.project(x, y, z, out)).toBe(true);
  return Math.floor(out[1]! * H) * W + Math.floor(out[0]! * W);
}

test("the frame from the spawn point shows the right thing under known pixels", () => {
  const view = provingView(W, H);
  view.cam.pitch = -0.07;
  view.cam.x -= 1.5; // off the line of pillars, which would hide the distance marker behind them
  const packet = view.render();
  const { raster, reg } = view;

  expect(raster.pickKind[W * 2 + W / 2]).toBe(PICK_SKY);
  expect(raster.pickKind[W * (H - 2) + W / 2]).toBe(PICK_TERRAIN);

  // The two bodies, by entity id, with their species colour through region 0.
  const survivor = pixelOf(view, 254, 0.9, 250);
  expect(raster.pickKind[survivor]).toBe(PICK_ENTITY);
  expect(raster.pickId[survivor]).toBe(101);
  expect(raster.color[survivor * 4]!).toBeGreaterThan(raster.color[survivor * 4 + 1]! * 1.8); // red
  const grazer = pixelOf(view, 259, 0.8, 254);
  expect(raster.pickId[grazer]).toBe(102);
  expect(raster.color[grazer * 4 + 2]!).toBeGreaterThan(raster.color[grazer * 4]! * 1.8); // teal

  // A specific wall segment and a specific pillar, by structure ref.
  const wall = pixelOf(view, 277.5, 1.5, 261.89);
  expect(raster.pickKind[wall]).toBe(PICK_STRUCTURE);
  expect(raster.pickId[wall]).toBe(refAt(view, 277.5, 262));
  const marker = pixelOf(view, 256, view.hf.heightAt(256, 350) + 5, 349.7);
  expect(raster.pickId[marker]).toBe(refAt(view, 256, 350)); // the 110 m distance marker is drawn and visible

  // Every structure draw references a buffer uploaded in this or an earlier packet; one draw per mesh per chunk.
  expect(packet.uploads.length).toBeGreaterThan(0);
  expect(packet.drawCount).toBeLessThan(120); // structures, plus up to three kinds of node per chunk in view
  expect(packet.tileCount).toBeGreaterThan(10);
  const wallMesh = view.scene.meshOfKind[reg.index.get("core:wall")!]!;
  expect([...packet.drawMesh.subarray(0, packet.drawCount)]).toContain(wallMesh);
});

test("instance buffers are uploaded once, again only when their chunk changes, and dropped with it", () => {
  const view = provingView(W, H);
  const first = view.render();
  const uploaded = first.uploads.map((u) => u.buffer);
  expect(uploaded.length).toBeGreaterThan(2);
  expect(view.render().uploads.length).toBe(0);

  const ref = view.structs.add(view.reg.index.get("core:crate")!, 256, 0.5, 250, 0, 0, 1);
  const chunk = Math.floor(ref / 65536);
  const second = view.render();
  expect(second.uploads.map((u) => u.buffer)).toEqual([chunk]);
  const px = pixelOf(view, 256, 0.5, 249.4);
  expect(view.raster.pickId[px]).toBe(ref);

  view.structs.dropChunk(chunk);
  const third = view.render();
  expect(third.drops).toEqual([chunk]);
  expect(third.uploads.length).toBe(0);
  expect(view.raster.pickKind[px]).not.toBe(PICK_STRUCTURE);
});

test("nothing behind the camera or beyond the view distance is submitted", () => {
  const view = provingView(W, H);
  view.cam.yaw = Math.PI; // facing south, away from every structure
  const south = view.render();
  // No structure is drawn: what is left is trees, rocks and bushes to the south, and the water surface last.
  expect(south.drawCount).toBeGreaterThan(1);
  for (let d = 0; d < south.drawCount - 1; d++) expect(south.drawBuffer[d]!).toBeGreaterThanOrEqual(NODE_BUFFERS);
  expect(south.drawFlags[south.drawCount - 1]).toBe(DRAW_BLEND);
  expect(south.tileCount).toBeGreaterThan(0);

  view.cam.yaw = 0;
  view.scene.viewDistance = 60;
  const near = view.render(); // the packet object is reused, so read it before the next build
  const nearTiles = near.tileCount;
  const nearDraws = near.drawCount;
  view.scene.viewDistance = 4000;
  const full = view.render();
  expect(nearTiles).toBeLessThan(full.tileCount);
  expect(nearDraws).toBeLessThan(full.drawCount);
});

test("terrain cost follows the view, not the map: a 2 km map selects a bounded set of tiles", () => {
  const dims = { chunksX: 32, chunksZ: 32 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.setSample(i, j, 20 * Math.sin(i / 37) * Math.cos(j / 53));
  const lod = new TerrainLod(hf);
  const cam = new Camera();
  cam.x = 64;
  cam.z = 64;
  cam.y = hf.heightAt(64, 64) + 2;
  cam.yaw = Math.PI / 4; // looking across the map's diagonal, 2.8 km
  cam.update();
  const packet = new FramePacket();
  lod.select(cam, packet, 4000);
  expect(packet.tileCount).toBeGreaterThan(20);
  expect(packet.tileCount).toBeLessThan(160);
  // Tiles near the camera are full resolution; distant ones are coarser.
  let nearestStride = Infinity;
  let coarsest = 0;
  for (let t = 0; t < packet.tileCount; t++) {
    const stride = packet.tiles[t * 4 + 3]!;
    coarsest = Math.max(coarsest, stride);
    const size = packet.tiles[t * 4 + 2]! * 32;
    const x = packet.tiles[t * 4]!;
    const z = packet.tiles[t * 4 + 1]!;
    if (x <= 0 && x + size >= 0 && z <= 0 && z + size >= 0) nearestStride = stride;
  }
  expect(nearestStride).toBe(1);
  expect(coarsest).toBeGreaterThanOrEqual(8);
});

test("water lies over the pool, tints what is under it, and changes the view from below", () => {
  const view = provingView(W, H);
  const at = (x: number, y: number): number => Math.floor(y * H) * W + Math.floor(x * W);
  const rgb = (i: number): number[] => [...view.raster.color.subarray(i * 4, i * 4 + 3)];

  // Standing on the dry plaza looking at the plaza: the surface is below the floor and hides nothing.
  view.cam.pitch = -0.5;
  view.render();
  const dry = rgb(at(0.5, 0.8));
  expect(Math.abs(dry[0]! - dry[2]!)).toBeLessThan(12); // grey, not blue

  // Above the pool looking down: the bottom shows through, tinted blue. Picking still finds the ground.
  view.cam.x = PROVING_POOL.x;
  view.cam.z = PROVING_POOL.z;
  view.cam.y = 4;
  view.cam.pitch = -1.3;
  const above = view.render();
  const wet = rgb(at(0.5, 0.5));
  expect(wet[2]! - wet[0]!).toBeGreaterThan(40);
  expect(view.raster.pickKind[at(0.5, 0.5)]).toBe(PICK_TERRAIN);
  expect(above.drawFlags[above.drawCount - 1]).toBe(DRAW_BLEND);
  for (let d = 0; d < above.drawCount - 1; d++) expect(above.drawFlags[d]).toBe(0);
  expect(above.fogEnd).toBe(4000);

  // Below the surface: a short, dim view, and the surface is still drawn overhead.
  view.cam.y = PROVING_SEA_LEVEL - 3;
  view.cam.pitch = 1.3;
  const below = view.render();
  expect(below.fogEnd).toBe(UNDERWATER_VIEW);
  expect(below.sky[2]!).toBeLessThan(0.45);
  const up = rgb(at(0.5, 0.5));
  expect(up[2]!).toBeGreaterThan(up[0]! + 30);
  expect(below.drawFlags[below.drawCount - 1]).toBe(DRAW_BLEND);
});

test("the hour moves the sun and dims the world at night; noon is what every other test sees", () => {
  const view = provingView(W, H);
  const at = (hour: number) => {
    view.scene.hour = hour;
    const p = view.render();
    const o = (Math.floor(0.9 * H) * W + Math.floor(0.5 * W)) * 4; // plaza at the bottom of the frame
    return { light: p.light, sunY: p.sun[1]!, sunX: p.sun[0]!, sky: p.sky[2]!, ground: view.raster.color[o]! };
  };
  const noon = at(12);
  const morning = at(8);
  const evening = at(16);
  const midnight = at(0);
  expect(noon.light).toBe(1);
  expect(noon.sunY).toBeGreaterThan(0.9);
  // The sun is on one side in the morning and on the other in the evening, at the same height.
  expect(morning.sunX).toBeGreaterThan(0.2);
  expect(evening.sunX).toBeLessThan(-0.2);
  expect(morning.sunY).toBeCloseTo(evening.sunY, 5);
  // Night: a third of the light, a darker sky, darker ground, and still lit from above.
  expect(midnight.light).toBeCloseTo(0.3, 5);
  expect(midnight.sky).toBeCloseTo(noon.sky * 0.3, 5);
  expect(midnight.ground).toBeLessThan(noon.ground * 0.45);
  expect(midnight.sunY).toBeGreaterThan(0.5);
  // Dusk is between the two.
  const dusk = at(18.2);
  expect(dusk.light).toBeGreaterThan(0.3);
  expect(dusk.light).toBeLessThan(1);
});
