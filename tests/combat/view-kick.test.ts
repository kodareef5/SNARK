// A blow turns the striker's own view a little (client/core/sight.ts), and never the look it sends.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ACT_SWING } from "../../shared/sim/weapon.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const DEGREE = Math.PI / 180;

/** The most the view dips below the player's own pitch through one punch, in radians, with the setting on or off. */
function dip(kick: boolean): { most: number; look: number } {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, parsePack(corePackBytes()));
  let most = 0;
  const run = (ms: number): void => h.run(ms, (now) => {
    app.frame(now, 1280, 720);
    if (app.session.own.act === ACT_SWING) most = Math.max(most, app.controls.pitch - app.cam.pitch);
  });
  run(600);
  app.view.thirdPerson = false;
  app.ui.settings.viewKick = kick;
  app.controls.pitch = 0.1;
  run(400);
  app.controls.mouseButton(0, true);
  run(100);
  app.controls.mouseButton(0, false);
  run(600);
  return { most, look: app.controls.pitch };
}

test("a punch dips the puncher's view a third of a degree as it lands, and the look it sends stays", () => {
  const on = dip(true);
  expect(on.most).toBeGreaterThan(0.25 * DEGREE);
  expect(on.most).toBeLessThan(0.35 * DEGREE);
  expect(on.look).toBe(0.1);
});

test("with the view kick off a punch leaves the view alone", () => {
  expect(dip(false).most).toBeLessThan(0.01 * DEGREE);
});
