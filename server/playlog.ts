// A development world's record of play (server/main.ts --dev). A page sends what it measured of itself every few seconds
// (client/core/diagnostics.ts PlayReport); each report is written as one line of JSON beside what this server knows of
// the same session over the same ticks: the inputs it had to repeat or go without and when each came, the margin it
// reported, what it sent and what waited behind the socket, and how late and how long its own ticks ran.
// tools/play.ts reads the lines.

import { TICK_RATE } from "../shared/coords.ts";
import { INPUT_WINDOW, MARGIN_UNKNOWN } from "../shared/net/protocol.ts";
import type { Client, GameServer } from "./game.ts";

/** Ticks kept of each session and of the loop, for a report to come and settle in. */
const KEPT = 1024;
/**
 * Ticks after a tick that its input's arrival is read: an input later than this is taken as never come. Client.arrived
 * holds INPUT_WINDOW ticks, so a later input's takes its place only on a clock that many ticks less this ahead.
 */
const ARRIVAL_TICKS = 12;
/** A report is written once the server has stepped this many ticks past the last it covers. */
const SETTLE = ARRIVAL_TICKS + 2;
/** Reports waiting to be written, at most. */
const WAITING = 64;
/** A tick of the server's this many ms late, or longer than its share of a second, is listed. */
const LATE_MS = 50;
const LONG_MS = 1000 / TICK_RATE;
/** Ticks of each sort a line lists, at most. */
const LISTED = 64;
/** The longest report taken, in bytes. */
export const REPORT_BYTES_MAX = 65536;

/** What a connection can say of itself: bytes it gave its socket, messages it skipped for the backlog, and bytes waiting. */
interface Counted {
  bytesSent?: number;
  skipped?: number;
  buffered?: number;
}

/** One session's ticks, in a ring by tick. */
class Ticks {
  /** Which tick a slot holds. */
  readonly tick = new Int32Array(KEPT).fill(-1);
  /** Ticks since the newest input it had stepped with: 0 where the tick's own input was there, 255 for none yet since it joined. */
  readonly since = new Uint8Array(KEPT);
  /** The tick its input arrived on, -1 for not by ARRIVAL_TICKS after it, -2 not yet read. */
  readonly arrived = new Int32Array(KEPT);
  readonly margin = new Int8Array(KEPT);
  readonly snapshot = new Uint8Array(KEPT);
  readonly sent = new Float64Array(KEPT);
  readonly skipped = new Float64Array(KEPT);
  readonly buffered = new Uint32Array(KEPT);
  readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }
}

interface Waiting {
  ticks: Ticks;
  report: Record<string, unknown>;
  from: number;
  to: number;
}

export class PlayLog {
  private readonly sessions = new Map<number, Ticks>();
  private readonly waiting: Waiting[] = [];
  /** The loop's ring: which tick, how many ms late it began and how long it ran, and ticks given up just before it. */
  private readonly loopTick = new Int32Array(KEPT).fill(-1);
  private readonly late = new Float32Array(KEPT);
  private readonly long = new Float32Array(KEPT);
  private readonly given = new Uint16Array(KEPT);
  private dropped = 0;

  private readonly game: GameServer;
  private readonly write: (line: string) => void;
  private readonly clock: () => number;

  /** `write` takes each line; `clock` names when it was written, in ms since 1970. */
  constructor(game: GameServer, write: (line: string) => void, clock: () => number = () => Date.now()) {
    this.game = game;
    this.write = write;
    this.clock = clock;
  }

  /**
   * After each tick: when the loop meant to run it, when it began and when it ended, in ms of one clock, and how many more
   * ticks the loop owed as it began, which the margin is told against (server/game.ts).
   */
  ticked(due: number, began: number, ended: number, behind = 0): void {
    const T = this.game.world.tick, k = T % KEPT;
    this.loopTick[k] = T;
    this.late[k] = began - due;
    this.long[k] = ended - began;
    this.given[k] = Math.min(0xffff, this.dropped);
    this.dropped = 0;
    for (const c of this.game.clients) {
      if (!c?.active || c.closed) continue;
      let s = this.sessions.get(c.id);
      if (s?.client !== c) this.sessions.set(c.id, (s = new Ticks(c)));
      s.tick[k] = T;
      s.since[k] = c.inputAt === 0 ? 255 : Math.min(254, T - c.inputAt);
      s.arrived[k] = -2;
      s.margin[k] = c.newestInput === 0 ? MARGIN_UNKNOWN : Math.max(-127, Math.min(127, c.newestInput - T - behind));
      s.snapshot[k] = c.lastSnapshot === T ? 1 : 0;
      const conn = c.conn as Counted;
      s.sent[k] = conn.bytesSent ?? 0;
      s.skipped[k] = conn.skipped ?? 0;
      s.buffered[k] = conn.buffered ?? 0;
      const t = T - ARRIVAL_TICKS, j = ((t % KEPT) + KEPT) % KEPT;
      if (s.tick[j] === t) {
        const at = c.arrived[t & (INPUT_WINDOW - 1)]!;
        s.arrived[j] = at >= t - INPUT_WINDOW && at <= T ? at : -1;
      }
    }
    for (let i = 0; i < this.waiting.length; i++) {
      const w = this.waiting[i]!;
      if (T < w.to + SETTLE && !w.ticks.client.closed && w.ticks.client.active) continue;
      this.waiting.splice(i--, 1);
      this.write(JSON.stringify({ at: new Date(this.clock()).toISOString(), slot: w.ticks.client.id, page: w.report, server: this.view(w.ticks, w.from, w.to) }));
    }
  }

  /** The loop gave up `ticks` ticks that were due. */
  drop(ticks: number): void {
    this.dropped += ticks;
  }

  /** A page's report: "" once it is taken to be written, else why it is not. */
  report(text: string): string {
    if (text.length > REPORT_BYTES_MAX) return "too long";
    let report: unknown;
    try {
      report = JSON.parse(text);
    } catch {
      return "not JSON";
    }
    const r = report as { name?: unknown; from?: unknown; to?: unknown };
    if (typeof report !== "object" || report === null || typeof r.name !== "string" || typeof r.from !== "number" || typeof r.to !== "number" || !(r.to >= r.from) || r.to - r.from > KEPT) return "not a report";
    // A page sends its last report as its socket closes, and the session may be gone by the time it comes.
    let ticks: Ticks | undefined;
    for (const t of this.sessions.values()) if (t.client.name === r.name && (!ticks || (t.client.active && !t.client.closed))) ticks = t;
    if (!ticks) return "no session of that name has played here";
    if (this.waiting.length >= WAITING) return "too many waiting";
    // A snapshot is compared some ticks after the inputs of its tick were sampled, so what the server knows is told from
    // the earliest snapshot a correction of the report was compared from.
    let from = r.from;
    const corrections = (report as { corrections?: unknown }).corrections;
    if (Array.isArray(corrections)) for (const c of corrections) if (typeof c?.since === "number" && c.since >= r.from - KEPT / 4) from = Math.min(from, c.since - 1);
    this.waiting.push({ ticks, report: report as Record<string, unknown>, from, to: r.to });
    return "";
  }

  /** What this server knows of a session's ticks after `from` up to `to`. */
  private view(s: Ticks, from: number, to: number) {
    let ticks = 0, snapshots = 0, guessed = 0, longest = 0, lo = 127, hi = -127, leadLo = 127, leadHi = -127, most = 0, worstLate = 0, worstLong = 0, given = 0;
    let sent = -1, sentTo = 0, skipped = -1, skippedTo = 0;
    const guesses: [number, number, number | null][] = [], loop: [number, number, number, number][] = [];
    for (let t = from + 1; t <= to; t++) {
      const k = t % KEPT;
      if (this.loopTick[k] === t) {
        const late = this.late[k]!, long = this.long[k]!;
        worstLate = Math.max(worstLate, late);
        worstLong = Math.max(worstLong, long);
        given += this.given[k]!;
        if ((late > LATE_MS || long > LONG_MS || this.given[k]! > 0) && loop.length < LISTED) loop.push([t, Math.round(late), Math.round(long), this.given[k]!]);
      }
      if (s.tick[k] !== t) continue;
      ticks++;
      snapshots += s.snapshot[k]!;
      if (s.margin[k] !== MARGIN_UNKNOWN) {
        lo = Math.min(lo, s.margin[k]!);
        hi = Math.max(hi, s.margin[k]!);
      }
      most = Math.max(most, s.buffered[k]!);
      if (sent < 0) {
        sent = s.sent[k]!;
        skipped = s.skipped[k]!;
      }
      sentTo = s.sent[k]!;
      skippedTo = s.skipped[k]!;
      const at = s.arrived[k]!;
      if (s.since[k]! > 0) {
        if (s.since[k]! < 255) {
          guessed++;
          longest = Math.max(longest, s.since[k]!);
        }
        if (guesses.length < LISTED) guesses.push([t, s.since[k]!, at >= 0 ? t - at : null]);
      } else if (at >= 0) {
        leadLo = Math.min(leadLo, t - at);
        leadHi = Math.max(leadHi, t - at);
      }
    }
    return {
      ticks, snapshots, skipped: Math.max(0, skippedTo - skipped), bytes: Math.max(0, sentTo - sent), waiting: most,
      margin: lo > hi ? null : [lo, hi], lead: leadLo > leadHi ? null : [leadLo, leadHi],
      guessed, longest, guesses, late: Math.round(worstLate), long: Math.round(worstLong), given, loop,
    };
  }
}
