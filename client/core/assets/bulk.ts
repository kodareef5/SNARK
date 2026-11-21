// The bulk fill: every part the player may ask the game to keep, and the order the asset worker
// (client/assets/assets-worker.ts) fetches the missing ones in. The worker does the fetching and the disk; this file
// decides what comes next, what a failure costs and when to stop. It is here, apart from the worker, so Bun can test it.

import type { AssetPart } from "./port.ts";

/** A part named to keep, and the file it is in. */
export interface KeepPart {
  url: string;
  part: AssetPart;
}

/** What the worker reports of the parts named to keep. Bytes are as stored. */
export interface KeepReport {
  /** KEEP_ number: whether the player asked for them, and whether the fill is paused. */
  mode: number;
  /** The parts named, after those named twice, and their bytes. */
  parts: number;
  bytes: number;
  /** Of those, the ones not on disk, and their bytes. */
  missing: number;
  missingBytes: number;
  /** Set when the fill stopped because what it keeps would pass the disk's limit. */
  capped: boolean;
}

/** Nobody asked; fetch what is missing and keep it; asked, but paused. */
export const KEEP_OFF = 0;
export const KEEP_ON = 1;
export const KEEP_PAUSED = 2;
/** Runs fetched at once. */
export const FILL_LANES = 2;
/** A run is parts that follow one another in a file, as many bytes as the last run brought in about a second, within these. */
export const FILL_FEWEST = 256 * 1024;
export const FILL_MOST = 4 * 1024 * 1024;
/** Each part may fail this many times in a visit before the fill gives it up. */
export const FILL_TRIES = 3;
/** A run starts only once the game's own requests have all been answered for this long. */
export const QUIET_MS = 250;

export class BulkFill {
  /** Every part named, by hash: a part the files hold twice is kept once. */
  readonly named = new Map<string, KeepPart>();
  bytes = 0;
  mode = KEEP_OFF;
  capped = false;
  /** Runs under way. */
  running = 0;
  /** Bytes a run is made of: about what the last one brought in a second. */
  pace = 1024 * 1024;
  private line: KeepPart[] = [];
  private readonly tries = new Map<string, number>();
  /** When the game's last request ended, in ms. */
  private quietAt = -Infinity;

  /** The game's request ended at `now`. */
  quiet(now: number): void {
    this.quietAt = now;
  }

  /**
   * Whether a run may start at `now` while `requests` of the game's are under way: -1 not until they end, else the ms
   * still to wait, 0 for at once. Play comes first: a run starts only once the game has asked for nothing for QUIET_MS.
   */
  wait(now: number, requests: number): number {
    return requests > 0 ? -1 : Math.max(0, this.quietAt + QUIET_MS - now);
  }

  /** Forgets every part named, for a new set: the tier or the textures' variant changed. */
  reset(): void {
    this.named.clear();
    this.bytes = 0;
    this.line = [];
    this.tries.clear();
    this.capped = false;
  }

  /** Adds parts to the set. While keeping, they join the line. */
  name(parts: readonly KeepPart[]): void {
    for (const p of parts) {
      if (this.named.has(p.part.hash)) continue;
      this.named.set(p.part.hash, p);
      this.bytes += p.part.length;
      if (this.mode === KEEP_ON) this.line.push(p);
    }
  }

  /** A new KEEP_ mode. Turned on, every part named is in line again, and those given up are tried again. */
  setMode(mode: number): void {
    if (mode === KEEP_ON && this.mode !== KEEP_ON) {
      this.line = [...this.named.values()];
      this.tries.clear();
    }
    if (mode !== KEEP_ON) this.line = [];
    this.mode = mode;
    this.capped = false;
  }

  /** Whether the disk should keep this part over others when it makes room: the player asked for it. */
  pinned(hash: string): boolean {
    return this.mode !== KEEP_OFF && this.named.has(hash);
  }

  report(has: (hash: string) => boolean): KeepReport {
    let missing = 0, missingBytes = 0;
    for (const [hash, p] of this.named) {
      if (has(hash)) continue;
      missing++;
      missingBytes += p.part.length;
    }
    return { mode: this.mode, parts: this.named.size, bytes: this.bytes, missing, missingBytes, capped: this.capped };
  }

  /**
   * The next run to fetch, or null for none: parts in line that are not on disk and follow one another in one file, as
   * many bytes as `pace` and as the disk has room for under `limit` beside the parts of the set it holds. Where the next
   * part does not fit there, the fill stops and `capped` is set.
   */
  next(has: (hash: string) => boolean, limit: number): KeepPart[] | null {
    if (this.mode !== KEEP_ON) return null;
    while (this.line.length > 0 && has(this.line[0]!.part.hash)) this.line.shift();
    const first = this.line[0];
    if (!first) return null;
    const report = this.report(has), room = limit - (report.bytes - report.missingBytes), most = Math.min(this.pace, room);
    if (first.part.length > room) {
      this.capped = true;
      return null;
    }
    const run = [this.line.shift()!];
    let bytes = first.part.length;
    for (let next = this.line[0]; next; next = this.line[0]) {
      const last = run[run.length - 1]!.part;
      if (next.url !== first.url || next.part.offset !== last.offset + last.length || has(next.part.hash) || bytes + next.part.length > most) break;
      run.push(this.line.shift()!);
      bytes += next.part.length;
    }
    this.running++;
    return run;
  }

  /**
   * A run has ended: `kept[k]` is whether its part k is on disk now, `ms` how long it took and `fetched` the bytes that
   * came. A part not kept goes to the back of the line until it has failed FILL_TRIES times, or at once without a try
   * spent where `own` is false: the disk failed, not the part. Returns how many parts were given up.
   */
  ended(run: readonly KeepPart[], kept: readonly boolean[], ms: number, fetched: number, own = true): number {
    this.running--;
    if (fetched > 0 && ms > 0) this.pace = Math.max(FILL_FEWEST, Math.min(FILL_MOST, Math.round(fetched / (ms / 1000))));
    let lost = 0;
    run.forEach((p, k) => {
      if (kept[k]) return void this.tries.delete(p.part.hash);
      const tries = (this.tries.get(p.part.hash) ?? 0) + (own ? 1 : 0);
      this.tries.set(p.part.hash, tries);
      if (tries >= FILL_TRIES) lost++;
      else if (this.mode === KEEP_ON) this.line.push(p);
    });
    return lost;
  }
}
