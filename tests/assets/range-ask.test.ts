// The asset worker's ranges go past the browser's cache: Chrome sends the ranges of one file that go through its cache
// one at a time, and every texture is a range of one file and every mesh level of another (client/core/assets/port.ts).

import { expect, test } from "bun:test";
import { rangeAsk } from "../../client/core/assets/port.ts";

test("a part is asked for by one range of its bytes, past the browser's cache", () => {
  const ask = rangeAsk(4096, 65536, new AbortController().signal);
  expect([ask.cache, ask.headers]).toEqual(["no-store", { range: "bytes=4096-69631" }]);
});
