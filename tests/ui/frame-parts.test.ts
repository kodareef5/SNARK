import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import type { FramePart } from "../../client/core/frame.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const pack = parsePack(corePackBytes());
const parts = (app: App): readonly FramePart[] => app["parts"];

test("the frame's parts stand in the order the view needs", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("order", {}, { manual: true }), h.reg, pack);
  // A guarded part (App.guarded) stands in its wrapper's place.
  const at = (part: FramePart): number => parts(app).findIndex((p) => p === part || (p as { part?: FramePart }).part === part);
  const order = [app.director, app["dash"], app.sight, app.director.body, app.director.place, app.prompts, app["heard"]].map(at);
  expect(order.every((n) => n >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // The HUD's fill and the interface come after every part.
  expect(parts(app).length - at(app["heard"])).toBe(3);
});

test("the game's frame has no tool's rows, and a tool's first ask adds them", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("plain", {}, { manual: true }), h.reg, pack);
  const game = parts(app).length;
  // What the shell tells every page leaves the game as it is.
  app.stress = false;
  app.steer = true;
  app.plainSky = false;
  app.fromEye = false;
  app.address(() => null, false);
  expect([app["tools"], parts(app).length]).toEqual([null, game]);
  expect([app.steer, app.fromEye, app.stress, app.off.size, app.marks]).toEqual([true, false, false, 0, []]);
  app.fromEye = true;
  expect(app["tools"]).not.toBeNull();
  expect(parts(app).length).toBe(game + 3);
  expect([app.fromEye, app.steer]).toEqual([true, true]);
  // Once made they stay, and take a value back.
  app.fromEye = false;
  expect([app.fromEye, parts(app).length]).toEqual([false, game + 3]);
});

test("the HUD shows the words the prompts found in the same frame", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  app.session.text("enablecheats");
  run(300);
  const g = flatGround(h, 20, 20);
  app.session.text(`tp ${g.x + 10} ${g.z + 5}`);
  run(400);
  app.key("KeyV", true);
  app.key("KeyV", false);
  app.controls.yaw = 0;
  app.controls.pitch = 0.6;
  app.session.text("place storage_box");
  run(600);
  expect(app.hud.prompt).toBe("");
  // The look comes down onto the box: that frame's HUD and interface say so.
  app.controls.pitch = -0.45;
  app.frame(h.now + 1, 1280, 720);
  expect(app.aimed).toBeGreaterThanOrEqual(0);
  expect(app.hud.prompt).toContain("E use");
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe(app.hud.prompt);
});
