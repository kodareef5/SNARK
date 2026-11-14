// A network made of numbers, for the asset library: a delay, a rate, a share of requests that fail, and a seed.
// It serves parts of the files it is given, one or several to a request, checks each against the hash asked for as
// the browser's worker will, and never delivers what was cancelled. Asked to, it keeps the parts it has delivered as
// the worker does. The same seed and the same requests give the same arrivals.

import { FAIL_HASH, FAIL_NET, FAIL_RANGE, type AssetArrival, type AssetPart, type AssetPort, type AssetRequest } from "../../client/core/assets/port.ts";
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
  /** Keeps every part delivered. Asked for again, a kept part comes with the next answer and costs the link nothing. */
  keep?: boolean;
}

interface Transfer {
  request: AssetRequest;
  /** The parts that come over the link. The others are kept ones. */
  link: AssetPart[];
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
  /** Every request and cancellation, in order, for comparing two runs. A request for several parts says how many. */
  readonly log: string[] = [];
  /** How many times each part has come whole over the link, by file and offset. */
  readonly over = new Map<string, number>();
  /** The most requests under way at once, and the slots cancelled. */
  mostAtOnce = 0;
  readonly cancelled = new Set<number>();
  loss: number;
  private readonly files: readonly Uint8Array[];
  private readonly latencyMs: number;
  private readonly rate: number;
  private readonly rng: Rng;
  private readonly kept: Set<string> | null;
  private now = 0;
  private transfers: Transfer[] = [];
  private readonly done: AssetArrival[] = [];

  constructor(files: readonly Uint8Array[], opts: NetOptions = {}) {
    this.files = files;
    this.latencyMs = opts.latencyMs ?? 0;
    this.rate = opts.bytesPerSecond ?? Infinity;
    this.loss = opts.loss ?? 0;
    this.rng = new Rng(opts.seed ?? 1);
    this.kept = opts.keep ? new Set() : null;
  }

  request(r: AssetRequest): void {
    const link = r.parts.filter((p) => r.fresh || !this.kept?.has(`${r.file}:${p.offset}`));
    const bytes = link.reduce((sum, p) => sum + p.length, 0);
    this.log.push(`${Math.round(this.now)} ask ${r.slot} ${r.priority.toFixed(4)}${r.parts.length > 1 ? ` x${r.parts.length}` : ""}${r.fresh ? " fresh" : ""}`);
    this.cancelled.delete(r.slot);
    // What is all kept does not touch the link, so it neither waits nor fails.
    const failAt = link.length > 0 && this.rng.float() < this.loss ? Math.floor(bytes * this.rng.float()) : -1;
    this.transfers.push({ request: r, link, startsAt: this.now + (link.length > 0 ? this.latencyMs : 0), left: bytes, failAt });
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
      const parts = t.request.parts;
      // A range that starts past the end of the file is refused at once, as a server answers 416.
      if (parts.some((p) => p.offset >= file.length)) {
        this.finish(t, null, FAIL_RANGE, 0);
        continue;
      }
      t.left -= each;
      if (t.failAt >= 0 && t.left <= t.failAt) this.finish(t, null, FAIL_NET, 0);
      else if (t.left <= 0) {
        let data = file.slice(parts[0]!.offset, parts[0]!.offset + parts[0]!.length);
        if (parts.length > 1) {
          // Several parts come as one run of bytes, in the order asked.
          data = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
          let at = 0;
          for (const p of parts) {
            const part = file.subarray(p.offset, p.offset + p.length);
            data.set(part, at);
            at += part.length;
          }
          if (at < data.length) data = data.subarray(0, at);
        }
        const whole = parts.reduce((sum, p) => sum + p.length, 0);
        const linked = t.link.reduce((sum, p) => sum + p.length, 0);
        const wrong = (): boolean => {
          let at = 0;
          return parts.some((p) => p.hash !== "" && partHash(data.subarray(at, (at += p.length))) !== p.hash);
        };
        // A range that runs off the end comes back short.
        if (data.length < whole) this.finish(t, null, FAIL_NET, data.length);
        else if (wrong()) this.finish(t, null, FAIL_HASH, linked);
        else {
          for (const p of t.link) this.over.set(`${t.request.file}:${p.offset}`, (this.over.get(`${t.request.file}:${p.offset}`) ?? 0) + 1);
          for (const p of parts) this.kept?.add(`${t.request.file}:${p.offset}`);
          this.finish(t, data, 0, linked, whole - linked);
        }
      }
    }
  }

  private finish(t: Transfer, data: Uint8Array | null, fail: number, fetched: number, cached = 0): void {
    this.transfers = this.transfers.filter((x) => x !== t);
    this.done.push({ slot: t.request.slot, data, fail, fetched, cached });
  }

  take(out: AssetArrival[]): number {
    const n = this.done.length;
    for (let i = 0; i < n; i++) out[i] = this.done[i]!;
    this.done.length = 0;
    return n;
  }
}
