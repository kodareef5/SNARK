import { expect, test } from "bun:test";
import { brotliDecompressSync, constants, gunzipSync, gzipSync } from "node:zlib";
import { groundBytes, writeMap } from "../../shared/world/mapfile.ts";
import { packMap } from "../../tools/map/pack.ts";
import { busyMap } from "../fixtures/map.ts";

test("a map's copies give its bytes back, the Brotli's ground alone gives the ground, and a release's are the smaller", async () => {
  const file = writeMap(busyMap());
  const everyday = await packMap(file);
  const release = await packMap(file, true);
  for (const copies of [everyday, release]) {
    expect(new Uint8Array(brotliDecompressSync(copies.br))).toEqual(file);
    expect(new Uint8Array(gunzipSync(copies.gz))).toEqual(file);
    const head = brotliDecompressSync(copies.br.subarray(0, copies.ground), { finishFlush: constants.BROTLI_OPERATION_FLUSH });
    expect(new Uint8Array(head)).toEqual(file.subarray(0, groundBytes(file)));
  }
  expect([everyday.release, release.release]).toEqual([false, true]);
  // What the budgets hold is the Brotli, before the first frame and in all.
  expect([release.ground < everyday.ground, release.br.length < everyday.br.length]).toEqual([true, true]);
  // A release's gzip is the tightest there is, as every build's was before an everyday build took less.
  expect(new Uint8Array(release.gz)).toEqual(new Uint8Array(gzipSync(file, { level: 9 })));
});
