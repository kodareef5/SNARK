import { expect, test } from "bun:test";
import { collisionHashes, creatureHash, hullHash, nodeHash, poseHash, simHash, snapHash, tunedHash, waterHash } from "../../tools/simhash.ts";

// Node is a development tool here, used only as a second JavaScript engine.
const node = Bun.which("node");
const nodeMajor = node ? Number((Bun.spawnSync([node, "--version"]).stdout.toString().match(/v(\d+)/) ?? [])[1]) : 0;

test("the simulation is repeatable within one engine", () => {
  expect(simHash(600)).toBe(simHash(600));
  expect(waterHash(600)).toBe(waterHash(600));
  // The water standing above the sea is in the bodies' way: they do not go as they do without it.
  expect(waterHash(600)).not.toBe(simHash(600));
});

test.skipIf(nodeMajor < 24)("JavaScriptCore and V8 produce identical simulation state, identical poses, identical places for what is built, identical creatures, identical content of the same tuning, identical sloped pieces met by bodies and rays, identical forests, and identical swimming, vehicle collisions/water and continued corpse motion", () => {
  const run = Bun.spawnSync([node!, "--no-warnings", "tools/simhash.ts"], { cwd: import.meta.dir + "/../.." });
  const v8 = run.stdout.toString().trim();
  expect(run.exitCode).toBe(0);
  expect(v8).toMatch(/^[0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{24} [0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{16} [0-9a-f]{64} [0-9a-f]{64} [0-9a-f]{64} [0-9a-f]{64} [0-9a-f]{64}$/);
  expect(v8).toBe(simHash() + " " + poseHash() + " " + snapHash() + " " + creatureHash() + " " + tunedHash() + " " + hullHash() + " " + nodeHash() + " " + waterHash() + " " + collisionHashes());
});
