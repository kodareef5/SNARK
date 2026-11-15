// A shot is judged as its shooter saw it. A rifle round is one piece, tested against the bodies of Combat.viewTick.
// An arrow flies one piece a tick. On the tick it is fired it first flies from the view tick up to now. A round with a blast
// goes off where it ends, and one that carries a light (the flare) flies as a prop every client draws (weapons-plan.md, W6).

import { TAU } from "../shared/math/scalar.ts";
import { EVENT_BLAST, EVENT_SHOT, S_EVENT } from "../shared/net/protocol.ts";
import { Rng } from "../shared/rng.ts";
import { aimSeed, aimShot, scopeFitted, shotAim, shotDir } from "../shared/sim/aim.ts";
import { Body, stanceEye } from "../shared/sim/character.ts";
import { shotRays } from "../shared/content/registry.ts";
import { falloff } from "../shared/sim/damage.ts";
import { FISTS } from "../shared/sim/weapon.ts";
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
import { event, type Bus } from "./events/bus.ts";

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
/**
 * A flare (a round that carries a light) rises as it was fired and, once it falls, sinks no faster than FLARE_FALL metres a
 * second and keeps FLARE_DRIFT of its speed across the ground each second, as a flare under its little canopy; it is out
 * where it lands, or after FLARE_TICKS. Ours: ARK says only that it lights "until it hits the ground" (Flare Gun, DEV150).
 */
export const FLARE_FALL = 2.5;
export const FLARE_DRIFT = 0.25;
export const FLARE_TICKS = 90 * TICK_RATE;
const FLARE_KEEP = Math.pow(FLARE_DRIFT, 1 / TICK_RATE);
/** A round that goes off on something stops this many metres short of it, so the blast is on the near side. */
const BLAST_OUT = 0.05;

export interface ProjectilesContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly combat: Combat;
  readonly bus: Bus;
}

const PROJECTILE_HIT = event("projectile.hit");

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
  /** Its weapon had a silencer: a survivor it hits is not shown its side. */
  silenced: boolean;
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

interface Flare extends Flight {
  gravity: number;
  until: number;
  /** The prop entity that shows it. */
  ent: number;
  gen: number;
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
  private readonly flares: Flare[] = [];
  /** Grenades that went off, and rounds that went off where they ended. */
  bursts = 0;
  blasts = 0;
  /** W5: a grenade with a cloud went off (server/clouds.ts): `item`, where, and its thrower's pid. */
  onCloud: ((item: number, x: number, y: number, z: number, by: number) => void) | null = null;
  /** While `fling` sends a throw: `tell` tells the thrower too. */
  private toShooter = false;
  private readonly stuckKind: number;
  private readonly liveKind: number;
  private readonly flareKind: number;
  private readonly rng: Rng;
  private readonly dir = [0, 0, 0];
  private readonly body = new Body();
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  /** A round's own, filled by `bring`, so the share its distance leaves it never reaches a blast. */
  private readonly round: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, far: 1 };
  /** Where the last ray `cast` ended: the point, metres from its origin, the body it hit (-1 for none), its zone, the structure it met (-1 for none) and `on` as lastEnd's. */
  private readonly at = { x: 0, y: 0, z: 0, t: 0, target: -1, zone: 0, built: -1, on: -1 };
  /** Rays the last shot sent, and how many of them hit a body: for tests and measurement. */
  readonly lastShot = { rays: 0, hits: 0 };

  constructor(ctx: ProjectilesContext, seed: number) {
    this.ctx = ctx;
    this.stuckKind = ctx.world.reg.index.get("core:arrow_stuck") ?? 0;
    this.liveKind = ctx.world.reg.index.get("core:grenade_live") ?? 0;
    this.flareKind = ctx.world.reg.index.get("core:flare_live") ?? 0;
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

  get flareCount(): number {
    return this.flares.length;
  }

  /** For tests. */
  flareAt(i: number): { x: number; y: number; z: number; vy: number; ent: number } {
    return this.flares[i]!;
  }

  /** For tests. */
  thrownAt(i: number): { x: number; y: number; z: number; resting: boolean } {
    return this.thrown[i]!;
  }

  /**
   * Fires one round of `ammo` from `weapon` from the eye of `c`'s body, judged at its view tick. The seams later work adds
   * to (planning/reference/weapons-plan.md, "Files more than one project touches"): `aim` gives each ray's direction, `ray`
   * judges a round with no speed and `flight` sends one that flies.
   */
  launch(c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, draw: number): void {
    const { world, combat } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    if (e < 0 || ammo === 0) return;
    const d = this.dir;
    const rays = shotRays(reg, weapon, ammo);
    this.aim(c, rec, weapon, 0, d, rays);
    const ox = ents.x[e]!;
    const oy = ents.y[e]! + stanceEye(reg.move[ents.kind[e]!]!, ents.stance[e]!);
    const oz = ents.z[e]!;
    this.fired++;
    if (reg.ammoLight[ammo]! > 0) {
      this.flare(ammo, draw, ox, oy, oz, d);
      return;
    }
    const view = combat.viewTick(c);
    this.lastShot.rays = rays;
    this.lastShot.hits = 0;
    this.silencedShot = this.silenced(rec);
    if (rays > 1) this.pellets(c, rec, weapon, quality, ammo, rays, ox, oy, oz, view);
    else if (reg.ammoSpeed[ammo]! <= 0) this.ray(c, rec, weapon, quality, ammo, ox, oy, oz, d, view);
    else this.flight(c, rec, weapon, quality, ammo, draw, ox, oy, oz, d, view);
  }

  /**
   * Whether the weapon in `rec`'s hand has a silencer, which needs no switching on: others are told the shot is silenced and
   * draw no flash, and a survivor it hits is not shown its side. Creatures still hear it (Silencer Attachment), and it is
   * told to as many clients as any shot (HEARD): how far the quiet shot carries is on no page (DEV146).
   */
  private silenced(rec: EntityRecord): boolean {
    const items = this.ctx.items;
    const inv = items.inv(rec);
    return inv.hotbar >= 0 && rec.held >= 0 && items.attachmentOf(inv, inv.hotbar + rec.held) === "silencer";
  }

  /**
   * The direction ray `k` of a shot from `weapon` leaves `c`'s body in, into `out`: the look as the input gave it, with the
   * body's kick and, through a scope, its sway, within the weapon's cone, at the place the seed of the body's handle and
   * this tick gives (shared/sim/aim.ts). The body is as this tick's step left it, as the shooter's client predicted it, so
   * its own tracer is this ray. The rays of a shot of many (W3) are more `k`: for one of `rays` above 1, the aim and cone
   * are kept as the 32-bit floats EVENT_SHOT carries them in, so every client lays the same rays (`shotSeed` keeps the seed).
   */
  private aim(c: Client, rec: EntityRecord, weapon: number, k: number, out: number[], rays = 1): void {
    const { world, items } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    const b = this.body;
    ents.loadBody(e, b);
    const inv = items.inv(rec);
    const slot = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    const handle = ents.handleOf(e);
    aimShot(b, c.heldButtons, reg.weapon[weapon] ?? FISTS, reg.tamedMove[b.kind]!, ents.yaw[e]!, ents.pitch[e]!, scopeFitted(reg, inv, slot), handle, world.tick);
    if (rays > 1) {
      shotAim.yaw = Math.fround(shotAim.yaw);
      shotAim.pitch = Math.fround(shotAim.pitch);
      shotAim.cone = Math.fround(shotAim.cone);
    }
    this.shotSeed = aimSeed(handle, world.tick);
    shotDir(this.shotSeed, k, shotAim.yaw, shotAim.pitch, shotAim.cone, out);
  }

  /** The seed of the shot `aim` last aimed. */
  private shotSeed = 0;
  /** Whether the shot being made has a silencer on its weapon (`silenced`). */
  private silencedShot = false;

  /**
   * A round of `rays` pellets (M3): each is its own ray of the cone from the seed, tested against the bodies of the view
   * tick and landed alone, as one round of one ray is. The shot is told once, by its aim, cone and seed in place of where it
   * ended, and each client lays the same rays (client/core/shots.ts). One shell and one use were spent for all of them.
   */
  private pellets(c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, rays: number, ox: number, oy: number, oz: number, view: number): void {
    const d = this.dir;
    const { yaw, pitch, cone } = shotAim;
    const seed = this.shotSeed;
    this.tell(c, ox, oy, oz, ammo, false, yaw, pitch, cone, 0, rays, seed, this.silencedShot);
    for (let k = 0; k < rays; k++) {
      shotDir(seed, k, yaw, pitch, cone, d);
      this.cast(c.ent, ox, oy, oz, d, view);
      this.strike(rec, weapon, quality, ammo, ox, oy, oz);
    }
  }

  /** A round with no speed is not flown. It is one piece along `d` from the origin, tested at the shooter's view tick. */
  private ray(c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, ox: number, oy: number, oz: number, d: readonly number[], view: number): void {
    const a = this.cast(c.ent, ox, oy, oz, d, view);
    this.tell(c, ox, oy, oz, ammo, false, a.x, a.y, a.z, 0, 1, 0, this.silencedShot);
    this.strike(rec, weapon, quality, ammo, ox, oy, oz);
  }

  /** Where one ray along `d` from the origin ends, against the world, water and the bodies of the view tick, into `at`. `self` is skipped. */
  private cast(self: number, ox: number, oy: number, oz: number, d: readonly number[], view: number): typeof this.at {
    const { world, combat } = this.ctx;
    const sea = world.hf.seaLevel;
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
    const target = combat.castBodies(self, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach, 0, view);
    const t = target >= 0 ? combat.t : reach;
    const a = this.at;
    a.x = ox + d[0]! * t;
    a.y = oy + d[1]! * t;
    a.z = oz + d[2]! * t;
    a.t = t;
    a.target = target;
    a.zone = combat.zone;
    a.built = built;
    a.on = on;
    return a;
  }

  /** Lands the round the last `cast` ended: on the body it hit, or on the structure it met, at the share its distance leaves it. */
  private strike(rec: EntityRecord, weapon: number, quality: number, ammo: number, ox: number, oy: number, oz: number): void {
    const a = this.at;
    // A round with a blast goes off where it ended, on a body or a little short of the world or the water. A miss into the
    // sky meets nothing and is lost.
    if (this.ctx.world.reg.ammoBlast[ammo]! > 0 && (a.target >= 0 || a.t < HITSCAN_RANGE)) {
      const out = a.target >= 0 ? 0 : Math.min(BLAST_OUT, a.t);
      const k = a.t > 0 ? out / a.t : 0;
      this.ended(a.x, a.y, a.z, a.target >= 0 ? a.target : a.on);
      this.explode(rec, weapon, quality, ammo, 1, ox, oz, a.x - (a.x - ox) * k, a.y - (a.y - oy) * k, a.z - (a.z - oz) * k, a.target);
      return;
    }
    if (a.target >= 0) {
      this.lastShot.hits++;
      this.hit(rec, weapon, quality, ammo, 1, ox, oy, oz, a.target, a.zone, a.x, a.y, a.z, this.silencedShot);
      return;
    }
    this.ended(a.x, a.y, a.z, a.on);
    if (a.built >= 0) this.ctx.combat.hitStructure(this.bring(rec, weapon, quality, ammo, 1, ox, oz, a.t), a.built, a.x, a.y, a.z);
  }

  /** A round that flies leaves along `d`, and is flown from the view tick up to now before it joins the others. */
  private flight(c: Client, rec: EntityRecord, weapon: number, quality: number, ammo: number, draw: number, ox: number, oy: number, oz: number, d: readonly number[], view: number): void {
    const silenced = this.silencedShot;
    const world = this.ctx.world;
    const reg = world.reg;
    const now = world.tick;
    const sea = world.hf.seaLevel;
    const wet = reg.weapon[weapon]?.wet ?? false;
    const speed = launchSpeed(reg.ammoSpeed[ammo]!, draw) * (wet && oy < sea ? WATER_SPEED : 1);
    const f: Flying = {
      x: ox, y: oy, z: oz, vx: d[0]! * speed, vy: d[1]! * speed, vz: d[2]! * speed,
      gravity: reg.ammoGravity[ammo]!, ammo, weapon, quality, draw, by: rec.pid, self: c.ent, ox, oy, oz,
      until: now + FLIGHT_TICKS, flown: now, wet, under: oy < sea, silenced,
    };
    // Nearby clients get its launch state and fly their own copy from there.
    const back = now - view;
    this.tell(c, ox, oy, oz, ammo, true, f.vx, f.vy, f.vz, Math.round(back), 1, 0, silenced);
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

    const flares = this.flares;
    kept = 0;
    for (let i = 0; i < flares.length; i++) {
      const f = flares[i]!;
      if (!this.drift(f)) {
        this.out(f);
        continue;
      }
      flares[kept++] = f;
    }
    flares.length = kept;

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
    const blast = world.reg.ammoBlast[f.ammo]! > 0;
    if (target >= 0) {
      const at = combat.t;
      if (blast) {
        this.ended(x + dx * at, y + dy * at, z + dz * at, target);
        this.explode(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oz, x + dx * at, y + dy * at, z + dz * at, target);
      } else this.hit(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oy, f.oz, target, combat.zone, x + dx * at, y + dy * at, z + dz * at, f.silenced);
      return false;
    }
    if (ends) {
      const hx = x + dx * length;
      const hy = y + dy * length;
      const hz = z + dz * length;
      this.ended(hx, hy, hz, on);
      // A round with a blast goes off a little short of what it met, and the blast is the whole of its harm.
      if (blast) {
        const out = Math.min(BLAST_OUT, length);
        this.explode(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oz, hx - dx * out, hy - dy * out, hz - dz * out, -1);
        return false;
      }
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

  private hit(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oy: number, oz: number, target: number, zone: number, x: number, y: number, z: number, silenced = false): void {
    const far = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz));
    const src = this.bring(by, weapon, quality, ammo, draw, ox, oz, far);
    src.silenced = silenced;
    this.struck++;
    this.ended(x, y, z, target);
    this.ctx.bus.after(PROJECTILE_HIT, { byPid: by ? by.pid : 0, ammo: this.ctx.world.reg.ids[ammo]!, target: this.ctx.world.ents.pid[target]! });
    this.ctx.combat.land(src, target, zone, x, y, z, far);
  }

  /** Returns the round's shared Source, filled for a round of `ammo` from `weapon` that came `far` metres (none given: no falloff). */
  private bring(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oz: number, far = 0): Source {
    const reg = this.ctx.world.reg;
    const src = this.round;
    src.far = falloff(far, reg.ammoFalloffFull[ammo]!, reg.ammoFalloffNone[ammo]!);
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
    src.silenced = false;
    src.pierce = reg.ammoPierce[ammo]!;
    return src;
  }

  /**
   * A round of `ammo` with a blast goes off at (x, y, z), as a grenade does (M8 of planning/reference/weapons-plan.md): every
   * body and structure within its reach takes it by distance, the body it hit straight on among them, so nothing is harmed
   * twice: `direct`, the body it struck, if any, takes it in full. Structures take it times the weapon's own factor
   * (`weapon.structures`, D435). A blast does not fall off with the distance the round flew.
   */
  private explode(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oz: number, x: number, y: number, z: number, direct: number): void {
    const radius = this.ctx.world.reg.ammoBlast[ammo]!;
    const src = this.bring(by, weapon, quality, ammo, draw, ox, oz);
    this.blasts++;
    this.boom(x, y, z, radius);
    this.ctx.combat.blast(src, x, y, z, radius, direct);
  }

  /** Tells every client within hearing of a blast at (x, y, z). */
  private boom(x: number, y: number, z: number, radius: number): void {
    const { world, game } = this.ctx;
    const ents = world.ents;
    for (const other of game.clients) {
      if (!other?.active || other.closed) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      if ((bx - x) * (bx - x) + (bz - z) * (bz - z) > HEARD * HEARD) continue;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_BLAST);
      w.f32(x);
      w.f32(y);
      w.f32(z);
      w.f32(radius);
      game.endOwn(other);
    }
  }

  /**
   * Sends a round of `ammo` that carries a light (the flare gun's flare) from the eye along `d`: a prop, so every client
   * draws it and rendering can light it from it (M9, D436), that rises, sinks slowly once it falls, harms nothing, and is out
   * where it lands. `draw` buys speed, as for any round.
   */
  private flare(ammo: number, draw: number, ox: number, oy: number, oz: number, d: readonly number[]): void {
    const world = this.ctx.world;
    const ents = world.ents;
    const reg = world.reg;
    if (this.flareKind === 0) return;
    const x = ox + d[0]! * 0.5;
    const y = oy + d[1]! * 0.5;
    const z = oz + d[2]! * 0.5;
    const ent = ents.create(this.flareKind, x, y, z, F_PROP);
    if (ent < 0) return;
    if (this.flares.length >= MAX_THROWN) this.out(this.flares.shift()!);
    const speed = launchSpeed(reg.ammoSpeed[ammo]!, draw);
    this.flares.push({ x, y, z, vx: d[0]! * speed, vy: d[1]! * speed, vz: d[2]! * speed, gravity: reg.ammoGravity[ammo]!, until: world.tick + FLARE_TICKS, ent, gen: ents.gen[ent]! });
  }

  /** One tick of a flare. False once it is out: it met the world or the sea, or burned its time. */
  private drift(f: Flare): boolean {
    const world = this.ctx.world;
    if (world.tick >= f.until) return false;
    // Falling, it slows across the ground and sinks at its canopy's pace.
    if (f.vy <= 0) {
      f.vx *= FLARE_KEEP;
      f.vz *= FLARE_KEEP;
    }
    const gravity = f.vy <= -FLARE_FALL ? 0 : f.gravity;
    flyStep(f, gravity);
    const length = piece.length;
    if (!(length > 0)) return false;
    if (castWorld(world, piece.x, piece.y, piece.z, piece.dx, piece.dy, piece.dz, length) !== HIT_NONE) return false;
    flyEnd(f, gravity);
    if (f.vy < -FLARE_FALL) f.vy = -FLARE_FALL;
    const hf = world.hf;
    if (f.y <= hf.seaLevel || f.x < 0 || f.z < 0 || f.x > hf.sizeX || f.z > hf.sizeZ) return false;
    if ((world.ents.flags[f.ent]! & F_ALIVE) === 0 || world.ents.gen[f.ent] !== f.gen) return false;
    world.ents.setPosition(f.ent, f.x, f.y, f.z);
    return true;
  }

  /** A flare goes out: its prop leaves the world. */
  private out(f: Flare): void {
    const ents = this.ctx.world.ents;
    if ((ents.flags[f.ent]! & F_ALIVE) !== 0 && ents.gen[f.ent] === f.gen) ents.destroy(f.ent);
  }

  /**
   * Throws one `item` that flies and hits (M5 of planning/reference/weapons-plan.md, the bola): a thrown weapon with an
   * ammo facet of its own is its own round, flown as an arrow is from `c`'s eye at its view tick. `draw`, how long a charged
   * throw was held (W2), buys speed and nothing else ("Charging up the Bola will increase its velocity, but not its
   * immobilization time", Bola). Unlike a shot, the thrower is told of it too, since its client predicts no round for it.
   */
  fling(c: Client, rec: EntityRecord, item: number, quality: number, draw: number): void {
    this.toShooter = true;
    this.launch(c, rec, item, quality, item, draw);
    this.toShooter = false;
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
    const { world, records, combat } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    if ((ents.flags[g.ent]! & F_ALIVE) !== 0 && ents.gen[g.ent] === g.gen) ents.destroy(g.ent);
    // W5: a grenade with a cloud leaves it where it went off, and one that does no harm (smoke, poison) has no blast.
    if (reg.cloudProp[g.item] !== 0) {
      this.onCloud?.(g.item, g.x, g.y, g.z, g.by);
      if (!(reg.damage[g.item]! > 0)) {
        this.bursts++;
        return;
      }
    }
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
    src.silenced = false;
    src.pierce = 0;
    const radius = reg.blast[g.item]!;
    this.bursts++;
    this.ended(g.x, g.y, g.z, -1);
    this.boom(g.x, g.y, g.z, radius);
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
   * else where it ended. `back` is how many ticks ago it left. A shot of many `rays` (W3 of
   * planning/reference/weapons-plan.md) sends its aim and cone as `a`, `b`, `c`, and its `seed`. `silenced` is its weapon's
   * silencer (W7): others draw no flash.
   */
  private tell(shooter: Client, ox: number, oy: number, oz: number, ammo: number, flies: boolean, a: number, b: number, c: number, back: number, rays = 1, seed = 0, silenced = false): void {
    const game = this.ctx.game;
    const ents = this.ctx.world.ents;
    for (const other of game.clients) {
      if (!other?.active || other.closed || (other === shooter && !this.toShooter)) continue;
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
      w.u8(rays);
      w.u32(seed);
      w.bool(silenced);
      game.endOwn(other);
    }
  }
}
