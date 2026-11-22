// The resource monitor among the whole HUD by touch: its strip and its page at every phone and tablet window, either
// way up and with the screen's edges, clear of the touch layer's controls and of the rest of the HUD. The windows and
// states are built from the interface's models (kit `direct`); three whole clients on the harness reach a state by
// real input, pass the same checks, and show that what the models build is, node for node, what the app builds.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { VehicleTelemetry, type HudModel } from "../../client/core/hud.ts";
import { KEY_TOUCH_BUTTON, T_CLOSE, T_MAP, touchKey } from "../../client/core/touch.ts";
import { KEY_CLOCK, KEY_MINIMAP, KEY_READOUT, KEY_VEHICLE } from "../../client/core/ui/hud.ts";
import { KEY_MONITOR, KEY_STRIP_OPEN, Monitor } from "../../client/core/ui/monitor.ts";
import { MONITOR_KIT } from "../../client/core/ui/monitor-kit.ts";
import { KEY_PANEL, KEY_TAB } from "../../client/core/ui/monitor-panel.ts";
import type { UiFrame, UiNode } from "../../client/core/ui/nodes.ts";
import * as layout from "../../client/core/ui/touch.ts";
import { JET_FULL_SUIT } from "../../shared/sim/character.ts";
import { fitsClear, glassBox, meets, stripFits, within } from "../fixtures/monitor.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { PHONES, camp, direct, nodes, screen, stood, vehicle, type Direct, type Phone, type Stood } from "../kit/kit.ts";

/** What stands under the minimap: nothing, the jet fuel, or a vehicle's instruments. */
const UNDER = ["", "jets", "car", "boat", "helicopter"];

/** A hand with something to use, and under the minimap the jet fuel or a vehicle's instruments. */
function show(hud: HudModel, under: string): void {
  hud.prompt = "E  ride a raptor with a long name";
  if (under === "jets") hud.jetGear = JET_FULL_SUIT;
  else if (under) hud.vehicle = Object.assign(new VehicleTelemetry(), { active: true, rotor: under === "helicopter", boat: under === "boat" });
}

/** The strip fits and stands clear, or has given way where a vehicle's instruments leave it no room. */
function stripStands(f: UiFrame, wide: boolean, under: string, where: string): void {
  // A vehicle's instruments may leave the strip no room above the crosshair and the stick: on a phone on its side,
  // where they stand under the bar, the strip and the readout give way; upright, the strip alone.
  if (glassBox(f, KEY_MONITOR) === null) {
    expect([under !== "" && under !== "jets", f.find(KEY_READOUT) === null], where).toEqual([true, wide]);
    return;
  }
  stripFits(f, where);
  // A vehicle's instruments stand clear of everything but the zones a finger plays in, the strip (which is clear of them) and their own.
  const own = (n: UiNode): boolean => (n.key >= KEY_VEHICLE && n.key < KEY_VEHICLE + 12) || (n.key >= 2000000 + KEY_VEHICLE * 16 && n.key < 2000000 + (KEY_VEHICLE + 12) * 16);
  if (under !== "" && under !== "jets") fitsClear(f, KEY_VEHICLE, where, own);
}

/** The page of one tab fits under the touch layer's Close, its controls finger-sized and apart. */
function pageFits(f: UiFrame, tab: number, at: string): void {
  const close = f.find(KEY_TOUCH_BUTTON + T_CLOSE)!;
  expect(close, at).not.toBeNull();
  // The page and its words fit, and nothing else but the crosshair's band is under it.
  within(f, fitsClear(f, KEY_PANEL, at, (n) => n.key >= 24 && n.key <= 35), KEY_PANEL, KEY_PANEL + 600, at);
  const controls = f.nodes.slice(0, f.count).filter((n) => n.interactive);
  for (const n of controls) if (n.key >= 8000 && n.key < 9000) expect(Math.min(n.w, n.h), `${at}: ${n.key} "${n.label}"`).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) expect(meets(controls[i]!, controls[j]!), `${at}: ${controls[i]!.key} over ${controls[j]!.key}`).toBe(false);
  expect(f.find(KEY_TAB + tab), at).not.toBeNull();
}

/** Upright, the strip stands across the canvas under the minimap and its clock, clear of the readout. */
function stripAcross(f: UiFrame, name: string): void {
  const box = stripFits(f, name), map = f.find(KEY_MINIMAP)!, clock = f.find(KEY_CLOCK)!;
  // Across the canvas between its margins, and under the minimap where its button is, at the top.
  expect(box.x, name).toBeCloseTo(f.left + 12, 5);
  // Its right edge on the minimap's frame's, which stands 2 units past the picture.
  expect(box.x + box.w, name).toBeCloseTo(map.x + map.w + 2, 5);
  expect(map.y, name).toBeLessThan(f.top + 20);
  expect(box.y, name).toBeGreaterThanOrEqual(clock.y + clock.h);
  const button = f.find(KEY_TOUCH_BUTTON + T_MAP)!;
  expect(meets(button, map), name).toBe(true);
  for (let i = 0; i < 3; i++) {
    const line = f.find(KEY_READOUT + i);
    if (line) expect(line.y + line.h <= box.y && line.x + line.w <= map.x, `${name}: readout ${i}`).toBe(true);
  }
}

/** The monitor's interface by touch at a window, from models. */
function monitored([, w, h, insets]: Phone, muted: boolean, as?: Stood): Direct {
  const d = direct(w, h, insets, { finger: true, monitor: true, as });
  d.ui.settings.muted = muted;
  return d;
}

/** An app played by a finger with the monitor on, as the page has it once its file has come. */
function fingered(app: App, [, , , insets]: Phone, muted: boolean): App {
  app.ui.inputDevice = 2;
  app.ui.layer = layout;
  app.ui.settings.diagnostics = app.ui.settings.monitor = true;
  app["monitorAsked"] = true;
  app.ui.monitor = new Monitor(app, MONITOR_KIT);
  app.ui.settings.muted = muted;
  insets.forEach((v, i) => (app.insets[i] = v));
  return app;
}

/** A finger's press and release of a key of the interface. */
function press(app: App, key: number, x = 0, y = 0): void {
  app.pointer(0, key, x, y, 0, 1);
  app.pointer(1, key, x, y, 0, 1);
}

test("by touch the strip fits every phone and tablet, clear of the rest", () => {
  for (const phone of PHONES) for (const muted of [true, false]) for (const under of UNDER) {
    const d = monitored(phone, muted);
    show(d.hud, under);
    stripStands(d.build(), phone[1] > phone[2], under, `${phone[0]}${muted ? ", muted" : ""}${under && `, ${under}`}`);
  }
});

test("by touch the strip opens the monitor's page, each tab fitting every window", () => {
  for (const phone of PHONES) for (const muted of [true, false]) {
    const d = monitored(phone, muted), f = d.build(), where = `${phone[0]}${muted ? ", muted" : ""}`;
    const open = f.find(KEY_STRIP_OPEN)!;
    expect(open.interactive, where).toBe(true);
    d.ui.pointer(0, KEY_STRIP_OPEN, open.x + 10, open.y + 10, 0, d.session);
    for (let tab = 0; tab < 3; tab++) {
      d.ui.monitor!.tab = tab;
      d.ui.monitor!.refreshNow();
      d.build();
      expect(d.ui.wantsPointerLock, `${where}, tab ${tab}`).toBe(false);
      pageFits(f, tab, `${where}, tab ${tab}`);
    }
    // Its Close is Escape, which shuts the page.
    d.ui.key(touchKey(T_CLOSE)!, true, false, d.session);
    expect(d.ui.monitor!.open, where).toBe(false);
  }
});

test("upright the strip stands across under the minimap and its clock", () => {
  for (const phone of PHONES) if (phone[1] < phone[2]) stripAcross(monitored(phone, false).build(), phone[0]);
});

test("a driver's strip in a whole client is the strip its models build", () => {
  const phone = PHONES[0]!, [name, w, h] = phone;
  const { h: net, ada } = camp({ screen: true }), view = screen(net, ada), app = fingered(view.app, phone, true);
  vehicle(net, ada, "compact", { drive: true });
  [view.width, view.height] = [w, h];
  net.run(600);
  expect(app.hud.vehicle?.active, name).toBe(true);
  stripStands(app.ui.frame, w > h, "car", name);
  const d = monitored(phone, true, stood(app));
  [d.hud.vehicle, d.hud.prompt] = [app.hud.vehicle, app.hud.prompt];
  expect(nodes(d.build())).toEqual(nodes(app.ui.frame));
});

test("a finger opens the page in a whole client, and Close shuts it", () => {
  const phone = PHONES[3]!, [name, w, h] = phone;
  const net = new Harness(), app = fingered(new App(net.join("page", { latencyMs: 20 }, { manual: true }), net.reg, corePack()), phone, false);
  const run = (ms: number): void => net.run(ms, (now) => app.frame(now, w, h));
  run(300);
  // The eye is turned to the sky, where the monitor's line of what is looked at has nothing to name.
  app.look(0, -4000);
  run(300);
  const f = app.ui.frame, open = f.find(KEY_STRIP_OPEN)!, d = monitored(phone, false, stood(app));
  expect(nodes(d.build())).toEqual(nodes(f));
  expect(open.interactive, name).toBe(true);
  press(app, KEY_STRIP_OPEN, open.x + 10, open.y + 10);
  d.ui.pointer(0, KEY_STRIP_OPEN, open.x + 10, open.y + 10, 0, d.session);
  for (let tab = 0; tab < 3; tab++) {
    app.ui.monitor!.tab = d.ui.monitor!.tab = tab;
    app.ui.monitor!.refreshNow();
    d.ui.monitor!.refreshNow();
    run(50);
    expect(app.ui.wantsPointerLock, `${name}, tab ${tab}`).toBe(false);
    pageFits(f, tab, `${name}, tab ${tab}`);
    // Food and water have fallen a little in the frames between.
    [d.hud.vitals[2]!.fraction, d.hud.vitals[3]!.fraction] = [app.hud.vitals[2]!.fraction, app.hud.vitals[3]!.fraction];
    expect(nodes(d.build()), `${name}, tab ${tab}`).toEqual(nodes(f));
  }
  press(app, KEY_TOUCH_BUTTON + T_CLOSE);
  run(50);
  expect(app.ui.monitor!.open, name).toBe(false);
});

test("a whole client upright lays its strip out as the models do", () => {
  const phone = PHONES[5]!, [name, w, h] = phone;
  const net = new Harness(), app = fingered(new App(net.join("upright", { latencyMs: 20 }, { manual: true }), net.reg, corePack()), phone, false);
  net.run(600, (now) => app.frame(now, w, h));
  stripAcross(app.ui.frame, name);
  // The new survivor of the kit's models: the same nodes in the same boxes, whatever their words.
  const boxes = (f: UiFrame): string[] => f.nodes.slice(0, f.count).map((n) => [n.key, n.kind, n.x, n.y, n.w, n.h, n.interactive].join(" "));
  expect(boxes(monitored(phone, false).build())).toEqual(boxes(app.ui.frame));
});
