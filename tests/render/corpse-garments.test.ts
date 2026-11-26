// A survivor's body wears what it died in (server/corpses.ts keeps the wardrobe): another client's view of the body
// carries it, and the scene dresses a body that falls from its view as it dresses one standing.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { CUE_DEAD, CUE_DOWN } from "../../shared/anim/pose.ts";
import { GEAR_COUNT, WORN_FIELDS, WORN_LENGTH } from "../../shared/sim/entities.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView } from "../../tools/snap.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { test } from "../fixtures/needs-art.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

test("another client sees a survivor's body in what it died in", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  try {
    const ada = h.join("ada"), bob = h.join("bob");
    h.run(500);
    const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
    const inv = h.host.items.inv(me);
    expect(h.host.items.mintAt(me, inv.wardrobe, id("plain_tee"), 1)).toBe(1);
    expect(h.host.items.mintAt(me, inv.wardrobe + 1, id("plain_trousers"), 1)).toBe(1);
    expect(h.host.items.restyle(me, inv.wardrobe, 0, 233 | (10 << 8))).toBe(true);
    h.run(200);
    expect(h.say(ada, "enablecheats")[0]).toMatch(/cheats/);
    expect(h.say(ada, "suicide")).toEqual(["You were killed."]);
    h.run(400);
    const seen = new RemoteSample();
    bob.sampleRemote(seen, 0);
    const bodies = [...Array(seen.count).keys()].filter((i) => seen.kind[i] === me.kind && (seen.cue[i]! & CUE_DEAD) !== 0);
    expect(bodies.length).toBe(1);
    const i = bodies[0]!;
    expect(seen.hasWardrobe[i]).toBe(1);
    expect([...seen.wardrobe.subarray(i * WORN_LENGTH, i * WORN_LENGTH + 2 * WORN_FIELDS)]).toEqual([id("plain_tee"), 0, 233 | (10 << 8), id("plain_trousers"), 0, 0]);
  } finally {
    h.host.shutdown();
  }
});

test("a survivor knocked down is drawn in its garments as it falls", () => {
  const view = provingView(320, 180);
  const { scene, cam, remote, hf } = view;
  scene.assets.tier = tierOf("medium");
  scene.viewHeight = 1080;
  asTextured(scene);
  [cam.yaw, cam.pitch, cam.fovY, cam.aspect] = [Math.PI, -0.3, (70 * Math.PI) / 180, 16 / 9];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  remote.count = 1;
  remote.tick = 100;
  [remote.id[0], remote.gen[0], remote.kind[0], remote.flags[0], remote.anim[0], remote.hasLook[0], remote.yaw[0], remote.cue[0]] = [3000, 1, view.reg.index.get("core:survivor")!, 1, 0, 1, 0, CUE_DOWN];
  [remote.x[0], remote.z[0]] = [cam.x, cam.z - 4];
  remote.y[0] = hf.heightAt(remote.x[0]!, remote.z[0]!);
  remote.look.set(defaultLook(), 0);
  remote.gear.fill(0, 0, GEAR_COUNT);
  remote.wardrobe.fill(0, 0, WORN_LENGTH);
  remote.wardrobe[0] = view.reg.index.get("core:plain_tee")!;
  remote.hasWardrobe[0] = 1;
  let p = scene.build(cam, remote);
  for (let f = 0; f < 4; f++) {
    remote.tick += 5;
    p = scene.build(cam, remote);
  }
  const ids = scene.assets.manifest.meshes.map((m) => m.id);
  const drawn = [...Array(p.drawCount).keys()].filter((d) => p.drawBuffer[d] === TRANSIENT_BUFFER).map((d) => ids[p.drawMesh[d]!]!);
  expect(drawn).toContain("core:human_m/garment/tee");
});
