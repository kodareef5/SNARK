// A client-only picture of structures collapsing. It decides nothing and collides with nothing. A city piece is thrown
// as its break set, each group where fragments.ts puts it by the time since the server's tick. Any other piece drops
// whole from when it is heard of, in a front moving outward from where the collapse began. Only the nearest the eye are kept.

import type { Registry } from "../../shared/content/registry.ts";
import { TICK_DT, TICK_RATE, YAW_UNITS } from "../../shared/coords.ts";
import { sortF64 } from "../../shared/sort.ts";
import { Found, GONE_BLAST, GONE_DESTROYED, GONE_FELL, type StructureStore } from "../../shared/world/structures.ts";
import { BreakSets, GRAVITY, MOST_GROUPS, POSE, fragmentPose, type BreakSet, type Broken } from "./fragments.ts";
import { MAX_FALLING } from "./render/packet.ts";
import type { Rubble } from "./session.ts";

/** Metres per second squared. */
export const FALL_GRAVITY = GRAVITY;
/** A piece waits this long per metre it is farther from the origin than the nearest piece of its removal. The front moves at 40 m/s. */
export const FRONT_MS_PER_METRE = 25;
/** The longest a whole piece waits, and the longest a piece in fragments does: a tower's front runs on past the first. */
export const MAX_WAIT_MS = 600;
export const MAX_FRONT_MS = 1500;
/** A whole piece's drift away from the collapse origin in metres per second, and the most it turns in yaw units per second. */
const DRIFT = 0.9;
const SPIN = YAW_UNITS / 12;
/** A whole piece still in the air after this long is dropped. */
const MAX_LIFE_MS = 4000;
/** Seconds fragments take to shrink out once their time is up. */
export const SHRINK = 0.4;
/** A break heard of this many seconds after its tick is not shown. */
const TOO_LATE = 30;
/** A blast whose centre is within its reach and this of a piece changing form in the same frame is what broke it. */
const BLAST_NEAR = 6;
/** Floors found by a ray in one frame. Past them a floor is the ground's height. */
export const FLOOR_RAYS = 64;
/** A ray for a floor starts this far over the underside it is for. */
const RAY_LIFT = 0.3;
/** Floors a piece keeps: one a group, then the whole set's. */
const FLOORS = MOST_GROUPS + 1;

/** What it takes to throw city pieces as their break sets. Without it every piece falls whole. */
export interface FallingCity {
  reg: Registry;
  /** The top of what is solid under (x, y, z), structures and ground, or `y` from inside something. Without it floors are the ground's. */
  floorUnder?(x: number, y: number, z: number): number;
  /** The store a row that changed form is found in again, for its turn and its slot. */
  structs?: StructureStore;
  /** The kind the map placed in a slot (ClientSession.mapKind). */
  mapKind?(chunk: number, slot: number): number;
}

const pose = new Float64Array(POSE.length);

export class Falling {
  /** Pieces kept. One with no set falls whole and is where x, y, z and yaw say, in metres and yaw units. */
  count = 0;
  /** What each was as it went, and what the map placed there: 0 for a piece that is not the map's. */
  readonly kind = new Uint16Array(MAX_FALLING);
  readonly map = new Uint16Array(MAX_FALLING);
  readonly sets: (BreakSet | null)[] = new Array<BreakSet | null>(MAX_FALLING).fill(null);
  readonly x = new Float32Array(MAX_FALLING);
  readonly y = new Float32Array(MAX_FALLING);
  readonly z = new Float32Array(MAX_FALLING);
  readonly yaw = new Uint16Array(MAX_FALLING);
  /** Where each stood. */
  readonly x0 = new Float64Array(MAX_FALLING);
  readonly y0 = new Float64Array(MAX_FALLING);
  readonly z0 = new Float64Array(MAX_FALLING);
  /** Pieces taken in since the start, and how many were dropped for lack of room. */
  taken = 0;
  dropped = 0;
  /** The most kept, and the seconds after a break by which its fragments shrink out once they lie still: the tier's. */
  most = MAX_FALLING;
  rest = 5;
  /** The clock of the last step, in ticks. */
  clock = 0;
  /** The pieces nearest the eye first, as `order` left them. */
  readonly sorted = new Uint16Array(MAX_FALLING);
  readonly breakSets: BreakSets | null;

  private readonly yaw0 = new Uint16Array(MAX_FALLING);
  private readonly cause = new Uint8Array(MAX_FALLING);
  private readonly ox = new Float64Array(MAX_FALLING);
  private readonly oy = new Float64Array(MAX_FALLING);
  private readonly oz = new Float64Array(MAX_FALLING);
  private readonly radius = new Float32Array(MAX_FALLING);
  /** The tick a piece's fragments count from, and the seconds after it at which it lets go. */
  private readonly born = new Float64Array(MAX_FALLING);
  private readonly wait = new Float32Array(MAX_FALLING);
  // A whole piece: when it lets go, in milliseconds, its drift and spin, and the height of its middle at which the ground covers all of it.
  private readonly start = new Float64Array(MAX_FALLING);
  private readonly vx = new Float32Array(MAX_FALLING);
  private readonly vz = new Float32Array(MAX_FALLING);
  private readonly spin = new Float32Array(MAX_FALLING);
  private readonly low = new Float32Array(MAX_FALLING);
  // A piece in fragments: the floor under its place, the floors its groups land on, which of those are found (1 the
  // whole set's, 2 every group's), and the seconds after its tick by which all found so far lie still.
  private readonly under = new Float32Array(MAX_FALLING);
  private readonly floors = new Float32Array(MAX_FALLING * FLOORS);
  private readonly floored = new Uint8Array(MAX_FALLING);
  private readonly settle = new Float32Array(MAX_FALLING);
  /** Scratch: how far each piece is from the eye, squared, and the keys `order` sorts. */
  private readonly off = new Float64Array(MAX_FALLING);
  private readonly keys = new Float64Array(MAX_FALLING);
  private measured = false;
  private far = -1;
  private farAt = -1;
  private rays = FLOOR_RAYS;
  /** Rows that changed form since the last absorb, five numbers each: what it was, what it is, its place. */
  private readonly swaps: number[] = [];
  private readonly halfY: Float32Array;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly city: FallingCity | null;
  private readonly nearest = new Map<number, number>();
  private readonly found = new Found(64);
  /** Scratch for `broken`. Its set is a piece's own before anything reads it. */
  private readonly entry: Broken = { cause: 0, x: 0, y: 0, z: 0, yaw: 0, ox: 0, oy: 0, oz: 0, radius: 0, wait: 0, under: 0, set: null as unknown as BreakSet };

  /** `halfY` is the half height of each kind of structure, by content index. */
  constructor(halfY: Float32Array, heightAt: (x: number, z: number) => number, city: FallingCity | null = null) {
    this.halfY = halfY;
    this.heightAt = heightAt;
    this.city = city;
    this.breakSets = city ? new BreakSets(city.reg) : null;
  }

  /** A row turned from `was` into `kind` at (x, y, z), as the session tells it (onStructure). What leaves a city piece taking a form is thrown at the next absorb. */
  swap(was: number, kind: number, x: number, y: number, z: number, cause: number): void {
    if (cause !== -1 || was === 0 || kind === 0 || was === kind || !this.breakSets?.swap(was, kind)) return;
    this.swaps.push(was, kind, x, y, z);
  }

  /**
   * Empties `list` and the rows that changed form. `tick` is the session's clock in ticks, which fragments count from
   * their break's tick by. If there is not room for all, the pieces nearest the eye (ex, ey, ez) are kept.
   */
  absorb(list: Rubble[], nowMs: number, ex: number, ey: number, ez: number, tick = (nowMs / 1000) * TICK_RATE): void {
    this.rays = FLOOR_RAYS;
    if (list.length === 0 && this.swaps.length === 0) return;
    // Pieces of one removal share a tick. `nearest` maps that tick to the distance of its nearest piece from the origin.
    const nearest = this.nearest;
    nearest.clear();
    let first = Infinity;
    for (const r of list) {
      if (r.tick < first) first = r.tick;
      const d = Math.hypot(r.x - r.ox, r.y - r.oy, r.z - r.oz);
      const known = nearest.get(r.tick);
      if (known === undefined || d < known) nearest.set(r.tick, d);
    }
    this.measured = false;
    this.far = this.farAt = -1;
    for (const r of list) {
      const set = this.breakSets?.rubble(r.kind, r.map, r.x, r.y, r.z) ?? null;
      const fell = r.cause === GONE_FELL;
      const front = fell ? (Math.hypot(r.x - r.ox, r.y - r.oy, r.z - r.oz) - nearest.get(r.tick)!) * FRONT_MS_PER_METRE : 0;
      // Fragments count from the server's tick. A whole piece counts from now, later by its tick's place among those that came with it.
      const wait = set ? Math.min(MAX_FRONT_MS, front) : Math.min(MAX_WAIT_MS, front + (fell ? (r.tick - first) * TICK_DT * 1000 : 0));
      this.take(r.tick, tick, nowMs, wait, r.kind, r.map, r.x, r.y, r.z, r.yaw, r.cause, r.ox, r.oy, r.oz, r.radius, set, ex, ey, ez);
    }
    const swaps = this.swaps;
    for (let s = 0; s < swaps.length; s += 5) {
      const was = swaps[s]!, kind = swaps[s + 1]!, x = swaps[s + 2]!, y = swaps[s + 3]!, z = swaps[s + 4]!;
      const ref = this.rowAt(kind, x, y, z);
      const set = ref < 0 ? null : this.breakSets!.swap(was, kind);
      if (!set) continue;
      const t = this.city!.structs!.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      const placed = this.city!.mapKind?.(Math.floor(ref / 65536), slot) ?? 0;
      // The blast that came with it broke it; without one it crumbles where it stands.
      let blast: Rubble | null = null;
      for (const r of list) {
        if (r.cause !== GONE_BLAST || Math.hypot(r.ox - x, r.oy - y, r.oz - z) > r.radius + BLAST_NEAR) continue;
        blast = r;
        break;
      }
      const map = placed !== 0 ? placed : this.city!.reg.breakForm[was] === 0 ? was : kind;
      if (blast) this.take(blast.tick, tick, nowMs, 0, kind, map, x, y, z, t.yaw[slot]!, GONE_BLAST, blast.ox, blast.oy, blast.oz, blast.radius, set, ex, ey, ez);
      else this.take(tick, tick, nowMs, 0, kind, map, x, y, z, t.yaw[slot]!, GONE_DESTROYED, x, y, z, 0, set, ex, ey, ez);
    }
    swaps.length = 0;
    list.length = 0;
  }

  /** The ref of the city piece of `kind` at exactly (x, y, z), or -1. */
  private rowAt(kind: number, x: number, y: number, z: number): number {
    const structs = this.city?.structs;
    if (!structs) return -1;
    const n = structs.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, this.found);
    for (let i = 0; i < n; i++) {
      const ref = this.found.refs[i]!, t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      if (t.kind[slot] === kind && t.owner[slot] === 0 && t.x[slot] === x && t.y[slot] === y && t.z[slot] === z) return ref;
    }
    return -1;
  }

  /** `born` is the break's tick, `tick` and `nowMs` are now, and `wait` is in milliseconds. */
  private take(born: number, tick: number, nowMs: number, wait: number, kind: number, map: number, x: number, y: number, z: number, yaw: number, cause: number, ox: number, oy: number, oz: number, radius: number, set: BreakSet | null, ex: number, ey: number, ez: number): void {
    this.taken++;
    if (set && (tick - born) / TICK_RATE > TOO_LATE) return;
    const d2 = (x - ex) * (x - ex) + (y - ey) * (y - ey) + (z - ez) * (z - ez);
    const most = Math.min(this.most, MAX_FALLING), off = this.off;
    let i = this.count;
    if (i >= most) {
      // No room. It replaces the farthest piece kept if it is nearer. How far each is, is worked out once.
      if (!this.measured) {
        for (let k = 0; k < i; k++) off[k] = (this.x0[k]! - ex) * (this.x0[k]! - ex) + (this.y0[k]! - ey) * (this.y0[k]! - ey) + (this.z0[k]! - ez) * (this.z0[k]! - ez);
        this.measured = true;
      }
      if (this.farAt < 0) {
        for (let k = 0; k < i; k++) {
          if (off[k]! > this.far) {
            this.far = off[k]!;
            this.farAt = k;
          }
        }
      }
      this.dropped++;
      if (this.farAt < 0 || d2 >= this.far) return;
      i = this.farAt;
      this.far = this.farAt = -1;
    } else this.count++;
    off[i] = d2;
    const dx = x - ox, dz = z - oz, flat = Math.hypot(dx, dz), fell = cause === GONE_FELL;
    this.kind[i] = kind;
    this.map[i] = map;
    this.sets[i] = set;
    this.x0[i] = x;
    this.y0[i] = y;
    this.z0[i] = z;
    this.yaw0[i] = yaw;
    this.cause[i] = cause;
    this.ox[i] = ox;
    this.oy[i] = oy;
    this.oz[i] = oz;
    this.radius[i] = radius;
    this.born[i] = born;
    this.wait[i] = wait / 1000;
    this.start[i] = nowMs + wait;
    // The spin is hashed from the position, so a piece turns the same way on every client.
    const h = (Math.imul(Math.round(x * 8), 73856093) ^ Math.imul(Math.round(y * 8), 19349663) ^ Math.imul(Math.round(z * 8), 83492791)) >>> 0;
    this.vx[i] = fell && flat > 0.01 ? (dx / flat) * DRIFT : 0;
    this.vz[i] = fell && flat > 0.01 ? (dz / flat) * DRIFT : 0;
    this.spin[i] = ((h % 2001) / 1000 - 1) * SPIN;
    this.low[i] = this.heightAt(x, z) - (this.halfY[kind] ?? 0);
    this.floored[i] = 0;
    this.settle[i] = 0;
    if (!set) return;
    // The floor it stood on is no higher than its foot: a ray from inside what took its place says nothing.
    const n = set.groups.length, foot = y + set.boxes[n * 6 + 1]! - set.boxes[n * 6 + 4]!;
    this.under[i] = Math.min(foot, this.floor(x, foot + RAY_LIFT, z, foot));
    this.land(i, false);
  }

  /** The floor under (x, y, z), or `blocked` where the ray starts inside something. */
  private floor(x: number, y: number, z: number, blocked: number): number {
    const under = this.city?.floorUnder;
    if (!under || this.rays <= 0) return this.heightAt(x, z);
    this.rays--;
    const top = under(x, y, z);
    return top > y - 0.02 ? blocked : top;
  }

  /** Finds the floors piece `i` lands on, once: the whole set's, and with `groups` each group's. */
  land(i: number, groups: boolean): void {
    const want = groups ? 2 : 1, had = this.floored[i]!;
    if (had >= want) return;
    const e = this.broken(i), boxes = e.set.boxes, n = e.set.groups.length;
    for (let g = groups ? 0 : n; g <= n; g++) {
      if (g === n && had >= 1) continue;
      // Where it would lie were the floor level with the piece's, and then the floor there.
      fragmentPose(e, g, e.under, Infinity, pose);
      const top = this.floor(pose[POSE.centre]!, e.y + boxes[g * 6 + 1]! - boxes[g * 6 + 4]! + RAY_LIFT, pose[POSE.centre + 2]!, e.under);
      this.floors[i * FLOORS + (g === n ? MOST_GROUPS : g)] = top;
      fragmentPose(e, g, top, Infinity, pose);
      if (pose[POSE.settled]! > this.settle[i]!) this.settle[i] = pose[POSE.settled]!;
    }
    this.floored[i] = want;
  }

  /** Piece `i`, which has a set, as a group's pose is worked out from it. The same object each time. */
  broken(i: number): Broken {
    const e = this.entry;
    e.cause = this.cause[i]!;
    e.x = this.x0[i]!;
    e.y = this.y0[i]!;
    e.z = this.z0[i]!;
    e.yaw = this.yaw0[i]!;
    e.ox = this.ox[i]!;
    e.oy = this.oy[i]!;
    e.oz = this.oz[i]!;
    e.radius = this.radius[i]!;
    e.wait = this.wait[i]!;
    e.under = this.under[i]!;
    e.set = this.sets[i]!;
    return e;
  }

  /** The floor group `g` of piece `i` lands on, or with `g` its set's count the whole set's. `land` finds it first. */
  floorOf(i: number, g: number): number {
    return this.floors[i * FLOORS + (g === this.sets[i]!.groups.length ? MOST_GROUPS : g)]!;
  }

  /** How far from where piece `i` stood its fragments go, level; and how far its floor is under where it stood. */
  reach(i: number): number {
    const set = this.sets[i]!, w = set.groups.length * 6;
    return Math.hypot(set.boxes[w]!, set.boxes[w + 1]!, set.boxes[w + 2]!) + Math.hypot(set.boxes[w + 3]!, set.boxes[w + 4]!, set.boxes[w + 5]!) + (this.cause[i] === GONE_BLAST ? 8 : 5);
  }

  drop(i: number): number {
    return Math.max(0, this.y0[i]! - this.under[i]!);
  }

  /** Seconds since piece `i`'s tick, as of the last step. */
  since(i: number): number {
    return (this.clock - this.born[i]!) / TICK_RATE;
  }

  /** The share of its size piece `i`'s fragments are drawn at: 1 until its time is up, then down to 0 over SHRINK. */
  share(i: number): number {
    const over = this.since(i) - Math.max(this.rest, this.settle[i]!);
    return over <= 0 ? 1 : over >= SHRINK ? 0 : 1 - over / SHRINK;
  }

  /** Puts the pieces in `sorted`, nearest the eye first. How many there are. */
  order(ex: number, ey: number, ez: number): number {
    const keys = this.keys, n = this.count;
    for (let i = 0; i < n; i++) {
      const d2 = (this.x0[i]! - ex) * (this.x0[i]! - ex) + (this.y0[i]! - ey) * (this.y0[i]! - ey) + (this.z0[i]! - ez) * (this.z0[i]! - ez);
      keys[i] = Math.floor(Math.min(d2, 1e9) * 64) * MAX_FALLING + i;
    }
    sortF64(keys, 0, n);
    for (let k = 0; k < n; k++) this.sorted[k] = keys[k]! % MAX_FALLING;
    return n;
  }

  /** Moves the whole pieces and forgets what is over. `tick` is the session's clock in ticks. */
  step(nowMs: number, tick = (nowMs / 1000) * TICK_RATE): void {
    this.clock = tick;
    this.rays = FLOOR_RAYS;
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const ms = nowMs - this.start[i]!;
      const t = ms > 0 ? ms / 1000 : 0;
      const y = this.y0[i]! - 0.5 * FALL_GRAVITY * t * t;
      if (this.sets[i] ? (tick - this.born[i]!) / TICK_RATE > Math.max(this.rest, this.settle[i]!) + SHRINK : y < this.low[i]! || ms > MAX_LIFE_MS) continue;
      if (kept !== i) this.move(i, kept);
      this.x[kept] = this.x0[kept]! + this.vx[kept]! * t;
      this.y[kept] = y;
      this.z[kept] = this.z0[kept]! + this.vz[kept]! * t;
      this.yaw[kept] = (this.yaw0[kept]! + Math.round(this.spin[kept]! * t)) & (YAW_UNITS - 1);
      kept++;
    }
    for (let i = kept; i < this.count; i++) this.sets[i] = null;
    this.count = kept;
  }

  private move(from: number, to: number): void {
    this.kind[to] = this.kind[from]!;
    this.map[to] = this.map[from]!;
    this.sets[to] = this.sets[from]!;
    this.x0[to] = this.x0[from]!;
    this.y0[to] = this.y0[from]!;
    this.z0[to] = this.z0[from]!;
    this.yaw0[to] = this.yaw0[from]!;
    this.cause[to] = this.cause[from]!;
    this.ox[to] = this.ox[from]!;
    this.oy[to] = this.oy[from]!;
    this.oz[to] = this.oz[from]!;
    this.radius[to] = this.radius[from]!;
    this.born[to] = this.born[from]!;
    this.wait[to] = this.wait[from]!;
    this.start[to] = this.start[from]!;
    this.vx[to] = this.vx[from]!;
    this.vz[to] = this.vz[from]!;
    this.spin[to] = this.spin[from]!;
    this.low[to] = this.low[from]!;
    this.under[to] = this.under[from]!;
    this.floored[to] = this.floored[from]!;
    this.settle[to] = this.settle[from]!;
    this.floors.copyWithin(to * FLOORS, from * FLOORS, (from + 1) * FLOORS);
  }
}
