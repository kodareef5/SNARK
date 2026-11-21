// The resource monitor in a whole client: its strip at every phone and tablet window, either way up and with the
// screen's edges, clear of the touch layer's controls and of the rest of the HUD.

import { test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { Monitor } from "../../client/core/ui/monitor.ts";
import { MONITOR_KIT } from "../../client/core/ui/monitor-kit.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";
import * as layout from "../../client/core/ui/touch.ts";
import { stripFits } from "../fixtures/monitor.ts";

const pack = parsePack(corePackBytes());

/** Window sizes in CSS pixels with the edges their screens take, as the touch layer's own test has them. */
export const WINDOWS: [string, number, number, number[]][] = [
  ["a phone on its side", 844, 390, [47, 0, 47, 21]],
  ["a small phone on its side", 667, 375, [0, 0, 0, 0]],
  ["the smallest phone on its side", 568, 320, [0, 0, 0, 0]],
  ["a phone upright", 390, 844, [0, 47, 0, 34]],
  ["a small phone upright", 375, 667, [0, 20, 0, 0]],
  ["a tall narrow phone upright", 360, 800, [0, 32, 0, 24]],
  ["the smallest phone upright", 320, 568, [0, 20, 0, 0]],
  ["a tablet", 1024, 768, [0, 24, 0, 20]],
  ["a tablet upright", 768, 1024, [0, 24, 0, 20]],
];

/** A client with the monitor on and its file at hand, played by a finger or not. */
export function monitored(h: Harness, name: string, finger: boolean): App {
  const app = new App(h.join(name, { latencyMs: 20 }, { manual: true }), h.reg, pack);
  if (finger) { app.ui.inputDevice = 2; app.ui.layer = layout; }
  app.ui.settings.diagnostics = app.ui.settings.monitor = true;
  app["monitorAsked"] = true;
  app.ui.monitor = new Monitor(app, MONITOR_KIT);
  return app;
}

test("by touch the strip fits every phone and tablet, clear of the bar, the vitals, the minimap and the thumbs", () => {
  for (const [name, w, h, insets] of WINDOWS) for (const muted of [true, false]) {
    const net = new Harness(), app = monitored(net, "strip", true);
    insets.forEach((v, i) => (app.insets[i] = v));
    app.ui.settings.muted = muted;
    net.run(600, (now) => app.frame(now, w, h));
    const hud = app.hud;
    hud.prompt = "E  ride a raptor with a long name";
    while (hud.hotbar.length < 10) hud.hotbar.push({ tint: -1, label: "", number: "" });
    app.ui.build(w / h, hud, app.session);
    stripFits(app.ui.frame, `${name}${muted ? ", muted" : ""}`);
  }
});
