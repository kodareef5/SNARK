// What the crosshair is on (client/core/assets/look.ts) in a small world with a client in it: a wall set in front of
// the eye, the ground under it, and the sky over it.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { emptyPick, pickLook } from "../../client/core/assets/look.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

test("the crosshair's ray names a wall in front of the eye, its model and level, then the ground below and nothing above", () => {
  const h = new Harness(), app = new App(h.join("look", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(600);
  const e = h.ent(app.session), ents = h.world.ents, wall = h.reg.index.get("core:wall_wood")!;
  h.world.structs.add(wall, ents.x[e]!, ents.y[e]! + 1.5, ents.z[e]! + 5, 0, 0, 1000);
  app.controls.yaw = 0;
  app.controls.pitch = 0;
  run(400);
  const pick = pickLook(app, emptyPick());
  expect([pick.what, pick.id]).toEqual(["structure", "core:wall_wood"]);
  expect(pick.distance).toBeGreaterThan(3);
  expect(pick.distance).toBeLessThan(6);
  expect(pick.mesh).toBe(app.scene!.meshOfKind[wall]!);
  expect(pick.shown).toBeGreaterThanOrEqual(0);
  // Down at the ground, and up at the sky.
  app.controls.pitch = -1.3;
  run(50);
  expect(pickLook(app, pick).what).toBe("ground");
  app.controls.pitch = 1.4;
  run(50);
  expect(pickLook(app, pick).what).toBe("none");
});
