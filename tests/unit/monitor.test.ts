// The resource monitor's strip in the HUD (client/core/ui/monitor.ts): its three ways in, its numbers, and its place
// in the top-left column at every window the interface is laid out for, clear of what else stands there.

import { expect, test } from "bun:test";
import type { App } from "../../client/core/app.ts";
import { FrameRing } from "../../client/core/assets/frames.ts";
import { HudModel } from "../../client/core/hud.ts";
import { Settings, SETTING_ROWS, toggleMonitor } from "../../client/core/settings.ts";
import { KEY_COMPASS } from "../../client/core/ui/compass.ts";
import { KEY_READOUT } from "../../client/core/ui/hud.ts";
import { KEY_UNMUTE } from "../../client/core/ui/menu.ts";
import { KEY_MONITOR, Monitor, bytesText, lastSecond, rateText } from "../../client/core/ui/monitor.ts";
import { MONITOR_KIT } from "../../client/core/ui/monitor-kit.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import * as mine from "../../client/core/ui/monitor-style.ts";
import * as nodes from "../../client/core/ui/nodes.ts";
import * as style from "../../client/core/ui/style.ts";
import { fakeApp, glassBox, stripFits } from "../fixtures/monitor.ts";

test("the monitor's copies of the first frame's numbers are the numbers", () => {
  const copies: [number, number][] = [[mine.K_PANEL, nodes.K_PANEL], [mine.K_TEXT, nodes.K_TEXT], [mine.K_BAR, nodes.K_BAR], [mine.K_BUTTON, nodes.K_BUTTON], [mine.K_HOLD, nodes.K_HOLD]];
  for (const name of ["S_TEXT", "S_LABEL", "S_DARK", "S_MENU", "S_MENU_NOTE", "S_HUD_HIT", "S_HUD_COUNT", "S_ICE", "S_MENU_HEADING", "S_WARNING", "S_KEY", "S_MENU_WARN"] as const) copies.push([mine[name], style[name]]);
  copies.push([mine.LINE, nodes.lineHeight(style.S_MENU_NOTE)], [mine.LINE, nodes.lineHeight(style.S_TEXT)], [mine.SMALL_LINE, nodes.lineHeight(style.S_LABEL)], [mine.SMALL_LINE, nodes.lineHeight(style.S_HUD_COUNT)], [mine.HEADING_LINE, nodes.lineHeight(style.S_MENU_HEADING)]);
  for (const [copy, real] of copies) expect(copy).toBe(real);
});

test("Diagnostics has three values, off, numbers and monitor, saved; F3 and the console's word turn the monitor on and back", () => {
  const s = new Settings(), row = SETTING_ROWS.find((r) => r.label === "Diagnostics")!;
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) { seen.push(row.value(s)); row.step(s, 1); }
  expect(seen).toEqual(["off", "numbers", "monitor", "off"]);
  // Back from numbers, past off, to monitor.
  row.step(s, -1); row.step(s, -1);
  expect([row.value(s), s.diagnostics, s.monitor]).toEqual(["monitor", true, true]);
  const copy = new Settings();
  copy.restoreInterface(s.interfacePreferences());
  expect([copy.diagnostics, copy.monitor, row.value(copy)]).toEqual([true, true, "monitor"]);
  // F3 from off turns it on, readout and all, and again back off; from numbers, back to numbers.
  const ui = new Ui(), hud = new HudModel();
  expect(ui.key("F3", true, false, null)).toBe(true);
  expect([ui.settings.monitor, ui.settings.diagnostics]).toEqual([true, true]);
  ui.key("F3", true, true, null);
  expect(ui.settings.monitor).toBe(true);
  ui.key("F3", false, false, null); ui.key("F3", true, false, null);
  expect([ui.settings.monitor, ui.settings.diagnostics]).toEqual([false, false]);
  ui.settings.diagnostics = true;
  ui.key("F3", true, false, null); ui.key("F3", true, false, null);
  expect([ui.settings.monitor, ui.settings.diagnostics]).toEqual([false, true]);
  // The console's word says what it did.
  expect(toggleMonitor(ui.settings)).toBe("resource monitor on");
  ui.build(16 / 9, hud, null);
  // Without the monitor's file the HUD leaves no room for it.
  expect(hud.stripH).toBe(0);
});

test("the strip's rates are the last second of the record of frames, and its words are made ten times a second", () => {
  const ring = new FrameRing(), stats = { fetched: 0, stale: 0, cached: 0, disk: 0, uploaded: 0 };
  const r = { stats, spentOther: 0, flying: 3, flyingLarge: 0, waiting: 3.1 * 1048576, wanting: () => 14, ledger: 0, texLedger: 0, cardFull: false, shareShort: false, holdBack: false };
  // Two seconds of frames 20 ms apart, each bringing 20 KB over the network, 10 KB from the disk and 5 KB from memory, and sending 30 KB to the card.
  for (let t = 0; t <= 2000; t += 20) {
    stats.fetched += 20480; stats.cached += 15360; stats.disk += 10240; stats.uploaded += 30720;
    ring.record(t, 20, 4, 0.5, r as never, null);
  }
  const sums = new Float64Array(4);
  lastSecond(ring, sums);
  expect(Array.from(sums)).toEqual([50 * 20480, 50 * 10240, 50 * 30720, 50 * 5120]);
  expect([rateText(50 * 20480), rateText(50 * 10240), rateText(300), bytesText(3.1 * 1048576), bytesText(200 * 1048576)]).toEqual(["1.0 MB/s", "500 KB/s", "0 KB/s", "3.1 MB", "200 MB"]);
  const app = { scene: { assets: { residency: r } }, frames: ring, sounds: { library: { flying: 1 } }, nowMs: 0 } as unknown as App;
  const m = new Monitor(app, MONITOR_KIT), f = new Ui().frame, hud = new HudModel();
  f.begin(16 / 9);
  m.reserve(f, hud, null);
  m.refresh(1000);
  expect([m.rates[0], m.rates[1], m.rates[2], m.queue]).toEqual(["1.0 MB/s", "500 KB/s", "1.5 MB/s", "4 downloading · 14 asked · 3.1 MB waiting for the card"]);
  r.flying = 0;
  m.refresh(1050);
  expect(m.queue.startsWith("4 downloading")).toBe(true);
  m.refresh(1100);
  expect(m.queue.startsWith("1 downloading")).toBe(true);
});

test("the strip stands under the readout at every window, pushes the compass, and keeps clear of the minimap and the unmute offer", () => {
  const ui = new Ui(), hud = new HudModel();
  ui.monitor = new Monitor(fakeApp(new FrameRing()), MONITOR_KIT);
  ui.settings.diagnostics = ui.settings.monitor = true;
  hud.readout[0] = "25.8 N 80.2 W  NE 41";
  hud.readout[1] = "x 1204.2  y 3.1  z -88.0  0.0 m/s";
  hud.readout[2] = "61 fps  42 ms  0 corrections  3 nearby";
  const windows: [number, number][] = [[405, 720], [960, 720], [1280, 720], [1680, 720], [2560, 720], [1056, 488], [834, 469], [710, 400], [1280, 576]];
  for (const [w, h] of windows) for (const muted of [true, false]) for (const inspect of [false, true]) {
    ui.canvasHeight = h; ui.settings.muted = muted; ui.inspect = inspect;
    ui.build(w / h, hud, null);
    const f = ui.frame, where = `${w}x${h}${muted ? " muted" : ""}${inspect ? " inspect" : ""}`;
    expect(f.width, where).toBe(w);
    stripFits(f, where);
    const strip = glassBox(f, KEY_MONITOR)!, readout = f.find(KEY_READOUT + 2)!;
    // Under the readout, its left edge on the readout's.
    expect(strip.x, where).toBe(readout.x);
    expect(strip.y, where).toBeGreaterThanOrEqual(readout.y + readout.h);
    // The compass starts right of it, where it stands.
    for (const n of f.nodes.slice(0, f.count)) if (n.key >= KEY_COMPASS && n.key < KEY_COMPASS + 100) expect(n.x, `${where}: compass ${n.key}`).toBeGreaterThanOrEqual(strip.x + hud.stripW);
    if (muted) expect(f.find(KEY_UNMUTE), where).not.toBeNull();
  }
});
