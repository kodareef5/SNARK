// The resource monitor in a whole client: its strip at every phone and tablet window, either way up and with the
// screen's edges, clear of the touch layer's controls and of the rest of the HUD.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { Monitor } from "../../client/core/ui/monitor.ts";
import { MONITOR_KIT } from "../../client/core/ui/monitor-kit.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";
import * as layout from "../../client/core/ui/touch.ts";
import { fitsClear, meets, stripFits } from "../fixtures/monitor.ts";
import { KEY_STRIP_OPEN } from "../../client/core/ui/monitor.ts";
import { KEY_PANEL, KEY_TAB } from "../../client/core/ui/monitor-panel.ts";
import { KEY_TOUCH_BUTTON, T_CLOSE } from "../../client/core/touch.ts";

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

test("by touch a tap on the strip opens the monitor as a page of its own, under the touch layer's Close, each tab fitting every phone and tablet", () => {
  for (const [name, w, h, insets] of WINDOWS) for (const muted of [true, false]) {
    const net = new Harness(), app = monitored(net, "page", true);
    insets.forEach((v, i) => (app.insets[i] = v));
    app.ui.settings.muted = muted;
    net.run(600, (now) => app.frame(now, w, h));
    const open = app.ui.frame.find(KEY_STRIP_OPEN)!, where = `${name}${muted ? ", muted" : ""}`;
    expect(open.interactive, where).toBe(true);
    app.pointer(0, KEY_STRIP_OPEN, open.x + 10, open.y + 10, 0, 1);
    app.pointer(1, KEY_STRIP_OPEN, open.x + 10, open.y + 10, 0, 1);
    for (let tab = 0; tab < 3; tab++) {
      app.ui.monitor!.tab = tab;
      app.ui.monitor!.refreshNow();
      net.run(50, (now) => app.frame(now, w, h));
      const f = app.ui.frame, at = `${where}, tab ${tab}`;
      expect(app.ui.wantsPointerLock, at).toBe(false);
      const close = f.find(KEY_TOUCH_BUTTON + T_CLOSE)!;
      expect(close, at).not.toBeNull();
      // The page and its words fit, and nothing else but the crosshair's band is under it.
      fitsClear(f, KEY_PANEL, at, (n) => n.key >= 24 && n.key <= 35);
      const controls = f.nodes.slice(0, f.count).filter((n) => n.interactive);
      for (const n of controls) if (n.key >= 8000 && n.key < 9000) expect(Math.min(n.w, n.h), `${at}: ${n.key} "${n.label}"`).toBeGreaterThanOrEqual(44);
      for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) expect(meets(controls[i]!, controls[j]!), `${at}: ${controls[i]!.key} over ${controls[j]!.key}`).toBe(false);
      expect(f.find(KEY_TAB + tab), at).not.toBeNull();
    }
    // Its Close is Escape, which shuts the page.
    app.pointer(0, KEY_TOUCH_BUTTON + T_CLOSE, 0, 0, 0, 1);
    app.pointer(1, KEY_TOUCH_BUTTON + T_CLOSE, 0, 0, 0, 1);
    net.run(50, (now) => app.frame(now, w, h));
    expect(app.ui.monitor!.open, where).toBe(false);
  }
});
