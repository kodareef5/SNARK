// What a page's first frame waits for is held to a byte budget (D636). Code that is only needed later is fetched later
// (D871, D873). This follows every value import from the page's entry and checks none of that code is reached. A late
// file may import what it needs of the first frame's modules: the build has it take that from page.js's exports
// (tools/page-script.ts, D1106), and the check's "script" step and the build's weighing hold the script to that shape.

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const CLIENT = join(import.meta.dir, "../../client");
const ROOT = join(CLIENT, "..");

/** Files a module imports for their values: `import type` and `import()` are left out, re-exports counted. */
function valueImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^(?:import|export)\s+(type\s+)?(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/gms)) {
    if (m[1] || !m[2]!.startsWith(".")) continue;
    const path = join(dirname(file), m[2]!);
    if (existsSync(path)) out.push(path);
  }
  return out;
}

/** Every file the page's script holds before its first frame. */
function firstFrameFiles(): Set<string> {
  const seen = new Set<string>();
  const next = [join(CLIENT, "shell/main.ts")];
  while (next.length) {
    const file = next.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    next.push(...valueImports(file));
  }
  return seen;
}

/** The debug bar's files, which the app fetches once the bar is first on, the shell's part of it, and what they read. */
const DEBUG_FILES = [
  ...readdirSync(join(CLIENT, "core/debug")).filter((f) => f.endsWith(".ts")).map((f) => `client/core/debug/${f}`),
  "client/debug/debug-port.ts", "client/core/assets/look.ts", "client/core/assets/requests.ts", "client/core/assets/inspect.ts", "shared/report.ts",
];

/**
 * The world's sounds' code (D1107): every file of client/core/sound but what the shell's device and the asset port use
 * (ease.ts, packet.ts, split.ts), and the cues.
 */
const SOUND_FILES = ["client/core/sound-late.ts", "shared/sound/cues.ts", ...readdirSync(join(CLIENT, "core/sound")).filter((f) => f.endsWith(".ts") && !["ease.ts", "packet.ts", "split.ts"].includes(f)).map((f) => `client/core/sound/${f}`)];

test("code a page needs only after its first frame is not in the script the first frame waits for", () => {
  const files = [...firstFrameFiles()].map((f) => relative(ROOT, f));
  // The walk does reach the page's game.
  expect(files).toContain("client/core/render/scene.ts");
  const late = [
    "client/core/ui/touch.ts",
    "client/core/render/city-late.ts",
    "client/core/render/farcity.ts",
    "client/core/render/nearcity.ts",
    "client/core/render/farlandmarks.ts",
    "client/core/render/farshadow.ts",
    "client/core/render/cityblocks.ts",
    "client/core/render/orb-late.ts",
    "client/core/render/orb.ts",
    "client/core/render/passes/orb.ts",
    "client/core/video/player.ts",
    "client/core/video/faces.ts",
    "client/shell/screen-video.ts",
    "client/shell/screen-faces.ts",
    "client/core/ui/bag-panels.ts",
    "client/core/ui/inventory.ts",
    "client/core/ui/character.ts",
    "client/core/ui/station.ts",
    "shared/anim/authored.ts",
    "shared/anim/emote-clips.ts",
    "client/core/selfcheck-tools.ts",
    "client/core/bench-run.ts",
    "client/core/selfcheck-report.ts",
    "client/core/selfcheck-surfaces.ts",
    "client/core/activity-selfcheck.ts",
    "client/core/assets/frames.ts",
    "client/core/assets/inspect.ts",
    "client/core/ui/storage.ts",
    "client/core/assets/keeping.ts",
    "client/core/light-capture.ts",
    "client/core/jet-late.ts",
    "shared/sim/families/jet.ts",
    "shared/sim/jet.ts",
    "shared/world/jet.ts",
    "client/core/render/jet-parts.ts",
    "client/core/hud/fighter.ts",
    "client/core/missile-trail.ts",
    ...SOUND_FILES,
    ...DEBUG_FILES,
  ];
  expect(SOUND_FILES).toContain("client/core/sound/sounds.ts");
  expect(DEBUG_FILES).toEqual(expect.arrayContaining(["client/core/debug/log.ts", "client/core/debug/shots.ts"]));
  for (const file of late) expect(files.includes(file), file).toBe(false);
  // The shell fetches them itself, and the app the Storage tab's page and the debug bar.
  const fetchedBy = (file: string): string[] => [...readFileSync(join(CLIENT, file), "utf8").matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!);
  expect(fetchedBy("shell/main.ts")).toEqual(expect.arrayContaining(["../core/ui/touch.ts", "../core/render/city-late.ts", "../core/render/orb-late.ts", "../core/selfcheck-tools.ts", "../core/bench-run.ts", "../core/assets/frames.ts", "../debug/debug-port.ts", "../core/light-capture.ts"]));
  expect(fetchedBy("shell/main.ts")).toContain("./screen-video.ts");
  expect(fetchedBy("shell/main.ts")).toContain("./screen-faces.ts");
  expect(fetchedBy("core/game-app.ts")).toEqual(expect.arrayContaining(["./ui/storage.ts", "./debug/debug.ts", "./sound-late.ts"]));
  expect(fetchedBy("core/ui/bag-load.ts")).toContain("./bag-panels.ts");
});

test("the browser requests city rendering after it draws the first world frame", () => {
  const shell = readFileSync(join(CLIENT, "shell/main.ts"), "utf8");
  const firstDraw = shell.indexOf("renderer.draw(packet)");
  expect(firstDraw).toBeGreaterThan(-1);
  expect(shell.indexOf('import("../core/render/city-late.ts")')).toBeGreaterThan(firstDraw);
});

test("the page's log is the first module the page runs, and takes only the levels", () => {
  const main = readFileSync(join(CLIENT, "shell/main.ts"), "utf8");
  expect(main.match(/^import\s+(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/m)?.[1]).toBe("./early-log.ts");
  expect([...firstFrameFiles()].map((f) => relative(ROOT, f))).toContain("client/shell/early-log.ts");
  expect(valueImports(join(CLIENT, "shell/early-log.ts")).map((f) => relative(ROOT, f))).toEqual(["shared/debug.ts"]);
});

test("the pictures' worker is built from client/debug under the name the port loads", () => {
  expect(readFileSync(join(ROOT, "tools/build-client.ts"), "utf8")).toContain('"client/debug/shot-worker.ts"');
  expect(existsSync(join(CLIENT, "debug/shot-worker.ts"))).toBe(true);
  expect(existsSync(join(CLIENT, "notes/shot-worker.ts"))).toBe(false);
  expect(readFileSync(join(CLIENT, "debug/debug-port.ts"), "utf8")).toContain('new Worker("shot-worker.js"');
});

test("the first frame holds the made textures' read; their engine comes later", () => {
  const files = [...firstFrameFiles()].map((f) => relative(ROOT, f));
  expect(files.filter((f) => f.startsWith("client/core/texgen/")).sort()).toEqual(["client/core/texgen/hash.ts", "client/core/texgen/layers.ts"]);
  expect(files.filter((f) => f.startsWith("content/texgen/"))).toEqual([]);
  expect(readFileSync(join(CLIENT, "shell/main.ts"), "utf8")).toContain('import("../core/texgen/late.ts")');
});

test("a reeling body is posed in the first frame; its curves come in a later file", () => {
  const files = [...firstFrameFiles()].map((f) => relative(ROOT, f));
  expect(files).toContain("shared/anim/reactions.ts");
  for (const file of ["shared/anim/reaction-late.ts", "shared/anim/reaction-curves.ts", "shared/anim/reaction-bake.ts"]) expect(files.includes(file), file).toBe(false);
  expect(readFileSync(join(CLIENT, "shell/main.ts"), "utf8")).toContain('import("../../shared/anim/reaction-late.ts")');
});
