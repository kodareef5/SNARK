// The MP4 box reader a clip is checked by before it joins a library, and the move of its moov box (shared/video/mp4.ts).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIP_MAX_SECONDS } from "../../shared/video/clip.ts";
import { chunkOffsets, faststart, faststartParts, probeMp4, type Mp4Info } from "../../shared/video/mp4.ts";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(import.meta.dir, "../fixtures/video", name)));

/** The first box of `type` anywhere in `b`, found by its name's bytes. */
function at(b: Uint8Array, type: string): number {
  for (let i = 4; i + 4 <= b.length; i++) if (String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!) === type) return i - 4;
  return -1;
}

test("a faststart H.264 clip is read for its size, length and rate", () => {
  expect(probeMp4(fixture("small.mp4"))).toEqual({ width: 160, height: 90, seconds: 2, kbps: 15, audio: false, faststart: true });
  expect((probeMp4(fixture("late.mp4")) as Mp4Info).faststart).toBe(false);
  expect(probeMp4(fixture("audio.mp4"))).toMatchObject({ width: 160, height: 90, seconds: 2, audio: true, faststart: false });
});

test("a clip that is not H.264 and AAC in a whole MP4 is refused, saying why", () => {
  expect(probeMp4(new TextEncoder().encode("<html>not a clip</html>"))).toBe("This is not an MP4 file.");
  expect(probeMp4(fixture("small.mp4").subarray(0, 600))).toBe("This is not an MP4 file.");
  expect(probeMp4(fixture("hevc.mp4"))).toBe("The video is hvc1, not H.264.");
  expect(probeMp4(fixture("fragmented.mp4"))).toStartWith("This MP4 is fragmented.");
  const ac3 = fixture("audio.mp4"), entry = at(ac3, "mp4a");
  ac3.set(new TextEncoder().encode("ac-3"), entry + 4);
  expect(probeMp4(ac3)).toBe("The audio is ac-3, not AAC.");
});

test("a clip over the caps is refused by what its boxes declare", () => {
  expect(probeMp4(fixture("wide.mp4"))).toBe("The picture is 1280×720, over 854×480.");
  // mvhd version 0: its duration follows the version, two times and the timescale.
  const long = fixture("small.mp4"), mvhd = at(long, "mvhd"), v = new DataView(long.buffer);
  v.setUint32(mvhd + 8 + 16, (CLIP_MAX_SECONDS + 1) * v.getUint32(mvhd + 8 + 12));
  expect(probeMp4(long)).toBe(`The clip is ${CLIP_MAX_SECONDS + 1} s long, over 30 min.`);
  const quick = fixture("small.mp4"), q = new DataView(quick.buffer);
  q.setUint32(mvhd + 8 + 16, q.getUint32(mvhd + 8 + 12) / 100);
  expect(probeMp4(quick)).toBe(`The clip runs at ${Math.round((quick.length * 8) / 0.01 / 1000)} kbit/s, over 1500.`);
});

test("a version 1 mvhd gives the length from its 64-bit fields", () => {
  const b = fixture("small.mp4"), mvhd = at(b, "mvhd"), size = new DataView(b.buffer).getUint32(mvhd);
  // Rebuilt as version 1: times and duration widen from 4 bytes to 8, so the box grows by 12.
  const body = b.subarray(mvhd + 8, mvhd + size), wide = new Uint8Array(size + 12), w = new DataView(wide.buffer);
  w.setUint32(0, size + 12);
  wide.set(new TextEncoder().encode("mvhd"), 4);
  wide[8] = 1;
  w.setUint32(8 + 20, new DataView(body.buffer, body.byteOffset).getUint32(12));
  w.setUint32(8 + 24, 0);
  w.setUint32(8 + 28, new DataView(body.buffer, body.byteOffset).getUint32(12) * 3);
  wide.set(body.subarray(20), 8 + 32);
  const moov = at(b, "moov"), moovSize = new DataView(b.buffer).getUint32(moov);
  const out = new Uint8Array(b.length + 12);
  out.set(b.subarray(0, mvhd));
  out.set(wide, mvhd);
  out.set(b.subarray(mvhd + size), mvhd + size + 12);
  new DataView(out.buffer).setUint32(moov, moovSize + 12);
  // The chunk offset points past the grown moov now.
  const stco = at(out, "stco"), o = new DataView(out.buffer);
  o.setUint32(stco + 16, o.getUint32(stco + 16) + 12);
  expect(probeMp4(out)).toMatchObject({ seconds: 3, width: 160, height: 90 });
});

test("faststart moves moov before mdat and every chunk offset with it", () => {
  for (const name of ["late.mp4", "audio.mp4"]) {
    const before = fixture(name), after = faststart(before) as Uint8Array;
    expect(after.length).toBe(before.length);
    expect((probeMp4(after) as Mp4Info).faststart).toBe(true);
    const was = chunkOffsets(before), now = chunkOffsets(after);
    expect(now.length).toBe(was.length);
    expect(now).not.toEqual(was);
    // Each offset still points at the same sample bytes.
    for (let i = 0; i < was.length; i++) expect(after.subarray(now[i]!, now[i]! + 32)).toEqual(before.subarray(was[i]!, was[i]! + 32));
    expect(faststart(after)).toBe(after);
  }
  const already = fixture("small.mp4");
  expect(faststart(already)).toBe(already);
  expect(faststartParts(already)).toEqual([already]);
});

test("faststart refuses a chunk offset that points outside the file", () => {
  const b = fixture("late.mp4"), stco = at(b, "stco");
  new DataView(b.buffer).setUint32(stco + 16, 0xffffff00);
  expect(faststart(b)).toBe("A chunk offset points outside the file.");
  expect(faststart(fixture("small.mp4").subarray(0, 100))).toBe("This is not an MP4 file.");
});
