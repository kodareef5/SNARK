// A measurement run's clock (D1122): on a bench page the scene's timers follow the run's clock the shell hands the app
// each frame (client/core/bench-run.ts BenchRun.clock, App.autopilot) on from the page's clock at the frame before the
// run began; in play they follow the page's.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

test("a run's clock times the scene and the tide's eyes, its view held or turning; play keeps the page's", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("owner", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  let last = 0;
  h.run(1500, (now) => {
    // Before the run is still its clock says none, and the page's clock is the scene's.
    app.autopilot(-1, -1);
    app.frame((last = now), 1280, 720);
  });
  expect(app.scene).not.toBeNull();
  expect(app.scene!.now).toBe(last);
  const still = last;
  // A run's frames at the page's pace, its clock stepping a sixtieth of a second each: on from the still frame.
  let step = 0;
  h.run(500, (now) => {
    app.autopilot(-1, (++step * 1000) / 60);
    app.frame((last = now), 1280, 720);
  });
  expect(app.scene!.now).toBeCloseTo(still + (step * 1000) / 60, 6);
  expect(app.scene!.eyeSeconds).toBeCloseTo(step / 60, 6);
  // Turning too, as a run that is not `?still` does: the clock goes on, the view turns.
  app.autopilot(3750, 5000);
  app.frame(last + 16, 1280, 720);
  expect([app.scene!.now, app.controls.yaw]).toEqual([still + 5000, Math.PI / 2]);
});
