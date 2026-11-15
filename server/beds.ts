// Where a survivor without a body may rise: the map's spawn points, then its tribe's beds. Why it chooses (it died, it arrived
// from another server, it travels from a bed) is a parameter of the list and of the rising, and changes only what rising does
// to the survivor. Every place is judged again when it is chosen, so a bed taken, destroyed or built over meanwhile is refused.

import { RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_STALE, RESULT_WAIT } from "../shared/net/protocol.ts";
import { TICK_RATE } from "../shared/coords.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";
import { event, type Bus } from "./events/bus.ts";

const SESSION_RESPAWN = event("session.respawn");

/** A place is chosen by one byte, so that is how many a list holds: the map's spawn points first. */
export const MAX_PLACES = 255;
/** In ticks. After a survivor rises at a bed, nobody may rise there for this long. */
export const BED_WAIT_TICKS = 5 * 60 * TICK_RATE;

export interface Place {
  /** The bed's structure kind, or 0 for a spawn point. */
  kind: number;
  /** The bed's structure ref and its record's id, or -1 and 0 for a spawn point. */
  ref: number;
  pid: number;
  name: string;
  x: number;
  /** NaN for a spawn point: a body is put on the ground around it. */
  y: number;
  z: number;
  yaw: number;
  /** The tick it may be risen at from, 0 for now. */
  readyAt: number;
}

export interface BedsContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly tribes: Tribes;
  readonly fixtures: Fixtures;
  readonly bus: Bus;
  /** Puts the session's survivor in the world at a place, as `why` has it. Returns a RESULT code. */
  rise(c: Client, place: Place, why: number): number;
}

export class Beds {
  /** Counts every change to any bed. A survivor choosing is sent its list again after one. */
  version = 0;
  private readonly ctx: BedsContext;

  constructor(ctx: BedsContext) {
    this.ctx = ctx;
  }

  /** The bed whose record is `rec`, as a place, or null if its structure is gone or is no bed. */
  private placeOf(ref: number, rec: EntityRecord): Place | null {
    const world = this.ctx.world;
    const t = world.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high) return null;
    const kind = t.kind[slot]!;
    if (world.reg.isBed[kind] !== 1) return null;
    // The survivor rises on top of the bed, facing the way it does.
    return { kind, ref, pid: rec.pid, name: rec.name, x: t.x[slot]!, y: t.y[slot]! + world.reg.halfY[kind]!, z: t.z[slot]!, yaw: (t.yaw[slot]! / 65536) * 2 * Math.PI, readyAt: rec.readyAt > world.tick ? rec.readyAt : 0 };
  }

  /** Where `rec` may rise: the map's spawn points, then the beds of its tribe, at most MAX_PLACES in all. */
  places(rec: EntityRecord, _why: number): Place[] {
    const { world, fixtures, tribes } = this.ctx;
    const out: Place[] = world.spawns.map((p) => ({ kind: 0, ref: -1, pid: 0, name: p.name, x: p.x, y: NaN, z: p.z, yaw: p.yaw, readyAt: 0 }));
    fixtures.each((ref, bed) => {
      if (out.length >= MAX_PLACES) return;
      const t = world.structs.chunks[Math.floor(ref / 65536)]!;
      if (!tribes.may(rec, t.owner[ref & 0xffff]!)) return;
      const place = this.placeOf(ref, bed);
      if (place) out.push(place);
    });
    return out;
  }

  /** The survivor of `c` rises at the place its list `list` has at `index`. Returns a RESULT code. */
  choose(c: Client, index: number, list: number): number {
    const p = c.respawnAt[index];
    if (list !== c.placesList || c.sentPlaces < 0) return RESULT_STALE;
    if (!p) return RESULT_INVALID;
    // A module may refuse the place, or make the survivor wait: `wait` is seconds, and more than none refuses for now.
    const asked = { pid: c.pid, bed: p.ref, wait: Math.max(0, Math.ceil(((this.ctx.fixtures.find(p.ref)?.readyAt ?? 0) - this.ctx.world.tick) / TICK_RATE)) };
    if (this.ctx.bus.before(SESSION_RESPAWN, asked) !== "") return RESULT_DENIED;
    if (asked.wait > 0) return RESULT_WAIT;
    if (p.ref < 0) return this.ctx.rise(c, p, c.why);
    const { records, tribes, fixtures } = this.ctx;
    // The bed must still stand, as the same bed, and still be its tribe's.
    const rec = records.byPid.get(c.pid);
    const bed = fixtures.find(p.ref);
    const now = bed && bed.pid === p.pid ? this.placeOf(p.ref, bed) : null;
    if (!rec || !bed || !now || !tribes.may(rec, this.ownerOf(p.ref))) return RESULT_INVALID;
    if (now.readyAt > 0) return RESULT_WAIT;
    const code = this.ctx.rise(c, now, c.why);
    if (code === RESULT_OK) {
      bed.readyAt = this.ctx.world.tick + BED_WAIT_TICKS;
      records.dirty.add(bed.pid);
      this.version++;
    }
    return code;
  }

  private ownerOf(ref: number): number {
    const t = this.ctx.world.structs.chunks[Math.floor(ref / 65536)];
    return t ? t.owner[ref & 0xffff]! : 0;
  }
}
