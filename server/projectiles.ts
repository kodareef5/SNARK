// A shot is judged as its shooter saw it. A rifle round is one piece, tested against the bodies of Combat.viewTick.
// An arrow flies one piece a tick. On the tick it is fired it first flies from the view tick up to now. A round with a blast
// goes off where it ends, and one that carries a light (the flare) flies as a prop every client draws (weapons-plan.md, W6).
// A round that flies and has a blast has a number: it is told by it (EVENT_ROCKET), and its blast says it.

import { TAU } from "../shared/math/scalar.ts";
import { BOLTS_MOST, packBolt, writeBolt } from "../shared/net/bolts.ts";
import type { BitWriter } from "../shared/net/codec.ts";
import { EVENT_BLAST, EVENT_BOLTS, EVENT_ROCKET, EVENT_SHOT, S_EVENT } from "../shared/net/protocol.ts";
import { MADE_METAL, MADE_STONE, MADE_THATCH, MADE_UNKNOWN, MADE_WOOD, ROCKET_AGE_MOST, ROCKET_IDS, SURFACE_AIR, SURFACE_BODY, SURFACE_BUILT, SURFACE_GROUND, SURFACE_VEHICLE, SURFACE_WATER, writeBlast, writeRocket } from "../shared/net/rockets.ts";
import { Rng } from "../shared/rng.ts";
import { aimSeed, aimShot, scopeFitted, shotAim, shotDir, zeroUnits } from "../shared/sim/aim.ts";
import { Body } from "../shared/sim/character.ts";
import { shotRays } from "../shared/content/registry.ts";
import { falloff } from "../shared/sim/damage.ts";
import { FISTS } from "../shared/sim/weapon.ts";
import { F_ALIVE, F_PROP } from "../shared/sim/entities.ts";
import { QUALITY_MUL } from "../shared/sim/items.ts";
import { FLIGHT_TICKS, HITSCAN_RANGE, WATER_SPEED, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../shared/sim/projectiles.ts";
import { TICK_RATE } from "../shared/coords.ts";
import { HIT_NONE, HIT_STRUCTURE, HIT_TERRAIN, castWorld, lookDirection, rayHit } from "../shared/world/ray.ts";
import { bodyAlong, seaHere } from "../shared/world/water.ts";
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
/** Rounds kept to be told together. One more and those kept are told at once. */
const TOLD_MOST = 1024;
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
 * where it lands, or after FLARE_TICKS. Ours: ARK says only that it lights "until it hits the ground" (Flare Gun, DEV157).
 */
export const FLARE_FALL = 2.5;
export const FLARE_DRIFT = 0.25;
export const FLARE_TICKS = 90 * TICK_RATE;
const FLARE_KEEP = Math.pow(FLARE_DRIFT, 1 / TICK_RATE);
/** A round that goes off on something stops this many metres short of it, so the blast is on the near side. */
const BLAST_OUT = 0.05;
/** Blasts judged a tick. More wait their turn, in the order they went off. */
export const BLASTS_A_TICK = 2;
/** Blasts that may wait. One more and the oldest is judged at once. */
const WAITING_MOST = 64;
/** Ticks between the times a numbered round looks for clients that have come within hearing of it. A power of two. */
const LATE_EVERY = 8;
/** A grenade this near over the ground goes off on it. */
const GROUND_NEAR = 0.5;

/** The MADE_ a structure's material or a node's says, by the word in its name. */
function madeBy(name: string | undefined): number {
  if (name === undefined) return MADE_UNKNOWN;
  if (/thatch/.test(name)) return MADE_THATCH;
  if (/wood|timber/.test(name)) return MADE_WOOD;
  if (/stone|concrete|block|tile|plaster/.test(name)) return MADE_STONE;
  if (/metal|steel|sheet/.test(name)) return MADE_METAL;
  return MADE_UNKNOWN;
}

const blankSource = (): Source => ({ by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, silenced: false, far: 1, vehicle: false, pierce: 0 });

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
  /** Its number if it goes off where it ends and is told by number, else 0. */
  id: number;
  /** The tick it left at, as its shooter saw it. */
  born: number;
}

/** A blast that waits to be judged: its own copy of what it carries, where, and the body it struck with that body's generation. */
interface Waiting {
  readonly src: Source;
  x: number;
  y: number;
  z: number;
  radius: number;
  direct: number;
  gen: number;
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
  /**
   * The rounds that left at full speed since the last step, told together when it ends (EVENT_BOLTS): where each left
   * on the ground and the tick it was fired, its start and way as the message says them, then its ammunition, the ticks
   * since it left, its silencer and whose it is (a client's id, or -1 for one its shooter is told too).
   */
  private readonly told = new Float64Array(TOLD_MOST * 3);
  private readonly toldPacked = new Uint32Array(TOLD_MOST * 5);
  private readonly toldAmmo = new Uint16Array(TOLD_MOST);
  private readonly toldBack = new Uint8Array(TOLD_MOST);
  private readonly toldSilenced = new Uint8Array(TOLD_MOST);
  private readonly toldBy = new Int32Array(TOLD_MOST);
  private toldCount = 0;
  /** Numbered rounds, by number: whether one flies, its start and way as the message says them, and a byte a client slot told of it. */
  private readonly numberFlies = new Uint8Array(ROCKET_IDS);
  private readonly numberPacked = new Uint32Array(ROCKET_IDS * 5);
  private numberTold: Uint8Array;
  private toldWide: number;
  private lastNumber = 0;
  /** Numbered rounds that fly. */
  private numbered = 0;
  /** Per content kind: the MADE_ a structure or a node of it is. */
  private readonly madeOf: Uint8Array;
  /** What the round being ended met: the unit way out of it, and its SURFACE_ and MADE_. */
  private readonly met = { nx: 0, ny: 1, nz: 0, surface: SURFACE_AIR, made: MADE_UNKNOWN };
  /** Blasts that wait, a ring from `waitHead`, and the blasts judged in tick `judgedAt`. */
  private readonly waiting: Waiting[] = Array.from({ length: WAITING_MOST }, () => ({ src: blankSource(), x: 0, y: 0, z: 0, radius: 0, direct: -1, gen: 0 }));
  private waitHead = 0;
  private waitCount = 0;
  private judgedAt = -1;
  private judged = 0;
  private readonly stuckKind: number;
  private readonly liveKind: number;
  private readonly flareKind: number;
  private readonly rng: Rng;
  private readonly eyeAt = new Float64Array(3);
  private readonly dir = [0, 0, 0];
  private readonly body = new Body();
  private readonly src: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  /** A round's own, filled by `bring`, so the share its distance leaves it never reaches a blast. */
  private readonly round: Source = { by: null, x: 0, z: 0, item: 0, base: 0, type: 0, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0, far: 1 };
  /** Where the last ray `cast` ended: the point, metres from its origin, the body it hit (-1 for none), its zone, the structure it met (-1 for none), `on` as lastEnd's, and what castWorld said of the world it met. */
  private readonly at = { x: 0, y: 0, z: 0, t: 0, target: -1, zone: 0, panel: -1, built: -1, on: -1, what: HIT_NONE, ref: 0, nx: 0, ny: 1, nz: 0 };
  /** Rays the last shot sent, and how many of them hit a body: for tests and measurement. */
  readonly lastShot = { rays: 0, hits: 0 };

  /** Told of every shot (where it left, who fired it, whether silenced) and every blast (where, and the survivor whose
   * it was), whatever it hits or misses: what the people about hear (server/cast/host.ts). */
  readonly heard: ((kind: "shot" | "blast", x: number, z: number, by: string | null, silenced: boolean) => void)[] = [];

  constructor(ctx: ProjectilesContext, seed: number) {
    this.ctx = ctx;
    this.stuckKind = ctx.world.reg.index.get("core:arrow_stuck") ?? 0;
    this.liveKind = ctx.world.reg.index.get("core:grenade_live") ?? 0;
    this.flareKind = ctx.world.reg.index.get("core:flare_live") ?? 0;
    this.rng = new Rng(seed);
    this.madeOf = Uint8Array.from(ctx.world.reg.defs, (d) => (d?.type === "structure" || d?.type === "node" ? madeBy(d.material) : MADE_UNKNOWN));
    this.toldWide = ctx.game.clients.length;
    this.numberTold = new Uint8Array(ROCKET_IDS * this.toldWide);
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

  /** Blasts that went off and wait to be judged. */
  get waitingCount(): number {
    return this.waitCount;
  }

  /** For tests: the number of flying round `i`, 0 for one that has none. */
  numberAt(i: number): number {
    return this.flying[i]!.id;
  }

  /** For tests. */
  flareAt(i: number): { x: number; y: number; z: number; vy: number; ent: number } {
    return this.flares[i]!;
  }

  /** For tests: where flying round `i` is, and how fast it goes. */
  flyingAt(i: number): { x: number; y: number; z: number; vx: number; vy: number; vz: number } {
    return this.flying[i]!;
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
    const reg = world.reg;
    const e = c.ent;
    if (e < 0 || ammo === 0) return;
    const d = this.dir;
    const rays = shotRays(reg, weapon, ammo);
    this.aim(c, rec, weapon, 0, d, rays, ammo);
    const view = combat.viewTick(c);
    combat.eye(e, this.eyeAt, combat.originTick(c), true, c);
    const ox = this.eyeAt[0]!, oy = this.eyeAt[1]!, oz = this.eyeAt[2]!;
    this.fired++;
    if (reg.ammoLight[ammo]! > 0) {
      this.flare(ammo, draw, ox, oy, oz, d);
      return;
    }
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
  /** The zero a session has dialled for its sight, metres (server/gaze.ts, D1083), 0 for none. */
  zero: (c: Client) => number = () => 0;

  private aim(c: Client, rec: EntityRecord, weapon: number, k: number, out: number[], rays = 1, ammo = 0): void {
    const { world, items } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const e = c.ent;
    const b = this.body;
    ents.loadBody(e, b);
    const inv = items.inv(rec);
    const slot = inv.hotbar >= 0 && rec.held >= 0 ? inv.hotbar + rec.held : -1;
    const handle = ents.handleOf(e);
    // The aimed look's 256ths of a unit, and a zero that lifts a flying round to cross the look where it was dialled (D1083).
    const zero = ammo !== 0 ? zeroUnits(this.zero(c), reg.ammoSpeed[ammo]!, reg.ammoGravity[ammo]!) : 0;
    aimShot(b, c.heldButtons, reg.weapon[weapon] ?? FISTS, reg.tamedMove[b.kind]!, ents.yaw[e]! + c.heldFineYaw / 256, ents.pitch[e]! + c.heldFinePitch / 256, scopeFitted(reg, inv, slot), handle, world.tick, zero);
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
    const hf = world.hf;
    const sea = hf.seaLevel;
    let reach = HITSCAN_RANGE;
    let on = -1;
    // Water stops a round fired from above it: the sea, or a lake's surface.
    if (oy > sea && d[1]! < 0 && (sea - oy) / d[1]! < reach && seaHere(hf.water, ox + (d[0]! * (sea - oy)) / d[1]!, oz + (d[2]! * (sea - oy)) / d[1]!)) {
      reach = (sea - oy) / d[1]!;
      on = -2;
    }
    const lake = bodyAlong(hf.water, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
    if (lake < reach) {
      reach = lake;
      on = -2;
    }
    let built = -1;
    const a = this.at;
    const what = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach);
    a.what = what;
    if (what !== HIT_NONE) {
      reach = rayHit.t;
      on = -1;
      if (what === HIT_STRUCTURE) built = rayHit.ref;
      // The cast of bodies that follows may cast the world again.
      a.ref = rayHit.ref;
      a.nx = rayHit.nx;
      a.ny = rayHit.ny;
      a.nz = rayHit.nz;
    }
    const target = combat.castBodies(self, ox, oy, oz, d[0]!, d[1]!, d[2]!, reach, 0, view);
    const t = target >= 0 ? combat.t : reach;
    a.x = ox + d[0]! * t;
    a.y = oy + d[1]! * t;
    a.z = oz + d[2]! * t;
    a.t = t;
    a.target = target;
    a.zone = combat.zone;
    a.panel = combat.panel;
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
      // The way it came, for what it met.
      const per = a.t > 0 ? 1 / a.t : 0;
      const dx = (a.x - ox) * per, dy = (a.y - oy) * per, dz = (a.z - oz) * per;
      if (a.target >= 0) this.metBody(a.target, dx, dy, dz);
      else if (a.what !== HIT_NONE) this.metWorld(a.what, a.ref, a.nx, a.ny, a.nz, dx, dy, dz);
      else this.meet(SURFACE_WATER, MADE_UNKNOWN, 0, 1, 0);
      this.ended(a.x, a.y, a.z, a.target >= 0 ? a.target : a.on);
      this.explode(rec, weapon, quality, ammo, 1, ox, oz, a.x - (a.x - ox) * k, a.y - (a.y - oy) * k, a.z - (a.z - oz) * k, a.target);
      return;
    }
    if (a.target >= 0) {
      this.lastShot.hits++;
      this.hit(rec, weapon, quality, ammo, 1, ox, oy, oz, a.target, a.zone, a.x, a.y, a.z, this.silencedShot, a.panel);
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
    const sea = world.hf.waterAt(ox, oz);
    const wet = reg.weapon[weapon]?.wet ?? false;
    const full = reg.ammoSpeed[ammo]!;
    const speed = launchSpeed(full, draw) * (wet && oy < sea ? WATER_SPEED : 1);
    const back = now - view;
    // A round with a reach is gone that far from where it left, which was `back` ticks ago.
    const life = reg.ammoFlightTicks[ammo]!;
    const f: Flying = {
      x: ox, y: oy, z: oz, vx: d[0]! * speed, vy: d[1]! * speed, vz: d[2]! * speed,
      gravity: reg.ammoGravity[ammo]!, ammo, weapon, quality, draw, by: rec.pid, self: c.ent, ox, oy, oz,
      until: life < FLIGHT_TICKS ? Math.floor(view) + life : now + FLIGHT_TICKS, flown: now, wet, under: oy < sea, silenced,
      // One at full speed that will go off has a number, while there is one to give: a message says no other speed.
      id: speed === full && reg.ammoBlast[ammo]! > 0 ? this.number() : 0, born: view,
    };
    // Nearby clients get its launch state and fly their own copy from there. One at full speed is told with the tick's others.
    if (f.id !== 0) this.tellRocket(c, f, d, back);
    else if (speed === full) this.keep(c, ox, oy, oz, d, ammo, back, silenced);
    else this.tell(c, ox, oy, oz, ammo, true, f.vx, f.vy, f.vz, Math.round(back), 1, 0, silenced);
    // Fly it from the view tick to now, one tick's piece at a time, each against the bodies of that tick,
    // then the leftover part of a tick. One whose reach is shorter than that is spent on the way.
    const whole = Math.floor(back);
    for (let j = 1; j <= whole; j++) if (!this.flyOn(f, view + j, 1)) return;
    if (back - whole > 0.01 && !this.flyOn(f, now, back - whole)) return;
    if (this.flying.length >= MAX_FLYING) {
      const old = this.flying.shift()!;
      this.spent(old);
      this.free(old);
    }
    this.flying.push(f);
  }

  /** Flies `f` as `fly` does, unless its time is up by tick `t`: then it is spent. Returns false, its number freed, if it is gone. */
  private flyOn(f: Flying, t: number, share: number): boolean {
    if (Math.floor(t) > f.until) this.spent(f);
    else if (this.fly(f, t, share)) return true;
    this.free(f);
    return false;
  }

  /** A round is gone having met nothing: one with a blast goes off in the air where it is, so that whoever draws it ends it. */
  private spent(f: Flying): void {
    if (!(this.ctx.world.reg.ammoBlast[f.ammo]! > 0) || !Number.isFinite(f.x + f.y + f.z)) return;
    this.ended(f.x, f.y, f.z, -1);
    this.meet(SURFACE_AIR, MADE_UNKNOWN, 0, 1, 0);
    this.explode(this.ctx.records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oz, f.x, f.y, f.z, -1, f.id);
  }

  /** The next number in turn that no flying round has, or 0 when every one is taken. */
  private number(): number {
    if (this.numbered >= ROCKET_IDS - 1) return 0;
    let id = this.lastNumber;
    do {
      id = (id % (ROCKET_IDS - 1)) + 1;
    } while (this.numberFlies[id] !== 0);
    this.lastNumber = id;
    this.numberFlies[id] = 1;
    this.numbered++;
    return id;
  }

  /** `f` flies no more: its number may be given again. */
  private free(f: Flying): void {
    if (f.id === 0) return;
    this.numberFlies[f.id] = 0;
    this.numbered--;
    f.id = 0;
  }

  /** Tells a numbered round, `back` ticks after it left `c` along `d`, to all within hearing of its start and to `c` as its own: a thrower as any other. */
  private tellRocket(c: Client, f: Flying, d: readonly number[], back: number): void {
    for (const l of this.heard) l("shot", f.ox, f.oz, c.name, f.silenced);
    const { world, game } = this.ctx;
    const ents = world.ents;
    if (game.clients.length > this.toldWide) this.widen(game.clients.length);
    const row = f.id * this.toldWide;
    const told = this.numberTold;
    told.fill(0, row, row + this.toldWide);
    packBolt(f.ox, f.oy, f.oz, d[0]!, d[1]!, d[2]!, this.numberPacked, f.id * 5);
    for (const other of game.clients) {
      if (!other?.active || other.closed) continue;
      if (other !== c) {
        const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
        const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
        if ((bx - f.ox) * (bx - f.ox) + (bz - f.oz) * (bz - f.oz) > HEARD * HEARD) continue;
      }
      told[row + other.id] = 1;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_ROCKET);
      writeRocket(w, this.numberPacked, f.id * 5, f.ammo, f.id, back, other === c && !this.toShooter);
      game.endOwn(other);
    }
  }

  /** Tells the numbered round `f` to each client that is now within hearing of where it is and has not been told of it. */
  private tellLate(f: Flying, tick: number): void {
    const age = tick - f.born;
    if (age > ROCKET_AGE_MOST) return;
    const { world, game } = this.ctx;
    const ents = world.ents;
    if (game.clients.length > this.toldWide) this.widen(game.clients.length);
    const row = f.id * this.toldWide;
    const told = this.numberTold;
    for (const other of game.clients) {
      if (!other?.active || other.closed || told[row + other.id] !== 0) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      if ((bx - f.x) * (bx - f.x) + (bz - f.z) * (bz - f.z) > HEARD * HEARD) continue;
      told[row + other.id] = 1;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_ROCKET);
      writeRocket(w, this.numberPacked, f.id * 5, f.ammo, f.id, age, false);
      game.endOwn(other);
    }
  }

  /** The server was given room for more clients: each number's row of who was told grows to `wide`. */
  private widen(wide: number): void {
    const next = new Uint8Array(ROCKET_IDS * wide);
    for (let id = 0; id < ROCKET_IDS; id++) next.set(this.numberTold.subarray(id * this.toldWide, (id + 1) * this.toldWide), id * wide);
    this.numberTold = next;
    this.toldWide = wide;
  }

  step(): void {
    const tick = this.ctx.world.tick;
    this.drain();
    const flying = this.flying;
    let kept = 0;
    for (let i = 0; i < flying.length; i++) {
      const f = flying[i]!;
      // A shot fired this tick has already been flown up to now.
      if (f.flown < tick && !this.flyOn(f, tick, 1)) continue;
      // Each numbered round takes its own tick of the eight to look for new listeners.
      if (f.id !== 0 && ((tick + f.id) & (LATE_EVERY - 1)) === 0) this.tellLate(f, tick);
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
    this.tellKept();
  }

  /** Keeps a round that left `c`'s body at its ammunition's full speed along the unit way `d`, to be told when the step ends. */
  private keep(c: Client, ox: number, oy: number, oz: number, d: readonly number[], ammo: number, back: number, silenced: boolean): void {
    for (const l of this.heard) l("shot", ox, oz, c.name, silenced);
    if (this.toldCount >= TOLD_MOST) this.tellKept();
    const n = this.toldCount++;
    const t = this.told;
    t[n * 3] = ox;
    t[n * 3 + 1] = oz;
    t[n * 3 + 2] = this.ctx.world.tick;
    packBolt(ox, oy, oz, d[0]!, d[1]!, d[2]!, this.toldPacked, n * 5);
    this.toldAmmo[n] = ammo;
    this.toldBack[n] = Math.min(255, Math.round(back));
    this.toldSilenced[n] = silenced ? 1 : 0;
    this.toldBy[n] = this.toShooter ? -1 : c.id;
  }

  /** Tells each client the rounds kept that left within its hearing, its own left out, in as few messages as hold them. */
  private tellKept(): void {
    const count = this.toldCount;
    if (count === 0) return;
    this.toldCount = 0;
    const { world, game } = this.ctx;
    const ents = world.ents;
    const t = this.told;
    const now = world.tick;
    for (const other of game.clients) {
      if (!other?.active || other.closed) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      let w: BitWriter | null = null;
      let said = 0;
      let last = 0;
      for (let n = 0; n < count; n++) {
        const ox = t[n * 3]!;
        const oz = t[n * 3 + 1]!;
        if (this.toldBy[n] === other.id || (bx - ox) * (bx - ox) + (bz - oz) * (bz - oz) > HEARD * HEARD) continue;
        if (!w) {
          w = game.begin(S_EVENT);
          w.u8(EVENT_BOLTS);
          w.u8(0);
        }
        // One kept from a tick before has flown that much longer.
        writeBolt(w, this.toldPacked, n * 5, this.toldAmmo[n]!, this.toldBack[n]! + (now - t[n * 3 + 2]!), this.toldSilenced[n] === 1, last);
        last = this.toldAmmo[n]!;
        if (++said === BOLTS_MOST) {
          // The count is the message's third byte, written last.
          w.bytes()[2] = said;
          game.endOwn(other);
          w = null;
          said = last = 0;
        }
      }
      if (w) {
        w.bytes()[2] = said;
        game.endOwn(other);
      }
    }
  }

  /** Flies `f` for `share` of a tick, to tick `t`, which is now or a tick the history remembers. Returns false if it ended. */
  private fly(f: Flying, t: number, share: number): boolean {
    const { world, combat, records } = this.ctx;
    const dt = share / TICK_RATE;
    f.flown = Math.floor(t);
    flyStep(f, f.gravity, dt);
    let length = piece.length;
    if (!(length > 0)) {
      this.spent(f);
      return false;
    }
    const { x, y, z, dx, dy, dz } = piece;
    const hf = world.hf;
    const sea = hf.seaLevel;
    const blast = world.reg.ammoBlast[f.ammo]! > 0;
    // At the surface a shot from a dry weapon stops. One from a wet weapon goes on, slowed.
    let splash = false;
    if (!f.under && y > sea && y + dy * length <= sea && seaHere(hf.water, x + (dx * (sea - y)) / dy, z + (dz * (sea - y)) / dy)) {
      length = (sea - y) / dy;
      splash = true;
    }
    const lake = f.under ? Infinity : bodyAlong(hf.water, x, y, z, dx, dy, dz, length);
    if (lake <= length) {
      length = lake;
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
      // Read now: the cast of bodies that follows may cast the world again.
      if (blast) this.metWorld(what, rayHit.ref, rayHit.nx, rayHit.ny, rayHit.nz, dx, dy, dz);
    } else if (blast && splash) this.meet(SURFACE_WATER, MADE_UNKNOWN, 0, 1, 0);
    // Skip the shooter, if its entity slot still holds it.
    const shooter = (world.ents.flags[f.self]! & F_ALIVE) !== 0 && world.ents.pid[f.self] === f.by ? f.self : -1;
    // A piece cut short by the world took that much less of the tick.
    const target = combat.castBodies(shooter, x, y, z, dx, dy, dz, length, 0, t, (share * length) / piece.length);
    if (target >= 0) {
      const at = combat.t;
      if (blast) {
        this.ended(x + dx * at, y + dy * at, z + dz * at, target);
        this.metBody(target, dx, dy, dz);
        this.explode(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oz, x + dx * at, y + dy * at, z + dz * at, target, f.id);
      } else this.hit(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oy, f.oz, target, combat.zone, x + dx * at, y + dy * at, z + dz * at, f.silenced, combat.panel);
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
        this.explode(records.byPid.get(f.by) ?? null, f.weapon, f.quality, f.ammo, f.draw, f.ox, f.oz, hx - dx * out, hy - dy * out, hz - dz * out, -1, f.id);
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
    } else if (f.under && f.y > hf.waterAt(f.x, f.z)) f.under = false;
    if (f.x >= 0 && f.z >= 0 && f.x <= world.hf.sizeX && f.z <= world.hf.sizeZ && f.y > -1000) return true;
    this.spent(f);
    return false;
  }

  /** Says what the round being ended met. A way out of no length is up. */
  private meet(surface: number, made: number, nx: number, ny: number, nz: number): void {
    const m = this.met;
    const l = nx * nx + ny * ny + nz * nz;
    const k = l > 1e-12 ? 1 / Math.sqrt(l) : 0;
    m.surface = surface;
    m.made = made;
    m.nx = nx * k;
    m.ny = k === 0 ? 1 : ny * k;
    m.nz = nz * k;
  }

  /** The round being ended met body `target`, going along (dx, dy, dz): the way out is back the way it came. */
  private metBody(target: number, dx: number, dy: number, dz: number): void {
    const world = this.ctx.world;
    this.meet(world.reg.vehicle[world.ents.kind[target]!] ? SURFACE_VEHICLE : SURFACE_BODY, MADE_UNKNOWN, -dx, -dy, -dz);
  }

  /** The round being ended met the world as castWorld said (`what`, `ref`, the way out), going along (dx, dy, dz). A tree or a rock is built if its kind says of what. */
  private metWorld(what: number, ref: number, nx: number, ny: number, nz: number, dx: number, dy: number, dz: number): void {
    const { world, combat } = this.ctx;
    if (!(nx * nx + ny * ny + nz * nz > 0.25)) {
      nx = -dx;
      ny = -dy;
      nz = -dz;
    }
    let surface = SURFACE_GROUND;
    let made = MADE_UNKNOWN;
    if (what !== HIT_TERRAIN) {
      const store = what === HIT_STRUCTURE ? world.structs : world.nodes;
      const placed = what === HIT_STRUCTURE ? combat.city.kindOf(ref) : 0;
      made = this.madeOf[placed !== 0 ? placed : (store?.chunks[Math.floor(ref / 65536)]?.kind[ref & 0xffff] ?? 0)] ?? MADE_UNKNOWN;
      if (what === HIT_STRUCTURE || made !== MADE_UNKNOWN) surface = SURFACE_BUILT;
    }
    this.meet(surface, made, nx, ny, nz);
  }

  private hit(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oy: number, oz: number, target: number, zone: number, x: number, y: number, z: number, silenced = false, panel = -1): void {
    const far = Math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy) + (z - oz) * (z - oz));
    const src = this.bring(by, weapon, quality, ammo, draw, ox, oz, far);
    src.silenced = silenced;
    this.struck++;
    this.ended(x, y, z, target);
    this.ctx.bus.after(PROJECTILE_HIT, { byPid: by ? by.pid : 0, ammo: this.ctx.world.reg.ids[ammo]!, target: this.ctx.world.ents.pid[target]! });
    this.ctx.combat.land(src, target, zone, x, y, z, far, undefined, true, panel);
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
  private explode(by: EntityRecord | null, weapon: number, quality: number, ammo: number, draw: number, ox: number, oz: number, x: number, y: number, z: number, direct: number, id = 0): void {
    const radius = this.ctx.world.reg.ammoBlast[ammo]!;
    const src = this.bring(by, weapon, quality, ammo, draw, ox, oz);
    this.blasts++;
    const m = this.met;
    this.boom(x, y, z, radius, by && by.keyHash !== null ? by.name : null, undefined, ammo, m.surface, m.made, id, m.nx, m.ny, m.nz);
    this.judge(src, x, y, z, radius, direct);
  }

  /** Nearby listeners and the operator watching through a remote camera receive the blast, with what blew, what it met and its round's number (shared/net/rockets.ts). */
  boom(x: number, y: number, z: number, radius: number, by: string | null = null, operator?: Client, item = 0, surface = SURFACE_AIR, made = MADE_UNKNOWN, id = 0, nx = 0, ny = 1, nz = 0): void {
    for (const l of this.heard) l("blast", x, z, by, false);
    const { world, game } = this.ctx;
    const ents = world.ents;
    for (const other of game.clients) {
      if (!other?.active || other.closed) continue;
      const bx = other.ent >= 0 ? ents.x[other.ent]! : other.body.x;
      const bz = other.ent >= 0 ? ents.z[other.ent]! : other.body.z;
      if (other !== operator && (bx - x) * (bx - x) + (bz - z) * (bz - z) > HEARD * HEARD) continue;
      const w = game.begin(S_EVENT);
      w.u8(EVENT_BLAST);
      writeBlast(w, x, y, z, nx, ny, nz, radius, item, id, surface, made);
      game.endOwn(other);
    }
  }

  /** Judges a blast of `src` at once if it is among the tick's first BLASTS_A_TICK. Later ones wait with a copy of `src`, which is shared. */
  private judge(src: Source, x: number, y: number, z: number, radius: number, direct: number): void {
    const { world, combat } = this.ctx;
    if (this.judgedAt !== world.tick) {
      this.judgedAt = world.tick;
      this.judged = 0;
    }
    if (this.waitCount === 0 && this.judged < BLASTS_A_TICK) {
      this.judged++;
      combat.blast(src, x, y, z, radius, direct);
      return;
    }
    if (this.waitCount === WAITING_MOST) this.judgeNext();
    const wait = this.waiting[(this.waitHead + this.waitCount++) % WAITING_MOST]!;
    const s = wait.src;
    s.by = src.by;
    s.x = src.x;
    s.z = src.z;
    s.item = src.item;
    s.base = src.base;
    s.type = src.type;
    s.quality = src.quality;
    s.draw = src.draw;
    s.attack = src.attack;
    s.torporInstant = src.torporInstant;
    s.torporOver = src.torporOver;
    s.torporSeconds = src.torporSeconds;
    s.buff = src.buff;
    s.silenced = src.silenced === true;
    s.far = src.far ?? 1;
    s.vehicle = src.vehicle === true;
    s.pierce = src.pierce ?? 0;
    wait.x = x;
    wait.y = y;
    wait.z = z;
    wait.radius = radius;
    wait.direct = direct;
    wait.gen = direct >= 0 ? world.ents.gen[direct]! : 0;
  }

  /** Judges the blast that has waited longest: for nobody if its attacker has gone, and on no body if the one it struck has. */
  private judgeNext(): void {
    const { world, combat, records } = this.ctx;
    const ents = world.ents;
    const wait = this.waiting[this.waitHead]!;
    this.waitHead = (this.waitHead + 1) % WAITING_MOST;
    this.waitCount--;
    const s = wait.src;
    if (s.by && records.byPid.get(s.by.pid) !== s.by) s.by = null;
    const direct = wait.direct >= 0 && (ents.flags[wait.direct]! & F_ALIVE) !== 0 && ents.gen[wait.direct] === wait.gen ? wait.direct : -1;
    combat.blast(s, wait.x, wait.y, wait.z, wait.radius, direct);
    s.by = null;
  }

  /** Judges the blasts that wait, as many as this tick has left. */
  private drain(): void {
    const tick = this.ctx.world.tick;
    if (this.judgedAt !== tick) {
      this.judgedAt = tick;
      this.judged = 0;
    }
    while (this.waitCount > 0 && this.judged < BLASTS_A_TICK) {
      this.judged++;
      this.judgeNext();
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
    if (f.y <= hf.waterAt(f.x, f.z) || f.x < 0 || f.z < 0 || f.x > hf.sizeX || f.z > hf.sizeZ) return false;
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
    this.ctx.combat.eye(e, this.eyeAt);
    // Check the short release segment too; a throw cannot skip a nearby roof/wall.
    const obstruction = castWorld(world, this.eyeAt[0]!, this.eyeAt[1]!, this.eyeAt[2]!, d[0]!, d[1]!, d[2]!, .5);
    const ahead = obstruction === HIT_NONE ? .5 : Math.max(0, rayHit.t - .01);
    const x = this.eyeAt[0]! + d[0]! * ahead, y = this.eyeAt[1]! + d[1]! * ahead, z = this.eyeAt[2]! + d[2]! * ahead;
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
    const { world, records } = this.ctx;
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
    // At rest or a little over the ground it goes off on it, and else in the air.
    const grounded = g.resting || castWorld(world, g.x, g.y + 0.05, g.z, 0, -1, 0, GROUND_NEAR + 0.05) !== HIT_NONE;
    this.boom(g.x, g.y, g.z, radius, src.by && src.by.keyHash !== null ? src.by.name : null, undefined, g.item, grounded ? SURFACE_GROUND : SURFACE_AIR);
    this.judge(src, g.x, g.y + 0.05, g.z, radius, -1);
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
    for (const l of this.heard) l("shot", ox, oz, shooter.name, silenced);
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
