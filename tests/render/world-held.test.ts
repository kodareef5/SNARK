import { expect, test } from "bun:test";
import { heldWidening } from "../../client/core/render/world-surfaces.ts";

/** The level a card reads a footprint of steps dx and dy (texels a pixel) at, three ways a card may pick it. */
function levels(dx: number[], dy: number[], most: number): number[] {
  const a = Math.hypot(dx[0]!, dx[1]!), b = Math.hypot(dy[0]!, dy[1]!), major = Math.max(a, b), narrow = Math.min(a, b);
  const minor = Math.abs(dx[0]! * dy[1]! - dx[1]! * dy[0]!) / major;
  const taps = Math.min(Math.ceil(major / narrow), most), even = Math.min(2 ** Math.ceil(Math.log2(major / narrow)), most);
  // The extension's rule, the same with the taps rounded up to a power of two, and a card that takes its level from the footprint's narrow way.
  return [Math.log2(major / taps), Math.log2(major / even), Math.log2(minor)];
}

/** The widening before: enough for the extension's rule while a footprint is no more slanted than the tier's taps. */
function before(dx: number[], dy: number[], least: number, taps: number): number {
  const a = Math.hypot(dx[0]!, dx[1]!), b = Math.hypot(dy[0]!, dy[1]!), major = Math.max(a, b);
  return Math.max(1, 2 ** least * Math.min(2 ** Math.ceil(Math.log2(major / Math.min(a, b))), taps) / major);
}

test("a held read is never taken finer than its layer's finest level, however slanted, where the widening before read finer on a slant past the taps", () => {
  let seed = 7;
  const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let reads = 0, finerBefore = 0, finerNow = 0, changedWithin = 0;
  for (let n = 0; n < 20000; n++) {
    // A pixel's steps on a surface seen at a slant: one way across, the other along the view and up to 64 times longer.
    const turn = random() * Math.PI * 2, skew = (random() - 0.5) * 0.4, size = 2 ** (random() * 8 - 4), slant = 2 ** (random() * 6);
    const dx = [Math.cos(turn) * size, Math.sin(turn) * size];
    const dy = [-Math.sin(turn + skew) * size * slant, Math.cos(turn + skew) * size * slant];
    const least = [0.25, 1, 2, 3, 4][n % 5]!, taps = [1, 4, 16][n % 3]!;
    const k = heldWidening(dx, dy, least, taps), was = before(dx, dy, least, taps);
    for (const [s, count] of [[k, (f: boolean) => f && finerNow++], [was, (f: boolean) => f && finerBefore++]] as const) {
      const at = levels(dx.map((v) => v * s), dy.map((v) => v * s), taps);
      count(at.some((l) => l < least - 1e-9));
    }
    if (slant <= taps && Math.abs(skew) < 0.01 && Math.abs(k - was) > 1e-9 * was) changedWithin++;
    reads++;
  }
  expect(reads).toBe(20000);
  expect(finerBefore).toBeGreaterThan(1000);
  expect(finerNow).toBe(0);
  expect(changedWithin).toBe(0);
  expect(heldWidening([0.01, 0], [0, 0.5], 0, 16)).toBe(1);
});
