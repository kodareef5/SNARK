// The survivor log as the host keeps it: where every survivor in a session was, on a cadence, what it held whenever that
// changed, and when its sessions began and ended. It lives beside the save, so a world with no save keeps none. The read
// functions are what an admin's pages ask; each runs on the log's own thread on a running server.

import { TICK_RATE } from "../../shared/coords.ts";
import { SESSION_ALIVE, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import type { Inventory } from "../../shared/sim/items.ts";
import type { Client } from "../game.ts";
import type { Persistence } from "../persist/persistence.ts";
import type { Records } from "../records.ts";
import type { Rules } from "../settings/rules.ts";
import type { Tribes } from "../tribes.ts";
import type { ServerWorld } from "../world.ts";
import { STATE_ALIVE, STATE_AWAY, STATE_DEAD, STATE_OUT, STATE_SPECTATING, aggregate, logFolder, stateOf } from "./format.ts";
import { LogRecorder, type Batch } from "./recorder.ts";
import type { LogChanges, LogHolder, LogHolding, LogItem, LogMarks, LogPositions, LogSpan, LogSurvivor } from "../../shared/survivor-log.ts";
import { LogStore, type LogWorld } from "./store.ts";

/** Five seconds: how often the tick thread hands what it gathered to the store, and so the most a crash loses. */
export const FLUSH_TICKS = 5 * TICK_RATE;

export interface SurvivorLogOptions {
  /** "worker" gives the store a thread of its own, as a running server wants. The default writes and reads on the calling thread. */
  mode?: "inline" | "worker";
  /** The wall clock in milliseconds. Without one, the system's, which never goes back while the server runs. */
  wall?: () => number;
}

export interface SurvivorLogContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly tribes: Tribes;
  readonly rules: Rules;
  readonly persistence: Persistence | null;
  /** The ops of the journal entries the log marks, and the words for causes of death. */
  readonly opAdmin: number;
  readonly opActs?: readonly number[];
  readonly opDeath: number;
  readonly causes: readonly string[];
  readonly say: (line: string) => void;
}

/** The span (store.ts LogSpan), whether the log is recording, why not, and its folder (null for a world with no save). */
export interface SurvivorLogSpan extends LogSpan {
  on: boolean;
  why: string;
  folder: string | null;
}

export type ReadName = "survivors" | "positions" | "track" | "heldAt" | "changes" | "holders" | "items" | "marks" | "wallAt" | "wallsAt" | "tickAt";

export type ToLog =
  | { op: "open"; folder: string; cap: number; world: LogWorld; closed: Int32Array }
  | { op: "batch"; batch: Batch }
  | { op: "cap"; bytes: number }
  | { op: "end" }
  | { op: "read"; id: number; fn: ReadName; args: unknown[]; json: boolean }
  | { op: "close" };

export type FromLog = { op: "span"; span: LogSpan } | { op: "say"; line: string } | { op: "read"; id: number; value?: unknown; error?: string };

interface Backend {
  write(b: Batch): void;
  cap(bytes: number): void;
  end(): void;
  close(): void;
  span(): LogSpan;
  /** With `json`, the answer comes as its JSON text, made where the read ran. */
  read(fn: ReadName, args: unknown[], json?: boolean): Promise<unknown>;
}

function inlineBackend(folder: string, cap: number, world: LogWorld, say: (line: string) => void): Backend {
  const store = new LogStore(folder, cap, world, say);
  return {
    write: (b) => store.write(b),
    cap: (bytes) => store.setCap(bytes),
    end: () => store.end(),
    close: () => store.close(),
    span: () => store.span(),
    read(fn, args, json = false) {
      try {
        const value = (store[fn] as (...a: unknown[]) => unknown).apply(store, args);
        return Promise.resolve(json ? JSON.stringify(value) : value);
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

function workerBackend(folder: string, cap: number, world: LogWorld, say: (line: string) => void): Backend {
  const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
  // The worker writes 1 here once the store is closed, so close() can wait for it without a turn of the event loop.
  const closed = new Int32Array(new SharedArrayBuffer(4));
  let span: LogSpan = { from: null, to: null, fromTick: null, toTick: null, bytes: 0, cap, segments: 0 };
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let next = 1;
  const send = (m: ToLog, transfer: ArrayBuffer[] = []): void => worker.postMessage(m, transfer);
  worker.onmessage = (e: MessageEvent<FromLog>) => {
    const m = e.data;
    if (m.op === "span") span = m.span;
    else if (m.op === "say") say(m.line);
    else {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error !== undefined) w?.reject(new Error(m.error));
      else w?.resolve(m.value);
    }
  };
  worker.onerror = (e) => {
    say(`survivor log: its thread failed (${e.message})`);
    for (const w of waiting.values()) w.reject(new Error("the survivor log's thread failed"));
    waiting.clear();
  };
  // The server may exit while the worker is idle.
  worker.unref();
  send({ op: "open", folder, cap, world, closed });
  return {
    write: (b) => send({ op: "batch", batch: b }, [b.frame.buffer as ArrayBuffer]),
    cap: (bytes) => send({ op: "cap", bytes }),
    end: () => send({ op: "end" }),
    close() {
      send({ op: "close" });
      Atomics.wait(closed, 0, 0, 5000);
      worker.terminate();
    },
    span: () => span,
    read: (fn, args, json = false) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { resolve, reject });
        send({ op: "read", id, fn, args, json });
      }),
  };
}

/** A survivor in a session, as the tick thread watches it. */
interface Watched {
  readonly c: Client;
  readonly phase: number;
  inv: Inventory | null;
  version: number;
  /** The tick its inventory is next looked at, 0 while nothing has changed. */
  due: number;
  team: number;
  tribe: string;
}

const MEGABYTE = 1 << 20;

export class SurvivorLog {
  /** Where the log is kept: beside the save. Null for a world with no save, which keeps none. */
  readonly folder: string | null;
  private readonly ctx: SurvivorLogContext;
  private readonly opts: SurvivorLogOptions;
  private readonly wall: () => number;
  private readonly recorder: LogRecorder;
  /** Every session with a survivor, recorded or not, so the log can start while they play. */
  private readonly sessions = new Map<number, Client>();
  private readonly watched = new Map<number, Watched>();
  private readonly scratch = new Map<number, number>();
  private backend: Backend | null = null;
  private recording = false;
  private stopped = false;
  private megabytes = 0;
  private positionTicks = TICK_RATE;
  private inventoryTicks = 5 * TICK_RATE;
  private seen = -1;
  private flushedAt = 0;
  private phases = 0;

  constructor(ctx: SurvivorLogContext, opts: SurvivorLogOptions = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.folder = ctx.persistence ? logFolder(ctx.persistence.store.path) : null;
    const base = Date.now() - performance.now();
    this.wall = opts.wall ?? (() => Math.floor(base + performance.now()));
    this.recorder = new LogRecorder(ctx.world.reg.ids, this.wall(), ctx.world.tick);
    this.configure();
  }

  /** A session's survivor is in the world: its log begins. */
  enter(c: Client): void {
    if (c.pid === 0 || this.sessions.has(c.pid)) return;
    this.sessions.set(c.pid, c);
    if (this.recording) this.watch(c, this.wall(), this.ctx.world.tick);
  }

  /** The session ended, for `why` ("left", or the reason it was put out). */
  leave(c: Client, why: string): void {
    if (this.sessions.get(c.pid) !== c) return;
    if (this.recording) this.unwatch(c.pid, why);
    this.sessions.delete(c.pid);
  }

  /** Call once a tick, after everything has moved. */
  step(tick: number): void {
    if (this.seen !== this.ctx.rules.version) this.configure();
    if (!this.recording) return;
    for (const w of this.watched.values()) {
      if (w.due !== 0 && tick >= w.due) this.held(w, tick);
      if ((tick + w.phase) % this.positionTicks === 0) this.sample(w, tick);
    }
    if (tick - this.flushedAt >= FLUSH_TICKS) this.flush();
  }

  /** Hands what is gathered to the store now, as a step does every FLUSH_TICKS. */
  flush(): void {
    if (!this.recording || !this.backend) return;
    this.flushedAt = this.ctx.world.tick;
    this.backend.write(this.recorder.flush(this.wall(), this.ctx.world.tick));
  }

  /** As the server stops: every session ends "stopped" and the store is closed. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.recording) this.halt("stopped");
    this.backend?.close();
    this.backend = null;
  }

  // ---------------------------------------------------------------- recording

  private configure(): void {
    const rules = this.ctx.rules;
    this.seen = rules.version;
    this.positionTicks = Math.max(1, Math.round(rules.num("SurvivorLogPositionSeconds") * TICK_RATE));
    this.inventoryTicks = Math.max(1, Math.round(rules.num("SurvivorLogInventorySeconds") * TICK_RATE));
    const mb = rules.num("SurvivorLogMegabytes");
    if (mb === this.megabytes || this.stopped) return;
    this.megabytes = mb;
    if (mb === 0) {
      if (this.recording) this.halt("log off");
      return;
    }
    if (!this.folder) return;
    if (this.backend) this.backend.cap(mb * MEGABYTE);
    else {
      const p = this.ctx.persistence!;
      const world: LogWorld = { saveId: p.saveId, mapId: this.ctx.world.mapId, world: this.ctx.records.worldId, opAdmin: this.ctx.opAdmin, ...(this.ctx.opActs === undefined ? {} : { opActs: this.ctx.opActs }), opDeath: this.ctx.opDeath, causes: this.ctx.causes };
      try {
        this.backend = (this.opts.mode === "worker" ? workerBackend : inlineBackend)(this.folder, mb * MEGABYTE, world, this.ctx.say);
      } catch (err) {
        this.ctx.say(`survivor log: ${this.folder} could not be opened (${err instanceof Error ? err.message : String(err)}), so nothing is logged`);
        return;
      }
    }
    if (this.recording) return;
    this.recording = true;
    const wall = this.wall();
    const tick = this.ctx.world.tick;
    this.recorder.resume(wall, tick);
    this.flushedAt = tick;
    for (const c of this.sessions.values()) this.watch(c, wall, tick);
  }

  /** Ends every session the log is recording and closes the segment, as the log stops. */
  private halt(why: string): void {
    for (const pid of [...this.watched.keys()]) this.unwatch(pid, why);
    this.flush();
    this.backend?.end();
    this.recording = false;
  }

  private watch(c: Client, wall: number, tick: number): void {
    const rec = this.ctx.records.byPid.get(c.pid);
    if (!rec || this.watched.has(c.pid)) return;
    const w: Watched = { c, phase: this.phases++ % 65536, inv: rec.inv, version: rec.inv?.version ?? -1, due: 0, team: rec.team, tribe: this.tribeOf(rec.team) };
    this.watched.set(c.pid, w);
    this.recorder.enter(c.pid, c.name, w.team, w.tribe, aggregate(rec.inv, this.scratch), wall, tick);
    this.sample(w, tick);
  }

  private unwatch(pid: number, why: string): void {
    const w = this.watched.get(pid);
    if (!w) return;
    const tick = this.ctx.world.tick;
    this.sample(w, tick);
    if (w.due !== 0) this.held(w, tick);
    this.recorder.leave(pid, why, this.wall(), tick);
    this.watched.delete(pid);
  }

  private tribeOf(team: number): string {
    return this.ctx.tribes.byId.get(team)?.name ?? "";
  }

  private held(w: Watched, tick: number): void {
    w.due = 0;
    this.recorder.held(w.c.pid, aggregate(this.ctx.records.byPid.get(w.c.pid)?.inv ?? null, this.scratch), this.wall(), tick);
  }

  /** Notes where the survivor is and what it is doing, and whether its tribe or what it holds has changed. */
  private sample(w: Watched, tick: number): void {
    const c = w.c;
    const rec = this.ctx.records.byPid.get(c.pid);
    if (!rec) return;
    if (rec.team !== w.team || this.tribeOf(rec.team) !== w.tribe) {
      w.team = rec.team;
      w.tribe = this.tribeOf(rec.team);
      this.recorder.team(c.pid, w.team, w.tribe, this.wall(), tick);
    }
    // A death hands the inventory to a cache without a change being told, so the object is watched as well as its version.
    if (rec.inv !== w.inv || (rec.inv !== null && rec.inv.version !== w.version)) {
      w.inv = rec.inv;
      w.version = rec.inv?.version ?? -1;
      if (w.due === 0) w.due = tick + this.inventoryTicks;
    }
    const ents = this.ctx.world.ents;
    let x: number;
    let y: number;
    let z: number;
    let condition: number;
    let seat = -1;
    if (c.state === SESSION_ALIVE && c.ent >= 0) {
      const e = c.ent;
      x = ents.x[e]!;
      y = ents.y[e]!;
      z = ents.z[e]!;
      condition = rec.out ? STATE_OUT : c.closed ? STATE_AWAY : STATE_ALIVE;
      // A rider is pinned to its seat, so its own position is where it really is; the seat says what carries it.
      const host = ents.seat[e]! - 1;
      if (host >= 0 && ents.seatSlot[e] !== 0 && ents.seatGen[e] === ents.gen[host] && (ents.flags[host]! & F_ALIVE) !== 0) seat = ents.kind[host]!;
    } else if (c.state === SESSION_SPECTATING || c.state === SESSION_DEAD) {
      x = c.body.x;
      y = c.body.y;
      z = c.body.z;
      condition = c.state === SESSION_DEAD ? STATE_DEAD : STATE_SPECTATING;
    } else return;
    this.recorder.sample(c.pid, tick, x, y, z, stateOf(condition, seat));
  }

  // ---------------------------------------------------------------- reading

  /** What the log holds and takes on disk, as of the last batch written. */
  span(): SurvivorLogSpan {
    const s = this.backend?.span() ?? { from: null, to: null, fromTick: null, toTick: null, bytes: 0, cap: this.megabytes * MEGABYTE, segments: 0 };
    const why = this.recording ? "" : !this.folder ? "this world is not saved to disk, so it keeps no survivor log" : this.stopped ? "the server has stopped" : this.megabytes === 0 ? "SurvivorLogMegabytes is 0" : "the log could not be opened";
    return { ...s, on: this.recording, why, folder: this.folder };
  }

  private read<T>(fn: ReadName, args: unknown[], none: T): Promise<T> {
    return this.backend ? (this.backend.read(fn, args) as Promise<T>) : Promise.resolve(none);
  }

  /** Every survivor online at any moment from `from` to `to` (wall milliseconds), with its sessions and its time online inside the window. */
  survivors(from: number, to: number): Promise<LogSurvivor[]> {
    return this.read("survivors", [from, to], []);
  }

  /** Where everyone was at each `step` milliseconds from `from` to `to`, as one track each. */
  positions(from: number, to: number, step: number): Promise<LogPositions> {
    return this.read("positions", [from, to, step], { from, to, step, seats: [""], tracks: [] });
  }

  /** One survivor's track, as positions gives it. */
  track(pid: number, from: number, to: number, step: number): Promise<LogPositions> {
    return this.read("track", [pid, from, to, step], { from, to, step, seats: [""], tracks: [] });
  }

  /** What a survivor held at `at`, or null if the log holds nothing of it at or before then. */
  heldAt(pid: number, at: number): Promise<LogHolding | null> {
    return this.read("heldAt", [pid, at], null);
  }

  /** What a survivor gained and lost from `from` to `to`, and each change between. */
  changes(pid: number, from: number, to: number): Promise<LogChanges> {
    return this.read("changes", [pid, from, to], { pid, name: "", from, to, before: [], after: [], gained: [], lost: [], entries: [], more: false });
  }

  /** Who held `item` (a content id such as "core:metal_ingot") from `from` to `to`, of that quality and blueprint or of any. */
  holders(item: string, from: number, to: number, quality?: number, blueprint?: boolean): Promise<LogHolder[]> {
    return this.read("holders", [item, from, to, quality, blueprint], []);
  }

  /** Every item anyone held from `from` to `to`, with how many held it and the most one held. */
  items(from: number, to: number): Promise<LogItem[]> {
    return this.read("items", [from, to], []);
  }

  /** The save's admin commands and survivors' deaths from `from` to `to`, at their wall times. */
  marks(from: number, to: number): Promise<LogMarks> {
    return this.read("marks", [from, to, this.ctx.persistence?.store.path ?? ""], { marks: [], more: false });
  }

  /** The wall time of a tick, null when the log holds nothing at or before it. */
  wallAt(tick: number): Promise<number | null> {
    return this.read("wallAt", [tick], null);
  }

  /** The wall time of each of `ticks`, in one read. */
  wallsAt(ticks: readonly number[]): Promise<(number | null)[]> {
    return this.read("wallsAt", [ticks], ticks.map(() => null));
  }

  /** The tick at a wall time; while the server was down, the tick it stopped at. Null before the log begins. */
  tickAt(wall: number): Promise<number | null> {
    return this.read("tickAt", [wall], null);
  }

  /**
   * The answer of the read `fn` with `args` as JSON text, made on the log's thread, for a route to send as it is: the tick's
   * thread then only takes a string, where a large answer as objects would cost it the time to copy and encode them.
   */
  json(fn: ReadName, ...args: unknown[]): Promise<string> {
    if (!this.backend) return ((this[fn] as (...a: unknown[]) => Promise<unknown>).apply(this, args)).then((v) => JSON.stringify(v));
    return this.backend.read(fn, fn === "marks" ? [args[0], args[1], this.ctx.persistence?.store.path ?? ""] : args, true) as Promise<string>;
  }
}
