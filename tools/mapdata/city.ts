// A city's map from its settings file, step by step: bun tools/mapdata/city.ts <name> [first step] [last step]
//
// assets/source/maps/<name>/city.json names the centre, the county, the elevation project, the coastal model and the
// authored rules; world/world.json and ruins/ hold the world build's settings. Steps that download skip what raw/ holds.
// Python steps run in tools/mapdata/.venv (README.md says how to make it).

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const name = process.argv[2];
if (!name) {
  console.error("bun tools/mapdata/city.ts <name> [first step] [last step]");
  process.exit(2);
}
const folder = join(ROOT, "assets/source/maps", name);
const python = join(ROOT, "tools/mapdata/.venv/bin/python");
const py = (script: string, ...args: string[]): string[] => [python, "-I", join(ROOT, "tools/mapdata", script), folder, ...args];
// Steps that hold several GB wait their turn with other agents' renders.
const heavy = (command: string[]): string[] => ["lockf", "-t", "7200", "/tmp/snark-render.lock", ...command];

const STEPS: [string, string[]][] = [
  ["frame", py("frame.py")],
  ["fetch", py("fetch.py", "tiger", "dem", "nlcd", "fema", "bathymetry", "osm")],
  ["prepare", py("prepare.py")],
  ["attributes", ["bun", join(ROOT, "tools/mapworld/fetch-attributes.ts"), name]],
  ["future", py("future.py")],
  ["fine", heavy(py("fine.py"))],
  ["bathymetry", py("bathy.py")],
  ["labels", py("labels.py")],
  ["ways", py("ways.py")],
  ["build", heavy(["bun", join(ROOT, "tools/mapworld/build.ts"), name])],
];

if (!existsSync(join(folder, "city.json"))) throw new Error(`${folder} has no city.json`);
if (!existsSync(python)) throw new Error("no tools/mapdata/.venv: see tools/mapdata/README.md");
const names = STEPS.map(([s]) => s);
const from = names.indexOf(process.argv[3] ?? "frame");
const to = names.indexOf(process.argv[4] ?? "build");
if (from < 0 || to < 0) throw new Error(`steps are ${names.join(", ")}`);
for (const [step, command] of STEPS.slice(from, to + 1)) {
  if (step === "attributes" && existsSync(join(folder, "base/buildings_attributes.json"))) {
    console.log("attributes: kept");
    continue;
  }
  const t0 = performance.now();
  console.log(`== ${step}`);
  const run = Bun.spawnSync(command, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`${step} failed with ${run.exitCode}`);
  console.log(`== ${step} done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
