// A city building comes down. When a piece that carried carries no more, its building is in doubt: after a wait in
// which more losses join and those near hear it, the building's pieces are judged for support (shared/world/bearing.ts),
// and what falls goes a wave at a time, lowest first, at a pace every client follows. Nothing is saved: after a restart
// each building with a carrier broken is judged once more.
//
// A wave is the pieces of two levels. Those that fall go as one batch a chunk with the first loss as their origin, those
// that hang take their hung form, and a fallen piece with something standing right under its foot is left as its heap.
// A chunk takes one wave in 8 ticks, so the 8 batches it keeps are every batch still news (REMOVAL_NEWS_TICKS).

import { FORM_HUNG, formKind } from "../shared/content/breaks.ts";
import { CHUNK_SIZE } from "../shared/coords.ts";
import { EVENT_GROAN, S_EVENT } from "../shared/net/protocol.ts";
import { F_ALIVE, F_HELD, F_PROP } from "../shared/sim/entities.ts";
import { BIT_GHOST, BIT_HEAP, BIT_HUNG, FALLS, HANGS, PART_FIXED, Pieces, RESTS, STANDS, VERDICT, carrier, carrying, gather, judge, pins } from "../shared/world/bearing.ts";
import { heapAt, heapHealth, variantAt } from "../shared/world/breaking.ts";
import { BUILDING_SPANS, STOREY, blankFrame } from "../shared/world/buildings.ts";
import { GONE_FELL, type Leaves } from "../shared/world/structures.ts";
import type { CityBreaks, CitySupport } from "./city-breaks.ts";
import type { GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

/** Ticks from a building's first loss to its first wave, and between its waves. */
export const FIRST_WAIT = 30, WAVE_TICKS = 8;
/** Levels a wave takes. */
export const WAVE_LEVELS = 2;
/** Pieces judged a tick at most. A building is judged whole, so the last one of a tick may go past it. */
export const JUDGEMENTS = 4000;
/** Metres a building in doubt is heard within. */
export const GROAN_HEARD = 150;
/** Health a wave takes from a body under it, before CityCollapseDamage. */
const CRUSH = 35;
/** Storeys under a wave's lowest level in which a body is still under it. */
const UNDER = 2;
/** Buildings whose pins are kept, the least lately asked for going first. */
const PINS_KEPT = 64;

export interface CollapseContext {
  readonly world: ServerWorld;
  readonly rules: Rules;
  readonly game: GameServer;
  readonly records: Records;
  readonly survival: Survival;
  readonly city: CityBreaks;
  /** Told of a piece of each building a wave took from, for the clock its return is counted by. */
  readonly harmed?: (ref: number) => void;
}

/** A building in doubt. */
interface Doubt {
  readonly id: number;
  readonly handles: number[];
  /** The tick its next wave, or its first judgement, may run. */
  due: number;
  /** Where it began: its first loss. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its pieces and what was said of each, once judged. A piece done with is set to stand. */
  plan: Pieces | null;
  verdict: Uint8Array | null;
  /** A carrier of it changed since it was judged. */
  stale: boolean;
  /** It is one of those coming down, not one waiting its turn. */
  falling: boolean;
}

export class CityCollapse implements CitySupport {
  private readonly ctx: CollapseContext;
  /** By building id, in the order they came into doubt. */
  private readonly doubts = new Map<number, Doubt>();
  private readonly pinned = new Map<number, Uint8Array>();
  /** Per chunk, the tick from which it may take another wave. */
  private readonly free = new Map<number, number>();
  private readonly placed = new Pieces();
  private readonly now = new Pieces();
  private out = new Uint8Array(1024);
  private refs = new Uint32Array(256);
  private readonly frame = blankFrame();
  private under = new Uint8Array(0);
  private readonly rest = new Set<number>();
  private coming = 0;
  /** Pieces judged in the last tick, and since the start; waves, pieces fallen and hung, bodies harmed, buildings settled. */
  spent = 0;
  judged = 0;
  waves = 0;
  fallen = 0;
  hung = 0;
  harmed = 0;
  settled = 0;

  constructor(ctx: CollapseContext) {
    this.ctx = ctx;
  }

  /** Whether buildings are judged: the map holds them, and CityCollapse is on. */
  get on(): boolean {
    return this.ctx.world.buildings !== null && this.ctx.rules.on("CityCollapse");
  }

  /** Buildings in doubt, and of them those coming down. */
  get waiting(): number {
    return this.doubts.size;
  }

  /** Whether the building of this id is in doubt. */
  doubted(id: number): boolean {
    return this.doubts.has(id);
  }

  get falling(): number {
    return this.coming;
  }

  /** Bytes held for the buildings in doubt. */
  get bytes(): number {
    let n = 0;
    for (const d of this.doubts.values()) n += 96 + d.handles.length * 8 + (d.plan?.bytes ?? 0) + (d.verdict?.byteLength ?? 0);
    return n;
  }

  changed(ref: number, going: boolean): void {
    if (!this.on) return;
    const { world } = this.ctx;
    const structs = world.structs, chunk = Math.floor(ref / 65536), slot = ref & 0xffff;
    const handle = world.buildings!.buildingOf(chunk, slot);
    const t = structs.chunks[chunk];
    if (handle < 0 || !t || slot >= t.mapped) return;
    const mapKind = structs.mapKind(chunk, slot);
    if (!carrier(world.reg, structs, mapKind) || (!going && carrying(world.reg, t.kind[slot]!))) return;
    this.doubt(handle, t.x[slot]!, t.y[slot]!, t.z[slot]!, world.tick + FIRST_WAIT, true);
  }

  /** Puts the building of `handle` in doubt from (x, y, z), or marks its plan stale. */
  private doubt(handle: number, x: number, y: number, z: number, due: number, heard: boolean): void {
    const buildings = this.ctx.world.buildings!;
    const id = buildings.id(handle);
    const was = this.doubts.get(id);
    if (was) {
      was.stale = true;
      return;
    }
    const handles: number[] = [];
    if ((buildings.flags(handle) & BUILDING_SPANS) !== 0) buildings.byId(id, handles);
    else handles.push(handle);
    this.doubts.set(id, { id, handles, due, x, y, z, plan: null, verdict: null, stale: false, falling: false });
    if (heard) this.groan(x, y, z);
  }

  /** Tells those near that a building is about to come down. */
  private groan(x: number, y: number, z: number): void {
    const { world, game } = this.ctx;
    const ents = world.ents;
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      const bx = c.ent >= 0 ? ents.x[c.ent]! : c.body.x, bz = c.ent >= 0 ? ents.z[c.ent]! : c.body.z;
      if ((bx - x) * (bx - x) + (bz - z) * (bz - z) > GROAN_HEARD * GROAN_HEARD) continue;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_GROAN);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      game.endOwn(c);
    }
  }

  /**
   * After a load: every building with a carrier that carries no more is put in doubt, to be judged within the tick's
   * budget like any other. Nothing is heard of these.
   */
  begin(): void {
    if (!this.on) return;
    const { world } = this.ctx;
    const structs = world.structs, reg = world.reg, buildings = world.buildings!;
    for (const chunk of structs.held) {
      const t = structs.chunks[chunk]!;
      if (t.changed === 0) continue;
      for (const slot of structs.changedSlots(chunk)) {
        const handle = buildings.buildingOf(chunk, slot);
        if (handle < 0 || t.owner[slot] !== 0) continue;
        if (carrier(reg, structs, structs.mapKind(chunk, slot)) && !carrying(reg, t.kind[slot]!)) this.doubt(handle, t.x[slot]!, t.y[slot]!, t.z[slot]!, world.tick, false);
      }
    }
  }

  /** A building's pins, worked out from the map the first time it is asked for. */
  private pinsOf(id: number, handles: readonly number[]): Uint8Array {
    let pin = this.pinned.get(id);
    if (pin) {
      // Asked for again, it is the last to go.
      this.pinned.delete(id);
      this.pinned.set(id, pin);
      return pin;
    }
    const { world } = this.ctx;
    const p = gather(world.buildings!, handles, world.structs, world.reg, true, this.placed);
    pin = new Uint8Array(p.n);
    pins(p, pin, this.scratch(p.n));
    this.count(p.n * 2);
    if (this.pinned.size >= PINS_KEPT) for (const old of this.pinned.keys()) {
      this.pinned.delete(old);
      break;
    }
    this.pinned.set(id, pin);
    return pin;
  }

  private scratch(n: number): Uint8Array {
    if (this.out.length < n) this.out = new Uint8Array(n * 2);
    return this.out;
  }

  private count(n: number): void {
    this.spent += n;
    this.judged += n;
  }

  resting(falls: readonly number[], going: ReadonlySet<number> | null, into: Set<number>): boolean {
    if (!this.on) return false;
    const { world, city } = this.ctx;
    const buildings = world.buildings!;
    const gone = going ?? new Set(falls);
    const done = new Set<number>();
    for (const ref of falls) {
      const handle = buildings.buildingOf(Math.floor(ref / 65536), ref & 0xffff);
      if (handle < 0) {
        if (city.rests(ref, going)) into.add(ref);
        continue;
      }
      const id = buildings.id(handle);
      if (done.has(id)) continue;
      done.add(id);
      const handles: number[] = [];
      if ((buildings.flags(handle) & BUILDING_SPANS) !== 0) buildings.byId(id, handles);
      else handles.push(handle);
      const pin = this.pinsOf(id, handles);
      const p = gather(buildings, handles, world.structs, world.reg, false, this.now, gone);
      const out = this.scratch(p.n);
      judge(p, out, pin);
      this.count(p.n);
      // Every piece of it that is going and would rest: those of `falls` are the ones asked of.
      for (let k = 0; k < p.n; k++) if ((p.bits[k]! & BIT_GHOST) !== 0 && (out[k]! & RESTS) !== 0) this.rest.add(p.ref[k]!);
    }
    for (const ref of falls) if (this.rest.has(ref)) into.add(ref);
    this.rest.clear();
    return true;
  }

  step(tick: number): void {
    this.spent = 0;
    if (this.doubts.size === 0) return;
    if (!this.on) {
      this.doubts.clear();
      this.coming = 0;
      return;
    }
    const most = this.ctx.rules.num("CityCollapseMostAtOnce");
    for (const d of this.doubts.values()) {
      if (d.due > tick) continue;
      if (!d.verdict || d.stale) {
        // Out of judgements, it waits a tick as it stands.
        if (this.spent >= JUDGEMENTS) continue;
        this.plan(d);
      }
      if (this.lowest(d) < 0) {
        this.settle(d);
        continue;
      }
      if (!d.falling) {
        if (this.coming >= most) continue;
        d.falling = true;
        this.coming++;
      }
      this.wave(d, tick);
    }
    if (this.free.size > 256) for (const [chunk, at] of this.free) if (at <= tick) this.free.delete(chunk);
  }

  /** Judges `d`'s building as it stands. */
  private plan(d: Doubt): void {
    const { world } = this.ctx;
    const pin = this.pinsOf(d.id, d.handles);
    const p = (d.plan = gather(world.buildings!, d.handles, world.structs, world.reg, false, d.plan ?? new Pieces()));
    if (!d.verdict || d.verdict.length < p.n) d.verdict = new Uint8Array(p.n);
    judge(p, d.verdict, pin);
    this.count(p.n);
    d.stale = false;
  }

  /** Whether piece `k` of `d`'s plan has still to fall (2) or to hang (1). A heap that rests lies where it is, and what hangs already hangs. */
  private todo(d: Doubt, k: number): number {
    const p = d.plan!, v = d.verdict![k]!;
    if (p.part[k] === PART_FIXED) return 0;
    if ((v & VERDICT) === FALLS) return (p.bits[k]! & BIT_HEAP) !== 0 && (v & RESTS) !== 0 ? 0 : 2;
    return (v & VERDICT) === HANGS && (p.bits[k]! & BIT_HUNG) === 0 ? 1 : 0;
  }

  /** The lowest level at which a piece of `d` has still to fall or hang, or -1. */
  private lowest(d: Doubt): number {
    const p = d.plan!;
    let low = -1;
    for (let k = 0; k < p.n; k++) if ((low < 0 || p.level[k]! < low) && this.todo(d, k) !== 0) low = p.level[k]!;
    return low;
  }

  private settle(d: Doubt): void {
    if (d.falling) this.coming--;
    this.doubts.delete(d.id);
    this.settled++;
  }

  /** One wave of `d`: its lowest two levels with something to do. Put off where a chunk it breaks in took a wave too lately. */
  private wave(d: Doubt, tick: number): void {
    const { world, city } = this.ctx;
    const structs = world.structs, reg = world.reg;
    const p = d.plan!, verdict = d.verdict!;
    const lo = this.lowest(d), hi = lo + WAVE_LEVELS;
    if (this.refs.length < p.n) this.refs = new Uint32Array(p.n);
    const refs = this.refs;
    let n = 0, wait = 0;
    for (let k = 0; k < p.n; k++) {
      if (p.level[k]! < lo || p.level[k]! >= hi || this.todo(d, k) !== 2) continue;
      refs[n++] = p.ref[k]!;
      const at = this.free.get(Math.floor(p.ref[k]! / 65536)) ?? 0;
      if (at > wait) wait = at;
    }
    if (wait > tick) {
      d.due = wait;
      return;
    }
    if (this.under.length < p.cols * p.rows) this.under = new Uint8Array(p.cols * p.rows);
    else this.under.fill(0, 0, p.cols * p.rows);
    const rest = this.rest;
    structs.hold();
    for (let k = 0; k < p.n; k++) {
      if (p.level[k]! < lo || p.level[k]! >= hi) continue;
      const todo = this.todo(d, k);
      if (todo === 0) continue;
      const ref = p.ref[k]!, chunk = Math.floor(ref / 65536), slot = ref & 0xffff;
      const t = structs.chunks[chunk]!;
      if (todo === 1) {
        const kind = formKind(reg, structs.mapKind(chunk, slot), FORM_HUNG, variantAt(t.x[slot]!, t.y[slot]!, t.z[slot]!));
        if (kind !== 0 && t.kind[slot] !== 0 && structs.swap(ref, kind)) this.hung++;
      } else {
        if ((verdict[k]! & RESTS) !== 0 && (p.bits[k]! & BIT_HEAP) === 0) rest.add(ref);
        // The tiles it comes down over.
        for (let j = Math.max(0, (p.v0[k]! - 1) >> 1); j <= Math.min(p.rows - 1, p.v1[k]! >> 1); j++) for (let i = Math.max(0, (p.u0[k]! - 1) >> 1); i <= Math.min(p.cols - 1, p.u1[k]! >> 1); i++) this.under[j * p.cols + i] = 1;
      }
      verdict[k] = STANDS;
    }
    const leaves = (ref: number, out: Leaves): void => {
      if (!rest.has(ref)) return;
      const t = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      out.kind = heapAt(reg, t.kind[slot]!, t.x[slot]!, t.y[slot]!, t.z[slot]!);
      out.hp = heapHealth(reg, out.kind);
    };
    // The refs are sorted by the break, so the chunks are read before it.
    for (let k = 0; k < n; k++) this.free.set(Math.floor(refs[k]! / 65536), tick + WAVE_TICKS);
    if (n > 0) this.fallen += structs.breakMany(refs, n, GONE_FELL, rest.size > 0 ? leaves : null, d.x, d.y, d.z, tick);
    for (const ref of rest) city.lift(ref);
    rest.clear();
    structs.release();
    if (n > 0) this.crush(d, lo, hi);
    this.ctx.harmed?.(p.ref[0]!);
    this.waves++;
    d.due = tick + WAVE_TICKS;
    if (this.lowest(d) < 0) this.settle(d);
  }

  /** Harms once each living body in `d`'s frame on a tile the wave came down over, from two storeys under it to its top. */
  private crush(d: Doubt, lo: number, hi: number): void {
    const { world, records, survival, rules } = this.ctx;
    const scale = rules.num("CityCollapseDamage");
    if (!(scale > 0)) return;
    const ents = world.ents, dims = world.dims, reg = world.reg;
    const f = world.buildings!.frame(d.handles[0]!, this.frame);
    const reach = (Math.abs(f.c) + Math.abs(f.s)) * Math.max(f.cols, f.rows) * f.bay * 0.5 + 1;
    const cx0 = Math.max(0, Math.floor((f.x - reach) / CHUNK_SIZE)), cx1 = Math.min(dims.chunksX - 1, Math.floor((f.x + reach) / CHUNK_SIZE));
    const cz0 = Math.max(0, Math.floor((f.z - reach) / CHUNK_SIZE)), cz1 = Math.min(dims.chunksZ - 1, Math.floor((f.z + reach) / CHUNK_SIZE));
    const [bottom, top] = [f.base + (lo - UNDER) * STOREY - 0.5, f.base + hi * STOREY];
    // Gathered first: a death changes the lists being walked.
    const found: number[] = [];
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let e = ents.chunkHead[cz * dims.chunksX + cx]!; e >= 0; e = ents.next[e]!) {
          if ((ents.flags[e]! & (F_ALIVE | F_PROP | F_HELD)) !== F_ALIVE || ents.seat[e] !== 0 || reg.vehicle[ents.kind[e]!]) continue;
          if (ents.y[e]! < bottom || ents.y[e]! >= top) continue;
          const dx = ents.x[e]! - f.x, dz = ents.z[e]! - f.z;
          const i = Math.floor((dx * f.c - dz * f.s) / f.bay + f.cols / 2), j = Math.floor((dx * f.s + dz * f.c) / f.bay + f.rows / 2);
          if (i >= 0 && j >= 0 && i < f.cols && j < f.rows && this.under[j * f.cols + i] === 1) found.push(e);
        }
      }
    }
    for (const e of found) {
      const rec = records.byPid.get(ents.pid[e]!);
      if (!rec || rec.dead || !rec.vitals) continue;
      survival.crushed(rec, CRUSH * scale);
      this.harmed++;
    }
  }
}
