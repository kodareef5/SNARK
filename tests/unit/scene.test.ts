// The scene drawing with materials: what it asks of the asset library, what it puts in a frame packet, and what the
// software rasterizer makes of the packet.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_ONE_BONE, DRAW_TEXTURED, type FramePacket } from "../../client/core/render/packet.ts";
import type { OwnBody } from "../../client/core/render/scene.ts";
import { Falling } from "../../client/core/rubble.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { hashBytes } from "../../shared/hash.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { CLUB, PANEL, POST, sceneWorld } from "../fixtures/sceneworld.ts";
import { TUBE } from "../fixtures/textured.ts";

/** Everything a renderer reads of a frame but its texture work, hashed onto `h`. */
function hashPacket(p: FramePacket, h: number): number {
  const add = (a: ArrayBufferView, n = a.byteLength): void => void (h = hashBytes(new Uint8Array(a.buffer, a.byteOffset, n), h));
  const count = (...n: number[]): void => add(Float64Array.from(n));
  for (const a of [p.viewProj, p.nearViewProj, p.sky, p.sun]) add(a);
  count(p.camX, p.camY, p.camZ, p.light, p.fogStart, p.fogEnd, p.skipped, p.dropped, p.triangles, p.drawCount, p.tileCount, p.transientCount, p.boneCount);
  for (const a of [p.drawMesh, p.drawLod, p.drawSlot, p.drawBuffer, p.drawFirst, p.drawInstances, p.drawFlags]) add(a, p.drawCount * a.BYTES_PER_ELEMENT);
  add(p.drawOffset, p.drawCount * 12);
  add(p.tiles, p.tileCount * 16);
  add(p.tileOrigin, p.tileCount * 8);
  add(p.transient, p.transientCount * INSTANCE_BYTES);
  add(p.transientIds, p.transientCount * 4);
  add(p.bones, p.boneCount * 48);
  for (const u of p.uploads) {
    count(u.buffer);
    add(u.data);
    add(u.slots);
  }
  for (const u of p.assetUploads) {
    count(u.slot, u.mesh, u.level, u.indexCount, u.indexBytes, u.of ?? -1, u.skinAt ?? -1);
    add(u.data);
  }
  count(...p.drops, -1, ...p.assetDrops);
  return h;
}

test("low poly asks for no surface and no texture, draws nothing with a material, and its packets are what they were", () => {
  const w = sceneWorld({ latencyMs: 40, bytesPerSecond: 150e3, loss: 0.7, seed: 1 }, tierOf("lowpoly"));
  const { scene, cam, remote, structs, nodes, kind } = w;
  w.hf.seaLevel = -0.5;
  // One of everything the scene draws: pieces in two chunks, nodes, bodies of both kinds, one young, one riding, things
  // in hands, a rigid creature, an arrow where it landed, the viewer's own body, beams, a ghost, falling pieces and loose things.
  for (let i = 0; i < 10; i++) structs.add(kind(PANEL), 22 + i * 2, 0, 34, 0, 0, 1);
  for (let i = 0; i < 6; i++) structs.add(kind(i % 2 ? "core:wall" : "core:foundation"), 58 + i * 3, 1.5, 40, 16384 * i, 0, 1);
  for (let i = 0; i < 4; i++) nodes.add(kind(i % 2 ? "core:tree" : "core:rock"), 20 + i * 9, 2, 46, 0, 0, 1);
  for (let i = 0; i < 8; i++) w.place(TUBE, 24 + i * 2.5, 23 + i * 5, { colors: [8, 7, 14, 6], yaw: i });
  [remote.span[3], remote.grown[3]] = [1000, 800];
  w.place("core:survivor", 30, 24, { held: CLUB });
  const looked = w.place("core:survivor", 33, 27, { held: "core:hatchet", colors: [3, 4, 5] });
  remote.hasLook[looked] = 1;
  remote.seat[w.place("core:survivor", 36, 30)] = remote.id[0]! + 1;
  w.place("core:grazer", 28, 31);
  w.place(POST, 34, 29);
  remote.anim[w.place("core:arrow_stuck", 31, 22)] = 9 << 12;
  const own: OwnBody = { kind: kind("core:survivor"), x: 32, y: 0, z: 19, yaw: 0, state: new AnimState(), tick: 0, firstPerson: false, colors: new Uint8Array(6), look: null, gear: Uint16Array.of(kind(CLUB), 0, 0, 0, 0, 0), id: 7 };
  scene.own = own;
  scene.beams.push(40, 0, 50, 70, 0, 60);
  Object.assign(scene.ghost, { kind: kind(PANEL), x: 31, y: 0, z: 25, color: 9 });
  const falling = (scene.falling = new Falling(w.reg.halfY, () => 0));
  falling.count = 2;
  [falling.kind[0], falling.x[0], falling.y[0], falling.z[0], falling.kind[1], falling.x[1], falling.y[1], falling.z[1]] = [kind(PANEL), 29, 2, 28, kind("core:wall"), 35, 3, 29];
  scene.things = [{ mesh: w.mesh(TUBE), x: 26, y: 0, z: 36, level: -1 }, { mesh: w.mesh("core:crate"), x: 38, y: 0.5, z: 33, level: -1 }];

  let hash = 0;
  let [draws, rigid, uploads] = [0, 0, 0];
  for (let f = 0; f < 300; f++) {
    cam.yaw = Math.sin(f / 40) * 0.7;
    cam.z = 20 + f / 30;
    cam.pitch = -0.1 + Math.cos(f / 25) * 0.1;
    remote.tick = own.tick = f / 2;
    scene.hour = 6 + f / 30;
    own.firstPerson = f >= 150;
    // A piece goes and another comes, and later the frame has bones for few of the bodies.
    if (f === 100) structs.add(kind(PANEL), 42, 0, 34, 0, 0, 1);
    if (f === 200) scene.assets.tier = { ...tierOf("lowpoly"), bones: 40 };
    const p = w.frame(1000 / 60, false);
    hash = hashPacket(p, hash);
    draws += p.drawCount;
    uploads += p.assetUploads.length;
    for (let d = 0; d < p.drawCount; d++) {
      expect(p.drawFlags[d]! & DRAW_TEXTURED).toBe(0);
      if ((p.drawFlags[d]! & DRAW_ONE_BONE) !== 0) rigid++;
    }
    expect([p.texUploads.length, p.texDrops.length, p.assetUploads.filter((u) => u.of !== undefined).length, p.skipped, p.dropped]).toEqual([0, 0, 0, 0, 0]);
  }
  // All it asked the network for was the finest level of the tube, for the post, no more urgently than it ever did,
  // and again when the request was lost.
  const post = scene.assets.residency.slot(w.mesh(TUBE), 0);
  expect(w.port.log).toEqual([`17 ask ${post} 0.0000`, `1167 ask ${post} 0.0000`, `2733 ask ${post} 0.0000`]);
  expect([draws, rigid, uploads, scene.assets.residency.texLedger]).toEqual([7643, 767, 20, 0]);
  // Taken from the scene as it was before it drew anything with a material. A change here changes what low poly draws.
  expect(hash).toBe(3946682517);
});
