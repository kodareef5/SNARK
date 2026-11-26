// The level a survivor is drawn at on each tier: a tier that draws bodies flat starts at a body's first flat level.

import { expect } from "bun:test";
import { flatBodies, tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_SKINNED, DRAW_TEXTURED, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { LOOK_BYTES, defaultLook } from "../../shared/anim/look.ts";
import { asTextured } from "../../tools/bench/base.ts";
import { provingView } from "../../tools/snap.ts";
import { test } from "../fixtures/needs-art.ts";

const AWAY = [2, 6, 12, 25, 60];

/** Each slot mesh's level for a survivor at each of AWAY metres, on `tier`, and whether any part is drawn with materials. */
function levels(tier: string): { level: number[]; textured: boolean[]; flat: number } {
  const view = provingView(320, 180);
  const { scene, cam, remote, reg, hf } = view;
  scene.assets.tier = tierOf(tier);
  scene.viewHeight = 1080;
  if (scene.assets.tier.lit) asTextured(scene);
  [cam.yaw, cam.pitch] = [Math.PI, -0.04];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.62;
  remote.count = AWAY.length;
  AWAY.forEach((d, n) => {
    [remote.id[n], remote.kind[n], remote.flags[n], remote.anim[n], remote.hasLook[n], remote.yaw[n]] = [500 + n, reg.index.get("core:survivor")!, 1, 0, 1, 0];
    [remote.x[n], remote.z[n]] = [cam.x + (n - 2) * 0.8, cam.z - d];
    remote.y[n] = hf.heightAt(remote.x[n]!, remote.z[n]!);
    remote.look.set(defaultLook(), n * LOOK_BYTES);
  });
  let p = scene.build(cam, remote);
  for (let f = 0; f < 4; f++) p = scene.build(cam, remote);
  const { table } = scene.assets;
  const torso = table.find("core:human_m/torso");
  const [level, textured] = [AWAY.map(() => -1), AWAY.map(() => false)];
  for (let d = 0; d < p.drawCount; d++) {
    if (p.drawBuffer[d] !== TRANSIENT_BUFFER || (p.drawFlags[d]! & DRAW_SKINNED) === 0 || p.drawMesh[d] !== torso) continue;
    for (let i = p.drawFirst[d]!; i < p.drawFirst[d]! + p.drawInstances[d]!; i++) {
      const n = p.transientIds[i]! - 500;
      level[n] = p.drawLod[d]!;
      textured[n] ||= (p.drawFlags[d]! & DRAW_TEXTURED) !== 0;
    }
  }
  return { level, textured, flat: table.flat[torso]! };
}

test("low poly draws a survivor from its first flat level on, and coarser as it goes", () => {
  expect(flatBodies(tierOf("lowpoly"))).toBe(true);
  const { level, flat } = levels("lowpoly");
  expect(flat).toBeGreaterThan(0);
  for (const l of level) expect(l).toBeGreaterThanOrEqual(flat);
  expect(level.at(-1)!).toBeGreaterThan(level[0]!);
});

test("medium draws a near survivor at its finest with materials and a far one flat", () => {
  expect(flatBodies(tierOf("medium"))).toBe(false);
  const { level, textured, flat } = levels("medium");
  expect(level[0]).toBe(0);
  expect(textured[0]).toBe(true);
  expect(level.at(-1)!).toBeGreaterThanOrEqual(flat);
  expect(textured.at(-1)).toBe(false);
  for (let n = 1; n < level.length; n++) expect(level[n]!).toBeGreaterThanOrEqual(level[n - 1]!);
});
