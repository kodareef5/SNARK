// Pictures of shots: arrows and darts in the air, and tracer lines. They decide nothing. The server flies every shot
// (server/projectiles.ts), and the client draws its own with the same arithmetic (shared/sim/projectiles.ts).

import { Assets } from "./assets/assets.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import type { Pack } from "../../shared/pack/pack.ts";
import { HELD_MUZZLE, HELD_VENT } from "../../shared/content/kinds/weapons.ts";
import { EVENT_BALL, EVENT_BLAST, EVENT_ROCKET, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { blastSeed } from "../../shared/net/rockets.ts";
import { HITSCAN_RANGE, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../../shared/sim/projectiles.ts";
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
/** Bursts drawn at once. */
const MAX_BURSTS = 64;
/** Bodies are sorted into squares this many metres wide, so that a flight is tested against those near it. A power of two of them. */
const NEAR_CELL = 16;
const NEAR_CELLS = 1024;
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
/** Ticks its own round may fly with no number told: past them it was told the old way, and ends by this client's judgement. */
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
  /** Metres flown. */
  flown: number;
  /**
   * A round that goes off where it ends (EVENT_ROCKET): the server ends it, by its blast. Its number, 0 until it is told;
   * the name the fire knows it by; and whether it is the viewer's own.
   */
  rocket: boolean;
  id: number;
  key: number;
  own: boolean;
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
  readonly flashes: { x: number; y: number; z: number; born: number; until: number; mesh: number; size: number }[] = [];
  /** Where a bolt of light ended on something: its burst's mesh and size. */
  readonly bursts: { x: number; y: number; z: number; born: number; mesh: number; size: number }[] = [];
  private readonly flashOfAmmo: Int32Array;
  private readonly burstOfAmmo: Int32Array;
  /** The bodies of the sample last sorted, by the square each stands in: where each square's run starts, and the run. */
  private readonly nearStart = new Uint16Array(NEAR_CELLS + 1);
  private readonly nearBody = new Uint16Array(MAX_VIEW);
  private readonly nearCell = new Uint16Array(MAX_VIEW);
  /** The widest of them, which a flight's search is widened by. */
  private nearWide = 0;
  private readonly blastMesh: number;
  /** The flash of a tame going into a soul ball or coming out (tools/pack/balls.ts), or the blast's where a pack has none. */
  private readonly ballMesh: number;
  private now = 0;
  private readonly meshOfAmmo: Int32Array;
  private readonly tracerMesh: number;
  /** The owner replaces this when the server's tuning arrives. */
  reg: Registry;
  /** Where what flies and goes off is drawn alight, which the scene gives. */
  fire: Blasts | null = null;
  /** The bodies as last drawn, for where a gun's muzzle is. `draw` keeps the one it is given. */
  bodies: Characters | null = null;
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

  constructor(reg: Registry, pack: Pack) {
    this.reg = reg;
    const { table, bind } = new Assets(reg, pack);
    // Its own mesh and no stand-in: ammunition without one is drawn as a tracer.
    this.meshOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo ? bind.own(d.id, "shot") : -1));
    this.flashOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo?.bolt ? bind.own(d.id, "flash") : -1));
    this.burstOfAmmo = Int32Array.from(reg.defs, (d) => (d?.type === "item" && d.ammo?.bolt ? bind.own(d.id, "burst") : -1));
    this.tracerMesh = table.find("core:tracer");
    this.blastMesh = table.find("core:blast");
    const flash = table.find("core:soul_flash");
    this.ballMesh = flash >= 0 ? flash : this.blastMesh;
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
        // A round that goes off flies its true path from the eye, and is drawn from the muzzle onto it.
        if (reg.ammoBlast[s.ammo]! > 0) this.fly(world, s.x, s.y, s.z, d[0]! * speed, d[1]! * speed, d[2]! * speed, s.ammo, -1, silenced, nowMs, true, 0, true);
        else this.fly(world, s.x + d[0]! * AHEAD, s.y - BELOW + d[1]! * AHEAD, s.z + d[2]! * AHEAD, d[0]! * speed, d[1]! * speed, d[2]! * speed, s.ammo, -1, silenced, nowMs);
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
      if (ev.flies) this.fly(world, ev.x, ev.y, ev.z, ev.vx, ev.vy, ev.vz, ev.item, ev.back, ev.silenced, nowMs);
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

  private flash(x: number, y: number, z: number, nowMs: number, mesh = this.blastMesh, size = FLASH_SIZE, ms = FLASH_MS): void {
    if (this.flashes.length >= MAX_TRACERS) this.flashes.shift();
    this.flashes.push({ x, y, z, born: nowMs, until: nowMs + ms, mesh, size });
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
    this.fly(world, x, y, z, vx, vy, vz, ammo, age, false, nowMs, true, id, own);
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
   * A round of `ammo` left (x, y, z) `back` ticks ago, as its shooter saw it. It is flown that far at once, against the world
   * alone, so that it is drawn where the server's is and comes when its harm does. `back` is -1 for its own shooter's,
   * which leaves now from ahead of the eye. A `rocket` goes off where it ends: it has the number `id`, 0 where none is
   * told yet, starts at its shooter's eye whoever shot it, and is drawn from the muzzle of the gun that is drawn there.
   */
  private fly(world: CollisionWorld, x: number, y: number, z: number, vx: number, vy: number, vz: number, ammo: number, back: number, silenced: boolean, nowMs: number, rocket = false, id = 0, own = false): void {
    const mesh = this.meshOfAmmo[ammo] ?? -1;
    if (mesh < 0) return;
    const reg = this.reg;
    const size = reg.ammoBoltSize[ammo]!;
    const lit = this.flashOfAmmo[ammo]!;
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (lit >= 0 && !silenced) {
      // Another's leaves its eye, as the server said, so its flash is put ahead of that as its own shot's start is.
      const ahead = back >= 0 && speed > 0 ? AHEAD / speed : 0;
      this.flash(x + vx * ahead, y + vy * ahead - (back >= 0 ? BELOW : 0), z + vz * ahead, nowMs, lit, BOLT_FLASH * size, BOLT_FLASH_MS);
    }
    const f: Flying = { x, y, z, vx, vy, vz, gravity: reg.ammoGravity[ammo]!, mesh, ammo, left: reg.ammoFlightTicks[ammo]!, age: 0, flown: 0, rocket, id, key: id, own, lit: false, ox: 0, oy: 0, oz: 0, waits: 0 };
    const flame = reg.ammoFlame[ammo]!;
    if (rocket && speed > 0) {
      if (own && id === 0) f.key = --this.ownKey;
      if (back < LEFT_NOW) {
        // Seen to leave: from its gun's muzzle where that is drawn, else from ahead of the eye as every shot was.
        const dx = vx / speed, dy = vy / speed, dz = vz / speed, m = this.muzzle, v = this.vent;
        const drawn = this.bodies !== null && this.bodies.heldNear(x, y, z, HELD_MUZZLE, m);
        if (!drawn) {
          m[0] = x + dx * AHEAD;
          m[1] = y + dy * AHEAD - BELOW;
          m[2] = z + dz * AHEAD;
        }
        if (!drawn || !this.bodies!.heldNear(x, y, z, HELD_VENT, v)) {
          v[0] = x - dx * VENT_BEHIND;
          v[1] = y - dy * VENT_BEHIND - BELOW;
          v[2] = z - dz * VENT_BEHIND;
        }
        f.ox = m[0]! - x;
        f.oy = m[1]! - y;
        f.oz = m[2]! - z;
        // A round with a motor leaves a launcher, which flashes ahead and blows out behind. Every client draws it from one seed.
        if (flame > 0) this.fire?.launch(m[0]!, m[1]!, m[2]!, v[0]!, v[1]!, v[2]!, dx, dy, dz, blastSeed(0, x, y, z), own, nowMs);
      }
    }
    for (let k = 0; k < back && f.waits === 0; k++) if (!this.advance(f, world, null, nowMs)) return;
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
      this.fire.fly(f.key, x + f.ox, y + f.oy, z + f.oz, vx, vy, vz, f.gravity, flame, nowMs - ((back > 0 ? back : 0) * 1000) / TICK_RATE + lead);
    }
  }

  /** Sorts the bodies of `remote` that a shot can meet into squares, for `advance` to find those near a flight's piece. */
  private sort(remote: RemoteSample): void {
    const reg = this.reg;
    const start = this.nearStart;
    const cell = this.nearCell;
    start.fill(0);
    let wide = 0;
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      const r = reg.bodyRadius[kind]!;
      if (reg.move[kind] === null || r <= 0) {
        cell[i] = NEAR_CELLS;
        continue;
      }
      if (r > wide) wide = r;
      const c = nearSquare(Math.floor(remote.x[i]! / NEAR_CELL), Math.floor(remote.z[i]! / NEAR_CELL));
      cell[i] = c;
      start[c]!++;
    }
    // Each square's count becomes where its run ends, and filling from the back leaves it where the run begins.
    for (let c = 1; c < NEAR_CELLS; c++) start[c]! += start[c - 1]!;
    start[NEAR_CELLS] = start[NEAR_CELLS - 1]!;
    for (let i = remote.count - 1; i >= 0; i--) if (cell[i]! < NEAR_CELLS) this.nearBody[--start[cell[i]!]!] = i;
    this.nearWide = wide;
  }

  /**
   * Flies `f` one tick. False when it ended: out of reach, or on the ground, a wall, water or, where `remote` is given and
   * sorted, a drawn body. A bolt of light that ended on something bursts there. A round that goes off is not ended here
   * and meets no body: where it runs out or meets the world it is put there to wait for its blast.
   */
  private advance(f: Flying, world: CollisionWorld, remote: RemoteSample | null, nowMs: number): boolean {
    if (f.rocket && f.id === 0 && f.age >= UNTOLD_TICKS) f.rocket = false;
    flyStep(f, f.gravity);
    let length = piece.length;
    const { x, y, z, dx, dy, dz } = piece;
    if (--f.left < 0 || !(length > 0)) {
      if (!f.rocket) return false;
      this.wait(f, nowMs);
      return true;
    }
    const sea = world.hf.seaLevel;
    let ends = false;
    if (y > sea && y + dy * length <= sea && seaHere(world.hf.water, x + (dx * (sea - y)) / dy, z + (dz * (sea - y)) / dy)) {
      length = (sea - y) / dy;
      ends = true;
    }
    const lake = bodyAlong(world.hf.water, x, y, z, dx, dy, dz, length);
    if (lake <= length) {
      length = lake;
      ends = true;
    }
    if (castWorld(world, x, y, z, dx, dy, dz, length) !== HIT_NONE) {
      length = rayHit.t;
      ends = true;
    }
    // The body test skips a flight's first two pieces, because a shot starts inside its shooter's box.
    if (remote && f.age >= 2 && !f.rocket) {
      const reg = this.reg;
      const pad = this.nearWide;
      const ex = x + dx * length;
      const ez = z + dz * length;
      const x0 = Math.floor(((x < ex ? x : ex) - pad) / NEAR_CELL);
      const x1 = Math.floor(((x < ex ? ex : x) + pad) / NEAR_CELL);
      const z0 = Math.floor(((z < ez ? z : ez) - pad) / NEAR_CELL);
      const z1 = Math.floor(((z < ez ? ez : z) + pad) / NEAR_CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = nearSquare(cx, cz);
          for (let k = this.nearStart[c]!, end = this.nearStart[c + 1]!; k < end; k++) {
            const i = this.nearBody[k]!;
            const kind = remote.kind[i]!;
            const r = reg.bodyRadius[kind]!;
            const t = rayBox(x, y, z, dx, dy, dz, remote.x[i]! - r, remote.y[i]!, remote.z[i]! - r, remote.x[i]! + r, remote.y[i]! + reg.bodyHeight[kind]!, remote.z[i]! + r);
            if (t < length) {
              length = t;
              ends = true;
            }
          }
        }
      }
    }
    if (ends) {
      this.ended(x, y, z, dx, dy, dz, nowMs);
      if (f.rocket) {
        f.x = x + dx * length;
        f.y = y + dy * length;
        f.z = z + dz * length;
        this.wait(f, nowMs);
        return true;
      }
      const burst = this.burstOfAmmo[f.ammo]!;
      if (burst >= 0) {
        if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
        this.bursts.push({ x: x + dx * length, y: y + dy * length, z: z + dz * length, born: nowMs, mesh: burst, size: BOLT_BURST * this.reg.ammoBoltSize[f.ammo]! });
      }
      return false;
    }
    flyEnd(f, f.gravity);
    f.age++;
    f.flown += length;
    return true;
  }

  /** A round that goes off met something here: its picture and its fire end, and it is kept a while for its blast. */
  private wait(f: Flying, nowMs: number): void {
    f.waits = nowMs + AWAIT_MS;
    this.waiting++;
    this.out(f, nowMs);
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
    if (this.tick < whole && remote && this.flying.length > 0) this.sort(remote);
    for (; this.tick < whole; this.tick++) {
      let kept = 0;
      for (const f of this.flying) {
        if (f.waits !== 0 || this.advance(f, world, remote, nowMs)) this.flying[kept++] = f;
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
    this.bodies = ch;
    ch.ownRounds = this.ownRounds;
    const ahead = (tick - Math.floor(tick)) * TICK_DT;
    const fire = this.fire;
    let room = true;
    for (const f of this.flying) {
      if (f.waits !== 0) continue;
      const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz);
      if (!(speed > 0)) continue;
      let x = f.x + f.vx * ahead;
      let y = f.y + f.vy * ahead;
      let z = f.z + f.vz * ahead;
      let roll = 0;
      if (f.rocket) {
        // It leaves its muzzle and comes onto its path over its first metres.
        const k = 1 - (f.flown + speed * ahead) / LEAVE;
        if (k > 0) {
          const share = k * k * (3 - 2 * k);
          x += f.ox * share;
          y += f.oy * share;
          z += f.oz * share;
        }
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
      const tail = size > 0 ? Math.max(0.2 * size, Math.min(BOLT_TAIL * size, f.flown + speed * ahead)) : 1;
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
    for (const f of this.flashes) if (f.mesh >= 0 && !ch.loose(p, f.mesh, f.x - cam.x, f.y - cam.y, f.z - cam.z, 0, 0, 1, f.size, f.size)) return;
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
