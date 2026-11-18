import { expect, test } from "bun:test";
import { TreeFalls } from "../../client/core/tree-fall.ts";
import type { TreePresentationEvent } from "../../client/core/vehicle-trees.ts";
import { DRAW_ONE_BONE, DRAW_SKINNED, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { BuildSounds } from "../../client/core/sound/build.ts";
import { cueKey } from "../../shared/sound/cues.ts";
import { WOOD, nodeWorld } from "../fixtures/nodeworld.ts";
import { coreRegistry } from "../fixtures/world.ts";
const event: TreePresentationEvent = { action: "break", ref: 0, kind: 1, form: 1, x: 64, y: 0, z: 64, yaw: 0, dx: 0, dz: 1, tick: 1 };

test("cosmetic tree falls follow the impact direction, remain bounded, survive confirmation and cancel on rejection", () => {
  const falls = new TreeFalls(); falls.add(event, 100);
  let pose = new Float64Array(12); falls.frame(100, (_event, frame) => pose.set(frame));
  expect(pose[5]).toBe(1); expect(pose[9]).toBe(0); expect(pose[11]).toBe(64);
  falls.frame(600, (_event, frame) => pose.set(frame)); expect(pose[9]!).toBeGreaterThan(.2); expect(pose[5]!).toBeLessThan(1);
  falls.add({ ...event, action: "confirm" }, 600); expect(falls.count).toBe(1);
  falls.add({ ...event, action: "revoke" }, 600); expect(falls.count).toBe(0);
  for (let ref = 0; ref < 100; ref++) falls.add({ ...event, ref }, 1000);
  expect(falls.count).toBe(16); let drawn = 0; falls.frame(1500, (_event, frame) => { drawn++; expect([...frame].every(Number.isFinite)).toBe(true); });
  expect(drawn).toBe(16); falls.frame(2400, () => { throw new Error("expired fall drawn"); }); expect(falls.count).toBe(0);
});

test("the actual scene renders the existing tree mesh with a bounded single-bone fall and drops it on expiry", () => {
  const w = nodeWorld({ chunksX: 4, chunksZ: 4, kinds: [WOOD], perChunk: 1 });
  w.stand(100, 100); const spot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 }; w.source.at(5, 0, spot);
  w.look(spot.x, spot.y + 3, spot.z - 15, 0); const ref = 5 * 65536;
  w.frame(); w.scene.hideNode(ref, true); w.scene.treeFalls.add({ ...event, ...spot, ref }, w.scene.now);
  const p = w.frame(), mesh = w.scene.assets.table.find(w.field.forms.mesh[spot.form]!);
  const draws = Array.from({ length: p.drawCount }, (_, i) => i).filter(i => p.drawBuffer[i] === TRANSIENT_BUFFER && p.drawMesh[i] === mesh);
  expect(draws.length).toBeGreaterThan(0);
  expect(draws.every(i => (p.drawFlags[i]! & (DRAW_ONE_BONE | DRAW_SKINNED)) === (DRAW_ONE_BONE | DRAW_SKINNED))).toBe(true);
  expect(p.boneCount).toBe(1); expect(w.field.store.chunks[5]!.kind[0]).toBe(spot.form);
  w.scene.now += 1500; w.frame(); expect(w.scene.treeFalls.count).toBe(0);
});

test("tree impact feedback layers existing wood and hull sounds once per queued impact", () => {
  const reg = coreRegistry(), sounds = new BuildSounds(reg, () => -1), heard: number[] = [];
  sounds.treeImpact(reg.index.get("core:tree")!, 1, 2, 3);
  const hear = (_owner: number, cue: number) => heard.push(cue);
  sounds.update(1, 2, 3, hear, () => {}); sounds.update(1, 2, 3, hear, () => {});
  expect(heard).toEqual([cueKey("felled"), cueKey("hit/metal")]);
});
