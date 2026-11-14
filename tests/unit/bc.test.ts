// BC5 and BC7: the decoders decode as a GPU does, and what the encoders make comes back close to what went in.
import { expect, test } from "bun:test";
import { hashBytes } from "../../shared/hash.ts";
import { bc7Mode, blockCount, decodeBc5, decodeBc7, encodeBc5, encodeBc7 } from "../../tools/pack/bc.ts";
import { BANDS, PURE, card, randomBc5, randomBc7 } from "../fixtures/bc.ts";

const SIZE = 64;

/** Decibels of `got` against `want` over rows `from` up to `to` of a picture SIZE across, in the first `channels` channels. */
function decibels(want: Uint8Array, got: Uint8Array, channels: number, from = 0, to = SIZE): number {
  let sum = 0;
  for (let i = from * SIZE * 4; i < to * SIZE * 4; i += 4) for (let c = 0; c < channels; c++) sum += (want[i + c]! - got[i + c]!) ** 2;
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255 * (to - from) * SIZE * channels) / sum);
}

function worst(want: Uint8Array, got: Uint8Array, channels: number): number {
  let most = 0;
  for (let i = 0; i < want.length; i += 4) for (let c = 0; c < channels; c++) most = Math.max(most, Math.abs(want[i + c]! - got[i + c]!));
  return most;
}

test("each BC7 mode decodes random blocks to the pixels a GPU shows", () => {
  // `bun tools/pack/bc-gpu.ts` shows these same blocks to a GPU and prints the hash of what it drew. These are those hashes.
  const seen = [0, 1, 2, 3, 4, 5, 6, 7].map((mode) => hashBytes(decodeBc7(randomBc7(mode, 256, 100 + mode), 64, 64)));
  expect(seen).toEqual([1166824849, 3658869983, 427021789, 3561433207, 2867115338, 3283837805, 1908848117, 1744070471]);
  // A first byte of zero is no mode at all, and decodes to nothing.
  expect(Array.from(decodeBc7(new Uint8Array(16).fill(255, 1), 4, 4))).toEqual(new Array(64).fill(0));
});

test("BC5 decodes by the specification's sevenths and fifths", () => {
  // Red from 255 down to 3 in eight values, coded in the order the format numbers them. Green from 10 up to 110 in six, then 0 and 255.
  const codes = [0, 2, 3, 4, 5, 6, 7, 1];
  const block = new Uint8Array(16);
  let bits = 0n;
  for (let t = 0; t < 16; t++) bits |= BigInt(codes[t & 7]!) << BigInt(3 * t);
  for (let half = 0; half < 2; half++) {
    block.set(half === 0 ? [255, 3] : [10, 110], half * 8);
    for (let k = 0; k < 6; k++) block[half * 8 + 2 + k] = Number((bits >> BigInt(8 * k)) & 255n);
  }
  const out = decodeBc5(block, 4, 4);
  expect(Array.from({ length: 8 }, (_, t) => out[t * 4])).toEqual([255, 219, 183, 147, 111, 75, 39, 3]);
  expect(Array.from({ length: 8 }, (_, t) => out[t * 4 + 1])).toEqual([10, 30, 50, 70, 90, 0, 255, 110]);
  expect([out[2], out[3]]).toEqual([0, 255]);
  expect(hashBytes(decodeBc5(randomBc5(256, 99), 64, 64))).toBe(2246212006);
});

test("a block of one colour comes back exact, whatever the colour", () => {
  // 256 blocks: every level once in each channel, in four different orders.
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = (y >> 2) * 16 + (x >> 2);
      rgba.set([v, (v * 7) & 255, 255 - v, (v * 13 + 5) & 255], (y * SIZE + x) * 4);
    }
  }
  expect(decodeBc7(encodeBc7(rgba, SIZE, SIZE), SIZE, SIZE)).toEqual(rgba);
  const five = decodeBc5(encodeBc5(rgba, SIZE, SIZE), SIZE, SIZE);
  expect(worst(rgba, five, 2)).toBe(0);
});

/** The card, opaque and with alpha, and what the encoder makes of them, made once: with alpha kept, and with it ignored. */
const plain = card(SIZE, false);
const cut = card(SIZE, true);
const plainBlocks = encodeBc7(plain, SIZE, SIZE);
const cutBlocks = encodeBc7(cut, SIZE, SIZE);
const freeBlocks = encodeBc7(plain, SIZE, SIZE, 3);

test("the card comes back within bounds in every band, and between them the bands use every mode", () => {
  const modes = new Set<number>();
  const band = SIZE / 8;
  // Decibels each band must reach: opaque, then with alpha in the measure too. Noise cannot be kept; it only has to come back.
  const floors = [
    [50, 55, 40, 15, 38, Infinity, 37, 47],
    [50, 52, 37, 13, 37, Infinity, 26, 44],
  ];
  for (const alpha of [false, true]) {
    const rgba = alpha ? cut : plain;
    const blocks = alpha ? cutBlocks : plainBlocks;
    const out = decodeBc7(blocks, SIZE, SIZE);
    for (let b = 0; b < blocks.length; b += 16) modes.add(bc7Mode(blocks, b));
    const reached = BANDS.map((_, k) => decibels(rgba, out, alpha ? 4 : 3, k * band, (k + 1) * band));
    for (let k = 0; k < 8; k++) expect(`${BANDS[k]}: ${reached[k]! >= floors[alpha ? 1 : 0]![k]!}`).toBe(`${BANDS[k]}: true`);
    // An opaque texel stays opaque.
    if (!alpha) expect(worst(rgba, out, 4)).toBe(worst(rgba, out, 3));
  }
  expect([...modes].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test("ramps and blocks of two flat colours come back within a level", () => {
  const out = decodeBc7(plainBlocks, SIZE, SIZE);
  const quarter = SIZE * SIZE;
  expect(worst(plain.subarray(0, quarter), out.subarray(0, quarter), 3)).toBeLessThanOrEqual(1);
});

test("a mask of pure colours comes back exact", () => {
  // Regions meet along straight and slanted edges, with black lines through them, as a mask of colour regions has.
  const rgba = new Uint8Array(SIZE * SIZE * 4).fill(255);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let c = PURE[(((x + (y >> 1)) / 12) | 0) % 6]!;
      if ((x * 3 + y) % 29 < 2 || y % 21 === 0) c = PURE[6]!;
      rgba.set(c, (y * SIZE + x) * 4);
    }
  }
  expect(worst(rgba, decodeBc7(encodeBc7(rgba, SIZE, SIZE), SIZE, SIZE), 4)).toBe(0);
  expect(worst(rgba, decodeBc7(encodeBc7(rgba, SIZE, SIZE, 3), SIZE, SIZE), 3)).toBe(0);
});

test("with alpha ignored the colour is no worse and alpha comes back 254 or 255", () => {
  const free = decodeBc7(freeBlocks, SIZE, SIZE);
  expect(decibels(plain, free, 3)).toBeGreaterThanOrEqual(decibels(plain, decodeBc7(plainBlocks, SIZE, SIZE), 3));
  let least = 255;
  for (let i = 3; i < free.length; i += 4) least = Math.min(least, free[i]!);
  expect(least).toBe(254);
  // What alpha the source has makes no difference.
  expect(encodeBc7(cut, SIZE, SIZE, 3)).toEqual(freeBlocks);
});

test("the same pixels give the same bytes, whole or in ranges", () => {
  expect(encodeBc7(plain, SIZE, SIZE)).toEqual(plainBlocks);
  const parts = [encodeBc7(cut, SIZE, SIZE, 4, 0, 100), encodeBc7(cut, SIZE, SIZE, 4, 100, 101), encodeBc7(cut, SIZE, SIZE, 4, 101)];
  expect(Buffer.concat(parts).equals(cutBlocks)).toBe(true);
  const five = encodeBc5(plain, SIZE, SIZE);
  expect(Buffer.concat([encodeBc5(plain, SIZE, SIZE, 0, 7), encodeBc5(plain, SIZE, SIZE, 7)]).equals(five)).toBe(true);
  // Pinned, so that a machine or an engine that rounds differently shows up here. A change to an encoder changes them too.
  expect([hashBytes(plainBlocks), hashBytes(cutBlocks), hashBytes(freeBlocks), hashBytes(five)]).toEqual([1193596061, 1182661630, 528535651, 3454168561]);
});

test("pictures that are not whole blocks are padded with their edge, down to one pixel", () => {
  for (const size of [1, 2, 3, 5, 6, 10]) {
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) rgba.set(plain.subarray((y * SIZE + 20) * 4, (y * SIZE + 20 + size) * 4), y * size * 4);
    const blocks = encodeBc7(rgba, size, size);
    expect(blocks.length).toBe(blockCount(size, size) * 16);
    expect(blocks.length).toBe(Math.ceil(size / 4) ** 2 * 16);
    const out = decodeBc7(blocks, size, size);
    expect(out.length).toBe(rgba.length);
    expect(worst(rgba, out, 4)).toBeLessThanOrEqual(size === 1 ? 0 : 2);
    expect(worst(rgba, decodeBc5(encodeBc5(rgba, size, size), size, size), 2)).toBeLessThanOrEqual(size === 1 ? 0 : 2);
  }
});

test("BC5 keeps the red and green of a normal map", () => {
  // A dome: the red and green of its normals, as a normal map stores them. And a second picture with texels at the ends of the range.
  const dome = new Uint8Array(SIZE * SIZE * 4);
  const ends = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = (x - 31.5) / 45;
      const ny = (y - 31.5) / 45;
      dome.set([Math.round(127.5 + 127.5 * nx), Math.round(127.5 + 127.5 * ny), 0, 255], (y * SIZE + x) * 4);
      ends.set([x % 5 === 0 ? 0 : 100 + ((x * 7 + y) % 40), y % 3 === 0 ? 255 : (x + y) % 7 === 0 ? 0 : 60 + ((x + y * 5) % 30), 0, 255], (y * SIZE + x) * 4);
    }
  }
  expect(decibels(dome, decodeBc5(encodeBc5(dome, SIZE, SIZE), SIZE, SIZE), 2)).toBeGreaterThan(55);
  expect(decibels(ends, decodeBc5(encodeBc5(ends, SIZE, SIZE), SIZE, SIZE), 2)).toBeGreaterThan(38);
});
