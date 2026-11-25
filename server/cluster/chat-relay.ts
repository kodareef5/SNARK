// Global chat across the maps of a cluster. The worlds share only the folder, so each appends the global lines said on it to a
// file of its own there, and reads what is new in the others' twice a second.
//
//   chat/<world>.jsonl       one line of JSON for each line said (RelayLine), appended
//   chat/<world>.old.jsonl   that file as it was when it was started again
//
// A line is known by its writer's start, a random name each relay takes when it is made, and its count within that start. A
// reader keeps the highest count it has seen of each start, so a line read twice is shown once: after the file starts again,
// after its writer starts again, or after a read that went back. The wall time alone would not do: two lines can share a
// millisecond, and a clock can be set back.

import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, mkdirSync, openSync, readSync, readdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHAT_RUNS_MOST, type TextRun } from "../../shared/net/chat.ts";

/** A line as it lies in a world's file. */
export interface RelayLine {
  /** Counts the lines of this start, from 0. */
  seq: number;
  /** The writer's start: random, new each time a relay is made. */
  start: string;
  /** Wall clock, milliseconds, when it was said. */
  at: number;
  world: number;
  speaker: string;
  /** As the other maps show it. */
  runs: TextRun[];
}

export interface ChatRelayOptions {
  /** The cluster's folder. */
  root: string;
  /** This world's id in the cluster. */
  world: number;
  /** Wall clock, milliseconds. */
  now: () => number;
  /** Told each new line from another world, once. */
  onLine: (line: RelayLine) => void;
  /** Told why the folder could not be read or written, at most once a minute. */
  say?: (text: string) => void;
  /** A file of this size or more is started again before the next line. */
  restartBytes?: number;
}

/** The least time between two reads of the other worlds' files. */
export const POLL_MS = 500;
/** A line read this long after it was said is dropped: its world's news is old, or this one's tick was held up. */
export const STALE_MS = 10_000;
/** The folder is listed for new worlds' files when it changes, and this often anyway, for a file system slow to say so. */
const LIST_MS = 5_000;
const RESTART_BYTES = 1 << 20;
/** The most bytes read from one file in one poll. More than that is a flood or a long stall, and its start is skipped. */
const READ_MOST = 256 * 1024;
const LINE_MOST = 8 * 1024;
const STARTS_KEPT = 8;
const NEWLINE = 10;
const FILE = /^(\d+)\.jsonl$/;

interface Peer {
  world: number;
  path: string;
  old: string;
  ino: number;
  /** Bytes of whole lines read so far in the file `ino` names. */
  offset: number;
  /** The read began mid-file: what comes before the first line's end is part of a line. */
  resync: boolean;
  /** The highest count seen of each start, the latest last. */
  seen: Map<string, number>;
}

export class ChatRelay {
  readonly world: number;
  /** This relay's start, put in every line it writes. */
  readonly start = randomBytes(8).toString("hex");
  private readonly dir: string;
  private readonly own: string;
  private readonly ownOld: string;
  private readonly now: () => number;
  private readonly onLine: (line: RelayLine) => void;
  private readonly say: (text: string) => void;
  private readonly restartBytes: number;
  private readonly peers = new Map<number, Peer>();
  private seq = 0;
  /** The size of this world's file. */
  private written = 0;
  private polledAt = -Infinity;
  private listedAt = -Infinity;
  private listedMtime = -1;
  private failedAt = -Infinity;

  constructor(opts: ChatRelayOptions) {
    this.world = opts.world;
    this.dir = join(opts.root, "chat");
    this.own = join(this.dir, `${opts.world}.jsonl`);
    this.ownOld = join(this.dir, `${opts.world}.old.jsonl`);
    this.now = opts.now;
    this.onLine = opts.onLine;
    this.say = opts.say ?? (() => {});
    this.restartBytes = opts.restartBytes ?? RESTART_BYTES;
    try {
      mkdirSync(this.dir, { recursive: true });
      this.written = sizeOf(this.own);
      // A line the last run left half written is ended, so the next line does not join it.
      if (this.written > 0 && lastByte(this.own, this.written) !== NEWLINE) {
        appendFileSync(this.own, "\n");
        this.written++;
      }
    } catch (err) {
      this.fail(err);
    }
    // What the others said before this relay started is not shown.
    this.list(true);
    this.listedAt = this.now();
  }

  /** Appends a global line said here to this world's file. False if the folder could not be written. */
  send(speaker: string, runs: readonly TextRun[]): boolean {
    const line: RelayLine = { seq: this.seq, start: this.start, at: this.now(), world: this.world, speaker, runs: runs.map((r) => (r.ink === undefined ? { text: r.text } : { text: r.text, ink: r.ink })) };
    const text = `${JSON.stringify(line)}\n`;
    try {
      if (this.written >= this.restartBytes) {
        try {
          renameSync(this.own, this.ownOld);
        } catch (err) {
          if ((err as { code?: string }).code !== "ENOENT") throw err;
        }
        this.written = 0;
      }
      try {
        appendFileSync(this.own, text);
      } catch (err) {
        if ((err as { code?: string }).code !== "ENOENT") throw err;
        mkdirSync(this.dir, { recursive: true });
        appendFileSync(this.own, text);
      }
      this.written += Buffer.byteLength(text);
      this.seq++;
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  /** Every tick. At most once in POLL_MS, hands each new line of the other worlds to `onLine`. Returns how many it handed. */
  poll(now = this.now()): number {
    if (now - this.polledAt < POLL_MS) return 0;
    this.polledAt = now;
    if (now - this.listedAt >= LIST_MS || this.folderMtime() !== this.listedMtime) {
      this.listedAt = now;
      this.list(false);
    }
    let n = 0;
    for (const p of this.peers.values()) {
      try {
        n += this.read(p, now);
      } catch (err) {
        this.fail(err);
      }
    }
    return n;
  }

  /** Finds the other worlds' files. A file there at the start is read from its end, and one that came later from its beginning. */
  private list(atStart: boolean): void {
    let names: string[];
    try {
      this.listedMtime = this.folderMtime();
      names = readdirSync(this.dir);
    } catch (err) {
      if ((err as { code?: string }).code !== "ENOENT") this.fail(err);
      return;
    }
    for (const name of names) {
      const m = FILE.exec(name);
      const world = m ? Number(m[1]) : this.world;
      if (world === this.world || this.peers.has(world)) continue;
      const path = join(this.dir, name);
      try {
        const st = statSync(path);
        this.peers.set(world, { world, path, old: join(this.dir, `${world}.old.jsonl`), ino: st.ino, offset: atStart ? st.size : 0, resync: false, seen: new Map() });
      } catch {
        // Gone again: the next listing finds it if it comes back.
      }
    }
  }

  private folderMtime(): number {
    try {
      return statSync(this.dir).mtimeMs;
    } catch {
      return -1;
    }
  }

  private read(p: Peer, now: number): number {
    let st;
    try {
      st = statSync(p.path);
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return 0;
      throw err;
    }
    let n = 0;
    if (st.size < p.offset || (p.ino !== 0 && st.ino !== 0 && st.ino !== p.ino)) {
      n += this.finishOld(p, now);
      p.ino = st.ino;
      p.offset = 0;
      p.resync = false;
    }
    if (st.size > p.offset) n += this.take(p, p.path, st.size, now);
    return n;
  }

  /** The writer started its file again: the rest of the file it moved aside is read first. */
  private finishOld(p: Peer, now: number): number {
    try {
      const old = statSync(p.old);
      const same = p.ino !== 0 && old.ino !== 0 ? old.ino === p.ino : old.size >= p.offset;
      return same && old.size > p.offset ? this.take(p, p.old, old.size, now) : 0;
    } catch {
      return 0;
    }
  }

  /** Reads `path` from the peer's offset to `size` and hands on its whole lines. A line not yet ended waits. */
  private take(p: Peer, path: string, size: number, now: number): number {
    let from = p.offset;
    if (size - from > READ_MOST) {
      from = size - READ_MOST;
      p.resync = true;
    }
    const buf = Buffer.alloc(size - from);
    const fd = openSync(path, "r");
    try {
      for (let got = 0; got < buf.length; ) {
        const k = readSync(fd, buf, got, buf.length - got, from + got);
        if (k === 0) break;
        got += k;
      }
    } finally {
      closeSync(fd);
    }
    let begin = 0;
    if (p.resync) {
      begin = buf.indexOf(NEWLINE) + 1;
      if (begin === 0) {
        p.offset = from;
        return 0;
      }
      p.resync = false;
    }
    const end = buf.lastIndexOf(NEWLINE) + 1;
    p.offset = from + Math.max(begin, end);
    if (end <= begin) return 0;
    let n = 0;
    for (const text of buf.toString("utf8", begin, end - 1).split("\n")) {
      const line = text.length > LINE_MOST ? null : parse(text, p.world);
      if (!line) continue;
      const last = p.seen.get(line.start);
      if (last !== undefined && line.seq <= last) continue;
      p.seen.delete(line.start);
      p.seen.set(line.start, line.seq);
      if (p.seen.size > STARTS_KEPT) p.seen.delete(p.seen.keys().next().value!);
      if (now - line.at > STALE_MS) continue;
      try {
        this.onLine(line);
        n++;
      } catch (err) {
        this.fail(err);
      }
    }
    return n;
  }

  private fail(err: unknown): void {
    const now = this.now();
    if (now - this.failedAt < 60_000) return;
    this.failedAt = now;
    try {
      this.say(`the cluster's chat in ${this.dir} failed: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      // The log is not the tick's to fail.
    }
  }
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return 0;
    throw err;
  }
}

function lastByte(path: string, size: number): number {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(1);
    return readSync(fd, b, 0, 1, size - 1) === 1 ? b[0]! : NEWLINE;
  } finally {
    closeSync(fd);
  }
}

/** A line of a world's file, or null if it is not one that world wrote. */
function parse(text: string, world: number): RelayLine | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const l = v as Record<string, unknown>;
  const { seq, start, at, speaker, runs } = l;
  if (!Number.isSafeInteger(seq) || (seq as number) < 0 || typeof start !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null;
  if (l.world !== world || typeof speaker !== "string" || speaker === "" || !Array.isArray(runs) || runs.length === 0 || runs.length > CHAT_RUNS_MOST) return null;
  const out: TextRun[] = [];
  for (const r of runs as unknown[]) {
    if (typeof r !== "object" || r === null) return null;
    const { text: t, ink } = r as Record<string, unknown>;
    if (typeof t !== "string") return null;
    if (ink === undefined) out.push({ text: t });
    else if (Number.isInteger(ink) && (ink as number) >= 0 && (ink as number) <= 0xffffff) out.push({ text: t, ink: ink as number });
    else return null;
  }
  return { seq: seq as number, start, at, world, speaker, runs: out };
}
