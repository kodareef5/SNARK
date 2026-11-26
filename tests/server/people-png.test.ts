// An uploaded print is checked by its PNG frame alone (server/people/png.ts): a real picture passes, and each malformed
// or hostile one is refused with its reason, without its picture ever being inflated.
import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { checkPng, hashOf, pngSize } from "../../server/people/png.ts";
import { PRINT_BYTES_MAX } from "../../shared/people/doc.ts";
import { encodePng } from "../../tools/snap/png.ts";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** One chunk, its CRC made as the PNG book says. */
function chunk(type: string, data: Uint8Array = new Uint8Array(0), crc?: number): number[] {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc ?? Bun.hash.crc32(out.subarray(4, 8 + data.length)) >>> 0);
  return [...out];
}

function header(width: number, height: number, depth = 8, colour = 6, interlace = 0): Uint8Array {
  const h = new Uint8Array(13), v = new DataView(h.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  h.set([depth, colour, 0, 0, interlace], 8);
  return h;
}

/** A PNG of `chunks` after the signature. */
const png = (...chunks: number[][]): Uint8Array => Uint8Array.from([...SIGNATURE, ...chunks.flat()]);
const pixels = (w: number, h: number) => deflateSync(new Uint8Array(h * (1 + w * 4)));
/** A small good picture's chunks, to break one at a time. */
const good = (w = 4, h = 4): number[][] => [chunk("IHDR", header(w, h)), chunk("IDAT", pixels(w, h)), chunk("IEND")];

/** A picture as a photo is: smooth colour with grain, so it compresses as a real print does. */
function photo(w: number, h: number, grain: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  let seed = 7;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const x = i % w, y = (i / w) | 0, n = (seed >>> 24) % (grain + 1);
    rgba.set([(x * 255) / w + n, (y * 255) / h + n, 128 + n, 255], i * 4);
  }
  return encodePng(w, h, rgba);
}

test("a photo-like print, one of noise up to the cap and a wide one pass, with their size", () => {
  const print = photo(512, 512, 4);
  expect(print.length).toBeLessThan(PRINT_BYTES_MAX);
  expect(checkPng(print)).toEqual({ width: 512, height: 512 });
  expect(pngSize(print)).toEqual({ width: 512, height: 512 });
  // Noise does not compress: 400 x 400 of it is under the cap, and 512 x 512 of it over.
  const noise = (side: number): Uint8Array => encodePng(side, side, crypto.getRandomValues(new Uint8Array(side * side * 4)));
  expect(checkPng(noise(400))).toEqual({ width: 400, height: 400 });
  expect(checkPng(noise(512))).toBe("A print is 640 KB at most.");
  expect(checkPng(photo(512, 256, 8))).toEqual({ width: 512, height: 256 });
  expect(checkPng(png(...good(64, 64)))).toEqual({ width: 64, height: 64 });
});

test("the CRC is the PNG book's: an end chunk's is always AE426082", () => {
  expect(chunk("IEND").slice(8)).toEqual([0xae, 0x42, 0x60, 0x82]);
});

test("the hash is the start of the file's SHA-256", () => {
  const print = photo(64, 64, 4);
  expect(hashOf(print)).toBe(new Bun.CryptoHasher("sha256").update(print).digest("hex").slice(0, 16));
});

test("each malformed or hostile PNG is refused, saying why", () => {
  const [ihdr, idat, iend] = good();
  const plte = chunk("PLTE", new Uint8Array(12));
  const refused: [string, Uint8Array, RegExp][] = [
    ["not a PNG", new TextEncoder().encode("GIF89a........................"), /not a PNG/],
    ["a huge declared size", png(chunk("IHDR", header(100_000, 100_000)), idat!, iend!), /1 to 512 pixels a side; this one is 100000 x 100000/],
    ["one pixel past the side", png(chunk("IHDR", header(513, 513)), idat!, iend!), /1 to 512 pixels/],
    ["a tall picture", png(chunk("IHDR", header(256, 512)), idat!, iend!), /square or twice as wide/],
    ["three to one", png(chunk("IHDR", header(384, 128)), idat!, iend!), /square or twice as wide/],
    ["an empty picture", png(chunk("IHDR", header(0, 0)), idat!, iend!), /1 to 512 pixels/],
    ["16-bit samples", png(chunk("IHDR", header(4, 4, 16, 6)), idat!, iend!), /8 bits a sample/],
    ["a colour type there is not", png(chunk("IHDR", header(4, 4, 8, 5)), idat!, iend!), /8 bits a sample/],
    ["an interlace method there is not", png(chunk("IHDR", header(4, 4, 8, 6, 2)), idat!, iend!), /method there is not/],
    ["a bad CRC", png(ihdr!, chunk("IDAT", pixels(4, 4), 0x12345678), iend!), /IDAT chunk of this PNG fails its CRC/],
    ["a bad header CRC", png(chunk("IHDR", header(4, 4), 0), idat!, iend!), /IHDR chunk of this PNG fails its CRC/],
    ["trailing junk", Uint8Array.from([...png(...good()), 0, 1, 2, 3]), /bytes after its end/],
    ["no end chunk", png(ihdr!, idat!), /stops before its end chunk/],
    ["cut inside a chunk", png(ihdr!, idat!).subarray(0, 40), /runs past its end|stops inside a chunk/],
    ["a chunk claiming 4 GB", png(ihdr!, [0xff, 0xff, 0xff, 0xff, ...[..."IDAT"].map((c) => c.charCodeAt(0)), 0, 0, 0, 0], iend!), /runs past its end/],
    ["no header first", png(idat!, ihdr!, iend!), /does not begin with its header/],
    ["two headers", png(ihdr!, ihdr!, idat!, iend!), /second header/],
    ["no picture", png(ihdr!, iend!), /has no picture/],
    ["a picture split by a chunk", png(ihdr!, idat!, chunk("tEXt", new TextEncoder().encode("a\0b")), idat!, iend!), /split by other chunks/],
    ["an end chunk with data", png(ihdr!, idat!, chunk("IEND", new Uint8Array(1))), /end chunk is not empty/],
    ["a palette picture with no palette", png(chunk("IHDR", header(4, 4, 8, 3)), idat!, iend!), /no palette/],
    ["two palettes", png(chunk("IHDR", header(4, 4, 8, 3)), plte, plte, idat!, iend!), /two palettes/],
    ["a palette after the picture", png(chunk("IHDR", header(4, 4, 8, 2)), idat!, plte, iend!), /after its picture/],
    ["a palette too long for its depth", png(chunk("IHDR", header(4, 4, 1, 3)), plte, idat!, iend!), /palette is the wrong length/],
    ["a grey picture with a palette", png(chunk("IHDR", header(4, 4, 8, 0)), plte, idat!, iend!), /grey PNG has no palette/],
    ["an animated PNG", png(ihdr!, chunk("acTL", new Uint8Array(8)), idat!, iend!), /animated/],
    ["a critical chunk no reader knows", png(ihdr!, chunk("ABCD", new Uint8Array(4)), idat!, iend!), /chunk ABCD no reader knows/],
    ["a chunk with a broken name", png(ihdr!, chunk("a1cd", new Uint8Array(4)), idat!, iend!), /broken name/],
    ["one byte past the cap", new Uint8Array(PRINT_BYTES_MAX + 1), /KB at most/],
  ];
  for (const [what, bytes, why] of refused) {
    const got = checkPng(bytes);
    expect([what, typeof got === "string" && why.test(got) ? "refused" : got]).toEqual([what, "refused"]);
  }
});

test("a zip bomb in the picture data costs no more than its bytes, since nothing is inflated", () => {
  // 64 KB of deflated zeros that would inflate to 64 MB, 64 times what a 512 x 512 picture holds; only the frame is read.
  const bomb = deflateSync(new Uint8Array(64 << 20), { level: 9 });
  expect(bomb.length).toBeLessThan(128 * 1024);
  const bytes = png(chunk("IHDR", header(512, 512)), chunk("IDAT", bomb), chunk("IEND"));
  const from = performance.now();
  expect(checkPng(bytes)).toEqual({ width: 512, height: 512 });
  expect(performance.now() - from).toBeLessThan(50);
});
