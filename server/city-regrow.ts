// The map's city comes back. A building that was harmed returns whole, as the map placed it, CityRegrowDays of the game's
// clock after its last harm, once nobody is near enough to see it come: no survivor within CityRegrowClearDistance,
// nothing a tribe built in its frame, no body where a piece would return, and it is not coming down. The unit is the building, so a tower
// never returns half. Broken pieces of no building return by the same clock, a chunk at a time, where their kind is
// one that breaks in forms.
//
// A cursor walks the chunks that hold changed map slots, a few a tick. What is kept is each harmed building's last harm,
// by its id, and each such chunk's, saved with the world as a sidecar. An admin resets a building, a circle or the whole
// city at once, and a client that holds a chunk so reset takes it again from its own map.

import { CHUNK_SIZE } from "../shared/coords.ts";
import { cycleTicks } from "../shared/sim/clock.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import { BUILDING_SPANS, STOREY, blankFrame, type BuildingFrame } from "../shared/world/buildings.ts";
import { frame, frameOf } from "../shared/world/frame.ts";
import { Found } from "../shared/world/structures.ts";
import type { GameServer } from "./game.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** Chunks the cursor looks at a tick. */
export const REGROW_CHUNKS = 4;
/** Metres past a frame's edge in which a built piece or a body still counts as in it. */
const MARGIN = 1;
/** Metres round a piece of no building that a body keeps it from returning into. */
const ROOM = 1;

export interface RegrowContext {
  readonly world: ServerWorld;
  readonly rules: Rules;
  readonly game: GameServer;
  /** Whether the building of this id is in doubt or coming down (server/city-collapse.ts). */
  readonly busy: (id: number) => boolean;
}

export class CityRegrow {
  private readonly ctx: RegrowContext;
  /** The tick of the last harm, by building id; and for pieces of no building by -1 - chunk. */
  private readonly last = new Map<number, number>();
  private cursor = 0;
  private readonly frame = blankFrame();
  private readonly slots: number[] = [];
  private readonly found = new Found();
  private readonly bodies: number[] = [];
  /** Chunks looked at, buildings and loose chunks healed, and slots set back, since the start. */
  looked = 0;
  buildings = 0;
  chunks = 0;
  healed = 0;
  readonly saved = { dirty: false, serialize: (): string => JSON.stringify([...this.last].flat()) };

  constructor(ctx: RegrowContext) {
    this.ctx = ctx;
  }

  /** Takes up what a save kept. */
  begin(saved: string | null): void {
    const list = JSON.parse(saved ?? "[]") as number[];
    for (let k = 0; k + 1 < list.length; k += 2) this.last.set(list[k]!, list[k + 1]!);
  }

  /** Harmed buildings and chunks remembered. */
  get kept(): number {
    return this.last.size;
  }

  /** The key the last harm of the piece in `slot` of `chunk` is kept under: its building's id, or its chunk's. */
  private key(chunk: number, slot: number): number {
    const handle = this.ctx.world.buildings?.buildingOf(chunk, slot) ?? -1;
    return handle < 0 ? -1 - chunk : this.ctx.world.buildings!.id(handle);
  }

  /** The city piece `ref` was harmed now. */
  harmed(ref: number): void {
    const { world } = this.ctx;
    const key = this.key(Math.floor(ref / 65536), ref & 0xffff);
    // A piece of no building that does not break in forms is not this clock's to bring back.
    if (key < 0 && world.reg.breakFamily[world.structs.mapKind(Math.floor(ref / 65536), ref & 0xffff)] === 0) return;
    if (this.last.get(key) === world.tick) return;
    this.last.set(key, world.tick);
    this.saved.dirty = true;
  }

  step(tick: number): void {
    const { world, rules } = this.ctx;
    const days = rules.num("CityRegrowDays");
    if (!(days > 0)) return;
    const held = world.structs.held;
    const period = days * cycleTicks(world.clock);
    for (let n = 0; n < REGROW_CHUNKS && n < held.length; n++) {
      if (this.cursor >= held.length) this.cursor = 0;
      this.look(held[this.cursor++]!, tick, period);
    }
  }

  /** Heals what is due of the changed map slots of `chunk`: each building once, and the pieces of none together. */
  private look(chunk: number, tick: number, period: number): void {
    const { world } = this.ctx;
    const structs = world.structs;
    const t = structs.chunks[chunk];
    this.looked++;
    if (!t || t.changed === 0) return;
    const seen = new Set<number>();
    for (const slot of structs.changedSlots(chunk)) {
      if (t.owner[slot] !== 0) continue;
      const key = this.key(chunk, slot);
      if (seen.has(key) || (key < 0 && world.reg.breakFamily[structs.mapKind(chunk, slot)] === 0)) continue;
      seen.add(key);
      let at = this.last.get(key);
      if (at === undefined) {
        // Changed before anything was kept of it: its clock starts now.
        this.last.set(key, (at = tick));
        this.saved.dirty = true;
      }
      if (tick - at < period) continue;
      if (key >= 0) {
        if (this.clear(key)) this.heal(key);
      } else this.healLoose(chunk);
    }
  }

  /** Every sector's handle of the building `id`. */
  private handles(id: number): number[] {
    const buildings = this.ctx.world.buildings!;
    const first = buildings.byId(id);
    if (first < 0) return [];
    if ((buildings.flags(first) & BUILDING_SPANS) === 0) return [first];
    const all: number[] = [];
    buildings.byId(id, all);
    return all;
  }

  /** Whether (x, z) is within `past` metres of frame `f`'s rectangle. */
  private inFrame(f: BuildingFrame, x: number, z: number, past: number): boolean {
    const dx = x - f.x, dz = z - f.z;
    return Math.abs(dx * f.c - dz * f.s) <= (f.cols * f.bay) / 2 + past && Math.abs(dx * f.s + dz * f.c) <= (f.rows * f.bay) / 2 + past;
  }

  /** Whether a survivor is within `range` metres of the circle of `reach` round (x, z): one in the world, or one whose body lies there. */
  private watched(x: number, z: number, reach: number, range: number): boolean {
    const { world, game } = this.ctx;
    const ents = world.ents, far = reach + range;
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      const bx = c.ent >= 0 ? ents.x[c.ent]! : c.body.x, bz = c.ent >= 0 ? ents.z[c.ent]! : c.body.z;
      if ((bx - x) * (bx - x) + (bz - z) * (bz - z) <= far * far) return true;
    }
    return false;
  }

  /**
   * Whether the building `id` may return now: it is not coming down, no survivor is within CityRegrowClearDistance of its
   * frame, nothing a tribe built stands in the frame, and no living body is where a piece would return.
   */
  clear(id: number): boolean {
    const { world, rules, busy } = this.ctx;
    const handles = this.handles(id);
    if (handles.length === 0 || busy(id)) return false;
    const f = world.buildings!.frame(handles[0]!, this.frame);
    const reach = Math.sqrt(f.cols * f.cols + f.rows * f.rows) * f.bay * 0.5;
    if (this.watched(f.x, f.z, reach, rules.num("CityRegrowClearDistance"))) return false;
    const { dims, structs, ents, reg } = world;
    const top = f.base + (world.buildings!.storeys(handles[0]!) + 2) * STOREY;
    const far = reach + MARGIN;
    const bodies = this.bodies;
    bodies.length = 0;
    for (let cz = Math.max(0, Math.floor((f.z - far) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((f.z + far) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((f.x - far) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((f.x + far) / CHUNK_SIZE)); cx++) {
        const chunk = cz * dims.chunksX + cx;
        const t = structs.chunks[chunk];
        // What differs past the changed map slots is what was built here.
        if (t && t.differs !== t.changed) for (let s = t.mapped; s < t.high; s++) if (t.kind[s] !== 0 && this.inFrame(f, t.x[s]!, t.z[s]!, MARGIN)) return false;
        for (let e = ents.chunkHead[chunk]!; e >= 0; e = ents.next[e]!) {
          if ((ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) === F_ALIVE && ents.y[e]! > f.base - STOREY && ents.y[e]! < top && this.inFrame(f, ents.x[e]!, ents.z[e]!, MARGIN)) bodies.push(e);
        }
      }
    }
    if (bodies.length === 0) return true;
    // A body where a piece would return keeps the building away: within the piece's reach, at its height.
    let taken = false;
    for (const handle of handles) {
      world.buildings!.eachRun(handle, (chunk, slot, count) => {
        const t = structs.chunks[chunk];
        for (let s = slot; t && s < slot + count && !taken; s++) {
          const kind = structs.mapKind(chunk, s);
          if (t.kind[s] === kind) continue;
          const [low, high] = [t.y[s]! + structs.low[kind]!, t.y[s]! + structs.top[kind]!];
          for (const e of bodies) {
            const room = structs.spread[kind]! + reg.bodyRadius[ents.kind[e]!]! + ROOM;
            const dx = ents.x[e]! - t.x[s]!, dz = ents.z[e]! - t.z[s]!;
            if (dx * dx + dz * dz < room * room && ents.y[e]! < high && ents.y[e]! + reg.bodyHeight[ents.kind[e]!]! > low) taken = true;
          }
        }
      });
    }
    return !taken;
  }

  /** Sets every map slot of the building `id` back as the map placed it. Returns how many were set back. */
  heal(id: number, refill = false): number {
    const { world, game } = this.ctx;
    const buildings = world.buildings!, structs = world.structs, slots = this.slots;
    let healed = 0;
    for (const handle of this.handles(id)) {
      buildings.eachRun(handle, (chunk, slot, count) => {
        slots.length = 0;
        for (let s = slot; s < slot + count; s++) if (!structs.asMap(chunk, s)) slots.push(s);
        if (slots.length === 0) return;
        healed += structs.heal(chunk, slots);
        if (refill) game.replication.refill(chunk);
      });
    }
    if (this.last.delete(id)) this.saved.dirty = true;
    if (healed > 0) this.buildings++;
    this.healed += healed;
    return healed;
  }

  /**
   * Sets back the changed map slots of `chunk` that are no building's and nobody's, where no survivor is within
   * CityRegrowClearDistance of the chunk and no body is in the piece's room. With `force`, whoever is near, and only
   * the pieces within `radius` metres of (x, z). Returns how many.
   */
  healLoose(chunk: number, force = false, x = 0, z = 0, radius = Infinity): number {
    const { world, rules, game } = this.ctx;
    const { dims, structs, ents } = world;
    const t = structs.chunks[chunk];
    if (!t || t.changed === 0) return 0;
    const cx = chunk % dims.chunksX, cz = Math.floor(chunk / dims.chunksX);
    if (!force && this.watched((cx + 0.5) * CHUNK_SIZE, (cz + 0.5) * CHUNK_SIZE, CHUNK_SIZE * Math.SQRT1_2, rules.num("CityRegrowClearDistance"))) return 0;
    const slots = this.slots;
    slots.length = 0;
    let left = 0;
    for (const slot of structs.changedSlots(chunk)) {
      if (t.owner[slot] !== 0 || (world.buildings?.buildingOf(chunk, slot) ?? -1) >= 0) continue;
      // Only what breaks in forms: a lamp a car felled and a door left open are others' to set back.
      if (world.reg.breakFamily[structs.mapKind(chunk, slot)] === 0) continue;
      // Past an admin's circle it is left, and keeps its clock.
      if ((t.x[slot]! - x) * (t.x[slot]! - x) + (t.z[slot]! - z) * (t.z[slot]! - z) > radius * radius) {
        left++;
        continue;
      }
      // A body where the piece would stand keeps it away this time.
      const reach = structs.spread[structs.mapKind(chunk, slot)]! + ROOM;
      let taken = false;
      for (let nz = Math.max(0, cz - 1); nz <= Math.min(dims.chunksZ - 1, cz + 1) && !taken && !force; nz++) {
        for (let nx = Math.max(0, cx - 1); nx <= Math.min(dims.chunksX - 1, cx + 1) && !taken; nx++) {
          for (let e = ents.chunkHead[nz * dims.chunksX + nx]!; e >= 0; e = ents.next[e]!) {
            const dx = ents.x[e]! - t.x[slot]!, dz = ents.z[e]! - t.z[slot]!;
            if ((ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) === F_ALIVE && dx * dx + dz * dz < reach * reach) taken = true;
          }
        }
      }
      // So does anything built there: a foundation laid where a wreck stood.
      if (taken || (!force && this.built(chunk, slot))) left++;
      else slots.push(slot);
    }
    const healed = slots.length > 0 ? structs.heal(chunk, slots) : 0;
    if (force && healed > 0) game.replication.refill(chunk);
    if (left === 0 && this.last.delete(-1 - chunk)) this.saved.dirty = true;
    if (healed > 0) this.chunks++;
    this.healed += healed;
    return healed;
  }

  /** Whether something a tribe built stands in the room the map's piece of `slot` in `chunk` would take back. */
  private built(chunk: number, slot: number): boolean {
    const structs = this.ctx.world.structs;
    const t = structs.chunks[chunk]!;
    const kind = structs.mapKind(chunk, slot);
    const [x, y, z] = [t.x[slot]!, t.y[slot]!, t.z[slot]!];
    frameOf(t.yaw[slot]!);
    const [c, s] = [Math.abs(frame.cos), Math.abs(frame.sin)];
    const ex = c * structs.halfXOf(kind) + s * structs.halfZOf(kind), ez = s * structs.halfXOf(kind) + c * structs.halfZOf(kind);
    const [low, top] = [y + structs.low[kind]!, y + structs.top[kind]!];
    const n = structs.query(x - ex, z - ez, x + ex, z + ez, this.found, low, top);
    for (let k = 0; k < n; k++) {
      const other = this.found.refs[k]!;
      const u = structs.chunks[Math.floor(other / 65536)]!, o = other & 0xffff;
      // The map's own pieces beside it stood there with it.
      if (o < u.mapped || u.kind[o] === 0) continue;
      const theirs = u.kind[o]!;
      if (u.y[o]! + structs.top[theirs]! <= low || u.y[o]! + structs.low[theirs]! >= top) continue;
      frameOf(u.yaw[o]!);
      const [uc, us] = [Math.abs(frame.cos), Math.abs(frame.sin)];
      const ux = uc * structs.halfXOf(theirs) + us * structs.halfZOf(theirs), uz = us * structs.halfXOf(theirs) + uc * structs.halfZOf(theirs);
      if (Math.abs(u.x[o]! - x) < ex + ux && Math.abs(u.z[o]! - z) < ez + uz) return true;
    }
    return false;
  }

  /**
   * An admin's reset: every changed building with a piece within `radius` metres of (x, z), and the loose pieces
   * there, set back now whoever is near; with no radius, the whole city. A building coming down is left to
   * finish. Returns the buildings and the slots set back.
   */
  reset(x = 0, z = 0, radius = Infinity): { buildings: number; slots: number } {
    const { world, busy } = this.ctx;
    const { dims, structs } = world;
    const done = new Set<number>();
    let slots = 0;
    for (const chunk of [...structs.held]) {
      const t = structs.chunks[chunk]!;
      if (t.changed === 0) continue;
      const cx = chunk % dims.chunksX, cz = Math.floor(chunk / dims.chunksX);
      const nx = Math.max(cx * CHUNK_SIZE, Math.min((cx + 1) * CHUNK_SIZE, x)), nz = Math.max(cz * CHUNK_SIZE, Math.min((cz + 1) * CHUNK_SIZE, z));
      if ((nx - x) * (nx - x) + (nz - z) * (nz - z) > radius * radius) continue;
      for (const slot of [...structs.changedSlots(chunk)]) {
        const key = this.key(chunk, slot);
        if (key < 0 || done.has(key) || t.owner[slot] !== 0) continue;
        if ((t.x[slot]! - x) * (t.x[slot]! - x) + (t.z[slot]! - z) * (t.z[slot]! - z) > radius * radius) continue;
        done.add(key);
        if (!busy(key)) slots += this.heal(key, true);
      }
      slots += this.healLoose(chunk, true, x, z, radius);
    }
    return { buildings: done.size, slots };
  }
}
