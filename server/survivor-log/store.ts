// The survivor log on disk: a folder beside the save of segment files, each one SQLite file holding a span of wall time.
// The newest is written and the oldest is deleted whole when the folder passes its cap. Every segment begins with what
// it needs to be read alone: who was online, since when, in which tribe and holding what. A server run always starts a
// segment of its own, so within one segment the tick only goes up.
// One LogStore owns a folder. A running server keeps it on a worker thread (worker.ts), where the reads run too.

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { decodeAct } from "../../shared/acts.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import type { LogChange, LogChanges, LogHeld, LogHolder, LogHolding, LogItem, LogMark, LogMarks, LogPositions, LogSession, LogSpan, LogSurvivor, LogTrack } from "../../shared/survivor-log.ts";
import { sqliteCode, sqliteIs } from "../persist/store.ts";
import { Cursor, SEGMENT_NAME, conditionOf, keyBlueprint, keyItem, keyQuality, packPairs, seatOf, segmentName, unpackPairs } from "./format.ts";
import { EV_HELD, EV_START, EV_STOP, EV_TEAM, type Batch, type LogEvent } from "./recorder.ts";

/** Bumped whenever a table changes. A segment of another is deleted as it is found. */
export const SEGMENT_FORMAT = 1;
/** A survivor's whole inventory is written again after this many changes, so reading one back replays fewer than this. */
export const FULL_EVERY = 64;
/** The most step times one read of positions answers. A longer window is given a longer step. */
export const MAX_STEPS = 4000;
/**
 * The most points one read of everyone's positions answers: the steps times the survivors online in the window. It bounds
 * what the answer costs the thread that receives it, the tick's.
 */
export const MAX_POINTS = 100_000;
/** The most changes or journal entries one read lists. */
export const MAX_ENTRIES = 10000;
/** Milliseconds: the shortest step a read of positions takes. */
export const MIN_STEP = 100;
/** Read connections kept open to segments no longer written. */
const KEEP_OPEN = 32;

// A row of `sessions` is one stint of one survivor in one segment: `began` is when its session began, `since` when the
// stint began (the session's start or a change of tribe), `start` when this row begins (`since`, or the segment's start
// for a stint carried over). `stop` is null while it runs; `why` is "continued" where the next segment carries it on.
// `held` is one span of one survivor holding some of one item key, with the most it held.
const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value) WITHOUT ROWID;
  CREATE TABLE names (idx INTEGER PRIMARY KEY, id TEXT NOT NULL);
  CREATE TABLE subjects (idx INTEGER PRIMARY KEY, pid INTEGER NOT NULL, name TEXT NOT NULL);
  CREATE TABLE frames (wall INTEGER PRIMARY KEY, tick INTEGER NOT NULL, end_wall INTEGER NOT NULL, end_tick INTEGER NOT NULL, data BLOB NOT NULL);
  CREATE INDEX frames_tick ON frames (tick);
  CREATE TABLE sessions (pid INTEGER NOT NULL, name TEXT NOT NULL, began INTEGER NOT NULL, began_tick INTEGER NOT NULL, since INTEGER NOT NULL, since_tick INTEGER NOT NULL, start INTEGER NOT NULL, stop INTEGER, stop_tick INTEGER, why TEXT NOT NULL, team INTEGER NOT NULL, tribe TEXT NOT NULL);
  CREATE INDEX sessions_pid ON sessions (pid, start);
  CREATE TABLE inventories (pid INTEGER NOT NULL, wall INTEGER NOT NULL, tick INTEGER NOT NULL, full INTEGER NOT NULL, data BLOB NOT NULL);
  CREATE INDEX inventories_pid ON inventories (pid, wall);
  CREATE TABLE held (key INTEGER NOT NULL, pid INTEGER NOT NULL, start INTEGER NOT NULL, stop INTEGER, most INTEGER NOT NULL);
  CREATE INDEX held_key ON held (key, start);
`;

/** What the store is told of the world it logs. Journal ops and the words for causes of death come from the server. */
export interface LogWorld {
  saveId: string;
  mapId: string;
  world: number;
  opAdmin: number;
  /** The journal's other ops that are acts too: a staff member's and the open commands'. Left out where there are none. */
  opActs?: readonly number[];
  opDeath: number;
  causes: readonly string[];
}

interface Segment {
  readonly file: string;
  readonly startWall: number;
  readonly startTick: number;
  endWall: number;
  endTick: number;
  bytes: number;
  sql: Database | null;
  dict: Dict | null;
}

interface Dict {
  names: Map<number, string>;
  ids: Map<string, number>;
  who: Map<number, { pid: number; name: string }>;
  idxOf: Map<number, number>;
}

/** A survivor online, as the store needs to carry it into the next segment. */
interface Live {
  pid: number;
  name: string;
  began: number;
  beganTick: number;
  since: number;
  sinceTick: number;
  team: number;
  tribe: string;
  held: Map<number, number>;
  sinceFull: number;
  row: number;
  spans: Map<number, { row: number; most: number }>;
}

interface FrameRow {
  wall: number;
  tick: number;
  end_wall: number;
  end_tick: number;
  data: Uint8Array;
}

interface Samples {
  tick: number[];
  x: number[];
  y: number[];
  z: number[];
  state: number[];
}

const sizeOf = (file: string): number => {
  let n = 0;
  for (const tail of ["", "-wal", "-journal"]) {
    try {
      n += statSync(file + tail).size;
    } catch {
      // Not there.
    }
  }
  return n;
};

const unlink = (file: string): void => {
  for (const tail of ["", "-wal", "-shm", "-journal"]) {
    try {
      unlinkSync(file + tail);
    } catch {
      // Not there.
    }
  }
};

/** A string for an item key that means the same in every segment. */
const heldKey = (names: Map<number, string>, key: number): string => `${names.get(keyItem(key)) ?? `#${keyItem(key)}`}\t${keyQuality(key)}\t${keyBlueprint(key) ? 1 : 0}`;

const heldOf = (key: string, count: number): LogHeld => {
  const [item, q, bp] = key.split("\t");
  return { item: item!, quality: Number(q), blueprint: bp === "1", count };
};

const listOf = (m: ReadonlyMap<string, number>): LogHeld[] => [...m].map(([k, n]) => heldOf(k, n)).sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : a.quality - b.quality || Number(a.blueprint) - Number(b.blueprint)));

export class LogStore {
  readonly folder: string;
  private cap: number;
  private readonly info: LogWorld;
  private readonly say: (line: string) => void;
  private readonly segments: Segment[] = [];
  /** The segment being written, the newest. Null before the first batch and after `end`. */
  private current: Segment | null = null;
  private readonly names = new Map<number, string>();
  private readonly who = new Map<number, { pid: number; name: string }>();
  private readonly live = new Map<number, Live>();
  private readonly reading: Segment[] = [];
  private failedAt = -Infinity;

  /** Opens the folder, making it if need be, and drops what is over `cap` bytes. Never throws for a segment it cannot read: that one is deleted and said. */
  constructor(folder: string, cap: number, info: LogWorld, say: (line: string) => void = () => {}) {
    this.folder = folder;
    this.cap = cap;
    this.info = info;
    this.say = say;
    mkdirSync(folder, { recursive: true });
    for (const name of readdirSync(folder).filter((n) => SEGMENT_NAME.test(n)).sort()) {
      const file = join(folder, name);
      try {
        // A segment a crash left open has its write-ahead log beside it. Opening it to write takes that in and closes it as one file.
        const db = new Database(file);
        let meta: Map<string, string | number>;
        try {
          db.exec("PRAGMA journal_mode = DELETE");
          meta = new Map((db.query("SELECT key, value FROM meta").all() as { key: string; value: string | number }[]).map((r) => [r.key, r.value]));
        } finally {
          db.close();
        }
        if (Number(meta.get("format")) !== SEGMENT_FORMAT) throw new Error(`format ${meta.get("format")}`);
        if (meta.get("save_id") !== info.saveId) {
          unlink(file);
          say(`survivor log: deleted ${name}, which was written for another save`);
          continue;
        }
        this.segments.push({ file, startWall: Number(meta.get("start_wall")), startTick: Number(meta.get("start_tick")), endWall: Number(meta.get("end_wall")), endTick: Number(meta.get("end_tick")), bytes: sizeOf(file), sql: null, dict: null });
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        // A damaged file, or one of another format, is of no use; one another program holds is left as it is.
        const code = sqliteCode(err);
        if (code === "" || sqliteIs(code, "SQLITE_CORRUPT") || sqliteIs(code, "SQLITE_NOTADB")) {
          unlink(file);
          say(`survivor log: deleted ${name}, which could not be read (${why})`);
        } else say(`survivor log: left out ${name}, which could not be opened (${why})`);
      }
    }
    this.prune();
  }

  /** Bytes a segment grows to before the next is begun: a sixteenth of the cap, from 64 KB to 64 MB. */
  get target(): number {
    return Math.min(64 << 20, Math.max(64 << 10, Math.floor(this.cap / 16)));
  }

  setCap(bytes: number): void {
    this.cap = bytes;
    this.prune();
  }

  /** Writes one batch. A batch that cannot be written is lost and said, at most once a minute; the log goes on. */
  write(b: Batch): void {
    for (const [i, id] of b.names) this.names.set(i, id);
    for (const [i, pid, name] of b.subjects) this.who.set(i, { pid, name });
    try {
      if (this.current && this.current.bytes >= this.target) this.roll(b.wall0, b.tick0);
      const seg = this.current ?? this.begin(b.wall0, b.tick0);
      const sql = seg.sql!;
      sql.transaction(() => {
        for (const [i, id] of b.names) sql.query("INSERT OR IGNORE INTO names (idx, id) VALUES (?, ?)").run(i, id);
        for (const [i, pid, name] of b.subjects) sql.query("INSERT OR IGNORE INTO subjects (idx, pid, name) VALUES (?, ?, ?)").run(i, pid, name);
        sql.query("INSERT INTO frames (wall, tick, end_wall, end_tick, data) VALUES (?, ?, ?, ?, ?)").run(b.wall0, b.tick0, b.wall1, b.tick1, b.frame);
        for (const e of b.events) this.apply(seg, e);
        this.ends(sql, b.wall1, b.tick1);
      })();
      if (b.names.length > 0 || b.subjects.length > 0) seg.dict = null;
      seg.endWall = b.wall1;
      seg.endTick = b.tick1;
      seg.bytes = sizeOf(seg.file);
      this.prune();
    } catch (err) {
      this.failed(err);
    }
  }

  /** Closes the segment being written, as the log stops. What is still online is ended "stopped". */
  end(): void {
    const seg = this.current;
    if (!seg) return;
    try {
      seg.sql!.transaction(() => {
        for (const live of this.live.values()) this.stint(seg, live, seg.endWall, seg.endTick, "stopped");
      })();
      this.live.clear();
      this.seal(seg);
    } catch (err) {
      this.failed(err);
    }
    this.current = null;
  }

  close(): void {
    this.end();
    for (const seg of this.segments) {
      seg.sql?.close();
      seg.sql = null;
    }
    this.reading.length = 0;
  }

  // ---------------------------------------------------------------- writing

  private failed(err: unknown): void {
    if (performance.now() - this.failedAt < 60_000) return;
    this.failedAt = performance.now();
    this.say(`survivor log: a batch could not be written and is lost (${err instanceof Error ? err.message : String(err)}); the log goes on`);
  }

  private ends(sql: Database, wall: number, tick: number): void {
    sql.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('end_wall', ?), ('end_tick', ?)").run(wall, tick);
  }

  private begin(wall: number, tick: number): Segment {
    const last = this.segments.at(-1);
    let at = Math.max(wall, last ? last.endWall : wall);
    while (existsSync(join(this.folder, segmentName(at, tick)))) at++;
    const file = join(this.folder, segmentName(at, tick));
    const sql = new Database(file, { create: true });
    // One connection, kept, so the write-ahead log needs no shared memory file; at the cap the log file is cut back.
    sql.exec("PRAGMA locking_mode = EXCLUSIVE");
    sql.exec("PRAGMA journal_mode = WAL");
    sql.exec("PRAGMA synchronous = NORMAL");
    sql.exec("PRAGMA wal_autocheckpoint = 256");
    sql.exec("PRAGMA journal_size_limit = 1048576");
    const seg: Segment = { file, startWall: wall, startTick: tick, endWall: wall, endTick: tick, bytes: 0, sql, dict: null };
    sql.transaction(() => {
      sql.exec(SCHEMA);
      const meta: [string, string | number][] = [["format", SEGMENT_FORMAT], ["save_id", this.info.saveId], ["map_id", this.info.mapId], ["world", this.info.world], ["start_wall", wall], ["start_tick", tick]];
      for (const [k, v] of meta) sql.query("INSERT INTO meta (key, value) VALUES (?, ?)").run(k, v);
      this.ends(sql, wall, tick);
      for (const [i, id] of this.names) sql.query("INSERT INTO names (idx, id) VALUES (?, ?)").run(i, id);
      for (const [i, w] of this.who) sql.query("INSERT INTO subjects (idx, pid, name) VALUES (?, ?, ?)").run(i, w.pid, w.name);
      // Who is online goes on in this segment as it stood, so it reads without the one before.
      for (const live of this.live.values()) {
        live.spans = new Map();
        this.open(seg, live, wall);
        const pairs: number[] = [];
        for (const [key, n] of live.held) pairs.push(key, n);
        live.held = new Map();
        this.change(seg, live, pairs, wall, tick, true);
      }
    })();
    seg.bytes = sizeOf(file);
    this.segments.push(seg);
    this.current = seg;
    return seg;
  }

  private roll(wall: number, tick: number): void {
    const seg = this.current!;
    seg.sql!.transaction(() => {
      for (const live of this.live.values()) this.stint(seg, live, wall, tick, "continued");
      this.ends(seg.sql!, wall, tick);
    })();
    seg.endWall = wall;
    seg.endTick = tick;
    this.seal(seg);
    this.current = null;
    this.begin(wall, tick);
  }

  /** Empties the write-ahead log into the file and leaves it a plain one, which opens read-only with nothing beside it. */
  private seal(seg: Segment): void {
    seg.sql!.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    seg.sql!.exec("PRAGMA journal_mode = DELETE");
    seg.sql!.close();
    seg.sql = null;
    seg.dict = null;
    seg.bytes = sizeOf(seg.file);
  }

  private apply(seg: Segment, e: LogEvent): void {
    const sql = seg.sql!;
    if (e.kind === EV_START) {
      const who = this.who.get(e.idx)!;
      const live: Live = { pid: who.pid, name: who.name, began: e.began, beganTick: e.beganTick, since: e.wall, sinceTick: e.tick, team: e.team, tribe: e.tribe, held: new Map(), sinceFull: 0, row: 0, spans: new Map() };
      this.live.set(e.idx, live);
      this.open(seg, live, e.wall);
      this.change(seg, live, e.pairs, e.wall, e.tick, true);
      return;
    }
    const live = this.live.get(e.idx);
    if (!live) return;
    if (e.kind === EV_HELD) this.change(seg, live, e.pairs, e.wall, e.tick, false);
    else if (e.kind === EV_TEAM) {
      sql.query("UPDATE sessions SET stop = ?, stop_tick = ?, why = 'tribe' WHERE rowid = ?").run(e.wall, e.tick, live.row);
      live.team = e.team;
      live.tribe = e.tribe;
      live.since = e.wall;
      live.sinceTick = e.tick;
      this.open(seg, live, e.wall);
    } else if (e.kind === EV_STOP) {
      this.stint(seg, live, e.wall, e.tick, e.why);
      this.live.delete(e.idx);
    }
  }

  private open(seg: Segment, live: Live, wall: number): void {
    const r = seg.sql!.query("INSERT INTO sessions (pid, name, began, began_tick, since, since_tick, start, why, team, tribe) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)").run(live.pid, live.name, live.began, live.beganTick, live.since, live.sinceTick, wall, live.team, live.tribe);
    live.row = Number(r.lastInsertRowid);
  }

  /** Ends a survivor's stint in `seg`, and every span of what it held. */
  private stint(seg: Segment, live: Live, wall: number, tick: number, why: string): void {
    const sql = seg.sql!;
    sql.query("UPDATE sessions SET stop = ?, stop_tick = ?, why = ? WHERE rowid = ?").run(wall, tick, why, live.row);
    for (const span of live.spans.values()) sql.query("UPDATE held SET stop = ? WHERE rowid = ?").run(wall, span.row);
    live.spans.clear();
  }

  /** Applies [key, count] pairs to what `live` holds, keeps its spans, and writes the change, or all it holds when `full`. */
  private change(seg: Segment, live: Live, pairs: readonly number[], wall: number, tick: number, full: boolean): void {
    const sql = seg.sql!;
    for (let i = 0; i < pairs.length; i += 2) {
      const key = pairs[i]!;
      const n = pairs[i + 1]!;
      if (n > 0) live.held.set(key, n);
      else live.held.delete(key);
      const span = live.spans.get(key);
      if (!span && n > 0) {
        const r = sql.query("INSERT INTO held (key, pid, start, most) VALUES (?, ?, ?, ?)").run(key, live.pid, wall, n);
        live.spans.set(key, { row: Number(r.lastInsertRowid), most: n });
      } else if (span && n === 0) {
        sql.query("UPDATE held SET stop = ? WHERE rowid = ?").run(wall, span.row);
        live.spans.delete(key);
      } else if (span && n > span.most) {
        span.most = n;
        sql.query("UPDATE held SET most = ? WHERE rowid = ?").run(n, span.row);
      }
    }
    if (full || ++live.sinceFull >= FULL_EVERY) {
      live.sinceFull = 0;
      const all: number[] = [];
      for (const [key, n] of live.held) all.push(key, n);
      sql.query("INSERT INTO inventories (pid, wall, tick, full, data) VALUES (?, ?, ?, 1, ?)").run(live.pid, wall, tick, packPairs(all));
    } else sql.query("INSERT INTO inventories (pid, wall, tick, full, data) VALUES (?, ?, ?, 0, ?)").run(live.pid, wall, tick, packPairs(pairs));
  }

  private prune(): void {
    while (this.segments.length > 1 && this.bytes() > this.cap) {
      const seg = this.segments.shift()!;
      seg.sql?.close();
      seg.sql = null;
      const r = this.reading.indexOf(seg);
      if (r >= 0) this.reading.splice(r, 1);
      unlink(seg.file);
    }
  }

  private bytes(): number {
    let n = 0;
    for (const seg of this.segments) n += seg.bytes;
    return n;
  }

  // ---------------------------------------------------------------- reading

  span(): LogSpan {
    const first = this.segments[0];
    const last = this.segments.at(-1);
    return { from: first?.startWall ?? null, to: last?.endWall ?? null, fromTick: first?.startTick ?? null, toTick: last?.endTick ?? null, bytes: this.bytes(), cap: this.cap, segments: this.segments.length };
  }

  private db(seg: Segment): Database {
    if (seg.sql) {
      if (seg !== this.current) {
        const r = this.reading.indexOf(seg);
        if (r >= 0) this.reading.splice(r, 1);
        this.reading.push(seg);
      }
      return seg.sql;
    }
    seg.sql = new Database(seg.file, { readonly: true });
    this.reading.push(seg);
    while (this.reading.length > KEEP_OPEN) {
      const old = this.reading.shift()!;
      old.sql?.close();
      old.sql = null;
    }
    return seg.sql;
  }

  private dict(seg: Segment): Dict {
    if (seg.dict) return seg.dict;
    const db = this.db(seg);
    const names = new Map<number, string>();
    const ids = new Map<string, number>();
    for (const r of db.query("SELECT idx, id FROM names").all() as { idx: number; id: string }[]) {
      names.set(r.idx, r.id);
      ids.set(r.id, r.idx);
    }
    const who = new Map<number, { pid: number; name: string }>();
    const idxOf = new Map<number, number>();
    for (const r of db.query("SELECT idx, pid, name FROM subjects").all() as { idx: number; pid: number; name: string }[]) {
      who.set(r.idx, { pid: r.pid, name: r.name });
      idxOf.set(r.pid, r.idx);
    }
    return (seg.dict = { names, ids, who, idxOf });
  }

  /** Segments any part of which lies in the window, oldest first. */
  private overlapping(from: number, to: number): Segment[] {
    return this.segments.filter((s) => s.startWall <= to && s.endWall >= from);
  }

  /** The segment whose span holds `wall`, or null for a moment the server was down or the log does not reach. */
  private containing(wall: number): Segment | null {
    let lo = 0;
    let hi = this.segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segments[mid]!;
      if (wall < s.startWall) hi = mid - 1;
      else if (wall > s.endWall) lo = mid + 1;
      else {
        // Where one segment ends the next begins: the later one has it.
        const next = this.segments[mid + 1];
        return next && next.startWall <= wall ? next : s;
      }
    }
    return null;
  }

  /** The wall time of `tick` in a frame row, from its two clocks. */
  private static wallIn(row: FrameRow, tick: number): number {
    return Math.round(row.wall + ((tick - row.tick) * (row.end_wall - row.wall)) / Math.max(1, row.end_tick - row.tick));
  }

  private static tickIn(row: FrameRow, wall: number): number {
    return Math.round(row.tick + ((wall - row.wall) * (row.end_tick - row.tick)) / Math.max(1, row.end_wall - row.wall));
  }

  /**
   * The wall time of `tick`. A tick a crash or a restored backup made happen twice belongs to the run that came later, as the
   * save's journal does. Null when the log holds nothing at or before it.
   */
  wallAt(tick: number): number | null {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i]!;
      if (s.startTick > tick) continue;
      const row = this.db(s).query("SELECT wall, tick, end_wall, end_tick FROM frames WHERE tick <= ? ORDER BY tick DESC LIMIT 1").get(tick) as FrameRow | null;
      if (!row) return Math.round(s.startWall + ((tick - s.startTick) * 1000) / TICK_RATE);
      if (tick <= row.end_tick) return LogStore.wallIn(row, tick);
      return Math.round(row.end_wall + ((tick - row.end_tick) * 1000) / TICK_RATE);
    }
    return null;
  }

  /** The wall time of each of `ticks`, as wallAt gives it: one read for the deaths of a page's list of survivors. */
  wallsAt(ticks: readonly number[]): (number | null)[] {
    return ticks.map((t) => this.wallAt(t));
  }

  /** The world's tick at `wall`. While the server was down the world stood still, so that is the tick it stopped at. Null before the log begins. */
  tickAt(wall: number): number | null {
    const s = this.containing(wall);
    if (!s) {
      const before = this.segments.filter((x) => x.endWall < wall).at(-1);
      return before ? before.endTick : null;
    }
    const row = this.db(s).query("SELECT wall, tick, end_wall, end_tick FROM frames WHERE wall <= ? ORDER BY wall DESC LIMIT 1").get(wall) as FrameRow | null;
    if (!row) return s.startTick;
    return wall <= row.end_wall ? LogStore.tickIn(row, wall) : row.end_tick;
  }

  survivors(from: number, to: number): LogSurvivor[] {
    type Piece = LogSession & { pid: number; name: string; start: number; stop: number };
    const pieces: Piece[] = [];
    for (const s of this.overlapping(from, to)) {
      const rows = this.db(s).query("SELECT pid, name, began, since, since_tick, start, stop, stop_tick, why, team, tribe FROM sessions WHERE start <= ? AND (stop IS NULL OR stop >= ?) ORDER BY start, rowid").all(to, from) as { pid: number; name: string; began: number; since: number; since_tick: number; start: number; stop: number | null; stop_tick: number | null; why: string; team: number; tribe: string }[];
      for (const r of rows) {
        const open = r.stop === null;
        const ongoing = open && s === this.current;
        pieces.push({ pid: r.pid, name: r.name, began: r.began, from: r.since, fromTick: r.since_tick, start: r.start, stop: open ? s.endWall : r.stop!, to: ongoing ? null : open ? s.endWall : r.stop, toTick: ongoing ? null : open ? s.endTick : r.stop_tick, team: r.team, tribe: r.tribe, why: ongoing ? "" : open ? "lost" : r.why });
      }
    }
    const by = new Map<number, LogSurvivor>();
    let last: Piece | null = null;
    for (const p of pieces.sort((a, b) => a.pid - b.pid || a.start - b.start)) {
      let who = by.get(p.pid);
      if (!who) by.set(p.pid, (who = { pid: p.pid, name: p.name, playMs: 0, sessions: [] }));
      who.playMs += Math.max(0, Math.min(p.stop, to) - Math.max(p.start, from));
      const prev = who.sessions.at(-1);
      // A stint carried into the next segment is one stint.
      if (prev && last && last.pid === p.pid && last.why === "continued" && last.stop === p.start && prev.from === p.from) {
        prev.to = p.to;
        prev.toTick = p.toTick;
        prev.why = p.why;
      } else who.sessions.push({ began: p.began, from: p.from, fromTick: p.fromTick, to: p.to, toTick: p.toTick, team: p.team, tribe: p.tribe, why: p.why });
      last = p;
    }
    return [...by.values()];
  }

  private static decode(row: FrameRow, only: number | undefined): Map<number, Samples> {
    const out = new Map<number, Samples>();
    const c = new Cursor(row.data);
    const n = c.u();
    for (let i = 0; i < n && !c.over; i++) {
      const idx = c.u();
      const len = c.u();
      const end = c.pos + len;
      if (only !== undefined && idx !== only) {
        c.pos = end;
        continue;
      }
      let s = out.get(idx);
      if (!s) out.set(idx, (s = { tick: [], x: [], y: [], z: [], state: [] }));
      const r = new Cursor(row.data, c.pos, end);
      let t = row.tick;
      let x = 0;
      let y = 0;
      let z = 0;
      let state = 0;
      let first = true;
      while (r.pos < end && !r.over) {
        const head = r.u();
        t += Math.floor(head / 4);
        if (first) {
          state = r.u();
          x = r.s();
          y = r.s();
          z = r.s();
          first = false;
        } else {
          if (head & 1) state = r.u();
          if (head & 2) {
            x += r.s();
            y += r.s();
            z += r.s();
          }
        }
        s.tick.push(t);
        s.x.push(x);
        s.y.push(y);
        s.z.push(z);
        s.state.push(state);
      }
      c.pos = end;
    }
    return out;
  }

  /** Every survivor's place at each step from `from` to `to`, `only` one survivor's if given. Each point is a real sample: the last at or before the step's moment, else the first after it in the same frame. */
  private sampled(from: number, to: number, step: number, only: number | null): LogPositions {
    if (!(to >= from)) to = from;
    const steps = only === null ? Math.max(2, Math.min(MAX_STEPS, Math.floor(MAX_POINTS / Math.max(1, this.survivors(from, to).length)))) : MAX_STEPS;
    step = Math.max(MIN_STEP, Number.isFinite(step) ? step : 0, Math.ceil((to - from) / (steps - 1)));
    const seats = [""];
    const seatOfIdx = new Map<string, number>();
    const tracks = new Map<number, LogTrack>();
    let seg: Segment | null = null;
    let row: FrameRow | null = null;
    let samples: Map<number, Samples> | null = null;
    for (let t = from; t <= to; t += step) {
      const s = this.containing(t);
      if (!s) continue;
      const d = this.dict(s);
      const only1 = only === null ? undefined : d.idxOf.get(only);
      if (only !== null && only1 === undefined) continue;
      if (s !== seg || !row || t < row.wall || t > row.end_wall) {
        seg = s;
        // A frame holds the samples after its first tick up to its last, so a moment on a boundary is the earlier frame's.
        const q = this.db(s).query("SELECT wall, tick, end_wall, end_tick, data FROM frames WHERE wall < ? ORDER BY wall DESC LIMIT 1");
        row = (q.get(t) ?? q.get(t + 1)) as FrameRow | null;
        samples = row && t <= row.end_wall ? LogStore.decode(row, only1) : null;
      }
      if (!row || !samples || t > row.end_wall) continue;
      const at = LogStore.tickIn(row, t);
      for (const [idx, sm] of samples) {
        const who = d.who.get(idx);
        if (!who) continue;
        let k = 0;
        while (k + 1 < sm.tick.length && sm.tick[k + 1]! <= at) k++;
        let track = tracks.get(who.pid);
        if (!track) tracks.set(who.pid, (track = { pid: who.pid, name: who.name, wall: [], tick: [], x: [], y: [], z: [], state: [], seat: [] }));
        const wall = LogStore.wallIn(row, sm.tick[k]!);
        if (track.wall.at(-1) === wall && track.tick.at(-1) === sm.tick[k]) continue;
        const state = sm.state[k]!;
        const on = seatOf(state);
        let seatIdx = 0;
        if (on >= 0) {
          const id = d.names.get(on) ?? `#${on}`;
          seatIdx = seatOfIdx.get(id) ?? 0;
          if (seatIdx === 0) {
            seatIdx = seats.length;
            seats.push(id);
            seatOfIdx.set(id, seatIdx);
          }
        }
        track.wall.push(wall);
        track.tick.push(sm.tick[k]!);
        track.x.push(sm.x[k]! / 4);
        track.y.push(sm.y[k]! / 4);
        track.z.push(sm.z[k]! / 4);
        track.state.push(conditionOf(state));
        track.seat.push(seatIdx);
      }
    }
    return { from, to, step, seats, tracks: [...tracks.values()] };
  }

  positions(from: number, to: number, step: number): LogPositions {
    return this.sampled(from, to, step, null);
  }

  /** One survivor's samples; `tracks` holds one track, or none if the log never saw it in the window. */
  track(pid: number, from: number, to: number, step: number): LogPositions {
    return this.sampled(from, to, step, pid);
  }

  /** What `pid` held at `at` in segment `s`, by keys that mean the same in every segment, and whether it was online then. Null if it was never online in `s` up to `at`. */
  private stateIn(s: Segment, pid: number, at: number): { held: Map<string, number>; wall: number; online: boolean; name: string } | null {
    const db = this.db(s);
    const full = db.query("SELECT rowid AS id, wall FROM inventories WHERE pid = ? AND wall <= ? AND full = 1 ORDER BY wall DESC, rowid DESC LIMIT 1").get(pid, at) as { id: number; wall: number } | null;
    if (!full) return null;
    const d = this.dict(s);
    const raw = new Map<number, number>();
    const rows = db.query("SELECT data FROM inventories WHERE pid = ? AND rowid >= ? AND wall <= ? ORDER BY rowid").all(pid, full.id, at) as { data: Uint8Array }[];
    rows.forEach((r, i) => {
      const pairs = unpackPairs(r.data);
      if (i === 0) raw.clear();
      for (let k = 0; k < pairs.length; k += 2) {
        if (pairs[k + 1]! > 0) raw.set(pairs[k]!, pairs[k + 1]!);
        else raw.delete(pairs[k]!);
      }
    });
    const held = new Map<string, number>();
    for (const [key, n] of raw) held.set(heldKey(d.names, key), n);
    const session = db.query("SELECT name, stop FROM sessions WHERE pid = ? AND start <= ? ORDER BY start DESC, rowid DESC LIMIT 1").get(pid, at) as { name: string; stop: number | null } | null;
    const until = session ? (session.stop ?? s.endWall) : full.wall;
    // A session of the segment being written that has not stopped goes on past the last batch.
    const online = !!session && ((session.stop === null && s === this.current) || at <= until);
    return { held, wall: online ? at : until, online, name: session?.name ?? "" };
  }

  /** The latest state of `pid` at or before `at`, from the newest segment that has one. */
  private stateAt(pid: number, at: number): { held: Map<string, number>; wall: number; online: boolean; name: string } | null {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i]!;
      if (s.startWall > at) continue;
      const found = this.stateIn(s, pid, at);
      if (found) return found;
    }
    return null;
  }

  heldAt(pid: number, at: number): LogHolding | null {
    const st = this.stateAt(pid, at);
    return st ? { pid, name: st.name, at, wall: st.wall, online: st.online, items: listOf(st.held) } : null;
  }

  changes(pid: number, from: number, to: number): LogChanges {
    if (!(to >= from)) to = from;
    const start = this.stateAt(pid, from);
    let name = start?.name ?? "";
    const before = new Map(start?.held ?? []);
    let cur = new Map(before);
    const entries: LogChange[] = [];
    let more = false;
    for (const s of this.overlapping(from, to)) {
      const d = this.dict(s);
      const rows = this.db(s).query("SELECT wall, tick, full, data FROM inventories WHERE pid = ? AND wall > ? AND wall <= ? ORDER BY rowid").all(pid, from, to) as { wall: number; tick: number; full: number; data: Uint8Array }[];
      if (rows.length > 0 && name === "") name = d.who.get(d.idxOf.get(pid) ?? -1)?.name ?? "";
      for (const r of rows) {
        const pairs = unpackPairs(r.data);
        const next = r.full ? new Map<string, number>() : new Map(cur);
        for (let k = 0; k < pairs.length; k += 2) {
          const key = heldKey(d.names, pairs[k]!);
          if (pairs[k + 1]! > 0) next.set(key, pairs[k + 1]!);
          else next.delete(key);
        }
        const gained = new Map<string, number>();
        const lost = new Map<string, number>();
        for (const [key, n] of next) if (n > (cur.get(key) ?? 0)) gained.set(key, n - (cur.get(key) ?? 0));
        for (const [key, n] of cur) if (n > (next.get(key) ?? 0)) lost.set(key, n - (next.get(key) ?? 0));
        cur = next;
        if (gained.size === 0 && lost.size === 0) continue;
        if (entries.length >= MAX_ENTRIES) more = true;
        else entries.push({ wall: r.wall, tick: r.tick, gained: listOf(gained), lost: listOf(lost) });
      }
    }
    const gained = new Map<string, number>();
    const lost = new Map<string, number>();
    for (const [key, n] of cur) if (n > (before.get(key) ?? 0)) gained.set(key, n - (before.get(key) ?? 0));
    for (const [key, n] of before) if (n > (cur.get(key) ?? 0)) lost.set(key, n - (cur.get(key) ?? 0));
    return { pid, name, from, to, before: listOf(before), after: listOf(cur), gained: listOf(gained), lost: listOf(lost), entries, more };
  }

  /** Who held `item` (a content id) in the window, of the quality and blueprint asked for, or any where not asked. */
  holders(item: string, from: number, to: number, quality?: number, blueprint?: boolean): LogHolder[] {
    if (!(to >= from)) to = from;
    const out: (LogHolder & { key: number })[] = [];
    for (const s of this.overlapping(from, to)) {
      const d = this.dict(s);
      const idx = d.ids.get(item);
      if (idx === undefined) continue;
      const rows = this.db(s).query("SELECT key, pid, start, stop, most FROM held WHERE key >= ? AND key < ? AND start <= ? AND (stop IS NULL OR stop >= ?) ORDER BY start, rowid").all(idx * 16, idx * 16 + 16, to, from) as { key: number; pid: number; start: number; stop: number | null; most: number }[];
      for (const r of rows) {
        if (quality !== undefined && keyQuality(r.key) !== quality) continue;
        if (blueprint !== undefined && keyBlueprint(r.key) !== blueprint) continue;
        const stop = r.stop ?? (s === this.current ? null : s.endWall);
        const key = keyQuality(r.key) * 2 + (keyBlueprint(r.key) ? 1 : 0);
        const prev = out.findLast((h) => h.pid === r.pid && h.key === key);
        // A span carried into the next segment is one span.
        if (prev && prev.to === r.start) {
          prev.to = stop;
          prev.most = Math.max(prev.most, r.most);
          continue;
        }
        out.push({ key, pid: r.pid, name: d.who.get(d.idxOf.get(r.pid) ?? -1)?.name ?? "", quality: keyQuality(r.key), blueprint: keyBlueprint(r.key), from: r.start, to: stop, most: r.most });
      }
    }
    return out.map(({ key: _, ...h }) => h);
  }

  /** Every item anyone held in the window, with how many survivors held it and the most one held. */
  items(from: number, to: number): LogItem[] {
    if (!(to >= from)) to = from;
    const by = new Map<string, { pids: Set<number>; most: number }>();
    for (const s of this.overlapping(from, to)) {
      const d = this.dict(s);
      const rows = this.db(s).query("SELECT key, pid, most FROM held WHERE start <= ? AND (stop IS NULL OR stop >= ?)").all(to, from) as { key: number; pid: number; most: number }[];
      for (const r of rows) {
        const key = heldKey(d.names, r.key);
        let e = by.get(key);
        if (!e) by.set(key, (e = { pids: new Set(), most: 0 }));
        e.pids.add(r.pid);
        e.most = Math.max(e.most, r.most);
      }
    }
    return [...by].map(([key, e]) => ({ ...heldOf(key, 0), survivors: e.pids.size, most: e.most })).map(({ count: _, ...rest }) => rest).sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : a.quality - b.quality));
  }

  /** The save's admin commands and survivors' deaths whose ticks fall in the window, read from the save at `savePath` without holding it. */
  marks(from: number, to: number, savePath: string): LogMarks {
    if (!(to >= from)) to = from;
    const ranges: [number, number][] = [];
    for (const s of this.overlapping(from, to)) {
      const lo = this.tickAt(Math.max(from, s.startWall)) ?? s.startTick;
      const hi = this.tickAt(Math.min(to, s.endWall)) ?? s.endTick;
      ranges.push([Math.min(lo, hi), Math.max(lo, hi)]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged.at(-1);
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    const marks: LogMark[] = [];
    let more = false;
    if (merged.length === 0 || !existsSync(savePath)) return { marks, more };
    const db = new Database(savePath, { readonly: true });
    try {
      db.exec("BEGIN");
      const bounds = db.query("SELECT MIN(seq) AS lo, MAX(seq) AS hi FROM journal").get() as { lo: number | null; hi: number | null };
      const tickOf = db.query("SELECT tick FROM journal WHERE seq >= ? ORDER BY seq LIMIT 1");
      const page = db.query("SELECT seq, tick, op, data FROM journal WHERE seq >= ? ORDER BY seq LIMIT 1000");
      const names = new Map<number, string>();
      const nameOf = (pid: number): string => {
        if (names.size === 0) for (const r of db.query("SELECT name, pid FROM survivors").all() as { name: string; pid: number }[]) names.set(r.pid, r.name);
        return names.get(pid) ?? "";
      };
      for (const [lo, hi] of merged) {
        if (bounds.lo === null || bounds.hi === null) break;
        // A save's journal goes up in tick as it goes up in sequence, so the first entry of the range is found by halving.
        let a = bounds.lo;
        let b = bounds.hi + 1;
        while (a < b) {
          const mid = Math.floor((a + b) / 2);
          const t = (tickOf.get(mid) as { tick: number } | null)?.tick ?? Infinity;
          if (t < lo) a = mid + 1;
          else b = mid;
        }
        let seq = a;
        for (let done = false; !done && !more; ) {
          const rows = page.all(seq) as { seq: number; tick: number; op: number; data: Uint8Array }[];
          if (rows.length === 0) break;
          for (const r of rows) {
            seq = r.seq + 1;
            if (r.tick > hi) {
              done = true;
              break;
            }
            const acted = r.op === this.info.opAdmin || (this.info.opActs?.includes(r.op) ?? false);
            if (!acted && r.op !== this.info.opDeath) continue;
            const act = acted ? decodeAct(r.data, r.seq, r.tick) : null;
            // An act keeps its own time; an older save's entry has only the tick, which the log gives a time.
            const wall = act && act.at > 0 ? act.at : this.wallAt(r.tick);
            if (wall === null || wall < from || wall > to) continue;
            if (marks.length >= MAX_ENTRIES) {
              more = true;
              break;
            }
            if (act) {
              marks.push({ wall, tick: r.tick, kind: "admin", pid: act.pid, name: act.name, text: act.what, cache: 0, act: act.kind });
            } else {
              const br = new BitReader(r.data);
              const pid = br.uint53();
              const cause = br.u8();
              const cache = br.uint53();
              marks.push({ wall, tick: r.tick, kind: "death", pid, name: nameOf(pid), text: this.info.causes[cause] ?? "", cache });
            }
          }
        }
      }
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    marks.sort((a, b) => a.wall - b.wall);
    return { marks, more };
  }
}
