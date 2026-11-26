// The jet's glass on the pilot's screen (client/core/hud/fighter.ts): its mode, its weapons as the server told them, a
// box about what its seeker holds, and the warning when another's seeker holds it; each fitting every window shape.

import { expect, test } from "bun:test";
import { KEY_FIGHTER, KEY_LOCK, KEY_LOCK_WARNING } from "../../client/core/jet-load.ts";
import { clashes } from "../fixtures/hud-states.ts";
import { WINDOWS, camp, fits, node, resize, screen, shown, survivor, until, vehicle } from "../kit/kit.ts";

test("a jet taken at rest shows VTOL, its weapons and its keys, fitting each window", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada);
  vehicle(h, ada, "jet", { at: { x: at.x, z: at.z + 30 }, yaw: 0, drive: true });
  expect(until(h, () => shown(view, KEY_FIGHTER + 5) === "Cannon 220 · Missiles 6/6", 5)).toBe(true);
  expect(shown(view, KEY_FIGHTER + 1)).toBe("VTOL");
  for (const [name, width, height] of WINDOWS) {
    resize(h, view, width, height);
    const frame = view.app.ui.frame;
    expect(clashes(view.app, frame.nodes.slice(0, frame.count))).toEqual([]);
    for (const key of [KEY_FIGHTER, KEY_FIGHTER + 4, KEY_FIGHTER + 5, KEY_FIGHTER + 6]) expect(fits(view, key), `${name} ${key}`).toBe(true);
  }
});

test("the seeker's box stands over a helicopter ahead, and the helicopter's crew is told it is looked for", () => {
  const { h, ada, at } = camp({ screen: true });
  const view = screen(h, ada), app = view.app;
  vehicle(h, ada, "jet", { at: { x: at.x, z: at.z - 60 }, yaw: 0, drive: true });
  app.controls.yaw = app.controls.pitch = 0;
  const bob = survivor(h, "bob", { screen: true, at: { x: at.x + 30, z: at.z + 60 } });
  const heli = vehicle(h, bob, "helicopter", { at: { x: at.x, z: at.z + 60 }, yaw: 0, drive: true });
  expect(bob.driving).toBe(heli.e);
  app.mouseButton(2, true);
  expect(until(h, () => shown(view, KEY_FIGHTER + 6)?.startsWith("LOCK") ?? false, 3)).toBe(true);
  h.run(500);
  expect(node(view, KEY_LOCK)).not.toBeNull();
  expect(until(h, () => shown(view, KEY_FIGHTER + 6)?.startsWith("LOCKED HELICOPTER") ?? false, 3)).toBe(true);
  // The helicopter's pilot is warned, in the middle of the screen.
  const theirs = screen(h, bob);
  expect(until(h, () => shown(theirs, KEY_LOCK_WARNING) === "LOCKED ON", 2)).toBe(true);
  app.mouseButton(2, false);
});
