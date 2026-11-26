import { tierOf } from "../../client/core/assets/tiers.ts";
import { expect, test } from "bun:test";
import { Found } from "../../shared/world/structures.ts";
import { Camera, NEAR_BODY, NEAR_BODY_FAR } from "../../client/core/render/camera.ts";
import { DRAW_BLEND, DRAW_NEAR, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, DRAW_WATER, FramePacket, InstanceWriter, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { UNDERWATER_VIEW } from "../../client/core/render/shading.ts";
import { sunDirection } from "../../client/core/render/sky.ts";
import { lit, shown } from "../../client/core/render/surface.ts";
import { NODE_BUFFERS, bodySeed, type OwnBody } from "../../client/core/render/scene.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_CHEST, B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_LOWER_LEG_R, B_UPPER_CHEST, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, humanPose } from "../../shared/anim/pose.ts";
import { STANCE_CROUCH } from "../../shared/sim/character.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { flatWorld } from "../fixtures/world.ts";
import { TerrainLod } from "../../client/core/render/terrain.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL } from "../../shared/world/proving.ts";
import { provingView } from "../../tools/snap.ts";
import { INSTANCE_BYTES, parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { PICK_ENTITY, PICK_SKY, PICK_STRUCTURE, PICK_TERRAIN, Rasterizer } from "../../tools/snap/raster.ts";

const W = 320;
const H = 180;

/**
 * What of body `id`, the viewer's own, the last picture shows: whether any of its chest, a hand or a foot, and the
 * nearest any of it comes along the view, in metres, from the depth its own pass keeps (camera.ts NEAR_BODY planes).
 */
function ownView(raster: Rasterizer, id: number): { chest: boolean; hand: boolean; foot: boolean; nearest: number } {
  const seen = new Set<number>();
  let nearest = Infinity;
  for (let i = 0; i < raster.width * raster.height; i++) {
    if (raster.pickKind[i] !== PICK_ENTITY || raster.pickId[i] !== id) continue;
    seen.add(raster.pickBone[i]! - 1);
    const z = raster.depth[i]!;
    nearest = Math.min(nearest, (2 * NEAR_BODY_FAR * NEAR_BODY) / (NEAR_BODY_FAR + NEAR_BODY - z * (NEAR_BODY_FAR - NEAR_BODY)));
  }
  const any = (...bones: number[]): boolean => bones.some((b) => seen.has(b));
  return { chest: any(B_CHEST, B_UPPER_CHEST), hand: any(B_HAND_L, B_HAND_R), foot: any(B_FOOT_L, B_FOOT_R), nearest };
}

/** Ref of the structure centred exactly at (x, z). */
function refAt(view: ReturnType<typeof provingView>, x: number, z: number): number {
  const found = new Found();
  const n = view.structs.query(x - 0.1, z - 0.1, x + 0.1, z + 0.1, found);
  const refs = found.refs;
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

  // The grazer shows its species' colour through region 0.
  const survivor = pixelOf(view, 254, 0.9, 250);
  expect(raster.pickKind[survivor]).toBe(PICK_ENTITY);
  expect(raster.pickId[survivor]).toBe(101);
  const grazer = pixelOf(view, 259, 0.8, 254);
  expect(raster.pickId[grazer]).toBe(102);
  expect(raster.color[grazer * 4 + 2]!).toBeGreaterThan(raster.color[grazer * 4]! * 1.8); // teal

  const wall = pixelOf(view, 277.5, 1.5, 261.89);
  expect(raster.pickKind[wall]).toBe(PICK_STRUCTURE);
  expect(raster.pickId[wall]).toBe(refAt(view, 277.5, 262));
  const marker = pixelOf(view, 256, view.hf.heightAt(256, 350) + 5, 349.7);
  expect(raster.pickId[marker]).toBe(refAt(view, 256, 350)); // the 110 m distance marker is drawn and visible

  // Structures take one draw per mesh per chunk.
  expect(packet.uploads.length).toBeGreaterThan(0);
  // Structures, plus one for each variant of a node kind in each chunk in view, or for each of its materials and each run of
  // cells at one level where it has them (492 with the rocks of 2026-11-15, twelve meshes more), and never the same
  // instances of one mesh drawn twice alike in one depth range.
  expect(packet.drawCount).toBeLessThan(600);
  const batches = [...packet.drawBuffer.subarray(0, packet.drawCount)].map((b, d) => `${b}/${packet.drawMesh[d]}/${packet.drawFlags[d]}/${packet.drawLod[d]}/${packet.drawFirst[d]}/${packet.drawFirstIndex[d]}/${packet.drawPass[d]}`).filter((key) => !key.startsWith(`${TRANSIENT_BUFFER}/`));
  expect(new Set(batches).size).toBe(batches.length);
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

test("a node and a piece in one chunk with one slot are told apart under the pixels they cover, by their buffers and slots", () => {
  const pack = parsePack(buildPack([{ id: "test:box", lods: [boxMesh([0.5, 0.5, 0.5], 15)] }], defaultPalette()));
  const raster = new Rasterizer(W, H, pack, new Heightfield({ chunksX: 1, chunksZ: 1 }, TERRAIN_CELL, -32, 1 / 256));
  const cam = new Camera();
  cam.aspect = W / H;
  cam.update();
  const p = new FramePacket();
  p.beginFrame();
  p.viewProj.set(cam.viewProj);
  [p.fogStart, p.fogEnd] = [1e6, 2e6];
  const [chunk, slot] = [27, 3];
  // A box of chunk 27's pieces on the left and of its nodes on the right, each the instance in slot 3 of its buffer.
  [chunk, NODE_BUFFERS + chunk].forEach((buffer, d) => {
    const data = new Uint8Array(INSTANCE_BYTES);
    new InstanceWriter(data).set(0, d === 0 ? 1 : -1, 0, 5, 0, 0);
    p.uploads.push({ buffer, data, slots: Uint16Array.of(slot) });
    [p.drawMesh[d], p.drawLod[d], p.drawSlot[d], p.drawBuffer[d], p.drawFirst[d], p.drawInstances[d], p.drawFlags[d]] = [0, 0, 0, buffer, 0, 1, DRAW_PLAIN];
  });
  p.drawCount = 2;
  raster.render(p);
  const [piece, node] = [H / 2 * W + W / 2 - 20, H / 2 * W + W / 2 + 20];
  expect([raster.pickKind[piece], raster.pickKind[node]]).toEqual([PICK_STRUCTURE, PICK_STRUCTURE]);
  expect([raster.pickId[piece], raster.pickId[node]]).toEqual([chunk * 65536 + slot, (NODE_BUFFERS + chunk) * 65536 + slot]);
  expect([raster.pickDraw[piece], raster.pickDraw[node], raster.pickDraw[0]]).toEqual([0, 1, -1]);
  // In 32 bits the node's id would be the piece's.
  expect(((NODE_BUFFERS + chunk) * 65536 + slot) >>> 0).toBe(chunk * 65536 + slot);
});

test("nothing behind the camera or beyond the view distance is submitted", () => {
  const view = provingView(W, H);
  view.cam.yaw = Math.PI; // facing south, away from every structure
  const south = view.render();
  // No structure is drawn. What is left is the nodes to the south, with the water surface last, drawn on this lit tier
  // as the sea seen from above.
  expect(south.drawCount).toBeGreaterThan(1);
  for (let d = 0; d < south.drawCount - 1; d++) expect(south.drawBuffer[d]!).toBeGreaterThanOrEqual(NODE_BUFFERS);
  expect(south.drawFlags[south.drawCount - 1]).toBe(DRAW_BLEND | DRAW_WATER);
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
  // Tiles near the camera are full resolution and distant ones are coarser.
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

  // On the dry plaza the water surface is below the floor and hides nothing.
  view.cam.pitch = -0.5;
  view.render();
  const dry = rgb(at(0.5, 0.8));
  expect(Math.abs(dry[0]! - dry[2]!)).toBeLessThan(12); // grey, not blue

  // From above the pool, picking still finds the ground under the water.
  view.cam.x = PROVING_POOL.x;
  view.cam.z = PROVING_POOL.z;
  view.cam.y = 4;
  view.cam.pitch = -1.3;
  const above = view.render();
  const wet = rgb(at(0.5, 0.5));
  expect(wet[2]! - wet[0]!).toBeGreaterThan(40);
  expect(view.raster.pickKind[at(0.5, 0.5)]).toBe(PICK_TERRAIN);
  expect(above.drawFlags[above.drawCount - 1]).toBe(DRAW_BLEND | DRAW_WATER);
  // Nothing else is see-through. Nodes are drawn at their sizes.
  for (let d = 0; d < above.drawCount - 1; d++) expect(above.drawFlags[d]! & ~DRAW_SIZED).toBe(0);
  // The view is measured along the ground, so from above the pool it ends a hair past 4 km (Scene.alongGround).
  expect(above.fogEnd).toBeCloseTo(4000, 1);

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
    // Low poly's sun lies round the sky where the lit tiers' does: its bearing from north toward east, in degrees.
    const lit = [0, 0, 0];
    sunDirection(hour, lit);
    const bearing = (x: number, z: number): number => (Math.atan2(-x, z) * 180) / Math.PI;
    return { light: p.light, sunY: p.sun[1]!, sunX: p.sun[0]!, sky: p.sky[2]!, ground: view.raster.color[o]!, off: Math.abs(bearing(p.sun[0]!, p.sun[2]!) - bearing(lit[0]!, lit[2]!)) };
  };
  const noon = at(12);
  const morning = at(8);
  const evening = at(16);
  const midnight = at(0);
  expect(noon.light).toBe(1);
  expect(noon.sunY).toBeGreaterThan(0.9);
  // It rises in the east (-X) and sets in the west, as on the lit tiers.
  expect(morning.sunX).toBeLessThan(-0.2);
  expect(evening.sunX).toBeGreaterThan(0.2);
  expect([noon.off, morning.off, evening.off].every((d) => d < 0.01)).toBe(true);
  expect(morning.sunY).toBeCloseTo(evening.sunY, 5);
  // Night has 0.3 of the light and is still lit from above.
  expect(midnight.light).toBeCloseTo(0.3, 5);
  expect(midnight.sky).toBeCloseTo(noon.sky * 0.3, 5);
  expect(midnight.ground).toBeLessThan(noon.ground * 0.45);
  expect(midnight.sunY).toBeGreaterThan(0.5);
  const dusk = at(18.2);
  expect(dusk.light).toBeGreaterThan(0.3);
  expect(dusk.light).toBeLessThan(1);
});

/** World position of the middle of a bone's hit capsule, raised by `lift` in the bone's space, for remote body `i` as the scene poses it. */
function boneCentre(view: ReturnType<typeof provingView>, i: number, bone: number, lift = 0): number[] {
  const r = view.remote;
  const st = new AnimState();
  st.unpack(r.anim[i]!);
  st.seed = bodySeed(r.id[i]!);
  const pose = new Pose(HUMAN_BONES);
  const solved = new Solved(HUMAN_BONES);
  humanPose(view.scene.characters.anim, st, r.tick, pose);
  solve(HUMAN, pose, solved);
  const m = [0, 0, 0];
  const mid = (k: number): number => (HUMAN.capA[bone * 3 + k]! + HUMAN.capB[bone * 3 + k]!) / 2;
  boneToModel(solved, bone, mid(0), mid(1) + lift, mid(2), m);
  const s = Math.sin(r.yaw[i]!);
  const c = Math.cos(r.yaw[i]!);
  return [c * m[0]! + s * m[2]! + r.x[i]!, m[1]! + r.y[i]!, c * m[2]! - s * m[0]! + r.z[i]!];
}

artTest("a body with bones is drawn where its skeleton is, standing and running", () => {
  const view = provingView(W * 2, H * 2);
  const { raster, remote } = view;
  // The camera is close to the survivor and a little to one side, so neither arm hides behind the body.
  view.cam.x = 255.5;
  view.cam.z = 246.4;
  view.cam.yaw = -0.4;
  view.cam.pitch = -0.12;
  const px = (p: number[]): number => {
    const out = [0, 0, 0];
    expect(view.cam.project(p[0]!, p[1]!, p[2]!, out)).toBe(true);
    return Math.floor(out[1]! * H * 2) * W * 2 + Math.floor(out[0]! * W * 2);
  };
  const seen = (): void => {
    const packet = view.render();
    for (const bone of [B_HEAD, B_UPPER_CHEST, B_HAND_L, B_HAND_R, B_FOOT_L, B_FOOT_R, B_LOWER_LEG_R]) {
      // A hand is a few pixels across and its edge may pass by the centre's pixel, so that pixel or one beside it will do.
      const at = px(boneCentre(view, 0, bone));
      const hit = [0, -1, 1, -W * 2, W * 2].map((d) => at + d).find((k) => raster.pickKind[k] === PICK_ENTITY);
      expect([bone, hit !== undefined && raster.pickId[hit]]).toEqual([bone, 101]);
    }
    // The chest shows skin in the plain look's tone, which is warm: its red against its blue is half again what a grey
    // standing in the same light, facing the camera, shows.
    const chest = px(boneCentre(view, 0, B_UPPER_CHEST)) * 4;
    const facing = [-Math.sin(view.cam.yaw), 0, -Math.cos(view.cam.yaw)];
    const grey = [0, 0, 0];
    lit(grey, [0.2159, 0.2159, 0.2159], [1, 1, 0], facing, facing, packet.frame, [0, 0, 0]);
    shown(grey, grey, 3, packet);
    expect(raster.color[chest]! / raster.color[chest + 2]!).toBeGreaterThan((grey[0]! / grey[2]!) * 1.5);
    // Its six meshes (five slots and its hair) are drawn with bones and without the checker. The grazer beside it is still one rigid box.
    const skinned = [...packet.drawFlags.subarray(0, packet.drawCount)].filter((f) => (f & DRAW_SKINNED) !== 0);
    expect(skinned.length).toBe(6);
    for (const f of skinned) expect(f).toBe(DRAW_SKINNED | DRAW_PLAIN);
    expect(packet.boneCount).toBe(HUMAN_BONES);
    expect(view.scene.characters.posed).toBe(1);
  };
  seen();
  const idleHand = boneCentre(view, 0, B_HAND_L);
  const running = new AnimState();
  running.speed = 7;
  remote.anim[0] = running.pack();
  remote.tick = 11;
  seen();
  const runHand = boneCentre(view, 0, B_HAND_L);
  expect(Math.hypot(runHand[0]! - idleHand[0]!, runHand[1]! - idleHand[1]!, runHand[2]! - idleHand[2]!)).toBeGreaterThan(0.15);

  // Out of view, the body costs nothing.
  view.cam.yaw = Math.PI;
  const away = view.render();
  expect(view.scene.characters.posed).toBe(0);
  expect(away.boneCount).toBe(0);
});

artTest("the viewer's own body is drawn last and in front: headless from its own eyes, whole from over the shoulder", () => {
  const view = provingView(W, H);
  const { raster, reg } = view;
  const kind = reg.index.get("core:survivor")!;
  const own: OwnBody = { kind, x: 256, y: view.hf.heightAt(256, 240), z: 240, yaw: 0, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: null, gear: new Uint16Array(6), id: 7 };
  view.scene.own = own;
  view.remote.count = 0;
  view.cam.x = own.x;
  view.cam.z = own.z;
  view.cam.y = own.y + 1.62;
  view.cam.pitch = -1.35;
  own.state.setMotion(0, 0, 0, -1.35);
  const packet = view.render();
  const flags = [...packet.drawFlags.subarray(0, packet.drawCount)];
  const near = flags.filter((f) => (f & DRAW_NEAR) !== 0);
  // The four are torso, hands, legs and feet. The head it looks out of is not drawn, and neither is its hair.
  expect(near.length).toBe(4);
  expect(flags.slice(-4)).toEqual(near);
  const hidden = ["core:human_m/head", "core:human_m/hair/buzzed"].map((id) => view.pack.meshIndex.get(id)!);
  for (let d = packet.drawCount - 4; d < packet.drawCount; d++) expect(hidden).not.toContain(packet.drawMesh[d]!);
  // Looking down it sees its chest, a hand and its feet below it, and nothing of it comes near the eye.
  expect(ownView(raster, 7)).toEqual({ chest: true, hand: true, foot: true, nearest: expect.any(Number) });
  expect(ownView(raster, 7).nearest).toBeGreaterThan(0.3);
  own.state.setMotion(0, 0, 0, 0);
  view.cam.pitch = 0;
  view.render();
  let own_pixels = 0;
  for (let i = 0; i < W * H; i++) if (raster.pickKind[i] === PICK_ENTITY && raster.pickId[i] === 7) own_pixels++;
  expect(own_pixels).toBe(0);

  const vp = new Viewpoint();
  vp.thirdPerson = true;
  vp.place(view.cam, null, own.x, own.y + 1.62, own.z, 0, -0.1);
  own.firstPerson = false;
  const third = view.render();
  const all = [...third.drawFlags.subarray(0, third.drawCount)];
  expect(all.filter((f) => (f & DRAW_NEAR) !== 0).length).toBe(0);
  expect(all.filter((f) => (f & DRAW_SKINNED) !== 0).length).toBe(6);
  const out = [0, 0, 0];
  expect(view.cam.project(own.x, own.y + 1.6, own.z, out)).toBe(true);
  const head = Math.floor(out[1]! * H) * W + Math.floor(out[0]! * W);
  expect(raster.pickId[head]).toBe(7);
  // The camera is behind the body and to its right, and the body is left of centre.
  expect(view.cam.z).toBeLessThan(own.z - 3);
  expect(view.cam.x).toBeLessThan(own.x - 0.4);
  expect(out[0]!).toBeLessThan(0.5);
});

artTest("in first person a suit keeps out of the eye's way as the body does: looking down, its chest, gloves and boots below and nothing near", () => {
  const view = provingView(W, H);
  const { raster, reg } = view;
  const own: OwnBody = { kind: reg.index.get("core:survivor")!, x: 256, y: view.hf.heightAt(256, 240), z: 240, yaw: 0.4, state: new AnimState(), tick: 0, firstPerson: true, colors: new Uint8Array(6), look: null, gear: new Uint16Array(6), id: 7 };
  view.scene.own = own;
  view.remote.count = 0;
  view.cam.x = own.x;
  view.cam.z = own.z;
  view.cam.y = own.y + 1.62;
  view.cam.yaw = own.yaw;
  const near: string[] = [];
  for (const set of ["meridian", "hide"]) {
    ["hat", "shirt", "gloves", "pants", "boots"].forEach((piece, k) => (own.gear[1 + k] = reg.index.get(`core:${set}_${piece}`)!));
    for (const pitch of [-0.4, -0.8, -1.1, -1.5]) {
      view.cam.pitch = pitch;
      own.state.setMotion(0, 0, 0, pitch);
      view.render();
      const seen = ownView(raster, 7);
      // A hide shirt's collar has a flap at the jaw on the head's bone, which a look a little down sees 10 cm off.
      if (seen.nearest < 0.25 && !(set === "hide" && pitch === -0.4)) near.push(`${set} ${pitch}: ${seen.nearest.toFixed(2)} m`);
      if (pitch === -1.5) expect([set, seen.chest, seen.hand, seen.foot]).toEqual([set, true, true, true]);
    }
  }
  // Crouched the eye is a quarter of a metre over the head as a crouch poses it, and the tops of the shoulders lean in under it.
  own.state.stance = STANCE_CROUCH;
  view.cam.y = own.y + reg.move[own.kind]!.crouchEye;
  for (const set of ["meridian", "hide"]) {
    ["hat", "shirt", "gloves", "pants", "boots"].forEach((piece, k) => (own.gear[1 + k] = reg.index.get(`core:${set}_${piece}`)!));
    for (const pitch of [-0.6, -0.9]) {
      view.cam.pitch = pitch;
      own.state.setMotion(0, 0, 0, pitch);
      view.render();
      const seen = ownView(raster, 7);
      // The hide shirt's shoulder rises to the jaw, where its flap is, 13 cm off at 34 degrees down.
      if (seen.nearest < 0.18 && !(set === "hide" && pitch === -0.6)) near.push(`crouched ${set} ${pitch}: ${seen.nearest.toFixed(2)} m`);
    }
  }
  expect(near).toEqual([]);
});

test("the third-person camera is pulled in by whatever is behind the body, and first person ignores it", () => {
  const w = flatWorld();
  const cam = new Camera();
  const vp = new Viewpoint();
  vp.thirdPerson = true;
  vp.place(cam, w, 64, 1.62, 64, 0, 0);
  const open = Math.hypot(cam.x - 64, cam.y - 1.62, cam.z - 64);
  expect(open).toBeGreaterThan(3.3);
  // A wall stands a metre behind.
  w.structs.add(w.kind("core:wall"), 64, 1.5, 62.9, 0, 0, 1);
  vp.place(cam, w, 64, 1.62, 64, 0, 0);
  const blocked = Math.hypot(cam.x - 64, cam.y - 1.62, cam.z - 64);
  expect(blocked).toBeLessThan(0.9);
  expect(cam.z).toBeGreaterThan(63);
  // Looking down from above, the ground does not stop the camera. Looking up from below, it does.
  vp.place(cam, w, 64, 1.62, 70, 0, -0.6);
  expect(cam.y).toBeGreaterThan(3);
  vp.place(cam, w, 64, 1.62, 70, 0, 1.2);
  expect(cam.y).toBeGreaterThan(0.2);
  vp.thirdPerson = false;
  vp.place(cam, w, 64, 1.62, 64, 0.5, 0.2);
  expect([cam.x, cam.y, cam.z, cam.yaw, cam.pitch]).toEqual([64, 1.62, 64, 0.5, 0.2]);
});

artTest("a body is drawn coarser as it goes off, all its parts at one level, and does not flicker at the edge", () => {
  const view = provingView();
  const { remote, cam, scene, pack } = view;
  remote.count = 1;
  cam.yaw = 0;
  cam.x = remote.x[0]!;
  cam.y = remote.y[0]! + 1.6;
  /** The levels the body's meshes are drawn at from `d` metres off: one number, if its parts agree. */
  const levels = (d: number): number[] => {
    cam.z = remote.z[0]! - d;
    const p = scene.build(cam, remote);
    const out = new Set<number>();
    let parts = 0;
    for (let i = 0; i < p.drawCount; i++) {
      if (!pack.header.meshes[p.drawMesh[i]!]!.id.startsWith("core:human_")) continue;
      out.add(p.drawLod[i]!);
      parts++;
    }
    expect(parts).toBeGreaterThanOrEqual(5);
    return [...out];
  };
  // A body is four levels (tools/pack/body.ts): MakeHuman's turns at about 8, 15 and 51 m walking out on this view, its
  // second level being coarser than Quaternius's, which turned at 6, 16 and 44 m.
  expect([levels(3), levels(10), levels(27), levels(70)]).toEqual([[0], [1], [2], [3]]);
  // Seen afresh at 8 m it would be the next level. Walking out to there from near, it is still the finest.
  expect([levels(3), levels(8), levels(9.6), levels(7.1), levels(6.4)]).toEqual([[0], [0], [1], [1], [0]]);
  // Low poly starts at the first flat level, the third; it drew the second, textured, drawn flat, until it did.
  scene.assets.tier = tierOf("lowpoly");
  expect(levels(3)).toEqual([2]);
  scene.assets.tier = tierOf("ultra");
  expect([levels(10), levels(30), levels(80), levels(200)]).toEqual([[0], [1], [2], [3]]);
});

artTest("a loose thing is drawn where it stands, at a level chosen for its distance, and not when it is out of view", () => {
  const view = provingView(320, 180);
  const { scene, cam, pack } = view;
  cam.yaw = 0;
  const mesh = pack.meshIndex.get("core:raptor")!;
  const ahead = { mesh, x: cam.x, y: cam.y - 1, z: cam.z + 400, level: -1 };
  const behind = { mesh, x: cam.x, y: cam.y - 1, z: cam.z - 30, level: -1 };
  scene.things = [ahead, behind];
  const p = scene.build(cam, view.remote);
  const draws = [...Array(p.drawCount).keys()].filter((i) => p.drawMesh[i] === mesh);
  expect(draws.length).toBe(1);
  // 400 m off, a raptor is drawn coarse, and the thing remembers the level for the next frame.
  expect(p.drawLod[draws[0]!]).toBeGreaterThanOrEqual(2);
  expect([ahead.level, behind.level]).toEqual([p.drawLod[draws[0]!]!, -1]);
  ahead.z = cam.z + 8;
  scene.build(cam, view.remote);
  expect(ahead.level).toBe(0);
});
