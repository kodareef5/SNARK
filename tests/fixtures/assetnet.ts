// A network made of numbers, for the asset library: a delay, a rate, a share of requests that fail, and a seed.
// It serves parts of the files it is given, checks each against the hash asked for as the browser's worker will,
// and never delivers what was cancelled. The same seed and the same requests give the same arrivals.

import { FAIL_HASH, FAIL_NET, FAIL_RANGE, type AssetArrival, type AssetPort, type AssetRequest } from "../../client/core/assets/port.ts";
import { Rng } from "../../shared/rng.ts";
import { partHash } from "../../tools/pack/manifest.ts";

export interface NetOptions {
  /** Milliseconds before the first byte of an answer. */
  latencyMs?: number;
  /** Bytes a second, shared between the answers under way. */
  bytesPerSecond?: number;
  /** The share of requests that fail part way: 0 to 1. */
  loss?: number;
  seed?: number;
}

interface Transfer {
  request: AssetRequest;
  /** When its first byte comes, and the bytes still to come. */
  startsAt: number;
  left: number;
  /** A request that will fail does so when this many bytes are left. */
  failAt: number;
}

export class FakeNet implements AssetPort {
  readonly cache = { used: 0, limit: 0, mode: "none" as const, filling: 0 };
  /** Parts asked for with `fill`. */
  readonly filled: number[] = [];
  /** Every request and cancellation, in order, for comparing two runs. */
  readonly log: string[] = [];
  /** The most requests under way at once, and the slots cancelled. */
  mostAtOnce = 0;
  readonly cancelled = new Set<number>();
  loss: number;
  private readonly files: readonly Uint8Array[];
  private readonly latencyMs: number;
  private readonly rate: number;
  private readonly rng: Rng;
  private now = 0;
  private transfers: Transfer[] = [];
  private readonly done: AssetArrival[] = [];

  constructor(files: readonly Uint8Array[], opts: NetOptions = {}) {
    this.files = files;
    this.latencyMs = opts.latencyMs ?? 0;
    this.rate = opts.bytesPerSecond ?? Infinity;
    this.loss = opts.loss ?? 0;
    this.rng = new Rng(opts.seed ?? 1);
  }

  request(r: AssetRequest): void {
    const bytes = r.parts.reduce((sum, p) => sum + p.length, 0);
    this.log.push(`${Math.round(this.now)} ask ${r.slot} ${r.priority.toFixed(4)}${r.fresh ? " fresh" : ""}`);
    this.cancelled.delete(r.slot);
    this.transfers.push({ request: r, startsAt: this.now + this.latencyMs, left: bytes, failAt: this.rng.float() < this.loss ? Math.floor(bytes * this.rng.float()) : -1 });
    this.mostAtOnce = Math.max(this.mostAtOnce, this.transfers.length);
  }

  fill(parts: readonly { file: number; part: { offset: number; length: number; hash: string } }[]): void {
    for (const p of parts) this.filled.push(p.part.length);
  }

  cancel(slot: number): void {
    this.log.push(`${Math.round(this.now)} cancel ${slot}`);
    this.cancelled.add(slot);
    this.transfers = this.transfers.filter((t) => t.request.slot !== slot);
  }

  /** Moves the network on to `nowMs`. */
  advance(nowMs: number): void {
    const dt = nowMs - this.now;
    this.now = nowMs;
    const running = this.transfers.filter((t) => t.startsAt <= nowMs);
    const each = running.length === 0 ? 0 : (this.rate * dt) / 1000 / running.length;
    for (const t of running) {
      const file = this.files[t.request.file]!;
      const part = t.request.parts[0]!;
      // A range that starts past the end of the file is refused at once, as a server answers 416.
      if (part.offset >= file.length) {
        this.finish(t, null, FAIL_RANGE, 0);
        continue;
      }
      t.left -= each;
      if (t.failAt >= 0 && t.left <= t.failAt) this.finish(t, null, FAIL_NET, 0);
      else if (t.left <= 0) {
        const data = file.slice(part.offset, part.offset + part.length);
        // A range that runs off the end comes back short.
        if (data.length < part.length) this.finish(t, null, FAIL_NET, data.length);
        else if (part.hash !== "" && partHash(data) !== part.hash) this.finish(t, null, FAIL_HASH, data.length);
        else this.finish(t, data, 0, data.length);
      }
    }
  }

  private finish(t: Transfer, data: Uint8Array | null, fail: number, fetched: number): void {
    this.transfers = this.transfers.filter((x) => x !== t);
    this.done.push({ slot: t.request.slot, data, fail, fetched, cached: 0 });
  }

  take(out: AssetArrival[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
