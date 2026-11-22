// The fabricated sniper rifle and its own scope (D1083): its rounds fly and drop, a zero lifts them to cross the look where
// it was dialled, its scope zooms 4 to 40 times with a reticle in milliradians, and its glass glints to those it faces.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { zoomed } from "../../client/core/optics.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CUE_SCOPED } from "../../shared/anim/pose.ts";
import { CHUNK_SIZE, TICK_DT } from "../../shared/coords.ts";
import { CMD_GAZE } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, BTN_PRONE, BTN_SECONDARY, BTN_SPRINT, Body, MF_WINDED } from "../../shared/sim/character.ts";
import { BREATH_WINDED, breathShare, holdsBreath } from "../../shared/sim/aim.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const MID = 24 * CHUNK_SIZE;
const TICK_MS = TICK_DT * 1000;

/** A survivor with the rifle in hand, loaded, at the middle of a flat map, looking north and level. */
function armed(h: Harness, s: ClientSession, pilot: number): void {
  s.text("enablecheats");
  h.run(300);
  s.text(`tp ${MID} ${MID - 600}`);
  h.run(500);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.items.mint(rec, h.reg.index.get("core:rifle_sniper")!, 1);
  h.host.items.mint(rec, h.reg.index.get("core:round_advanced_sniper")!, 20);
  h.run(300);
  const slot = takeInHand(h, s, h.reg.index.get("core:rifle_sniper")!);
  h.run(6000);
  expect(h.host.items.inv(rec).loaded[slot]).toBeGreaterThan(0);
  const p = h.pilots[pilot]!;
  [p.yaw, p.pitch] = [0, 0];
}

test("a sniper round flies at 850 m/s and falls off its line as a round does; a zero of 500 m lifts its launch by the angle that crosses the look there", () => {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  const s = h.join("ada");
  h.run(1000);
  armed(h, s, 0);
  const p = h.pilots[0]!;
  // Lying down and holding its breath, the scope's sway is a twenty-fifth of a standing one's.
  p.buttons |= BTN_PRONE;
  // From so low, a level round meets the flat ground short of 500 m: a little up, it clears it.
  p.pitch = 0.008;
  h.run(2000);
  const shot = (zero: number): { fall: number; speed: number; lift: number } => {
    p.buttons |= BTN_SECONDARY | BTN_SPRINT;
    s.command(CMD_GAZE, (w) => (w.u16(10 * 16), w.u16(0), w.u16(zero)));
    h.run(1500);
    expect(h.host.gaze.zeroOf(h.client(s)!)).toBe(zero);
    p.buttons |= BTN_PRIMARY;
    const before = h.host.projectiles.flyingCount;
    let k = -1;
    for (let t = 0; t < 120 && k < 0; t++) {
      h.run(TICK_MS);
      if (h.host.projectiles.flyingCount > before) k = h.host.projectiles.flyingCount - 1;
    }
    p.buttons &= ~BTN_PRIMARY;
    expect(k).toBeGreaterThanOrEqual(0);
    const f0 = { ...h.host.projectiles.flyingAt(k) };
    const speed = Math.hypot(f0.vx, f0.vy, f0.vz);
    // Followed 500 m on: how far under the line it was on as first seen, and the time it took.
    let f = f0;
    while (f.z - f0.z < 500) {
      h.run(TICK_MS);
      f = { ...h.host.projectiles.flyingAt(k) };
    }
    const t = (f.z - f0.z) / f0.vz;
    const fall = f.y - (f0.y + f0.vy * t);
    p.buttons &= ~(BTN_SECONDARY | BTN_SPRINT);
    h.run(4000);
    return { fall: fall / ((9.81 / 2) * t * t), speed, lift: Math.atan2(f0.vy, Math.hypot(f0.vx, f0.vz)) };
  };
  const plain = shot(0);
  expect(plain.speed).toBeCloseTo(850, -1);
  // It falls under its line by half g t squared, as a round does.
  expect(plain.fall).toBeCloseTo(-1, 1);
  const zeroed = shot(500);
  const want = (9.81 * 500) / (2 * 850 * 850);
  expect(Math.abs(zeroed.lift - plain.lift - want)).toBeLessThan(want * 0.25);
});

test("in the whole client: the sniper's own scope zooms 4 to 40 times, its reticle in milliradians, its zero told the server; another survivor it faces sees its glass glint", () => {
  const h = new Harness({}, 5, 60, { dev: true, map: writeMap(flatMap(48)) });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const bob = h.join("bob");
  app.ui.settings.thirdPerson = false;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(1000);
  armed(h, app.session, 0);
  bob.text("enablecheats");
  run(300);
  bob.text(`tp ${MID} ${MID - 450}`);
  run(1000);
  app.controls.yaw = 0;
  app.controls.pitch = 0;
  const base = (app.ui.settings.fov * Math.PI) / 180;
  app.controls.mouseButton(2, true);
  run(1500);
  expect([app.hud.scope, app.hud.sightMil, app.view.atEye]).toEqual([true, true, true]);
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, 4), 3);
  app.sightZoom = 40;
  app.sightZero = 300;
  run(2000);
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, 40), 4);
  expect([app.hud.sightZoom, app.hud.sightZero, h.host.gaze.zeroOf(h.client(app.session)!)]).toEqual([40, 300, 300]);
  // Bob, 150 m ahead and in Ada's look, is told her glass is up; facing her, he would see it glint.
  const r = new RemoteSample();
  bob.sampleRemote(r);
  const ada = [...r.id.subarray(0, r.count)].indexOf(h.client(app.session)!.ent);
  expect(ada).toBeGreaterThanOrEqual(0);
  expect(r.cue[ada]! & CUE_SCOPED).toBe(CUE_SCOPED);
  app.controls.mouseButton(2, false);
  run(1500);
  bob.sampleRemote(r);
  expect(r.cue[[...r.id.subarray(0, r.count)].indexOf(h.client(app.session)!.ent)]! & CUE_SCOPED).toBe(0);
  expect([app.hud.scope, h.host.gaze.zeroOf(h.client(app.session)!)]).toEqual([false, 0]);
});

test("a held breath costs stamina: still and aimed with the sprint key it lasts some six seconds, then the shooter is winded and its sway shakes the more", () => {
  const h = new Harness({}, 5, 30, { dev: true, map: writeMap(flatMap(48)) });
  const s = h.join("ada");
  h.run(1000);
  armed(h, s, 0);
  const p = h.pilots[0]!, body = (): Body => h.client(s)!.body;
  p.buttons |= BTN_SECONDARY;
  h.run(1000);
  const full = body().stamina;
  p.buttons |= BTN_SPRINT;
  h.run(3000);
  expect(holdsBreath(body(), p.buttons)).toBe(true);
  expect(body().stamina).toBeLessThan(full * 0.6);
  let held = 3000;
  while (holdsBreath(body(), p.buttons) && held < 12000) {
    h.run(500);
    held += 500;
  }
  expect(held).toBeGreaterThanOrEqual(5000);
  expect(held).toBeLessThanOrEqual(8000);
  expect([(body().mflags & MF_WINDED) !== 0, breathShare(body(), p.buttons)]).toEqual([true, BREATH_WINDED]);
  // Let go, the breath comes back.
  p.buttons &= ~BTN_SPRINT;
  h.run(15000);
  expect([(body().mflags & MF_WINDED) !== 0, breathShare(body(), p.buttons)]).toEqual([false, 1]);
});
