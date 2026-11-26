// Things that stand and hold loot (planning/workstreams/loot.md): a street bin, a mailbox. A survivor searches one by
// holding the use key on it for its seconds; it then opens as a box that only gives. What it holds is rolled at that
// first search, and it holds loot again a time after, kept here only for the ones that were searched.

import { hashString } from "../shared/hash.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { RESULT_DENIED, RESULT_OK, RESULT_SEARCHED, RESULT_WAIT, TEXT_NOTICE } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { Inventory } from "../shared/sim/items.ts";
import { GAME_HOUR_TICKS } from "../shared/sim/lazy.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { matches } from "../shared/supply/compile.ts";
import type { Containers } from "./containers.ts";
import type { Death } from "./death.ts";
import type { Fixtures } from "./fixtures.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { Loot } from "./loot.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** Ticks a search may end early by, for a client whose clock runs a little ahead of the server's. */
const SLACK = Math.round(TICK_RATE * 0.3);
/** Ticks before a refill that was held back is looked at again. */
const RETRY = TICK_RATE * 600;
/** Metres from a survivor within which a searched thing does not fill again. */
const NEAR = 30;
/** Game hours before a searched thing holds loot again, where no source of its says. */
const REFILL: readonly [number, number] = [24, 24];

export interface HoldersContext {
  world: ServerWorld;
  game: GameServer;
  records: Records;
  items: Items;
  fixtures: Fixtures;
  containers: Containers;
  death: Death;
  deadlines: DeadlineHeap;
  rules: Rules;
  loot: Loot;
  /** Whether a survivor or a base is too near (x, z) for a thing there to hold loot again (server/harvest.ts). */
  held: (x: number, z: number) => boolean;
}

export class Holders {
  /** Each searched thing's ref, and the tick it holds loot again. */
  private readonly marks = new Map<number, number>();
  /** Who is searching what, since when: by the survivor's pid. */
  private readonly searching = new Map<number, { ref: number; at: number }>();
  private readonly ctx: HoldersContext;
  private readonly deadline: number;
  readonly saved = { dirty: false, serialize: (): string => JSON.stringify([...this.marks]) };
  /** Things searched and refilled since the world began. */
  searched = 0;
  refilled = 0;

  constructor(ctx: HoldersContext) {
    this.ctx = ctx;
    this.deadline = ctx.deadlines.kind("holder", (ref, until) => this.due(ref, until));
    // An emptied one keeps no record: its mark says it was searched.
    ctx.containers.onShut.on((rec) => {
      if (rec.at >= 0 && this.marks.has(rec.at) && ctx.items.inv(rec).used() === 0) this.forget(rec.at);
    });
  }

  /** Takes up what a save kept: the marks, each with its deadline again. */
  begin(saved: string | null): void {
    let read: unknown = [];
    try {
      read = JSON.parse(saved ?? "[]");
    } catch {
      read = [];
    }
    if (!Array.isArray(read)) return;
    for (const row of read) {
      if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || !Number.isSafeInteger(row[1]) || this.tag(row[0] as number) === null) continue;
      this.marks.set(row[0] as number, row[1] as number);
      this.ctx.deadlines.push(row[1] as number, this.deadline, row[0] as number, row[1] as number);
    }
  }

  get count(): number {
    return this.marks.size;
  }

  /** The tag of the map's piece at `ref` if it holds loot and street loot is on, else null. */
  tag(ref: number): string | null {
    const { world, rules } = this.ctx;
    const t = world.structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0 || t.owner[slot] !== 0) return null;
    const tag = world.reg.holds[t.kind[slot]!] ?? null;
    return tag !== null && rules.on("WorldLootEnabled") && rules.on("StreetLootEnabled") ? tag : null;
  }

  /** Whether `ref` was searched and holds nothing a survivor may still take. */
  spent(ref: number): boolean {
    return this.marks.has(ref) && (this.ctx.fixtures.find(ref)?.inv?.used() ?? 0) === 0;
  }

  /** A survivor began to search the thing at `ref` (STRUCT_SEARCH). Reach and sight are the caller's to check. */
  start(c: Client, ref: number): number {
    if (this.tag(ref) === null) return RESULT_DENIED;
    if (this.spent(ref)) return RESULT_SEARCHED;
    this.searching.set(c.pid, { ref, at: this.ctx.world.tick });
    return RESULT_OK;
  }

  /**
   * The use key on the thing at `ref`: it opens for a survivor who has searched it for its seconds, and shuts for one who
   * has it open. Returns a RESULT code, or -1 if the piece holds nothing.
   */
  use(c: Client, ref: number): number {
    const { world, game, fixtures } = this.ctx;
    const tag = this.tag(ref);
    if (tag === null) return -1;
    const open = fixtures.find(ref);
    if (open && c.open === open.pid) {
      this.ctx.containers.close(c);
      return RESULT_OK;
    }
    if (this.spent(ref)) return RESULT_SEARCHED;
    const t = world.structs.chunks[Math.floor(ref / 65536)]!;
    const kind = t.kind[ref & 0xffff]!;
    const began = this.searching.get(c.pid);
    if (!began || began.ref !== ref || world.tick - began.at < Math.round(world.reg.holdSeconds[kind]! * TICK_RATE) - SLACK) return RESULT_WAIT;
    this.searching.delete(c.pid);
    let box = open;
    if (!this.marks.has(ref)) {
      box = this.roll(ref, tag, kind, c.pid);
      if (!box) {
        game.sendText(c, TEXT_NOTICE, "Nothing in it.");
        return RESULT_OK;
      }
    }
    if (!box) return RESULT_SEARCHED;
    if (!game.mayOpen(c, box.pid)) return RESULT_DENIED;
    c.open = box.pid;
    return RESULT_OK;
  }

  /** Rolls what the thing at `ref` holds and marks it searched. Its record, or null if it held nothing. */
  private roll(ref: number, tag: string, kind: number, by: number): EntityRecord | null {
    const { world, fixtures, loot, deadlines, rules, records } = this.ctx;
    const thing = { kind: "static", holds: tag } as const;
    const seed = hashString(`static/${ref}/${world.tick}`, 0);
    const box = fixtures.ensure(ref);
    box.inv = new Inventory(world.reg.structSlots[kind]!);
    const stacks = loot.fill(box, thing, seed, by);
    // The soonest of its sources' times, drawn within its range.
    let hours = REFILL;
    for (const s of loot.sources()) if (s.on && s.refillHours && matches(s, thing) && (hours === REFILL || s.refillHours[0] < hours[0])) hours = s.refillHours;
    const rng = new Rng(seed);
    const until = world.tick + Math.max(1, Math.round((hours[0] + rng.float() * (hours[1] - hours[0])) * GAME_HOUR_TICKS * rules.num("WorldLootRefillPeriodMultiplier")));
    this.marks.set(ref, until);
    deadlines.push(until, this.deadline, ref, until);
    this.saved.dirty = true;
    this.searched++;
    if (stacks > 0) return box;
    records.delete(fixtures.release(ref)!.pid);
    return null;
  }

  /** Lets go of the record of the thing at `ref`, burning what it still held. */
  private forget(ref: number): void {
    const { fixtures, items, records, containers } = this.ctx;
    const rec = fixtures.release(ref);
    if (!rec) return;
    containers.removing(rec);
    if (rec.inv) items.burnAll(rec);
    records.delete(rec.pid);
  }

  /** A searched thing's time is up: it holds loot again, unless somebody is at it or too near, when it is looked at later. */
  private due(ref: number, until: number): void {
    const { world, game, fixtures, deadlines } = this.ctx;
    if (this.marks.get(ref) !== until) return;
    const t = world.structs.chunks[Math.floor(ref / 65536)];
    const rec = fixtures.find(ref);
    const standing = t !== undefined && t !== null && (ref & 0xffff) < t.high && t.kind[ref & 0xffff] !== 0;
    if (standing && ((rec && game.clients.some((c) => c?.open === rec.pid)) || this.near(t.x[ref & 0xffff]!, t.z[ref & 0xffff]!) || this.ctx.held(t.x[ref & 0xffff]!, t.z[ref & 0xffff]!))) {
      const later = world.tick + RETRY;
      this.marks.set(ref, later);
      deadlines.push(later, this.deadline, ref, later);
      this.saved.dirty = true;
      return;
    }
    this.forget(ref);
    this.marks.delete(ref);
    this.saved.dirty = true;
    this.refilled++;
  }

  /** Whether a survivor is within sight of a thing at (x, z): it does not fill again under their eyes. */
  private near(x: number, z: number): boolean {
    const ents = this.ctx.world.ents;
    for (const c of this.ctx.game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const dx = ents.x[c.ent]! - x;
      const dz = ents.z[c.ent]! - z;
      if (dx * dx + dz * dz < NEAR * NEAR) return true;
    }
    return false;
  }

  /** The piece at `ref` is being destroyed: what it still held lies where it stood, in a bag. */
  gone(ref: number): void {
    const { world, fixtures, items, death, records, containers } = this.ctx;
    const rec = fixtures.find(ref);
    if (!rec) return;
    containers.removing(rec);
    const inv = rec.inv;
    if (inv && inv.used() > 0) {
      const t = world.structs.chunks[Math.floor(ref / 65536)]!;
      const bag = death.spill(t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]!, "Spilled");
      bag.inv = new Inventory(inv.cap);
      for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) items.move(rec, s, bag, s, 0);
    }
    fixtures.release(ref);
    if (rec.inv) items.burnAll(rec);
    records.delete(rec.pid);
  }
}
