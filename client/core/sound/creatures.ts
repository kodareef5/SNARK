// What creatures do that is heard, found in what a client already has of them: the cues and the pose state their
// snapshots carry (shared/anim/pose.ts), the deaths the server tells of, and the gait each is drawn with. Nothing here
// is sent for sound, and nothing here touches the simulation.
//
// A species' sounds are found by cue (shared/sound/cues.ts) under its id, as `core:dodo/sound/startled`, falling back as
// the catalogue says, so a second creature needs only its sounds and is heard through shared ones until it has them.
// A body is followed from when it comes within hearing; what it was doing when first heard makes no sound.

import { CreatureAnim, advanceCreature, idleOf } from "../../../shared/anim/creature.ts";
import { Gait } from "../../../shared/anim/gait.ts";
import { AnimState, CUE_DEAD, CUE_LAND, CUE_NONE, CUE_STARTLE, CUE_TAKEOFF, CUE_TORPOR, FLY_SPEED_STEP, LAYER_EAT, LAYER_FLINCH, SPEED_STEP, bodySeed } from "../../../shared/anim/pose.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { MODE_FLYER, MODE_SWIM } from "../../../shared/sim/character.ts";
import { ACT_NONE } from "../../../shared/sim/weapon.ts";
import type { Heightfield } from "../../../shared/world/heightfield.ts";
import type { RemoteSample } from "../session.ts";
import { GROUND_NAMES, groundAt } from "./ground.ts";
import type { DetailSheet, DetailSound, Occasion } from "../../../shared/pack/details.ts";
import { cueKey } from "../../../shared/sound/cues.ts";
import { Rng } from "../../../shared/rng.ts";
import type { SoundLibrary } from "./library.ts";
import type { Resolver } from "./resolve.ts";
import { KIND_HIT, KIND_STEP, KIND_VOCAL } from "./mixer.ts";
import { bodyDown, groundPecks, mouthOpens, strikeAt } from "./timing.ts";

/** What a body does that has a sound, and the names that sound may have, tried in turn. */
export const O_STARTLED = 0;
export const O_HURT = 1;
export const O_ATTACK = 2;
export const O_LAND = 3;
export const O_DEATH = 4;
export const O_TORPOR_IN = 5;
export const O_TORPOR_OUT = 6;
export const O_EAT = 7;
/** The thump of a body that has gone down, knocked out or dead. */
export const O_THUMP = 8;
/** Calls while running, and a growl while stalking near: a pack talks as it hunts, a herd as it flees. */
export const O_CHASE = 9;
export const O_GROWL = 10;
/** A flyer's wingbeat, and its take-off. */
export const O_FLAP = 11;
/** The occasions of a creature's sheet (shared/pack/details.ts) and the sound occasion each names. */
const SHEET: readonly (readonly [Occasion, number])[] = [["struck", O_HURT], ["peck", O_ATTACK], ["land", O_LAND], ["death", O_DEATH], ["down", O_TORPOR_IN], ["up", O_TORPOR_OUT]];
/** Seconds between a running body's calls, and a stalking hunter's growls, at random within these. */
const CHASE_EVERY: readonly [number, number] = [1.2, 3.5];
const GROWL_EVERY: readonly [number, number] = [4, 8];
/** A hunter growls when it walks within this many metres of the ear. */
const GROWL_NEAR = 15;
/** The registry's temper of a hunter (shared/content/registry.ts: 0 flees, 1 defends, 2 hunts). */
const TEMPER_HUNTS = 2;
/** The cue of each occasion; what stands in for a species without it is the catalogue's to say. */
const OCCASIONS: readonly string[] = ["startled", "hurt", "attack", "land", "death", "torpor_in", "torpor_out", "eat", "thump", "chase", "growl", "flap"];
/**
 * How each occasion is heard: from its mouth, its feet or its body, and how much it weighs when voices are short. A
 * startle outweighs the pain of the blow that startled it, which comes in the same snapshot, so the alarm is heard.
 */
const KIND: readonly number[] = [KIND_VOCAL, KIND_VOCAL, KIND_HIT, KIND_HIT, KIND_VOCAL, KIND_VOCAL, KIND_VOCAL, KIND_HIT, KIND_HIT, KIND_VOCAL, KIND_VOCAL, KIND_STEP];
const WEIGHT: readonly number[] = [0.95, 0.9, 0.5, 0.6, 1, 0.8, 0.5, 0.3, 0.6, 0.7, 0.55, 0.35];
/** Flying at least this fast it strokes twice a beat, as its fly_fast does (shared/anim/creature.ts). */
const FAST_STROKES = 12;
/** Looking this many steps of the pose's pitch below level or further, it glides or dives on still wings. */
const STILL_WINGS = -4;
const CALL_WEIGHT = 0.4;
const STEP_WEIGHT = 0.25;
/** An idle's sound under the clip's word alone (`peck` for `idle_peck`) is this much quieter. */
const IDLE_STAND_IN = 0.45;
/** Metres a footfall is heard to at most, whatever its sound says: there are many of them. */
const STEP_REACH = 25;

/** A species' sounds, as sound numbers of the library (-1 for none), and when within its clips each belongs. */
export class Book {
  readonly sound = new Int32Array(OCCASIONS.length).fill(-1);
  readonly rate = new Float32Array(OCCASIONS.length).fill(1);
  /** By kind of ground (ground.ts). */
  readonly step = new Int32Array(GROUND_NAMES.length).fill(-1);
  /** By its idles' order in CreatureAnim: the sound each plays, how loud, and the seconds into it each is heard. */
  readonly idle: Int32Array;
  readonly idleLevel: Float32Array;
  readonly idleAt: readonly (readonly number[])[];
  /** Seconds into its attack at which the blow lands, and into going down and dying at which its body meets the ground. */
  readonly strike: number;
  readonly down: number;
  readonly dies: number;
  /** The farthest any of its sounds is heard, and its height in metres. */
  readonly reach: number;
  readonly height: number;
  /** What it plays as drawn; null for a creature drawn as a grey box, which is heard by its cue word alone. */
  readonly anim: CreatureAnim | null;

  /** `lands` is the tick of its bite at which the blow lands, where its content says, else it is read from the clip. */
  constructor(owner: string, anim: CreatureAnim | null, height: number, lib: SoundLibrary, res: Resolver, lands: number | null = null, sheet: DetailSheet | null = null) {
    this.anim = anim;
    this.height = height;
    const o = res.owner(owner);
    const find = (name: string): number => lib.index.get(`${owner}/sound/${name}`) ?? -1;
    OCCASIONS.forEach((name, i) => {
      this.sound[i] = res.peek(o, cueKey(name));
      this.rate[i] = res.rate(o, cueKey(name));
    });
    // The creature's own sheet (its cues.json, D426) names its sound for an occasion where it says one.
    for (const [occasion, i] of SHEET) {
      const sounds = sheet?.cues[occasion]?.sounds ?? [];
      const now = sounds.find((s) => typeof s === "string" || s.at === "now");
      const down = sounds.find((s) => typeof s !== "string" && s.at === "down");
      const named = (s: DetailSound | undefined): number => (s === undefined ? -1 : find(typeof s === "string" ? s : s.sound));
      if (named(now) >= 0) {
        this.sound[i] = named(now);
        this.rate[i] = 1;
      }
      if (named(down) >= 0) {
        this.sound[O_THUMP] = named(down);
        this.rate[O_THUMP] = 1;
      }
    }
    GROUND_NAMES.forEach((g, i) => (this.step[i] = res.peek(o, cueKey(`step/${g}`))));
    const rig = anim?.rig ?? null;
    const idles = anim?.idles ?? [];
    const names = idles.map((c) => c.id.slice(c.id.lastIndexOf("/") + 1));
    this.idle = Int32Array.from(names, (n) => (find(n) >= 0 ? find(n) : find(n.replace(/^idle_/, ""))));
    this.idleLevel = Float32Array.from(names, (n) => (find(n) >= 0 ? 1 : IDLE_STAND_IN));
    this.idleAt = idles.map((clip, i) => {
      if (this.idle[i]! < 0 || !rig) return [];
      // A clip with its own sound starts it as its mouth opens; one that borrows a peck's is heard each time the mouth meets the ground.
      if (this.idleLevel[i] === 1) return [mouthOpens(rig, clip)];
      const pecks = groundPecks(rig, clip);
      return pecks.length > 0 ? pecks : [mouthOpens(rig, clip)];
    });
    // Without a rig, the moments its clips would give are guessed.
    this.strike = lands !== null ? lands / TICK_RATE : rig && anim ? strikeAt(rig, anim.attack) : 0.3;
    this.down = rig && anim ? bodyDown(rig, anim.torporIn ?? anim.death) : 0.5;
    this.dies = rig && anim ? bodyDown(rig, anim.death) : 0.6;
    let reach = 0;
    for (const s of [...this.sound, ...this.step, ...this.idle]) if (s >= 0) reach = Math.max(reach, lib.sounds[s]!.range);
    this.reach = reach;
  }
}

/** What is kept of a body heard, between frames. */
class Heard {
  kind = 0;
  seen = 0;
  cue = 0;
  layer = 0;
  act = ACT_NONE;
  actStart = 0;
  /** The turn of its idle it was last standing in, or -1 while it was not standing. */
  slot = -1;
  out = false;
  /** Its distance from the ear last frame. */
  lastD = Infinity;
  /** Seconds at which it next calls while running, and growls while stalking; 0 while it does neither. */
  nextCall = 0;
  nextGrowl = 0;
  /** The stroke of its flight it was last heard in, or -1 while it was not flapping. */
  stroke = -1;
  readonly gait = new Gait();
  x = 0;
  y = 0;
  z = 0;
}

/** Hands on a sound of the library to be heard: how it is heard and weighed, whose it is, where, how loud, how high and when. */
export type Emit = (sound: number, kind: number, weight: number, entity: number, x: number, y: number, z: number, lift: number, level: number, rate: number, delay: number) => void;

/** Metres within which a moving hunter is a threat the music hears, and a running one a chaser; a hunter this tall or taller is an apex. */
const THREAT_NEAR = 40;
const CHASE_NEAR = 30;
const APEX_HEIGHT = 3;

export class CreatureSounds {
  /** This frame: hunters moving within reach of the ear, those running at it, and whether any is an apex (music.ts). */
  hunters = 0;
  chasers = 0;
  apex = false;
  /** By content index, or null for a kind with no sounds. */
  readonly books: (Book | null)[];
  readonly bodies = new Map<number, Heard>();
  private readonly reg: Registry;
  private readonly lib: SoundLibrary;
  private readonly res: Resolver;
  private readonly sheets: readonly DetailSheet[];
  /** What each kind plays as it is drawn, and what it played when its book was made. */
  private readonly animOf: (kind: number) => CreatureAnim | null;
  private readonly made: (CreatureAnim | null)[];
  private readonly st = new AnimState();
  private frame = 0;
  private readonly rng = new Rng(5);
  /** Ids whose death has been heard, kept while the session still tells of them. */
  private readonly mourned = new Set<number>();

  constructor(reg: Registry, lib: SoundLibrary, res: Resolver, animOf: (kind: number) => CreatureAnim | null, sheets: readonly DetailSheet[] = []) {
    this.reg = reg;
    this.lib = lib;
    this.res = res;
    this.sheets = sheets;
    this.animOf = animOf;
    this.made = reg.defs.map((d, kind) => (d?.type === "species" ? animOf(kind) : null));
    this.books = reg.defs.map((_, kind) => this.bookOf(kind));
  }

  private bookOf(kind: number): Book | null {
    const d = this.reg.defs[kind];
    if (d?.type !== "species") return null;
    const book = new Book(d.id, this.made[kind] ?? null, this.reg.bodyHeight[kind]!, this.lib, this.res, d.bite ? (this.reg.weapon[kind]?.strikeTick ?? null) : null, this.sheets.find((s) => s.owner === d.id) ?? null);
    return book.reach > 0 ? book : null;
  }

  /**
   * Finds what the bodies of `remote` did since the last frame that is heard from (ex, ey, ez), and hands each to `emit`.
   * `want` is told of each sound a body within its range may make, and how near it is.
   */
  update(remote: RemoteSample, hf: Heightfield, ex: number, ey: number, ez: number, emit: Emit, want: (sound: number, metres: number) => void): void {
    const frame = ++this.frame;
    this.hunters = 0;
    this.chasers = 0;
    this.apex = false;
    const st = this.st;
    for (let i = 0; i < remote.count; i++) {
      const kind = remote.kind[i]!;
      // Its skeleton's clips have come, on a rig made anew with them: it is heard by them from now, each of its bodies afresh, as one first heard.
      if (this.made[kind] && this.made[kind]!.rig !== this.animOf(kind)?.rig) {
        this.made[kind] = this.animOf(kind);
        this.books[kind] = this.bookOf(kind);
        for (const [id, b] of this.bodies) if (b.kind === kind) this.bodies.delete(id);
      }
      const book = this.books[kind];
      // A dead creature's body is an entity of its own (client/core/ragdoll.ts): its death was heard as the living one left.
      if (!book || (remote.flags[i]! & 8) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0) continue;
      const id = remote.id[i]!;
      const x = remote.x[i]!;
      const y = remote.y[i]!;
      const z = remote.z[i]!;
      const d = Math.hypot(x - ex, y - ey, z - ez);
      if (d > book.reach) continue;
      for (const s of book.sound) if (s >= 0) want(s, d);
      for (const s of book.idle) if (s >= 0) want(s, d);
      st.unpack(remote.anim[i]!, remote.cue[i]!);
      st.seed = bodySeed(id);
      // A body held in a survivor's arms moves at its carrier's speed, and its feet are off the ground.
      const ground = st.grounded && st.mode !== MODE_SWIM && !st.out && !st.held ? groundAt(hf, x, y, z) : -1;
      if (ground >= 0 && d < STEP_REACH && book.step[ground]! >= 0) want(book.step[ground]!, d);
      let b = this.bodies.get(id);
      const first = !b;
      if (!b) this.bodies.set(id, (b = new Heard()));
      b.seen = frame;
      b.x = x;
      b.y = y;
      b.z = z;
      const size = remote.grown[i] !== 0 ? youngScale(this.reg.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
      // A young one is higher and quieter.
      const pitch = 1 / Math.sqrt(Math.max(0.35, size));
      const quiet = 0.5 + 0.5 * size;
      // The cue and its start, and the layer and its start; whether it lies knocked out is read from the state.
      const cue = remote.cue[i]! & 0xffe;
      const layer = (remote.cue[i]! >>> 12) & 0x3ff;
      const act = st.action & 7;
      const play = (o: number, delay = 0, level = 1): void => {
        const s = book.sound[o]!;
        if (s >= 0) emit(s, KIND[o]!, WEIGHT[o]!, id, x, y, z, KIND[o] === KIND_VOCAL ? book.height * size * 0.8 : book.height * size * 0.3, level * quiet, book.rate[o]! * pitch, delay);
      };
      if (!first) {
        if (cue !== b.cue && st.cue !== CUE_NONE) {
          if (st.cue === CUE_STARTLE) play(O_STARTLED);
          else if (st.cue === CUE_LAND) play(O_LAND);
          else if (st.cue === CUE_TAKEOFF) play(O_FLAP);
          else if (st.cue === CUE_TORPOR && st.out) {
            play(O_TORPOR_IN);
            // Knocked out off the ground, its body is heard as it lands.
            if (st.grounded || st.mode === MODE_SWIM) play(O_THUMP, book.down, 0.8);
          } else if (st.cue === CUE_TORPOR) play(O_TORPOR_OUT);
        }
        if (layer !== b.layer && st.layer === LAYER_FLINCH) play(O_HURT);
        else if (layer !== b.layer && st.layer === LAYER_EAT) play(O_EAT);
        if (act !== ACT_NONE && (b.act === ACT_NONE || st.actionStart !== b.actStart)) play(O_ATTACK, book.strike);
      }
      b.cue = cue;
      b.layer = layer;
      b.act = act;
      b.actStart = st.actionStart;
      b.out = st.out;
      b.kind = kind;
      if (this.reg.temper[kind] === TEMPER_HUNTS && st.speed > 0 && !st.out && d < THREAT_NEAR) {
        this.hunters++;
        // Running and nearer than last frame: it runs at the ear.
        if (st.speed * SPEED_STEP >= (book.anim?.runAt ?? 6) * 0.8 && d < CHASE_NEAR && d < b.lastD) this.chasers++;
        if (this.reg.bodyHeight[kind]! >= APEX_HEIGHT) this.apex = true;
      }
      b.lastD = d;
      this.calls(book, b, st, remote.tick / TICK_RATE, first, d, this.reg.temper[kind] === TEMPER_HUNTS, play);
      if (book.anim) this.idles(book, book.anim, b, st, remote.tick, first, id, x, y, z, size, pitch, quiet, emit);
      if (book.anim?.flies && book.sound[O_FLAP]! >= 0) this.flaps(book.anim, b, st, remote.tick, first, play);
      if (ground >= 0 && book.anim) this.steps(book, book.anim, b, st, remote.tick, remote.yaw[i]!, size, ground, d, id, x, y, z, pitch, quiet, emit);
    }
    // Those that left the view because they died are heard dying where they were last.
    for (const [id, b] of this.bodies) {
      if (b.seen === frame) continue;
      const book = this.books[b.kind];
      if (remote.died.has(id) && !this.mourned.has(id) && book) {
        this.mourned.add(id);
        // A body knocked out dies where it lies, with no cry and no fall.
        if (!b.out) {
          if (book.sound[O_DEATH]! >= 0) emit(book.sound[O_DEATH]!, KIND_VOCAL, WEIGHT[O_DEATH]!, id, b.x, b.y, b.z, book.height * 0.6, 1, book.rate[O_DEATH]!, 0);
          if (book.sound[O_THUMP]! >= 0) emit(book.sound[O_THUMP]!, KIND_HIT, WEIGHT[O_THUMP]!, id, b.x, b.y, b.z, 0.1, 0.9, book.rate[O_THUMP]!, book.dies);
        }
      }
      this.bodies.delete(id);
    }
    for (const id of this.mourned) if (!remote.died.has(id)) this.mourned.delete(id);
  }

  /** A running body calls now and then, each on its own time; a hunter walking near the ear growls now and then. */
  private calls(book: Book, b: Heard, st: AnimState, t: number, first: boolean, d: number, hunts: boolean, play: (o: number) => void): void {
    const pace = st.speed * SPEED_STEP;
    const running = book.sound[O_CHASE]! >= 0 && st.grounded && !st.out && pace >= (book.anim?.runAt ?? 6) * 0.8;
    if (!running || first) b.nextCall = 0;
    else if (b.nextCall === 0) b.nextCall = t + this.rng.range(0, CHASE_EVERY[1]);
    else if (t >= b.nextCall) {
      play(O_CHASE);
      b.nextCall = t + this.rng.range(CHASE_EVERY[0], CHASE_EVERY[1]);
    }
    const stalking = hunts && book.sound[O_GROWL]! >= 0 && !running && pace > 0 && d < GROWL_NEAR && st.grounded && !st.out;
    if (!stalking || first) b.nextGrowl = 0;
    else if (b.nextGrowl === 0) b.nextGrowl = t + this.rng.range(1, GROWL_EVERY[0]);
    else if (t >= b.nextGrowl) {
      play(O_GROWL);
      b.nextGrowl = t + this.rng.range(GROWL_EVERY[0], GROWL_EVERY[1]);
    }
  }

  /** A flyer's wingbeat at the top of each stroke: one a beat of its flight, two flying fast, none on still wings. */
  private flaps(anim: CreatureAnim, b: Heard, st: AnimState, tick: number, first: boolean, play: (o: number) => void): void {
    const speed = st.speed * FLY_SPEED_STEP;
    if (st.mode !== MODE_FLYER || st.out || (speed > 0 && st.pitch <= STILL_WINGS)) {
      b.stroke = -1;
      return;
    }
    const stroke = Math.floor(((Math.floor(tick) + st.seed) * (speed >= FAST_STROKES ? 2 : 1)) / anim.beat);
    if (stroke !== b.stroke && b.stroke >= 0 && !first) play(O_FLAP);
    b.stroke = stroke;
  }

  /** At the start of each turn of its idle that it stands through, the idle chosen for the turn may have a sound. */
  private idles(book: Book, anim: CreatureAnim, b: Heard, st: AnimState, tick: number, first: boolean, id: number, x: number, y: number, z: number, size: number, pitch: number, quiet: number, emit: Emit): void {
    const a = anim;
    const standing = st.speed === 0 && st.grounded && !st.out && st.mode !== MODE_SWIM && (st.action & 7) === ACT_NONE && st.cue === CUE_NONE;
    if (!standing || a.idles.length === 0) {
      b.slot = -1;
      return;
    }
    const t = Math.floor(tick) + st.seed;
    const slot = Math.floor(t / a.slot);
    if (slot !== b.slot && b.slot >= 0 && !first) {
      const which = idleOf(a, st.seed, t);
      const s = which >= 0 ? book.idle[which]! : -1;
      if (s >= 0) {
        const into = (t - slot * a.slot) / TICK_RATE;
        for (const at of book.idleAt[which]!) {
          if (at + 0.05 < into) continue;
          emit(s, book.idleLevel[which] === 1 ? KIND_VOCAL : KIND_HIT, CALL_WEIGHT, id, x, y, z, book.idleLevel[which] === 1 ? book.height * size * 0.8 : 0.1, book.idleLevel[which]! * quiet, pitch, Math.max(0, at - into));
        }
      }
    }
    b.slot = slot;
  }

  /** A footfall each time a foot comes down: where the gait, moved on by the ground covered, passes the plant of either foot. */
  private steps(book: Book, anim: CreatureAnim, b: Heard, st: AnimState, tick: number, yaw: number, size: number, ground: number, d: number, id: number, x: number, y: number, z: number, pitch: number, quiet: number, emit: Emit): void {
    const g = b.gait;
    const before = g.phase;
    // A gait seen for the first time, or again after a gap, starts afresh, and its first move is no step.
    const gap = tick - g.tick;
    advanceCreature(anim, g, st, tick, x, z, yaw, size);
    if (!(gap > 0 && gap <= 4) || st.speed === 0 || d >= STEP_REACH) return;
    // The phase is 0 where the first foot is farthest forward, as it comes down, and a half where the other is.
    const moved = g.phase - before + (g.phase < before ? 1 : 0);
    if (moved <= 0 || moved >= 0.5) return;
    const crossed = (before < 0.5 && before + moved >= 0.5) || before + moved >= 1;
    if (!crossed) return;
    const s = book.step[ground]!;
    if (s < 0) return;
    // A run lands harder than a walk, and a big body than a small.
    const speed = (st.speed * SPEED_STEP) / Math.max(0.1, anim.runAt);
    const level = (0.55 + 0.45 * Math.min(1, speed)) * quiet;
    emit(s, KIND_STEP, STEP_WEIGHT, id, x, y, z, 0.05, level, pitch, 0);
  }
}
