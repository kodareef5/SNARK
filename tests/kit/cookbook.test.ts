// The cookbook shows each recipe's file as it is, so the page is made of tests that pass.

import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const page = readFileSync(join(import.meta.dir, "../COOKBOOK.md"), "utf8");
const shown = new Map([...page.matchAll(/\]\(kit\/recipes\/([\w-]+\.test\.ts)\)\n\n```ts\n([\s\S]*?)```/g)].map((m) => [m[1]!, m[2]!]));

test("the cookbook shows every recipe file as it is, and nothing that is not one", () => {
  const files = readdirSync(join(import.meta.dir, "recipes")).filter((name) => name.endsWith(".test.ts")).sort();
  expect([...shown.keys()].sort()).toEqual(files);
  expect(page.match(/^```ts$/gm)!.length).toBe(files.length);
  for (const name of files) expect(shown.get(name), name).toBe(readFileSync(join(import.meta.dir, "recipes", name), "utf8"));
});
