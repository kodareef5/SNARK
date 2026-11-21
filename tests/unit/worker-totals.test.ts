// The asset worker's totals as the page takes them. Bytes from the port's cache are told apart, memory from disk, and
// `cached` stays their sum for what reads it today; the record of frames keeps the disk's share; and the self-check
// does not take the disk for still while the worker says writes are under way. The worker itself has no test: the
// browser probe's `--twice` exercises its disk.
import { expect, test } from "bun:test";
import { FrameRing } from "../../client/core/assets/frames.ts";
import type { AssetArrival, AssetPort } from "../../client/core/assets/port.ts";
import { Residency } from "../../client/core/assets/residency.ts";
import { SelfcheckProgress } from "../../client/core/selfcheck-report.ts";
import { SoundLibrary } from "../../client/core/sound/library.ts";
import { SoundPacket } from "../../client/core/sound/packet.ts";
import { MANIFEST_VERSION, parseManifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { stressSet } from "../../tools/pack/stress.ts";
import { builtSounds } from "../fixtures/sounds.ts";

/** A port that answers each request at once, whole, as a cache that holds `memory` of every request's bytes in memory and the rest on disk. */
class SplitCache implements AssetPort {
  readonly cache = { used: 0, limit: 0, mode: "disk" as const, filling: 0 };
  readonly protocol = "h2";
  private readonly files: readonly Uint8Array[];
  private readonly memory: number;
  private readonly done: AssetArrival[] = [];
  constructor(files: readonly Uint8Array[], memory: number) {
    this.files = files;
    this.memory = memory;
  }
  request(r: Parameters<AssetPort["request"]>[0]): void {
    const file = this.files[r.file]!;
    const parts = r.parts.map((p) => file.slice(p.offset, p.offset + p.length));
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (data.set(p, at), at + p.length), 0);
    const memory = Math.floor(data.length * this.memory);
    this.done.push({ slot: r.slot, generation: r.generation, data, fail: 0, fetched: 0, cached: data.length, memory, disk: data.length - memory });
  }
  cancel(): void {}
  fill(): void {}
  take(out: AssetArrival[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}

test("what comes from the cache is counted from memory and from disk apart, and the two still add up to what the cache gave", () => {
  const set = stressSet({ rocks: 4, detail: 4, plate: 64 });
  const port = new SplitCache(set.files.map((f) => f.bytes), 0.25);
  const r = new Residency(set.manifest, parsePack(set.files[0]!.bytes), port);
  const ring = new FrameRing();
  for (let f = 1; f <= 60; f++) {
    r.begin(f * 16);
    for (let m = 0; m < set.manifest.meshes.length; m++) r.want(m, 0, 1);
    r.end([], [], [], [], f * 16);
    ring.record(f * 16, 16, 1, 0, r, null);
  }
  const { cached, memory, disk, fetched } = r.stats;
  expect([cached > 0, memory + disk, fetched, Math.abs(memory - cached / 4) <= 4 * r.stats.requests]).toEqual([true, cached, 0, true]);
  const sum = (a: Float64Array): number => a.reduce((n, v) => n + v, 0);
  expect([sum(ring.cached), sum(ring.disk), sum(ring.bucketDisk)]).toEqual([cached, disk, disk]);
});

test("the sounds count what comes from memory and from disk apart too", () => {
  const made = builtSounds();
  const manifest = parseManifest(JSON.stringify({ version: MANIFEST_VERSION, files: [{ name: "boot", bytes: 0, role: "boot" }, { name: "sounds", bytes: made.file.length, role: "sound" }], boot: 0, clipHash: 0, meshes: [], sounds: made.sounds }));
  const lib = new SoundLibrary(manifest, new SplitCache([new Uint8Array(0), made.file], 0.5));
  const p = new SoundPacket();
  for (let now = 16; now < 1000; now += 16) {
    p.clear();
    lib.begin(now, p);
    for (let s = 0; s < lib.sounds.length; s++) lib.want(s, s + 1);
    lib.end(p);
  }
  expect([lib.stats.cached > 0, lib.stats.memory + lib.stats.disk, lib.stats.disk > 0]).toEqual([true, lib.stats.cached, true]);
});

test("the self-check waits for the disk to be still, and does not take it for still while the worker says writes are under way", () => {
  const p = new SelfcheckProgress();
  let at = -1;
  // What the disk keeps does not change, but writes go on until frame 150: the report waits 30 frames past it.
  for (let f = 0; f < 400 && at < 0; f++) if (p.advance(16, { used: 1000, writing: f < 150 ? 1 : 0 }, true, false, 0, true)) at = f;
  expect(at).toBe(150 + 29);
  // A port that says nothing of its writes is taken as it was: still once what it keeps stops changing, at frame 100.
  const q = new SelfcheckProgress();
  let bare = -1;
  for (let f = 0; f < 400 && bare < 0; f++) if (q.advance(16, { used: Math.min(f, 100) }, true, false, 0, true)) bare = f;
  expect(bare).toBe(100 + 30);
});
