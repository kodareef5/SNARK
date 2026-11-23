// A creature's pose from the same packed state a survivor has and from its cues (shared/anim/pose.ts), on the clips its
// asset names for what it does (RIG_CLIPS). The arithmetic is exactly rounded, so the server's hit capsules and every
// client's drawing use the same pose. Nothing accumulates: a cue carries the tick it began, and an idle's variant is
// chosen by the tick and the body's seed.
//
// What it does throughout (lies knocked out, floats, falls, or stands and moves on its gaits) is played by the tick. A
// one-shot that begins at a cue's tick (going down, getting up, a startle, a landing) plays over that, and its strike over
// all of it but lying. Each one-shot fades in from what played before it and out into what plays after, over FADE ticks.
// Last, a layer clip (a flinch, a gulp) turns its bones further, each in its own frame.
//
// A creature in its own flight (MODE_FLYER) with clips to fly by hovers, flaps, glides and dives by its speed, its climb
// and its look, all played by the tick, its body pitched with its look and rolled into its turns about its middle, so
// its hit zones follow its wings. A take-off and a landing hand it between the ground and the air, a barrel roll turns it
// over, it bites with its neck and head, and its feet take hold of what it carries.

import type { CreatureCombatFacet, SpeciesDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { TICK_RATE } from "../coords.ts";
import { PI, TAU, detCos, detSin } from "../math/scalar.ts";
import { quatAxis, quatMul, quatNlerp, quatRotate, quatUnrotate } from "../math/quat.ts";
import { MODE_FLYER, MODE_SWIM, MODE_WALK } from "../sim/character.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_RELOAD, ACT_SWING, HOLD_CARRY } from "../sim/weapon.ts";
import { blendPose, sampleClip, type Clip, type Pose } from "./clip.ts";
import { footStart, gaitClip, gaitShares, playGaits, tickPhase, type Gait, type GaitClip } from "./gait.ts";
import { HUMAN } from "./human.ts";
import { Carriage } from "./carriage.ts";
import { AnimState, BANK_STEPS, CLIMB_DIVE, CLIMB_DOWN, CUE_LAND, CUE_ROLL, CUE_ROAR, CUE_STARTLE, CUE_TAKEOFF, CUE_TORPOR, FLY_SPEED_STEP, LAYER_EAT, LAYER_FLINCH, LAYER_NONE, PITCH_STEPS, SPEED_STEP, backward } from "./pose.ts";
import type { Rig, RigClip } from "./rigs.ts";
import { boneToModel, rayZones, solve, zoneHit, type Solved } from "./skeleton.ts";
import { conformCreature, groundSpeedScale } from "./ground-conform.ts";
import { nothingBuilt, wallDepth, wallOut, type CollisionWorld } from "../world/collide.ts";

/** Below this speed, in metres per second, a walk with no stride is blended with the idle so that starting off is not a jump. */
const EASE_IN = 1.2;
/** Ticks over which a one-shot comes in from what played before it, and goes out into what plays after. */
export const FADE = 6;
/** Ticks a species with no clip to get up by takes to rise from lying. */
const GET_UP = 30;
/** A turn on the spot is a quarter turn to its left, its body turning as a smooth step over the clip. */
const QUARTER = PI / 2;
/** Metres a second at which its fly and its fly_fast play alone, where its asset gives neither a stride. */
const FLY_AT = 6;
const FAST_AT = 16;
const DEGREE = PI / 180;
/** Its look below level, over which it comes from flapping into the glide, and from the glide into the dive. */
const GLIDE_FROM = 3 * DEGREE;
const GLIDE_TO = 20 * DEGREE;
const DIVE_FROM = 30 * DEGREE;
const DIVE_TO = 60 * DEGREE;
/** Going down without looking down it sinks on its wings as it hovers, up to SINK_MOST metres a second, and none from SINK_NONE. */
const SINK_MOST = 12;
const SINK_NONE = 16;
/** The most its body pitches up and down with its look. */
const PITCH_UP = 60 * DEGREE;
const PITCH_DOWN = 80 * DEGREE;
/** The most its body rolls into a turn, at its greatest bank, and the share of that its head rolls back, as a bird's keeps level. */
const BANK_MOST = 60 * DEGREE;
const HEAD_LEVEL = 0.6;
/** A barrel roll without a clip of its own: one turn over this many ticks. */
const ROLL_TICKS = 30;
/** Ticks over which a flyer's landing comes in from its flight, its legs swinging forward to the ground. */
const LAND_FADE = 2 * FADE;
/** Seconds over which a client's drawing of a flyer comes most of the way to the shares and roll its state says. */
const SHARE_EASE = 0.15;
/** Which contact map actually drives the submitted feet. Zero also suppresses legacy cadence. */
export const FOOTFALL_NONE = 0;
export const FOOTFALL_FORWARD = 1, FOOTFALL_REVERSE = 2, FOOTFALL_CHARGE = 3;
export interface FootfallGait { readonly phase: number; readonly speed: number; readonly domain: number; }
const single: GaitClip[] = [];
const q = new Float64Array(4);
const r = new Float64Array(4);
const v = new Float64Array(3);

/** What one species plays on its rig: the clip of each name in RIG_CLIPS, its idles, and its gaits at its speeds. */
export class CreatureAnim {
  readonly rig: Rig;
  /** Metres a second from which it runs. */
  readonly runAt: number;
  readonly idle: Clip | null;
  readonly walk: Clip | null;
  readonly run: Clip | null;
  readonly attack: Clip | null;
  readonly swim: Clip | null;
  readonly swimIdle: Clip | null;
  /** Awake water reactions preserve the breathing pose; ground reactions never replace the swimming neck. */
  readonly startledSwim: Clip | null;
  readonly landSwim: Clip | null;
  readonly torporOutSwim: Clip | null;
  readonly fall: Clip | null;
  readonly land: Clip | null;
  readonly turn: Clip | null;
  /** The turn mirrored, to turn to its right. */
  readonly turnRight: Clip | null;
  readonly startled: Clip | null;
  readonly call: Clip | null;
  readonly flinch: Clip | null;
  readonly torporIn: Clip | null;
  readonly torporIdle: Clip | null;
  readonly torporEat: Clip | null;
  readonly torporOut: Clip | null;
  readonly death: Clip | null;
  /** In a survivor's arms, and hanging from a creature that carries it. */
  readonly held: Clip | null;
  readonly carried: Clip | null;
  /** Its hold_point socket as it is held, in its model space: where a survivor's palms take it. Null without the socket. */
  readonly holdAt: Float64Array | null;
  /**
   * Its idle's variants, the clips named "idle_" and a word, and its call. In each `slot` ticks of standing, from a whole
   * turn of its idle, one of them may play.
   */
  readonly idles: readonly Clip[];
  readonly slot: number;
  /** Its walk, run and swim as gaits, where its asset gives each a stride; a swim without one plays at its own rate at the swim speed. */
  readonly walkGait: GaitClip | null;
  readonly runGait: GaitClip | null;
  readonly swimGait: GaitClip | null;
  /** Every moving clip it has, slowest first, when all of them have a stride and so blend in step. Otherwise empty. */
  readonly gaits: readonly GaitClip[];
  /** The bones a flinch, a gulp and a bite turn: of those each clip turns, the ones above its legs. */
  readonly flinchBones: Uint8Array;
  readonly eatBones: Uint8Array;
  readonly biteBones: Uint8Array;
  /** Radians a second at which its turn plays at its own rate. */
  readonly spinAt: number;
  /** Its flight's: taking off, hovering, flying, flying fast, gliding, diving, the barrel roll, limp in the air when knocked out, and dying in the air. */
  readonly takeOff: Clip | null;
  readonly hover: Clip | null;
  readonly fly: Clip | null;
  readonly flyFast: Clip | null;
  readonly glide: Clip | null;
  readonly dive: Clip | null;
  readonly roll: Clip | null;
  readonly torporFall: Clip | null;
  readonly deathAir: Clip | null;
  /** Layers: the bite in the air on its neck and head; its feet taking hold, holding and letting go. */
  readonly attackAir: Clip | null;
  readonly grab: Clip | null;
  readonly carry: Clip | null;
  readonly release: Clip | null;
  readonly airBiteBones: Uint8Array;
  readonly grabBones: Uint8Array;
  readonly carryBones: Uint8Array;
  readonly releaseBones: Uint8Array;
  /** Whether it flies on clips of its own, a hover or a fly. Without them it falls on its fall clip while it flies. */
  readonly flies: boolean;
  /** Ticks of one wing beat. Its hover and fly share it, each a beat a turn, so they blend with the wings together. */
  readonly beat: number;
  /** Metres a second at which its fly and fly_fast play alone: each one's stride over its length, as a gait's. */
  readonly flyAt: number;
  readonly fastAt: number;
  /** Where its body turns about in flight, in its model space: the middle of its joints at rest. */
  readonly pivot: Float64Array;
  /** The bone of its `head` socket, which it keeps nearer level in a bank, or -1. */
  readonly head: number;
  /** Its neck and head: that bone, those below it, and those above it up to where the body branches. */
  readonly neck: Uint8Array;

  readonly combat: CreatureCombatFacet | null;
  /** Whether it goes only forward or backward, its direction bits carrying its turn (TURN_STEPS); then its carriage in a turn. */
  readonly turns: boolean;
  readonly carriage: Carriage | null;
  readonly modeBones: Uint8Array;
  readonly primaryBones: Uint8Array | null;
  readonly secondaryBones: Uint8Array | null;
  readonly chargeGait: GaitClip | null;
  /** Nonidentity layer rotations on a foot or its ancestors/descendants, compiled once. */
  readonly footLayers: ReadonlyMap<Clip, Uint8Array>;

  constructor(rig: Rig, runAt: number, swimSpeed: number, combat: CreatureCombatFacet | null = null, turns = false) {
    this.combat = combat;
    this.turns = turns;
    // It walks at two thirds of the speed it runs from (Registry.runAt).
    this.carriage = turns && rig.sections.head >= 0 ? new Carriage(rig, (runAt * 2) / 3) : null;
    this.modeBones = Uint8Array.from({ length: rig.bones }, (_, i) => i);
    const mask = (names: readonly string[] | undefined): Uint8Array | null => names ? Uint8Array.from(names.map(n => rig.names.indexOf(n)).filter(n => n >= 0)) : null;
    this.primaryBones = mask(combat?.primary.bones);
    this.secondaryBones = mask(combat?.secondary?.bones);
    this.rig = rig;
    this.runAt = runAt;
    const named = (name: RigClip): Clip | null => rig.clips.get(name) ?? null;
    this.idle = named("idle");
    this.walk = named("walk");
    this.run = named("run");
    this.attack = named("attack");
    this.swim = named("swim");
    this.swimIdle = named("swim_idle");
    this.startledSwim = named("startled_swim");
    this.landSwim = named("land_swim");
    this.torporOutSwim = named("torpor_out_swim");
    this.fall = named("fall");
    this.land = named("land");
    this.turn = named("turn");
    this.turnRight = this.turn ? mirrored(this.turn, rig.names) : null;
    this.startled = named("startled");
    this.flinch = named("flinch");
    this.torporIn = named("torpor_in");
    this.torporIdle = named("torpor_idle");
    this.torporEat = named("torpor_eat");
    this.torporOut = named("torpor_out");
    this.death = named("death");
    this.held = named("held");
    this.carried = named("carried");
    const idles = [...rig.clips.keys()].filter((n) => /^idle_\w+$/.test(n)).sort().map((n) => rig.clips.get(n)!);
    this.call = named("call");
    if (this.call) idles.push(this.call);
    this.idles = this.idle ? idles : [];
    const longest = Math.max(0, ...this.idles.map((c) => c.frames - 1 + FADE));
    this.slot = this.idle ? this.idle.frames * Math.max(1, Math.ceil(longest / this.idle.frames)) : 1;
    const gait = (clip: Clip | null, name: RigClip): GaitClip | null => {
      const stride = rig.strides.get(name);
      return clip && clip.loop && stride !== undefined ? gaitClip(clip, stride, rig.feet.length > 0 ? footStart(rig, clip, rig.feet[0]!, rig.a, rig.solved) : 0, rig.footfalls.get(name) ?? null) : null;
    };
    this.walkGait = gait(this.walk, "walk");
    this.runGait = gait(this.run, "run");
    this.chargeGait = gait(named("charge"), "charge");
    const moving = [this.walk ? this.walkGait : undefined, this.run ? this.runGait : undefined].filter((g) => g !== undefined);
    this.gaits = moving.length > 0 && moving.every((g) => g !== null) ? (moving as GaitClip[]).sort((p, r) => p.speed - r.speed) : [];
    const swum = this.swim && this.swim.loop ? (rig.strides.get("swim") ?? (swimSpeed * this.swim.frames) / TICK_RATE) : 0;
    this.swimGait = swum > 0 ? gaitClip(this.swim!, swum, 0) : null;
    const legs = legBones(rig);
    const chains = new Uint8Array(rig.bones);
    for (const foot of rig.feet) for (let b = foot; b >= 0; b = rig.parent[b]!) chains[b] = 1;
    for (let b = 1; b < rig.bones; b++) if (legs[b]) chains[b] = 1;
    const excluded = Uint8Array.from(chains, on => 1 - on);
    const layers = new Map<Clip, Uint8Array>();
    const inspectLayer = (name: string | undefined) => {
      const clip = name ? rig.clips.get(name) : null;
      if (clip && !layers.has(clip)) layers.set(clip, turnedBones(clip, excluded));
    };
    inspectLayer("flinch"); inspectLayer("torpor_eat");
    if (this.primaryBones) { inspectLayer(combat?.primary.clip); inspectLayer(combat?.primary.alternateClip); }
    if (this.secondaryBones) { inspectLayer(combat?.secondary?.clip); inspectLayer("impale_hold"); inspectLayer("impale_out"); }
    for (const mode of combat?.modes ?? []) inspectLayer(mode.clip);
    this.footLayers = layers;
    this.flinchBones = this.flinch ? turnedBones(this.flinch, legs) : new Uint8Array(0);
    this.eatBones = this.torporEat ? turnedBones(this.torporEat, legs) : new Uint8Array(0);
    this.biteBones = this.attack ? turnedBones(this.attack, legs) : new Uint8Array(0);
    const socket = rig.sockets.get("hold_point");
    const held = this.held ?? this.idle;
    if (socket) {
      if (held) sampleClip(held, 0, rig.a);
      else rig.a.rest();
      solve(rig, rig.a, rig.solved);
      this.holdAt = new Float64Array(3);
      boneToModel(rig.solved, socket.bone, socket.x, socket.y, socket.z, this.holdAt);
    } else this.holdAt = null;
    this.spinAt = this.turn ? QUARTER / (Math.max(1, this.turn.frames - 1) / TICK_RATE) : 1;
    this.takeOff = named("take_off");
    this.hover = loop(named("hover"));
    this.fly = loop(named("fly"));
    this.flyFast = loop(named("fly_fast"));
    this.glide = loop(named("glide"));
    this.dive = loop(named("dive"));
    this.roll = named("barrel_roll");
    this.torporFall = named("torpor_fall");
    this.deathAir = named("death_air");
    this.attackAir = named("attack_air");
    this.grab = named("grab");
    this.carry = loop(named("carry"));
    this.release = named("release");
    const none = new Uint8Array(rig.bones);
    this.airBiteBones = this.attackAir ? turnedBones(this.attackAir, legs) : new Uint8Array(0);
    this.grabBones = this.grab ? turnedBones(this.grab, none) : new Uint8Array(0);
    this.carryBones = this.carry ? turnedBones(this.carry, none) : new Uint8Array(0);
    this.releaseBones = this.release ? turnedBones(this.release, none) : new Uint8Array(0);
    this.flies = this.hover !== null || this.fly !== null;
    this.beat = (this.fly ?? this.hover)?.frames ?? 1;
    const speedOf = (clip: Clip | null, name: RigClip, otherwise: number): number => {
      const stride = rig.strides.get(name);
      return clip && stride !== undefined ? (stride * TICK_RATE) / clip.frames : otherwise;
    };
    this.flyAt = speedOf(this.fly, "fly", FLY_AT);
    this.fastAt = Math.max(this.flyAt + 1, speedOf(this.flyFast, "fly_fast", FAST_AT));
    this.head = rig.sockets.get("head")?.bone ?? -1;
    const neck = branchOf(rig, this.head > 0 ? [this.head] : []);
    this.neck = Uint8Array.from(Array.from(neck).flatMap((on, b) => (on === 1 ? [b] : [])));
    this.pivot = new Float64Array(3);
    for (let b = 0; b < rig.bones; b++) {
      this.pivot[1]! += rig.rest[b * 3 + 1]! / rig.bones;
      this.pivot[2]! += rig.rest[b * 3 + 2]! / rig.bones;
    }
  }
}

/** A clip that loops, or null. */
function loop(clip: Clip | null): Clip | null {
  return clip && clip.loop ? clip : null;
}

/**
 * 1 for the root, and for each foot its leg: the foot, the bones below it, and those above it up to where the body
 * branches, so a hand a flyer stands on takes its fingers and not its wing, chest and neck.
 */
function legBones(rig: Rig): Uint8Array {
  const legs = branchOf(rig, rig.feet);
  legs[0] = 1;
  return legs;
}

/** 1 for each of `tips`, the bones below it, and those above it up to where the body branches; never the root. */
function branchOf(rig: Rig, tips: readonly number[]): Uint8Array {
  const on = new Uint8Array(rig.bones);
  const children = new Uint8Array(rig.bones);
  for (let b = 1; b < rig.bones; b++) children[rig.parent[b]!]!++;
  for (const tip of tips) {
    for (let b = tip; b > 0; b = rig.parent[b]!) {
      on[b] = 1;
      if (children[rig.parent[b]!]! > 1) break;
    }
  }
  const below = new Uint8Array(rig.bones);
  for (const tip of tips) below[tip] = 1;
  // Parents come before their children, so one pass carries a tip down to its ends.
  for (let b = 1; b < rig.bones; b++) if (below[rig.parent[b]!] === 1) below[b] = on[b] = 1;
  return on;
}

/** The bones `clip` turns away from rest in any frame, leaving out those marked in `legs`. */
function turnedBones(clip: Clip, legs: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let b = 0; b < clip.bones; b++) {
    if (legs[b] === 1) continue;
    for (let f = 0; f < clip.frames; f++) {
      const i = (f * clip.bones + b) * 4;
      if (Math.abs(clip.rot[i]!) > 1e-6 || Math.abs(clip.rot[i + 1]!) > 1e-6 || Math.abs(clip.rot[i + 2]!) > 1e-6) {
        out.push(b);
        break;
      }
    }
  }
  return Uint8Array.from(out);
}

/** `clip` with left and right swapped: bones named "_l" and "_r", or ".L" and ".R", trade places across the body's middle. */
function mirrored(clip: Clip, names: readonly string[]): Clip {
  const other = names.map((n, b) => {
    const m = n.replace(/([._])([lLrR])$/, (_, mark: string, side: string) => mark + ({ l: "r", r: "l", L: "R", R: "L" } as Record<string, string>)[side]);
    const i = names.indexOf(m);
    return i >= 0 ? i : b;
  });
  const rot = new Float32Array(clip.rot.length);
  const root = new Float32Array(clip.root.length);
  for (let f = 0; f < clip.frames; f++) {
    for (let b = 0; b < clip.bones; b++) {
      // Seen in a mirror across the x = 0 plane, a turn keeps its x and reverses its y and z.
      const from = (f * clip.bones + other[b]!) * 4;
      const to = (f * clip.bones + b) * 4;
      rot[to] = clip.rot[from]!;
      rot[to + 1] = -clip.rot[from + 1]!;
      rot[to + 2] = -clip.rot[from + 2]!;
      rot[to + 3] = clip.rot[from + 3]!;
    }
    root[f * 3] = -clip.root[f * 3]!;
    root[f * 3 + 1] = clip.root[f * 3 + 1]!;
    root[f * 3 + 2] = clip.root[f * 3 + 2]!;
  }
  return { id: `${clip.id}/mirrored`, bones: clip.bones, frames: clip.frames, loop: clip.loop, rot, root };
}

function smooth(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
}

/** The x in 0 to 1 at which smooth(x) is y. */
function unsmooth(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 20; k++) {
    const m = (lo + hi) / 2;
    if (smooth(m) < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** Ticks since `start`, the low byte of a tick. A moment drawn just before it counts as its first. */
function since(tick: number, start: number): number {
  const whole = Math.floor(tick);
  const s = ((whole & 255) - start) & 255;
  return s > 250 ? 0 : s + (tick - whole);
}

/**
 * Which of its idles plays at `t` ticks (its seed added) for a body with `seed`, or -1 for its idle itself. Each of its
 * `slot` ticks of standing is a turn, and half the turns, by a hash of the turn and the seed, play one of its idles.
 */
export function idleOf(a: CreatureAnim, seed: number, t: number): number {
  const n = a.idles.length;
  if (n === 0) return -1;
  let h = Math.imul(Math.floor(t / a.slot) | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = (h ^ (h >>> 15)) >>> 0;
  return (h & 1) === 0 ? -1 : (h >>> 1) % n;
}

/**
 * Plays `clip` `s` ticks in over what `out` holds, which is what plays after it. It comes in over `fade` ticks from
 * `from`, what played before it (`out` itself where null), and after its last frame goes out into `out` over FADE ticks.
 */
function oneShot(rig: Rig, clip: Clip, s: number, out: Pose, from: Pose | null, fade = FADE): void {
  const end = clip.frames - 1;
  if (s >= end + FADE) return;
  if (s >= fade && s <= end) {
    sampleClip(clip, s, out);
    return;
  }
  sampleClip(clip, s < end ? s : end, rig.f);
  if (s <= end) blendPose(out, from ?? out, rig.f, smooth(s / fade));
  else blendPose(out, rig.f, out, smooth((s - end) / FADE));
}

/**
 * Turns each of `bones` further by `clip` at `frame`, in the bone's own frame: the turn it has first, then the layer's,
 * by the share `w` of it. A looping clip wraps.
 */
export function layer(out: Pose, clip: Clip, frame: number, bones: Uint8Array, w = 1): void {
  const n = clip.frames;
  const f = clip.loop ? frame - Math.floor(frame / n) * n : frame < 0 ? 0 : frame > n - 1 ? n - 1 : frame;
  const f0 = Math.floor(f);
  const t = f - f0;
  const f1 = f0 + 1 < n ? f0 + 1 : clip.loop ? 0 : f0;
  const rot = clip.rot;
  r[0] = r[1] = r[2] = 0;
  r[3] = 1;
  for (let k = 0; k < bones.length; k++) {
    const b = bones[k]!;
    const a = (f0 * clip.bones + b) * 4;
    if (t === 0) for (let c = 0; c < 4; c++) q[c] = rot[a + c]!;
    else quatNlerp(q, 0, rot, a, rot, (f1 * clip.bones + b) * 4, t);
    if (w < 1) quatNlerp(q, 0, r, 0, q, 0, w);
    quatMul(out.rot, b * 4, out.rot, b * 4, q, 0);
  }
}

/** The gaits that carry it on foot at `speed`. Where every moving clip has a stride they all blend. Otherwise it walks below `runAt` and runs from it, and a clip with no stride is played by time: null then. */
function movesAt(a: CreatureAnim, speed: number): readonly GaitClip[] | null {
  if (a.gaits.length > 0) return a.gaits;
  const g = a.run && (speed >= a.runAt || !a.walk) ? a.runGait : a.walkGait;
  if (!g) return null;
  single[0] = g;
  return single;
}

/** Whether it floats on its swim clips. Without them a swimmer moves as it does on foot. */
function afloat(a: CreatureAnim, st: AnimState): boolean {
  return st.mode === MODE_SWIM && a.swimGait !== null;
}

/** Whether it flies on its own flight clips, which are played by the tick and never by distance. */
function aloft(a: CreatureAnim, st: AnimState): boolean {
  return st.mode === MODE_FLYER && a.flies;
}

/** The stride of its legs at `speed`, 0 where they are not played by distance. Fills rig.w with the gaits' shares. */
export function creatureStride(a: CreatureAnim, st: AnimState, speed: number): number {
  if (a.combat?.charge && (st.action & 7) === ACT_HOLD && a.chargeGait) return a.chargeGait.stride;
  if (aloft(a, st)) {
    a.rig.w.fill(0);
    return 0;
  }
  if (afloat(a, st)) {
    single[0] = a.swimGait!;
    return gaitShares(single, speed, true, a.rig.w);
  }
  const moves = movesAt(a, speed);
  // The idle takes what the slowest leaves, but not under a run that only a walk played by time comes before.
  return moves ? gaitShares(moves, speed, moves !== single || moves[0] === a.walkGait, a.rig.w) : 0;
}

/** Whether a layer changes a leg chain, including a body ancestor above its branch. */
function movesFeet(a: CreatureAnim, clip: Clip | null | undefined, bones: Uint8Array): boolean {
  if (!clip) return false;
  const turns = a.footLayers.get(clip);
  if (turns) for (const b of turns) if (bones.includes(b)) return true;
  return false;
}

/** Contact domain of this exact pose, captured only when its skeleton is sampled. */
export function creatureFootfallDomain(a: CreatureAnim, st: AnimState, tick: number): number {
  if (!st.grounded || st.mode === MODE_SWIM || st.mode === MODE_FLYER || st.out || st.dead || st.held) return FOOTFALL_NONE;
  const act = st.action & 7, s = since(tick, st.actionStart), c = a.combat;
  // Legacy strike intentionally uses its original unsigned elapsed tick, including just-before-start snapshots.
  const strikeAge = (((Math.floor(tick) & 255) - st.actionStart) & 255) + (tick - Math.floor(tick));
  const clip = c ? groundClip(a, st) : act === ACT_SWING && a.attack && strikeAge < a.attack.frames - 1 ? a.attack : null;
  let charge = false;
  if (clip) {
    const bones = c ? groundMask(a, act) : null;
    charge = !!(c?.charge && act === ACT_HOLD && a.chargeGait);
    if (!charge && (bones ? movesFeet(a, clip, bones) : !c || act === ACT_HOLD || s < clip.frames - 1 + FADE)) return FOOTFALL_NONE;
  } else {
    const elapsed = since(tick, st.cueStart);
    if (st.cue === CUE_TORPOR) {
      if (a.torporOut ? elapsed < a.torporOut.frames - 1 + FADE : elapsed < GET_UP && (a.torporIdle || a.death)) return FOOTFALL_NONE;
    } else {
      const reaction = st.cue === CUE_STARTLE ? a.startled : st.cue === CUE_LAND ? a.land : null;
      if (reaction && elapsed < reaction.frames - 1 + FADE) return FOOTFALL_NONE;
    }
  }
  const modes = c?.modes;
  if (modes?.length) {
    const mode = ((st.action >> 4) & 3) % modes.length;
    const old = act === ACT_EQUIP && s >= Math.floor((c!.switchTicks ?? 30) / 2) ? (mode + modes.length - 1) % modes.length : mode;
    if (movesFeet(a, a.rig.clips.get(modes[old]!.clip), a.modeBones) || act === ACT_EQUIP && movesFeet(a, a.rig.clips.get(modes[(old + 1) % modes.length]!.clip), a.modeBones)) return FOOTFALL_NONE;
  }
  const layerClip = st.layer === LAYER_FLINCH ? a.flinch : st.layer === LAYER_EAT ? a.torporEat : null;
  if (layerClip && since(tick, st.layerStart) < layerClip.frames - 1 && movesFeet(a, layerClip, st.layer === LAYER_FLINCH ? a.flinchBones : a.eatBones)) return FOOTFALL_NONE;
  // A carried load replaces the legs' gait; release may retain that replacement while it fades.
  if ((st.action >>> 3) === HOLD_CARRY && a.carry || act === ACT_EQUIP && s < (a.release ? a.release.frames - 1 : FADE) && (a.carry || a.release)) return FOOTFALL_NONE;
  if (charge) return FOOTFALL_CHARGE;
  return backward(st.dir) ? FOOTFALL_REVERSE : FOOTFALL_FORWARD;
}

/** Actual authored contact moments in the captured domain, as bone/phase pairs. No metadata retains legacy cadence. */
export function creatureFootfalls(a: CreatureAnim, domain: number, speed: number, out: Float64Array): number {
  if (domain === FOOTFALL_NONE) return 0;
  const charge = domain === FOOTFALL_CHARGE && a.chargeGait;
  if (charge) single[0] = charge;
  const moves = charge ? single : movesAt(a, speed), feet = a.rig.feet;
  if (!moves || feet.length * 2 > out.length || !(speed > 0)) return 0;
  const w = a.rig.w;
  if (charge) w[0] = 1;
  else gaitShares(moves, speed, moves !== single || moves[0] === a.walkGait, w);
  const backward = domain === FOOTFALL_REVERSE;
  for (let f = 0; f < feet.length; f++) {
    const bone = feet[f]!;
    let first = -1, sum = 0, total = 0;
    for (let i = 0; i < moves.length; i++) {
      const weight = w[i]!;
      if (!(weight > 0)) continue;
      const g = moves[i]!, rows = g.footfalls;
      if (!rows) return 0;
      let at = -1;
      for (let j = 0; j < rows.length; j++) if (rows[j]!.bone === bone) { at = j; break; }
      if (at < 0) return 0;
      const row = rows[at]!;
      let phase = backward ? g.start - row.lift : row.plant - g.start;
      phase -= Math.floor(phase);
      if (first < 0) first = phase;
      // Blend contact phase across the shorter part of the circle, just as aligned clips blend their poses.
      const delta = phase - first;
      sum += (first + delta - Math.floor(delta + .5)) * weight;
      total += weight;
    }
    if (!(total > 0)) return 0;
    const phase = sum / total;
    out[f * 2] = bone; out[f * 2 + 1] = phase - Math.floor(phase);
  }
  return feet.length;
}

/**
 * Moves a body's gait on to where it is drawn at `tick`, (x, z) facing `yaw` radians, `size` times as large as it was
 * made. A body seen for the first time starts at the phase the server poses it at. One with a clip to turn on the spot
 * does not step round with its walk.
 */
export function advanceCreature(a: CreatureAnim, g: Gait, st: AnimState, tick: number, x: number, z: number, yaw: number, size: number, distanceScale = 1): void {
  const before = g.tick;
  const metres = g.track(x, z, yaw, tick, st.speed * (st.mode === MODE_FLYER ? FLY_SPEED_STEP : SPEED_STEP), a.turn ? 0 : a.rig.turn, size, distanceScale, !aloft(a, st));
  if (metres < 0) g.phase = tickPhase(tick + st.seed, g.speed, creatureStride(a, st, g.speed));
  else g.step(metres, creatureStride(a, st, g.speed));
  // Out of the air they are kept as it last flew, for a landing to come in from.
  if (!aloft(a, st)) return;
  // A flyer's shares and roll come to what its state says over SHARE_EASE, so a step of what it is sent is no jump.
  airShares(a, st, st.speed * FLY_SPEED_STEP);
  const roll = bankRoll(st);
  const seconds = (tick - before) / TICK_RATE;
  const k = metres < 0 || !(g.hover >= 0) || !(seconds > 0) ? 1 : seconds / (SHARE_EASE + seconds);
  g.hover = eased(g.hover, shares.hover, k);
  g.fast = eased(g.fast, shares.fast, k);
  g.glide = eased(g.glide, shares.gliding, k);
  g.dive = eased(g.dive, shares.diving, k);
  g.roll = eased(g.roll, roll, k);
}

/**
 * Radians it rolls to its right for its bank, the angle its facing leads the way it travels: most at the first steps,
 * since at its flying speed its velocity keeps within a step of its facing however hard it turns, up to BANK_MOST.
 */
function bankRoll(st: AnimState): number {
  const k = 1 - Math.abs(st.bank) / BANK_STEPS;
  return (st.bank > 0 ? -BANK_MOST : BANK_MOST) * (1 - k * k);
}

/** `from` moved by `k` of the way to `to`, and at it once within a hundredth, so a client settles on what the server poses. */
function eased(from: number, to: number, k: number): number {
  const d = to - from;
  return k >= 1 || (d < 0.01 && d > -0.01) ? to : from + d * k;
}

/** Its idle, and now and then one of its idles in place of it, chosen by the tick `t` (seed added) and its seed. */
function idleAt(a: CreatureAnim, seed: number, t: number, out: Pose): void {
  const idle = a.idle;
  if (!idle) {
    out.rest();
    return;
  }
  const which = idleOf(a, seed, t);
  if (which < 0) {
    sampleClip(idle, t, out);
    return;
  }
  const clip = a.idles[which]!;
  const s = t - Math.floor(t / a.slot) * a.slot;
  if (s >= FADE && s <= clip.frames - 1) {
    sampleClip(clip, s, out);
    return;
  }
  sampleClip(idle, t, out);
  oneShot(a.rig, clip, s, out, null);
}

/** Standing and moving on its gaits, by the tick `t` (seed added) or by `gait`, which also turns it on the spot. */
function onFoot(a: CreatureAnim, st: AnimState, t: number, out: Pose, gait: Gait | null, distanceScale = 1): void {
  const rig = a.rig;
  const speed = gait ? gait.speed : st.speed * SPEED_STEP * distanceScale;
  const moves = speed > 0 ? movesAt(a, speed) : null;
  const clip = speed > 0 && !moves ? (speed >= a.runAt && a.run ? a.run : (a.walk ?? a.run)) : null;
  const stride = moves ? creatureStride(a, st, speed) : 0;
  // The idle is under whatever share the gaits leave.
  if (moves ? rig.w[0]! + (moves.length > 1 ? rig.w[1]! : 0) < 1 : !clip || (speed < EASE_IN && clip === a.walk)) {
    idleAt(a, st.seed, t, out);
    const share = gait && a.turn && st.speed === 0 ? Math.abs(gait.spin) / a.spinAt : 0;
    if (share > 0.01) {
      // Turning where it stands, by the angle turned: one turn of the clip a quarter turn.
      const turns = Math.abs(gait!.turned) / QUARTER;
      const turn = gait!.turned >= 0 ? a.turn! : a.turnRight!;
      sampleClip(turn, (turn.frames - 1) * unsmooth(turns - Math.floor(turns)), rig.d);
      blendPose(out, out, rig.d, share < 1 ? share : 1);
    }
  }
  // Moving away from where it faces, it plays its gait in reverse.
  const back = backward(st.dir);
  if (moves) playGaits(moves, rig.w, gait ? gait.phase : tickPhase(t, speed, stride), back, out, rig.b, rig.c);
  else if (clip && speed < EASE_IN && a.idle && clip === a.walk) {
    sampleClip(clip, back ? -t : t, rig.b);
    blendPose(out, out, rig.b, speed / EASE_IN);
  } else if (clip) sampleClip(clip, back ? -t : t, out);
}

function clamp01(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : x;
}

/**
 * Where its wing beat is at `tick`, in turns from the top of a stroke. A take-off ends at the top of a stroke; for a beat
 * after it the beat comes from there into the one its clock gives, a little quicker or slower, so the wings never jump.
 */
function beatAt(a: CreatureAnim, st: AnimState, tick: number): number {
  const clock = (tick + st.seed) / a.beat;
  if (st.cue === CUE_TAKEOFF && a.takeOff) {
    const s = since(tick, st.cueStart);
    const end = a.takeOff.frames - 1;
    if (s < end + a.beat) {
      const own = (s - end) / a.beat;
      let d = clock - own;
      d -= Math.round(d);
      const turns = s <= end ? own : own + d * smooth((s - end) / a.beat);
      return turns - Math.floor(turns);
    }
  }
  return clock - Math.floor(clock);
}

/** Plays `clip` at `frame` over `out` by the share `w`, or whole where `out` holds nothing yet (`held`). Returns whether it holds a pose now. */
function mix(a: CreatureAnim, clip: Clip | null, frame: number, w: number, out: Pose, held: boolean): boolean {
  if (!clip || !(w > 0)) return held;
  if (!held || w >= 1) sampleClip(clip, frame, out);
  else {
    sampleClip(clip, frame, a.rig.b);
    blendPose(out, out, a.rig.b, w);
  }
  return true;
}

/** A flyer's shares of each way it flies, as `airShares` finds them from its state. */
const shares = { hover: 0, fast: 0, gliding: 0, diving: 0 };

/**
 * Below its flying speed it hovers, toward its sprint it flaps fast, looking down it glides and then dives, and going down
 * without looking down it sinks on its wings as it hovers.
 */
function airShares(a: CreatureAnim, st: AnimState, speed: number): void {
  const down = (-st.pitch / PITCH_STEPS) * (PI / 2);
  shares.gliding = smooth((down - GLIDE_FROM) / (GLIDE_TO - GLIDE_FROM));
  shares.diving = smooth((down - DIVE_FROM) / (DIVE_TO - DIVE_FROM));
  const sinking = (st.climb === CLIMB_DIVE ? 1 : st.climb === CLIMB_DOWN ? 0.5 : 0) * (1 - shares.gliding) * (1 - clamp01((speed - SINK_MOST) / (SINK_NONE - SINK_MOST)));
  shares.hover = Math.max(1 - clamp01(speed / a.flyAt), sinking);
  shares.fast = clamp01((speed - a.flyAt) / (a.fastAt - a.flyAt));
}

/**
 * Its flight at `speed` metres a second, by the shares that gives or, drawn by a client, those its gait eased: its beat
 * flapped at its flying speed, fast toward its sprint, hovering, gliding and diving. Its body is pitched with its look and
 * rolled into its turn, and turned over by a barrel roll.
 */
function flight(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null, speed: number): void {
  const t = tick + st.seed;
  airShares(a, st, speed);
  const drawn = gait !== null && gait.hover >= 0;
  const hover = drawn ? gait.hover : shares.hover;
  const spread = 1 - hover;
  const look = (st.pitch / PITCH_STEPS) * (PI / 2);
  const u = beatAt(a, st, tick);
  let held = mix(a, a.fly, u * (a.fly?.frames ?? 0), 1, out, false);
  held = mix(a, a.flyFast, t, drawn ? gait.fast : shares.fast, out, held);
  held = mix(a, a.hover, u * (a.hover?.frames ?? 0), hover, out, held);
  held = mix(a, a.glide, t, (drawn ? gait.glide : shares.gliding) * spread, out, held);
  held = mix(a, a.dive, t, (drawn ? gait.dive : shares.diving) * spread, out, held);
  if (!held) mix(a, a.fly ?? a.hover, u * (a.fly ?? a.hover)!.frames, 1, out, false);
  const bank = (drawn ? gait.roll : bankRoll(st)) * spread;
  let roll = bank;
  if (st.cue === CUE_ROLL) {
    const s = since(tick, st.cueStart);
    if (a.roll) oneShot(a.rig, a.roll, s, out, null);
    // One whole turn, to the side its seed gives it.
    else if (s < ROLL_TICKS) roll += ((st.seed & 1) === 0 ? TAU : -TAU) * smooth(s / ROLL_TICKS);
  }
  const pitch = look > PITCH_UP ? PITCH_UP : look < -PITCH_DOWN ? -PITCH_DOWN : look;
  turnBody(a, out, pitch * spread, roll);
  // It holds its head nearer level than its body in a bank, rolled back about its own length.
  if (a.head >= 0 && bank !== 0) {
    quatAxis(q, 0, 0, 0, 1, -HEAD_LEVEL * bank);
    quatMul(out.rot, a.head * 4, out.rot, a.head * 4, q, 0);
  }
}

/** Turns its whole body about its pivot, pitched up by `pitch` and rolled to its right about its own length by `roll`, in radians. */
function turnBody(a: CreatureAnim, pose: Pose, pitch: number, roll: number): void {
  if (pitch === 0 && roll === 0) return;
  quatAxis(q, 0, 1, 0, 0, -pitch);
  quatAxis(r, 0, 0, 0, 1, roll);
  quatMul(q, 0, q, 0, r, 0);
  quatMul(pose.rot, 0, q, 0, pose.rot, 0);
  const rest = a.rig.rest;
  const c = a.pivot;
  quatRotate(q, 0, rest[0]! + pose.root[0]! - c[0]!, rest[1]! + pose.root[1]! - c[1]!, rest[2]! + pose.root[2]! - c[2]!, v, 0);
  for (let k = 0; k < 3; k++) pose.root[k] = v[k]! + c[k]! - rest[k]!;
}

const was = new AnimState();

/**
 * A flyer's flight just before it came down or was knocked out, from what it does now: flying level at the speed it
 * still goes over the ground, so one that skimmed in still flaps and one that sank in hovers. Drawn by a client, it is
 * flown as its gait last had it.
 */
function airborne(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null): void {
  was.mode = MODE_FLYER;
  was.grounded = false;
  was.pitch = st.pitch;
  was.seed = st.seed;
  flight(a, was, tick, out, gait, st.speed * (st.mode === MODE_FLYER ? FLY_SPEED_STEP : SPEED_STEP));
}

/** What it does throughout, by the tick: lies knocked out when `lying` (limp while it falls), else flies, floats, falls, or stands and moves. */
function steady(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null, lying: boolean, distanceScale = 1): void {
  const t = tick + st.seed;
  if (lying && a.torporFall && !st.grounded && st.mode !== MODE_SWIM) sampleClip(a.torporFall, t, out);
  else if (lying && a.torporIdle) sampleClip(a.torporIdle, t, out);
  else if (lying && a.death) sampleClip(a.death, a.death.frames - 1, out);
  else if (aloft(a, st)) flight(a, st, tick, out, gait, st.speed * FLY_SPEED_STEP);
  else if (afloat(a, st)) {
    const speed = gait ? gait.speed : st.speed * SPEED_STEP;
    const stride = creatureStride(a, st, speed);
    if (a.rig.w[0]! < 1) {
      const still = a.swimIdle ?? a.idle;
      if (still) sampleClip(still, t, out);
      else out.rest();
    }
    single[0] = a.swimGait!;
    playGaits(single, a.rig.w, gait ? gait.phase : tickPhase(t, speed, stride), false, out, a.rig.b, a.rig.c);
  } else if (!st.grounded && a.fall) sampleClip(a.fall, t, out);
  else onFoot(a, st, t, out, gait, distanceScale);
}

/** Its bite, from the tick it began, for the length of its clip. False when none is under way. */
function strike(a: CreatureAnim, st: AnimState, tick: number, out: Pose): boolean {
  if ((st.action & 7) !== ACT_SWING || !a.attack) return false;
  const s = (((Math.floor(tick) & 255) - st.actionStart) & 255) + (tick - Math.floor(tick));
  if (s >= a.attack.frames - 1) return false;
  sampleClip(a.attack, s, out);
  return true;
}

/** Ground action selection shared by posing and contact eligibility. */
function groundClip(a: CreatureAnim, st: AnimState): Clip | null {
  const c = a.combat!, act = st.action & 7, side = (st.action >> 3) & 1;
  const name = act === ACT_SWING ? (side && c.primary.alternateClip ? c.primary.alternateClip : c.primary.clip)
    : act === ACT_RELOAD ? c.secondary?.clip : act === ACT_DRAW ? "charge_windup"
    : act === ACT_HOLD ? (c.charge ? "charge" : "impale_hold")
    : act === ACT_COOL ? (c.charge ? "charge_stop" : "impale_out") : act === ACT_EQUIP ? "plate_switch" : undefined;
  return name ? a.rig.clips.get(name) ?? null : null;
}
function groundMask(a: CreatureAnim, act: number): Uint8Array | null {
  return act === ACT_SWING ? a.primaryBones : !a.combat!.charge && (act === ACT_RELOAD || act === ACT_HOLD || act === ACT_COOL) ? a.secondaryBones : null;
}

/** Ground action names are content; action/hold/start are the same words on authority and observers. */
function groundAction(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null, distanceScale = 1): boolean {
  const c = a.combat!, act = st.action & 7, s = since(tick, st.actionStart), clip = groundClip(a, st);
  if (!clip) return false;
  const bones = groundMask(a, act);
  if (act === ACT_HOLD && c.charge && a.chargeGait) {
    const phase = gait ? gait.phase : tickPhase(tick + st.seed, st.speed * SPEED_STEP * distanceScale, a.chargeGait.stride);
    single[0] = a.chargeGait;
    a.rig.w.fill(0); a.rig.w[0] = 1;
    playGaits(single, a.rig.w, phase, false, out, a.rig.b, a.rig.c);
  } else if (bones) layer(out, clip, s, bones);
  else if (act === ACT_HOLD) sampleClip(clip, s, out);
  else oneShot(a.rig, clip, s, out, null);
  return true;
}

function plateMode(a: CreatureAnim, st: AnimState, tick: number, out: Pose): void {
  const c = a.combat!, modes = c.modes;
  if (!modes?.length) return;
  const mode = ((st.action >> 4) & 3) % modes.length;
  const act = st.action & 7;
  if (act === ACT_EQUIP) {
    const s = since(tick, st.actionStart), total = c.switchTicks ?? 30;
    const old = s < Math.floor(total / 2) ? mode : (mode + modes.length - 1) % modes.length;
    const next = (old + 1) % modes.length, k = smooth(Math.min(1, s / total));
    const before = a.rig.clips.get(modes[old]!.clip), after = a.rig.clips.get(modes[next]!.clip);
    if (before) layer(out, before, 0, a.modeBones, 1 - k);
    if (after) layer(out, after, 0, a.modeBones, k);
  } else {
    const clip = a.rig.clips.get(modes[mode]!.clip);
    if (clip) layer(out, clip, 0, a.modeBones);
  }
}

/**
 * Fills `out` with its pose at `tick`, which may fall between ticks. With `gait` its legs are where that says, and without
 * it where the tick puts them.
 */
export function creaturePose(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null = null, distanceScale = 1): void {
  const rig = a.rig;
  // Held, nothing that plays on its feet plays, unless it is knocked out.
  if (st.held && !st.out) inArms(a, st, tick, out);
  else steady(a, st, tick, out, gait, st.out, distanceScale);
  if (st.out) {
    const s = since(tick, st.cueStart);
    if (st.cue === CUE_LAND) {
      // Come down from its limp fall, it lies down from that.
      if (s < FADE && a.torporFall && st.grounded) {
        sampleClip(a.torporFall, tick + st.seed, rig.e);
        blendPose(out, rig.e, out, smooth(s / FADE));
      }
    } else if (st.cue !== CUE_TORPOR) {
      // Out cold.
    } else if (a.torporFall && !st.grounded && st.mode !== MODE_SWIM) {
      // Knocked out off the ground it goes limp from what it was doing there.
      if (s < FADE) {
        if (a.flies) airborne(a, st, tick, rig.e, gait);
        else steady(a, st, tick, rig.e, gait, false, distanceScale);
        blendPose(out, rig.e, out, smooth(s / FADE));
      }
    } else {
      // Going down, from what it was doing into lying. Without its own clip it falls as it dies.
      const clip = a.torporIn ?? a.death;
      if (clip) {
        if (s < FADE) steady(a, st, tick, rig.e, gait, false, distanceScale);
        oneShot(rig, clip, s, out, rig.e);
      }
    }
  } else if (!st.held) {
    if (aloft(a, st)) {
      if (st.cue === CUE_TAKEOFF && a.takeOff) {
        // From the crouch it stands in, up into its flight. It begins where it stood and holds the ground as the step lifts
        // it, so it comes in at once, as a fade would float its planted hands and feet up with the body; only its neck and
        // head come round from where its idle had them.
        const s = since(tick, st.cueStart);
        oneShot(rig, a.takeOff, s, out, null, 0);
        if (s < FADE) {
          idleAt(a, st.seed, tick + st.seed, rig.e);
          const k = smooth(s / FADE);
          for (let i = 0; i < a.neck.length; i++) quatNlerp(out.rot, a.neck[i]! * 4, rig.e.rot, a.neck[i]! * 4, out.rot, a.neck[i]! * 4, k);
        }
      }
      biteAloft(a, st, tick, out);
    } else if (!(a.combat ? groundAction(a, st, tick, out, gait, distanceScale) : strike(a, st, tick, out))) {
      if (st.cue === CUE_TORPOR) gettingUp(a, st, tick, out);
      else if (st.cue === CUE_ROAR && a.call) {
        const elapsed = since(tick, st.cueStart);
        if (elapsed < a.call.frames - 1 + FADE) {
          // The moving body keeps its planted feet. As it stops, its torso joins the neck and jaw in the call.
          const body = 1 - Math.min(1, (gait?.speed ?? st.speed * SPEED_STEP) / EASE_IN);
          blendPose(rig.e, out, out, 0);
          oneShot(rig, a.call, elapsed, rig.e, null);
          blendPose(out, out, rig.e, body);
          for (const bone of a.neck) blendPose(out, out, rig.e, 1, bone, bone + 1);
        }
      }
      else if (st.cue === CUE_LAND && a.flies && st.mode === MODE_SWIM) {
        // Set down on the water, from the air into floating.
        const s = since(tick, st.cueStart);
        if (s < FADE) {
          airborne(a, st, tick, rig.e, gait);
          blendPose(out, rig.e, out, smooth(s / FADE));
        }
      } else if (st.cue === CUE_STARTLE || st.cue === CUE_LAND) {
        const water = st.mode === MODE_SWIM;
        const clip = st.cue === CUE_STARTLE ? water ? a.startledSwim : a.startled : water ? a.landSwim : a.land;
        const s = since(tick, st.cueStart);
        // A landing comes in from the air, or from the fall.
        const fade = st.cue === CUE_LAND && a.flies ? LAND_FADE : FADE;
        let from: Pose | null = null;
        if (!water && st.cue === CUE_LAND && s < fade) {
          if (a.flies) airborne(a, st, tick, (from = rig.e), gait);
          else if (a.fall) sampleClip(a.fall, tick + st.seed, (from = rig.e));
        }
        if (clip) oneShot(rig, clip, s, out, from, fade);
      }
    }
    talons(a, st, tick, out);
  }
  if (a.combat && !st.out && !st.held) plateMode(a, st, tick, out);
  // Turning on its feet, it bends, leads and leans into the turn.
  if (a.carriage && !st.out && !st.held && !st.dead && st.grounded && st.mode === MODE_WALK) a.carriage.apply(st, out);
  if (st.layer === LAYER_NONE) return;
  // A flinch or a gulp, over whatever the rest of it does.
  const clip = st.layer === LAYER_FLINCH ? a.flinch : st.layer === LAYER_EAT ? a.torporEat : null;
  const s = clip ? since(tick, st.layerStart) : 0;
  if (clip && s < clip.frames - 1) layer(out, clip, s, st.layer === LAYER_FLINCH ? a.flinchBones : a.eatBones);
}

/** In a survivor's arms: its clip for that, and its bite over the bones above its legs, so it pecks from the arms. */
function inArms(a: CreatureAnim, st: AnimState, tick: number, out: Pose): void {
  const clip = a.held ?? a.idle;
  if (clip) sampleClip(clip, tick + st.seed, out);
  else out.rest();
  if ((st.action & 7) === ACT_SWING) peck(a, since(tick, st.actionStart), out);
}

/** Its bite `s` ticks in over the bones above its legs, in over two ticks and out over three, as a survivor's swing. */
function peck(a: CreatureAnim, s: number, out: Pose): void {
  if (!a.attack) return;
  const end = a.attack.frames - 1;
  const k = Math.min(1, s / 2, (end - s) / 3);
  if (k <= 0) return;
  const f = a.rig.f;
  sampleClip(a.attack, s, f);
  const bones = a.biteBones;
  for (let i = 0; i < bones.length; i++) quatNlerp(out.rot, bones[i]! * 4, out.rot, bones[i]! * 4, f.rot, bones[i]! * 4, k);
}

/** Its bite in the air, on its neck and head: its own clip turned further onto its flight, or else its bite on the ground. */
function biteAloft(a: CreatureAnim, st: AnimState, tick: number, out: Pose): void {
  if ((st.action & 7) !== ACT_SWING) return;
  const s = since(tick, st.actionStart);
  if (!a.attackAir) peck(a, s, out);
  else if (s < a.attackAir.frames - 1) layer(out, a.attackAir, s, a.airBiteBones);
}

/**
 * Its feet round what it carries in them, its hold HOLD_CARRY: taking hold as an equip begins with that hold, then holding,
 * and letting go as an equip begins with any other, each turned further onto its legs.
 */
function talons(a: CreatureAnim, st: AnimState, tick: number, out: Pose): void {
  if (!a.carry && !a.grab && !a.release) return;
  const equip = (st.action & 7) === ACT_EQUIP;
  const s = equip ? since(tick, st.actionStart) : Infinity;
  if (st.action >>> 3 === HOLD_CARRY) {
    const taking = a.grab !== null && s < a.grab.frames - 1;
    if (a.carry) holding(a, tick + st.seed, out, taking ? s / (a.grab!.frames - 1) : 1);
    if (taking) layer(out, a.grab!, s, a.grabBones);
  } else if (equip) {
    const end = a.release ? a.release.frames - 1 : FADE;
    if (s >= end) return;
    if (a.carry) holding(a, tick + st.seed, out, 1 - s / end);
    if (a.release) layer(out, a.release, s, a.releaseBones);
  }
}

/** The carry laid in place of the legs' own turns by the share `w`, so the stroke's leg swing does not carry the grip off the load. */
function holding(a: CreatureAnim, t: number, out: Pose, w: number): void {
  const f = a.rig.f;
  sampleClip(a.carry!, t, f);
  const bones = a.carryBones;
  for (let i = 0; i < bones.length; i++) quatNlerp(out.rot, bones[i]! * 4, out.rot, bones[i]! * 4, f.rot, bones[i]! * 4, w);
}

/** Getting up, from lying into what it does now. Without its own clip it rises over GET_UP ticks. */
function gettingUp(a: CreatureAnim, st: AnimState, tick: number, out: Pose): void {
  const rig = a.rig;
  const s = since(tick, st.cueStart);
  if (st.mode === MODE_SWIM) {
    // A ground get-up rolls onto planted feet and can submerge a swimming animal's nose. A water recovery is
    // authored around its awake float pose; without one, retain that pose instead of blending from ground lying.
    if (a.torporOutSwim) oneShot(rig, a.torporOutSwim, s, out, null);
    return;
  }
  if (a.torporOut) {
    if (s < FADE) steady(a, st, tick, rig.e, null, true);
    oneShot(rig, a.torporOut, s, out, rig.e);
  } else if (s < GET_UP && (a.torporIdle || a.death)) {
    steady(a, st, tick, rig.e, null, true);
    blendPose(out, rig.e, out, smooth(s / GET_UP));
  }
}

/**
 * Returns the zone a ray hits, or 0. The creature stands at (bx, by, bz) facing `yaw` (1/65536 turns). The ray starts at
 * (ox, oy, oz) and runs along the unit direction (dx, dy, dz) no farther than `maxT`. `zoneHit` holds the bone and the distance.
 */
export function rayCreature(a: CreatureAnim, st: AnimState, tick: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, padding = 0, world?: CollisionWorld, size = 1): number {
  const rig = a.rig;
  // Most rays miss the bounding sphere, so test that first.
  const cx = bx - ox;
  const cy = by + rig.mid - oy;
  const cz = bz - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const off2 = cx * cx + cy * cy + cz * cz - along * along;
  if (off2 > (rig.reach + padding) * (rig.reach + padding) || along < -rig.reach - padding || along > maxT + rig.reach + padding) {
    zoneHit.zone = 0;
    zoneHit.bone = -1;
    zoneHit.t = maxT;
    return 0;
  }
  // Move the ray into the body's space by undoing its position, then its yaw. Yaw is x' = c x + s z, z' = c z - s x.
  const r = (yaw * TAU) / 65536;
  poseCreatureOn(a, st, tick, world, bx, by, bz, r, size);
  const s = detSin(r);
  const c = detCos(r);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(rig, rig.solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT, padding);
}

/** Authored pose, slope-aware stride rate and spatial support shared by drawing, seats and authoritative contacts. */
export function poseCreatureOn(a: CreatureAnim, st: AnimState, tick: number, world: CollisionWorld | null | undefined, x: number, y: number, z: number, yaw: number, size = 1, gait: Gait | null = null, solved: Solved = a.rig.solved, adjust: ((pose: Pose) => void) | null = null): void {
  const rig = a.rig;
  creaturePose(a, st, tick, rig.a, gait, groundSpeedScale(rig, st, world, x, y, z, yaw, size, a.turns) / size);
  // A drawing's own turns before the pose is solved (client/core/render/impact-springs.ts); the server passes none.
  adjust?.(rig.a);
  solve(rig, rig.a, solved);
  conformCreature(rig, st, rig.a, solved, world, x, y, z, yaw, size);
  if (world && !st.dead && !st.out) turnAside(rig, rig.a, solved, world, x, y, z, yaw, size);
}

/** Metres short of a wall at which a head begins to turn from it, and the most its neck turns, in radians. */
const ASIDE_SLACK = 0.3;
const ASIDE_MOST = 0.6;
const asidePoint = new Float64Array(3);
const asideTurn = new Float64Array(4);
const asideAxis = new Float64Array(3);

/**
 * A head come up to a wall turns aside from it, the turn shared along the neck and most near the head: from the pose
 * and the walls alone, so the server's bites and hits find the head where every client draws it.
 */
function turnAside(rig: Rig, pose: Pose, solved: Solved, world: CollisionWorld, x: number, y: number, z: number, yaw: number, size: number): void {
  const { neck, head } = rig.sections;
  if (head < 0 || neck.length === 0 || !(rig.capR[head]! > 0)) return;
  const h = head * 3;
  boneToModel(solved, head, (rig.capA[h]! + rig.capB[h]!) / 2, (rig.capA[h + 1]! + rig.capB[h + 1]!) / 2, (rig.capA[h + 2]! + rig.capB[h + 2]!) / 2, asidePoint);
  const co = detCos(yaw), sn = detSin(yaw), r = rig.capR[head]! * size, reach = r + ASIDE_SLACK;
  const hx = x + size * (co * asidePoint[0]! + sn * asidePoint[2]!), hy = y + size * asidePoint[1]!, hz = z + size * (co * asidePoint[2]! - sn * asidePoint[0]!);
  if (nothingBuilt(world, hx, hz, reach, hy - reach, hy + reach)) return;
  const depth = wallDepth(world, hx, hy - reach, hz, reach);
  if (!(depth > 0)) return;
  // The way out of the wall in its own frame: toward its left is +X. Straight on, it turns the way its head already leans.
  const out = co * wallOut.x - sn * wallOut.z;
  const side = out > 0.05 ? 1 : out < -0.05 ? -1 : asidePoint[0]! >= 0 ? 1 : -1;
  const amount = (depth < reach ? depth / reach : 1) * ASIDE_MOST * side;
  let total = 0;
  for (let k = 0; k < neck.length; k++) total += k + 1;
  for (let k = 0; k < neck.length; k++) {
    const b = neck[k]!, p = rig.parent[b]!;
    // Up, in the bone's parent's frame, so it turns about the upright line whatever its parent's turn.
    if (p >= 0) quatUnrotate(solved.rot, p * 4, 0, 1, 0, asideAxis, 0);
    else { asideAxis[0] = 0; asideAxis[1] = 1; asideAxis[2] = 0; }
    quatAxis(asideTurn, 0, asideAxis[0]!, asideAxis[1]!, asideAxis[2]!, (amount * (k + 1)) / total);
    quatMul(pose.rot, b * 4, asideTurn, 0, pose.rot, b * 4);
  }
  solve(rig, pose, solved);
}

/** What species `i` of `reg` plays on `rig`: one way for the server and every client. */
export function speciesAnim(reg: Registry, i: number, rig: Rig): CreatureAnim {
  return new CreatureAnim(rig, reg.runAt[i]!, reg.move[i]?.swimSpeed ?? 0, reg.combat[i], reg.move[i]?.strafe === false);
}

/** What each species of `reg` drawn on a rig of its own plays, by content index. `rigOf` finds a species' rig. */
export function creatureAnims(reg: Registry, rigOf: (d: SpeciesDef) => Rig | null | undefined): (CreatureAnim | null)[] {
  return reg.defs.map((d, i) => {
    if (d?.type !== "species" || d.skeleton === undefined || d.skeleton === HUMAN.id) return null;
    const rig = rigOf(d);
    return rig ? speciesAnim(reg, i, rig) : null;
  });
}
