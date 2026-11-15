import { tierOf } from "../../client/core/assets/tiers.ts";
import { expect, test } from "bun:test";
import { Found } from "../../shared/world/structures.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DRAW_BLEND, DRAW_NEAR, DRAW_PLAIN, DRAW_SIZED, DRAW_SKINNED, DRAW_WATER, FramePacket, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { UNDERWATER_VIEW } from "../../client/core/render/shading.ts";
import { sunDirection } from "../../client/core/render/sky.ts";
import { lit, shown } from "../../client/core/render/surface.ts";
import { NODE_BUFFERS, bodySeed, type OwnBody } from "../../client/core/render/scene.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_FOOT_L, B_FOOT_R, B_HAND_L, B_HAND_R, B_HEAD, B_LOWER_LEG_R, B_UPPER_CHEST, HUMAN, HUMAN_BONES, ZONE_COUNT, ZONE_HEAD, ZONE_NAMES } from "../../shared/anim/human.ts";
import { AnimState, humanPose } from "../../shared/anim/pose.ts";
import { Solved, boneToModel, solve } from "../../shared/anim/skeleton.ts";
import { rayBody, zoneOfBone } from "../../shared/anim/zones.ts";
import { STANCE_CROUCH, STANCE_PRONE } from "../../shared/sim/character.ts";
import { flatWorld } from "../fixtures/world.ts";
import { TerrainLod } from "../../client/core/render/terrain.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { PROVING_POOL, PROVING_SEA_LEVEL } from "../../shared/world/proving.ts";
import { provingView } from "../../tools/snap.ts";
import { PICK_ENTITY, PICK_SKY, PICK_STRUCTURE, PICK_TERRAIN } from "../../tools/snap/raster.ts";

const W = 320;
const H = 180;

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
  // cells at one level where it has them (437 at the art of 2026-11-15), and never two alike for one mesh in one chunk.
  expect(packet.drawCount).toBeLessThan(500);
  const batches = [...packet.drawBuffer.subarray(0, packet.drawCount)].map((b, d) => `${b}/${packet.drawMesh[d]}/${packet.drawFlags[d]}`).filter((key) => !key.startsWith(`${TRANSIENT_BUFFER}/`));
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
  expect(above.fogEnd).toBe(4000);

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

test("a body with bones is drawn where its skeleton is, standing and running", () => {
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
      const at = px(boneCentre(view, 0, bone));
      expect(raster.pickKind[at]).toBe(PICK_ENTITY);
      expect(raster.pickId[at]).toBe(101);
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

test("the viewer's own body is drawn last and in front: headless from its own eyes, whole from over the shoulder", () => {
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
  const packet = view.render();
  const flags = [...packet.drawFlags.subarray(0, packet.drawCount)];
  const near = flags.filter((f) => (f & DRAW_NEAR) !== 0);
  // The four are torso, hands, legs and feet. The head it looks out of is not drawn, and neither is its hair.
  expect(near.length).toBe(4);
  expect(flags.slice(-4)).toEqual(near);
  const hidden = ["core:human_m/head", "core:human_m/hair/buzzed"].map((id) => view.pack.meshIndex.get(id)!);
  for (let d = packet.drawCount - 4; d < packet.drawCount; d++) expect(hidden).not.toContain(packet.drawMesh[d]!);
  const mid = Math.floor(0.6 * H) * W + W / 2;
  expect(raster.pickKind[mid]).toBe(PICK_ENTITY);
  expect(raster.pickId[mid]).toBe(7);
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

test("aiming at what is drawn of a body hits it, in the zone drawn: in every pose, from every side", () => {
  const SIZE = 128;
  const view = provingView(SIZE, SIZE);
  const { raster, remote, cam } = view;
  const anim = view.scene.characters.anim;
  remote.count = 1;
  const id = remote.id[0]!;
  const bx = remote.x[0]!;
  const by = remote.y[0]!;
  const bz = remote.z[0]!;
  // drawn[z] counts pixels showing zone z, and agreed[z] those where a ray through the pixel finds zone z too.
  const drawn = new Uint32Array(ZONE_COUNT);
  const agreed = new Uint32Array(ZONE_COUNT);
  let phantom = 0;
  let empty = 0;
  let missed = 0;
  const st = new AnimState();
  const dir = [0, 0, 0];
  const states: readonly (readonly [speed: number, dirTo: number, pitch: number, mode: number, stance: number, grounded: boolean])[] = [
    [0, 0, 0, 1, 0, true], [7, 0, 0, 1, 0, true], [12, 0, 10, 1, 0, true], [7, 5, -12, 1, 0, true], [7, 8, 0, 1, 0, true],
    [0, 0, 0, 1, 0, false], [2, 0, 0, 1, STANCE_CROUCH, true], [1, 0, 8, 1, STANCE_PRONE, true], [4, 0, 14, 2, 0, false],
  ];
  let shot = 0;
  for (const [speed, dirTo, pitch, mode, stance, grounded] of states) {
    st.speed = speed;
    st.dir = dirTo;
    st.pitch = pitch;
    st.mode = mode;
    st.stance = stance;
    st.grounded = grounded;
    remote.anim[0] = st.pack();
    remote.flags[0] = grounded ? 1 : 0;
    st.seed = bodySeed(id);
    // From the front, a side, behind and above, at a different tick and facing each time.
    for (const [around, up] of [[0, 0.1], [1.4, 0.2], [3.3, 0.05], [4.6, 0.9], [0.7, -0.25]] as const) {
      const tick = shot * 7.3;
      const yawUnits = (shot * 9973) & 0xffc0; // a facing the 10-bit wire yaw can carry exactly
      shot++;
      remote.tick = tick;
      remote.yaw[0] = (yawUnits / 65536) * Math.PI * 2;
      const reach = 4;
      cam.x = bx + Math.sin(around) * Math.cos(up) * reach;
      cam.z = bz + Math.cos(around) * Math.cos(up) * reach;
      cam.y = by + 0.9 + Math.sin(up) * reach;
      cam.yaw = around + Math.PI;
      cam.pitch = -up;
      cam.fovY = 0.7;
      cam.aspect = 1;
      view.render();
      for (let py = 0; py < SIZE; py++) {
        for (let px = 0; px < SIZE; px++) {
          const at = py * SIZE + px;
          const isBody = raster.pickKind[at] === PICK_ENTITY && raster.pickId[at] === id;
          cam.ray((px + 0.5) / SIZE, (py + 0.5) / SIZE, dir);
          const hit = rayBody(anim, st, tick, bx, by, bz, yawUnits, cam.x, cam.y, cam.z, dir[0]!, dir[1]!, dir[2]!, 50);
          if (!isBody) {
            // No part of the body is drawn here, so a hit lands on thin air unless a structure is in front.
            if (hit !== 0 && raster.pickKind[at] !== PICK_STRUCTURE) phantom++;
            else empty++;
            continue;
          }
          const zone = zoneOfBone(raster.pickBone[at]! - 1);
          drawn[zone]!++;
          if (hit === zone) agreed[zone]!++;
          else if (hit === 0) missed++;
        }
      }
    }
  }
  let all = 0;
  let allAgreed = 0;
  for (let z = 1; z < ZONE_COUNT; z++) {
    all += drawn[z]!;
    allAgreed += agreed[z]!;
    // Every zone is seen, and a ray through its pixels mostly finds it. Each bone has one generous capsule, and where two
    // meet (a wrist, an ankle, an armpit) the nearer one wins, which accounts for the rest.
    expect(drawn[z]!).toBeGreaterThan(150);
    if (agreed[z]! / drawn[z]! < 0.78) throw new Error(`${ZONE_NAMES[z]}: only ${agreed[z]} of ${drawn[z]} drawn pixels are hit`);
  }
  // The head matters most. A ray through a drawn head must be a headshot.
  expect(agreed[ZONE_HEAD]! / drawn[ZONE_HEAD]!).toBeGreaterThan(0.965);
  expect(allAgreed / all).toBeGreaterThan(0.88);
  // Almost no drawn pixel misses every capsule, so aiming at the body hits the body.
  expect(missed / all).toBeLessThan(0.02);
  // The capsules are generous, so some hits land a little outside the drawn body, but not much more than its rim.
  expect(phantom / all).toBeLessThan(0.3);
  expect(empty).toBeGreaterThan(all);
});

test("a body is drawn coarser as it goes off, all its parts at one level, and does not flicker at the edge", () => {
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
  expect([levels(8), levels(25), levels(100)]).toEqual([[0], [1], [2]]);
  // Seen afresh at 15 m it would be the middle level. Walking out to there from near, it is still the finest.
  expect([levels(8), levels(15), levels(17), levels(12.5), levels(11)]).toEqual([[0], [0], [1], [1], [0]]);
  scene.assets.tier = tierOf("lowpoly");
  expect(levels(3)).toEqual([1]);
  scene.assets.tier = tierOf("ultra");
  expect([levels(30), levels(60), levels(200)]).toEqual([[0], [1], [2]]);
});

test("a scene whose levels stream never draws what the card lacks, and ends with the picture the whole pack gives", () => {
  const [whole, stream] = [provingView(320, 180), provingView(320, 180, { latencyMs: 150, bytesPerSecond: 300e3 })];
  for (const view of [whole, stream]) {
    // Three metres from the survivor, so its finest level is wanted.
    view.cam.yaw = 0;
    view.cam.x = view.remote.x[0]!;
    view.cam.y = view.remote.y[0]! + 1.5;
    view.cam.z = view.remote.z[0]! - 3;
  }
  whole.render();
  const first = stream.render();
  // The first frame has the boot pack alone: every body part at its coarsest, and nothing left out.
  const head = stream.pack.meshIndex.get("core:human_m/head")!;
  const level = (p: typeof first): number => p.drawLod[[...Array(p.drawCount).keys()].find((i) => p.drawMesh[i] === head)!]!;
  expect([level(first), first.skipped, first.drawCount]).toEqual([2, 0, whole.scene.packet.drawCount]);
  expect(stream.raster.color).not.toEqual(whole.raster.color);
  let uploads = first.assetUploads.length;
  // The rasterizer throws at a draw of anything not uploaded, so each of these frames is a check.
  for (let ms = 100; ms <= 6000; ms += 100) {
    stream.port!.advance(ms);
    stream.scene.now = ms;
    uploads += stream.render().assetUploads.length;
  }
  expect([level(stream.scene.packet), stream.scene.assets.residency.flying]).toEqual([0, 0]);
  expect(uploads).toBeGreaterThan(first.assetUploads.length + 4);
  expect(stream.raster.color).toEqual(whole.raster.color);
});

test("a loose thing is drawn where it stands, at a level chosen for its distance, and not when it is out of view", () => {
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
