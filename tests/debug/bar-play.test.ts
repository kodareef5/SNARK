// The debug bar in a whole client on the harness: Shift+F3 fetches it and opens its drawer, the HUD stands over it, each tab
// lays out inside the drawer at the windows players have, the pointer goes between the drawer and the game, turning it
// off lets go of every hook, and a save arrives in a report store as a capture.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { BAR_H, type DebugBar } from "../../client/core/debug/debug.ts";
import { SpanFrame } from "../../client/core/debug/spans.ts";
import { KEY_DEBUG } from "../../client/core/debug/draw.ts";
import { EV_LONG, EV_TASK } from "../../client/core/debug/events.ts";
import { SOURCE_PAGE } from "../../client/core/debug/log.ts";
import { KEY_HOTBAR } from "../../client/core/ui/hud.ts";
import { textWidth } from "../../client/core/ui/nodes.ts";
import { LEVEL_ERROR } from "../../shared/debug.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { ReportStore } from "../../server/reports.ts";
import { fakePort, type FakePort } from "../fixtures/debug-port.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import type { MenuScreen } from "../../client/core/ui/menu-screen.ts";

const pack = parsePack(corePackBytes());
const ROOT = join(import.meta.dir, "../..");

/**
 * A client on the harness whose frames are drawn as the shell draws them, at `w` by `h` points. `late` puts the frames
 * after it that many ms later, as a frame that took them would.
 */
function client(h: Harness, port: FakePort, w = 1280, ht = 720): { app: App; run: (ms: number) => void; size: (w: number, h: number) => void; late: (ms: number) => void } {
  const app = new App(h.join("dee", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  app.debugPort = async () => port;
  let W = w, H = ht, lead = 0;
  const run = (ms: number): void => h.run(ms, (now) => {
    const p = app.frame(now + lead, W, H);
    if (p) app.drawn(p, 2, W, H, 0, 1);
  });
  return { app, run, size: (a, b) => void ((W = a), (H = b)), late: (ms) => void (lead += ms) };
}

/** Runs `ms` of frames a tenth of a second at a time, letting what the port answers come in between, as a browser does. */
async function play(run: (ms: number) => void, ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    run(Math.min(100, ms - t));
    await Bun.sleep(0);
  }
}

/** Frames until the bar has come and its port with it. */
async function barOf(app: App, run: (ms: number) => void): Promise<DebugBar> {
  for (let i = 0; i < 400 && !(app.ui.debug && app.ui.debug.port); i++) {
    run(20);
    await Bun.sleep(2);
  }
  expect(app.ui.debug?.port).not.toBeNull();
  return app.ui.debug!;
}

test("the bar is off at first, and Shift+F3 fetches it and opens its drawer", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), { app, run } = client(h, fakePort());
  run(600);
  expect([app.ui.settings.debug, app.ui.debug]).toEqual([false, null]);
  expect(app.ui.frame.find(KEY_DEBUG)).toBeNull();
  app.key("ShiftLeft", true);
  app.key("F3", true);
  app.key("ShiftLeft", false);
  app.key("F3", false);
  expect(app.ui.settings.debug).toBe(true);
  const bar = await barOf(app, run);
  run(100);
  expect([bar.open, bar.holdsPointer, app.ui.wantsPointerLock]).toEqual([true, true, false]);
  // Shift+F3 again closes the drawer and keeps the bar, which keeps the pointer no more.
  app.key("ShiftLeft", true);
  app.key("F3", true);
  app.key("ShiftLeft", false);
  run(50);
  expect([app.ui.settings.debug, bar.open, app.ui.wantsPointerLock]).toEqual([true, false, true]);
});

test("with the bar on, each frame is timed and recorded and the HUD stands over the bar", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), port = fakePort(), { app, run } = client(h, port);
  app.ui.settings.debug = true;
  const bar = await barOf(app, run);
  run(3000);
  // The pictures come once their promises settle.
  await Bun.sleep(5);
  expect(app.probe).toBe(bar.spans);
  expect(app.session.tap).toBe(bar.net);
  expect(bar.spans.rows).toBeGreaterThan(100);
  expect(bar.perf.rows).toBeGreaterThan(100);
  expect(bar.net.bytesIn).toBeGreaterThan(0);
  // A picture every two seconds, kept as the port made them.
  expect(bar.shots!.shots.length).toBeGreaterThanOrEqual(1);
  const f = app.ui.frame, hotbar = f.find(KEY_HOTBAR)!;
  expect(hotbar.y + hotbar.h).toBeLessThanOrEqual(f.height - BAR_H + 0.01);
  // A line the page logged reaches the bar's log, and an error counts on the bar.
  port.queued.push({ at: app.nowMs, level: LEVEL_ERROR, text: "a page error" });
  run(300);
  const out: { text: string }[] = [];
  bar.log.read(out as never, 1 << SOURCE_PAGE, LEVEL_ERROR, 10);
  expect(out.map((l) => l.text)).toEqual(["a page error"]);
});

test("each tab lays out inside the drawer and the bar at the windows players have", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), { app, run, size } = client(h, fakePort());
  run(600);
  app.session.text("enablecheats");
  app.ui.settings.debug = true;
  const bar = await barOf(app, run);
  run(2500);
  await Bun.sleep(5);
  // Each tab's chosen state too: a second on the timeline, an event's frame, a log line read whole, a picture opened.
  const chosen = (on: boolean): void => {
    const [timeline, , , log, shots] = bar.tabs as unknown as Record<string, unknown>[];
    timeline!["chosen"] = on ? Math.floor(app.nowMs / 1000) - 1 : -1;
    bar.chosenSpans = on ? bar.spans.read(bar.spans.row(0), new SpanFrame()) : null;
    bar.chosenAt = on ? app.nowMs : -1;
    const lines: unknown[] = [];
    bar.log.read(lines as never, 7, 0, 1);
    log!["open"] = on ? (lines[0] ?? null) : null;
    shots!["opened"] = on ? (bar.shots!.shots[0]?.at ?? -1) : -1;
  };
  bar.line(0, 3, "a long line, as an error that comes with its stack: ".repeat(8));
  for (const [w, ht, on] of [[1280, 720, false], [1920, 1080, false], [2560, 1080, false], [1024, 768, false], [844, 390, false], [390, 844, false], [1280, 720, true], [844, 390, true], [390, 844, true]] as const) {
    size(w, ht);
    chosen(on);
    for (let t = 0; t < bar.tabs.length; t++) {
      bar.show(t);
      run(40);
      const f = app.ui.frame, where = `${bar.tabs[t]!.name} at ${w}x${ht}${on ? ", chosen" : ""}`;
      const ours = f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_DEBUG && n.key < KEY_DEBUG + 4000);
      expect(ours.length, where).toBeGreaterThan(10);
      for (const n of ours) {
        expect(n.x >= -0.01 && n.y >= -0.01 && n.x + n.w <= f.width + 0.01 && n.y + n.h <= f.height + 0.01, `${where}: ${n.key} "${n.text}" at ${n.x},${n.y} ${n.w}x${n.h}`).toBe(true);
        if (n.text && n.kind === 1) expect(textWidth(n.text, n.style), `${where}: "${n.text}"`).toBeLessThanOrEqual(n.w + 0.01);
      }
      // The drawer is the first node and the bar's strip comes after the tab's: the tab's nodes stand inside the drawer.
      const drawer = ours[0]!, strip = ours.findIndex((n) => n.y >= drawer.y + drawer.h - 0.5 && n.w >= f.width - 0.5);
      expect(strip, where).toBeGreaterThan(0);
      for (const n of ours.slice(1, strip)) expect(n.y >= drawer.y - 0.01 && n.y + n.h <= drawer.y + drawer.h + 0.5, `${where}: ${n.key} "${n.text || n.label}" at ${n.x},${n.y} ${n.w}x${n.h} past the drawer ${drawer.y}..${drawer.y + drawer.h}`).toBe(true);
    }
  }
});

test("Escape gives the pointer to an open drawer, and a press on the world gives it back", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), { app, run } = client(h, fakePort());
  app.ui.settings.debug = true;
  const bar = await barOf(app, run);
  bar.show(0);
  run(50);
  app.ui.clickWorld();
  expect([bar.open, bar.holdsPointer, app.ui.wantsPointerLock]).toEqual([true, false, true]);
  // The browser lets the lock go on Escape; the drawer takes the pointer and the menu stays shut.
  app.ui.escaped();
  expect([bar.holdsPointer, app.ui.screen<MenuScreen>("menu").menu]).toEqual([true, false]);
  // Escape again, with the pointer free, shuts the drawer.
  app.key("Escape", true);
  expect([bar.open, app.ui.screen<MenuScreen>("menu").menu]).toEqual([false, false]);
  // With the drawer shut, Escape is the menu's again.
  app.ui.escaped();
  expect(app.ui.screen<MenuScreen>("menu").menu).toBe(true);
});

test("a press on a tab opens it, and on the open tab shuts the drawer", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), { app, run } = client(h, fakePort());
  app.ui.settings.debug = true;
  const bar = await barOf(app, run);
  run(50);
  const tab = (name: string): number => app.ui.frame.nodes.slice(0, app.ui.frame.count).find((n) => n.key >= KEY_DEBUG && n.label === name)!.key;
  app.pointer(0, tab("Network"), 0, 0, 0);
  run(30);
  expect([bar.open, bar.tabs[bar.tab]!.name]).toEqual([true, "Network"]);
  app.pointer(0, tab("Network"), 0, 0, 0);
  run(30);
  expect(bar.open).toBe(false);
});

test("turning the bar off lets go of every hook, and on takes them again", async () => {
  const h = new Harness({}, 1, 60, { dev: true }), { app, run } = client(h, fakePort());
  app.ui.settings.debug = true;
  const bar = await barOf(app, run);
  run(200);
  const parts = app["parts"].length;
  app.ui.settings.debug = false;
  run(100);
  expect([app.probe, app.session.tap, app.ui.frame.find(KEY_DEBUG)]).toEqual([null, null, null]);
  expect(app["parts"].length).toBe(parts);
  const rows = bar.spans.rows;
  run(200);
  expect(bar.spans.rows).toBe(rows);
  app.ui.settings.debug = true;
  run(200);
  expect(app.probe).toBe(bar.spans);
  expect(bar.spans.rows).toBeGreaterThan(rows);
});

test("a save arrives in a report store as a capture an agent can read", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-capture-"));
  try {
    const store = new ReportStore({ dir, root: ROOT, clientDir: dir, map: { id: "proving" } });
    const h = new Harness({}, 1, 60, { dev: true }), port = fakePort((req) => store.answer(req, { sender: () => ({ name: "dee", admin: true }), facts: () => ({}) }));
    const { app, run } = client(h, port);
    run(600);
    app.session.text("enablecheats");
    app.ui.settings.debug = true;
    const bar = await barOf(app, run);
    await play(run, 5000);
    expect(app.session.admin).toBe(true);
    app.ui.chat.local!("debug save the kerb floats here");
    for (let i = 0; i < 400 && !bar.saved.startsWith("saved") && !bar.saved.startsWith("not"); i++) {
      run(20);
      await Bun.sleep(2);
    }
    expect(bar.saved).toMatch(/^saved capture 1 \(\d+ pictures\)$/);
    const folder = join(dir, "0001"), files = readdirSync(folder);
    expect(files).toEqual(expect.arrayContaining(["report.md", "report.json", "perf.json", "events.json", "log.json", "net.json", "server.json", "shot-01.jpg"]));
    const report = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"));
    expect([report.kind, report.text[0].line, report.shots.at(-1).w]).toEqual(["capture", "the kerb floats here", 1280]);
    expect(report.shots.length).toBe(files.filter((f) => /^shot-\d+\.jpg$/.test(f)).length);
    const perf = JSON.parse(readFileSync(join(folder, "perf.json"), "utf8"));
    expect(perf.spans.names).toEqual(expect.arrayContaining(["frame", "app", "build", "near store"]));
    expect(perf.frames.length).toBeGreaterThan(200);
    const net = JSON.parse(readFileSync(join(folder, "net.json"), "utf8"));
    expect(net.categories.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["player", "bodies"]));
    expect(readFileSync(join(folder, "report.md"), "utf8")).toContain("## What happened");
    // The chat says it, as the owner sees it.
    expect(app.ui.chat.lines.some((l) => l.text.startsWith("Debug bar: saved capture 1"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one hitch tells one story: on the timeline, in the Frame tab, in its picture and in the capture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-capture-"));
  try {
    const store = new ReportStore({ dir, root: ROOT, clientDir: dir, map: { id: "proving" } });
    const h = new Harness({}, 1, 60, { dev: true }), port = fakePort((req) => store.answer(req, { sender: () => ({ name: "dee", admin: true }), facts: () => ({}) }));
    const { app, run, late } = client(h, port);
    run(600);
    app.session.text("enablecheats");
    app.ui.settings.debug = true;
    const bar = await barOf(app, run);
    let pageMs = bar.spans.now();
    bar.spans.now = () => pageMs;
    await play(run, 5000);
    // Advance the span clock inside the dash and the frame clock on the following frame.
    const dash = app["dash"], step = dash.step.bind(dash);
    let slow = true;
    dash.step = (f: Parameters<typeof step>[0]) => {
      if (slow) {
        slow = false;
        pageMs += 60;
        late(70);
      }
      step(f);
    };
    run(50);
    // Then a browser's long task, apart from it, close behind.
    port.tasks.push([1, 90]);
    await play(run, 100);
    const own = app.session.own, there = [own.x, own.y, own.z];
    const hitch = bar.events.list.find((e) => e.kind === EV_LONG)!;
    expect(hitch.cause).toMatch(/\bdash\b/);
    expect(bar.events.list.filter((e) => e.kind === EV_TASK).map((e) => [e.size, e.cause])).toEqual([[90, "the main thread was busy"]]);
    // A block on, and half a minute later the moment is chosen on the timeline.
    app.session.text(`tp ${Math.round(own.x + 150)} ${Math.round(own.z)}`);
    await play(run, 30_000);
    expect(Math.hypot(own.x - there[0]!, own.z - there[2]!)).toBeGreaterThan(100);
    bar.show(0);
    await play(run, 50);
    const shown = () => app.ui.frame.nodes.slice(0, app.ui.frame.count).filter((n) => n.key >= KEY_DEBUG);
    const row = shown().find((n) => n.text === "long frame")!;
    app.pointer(0, row.key, 0, 0, 0);
    await play(run, 50);
    // The Frame tab shows the frame before it, where the dash took the time.
    expect([bar.tabs[bar.tab]!.name, bar.chosenAt, bar.chosenEvent]).toEqual(["Frame", hitch.at, hitch]);
    const slot = bar.spans.names.indexOf("dash");
    expect(bar.chosenSpans!.ms[slot]).toBeGreaterThan(55);
    expect(shown().some((n) => /the frame before the event 3\d s ago/.test(n.text))).toBe(true);
    // Back on the timeline, the chosen second still has its frames one by one, 1,800 frames back.
    bar.show(0);
    await play(run, 50);
    expect(shown().map((n) => n.text).filter((t) => t.startsWith("the frames of"))).toEqual([expect.stringMatching(/^the frames of 3\d s ago$/)]);
    bar.show(bar.tabs.findIndex((t) => t.name === "Frame"));
    await play(run, 50);
    app.key("F8", true);
    app.key("F8", false);
    for (let i = 0; i < 400 && !bar.saved.startsWith("saved") && !bar.saved.startsWith("not"); i++) {
      run(20);
      await Bun.sleep(2);
    }
    expect(bar.saved).toMatch(/^saved capture 1/);
    const folder = join(dir, "0001"), read = (name: string) => JSON.parse(readFileSync(join(folder, name), "utf8"));
    const report = read("report.json"), perf = read("perf.json"), events = read("events.json"), net = read("net.json");
    // When: the capture began when the bar did, not three minutes back, and the chosen moment is the hitch's.
    const start = perf.start as number;
    expect(start).toBe(Math.round(bar.recordingFrom));
    expect(app.nowMs - start - report.ms).toBeGreaterThanOrEqual(0);
    expect(app.nowMs - start - report.ms).toBeLessThan(2000);
    expect(report.chosen.at).toBe(Math.round(hitch.at - start));
    const saved = events.events.find((e: { kind: string }) => e.kind === "long frame");
    expect([saved.at, saved.cause]).toEqual([report.chosen.at, hitch.cause]);
    expect(events.events.filter((e: { kind: string }) => e.kind === "long task").map((e: { size: number }) => e.size)).toEqual([90]);
    expect(report.chosen.what).toContain("long frame");
    expect(report.chosen.what).toContain("dash");
    // Where: the chosen picture was taken where the hitch was, not where the save was.
    const picture = report.shots[report.chosen.shot];
    expect(Math.abs(picture.at - report.chosen.at)).toBeLessThan(1000);
    expect(Math.hypot(picture.place[0] - there[0]!, picture.place[2] - there[2]!)).toBeLessThan(2);
    expect(Math.hypot(report.place.x - there[0]!, report.place.z - there[2]!)).toBeGreaterThan(100);
    const md = readFileSync(join(folder, "report.md"), "utf8");
    expect(md).toContain("## Chosen in the bar");
    expect(md).toContain(`tp ${picture.place[0].toFixed(2)}`);
    // What: the dash, in the event, in the slowest frame the record kept, and nowhere the card's passes.
    expect(saved.top[0].slot).toMatch(/\bdash$/);
    const names = perf.spans.names as string[], slowest = perf.spans.slowest[0];
    expect(slowest.ms[names.indexOf("dash")]).toBeGreaterThan(55);
    expect(Math.abs(slowest.at - report.chosen.at)).toBeLessThan(100);
    // Each record says what part of the capture it holds; the slots' ring holds less than the capture.
    expect(perf.window).toEqual({ from: expect.any(Number), to: report.ms });
    expect(perf.window.from).toBeLessThan(100);
    expect(perf.spans.from).toBeGreaterThan(0);
    expect(events.window).toEqual({ from: 0, to: report.ms });
    // The socket's whole seconds lie inside the capture, and its rates are over them.
    expect(net.window.to - net.window.from).toBe(net.seconds * 1000);
    expect(net.window.from).toBeGreaterThanOrEqual(0);
    expect(net.window.to).toBeLessThanOrEqual(report.ms);
    expect(net.seconds).toBeGreaterThanOrEqual(Math.floor(report.ms / 1000) - 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
