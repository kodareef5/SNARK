// A soul ball keeps a tame, saddle and all, as ARK's cryopod does (planning/workstreams/soul-ball.md). A click with an
// empty ball in hand keeps the tribe's tame the survivor looks at: its body leaves the world, its record stays with its
// time stood still (EntityRecord.stored), and the ball becomes a full one that stands for that record (Inventory.ref), as
// a fertilised egg taken up stands for its young (server/eggs.ts). A click with a full ball looses the tame where the
// survivor looks. A full ball's spoil clock is its charge: run out, or the ball lost any other way, the tame is gone too.
// A survivor's starter mount has an issued ball of its own, which keeps only that tame (server/mount.ts).

import { rebaseTicks } from "./persist/codec.ts";
import { EVENT_BALL, OWN_KEPT, S_EVENT } from "../shared/net/protocol.ts";
import { KEEP_REACH, LOOSE_REACH } from "../shared/sim/balls.ts";
import { STAMINA_UNITS, stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import type { Inventory } from "../shared/sim/items.ts";
import { V_TORPOR } from "../shared/sim/vitals.ts";
import { groundUnder } from "../shared/world/collide.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Breeding } from "./breeding.ts";
import type { Buffs } from "./buffs.ts";
import type { Carry } from "./carry.ts";
import type { Creatures } from "./creatures.ts";
import type { Containers } from "./containers.ts";
import type { Death } from "./death.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import { freeAt, freePlace } from "./place.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Riding } from "./riding.ts";
import type { Rules } from "./settings/rules.ts";
import type { Survival } from "./survival.ts";
import type { Taming } from "./taming.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

export { KEEP_REACH, LOOSE_REACH };
/** Metres from where the survivor looked that a loosed tame may be set, where its body does not fit there. */
const LOOSE_NEAR = 5;
/** Metres within which a session is told of a tame going into a ball or coming out, to see its flash and hear it. Chosen. */
const BALL_SEEN = 120;
/** Places in the entity store a loosed tame may not take: a dropped bag's, and a survivor's (server/death.ts). */
const STORE_RESERVE = 256;

/** Why a ball did nothing, told to the survivor who clicked. */
const NOT_A_TAME = "Only one of your tribe's tamed creatures goes into a soul ball.";
const NOT_YOURS = "That creature is not your tribe's.";
const NOT_AWAKE = "It must be awake to go into a soul ball.";
const RIDDEN = "Nobody may be on it.";
const IN_ARMS = "Set it down first.";
const SICK = "It is ball sick, and cannot be kept again until that has passed.";
const NOTHING = "Look at one of your tribe's creatures, close by.";
const NO_ROOM = "There is no room for it there.";
const NO_BODY = "The world has no room for another creature now.";
const CARGO = "What it carried lies in a bag where it stood.";
const NOT_A_BALL = "That is not a soul ball to do that with.";
const ONLY_ITS_OWN = "This soul ball was issued with your pteranodon, and keeps only that one.";
const ITS_OWN_BALL = "It goes only into the soul ball it was issued with.";

/**
 * Sends the tames kept in the soul balls of `inv` (OWN_KEPT), whole, if it holds one or `told` says the session was last
 * told of one. Returns whether it holds one now. Call after the box's slots are sent.
 */
export function sendKept(game: GameServer, records: Records, c: Client, box: number, inv: Inventory, told: boolean): boolean {
  const reg = game.world.reg;
  const slots: number[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0 && reg.ballEmpty[inv.item[s]!] !== 0 && records.byPid.get(inv.refOf(s))?.stored) slots.push(s);
  if (slots.length === 0 && !told) return false;
  const w = game.beginOwn(OWN_KEPT);
  w.bits(box, 1);
  w.varint(slots.length);
  for (const s of slots) {
    const tame = records.byPid.get(inv.refOf(s))!;
    w.varint(s);
    w.u16(tame.kind);
    w.u16(tame.genome ? tame.genome.level : 1);
    w.string(tame.name);
  }
  game.endOwn(c);
  return slots.length > 0;
}

export interface BallsContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly rules: Rules;
  readonly creatures: Creatures;
  readonly survival: Survival;
  readonly buffs: Buffs;
  readonly taming: Taming;
  readonly breeding: Breeding;
  readonly tribes: Tribes;
  readonly riding: Riding;
  readonly carry: Carry;
  readonly death: Death;
  readonly containers: Containers;
  /** The record takes its body's place and facing, and is parted from it (Persistence.detach, or the same without a save). */
  detach(rec: EntityRecord, e: number): void;
  /** The record is told its new body (Persistence.attach). */
  attach(rec: EntityRecord, e: number): void;
  /** Every hold on a body that is about to leave the world is let go: arms, jaws, a bola. */
  release(rec: EntityRecord): void;
  /** What a body's stats and load make of it is worked out again (the host's refreshBody). */
  refresh(rec: EntityRecord): void;
  notice(pid: number, text: string): void;
  /** Tells every survivor of `team` who is here. */
  tell(team: number, text: string): void;
}

export class Balls {
  /** Counters. */
  kept = 0;
  loosed = 0;
  lost = 0;
  sickened = 0;
  /** Things a load found that did not agree, and put right: a full ball that named no kept tame, or a kept tame no ball named. */
  mended = 0;
  private readonly ctx: BallsContext;
  /** The buffs of content: a survivor's wait after loosing, and a tame's sickness at being loosed within it. 0 where content has none. */
  private readonly chill: number;
  private readonly sick: number;
  private readonly dir = [0, 0, 0];

  constructor(ctx: BallsContext) {
    this.ctx = ctx;
    const index = ctx.world.reg.index;
    this.chill = index.get("core:ball_chill") ?? 0;
    this.sick = index.get("core:ball_sick") ?? 0;
  }

  /** Whether `item` is a soul ball, empty or full. */
  is(item: number): boolean {
    const reg = this.ctx.world.reg;
    return reg.ballFull[item] !== 0 || reg.ballEmpty[item] !== 0;
  }

  /** The strike of a click with the ball in `slot` of `me` in hand: an empty one keeps, a full one looses. */
  click(c: Client, me: EntityRecord, slot: number): void {
    const reg = this.ctx.world.reg;
    const item = this.ctx.items.inv(me).item[slot]!;
    if (c.ent < 0 || me.dead || me.out) return;
    if (reg.ballFull[item] !== 0) this.keep(c, me, slot);
    else if (reg.ballEmpty[item] !== 0) this.loose(c, me, slot);
  }

  /**
   * Why the creature with body `e` may not be kept by `me` in the ball in `slot`, or "" if it may. A starter mount goes only
   * into the issued ball of the survivor it was issued to, and into that one whatever tribe it is in now (server/mount.ts).
   */
  refusal(me: EntityRecord, e: number, slot: number): string {
    const { world, records, items, tribes, riding, carry, buffs } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    if (e < 0 || (ents.flags[e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) return NOTHING;
    const rec = records.byPid.get(ents.pid[e]!);
    if (!rec || records.entOf.get(rec.pid) !== e || rec.keyHash !== null || rec.egg !== null || rec.dead || reg.defs[rec.kind]?.type !== "species" || reg.vehicle[rec.kind]) return NOT_A_TAME;
    if (rec.team === 0) return NOT_A_TAME;
    const issued = items.issued(me, slot);
    if (issued && rec.issuedTo !== me.pid) return ONLY_ITS_OWN;
    if (!issued && rec.issuedTo !== 0) return ITS_OWN_BALL;
    if (!issued && !tribes.may(me, rec.team)) return NOT_YOURS;
    // The sickness knocks it out, and is the reason to give of the two.
    if (this.sick !== 0 && buffs.has(rec, this.sick)) return SICK;
    if (rec.out || rec.tame) return NOT_AWAKE;
    if (riding.occupied(e) || ents.driven[e] !== 0) return RIDDEN;
    if (carry.held(e)) return IN_ARMS;
    return "";
  }

  /** The empty ball in `slot` of `me` takes in the tame `me` looks at. */
  private keep(c: Client, me: EntityRecord, slot: number): void {
    const why = this.keepIn(me, slot, this.ctx.containers.target(c, KEEP_REACH));
    if (why !== "") this.ctx.notice(me.pid, why);
  }

  /**
   * The empty ball in `slot` of `me` takes in the creature with body `e`, all within one tick: its body leaves the world,
   * its record stays with its time stood still, and the ball is a full one that stands for it. Returns why not, having
   * changed nothing, or "".
   */
  keepIn(me: EntityRecord, slot: number, e: number): string {
    const { world, records, items } = this.ctx;
    const reg = world.reg;
    const full = reg.ballFull[items.inv(me).item[slot]!] ?? 0;
    if (full === 0) return NOT_A_BALL;
    const why = this.refusal(me, e, slot);
    if (why !== "") return why;
    const rec = records.byPid.get(world.ents.pid[e]!)!;
    // The ball is made full first: if it cannot be, nothing has changed.
    if (!items.turn(me, slot, full, rec.pid)) return NOT_A_BALL;
    if (this.stow(rec, e)) this.ctx.notice(me.pid, CARGO);
    this.kept++;
    return "";
  }

  /**
   * The body `e` of tame `rec` leaves the world as it goes into a ball, all within one tick, and its record stays with its
   * time stood still. Nothing holds it and nobody has it open as it goes. What it carried is left in a bag where it stood,
   * and true is returned then. Its saddle is on its record, and goes with it. The caller names it in a ball, or deletes it.
   */
  stow(rec: EntityRecord, e: number): boolean {
    const { world, game, survival, breeding, death, containers } = this.ctx;
    const ents = world.ents;
    const x = ents.x[e]!;
    const y = ents.y[e]!;
    const z = ents.z[e]!;
    this.ctx.release(rec);
    for (const other of game.clients) if (other?.active && other.open === rec.pid) containers.close(other);
    const cargo = death.dropAll(rec, x, y, z) !== null;
    // Its time stops here: every clock it has is as of this tick, and nothing of it is due while it is kept.
    const tick = Math.max(1, world.tick);
    rec.vitals?.rebase(tick);
    rec.vitalsDue = 0;
    rec.mealDue = 0;
    rec.growDue = 0;
    breeding.kept(rec);
    this.ctx.detach(rec, e);
    this.ctx.creatures.remove(e);
    survival.forget(rec.pid);
    rec.flying = false;
    rec.stored = tick;
    this.ctx.records.dirty.add(rec.pid);
    this.show(true, x, y, z, rec.kind);
    return cargo;
  }

  /** The full ball in `slot` of `me` lets its tame out where `me` looks. */
  private loose(c: Client, me: EntityRecord, slot: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const rec = this.ctx.records.byPid.get(this.ctx.items.inv(me).refOf(slot));
    const p = rec ? (reg.tamedMove[rec.kind] ?? reg.move[rec.kind]) : undefined;
    // On what the survivor looks at within LOOSE_REACH, or on the ground under the end of that reach.
    const e = c.ent;
    const ox = ents.x[e]!;
    const oy = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
    const oz = ents.z[e]!;
    lookDirection(c.heldYaw, c.heldPitch, this.dir);
    const [dx, dy, dz] = this.dir as [number, number, number];
    const r = p ? p.radius : 0.5;
    const hit = castWorld(world, ox, oy, oz, dx, dy, dz, LOOSE_REACH);
    // Short of what the look meets by the body's radius, so it does not start inside a wall.
    const t = hit !== HIT_NONE ? Math.max(0, rayHit.t - r - 0.2) : LOOSE_REACH;
    const x = Math.min(world.hf.sizeX - r, Math.max(r, ox + dx * t));
    const z = Math.min(world.hf.sizeZ - r, Math.max(r, oz + dz * t));
    const ground = groundUnder(world.hf, x, z, r);
    // On a floor or a deck it looked down at, else on the ground under the place.
    const y = hit !== HIT_NONE && rayHit.ny > 0.5 && oy + dy * rayHit.t > ground ? oy + dy * rayHit.t : ground;
    const why = this.looseAt(me, slot, x, y, z, c.heldYaw & 0xffff);
    if (why !== "") this.ctx.notice(me.pid, why);
  }

  /**
   * The full ball in `slot` of `me` lets its tame out at the place nearest (x, y, z) that its body fits, within
   * LOOSE_NEAR of it, facing `yaw`: the same record has a body again, its clocks go on from where they stopped, it is of
   * `me`'s tribe, and the ball is an empty one. Returns why not, the ball and the tame as they were, or "". A ball that
   * names no kept tame becomes an empty one, and that is no refusal.
   */
  looseAt(me: EntityRecord, slot: number, x: number, y: number, z: number, yaw: number): string {
    const { world, records, items, rules, taming, breeding, buffs, survival, creatures } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const inv = items.inv(me);
    const empty = reg.ballEmpty[inv.item[slot]!] ?? 0;
    if (empty === 0) return NOT_A_BALL;
    const rec = records.byPid.get(inv.refOf(slot));
    if (!rec || rec.stored === 0 || records.entOf.has(rec.pid)) {
      // It named nothing kept: it is an empty ball.
      inv.setRef(slot, 0);
      items.turn(me, slot, empty);
      this.mended++;
      return "";
    }
    // A starter mount's issued ball is never held back: no tame limit counts it, and loosing it neither chills nor sickens.
    const issued = items.issued(me, slot);
    const limit = issued ? "" : taming.full(me.team);
    if (limit !== "") return limit;
    if (ents.room < STORE_RESERVE) return NO_BODY;
    const p = reg.tamedMove[rec.kind] ?? reg.move[rec.kind];
    if (!p || !freePlace(world, x, y, z, p.radius, p.height, me.team, p.stepUp, p.slopeCos) || Math.hypot(freeAt.x - x, freeAt.z - z) > LOOSE_NEAR) return NO_ROOM;
    // Its clocks go on from where they stopped.
    const tick = world.tick;
    const away = tick - rec.stored;
    const was = { x: rec.x, y: rec.y, z: rec.z, yaw: rec.yaw };
    rebaseTicks(rec, away);
    rec.stored = 0;
    rec.x = freeAt.x;
    rec.y = freeAt.y;
    rec.z = freeAt.z;
    rec.yaw = yaw;
    const e = creatures.adopt(rec);
    if (e < 0) {
      // No body after all: it stays kept, as it was.
      rebaseTicks(rec, -away);
      rec.stored = tick - away;
      rec.x = was.x;
      rec.y = was.y;
      rec.z = was.z;
      rec.yaw = was.yaw;
      return NO_BODY;
    }
    this.ctx.attach(rec, e);
    // The ball is empty again, and stands for nothing.
    inv.setRef(slot, 0);
    items.turn(me, slot, empty);
    // Whoever looses it has it, as ARK gives a released creature to its releaser.
    if (rec.team !== me.team) {
      rec.team = me.team;
      rec.follow = 0;
      ents.setTeam(e, rec.team);
    }
    records.dirty.add(rec.pid);
    buffs.restore(rec, false);
    breeding.loosed(rec);
    taming.meal(rec);
    this.ctx.refresh(rec);
    // A starter comes out rested: a new body has 100 stamina whatever its most, and a mount for travel wants all of it.
    if (issued) ents.stamina[e] = ents.staminaMax[e]! * STAMINA_UNITS;
    this.loosed++;
    // ARK's cryo sickness: loosed within the survivor's wait after the last, it is knocked out and takes ten times the harm.
    // It is always so on PvP, and on PvE only where the server says (EnableCryoSicknessPVE).
    if (!issued && this.chill !== 0 && this.sick !== 0 && (!rules.on("serverPVE") || rules.on("EnableCryoSicknessPVE"))) {
      if (buffs.has(me, this.chill)) {
        buffs.give(rec, this.sick, me.pid);
        survival.add(rec, V_TORPOR, 1e9);
        this.sickened++;
      }
      buffs.give(me, this.chill, me.pid);
    }
    this.show(false, rec.x, rec.y, rec.z, rec.kind);
    return "";
  }

  /** Tells those within BALL_SEEN metres that a body of `kind` went into a ball (`kept`) or came out of one at (x, y, z): EVENT_BALL. */
  private show(kept: boolean, x: number, y: number, z: number, kind: number): void {
    const { world, game } = this.ctx;
    const ents = world.ents;
    for (const other of game.clients) {
      if (!other?.active || other.closed) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      if ((bx - x) * (bx - x) + (bz - z) * (bz - z) > BALL_SEEN * BALL_SEEN) continue;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_BALL);
      w.bool(kept);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      w.f32(world.reg.bodyRadius[kind]!);
      w.f32(world.reg.bodyHeight[kind]!);
      game.endOwn(other);
    }
  }

  /**
   * The item that stood for record `ref` is gone: spoiled at the end of its charge, burned, or lost with what held it. If
   * that record is a kept tame it is lost with its ball, and its tribe is told.
   */
  gone(ref: number): void {
    const { world, records, items, survival, buffs } = this.ctx;
    const rec = records.byPid.get(ref);
    if (!rec || rec.stored === 0) return;
    const def = world.reg.defs[rec.kind];
    const what = rec.name !== "" ? rec.name : def ? ((def as { label?: string }).label ?? def.id.slice(def.id.indexOf(":") + 1)) : "tame";
    if (rec.inv) items.burnAll(rec);
    buffs.died(rec);
    survival.forget(rec.pid);
    const team = rec.team;
    records.delete(rec.pid);
    this.lost++;
    if (team !== 0) this.ctx.tell(team, `${what} was lost with the soul ball that held it.`);
  }

  /**
   * Call after a load, once every body is back and before anything else resumes. Each full ball must name one kept tame
   * that no other names, and each kept tame must be named by a ball. A ball that names none becomes an empty one. A kept
   * tame no ball names is set back in the world where it was kept, since nothing else could ever loose it: it is then a
   * tame with a body, whose meals, growth and buffs the modules that resume after this take up as they do any other's.
   */
  resume(): void {
    const { world, records, items, creatures } = this.ctx;
    const reg = world.reg;
    const named = new Set<number>();
    for (const rec of [...records.byPid.values()]) {
      const inv = rec.inv;
      if (!inv) continue;
      for (let s = 0; s < inv.cap; s++) {
        const item = inv.item[s]!;
        if (item === 0 || reg.ballEmpty[item] === 0) continue;
        const ref = inv.refOf(s);
        const tame = ref !== 0 ? records.byPid.get(ref) : undefined;
        if (tame && tame.stored !== 0 && !records.entOf.has(ref) && !named.has(ref)) {
          named.add(ref);
          continue;
        }
        inv.setRef(s, 0);
        if (!items.turn(rec, s, reg.ballEmpty[item]!)) items.burn(rec, s, inv.count[s]!, true);
        this.mended++;
      }
    }
    for (const rec of [...records.byPid.values()]) {
      if (rec.stored === 0 || named.has(rec.pid)) continue;
      const p = reg.tamedMove[rec.kind] ?? reg.move[rec.kind];
      rebaseTicks(rec, Math.max(0, world.tick - rec.stored));
      rec.stored = 0;
      records.dirty.add(rec.pid);
      this.mended++;
      if (records.entOf.has(rec.pid) || !p) continue;
      if (freePlace(world, rec.x, rec.y, rec.z, p.radius, p.height, rec.team, p.stepUp, p.slopeCos)) {
        rec.x = freeAt.x;
        rec.y = freeAt.y;
        rec.z = freeAt.z;
      }
      const e = creatures.adopt(rec);
      if (e >= 0) this.ctx.attach(rec, e);
    }
  }
}
