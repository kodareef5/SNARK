// The client build's Brotli copies: the smallest there is for a build that is served, and a quick one for a rebuild while developing.

import { expect, test } from "bun:test";
import { brotliDecompressSync } from "node:zlib";
import { brotli } from "../../tools/build-client.ts";
import { corePackBytes } from "../fixtures/pack.ts";

test("the quick Brotli copy reads back the same as the best one, and is a little larger for far less work", () => {
  const bytes = corePackBytes().subarray(0, 32 * 1024);
  const best = brotli(bytes, false);
  const quick = brotli(bytes, true);
  expect(Buffer.compare(brotliDecompressSync(best), bytes)).toBe(0);
  expect(Buffer.compare(brotliDecompressSync(quick), bytes)).toBe(0);
  // Less work shows as a larger copy, though not by much.
  expect(quick.length).toBeGreaterThan(best.length);
  expect(quick.length).toBeLessThan(best.length * 1.3);
});
