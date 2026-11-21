// The data utility's record of frames: each frame's row holds what came in it and what went to the card, a second's
// bucket sums its frames, and the bytes counted are every byte the asset and sound libraries took in, those that came
// too late among them.
import { expect, test } from "bun:test";
import { BUCKETS, FLAG_HELD, FRAME_ROWS, FrameRing, SLOW_MS } from "../../client/core/assets/frames.ts";
import type { AssetArrival, AssetPort } from "../../client/core/assets/port.ts";
import { Residency } from "../../client/core/assets/residency.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { SoundPacket } from "../../client/core/sound/packet.ts";
import { MANIFEST_VERSION, parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { stressSet } from "../../tools/pack/stress.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { FRAME_MS, assetWorld } from "../fixtures/assetworld.ts";
import { builtSounds } from "../fixtures/sounds.ts";

const SET = stressSet({ rocks: 8, detail: 4, plate: 64 });
const ROCKS = Array.from({ length: 8 }, (_, i) => ({ mesh: SET.manifest.meshes.findIndex((m) => m.id === `stress:rock_${String(i).padStart(2, "0")}`), z: 10 + 12 * i }));
const sum = (a: ArrayLike<number>): number => Array.from(a).reduce((s, v) => s + v, 0);

test("each frame's row holds the bytes that came in it and went to the card, and the rows add up to the library's totals", () => {
  const w = assetWorld(SET, ROCKS, { latencyMs: 100, bytesPerSecond: 2e6, keep: true });
  const ring = new FrameRing();
  w.spend(1000);
  for (let f = 0; f < 600; f++) {
    w.frame(f < 300 ? 140 - f / 3 : 40);
    ring.record(w.now(), FRAME_MS, 3, 0.25, w.r, null);
  }
  expect([w.r.stats.fetched > 0, w.r.stats.uploaded > 0, ring.rows]).toEqual([true, true, 600]);
  expect([sum(ring.fetched), sum(ring.cached), sum(ring.uploaded)]).toEqual([w.r.stats.fetched + w.r.stats.stale, w.r.stats.cached, w.r.stats.uploaded]);
  // What is not an asset spends first, every frame.
  expect([...new Set(ring.spent.subarray(0, 600))]).toEqual([1000]);
  // The latest row is the state after the last frame.
  const last = ring.row(0);
  expect([ring.at[last], ring.flying[last], ring.ledger[last], ring.waiting[last], ring.wanting[last]]).toEqual([w.now(), w.r.flying, w.r.ledger, w.r.waiting, w.r.wanting()]);
  // A frame that took bytes in is one a slow frame can be laid beside: some rows took some, and most took none.
  const busy = Array.from(ring.fetched.subarray(0, 600)).filter((b) => b > 0).length;
  expect(busy > 0 && busy < 300).toBe(true);
});

test("a second's bucket sums its frames, counts the slow ones and keeps the longest, and a second with no frame is empty", () => {
  const ring = new FrameRing();
  // In second 10, half a second at 60 frames a second and one frame of 83 ms; then a pause of three seconds, and two
  // frames in second 13.
  let at = 10_000;
  for (let k = 0; k < 30; k++) ring.record((at += 1000 / 60), 1000 / 60, 4, 0, null, null);
  ring.record((at += 83), 83, 70, 12, null, null);
  ring.record((at += 3000), 3000, 5, 0, null, null);
  ring.record((at += 16), 16, 5, 0, null, null);
  expect(ring.second).toBe(13);
  const now = ring.bucket(0), before = ring.bucket(3);
  expect([ring.bucketFrames[now], ring.bucketSlow[now], ring.bucketWorst[now]]).toEqual([2, 1, 3000]);
  expect([ring.bucketSecond[before], ring.bucketFrames[before], ring.bucketSlow[before], ring.bucketWorst[before], ring.bucketUploadMs[before]]).toEqual([10, 31, 1, 83, 12]);
  // The seconds between had no frame drawn in them, and the seconds before the first are not kept.
  expect([1, 2].map((back) => ring.bucketFrames[ring.bucket(back)])).toEqual([0, 0]);
  expect([ring.bucketSecond[ring.bucket(2)], ring.bucket(4)]).toEqual([11, -1]);
  // A frame over SLOW_MS is slow, and one at it is not.
  ring.record((at += SLOW_MS), SLOW_MS, 5, 0, null, null);
  expect(ring.bucketSlow[ring.bucket(0)]).toBe(1);
});

test("the ring keeps its last frames and seconds and no more, and starts its counts again when a library is made anew", () => {
  const ring = new FrameRing();
  for (let k = 0; k < FRAME_ROWS + 10; k++) ring.record(k * 1000, 1000, 1, 0, null, null);
  expect([ring.at[ring.row(0)], ring.at[ring.row(FRAME_ROWS - 1)], ring.row(FRAME_ROWS), ring.row(-1)]).toEqual([(FRAME_ROWS + 9) * 1000, 10 * 1000, -1, -1]);
  expect([ring.bucket(BUCKETS - 1) >= 0, ring.bucket(BUCKETS), ring.bucketSecond[ring.bucket(BUCKETS - 1)]]).toEqual([true, -1, FRAME_ROWS + 10 - BUCKETS]);
  // A scene made again brings a library whose totals start from nothing: its first row is what it took, not less than nothing.
  const manifest: Manifest = { version: MANIFEST_VERSION, files: [], boot: 0, clipHash: 0, meshes: [] };
  const pack = { blobAt: 0, blob: new Uint8Array(0) } as unknown as Pack;
  const first = new Residency(manifest, pack, null), again = new Residency(manifest, pack, null);
  first.stats.fetched = 5000;
  first.holdBack = true;
  ring.record(2e6, 16, 1, 0, first, null);
  again.stats.fetched = 300;
  ring.record(2e6 + 16, 16, 1, 0, again, null);
  expect([ring.fetched[ring.row(1)], ring.fetched[ring.row(0)], ring.flags[ring.row(1)], ring.flags[ring.row(0)]]).toEqual([5000, 300, FLAG_HELD, 0]);
});

test("bytes that come for a request no longer waited on are counted as stale, and what arrived is not kept past the frame that took it", () => {
  const manifest: Manifest = { version: MANIFEST_VERSION, files: [], boot: 0, clipHash: 0, meshes: [] };
  const pack = { blobAt: 0, blob: new Uint8Array(0) } as unknown as Pack;
  const late: AssetArrival = { slot: 0, generation: 7, data: new Uint8Array(4096), fail: 0, fetched: 4096, cached: 0 };
  const port: AssetPort = { cache: { used: 0, limit: 0, mode: "none", filling: 0 }, protocol: "", request: () => {}, cancel: () => {}, fill: () => {}, take: (out) => ((out[0] = late), 1) };
  const r = new Residency(manifest, pack, port);
  r.begin(16);
  expect([r.stats.stale, r.stats.fetched]).toEqual([4096, 0]);
  expect((r as unknown as { arrivals: (AssetArrival | null)[] }).arrivals).toEqual([null]);
});

test("the sounds' bytes are counted as they come, and a frame's row holds them beside the assets'", () => {
  const made = builtSounds();
  const manifest = parseManifest(JSON.stringify({ version: MANIFEST_VERSION, files: [{ name: "boot", bytes: 0, role: "boot" }, { name: "sounds", bytes: made.file.length, role: "sound" }], boot: 0, clipHash: 0, meshes: [], sounds: made.sounds }));
  const net = new FakeNet([new Uint8Array(0), made.file], { latencyMs: 20, bytesPerSecond: 1e6 });
  const lib = new SoundLibrary(manifest, net);
  const ring = new FrameRing();
  const p = new SoundPacket();
  for (let now = 16; now < 2000; now += 16) {
    net.advance(now);
    p.clear();
    lib.begin(now, p);
    for (let s = 0; s < lib.sounds.length; s++) lib.want(s, s + 1);
    lib.end(p);
    ring.record(now, 16, 1, 0, null, lib);
  }
  const taken = lib.sounds.reduce((n, s, i) => n + s.takes.slice(0, lib.takes(i)).reduce((m, t) => m + t.bytes, 0), 0);
  expect([lib.stats.fetched > 0, lib.stats.fetched, sum(ring.fetched)]).toEqual([true, taken, lib.stats.fetched + lib.stats.stale]);
});
