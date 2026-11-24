// A blow turns the striker's own view a little (client/core/sight.ts), and never the look it sends.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { EVENT_HIT, EVENT_STRIKE, S_EVENT } from "../../shared/net/protocol.ts";
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

test("only a fresh swing contact kicks the view, once, when view kick is on", () => {
  const h = new Harness({}, 3, 60, { dev: true });
  try {
    const s = h.join("ada", {}, { manual: true });
    const app = new App(s, h.reg, parsePack(corePackBytes()));
    let peak = 0;
    const run = (ms: number): void => h.run(ms, (now) => {
      app.frame(now, 1280, 720);
      peak = Math.max(peak, app.cam.pitch - app.controls.pitch);
    });
    const deliver = (kind: number, tick: number): void => {
      const w = h.server.begin(S_EVENT);
      w.u8(kind);
      if (kind === EVENT_STRIKE) {
        w.u32(tick);
        w.varint(0);
      } else {
        w.f32(0); w.f32(1); w.f32(2); w.bits(1, 4); w.u16(12); w.bool(false); w.bool(false);
      }
      h.server.endOwn(h.client(s)!);
      peak = 0;
      run(60);
    };
    run(600);
    app.view.thirdPerson = false;
    app.ui.settings.viewKick = true;
    run(400);
    app.controls.mouseButton(0, true);
    run(65);
    expect(s.own.act).toBe(ACT_SWING);
    deliver(EVENT_HIT, 0);
    expect(peak).toBeLessThan(0.01 * DEGREE);
    app.controls.mouseButton(0, false);
    run(550);
    deliver(EVENT_STRIKE, h.world.tick);
    expect(peak).toBeGreaterThan(0.45 * DEGREE);
    run(180);
    expect(Math.abs(app.cam.pitch - app.controls.pitch)).toBeLessThan(0.01 * DEGREE);
    deliver(EVENT_STRIKE, h.world.tick - 20);
    expect(peak).toBeLessThan(0.01 * DEGREE);
    app.ui.settings.viewKick = false;
    deliver(EVENT_STRIKE, h.world.tick);
    expect(peak).toBeLessThan(0.01 * DEGREE);
  } finally {
    h.host.shutdown();
  }
});
