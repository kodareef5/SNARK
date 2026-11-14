// The ASTC encoder and its decoder. The decoder is held to what a GPU showed for the same blocks; the encoder is
// held to the decoder: every kind of block it makes must come back close to the pixels it was given.
import { expect, test } from "bun:test";
import { PINNED, builtBlocks, decodedSum } from "../../tools/pack/astc-gpu.ts";
import { type AstcKind, astcBlockCount, decodeAstc, decodeAstcBlock, describeAstcBlock, encodeAstc, encodeAstcBlocks, iseBits, iseDecode, iseEncode } from "../../tools/pack/astc.ts";

const LEVELS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256];

/** A seeded source of whole numbers below `n`. */
function dice(seed: number): (n: number) => number {
  let state = seed;
  return (n) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.floor(((state >>> 0) / 4294967296) * n);
  };
}

/** A square picture from a function of position that gives red, green, blue and alpha. */
function picture(size: number, at: (x: number, y: number) => number[]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out.set(at(x, y).map((v) => Math.max(0, Math.min(255, Math.round(v)))), (y * size + x) * 4);
  return out;
}

/** What encoding and decoding does to a picture: the decibels of what came back, the largest difference in any
 *  channel, and the kinds of block that were used. A normal map is compared as the two channels it keeps. */
function through(rgba: Uint8Array, size: number, kind: AstcKind): { db: number; worst: number; kinds: Set<string> } {
  const blocks = encodeAstc(rgba, size, size, kind);
  const back = decodeAstc(blocks, size, size, kind);
  let squares = 0;
  let worst = 0;
  for (let i = 0; i < size * size * 4; i += 4) {
    const pairs = kind === "normal" ? [[back[i]!, rgba[i]!], [back[i + 1]!, rgba[i]!], [back[i + 2]!, rgba[i]!], [back[i + 3]!, rgba[i + 1]!]] : [0, 1, 2, 3].map((c) => [back[i + c]!, rgba[i + c]!]);
    for (const [got, want] of pairs) {
      squares += (got! - want!) ** 2;
      worst = Math.max(worst, Math.abs(got! - want!));
    }
  }
  const kinds = new Set<string>();
  for (let at = 0; at < blocks.length; at += 16) kinds.add(describeAstcBlock(blocks, at).replace(/ weights.*/, ""));
  return { db: 10 * Math.log10((255 * 255) / (squares / (size * size * 4))), worst, kinds };
}

test("the integer sequence encoding gives back every value of every range", () => {
  const below = dice(0x15e);
  const bits = new Uint8Array(400);
  const out = new Int32Array(40);
  for (let range = 0; range < LEVELS.length; range++) {
    for (let count = 1; count <= 34; count++) {
      for (let n = 0; n < 4; n++) {
        // All the lowest, all the highest, then random.
        const values = Array.from({ length: count }, () => (n === 0 ? 0 : n === 1 ? LEVELS[range]! - 1 : below(LEVELS[range]!)));
        bits.fill(7);
        iseEncode(values, count, range, bits, 5);
        const end = 5 + iseBits(range, count);
        // Nothing is written outside the bits the specification counts.
        expect(bits.subarray(0, 5).every((b) => b === 7) && bits.subarray(end).every((b) => b === 7)).toBe(true);
        expect(bits.subarray(5, end).every((b) => b < 2)).toBe(true);
        bits.fill(0, end);
        iseDecode(bits, 5, range, count, out);
        expect(Array.from(out.subarray(0, count))).toEqual(values);
      }
    }
  }
  // Five trits take 8 bits and three quints take 7, C.2.12.
  expect([iseBits(1, 5), iseBits(3, 3), iseBits(4, 6), iseBits(20, 6), iseBits(11, 16)]).toEqual([8, 7, 16, 48, 80]);
});

test("the decoder reads blocks the way a GPU was seen to", () => {
  // These blocks cover every grid, weight range, number of planes and partitions and endpoint mode of a 4 by 4
  // block. tools/pack/astc-gpu.ts showed each of them to a GPU, which agreed with our decoder on every pixel, and
  // printed this sum. After any change to the decoder, run it again.
  expect(decodedSum(builtBlocks(PINNED.seed, PINNED.each))).toBe("7ad59271");
});

test("a block the format does not allow decodes to the error colour", () => {
  const out = new Uint8Array(64);
  const magenta = Array.from({ length: 64 }, (_, i) => (i % 4 === 1 ? 0 : 255));
  const bad: Record<string, number[]> = {
    "a reserved block mode": [0x00, 0x00],
    "a void-extent block with a reserved bit clear": [0xfc, 0xf9, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
    "a void-extent block whose low coordinate is not below its high": [0xfc, 0x0d, 0x00, 0x00],
    "a weight grid five wide": [0x81, 0x00],
    "weights in fewer than 24 bits": [0x41, 0x00],
    "four partitions with two planes": [0x42, 0x1c],
    "more than 18 endpoint values": [0x43, 0x10, 0x80, 0x19],
  };
  for (const [what, bytes] of Object.entries(bad)) {
    const block = new Uint8Array(16);
    block.set(bytes);
    for (const srgb of [false, true]) {
      expect([what, decodeAstcBlock(block, 0, srgb, out)]).toEqual([what, false]);
      expect([what, Array.from(out)]).toEqual([what, magenta]);
    }
  }
});

test("a block of one colour comes back exactly", () => {
  for (const kind of ["srgb", "linear"] as const) {
    for (const colour of [[0, 0, 0, 255], [255, 255, 255, 255], [1, 128, 254, 255], [200, 17, 99, 3], [77, 77, 77, 0]]) {
      const rgba = picture(8, () => colour);
      const blocks = encodeAstc(rgba, 8, 8, kind);
      expect(describeAstcBlock(blocks, 0)).toBe("solid");
      expect(Array.from(decodeAstc(blocks, 8, 8, kind))).toEqual(Array.from(rgba));
    }
  }
});

test("every kind of block the encoder makes comes back close to its pixels", () => {
  const below = dice(0xa57c);
  const noise = (amount: number): number => (below(4096) / 4096 - 0.5) * amount;
  const tile = (x: number, y: number): number => (x >> 3) + (y >> 3) * 4;
  const colours = Array.from({ length: 64 }, () => [below(256), below(256), below(256), below(256)]);
  const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i]! - v) * t);
  const slope = (x: number, y: number): number => ((x & 7) + (y & 7) * (tile(x, y) % 3)) / (7 + 7 * (tile(x, y) % 3));
  const opaque = (c: number[]): number[] => [c[0]!, c[1]!, c[2]!, 255];
  const grey = (c: number[]): number[] => [c[0]!, c[0]!, c[0]!, c[3]!];
  const seen = new Set<string>();
  const check = (what: string, rgba: Uint8Array, kind: AstcKind, db: number, worst: number): void => {
    const got = through(rgba, 32, kind);
    for (const k of got.kinds) seen.add(k);
    expect([what, got.db >= db, got.worst <= worst]).toEqual([what, true, true]);
  };
  // Slopes from one colour to another, each 8 by 8 tile its own.
  const slopes = (x: number, y: number): number[] => mix(colours[tile(x, y)]!, colours[tile(x, y) + 16]!, slope(x, y));
  check("slopes", picture(32, (x, y) => opaque(slopes(x, y))), "srgb", 54, 3);
  check("slopes with alpha", picture(32, slopes), "linear", 51, 4);
  check("grey slopes", picture(32, (x, y) => opaque(grey(slopes(x, y)))), "linear", 58, 2);
  check("grey slopes with alpha", picture(32, (x, y) => grey(slopes(x, y))), "linear", 54, 3);
  // Two flat colours with a slanted edge between them are two points on one line: exact.
  const edge = (x: number, y: number): boolean => (x & 7) * 2 + (y & 7) > 9;
  check("two colours", picture(32, (x, y) => opaque(colours[tile(x, y) + (edge(x, y) ? 16 : 0)]!)), "srgb", Infinity, 0);
  check("two colours with alpha", picture(32, (x, y) => colours[tile(x, y) + (edge(x, y) ? 16 : 0)]!), "linear", Infinity, 0);
  // Two slopes with an edge between them need two partitions, and three colours need three or a second plane.
  const sides = (x: number, y: number): number[] => (edge(x, y) ? mix(colours[tile(x, y)]!, colours[tile(x, y) + 16]!, (x & 7) / 14) : mix(colours[tile(x, y) + 32]!, colours[tile(x, y) + 48]!, (y & 7) / 14));
  check("two slopes", picture(32, (x, y) => opaque(sides(x, y))), "srgb", 47, 8);
  check("two slopes with alpha", picture(32, sides), "linear", 39, 16);
  check("three colours", picture(32, (x, y) => opaque(colours[tile(x, y) + ((x & 7) > 1 ? ((y & 7) > 5 ? 32 : 16) : 0)]!)), "linear", 48, 6);
  // Noise on a slope, and a normal map of a rippled surface.
  check("noise", picture(32, (x, y) => opaque(slopes(x, y).map((v) => v + noise(50)))), "srgb", 30, 40);
  check("normals", picture(32, (x, y) => [128 + 90 * Math.sin(x / 5) + noise(6), 128 + 90 * Math.cos(y / 3 + x / 9) + noise(6), 255, 255]), "normal", 44, 8);

  // One colour; one, two and three partitions; luminance, with alpha, RGB and RGBA; direct, and base and offset; a
  // second plane of weights; and grids smaller than the block.
  const wanted = [/^solid$/, /^1 part l \d/, /^1 part la \d/, /^1 part rgb 4x4/, /^1 part rgba 4x4/, /^1 part rgb offset \d/, /^1 part rgba offset \d/, /^2 parts l \d/, /^2 parts la \d/, /^2 parts rgb \d/, /^2 parts rgb offset \d/, /^2 parts rgba/, /^3 parts rgb/, /^1 part la two planes/, /^1 part la offset two planes/, /^1 part rgb two planes/, /^1 part rgba two planes/, / [23]x[234]$/, / 4x[23]$/];
  for (const kind of wanted) expect([String(kind), [...seen].some((k) => kind.test(k))]).toEqual([String(kind), true]);
});

test("a mask of pure colours comes back within two levels", () => {
  // A mask gives each of three colour regions a channel to itself, and black is undyed. Here regions grow from
  // scattered points, so borders run at every angle and three regions meet in many blocks.
  const below = dice(0x3a5c);
  const pure = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 255]];
  const seeds = Array.from({ length: 40 }, () => [below(96), below(96), below(4)]);
  const rgba = picture(96, (x, y) => {
    let nearest = seeds[0]!;
    for (const s of seeds) if ((s[0]! - x) ** 2 + (s[1]! - y) ** 2 < (nearest[0]! - x) ** 2 + (nearest[1]! - y) ** 2) nearest = s;
    return pure[nearest[2]!]!;
  });
  const blocks = encodeAstc(rgba, 96, 96, "linear");
  const back = decodeAstc(blocks, 96, 96, "linear");
  let worst = 0;
  let three = 0;
  for (let i = 0; i < back.length; i++) worst = Math.max(worst, Math.abs(back[i]! - rgba[i]!));
  for (let b = 0; b < 576; b++) {
    const seen = new Set<number>();
    for (let i = 0; i < 16; i++) seen.add(new DataView(rgba.buffer).getUint32((((b / 24) | 0) * 4 + (i >> 2)) * 384 + ((b % 24) * 4 + (i & 3)) * 4));
    if (seen.size >= 3) three++;
  }
  expect(three).toBeGreaterThan(10);
  expect(worst).toBeLessThanOrEqual(2);
  // The same mask after a blur, as a smaller mip of it would be: every pixel a mix of regions.
  const soft = picture(96, (x, y) => [0, 1, 2, 3].map((c) => (c === 3 ? 255 : (rgba[(y * 96 + x) * 4 + c]! + rgba[(y * 96 + Math.min(95, x + 1)) * 4 + c]! + rgba[(Math.min(95, y + 1) * 96 + x) * 4 + c]! + rgba[(Math.min(95, y + 1) * 96 + Math.min(95, x + 1)) * 4 + c]!) / 4)));
  // Where three blurred regions meet no block is exact, and a pixel there can be far off.
  const softened = through(soft, 96, "linear");
  expect(softened.db).toBeGreaterThan(50);
  expect(softened.worst).toBeLessThanOrEqual(48);
});

test("pictures down to one pixel across are padded to whole blocks", () => {
  const below = dice(0x51de);
  for (const [w, h] of [[1, 1], [2, 2], [3, 5], [5, 4], [6, 7], [9, 1]] as const) {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([40 + (i % w) * 20, 90 + Math.floor(i / w) * 15, below(8) + 100, 255], i * 4);
    const blocks = encodeAstc(rgba, w, h, "srgb");
    expect(blocks.length).toBe(astcBlockCount(w, h) * 16);
    expect(blocks.length).toBe(Math.ceil(w / 4) * Math.ceil(h / 4) * 16);
    const back = decodeAstc(blocks, w, h, "srgb");
    let worst = 0;
    for (let i = 0; i < back.length; i++) worst = Math.max(worst, Math.abs(back[i]! - rgba[i]!));
    expect(worst).toBeLessThanOrEqual(4);
  }
});

test("the same pixels give the same bytes", () => {
  const below = dice(0xb17e5);
  const rgba = picture(40, (x, y) => [x * 6 + below(30), y * 5 + below(60), ((x >> 3) + (y >> 3)) % 2 ? 200 : 40 + below(20), y > 20 ? 255 : 128 + below(100)]);
  const whole = encodeAstc(rgba, 40, 40, "srgb");
  expect(Array.from(encodeAstc(rgba, 40, 40, "srgb"))).toEqual(Array.from(whole));
  // A range of blocks is the same bytes the whole picture has there, whatever was encoded before it.
  const part = new Uint8Array(30 * 16);
  encodeAstcBlocks(rgba, 40, 40, "srgb", 55, 30, part);
  expect(Array.from(part)).toEqual(Array.from(whole.subarray(55 * 16, 85 * 16)));
  // And the same bytes on any machine: this sum changes only when the encoder's choices do.
  let sum = 0x811c9dc5;
  for (const kind of ["srgb", "linear", "normal"] as const) for (const b of encodeAstc(rgba, 40, 40, kind)) sum = Math.imul(sum ^ b, 0x01000193);
  expect((sum >>> 0).toString(16)).toBe("55b08dc0");
});
