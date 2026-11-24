// Small details: feathers knocked loose, dust thrown up, a splash. A species answers what its body does (occasions.ts)
// as its cue sheet says (shared/pack/details.ts), each answer a burst of particles from a place on its body, seeded by
// the body, the occasion and its tick, so every client that saw the occasion makes the same ones. They are pictures:
// nothing here is read by the simulation. planning/reference/round9-details-design.md is the design.

import { poseCreatureOn, type CreatureAnim } from "../../../shared/anim/creature.ts";
import { bodyDown, bodyUp } from "../../../shared/anim/moments.ts";
import { AnimState, CUE_DEAD, bodySeed } from "../../../shared/anim/pose.ts";
import { boneToModel, solve, type Solved } from "../../../shared/anim/skeleton.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { hashString } from "../../../shared/hash.ts";
import { OCCASIONS, type DetailEffect, type DetailEntry, type DetailPicture, type DetailSheet, type Occasion, type PackDetails } from "../../../shared/pack/details.ts";
import { Rng } from "../../../shared/rng.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { MODE_WALK } from "../../../shared/sim/character.ts";
import { sortU32 } from "../../../shared/sort.ts";
import { rayVehicle, vehiclePoint, vehicleRotation } from "../../../shared/sim/vehicle-frame.ts";
import type { VehicleDefinition } from "../../../shared/sim/vehicle.ts";
import { quatAxis, quatRotate } from "../../../shared/math/quat.ts";
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../../../shared/world/ray.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import type { Tier } from "../assets/tiers.ts";
import { Occasions, type DrawnGait, type Happening, type ShotEnd, type Viewer } from "../occasions.ts";
import { corpseDownAt, type Corpse } from "../ragdoll.ts";
import { LOW } from "../render/atmosphere.ts";
import type { Camera } from "../render/camera.ts";
import { DETAIL, DETAIL_FLOATS, DETAIL_GLOW, DETAIL_LIT, DETAIL_PUFF, DETAIL_SCORCH, DETAIL_SMOKE, DETAIL_WAKE, GLOW_STEPS, MAX_DETAILS, SMOKE_STEPS, type FramePacket } from "../render/packet.ts";
import type { RemoteSample } from "../session.ts";
import { BREAK_NEAR, BREAK_SHARE, breakEffects } from "./breaks.ts";
import { GROUND_WATER, dustColour, groundAt } from "./ground.ts";
import { Pool } from "./pool.ts";

/** A burst keeps its whole count within this many metres of the eye, and this many over the distance beyond. */
const NEAR = 10;
/** A burst with no body (`burst`) keeps its whole count this far: a blast is seen from farther than a feather. */
const BURST_NEAR = 30;
/** Metres over the ground within which a burst with no body still throws up the ground's dust. */
const GROUND_NEAR = 3;
/** Seconds under which a burst with no body is a flash, gone before it could fill a frame's budget. */
const FLASH_SECONDS = 0.25;
/** Seconds over which the fill a bodiless burst was made for stops being held against the next. */
const PROMISE_SECONDS = 1.5;
/**
 * The share of the tier's fill of the screen that bursts with no body may take in all: the rockets' smoke and the
 * fire's lobes have the rest (render/blasts.ts TRAIL_SHARE, LOBE_SHARE).
 */
export const BURST_SHARE = 0.5;
/** The share of its life a thick puff has had when it begins to tear, and how far it is torn by its end. */
/**
 * A burst's particles are each held against the screen's fill for what they cover at their largest and nearest. They
 * are not all so at once, and this is the share of that sum the frames measured show for a blast.
 */
const TOGETHER = 0.45;
const TEAR_FROM = 0.55;
const TEAR_MOST = 0.7;
/** The ground wind is the low clouds' turned down to this share, and it gusts by this share of itself. */
const WIND_SHARE = 0.1;
const GUST = 0.4;
/** Seconds a frame is stepped at most, so a stall does not throw particles through the ground. */
const LONGEST_STEP = 0.1;
/** The most bursts waiting for their moment, and the most made in a frame. A burst past those waits a frame, nearest made first. */
const MOST_WAITING = 512;
const MOST_BURSTS = 24;
/** A see-through particle within this many metres of the eye fades out, so one through the camera does not fill the screen. */
const EYE_FADE = 1;
/** A boat's wake and its spray: the sockets each comes from, and the speed it starts at. */
const WAKES = [{ occasion: "boat_wake", sockets: ["wake_left", "wake_right"], speed: .6 }, { occasion: "boat_spray", sockets: ["spray_left", "spray_right"], speed: 5 }] as const;

interface Answer {
  entry: DetailEntry;
  effect: DetailEffect;
  /** Seconds into the occasion at which it is made. */
  delay: number;
}

/** What a species answers, by occasion. */
interface Book {
  anim: CreatureAnim;
  answers: Partial<Record<Occasion, Answer[]>>;
  /** Its dyes where a body has none of its own, and its height and radius. */
  colour: number;
  height: number;
  radius: number;
  vehicle: VehicleDefinition | null;
}

const NO_ANSWERS: readonly Answer[] = [];

interface Waiting {
  h: Happening;
  answer: Answer;
  /** The tick it is made at, and its place among the answers, for its seed. */
  due: number;
  index: number;
  /** Sustained emitters already resolved their complete vehicle frame and supporting surface. */
  origin?: { x: number; y: number; z: number; floor: number };
  wash?: { speed: number; side: number; outside: number };
  /** A break's burst (breakBurst): its colour as a word, or -1 for its effect's own. */
  broke?: number;
}

export class Details {
  readonly pool: Pool;
  readonly occasions: Occasions;
  /** Particles left out this frame because the packet was full, and bursts thinned for the screen's fill. */
  dropped = 0;
  thinned = 0;
  /** The blended fill of the last frame written, in screens. */
  fill = 0;
  private readonly effects: readonly DetailEffect[];
  private readonly pictures: readonly DetailPicture[];
  private readonly books: (Book | null)[];
  /** The kinds that have a book, each species' sheet, and what each kind plays as it is drawn. */
  private readonly booked: readonly number[];
  private readonly sheets: readonly (DetailSheet | null)[];
  private readonly animOf: (kind: number) => CreatureAnim | null;
  private readonly drawnPose: ((id: number, kind: number, tick: number) => Solved | null) | null;
  private readonly reg: Registry;
  private readonly waiting: Waiting[] = [];
  private readonly palette: Uint8Array;
  private readonly st = new AnimState();
  private last = Number.NaN;
  private readonly at = [0, 0, 0];
  private readonly colour = [0, 0, 0];
  private readonly order = new Uint32Array(MAX_DETAILS);
  /** Per particle as written, 1 where its effect is one a page may leave out (`muted`). */
  private readonly tagged = new Uint8Array(MAX_DETAILS);
  /** The see-through particles as written, while they are put far to near: words, so that every bit is kept. */
  private readonly unsorted = new Uint32Array(MAX_DETAILS * DETAIL_FLOATS);
  private readonly index = new Map<number, number>();
  private readonly due: Waiting[] = [];
  /** The body last posed for a burst this frame, and the tick it was posed at. */
  private posed = -1;
  private posedAt = 0;
  private readonly birth: Float32Array;
  private readonly rotorKinds: Uint8Array;
  private readonly boatKinds: Uint8Array;
  private readonly emissions = new Map<number, { wash: number; smoke: number; seen: number; tick: number; x: number; z: number; speed: number; yaw: number; turn: number; travel: number }>();
  private emissionFrame = 0;
  private readonly rotation = new Float64Array(4);
  private readonly up = new Float64Array(3);
  private readonly emitter = new Float64Array(3);
  /** The frame of the machine giving off details (machinery). */
  private readonly machine = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  private readonly treeDust: number;
  private readonly nodeColours = new Uint8Array(6);
  /** The first of the break effects (breaks.ts), which follow the pack's, and how many of their particles are alive. */
  private readonly breakFirst: number;
  breaking = 0;
  /** 1 for each effect left undrawn while `muting`: a page's before and after of one feature's particles (passes.ts). */
  readonly muted: Uint8Array;
  muting = false;
  /** The last frame's eye, tier, ground and view, which a burst with no body is thinned by (`burst`). */
  private eyeX = 0;
  private eyeY = 0;
  private eyeZ = 0;
  private tier: Tier | null = null;
  private hf: Heightfield | null = null;
  private screen = 1;
  /** A burst's own random numbers, seeded by `burst`. */
  private seeded = 0;
  /** The blended fill of the details' own particles in the last frame written, without what `fill` is given besides. */
  private own = 0;
  /** The screen's fill the bodiless bursts of the last seconds were made for, falling away as they do. */
  private promised = 0;

  /** `animOf` gives what a species of a kind plays, or null for one not drawn on a rig of its own. */
  constructor(reg: Registry, details: PackDetails | undefined, palette: Uint8Array, animOf: (kind: number) => CreatureAnim | null, drawnGait: DrawnGait | null = null, drawnPose: ((id: number, kind: number, tick: number) => Solved | null) | null = null) {
    this.palette = palette;
    this.birth = reg.birthScale;
    this.boatKinds = Uint8Array.from(reg.vehicle, v => v?.movement === "boat" ? 1 : 0);
    this.rotorKinds = Uint8Array.from(reg.vehicle, v => v?.movement === "rotor" ? 1 : 0);
    // A pack made before an effect could glow says nothing of it.
    const effects = (details?.effects ?? []).map((e) => (e.appear === undefined ? { ...e, glow: e.glow ?? 0, opacity: e.opacity ?? 1, thick: e.thick ?? false, stain: e.stain ?? false, appear: 0.08 } : e));
    this.pictures = details?.pictures ?? [];
    this.treeDust = effects.findIndex(e => e.id.includes("dust") && e.colour !== "body" && e.pass === "blend");
    this.breakFirst = effects.length;
    this.effects = this.treeDust < 0 ? effects : effects.concat(breakEffects(this.pictures, effects[this.treeDust]!.pictures));
    this.muted = new Uint8Array(this.effects.length);
    this.pool = new Pool(MAX_DETAILS);
    this.reg = reg;
    this.animOf = animOf;
    this.drawnPose = drawnPose;
    const listens = new Uint16Array(reg.defs.length);
    const boatEffects = details?.sheets.find(s => s.owner === "core:boat");
    this.sheets = reg.defs.map((d, kind) => d?.type === "species"
      ? details?.sheets.find(s => s.owner === d.id) ?? (this.boatKinds[kind] ? boatEffects : null) ?? null : null);
    this.books = reg.defs.map((_, kind) => {
      const anim = this.sheets[kind] ? animOf(kind) : null;
      return anim ? this.bookOf(kind, anim) : null;
    });
    this.booked = this.books.flatMap((b, kind) => (b ? [kind] : []));
    for (const kind of this.booked) for (const o of Object.keys(this.sheets[kind]!.cues)) listens[kind]! |= 1 << OCCASIONS.indexOf(o as Occasion);
    this.occasions = new Occasions(
      this.books.map((b) => b?.anim ?? null),
      listens,
      (o) => 1 << OCCASIONS.indexOf(o),
      reg.birthScale,
      drawnGait,
    );
  }

  /** A witnessed tree fracture reuses authored dust and the ordinary global particle/fill/distance budgets. */
  nodeBreak(kind: number, id: number, x: number, y: number, z: number, tick: number, size: number): void {
    if (this.treeDust < 0 || this.waiting.length >= MOST_WAITING) return;
    const def = this.reg.defs[kind];
    if (def?.type !== "node" || def.material !== "wood") return;
    const effect = this.effects[this.treeDust]!;
    const h: Happening = { occasion: "struck", id, kind, tick, x, y, z, yaw: 0, size: Math.max(1.4, Math.min(2.4, size * 1.8)),
      anim: 0, cue: 0, grounded: true, colours: this.nodeColours, fromX: NaN, fromY: NaN, fromZ: NaN, foot: -1, corpse: null };
    this.waiting.push({ h, answer: { effect, delay: 0, entry: { effect: this.treeDust, from: "ground", at: "now", count: [14, 22] } },
      due: tick, index: id, origin: { x, y: y + .65, z, floor: y } });
  }

  /**
   * Dust thrown up from the ground at a place: a supply capsule's jets as it comes down on them, its touchdown, and
   * its going (render/passes/supply-drops.ts). The trees' authored dust, on the ordinary budgets; `size` scales the puffs
   * and `least` to `most` is how many.
   */
  groundDust(id: number, x: number, y: number, z: number, tick: number, size: number, least: number, most: number): void {
    if (this.treeDust < 0 || this.waiting.length >= MOST_WAITING) return;
    const effect = this.effects[this.treeDust]!;
    const h: Happening = { occasion: "struck", id, kind: 0, tick, x, y, z, yaw: 0, size, anim: 0, cue: 0, grounded: true, colours: this.nodeColours, fromX: NaN, fromY: NaN, fromZ: NaN, foot: -1, corpse: null };
    this.waiting.push({ h, answer: { effect, delay: 0, entry: { effect: this.treeDust, from: "ground", at: "now", count: [least, most] } }, due: tick, index: id, origin: { x, y: y + 0.25, z, floor: y } });
  }

  /**
   * One part of a break's burst (breaks.ts BREAK_) at a place: `count` particles as its tier has them, so the tier's share
   * is not taken again, in the colour word `rgb` or, for -1, the effect's own. `tick` seeds it and `due` is when it is made.
   * They land on `floor`, or on the ground for NaN.
   */
  breakBurst(part: number, id: number, x: number, y: number, z: number, floor: number, tick: number, due: number, size: number, count: number, rgb: number): void {
    if (this.treeDust < 0 || count <= 0 || this.waiting.length >= MOST_WAITING) return;
    const index = this.breakFirst + part, effect = this.effects[index]!;
    const h: Happening = { occasion: "struck", id, kind: 0, tick, x, y, z, yaw: 0, size, anim: 0, cue: 0, grounded: true, colours: this.nodeColours, fromX: NaN, fromY: NaN, fromZ: NaN, foot: -1, corpse: null };
    this.waiting.push({ h, answer: { effect, delay: 0, entry: { effect: index, from: "ground", at: "now", count: [count, count] } }, due, index: part, origin: { x, y, z, floor }, broke: rgb });
  }

  /** The effect "<owner>/<name>" as `burst` takes it, or -1 where the pack has none. */
  effectOf(id: string): number {
    return this.effects.findIndex((e) => e.id === id);
  }

  /** The next of a burst's random numbers, 0 to 1 (mulberry32, as shared/rng.ts has it). */
  private next(): number {
    let t = (this.seeded = (this.seeded + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * A burst of `effect` (`effectOf`) at a place, with no body and no occasion: a blast's smoke and dust, a launcher's
   * backblast (render/blasts.ts). (nx, ny, nz) is the unit way out of what it is on: its particles' up, and the axis of a
   * ring or a disc. `scale` sizes it: its particles, how far from the place they start, and how fast they go. `count` is
   * how many are asked for, -1 for the effect's own; the tier's share, the distance and the screen's fill thin them as
   * any burst's. `tint` is a colour word in place of the effect's own or the ground's, or -1, and `floor` the height
   * they land on, NaN for the ground. `most` is the most of the screen's fill it may take, in screens, so that one part
   * of a blast leaves room for the next. Every random number is from `seed`. Returns how many it made, and makes no object.
   */
  burst(effect: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, seed: number, scale: number, count = -1, tint = -1, floor = Number.NaN, most = Infinity): number {
    const e = this.effects[effect], tier = this.tier;
    if (!e || !tier) return 0;
    const d = Math.hypot(x - this.eyeX, y - this.eyeY, z - this.eyeZ);
    if (d > e.reach * tier.details.reach) return 0;
    this.seeded = (seed ^ Math.imul(effect + 1, 0x9e3779b1)) >>> 0;
    const colour = this.colour;
    if (tint >= 0) {
      colour[0] = tint & 255;
      colour[1] = (tint >>> 8) & 255;
      colour[2] = (tint >>> 16) & 255;
    } else if (e.colour === "ground") {
      // The ground's own dust is thrown up from the ground, and there is none well over it or on water.
      if (!this.hf) return 0;
      const ground = floor === floor ? floor : this.hf.heightAt(x, z);
      if (y - ground > GROUND_NEAR || !dustColour(this.hf, this.palette, groundAt(this.hf, x, ground, z), x, z, colour)) return 0;
      y = ground + 0.15;
    } else if (Array.isArray(e.colour)) {
      colour[0] = e.colour[0];
      colour[1] = e.colour[1];
      colour[2] = e.colour[2];
    } else colour[0] = colour[1] = colour[2] = 128;
    let n = count >= 0 ? count : e.count[0] + Math.floor(this.next() * (e.count[1] - e.count[0] + 1));
    // Fewer far off. Thick puffs are thinned less and are each larger there, so a far blast's smoke still marks where it struck.
    const near = Math.min(1, BURST_NEAR / Math.max(d, 0.01));
    n = n * tier.details.share * (e.thick ? Math.sqrt(near) : near);
    n = n > 0 ? Math.max(1, Math.round(n)) : 0;
    const sized = e.thick ? scale * (1.35 - 0.35 * near) : scale;
    // A flash is gone in a few frames, and is not held against the screen's fill. The rest is, each particle for what
    // it will cover where it goes: against what is seen now and what the bursts just made will grow to, whichever is more.
    const held = e.pass === "blend" && e.life[1] >= FLASH_SECONDS;
    let room = held ? Math.min(most, BURST_SHARE * tier.details.fill - Math.max(this.own, this.promised)) : Infinity;
    const half = Math.min(most, 0.5 * BURST_SHARE * tier.details.fill);
    // What one covers at a metre when it covers most: its size as its fade begins.
    const big = e.size[1] * (1 + (e.grow - 1) * ease(1 - e.fade / e.life[1])) * sized;
    // A low wave of the ground's dust is half under the ground it rolls over.
    const area = ((e.thick && e.colour === "ground" && tint < 0 && e.up < 0.2 ? 0.5 : 1) * TOGETHER * big * big * e.aspect * e.opacity) / this.screen;
    const lies = e.face === "flat" || e.settle > 0;
    // Seconds it goes before the air has stopped it.
    const goes = Math.min(e.life[1], 1 / Math.max(e.drag, 0.25));
    // Two ways across the way out.
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
    const pool = this.pool;
    let made = 0, spent = 0;
    for (let k = 0; k < n; k++) {
      // Where it starts, and the way across it goes; the rest of its speed is along the way out.
      let sx = 0, sy = 0, sz = 0, c: number, w: number;
      if (e.shape === "ring" || e.shape === "disc") {
        const turn = ((k + this.next() * 0.6) / n) * Math.PI * 2;
        const r = e.radius * scale * (e.shape === "disc" ? Math.sqrt(this.next()) : 0.85 + this.next() * 0.3);
        c = Math.cos(turn);
        w = Math.sin(turn);
        sx = (ax * c + bx * w) * r;
        sy = (ay * c + by * w) * r;
        sz = (az * c + bz * w) * r;
      } else {
        const u = this.next() * 2 - 1, a = this.next() * Math.PI * 2, ring = Math.sqrt(1 - u * u);
        c = Math.cos(a);
        w = Math.sin(a);
        if (e.shape === "sphere") {
          const r = e.radius * scale * Math.cbrt(this.next());
          sx = (ax * c * ring + nx * Math.abs(u) + bx * w * ring) * r;
          sy = (ay * c * ring + ny * Math.abs(u) + by * w * ring) * r;
          sz = (az * c * ring + nz * Math.abs(u) + bz * w * ring) * r;
        }
      }
      const speed = (e.speed[0] + this.next() * (e.speed[1] - e.speed[0])) * scale, across = (1 - e.up) * speed, out = e.up * speed;
      const vx = (ax * c + bx * w) * across + nx * out, vy = (ay * c + by * w) * across + ny * out, vz = (az * c + bz * w) * across + nz * out;
      // Every number of it is drawn whether it is made or not, so one left out changes none of the others.
      const ends = e.life[0] + this.next() * (e.life[1] - e.life[0]);
      const size = (e.size[0] + this.next() * (e.size[1] - e.size[0])) * sized;
      const heading = this.next() * Math.PI * 2, pitch = (this.next() - 0.5) * 0.8, phase = this.next() * Math.PI * 2, swayTo = this.next() * Math.PI * 2;
      const picture = this.pictures[e.pictures[Math.floor(this.next() * e.pictures.length)]!]!;
      const shade = 1 + e.vary * (this.next() * 2 - 1);
      const puff = Math.floor(this.next() * 256);
      let share = 0;
      if (held) {
        // The nearest it comes to the eye: where it starts, midway, or where it stops.
        const fx = x + sx - this.eyeX, fy = y + sy - this.eyeY, fz = z + sz - this.eyeZ;
        const near = Math.max(1, Math.min(Math.hypot(fx, fy, fz), Math.hypot(fx + vx * goes * 0.5, fy + vy * goes * 0.5, fz + vz * goes * 0.5), Math.hypot(fx + vx * goes, fy + vy * goes, fz + vz * goes)));
        // What lies flat is seen as thin as the eye is low over it, and no card covers more than the screen.
        share = Math.min(1, (area * (lies ? Math.max(0.1, Math.abs(fy) / near) : 1)) / (near * near));
        // What fits, and one at the least while half the screen's fill is free; a screen already full takes none.
        if (share > room && (made > 0 || room < half)) {
          this.thinned++;
          continue;
        }
      }
      const i = pool.count < tier.details.pool ? pool.take() : -1;
      if (i < 0) break;
      made++;
      room -= share;
      spent += share;
      pool.x[i] = x + sx;
      pool.y[i] = y + sy;
      pool.z[i] = z + sz;
      pool.vx[i] = vx;
      pool.vy[i] = vy;
      pool.vz[i] = vz;
      pool.age[i] = 0;
      pool.end[i] = ends;
      pool.landed[i] = -1;
      pool.plane[i] = floor;
      pool.size[i] = size;
      pool.heading[i] = heading;
      pool.pitch[i] = pitch;
      pool.phase[i] = phase;
      pool.swayTo[i] = swayTo;
      pool.widthScale[i] = 1;
      pool.effect[i] = effect;
      this.looks(i, e, picture);
      pool.colourA[i] = pool.colourB[i] = (shaded(colour[0]!, shade) | (shaded(colour[1]!, shade) << 8) | (shaded(colour[2]!, shade) << 16) | (255 << 24)) >>> 0;
      // A thick puff's second colour is its seed, and a stain's.
      if (e.thick || e.stain) pool.colourB[i] = puff;
    }
    this.fill += spent;
    this.promised += spent;
    return made;
  }

  /** Gives particle `i` of effect `e` its picture's cell, shape and grey, or what light with no surface has in their place. */
  private looks(i: number, e: DetailEffect, picture: DetailPicture): void {
    const pool = this.pool;
    pool.cell[i] = picture.cell;
    pool.flags[i] = e.glow > 0 ? DETAIL_GLOW : e.thick ? DETAIL_SMOKE : e.stain ? DETAIL_SCORCH : picture.flat | (e.lit ? DETAIL_LIT : 0) | (e.face === "camera" ? DETAIL_PUFF : 0);
    pool.grey[i] = e.thick ? SMOKE_STEPS : e.stain ? 255 : Math.max(1, Math.min(255, Math.round(e.glow > 0 ? e.glow * GLOW_STEPS : picture.grey * 255)));
  }

  /** What a species of `kind` answers, as it plays `anim`. */
  private bookOf(kind: number, anim: CreatureAnim): Book {
    const sheet = this.sheets[kind]!;
    const d = this.reg.defs[kind]!;
    const moments: Partial<Record<Occasion, number>> = { down: bodyDown(anim.rig, anim.torporIn ?? anim.death), death: bodyDown(anim.rig, anim.death), up: bodyUp(anim.rig, anim.torporOut) };
    const answers: Book["answers"] = {};
    for (const o of Object.keys(sheet.cues) as Occasion[]) answers[o] = sheet.cues[o]!.effects.map((entry) => ({ entry, effect: this.effects[entry.effect]!, delay: entry.at === "down" ? (moments[o] ?? 0) : entry.at === "now" ? 0 : entry.at }));
    return { anim, answers, colour: d.type === "species" ? d.color : 0, height: this.reg.bodyHeight[kind]!, radius: this.reg.bodyRadius[kind]!, vehicle: this.reg.vehicle[kind] ?? null };
  }

  /**
   * Reads what bodies did, makes the bursts whose moment has come, moves every particle on to the tick of `remote`, and
   * writes those in view into `p`. Returns the first particle of the blended ones; those before it are cut out.
   */
  frame(p: FramePacket, cam: Camera, remote: RemoteSample | null, corpses: readonly Corpse[], shots: readonly ShotEnd[], viewer: Viewer | null, hf: Heightfield, tier: Tier, nowMs: number, world?: CollisionWorld, reserve = 0): number {
    const tick = remote ? remote.tick : nowMs * (TICK_RATE / 1000);
    const dt = this.last === this.last ? Math.min(LONGEST_STEP, Math.max(0, (tick - this.last) / TICK_RATE)) : 0;
    this.last = tick;
    this.promised *= Math.exp(-dt / PROMISE_SECONDS);
    this.eyeX = cam.x;
    this.eyeY = cam.y;
    this.eyeZ = cam.z;
    this.tier = tier;
    this.hf = hf;
    this.screen = 4 * Math.tan(cam.fovY / 2) ** 2 * cam.aspect;
    if (this.effects.length === 0) return 0;
    // A species whose clips have come, on a rig made anew with them, plays them from now, and its moments are read from them.
    for (const kind of this.booked) {
      const anim = this.animOf(kind);
      if (!anim || anim.rig === this.books[kind]!.anim.rig) continue;
      this.books[kind] = this.bookOf(kind, anim);
      this.occasions.renew(kind, anim);
    }
    const ex = cam.x;
    const ey = cam.y;
    const ez = cam.z;
    if (remote) {
      this.occasions.update(remote, corpses, shots, viewer, ex, ey, ez, nowMs, world);
      this.sustained(remote, hf, world, cam);
      for (const h of this.occasions.happened) {
        const book = this.books[h.kind];
        book?.answers[h.occasion]?.forEach((answer, k) => {
          if (this.waiting.length < MOST_WAITING) this.waiting.push({ h, answer, due: h.tick + answer.delay * TICK_RATE, index: k });
        });
      }
      // Kept from frame to frame, as clearing it would make it grow again each frame; a stale place is checked where it is read.
      if (this.index.size > 2 * MAX_VIEW) this.index.clear();
      for (let i = 0; i < remote.count; i++) this.index.set(remote.id[i]!, i);
    }
    const seconds = tick / TICK_RATE;
    const gust = 1 + GUST * Math.sin(seconds * 0.7) * Math.sin(seconds * 0.23 + 1);
    const wx = LOW.wind[0] * WIND_SHARE * gust;
    const wz = LOW.wind[1] * WIND_SHARE * gust;
    const full = this.pool.count / Math.max(1, tier.details.pool);
    this.pool.step(dt, this.effects, hf, wx, wz, Math.max(0, 1 - full * full));
    let breaking = 0;
    for (let i = 0, effect = this.pool.effect, first = this.breakFirst; i < this.pool.count; i++) if (effect[i]! >= first) breaking++;
    this.breaking = breaking;
    // The bursts whose moment has come, nearest first, as many as a frame makes; the rest wait a frame.
    const due = this.due;
    due.length = 0;
    let kept = 0;
    for (const w of this.waiting) {
      if (w.h.occasion === "death" && w.h.corpse && w.answer.entry.at === "down") {
        if (!corpses.includes(w.h.corpse)) continue;
        w.due = corpseDownAt(w.h.corpse, w.answer.delay);
        const point = w.h.corpse.impact;
        if (tick >= w.due && point && Number.isFinite(point[0]) && w.answer.entry.from === "ground") {
          w.origin = { x: point[0]!, y: point[1]!, z: point[2]!, floor: point[1]! };
        }
      }
      if (w.due > tick) this.waiting[kept++] = w;
      else due.push(w);
    }
    this.waiting.length = kept;
    if (due.length > MOST_BURSTS) {
      const far = (w: Waiting): number => (w.h.x - ex) ** 2 + (w.h.z - ez) ** 2;
      due.sort((a, b) => far(a) - far(b));
      for (const w of due.splice(MOST_BURSTS)) this.waiting.push(w);
    }
    let fill = this.fill;
    this.posed = -1;
    for (const w of due) fill += this.answer(w, remote, hf, tier, cam, tick, fill, world);
    return this.write(p, cam, hf, reserve);
  }

  /** Continuous machinery uses the same art cues and bounded burst/particle/fill budgets as creature details. */
  private sustained(r: RemoteSample, hf: Heightfield, world: CollisionWorld | undefined, cam: Camera): void {
    const frameNumber = ++this.emissionFrame;
    for (let i = 0; i < r.count; i++) {
      const kind = r.kind[i]!, book = this.books[kind];
      if ((!this.rotorKinds[kind] && !this.boatKinds[kind]) || !book || (r.cue[i]! & CUE_DEAD) !== 0 || Math.hypot(r.x[i]! - cam.x, r.y[i]! - cam.y, r.z[i]! - cam.z) > 90) continue;
      this.machinery(r, i, book, hf, world, frameNumber);
    }
    for (const key of this.emissions.keys()) if (this.emissions.get(key)!.seen !== frameNumber) this.emissions.delete(key);
  }

  /** What the boat or aircraft `i` gives off this frame. */
  private machinery(r: RemoteSample, i: number, book: Book, hf: Heightfield, world: CollisionWorld | undefined, frameNumber: number): void {
    const kind = r.kind[i]!;
    const key = r.id[i]! + r.gen[i]! * 1048576;
    let seen = this.emissions.get(key);
    if (!seen) this.emissions.set(key, seen = { wash: -1, smoke: -1, seen: frameNumber, tick: r.tick, x: r.x[i]!, z: r.z[i]!, speed: 0, yaw: r.yaw[i]!, turn: 0, travel: 0 });
    seen.seen = frameNumber;
    if (r.tick > seen.tick) {
      const elapsed = (r.tick - seen.tick) / TICK_RATE;
      const moved = Math.hypot(r.x[i]! - seen.x, r.z[i]! - seen.z);
      seen.speed = elapsed < .5 ? moved / elapsed : 0;
      const yaw = r.yaw[i]!, angle = yaw - seen.yaw;
      if (elapsed < .5 && seen.speed < 60) {
        const rate = Math.atan2(Math.sin(angle), Math.cos(angle)) / elapsed;
        seen.turn += (rate - seen.turn) * Math.min(1, elapsed * 6);
        seen.travel = Math.min(3, seen.travel + moved);
      } else { seen.turn = 0; seen.travel = 0; }
      seen.yaw = yaw;
      seen.tick = r.tick; seen.x = r.x[i]!; seen.z = r.z[i]!;
    }
    const frame = this.machine;
    frame.x = r.x[i]!; frame.y = r.y[i]!; frame.z = r.z[i]!; frame.yaw = r.yaw[i]!; frame.pitch = r.vehiclePitch[i]!; frame.roll = r.vehicleRoll[i]!;
    frame.qx = r.vehicleQx[i]!; frame.qy = r.vehicleQy[i]!; frame.qz = r.vehicleQz[i]!; frame.qw = r.vehicleQw[i]!;
    if (this.boatKinds[kind]) {
      const beat = Math.floor(r.tick / (TICK_RATE / 8));
      vehicleRotation(frame, this.rotation); quatRotate(this.rotation, 0, 0, 1, 0, this.up, 0);
      const water = hf.waterAt(frame.x, frame.z), draft = water - frame.y;
      if (beat !== seen.wash && seen.travel >= .75 && seen.speed > .6 && seen.speed < 60 && this.up[1]! > .5 && draft > -.08 && draft < (book.vehicle?.movement === "boat" ? book.vehicle.spec.draft + .6 : .95) && water > hf.heightAt(frame.x, frame.z) + .15) {
        seen.wash = beat; seen.travel = 0;
        for (const wake of WAKES) {
          if (seen.speed < wake.speed) continue;
          for (const socket of wake.sockets) if (this.socketAt(r, i, book, socket)) {
            const x = this.emitter[0]!, z = this.emitter[2]!, surface = hf.waterAt(x, z);
            if (Number.isFinite(surface) && Math.abs(surface - water) < .05 && surface > hf.heightAt(x, z) + .1 && Math.abs(this.emitter[1]! - surface) < .9) {
              const side = Math.sign((x - frame.x) * Math.cos(frame.yaw) - (z - frame.z) * Math.sin(frame.yaw));
              const outside = Math.max(-1, Math.min(1, -side * seen.speed * seen.turn / 5));
              this.emit(r, i, book, wake.occasion, x, surface + .025, z, surface, socket, { speed: seen.speed, side, outside });
            }
          }
        }
      }
      const smoke = Math.floor(r.tick / (TICK_RATE / 3));
      if (r.vehicleEngineOn[i] && r.vehicleEngineCondition[i]! < .65 && smoke !== seen.smoke) {
        seen.smoke = smoke;
        for (const answer of book.answers.engine_smoke ?? NO_ANSWERS) if (this.socketAt(r, i, book, answer.entry.from)) {
          if (this.emitter[1]! > hf.waterAt(this.emitter[0]!, this.emitter[2]!)) this.emit(r, i, book, "engine_smoke", this.emitter[0]!, this.emitter[1]!, this.emitter[2]!, NaN, answer.entry.from);
        }
      }
      return;
    }
    const wash = Math.floor(r.tick / (TICK_RATE / 4));
    if (r.vehicleRotorRpm[i]! > 220 && wash !== seen.wash) {
      seen.wash = wash;
      const anchor = book.anim.rig.sockets.get("rotor_main");
      if (anchor) {
        vehicleRotation(frame, this.rotation); quatRotate(this.rotation, 0, 0, 1, 0, this.up, 0);
        this.emitter[0] = anchor.x; this.emitter[1] = anchor.y; this.emitter[2] = anchor.z;
        vehiclePoint(frame, this.emitter, this.emitter);
        if (this.up[1]! > .45) {
          const x = this.emitter[0]!, y = this.emitter[1]!, z = this.emitter[2]!;
          let distance = world ? Infinity : (y - hf.heightAt(x, z)) / this.up[1]!;
          if (world && castWorld(world, x, y, z, -this.up[0]!, -this.up[1]!, -this.up[2]!, 7.2) !== HIT_NONE) distance = rayHit.t;
          // Water is a surface for spray, even though the solid-world ray deliberately passes through it.
          distance = Math.min(distance, (y - hf.waterAt(x, z)) / this.up[1]!);
          if (distance >= 0 && distance <= 7.2) {
            const gx = x - this.up[0]! * distance, gy = y - this.up[1]! * distance, gz = z - this.up[2]! * distance;
            this.emit(r, i, book, "rotor_wash", gx, gy + .04, gz, gy);
          }
        }
      }
    }
    const smoke = Math.floor(r.tick / (TICK_RATE / 3));
    if (r.vehicleEngineCondition[i]! < .65 && r.vehicleRotorRpm[i]! > 30 && smoke !== seen.smoke) {
      seen.smoke = smoke;
      const anchor = book.anim.rig.sockets.get("exhaust");
      if (anchor) {
        this.emitter[0] = anchor.x; this.emitter[1] = anchor.y; this.emitter[2] = anchor.z;
        vehiclePoint(frame, this.emitter, this.emitter);
        this.emit(r, i, book, "engine_smoke", this.emitter[0]!, this.emitter[1]!, this.emitter[2]!, NaN);
      }
    }
  }

  /** Queues the answers of the machine `i` (machinery) to `occasion` at a place, those from `socket` alone where it is given. */
  private emit(r: RemoteSample, i: number, book: Book, occasion: "rotor_wash" | "engine_smoke" | "boat_wake" | "boat_spray", x: number, y: number, z: number, floor: number, socket?: string, wash?: Waiting["wash"]): void {
    const answers = book.answers[occasion];
    if (!answers) return;
    const frame = this.machine;
    const h: Happening = { occasion, id: r.id[i]!, kind: r.kind[i]!, tick: r.tick, x: frame.x, y: frame.y, z: frame.z, yaw: frame.yaw, size: 1, anim: r.anim[i]!, cue: r.cue[i]!, grounded: Number.isFinite(floor), colours: r.colors.slice(i * 6, i * 6 + 6), fromX: NaN, fromY: NaN, fromZ: NaN, foot: -1, corpse: null };
    for (let index = 0; index < answers.length; index++) {
      const answer = answers[index]!;
      if (socket && answer.entry.from !== socket) continue;
      if (this.waiting.length < MOST_WAITING) this.waiting.push({ h, answer, due: r.tick, index, wash, origin: { x, y, z, floor } });
    }
  }

  /** Puts in `emitter` where the machine `i`'s socket `name` is, posed as it is drawn; false if its rig has none. A socket may live on the steering outboard. */
  private socketAt(r: RemoteSample, i: number, book: Book, name: string): boolean {
    const rig = book.anim.rig, anchor = rig.sockets.get(name); if (!anchor) return false;
    rig.a.rest();
    if (book.vehicle?.movement === "boat" && book.vehicle.outboard) {
      const motor = book.vehicle.outboard, bone = rig.names.indexOf(motor.bone);
      if (bone >= 0) quatAxis(rig.a.rot, bone * 4, motor.axis[0], motor.axis[1], motor.axis[2], r.steering[i]! * motor.ratio);
    }
    solve(rig, rig.a, rig.solved); boneToModel(rig.solved, anchor.bone, anchor.x, anchor.y, anchor.z, this.emitter);
    vehiclePoint(this.machine, this.emitter, this.emitter); return true;
  }

  /** Makes one burst. Returns the share of the screen it is expected to cover, if it is see-through. */
  private answer(w: Waiting, remote: RemoteSample | null, hf: Heightfield, tier: Tier, cam: Camera, tick: number, fill: number, collision?: CollisionWorld): number {
    const { h, answer } = w;
    const e = answer.effect;
    const book = this.books[h.kind]!;
    const rng = new Rng(hashString(`${h.occasion}:${Math.floor(h.tick)}:${w.index}`, h.id * 2654435761));
    const at = this.at;
    let size = h.size;
    // Where the body is as it is drawn now, posed at the moment.
    let x = h.x;
    let y = h.y;
    let z = h.z;
    let yaw = h.yaw, steering = 0;
    const from = answer.entry.from;
    let ox = 0, oy = 0, oz = 0;
    if (w.origin) { at[0] = w.origin.x; at[1] = w.origin.y; at[2] = w.origin.z; }
    else {
    let solved: Solved | null = null;
    let rotated = false;
    let fitted = false;
    const rig = book.anim.rig;
    if (h.corpse) {
      const c = h.corpse;
      solved = c.solved;
      x = c.x;
      y = c.y;
      z = c.z;
      if (c.rigid) {
        vehicleRotation({ ...c, pitch: 0, roll: 0 }, this.rotation);
        rotated = true;
      }
    }
    else {
      const at = remote ? this.index.get(h.id) : undefined;
      const i = at !== undefined && at < remote!.count && remote!.id[at] === h.id ? at : undefined;
      const st = this.st;
      if (i !== undefined) {
        const r = remote!;
        x = r.x[i]!;
        y = r.y[i]!;
        z = r.z[i]!;
        yaw = r.yaw[i]!; steering = r.steering[i]!;
        if (this.reg.vehicle[h.kind]) {
          vehicleRotation({ x, y, z, yaw, pitch: 0, roll: 0, qx: r.vehicleQx[i]!, qy: r.vehicleQy[i]!, qz: r.vehicleQz[i]!, qw: r.vehicleQw[i]! }, this.rotation);
          rotated = true;
        }
        st.unpack(r.anim[i]!, r.cue[i]!, r.emote[i]!, r.react[i]!, r.stride[i]!);
        if (r.grown[i] !== 0) size = youngScale(this.birth[h.kind]!, r.span[i]!, r.grown[i]!, r.tick);
      } else st.unpack(h.anim, h.cue);
      st.seed = bodySeed(h.id);
      fitted = !!rig.ground && !!collision && st.mode === MODE_WALK && st.grounded && !st.out && !st.dead && !st.held;
      // The answers of one occasion at one moment share a pose.
      solved = i !== undefined ? this.drawnPose?.(h.id, h.kind, remote!.tick) ?? null : null;
      if (!solved) {
        if (this.posed !== h.id || this.posedAt !== w.due) {
          poseCreatureOn(book.anim, st, w.due, collision, x, y, z, yaw, size);
          this.posed = h.id;
          this.posedAt = w.due;
        }
        solved = rig.solved;
      }
    }
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const world = (mx: number, my: number, mz: number): void => {
      if (rotated) {
        quatRotate(this.rotation, 0, mx * size, my * size, mz * size, at, 0);
        at[0] += x; at[1] += y; at[2] += z;
        return;
      }
      at[0] = x + (c * mx + s * mz) * size;
      at[1] = y + my * size;
      at[2] = z + (c * mz - s * mx) * size;
    };
    if (from === "body" || from === "ground") world(solved.pos[0]!, solved.pos[1]!, solved.pos[2]!);
    else if (from === "hit") {
      world(solved.pos[0]!, book.height * 0.55, solved.pos[2]!);
      const cx = at[0]!, cz = at[2]!;
      if (rotated && book.vehicle) {
        // The impact surface follows the cabin in three dimensions, including an inverted aircraft.
        let sx = h.fromX, sy = h.fromY - .6, sz = h.fromZ;
        if (!Number.isFinite(sx)) {
          const a = rng.float() * Math.PI * 2, dy = rng.float() * 2 - 1, r = Math.sqrt(1 - dy * dy);
          sx = cx + Math.cos(a) * r * 10;
          sy = at[1]! + dy * 10;
          sz = cz + Math.sin(a) * r * 10;
        }
        const dx = cx - sx, dy = at[1]! - sy, dz = cz - sz, len = Math.hypot(dx, dy, dz) || 1;
        ox = dx / len;
        oy = dy / len;
        oz = dz / len;
        const t = rayVehicle(book.vehicle, x, y, z, yaw, sx, sy, sz, ox, oy, oz, book.height, { pitch: 0, roll: 0, steering, qx: this.rotation[0]!, qy: this.rotation[1]!, qz: this.rotation[2]!, qw: this.rotation[3]! });
        if (Number.isFinite(t)) { at[0] = sx + ox * t; at[1] = sy + oy * t; at[2] = sz + oz * t; }
      } else if (h.fromX === h.fromX) {
        // The side of the body that faces whoever struck it, and away from them.
        const dx = h.fromX - cx, dz = h.fromZ - cz;
        const l = Math.hypot(dx, dz) || 1;
        const r = book.radius * size;
        at[0] = cx + (dx / l) * r;
        at[1] = Math.min(y + book.height * size, Math.max(y + 0.1, h.fromY - 0.6));
        at[2] = cz + (dz / l) * r;
        ox = -dx / l;
        oy = 0;
        oz = -dz / l;
      } else {
        const a = rng.float() * Math.PI * 2;
        ox = Math.cos(a);
        oz = Math.sin(a);
        at[0] = cx + ox * book.radius * size;
        at[2] = cz + oz * book.radius * size;
      }
    } else if (from === "foot") {
      if (h.foot < 0) return 0;
      world(solved.pos[h.foot * 3]!, solved.pos[h.foot * 3 + 1]!, solved.pos[h.foot * 3 + 2]!);
      if (fitted) for (const leg of rig.ground!.legs) if (leg.end === h.foot || leg.foot.bone === h.foot) {
        boneToModel(solved, leg.foot.bone, leg.foot.x, leg.foot.y, leg.foot.z, at);
        world(at[0]!, at[1]!, at[2]!);
        break;
      }
    } else {
      const socket = rig.sockets.get(from);
      if (!socket) return 0;
      boneToModel(solved, socket.bone, socket.x, socket.y, socket.z, at);
      world(at[0]!, at[1]!, at[2]!);
    }
    if (from === "ground" || from === "foot") {
      if (fitted) {
        const top = (from === "foot" ? at[1]! : y) + .04 * size;
        // Dust follows the real supporting face; an unsupported foot throws no dust from a lower ledge.
        if (castWorld(collision!, at[0]!, top, at[2]!, 0, -1, 0, (rig.ground!.maxStep + .04) * size) === HIT_NONE || rayHit.ny < .65) return 0;
        at[1] = top - rayHit.t;
      } else at[1] = y;
    }
    }
    // A floating hull's origin is its submerged keel. Surface splashes belong on the visible water, not below it.
    const surface = hf.waterAt(at[0]!, at[2]!);
    const marineWater = this.boatKinds[h.kind] && from === "ground" && Number.isFinite(surface) && surface > hf.heightAt(at[0]!, at[2]!) + .1 && Math.abs(y - surface) < 1.2;
    if (marineWater) at[1] = surface + .025;
    const px = at[0]!, py = at[1]!, pz = at[2]!;
    const d = Math.hypot(px - cam.x, py - cam.y, pz - cam.z);
    if (d > e.reach * tier.details.reach) return 0;
    // What the ground is, for the dust's colour and whether there is any.
    const wet = marineWater || w.origin && Number.isFinite(w.origin.floor) && w.origin.floor <= hf.waterAt(px, pz) + .08 && hf.waterAt(px, pz) > hf.heightAt(px, pz) + .1;
    const kind = wet ? GROUND_WATER : groundAt(hf, px, w.origin?.floor ?? y, pz);
    if (answer.entry.on && !answer.entry.on.includes(kind)) return 0;
    const colour = this.colour;
    const broke = w.broke !== undefined, tinted = broke && w.broke! >= 0;
    if (tinted) { colour[0] = w.broke! & 255; colour[1] = (w.broke! >>> 8) & 255; colour[2] = (w.broke! >>> 16) & 255; }
    else if (e.colour === "ground" && !dustColour(hf, this.palette, kind, px, pz, colour)) return 0;
    const [least, most] = answer.entry.count ?? e.count;
    let n = least + Math.floor(rng.float() * (most - least + 1));
    n = broke ? n * Math.min(1, BREAK_NEAR / Math.max(d, 0.01)) : n * tier.details.share * Math.min(1, NEAR / Math.max(d, 0.01));
    n = n > 0 ? Math.max(1, Math.round(n)) : 0;
    // Breaks hold their share of the pool and no more, so a falling street leaves room for everything else.
    if (broke) n = Math.max(0, Math.min(n, Math.floor(tier.details.pool * BREAK_SHARE) - this.breaking));
    let share = 0;
    if (e.pass === "blend") {
      // How much of the screen the burst covers at its largest, at its distance.
      const big = e.size[1] * e.grow * size;
      const t = Math.tan(cam.fovY / 2);
      share = (big * big * e.aspect) / (Math.max(d, 1) ** 2 * 4 * t * t * cam.aspect);
      const room = tier.details.fill - fill;
      if (n * share > room) {
        const fits = Math.max(Math.min(3, n), Math.floor(Math.max(0, room) / share));
        this.thinned += n - fits;
        n = fits;
      }
    }
    // A body on a floor above the ground lands its particles on that floor; one on the ground or in the air on the ground.
    const onFloor = w.origin ? w.origin.floor : h.grounded && y > hf.heightAt(x, z) + 0.25 ? y : Number.NaN;
    const pool = this.pool;
    const age = Math.max(0, (tick - w.due) / TICK_RATE);
    for (let k = 0; k < n; k++) {
      const i = pool.count < tier.details.pool ? pool.take() : -1;
      if (i < 0) break;
      if (broke) this.breaking++;
      // Where it starts and which way it goes: out from the place, and up by the effect's share.
      let sx = 0, sy = 0, sz = 0;
      let dx = ox, dy = oy, dz = oz;
      const turn = ((k + rng.float() * 0.6) / n) * Math.PI * 2;
      if (e.shape === "ring" || e.shape === "disc") {
        const r = e.radius * size * (e.shape === "disc" ? Math.sqrt(rng.float()) : 0.85 + rng.float() * 0.3);
        dx = Math.cos(turn);
        dy = 0;
        dz = Math.sin(turn);
        sx = dx * r;
        sz = dz * r;
      } else {
        const u = rng.float() * 2 - 1;
        const a = rng.float() * Math.PI * 2;
        const ring = Math.sqrt(1 - u * u);
        const rx = ring * Math.cos(a), ry = u, rz = ring * Math.sin(a);
        if (e.shape === "sphere") {
          const r = e.radius * size * Math.cbrt(rng.float());
          sx = rx * r;
          sy = ry * r;
          sz = rz * r;
        }
        if (from === "hit") { dx = dx + rx * 0.6; dy = dy + Math.abs(ry) * 0.3; dz = dz + rz * 0.6; }
        else { dx = rx; dy = Math.abs(ry); dz = rz; }
      }
      const up = e.up;
      const hl = Math.hypot(dx, dz);
      const hx = hl > 0 ? dx / hl : 0, hz = hl > 0 ? dz / hl : 0;
      const speed = e.speed[0] + rng.float() * (e.speed[1] - e.speed[0]);
      pool.x[i] = px + sx;
      pool.y[i] = py + sy;
      pool.z[i] = pz + sz;
      pool.vx[i] = hx * (1 - up) * speed;
      pool.vy[i] = up * speed;
      pool.vz[i] = hz * (1 - up) * speed;
      pool.age[i] = age;
      pool.end[i] = e.life[0] + rng.float() * (e.life[1] - e.life[0]);
      pool.landed[i] = -1;
      pool.plane[i] = onFloor;
      pool.size[i] = (e.size[0] + rng.float() * (e.size[1] - e.size[0])) * size;
      pool.heading[i] = rng.float() * Math.PI * 2;
      pool.pitch[i] = (rng.float() - 0.5) * 0.8;
      pool.phase[i] = rng.float() * Math.PI * 2;
      pool.swayTo[i] = rng.float() * Math.PI * 2;
      pool.widthScale[i] = 1;
      if (w.wash) {
        const { side, outside, speed: travel } = w.wash;
        const foam = h.occasion === "boat_wake", pressure = 1 + 0.42 * outside;
        const facingX = Math.sin(h.yaw), facingZ = Math.cos(h.yaw);
        const outward = side * pressure * (0.65 + 0.55 * rng.float());
        const aft = foam ? -0.35 : 0.12;
        const jetspeed = foam ? Math.min(2.3, 0.45 + 0.13 * travel) : speed * 0.9;
        pool.vx[i] = (facingZ * outward + facingX * aft) * jetspeed;
        pool.vz[i] = (-facingX * outward + facingZ * aft) * jetspeed;
        if (foam) {
          const fan = side * pressure * (0.2 + 0.32 * rng.float());
          pool.heading[i] = Math.atan2(-facingZ - facingX * fan, -facingX + facingZ * fan);
          pool.widthScale[i] = (0.22 + 0.22 * rng.float()) * pressure;
          pool.size[i] *= Math.min(1.5, 0.75 + 0.045 * travel) * (1 + 0.15 * outside);
          pool.end[i] *= 0.48 + 0.16 * rng.float();
        } else {
          pool.vy[i] *= pressure;
          pool.size[i] *= 1 + .28 * outside;
        }
      }
      pool.effect[i] = answer.entry.effect;
      const picture = this.pictures[e.pictures[Math.floor(rng.float() * e.pictures.length)]!]!;
      this.looks(i, e, picture);
      if (w.wash && h.occasion === "boat_wake" && e.face === "flat") {
        pool.flags[i] = DETAIL_WAKE;
        pool.grey[i] = Math.round(255 * rng.float());
      }
      const shade = 1 + e.vary * (rng.float() * 2 - 1);
      pool.colourA[i] = this.paint(e, picture.regions[0]!, h, book, colour, shade, tinted);
      pool.colourB[i] = this.paint(e, picture.regions[1]!, h, book, colour, shade, tinted);
    }
    return e.pass === "blend" ? n * share : 0;
  }

  /** The colour word of a particle's region `region` of the body, the ground's `ground` (a break's own where `tinted`), or the effect's own, shaded. */
  private paint(e: DetailEffect, region: number, h: Happening, book: Book, ground: readonly number[], shade: number, tinted = false): number {
    let r: number;
    let g: number;
    let b: number;
    if (e.colour === "ground" || tinted) { r = ground[0]!; g = ground[1]!; b = ground[2]!; }
    else if (Array.isArray(e.colour)) [r, g, b] = e.colour;
    else {
      const dye = (region >= 0 && h.colours[region]) || book.colour;
      r = this.palette[dye * 4]!;
      g = this.palette[dye * 4 + 1]!;
      b = this.palette[dye * 4 + 2]!;
    }
    const k = (v: number): number => Math.max(0, Math.min(255, Math.round(v * shade)));
    return (k(r) | (k(g) << 8) | (k(b) << 16) | (255 << 24)) >>> 0;
  }

  /** Writes the particles in view into `p`, the cut-out ones and then the see-through ones far to near. */
  private write(p: FramePacket, cam: Camera, hf: Heightfield, reserve: number): number {
    const pool = this.pool;
    const out = p.details;
    const words = p.detailWords;
    const order = this.order;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    // The camera's right and up, which a puff faces.
    const sy = Math.sin(cam.yaw), cyw = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const rx = -cyw, rz = sy;
    const ux = -sy * sp, uy = cp, uz = -cyw * sp;
    const t = Math.tan(cam.fovY / 2);
    let cut = 0;
    let blended = 0;
    let fill = 0;
    // Cut-out ones go first; see-through ones are kept aside to be sorted.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < pool.count; i++) {
        const e = this.effects[pool.effect[i]!]!;
        if ((e.pass === "blend") !== (pass === 1) || (this.muting && this.muted[pool.effect[i]!] === 1)) continue;
        const half = pool.size[i]! * (e.grow === 1 ? 1 : 1 + (e.grow - 1) * ease(pool.age[i]! / pool.end[i]!)) * 0.5;
        const x = pool.x[i]! - cx;
        const y = pool.y[i]! - cy;
        const z = pool.z[i]! - cz;
        if (!cam.boxVisible(x - half, y - half, z - half, x + half, y + half, z + half)) continue;
        const d = Math.hypot(x, y, z);
        let shows = pool.shows(i, e) * e.opacity;
        if (pass === 1) {
          shows *= Math.min(1, Math.max(0, (d - 0.3) / EYE_FADE));
          if (shows <= 0) continue;
          const area = (4 * half * half * e.aspect * pool.widthScale[i]!) / (Math.max(d, 0.5) ** 2 * 4 * t * t * cam.aspect);
          // What lies flat is seen as thin as the eye is low over it, a thick puff only what of it is over its floor, and no card covers more than the screen.
          const seen = e.face === "flat" || pool.landed[i]! >= 0 ? Math.max(0.1, Math.abs(y) / Math.max(d, 0.5)) : e.thick ? Math.min(1, Math.max(0.1, 0.5 + (pool.y[i]! - pool.floor(i, pool.x[i]!, pool.z[i]!, hf)) / (4 * half))) : 1;
          fill += Math.min(1, area * seen) * shows;
        }
        const n = cut + blended;
        if (n >= MAX_DETAILS - reserve) {
          this.dropped++;
          continue;
        }
        const o = n * DETAIL_FLOATS;
        out[o + DETAIL.middle] = x;
        out[o + DETAIL.middle + 1] = y;
        out[o + DETAIL.middle + 2] = z;
        const width = half * e.aspect * pool.widthScale[i]!;
        const lying = pool.landed[i]! >= 0;
        if (e.face === "streak" && !lying) {
          // Along the way it flies, and across that as the eye sees it.
          let ax = pool.vx[i]!, ay = pool.vy[i]!, az = pool.vz[i]!;
          const al = Math.hypot(ax, ay, az);
          if (al < 1e-3) {
            ax = 0;
            ay = 1;
            az = 0;
          } else {
            ax /= al;
            ay /= al;
            az /= al;
          }
          let bx = y * az - z * ay, by = z * ax - x * az, bz = x * ay - y * ax;
          const bl = Math.hypot(bx, by, bz);
          if (bl < 1e-6) {
            bx = rx;
            by = 0;
            bz = rz;
          } else {
            bx /= bl;
            by /= bl;
            bz /= bl;
          }
          sides(out, o, ax * half, ay * half, az * half, bx * width, by * width, bz * width);
        } else if (e.face === "camera") {
          const a = pool.heading[i]! + e.turn * pool.age[i]!;
          const ca = Math.cos(a), sa = Math.sin(a);
          sides(out, o, (ux * ca - rx * sa) * half, uy * ca * half, (uz * ca - rz * sa) * half, (rx * ca + ux * sa) * width, uy * sa * width, (rz * ca + uz * sa) * width);
        } else if (lying || e.face === "flat") {
          const l = i * 6;
          if (!lying) {
            const h = pool.heading[i]! + e.turn * pool.age[i]!;
            sides(out, o, Math.cos(h) * half, 0, Math.sin(h) * half, -Math.sin(h) * width, 0, Math.cos(h) * width);
          } else {
            for (let k = 0; k < 3; k++) {
              out[o + DETAIL.along + k] = pool.lying[l + k]! * half;
              out[o + DETAIL.across + k] = pool.lying[l + 3 + k]! * width;
            }
          }
        } else {
          // Falling, a feather lies across its fall and rocks; bursting out, it tumbles.
          const age = pool.age[i]!;
          const swing = Math.sin(2 * Math.PI * e.swayHz * age + pool.phase[i]!);
          const h = pool.heading[i]! + e.turn * age;
          const pitch = pool.pitch[i]! + e.rock * swing;
          const roll = e.rock * 0.6 * Math.cos(2 * Math.PI * e.swayHz * age + pool.phase[i]!) + 3 * Math.max(0, 0.5 - age) * pool.phase[i]!;
          const ch = Math.cos(h), sh = Math.sin(h), cpt = Math.cos(pitch), spt = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
          const ax = ch * cpt, ay = spt, az = sh * cpt;
          // Across: the level side direction, rolled about the length.
          const bx = -sh, by = 0, bz = ch;
          const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          sides(out, o, ax * half, ay * half, az * half, (bx * cr + nx * sr) * width, (by * cr + ny * sr) * width, (bz * cr + nz * sr) * width);
        }
        // A thick puff that lies is not faded into the floor it lies on.
        out[o + DETAIL.floor] = lying && e.thick ? -1e6 : pool.floor(i, pool.x[i]!, pool.z[i]!, hf) - cy;
        words[o + DETAIL.colourA] = pool.colourA[i]!;
        // A thick puff tears as it ages: its second colour's second byte, over its seed.
        words[o + DETAIL.colourB] = e.thick && !lying ? (pool.colourB[i]! & 255) | (Math.round(255 * TEAR_MOST * Math.min(1, Math.max(0, (pool.age[i]! / pool.end[i]! - TEAR_FROM) / (1 - TEAR_FROM)))) << 8) : pool.colourB[i]!;
        words[o + DETAIL.misc] = (pool.cell[i]! | (pool.flags[i]! << 8) | (Math.round(shows * 255) << 16) | (pool.grey[i]! << 24)) >>> 0;
        this.tagged[n] = p.detailTag[n] = this.muted[pool.effect[i]!]!;
        if (pass === 0) cut++;
        else {
          order[blended] = (0x7ffff - Math.min(0x7ffff, Math.floor(d * 64))) * MAX_DETAILS + n;
          blended++;
        }
      }
    }
    // The see-through ones far to near: their keys are inverted distances, sorted from least.
    if (blended > 1) {
      sortU32(order, blended);
      const from = this.unsorted;
      for (let k = 0, at = cut * DETAIL_FLOATS; k < blended * DETAIL_FLOATS; k++) from[k] = words[at + k]!;
      for (let k = 0; k < blended; k++) {
        const src = ((order[k]! % MAX_DETAILS) - cut) * DETAIL_FLOATS;
        const dst = (cut + k) * DETAIL_FLOATS;
        for (let f = 0; f < DETAIL_FLOATS; f++) words[dst + f] = from[src + f]!;
        p.detailTag[cut + k] = this.tagged[order[k]! % MAX_DETAILS]!;
      }
    }
    p.detailCount = p.detailOwn = cut + blended;
    p.detailFill = this.fill = this.own = fill;
    return cut;
  }
}

/** Writes a particle's half length and half width, each a vector, from `o`. */
function sides(out: Float32Array, o: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  out[o + DETAIL.along] = ax;
  out[o + DETAIL.along + 1] = ay;
  out[o + DETAIL.along + 2] = az;
  out[o + DETAIL.across] = bx;
  out[o + DETAIL.across + 1] = by;
  out[o + DETAIL.across + 2] = bz;
}

/** A colour's byte `v`, shaded. */
function shaded(v: number, shade: number): number {
  return Math.max(0, Math.min(255, Math.round(v * shade)));
}

/** Fast at first and slower as it ends, 0 to 1. */
function ease(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return 1 - (1 - t) * (1 - t);
}
