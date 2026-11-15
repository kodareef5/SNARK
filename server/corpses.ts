// A creature's body lies where it fell until it is used up or decays, and holds what the creature carried and its saddle
// (D201) for anyone to take. A blow from a tool, a weapon or bare hands harvests it as ARK's does: each roll's worth of
// harvest damage gives one of its drops, picked by weight, and a tool favours the drop its kind of work favours. A young
// body gives prime meat in place of raw meat. What does not fit the harvester is left in a bag at its feet. Its ragdoll is
// worked out here as each client works it out (shared/anim/corpse.ts), so a blow lands on the body as it is drawn.
//
// One that died in the air or in the water falls or sinks first, as its kind's capsule with nothing steering it, until
// that rests on the ground, on something built or on the bottom. In water it weighs and slows as a ragdoll does there, so
// it sinks. It lies, and its ragdoll is laid, only where it came to rest.

import { CUE_DEAD, CUE_DECAY_SHIFT, CUE_OUT, hurtStage } from "../shared/anim/pose.ts";
import { FALLING, Fall, corpseSize, layCorpse, sizeSpan, wireX, wireY, yawOf16 } from "../shared/anim/corpse.ts";
import { WET_DAMP, WET_GRAVITY } from "../shared/anim/ragdoll.ts";
import { Solved, rayZones, zoneHit } from "../shared/anim/skeleton.ts";
import type { ItemDef, SpeciesDef } from "../shared/content/defs.ts";
import { TICK_DT, TICK_RATE } from "../shared/coords.ts";
import { detCos, detSin } from "../shared/math/scalar.ts";
import { Rng } from "../shared/rng.ts";
import { GROWN, growthStep, leftAtPeriod, youngScale } from "../shared/sim/breeding.ts";
import { Body as Mover, MF_OUT, MF_ROOTED, MODE_WALK, STANCE_STAND, stepBody, type MoveParams } from "../shared/sim/character.ts";
import { F_GROUNDED, F_PROP } from "../shared/sim/entities.ts";
import { Inventory } from "../shared/sim/items.ts";
import type { DeadlineHeap } from "../shared/sim/schedule.ts";
import { groundUnder, restingAt, type CollisionWorld } from "../shared/world/collide.ts";
import { rayBox } from "../shared/world/ray.ts";
import type { Death } from "./death.ts";
import { event } from "./events/bus.ts";
import type { GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import { XP_HARVEST, type Progression } from "./progression.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Lists } from "./settings/lists.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

export const DEADLINE_CORPSE = 10;
/** Ticks a body lies at 1x. ARK publishes none: fifteen minutes, as a cache lies (D244). */
export const CORPSE_TICKS = 15 * 60 * TICK_RATE;
/** A drop a tool favours is picked this many times as often: 60 rolls in 100 of two drops alike, as ARK's hatchet and pick. */
export const FAVOUR = 1.5;
/** For a creature whose content gives no `corpse`. Chosen. */
const HEALTH = 100;
const ROLL = 10;
/** Experience for a blow that gave something, as a rock gives for each hit. Chosen. */
const XP = 1;
/** Ticks between looks at whether something was built or taken where a body sleeps. Chosen. */
const SHAKE_TICKS = TICK_RATE;
/** Metres a ray is searched for bodies beyond its length, for one that rolled from where it fell. */
const PAD = 4;
/**
 * Ticks a body falls or sinks at most before it lies wherever it is. A fall from the top of the world to its floor at the
 * step's terminal speed takes 68 s; in five minutes a body sinks about 160 m, at 0.55 m/s.
 */
export const DROP_TICKS = 5 * 60 * TICK_RATE;
/** Metres under a body within which the ground, or something it could stand on, holds it where it is: the step's own probe. */
const PROBE = 0.02;
/** Of its speed, what a body sinking keeps each tick, as a ragdoll's bodies under water do. */
const WET_KEEP = 1 - WET_DAMP * TICK_DT;

const HARVEST = event("harvest");

export interface CorpsesContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly deadlines: DeadlineHeap;
  readonly rules: Rules;
  readonly lists?: Lists;
  readonly progression?: Progression;
  readonly death?: Death;
}

/** One body. Its place, facing and size are as the wire carries them. */
export interface Body {
  readonly rec: EntityRecord;
  /** The species it was. */
  readonly kind: number;
  /** Its entity, or -1 while it has none. */
  e: number;
  /** Harvest damage it takes in all, and what is left of that. */
  readonly max: number;
  left: number;
  readonly young: boolean;
  readonly size: number;
  /** It died knocked out. */
  readonly out: boolean;
  /** Ticks its whole time lasts under the rules now. It ends at rec.expiresAt. */
  life: number;
  /** The tick of its next deadline. */
  next: number;
  stage: number;
  /** Where it lies, as the wire has it, or while it falls where it is now. */
  x: number;
  y: number;
  z: number;
  /** Radians. */
  readonly yaw: number;
  /** Its ragdoll, null for a kind without one or while it falls, and its pose as the model's about (x, y, z). */
  fall: Fall | null;
  readonly pose: Solved | null;
  /** In the list of bodies stepped each tick. */
  moving: boolean;
  /** While it falls or sinks to where it will lie: its capsule, and the ticks it has fallen. */
  drop: Mover | null;
  dropped: number;
}

/** What one blow gave, for tests and the console. */
export interface Take {
  rolls: number;
  /** Per drop, in the order of the species' drops: what it gave, the item it was, and what was left in a bag. */
  readonly got: number[];
  readonly items: number[];
  readonly bagged: number[];
}

export class Corpses {
  readonly ctx: CorpsesContext;
  readonly seed: number;
  /** By record id, and by entity. */
  readonly bodies = new Map<number, Body>();
  private readonly byEnt = new Map<number, Body>();
  /** Bodies whose ragdolls are still moving. */
  private readonly moving: Body[] = [];
  /** Bodies falling or sinking to where they will lie. */
  private readonly dropping: Body[] = [];
  /** Loaded from a save, to be asked once the world is whole whether anything holds them up. */
  private readonly loaded: Body[] = [];
  /** By kind, what a body sinks by in water: its kind's capsule, pulled down as a ragdoll's bodies are there. */
  private readonly sunk: (MoveParams | undefined)[] = [];
  /** Made by `fell`, waiting for the creature's entity to go. */
  private readonly laid = new Map<number, Body>();
  /** Blows that landed on a body, and the last one's yield. */
  blows = 0;
  readonly last: Take = { rolls: 0, got: [], items: [], bagged: [] };
  /** The distance along the ray of the body `cast` last found. */
  t = 0;
  private readonly rng: Rng;
  private readonly corpse: number;

  constructor(ctx: CorpsesContext, seed: number) {
    this.ctx = ctx;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.corpse = ctx.world.reg.index.get("core:corpse") ?? 0;
  }

  get count(): number {
    return this.bodies.size;
  }

  /** The body whose entity is `e`, or undefined. */
  at(e: number): Body | undefined {
    return this.byEnt.get(e);
  }

  /** In ticks, under the rules now. */
  lifetime(): number {
    const rules = this.ctx.rules;
    return Math.max(1, Math.round(CORPSE_TICKS * rules.num("GlobalCorpseDecompositionTimeMultiplier") * rules.num("UseCorpseLifeSpanMultiplier")));
  }

  /**
   * `rec` died of `cause` (a CAUSE_ of server/survival.ts), struck last by `by` (a pid, or 0). Its body is still in the
   * world. A creature's becomes a body whatever killed it, and takes what it carried and its saddle; Death raises it once
   * the creature's entity is gone.
   */
  fell(rec: EntityRecord, cause: number, by: number): void {
    const { world, records, items, rules } = this.ctx;
    const reg = world.reg;
    const def = reg.defs[rec.kind];
    const e = records.entOf.get(rec.pid);
    if (this.corpse === 0 || def?.type !== "species" || def.class !== "creature" || e === undefined) return;
    const ents = world.ents;
    const tick = world.tick;
    const young = rec.grown !== 0 && growthStep(rec.span, rec.grown, tick) < GROWN;
    const span = sizeSpan(ents.grown[e] !== 0 ? youngScale(reg.birthScale[rec.kind]!, ents.span[e]!, ents.grown[e]!, tick) : 1);
    const size = corpseSize(span);
    const name = rec.name !== "" ? rec.name : reg.ids[rec.kind]!.slice(reg.ids[rec.kind]!.indexOf(":") + 1);
    const body = records.create(this.corpse, name);
    body.x = wireX(ents.x[e]!);
    body.y = wireY(ents.y[e]!);
    body.z = wireX(ents.z[e]!);
    body.yaw = ents.yaw[e]! & 0xffc0;
    body.genome = rec.genome;
    // A slot for each of the creature's and one for its saddle. Items.move sets each stack's spoil clock for where it now lies.
    const inv = rec.inv ? items.inv(rec) : null;
    if ((inv && inv.used() > 0) || rec.saddle !== 0) {
      body.inv = new Inventory((inv ? inv.cap : 0) + 1);
      for (let s = 0; inv && s < inv.cap; s++) if (inv.item[s] !== 0) items.move(rec, s, body, s, 0);
      // A saddle was taken out of the ledger when it was put on, and comes back as it does when it is taken off.
      if (rec.saddle !== 0 && items.mint(body, rec.saddle, 1) === 1) rec.saddle = 0;
    }
    const life = this.lifetime();
    body.expiresAt = tick + life;
    const of = def as SpeciesDef;
    const max = (of.corpse?.health ?? HEALTH) * size * rules.num("HarvestHealthMultiplier");
    // Survival clears rec.out as health runs out, so the body asks what the entity still shows.
    const out = rec.out || (ents.mflags[e]! & MF_OUT) !== 0 || (ents.cue[e]! & CUE_OUT) !== 0;
    const b = this.make(body, rec.kind, max, max, young, size, out, life);
    // Off the ground with nothing under it, it falls on as it was going.
    if ((ents.flags[e]! & F_GROUNDED) === 0 && !this.held(b)) this.fallFrom(b, ents.vx[e]!, ents.vy[e]!, ents.vz[e]!, ents.yaw[e]!);
    this.save(b);
    this.laid.set(rec.pid, b);
  }

  /** How many bodies are falling or sinking now. */
  get falling(): number {
    return this.dropping.length;
  }

  /** Death took the creature `pid`'s entity away: its body takes its place. */
  raise(pid: number): void {
    const b = this.laid.get(pid);
    if (!b) return;
    this.laid.delete(pid);
    this.place(b);
  }

  /** A body's record, loaded from a save. */
  restore(rec: EntityRecord): void {
    const s = rec.corpse;
    if (!s || this.ctx.world.reg.defs[s.species]?.type !== "species" || !(s.life > 0)) {
      // A body of a kind this build lacks goes with what it held.
      this.drop(rec);
      return;
    }
    rec.x = wireX(rec.x);
    rec.y = wireY(rec.y);
    rec.z = wireX(rec.z);
    rec.yaw &= 0xffc0;
    const b = this.make(rec, s.species, s.max, s.left, s.young, corpseSize(s.span), s.out, s.life);
    this.place(b);
    // A body saved while it fell lies where it was in the air until it is found to hang there, when the world is whole.
    this.loaded.push(b);
  }

  private make(rec: EntityRecord, kind: number, max: number, left: number, young: boolean, size: number, out: boolean, life: number): Body {
    const anim = this.ctx.world.anims[kind];
    const b: Body = {
      rec, kind, e: -1, max, left, young, size, out, life, next: 0, stage: 0,
      x: rec.x, y: rec.y, z: rec.z, yaw: yawOf16(rec.yaw),
      fall: null, pose: anim?.rig.ragdoll ? new Solved(anim.rig.bones) : null, moving: false, drop: null, dropped: 0,
    };
    this.bodies.set(rec.pid, b);
    return b;
  }

  /** Whether the ground, or something its kind's capsule could stand on, holds a body up where it is. */
  private held(b: Body): boolean {
    const world = this.ctx.world;
    const p = world.reg.move[b.kind]!;
    return rests(world, b.x, b.y, b.z, p);
  }

  /** Sets body `b` falling from where it is, at the velocity given, facing `yaw` in 65536ths of a turn. */
  private fallFrom(b: Body, vx: number, vy: number, vz: number, yaw: number): void {
    const m = new Mover();
    m.kind = b.kind;
    m.x = b.x;
    m.y = b.y;
    m.z = b.z;
    m.vx = vx;
    m.vy = vy;
    m.vz = vz;
    m.yaw = yaw;
    b.drop = m;
    b.dropped = 0;
    b.fall = null;
  }

  /**
   * Gives a body its entity, its deadline, and its fall to where it will lie or, lying, its ragdoll. Its time runs and it
   * falls whether or not the store has room for it.
   */
  private place(b: Body): void {
    const { world, records } = this.ctx;
    const ents = world.ents;
    const rec = b.rec;
    this.schedule(b);
    if (b.drop) this.dropping.push(b);
    const e = ents.create(b.kind, b.x, b.y, b.z, F_PROP);
    if (e < 0) return;
    b.e = e;
    ents.yaw[e] = rec.yaw;
    ents.pid[e] = rec.pid;
    ents.setLook(e, rec.genome ? rec.genome.level : 1, rec.genome ? rec.genome.colors : null, rec.name);
    ents.setYoung(e, sizeSpan(b.size), 0);
    records.entOf.set(rec.pid, e);
    this.byEnt.set(e, b);
    this.cue(b);
    if (b.drop) ents.anim[e] = FALLING;
    else this.lay(b);
  }

  /** Lays a body's ragdoll where it lies. */
  private lay(b: Body): void {
    const anim = this.ctx.world.anims[b.kind];
    const r = anim && b.pose ? layCorpse(anim, b.out, b.x, b.y, b.z, b.yaw, b.size, b.pose) : null;
    if (r) {
      b.fall = new Fall(r);
      this.wake(b);
    }
  }

  /**
   * One tick of a body's fall: its kind's capsule as the step moves a creature with nothing steering it and no way to jump,
   * in water weighing a quarter and slowed as a ragdoll's bodies are, so that it sinks. It lies where something holds it
   * up, where it can go no further, or after DROP_TICKS.
   */
  private fall(b: Body): void {
    const world = this.ctx.world;
    const m = b.drop!;
    const p = world.reg.move[b.kind]!;
    const wet = m.y + p.height * 0.5 < world.hf.seaLevel;
    if (wet) {
      m.vx = Math.fround(m.vx * WET_KEEP);
      m.vy = Math.fround(m.vy * WET_KEEP);
      m.vz = Math.fround(m.vz * WET_KEEP);
    }
    // Each tick it is a walker in the air, whatever the step made it the tick before.
    m.mode = MODE_WALK;
    m.stance = STANCE_STAND;
    m.grounded = false;
    m.mflags = MF_ROOTED;
    const [x, y, z] = [m.x, m.y, m.z];
    stepBody(world, m, 0, 0, m.yaw, 0, 0, wet ? (this.sunk[b.kind] ??= { ...p, gravity: WET_GRAVITY }) : p, TICK_DT);
    b.dropped++;
    const stuck = m.x === x && m.y === y && m.z === z;
    if (!stuck && !(m.vy <= 0 && rests(world, m.x, m.y, m.z, p)) && b.dropped < DROP_TICKS) {
      b.x = m.x;
      b.y = m.y;
      b.z = m.z;
      if (b.e >= 0) world.ents.setPosition(b.e, m.x, m.y, m.z);
      return;
    }
    this.land(b);
  }

  /** A body that fell comes to rest: where it lies is what the wire carries, and its ragdoll is laid there. */
  private land(b: Body): void {
    const m = b.drop!;
    const rec = b.rec;
    b.drop = null;
    b.x = rec.x = wireX(m.x);
    b.y = rec.y = wireY(m.y);
    b.z = rec.z = wireX(m.z);
    const ents = this.ctx.world.ents;
    if (b.e >= 0) {
      ents.setPosition(b.e, b.x, b.y, b.z);
      ents.anim[b.e] = 0;
    }
    this.save(b);
    this.lay(b);
  }

  private wake(b: Body): void {
    if (!b.moving) this.moving.push(b);
    b.moving = true;
  }

  /** The decay stage: by what time has left of it or what harvesting has, whichever is further gone. */
  private cue(b: Body): void {
    const tick = this.ctx.world.tick;
    b.stage = Math.max(hurtStage(b.rec.expiresAt - tick, b.life), hurtStage(b.left, b.max));
    if (b.e < 0) return;
    const ents = this.ctx.world.ents;
    const cue = (CUE_DEAD | (b.stage << CUE_DECAY_SHIFT) | (b.out ? CUE_OUT : 0)) >>> 0;
    if (ents.cue[b.e] === cue) return;
    ents.cue[b.e] = cue;
    this.ctx.world.history.cued(b.e);
  }

  /** Its next deadline: the first tick a quarter more of its time has gone, or its end. */
  private schedule(b: Body): void {
    const tick = this.ctx.world.tick;
    const end = b.rec.expiresAt;
    let next = end;
    for (let k = 1; k <= 3; k++) {
      const at = Math.floor(end - (k * b.life) / 4) + 1;
      if (at > tick && at < next) next = at;
    }
    b.next = Math.max(next, tick + 1);
    this.ctx.deadlines.push(b.next, DEADLINE_CORPSE, b.rec.pid, b.next);
  }

  /** A DEADLINE_CORPSE entry came due. */
  due(pid: number, stamp: number): void {
    const b = this.bodies.get(pid);
    if (!b || b.next !== stamp) return;
    if (this.ctx.world.tick >= b.rec.expiresAt) {
      this.remove(b, false);
      return;
    }
    this.cue(b);
    this.schedule(b);
  }

  /** The two lifetime rules multiplied were `was` and are `is`. Rescales the time each body has left. */
  retime(was: number, is: number): void {
    if (was === is || !(was > 0)) return;
    const tick = this.ctx.world.tick;
    for (const b of this.bodies.values()) {
      if (b.rec.expiresAt <= tick) continue;
      b.rec.expiresAt = tick + leftAtPeriod(b.rec.expiresAt - tick, was, is);
      b.life = Math.max(1, Math.round((b.life * is) / was));
      this.save(b);
      this.cue(b);
      this.schedule(b);
    }
  }

  step(tick: number): void {
    for (const pid of [...this.laid.keys()]) this.raise(pid);
    const world = this.ctx.world;
    for (const b of this.loaded) {
      if (this.bodies.get(b.rec.pid) !== b || this.held(b)) continue;
      this.fallFrom(b, 0, 0, 0, b.rec.yaw);
      this.dropping.push(b);
      if (b.e >= 0) world.ents.anim[b.e] = FALLING;
    }
    this.loaded.length = 0;
    const dropping = this.dropping;
    let still = 0;
    for (const b of dropping) {
      if (!b.drop || this.bodies.get(b.rec.pid) !== b) continue;
      this.fall(b);
      if (b.drop) dropping[still++] = b;
    }
    dropping.length = still;
    const moving = this.moving;
    let kept = 0;
    for (const b of moving) {
      const fall = b.fall;
      if (!fall || this.bodies.get(b.rec.pid) !== b) {
        b.moving = false;
        continue;
      }
      if (fall.tick(world)) fall.ragdoll.pose(b.pose!);
      if (!fall.still) moving[kept++] = b;
      else b.moving = false;
    }
    moving.length = kept;
    // One that sleeps wakes when something is built or taken where it lies.
    if (tick % SHAKE_TICKS !== 0) return;
    for (const b of this.bodies.values()) {
      if (b.moving || !b.fall || b.fall.ragdoll.awake) continue;
      if (b.fall.tick(world)) {
        b.fall.ragdoll.pose(b.pose!);
        this.wake(b);
      }
    }
  }

  /**
   * The body nearest along a ray, within `maxT`, as an entity index, or -1. `t` says how far along. A body with a rig is met
   * on its capsules as its ragdoll lays them, and one without on its box.
   */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const world = this.ctx.world;
    const ents = world.ents;
    const dims = world.dims;
    this.t = maxT;
    if (this.byEnt.size === 0) return -1;
    const reach = maxT + PAD;
    const x0 = Math.max(0, Math.floor((Math.min(ox, ox + dx * maxT) - PAD) / 64));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((Math.max(ox, ox + dx * maxT) + PAD) / 64));
    const z0 = Math.max(0, Math.floor((Math.min(oz, oz + dz * maxT) - PAD) / 64));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((Math.max(oz, oz + dz * maxT) + PAD) / 64));
    let best = -1;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          const b = this.byEnt.get(i);
          if (!b) continue;
          const fx = b.x - ox;
          const fy = b.y - oy;
          const fz = b.z - oz;
          if (fx * fx + fy * fy + fz * fz > reach * reach) continue;
          const t = this.ray(b, ox, oy, oz, dx, dy, dz, this.t);
          if (t < this.t) {
            this.t = t;
            best = i;
          }
        }
      }
    }
    return best;
  }

  /** Where a body's middle lies now: its ragdoll's first body, or a third of the way up its box. For aiming at it. */
  middle(b: Body): { x: number; y: number; z: number } {
    const anim = this.ctx.world.anims[b.kind];
    const bone = anim?.rig.ragdoll?.bone[0];
    if (!b.pose || !b.fall || bone === undefined) return { x: b.x, y: b.y + this.ctx.world.reg.bodyHeight[b.kind]! * b.size * 0.33, z: b.z };
    const s = detSin(b.yaw);
    const c = detCos(b.yaw);
    const px = b.pose.pos[bone * 3]! * b.size;
    const pz = b.pose.pos[bone * 3 + 2]! * b.size;
    return { x: b.x + c * px + s * pz, y: b.y + b.pose.pos[bone * 3 + 1]! * b.size, z: b.z + c * pz - s * px };
  }

  /** Where a ray meets the body that is entity `e` within `maxT`, or `maxT` if it misses or `e` is no body. */
  hit(e: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const b = this.byEnt.get(e);
    return b ? this.ray(b, ox, oy, oz, dx, dy, dz, maxT) : maxT;
  }

  /** Where a ray meets body `b` within `maxT`, or `maxT`. */
  private ray(b: Body, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const reg = this.ctx.world.reg;
    const anim = this.ctx.world.anims[b.kind];
    if (!anim || !b.pose || !b.fall) {
      const r = reg.bodyRadius[b.kind]! * b.size;
      const t = rayBox(ox, oy, oz, dx, dy, dz, b.x - r, b.y, b.z - r, b.x + r, b.y + reg.bodyHeight[b.kind]! * b.size, b.z + r);
      return t < maxT ? t : maxT;
    }
    // Into the body's space: its place undone, then its yaw (x' = c x + s z, z' = c z - s x), then its size.
    const s = detSin(b.yaw);
    const c = detCos(b.yaw);
    const rx = ox - b.x;
    const rz = oz - b.z;
    const k = 1 / b.size;
    const zone = rayZones(anim.rig, b.pose, (c * rx - s * rz) * k, (oy - b.y) * k, (s * rx + c * rz) * k, c * dx - s * dz, dy, s * dx + c * dz, maxT * k);
    return zone !== 0 && zoneHit.t * b.size < maxT ? zoneHit.t * b.size : maxT;
  }

  /**
   * `by` struck the body that is entity `e` for `damage` of harvest damage, with `tool` in hand (a content index, or 0 for
   * bare hands). Each roll's worth of damage gives one of its drops. The last blow counts whole, not cut to what is left, as
   * wikily.gg's harvest calculator counts ASA's. Returns false if `e` is no body.
   */
  struck(by: EntityRecord, e: number, damage: number, tool: number): boolean {
    const b = this.byEnt.get(e);
    if (!b || !(damage > 0)) return false;
    this.take(by, b, damage, tool);
    return true;
  }

  /** The yield of one blow on `b`, as `struck` gives it. Exposed for the tests that run it without a swing. */
  take(by: EntityRecord, b: Body, damage: number, tool: number): Take {
    const { world, items, rules, lists, progression, death } = this.ctx;
    const reg = world.reg;
    const def = reg.defs[b.kind] as SpeciesDef;
    const drops = def.drops ?? [];
    const last = this.last;
    last.rolls = 0;
    last.got.length = last.items.length = last.bagged.length = 0;
    if (drops.length === 0 || b.left <= 0) return last;
    this.blows++;
    const roll = def.corpse?.roll ?? ROLL;
    // A fractional roll lands by chance, so 1.6 rolls a blow is two in three blows of five.
    const exact = damage / roll;
    let rolls = Math.floor(exact);
    if (this.rng.float() < exact - rolls) rolls++;
    b.left -= damage;
    last.rolls = rolls;
    // Which drops this tool favours, and the weights it picks by.
    const on = tool !== 0 ? (reg.defs[tool] as ItemDef | undefined)?.tool?.on : undefined;
    let sum = 0;
    const weights: number[] = [];
    for (const d of drops) {
      const w = (d.weight ?? 1) * (on !== undefined && d.favoured === on ? FAVOUR : 1);
      weights.push(w);
      sum += w;
    }
    const counts = drops.map(() => 0);
    for (let n = 0; n < rolls; n++) {
      let pick = this.rng.float() * sum;
      let k = 0;
      while (k < drops.length - 1 && pick >= weights[k]!) pick -= weights[k++]!;
      const d = drops[k]!;
      counts[k] = counts[k]! + d.min + this.rng.int(d.max - d.min + 1);
    }
    const amount = rules.num("HarvestAmountMultiplier");
    const each = lists?.multipliers("HarvestResourceItemAmountClassMultipliers");
    let gave = 0;
    for (let k = 0; k < drops.length; k++) {
      let item = reg.index.get(drops[k]!.item) ?? 0;
      if (b.young && reg.youngItem[item]! !== 0) item = reg.youngItem[item]!;
      // A fraction of a piece is a chance of one.
      const exactN = counts[k]! * amount * (each?.get(item) ?? 1);
      let n = Math.floor(exactN);
      if (exactN > n && this.rng.float() < exactN - n) n++;
      let got = 0;
      let bagged = 0;
      if (n > 0 && item !== 0) {
        got = items.mint(by, item, n, 0, 0, -1, "harvest");
        if (got < n && death) bagged = death.overflow(by, item, n - got);
        if (got + bagged > 0) items.bus.after(HARVEST, { pid: by.pid, node: reg.ids[b.kind]!, item: reg.ids[item]!, n: got + bagged });
      }
      last.got.push(got);
      last.items.push(item);
      last.bagged.push(bagged);
      gave += got + bagged;
    }
    if (gave > 0) progression?.addXp(by, XP, XP_HARVEST);
    if (b.left <= 0) this.remove(b, true);
    else {
      this.save(b);
      this.cue(b);
    }
    return last;
  }

  /** Writes a body's own state into its record, for the store. */
  private save(b: Body): void {
    b.rec.corpse = { species: b.kind, max: b.max, left: b.left, span: sizeSpan(b.size), young: b.young, out: b.out, life: b.life };
    this.ctx.records.dirty.add(b.rec.pid);
  }

  /**
   * Takes a body out of the world. One used up leaves what it held in a cache where it lay. One that decayed takes what it
   * held with it, through the ledger, as a cache does.
   */
  remove(b: Body, usedUp: boolean): void {
    const { world, records, items, game, death } = this.ctx;
    const rec = b.rec;
    for (const c of game.clients) {
      if (c?.open !== rec.pid) continue;
      if (death) death.close(c);
      else c.open = 0;
    }
    // Its entity goes first, so the cache has its place in a full store.
    if (b.e >= 0) {
      this.byEnt.delete(b.e);
      world.ents.destroy(b.e);
      records.entOf.delete(rec.pid);
      b.e = -1;
    }
    if (usedUp && rec.inv && items.inv(rec).used() > 0 && death) {
      const inv = items.inv(rec);
      const cache = death.spill(b.x, b.y, b.z, `${rec.name}'s cache`);
      cache.inv = new Inventory(inv.cap);
      for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) items.move(rec, s, cache, s, 0);
    }
    if (rec.inv) items.burnAll(rec);
    b.fall = null;
    this.bodies.delete(rec.pid);
    records.delete(rec.pid);
  }

  /** A record that cannot be a body: what it held is burned through the ledger, and it goes. */
  private drop(rec: EntityRecord): void {
    if (rec.inv) this.ctx.items.burnAll(rec);
    this.ctx.records.delete(rec.pid);
  }
}

/** Whether the ground, or something a capsule of `p` could stand on, is within PROBE under it at (x, y, z). */
function rests(w: CollisionWorld, x: number, y: number, z: number, p: MoveParams): boolean {
  return y - groundUnder(w.hf, x, z, p.radius) <= PROBE || !Number.isNaN(restingAt(w, x, y, z, p.radius, p.height, PROBE, p.slopeCos));
}
