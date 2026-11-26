// The app's frame timed by the debug bar's ring (client/core/debug/spans.ts): every part, the scene's build and each pass
// in one tree, each span within its parent's, and the plain frame again once the probe is taken away.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { App } from "../../client/core/app.ts";
import { LANE_FRAME, SpanFrame, SpanRing } from "../../client/core/debug/spans.ts";
import type { FramePart } from "../../client/core/frame.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Harness } from "../fixtures/net.ts";
import { corePackBytes } from "../fixtures/pack.ts";

const pack = parsePack(corePackBytes());
const parts = (app: App): readonly FramePart[] => app["parts"];
const find = (ring: SpanRing, name: string, parent: number): number => ring.names.findIndex((n, s) => n === name && ring.parents[s] === parent);

/** A frame as the shell runs it: its marks written round the app's frame, and the frame closed once it is drawn. */
function shell(app: App, ring: SpanRing, now: number): void {
  const m = app.shellMarks;
  m[0] = m[1] = ring.now();
  const packet = app.frame(now, 1280, 720);
  m[2] = m[3] = m[4] = ring.now();
  if (packet && app.probe) ring.close(m, null);
}

test("every part, the scene's build and each pass are timed in one tree", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("spans", {}, { manual: true }), h.reg, pack), ring = new SpanRing();
  app.probe = ring;
  h.run(1000, (now) => shell(app, ring, now));
  const scene = app.scene!, frame = ring.read(ring.row(0), new SpanFrame());
  const ran = (s: number): boolean => s >= 0 && !Number.isNaN(frame.start[s]!);
  const named = (parent: number): string[] => ring.children(parent, frame, []).map((s) => ring.names[s]!);
  const own = find(ring, "app", LANE_FRAME), turn = find(ring, "turn", own), build = find(ring, "build", own);
  expect(named(LANE_FRAME)).toEqual(["input", "app", "ui", "gl"]);
  expect(named(own)).toEqual(["measure", "turn", "director", "dash", "sight", "body", "fallen", "place", "feed", "map events", "absorb", "missile trails", "build", "sound", "ghost", "prompts", "voice", "hud", "interface"]);
  expect([named(turn), named(build)]).toEqual([["update", "sample"], ["begin", "update", "draw", "order", "close"]]);
  // Each pass by its name, under each hook it has, in the frame's order.
  const passes = (hook: "update" | "draw"): string[] => scene.passes.filter((r) => r[1][hook] !== undefined).map((r) => r[0]);
  expect(named(find(ring, "update", build))).toEqual(passes("update"));
  expect(named(find(ring, "draw", build))).toEqual(passes("draw"));
  expect(passes("draw")).toEqual(expect.arrayContaining(["waters", "near store", "far city", "bodies", "own body"]));
  // Each span lies within its parent's.
  const outside: string[] = [];
  for (let s = 0; s < ring.names.length; s++) {
    const p = ring.parents[s]!, start = frame.start[s]!;
    if (!ran(s) || p < 0) continue;
    if (!ran(p) || start < frame.start[p]! - 1e-3 || start + frame.ms[s]! > frame.start[p]! + frame.ms[p]! + 1e-3) outside.push(ring.names[s]!);
  }
  expect(outside).toEqual([]);
});

test("the probe taken away leaves the plain parts, and nothing is timed", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("plain", {}, { manual: true }), h.reg, pack);
  let adds = 0;
  const ring = new (class extends SpanRing {
    override add(slot: number, from: number, to: number): void {
      adds++;
      super.add(slot, from, to);
    }
  })();
  const own = [app.director, app["dash"], app.sight, app.director.body, app.fallen, app.director.place], game = parts(app).length;
  const wrapped = (): boolean => own.every((p) => !parts(app).includes(p) && parts(app).some((w) => (w as { part?: FramePart }).part === p));
  app.probe = ring;
  h.run(600, (now) => shell(app, ring, now));
  expect([parts(app).length, wrapped(), adds > 0]).toEqual([game, true, true]);
  // A tool's rows, first asked for once the probe is on, are timed with the rest.
  app.fromEye = true;
  expect([parts(app).length, wrapped(), find(ring, "tool lines", find(ring, "app", LANE_FRAME)) >= 0]).toEqual([game + 3, true, true]);
  app.probe = null;
  const before = adds;
  h.run(300, (now) => shell(app, ring, now));
  expect([parts(app).length, own.every((p) => parts(app).includes(p)), adds - before]).toEqual([game + 3, true, 0]);
});

test("the first frame's script holds none of the ring's code", () => {
  // Every file the page's entry imports for its values, as tests/tools/first-frame.test.ts walks them.
  const root = join(import.meta.dir, "../..");
  const seen = new Set<string>(), next = [join(root, "client/shell/main.ts")];
  while (next.length > 0) {
    const file = next.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/gms)) {
      const path = join(dirname(file), m[2]!);
      if (!m[1] && m[2]!.startsWith(".") && existsSync(path)) next.push(path);
    }
  }
  const files = [...seen].map((f) => relative(root, f));
  expect(files).toContain("client/core/render/scene.ts");
  expect(files).not.toContain("client/core/debug/spans.ts");
});
