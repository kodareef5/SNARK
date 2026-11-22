// Bug report mode in a whole client (client/core/notes/notes.ts), with a stand-in for the browser's port: it arms where
// the server keeps notes and the session is an admin's, F8 takes a picture at once and one every three seconds, a typed
// chat line goes into the note, F8 sends it as one upload and keeps it when the upload fails, Esc twice discards it,
// `perf` keeps a record with a picture at each end, and the record runs only while the mode is armed.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { NOTES_KIT } from "../../client/core/notes-kit.ts";
import { Notes } from "../../client/core/notes/notes.ts";
import type { Answer, NotePort } from "../../client/core/notes/port.ts";
import { C, CELLS, FLAG_AFTER_SHOT, FLAG_SHOT } from "../../client/core/notes/ring.ts";
import { KEY_MENU_NOTE } from "../../client/core/ui/menu.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";
import { glassBox, meets } from "../fixtures/monitor.ts";

const pack = parsePack(corePackBytes());

interface Posted { fields: Record<string, string>; files: [string, unknown][] }

/** The browser's part, as a test sees it: pictures named by their number, and the server's answers in turn. */
function fakePort(answers: Answer[], failing: readonly number[] = []): NotePort & { posted: Posted[]; shots: number } {
  let clock = 0;
  const port = {
    posted: [] as Posted[],
    shots: 0,
    now: () => (clock += 0.01),
    shot: (_wide: number, thumb: number) => {
      const n = ++port.shots;
      return { ms: 0.5, picture: failing.includes(n) ? Promise.reject(new Error("the card was lost")) : Promise.resolve({ jpeg: `picture ${n}`, w: 1280, h: 720, thumb: thumb > 0 ? "thumbnail" : null }) };
    },
    heap: () => 120,
    longTasks: (out: Float64Array) => void out.fill(0),
    // By pass the casters take 1.5 ms and the near pass 3; whole, the frame 4.5.
    gpu: (mode: number, out: Float64Array) => {
      out.fill(0);
      if (mode === 2) [out[1], out[2]] = [1.5, 3];
      else out[0] = 4.5;
      return mode > 0;
    },
    glDraws: () => 300,
    page: () => ({ browser: "a test", card: "no card", format: "rgba" }),
    get: (path: string) => Promise.resolve(path === "__report" ? { status: 204, text: "" } : { status: 200, text: '{"commit":"c0ffee","clean":true}' }),
    post: (_path: string, fields: readonly (readonly [string, string])[], files: readonly (readonly [string, unknown])[]) => {
      port.posted.push({ fields: Object.fromEntries(fields), files: files.map(([k, v]) => [k, v]) });
      return Promise.resolve(answers.shift() ?? { status: 500, text: "no answer left" });
    },
  };
  return port;
}

/** Lines the chat shows. */
const chat = (app: App): string[] => app.ui.chat.lines.map((l) => l.text);
/** Lets the port's promises settle between frames of the virtual clock. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("a note takes a picture at once and every three seconds, keeps typed lines, sends once, and keeps itself for another try", async () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("owner", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const port = fakePort([{ status: 500, text: "the disk is full" }, { status: 200, text: '{"id":7,"folder":"0007","pictures":3}' }]);
  app.notePort = () => Promise.resolve(port);
  /** Frames of the virtual clock, letting the port's promises settle every 50 ms of it, as a browser's would between frames. */
  const frames = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      run(Math.min(50, ms - t));
      await settle();
    }
  };
  const run = (ms: number): void => h.run(ms, (now) => {
    const p = app.frame(now, 1280, 720);
    if (p) app.drawn(p, 2, 1280, 720, 0);
  });
  await frames(500);
  // F8 does nothing of its own before the mode is on; `/notes` turns it on and it is kept.
  expect(app.key("F8", true)).toBe(false);
  app.ui.chat.input = "/notes";
  app.ui.chat.submit(app.session);
  expect(app.ui.settings.notes).toBe(true);
  expect(JSON.parse(app.ui.settings.interfacePreferences()).notes).toBe(true);
  // The app fetches the mode's file; here it is made in place, and its port answers at once.
  app["notesAsked"] = true;
  app.notes = new Notes(app, NOTES_KIT);
  await settle();
  await frames(200);
  const notes = app.notes;
  // The page says plainly why it is not armed, and arms once the session is an admin's.
  expect([notes.armed, chat(app).at(-1)]).toEqual([false, "Bug report mode is on, but it cannot take notes: notes are an admin's: enablecheats first."]);
  expect(app.ui.noteRow).toBe("");
  expect(notes.ring.rows).toBe(0);
  app.session.text("enablecheats");
  await frames(500);
  expect(notes.armed).toBe(true);
  expect(chat(app).some((l) => l.startsWith("Bug report mode is armed"))).toBe(true);
  expect(app.ui.noteRow).toBe("Take note");
  const before = notes.ring.rows;
  expect(before).toBeGreaterThan(5);

  app.key("F8", true);
  app.key("F8", false);
  await frames(1500);
  app.ui.chat.input = "the kerb floats here";
  app.ui.chat.submit(app.session);
  expect(chat(app).at(-1)).toMatch(/^Note 0:01: “the kerb floats here”$/);
  await frames(5200);
  // Pictures at 0, 3 and 6 s; the menu's row saves.
  expect(port.shots).toBe(3);
  expect(app.ui.noteRow).toBe("Save note");
  const flags = Array.from({ length: 1000 }, (_, back) => notes.ring.row(back)).filter((k) => k >= 0).map((k) => notes.ring.cells[k * CELLS + C.flags]!);
  expect(flags.filter((f) => (f & FLAG_SHOT) !== 0).length).toBe(3);
  // The frame after each picture, and those while it is being made, are flagged.
  const after = flags.filter((f) => (f & FLAG_AFTER_SHOT) !== 0).length;
  expect(after >= 3 && after <= 12).toBe(true);
  // The note's line is under the compass, with its bar.
  const line = app.ui.frame.nodes.slice(0, app.ui.frame.count).find((n) => n.key === 9601)?.text ?? "";
  expect(line).toMatch(/^NOTE 0:0[67]  ·  3 pictures  ·  F8 saves  ·  Esc discards$/);

  // The first upload fails: the note is kept, and F8 tries again.
  app.ui.pointer(0, KEY_MENU_NOTE, 0, 0, 0, app.session);
  app.key("F8", true);
  app.key("F8", false);
  await settle();
  await frames(100);
  expect(port.posted.length).toBe(1);
  expect(chat(app).at(-1)).toBe("Report not saved: the disk is full. F8 tries again; Esc twice discards it.");
  expect(notes.open?.state).toBe("failed");
  app.key("F8", true);
  await settle();
  await frames(100);
  expect(port.posted.length).toBe(2);
  expect(chat(app).at(-1)).toBe("Saved report 7 (3 pictures).");
  expect(notes.open).toBeNull();
  // One upload carries the session's token, the report, the record and the pictures with the first's thumbnail.
  const sent = port.posted[1]!;
  expect(sent.fields.token).toBe(`${app.session.voice.slot}:${Array.from(app.session.voice.token, (b) => b.toString(16).padStart(2, "0")).join("")}`);
  expect(sent.files).toEqual([["shot", "picture 1"], ["shot", "picture 2"], ["shot", "picture 3"], ["thumb", "thumbnail"]]);
  const report = JSON.parse(sent.fields.report!);
  expect([report.kind, report.shots.length, report.shots.map((s: { at: number }) => Math.round(s.at / 1000)), report.text, report.build.commit]).toEqual(["note", 3, [0, 3, 6], [{ at: report.text[0].at, line: "the kerb floats here" }], "c0ffee"]);
  expect([typeof report.place.x, report.place.chunk.length, report.view.fov, report.page.canvas, report.sky.hour >= 0, report.survivor.alive, report.aim.what]).toEqual(["number", 2, 70, [1280, 720], true, true, report.aim.what]);
  const perf = JSON.parse(sent.fields.perf!);
  expect(perf.frames.length).toBeGreaterThan(300);
  expect(perf.summary.left).toBe(3 + after);
  expect(perf.summary.gpu.middle).toBe(4.5);
  expect(perf.census.length).toBe(3);
  // The sound engine's place, empty until it is built.
  expect(perf.sound).toEqual({});
  expect(perf.census[0].steps.length).toBeGreaterThan(0);
  expect(perf.summary.ringMs).toBeGreaterThan(0);
});

test("Esc twice discards a note, `perf` keeps a record with a picture at each end, and the record stops with the mode", async () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("owner", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const port = fakePort([{ status: 200, text: '{"id":8,"folder":"0008","pictures":2}' }]);
  app.notePort = () => Promise.resolve(port);
  app.ui.settings.notes = true;
  app["notesAsked"] = true;
  app.notes = new Notes(app, NOTES_KIT);
  /** Frames of the virtual clock, letting the port's promises settle every 50 ms of it, as a browser's would between frames. */
  const frames = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      run(Math.min(50, ms - t));
      await settle();
    }
  };
  const run = (ms: number): void => h.run(ms, (now) => {
    const p = app.frame(now, 1280, 720);
    if (p) app.drawn(p, 2, 1280, 720, 0);
  });
  await settle();
  await frames(700);
  app.session.text("enablecheats");
  await frames(300);
  const notes = app.notes;
  expect(notes.armed).toBe(true);
  app.key("F8", true);
  await frames(500);
  expect(notes.open).not.toBeNull();
  app.ui.escaped();
  expect(notes.open).not.toBeNull();
  expect(app.ui.menu).toBe(false);
  await frames(200);
  expect(app.ui.frame.nodes.slice(0, app.ui.frame.count).some((n) => n.key === 9601 && n.text.includes("Esc again discards it"))).toBe(true);
  app.ui.escaped();
  expect(notes.open).toBeNull();
  expect(chat(app).at(-1)).toBe("Note discarded: nothing was sent.");
  // Escape opens the menu again once no note is open.
  app.ui.escaped();
  expect(app.ui.menu).toBe(true);
  app.ui.menu = false;

  expect(app.ui.local!("perf 4")).toBe("keeping a performance record for 4 s, with a picture at each end; F8 ends it sooner, Esc twice discards it");
  await frames(4600);
  await settle();
  await frames(100);
  expect(port.posted.length).toBe(1);
  const report = JSON.parse(port.posted[0]!.fields.report!);
  expect([report.kind, report.shots.length, Math.round(report.shots[1].at / 100)]).toEqual(["perf", 2, 40]);
  expect(chat(app).at(-1)).toBe("Saved report 8 (2 pictures).");
  expect(app.ui.local!("perf 900")).toBe("usage: perf [seconds], 1 to 90, 20 if none");

  // Off, the record stops and the menu has no row.
  app.ui.local!("notes");
  await frames(100);
  const rows = notes.ring.rows;
  await frames(500);
  expect(notes.ring.rows).toBe(rows);
  expect(app.ui.noteRow).toBe("");
  expect(app.ui.local!("perf")).toBe("bug report mode is off: /notes turns it on");
});

test("`/budget` shows the frame's budget without the mode armed, costs nothing off, and each picture keeps what it said", async () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("owner", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const port = fakePort([{ status: 200, text: '{"id":9,"folder":"0009","pictures":1}' }]);
  app.notePort = () => Promise.resolve(port);
  const run = (ms: number): void => h.run(ms, (now) => {
    const p = app.frame(now, 1280, 720);
    if (p) app.drawn(p, 6, 1280, 720, 0.5, 4);
  });
  const frames = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      run(Math.min(50, ms - t));
      await settle();
    }
  };
  await frames(500);
  expect(app.ui.local!("budget")).toBe("frame budget on: the panel under the minimap");
  expect(JSON.parse(app.ui.settings.interfacePreferences()).budget).toBe(true);
  app["notesAsked"] = true;
  app.notes = new Notes(app, NOTES_KIT);
  await frames(600);
  const notes = app.notes, texts = (): string[] => app.ui.frame.nodes.slice(0, app.ui.frame.count).filter((n) => n.key >= 9700 && n.key < 9800).map((n) => n.text);
  // Not armed, the record does not run and F8 is the browser's; the panel shows all the same.
  expect([notes.armed, notes.ring.rows, app.key("F8", true)]).toEqual([false, 0, false]);
  expect(texts()).toContain("FRAME BUDGET");
  expect(texts().some((t) => /^Processor \d+\.\d ms$/.test(t))).toBe(true);
  expect(texts()).toContain("Card 4.5 ms");
  expect(texts().some((t) => t.startsWith("near 3.0 · casters 1.5"))).toBe(true);
  expect(texts().some((t) => /^Triangles .* of /.test(t))).toBe(true);
  expect(texts().some((t) => t.includes("this panel") && t.includes("ms a frame"))).toBe(true);
  // It stands clear of the rest of the HUD: under the minimap and what is below it, left of the vitals.
  const mine = (k: number): boolean => (k >= 9700 && k < 10100) || (k >= 2000000 + 9700 * 16 && k < 2000000 + 9700 * 16 + 9);
  for (const size of [[1280, 720], [1920, 1080], [2560, 1080]] as const) {
    h.run(50, (now) => void app.frame(now, size[0], size[1]));
    const panelBox = glassBox(app.ui.frame, 9700)!, under = app.ui.frame.nodes.slice(0, app.ui.frame.count).filter((n) => !mine(n.key) && n.w < app.ui.frame.width / 2 && meets(n, panelBox));
    expect(under.map((n) => `${n.key} ${n.text}`), `${size[0]}×${size[1]}`).toEqual([]);
  }
  // On a phone held upright the panel is as wide as the screen leaves it.
  h.run(50, (now) => void app.frame(now, 390, 844));
  const box = glassBox(app.ui.frame, 9700), f = app.ui.frame;
  expect(box !== null && box.x >= f.left && box.x + box.w <= f.width - f.right && box.y + box.h <= f.height - f.bottom).toBe(true);
  // On an Apple GPU, where a query between passes ends Metal's render pass, the card is timed whole and the panel says so.
  port.page = () => ({ browser: "a test", card: "ANGLE (Apple, ANGLE Metal Renderer: Apple M5)", format: "bc" });
  await frames(400);
  expect(texts()).toContain("Card 4.5 ms, the whole frame");
  expect(texts()).toContain("by pass: not measured on an Apple GPU, where a query");
  port.page = () => ({ browser: "a test", card: "no card", format: "rgba" });
  // The scene's build is timed while the panel is on, and let go once it is off.
  expect(Object.prototype.hasOwnProperty.call(app.scene, "build")).toBe(true);
  expect(notes.panel!.stages().scene).toBeGreaterThanOrEqual(0);
  app.ui.local!("budget");
  await frames(200);
  expect(Object.prototype.hasOwnProperty.call(app.scene, "build")).toBe(false);
  expect(texts()).toEqual([]);

  // With both on, a picture keeps the panel's breakdown.
  app.ui.local!("budget");
  app.ui.local!("notes");
  app.session.text("enablecheats");
  await frames(600);
  expect(notes.armed).toBe(true);
  app.key("F8", true);
  await frames(300);
  app.key("F8", true);
  await frames(200);
  const perf = JSON.parse(port.posted[0]!.fields.perf!);
  expect(perf.census[0].cpu.frame).toBeGreaterThanOrEqual(0);
  expect(perf.census[0].cpu.uploads).toBe(0.5);
  expect(perf.census[0].gpu.find((g: { name: string }) => g.name === "near").ms).toBe(3);
  expect(perf.census[0].budget.triangles).toBeGreaterThan(0);
  expect(perf.fields).toContain("scene");
});

test("a picture the browser could not make is left out with its pose and count, and the note goes with the rest", async () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("owner", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  const port = fakePort([{ status: 200, text: '{"id":10,"folder":"0010","pictures":2}' }], [2]);
  app.notePort = () => Promise.resolve(port);
  const frames = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      h.run(Math.min(50, ms - t), (now) => {
        const p = app.frame(now, 1280, 720);
        if (p) app.drawn(p, 2, 1280, 720, 0);
      });
      await settle();
    }
  };
  app.ui.settings.notes = true;
  app["notesAsked"] = true;
  app.notes = new Notes(app, NOTES_KIT);
  await frames(500);
  app.session.text("enablecheats");
  await frames(500);
  app.key("F8", true);
  await frames(6500);
  app.key("F8", true);
  await frames(200);
  expect(port.shots).toBe(3);
  const sent = port.posted[0]!, report = JSON.parse(sent.fields.report!), perf = JSON.parse(sent.fields.perf!);
  expect(sent.files.map(([, v]) => v)).toEqual(["picture 1", "picture 3", "thumbnail"]);
  expect(report.shots.map((s: { at: number }) => Math.round(s.at / 1000))).toEqual([0, 6]);
  expect(perf.census.map((c: { shot: number }) => c.shot)).toEqual([0, 1]);
  expect(app.ui.chat.lines.at(-1)!.text).toBe("Saved report 10 (2 pictures).");
});
