// What a page's first frame waits for is held to a byte budget (D636). Code that is only needed later is fetched later
// (D871, D873). This follows every value import from the page's entry and checks none of that code is reached.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
    ...MONITOR_FILES,
  ];
  for (const file of late) expect(files.includes(file), file).toBe(false);
  // The resource monitor's files import nothing the first frame holds, which would cut its script into more pieces: what
  // they use of it comes to them in a kit (client/core/ui/monitor-kit.ts).
  for (const file of MONITOR_FILES) for (const dep of valueImports(join(ROOT, file))) expect(files.includes(relative(ROOT, dep)), `${file} imports ${relative(ROOT, dep)}`).toBe(false);
  // The shell fetches them itself.
  const shell = readFileSync(join(CLIENT, "shell/main.ts"), "utf8");
  const fetched = [...shell.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  expect(fetched).toEqual(expect.arrayContaining(["../core/ui/touch.ts", "../core/render/city-late.ts", "../core/selfcheck-tools.ts", "../core/bench-run.ts", "../core/assets/frames.ts"]));
});
