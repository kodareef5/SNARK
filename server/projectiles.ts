// Shots: the rifle round that arrives the tick it is fired, and the arrows and
// darts that fly.
//
// One rule for all of them: a shot is a piece of a path, tested against the
// world and the bodies in it. A rifle round is one long piece. An arrow is one
// piece a tick (shared/sim/projectiles.ts) for as long as it flies.
//
// A shot is judged as its shooter saw it. A client draws everyone else a few
// ticks in the past; it aims at that picture. So the bodies a shot is tested
// against are where the history ring says they were at the moment the shooter
// was looking at (Combat.viewTick), no more than twelve ticks back. A rifle
// round is tested once, there. An arrow is flown through those remembered ticks
// at once, the tick it is fired, each piece against the bodies of its own
// moment; if it has hit nothing by now, it flies on in the present. The harm a
// hit does is done now, to the body as it now is.
//
// An arrow that hits the world and does not break stands where it landed for a
// minute, as a prop anyone can see, and is picked up by walking over it. The
// round that was fired is spent on the books when it leaves; one picked up is
// made anew.

import { TAU } from "../shared/math/scalar.ts";
import { EVENT_SHOT, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { QUALITY_MUL } from "../shared/sim/items.ts";
import { FLIGHT_TICKS, HITSCAN_RANGE, WATER_SPEED, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../shared/sim/projectiles.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { HIT_NONE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Combat, Source } from "./combat.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** Things in flight at once, at most. One more than that and the oldest is given up. */
export const MAX_FLYING = 4096;
/** Arrows standing where they landed, at most; and how long one stands. */
export const MAX_STUCK = 2048;
export const STUCK_TICKS = 60 * TICK_RATE;
/** How near a body must come to an arrow to pick it up, and how often that is looked for. */
const PICKUP_REACH = 1.2;
const PICKUP_EVERY = 5;
/** Whoever is within this of a shot is told of it. */
const HEARD = 260;
/** A stuck arrow stands this far back out of what it hit. */
const STAND_OUT = 0.06;

export interface ProjectilesContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly combat: Combat;
}

/** One thing in flight. */
interface Flying extends Flight {
  gravity: number;
  ammo: number;
  weapon: number;
  quality: number;
  draw: number;
  /** Who fired it (a persistent id) and from which entity slot, so that it does not hit its own shooter. */
  by: number;
  self: number;
  /** Where it left from. */
  ox: number;
  oy: number;
  oz: number;
  /** The last tick it may fly, and the tick it has been flown through. */
  until: number;
  flown: number;
  /** It was fired from something that works under water, and whether it is under water now. */
  wet: boolean;
  under: boolean;
}

interface Stuck {
  ent: number;
  gen: number;
  ammo: number;
  until: number;
}

export class Projectiles {
  /** Shots fired, shots that hit a body, and arrows picked up again, for tests and measurement. */
  fired = 0;
  struck = 0;
  recovered = 0;
  /** Where the last shot that ended did so, and on what: an entity index, or -1 for the world, or -2 for water. */
  readonly lastEnd = { x: 0, y: 0, z: 0, on: -1 };

  private readonly ctx: ProjectilesContext;
  private readonly flying: Flying[] = [];
  private readonly stuck: Stuck[] = [];
  private readonly stuckKind: number;
  private readonly rng: Rng;
  private readonly dir = [0, 0, 0];
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0 };

  constructor(ctx: ProjectilesContext, seed: number) {
    this.ctx = ctx;
    this.stuckKind = ctx.world.reg.index.get("core:arrow_stuck") ?? 0;
    this.rng = new Rng(seed);
  }

  get flyingCount(): number {
    return this.flying.length;
  }

  get stuckCount(): number {
    return this.stuck.length;
  }

  /** A round of `ammo` leaves `weapon` (of `quality`), drawn `draw`, from the eye of `c`'s body along its look. */
  launch(c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, draw: number): void {
    const { world, combat } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    if (e < 0 || ammo === 0) return;
    const d = this.dir;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    const ox = ents.x[e]!;
    const oy = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
    const oz = ents.z[e]!;
    const now = world.tick;
    const view = combat.viewTick(c);
    this.fired++;
    const full = reg.ammoSpeed[ammo]!;
    const sea = world.hf.seaLevel;
    const wet = reg.weapon[weapon]?.wet ?? false;

    if (full <= 0) {
      // Not flown: one piece, as far as it reaches, judged at the moment the shooter was looking at.
      let reach = HITSCAN_RANGE;
      let on = -1;
      // Water stops a round fired from above it.
      if (oy > sea && d[1]! < 0 && (sea - oy) / d[1]! < reach) {
        reach = (sea - oy) / d[1]!;
        on = -2;
      }
      if (castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach) !== HIT_NONE) {
        reach = rayHit.t;
        on = -1;
      }
      const target = combat.castBodies(e, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach, 0, view);
      const t = target >= 0 ? combat.t : reach;
      const x = ox + d[0]! * t;
      const y = oy + d[1]! * t;
      const z = oz + d[2]! * t;
      this.tell(c, ox, oy, oz, ammo, false, x, y, z, 0);
      if (target >= 0) this.hit(rec, weapon, quality, ammo, 1, ox, oy, oz, target, combat.zone, x, y, z);
      else this.ended(x, y, z, on);
      return;
    }

    const speed = launchSpeed(full, draw) * (wet && oy < sea ? WATER_SPEED : 1);
    const f: Flying = {
      x: ox, y: oy, z: oz, vx: d[0]! * speed, vy: d[1]! * speed, vz: d[2]! * speed,
      gravity: reg.ammoGravity[ammo]!, ammo, weapon, quality, draw, by: rec.pid, self: e, ox, oy, oz,
      until: now + FLIGHT_TICKS, flown: now, wet, under: oy < sea,
    };
    // Whoever is near is told of it as it left: they fly their own picture of it from there.
    const back = now - view;
    this.tell(c, ox, oy, oz, ammo, true, f.vx, f.vy, f.vz, Math.round(back));
    // Flown through the time since the shooter's picture: a tick's piece at a time, each against the bodies
    // of its own moment, then whatever part of a tick is left, which brings it to now.
    const whole = Math.floor(back);
    for (let j = 1; j <= whole; j++) if (!this.fly(f, view + j, 1)) return;
    if (back - whole > 0.01 && !this.fly(f, now, back - whole)) return;
    if (this.flying.length >= MAX_FLYING) this.flying.shift();
    this.flying.push(f);
  }

  /** Once a tick: fly everything in flight, take away arrows that have stood their time, and give those walked over to whoever walked. */
  step(): void {
    const tick = this.ctx.world.tick;
    const flying = this.flying;
    let kept = 0;
    for (let i = 0; i < flying.length; i++) {
      const f = flying[i]!;
      // One fired this tick has been flown up to now already.
      if (f.flown < tick && !(tick <= f.until && this.fly(f, tick, 1))) continue;
      flying[kept++] = f;
    }
    flying.length = kept;

    const stuck = this.stuck;
    const ents = this.ctx.world.ents;
    while (stuck.length > 0 && (tick >= stuck[0]!.until || !this.stands(stuck[0]!))) {
      const s = stuck.shift()!;
      if (this.stands(s)) ents.destroy(s.ent);
    }
    if (tick % PICKUP_EVERY === 0 && stuck.length > 0) this.pickUp();
  }

  /**
   * Fly `f` for `share` of a tick, to the moment `t` (now, or a moment the
   * history remembers): one piece, against water, the world and the bodies of
   * that moment. False if it ended.
   */
  private fly(f: Flying, t: number, share: number): boolean {
    const { world, combat, records } = this.ctx;
    const dt = share / TICK_RATE;
    f.flown = Math.floor(t);
    flyStep(f, f.gravity, dt);
    let length = piece.length;
    if (!(length > 0)) return false;
    const { x, y, z, dx, dy, dz } = piece;
    const sea = world.hf.seaLevel;
    // The surface: what is not made for water stops there; what is goes on, slowly.
    let splash = false;
    if (!f.under && y > sea && y + dy * length <= sea) {
      length = (sea - y) / dy;
      splash = true;
    }
    let on = splash ? -2 : -1;
    let ends = splash && !f.wet;
    if (castWorld(world, x, y, z, dx, dy, dz, length) !== HIT_NONE) {
      length = rayHit.t;
      on = -1;
      ends = true;
      splash = false;
    }
    // Its own shooter is in its way for the first piece only if it is skipped: it always is.
    const shooter = (world.ents.flags[f.self]! & F_ALIVE) !== 0 && world.ents.pid[f.self] === f.by ? f.self : -1;
    // The piece was cut short where it met the world, and took that much less of the tick.
    const target = combat.castBodies(shooter, x, y, z, dx, dy, dz, length, 0, t, (share * length) / piece.length);
    if (target >= 0) {
      const at = combat.t;
      this.hit(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oy, f.oz, target, combat.zone, x + dx * at, y + dy * at, z + dz * at);
      return false;
    }
    if (ends) {
      const hx = x + dx * length;
      const hy = y + dy * length;
      const hz = z + dz * length;
      this.ended(hx, hy, hz, on);
      // One that hit the ground or a wall and did not break stands there.
      if (on === -1 && this.rng.float() < world.reg.ammoRecover[f.ammo]!) this.stand(f.ammo, hx - dx * STAND_OUT, hy - dy * STAND_OUT, hz - dz * STAND_OUT, dx, dy, dz);
      return false;
    }
    flyEnd(f, f.gravity, dt);
    if (splash) {
      f.under = true;
      f.vx *= WATER_SPEED;
      f.vy *= WATER_SPEED;
      f.vz *= WATER_SPEED;
    } else if (f.under && f.y > sea) f.under = false;
    // Off the map, or through the floor of the world: gone.
    return f.x >= 0 && f.z >= 0 && f.x <= world.hf.sizeX && f.z <= world.hf.sizeZ && f.y > -1000;
  }

  /** A shot reached a body: what it brings is worked out from the weapon and the round, and lands. */
  private hit(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oy: number, oz: number, target: number, zone: number, x: number, y: number, z: number): void {
    const reg = this.ctx.world.reg;
    const src = this.src;
    src.by = by;
    src.x = ox;
    src.z = oz;
    src.item = weapon;
    src.base = reg.damage[ammo]! * reg.power[weapon]!;
    src.type = reg.damageType[ammo]!;
    src.quality = QUALITY_MUL[quality] ?? 1;
    src.draw = draw;
    src.attack = 1;
    src.torporInstant = src.torporOver = 0;
    this.struck++;
    this.ended(x, y, z, target);
    this.ctx.combat.land(src, target, zone, x, y, z, Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz)));
  }

  private ended(x: number, y: number, z: number, on: number): void {
    const last = this.lastEnd;
    last.x = x;
    last.y = y;
    last.z = z;
    last.on = on;
  }

  /** Stand an arrow of `ammo` at (x, y, z), pointing along (dx, dy, dz), for anyone to pick up. */
  private stand(ammo: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const ents = this.ctx.world.ents;
    if (this.stuckKind === 0) return;
    if (this.stuck.length >= MAX_STUCK) {
      const old = this.stuck.shift()!;
      if (this.stands(old)) ents.destroy(old.ent);
    }
    const e = ents.create(this.stuckKind, x, y, z, F_PROP);
    if (e < 0) return;
    // Its facing and its tilt are the way it was flying: both are sent with it, as any body's are.
    ents.yaw[e] = Math.round((Math.atan2(dx, dz) / TAU) * 65536) & 0xffff;
    ents.pitch[e] = Math.round((Math.asin(dy < -1 ? -1 : dy > 1 ? 1 : dy) / (Math.PI / 2)) * 16384);
    ents.pose(e);
    this.stuck.push({ ent: e, gen: ents.gen[e]!, ammo, until: this.ctx.world.tick + STUCK_TICKS });
  }

  /** Whether a stuck arrow's entity is still the one that was made for it. */
  private stands(s: Stuck): boolean {
    const ents = this.ctx.world.ents;
    return (ents.flags[s.ent]! & F_ALIVE) !== 0 && ents.gen[s.ent] === s.gen && ents.kind[s.ent] === this.stuckKind;
  }

  /** Every body standing over an arrow takes it, if it has room. */
  private pickUp(): void {
    const { world, game, records, items } = this.ctx;
    const ents = world.ents;
    const stuck = this.stuck;
    for (const c of game.clients) {
      if (!c?.active || c.ent < 0) continue;
      const rec = records.byPid.get(c.pid);
      if (!rec) continue;
      const x = ents.x[c.ent]!;
      const y = ents.y[c.ent]!;
      const z = ents.z[c.ent]!;
      for (let i = 0; i < stuck.length; i++) {
        const s = stuck[i]!;
        const dx = ents.x[s.ent]! - x;
        const dz = ents.z[s.ent]! - z;
        const dy = ents.y[s.ent]! - y;
        if (dx * dx + dz * dz > PICKUP_REACH * PICKUP_REACH || dy < -1 || dy > 2.2 || !this.stands(s)) continue;
        if (items.mint(rec, s.ammo, 1) !== 1) continue;
        ents.destroy(s.ent);
        stuck.splice(i--, 1);
        this.recovered++;
      }
    }
  }

  /**
   * Tell everyone near a shot, but the one who fired it, that it was fired:
   * from where, what, and either how it flies (a velocity, and how many ticks
   * ago it left) or where it ended.
   */
  private tell(shooter: Client, ox: number, oy: number, oz: number, ammo: number, flies: boolean, a: number, b: number, c: number, back: number): void {
    const game = this.ctx.game;
    const ents = this.ctx.world.ents;
    for (const other of game.clients) {
      if (!other?.active || other.closed || other === shooter) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      if ((bx - ox) * (bx - ox) + (bz - oz) * (bz - oz) > HEARD * HEARD) continue;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_SHOT);
      w.f32(ox);
      w.f32(oy);
      w.f32(oz);
      w.u16(ammo);
      w.bool(flies);
      w.f32(a);
      w.f32(b);
      w.f32(c);
      if (flies) w.u8(back);
      game.endOwn(other);
    }
  }
}
