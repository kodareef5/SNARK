// A test of a map data stage (tools/mapdata) runs its Python in the stages' own venv, and is skipped where there is
// none (tools/maps/README.md says how to make it); the check counts those skipped, as it counts tests skipped for art.

import { test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const PYTHON = join(ROOT, "tools/mapdata/.venv/bin/python");
/** Whether the map data stages' venv is here. */
export const PYTHON_HERE = existsSync(PYTHON);

export const pyTest: typeof test = PYTHON_HERE ? test : test.skip;
export { pyTest as test };

/** Runs `code` in the venv's Python with tools/mapdata importable, and gives what it printed; throws with its error. */
export function python(code: string, cwd = ROOT): string {
  const run = Bun.spawnSync([PYTHON, "-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, "tools/mapdata"))})\n${code}`], { cwd, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(new TextDecoder().decode(run.stderr));
  return new TextDecoder().decode(run.stdout);
}
