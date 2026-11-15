// Entangling (planning/reference/weapons-plan.md, M6). A hit that gives a buff gives it through here, which reads the
// buff's bola fields: `only` (the species it takes), `survivorSeconds` (its time on a survivor) and `after` (a buff given
// as it ends, during which it is not given again). A survivor rooted by a buff with `survivorSeconds` struggles free
// sooner by pressing jump.
//
// The root itself is the buff's `root`: refreshMods sets MF_ROOTED on the body, which travels with it to its client, so
// the client predicts a rooted body standing as the server steps it (shared/sim/character.ts).

import type { BuffDef } from "../shared/content/defs.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { BTN_JUMP } from "../shared/sim/character.ts";
import type { Buffs } from "./buffs.ts";
import type { GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/**
 * Each press of jump takes this many seconds off the time left, and presses count at most once in this many ticks, so a
 * survivor pressing as fast as it counts is free of a bola's 25 s in about 9 (DEV132). ARK gives neither number.
 */
export const STRUGGLE_SECONDS = 0.5;
export const STRUGGLE_EVERY = 8;

export interface EntangleContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly buffs: Buffs;
}

/** A body with a buff given here whose end matters: it has an `after`, or it can be struggled out of. */
interface Held {
  buff: number;
  /** The tick the last counted press was on. */
  pressed: number;
}

export class Entangle {
  /** Counters for tests and measurement. */
  caught = 0;
  refused = 0;
  struggles = 0;
  freed = 0;

  private readonly ctx: EntangleContext;
  /** By record id. */
  private readonly held = new Map<number, Held>();
  /** By buff: the species indices it takes, or null for any. */
  private readonly takes = new Map<number, ReadonlySet<number> | null>();
  private readonly survivorClass: (kind: number) => boolean;
  private scanned = false;

  constructor(ctx: EntangleContext) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    this.survivorClass = (kind) => {
      const d = reg.defs[kind];
      return d?.type === "species" && d.class === "survivor";
    };
  }

  private def(buff: number): BuffDef | null {
    const d = this.ctx.world.reg.defs[buff];
    return d?.type === "buff" ? d : null;
  }

  /** Whether `buff` takes a body of species `kind`. */
  takesKind(buff: number, kind: number): boolean {
    let set = this.takes.get(buff);
    if (set === undefined) {
      const only = this.def(buff)?.only;
      const index = this.ctx.world.reg.index;
      set = only ? new Set(only.map((id) => index.get(id) ?? 0)) : null;
      this.takes.set(buff, set);
    }
    return set === null || set.has(kind);
  }

  /** Whether the body cannot be mounted or mount: a buff given here roots it. */
  tangled(rec: EntityRecord): boolean {
    const h = this.held.get(rec.pid);
    return h !== undefined && this.def(h.buff)?.root === true && this.ctx.buffs.has(rec, h.buff);
  }

  /**
   * Gives a hit's `buff` to `victim`, from the record `by` (0 for none). False if the buff does not take the victim's
   * species, or its `after` is on the victim (the grace after a bola).
   */
  give(victim: EntityRecord, buff: number, by: number): boolean {
    const def = this.def(buff);
    if (!def) return false;
    const { world, buffs } = this.ctx;
    const after = def.after !== undefined ? (world.reg.index.get(def.after) ?? 0) : 0;
    if (!this.takesKind(buff, victim.kind) || (after !== 0 && buffs.has(victim, after))) {
      if (def.only !== undefined || after !== 0) this.refused++;
      return false;
    }
    if (!buffs.give(victim, buff, by, this.survivorClass(victim.kind) ? def.survivorSeconds : undefined)) return false;
    if (this.watched(buff)) {
      this.held.set(victim.pid, { buff, pressed: -STRUGGLE_EVERY });
      this.caught++;
    }
    return true;
  }

  /** Once a tick, after the buffs that came due have ended: struggling, and the `after` of each buff that ended. */
  step(tick: number): void {
    const { game, records, buffs } = this.ctx;
    // A restart keeps the buffs but not this list: the first step finds them again.
    if (!this.scanned) {
      this.scanned = true;
      for (const rec of records.byPid.values()) for (const b of rec.buffs) if (this.watched(b.buff)) this.held.set(rec.pid, { buff: b.buff, pressed: -STRUGGLE_EVERY });
    }
    if (this.held.size === 0) return;
    for (const c of game.clients) {
      if (!c?.active || c.ent < 0 || (c.pressed & BTN_JUMP) === 0) continue;
      const h = this.held.get(c.pid);
      if (!h || tick - h.pressed < STRUGGLE_EVERY) continue;
      const rec = records.byPid.get(c.pid);
      const def = this.def(h.buff);
      const on = rec?.buffs.find((b) => b.buff === h.buff);
      if (!rec || !def || def.root !== true || def.survivorSeconds === undefined || !on || on.until === 0) continue;
      h.pressed = tick;
      this.struggles++;
      const left = on.until - tick - Math.round(STRUGGLE_SECONDS * TICK_RATE);
      if (left > 0) buffs.give(rec, h.buff, on.by, left / TICK_RATE);
      else buffs.take(rec, h.buff);
    }
    for (const [pid, h] of this.held) {
      const rec = records.byPid.get(pid);
      if (rec && buffs.has(rec, h.buff)) continue;
      this.held.delete(pid);
      if (!rec || rec.dead || !records.entOf.has(pid)) continue;
      this.freed++;
      const name = this.def(h.buff)?.after;
      const after = name !== undefined ? (this.ctx.world.reg.index.get(name) ?? 0) : 0;
      if (after !== 0 && this.takesKind(after, rec.kind)) buffs.give(rec, after);
    }
  }

  /** Whether a body with `buff` is kept on the list. */
  private watched(buff: number): boolean {
    const def = this.def(buff);
    return def !== null && (def.after !== undefined || (def.root === true && def.survivorSeconds !== undefined));
  }
}
