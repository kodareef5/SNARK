// What burns: a rocket's flame and the smoke it leaves, a launcher's flash and backblast, and a blast's fire, smoke, dust
// and debris. They are pictures and decide nothing. Shots (client/core/shots.ts) says what flies and what went off, and
// the scene draws what is alight.
//
// Fire is two meshes drawn by the fire program (fire-light.ts): a cone behind each rocket, and up to three lobes a blast,
// every flame in a draw and every blast's lobes in one. Everything soft is the small details' (client/core/details): a
// blast asks them for its smoke, dust, debris, sparks and scorch once, as it goes off, and they fly, land and fade there.
// A rocket's smoke is not kept at all: its path is known from how it left, so each frame its puffs are written along it
// where smoke that old would be, as cards among the details' (`cards`, `write`).
//
// Nothing here is made in a frame: rockets and blasts are rows of typed arrays, and what is random in a blast comes from
// its seed, which every client has alike.

import type { Registry } from "../../../shared/content/registry.ts";
import { SURFACE_AIR, SURFACE_BODY, SURFACE_BUILT, SURFACE_GROUND, SURFACE_VEHICLE, SURFACE_WATER } from "../../../shared/net/rockets.ts";
import { sortU32 } from "../../../shared/sort.ts";
import type { Assets } from "../assets/assets.ts";
import type { Tier } from "../assets/tiers.ts";
import type { Details } from "../details/details.ts";
import { SHAKE_LAUNCH, Shake, blastShake } from "../view/shake.ts";
import { LOW } from "./atmosphere.ts";
import type { Camera } from "./camera.ts";
import type { Draws } from "./draws.ts";
import { FIRE_FLAME, FIRE_LOBE, flamePhase, lobeSwell, putFlame, putLobe } from "./fire-light.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_SMOKE, DRAW_BLEND, DRAW_FIRE, DRAW_PLAIN, GLOW_STEPS, TRANSIENT_BUFFER, type FramePacket } from "./packet.ts";

/** Rounds with a motor kept at once, flying or their smoke still thinning, and blasts whose fire is still alight. */
export const MAX_TRAILS = 64;
export const MAX_BURSTS = 32;
/** Puffs of one rocket's smoke a frame at most, and of every rocket's together. */
export const TRAIL_CARDS = 24;
export const MAX_TRAIL_CARDS = 384;
/** Cards a frame holds in all: the smoke, and each rocket's glow and each far blast's. */
const MAX_CARDS = 512;
/** Seconds a rocket's smoke hangs, and seconds between the puffs laid nearest it. */
export const TRAIL_SECONDS = 3;
const TRAIL_STEP = 1 / 30;
/**
 * A puff is of a level, the count of twos its place along the path divides by: every other one is of level 0 and is gone
 * soonest, so the smoke is close set by the rocket and thins behind it, and no puff ever slides along it.
 */
const LEVEL_AGES = [0.25, 0.6, 1.4, TRAIL_SECONDS] as const;
/** The ground wind is the low clouds' turned down to this share, as the details have it. */
const WIND_SHARE = 0.1;
/** Milliseconds a motor takes to settle after it lights, its flame longer and brighter meanwhile. */
const IGNITE_MS = 350;
/** Metres past which a flame is its glow alone, and a blast its glow alone; and within which a blast has three lobes, and two. */
export const FLAME_REACH = 160;
export const BURST_REACH = 250;
export const LOBES_NEAR = 60;
export const LOBES_MID = 140;
/** Scorches that lie at once, and the milliseconds one lies: a blast past those leaves none, so a fight does not paint the ground over and over. */
export const SCORCHES = 8;
const SCORCH_MS = 32000;
/** A rocket's reach in metres, which a blast's size is measured against. */
const ROCKET_REACH = 7.5;

/** How a blast is drawn by what blew (shared/content/kinds/weapons.ts BURST_LOOKS): its fireball's share of its reach, its fire's seconds, and its share of a tier's particles. */
const LOOKS = [
  { ball: 0.36, life: 1, share: 0.6 },
  { ball: 0.4, life: 1.05, share: 0.75 },
  { ball: 0.42, life: 1.3, share: 1 },
] as const;

/** A blast's parts among the details, in the order of PARTS. */
const FLASH = 0, GLOW = 1, SOOT = 2, SMOKE = 3, DUST = 4, DEBRIS = 5, SPARKS = 6, SCORCH = 7, SPRAY = 8, DROPS = 9, RING = 10, LAUNCH_FLASH = 11, BACKBLAST = 12, BACK_DUST = 13;
const PARTS = ["blast_flash", "blast_glow", "blast_soot", "blast_smoke", "blast_dust", "blast_debris", "blast_sparks", "scorch", "blast_spray", "splash_drops", "splash_ring", "launch_flash", "backblast", "backblast_dust"] as const;
/** How many of each part a rocket's blast asks for at the most, of the fifty a tier's sixty leave after its three single ones. */
const SOOT_MOST = 6, SMOKE_MOST = 10, DUST_MOST = 12, DEBRIS_MOST = 11, SPARKS_MOST = 11, PARTS_MOST = 50;
/** By what was hit (shared/net/rockets.ts SURFACE_): the share of its soot, smoke, dust, debris and sparks a blast has. */
const BY_SURFACE: readonly (readonly number[])[] = [
  [1, 1, 0, 0, 1.6],
  [1, 1, 1, 1, 1],
  [1, 1, 0.6, 1.2, 1],
  [0.5, 0.6, 0, 0, 0.3],
  [1, 1, 0, 0.6, 1.5],
  [1, 1, 0, 0.9, 1.5],
];
const word = (r: number, g: number, b: number): number => (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0;
/** The colour of debris and dust off something built, by what it is made of (MADE_): unknown, thatch, wood, stone, metal. */
const MADE_TINT: readonly number[] = [word(150, 146, 138), word(176, 150, 96), word(128, 96, 64), word(150, 146, 138), word(96, 100, 108)];
/** The colour of the shards off a body or a vehicle. */
const SHARD_TINT = word(70, 72, 78);

/** The floats a blast keeps of each of its lobes: where it is from the blast, its radius, the seconds it waits, how far it moves in its life, its seed, its soot's shade and its heat. */
const LOBE = 11;
const LOBES = 3;

export class Blasts {
  /** The owner replaces this when the server's tuning arrives. */
  reg: Registry;
  /** Off, nothing of it is drawn: a page's before and after (client/core/passes.ts "bursts"). */
  on = true;
  /** What its blasts and the viewer's own launches shake the view by (client/core/sight.ts). */
  readonly shake = new Shake();
  /** Pixels the view is high, which a far rocket's glow is sized by. The scene sets it. */
  viewHeight = 720;
  /** Flames, blasts' draws and cards put in the last frame, the lobes among them, and the share of the screen they cover. */
  flames = 0;
  draws = 0;
  lobes = 0;
  fill = 0;
  /** Cards written this frame (`cards`), and the share of the screen they cover. */
  count = 0;
  private cardFill = 0;

  private readonly assets: Assets | null;
  private readonly put: Draws | null;
  private readonly details: Details | null;
  private readonly cone: number;
  private readonly lobe: number;
  /** Each part's effect among the details', -1 where the pack has none. */
  private readonly parts = new Int32Array(PARTS.length).fill(-1);

  // Rounds with a motor: 0 free, 1 flying, 2 gone and its smoke thinning.
  private readonly tLive = new Uint8Array(MAX_TRAILS);
  private readonly tKey = new Float64Array(MAX_TRAILS);
  private readonly tFrom = new Float64Array(MAX_TRAILS * 3);
  private readonly tWay = new Float32Array(MAX_TRAILS * 3);
  private readonly tFall = new Float32Array(MAX_TRAILS);
  private readonly tFlame = new Float32Array(MAX_TRAILS);
  private readonly tBorn = new Float64Array(MAX_TRAILS);
  private readonly tEnd = new Float64Array(MAX_TRAILS);
  /** Where its tail is and its way, as `at` last said, and the frame it said so in. */
  private readonly tAt = new Float64Array(MAX_TRAILS * 6);
  private readonly tSeen = new Uint32Array(MAX_TRAILS);
  private readonly tSeed = new Float32Array(MAX_TRAILS);

  // Blasts whose fire is alight.
  private readonly bLive = new Uint8Array(MAX_BURSTS);
  private readonly bAt = new Float64Array(MAX_BURSTS * 3);
  private readonly bBorn = new Float64Array(MAX_BURSTS);
  private readonly bLife = new Float32Array(MAX_BURSTS);
  private readonly bBall = new Float32Array(MAX_BURSTS);
  private readonly bLobes = new Uint8Array(MAX_BURSTS);
  private readonly bLobe = new Float32Array(MAX_BURSTS * LOBES * LOBE);

  /** When each of the last scorches was left. */
  private readonly scorched = new Float64Array(SCORCHES).fill(-Infinity);
  private serial = 1;
  private seeded = 0;
  private tier: Tier | null = null;
  private eyeX = NaN;
  private eyeY = NaN;
  private eyeZ = NaN;
  /** This frame's cards, the keys they are put far to near by, and the depths they reach. */
  private readonly held = new Float32Array(MAX_CARDS * DETAIL_FLOATS);
  private readonly heldWords = new Uint32Array(this.held.buffer);
  private readonly keys = new Uint32Array(MAX_CARDS);
  private nearest = Infinity;
  private farthest = -Infinity;
  private readonly order = new Uint8Array(LOBES);
  private readonly depth = new Float32Array(LOBES);

  /**
   * `assets` holds the fire's meshes, `put` writes its draws, and `details` takes what a blast throws up. Without them
   * it keeps what it is told and draws nothing.
   */
  constructor(reg: Registry, assets: Assets | null = null, put: Draws | null = null, details: Details | null = null) {
    this.reg = reg;
    this.assets = assets;
    this.put = put;
    this.details = details;
    this.cone = assets ? assets.table.find("core:fire_cone") : -1;
    this.lobe = assets ? assets.table.find("core:fire_lobe") : -1;
    PARTS.forEach((name, k) => {
      const effect = details ? details.effectOf(`core:details/${name}`) : -1;
      this.parts[k] = effect;
      // The splashes are a body's too, and are drawn when this is off.
      if (effect >= 0 && k !== DROPS && k !== RING) details!.muted[effect] = 1;
    });
  }

  /** The next of a blast's random numbers, 0 to 1 (mulberry32, as shared/rng.ts has it). */
  private next(): number {
    let t = (this.seeded = (this.seeded + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** The row of round `key`, or -1. */
  private trail(key: number): number {
    for (let t = 0; t < MAX_TRAILS; t++) if (this.tLive[t] === 1 && this.tKey[t] === key) return t;
    return -1;
  }

  /**
   * A round with a motor left (ox, oy, oz) at `bornMs`, which may be past, at the velocity (vx, vy, vz), falling at
   * `gravity`, with `flame` metres of fire behind it. `key` names it until `end`: any whole number no other flying round has.
   * Its smoke is laid along that path from then on.
   */
  fly(key: number, ox: number, oy: number, oz: number, vx: number, vy: number, vz: number, gravity: number, flame: number, bornMs: number): void {
    let t = this.trail(key);
    if (t < 0) {
      // A free row, else the one whose smoke is oldest, else the round longest in the air.
      let gone = -1;
      for (let k = 0; k < MAX_TRAILS && t < 0; k++) {
        if (this.tLive[k] === 0) t = k;
        else if (this.tLive[k] === 2 && (gone < 0 || this.tEnd[k]! < this.tEnd[gone]!)) gone = k;
      }
      if (t < 0) t = gone;
      if (t < 0) {
        t = 0;
        for (let k = 1; k < MAX_TRAILS; k++) if (this.tBorn[k]! < this.tBorn[t]!) t = k;
      }
    }
    this.tLive[t] = 1;
    this.tKey[t] = key;
    this.tFrom[t * 3] = ox;
    this.tFrom[t * 3 + 1] = oy;
    this.tFrom[t * 3 + 2] = oz;
    this.tWay[t * 3] = vx;
    this.tWay[t * 3 + 1] = vy;
    this.tWay[t * 3 + 2] = vz;
    this.tFall[t] = gravity;
    this.tFlame[t] = flame;
    this.tBorn[t] = bornMs;
    this.tEnd[t] = NaN;
    this.tSeen[t] = 0;
    const s = key * 0.618034 + ox * 0.0137 + oz * 0.0071;
    this.tSeed[t] = s - Math.floor(s);
  }

  /** Where round `key`'s tail is this frame and its unit way: its flame is drawn there. Once a frame while it flies. */
  at(key: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const t = this.trail(key);
    if (t < 0) return;
    const o = t * 6, a = this.tAt;
    a[o] = x;
    a[o + 1] = y;
    a[o + 2] = z;
    a[o + 3] = dx;
    a[o + 4] = dy;
    a[o + 5] = dz;
    this.tSeen[t] = this.serial;
  }

  /** Round `key` is gone: its flame is out, and its smoke ends where it was at `nowMs` and thins away. */
  end(key: number, nowMs: number): void {
    const t = this.trail(key);
    if (t < 0) return;
    this.tLive[t] = 2;
    this.tEnd[t] = nowMs;
  }

  /** How many of a part a blast asks for: from `least` to `most` of it by its seed, times the tier's `unit` and what was hit's share of it. */
  private part(most: number, least: number, unit: number): number {
    return Math.floor((least + (most - least) * this.next()) * unit);
  }

  /**
   * Asks the details for `count` of a part at a place, along the unit way out (nx, ny, nz): how many they made. `share`
   * is the most of the tier's fill of the screen the part may take, so that each part of a blast leaves room for the next.
   */
  private ask(part: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, seed: number, scale: number, count: number, tint = -1, share = 1): number {
    const effect = this.parts[part]!;
    if (effect < 0 || count <= 0) return 0;
    return this.details!.burst(effect, x, y, z, nx, ny, nz, (seed + part * 0x9e3779b1) >>> 0, scale, count, tint, Number.NaN, share * (this.tier?.details.fill ?? 1));
  }

  /**
   * A launcher fired: a flash at its muzzle (mx, my, mz) along the unit way (dx, dy, dz), and a backblast from its vent
   * (vx, vy, vz) against it. `own` is the viewer's own shot, which shakes its view.
   */
  launch(mx: number, my: number, mz: number, vx: number, vy: number, vz: number, dx: number, dy: number, dz: number, seed: number, own: boolean, nowMs: number): void {
    if (own) this.shake.add(SHAKE_LAUNCH, nowMs);
    if (!this.details) return;
    this.seeded = seed >>> 0;
    const cap = (this.tier?.bursts.particles ?? 60) / 60;
    this.ask(LAUNCH_FLASH, mx, my, mz, dx, dy, dz, seed, 1, 1);
    this.ask(BACKBLAST, vx, vy, vz, -dx, -dy, -dz, seed, 1, Math.max(2, Math.round((6 + 2 * this.next()) * cap)), -1, 0.2);
    // Dust off the ground behind the shooter, where the blast of gas meets it.
    this.ask(BACK_DUST, vx - dx * 2.2, vy, vz - dz * 2.2, 0, 1, 0, seed, 1, Math.max(1, Math.round((4 + 2 * this.next()) * cap)), -1, 0.1);
  }

  /**
   * A blast at (x, y, z) reaching `radius` metres, on a surface whose unit way out is (nx, ny, nz). `look` is an index
   * into BURST_LOOKS, `surface` and `made` what it met (shared/net/rockets.ts SURFACE_, MADE_), and `seed` what every
   * client draws it from (blastSeed).
   */
  burst(look: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, surface: number, made: number, seed: number, nowMs: number): void {
    const recipe = LOOKS[look] ?? LOOKS[0];
    const scale = radius / ROCKET_REACH;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 0.5 || surface === SURFACE_AIR) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    const far = Math.hypot(x - this.eyeX, y - this.eyeY, z - this.eyeZ);
    this.shake.add(blastShake(far, radius), nowMs);
    this.seeded = seed >>> 0;
    // The fire: a row of its own, the oldest blast's if none is free.
    let b = 0;
    for (let k = 0; k < MAX_BURSTS; k++) {
      if (this.bLive[k] === 0) {
        b = k;
        break;
      }
      if (this.bBorn[k]! < this.bBorn[b]!) b = k;
    }
    const ball = radius * recipe.ball * (surface === SURFACE_WATER ? 0.7 : surface === SURFACE_BODY ? 0.85 : 1);
    const round = surface === SURFACE_AIR || surface === SURFACE_BODY || surface === SURFACE_VEHICLE;
    const count = surface === SURFACE_WATER ? 1 : 2 + (this.next() > 0.4 ? 1 : 0);
    this.bLive[b] = 1;
    this.bAt[b * 3] = x;
    this.bAt[b * 3 + 1] = y;
    this.bAt[b * 3 + 2] = z;
    this.bBorn[b] = nowMs;
    this.bLife[b] = recipe.life * (0.9 + 0.2 * this.next()) * Math.sqrt(Math.max(0.4, scale));
    this.bBall[b] = ball;
    this.bLobes[b] = count;
    // Two ways across the way out, for the lobes beside the first.
    let ax = nz, ay = 0, az = -nx;
    if (Math.abs(ny) > 0.9) {
      ax = 1;
      az = 0;
      ay = -nx / ny;
    }
    const al = Math.hypot(ax, ay, az);
    ax /= al;
    ay /= al;
    az /= al;
    const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
    const tone = 0.02 + 0.035 * this.next();
    const rise = surface === SURFACE_BUILT ? 0.45 : 0.22;
    for (let k = 0; k < LOBES; k++) {
      const o = (b * LOBES + k) * LOBE, l = this.bLobe;
      const turn = this.next() * Math.PI * 2, out = this.next(), up = this.next(), size = this.next(), wait = this.next();
      const cx = ax * Math.cos(turn) + bx * Math.sin(turn), cy = ay * Math.cos(turn) + by * Math.sin(turn), cz = az * Math.cos(turn) + bz * Math.sin(turn);
      // The first lobe stands on what was hit, or in the middle of a blast in the air; the others lean out of it.
      const side = k === 0 ? 0 : 0.55 + 0.3 * out;
      const along = round ? (k === 0 ? 0 : 0.5 * (up - 0.5)) : k === 0 ? 0.55 : 0.35 + 0.5 * up;
      l[o] = (cx * side + nx * along) * ball;
      l[o + 1] = (cy * side + ny * along) * ball;
      l[o + 2] = (cz * side + nz * along) * ball;
      l[o + 3] = ball * (k === 0 ? 0.95 + 0.15 * size : 0.6 + 0.2 * size);
      l[o + 4] = k === 0 ? 0 : 0.03 + 0.07 * wait;
      // It is thrown out along the surface's way out, and rises.
      const thrown = (round ? 0.15 : 0.35 + 0.4 * up) * ball, drift = (k === 0 ? 0 : 0.35) * ball;
      l[o + 5] = cx * drift + nx * thrown;
      l[o + 6] = cy * drift + ny * thrown + rise * ball;
      l[o + 7] = cz * drift + nz * thrown;
      l[o + 8] = this.next();
      l[o + 9] = tone * (0.8 + 0.4 * this.next());
      l[o + 10] = surface === SURFACE_WATER ? 0.8 : 1;
    }
    if (!this.details) return;
    // What it throws up, within the tier's particles for a blast: its three single ones, then each part's share.
    const cap = (this.tier?.bursts.particles ?? 60) * recipe.share;
    const unit = Math.max(0, cap - 3) / PARTS_MOST;
    const shares = BY_SURFACE[surface] ?? BY_SURFACE[SURFACE_GROUND]!;
    const lift = 0.25 * scale;
    const px = x + nx * lift, py = y + ny * lift, pz = z + nz * lift;
    // A flash by the eye is no wider than the view: it is light, and a screen of it is enough.
    this.ask(FLASH, px, py, pz, nx, ny, nz, seed, far < ROCKET_REACH * scale ? Math.max(0.15, far / ROCKET_REACH) : scale, 1);
    const tint = surface === SURFACE_BUILT ? MADE_TINT[made] ?? MADE_TINT[0]! : surface === SURFACE_VEHICLE || surface === SURFACE_BODY ? SHARD_TINT : -1;
    // Each part has its share of the screen's fill, so a blast by the eye is still all of them: the scorch, which is
    // little; the ring of dust, which is the blast's reach and what a player must read; then the smoke and the soot.
    if (surface === SURFACE_GROUND) {
      let oldest = 0;
      for (let k = 1; k < SCORCHES; k++) if (this.scorched[k]! < this.scorched[oldest]!) oldest = k;
      if (nowMs - this.scorched[oldest]! > SCORCH_MS && this.ask(SCORCH, x, y + 0.05, z, 0, 1, 0, seed, scale, 1) > 0) this.scorched[oldest] = nowMs;
    }
    if (surface !== SURFACE_WATER) this.ask(DUST, px, py, pz, nx, ny, nz, seed, scale, this.part(DUST_MOST, 10, unit * shares[2]!), surface === SURFACE_BUILT ? tint : -1, 0.35);
    this.ask(SMOKE, px, py, pz, nx, ny, nz, seed, scale, this.part(SMOKE_MOST, 6, unit * shares[1]!), -1, 0.4);
    this.ask(SOOT, px, py, pz, nx, ny, nz, seed, scale, this.part(SOOT_MOST, 4, unit * shares[0]!), -1, 0.2);
    const sparks = this.part(SPARKS_MOST, 8, unit * shares[4]!);
    if (surface === SURFACE_WATER) {
      // A column of spray and a ring on the water; no dust and no scorch.
      this.ask(SPRAY, x, y + 0.1, z, 0, 1, 0, seed, scale, this.part(12, 8, unit), -1, 0.3);
      this.ask(DROPS, x, y + 0.05, z, 0, 1, 0, seed, 6 * scale, this.part(14, 10, unit));
      this.ask(RING, x, y + 0.03, z, 0, 1, 0, seed, 6.5 * scale, 2);
      this.ask(SPARKS, px, py, pz, nx, ny, nz, seed, scale, sparks);
      return;
    }
    this.ask(DEBRIS, px, py, pz, nx, ny, nz, seed, scale, this.part(DEBRIS_MOST, 8, unit * shares[3]!), tint);
    this.ask(SPARKS, px, py, pz, nx, ny, nz, seed, scale, sparks);
    if (surface === SURFACE_GROUND) this.ask(GLOW, x, y + 0.06, z, 0, 1, 0, seed, scale, 1);
  }

  /**
   * This frame's cards, before the details are written, so that room is kept for them (`count`): each rocket's smoke
   * along its path, its glow, and the glow that is all of a blast too far off for its fire.
   */
  cards(cam: Camera, nowMs: number): void {
    this.count = 0;
    this.nearest = Infinity;
    this.farthest = -Infinity;
    this.cardFill = 0;
    if (!this.on) return;
    const screen = 4 * Math.tan(cam.fovY / 2) ** 2 * cam.aspect;
    const pixel = (2 * Math.tan(cam.fovY / 2)) / this.viewHeight;
    const wx = LOW.wind[0] * WIND_SHARE, wz = LOW.wind[1] * WIND_SHARE;
    const full = this.full();
    let smoke = 0;
    for (let t = 0; t < MAX_TRAILS; t++) {
      const live = this.tLive[t]!;
      if (live === 0) continue;
      const now = (nowMs - this.tBorn[t]!) / 1000;
      const until = live === 2 ? (this.tEnd[t]! - this.tBorn[t]!) / 1000 : now;
      if (now - until > TRAIL_SECONDS) {
        this.tLive[t] = 0;
        continue;
      }
      const f = t * 3;
      const ox = this.tFrom[f]! - cam.x, oy = this.tFrom[f + 1]! - cam.y, oz = this.tFrom[f + 2]! - cam.z;
      const vx = this.tWay[f]!, vy = this.tWay[f + 1]!, vz = this.tWay[f + 2]!, fall = this.tFall[t]!;
      const speed = Math.hypot(vx, vy, vz);
      const seed = this.tSeed[t]!;
      // Its glow, a few pixels at least however far, and the hot gas just behind its flame.
      if (live === 1 && this.tSeen[t] === this.serial) {
        const a = this.tAt, o = t * 6;
        const x = a[o]! - cam.x, y = a[o + 1]! - cam.y, z = a[o + 2]! - cam.z;
        const d = Math.hypot(x, y, z);
        const ignite = Math.max(0, 1 - (nowMs - this.tBorn[t]!) / IGNITE_MS);
        if (d > 0.5) {
          const half = Math.max(0.45 * (1 + ignite), 3 * pixel * d);
          this.glow(cam, x, y, z, half, 0, 1, 0, half, 255, 190, 110, 3, 1, screen);
          const long = this.tFlame[t]! * (1.5 + ignite);
          this.glow(cam, x - a[o + 3]! * long * 0.5, y - a[o + 4]! * long * 0.5, z - a[o + 5]! * long * 0.5, 0.26 * (1 + ignite), -a[o + 3]!, -a[o + 4]!, -a[o + 5]!, long * 0.6, 255, 120, 40, 0.9, Math.min(1, d / 2), screen);
        }
      }
      // Fewer puffs seen down the path, as the one who fired sees it, and fewer far off.
      const head = Math.min(now, until);
      const hx = ox + vx * head, hy = oy + vy * head - 0.5 * fall * head * head, hz = oz + vz * head;
      const hd = Math.hypot(hx, hy, hz);
      const down = hd > 0 && speed > 0 ? Math.abs(hx * vx + hy * (vy - fall * head) + hz * vz) / (hd * speed) : 0;
      const least = Math.min(3, (down > 0.97 ? 2 : down > 0.85 ? 1 : 0) + (hd > 160 ? 2 : hd > 80 ? 1 : 0) + full);
      let written = 0;
      // From the newest puff back: every one within the first age, every other within the second, and so on.
      for (let next = Math.floor(until / TRAIL_STEP); next >= 0 && written < TRAIL_CARDS && smoke < MAX_TRAIL_CARDS; ) {
        const age = now - next * TRAIL_STEP;
        if (age >= TRAIL_SECONDS) break;
        const need = Math.max(age < LEVEL_AGES[0] ? 0 : age < LEVEL_AGES[1] ? 1 : age < LEVEL_AGES[2] ? 2 : 3, least);
        const step = 1 << need;
        if ((next & (step - 1)) !== 0) {
          next &= ~(step - 1);
          continue;
        }
        const j = next, then = j * TRAIL_STEP;
        next -= step;
        const level = j === 0 ? 3 : (j & 1) !== 0 ? 0 : (j & 2) !== 0 ? 1 : (j & 4) !== 0 ? 2 : 3;
        const lasts = LEVEL_AGES[level]!;
        // It comes out of the flame, thins as it ages, and goes as its level's time comes.
        let shows = 0.8 * Math.min(1, age / 0.04) * (1 - age / TRAIL_SECONDS) ** 1.3 * (level < 3 ? Math.min(1, (lasts - age) / (lasts * 0.35)) : 1);
        if (shows <= 0.01) continue;
        // Carried by the wind and rising a little, each puff a little off the line.
        const off = Math.sin(j * 2.4 + seed * 40) * 0.18 * Math.sqrt(age);
        const x = ox + vx * then + wx * age + off;
        const y = oy + vy * then - 0.5 * fall * then * then + 0.35 * age + Math.cos(j * 1.7 + seed * 23) * 0.12 * Math.sqrt(age);
        const z = oz + vz * then + wz * age - off;
        const d = Math.hypot(x, y, z);
        const wide = 0.3 + 1.2 * Math.sqrt(age);
        shows *= Math.min(1, Math.max(0, (d - 0.4 - wide) / 1.5));
        if (shows <= 0.01) continue;
        // Drawn out along the path as far as the next puff of its level, as the eye sees it.
        let tx = vx, ty = vy - fall * then, tz = vz;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const ex = x / d, ey = y / d, ez = z / d, dot = tx * ex + ty * ey + tz * ez;
        let ax = tx - ex * dot, ay = ty - ey * dot, az = tz - ez * dot;
        const seen = Math.hypot(ax, ay, az);
        if (seen < 1e-3) {
          ax = ey;
          ay = -ex;
          az = 0;
        }
        const al = Math.hypot(ax, ay, az) || 1;
        ax /= al;
        ay /= al;
        az /= al;
        const long = Math.max(wide, TRAIL_STEP * step * speed * 0.8 * seen);
        if (!cam.boxVisible(x - long, y - long, z - long, x + long, y + long, z + long)) continue;
        const n = this.card(cam, x, y, z, ax * long, ay * long, az * long, (ey * az - ez * ay) * wide, (ez * ax - ex * az) * wide, (ex * ay - ey * ax) * wide);
        if (n < 0) break;
        const grey = Math.round(165 + 50 * seed);
        this.heldWords[n + DETAIL.colourA] = word(grey, grey, grey - 4);
        // A thick puff, its outline its own by its place along the path.
        this.heldWords[n + DETAIL.colourB] = (j * 97 + t * 31) & 255;
        this.heldWords[n + DETAIL.misc] = ((DETAIL_SMOKE << 8) | (Math.round(shows * 255) << 16) | (255 << 24)) >>> 0;
        this.cardFill += Math.min(1, (4 * long * wide) / (Math.max(d, 0.5) ** 2 * screen)) * shows;
        written++;
        smoke++;
      }
    }
    // A blast too far off for its fire is one glow.
    for (let b = 0; b < MAX_BURSTS; b++) {
      if (this.bLive[b] === 0) continue;
      const x = this.bAt[b * 3]! - cam.x, y = this.bAt[b * 3 + 1]! - cam.y, z = this.bAt[b * 3 + 2]! - cam.z;
      const age = (nowMs - this.bBorn[b]!) / (1000 * this.bLife[b]!);
      if (Math.hypot(x, y, z) <= BURST_REACH || age >= 0.6 || age < 0) continue;
      const half = this.bBall[b]! * 1.6 * lobeSwell(age);
      this.glow(cam, x, y + this.bBall[b]! * 0.5, z, half, 0, 1, 0, half, 255, 170, 80, 3 * (1 - age / 0.6), 1, screen);
    }
  }

  /** How full the screen is of what is see-through, by the ledger the details keep: 0 with room, 1 near the tier's fill, 2 past it. */
  private full(): number {
    if (!this.details || !this.tier) return 0;
    const share = this.details.fill / this.tier.details.fill;
    return share > 1 ? 2 : share > 0.8 ? 1 : 0;
  }

  /** Room for one more card at (x, y, z) from the eye with those half axes: where its words begin, or -1. */
  private card(cam: Camera, x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    if (this.count >= MAX_CARDS) return -1;
    const k = this.count++, n = k * DETAIL_FLOATS, c = this.held;
    c[n] = x;
    c[n + 1] = y;
    c[n + 2] = z;
    c[n + DETAIL.along] = ax;
    c[n + DETAIL.along + 1] = ay;
    c[n + DETAIL.along + 2] = az;
    c[n + DETAIL.across] = bx;
    c[n + DETAIL.across + 1] = by;
    c[n + DETAIL.across + 2] = bz;
    // No floor to fade toward.
    c[n + DETAIL.floor] = -1e6;
    const d = Math.hypot(x, y, z);
    this.keys[k] = (0x7ffff - Math.min(0x7ffff, Math.floor(d * 64))) * MAX_CARDS + k;
    const depth = cam.depth(x, y, z), reach = Math.abs(cam.depth(ax, ay, az)) + Math.abs(cam.depth(bx, by, bz));
    if (depth - reach < this.nearest) this.nearest = depth - reach;
    if (depth + reach > this.farthest) this.farthest = depth + reach;
    return n;
  }

  /** A card of light with no surface: `half` across, and `wide` along the unit way (ax, ay, az) as the eye sees it, of a colour `bright` times as bright, `shows` of it. */
  private glow(cam: Camera, x: number, y: number, z: number, half: number, ax: number, ay: number, az: number, wide: number, r: number, g: number, b: number, bright: number, shows: number, screen: number): void {
    const d = Math.hypot(x, y, z);
    if (d < 0.3 || shows <= 0 || !cam.boxVisible(x - wide - half, y - wide - half, z - wide - half, x + wide + half, y + wide + half, z + wide + half)) return;
    const ex = x / d, ey = y / d, ez = z / d, dot = ax * ex + ay * ey + az * ez;
    // Square to the eye: its way less the part toward the eye, and across that.
    let px = ax - ex * dot, py = ay - ey * dot, pz = az - ez * dot;
    const seen = Math.hypot(px, py, pz);
    if (seen < 1e-3) {
      px = ey;
      py = -ex;
      pz = 0;
    }
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl;
    py /= pl;
    pz /= pl;
    const long = Math.max(half, wide * seen);
    const n = this.card(cam, x, y, z, px * long, py * long, pz * long, (ey * pz - ez * py) * half, (ez * px - ex * pz) * half, (ex * py - ey * px) * half);
    if (n < 0) return;
    this.heldWords[n + DETAIL.colourA] = this.heldWords[n + DETAIL.colourB] = word(r, g, b);
    this.heldWords[n + DETAIL.misc] = ((DETAIL_GLOW << 8) | (Math.round(Math.min(1, shows) * 255) << 16) | (Math.max(1, Math.min(255, Math.round(bright * GLOW_STEPS))) << 24)) >>> 0;
    this.cardFill += Math.min(1, (4 * long * half) / (Math.max(d, 0.5) ** 2 * screen)) * Math.min(1, shows);
  }

  /** Writes the frame's cards into `p` after what is there, far to near. */
  write(p: FramePacket): void {
    if (this.count === 0) return;
    sortU32(this.keys, this.count);
    for (let k = 0; k < this.count; k++) {
      const from = (this.keys[k]! % MAX_CARDS) * DETAIL_FLOATS, to = p.detailCount++ * DETAIL_FLOATS;
      for (let f = 0; f < DETAIL_FLOATS; f++) p.detailWords[to + f] = this.heldWords[from + f]!;
    }
  }

  /** The depth ranges the frame's cards are drawn in. */
  passes(cam: Camera): number {
    return cam.passesOf(this.nearest, this.farthest);
  }

  /** Queues what is alight into the frame. */
  draw(p: FramePacket, cam: Camera, nowMs: number): void {
    this.tier = p.tier;
    this.eyeX = cam.x;
    this.eyeY = cam.y;
    this.eyeZ = cam.z;
    this.flames = this.draws = this.lobes = this.fill = 0;
    const serial = this.serial++;
    const assets = this.assets, put = this.put;
    if (!assets || !put || !this.on) return this.expire(nowMs);
    const bytes = p.transient, ids = p.transientIds;
    const screen = 4 * Math.tan(cam.fovY / 2) ** 2 * cam.aspect;
    let fill = 0;
    // A screen near its fill of smoke and fire draws a blast with fewer lobes.
    const most = 3 - this.full();
    // Every flame in a draw for each depth range it is in: the near, the far, and both.
    for (let range = 1; this.cone >= 0 && range <= 3; range++) {
      const first = p.transientCount;
      let n = 0, nearest = Infinity, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let t = 0; t < MAX_TRAILS; t++) {
        if (this.tLive[t] !== 1 || this.tSeen[t] !== serial) continue;
        const a = this.tAt, o = t * 6, long = this.tFlame[t]!;
        const x = a[o]! - cam.x, y = a[o + 1]! - cam.y, z = a[o + 2]! - cam.z;
        const d = Math.hypot(x, y, z), reach = long * 2.2;
        if (d > FLAME_REACH || d < 0.6 || first + n >= ids.length) continue;
        if (!cam.boxVisible(x - reach, y - reach, z - reach, x + reach, y + reach, z + reach) || cam.passes(x - reach, y - reach, z - reach, x + reach, y + reach, z + reach) !== range) continue;
        const ignite = Math.max(0, 1 - (nowMs - this.tBorn[t]!) / IGNITE_MS);
        // It blows back along the way the round came.
        putFlame(bytes, first + n, x, y, z, -a[o + 3]!, -a[o + 4]!, -a[o + 5]!, long, 1, ignite, this.tSeed[t]!);
        ids[first + n] = 0;
        n++;
        if (d < nearest) nearest = d;
        x0 = Math.min(x0, x - reach);
        y0 = Math.min(y0, y - reach);
        z0 = Math.min(z0, z - reach);
        x1 = Math.max(x1, x + reach);
        y1 = Math.max(y1, y + reach);
        z1 = Math.max(z1, z + reach);
        fill += (long * long * 0.4) / (Math.max(d, 0.5) ** 2 * screen);
      }
      if (n === 0) continue;
      p.transientCount = first + n;
      const errors = assets.table.error[this.cone]!;
      const level = assets.choose(errors, Math.max(1, nearest), -1);
      assets.want(this.cone, level, nearest);
      put.effect[0] = FIRE_FLAME;
      put.effect[1] = flamePhase(nowMs);
      const before = p.drawCount;
      put.draw(this.cone, level, TRANSIENT_BUFFER, first, n, 0, 0, 0, DRAW_BLEND | DRAW_PLAIN | DRAW_FIRE, range);
      if (p.drawCount > before) {
        this.flames += n;
        this.draws++;
      }
    }
    // Each blast's lobes in a draw, the farthest first: three near, two farther, one far off, and one where the tier says.
    for (let b = 0; this.lobe >= 0 && b < MAX_BURSTS; b++) {
      if (this.bLive[b] === 0) continue;
      const seconds = (nowMs - this.bBorn[b]!) / 1000, life = this.bLife[b]!;
      if (seconds >= life || seconds < 0) continue;
      const cx = this.bAt[b * 3]! - cam.x, cy = this.bAt[b * 3 + 1]! - cam.y, cz = this.bAt[b * 3 + 2]! - cam.z;
      const far = Math.hypot(cx, cy, cz), ball = this.bBall[b]!, reach = ball * 3;
      if (far > BURST_REACH || !cam.boxVisible(cx - reach, cy - reach, cz - reach, cx + reach, cy + reach, cz + reach)) continue;
      const count = Math.min(this.bLobes[b]!, p.tier.bursts.lobes, most, far < LOBES_NEAR ? 3 : far < LOBES_MID ? 2 : 1);
      const first = p.transientCount;
      if (first + count > ids.length) continue;
      // Which lobe is farthest: a few, so put in order by hand.
      const l = this.bLobe, order = this.order, depth = this.depth;
      for (let k = 0; k < count; k++) {
        const o = (b * LOBES + k) * LOBE;
        const age = Math.min(1, Math.max(0, (seconds - l[o + 4]!) / (life - l[o + 4]!)));
        depth[k] = Math.hypot(cx + l[o]! + l[o + 5]! * age, cy + l[o + 1]! + l[o + 6]! * age, cz + l[o + 2]! + l[o + 7]! * age);
        order[k] = k;
      }
      for (let i = 1; i < count; i++) for (let j = i; j > 0 && depth[order[j]!]! > depth[order[j - 1]!]!; j--) {
        const swap = order[j]!;
        order[j] = order[j - 1]!;
        order[j - 1] = swap;
      }
      let n = 0, widest = 0;
      for (let i = 0; i < count; i++) {
        const k = order[i]!, o = (b * LOBES + k) * LOBE;
        const age = (seconds - l[o + 4]!) / (life - l[o + 4]!);
        if (age <= 0 || age >= 1) continue;
        const x = cx + l[o]! + l[o + 5]! * age, y = cy + l[o + 1]! + l[o + 6]! * age, z = cz + l[o + 2]! + l[o + 7]! * age;
        // One lobe standing for three is a little larger.
        const r = l[o + 3]! * lobeSwell(age) * (count === 1 && this.bLobes[b]! > 1 ? 1.2 : 1);
        // A blast in the viewer's face is not a screen of fire: a lobe goes as the eye comes into it.
        const fade = Math.min(1, Math.max(0, (depth[k]! - 1.15 * r) / (0.7 * r)));
        if (fade <= 0) continue;
        putLobe(bytes, first + n, x, y, z, r, age, l[o + 8]!, l[o + 9]!, fade, l[o + 10]!);
        ids[first + n] = 0;
        n++;
        if (r > widest) widest = r;
        fill += Math.min(1, (Math.PI * r * r) / (Math.max(depth[k]!, 0.5) ** 2 * screen)) * fade;
      }
      if (n === 0) continue;
      p.transientCount = first + n;
      const errors = assets.table.error[this.lobe]!;
      const near = Math.max(1, far - reach) / Math.max(widest, 0.1);
      const level = assets.choose(errors, near, -1);
      assets.want(this.lobe, level, near);
      put.effect[0] = FIRE_LOBE;
      put.effect[1] = 0;
      const before = p.drawCount;
      put.draw(this.lobe, level, TRANSIENT_BUFFER, first, n, 0, 0, 0, DRAW_BLEND | DRAW_PLAIN | DRAW_FIRE, cam.passes(cx - reach, cy - reach, cz - reach, cx + reach, cy + reach, cz + reach));
      if (p.drawCount > before) {
        this.lobes += n;
        this.draws++;
      }
    }
    put.effect[0] = put.effect[1] = 0;
    // The fire and the smoke fill pixels as the dust does: the ledger the details thin their bursts by holds them too.
    this.fill = fill + this.cardFill;
    p.detailFill += this.fill;
    if (this.details) this.details.fill += this.fill;
    this.expire(nowMs);
  }

  /** Lets go of the blasts whose fire is out. */
  private expire(nowMs: number): void {
    for (let b = 0; b < MAX_BURSTS; b++) if (this.bLive[b] === 1 && nowMs - this.bBorn[b]! >= this.bLife[b]! * 1000) this.bLive[b] = 0;
  }

  /** Blasts whose fire is alight, and rounds kept, flying or their smoke thinning. */
  get alight(): number {
    let n = 0;
    for (let b = 0; b < MAX_BURSTS; b++) n += this.bLive[b]!;
    return n;
  }

  get trails(): number {
    let n = 0;
    for (let t = 0; t < MAX_TRAILS; t++) if (this.tLive[t] !== 0) n++;
    return n;
  }
}
