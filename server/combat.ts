// Combat: what a swing lands on, and what that does.
//
// The shared action step (shared/sim/weapon.ts) says *when*: the tick a swing
// lands, a shot leaves, a reload ends. This file says *what*. It looks from the
// body's own eye along where it is looking, on the server, against the world,
// the resource nodes and the bodies near; a client never names what it hit.
//
// A body with a skeleton is hit by zone: it is posed as every client draws it
// (shared/anim/zones.ts) and the ray is tested against its boxes. Anything else
// is its box, and counts as its torso.
//
// What a hit does is `resolveDamage` (shared/sim/damage.ts) and nothing else.
// This file gathers what that needs: the weapon, the attacker's strength, what
// the victim's species makes of the kind of damage, the part hit, and the piece
// of armor over that part.
//
// What clients are told (S_EVENT) is little. Whoever landed a hit learns where,
// which part, how much, and whether it killed: never what the victim has left.
// Whoever was hit learns how much and from which side.

import { HUMAN } from "../shared/anim/human.ts";
import { SLOT_OF_ZONE, ZONE_NONE, ZONE_TORSO } from "../shared/anim/human.ts";
import { AnimState, bodySeed } from "../shared/anim/pose.ts";
import { BODY_REACH, BODY_REACH_Y, rayBody } from "../shared/anim/zones.ts";
import { zoneHit } from "../shared/anim/skeleton.ts";
import type { SpeciesDef } from "../shared/content/defs.ts";
import { EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { DMG_EXPLOSIVE, DMG_MELEE, PIECE_SCALE, harm, hit, resetHit, resolveDamage } from "../shared/sim/damage.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { ARMOR_SLOTS, QUALITY_MUL } from "../shared/sim/items.ts";
import { W_MELEE, W_THROWN } from "../shared/sim/weapon.ts";
import { HIT_NODE, HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayBox, rayHit } from "../shared/world/ray.ts";
import type { Buffs } from "./buffs.ts";
import type { Creatures } from "./creatures.ts";
import { V_TORPOR } from "../shared/sim/vitals.ts";
import { DID_FIRE, DID_RELOAD, DID_STRIKE, type Client, type GameServer } from "./game.ts";
import type { Harvest } from "./harvest.ts";
import { Past } from "./history.ts";
import type { Items } from "./items.ts";
import type { Progression } from "./progression.ts";
import type { Rules } from "./rules.ts";
import type { EntityRecord, Records } from "./records.ts";
import { STAT_MELEE, statOf, type Survival } from "./survival.ts";
import type { ServerWorld } from "./world.ts";

/** Chunks are this many metres across. */
const CHUNK_METRES = 64;
/** A swing is not a line: rays this far to each side of where it looks also land. */
const SWING_WIDTH = 0.14;
/** Bodies near enough to a ray to be worth posing, at most. */
const MAX_NEAR = 256;
/** From a chunk's middle to its corner. */
const CHUNK_REACH = CHUNK_METRES * Math.SQRT1_2;

export interface CombatContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly survival: Survival;
  readonly progression: Progression;
  readonly creatures: Creatures;
  readonly buffs: Buffs;
  readonly rules: Rules;
  readonly harvest: Harvest | null;
}

/** How far behind the newest snapshot it has a client draws everyone else, in ticks, when it has not said (client/core/session.ts says with each input). */
const VIEW_BEHIND = 2;
/** The farthest back a shot is judged: beyond this the shooter must lead. */
export const REWIND_TICKS = 12;
/** How far a body can have moved in that time, for finding the bodies a rewound ray might touch; and in the tick a piece of a flight takes. */
const REWIND_REACH = 5;
const SWEEP_REACH = 1;

/** What a blow or a shot brings with it: who, from where, with what, and how hard. */
export interface Source {
  /** Who did it, or null if they are no longer there to be credited. */
  by: EntityRecord | null;
  /** Where it came from, for the side the victim is shown. */
  x: number;
  z: number;
  /** What it was done with: the weapon's content index, or 0 for bare hands. */
  item: number;
  /** As `hit` of shared/sim/damage.ts has them. */
  base: number;
  type: number;
  quality: number;
  draw: number;
  attack: number;
  torporInstant: number;
  torporOver: number;
  /** Seconds the torpor to come is spread over, and a buff the hit gives (a content index, or 0). */
  torporSeconds: number;
  buff: number;
}

/** One blow as it was resolved, for tests, the console and measurement. */
export interface Blow {
  /** Persistent ids of who struck and who was struck. */
  by: number;
  victim: number;
  zone: number;
  /** Health taken, damage the armor stopped, and the uses that cost it. */
  damage: number;
  blocked: number;
  wear: number;
  killed: boolean;
}

export class Combat {
  /** Blows landed on bodies so far. */
  hits = 0;
  /** The last blow landed. */
  readonly last: Blow = { by: 0, victim: 0, zone: 0, damage: 0, blocked: 0, wear: 0, killed: false };

  private readonly ctx: CombatContext;
  private readonly survivor: number;
  /** 1 for kinds whose body has the humanoid skeleton. */
  private readonly human: Uint8Array;
  private readonly rng: Rng;
  private readonly dir = [0, 0, 0];
  private readonly st = new AnimState();
  private readonly near = new Int32Array(MAX_NEAR);
  private readonly past = new Past();
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  /** The buff a dose of narcotic is: each hit that brings torpor to come puts one on, carrying its strength. */
  private readonly dose: number;
  /** Where the last `castBodies` hit: the part, and how far along the ray. */
  zone = ZONE_NONE;
  t = 0;
  /** A shot left `c`'s weapon: `weapon` at `quality` fired a round of `ammo`, drawn `draw` (0 to 1). Set by whoever flies it. */
  onFire: ((c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, draw: number) => void) | null = null;
  /** A thrown thing left `c`'s hand: one of `item`, of `quality`. Set by whoever flies it. */
  onThrow: ((c: Client, rec: EntityRecord, item: number, quality: number) => void) | null = null;
  /** Hits landed on things built, and the last of them: which, how much it took, and what it has left (0: it is gone). */
  structureHits = 0;
  readonly lastStructure = { ref: 0, damage: 0, left: 0 };
  private readonly refs = new Uint32Array(4096);
  private readonly found: number[] = [];
  private readonly share: number[] = [];
  /** Set by `killed`, which the hurt in progress may call. */
  private died = false;

  constructor(ctx: CombatContext, seed: number) {
    this.ctx = ctx;
    const reg = ctx.world.reg;
    this.survivor = reg.index.get("core:survivor")!;
    this.human = Uint8Array.from(reg.defs, (d) => (d?.type === "species" && d.skeleton === HUMAN.id ? 1 : 0));
    this.rng = new Rng(seed);
    this.dose = reg.index.get("core:tranquilized") ?? 0;
  }

  /** Once a tick, after every body has stepped: act on what each body's step said happened. */
  step(): void {
    for (const c of this.ctx.game.clients) {
      if (!c?.active || c.did === 0 || c.ent < 0) continue;
      if ((c.did & DID_RELOAD) !== 0) this.reload(c);
      if ((c.did & DID_STRIKE) !== 0) this.strike(c);
      if ((c.did & DID_FIRE) !== 0) this.fire(c);
    }
  }

  /** The slot of what a record holds in its hands, or -1. */
  private heldSlot(rec: EntityRecord): number {
    const inv = this.ctx.items.inv(rec);
    return inv.hotbar >= 0 && rec.held >= 0 && inv.item[inv.hotbar + rec.held] !== 0 ? inv.hotbar + rec.held : -1;
  }

  /** A swing landed: find what is in front, and hit it. */
  private strike(c: Client): void {
    const { world, records, items, harvest } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec) return;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    const kind = ents.kind[e]!;
    // What it swings: the thing in its hands if that is for swinging and not worn out, or its bare hands.
    const inv = items.inv(rec);
    const slot = this.heldSlot(rec);
    let item = slot >= 0 ? inv.item[slot]! : 0;
    if (item !== 0 && (reg.weapon[item]?.kind !== W_MELEE || (reg.uses[item]! > 0 && inv.dur[slot]! === 0))) item = 0;
    const reach = reg.reach[item !== 0 ? item : kind]!;
    const d = this.dir;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    const ox = ents.x[e]!;
    const oy = ents.y[e]! + stanceEye(reg.move[kind]!, ents.stance[e]!);
    const oz = ents.z[e]!;
    const what = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
    const ref = rayHit.ref;
    const worldT = rayHit.t;
    const target = this.castBodies(e, ox, oy, oz, d[0]!, d[1]!, d[2]!, what === HIT_NONE ? reach : worldT, SWING_WIDTH);
    // What the blow brings, whatever it lands on.
    const src = this.src;
    src.by = rec;
    src.x = ox;
    src.z = oz;
    src.item = item;
    src.base = reg.damage[item !== 0 ? item : kind]!;
    src.type = item !== 0 ? reg.damageType[item]! : DMG_MELEE;
    src.quality = item !== 0 ? (QUALITY_MUL[inv.quality[slot]!] ?? 1) : 1;
    src.draw = 1;
    src.attack = statOf(reg.defs[kind] as SpeciesDef, rec.genome, STAT_MELEE, 1);
    src.torporInstant = src.torporOver = src.torporSeconds = 0;
    src.buff = 0;
    const wears = item !== 0 && reg.uses[item]! > 0;
    if (target >= 0) {
      const t = this.t;
      this.land(src, target, this.zone, ox + d[0]! * t, oy + d[1]! * t, oz + d[2]! * t, t);
      // A blow wears what struck it.
      if (wears) items.wear(rec, slot, 1);
    } else if (what === HIT_NODE && harvest) harvest.struck(c, Math.floor(ref / 65536), ref & 0xffff);
    else if (what === HIT_STRUCTURE && this.hitStructure(src, ref, ox + d[0]! * worldT, oy + d[1]! * worldT, oz + d[2]! * worldT) > 0 && wears) items.wear(rec, slot, 1);
  }

  /** A reload ended: the rounds go from the bag into the weapon. */
  private reload(c: Client): void {
    const { world, records, items } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec) return;
    const slot = this.heldSlot(rec);
    const params = slot >= 0 ? world.reg.weapon[items.inv(rec).item[slot]!] : null;
    const ammo = slot >= 0 ? this.ammoFor(rec, slot) : 0;
    if (params && ammo !== 0) items.load(rec, slot, ammo, params.clip);
    // The body's count is the weapon's, whatever the step supposed.
    world.ents.rounds[c.ent] = slot >= 0 ? items.inv(rec).loaded[slot]! : 0;
  }

  /** A shot left: the round is spent, the weapon is worn by it, and what was fired is on its way. */
  private fire(c: Client): void {
    const { world, records, items } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec) return;
    const slot = this.heldSlot(rec);
    const inv = items.inv(rec);
    if (slot >= 0 && world.reg.weapon[inv.item[slot]!]?.kind === W_THROWN) {
      this.throwIt(c, rec, slot);
      return;
    }
    if (slot < 0 || !items.spend(rec, slot)) {
      // The step supposed a round that the weapon does not have.
      world.ents.rounds[c.ent] = slot >= 0 ? inv.loaded[slot]! : 0;
      return;
    }
    const weapon = inv.item[slot]!;
    if (world.reg.uses[weapon]! > 0) items.wear(rec, slot, 1);
    this.onFire?.(c, rec, weapon, inv.quality[slot]!, inv.ammo[slot]!, c.drawn);
  }

  /** A thrown thing left the hand: one fewer of them is carried, and it is on its way. */
  private throwIt(c: Client, rec: EntityRecord, slot: number): void {
    const items = this.ctx.items;
    const inv = items.inv(rec);
    const item = inv.item[slot]!;
    const quality = inv.quality[slot]!;
    if (!items.burn(rec, slot, 1)) return;
    this.onThrow?.(c, rec, item, quality);
  }

  /**
   * The moment `c` was looking at when it sampled the input being stepped
   * now: a tick, perhaps between two, no later than now and no earlier than
   * the rewind allows. It is what the client said it was drawing, which
   * cannot be later than the last snapshot it was sent. Now, if that moment
   * is not remembered.
   */
  viewTick(c: Client): number {
    const world = this.ctx.world;
    const now = world.tick;
    const inputs = c.inputs;
    let view = inputs.has(now) ? inputs.view[now & inputs.mask]! : c.ackTick - VIEW_BEHIND;
    if (view > c.lastSnapshot) view = c.lastSnapshot;
    if (view < now - REWIND_TICKS) view = now - REWIND_TICKS;
    if (view >= now || !world.history.has(Math.floor(view))) return now;
    return view;
  }

  /**
   * The ammunition a reload of the weapon in `slot` would use: the kind it was
   * last told to take, or else the first kind it takes that the body carries. 0 for none.
   */
  ammoFor(rec: EntityRecord, slot: number): number {
    const reg = this.ctx.world.reg;
    const inv = this.ctx.items.inv(rec);
    const def = reg.defs[inv.item[slot]!];
    const takes = def?.type === "item" ? def.weapon?.ammo : undefined;
    if (!takes) return 0;
    const chosen = inv.ammo[slot]!;
    if (chosen !== 0 && (inv.loaded[slot]! > 0 || inv.total(chosen) > 0)) return chosen;
    for (const id of takes) {
      const k = reg.index.get(id)!;
      if (inv.total(k) > 0) return k;
    }
    return chosen;
  }

  /**
   * The nearest body a ray hits within `maxT`, other than `self`: its entity
   * index, or -1. `this.zone` and `this.t` say where. With a `width`, rays that
   * far to each side are tried when the middle one finds nothing, so that a
   * swing lands on what it visibly passes through. `at` is the moment to test
   * bodies at: now, or a moment the history remembers, for a shot judged as
   * its shooter saw it. `sweep` is the ticks the ray took to cover `maxT`, for
   * a piece of a flight: each body is then met where it was along the way.
   */
  castBodies(self: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, width = 0, at = this.ctx.world.tick, sweep = 0): number {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    this.at = at >= world.tick ? -1 : at;
    this.sweep = sweep;
    this.span = maxT;
    // Every body whose farthest reach could touch the ray. A body judged in the past may since have moved.
    let n = 0;
    const near = this.near;
    const slack = width + (this.at < 0 ? 0 : REWIND_REACH) + (sweep > 0 ? SWEEP_REACH : 0);
    const pad = BODY_REACH + slack;
    const ex = ox + dx * maxT;
    const ez = oz + dz * maxT;
    const x0 = Math.max(0, Math.floor((Math.min(ox, ex) - pad) / CHUNK_METRES));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((Math.max(ox, ex) + pad) / CHUNK_METRES));
    const z0 = Math.max(0, Math.floor((Math.min(oz, ez) - pad) / CHUNK_METRES));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((Math.max(oz, ez) + pad) / CHUNK_METRES));
    const flat2 = dx * dx + dz * dz;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        // A long ray crosses few of the chunks its bounds cover: skip those it passes nowhere near.
        const mx = (cx + 0.5) * CHUNK_METRES - ox;
        const mz = (cz + 0.5) * CHUNK_METRES - oz;
        let along = flat2 > 1e-9 ? (mx * dx + mz * dz) / flat2 : 0;
        along = along < 0 ? 0 : along > maxT ? maxT : along;
        const fx = mx - dx * along;
        const fz = mz - dz * along;
        if (fx * fx + fz * fz > (CHUNK_REACH + pad) * (CHUNK_REACH + pad)) continue;
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if (i === self || (ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
          const kind = ents.kind[i]!;
          // A sphere about the body that holds it whatever it does; a box that is larger has a larger one.
          const h = reg.bodyHeight[kind]!;
          const r = Math.max(BODY_REACH, h * 0.5 + reg.bodyRadius[kind]!) + slack;
          const px = ents.x[i]! - ox;
          const py = ents.y[i]! + (this.human[kind] ? BODY_REACH_Y : h * 0.5) - oy;
          const pz = ents.z[i]! - oz;
          const t = px * dx + py * dy + pz * dz;
          if (t < -r || t > maxT + r || px * px + py * py + pz * pz - t * t > r * r) continue;
          if (n < MAX_NEAR) near[n++] = i;
        }
      }
    }
    this.zone = ZONE_NONE;
    this.t = maxT;
    if (n === 0) return -1;
    let best = this.castNear(n, ox, oy, oz, dx, dy, dz);
    if (best >= 0 || width <= 0) return best;
    // To each side and above and below: (rx, 0, rz) is level and square to the ray, (ux, uy, uz) square to both.
    let rx = dz;
    let rz = -dx;
    const rl = Math.sqrt(rx * rx + rz * rz);
    if (rl < 1e-6) {
      rx = 1;
      rz = 0;
    } else {
      rx /= rl;
      rz /= rl;
    }
    const ux = -rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy;
    for (let k = 0; k < 4; k++) {
      const a = k === 0 ? width : k === 1 ? -width : 0;
      const b = k === 2 ? width : k === 3 ? -width : 0;
      const hit = this.castNear(n, ox + rx * a + ux * b, oy + uy * b, oz + rz * a + uz * b, dx, dy, dz);
      if (hit >= 0) best = hit;
    }
    return best;
  }

  /** The moment `castNear` tests bodies at: a remembered tick, or -1 for now. */
  private at = -1;
  /** For a piece of a flight: the ticks it took, and its length. 0 for a ray that takes no time. */
  private sweep = 0;
  private span = 0;
  private readonly before = new Past();

  /**
   * Where body `i` was at `tick`: now, a tick the history remembers, or a
   * moment between two of those. False if it was not there then.
   */
  private where(i: number, tick: number, out: Past): boolean {
    const world = this.ctx.world;
    const ents = world.ents;
    const now = world.tick;
    const whole = Math.floor(tick);
    if (whole < now - 1 || (whole < now && whole === tick)) return world.history.sample(tick, i, out);
    if (whole >= now) {
      out.x = ents.x[i]!;
      out.y = ents.y[i]!;
      out.z = ents.z[i]!;
      out.yaw = ents.yaw[i]!;
      out.anim = ents.anim[i]!;
      return true;
    }
    // Between the last tick remembered and this one, which is not remembered yet: blended as a client blends.
    if (!world.history.at(whole, i, out)) return false;
    const k = tick - whole;
    out.x += (ents.x[i]! - out.x) * k;
    out.y += (ents.y[i]! - out.y) * k;
    out.z += (ents.z[i]! - out.z) * k;
    let turn = ents.yaw[i]! - out.yaw;
    if (turn > 32768) turn -= 65536;
    else if (turn < -32768) turn += 65536;
    out.yaw = (out.yaw + Math.round(turn * k)) & 0xffff;
    if (k >= 0.5) out.anim = ents.anim[i]!;
    return true;
  }

  /** The nearest of the first `n` bodies in `near` that a ray hits nearer than `this.t`, or -1. Moves `this.t` and `this.zone` up to it. */
  private castNear(n: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const world = this.ctx.world;
    const reg = world.reg;
    const st = this.st;
    const past = this.past;
    const before = this.before;
    const tick = this.at < 0 ? world.tick : this.at;
    const span = this.span;
    let best = -1;
    for (let k = 0; k < n; k++) {
      const i = this.near[k]!;
      const kind = world.ents.kind[i]!;
      // Where it was then. A body that was not there then cannot have been hit.
      if (!this.where(i, tick, past)) continue;
      // A piece of a flight took time, and the body moved in that time. Seen from the body, the piece
      // began further back by as much as the body has come forward: tested so, nothing slips between ticks.
      let rx = ox, ry = oy, rz = oz, ux = dx, uy = dy, uz = dz;
      let scale = 1;
      if (this.sweep > 0 && this.where(i, tick - this.sweep, before)) {
        const mx = past.x - before.x;
        const my = past.y - before.y;
        const mz = past.z - before.z;
        if (mx !== 0 || my !== 0 || mz !== 0) {
          rx += mx;
          ry += my;
          rz += mz;
          const ex = ox + dx * span - rx;
          const ey = oy + dy * span - ry;
          const ez = oz + dz * span - rz;
          const length = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (length > 1e-9) {
            ux = ex / length;
            uy = ey / length;
            uz = ez / length;
            // Distances along this ray, as distances along the piece.
            scale = span / length;
          }
        }
      }
      const reach = this.t / scale;
      if (this.human[kind] && world.anim) {
        st.unpack(past.anim);
        st.seed = bodySeed(i);
        const zone = rayBody(world.anim, st, tick, past.x, past.y, past.z, past.yaw, rx, ry, rz, ux, uy, uz, reach);
        if (zone !== ZONE_NONE && zoneHit.t < reach) {
          this.t = zoneHit.t * scale;
          this.zone = zone;
          best = i;
        }
      } else {
        const r = reg.bodyRadius[kind]!;
        const t = rayBox(rx, ry, rz, ux, uy, uz, past.x - r, past.y, past.z - r, past.x + r, past.y + reg.bodyHeight[kind]!, past.z + r);
        if (t < reach) {
          this.t = t * scale;
          this.zone = ZONE_TORSO;
          best = i;
        }
      }
    }
    return best;
  }

  /**
   * What `src` brings lands on entity `target`, on `zone`, at (x, y, z),
   * `far` metres from where it came. The harm is done now, to the body as it
   * is now, whatever moment the hit was judged at.
   */
  land(src: Source, target: number, zone: number, x: number, y: number, z: number, far: number): void {
    const { world, records, items, survival, creatures, buffs } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const victim = records.byPid.get(ents.pid[target]!);
    if (!victim) return;
    const by = src.by;
    const item = src.item;
    const vkind = ents.kind[target]!;
    resetHit();
    hit.base = src.base;
    hit.type = src.type;
    hit.quality = src.quality;
    hit.draw = src.draw;
    // What is acting on either of them is a factor like any other.
    hit.attack = src.attack * (by ? buffs.dealtOf(by) : 1);
    hit.resist = buffs.takenOf(victim);
    hit.torporInstant = src.torporInstant;
    hit.torporOver = src.torporOver;
    hit.takes = reg.takes[vkind]?.[hit.type] ?? 1;
    // The server's rules: whether where it landed matters, and what this pairing of who and whom is worth.
    const rules = this.ctx.rules.values;
    hit.zone = rules.headshots !== 0 ? (reg.zoneMul[vkind]?.[zone] ?? 1) : 1;
    hit.rule = vkind !== this.survivor ? rules.creatureDamage : by === victim ? rules.selfDamage : rules.playerDamage;
    // Its own side: a blow, an arrow or a shot does nothing, unless the server allows it. A blast spares nobody,
    // as it does not spare whoever set it off; and what one does to oneself is not this.
    if (by && by !== victim && hit.type !== DMG_EXPLOSIVE && rules.friendlyFire === 0 && by.team !== 0 && by.team === victim.team) hit.rule = 0;
    const vinv = victim.inv;
    let piece = -1;
    let worn = 0;
    if (vinv && vinv.armor >= 0 && zone !== ZONE_NONE) {
      // Aimed: the piece worn over the part hit, if it is not worn out, counted five times.
      piece = vinv.armor + SLOT_OF_ZONE[zone]!;
      if (vinv.item[piece] !== 0 && vinv.dur[piece]! > 0) hit.armor = reg.armor[vinv.item[piece]!]! * (QUALITY_MUL[vinv.quality[piece]!] ?? 1) * PIECE_SCALE;
    } else if (vinv && vinv.armor >= 0) {
      // Not aimed (a blast): everything worn stands against it together, each piece counted once.
      for (let k = 0; k < ARMOR_SLOTS; k++) {
        const at = vinv.armor + k;
        if (vinv.item[at] === 0 || vinv.dur[at]! === 0) continue;
        hit.armor += reg.armor[vinv.item[at]!]! * (QUALITY_MUL[vinv.quality[at]!] ?? 1);
        worn++;
      }
    }
    resolveDamage();
    if (harm.wear > 0 && hit.armor > 0) {
      if (piece >= 0) items.wear(victim, piece, harm.wear);
      else for (let k = 0; k < ARMOR_SLOTS; k++) if (vinv!.item[vinv!.armor + k] !== 0 && vinv!.dur[vinv!.armor + k]! > 0) items.wear(victim, vinv!.armor + k, Math.ceil(harm.wear / worn));
    }

    const vc = this.clientOf(victim.pid);
    const ax = src.x;
    const az = src.z;
    const vx = ents.x[target]!;
    const vz = ents.z[target]!;
    this.died = false;
    const taken = survival.hurt(victim, harm.health, by ? by.pid : 0);
    const killed = this.died;
    this.hits++;
    const last = this.last;
    last.by = by ? by.pid : 0;
    last.victim = victim.pid;
    last.zone = zone;
    last.damage = taken;
    last.blocked = harm.blocked;
    last.wear = hit.armor > 0 ? harm.wear : 0;
    last.killed = killed;
    if (!killed && (ents.flags[target]! & F_ALIVE) !== 0) {
      creatures.provoke(target, ax, az);
      // What the hit leaves behind: torpor at once, torpor to come as a dose, and whatever the round carries. Armor that stopped the harm stopped these in the same measure.
      const from = by ? by.pid : 0;
      if (harm.torpor > 0) survival.add(victim, V_TORPOR, harm.torpor);
      if (harm.torporOver > 0 && src.torporSeconds > 0 && this.dose !== 0) buffs.give(victim, this.dose, from, src.torporSeconds, harm.torporOver / src.torporSeconds);
      if (src.buff !== 0) buffs.give(victim, src.buff, from);
    }

    const game = this.ctx.game;
    const shown = Math.min(65535, Math.max(taken > 0 ? 1 : 0, Math.round(taken)));
    const ac = by ? this.clientOf(by.pid) : null;
    if (ac) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_HIT);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      w.bits(zone, 4);
      w.u16(shown);
      w.bool(killed);
      w.bool(harm.blocked > 0);
      game.endOwn(ac);
    }
    if (vc && taken > 0) {
      const w = game.begin(S_EVENT);
      w.u8(killed ? EVENT_DEATH : EVENT_HURT);
      w.u16(shown);
      // The side it came from, as a facing: 256ths of a turn.
      w.u8(Math.round((Math.atan2(ax - vx, az - vz) / (Math.PI * 2)) * 256) & 255);
      w.bits(zone, 4);
      if (killed) {
        w.string(!by ? "someone" : by.name !== "" ? by.name.slice(0, 24) : speciesLabel(reg.ids[by.kind]!));
        w.u16(item);
        w.u16(Math.min(65535, Math.round(far * 10)));
      }
      game.endOwn(vc);
    }
  }

  /**
   * What `src` brings, times `share`, lands on the structure `ref` at
   * (x, y, z). What it is made of says what that kind of damage does to it;
   * at no health left it is gone. Returns the damage done.
   */
  hitStructure(src: Source, ref: number, x: number, y: number, z: number, share = 1): number {
    const { world, buffs, game } = this.ctx;
    const structs = world.structs;
    const t = structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    if (!t || slot >= t.high || t.kind[slot] === 0) return 0;
    const takes = world.reg.structTakes[t.kind[slot]!];
    if (!takes) return 0;
    resetHit();
    hit.base = src.base * share;
    hit.type = src.type;
    hit.quality = src.quality;
    hit.draw = src.draw;
    hit.attack = src.attack * (src.by ? buffs.dealtOf(src.by) : 1);
    hit.takes = takes[src.type]!;
    hit.rule = this.ctx.rules.values.structureDamage;
    // What its own side built: likewise nothing, but for a blast.
    if (src.by && src.type !== DMG_EXPLOSIVE && this.ctx.rules.values.friendlyFire === 0 && src.by.team !== 0 && src.by.team === t.owner[slot]) hit.rule = 0;
    resolveDamage();
    if (!(harm.health > 0)) return 0;
    const before = t.hp[slot]!;
    const left = structs.damage(ref, harm.health);
    const done = left === 0 ? before : harm.health;
    this.structureHits++;
    this.lastStructure.ref = ref;
    this.lastStructure.damage = done;
    this.lastStructure.left = left;
    const ac = src.by ? this.clientOf(src.by.pid) : null;
    if (ac) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_HIT);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      w.bits(ZONE_NONE, 4);
      w.u16(Math.min(65535, Math.max(1, Math.round(done))));
      w.bool(left === 0);
      w.bool(false);
      game.endOwn(ac);
    }
    return done;
  }

  /**
   * Something went off at (x, y, z). Every body within `radius` that it has a
   * clear line to, and everything built within it, takes what `src` brings:
   * all of it within a metre, and less the further off, to nothing at the edge.
   */
  blast(src: Source, x: number, y: number, z: number, radius: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const dims = world.dims;
    const fade = (far: number): number => (far <= 1 ? 1 : far >= radius ? 0 : 1 - (far - 1) / (radius - 1));
    const base = src.base;
    // Who is in reach is found first: a blast that kills changes the lists it would be walking.
    const found = this.found;
    const share = this.share;
    found.length = share.length = 0;
    const x0 = Math.max(0, Math.floor((x - radius - 2) / CHUNK_METRES));
    const x1 = Math.min(dims.chunksX - 1, Math.floor((x + radius + 2) / CHUNK_METRES));
    const z0 = Math.max(0, Math.floor((z - radius - 2) / CHUNK_METRES));
    const z1 = Math.min(dims.chunksZ - 1, Math.floor((z + radius + 2) / CHUNK_METRES));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
          if ((ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
          const kind = ents.kind[i]!;
          const mx = ents.x[i]! - x;
          const my = ents.y[i]! + reg.bodyHeight[kind]! * 0.5 - y;
          const mz = ents.z[i]! - z;
          // From the blast to the nearest of the body, about: its middle, less its girth.
          const mid = Math.sqrt(mx * mx + my * my + mz * mz);
          const far = Math.max(0, mid - reg.bodyRadius[kind]!);
          if (far >= radius) continue;
          // Something of the world between the two shields it.
          if (mid > 0.5 && castWorld(world, x, y + 0.1, z, mx / mid, (my - 0.1) / mid, mz / mid, mid - 0.3) !== HIT_NONE) continue;
          found.push(i);
          share.push(fade(far));
        }
      }
    }
    for (let k = 0; k < found.length; k++) {
      const i = found[k]!;
      if ((ents.flags[i]! & F_ALIVE) === 0) continue;
      src.base = base * share[k]!;
      const kind = ents.kind[i]!;
      const by = ents.y[i]! + reg.bodyHeight[kind]! * 0.5;
      this.land(src, i, ZONE_NONE, ents.x[i]!, by, ents.z[i]!, Math.sqrt((ents.x[i]! - x) * (ents.x[i]! - x) + (by - y) * (by - y) + (ents.z[i]! - z) * (ents.z[i]! - z)));
    }
    src.base = base;
    // Everything built within reach, by how near its nearest point is.
    const structs = world.structs;
    const n = structs.query(x - radius, z - radius, x + radius, z + radius, this.refs);
    found.length = share.length = 0;
    for (let k = 0; k < n; k++) {
      const ref = this.refs[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const kind = t.kind[slot]!;
      // The blast in the box's own frame, and the point of the box nearest it.
      const a = (t.yaw[slot]! * Math.PI * 2) / 65536;
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const px = x - t.x[slot]!;
      const pz = z - t.z[slot]!;
      const lx = cs * px - sn * pz;
      const ly = y - t.y[slot]!;
      const lz = sn * px + cs * pz;
      const hx = structs.halfXOf(kind);
      const hy = structs.halfYOf(kind);
      const hz = structs.halfZOf(kind);
      const ex = lx - Math.max(-hx, Math.min(hx, lx));
      const ey = ly - Math.max(-hy, Math.min(hy, ly));
      const ez = lz - Math.max(-hz, Math.min(hz, lz));
      const far = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (far >= radius) continue;
      found.push(ref);
      share.push(fade(far));
    }
    for (let k = 0; k < found.length; k++) {
      const ref = found[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      this.hitStructure(src, ref, t.x[slot]!, t.y[slot]!, t.z[slot]!, share[k]!);
    }
  }

  /**
   * A body's health reached zero, and `by` (a persistent id, or 0) did it.
   * Called before the body is taken out of the world: whoever killed it has
   * the experience and what it yields.
   */
  killed(rec: EntityRecord, by: number): void {
    this.died = true;
    const { world, records, items, progression, game } = this.ctx;
    const killer = by !== 0 ? records.byPid.get(by) : undefined;
    if (!killer || killer === rec || killer.dead) return;
    const reg = world.reg;
    const def = reg.defs[rec.kind] as SpeciesDef;
    const level = rec.kind === this.survivor ? progression.levelOf(rec.xp) : (rec.genome?.level ?? 1);
    const xp = Math.round((def.killXp ?? 0) * (1 + 0.1 * (level - 1)) * 10) / 10;
    progression.addXp(killer, xp);
    for (const drop of def.drops ?? []) {
      const n = drop.min + this.rng.int(drop.max - drop.min + 1);
      if (n > 0) items.mint(killer, reg.index.get(drop.item)!, n);
    }
    const kc = this.clientOf(killer.pid);
    if (kc) {
      const w = game.begin(S_EVENT);
      w.u8(EVENT_KILL);
      w.string(rec.name !== "" ? rec.name.slice(0, 24) : speciesLabel(def.id));
      w.u16(level);
      w.u16(Math.min(65535, Math.round(xp * 10)));
      game.endOwn(kc);
    }
  }

  private clientOf(pid: number): Client | null {
    for (const c of this.ctx.game.clients) if (c?.active && !c.closed && c.pid === pid) return c;
    return null;
  }
}

/** A species' id without its namespace, for when a body has no name of its own. */
function speciesLabel(id: string): string {
  return id.slice(id.indexOf(":") + 1);
}
