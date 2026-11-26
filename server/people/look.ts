// One path for every change to a survivor's look once it is made (`relook`): a cut, a hair dye, a remake. Each cause may
// change only its own bytes. The new look goes on the record, which saves it, and on the body, whose identity revision
// then moves so that every watcher is sent it again; its owner is sent it as owner state (OWN_LOOK). Nothing here is
// stepped: it runs from commands and item uses.
//
// The hair clock is kept here too: the tick the look's hair and beard lengths were set. The lengths at any tick are worked
// out from it (shared/people/hair.ts), on the server and on each client alike. A new survivor's clock starts as it is made;
// the same survivor keeps its clock through death, a restart and travel, which moves it to the other world's ticks.

import { LOOK_BEARD_LENGTH, LOOK_BYTES, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, validLook } from "../../shared/anim/look.ts";
import type { BitReader } from "../../shared/net/codec.ts";
import { CMD_GROOM, CMD_REMAKE, OWN_REMAKE, RESULT_DENIED, RESULT_FAR, RESULT_INVALID, RESULT_OK, RESULT_STALE, SESSION_ALIVE, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { HAIR_STAGES, HAIR_TICK, bakeHair, bakeHairUp, carrySteps, hairClock, stageOf } from "../../shared/people/hair.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { event } from "../events/bus.ts";
import type { Client, GameServer } from "../game.ts";
import type { Items } from "../items.ts";
import { part, type EntityRecord, type Records } from "../records.ts";
import { saved } from "../saved.ts";
import type { ServerWorld } from "../world.ts";

export const CAUSE_CUT = 1;
export const CAUSE_DYE = 2;
export const CAUSE_REMAKE = 3;
const CAUSE_NAMES = ["", "cut", "dye", "remake"];

/** What scissors cut: the hair, or the beard. */
export const PART_HAIR = 0;
export const PART_BEARD = 1;
/** What a dye colours: the hair's colour, or its second colour. */
export const DYE_MAIN = 0;
export const DYE_SECOND = 1;

/** How near another survivor must stand to cut or dye one's hair, in metres. Chosen. */
export const GROOM_REACH = 3;

const RELOOK = event("session.relook");
const ITEM_USE = event("item.use");

/**
 * A survivor's hair clock, null for none yet, and whether it may be made again in the creator. Moved to a younger world's
 * ticks, the start may lie before its first tick until the survivor takes a body there (Relook.wear).
 */
interface Clock {
  start: number | null;
  offered: boolean;
}
const CLOCK = part<Clock>(() => ({ start: null, offered: false }));

/** A tick's clock step, before tick 0 too. */
const stepOf = (tick: number): number => Math.floor(tick / HAIR_TICK) * HAIR_TICK;

saved({
  name: "hair-clock",
  has: (rec) => rec.part(CLOCK) !== undefined,
  write(rec, w) {
    const c = rec.part(CLOCK)!;
    w.bool(c.start !== null);
    if (c.start !== null) {
      w.bool(c.start < 0);
      w.uint53(Math.abs(c.start));
    }
    w.bool(c.offered);
  },
  read(rec, r) {
    const c = rec.own(CLOCK);
    if (r.bool()) {
      const before = r.bool(), at = r.uint53();
      c.start = stepOf(before ? -at : at);
    } else c.start = null;
    c.offered = r.bool();
  },
  rebase(rec, delta) {
    const c = rec.part(CLOCK);
    if (!c) return;
    if (c.start !== null) c.start = stepOf(c.start + delta);
    // An admin's offer to remake belongs to the world that made it.
    c.offered = false;
  },
});

/** The survivor's hair clock start, a tick, or -1 for one whose hair has no clock. */
export function hairStart(rec: EntityRecord): number {
  const start = rec.part(CLOCK)?.start ?? null;
  return start === null ? -1 : Math.max(0, start);
}

/** A copy of the survivor's look with its hair and beard as grown at `now`: what a body it leaves keeps. */
export function grownLook(rec: EntityRecord, now: number, rate: number): Uint8Array | null {
  if (!rec.look) return null;
  const look = rec.look.slice();
  bakeHair(look, hairStart(rec), now, rate);
  return look;
}

export interface RelookContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  /** The survivor's content index. */
  readonly survivor: number;
}

export class Relook {
  private readonly ctx: RelookContext;

  get survivor(): number {
    return this.ctx.survivor;
  }

  constructor(ctx: RelookContext) {
    this.ctx = ctx;
    ctx.game.handle(CMD_GROOM, (c, r) => this.groomCommand(c, r));
    ctx.game.handle(CMD_REMAKE, (c, r) => this.remakeCommand(c, r));
    ctx.game.own.add({ kind: OWN_REMAKE, unsent: false, version: (_c, rec) => rec.part(CLOCK)?.offered ?? false, write: (w, _c, rec) => w.u8(rec.part(CLOCK)?.offered ? 1 : 0) });
  }

  /** Puts the survivor's look and hair clock on body `e`, starting the clock of one that has none. Called as it gets a body. */
  wear(rec: EntityRecord, e: number): void {
    const { world, records } = this.ctx;
    const clock = rec.own(CLOCK);
    if (clock.start === null || clock.start < 0 || clock.start > world.tick) {
      const look = rec.look?.slice() ?? null;
      // Moved before this world's first tick, it keeps what grew until then, a part-grown unit rounded up. Ahead of
      // this world's tick (a save from one whose ticks ran further), nothing has grown yet, so it starts now.
      if (look && clock.start !== null && clock.start < 0) bakeHairUp(look, clock.start, 0, world.hairRate);
      clock.start = clock.start !== null && clock.start < 0 ? 0 : hairClock(world.tick);
      records.dirty.add(rec.pid);
      // A new array is a new version of OWN_LOOK, which carries the clock.
      rec.look = look;
    }
    world.ents.setBodyLook(e, rec.look);
    world.ents.setHairClock(e, rec.look ? clock.start : -1);
  }

  /**
   * The one way a made survivor's look changes. `next` must be a valid look that differs from the current one only where
   * `cause` may change it; a cut and a remake start the hair clock again. Answers "" once it is done, or why not.
   */
  relook(rec: EntityRecord, next: Uint8Array, cause: number, byPid = 0): string {
    const { world, game, records } = this.ctx;
    if (rec.kind !== this.ctx.survivor || !rec.look) return "Only a survivor's look changes.";
    if (!validLook(next)) return "That is not a look.";
    const clock = rec.own(CLOCK);
    const restarts = cause === CAUSE_CUT || cause === CAUSE_REMAKE;
    const start = hairStart(rec);
    const was = rec.look.slice();
    if (restarts) bakeHair(was, start, world.tick, world.hairRate);
    for (let k = 0; k < LOOK_BYTES; k++) if (was[k] !== next[k] && !mayChange(cause, k)) return "That would change more than it may.";
    if (cause === CAUSE_CUT && (next[LOOK_HAIR_LENGTH]! > was[LOOK_HAIR_LENGTH]! || next[LOOK_BEARD_LENGTH]! > was[LOOK_BEARD_LENGTH]!)) return "Scissors only make hair shorter.";
    if (cause === CAUSE_REMAKE && !clock.offered) return "No remake was offered.";
    const refused = game.bus.n[RELOOK] !== 0 ? game.bus.before(RELOOK, { pid: rec.pid, byPid, cause: CAUSE_NAMES[cause]! }) : "";
    if (refused !== "") return refused;
    rec.look = next.slice();
    // A cut starts the clock again as far back as the growth not yet a whole unit, so the part not cut keeps it.
    if (restarts) clock.start = Math.max(0, hairClock(world.tick) - (cause === CAUSE_CUT ? carrySteps(start, world.tick, world.hairRate) * HAIR_TICK : 0));
    if (cause === CAUSE_REMAKE) clock.offered = false;
    records.dirty.add(rec.pid);
    const e = records.entOf.get(rec.pid);
    if (e !== undefined && world.ents.pid[e] === rec.pid) this.wear(rec, e);
    return "";
  }

  /**
   * Cuts the survivor's hair or beard to stage `stage` (HAIR_STAGES). Hair already drawn at that stage is left as it is,
   * clock and all, and the cut counts as done: a stage is what scissors cut to.
   */
  cut(rec: EntityRecord, what: number, stage: number, byPid = 0): string {
    const { world } = this.ctx;
    if (!rec.look || stage < 0 || stage >= HAIR_STAGES.length || (what !== PART_HAIR && what !== PART_BEARD)) return "There is no such cut.";
    const next = rec.look.slice();
    bakeHair(next, hairStart(rec), world.tick, world.hairRate);
    const at = what === PART_HAIR ? LOOK_HAIR_LENGTH : LOOK_BEARD_LENGTH;
    const now = stageOf(next[at]!);
    if (stage > now) return what === PART_HAIR ? "The hair is shorter than that already." : "The beard is shorter than that already.";
    if (stage === now) return "";
    next[at] = HAIR_STAGES[stage]!;
    return this.relook(rec, next, CAUSE_CUT, byPid);
  }

  /** Dyes the survivor's hair colour, or its second colour, hair colour `colour`. */
  dye(rec: EntityRecord, what: number, colour: number, byPid = 0): string {
    if (!rec.look || (what !== DYE_MAIN && what !== DYE_SECOND)) return "There is no such dye.";
    const next = rec.look.slice();
    if (what === DYE_MAIN) next[LOOK_HAIR_COLOR] = colour;
    else next[LOOK_HAIR_COLOR_2] = colour + 1;
    if (next[LOOK_HAIR_COLOR] === rec.look[LOOK_HAIR_COLOR] && next[LOOK_HAIR_COLOR_2] === rec.look[LOOK_HAIR_COLOR_2]) return "The hair is that colour already.";
    return this.relook(rec, next, CAUSE_DYE, byPid);
  }

  /** Lets the survivor make itself again in the creator, or takes that away. Its client opens the creator. */
  offer(rec: EntityRecord, on: boolean): void {
    if (rec.kind !== this.ctx.survivor) return;
    const clock = rec.own(CLOCK);
    if (clock.offered === on) return;
    clock.offered = on;
    this.ctx.records.dirty.add(rec.pid);
  }

  offered(rec: EntityRecord): boolean {
    return rec.part(CLOCK)?.offered ?? false;
  }

  /** The survivor that grooming from session `c` would work on: its own, or one of its tribe in reach. Answers a result code. */
  private target(c: Client, me: EntityRecord, handle: number): EntityRecord | number {
    const { world, records } = this.ctx;
    if (handle === 0) return me;
    const ents = world.ents, e = ents.resolve(handle);
    const rec = e >= 0 ? records.byPid.get(ents.pid[e]!) : undefined;
    if (!rec || rec.kind !== this.ctx.survivor || records.entOf.get(rec.pid) !== e) return RESULT_INVALID;
    if (rec.team !== me.team) return RESULT_DENIED;
    const dx = ents.x[e]! - ents.x[c.ent]!, dy = ents.y[e]! - ents.y[c.ent]!, dz = ents.z[e]! - ents.z[c.ent]!;
    return dx * dx + dy * dy + dz * dz <= GROOM_REACH * GROOM_REACH ? rec : RESULT_FAR;
  }

  /**
   * Scissors or a dye from slot `slot`, used on `handle`'s hair (0 for the user's own). A dye is used up; scissors are
   * kept. `stage` is the cut's; -1 cuts `what` one stage shorter, and with `what` -1 too, the hair first, else the beard.
   */
  groom(c: Client, slot: number, expect: number, handle: number, what: number, stage: number): number {
    const { code, why } = this.groomed(c, slot, expect, handle, what, stage);
    if (why !== "") this.ctx.game.sendText(c, TEXT_NOTICE, why);
    return code;
  }

  /** As `groom`, telling nobody: the result, and why it was refused where a survivor should be told. */
  groomed(c: Client, slot: number, expect: number, handle: number, what: number, stage: number): { code: number; why: string } {
    const { world, records, items, game } = this.ctx;
    const me = c.ent >= 0 && c.state === SESSION_ALIVE ? records.byPid.get(c.pid) : undefined;
    if (!me) return { code: RESULT_DENIED, why: "" };
    if (me.out) return { code: RESULT_DENIED, why: "Not while you are unconscious." };
    const inv = items.inv(me);
    if (slot >= inv.cap) return { code: RESULT_INVALID, why: "" };
    const item = inv.item[slot]!;
    if (item === 0 || item !== expect) return { code: RESULT_STALE, why: "" };
    if ((inv.flags[slot]! & FLAG_BLUEPRINT) !== 0) return { code: RESULT_INVALID, why: "" };
    const cuts = world.reg.groomCut[item] === 1, colour = world.reg.groomHair[item]!;
    if (!cuts && colour < 0) return { code: RESULT_INVALID, why: "" };
    // Asked on every way a groom item is used, as the bag asks of any other.
    const refused = game.bus.n[ITEM_USE] !== 0 ? game.bus.before(ITEM_USE, { byPid: me.pid, item: world.reg.ids[item]! }) : "";
    if (refused !== "") return { code: RESULT_DENIED, why: refused };
    const who = this.target(c, me, handle);
    if (who === RESULT_FAR) return { code: RESULT_FAR, why: "Stand nearer to do that." };
    if (who === RESULT_DENIED) return { code: RESULT_DENIED, why: "Only your own tribe's hair." };
    if (typeof who === "number") return { code: who, why: "" };
    let why: string;
    if (cuts) {
      if (stage < 0) [what, stage] = shorter(who, world.tick, world.hairRate, what);
      why = what < 0 ? "There is nothing to cut." : this.cut(who, what, stage, me.pid);
    } else {
      why = this.dye(who, what < 0 ? DYE_MAIN : what, colour, me.pid);
      if (why === "" && !items.burn(me, slot, 1)) why = "The dye is gone.";
    }
    return { code: why === "" ? RESULT_OK : RESULT_DENIED, why };
  }

  private groomCommand(c: Client, r: BitReader): number {
    const slot = r.varint(), expect = r.u16(), handle = r.u32(), what = r.u8(), stage = r.u8();
    if (r.overflow) return RESULT_INVALID;
    if (stage >= HAIR_STAGES.length) return RESULT_INVALID;
    return this.groom(c, slot, expect, handle, what, stage);
  }

  private remakeCommand(c: Client, r: BitReader): number {
    const made = r.bool();
    const look = new Uint8Array(LOOK_BYTES);
    for (let i = 0; made && i < LOOK_BYTES; i++) look[i] = r.u8();
    if (r.overflow) return RESULT_INVALID;
    const rec = c.ent >= 0 ? this.ctx.records.byPid.get(c.pid) : undefined;
    if (!rec || !this.offered(rec)) return RESULT_DENIED;
    if (!made) {
      this.offer(rec, false);
      return RESULT_OK;
    }
    const why = this.relook(rec, look, CAUSE_REMAKE);
    if (why === "") return RESULT_OK;
    this.ctx.game.sendText(c, TEXT_NOTICE, why);
    return RESULT_DENIED;
  }
}

/** Whether a change for `cause` may touch look byte `k`. */
function mayChange(cause: number, k: number): boolean {
  if (cause === CAUSE_REMAKE) return true;
  if (cause === CAUSE_CUT) return k === LOOK_HAIR_LENGTH || k === LOOK_BEARD_LENGTH;
  return cause === CAUSE_DYE && (k === LOOK_HAIR_COLOR || k === LOOK_HAIR_COLOR_2);
}

/** What scissors used with no stage chosen cut: `what` one stage shorter, or for -1 the hair, else the beard; -1 for nothing. */
function shorter(rec: EntityRecord, now: number, rate: number, what: number): [number, number] {
  const look = rec.look;
  if (!look) return [-1, 0];
  const grown = look.slice();
  bakeHair(grown, hairStart(rec), now, rate);
  for (const [part, at] of [[PART_HAIR, LOOK_HAIR_LENGTH], [PART_BEARD, LOOK_BEARD_LENGTH]] as const) {
    if (what >= 0 && part !== what) continue;
    const length = grown[at]!;
    const stage = stageOf(length) - 1;
    if (stage >= 0) return [part, stage];
  }
  return [-1, 0];
}
