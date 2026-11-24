import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
/** Each family's own file, the list, and what leads back to it: any may be the first a process loads, a mod's file among them. */
const FIRST = [
  ...readdirSync(join(ROOT, "shared/sim/families")).filter((f) => f.endsWith(".ts")).map((f) => `shared/sim/families/${f}`),
  "shared/sim/families.ts", "shared/sim/vehicle.ts", "shared/sim/vehicle-body.ts", "shared/world/vehicle-meet.ts", "shared/world/vehicle-shapes.ts",
];
/** Loads `file` first, then asks every family of the stock vehicles, so the list is made after it. */
const script = (file: string) =>
  `await import(${JSON.stringify(`./${file}`)}); const { familyOf } = await import("./shared/sim/families.ts"); const { COMPACT_VEHICLE } = await import("./content/vehicles/compact.ts"); if (familyOf(COMPACT_VEHICLE)?.name !== "wheeled") throw new Error("no family"); console.log("ok");`;

const node = Bun.which("node");
const nodeMajor = node ? Number((Bun.spawnSync([node, "--version"]).stdout.toString().match(/v(\d+)/) ?? [])[1]) : 0;

test("each vehicle family's file loads first in a fresh process, and the families answer after it", () => {
  for (const file of FIRST) {
    const run = Bun.spawnSync([process.execPath, "-e", script(file)], { cwd: ROOT });
    expect(`${file}: ${run.stdout.toString().trim() || run.stderr.toString().trim().split("\n").at(-1)}`).toBe(`${file}: ok`);
  }
});

test.skipIf(nodeMajor < 24)("in V8 too", () => {
  for (const file of FIRST) {
    const run = Bun.spawnSync([node!, "--no-warnings", "--input-type=module", "-e", script(file)], { cwd: ROOT });
    expect(`${file}: ${run.stdout.toString().trim() || run.stderr.toString().trim().split("\n").find((l) => l.includes("Error"))}`).toBe(`${file}: ok`);
  }
});
