// A shot is judged as its shooter saw it. A rifle round is one piece, tested against the bodies of Combat.viewTick.
// An arrow flies one piece a tick. On the tick it is fired it first flies from the view tick up to now.

import { TAU } from "../shared/math/scalar.ts";
import { EVENT_BLAST, EVENT_SHOT, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { QUALITY_MUL } from "../shared/sim/items.ts";
import { FLIGHT_TICKS, HITSCAN_RANGE, WATER_SPEED, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../shared/sim/projectiles.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { HIT_NONE, HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import type { Combat, Source } from "./combat.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

/** One more than this in flight and the oldest is dropped. */
export const MAX_FLYING = 4096;
/** Arrows left standing where they landed. */
export const MAX_STUCK = 2048;
export const STUCK_TICKS = 60 * TICK_RATE;
/** Horizontal metres, and the ticks between pickup checks. */
const PICKUP_REACH = 1.2;
const PICKUP_EVERY = 5;
/** Clients within this many metres of a shot are sent it. */
const HEARD = 260;
/** A stuck arrow stands this many metres back from what it hit. */
const STAND_OUT = 0.06;
const MAX_THROWN = 256;
/** A throw adds LOFT of upward speed. A bounce keeps BOUNCE of the speed into the surface and SLIDE of the speed along it. */
const GRAVITY = 9.81;
const LOFT = 2.5;
const BOUNCE = 0.4;
const SLIDE = 0.7;
const REST_SPEED = 1.2;

export interface ProjectilesContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly combat: Combat;
}

interface Flying extends Flight {
  gravity: number;
  ammo: number;
  weapon: number;
  quality: number;
  draw: number;
  /** The shooter's record id and entity index, so the shot skips its own shooter. */
  by: number;
  self: number;
  /** Where it left from. */
  ox: number;
  oy: number;
  oz: number;
  /** The last tick it may fly, and the tick it has been flown through. */
  until: number;
  flown: number;
  /** `wet` means its weapon works under water. `under` means it is under water now. */
  wet: boolean;
  under: boolean;
}

interface Thrown extends Flight {
  item: number;
  quality: number;
  by: number;
  until: number;
  /** The prop entity that shows it. */
  ent: number;
  gen: number;
  resting: boolean;
}

interface Stuck {
  ent: number;
  gen: number;
  ammo: number;
  until: number;
}

export class Projectiles {
  /** Counters for tests and measurement. */
  fired = 0;
  struck = 0;
  recovered = 0;
  /** Where the last shot ended. `on` is an entity index, -1 for the world, or -2 for water. */
  readonly lastEnd = { x: 0, y: 0, z: 0, on: -1 };

  private readonly ctx: ProjectilesContext;
  private readonly flying: Flying[] = [];
  private readonly stuck: Stuck[] = [];
  private readonly thrown: Thrown[] = [];
  bursts = 0;
  private readonly stuckKind: number;
  private readonly liveKind: number;
  private readonly rng: Rng;
  private readonly dir = [0, 0, 0];
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };

  constructor(ctx: ProjectilesContext, seed: number) {
    this.ctx = ctx;
    this.stuckKind = ctx.world.reg.index.get("core:arrow_stuck") ?? 0;
    this.liveKind = ctx.world.reg.index.get("core:grenade_live") ?? 0;
    this.rng = new Rng(seed);
  }

  get flyingCount(): number {
    return this.flying.length;
  }

  get stuckCount(): number {
    return this.stuck.length;
  }

  get thrownCount(): number {
    return this.thrown.length;
  }

  /** For tests. */
  thrownAt(i: number): { x: number; y: number; z: number; resting: boolean } {
    return this.thrown[i]!;
  }

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
      // A round with no speed is not flown. It is one piece, tested at the shooter's view tick.
      let reach = HITSCAN_RANGE;
      let on = -1;
      // Water stops a round fired from above it.
      if (oy > sea && d[1]! < 0 && (sea - oy) / d[1]! < reach) {
        reach = (sea - oy) / d[1]!;
        on = -2;
      }
      let built = -1;
      const what = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
      if (what !== HIT_NONE) {
        reach = rayHit.t;
        on = -1;
        if (what === HIT_STRUCTURE) built = rayHit.ref;
      }
      const target = combat.castBodies(e, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach, 0, view);
      const t = target >= 0 ? combat.t : reach;
      const x = ox + d[0]! * t;
      const y = oy + d[1]! * t;
      const z = oz + d[2]! * t;
      this.tell(c, ox, oy, oz, ammo, false, x, y, z, 0);
      if (target >= 0) this.hit(rec, weapon, quality, ammo, 1, ox, oy, oz, target, combat.zone, x, y, z);
      else {
        this.ended(x, y, z, on);
        if (built >= 0) combat.hitStructure(this.bring(rec, weapon, quality, ammo, 1, ox, oz), built, x, y, z);
      }
      return;
    }

    const speed = launchSpeed(full, draw) * (wet && oy < sea ? WATER_SPEED : 1);
    const f: Flying = {
      x: ox, y: oy, z: oz, vx: d[0]! * speed, vy: d[1]! * speed, vz: d[2]! * speed,
      gravity: reg.ammoGravity[ammo]!, ammo, weapon, quality, draw, by: rec.pid, self: e, ox, oy, oz,
      until: now + FLIGHT_TICKS, flown: now, wet, under: oy < sea,
    };
    // Nearby clients get its launch state and fly their own copy from there.
    const back = now - view;
    this.tell(c, ox, oy, oz, ammo, true, f.vx, f.vy, f.vz, Math.round(back));
    // Fly it from the view tick to now, one tick's piece at a time, each against the bodies of that tick,
    // then the leftover part of a tick.
    const whole = Math.floor(back);
    for (let j = 1; j <= whole; j++) if (!this.fly(f, view + j, 1)) return;
    if (back - whole > 0.01 && !this.fly(f, now, back - whole)) return;
    if (this.flying.length >= MAX_FLYING) this.flying.shift();
    this.flying.push(f);
  }

  step(): void {
    const tick = this.ctx.world.tick;
    const flying = this.flying;
    let kept = 0;
    for (let i = 0; i < flying.length; i++) {
      const f = flying[i]!;
      // A shot fired this tick has already been flown up to now.
      if (f.flown < tick && !(tick <= f.until && this.fly(f, tick, 1))) continue;
      flying[kept++] = f;
    }
    flying.length = kept;

    const thrown = this.thrown;
    kept = 0;
    for (let i = 0; i < thrown.length; i++) {
      const g = thrown[i]!;
      if (tick >= g.until) {
        this.burst(g);
        continue;
      }
      if (!g.resting) this.roll(g);
      thrown[kept++] = g;
    }
    thrown.length = kept;

    const stuck = this.stuck;
    const ents = this.ctx.world.ents;
    while (stuck.length > 0 && (tick >= stuck[0]!.until || !this.stands(stuck[0]!))) {
      const s = stuck.shift()!;
      if (this.stands(s)) ents.destroy(s.ent);
    }
    if (tick % PICKUP_EVERY === 0 && stuck.length > 0) this.pickUp();
  }

  /** Flies `f` for `share` of a tick, to tick `t`, which is now or a tick the history remembers. Returns false if it ended. */
  private fly(f: Flying, t: number, share: number): boolean {
    const { world, combat, records } = this.ctx;
    const dt = share / TICK_RATE;
    f.flown = Math.floor(t);
    flyStep(f, f.gravity, dt);
    let length = piece.length;
    if (!(length > 0)) return false;
    const { x, y, z, dx, dy, dz } = piece;
    const sea = world.hf.seaLevel;
    // At the surface a shot from a dry weapon stops. One from a wet weapon goes on, slowed.
    let splash = false;
    if (!f.under && y > sea && y + dy * length <= sea) {
      length = (sea - y) / dy;
      splash = true;
    }
    let on = splash ? -2 : -1;
    let ends = splash && !f.wet;
    let built = -1;
    const what = castWorld(world, x, y, z, dx, dy, dz, length);
    if (what !== HIT_NONE) {
      length = rayHit.t;
      on = -1;
      ends = true;
      splash = false;
      if (what === HIT_STRUCTURE) built = rayHit.ref;
    }
    // Skip the shooter, if its entity slot still holds it.
    const shooter = (world.ents.flags[f.self]! & F_ALIVE) !== 0 && world.ents.pid[f.self] === f.by ? f.self : -1;
    // A piece cut short by the world took that much less of the tick.
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
      // A structure it hit takes the damage. If that destroyed it, the arrow has nothing to stand in.
      const gone = built >= 0 && combat.hitStructure(this.bring(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oz), built, hx, hy, hz) > 0 && combat.lastStructure.left === 0;
      // An arrow that hit the world and did not break stands where it landed.
      if (on === -1 && !gone && this.rng.float() < world.reg.ammoRecover[f.ammo]!) this.stand(f.ammo, hx - dx * STAND_OUT, hy - dy * STAND_OUT, hz - dz * STAND_OUT, dx, dy, dz);
      return false;
    }
    flyEnd(f, f.gravity, dt);
    if (splash) {
      f.under = true;
      f.vx *= WATER_SPEED;
      f.vy *= WATER_SPEED;
      f.vz *= WATER_SPEED;
    } else if (f.under && f.y > sea) f.under = false;
    return f.x >= 0 && f.z >= 0 && f.x <= world.hf.sizeX && f.z <= world.hf.sizeZ && f.y > -1000;
  }

  private hit(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oy: number, oz: number, target: number, zone: number, x: number, y: number, z: number): void {
    const src = this.bring(by, weapon, quality, ammo, draw, ox, oz);
    this.struck++;
    this.ended(x, y, z, target);
    this.ctx.combat.land(src, target, zone, x, y, z, Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz)));
  }

  /** Returns the shared Source, filled for a round of `ammo` from `weapon`. */
  private bring(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oz: number): Source {
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
    src.torporInstant = reg.ammoTorpor[ammo]!;
    src.torporOver = reg.ammoTorporOver[ammo]!;
    src.torporSeconds = reg.ammoTorporSeconds[ammo]!;
    src.buff = reg.ammoBuff[ammo]!;
    return src;
  }

  /** Throws one `item` from the eye of `c`'s body. It goes off when its fuse runs out, wherever it then is. */
  lob(c: Client, rec: EntityRecord, item: number, quality: number): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    if (e < 0 || this.liveKind === 0) return;
    const d = this.dir;
    lookDirection(ents.yaw[e]!, ents.pitch[e]!, d);
    const speed = reg.throwSpeed[item]!;
    const x = ents.x[e]! + d[0]! * 0.5;
    const y = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!) + d[1]! * 0.5;
    const z = ents.z[e]! + d[2]! * 0.5;
    const ent = ents.create(this.liveKind, x, y, z, F_PROP);
    if (ent < 0) return;
    if (this.thrown.length >= MAX_THROWN) this.burst(this.thrown.shift()!);
    this.thrown.push({ x, y, z, vx: d[0]! * speed, vy: d[1]! * speed + LOFT, vz: d[2]! * speed, item, quality, by: rec.pid, until: world.tick + reg.fuseTicks[item]!, ent, gen: ents.gen[ent]!, resting: false });
    this.fired++;
  }

  /** One tick of falling and bouncing. */
  private roll(g: Thrown): void {
    const world = this.ctx.world;
    let left = 1;
    for (let bounce = 0; bounce < 3 && left > 0.001 && !g.resting; bounce++) {
      const dt = left / TICK_RATE;
      flyStep(g, GRAVITY, dt);
      const length = piece.length;
      if (!(length > 1e-6)) break;
      if (castWorld(world, piece.x, piece.y, piece.z, piece.dx, piece.dy, piece.dz, length) === HIT_NONE) {
        flyEnd(g, GRAVITY, dt);
        break;
      }
      // It hit something partway. Place it 3 cm off the surface, with the speed it had by then.
      const part = rayHit.t / length;
      const nx = rayHit.nx;
      const ny = rayHit.ny;
      const nz = rayHit.nz;
      g.x = piece.x + piece.dx * rayHit.t + nx * 0.03;
      g.y = piece.y + piece.dy * rayHit.t + ny * 0.03;
      g.z = piece.z + piece.dz * rayHit.t + nz * 0.03;
      g.vy -= GRAVITY * dt * part;
      const into = g.vx * nx + g.vy * ny + g.vz * nz;
      if (into < 0) {
        g.vx = (g.vx - into * nx) * SLIDE - into * nx * BOUNCE;
        g.vy = (g.vy - into * ny) * SLIDE - into * ny * BOUNCE;
        g.vz = (g.vz - into * nz) * SLIDE - into * nz * BOUNCE;
      }
      left *= 1 - part;
      // Slow, on a surface near level, it comes to rest.
      if (ny > 0.7 && g.vx * g.vx + g.vy * g.vy + g.vz * g.vz < REST_SPEED * REST_SPEED) {
        g.resting = true;
        g.vx = g.vy = g.vz = 0;
      }
    }
    const hf = world.hf;
    g.x = g.x < 0 ? 0 : g.x > hf.sizeX ? hf.sizeX : g.x;
    g.z = g.z < 0 ? 0 : g.z > hf.sizeZ ? hf.sizeZ : g.z;
    if ((world.ents.flags[g.ent]! & F_ALIVE) !== 0 && world.ents.gen[g.ent] === g.gen) world.ents.setPosition(g.ent, g.x, g.y, g.z);
  }

  private burst(g: Thrown): void {
    const { world, records, combat, game } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    if ((ents.flags[g.ent]! & F_ALIVE) !== 0 && ents.gen[g.ent] === g.gen) ents.destroy(g.ent);
    const src = this.src;
    src.by = records.byPid.get(g.by) ?? null;
    src.x = g.x;
    src.z = g.z;
    src.item = g.item;
    src.base = reg.damage[g.item]!;
    src.type = reg.damageType[g.item]!;
    src.quality = QUALITY_MUL[g.quality] ?? 1;
    src.draw = 1;
    src.attack = 1;
    src.torporInstant = src.torporOver = src.torporSeconds = 0;
    src.buff = 0;
    const radius = reg.blast[g.item]!;
    this.bursts++;
    this.ended(g.x, g.y, g.z, -1);
    for (const other of game.clients) {
      if (!other?.active || other.closed) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      if ((bx - g.x) * (bx - g.x) + (bz - g.z) * (bz - g.z) > HEARD * HEARD) continue;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_BLAST);
      w.f32(g.x);
      w.f32(g.y);
      w.f32(g.z);
      w.f32(radius);
      game.endOwn(other);
    }
    combat.blast(src, g.x, g.y + 0.05, g.z, radius);
  }

  private ended(x: number, y: number, z: number, on: number): void {
    const last = this.lastEnd;
    last.x = x;
    last.y = y;
    last.z = z;
    last.on = on;
  }

  private stand(ammo: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const ents = this.ctx.world.ents;
    if (this.stuckKind === 0) return;
    if (this.stuck.length >= MAX_STUCK) {
      const old = this.stuck.shift()!;
      if (this.stands(old)) ents.destroy(old.ent);
    }
    const e = ents.create(this.stuckKind, x, y, z, F_PROP);
    if (e < 0) return;
    // Yaw and pitch point it the way it was flying. Both are sent like any body's.
    ents.yaw[e] = Math.round((Math.atan2(dx, dz) / TAU) * 65536) & 0xffff;
    ents.pitch[e] = Math.round((Math.asin(dy < -1 ? -1 : dy > 1 ? 1 : dy) / (Math.PI / 2)) * 16384);
    ents.pose(e);
    this.stuck.push({ ent: e, gen: ents.gen[e]!, ammo, until: this.ctx.world.tick + STUCK_TICKS });
  }

  /** Whether the arrow's entity is still the one made for it. */
  private stands(s: Stuck): boolean {
    const ents = this.ctx.world.ents;
    return (ents.flags[s.ent]! & F_ALIVE) !== 0 && ents.gen[s.ent] === s.gen && ents.kind[s.ent] === this.stuckKind;
  }

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
   * Sends the shot to every nearby client but the shooter. `a`, `b`, `c` are its velocity if it flies,
   * else where it ended. `back` is how many ticks ago it left.
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
