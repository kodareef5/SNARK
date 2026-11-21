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
import * as panel from "../../client/core/ui/monitor-panel.ts";
import * as hudKeys from "../../client/core/ui/hud.ts";
import { fakeApp, fitsClear, glassBox, meets, stripFits } from "../fixtures/monitor.ts";
import { KEY_CARD, KEY_STRIP_OPEN } from "../../client/core/ui/monitor.ts";
import { CHART_SECONDS, ChartData, SERIES, chartBox, columnAt, scaleText } from "../../client/core/ui/monitor-chart.ts";
import { KEY_CHART_PICK, KEY_CLOSE, KEY_COLUMN_BACK, KEY_FREEZE, KEY_PANEL, KEY_TAB } from "../../client/core/ui/monitor-panel.ts";
import { textureWords } from "../../client/core/ui/monitor-card.ts";
import type { TextureInspection } from "../../client/core/assets/inspect.ts";
import * as copied from "../../client/core/assets/copied.ts";
import * as residency from "../../client/core/assets/residency.ts";
import * as texture from "../../shared/pack/texture.ts";

test("the monitor's copies of the first frame's numbers are the numbers", () => {
  const copies: [number, number][] = [[mine.K_PANEL, nodes.K_PANEL], [mine.K_TEXT, nodes.K_TEXT], [mine.K_BAR, nodes.K_BAR], [mine.K_BUTTON, nodes.K_BUTTON], [mine.K_HOLD, nodes.K_HOLD]];
  for (const name of ["S_TEXT", "S_LABEL", "S_DARK", "S_MENU", "S_MENU_NOTE", "S_HUD_HIT", "S_HUD_COUNT", "S_ICE", "S_MENU_HEADING", "S_WARNING", "S_KEY", "S_MENU_WARN", "S_UNMUTE"] as const) copies.push([mine[name], style[name]]);
  copies.push([mine.LINE, nodes.lineHeight(style.S_MENU_NOTE)], [mine.LINE, nodes.lineHeight(style.S_TEXT)], [mine.SMALL_LINE, nodes.lineHeight(style.S_LABEL)], [mine.SMALL_LINE, nodes.lineHeight(style.S_HUD_COUNT)], [mine.HEADING_LINE, nodes.lineHeight(style.S_MENU_HEADING)]);
  for (const [copy, real] of copies) expect(copy).toBe(real);
  expect([panel.KEY_COMPASS, panel.KEY_MINIMAP_FRAME, panel.KEY_CLOCK, panel.KEY_MINIMAP_TOGGLE]).toEqual([KEY_COMPASS, hudKeys.KEY_MINIMAP_FRAME, hudKeys.KEY_CLOCK, hudKeys.KEY_MINIMAP_TOGGLE]);
  for (const name of ["ABSENT", "LOADING", "ARRIVED", "RESIDENT", "DEAD", "RIDING", "MAPS", "WHY_NONE", "WHY_LANES", "WHY_WAITING", "WHY_RETRY", "WHY_FIRSTS", "WHY_SHARE", "WHY_LEVEL", "WHY_LARGE", "WHY_ALLOWANCE", "WHY_FULL"] as const) expect(copied[name], name).toBe(residency[name]);
  for (const name of ["STEP0_SIZE", "LAST_STEP", "RGBA_TOP"] as const) expect(copied[name], name).toBe(texture[name]);
  for (let px = 0; px <= 5000; px += 37) for (let most = 0; most <= 6; most++) expect(copied.stepFor(px, most)).toBe(residency.stepFor(px, most));
  for (let size = 0; size <= 5000; size += 16) expect(copied.stepOf(size)).toBe(texture.stepOf(size));
  for (const format of texture.TEXTURE_FORMATS) for (const top of [64, 512, 1024, 2048, 4096]) expect(copied.topIn(format, top)).toBe(texture.topIn(format, top));
});

test("the card says of a texture what is shown, what is wanted, what it was authored at and why it waits, in plain words", () => {
  const t: TextureInspection = { texture: 0, id: "core:compact/sidewall/normal", role: "normal", showing: 256, coming: 1024, wanted: 1024, asked: 900, relax: 1, authored: 1024, variant: 1024, tier: 1024, most: 1024, lowered: false, state: "arrived", why: "allowance", bytes: 0, comingBytes: 1398101, sent: 0, fetched: 0, shrinking: false, tries: 0, retryAt: 0, onScreen: true };
  expect(textureWords("Sidewall normal", t)).toEqual(["Sidewall normal 256 px, wants 1024", "downloaded, waiting for the card"]);
  expect(textureWords("Sidewall normal", { ...t, state: "loading", why: "" })).toEqual(["Sidewall normal 256 px, wants 1024", "downloading 1.3 MB"]);
  expect(textureWords("Sidewall normal", { ...t, state: "absent", why: "share" })).toEqual(["Sidewall normal 256 px, wants 1024", "waiting for room in the textures' share of the card"]);
  expect(textureWords("Tread colour", { ...t, showing: 256, wanted: 256, authored: 256, state: "absent", why: "" })).toEqual(["Tread colour 256 px: authored at 256", ""]);
  expect(textureWords("Bark colour", { ...t, showing: 1024, wanted: 1024, authored: 2048, variant: 1024, tier: 2048, state: "absent", why: "" })).toEqual(["Bark colour 1024 px: the most this format holds", "authored at 2048"]);
  expect(textureWords("Bark colour", { ...t, showing: 512, wanted: 512, authored: 2048, tier: 512, state: "absent", why: "" })).toEqual(["Bark colour 512 px: the most this graphics level takes", "authored at 2048"]);
  expect(textureWords("Bark colour", { ...t, showing: 512, wanted: 2048, most: 512, lowered: true, state: "absent", why: "" })[0]).toBe("Bark colour 512 px, wants 2048");
  expect(textureWords("Bark colour", { ...t, showing: 512, wanted: 512, most: 512, lowered: true, state: "absent", why: "" })).toEqual(["Bark colour 512 px: the most it can have", "a larger step failed to come"]);
  expect(textureWords("Hide mask", { ...t, showing: 0, wanted: 0, state: "absent", why: "", onScreen: false })).toEqual(["Hide mask none yet", "not asked for: drawn without it"]);
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
  m.refresh(f, 1000, false, false);
  expect([m.rates[0], m.rates[1], m.rates[2], m.queue]).toEqual(["1.0 MB/s", "500 KB/s", "1.5 MB/s", "4 downloading · 14 asked · 3.1 MB waiting for the card"]);
  r.flying = 0;
  m.refresh(f, 1050, false, false);
  expect(m.queue.startsWith("4 downloading")).toBe(true);
  m.refresh(f, 1100, false, false);
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
    // While H is held the card stands beside the crosshair, clear of the rest of the HUD and of the strip.
    if (inspect) {
      const card = fitsClear(f, KEY_CARD, where);
      expect(card.x + card.w <= f.width / 2 - 2 || card.x >= f.width / 2 + 2 || card.y >= f.height / 2 + 40, `${where}: card over the crosshair`).toBe(true);
      expect(card.y + card.h <= strip.y || card.y >= strip.y + hud.stripH || card.x >= strip.x + hud.stripW, `${where}: card over the strip`).toBe(true);
    } else expect(glassBox(f, KEY_CARD), where).toBeNull();
  }
});

test("the chart reads the last minute's buckets, oldest first, its top the least scale that holds the tallest", () => {
  const ring = new FrameRing(), stats = { fetched: 0, stale: 0, cached: 0, disk: 0, uploaded: 0 };
  const r = { stats, spentOther: 0, flying: 0, flyingLarge: 0, waiting: 0, wanting: () => 0, ledger: 0, texLedger: 0, cardFull: false, shareShort: false, holdBack: false };
  // Ninety seconds; in second 80 three megabytes come over the network and one frame takes 83 ms.
  for (let t = 0; t < 90000; t += 50) {
    const second = Math.floor(t / 1000);
    stats.fetched += second === 80 ? 150000 : 1000;
    stats.uploaded += 500;
    ring.record(t, second === 80 && t % 1000 === 0 ? 83 : 50, 4, 0, r as never, null);
  }
  const chart = new ChartData();
  chart.read(ring);
  // The latest column is second 89, the oldest second 30.
  expect([chart.second[CHART_SECONDS - 1], chart.second[0]]).toEqual([89, 30]);
  const col = CHART_SECONDS - 1 - 9;
  expect(chart.second[col]).toBe(80);
  expect(chart.bytes[col * SERIES]).toBe(20 * 150000);
  expect([chart.slow[col], chart.worst[col], chart.slow[col - 1]]).toEqual([1, 83, 0]);
  expect(chart.scale).toBe(4 * 1048576);
  expect(scaleText(chart.scale)).toBe("4 MB/s");
  const box = chartBox(100, 50, 248, 100, { x: 0, y: 0, w: 0, h: 0, column: 0 });
  expect([columnAt(box, 100 + 4), columnAt(box, 100 + 4 + 4 * 60 - 1), columnAt(box, 90)]).toEqual([0, 59, -1]);
  // Frozen, it keeps what it showed.
  const still = new ChartData();
  still.copy(chart);
  expect(Array.from(still.bytes)).toEqual(Array.from(chart.bytes));
});

test("the panel opens from the strip while H is held, closes by its button, Escape and F3, and frees the mouse while open", () => {
  const ui = new Ui(), hud = new HudModel();
  const m = new Monitor(fakeApp(new FrameRing()), MONITOR_KIT);
  ui.monitor = m;
  ui.settings.diagnostics = ui.settings.monitor = true;
  ui.build(16 / 9, hud, null);
  expect(ui.frame.find(KEY_STRIP_OPEN)).toBeNull();
  ui.key("KeyH", true, false, null);
  ui.build(16 / 9, hud, null);
  expect(ui.frame.find(KEY_STRIP_OPEN)!.interactive).toBe(true);
  ui.pointer(0, KEY_STRIP_OPEN, 100, 100, 0, null);
  ui.key("KeyH", false, false, null);
  expect([m.open, ui.wantsPointerLock, ui.captureKeyboard]).toEqual([true, false, false]);
  ui.build(16 / 9, hud, null);
  expect(glassBox(ui.frame, KEY_PANEL)).not.toBeNull();
  // The readout gives way to the panel, and so does the strip.
  expect(ui.frame.find(KEY_READOUT)).toBeNull();
  expect(glassBox(ui.frame, KEY_MONITOR)).toBeNull();
  ui.pointer(0, KEY_TAB + 1, 0, 0, 0, null);
  expect(m.tab).toBe(1);
  ui.build(16 / 9, hud, null);
  ui.pointer(0, KEY_COLUMN_BACK, 0, 0, 0, null);
  expect(m.column).toBe(CHART_SECONDS - 1);
  ui.pointer(0, KEY_COLUMN_BACK, 0, 0, 0, null);
  expect(m.column).toBe(CHART_SECONDS - 2);
  const pick = ui.frame.find(KEY_CHART_PICK)!;
  ui.pointer(0, KEY_CHART_PICK, pick.x + 6, pick.y + 10, 0, null);
  expect(m.column).toBe(0);
  ui.pointer(0, KEY_FREEZE, 0, 0, 0, null);
  expect(m.frozen).toBe(true);
  ui.key("Escape", true, false, null);
  expect([m.open, ui.wantsPointerLock, ui.menu]).toEqual([false, true, false]);
  ui.pointer(0, KEY_STRIP_OPEN, 0, 0, 0, null);
  ui.pointer(0, KEY_CLOSE, 0, 0, 0, null);
  expect(m.open).toBe(false);
  // Turned off, the monitor's panel is gone with it.
  m.open = true;
  ui.key("F3", true, false, null);
  expect(ui.wantsPointerLock).toBe(true);
  ui.build(16 / 9, hud, null);
  expect(glassBox(ui.frame, KEY_PANEL)).toBeNull();
});

test("the panel and its chart fit every window, each tab: words fit, controls apart, clear of the compass, the minimap and the unmute offer", () => {
  const ring = new FrameRing(), stats = { fetched: 0, stale: 0, cached: 0, disk: 0, uploaded: 0 };
  const r = { stats, spentOther: 0, flying: 0, flyingLarge: 0, waiting: 0, wanting: () => 0, ledger: 0, texLedger: 0, cardFull: false, shareShort: false, holdBack: false };
  for (let t = 0; t < 70000; t += 20) { stats.fetched += 3000; stats.disk += 800; stats.cached += 900; stats.uploaded += 2000; ring.record(t, t % 9000 === 0 ? 80 : 20, 4, 0, r as never, null); }
  const app = fakeApp(ring);
  (app as unknown as { nowMs: number }).nowMs = 70000;
  const ui = new Ui(), hud = new HudModel(), m = new Monitor(app, MONITOR_KIT);
  ui.monitor = m;
  ui.settings.diagnostics = ui.settings.monitor = true;
  const windows: [number, number][] = [[405, 720], [960, 720], [1280, 720], [1680, 720], [2560, 720], [1056, 488], [834, 469], [710, 400], [1280, 576]];
  for (const [w, h] of windows) for (const muted of [true, false]) for (let tab = 0; tab < 3; tab++) {
    ui.canvasHeight = h; ui.settings.muted = muted;
    m.open = true; m.tab = tab; m.column = tab === 1 ? 40 : -1; m.refreshNow();
    ui.build(w / h, hud, null);
    const f = ui.frame, where = `${w}x${h}${muted ? " muted" : ""} tab ${tab}`;
    // A screen covers the middle of the HUD, as the inventory does: the crosshair, its cone and what shows under it.
    fitsClear(f, KEY_PANEL, where, (n) => n.key >= 24 && n.key <= 35);
    const controls = f.nodes.slice(0, f.count).filter((n) => n.interactive);
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) expect(meets(controls[i]!, controls[j]!), `${where}: ${controls[i]!.key} over ${controls[j]!.key}`).toBe(false);
  }
});
