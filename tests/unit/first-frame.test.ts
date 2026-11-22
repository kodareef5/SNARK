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

/** The resource monitor's files, which the app fetches once it is first turned on. */
const MONITOR_FILES = ["client/core/ui/monitor.ts", "client/core/ui/monitor-style.ts", "client/core/ui/monitor-card.ts", "client/core/ui/monitor-chart.ts", "client/core/ui/monitor-panel.ts", "client/core/assets/look.ts", "client/core/assets/requests.ts", "client/core/assets/inspect.ts", "client/core/assets/copied.ts"];

/** Bug report mode's files, which the app fetches once the mode is first on (D1091), and the shell's part of it. */
const NOTES_FILES = ["client/core/notes/notes.ts", "client/core/notes/budget.ts", "client/core/notes/ring.ts", "client/core/notes/sample.ts", "client/core/notes/place.ts", "client/core/notes/census.ts", "client/core/notes/copies.ts", "shared/report.ts", "shared/listing.ts", "client/notes/port.ts"];

/**
 * First-frame modules the late files above may import, each a name page.js exports (D1106): the pass clock's list of
 * passes, which the budget's panel and a note's census name the GPU's passes by in its order (D1121).
 */
const TAKEN_FIRST = ["client/core/passes.ts"];

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
    "client/core/render/cityblocks.ts",
    "client/core/selfcheck-tools.ts",
    "client/core/bench-run.ts",
    "client/core/selfcheck-report.ts",
    "client/core/selfcheck-surfaces.ts",
    "client/core/activity-selfcheck.ts",
    "client/core/assets/frames.ts",
    "client/core/assets/inspect.ts",
    "client/core/ui/storage.ts",
    "client/core/assets/keeping.ts",
    ...MONITOR_FILES,
    ...NOTES_FILES,
    ...SOUND_FILES,
  ];
  expect(SOUND_FILES).toContain("client/core/sound/sounds.ts");
  for (const file of late) expect(files.includes(file), file).toBe(false);
  // The resource monitor's files and bug report mode's import nothing the first frame holds but what TAKEN_FIRST names:
  // what they use of it comes to them in a kit (client/core/ui/monitor-kit.ts, client/core/notes-kit.ts). They were
  // written so when such an import cut the first frame's script into more pieces; since D1106 it costs only a name page.js
  // exports, and they keep their kits. What must never be a copy they import.
  for (const file of [...MONITOR_FILES, ...NOTES_FILES]) for (const dep of valueImports(join(ROOT, file))) expect(files.includes(relative(ROOT, dep)) && !TAKEN_FIRST.includes(relative(ROOT, dep)), `${file} imports ${relative(ROOT, dep)}`).toBe(false);
  for (const file of TAKEN_FIRST) expect(files, file).toContain(file);
  // The shell fetches them itself, and the app the Storage tab's page and the resource monitor.
  const fetchedBy = (file: string): string[] => [...readFileSync(join(CLIENT, file), "utf8").matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!);
  expect(fetchedBy("shell/main.ts")).toEqual(expect.arrayContaining(["../core/ui/touch.ts", "../core/render/city-late.ts", "../core/selfcheck-tools.ts", "../core/bench-run.ts", "../core/assets/frames.ts", "../notes/port.ts"]));
  expect(fetchedBy("core/app.ts")).toEqual(expect.arrayContaining(["./ui/storage.ts", "./ui/monitor.ts", "./notes/notes.ts", "./sound-late.ts"]));
});
