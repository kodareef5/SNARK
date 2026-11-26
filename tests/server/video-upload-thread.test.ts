// An upload's whole-file work stays off the world's event loop (server/video/upload.ts): the MP4 is checked and moved
// to faststart on a thread of its own, and receiving a buffered body lets timers run.
import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { VideoLibrary } from "../../server/video/library.ts";
import { inspectMp4, receive } from "../../server/video/upload.ts";
import { faststart, probeMp4 } from "../../shared/video/mp4.ts";

const lib = new VideoLibrary({ db: ":memory:" });
afterAll(() => lib.close());
const fixture = (name: string): string => join(import.meta.dir, "../fixtures/video", name);

test("the MP4 thread answers what probeMp4 and faststart do", async () => {
  for (const name of ["audio.mp4", "late.mp4", "small.mp4", "hevc.mp4", "wide.mp4", "fragmented.mp4"]) {
    const bytes = new Uint8Array(readFileSync(fixture(name))), part = join(lib.tmp, `part-${name}`);
    const got = await inspectMp4(fixture(name), part), probed = probeMp4(bytes);
    if (typeof probed === "string") {
      expect(got).toEqual({ error: probed });
      expect(existsSync(part)).toBe(false);
      continue;
    }
    expect(got).toEqual({ info: probed });
    // A clip already laid out is left where it is; one that is not is written moved, byte for byte as faststart makes it.
    if (probed.faststart) expect(existsSync(part)).toBe(false);
    else expect(Buffer.compare(readFileSync(part), faststart(bytes) as Uint8Array)).toBe(0);
    rmSync(part, { force: true });
  }
});

test("a missing file is the thread's fault, not the clip's", async () => {
  expect(await inspectMp4(join(lib.tmp, "none.mp4"), join(lib.tmp, "none.part"))).toMatchObject({ fault: expect.any(String) });
});

test("receiving a body already buffered lets timers run", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(7), chunks = 768;
  const body = new ReadableStream<Uint8Array>({ start: (c) => (Array.from({ length: chunks }, () => c.enqueue(chunk)), c.close()) });
  const req = new Request("http://snark.test/admin/screens/upload", { method: "POST", headers: { "content-length": String(chunk.length * chunks) }, body });
  let turns = 0;
  const timer = setInterval(() => turns++, 0);
  const got = await receive(req, lib, 64 * 1048576, "A clip");
  clearInterval(timer);
  expect(got).toMatchObject({ size: chunk.length * chunks });
  expect(turns).toBeGreaterThanOrEqual(2);
  if (!(got instanceof Response)) rmSync(got.tmp, { force: true });
});
