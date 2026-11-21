import { expect, test } from "bun:test";
import { titleRelease } from "../../tools/build-entry.ts";

test("the title shows the newest edition while previous notes stay in the text archive", () => {
  const archive = "v0.0.9 — 2026-11-24\r\n\r\nAcross the bay\r\nWatch the tide\r\nturn.\r\n\r\nv0.0.8 — 2026-11-20\r\n\r\nThe first camp\r\nGather wood.\r\n";
  expect(titleRelease(archive, "0.0.9")).toEqual({ version: "v0.0.9", notes: [{ title: "Across the bay", body: "Watch the tide turn." }] });
  expect(() => titleRelease(archive, "0.0.8")).toThrow();
  expect(() => titleRelease("v0.0.9 — 2026-11-24\n\nMissing paragraph", "0.0.9")).toThrow();
});
