// Things thrown from the hand (CMD_THROW): a knife, a pistol, whatever is held. The thing becomes a bag of its own at
// once (server/death.ts letGo), drawn as its item (client/core/render/dropped.ts), and that bag flies as a loose body
// (shared/sim/loose.ts): it tumbles end over end, strikes walls and floors, slides and comes to rest, where anyone may
// take it up with the use key (CMD_TAKE). Its place and the way its length points go to every client as any body's do,
// the pitch in the pose word as a stuck arrow's (server/projectiles.ts), so nothing new travels.
//
// The first body it meets while still fast takes a blow by its weight and speed, once, and it falls back off it. The
// thrower is not struck by their own throw as it leaves the hand.
//
// It runs in the physics lane (server/lane.ts). At most MOST fly at once: a throw beyond that is let fall at the
// thrower's feet at rest, decided as it is thrown, so one in flight is never slowed or cut short.

import { TICK_RATE } from "../shared/coords.ts";
import { RESULT_DENIED, RESULT_FULL, RESULT_INVALID, RESULT_OK } from "../shared/net/protocol.ts";
import { MODE_GHOST, MODE_NONE } from "../shared/sim/character.ts";
import { DMG_MELEE } from "../shared/sim/damage.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { QUALITY_MUL } from "../shared/sim/items.ts";
import { LOOSE_FLIGHT, LooseBody, droppedTurn, looseShape } from "../shared/sim/loose.ts";
import { castWorld, HIT_NONE, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Combat, Source } from "./combat.ts";
import type { Death } from "./death.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** Things in flight at once. */
export const LOOSE_MOST = 256;
/** Metres a second a thing leaves the hand at, and its turns end over end, radians a second. */
export const THROW_SPEED = 14;
const THROW_SPIN = 14;
/** A thing slower than this strikes nobody. */
const HARM_SPEED = 5;
/** Ticks its thrower is not in its way, as it leaves the hand. */
const OWN_TICKS = 8;
/** A blow's damage: a base, and so much a kilogram a metre a second. */
const HARM_BASE = 2;
const HARM_PER = 0.6;
/** Of its speed, what it keeps falling back off a body it struck. */
const OFF_BODY = 0.25;
/** The most seconds one flies before it is laid where it is: a thing that never settles on something odd. */
const MOST_SECONDS = 20;
/** Metres from the eye, as far as a hand reaches, and within which a thing lying is taken up. */
const HAND = 0.45;
export const TAKE_REACH = 3.5;
const TAU = Math.PI * 2;

interface Flying {
  readonly bag: EntityRecord;
  readonly ent: number;
  readonly gen: number;
  readonly body: LooseBody;
  /** The thrower's entity and record, for the blow and for keeping out of their own way. */
  readonly by: number;
  readonly byRec: EntityRecord;
  readonly item: number;
  readonly quality: number;
  readonly ox: number;
  readonly oz: number;
  struck: boolean;
}

export interface LooseContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly combat: Combat;
  readonly death: Death;
}

export class Loose {
  private readonly ctx: LooseContext;
  private readonly flying: Flying[] = [];
  private readonly dir = new Float64Array(3);
  private readonly eyeAt = new Float64Array(3);
  private readonly axis = new Float64Array(3);
  private readonly bag: number;
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  /** Thrown, let fall for want of room, bodies struck, and laid to rest. */
  readonly stats = { thrown: 0, dropped: 0, struck: 0, rested: 0 };

  constructor(ctx: LooseContext) {
    this.ctx = ctx;
    this.bag = ctx.world.reg.index.get("core:bag") ?? -1;
  }

  /** In flight now. */
  get count(): number {
    return this.flying.length;
  }

  /** CMD_THROW: the session throws one of what it holds, along its look. */
  command(c: Client): number {
    const { world, records, items, death, combat } = this.ctx;
    const ents = world.ents;
    const rec = records.byPid.get(c.pid);
    const e = c.ent;
    if (!rec || e < 0 || rec.dead || rec.out || c.drive >= 0 || ents.seat[e] !== 0) return RESULT_DENIED;
    if (ents.mode[e] === MODE_GHOST || ents.mode[e] === MODE_NONE) return RESULT_DENIED;
    const inv = items.inv(rec);
    const slot = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    if (slot < 0 || inv.item[slot] === 0) return RESULT_INVALID;
    const item = inv.item[slot]!, quality = inv.quality[slot]!;
    const d = this.dir;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    combat.eye(e, this.eyeAt);
    const ex = this.eyeAt[0]!, ey = this.eyeAt[1]!, ez = this.eyeAt[2]!;
    // It leaves the hand a little ahead of the eye, short of any wall that close.
    const clear = castWorld(world, ex, ey, ez, d[0]!, d[1]!, d[2]!, HAND) === HIT_NONE ? HAND : Math.max(0, rayHit.t - 0.1);
    const x = ex + d[0]! * clear, y = ey - 0.15 + d[1]! * clear, z = ez + d[2]! * clear;
    const bag = death.letGo(rec, slot, 1, x, y, z);
    if (!bag) return RESULT_FULL;
    this.stats.thrown++;
    const ent = records.entOf.get(bag.pid);
    if (ent === undefined) return RESULT_OK;
    // With no room in the lane it is let fall at the thrower's feet, lying there at once, at the cost of a drop: nothing is
    // stepped for it.
    if (this.flying.length >= LOOSE_MOST) {
      this.stats.dropped++;
      ents.setPosition(ent, ents.x[e]!, ents.y[e]!, ents.z[e]!);
      ents.yaw[ent] = (ents.yaw[e]! - droppedTurn(ent)) & 0xffff;
      ents.pitch[ent] = 0;
      ents.hold[ent] = 0;
      ents.pose(ent);
      bag.x = ents.x[ent]!;
      bag.y = ents.y[ent]!;
      bag.z = ents.z[ent]!;
      this.ctx.records.dirty.add(bag.pid);
      return RESULT_OK;
    }
    const body = new LooseBody(looseShape(world.reg.weight[item]!));
    body.throw(x, y, z, d[0]!, d[1]!, d[2]!, THROW_SPEED, ents.vx[e]!, ents.vy[e]!, ents.vz[e]!, THROW_SPIN);
    this.flying.push({ bag, ent, gen: ents.gen[ent]!, body, by: e, byRec: rec, item, quality, ox: ex, oz: ez, struck: false });
    this.show(ent, body);
    return RESULT_OK;
  }

  /** One tick of every thing in flight. */
  step(): void {
    const { world, records } = this.ctx;
    const ents = world.ents;
    let kept = 0;
    for (const f of this.flying) {
      // Taken up, emptied or gone while it flew.
      if ((ents.flags[f.ent]! & F_ALIVE) === 0 || ents.gen[f.ent] !== f.gen || records.entOf.get(f.bag.pid) !== f.ent) continue;
      const b = f.body;
      const px = b.x, py = b.y, pz = b.z;
      const moving = b.step(world);
      if (!f.struck) this.strike(f, px, py, pz);
      if (!moving || b.age > MOST_SECONDS) {
        this.lay(f.bag, f.ent, b);
        continue;
      }
      this.show(f.ent, b);
      this.flying[kept++] = f;
    }
    this.flying.length = kept;
  }

  /** CMD_TAKE on a bag of one stack: the session takes it all up, within reach. A RESULT code, or -1 if `e` is not such a bag. */
  take(c: Client, e: number): number {
    const { world, records, items, death } = this.ctx;
    const ents = world.ents;
    if (e < 0 || e >= ents.cap || (ents.flags[e]! & (F_ALIVE | F_PROP)) !== (F_ALIVE | F_PROP) || ents.kind[e] !== this.bag) return -1;
    const bag = records.byPid.get(ents.pid[e]!);
    const me = records.byPid.get(c.pid);
    if (!bag || !me || c.ent < 0 || me.dead || me.out || records.entOf.get(bag.pid) !== e) return RESULT_INVALID;
    const inv = bag.inv ? items.inv(bag) : null;
    if (!inv || inv.used() !== 1) return RESULT_INVALID;
    const dx = ents.x[e]! - ents.x[c.ent]!, dy = ents.y[e]! - ents.y[c.ent]!, dz = ents.z[e]! - ents.z[c.ent]!;
    if (dx * dx + dy * dy + dz * dz > TAKE_REACH * TAKE_REACH) return RESULT_INVALID;
    let slot = 0;
    while (slot < inv.cap && inv.item[slot] === 0) slot++;
    const item = inv.item[slot]!;
    if (!items.give(bag, me, item, inv.total(item))) return RESULT_FULL;
    death.remove(bag);
    return RESULT_OK;
  }

  /** The first body it passes through while fast takes the blow, and it falls back off it. */
  private strike(f: Flying, px: number, py: number, pz: number): void {
    const { world, combat } = this.ctx;
    const b = f.body;
    const speed = b.speed();
    if (speed < HARM_SPEED) return;
    const dx = b.x - px, dy = b.y - py, dz = b.z - pz;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(length > 1e-6)) return;
    const self = b.age * TICK_RATE <= OWN_TICKS && (world.ents.flags[f.by]! & F_ALIVE) !== 0 ? f.by : -1;
    const target = combat.castBodies(self, px, py, pz, dx / length, dy / length, dz / length, length, b.shape.radius);
    if (target < 0 || target === f.by) return;
    f.struck = true;
    this.stats.struck++;
    const at = combat.t;
    const src = this.src;
    src.by = f.byRec;
    src.x = f.ox;
    src.z = f.oz;
    src.item = f.item;
    src.quality = QUALITY_MUL[f.quality] ?? 1;
    src.base = HARM_BASE + b.shape.mass * speed * HARM_PER;
    const zone = combat.zone;
    combat.land(src, target, zone, px + (dx / length) * at, py + (dy / length) * at, pz + (dz / length) * at, Math.sqrt((px - f.ox) * (px - f.ox) + (pz - f.oz) * (pz - f.oz)));
    // It falls back off what it struck, most of its speed spent.
    const v = b.v;
    v[0] = -v[0]! * OFF_BODY;
    v[1] = v[1]! * OFF_BODY;
    v[2] = -v[2]! * OFF_BODY;
  }

  /** Where it is and the way its length points, as a body's place, yaw and pitch. */
  private show(ent: number, b: LooseBody): void {
    const ents = this.ctx.world.ents;
    ents.setPosition(ent, b.x, b.y - b.shape.radius, b.z);
    const a = this.axis;
    b.axis(a);
    const dy = a[1]! < -1 ? -1 : a[1]! > 1 ? 1 : a[1]!;
    // A thing pointing straight up or down keeps the yaw it had.
    if (a[0]! * a[0]! + a[2]! * a[2]! > 1e-6) ents.yaw[ent] = Math.round((Math.atan2(a[0]!, a[2]!) / TAU) * 65536) & 0xffff;
    ents.pitch[ent] = Math.round((Math.asin(dy) / (Math.PI / 2)) * 16384);
    ents.hold[ent] = LOOSE_FLIGHT;
    ents.pose(ent);
  }

  /** At rest: it lies flat where it stopped, as a dropped thing lies, and its record says so. */
  private lay(bag: EntityRecord, ent: number, b: LooseBody): void {
    const { world, records } = this.ctx;
    const ents = world.ents;
    this.show(ent, b);
    // A bag lying is drawn turned by its id (client/core/render/dropped.ts): turned back by as much, it lies the way it came to rest.
    ents.yaw[ent] = (ents.yaw[ent]! - droppedTurn(ent)) & 0xffff;
    ents.pitch[ent] = 0;
    ents.hold[ent] = 0;
    ents.pose(ent);
    bag.x = ents.x[ent]!;
    bag.y = ents.y[ent]!;
    bag.z = ents.z[ent]!;
    records.dirty.add(bag.pid);
    this.stats.rested++;
  }
}

