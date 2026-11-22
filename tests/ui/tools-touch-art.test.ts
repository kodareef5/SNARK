import { expect, test } from "bun:test";
import { body, lift, resize } from "../../tools/ui/touch-art.ts";

/** A generated part as the tool is given one: a glass disc with a bright rim on black, its glow `glow` strong at the rim. */
function disc(size: number, radius: number, glow: number): { width: number; height: number; channels: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) - radius;
    // Inside, dark glass; a rim four pixels thick; outside, a glow that halves every eight pixels.
    const v = d < -4 ? 0.22 : d < 0 ? 0.95 : glow * 0.5 ** (d / 8);
    data.set([v * 90, v * 200, v * 255], (y * size + x) * 3);
  }
  return { width: size, height: size, channels: 3, data };
}

test("black becomes transparency: what was dark is clear, what was bright is solid, and over black it is the picture again", () => {
  const p = disc(256, 80, 0.5), l = lift(p, [0, 0, 256, 256], 1);
  const at = (x: number, y: number): number[] => Array.from(l.data.subarray((y * 256 + x) * 4, (y * 256 + x) * 4 + 4));
  expect(at(2, 2)[3]).toBe(0);
  expect(at(128 + 78, 128)[3]).toBeGreaterThan(0.9);
  expect(at(128, 128)[3]).toBeGreaterThan(0.1);
  expect(at(128, 128)[3]).toBeLessThan(0.4);
  // Premultiplied, a pixel is its own colour dimmed as the picture had it: the hue is kept, here blue over green over red.
  const [r, g, b] = at(128 + 90, 128) as [number, number, number];
  expect(b > g && g > r && r > 0).toBe(true);
  // The glow fades without a step: no neighbour differs by more than a little.
  let step = 0;
  for (let x = 128 + 84; x < 250; x++) step = Math.max(step, Math.abs(at(x + 1, 128)[3]! - at(x, 128)[3]!));
  expect(step).toBeLessThan(0.06);
});

test("a body's edge is its rim, found the same for a lit part's wider glow and at another size", () => {
  const rest = body(lift(disc(256, 80, 0.25), [0, 0, 256, 256], 1.2)), lit = body(lift(disc(256, 80, 0.5), [0, 0, 256, 256], 1.2));
  for (const b of [rest, lit]) {
    expect(Math.abs(b.r - b.l - 160)).toBeLessThan(2.5);
    expect(Math.abs(b.b - b.t - 160)).toBeLessThan(2.5);
    expect(Math.abs((b.l + b.r) / 2 - 128)).toBeLessThan(1);
  }
  // A press must not change a button's size: the two measure within a pixel of each other.
  expect(Math.abs(rest.r - rest.l - (lit.r - lit.l))).toBeLessThan(1.5);
  // Brought to the sheet's size with its body 92 across, it measures 92 there.
  const big = lift(disc(512, 160, 0.5), [0, 0, 512, 512], 1.2), b = body(big);
  const small = resize(big, 92 / (b.r - b.l), 92 / (b.b - b.t), 128, 128, (b.l + b.r) / 2, (b.t + b.b) / 2), s = body(small);
  expect(Math.abs(s.r - s.l - 92)).toBeLessThan(2);
  expect(Math.abs((s.l + s.r) / 2 - 64)).toBeLessThan(1);
  expect(Math.abs((s.t + s.b) / 2 - 64)).toBeLessThan(1);
  // Nothing is brighter than whole, nor less than nothing, after the filter's overshoot.
  let low = 0, high = 0;
  for (let i = 3; i < small.data.length; i += 4) { low = Math.min(low, small.data[i]!); high = Math.max(high, small.data[i]!); }
  expect([low, high <= 1]).toEqual([0, true]);
});
