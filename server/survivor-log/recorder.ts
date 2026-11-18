// The tick thread's half of the survivor log. It encodes each survivor's samples into a buffer of its own and gathers
// sessions and inventory changes, and every few seconds hands the lot over as one batch for the store to write. Nothing
// here touches the disk.

import { Bytes, QUANTUM, difference, keyItem, seatOf } from "./format.ts";

export const EV_START = 1;
export const EV_STOP = 2;
export const EV_TEAM = 3;
export const EV_HELD = 4;

/**
 * Something that happened to survivor `idx` (a number this run gives each survivor) at `wall` and `tick`. A start has the
 * name of the session's first moment (`began`), the team and tribe, and everything held as [key, count] pairs; a change of
 * what is held has the pairs that changed, a count of 0 being gone.
 */
export type LogEvent =
  | { kind: typeof EV_START; idx: number; wall: number; tick: number; began: number; beganTick: number; team: number; tribe: string; pairs: number[] }
  | { kind: typeof EV_STOP; idx: number; wall: number; tick: number; why: string }
  | { kind: typeof EV_TEAM; idx: number; wall: number; tick: number; team: number; tribe: string }
  | { kind: typeof EV_HELD; idx: number; wall: number; tick: number; pairs: number[] };

/**
 * What the store writes at once: the window from `wall0`/`tick0` to `wall1`/`tick1`, the content ids and survivors first
 * named in it, every position sampled in it (`frame`), and what happened in it, in order.
 *
 * `frame` is the count of survivors, then for each its number, the byte length of its samples, and the samples. A
 * survivor's first sample in a frame is whole: a head of the ticks since `tick0` times 4 plus 3, the state, and x, y and z
 * in quarter metres, zig-zag. Each later one is a head of the ticks since the one before times 4, plus 2 if it moved and 1
 * if its state changed, then the state if it changed and the moves in x, y and z if it moved.
 */
export interface Batch {
  wall0: number;
  tick0: number;
  wall1: number;
  tick1: number;
  names: [number, string][];
  subjects: [number, number, string][];
  frame: Uint8Array;
  events: LogEvent[];
}

interface Subject {
  readonly idx: number;
  readonly samples: Bytes;
  count: number;
  tick: number;
  x: number;
  y: number;
  z: number;
  state: number;
  held: Map<number, number>;
}

export class LogRecorder {
  private readonly ids: readonly string[];
  private readonly named = new Set<number>();
  private readonly idxOf = new Map<number, number>();
  private readonly online = new Map<number, Subject>();
  /** Survivors that left in this window, whose samples still go in its frame. */
  private readonly gone: Subject[] = [];
  private names: [number, string][] = [];
  private subjects: [number, number, string][] = [];
  private events: LogEvent[] = [];
  private wall0: number;
  private tick0: number;

  /** `ids` names content by its index, as the registry does. */
  constructor(ids: readonly string[], wall: number, tick: number) {
    this.ids = ids;
    this.wall0 = wall;
    this.tick0 = tick;
  }

  /** Survivors in a session, by record id. */
  get size(): number {
    return this.online.size;
  }

  has(pid: number): boolean {
    return this.online.has(pid);
  }

  /** A session starts, or the log starts while it runs. `began` is when the session started, for one the log comes late to. */
  enter(pid: number, name: string, team: number, tribe: string, held: Map<number, number>, wall: number, tick: number, began = wall, beganTick = tick): void {
    if (this.online.has(pid)) return;
    let idx = this.idxOf.get(pid);
    if (idx === undefined) {
      idx = this.idxOf.size + 1;
      this.idxOf.set(pid, idx);
      this.subjects.push([idx, pid, name]);
    }
    const s: Subject = { idx, samples: new Bytes(), count: 0, tick: 0, x: 0, y: 0, z: 0, state: 0, held: new Map(held) };
    this.online.set(pid, s);
    const pairs: number[] = [];
    for (const [key, n] of held) {
      this.name(keyItem(key));
      pairs.push(key, n);
    }
    this.events.push({ kind: EV_START, idx, wall, tick, began, beganTick, team, tribe, pairs });
  }

  /** Where survivor `pid` is at `tick`, in metres, and its state (format.ts stateOf). */
  sample(pid: number, tick: number, x: number, y: number, z: number, state: number): void {
    const s = this.online.get(pid);
    if (!s) return;
    const qx = Math.round(x * QUANTUM);
    const qy = Math.round(y * QUANTUM);
    const qz = Math.round(z * QUANTUM);
    const w = s.samples;
    const seat = seatOf(state);
    if (seat >= 0) this.name(seat);
    if (s.count === 0) {
      w.u(Math.max(0, tick - this.tick0) * 4 + 3);
      w.u(state);
      w.s(qx);
      w.s(qy);
      w.s(qz);
    } else {
      const moved = qx !== s.x || qy !== s.y || qz !== s.z;
      const changed = state !== s.state;
      w.u(Math.max(0, tick - s.tick) * 4 + (moved ? 2 : 0) + (changed ? 1 : 0));
      if (changed) w.u(state);
      if (moved) {
        w.s(qx - s.x);
        w.s(qy - s.y);
        w.s(qz - s.z);
      }
    }
    s.count++;
    s.tick = tick;
    s.x = qx;
    s.y = qy;
    s.z = qz;
    s.state = state;
  }

  /** What survivor `pid` holds now, by item key. Returns whether it differed from what was last noted. */
  held(pid: number, now: Map<number, number>, wall: number, tick: number): boolean {
    const s = this.online.get(pid);
    if (!s) return false;
    const pairs = difference(s.held, now);
    if (pairs.length === 0) return false;
    for (let i = 0; i < pairs.length; i += 2) this.name(keyItem(pairs[i]!));
    s.held = new Map(now);
    this.events.push({ kind: EV_HELD, idx: s.idx, wall, tick, pairs });
    return true;
  }

  team(pid: number, team: number, tribe: string, wall: number, tick: number): void {
    const s = this.online.get(pid);
    if (s) this.events.push({ kind: EV_TEAM, idx: s.idx, wall, tick, team, tribe });
  }

  leave(pid: number, why: string, wall: number, tick: number): void {
    const s = this.online.get(pid);
    if (!s) return;
    this.online.delete(pid);
    this.events.push({ kind: EV_STOP, idx: s.idx, wall, tick, why });
    // Its samples of this window still go in the frame.
    if (s.count > 0) this.gone.push(s);
  }

  /** The next window starts at `wall` and `tick`, as the log starts again after being off. */
  resume(wall: number, tick: number): void {
    this.wall0 = wall;
    this.tick0 = tick;
  }

  /** Ends the window at `wall` and `tick` and returns what was gathered in it. */
  flush(wall: number, tick: number): Batch {
    const frame = new Bytes();
    const all = [...this.gone, ...this.online.values()].filter((s) => s.count > 0);
    frame.u(all.length);
    for (const s of all) {
      frame.u(s.idx);
      frame.u(s.samples.n);
      frame.put(s.samples.buf.subarray(0, s.samples.n));
      s.samples.n = 0;
      s.count = 0;
    }
    this.gone.length = 0;
    const batch: Batch = { wall0: this.wall0, tick0: this.tick0, wall1: Math.max(wall, this.wall0 + 1), tick1: Math.max(tick, this.tick0), names: this.names, subjects: this.subjects, frame: frame.take(), events: this.events };
    this.wall0 = batch.wall1;
    this.tick0 = batch.tick1;
    this.names = [];
    this.subjects = [];
    this.events = [];
    return batch;
  }

  private name(idx: number): void {
    if (this.named.has(idx)) return;
    this.named.add(idx);
    this.names.push([idx, this.ids[idx] ?? `#${idx}`]);
  }
}
