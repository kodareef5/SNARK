import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { HudModel } from "../../client/core/hud.ts";
import { HUD_WIDGETS } from "../../client/core/hud/widgets.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

test("every widget has a name of its own, and something to fill or draw", () => {
  const names = HUD_WIDGETS.map((w) => w.name);
  expect(new Set(names).size).toBe(names.length);
  for (const w of HUD_WIDGETS) expect(w.fill !== undefined || w.build !== undefined, w.name).toBe(true);
});

test("the model holds each widget's fields, and no two widgets share a name", () => {
  const model = new HudModel() as unknown as Record<string, unknown>;
  const owner = new Map<string, string>();
  for (const w of HUD_WIDGETS) {
    for (const [name, value] of Object.entries(w.make?.() ?? {})) {
      expect(owner.get(name), `${name} of ${w.name}`).toBeUndefined();
      owner.set(name, w.name);
      expect(name in model, name).toBe(true);
      expect(typeof model[name]).toBe(typeof value);
    }
  }
  expect(owner.size).toBeGreaterThan(0);
});

test("a frame refills the model's arrays and objects and makes none again", () => {
  const h = new Harness();
  const app = new App(h.join("widgets", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const run = (ms: number): void => h.run(ms, (now) => app.frame(now, 1280, 720));
  run(500);
  const hud = app.hud as unknown as Record<string, unknown>;
  const held = new Map<string, object>();
  for (const [name, value] of Object.entries(hud)) if (value !== null && typeof value === "object") held.set(name, value);
  expect(held.has("vitals") && held.has("markers") && held.has("readout") && held.has("hotbar")).toBe(true);
  const rows = (app.hud.vitals as object[]).slice();
  app.key("KeyW", true);
  run(500);
  for (const [name, value] of held) expect(hud[name], name).toBe(value);
  // The rows inside are the same too: a fill writes into them.
  expect((app.hud.vitals as object[]).every((row, i) => row === rows[i])).toBe(true);
});

test("a widget reads what an earlier one in the list filled", () => {
  const h = new Harness();
  const app = new App(h.join("order", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  h.run(500, (now) => app.frame(now, 1280, 720));
  const at = (name: string): number => HUD_WIDGETS.findIndex((w) => w.name === name);
  // The readout's lines, the compass's dial and the crosshair's rule are made from what the state widget fills.
  for (const later of ["readout", "compass", "minimap", "crosshair", "words"]) expect(at("state"), later).toBeLessThan(at(later));
  expect(app.hud.readout[0]).toContain(app.hud.compass);
  expect(app.hud.dial.heading).toBeCloseTo(app.hud.heading, 3);
});
