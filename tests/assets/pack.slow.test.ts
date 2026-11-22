// The whole core pack built a second time (pack.test.ts reads the one the check built): every asset again, slow by nature.

import { expect } from "bun:test";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePackBytes } from "../fixtures/pack.ts";

artTest("the core pack built again hashes its clips as the first did", () => {
  const clips = parsePack(corePackBytes()).clips;
  expect(clips.hash).not.toBe(0);
  expect(parsePack(buildCorePack()).clips.hash).toBe(clips.hash);
});
