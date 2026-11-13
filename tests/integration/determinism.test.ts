import { expect, test } from "bun:test";
import { creatureHash, poseHash, simHash, snapHash } from "../../tools/simhash.ts";

// Node is a development tool here, used only as a second JavaScript engine.
const node = Bun.which("node");
const nodeMajor = node ? Number((Bun.spawnSync([node, "--version"]).stdout.toString().match(/v(\d+)/) ?? [])[1]) : 0;

test("the simulation is repeatable within one engine", () => {
  expect(simHash(600)).toBe(simHash(600));
});

test.skipIf(nodeMajor < 24)("JavaScriptCore and V8 produce identical simulation state, identical poses, identical places for what is built, and identical creatures", () => {
  const run = Bun.spawnSync([node!, "--no-warnings", "tools/simhash.ts"], { cwd: import.meta.dir + "/../.." });
  const v8 = run.stdout.toString().trim();
  expect(run.exitCode).toBe(0);
  expect(v8).toMatch(/^[0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{16}$/);
  expect(v8).toBe(simHash() + " " + poseHash() + " " + snapHash() + " " + creatureHash());
});
