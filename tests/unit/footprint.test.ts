import { expect, test } from "bun:test";
import { footprint } from "../../tools/footprint.ts";

test("a process's footprint counts the memory it holds, and a process that has ended holds none", () => {
  const before = footprint(process.pid);
  expect(before).toBeGreaterThan(0);
  // Written, so every page of it is the process's own.
  const held = new Uint8Array(64_000_000).fill(1);
  // A collection that frees something else meanwhile may take a little back.
  expect(footprint(process.pid) - before).toBeGreaterThan(48_000_000);
  expect(held[held.length - 1]).toBe(1);
  expect(footprint(Bun.spawnSync(["true"]).pid)).toBe(0);
});
