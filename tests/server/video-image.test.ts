// The header reader a still is checked by before it joins a library (shared/video/image.ts).
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMAGE_MAX_BYTES, IMAGE_MAX_LONG } from "../../shared/video/clip.ts";
import { probeImage } from "../../shared/video/image.ts";

const root = mkdtempSync(join(tmpdir(), "snark-video-image-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number): number[] => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number): number[] => [n >>> 8, n & 255];
const le16 = (n: number): number[] => [n & 255, n >>> 8];
const le24 = (n: number): number[] => [n & 255, (n >>> 8) & 255, n >>> 16];
const le32 = (n: number): number[] => [...le16(n & 0xffff), ...le16(n >>> 16)];

const png = (w: number, h: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 2, 0, 0, 0]);
/** A JPEG's start, an APP0 segment, then a frame header of `sof`. */
const jpeg = (w: number, h: number, sof = 0xc0): Uint8Array =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...be16(16), ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xff, sof, ...be16(11), 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0, 0xff, 0xda]);
const riff = (chunk: string, body: number[]): Uint8Array => new Uint8Array([...ascii("RIFF"), ...le32(4 + 8 + body.length), ...ascii("WEBP"), ...ascii(chunk), ...le32(body.length), ...body]);
const vp8 = (w: number, h: number): Uint8Array => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0]);
const vp8l = (w: number, h: number): Uint8Array => riff("VP8L", [0x2f, ...le32((w - 1) | ((h - 1) << 14)), 0, 0, 0, 0, 0]);
const vp8x = (w: number, h: number): Uint8Array => riff("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);

test("a PNG, JPEG and each kind of WebP are read for their size from the header", () => {
  expect(probeImage(png(640, 360))).toEqual({ type: "png", width: 640, height: 360 });
  expect(probeImage(jpeg(1280, 420))).toEqual({ type: "jpeg", width: 1280, height: 420 });
  expect(probeImage(jpeg(300, 200, 0xc2))).toEqual({ type: "jpeg", width: 300, height: 200 });
  expect(probeImage(vp8(800, 262))).toEqual({ type: "webp", width: 800, height: 262 });
  expect(probeImage(vp8l(1000, 1))).toEqual({ type: "webp", width: 1000, height: 1 });
  expect(probeImage(vp8x(1280, 720))).toEqual({ type: "webp", width: 1280, height: 720 });
});

test("an image over the long side, too big, or of another type is refused, saying why", () => {
  expect(probeImage(png(IMAGE_MAX_LONG + 1, 10))).toBe(`The picture is ${IMAGE_MAX_LONG + 1}×10, over ${IMAGE_MAX_LONG} on its long side.`);
  expect(probeImage(vp8x(10, 4000))).toBe(`The picture is 10×4000, over ${IMAGE_MAX_LONG} on its long side.`);
  expect(probeImage(new Uint8Array(IMAGE_MAX_BYTES + 1))).toBe("An image is 1 MB at most.");
  expect(probeImage(new TextEncoder().encode("GIF89a........"))).toBe("This is not a PNG, JPEG or WebP image.");
  expect(probeImage(png(0, 10))).toBe("The picture has no size.");
  expect(probeImage(png(10, 10).subarray(0, 20))).toBe("This PNG has no header.");
  expect(probeImage(jpeg(10, 10, 0xc3))).toBe("This JPEG is lossless or arithmetic coded, which browsers do not show.");
  expect(probeImage(jpeg(10, 10).subarray(0, 24))).toBe("This JPEG is broken.");
  expect(probeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe("This JPEG has no frame header before its picture.");
  expect(probeImage(riff("ALPH", new Array(20).fill(0)))).toBe("This WebP is broken.");
});

test.skipIf(!Bun.which("ffmpeg"))("files ffmpeg makes are read for the size they were made at", async () => {
  const cases = [["a.png", "png"], ["b.jpg", "jpeg"], ["c.webp", "webp"]] as const;
  for (const [name, type] of cases) {
    const file = join(root, name);
    const p = Bun.spawn(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=321x123:rate=1", "-frames:v", "1", file], { stdout: "ignore", stderr: "pipe" });
    if ((await p.exited) !== 0) {
      // An ffmpeg without a WebP encoder skips that one.
      if (type === "webp") continue;
      throw new Error(await new Response(p.stderr).text());
    }
    expect(probeImage(new Uint8Array(readFileSync(file)))).toEqual({ type, width: 321, height: 123 });
  }
});
