// The UFO from its call to its rest as one client sees it: the module's kind on a real server, its feed as the engine
// writes it, read and drawn by a real client where the server has it, and its going.

import { expect, test } from "bun:test";
import "../../client/core/mapevent-late.ts";
import ufo from "../../modules/ufo.ts";
import { MAPEVENT_LIVE } from "../../shared/mapevent/wire.ts";
import { camp, look, screen } from "../kit/kit.ts";

/** A UFO that lingers: slow, low, one long low pass over whoever called it, its notice a second. */
const SLOW = { noticeSeconds: 1, cruiseSpeed: 10, scanSpeed: 5, cruiseHeight: [50, 55], scanHeight: [30, 32], points: [4, 4], scans: [1, 1], scanNear: 0, health: 300 };

test("a UFO called on the server is drawn by a client where the server has it, and leaves no draw once ended", () => {
  const { h, ada, at } = camp({ screen: true, host: { modules: [ufo] } });
  const view = screen(h, ada);
  const store = h.host.eventBook;
  const saved = store.save({ ...store.book, schedules: [], tuning: { ufo: SLOW } }, store.book.revision, "test", "");
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  const pass = () => view.app.scene!.mapEventPass;
  // Nothing told yet: nothing drawn, and the late file's pass has drawn no craft.
  h.run(500);
  expect(pass()?.craft ?? 0).toBe(0);
  h.say(ada, "event call ufo here");
  const ev = h.host.mapEvents.events.at(-1)!;
  h.run(2000);
  expect(ev.state).toBe(MAPEVENT_LIVE);
  // Over her on its low pass: look at it where the server has it, and it is drawn there.
  const near = (): { x: number; y: number; z: number } => h.host.mapEvents.views(ev)[0] as { x: number; y: number; z: number };
  for (let k = 0; k < 400 && Math.hypot(near().x - at.x, near().z - at.z) > 60; k++) h.run(250);
  const p = near();
  look(h, ada, p);
  h.run(400);
  const q = near();
  expect(pass()!.craft).toBe(1);
  expect(pass()!.beams).toBe(1);
  const placed = pass()!.placed;
  // The client draws it a few ticks back, where shots are judged: at 5 m/s that is within a couple of metres.
  expect(Math.hypot(placed[0]! - q.x, placed[2]! - q.z)).toBeLessThan(3);
  // Ended, it is gone from the sky; its feed says so and, once forgotten, nothing is drawn.
  h.say(ada, `event cancel ${ev.id}`);
  h.run(16_000);
  expect(pass()!.craft).toBe(0);
});
