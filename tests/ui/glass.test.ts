// A held glass, the spyglass, in the whole client (client/core/glass.ts, D1082): raised, it zooms in steps through two
// lenses, tells what it is on far off as the floating HUD does, ranges, and marks for the tribe alone.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { TWIN_WIDE, zoomed } from "../../client/core/optics.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { MARK_SPOT } from "../../shared/world/tactical.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";

const MID = 24 * CHUNK_SIZE;
const OFF = 400;

test("in the whole client: a spyglass raised zooms in steps through two lenses, tells of a dodo 400 m off, ranges, and marks it for the tribe and not for a stranger", () => {
  const h = new Harness({}, 3, 60, { dev: true, map: writeMap(flatMap(48)) });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
  const bob = h.join("bob");
  const cat = h.join("cat");
  const ents = h.world.ents;
  let target = -1;
  // Each frame Ada's look is laid on the dodo's middle, as a player follows what it watches.
  const follow = (): void => {
    if (target < 0) return;
    const s = app.session, eye = 1.6;
    const dx = ents.x[target]! - s.own.x, dz = ents.z[target]! - s.own.z;
    app.controls.yaw = Math.atan2(dx, dz);
    app.controls.pitch = Math.atan2(ents.y[target]! + 0.4 - (s.own.y + eye), Math.hypot(dx, dz));
  };
  const run = (ms: number): void => h.run(ms, (now) => (follow(), void app.frame(now, 1280, 720)));
  run(1000);
  const s = app.session;
  for (const who of [s, bob, cat]) who.text("enablecheats");
  run(300);
  h.say(s, "tribe create Scouts");
  h.say(s, "tribe invite bob");
  h.say(bob, "tribe accept");
  s.text(`tp ${MID} ${MID}`);
  bob.text(`tp ${MID + 3} ${MID}`);
  cat.text(`tp ${MID - 3} ${MID}`);
  run(1000);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.items.mint(rec, h.reg.index.get("core:spyglass")!, 1);
  run(300);
  takeInHand(h, s, h.reg.index.get("core:spyglass")!);
  run(500);
  target = h.host.spawnCreature("core:dodo", MID, MID + OFF, 10);
  run(500);
  const base = (app.ui.settings.fov * Math.PI) / 180;
  // Raised, at its first step, through two lenses, from the eye; a step of the wheel up, four times.
  app.controls.mouseButton(2, true);
  app.glass.wheel({ min: 2, max: 30, steps: [2, 4, 8, 16, 30] }, -1);
  run(3000);
  expect([app.hud.glass, app.hud.scope, app.view.atEye, app.hud.glassZoom]).toEqual([true, true, true, 4]);
  expect(app.cam.fovY).toBeCloseTo(zoomed(base, 4), 3);
  expect(h.host.gaze.count).toBe(1);
  // The arrows step it as the wheel does (and a finger's zoom buttons, which send them).
  app.key("ArrowUp", true);
  app.key("ArrowUp", false);
  run(100);
  expect([app.hud.glassZoom, app.hud.zooming]).toEqual([8, true]);
  app.key("ArrowDown", true);
  app.key("ArrowDown", false);
  run(1500);
  expect(app.hud.glassZoom).toBe(4);
  const p = app.frame(h.now, 1280, 720)!;
  expect(((p.window[2]! - p.window[0]!) * 1280) / ((p.window[3]! - p.window[1]!) * 720)).toBeCloseTo(TWIN_WIDE, 1);
  // What it is on, 400 m off, as the floating HUD tells it: past the 30 m a bare look reaches.
  expect(app.hud.overhead.lookedId).toBe(target);
  expect(app.hud.overhead.lookedFar).toBeGreaterThan(OFF - 20);
  // The primary ranges it: a second's lasing, then a distance; the hand that holds the glass does not strike.
  app.controls.mouseButton(0, true);
  run(100);
  expect(app.hud.glassRange).toBe(-1);
  app.controls.mouseButton(0, false);
  run(1200);
  expect(app.hud.glassRange).toBeGreaterThan(OFF - 20);
  // N marks it for the tribe: Bob is told where it is, Cat is not.
  app.key("KeyN", true);
  app.key("KeyN", false);
  run(2500);
  expect(app.hud.glassMarked || app.glass.markedAt > 0).toBe(true);
  const team = rec.team;
  expect(h.host.tactical.spotted(team)).toEqual([target]);
  const spots = (who: typeof bob): number => {
    const m = who.tactical.marks;
    let n = 0;
    for (let i = 0; i < m.count; i++) if (m.kind[i] === MARK_SPOT) n++;
    return n;
  };
  expect([spots(s), spots(bob), spots(cat)]).toEqual([1, 1, 0]);
  expect(app.hud.markers.some((k) => k.kind === "spotted")).toBe(true);
  // Lowered: the view as it was, the gaze gone; the mark stays its minute.
  app.controls.mouseButton(2, false);
  run(1500);
  expect([app.hud.glass, app.hud.scope, h.host.gaze.count, spots(bob)]).toEqual([false, false, 0, 1]);
});
