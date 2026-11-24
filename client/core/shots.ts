// Pictures of shots: arrows and darts in the air, and tracer lines. They decide nothing. The server flies every shot
// (server/projectiles.ts), and the client draws its own with the same arithmetic (shared/sim/projectiles.ts).

import { Assets } from "./assets/assets.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { HELD_MUZZLE, HELD_VENT } from "../../shared/content/kinds/weapons.ts";
import { EVENT_BALL, EVENT_BLAST, EVENT_ROCKET, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { blastSeed } from "../../shared/net/rockets.ts";
import { AnimState } from "../../shared/anim/pose.ts";
import { STANCE_STAND, stanceHeight } from "../../shared/sim/character.ts";
import { FLIGHT_TICKS, HITSCAN_RANGE, WATER_SPEED, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../../shared/sim/projectiles.ts";
import { TICK_DT, TICK_RATE } from "../../shared/coords.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../../shared/world/ray.ts";
import { bodyAlong, seaHere } from "../../shared/world/water.ts";
import { shotDir } from "../../shared/sim/aim.ts";
import { shotRays } from "../../shared/content/registry.ts";
import type { Blasts } from "./render/blasts.ts";
import type { Camera } from "./render/camera.ts";
import type { Characters } from "./render/characters.ts";
import type { FramePacket } from "./render/packet.ts";
import type { ShotEnd } from "./occasions.ts";
import type { ClientSession, RemoteSample } from "./session.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";

export const TRACER_MS = 90;
export const BLAST_MS = 220;
/** Milliseconds the flash of a tame going into a soul ball or coming out is drawn. */
export const BALL_MS = 320;
/**
 * A round from a gun flashes at the muzzle, unless its gun has a silencer: others see "no muzzle flash" (Silencer
 * Attachment). The flash is the blast's cube at this many metres across, for FLASH_MS (ours).
 */
export const FLASH_MS = 50;
const FLASH_SIZE = 0.14;
/** A bolt of light (ammo.bolt): its flash and its burst, in milliseconds and in metres across at a size of 1, and its tail's length. */
export const BOLT_FLASH_MS = 80;
export const BOLT_BURST_MS = 160;
const BOLT_FLASH = 0.24;
const BOLT_BURST = 0.7;
const BOLT_TAIL = 2.2;
/** Metres off that the materials of a shot's meshes are kept as if at, while no shot is drawn. */
const PRELOAD = 30;
/** Bursts drawn at once. */
const MAX_BURSTS = 64;
/** Metres about where a round left, on the ground, within which a body is taken for its shooter over its first two ticks. */
const SHOOTER = 1;
/** Bodies are sorted into squares this many metres wide, so that a flight is tested against those near it. A power of two of them. */
const NEAR_CELL = 8;
const NEAR_CELLS = 2048;
const MAX_FLYING = 256;
/** Two shotguns' worth of pellets and a few more. */
const MAX_TRACERS = 48;
/** Its own shot is drawn from ahead of the eye and a little below, so it is seen to leave. Metres. */
const AHEAD = 0.7;
const BELOW = 0.1;
/** Longest tracer drawn, in metres. */
const TRACER_REACH = 300;
/** Milliseconds a round that goes off is kept, once it has met something here, for the blast that ends it. */
export const AWAIT_MS = 500;
/** Metres over which a round drawn from its gun's muzzle comes onto its true path, which starts at its shooter's eye. */
export const LEAVE = 8;
/**
 * Another's round told within this many ticks of leaving is seen to leave: its launcher flashes and it starts at the
 * muzzle. A round just fired is already as old as the server looked back for its shooter (BOLT_BACK_MOST).
 */
const LEFT_NOW = 16;
/** Metres behind the eye a launcher's vent is taken to be, where its body is not drawn. */
const VENT_BEHIND = 0.5;
/** Ticks its own round may fly with no number told: past them it was told as any round is, and ends by this client's judgement. */
const UNTOLD_TICKS = 30;
/** Turns a second a round with a motor rolls as it flies. */
const ROLL = 0.6;

interface Flying extends Flight {
  gravity: number;
  mesh: number;
  ammo: number;
  /** Ticks left to fly, and ticks flown. */
  left: number;
  age: number;
  /** Metres flown, and the metres at which it is gone (0 for one with no reach). */
  flown: number;
  reach: number;
  /** Where it left on the ground: whoever stands there fired it, and it does not meet them. */
  sx: number;
  sz: number;
  /** The viewer's own, which does not meet the body it left. */
  own: boolean;
  /** Its weapon works under water, so it goes on there, slowed; and whether it is under water now. */
  wet: boolean;
  under: boolean;
  /**
   * Its next piece, looked along when its last was flown (`look`, then `bodies`): the metres of it free of the ground,
   * a wall, the water, its reach and the bodies drawn; the metres of it that may be drawn; and what is at the end of the
   * free part: something it meets, the end of its reach, or the water it goes on into.
   */
  clear: number;
  lead: number;
  met: boolean;
  gone: boolean;
  splash: boolean;
  /** It has just left, and its first piece has not been tested against the bodies drawn. */
  fresh: boolean;
  /**
   * A round that goes off where it ends (EVENT_ROCKET): the server ends it, by its blast, and it meets no body here.
   * Its number, 0 until it is told, and the name the fire knows it by.
   */
  rocket: boolean;
  id: number;
  key: number;
  /** Whether the fire was told of it, which it is if it has a motor. */
  lit: boolean;
  /** Where it is drawn from its path as it leaves: its muzzle less its path's start. It closes over LEAVE metres. */
  ox: number;
  oy: number;
  oz: number;
  /** When a round that met something here is dropped if no blast has come, in milliseconds; 0 while it flies. */
  waits: number;
}

interface Tracer {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  length: number;
  until: number;
}

/** The square of the sort that the cell (cx, cz) falls in: cells far apart may share one, and are then searched together. */
function nearSquare(cx: number, cz: number): number {
  return ((cx * 73) ^ (cz * 151)) & (NEAR_CELLS - 1);
}

/** Shot ends kept for small details, which find what a shot struck (client/core/occasions.ts). */
const ENDS = 32;

export class Shots {
  /** Where shots lately ended, newest last: where the last piece began, its way, and when, in milliseconds. */
  readonly ends: ShotEnd[] = [];
  readonly flying: Flying[] = [];
  readonly tracers: Tracer[] = [];
  readonly blasts: { x: number; y: number; z: number; radius: number; born: number }[] = [];
  /** A tame going into a soul ball or coming out of one (EVENT_BALL): the middle of its body and its size. */
  readonly balls: { x: number; y: number; z: number; size: number; into: boolean; born: number }[] = [];
  /** Muzzle flashes of rounds from guns with no silencer: the blast's cube, or a bolt's own mesh at its size. */
  readonly flashes: { x: number; y: number; z: number; dx: number; dy: number; dz: number; born: number; until: number; mesh: number; size: number }[] = [];
  /** Where a bolt of light ended on something: its burst's mesh and size. */
  readonly bursts: { x: number; y: number; z: number; born: number; mesh: number; size: number }[] = [];
  private flashOfAmmo: Int32Array = new Int32Array(0);
  private burstOfAmmo: Int32Array = new Int32Array(0);
  /** Each square links the bodies in it in sample order. */
  private readonly nearHead = new Int16Array(NEAR_CELLS);
  private readonly nearNext = new Int16Array(MAX_VIEW);
  /** The widest of them, which a flight's search is widened by. */
  private nearWide = 0;
  private bodiesSorted = false;
  private blastMesh = -1;
  /** The flash of a tame going into a soul ball or coming out (tools/pack/balls.ts), or the blast's where a pack has none. */
  private ballMesh = -1;
  private now = 0;
  private meshOfAmmo: Int32Array = new Int32Array(0);
  private tracerMesh = -1;
  /**
   * The client's own body as last absorbed, which another's round may meet: its feet, how wide it is and how tall as it
   * stands, crouches or lies. No width while it has none in the world to meet: spectating, dead, or sat in something.
   */
  private readonly me = { x: 0, y: 0, z: 0, r: 0, h: 0 };
  /** A body's state as it is sent, read to find how tall it stands (`tall`). */
  private readonly posed = new AnimState();
  /** The scene's assets, once it has named them (`bind`), and every mesh a shot is drawn with: few and small, and kept asked for. */
  private assets: Assets | null = null;
  private kept: number[] = [];
  /** The owner replaces this when the server's tuning arrives. */
  reg: Registry;
  /** Where what flies and goes off is drawn alight, which the scene gives. */
  fire: Blasts | null = null;
  /** The bodies as last drawn, for where a gun's muzzle is. `draw` keeps the one it is given. */
  private drawn: Characters | null = null;
  private readonly dir = [0, 0, 0];
  private readonly muzzle = [0, 0, 0];
  private readonly vent = [0, 0, 0];
  /** Rounds kept that have met something and wait for their blast. */
  private waiting = 0;
  /** The name of the viewer's last round that goes off, counted down from -1: no told round has one below zero. */
  private ownKey = 0;
  /** The rounds in the viewer's own gun as it predicts them, or -1: the bodies' draw is told. */
  private ownRounds = -1;
  /** The whole tick the flights have been flown through. */
  private tick = -1;

  constructor(reg: Registry, pack?: Pack) {
    this.reg = reg;
    if (pack) this.name(new Assets(reg, pack));
  }

  /**
   * Finds the meshes of shots among the scene's own assets, which name every mesh and number them as the scene draws
   * them. A client that streams its assets starts with a pack that holds none of these: they come in pages.
   */
  bind(assets: Assets): void {
    this.name(assets);
    this.assets = assets;
  }

  private name({ table, bind }: Assets): void {
    const reg = this.reg;
    // Its own mesh and no stand-in: ammunition without one is drawn as a tracer.
    this.meshOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo ? bind.own(d.id, "shot") : -1));
    this.flashOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo?.bolt ? bind.own(d.id, "flash") : -1));
    this.burstOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo?.bolt ? bind.own(d.id, "burst") : -1));
    this.tracerMesh = table.find("core:tracer");
    this.blastMesh = table.find("core:blast");
    const flash = table.find("core:soul_flash");
    this.ballMesh = flash >= 0 ? flash : this.blastMesh;
    this.kept = [...new Set([...this.meshOfAmmo, ...this.flashOfAmmo, ...this.burstOfAmmo, this.tracerMesh, this.blastMesh, this.ballMesh])].filter((m) => m >= 0);
  }

  absorb(session: ClientSession, world: CollisionWorld, nowMs: number): void {
    const reg = this.reg;
    const d = this.dir;
    // Its own gun's silencer is on its own books.
    const inv = session.inventory;
    const held = inv && inv.hotbar >= 0 && session.held >= 0 ? inv.hotbar + session.held : -1;
    const fitted = held >= 0 ? inv!.attach[held]! : 0;
    const silenced = fitted !== 0 && (reg.defs[fitted] as ItemDef | null)?.attachment === "silencer";
    this.ownRounds = held >= 0 && session.own ? session.own.rounds : -1;
    const me = this.me;
    const own = session.own;
    const move = reg.move[own.kind];
    me.x = own.x;
    me.y = own.y;
    me.z = own.z;
    me.r = move && session.ownHandle !== 0 && session.driving < 0 && own.seat === 0 ? reg.bodyRadius[own.kind]! : 0;
    me.h = move ? stanceHeight(move, own.stance) : 0;
    for (const s of session.fired) {
      // Its own shot leaves along the server's ray: the same aim, cone and seed (shared/sim/aim.ts).
      const full = reg.ammoSpeed[s.ammo]!;
      const rays = shotRays(reg, s.weapon, s.ammo);
      if (rays > 1) {
        // A shot of many rays is laid from its aim and cone as 32-bit floats, as the server lays and sends it.
        if (!silenced) {
          lookDirection(s.yaw, s.pitch, d);
          this.flash(s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, nowMs);
        }
        this.pellets(world, s.x, s.y, s.z, Math.fround(s.yaw), Math.fround(s.pitch), Math.fround(s.cone), s.seed, rays, true, nowMs);
        continue;
      }
      shotDir(s.seed, 0, s.yaw, s.pitch, s.cone, d);
      if (full <= 0) {
        const reach = castWorld(world, s.x, s.y, s.z, d[0]!, d[1]!, d[2]!, HITSCAN_RANGE) === HIT_NONE ? HITSCAN_RANGE : rayHit.t;
        if (!silenced) this.flash(s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, nowMs);
        this.line(s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, s.x + d[0]! * reach, s.y + d[1]! * reach, s.z + d[2]! * reach, nowMs);
      } else {
        const speed = launchSpeed(full, s.draw);
        const wet = reg.weapon[s.weapon]?.wet ?? false;
        // A round that goes off flies its true path from the eye, and is drawn from the muzzle onto it.
        if (reg.ammoBlast[s.ammo]! > 0) this.fly(world, s.x, s.y, s.z, d[0]! * speed, d[1]! * speed, d[2]! * speed, s.ammo, -1, silenced, nowMs, 0, wet, true, true);
        else this.fly(world, s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, d[0]! * speed, d[1]! * speed, d[2]! * speed, s.ammo, -1, silenced, nowMs, 0, wet, true);
      }
    }
    session.fired.length = 0;
    // Shot and blast events are taken here. The rest stay for Feedback.absorb.
    const events = session.events;
    let kept = 0;
    for (const ev of events) {
      if (ev.kind === EVENT_BLAST) {
        // Its round ends here, wherever this client had flown it to.
        if (ev.id !== 0) this.finish(ev.id, nowMs);
        if (this.fire) this.fire.burst(reg.burstLook[ev.item] ?? 0, ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.far, ev.surface, ev.made, blastSeed(ev.id, ev.x, ev.y, ev.z), nowMs);
        else {
          if (this.blasts.length >= MAX_TRACERS) this.blasts.shift();
          this.blasts.push({ x: ev.x, y: ev.y, z: ev.z, radius: ev.far, born: nowMs });
        }
        continue;
      }
      if (ev.kind === EVENT_ROCKET) {
        this.told(world, ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.item, ev.back, ev.id, ev.own, nowMs);
        continue;
      }
      if (ev.kind === EVENT_BALL) {
        if (this.balls.length >= MAX_TRACERS) this.balls.shift();
        // Half as large again as the body, so that it closes over it or opens round it.
        this.balls.push({ x: ev.x, y: ev.y + ev.vy / 2, z: ev.z, size: 1.5 * Math.max(2 * ev.far, ev.vy), into: ev.kill, born: nowMs });
        continue;
      }
      if (ev.kind !== EVENT_SHOT) {
        events[kept++] = ev;
        continue;
      }
      if (ev.flies) this.fly(world, ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.item, ev.back, ev.silenced, nowMs, ev.far, ev.wet ?? false, ev.mine ?? false);
      else if (ev.rays > 1) {
        // The first ray's way stands for the muzzle's, as a silencer hides the flash of any shot.
        if (!ev.silenced) {
          lookDirection(ev.vx, ev.vy, d);
          this.flash(ev.x + d[0]! * AHEAD, ev.y - BELOW + d[1]! * AHEAD, ev.z + d[2]! * AHEAD, nowMs);
        }
        this.pellets(world, ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.seed, ev.rays, false, nowMs);
      } else {
        if (!ev.silenced) {
          const dx = ev.vx - ev.x;
          const dy = ev.vy - ev.y;
          const dz = ev.vz - ev.z;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const k = l > AHEAD ? AHEAD / l : 0;
          this.flash(ev.x + dx * k, ev.y - BELOW + dy * k, ev.z + dz * k, nowMs);
        }
        this.line(ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, nowMs);
      }
    }
    events.length = kept;
  }

  /** A flash at (x, y, z). The blast's cube looks the same every way; a bolt's own points along (dx, dy, dz), the way its shot left. */
  private flash(x: number, y: number, z: number, nowMs: number, mesh = this.blastMesh, size = FLASH_SIZE, ms = FLASH_MS, dx = 0, dy = 0, dz = 1): void {
    if (this.flashes.length >= MAX_TRACERS) this.flashes.shift();
    this.flashes.push({ x, y, z, dx, dy, dz, born: nowMs, until: nowMs + ms, mesh, size });
  }

  /**
   * A tracer for each of a shot's `rays` from (x, y, z), each shotDir(seed, k, ...) about the aim `yaw`, `pitch` within
   * `cone`, as the server cast them, to the world it meets. `own`: drawn from ahead of the eye, as its own shot is.
   */
  private pellets(world: CollisionWorld, x: number, y: number, z: number, yaw: number, pitch: number, cone: number, seed: number, rays: number, own: boolean, nowMs: number): void {
    const d = this.dir;
    for (let k = 0; k < rays; k++) {
      shotDir(seed, k, yaw, pitch, cone, d);
      const reach = castWorld(world, x, y, z, d[0]!, d[1]!, d[2]!, HITSCAN_RANGE) === HIT_NONE ? HITSCAN_RANGE : rayHit.t;
      const ahead = own ? AHEAD : 0;
      this.line(x + d[0]! * ahead, y - (own ? BELOW : 0) + d[1]! * ahead, z + d[2]! * ahead, x + d[0]! * reach, y + d[1]! * reach, z + d[2]! * reach, nowMs);
    }
  }

  /**
   * The server tells of a round that goes off: number `id`, left (x, y, z) `age` ticks ago. One already kept under that
   * number is not started again. The viewer's `own` was drawn when it was fired, and takes the number: the newest of
   * its rounds of that ammunition that has none.
   */
  private told(world: CollisionWorld, x: number, y: number, z: number, vx: number, vy: number, vz: number, ammo: number, age: number, id: number, own: boolean, nowMs: number): void {
    const flying = this.flying;
    for (let i = 0; i < flying.length; i++) if (flying[i]!.rocket && flying[i]!.id === id) return;
    if (own) {
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i]!;
        if (f.own && f.id === 0 && f.ammo === ammo) {
          f.id = id;
          return;
        }
      }
    }
    this.fly(world, x, y, z, vx, vy, vz, ammo, age, false, nowMs, 0, false, own, true, id);
  }

  /** Round `id` went off: it is gone, flying or waiting. */
  private finish(id: number, nowMs: number): void {
    const flying = this.flying;
    for (let i = 0; i < flying.length; i++) {
      const f = flying[i]!;
      if (!f.rocket || f.id !== id) continue;
      if (f.waits !== 0) this.waiting--;
      else {
        const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz) || 1;
        this.ended(f.x, f.y, f.z, f.vx / speed, f.vy / speed, f.vz / speed, nowMs);
        this.out(f, nowMs);
      }
      for (let k = i + 1; k < flying.length; k++) flying[k - 1] = flying[k]!;
      flying.length--;
      return;
    }
  }

  /** The fire is told that `f` flies no more. */
  private out(f: Flying, nowMs: number): void {
    if (!f.lit) return;
    f.lit = false;
    this.fire?.end(f.key, nowMs);
  }

  /**
   * A round of `ammo` left (x, y, z) `back` ticks ago, as its shooter saw it. The server has flown it that far already
   * and met no body, so it is flown that far at once against the world alone: it is then drawn where the server's is and
   * comes when its harm does. One the server flew to its end in that time is told with the metres it had gone, `ended`,
   * and bursts there. `back` is -1 for one that leaves now from ahead of the eye. `mine` is this client's own, which
   * does not meet its own body: its own shot, or its throw told back to it. A `rocket` goes off where it ends: it has
   * the number `id`, 0 where none is told yet, starts at its shooter's eye whoever shot it, and is drawn from the muzzle
   * of the gun that is drawn there.
   */
  private fly(world: CollisionWorld, x: number, y: number, z: number, vx: number, vy: number, vz: number, ammo: number, back: number, silenced: boolean, nowMs: number, ended = 0, wet = false, mine = false, rocket = false, id = 0): void {
    const mesh = this.meshOfAmmo[ammo] ?? -1;
    if (mesh < 0) return;
    const reg = this.reg;
    const size = reg.ammoBoltSize[ammo]!;
    const lit = this.flashOfAmmo[ammo]!;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (lit >= 0 && !silenced && speed > 0) {
      // Another's leaves its eye, as the server said, so its flash is put ahead of that as its own shot's start is.
      const ahead = back >= 0 ? AHEAD / speed : 0;
      this.flash(x + vx * ahead, y + vy * ahead - (back >= 0 ? BELOW : 0), z + vz * ahead, nowMs, lit, BOLT_FLASH * size, BOLT_FLASH_MS, vx / speed, vy / speed, vz / speed);
    }
    const f: Flying = {
      x, y, z, vx, vy, vz, gravity: reg.ammoGravity[ammo]!, mesh, ammo, left: FLIGHT_TICKS, age: 0, flown: 0, reach: reg.ammoReach[ammo]!, sx: x, sz: z,
      own: mine, wet, under: y < world.hf.waterAt(x, z), clear: 0, lead: 0, met: false, gone: false, splash: false, fresh: !rocket,
      rocket, id, key: id, lit: false, ox: 0, oy: 0, oz: 0, waits: 0,
    };
    const flame = reg.ammoFlame[ammo]!;
    if (rocket && speed > 0) {
      if (mine && id === 0) f.key = --this.ownKey;
      if (back < LEFT_NOW) {
        // Seen to leave: from its gun's muzzle where that is drawn, else from ahead of the eye as every shot was.
        const dx = vx / speed, dy = vy / speed, dz = vz / speed, m = this.muzzle, v = this.vent;
        const drawn = this.drawn !== null && this.drawn.heldNear(x, y, z, HELD_MUZZLE, m);
        if (!drawn) {
          m[0] = x + dx * AHEAD;
          m[1] = y + dy * AHEAD - BELOW;
          m[2] = z + dz * AHEAD;
        }
        if (!drawn || !this.drawn!.heldNear(x, y, z, HELD_VENT, v)) {
          v[0] = x - dx * VENT_BEHIND;
          v[1] = y - dy * VENT_BEHIND - BELOW;
          v[2] = z - dz * VENT_BEHIND;
        }
        f.ox = m[0]! - x;
        f.oy = m[1]! - y;
        f.oz = m[2]! - z;
        // A round with a motor leaves a launcher, which flashes ahead and blows out behind. Every client draws it from one seed.
        if (flame > 0) this.fire?.launch(m[0]!, m[1]!, m[2]!, v[0]!, v[1]!, v[2]!, dx, dy, dz, blastSeed(0, x, y, z), mine, nowMs);
      }
    }
    // The ticks the server flew are flown on its word: it met nothing in them, so only the water a wet round goes on
    // into is looked for. One that ended is flown to its end however many ticks that takes: `back` is whole ticks, and
    // its end was within one more. A rocket is told before the server flies it, so its way is looked along here.
    this.look(f, world, back <= 0 || rocket);
    for (let k = 0; k < (ended > 0 ? back + 2 : back) && f.waits === 0; k++) {
      if (ended > 0) {
        flyStep(f, f.gravity);
        if (f.flown + piece.length >= ended) {
          this.end(f, piece.x, piece.y, piece.z, piece.dx, piece.dy, piece.dz, ended - f.flown, nowMs);
          return;
        }
      }
      if (!this.advance(f, world, null, nowMs, false)) return;
    }
    if (ended > 0) return;
    // One flown on the server's word has its next piece looked along in full. A rocket's was, as it was flown.
    if (back > 0 && !rocket) this.look(f, world, true);
    if (this.flying.length >= MAX_FLYING) {
      const gone = this.flying.shift()!;
      if (gone.waits !== 0) this.waiting--;
      this.out(gone, nowMs);
    }
    this.flying.push(f);
    if (rocket && flame > 0 && f.waits === 0 && this.fire) {
      // Its smoke starts at the muzzle, when it passed there by this client's clock, and lies beside its path from then.
      f.lit = true;
      const lead = ((f.ox * vx + f.oy * vy + f.oz * vz) / (speed * speed)) * 1000;
      this.fire.fly(f.key, x + f.ox, y + f.oy, z + f.oz, vx, vy, vz, f.gravity, flame, nowMs - ((back > 0 ? back : 0) * 1000) / TICK_RATE + lead, mine);
    }
  }

  /** `f` met something `length` metres along the piece from (x, y, z): its end is kept for the details, and a bolt of light bursts there. */
  private end(f: Flying, x: number, y: number, z: number, dx: number, dy: number, dz: number, length: number, nowMs: number): void {
    this.ended(x, y, z, dx, dy, dz, nowMs);
    const burst = this.burstOfAmmo[f.ammo]!;
    if (burst < 0) return;
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({ x: x + dx * length, y: y + dy * length, z: z + dz * length, born: nowMs, mesh: burst, size: BOLT_BURST * this.reg.ammoBoltSize[f.ammo]! });
  }

  /** Sorts the bodies of `remote` that a shot can meet into squares, for `advance` to find those near a flight's piece. */
  private sort(remote: RemoteSample): void {
    const reg = this.reg;
    const heads = this.nearHead;
    heads.fill(-1);
    let wide = 0;
    for (let i = remote.count - 1; i >= 0; i--) {
      const kind = remote.kind[i]!;
      const r = reg.bodyRadius[kind]!;
      if (reg.move[kind] === null || r <= 0) continue;
      if (r > wide) wide = r;
      const c = nearSquare(Math.floor(remote.x[i]! / NEAR_CELL), Math.floor(remote.z[i]! / NEAR_CELL));
      this.nearNext[i] = heads[c]!;
      heads[c] = i;
    }
    this.nearWide = wide;
  }

  /**
   * How tall body `i` of `remote` stands to a shot, as it is drawn: one that crouches or lies is as low as that, one
   * knocked out lies, and a dead one is met by nothing, as the server meets none.
   */
  private tall(remote: RemoteSample, i: number, kind: number): number {
    const move = this.reg.move[kind]!;
    const st = this.posed;
    st.unpack(remote.anim[i]!, remote.cue[i]!);
    if (st.dead) return 0;
    if (st.out) return move.proneHeight > 0 ? move.proneHeight : this.reg.bodyHeight[kind]!;
    return st.stance !== STANCE_STAND && move.crouchHeight > 0 ? stanceHeight(move, st.stance) : this.reg.bodyHeight[kind]!;
  }

  /**
   * Looks along the piece `f` flies next, as the server flies it: how far it is free of its reach, the water and the
   * world, and what is there. A round is never drawn further along a piece than it was found free, by this and by
   * `bodies`. Not `whole`, it is a piece the server has flown and met nothing in: its reach and, for a round that goes
   * on under water, the water are all that is looked for.
   */
  private look(f: Flying, world: CollisionWorld, whole: boolean): void {
    flyStep(f, f.gravity);
    let length = piece.length;
    const { x, y, z, dx, dy, dz } = piece;
    f.met = f.splash = false;
    // The piece that reaches its reach is cut there, as the server cuts it.
    f.gone = !(length > 0) || (f.reach > 0 && f.flown + length >= f.reach);
    if (f.gone) length = length > 0 ? Math.max(0, f.reach - f.flown) : 0;
    let wet = false;
    if (!f.under && length > 0 && (whole || f.wet)) {
      const sea = world.hf.seaLevel;
      if (y > sea && y + dy * length <= sea && seaHere(world.hf.water, x + (dx * (sea - y)) / dy, z + (dz * (sea - y)) / dy)) {
        length = (sea - y) / dy;
        wet = true;
      }
      const lake = bodyAlong(world.hf.water, x, y, z, dx, dy, dz, length);
      if (lake <= length) {
        length = lake;
        wet = true;
      }
    }
    // At the surface one from a dry weapon stops. One from a wet weapon goes on, slowed.
    if (wet) {
      f.met = !f.wet;
      f.splash = f.wet;
    }
    if (whole && length > 0 && castWorld(world, x, y, z, dx, dy, dz, length) !== HIT_NONE) {
      length = rayHit.t;
      f.met = true;
      f.splash = false;
    }
    f.clear = length;
    // One that goes on into the water flies its whole piece, as the server moves it.
    f.lead = f.splash && !f.gone ? piece.length : length;
  }

  /**
   * Cuts the current flight `piece` at the first body in it: the client's own, which is not among
   * those it is sent, and the drawn bodies of `remote`. They are met where they are drawn now, a
   * tick before the round is there: near enough for a picture, and it lets the round be drawn no further than the body.
   */
  private bodies(f: Flying, remote: RemoteSample | null): void {
    f.fresh = false;
    let length = f.clear;
    // A round that goes off meets no body here: the server's blast ends it.
    if (f.rocket || !(length > 0)) return;
    const { x, y, z, dx, dy, dz } = piece;
    let met = false;
    const me = this.me;
    if (!f.own && me.r > 0) {
      const t = rayBox(x, y, z, dx, dy, dz, me.x - me.r, me.y, me.z - me.r, me.x + me.r, me.y + me.h, me.z + me.r);
      if (t < length) {
        length = t;
        met = true;
      }
    }
    if (remote && remote.count > 0) {
      if (!this.bodiesSorted) {
        this.sort(remote);
        this.bodiesSorted = true;
      }
      const reg = this.reg;
      // A shot starts inside its shooter's box, so over its first two pieces whoever stands where it left is passed over.
      const near = f.age < 2;
      const pad = this.nearWide;
      const ex = x + dx * length;
      const ez = z + dz * length;
      const minX = Math.min(x, ex), maxX = Math.max(x, ex);
      const x0 = Math.floor((minX - pad) / NEAR_CELL);
      const x1 = Math.floor((maxX + pad) / NEAR_CELL);
      const minZ = Math.min(z, ez), maxZ = Math.max(z, ez);
      const z0 = Math.floor((minZ - pad) / NEAR_CELL);
      const z1 = Math.floor((maxZ + pad) / NEAR_CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = nearSquare(cx, cz);
          for (let i = this.nearHead[c]!; i >= 0; i = this.nearNext[i]!) {
            const kind = remote.kind[i]!;
            const r = reg.bodyRadius[kind]!;
            const bx = remote.x[i]!, bz = remote.z[i]!;
            if (bx + r < minX || bx - r > maxX || bz + r < minZ || bz - r > maxZ) continue;
            if (near && (bx - f.sx) * (bx - f.sx) + (bz - f.sz) * (bz - f.sz) < (r + SHOOTER) * (r + SHOOTER)) continue;
            // As tall as its kind stands first: few are in the way at all, and only one that is has its stance read.
            const full = reg.bodyHeight[kind]!;
            let t = rayBox(x, y, z, dx, dy, dz, bx - r, remote.y[i]!, bz - r, bx + r, remote.y[i]! + full, bz + r);
            if (!(t < length)) continue;
            const tall = this.tall(remote, i, kind);
            if (!(tall > 0)) continue;
            if (tall < full) t = rayBox(x, y, z, dx, dy, dz, bx - r, remote.y[i]!, bz - r, bx + r, remote.y[i]! + tall, bz + r);
            if (t < length) {
              length = t;
              met = true;
            }
          }
        }
      }
    }
    if (!met) return;
    f.clear = length;
    if (length < f.lead) f.lead = length;
    f.met = true;
    f.splash = false;
  }

  /**
   * Flies `f` one tick along the piece it last looked along. False when it ended: out of reach, or on what was found
   * in that piece. One that ended on something bursts there, if it is a bolt of light. When `live`, its next piece is
   * tested against the bodies drawn. A round flown at once to where the server has it is not `live`: the server met no
   * body on that way. A round that goes off is not ended here: where its way ends it is put to wait for its blast.
   */
  private advance(f: Flying, world: CollisionWorld, remote: RemoteSample | null, nowMs: number, live: boolean): boolean {
    if (f.rocket && f.id === 0 && f.age >= UNTOLD_TICKS) f.rocket = false;
    if (--f.left < 0) return f.rocket && this.wait(f, nowMs);
    flyStep(f, f.gravity);
    const whole = piece.length;
    if (f.rocket && (f.met || f.gone)) {
      if (f.met) this.ended(piece.x, piece.y, piece.z, piece.dx, piece.dy, piece.dz, nowMs);
      f.x = piece.x + piece.dx * f.clear;
      f.y = piece.y + piece.dy * f.clear;
      f.z = piece.z + piece.dz * f.clear;
      return this.wait(f, nowMs);
    }
    if (f.met) {
      this.end(f, piece.x, piece.y, piece.z, piece.dx, piece.dy, piece.dz, f.clear, nowMs);
      return false;
    }
    if (f.gone) return false;
    flyEnd(f, f.gravity);
    f.age++;
    f.flown += whole;
    if (f.splash) {
      f.under = true;
      f.vx *= WATER_SPEED;
      f.vy *= WATER_SPEED;
      f.vz *= WATER_SPEED;
    } else if (f.under && f.y > world.hf.waterAt(f.x, f.z)) f.under = false;
    // A rocket's way is looked along whoever flew it: the server tells of it before it has flown it.
    this.look(f, world, live || f.rocket);
    if (live) this.bodies(f, remote);
    return true;
  }

  /** A round that goes off met something here: its picture and its fire end, and it is kept a while for its blast. True, as it is kept. */
  private wait(f: Flying, nowMs: number): boolean {
    f.waits = nowMs + AWAIT_MS;
    this.waiting++;
    this.out(f, nowMs);
    return true;
  }

  private line(x: number, y: number, z: number, ex: number, ey: number, ez: number, nowMs: number): void {
    const dx = ex - x;
    const dy = ey - y;
    const dz = ez - z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(length > 0.01)) return;
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.ended(x, y, z, dx / length, dy / length, dz / length, nowMs);
    this.tracers.push({ x, y, z, dx: dx / length, dy: dy / length, dz: dz / length, length: length > TRACER_REACH ? TRACER_REACH : length, until: nowMs + TRACER_MS });
  }

  /**
   * Flies each shot up to the whole tick of `tick`. A flight ends at the ground, a wall, water, or a drawn body; a round
   * that goes off ends when its blast is told, and waits for it AWAIT_MS where it met the world here.
   */
  step(world: CollisionWorld, remote: RemoteSample | null, tick: number, nowMs: number): void {
    while (this.tracers.length > 0 && nowMs >= this.tracers[0]!.until) this.tracers.shift();
    while (this.blasts.length > 0 && nowMs >= this.blasts[0]!.born + BLAST_MS) this.blasts.shift();
    while (this.balls.length > 0 && nowMs >= this.balls[0]!.born + BALL_MS) this.balls.shift();
    // The flashes are not all as long, so the first out is found among them.
    for (let i = this.flashes.length - 1; i >= 0; i--) if (nowMs >= this.flashes[i]!.until) this.flashes.splice(i, 1);
    while (this.bursts.length > 0 && nowMs >= this.bursts[0]!.born + BOLT_BURST_MS) this.bursts.shift();
    this.now = nowMs;
    const whole = Math.floor(tick);
    // After a clock jump, do not catch up tick by tick.
    if (this.tick < 0 || whole - this.tick > 8 || whole < this.tick) this.tick = whole - 1;
    // One that left since the last step has its first piece tested now, before it is drawn.
    this.bodiesSorted = false;
    for (const f of this.flying) if (f.fresh) {
      flyStep(f, f.gravity);
      this.bodies(f, remote);
    }
    for (; this.tick < whole; this.tick++) {
      let kept = 0;
      for (const f of this.flying) {
        if (f.waits !== 0 || this.advance(f, world, remote, nowMs, true)) this.flying[kept++] = f;
        else this.out(f, nowMs);
      }
      this.flying.length = kept;
    }
    if (this.waiting > 0) {
      // A round whose blast never came is dropped quietly.
      let kept = 0;
      for (const f of this.flying) {
        if (f.waits !== 0 && nowMs >= f.waits) this.waiting--;
        else this.flying[kept++] = f;
      }
      this.flying.length = kept;
    }
  }

  private ended(x: number, y: number, z: number, dx: number, dy: number, dz: number, at: number): void {
    if (this.ends.length >= ENDS) this.ends.shift();
    this.ends.push({ x, y, z, dx, dy, dz, at });
  }

  /** `tick` may be fractional. A flight is drawn that far along its next piece. */
  draw(ch: Characters, p: FramePacket, cam: Camera, tick: number): void {
    this.drawn = ch;
    ch.ownRounds = this.ownRounds;
    // Asked for every frame as a draw asks, shot or no shot, so that each mesh is on the card with its surface and its
    // materials before the first shot needs them: a surface is not sent for until its level is there.
    const assets = this.assets;
    if (assets) {
      for (const mesh of this.kept) {
        if (!assets.known(mesh)) continue;
        // Its materials are said to be thirty metres off, so their pictures are kept small until a shot is near.
        assets.wantTextured(mesh, 0, PRELOAD);
        const held = assets.level(mesh, 0);
        if (held >= 0) assets.textured(mesh, held);
      }
    }
    const ahead = (tick - Math.floor(tick)) * TICK_DT;
    const fire = this.fire;
    let room = true;
    for (const f of this.flying) {
      if (f.waits !== 0) continue;
      const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz);
      if (!(speed > 0)) continue;
      // Between ticks it is drawn along its next piece, and no further than that was found free: not past a wall, the
      // water or its reach, which the next tick ends it at.
      const along = Math.min(speed * ahead, f.lead) / speed;
      let x = f.x + f.vx * along;
      let y = f.y + f.vy * along;
      let z = f.z + f.vz * along;
      let roll = 0;
      if (f.rocket) {
        // It leaves its muzzle and comes onto its path over its first metres.
        const k = 1 - (f.flown + speed * along) / LEAVE;
        if (k > 0) {
          const share = k * k * (3 - 2 * k);
          x += f.ox * share;
          y += f.oy * share;
          z += f.oz * share;
        }
        // The fire is told where it is drawn whether or not the meshes have room.
        if (f.lit) {
          fire!.at(f.key, x, y, z, f.vx / speed, f.vy / speed, f.vz / speed);
          roll = (this.now / 1000) * ROLL * 2 * Math.PI + f.key;
        }
      }
      x -= cam.x;
      y -= cam.y;
      z -= cam.z;
      if (!room || !cam.boxVisible(x - 1, y - 1, z - 1, x + 1, y + 1, z + 1)) continue;
      // A bolt of light is its head with a tail behind it, no longer than it has flown.
      const size = this.reg.ammoBoltSize[f.ammo]!;
      const tail = size > 0 ? Math.max(0.2 * size, Math.min(BOLT_TAIL * size, f.flown + speed * along)) : 1;
      room = ch.loose(p, f.mesh, x, y, z, f.vx / speed, f.vy / speed, f.vz / speed, tail, size > 0 ? size : 1, 0, roll);
    }
    if (!room) return;
    // A blast is a flash that swells from a quarter of its reach to most of it.
    for (const b of this.blasts) {
      const size = b.radius * (0.25 + 0.75 * Math.min(1, (this.now - b.born) / BLAST_MS)) * 0.9;
      if (this.blastMesh >= 0 && !ch.loose(p, this.blastMesh, b.x - cam.x, b.y - cam.y, b.z - cam.z, 0, 0, 1, size, size)) return;
    }
    // A tame into a ball is a flash its size that closes to nothing; one out of a ball opens from nothing to its size.
    for (const b of this.balls) {
      const t = Math.min(1, (this.now - b.born) / BALL_MS);
      const size = b.size * (b.into ? 1 - t : t);
      // It turns as it goes, a quarter turn over its life.
      const a = (t * Math.PI) / 2;
      if (this.ballMesh >= 0 && size > 0.01 && !ch.loose(p, this.ballMesh, b.x - cam.x, b.y - cam.y, b.z - cam.z, Math.sin(a), 0, Math.cos(a), size, size)) return;
    }
    for (const f of this.flashes) if (f.mesh >= 0 && !ch.loose(p, f.mesh, f.x - cam.x, f.y - cam.y, f.z - cam.z, f.dx, f.dy, f.dz, f.size, f.size)) return;
    // A burst swells from a third of its size to all of it, turning a quarter turn.
    for (const b of this.bursts) {
      const t = Math.min(1, (this.now - b.born) / BOLT_BURST_MS);
      const size = b.size * (0.35 + 0.65 * t);
      const a = (t * Math.PI) / 2;
      if (!ch.loose(p, b.mesh, b.x - cam.x, b.y - cam.y, b.z - cam.z, Math.sin(a), 0, Math.cos(a), size, size)) return;
    }
    if (this.tracerMesh < 0) return;
    for (const t of this.tracers) if (!ch.loose(p, this.tracerMesh, t.x - cam.x, t.y - cam.y, t.z - cam.z, t.dx, t.dy, t.dz, t.length)) return;
  }
}
