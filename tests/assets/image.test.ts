// Source pictures: PNG in and out, the mips of base colour, normals and packed maps, and the measures of a texture set.
import { expect, test } from "bun:test";
import { Rng } from "../../shared/rng.ts";
import { baseMips, decodePng, encodePng, normalAgainstHeight, normalMips, oddSizes, packMro, packedMips, roughened, seam, shrunkAgainst, type Picture } from "../../tools/pack/image.ts";

/** An 8-bit picture with `at(x, y)` for each pixel, as many channels as it returns. */
function paint(size: number, at: (x: number, y: number) => readonly number[]): Picture {
  const channels = at(0, 0).length;
  const data = new Uint8Array(size * size * channels);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(at(x, y), (y * size + x) * channels);
  return { width: size, height: size, channels, depth: 8, data };
}

/** A mip as a picture again. */
const picture = (mip: Uint8Array): Picture => ({ width: Math.sqrt(mip.length / 4), height: Math.sqrt(mip.length / 4), channels: 4, depth: 8, data: mip });
const pixel = (mip: Uint8Array, i = 0): number[] => [...mip.subarray(i * 4, i * 4 + 4)];
const noise = (rng: Rng, bytes: number): Uint8Array => Uint8Array.from({ length: bytes }, () => rng.int(256));

// Written by Pillow, which filters rows: v(x, y) = (40000 + 4099 x + 9509 y + 9973 (x y mod 3)) mod 65536, 7 by 5.
const GREY_16 = "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFEAAAAAD8YXVHAAAALklEQVR4nGOc4yDAjIAsqqrmP8x/HJKEkCyqqj5v//Gp8sW9fcmnysfIvR6PYgDOhBU4y5f49AAAAABJRU5ErkJggg==";
// And grey (31 x + 57 y) mod 256 with alpha 255 - 40 x, 6 by 4.
const GREY_ALPHA_8 = "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAQAAAAHDYbIAAAAGElEQVR4nGNk+C9/AwZZLBnk4RAXx5IBADvGCHZhXvEcAAAAAElFTkSuQmCC";

test("a 16-bit PNG reads exactly, and every kind that is read comes back as it was written", () => {
  const grey = decodePng(Buffer.from(GREY_16, "base64"));
  expect([grey.width, grey.height, grey.channels, grey.depth]).toEqual([7, 5, 1, 16]);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) expect(grey.data[y * 7 + x]).toBe((40000 + 4099 * x + 9509 * y + 9973 * ((x * y) % 3)) % 65536);
  const both = decodePng(Buffer.from(GREY_ALPHA_8, "base64"));
  expect([both.width, both.height, both.channels, both.depth]).toEqual([6, 4, 2, 8]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) expect([...both.data.subarray((y * 6 + x) * 2, (y * 6 + x) * 2 + 2)]).toEqual([(31 * x + 57 * y) % 256, 255 - 40 * x]);

  const rng = new Rng(5);
  for (const depth of [8, 16] as const) {
    for (const channels of [1, 2, 3, 4]) {
      const data = depth === 8 ? noise(rng, 9 * 5 * channels) : Uint16Array.from({ length: 9 * 5 * channels }, () => rng.int(65536));
      const p: Picture = { width: 9, height: 5, channels, depth, data };
      expect(decodePng(encodePng(p))).toEqual(p);
    }
  }
  expect(() => decodePng(new Uint8Array(64))).toThrow("not a PNG file");
  const interlaced = encodePng(paint(4, () => [1, 2, 3]));
  interlaced[28] = 1;
  expect(() => decodePng(interlaced, "art.png")).toThrow("art.png: only grey, RGB and RGBA PNGs");
});

test("base colour is averaged as light: a black and white checker is linear mid grey, not sRGB mid grey", () => {
  const checker = paint(64, (x, y) => ((x + y) & 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const mips = baseMips(checker);
  expect(mips.map((m) => m.length)).toEqual([1, 2, 4, 8, 16, 32, 64].map((n) => n * n * 4));
  expect(mips[6]).toEqual(checker.data as Uint8Array);
  // Half the light is 188 in sRGB. Alpha is not light and is plainly halved.
  for (const m of mips.slice(0, 6)) for (let i = 0; i < m.length / 4; i++) expect(pixel(m, i)).toEqual([188, 188, 188, 128]);
  // Every value a picture can hold survives the trip to light and back.
  const all = paint(16, (x, y) => [y * 16 + x, 255 - (y * 16 + x), (y * 16 + x) ^ 85]);
  const top = baseMips(all)[4]!;
  for (let i = 0; i < 256; i++) expect(pixel(top, i)).toEqual([i, 255 - i, i ^ 85, 255]);
});

test("a source that is not a power of two across is resized to the nearest, and one that is not square is refused", () => {
  const flat = baseMips(paint(40, () => [200, 100, 50]));
  expect(flat.length).toBe(6);
  for (let i = 0; i < 32 * 32; i++) expect(pixel(flat[5]!, i)).toEqual([200, 100, 50, 255]);
  const halves = baseMips(paint(48, (x) => (x < 24 ? [0, 0, 0] : [255, 255, 255])));
  expect(halves.length).toBe(7);
  expect([pixel(halves[6]!, 20), pixel(halves[6]!, 43)]).toEqual([[0, 0, 0, 255], [255, 255, 255, 255]]);
  expect(Math.abs(halves[0]![0]! - 188)).toBeLessThan(2);
  expect(() => baseMips({ width: 8, height: 4, channels: 3, depth: 8, data: new Uint8Array(96) })).toThrow("8 by 4");
});

test("normals are averaged as vectors: opposed slopes shorten, point straight out, and raise the roughness under them", () => {
  // Columns lean left and right by turns: (-0.6, 0, 0.8) and (0.6, 0, 0.8).
  const ridged = paint(4, (x) => [x & 1 ? 204 : 51, 128, 230]);
  const { pictures, lengths } = normalMips(ridged);
  expect(pixel(pictures[2]!, 1)).toEqual([204, 128, 230, 255]);
  expect([...lengths[2]!].every((l) => l > 0.9999)).toBe(true);
  for (const level of [0, 1]) {
    for (let i = 0; i < lengths[level]!.length; i++) {
      expect(pixel(pictures[level]!, i)).toEqual([128, 128, 255, 255]);
      expect(lengths[level]![i]).toBeCloseTo(0.8, 2);
    }
  }
  // A slope that agrees with itself keeps its lean and its length.
  const leaning = normalMips(paint(4, () => [204, 128, 230]));
  expect([pixel(leaning.pictures[0]!), leaning.lengths[0]![0]! > 0.9999]).toEqual([[204, 128, 230, 255], true]);

  // Toksvig: a highlight of power s through normals that vary by v has the power s / (1 + s v).
  const r = 128 / 255;
  const power = 2 / r ** 4 - 2;
  expect(roughened(r, 0.8)).toBeCloseTo((2 / (power / (1 + power * 0.25) + 2)) ** 0.25, 6);
  expect([roughened(0.3, 1), roughened(1, 0.5), roughened(0, 1)]).toEqual([0.3, 1, 0]);
  expect(roughened(0.3, 0.99)).toBeGreaterThan(0.3);

  const packed = paint(4, () => [200, 128, 40]);
  const rough = packedMips(packed, lengths);
  expect(pixel(rough[2]!, 5)).toEqual([200, 128, 40, 255]);
  expect(pixel(rough[1]!, 3)).toEqual([200, 198, 40, 255]);
  expect(pixel(rough[0]!)).toEqual([200, 198, 40, 255]);
  // Under flat normals, or with no normal map, a packed map is its plain average.
  expect(packedMips(packed, leaning.lengths)).toEqual(packedMips(packed));
  expect(pixel(packedMips(paint(2, (x) => [x * 100, 50 + x * 100, 255]))[0]!)).toEqual([50, 100, 255, 255]);
  // A packed map one size below its normal map is matched to the normal mip of its own size.
  expect(pixel(packedMips(paint(2, () => [200, 128, 40]), lengths)[1]!)).toEqual([200, 198, 40, 255]);
  // Grey layers pack as occlusion, roughness, metalness, and 16 bits come down to 8.
  const layer = (depth: 8 | 16, v: number): Picture => ({ width: 2, height: 2, channels: 1, depth, data: depth === 8 ? new Uint8Array(4).fill(v) : new Uint16Array(4).fill(v) });
  expect([...packMro(layer(8, 200), layer(16, 0x8123)).data.subarray(0, 3)]).toEqual([200, 0x81, 0]);
  expect([...packMro(layer(8, 200), layer(8, 90), layer(8, 255)).data.subarray(3, 6)]).toEqual([200, 90, 255]);
});

test("the measures: layers of one size, a normal map that follows its height with green up, a picture that wraps, a large size that shrinks to the small", () => {
  const n = 32;
  const wave = (x: number, y: number): number => Math.sin((2 * Math.PI * (x + 3 * y)) / n) + 0.5 * Math.cos((2 * Math.PI * (2 * x - y)) / n);
  const height: Picture = { width: n, height: n, channels: 1, depth: 16, data: Uint16Array.from({ length: n * n }, (_, i) => 32768 + 12000 * wave(i % n, (i / n) | 0)) };
  // The normal of that height, green pointing up the image.
  const slope = (x: number, y: number): number[] => {
    const [dx, dy] = [(wave(x + 1, y) - wave(x - 1, y)) * 2, (wave(x, y + 1) - wave(x, y - 1)) * 2];
    const l = Math.hypot(dx, dy, 1);
    return [-dx / l, dy / l, 1 / l].map((v) => Math.round(v * 127.5 + 127.5));
  };
  const normal = paint(n, slope);
  const up = normalAgainstHeight(normal, height);
  expect([up.x > 0.99, up.y > 0.99, Math.abs(up.length - 1) < 0.005, up.off < 0.02]).toEqual([true, true, true, true]);
  // Green pointing down is the other convention, and it shows as the opposite sign.
  const down = normalAgainstHeight(paint(n, (x, y) => slope(x, y).map((v, c) => (c === 1 ? 255 - v : v))), height);
  expect([down.x > 0.99, down.y < -0.99]).toEqual([true, true]);
  expect(() => normalAgainstHeight(paint(16, () => [128, 128, 255]), height)).toThrow("its own size");

  // The wave tiles. A ramp does not: its last column is a whole picture away from its first.
  const [across, along] = seam(height);
  expect([across > 0.8 && across < 1.25, along > 0.8 && along < 1.25]).toEqual([true, true]);
  const ramp = seam(paint(n, (x) => [x * 8]));
  expect([ramp[0], ramp[1]]).toEqual([31, 0]);

  expect(oddSizes({ base: normal, height, mask: paint(16, () => [0]) })).toEqual(["mask 16x16"]);
  expect(oddSizes({ base: normal, height })).toEqual([]);

  // A large picture against the small one made from it, and against a small one that is something else.
  const rng = new Rng(9);
  const large = baseMips({ width: 64, height: 64, channels: 3, depth: 8, data: noise(rng, 64 * 64 * 3) });
  const small = baseMips(picture(large[5]!));
  expect(shrunkAgainst(large, small)).toBe(99);
  const other = baseMips(picture(large[5]!.map((v, i) => ((i & 3) === 0 ? v ^ 16 : v))));
  expect(shrunkAgainst(large, other)).toBeCloseTo(10 * Math.log10((255 * 255 * 3) / 256), 6);
});
