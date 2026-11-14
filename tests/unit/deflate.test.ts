// Our deflate against the runtime's inflate: degenerate inputs, seeded random ones, and the parts of a small build.
import { expect, test } from "bun:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { Rng } from "../../shared/rng.ts";
import { deflate, Lengths } from "../../tools/pack/deflate.ts";
import { partHash } from "../../tools/pack/manifest.ts";

const back = (z: Uint8Array): Uint8Array => new Uint8Array(inflateRawSync(z));

/** Runs of one byte, copies from up to a window and a little further back, noise, and bytes from small alphabets. */
function mixed(rng: Rng, n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; ) {
    const kind = rng.int(5);
    const len = Math.min(n - i, 1 + rng.int(kind === 0 ? 3000 : 400));
    if (kind === 0) out.fill(rng.int(256), i, i + len);
    else if (kind === 1 && i > 0) {
      const d = 1 + rng.int(Math.min(i, 33000));
      for (let k = 0; k < len; k++) out[i + k] = out[i + k - d]!;
    } else for (let k = 0; k < len; k++) out[i + k] = rng.int(kind === 2 ? 256 : kind === 3 ? 4 : 40);
    i += len;
  }
  return out;
}

test("what comes back from the runtime's inflate is what went in: nothing, a byte, long runs, noise", () => {
  const rng = new Rng(3);
  const cases = [new Uint8Array(0), Uint8Array.of(7), Uint8Array.of(7, 7), new Uint8Array(300_000), Uint8Array.from({ length: 70_000 }, () => rng.int(256))];
  for (const data of cases) expect(back(deflate(data))).toEqual(data);
  // Noise is stored, a header a block of 65,535 bytes the most it costs.
  expect(deflate(cases[4]!).length).toBeLessThan(70_000 + 32);
  // A run is a match of 258 bytes one back, over and over.
  expect(deflate(cases[3]!).length).toBeLessThan(320);
});

test("seeded random inputs come back, whatever the effort, across the edges of segments and stored blocks", () => {
  const rng = new Rng(11);
  for (const n of [1, 3, 258, 259, 65535, 65536, 140_000, (1 << 20) + 5]) {
    const data = mixed(rng, n);
    expect(back(deflate(data, n > 1e6 ? { chain: 4, passes: 0 } : {}))).toEqual(data);
  }
  for (let t = 0; t < 100; t++) {
    const data = mixed(rng, rng.int(2000));
    expect(back(deflate(data, { chain: 1 + rng.int(64), passes: rng.int(3) }))).toEqual(data);
  }
});

test("the same input gives the same bytes, and a mixed input is smaller than the runtime's deflate at 9", () => {
  const data = mixed(new Rng(5), 50_000);
  const ours = deflate(data);
  expect(partHash(ours)).toBe(partHash(deflate(data)));
  // Pinned. Another runtime that gives other bytes, or a change that does, changes every file name a build serves.
  expect([ours.length, partHash(ours)]).toEqual([7590, "d92d837831e1856d"]);
  expect(ours.length).toBeLessThan(deflateRawSync(data, { level: 9, memLevel: 9 }).length);
});

test("code lengths are the fewest bits within the limit, and make a whole code", () => {
  const lengths = new Lengths(40, 15);
  const out = new Uint8Array(40);
  // Fibonacci counts would want a code 39 bits long.
  const fib = [1, 1];
  while (fib.length < 40) fib.push(fib[fib.length - 1]! + fib[fib.length - 2]!);
  lengths.make(fib, 40, out);
  expect(Math.max(...out)).toBe(15);
  expect(out.reduce((sum, l) => sum + 2 ** -l, 0)).toBe(1);
  // Without the limit biting, the lengths are Huffman's: these counts give 1, 2, 3, 3.
  lengths.make([8, 4, 2, 2], 4, out);
  expect([...out.subarray(0, 4)]).toEqual([1, 2, 3, 3]);
  lengths.make([0, 5, 0], 3, out);
  expect([...out.subarray(0, 3)]).toEqual([0, 1, 0]);
});
