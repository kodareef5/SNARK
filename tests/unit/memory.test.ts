import { expect, test } from "bun:test";
import { footprint } from "../../tools/memory.ts";

test("a process's footprint counts the memory it holds, and a process that has ended holds none", async () => {
  // A process of its own: a test worker may lend this one pages that an earlier file freed.
  const child = Bun.spawn(["bun", "-e", "const held = new Uint8Array(64_000_000).fill(1); console.log('held'); for await (const _ of process.stdin); held[0];"], { stdin: "pipe", stdout: "pipe" });
  const reader = child.stdout.getReader();
  await reader.read();
  expect(footprint(child.pid)).toBeGreaterThan(64_000_000);
  child.stdin.end();
  await child.exited;
  expect(footprint(child.pid)).toBe(0);
});
