// The person stage's readiness (client/core/studio/person.ts stageSettled) on the game's scene: a stage asked for a face
// is not settled while it draws the shared head, so neither its ready nor a picture comes before the face does.

import { expect } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FACE_SLOTS } from "../../client/core/render/faces.ts";
import { stageSettled } from "../../client/core/studio/person.ts";
import { FACE_COUNT, defaultLook, setFace } from "../../shared/anim/look.ts";
import { Rng } from "../../shared/rng.ts";
import { provingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

test("a stage asked for a face is not settled while it draws the shared head", () => {
  const view = provingView(180, 240);
  const { scene, cam, remote, reg, hf } = view;
  scene.assets.tier = { ...tierOf("high"), finishes: 0 };
  scene.viewHeight = 240;
  [cam.yaw, cam.pitch] = [Math.PI, -0.04];
  remote.count = 1;
  [remote.id[0], remote.kind[0], remote.flags[0], remote.anim[0], remote.hasLook[0], remote.yaw[0]] = [500, reg.index.get("core:survivor")!, 1, 0, 1, 0];
  [remote.x[0], remote.z[0]] = [cam.x, cam.z - 0.9];
  remote.y[0] = hf.heightAt(remote.x[0]!, remote.z[0]!);
  cam.y = remote.y[0]! + 1.6;
  const look = defaultLook(), rng = new Rng(4);
  for (let f = 0; f < FACE_COUNT; f++) setFace(look, f, rng.range(-0.6, 0.6));
  remote.look.set(look, 0);
  scene.own = null;
  const head = scene.assets.table.find("core:human_m/head");
  let shared = -1, settledOn = -1, sharedFrames = 0;
  for (let frame = 0; frame < 2000 && settledOn < 0; frame++) {
    scene.now += 1000 / 60;
    const p = scene.build(cam, remote);
    let slot = -1;
    for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === head && p.drawSlot[d]! >= FACE_SLOTS) slot = p.drawSlot[d]!;
    // The shared head is the first made head drawn.
    if (slot >= 0 && shared < 0) shared = slot;
    if (slot >= 0 && slot === shared) sharedFrames++;
    const drawn = scene.characters.posed > 0;
    if (stageSettled(scene, drawn, true)) {
      expect(slot, `frame ${frame}`).toBeGreaterThanOrEqual(FACE_SLOTS);
      expect(slot, `frame ${frame}`).not.toBe(shared);
      settledOn = frame;
    }
  }
  expect(sharedFrames).toBeGreaterThan(0);
  expect(settledOn).toBeGreaterThan(0);
});
