// A creature's pose from the same packed state a survivor has and from its cues (shared/anim/pose.ts), on the clips its
// asset names for what it does (RIG_CLIPS). The arithmetic is exactly rounded, so the server's hit capsules and every
// client's drawing use the same pose. Nothing accumulates: a cue carries the tick it began, and an idle's variant is
// chosen by the tick and the body's seed.
//
// What it does throughout (lies knocked out, floats, falls, or stands and moves on its gaits) is played by the tick. A
// one-shot that begins at a cue's tick (going down, getting up, a startle, a landing) plays over that, and its strike over
// all of it but lying. Each one-shot fades in from what played before it and out into what plays after, over FADE ticks.
// Last, a layer clip (a flinch, a gulp) turns its bones further, each in its own frame.

import type { SpeciesDef } from "../content/defs.ts";
import type { Registry } from "../content/registry.ts";
import { TICK_RATE } from "../coords.ts";
import { PI, TAU, detCos, detSin } from "../math/scalar.ts";
import { quatMul, quatNlerp } from "../math/quat.ts";
import { MODE_SWIM } from "../sim/character.ts";
import { ACT_NONE } from "../sim/weapon.ts";
import { blendPose, sampleClip, type Clip, type Pose } from "./clip.ts";
import { footStart, gaitClip, gaitShares, playGaits, tickPhase, type Gait, type GaitClip } from "./gait.ts";
import { HUMAN } from "./human.ts";
import { CUE_LAND, CUE_STARTLE, CUE_TORPOR, DIR_STEPS, LAYER_EAT, LAYER_FLINCH, LAYER_NONE, SPEED_STEP, type AnimState } from "./pose.ts";
import type { Rig, RigClip } from "./rigs.ts";
import { rayZones, solve, zoneHit } from "./skeleton.ts";

/** Below this speed, in metres per second, a walk with no stride is blended with the idle so that starting off is not a jump. */
const EASE_IN = 1.2;
/** Ticks over which a one-shot comes in from what played before it, and goes out into what plays after. */
export const FADE = 6;
/** Ticks a species with no clip to get up by takes to rise from lying. */
const GET_UP = 30;
/** A turn on the spot is a quarter turn to its left, its body turning as a smooth step over the clip. */
const QUARTER = PI / 2;
const single: GaitClip[] = [];
const q = new Float64Array(4);

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
  readonly fall: Clip | null;
  readonly land: Clip | null;
  readonly turn: Clip | null;
  /** The turn mirrored, to turn to its right. */
  readonly turnRight: Clip | null;
  readonly startled: Clip | null;
  readonly flinch: Clip | null;
  readonly torporIn: Clip | null;
  readonly torporIdle: Clip | null;
  readonly torporEat: Clip | null;
  readonly torporOut: Clip | null;
  readonly death: Clip | null;
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
  /** The bones a flinch and a gulp turn: of those each clip turns, the ones above its legs. */
  readonly flinchBones: Uint8Array;
  readonly eatBones: Uint8Array;
  /** Radians a second at which its turn plays at its own rate. */
  readonly spinAt: number;

  constructor(rig: Rig, runAt: number, swimSpeed: number) {
    this.rig = rig;
    this.runAt = runAt;
    const named = (name: RigClip): Clip | null => rig.clips.get(name) ?? null;
    this.idle = named("idle");
    this.walk = named("walk");
    this.run = named("run");
    this.attack = named("attack");
    this.swim = named("swim");
    this.swimIdle = named("swim_idle");
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
    const idles = [...rig.clips.keys()].filter((n) => /^idle_\w+$/.test(n)).sort().map((n) => rig.clips.get(n)!);
    const call = named("call");
    if (call) idles.push(call);
    this.idles = this.idle ? idles : [];
    const longest = Math.max(0, ...this.idles.map((c) => c.frames - 1 + FADE));
    this.slot = this.idle ? this.idle.frames * Math.max(1, Math.ceil(longest / this.idle.frames)) : 1;
    const gait = (clip: Clip | null, name: RigClip): GaitClip | null => {
      const stride = rig.strides.get(name);
      return clip && clip.loop && stride !== undefined ? gaitClip(clip, stride, rig.feet.length > 0 ? footStart(rig, clip, rig.feet[0]!, rig.a, rig.solved) : 0) : null;
    };
    this.walkGait = gait(this.walk, "walk");
    this.runGait = gait(this.run, "run");
    const moving = [this.walk ? this.walkGait : undefined, this.run ? this.runGait : undefined].filter((g) => g !== undefined);
    this.gaits = moving.length > 0 && moving.every((g) => g !== null) ? (moving as GaitClip[]).sort((p, r) => p.speed - r.speed) : [];
    const swum = this.swim && this.swim.loop ? (rig.strides.get("swim") ?? (swimSpeed * this.swim.frames) / TICK_RATE) : 0;
    this.swimGait = swum > 0 ? gaitClip(this.swim!, swum, 0) : null;
    const legs = legBones(rig);
    this.flinchBones = this.flinch ? turnedBones(this.flinch, legs) : new Uint8Array(0);
    this.eatBones = this.torporEat ? turnedBones(this.torporEat, legs) : new Uint8Array(0);
    this.spinAt = this.turn ? QUARTER / (Math.max(1, this.turn.frames - 1) / TICK_RATE) : 1;
  }
}

/** 1 for the root, and for each bone from the root down to a foot and every bone below those. */
function legBones(rig: Rig): Uint8Array {
  const legs = new Uint8Array(rig.bones);
  legs[0] = 1;
  for (const foot of rig.feet) for (let b = foot; b > 0; b = rig.parent[b]!) legs[b] = 1;
  // Parents come before their children, so one pass carries a leg down to its toes.
  for (let b = 1; b < rig.bones; b++) if (legs[rig.parent[b]!] === 1 && rig.parent[b] !== 0) legs[b] = 1;
  return legs;
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
 * Plays `clip` `s` ticks in over what `out` holds, which is what plays after it. It comes in over FADE ticks from `from`,
 * what played before it (`out` itself where null), and after its last frame goes out into `out` over FADE ticks.
 */
function oneShot(rig: Rig, clip: Clip, s: number, out: Pose, from: Pose | null): void {
  const end = clip.frames - 1;
  if (s >= end + FADE) return;
  if (s >= FADE && s <= end) {
    sampleClip(clip, s, out);
    return;
  }
  sampleClip(clip, s < end ? s : end, rig.f);
  if (s <= end) blendPose(out, from ?? out, rig.f, smooth(s / FADE));
  else blendPose(out, rig.f, out, smooth((s - end) / FADE));
}

/** Turns each of `bones` further by `clip` at `frame`, in the bone's own frame: the turn it has first, then the layer's. */
export function layer(out: Pose, clip: Clip, frame: number, bones: Uint8Array): void {
  const n = clip.frames;
  const f = frame < 0 ? 0 : frame > n - 1 ? n - 1 : frame;
  const f0 = Math.floor(f);
  const t = f - f0;
  const f1 = f0 + 1 < n ? f0 + 1 : f0;
  const rot = clip.rot;
  for (let k = 0; k < bones.length; k++) {
    const b = bones[k]!;
    const a = (f0 * clip.bones + b) * 4;
    if (t === 0) for (let c = 0; c < 4; c++) q[c] = rot[a + c]!;
    else quatNlerp(q, 0, rot, a, rot, (f1 * clip.bones + b) * 4, t);
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

/** The stride of its legs at `speed`, 0 where they are not played by distance. Fills rig.w with the gaits' shares. */
export function creatureStride(a: CreatureAnim, st: AnimState, speed: number): number {
  if (afloat(a, st)) {
    single[0] = a.swimGait!;
    return gaitShares(single, speed, true, a.rig.w);
  }
  const moves = movesAt(a, speed);
  // The idle takes what the slowest leaves, but not under a run that only a walk played by time comes before.
  return moves ? gaitShares(moves, speed, moves !== single || moves[0] === a.walkGait, a.rig.w) : 0;
}

/**
 * Moves a body's gait on to where it is drawn at `tick`, (x, z) facing `yaw` radians, `size` times as large as it was
 * made. A body seen for the first time starts at the phase the server poses it at. One with a clip to turn on the spot
 * does not step round with its walk.
 */
export function advanceCreature(a: CreatureAnim, g: Gait, st: AnimState, tick: number, x: number, z: number, yaw: number, size: number): void {
  const metres = g.track(x, z, yaw, tick, st.speed * SPEED_STEP, a.turn ? 0 : a.rig.turn, size);
  if (metres < 0) g.phase = tickPhase(tick + st.seed, g.speed, creatureStride(a, st, g.speed));
  else g.step(metres, creatureStride(a, st, g.speed));
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
function onFoot(a: CreatureAnim, st: AnimState, t: number, out: Pose, gait: Gait | null): void {
  const rig = a.rig;
  const speed = gait ? gait.speed : st.speed * SPEED_STEP;
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
  const turn = st.dir <= DIR_STEPS / 2 ? st.dir : DIR_STEPS - st.dir;
  const backward = turn > DIR_STEPS / 4;
  if (moves) playGaits(moves, rig.w, gait ? gait.phase : tickPhase(t, speed, stride), backward, out, rig.b, rig.c);
  else if (clip && speed < EASE_IN && a.idle && clip === a.walk) {
    sampleClip(clip, backward ? -t : t, rig.b);
    blendPose(out, out, rig.b, speed / EASE_IN);
  } else if (clip) sampleClip(clip, backward ? -t : t, out);
}

/** What it does throughout, by the tick: lies knocked out when `lying`, else floats, falls, or stands and moves. */
function steady(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null, lying: boolean): void {
  const t = tick + st.seed;
  if (lying && a.torporIdle) sampleClip(a.torporIdle, t, out);
  else if (lying && a.death) sampleClip(a.death, a.death.frames - 1, out);
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
  else onFoot(a, st, t, out, gait);
}

/** Its bite, from the tick it began, for the length of its clip. False when none is under way. */
function strike(a: CreatureAnim, st: AnimState, tick: number, out: Pose): boolean {
  if ((st.action & 7) === ACT_NONE || !a.attack) return false;
  const s = (((Math.floor(tick) & 255) - st.actionStart) & 255) + (tick - Math.floor(tick));
  if (s >= a.attack.frames - 1) return false;
  sampleClip(a.attack, s, out);
  return true;
}

/**
 * Fills `out` with its pose at `tick`, which may fall between ticks. With `gait` its legs are where that says, and without
 * it where the tick puts them.
 */
export function creaturePose(a: CreatureAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null = null): void {
  const rig = a.rig;
  steady(a, st, tick, out, gait, st.out);
  if (st.out) {
    // Going down, from what it was doing into lying. Without its own clip it falls as it dies.
    const clip = a.torporIn ?? a.death;
    if (st.cue === CUE_TORPOR && clip) {
      const s = since(tick, st.cueStart);
      if (s < FADE) steady(a, st, tick, rig.e, gait, false);
      oneShot(rig, clip, s, out, rig.e);
    }
  } else if (!strike(a, st, tick, out)) {
    if (st.cue === CUE_TORPOR) gettingUp(a, st, tick, out);
    else if (st.cue === CUE_STARTLE || st.cue === CUE_LAND) {
      const clip = st.cue === CUE_STARTLE ? a.startled : a.land;
      const s = since(tick, st.cueStart);
      // A landing comes in from the fall.
      const fall = st.cue === CUE_LAND && a.fall !== null && s < FADE;
      if (fall) sampleClip(a.fall!, tick + st.seed, rig.e);
      if (clip) oneShot(rig, clip, s, out, fall ? rig.e : null);
    }
  }
  if (st.layer === LAYER_NONE) return;
  // A flinch or a gulp, over whatever the rest of it does.
  const clip = st.layer === LAYER_FLINCH ? a.flinch : st.layer === LAYER_EAT ? a.torporEat : null;
  const s = clip ? since(tick, st.layerStart) : 0;
  if (clip && s < clip.frames - 1) layer(out, clip, s, st.layer === LAYER_FLINCH ? a.flinchBones : a.eatBones);
}

/** Getting up, from lying into what it does now. Without its own clip it rises over GET_UP ticks. */
function gettingUp(a: CreatureAnim, st: AnimState, tick: number, out: Pose): void {
  const rig = a.rig;
  const s = since(tick, st.cueStart);
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
export function rayCreature(a: CreatureAnim, st: AnimState, tick: number, bx: number, by: number, bz: number, yaw: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
  const rig = a.rig;
  // Most rays miss the bounding sphere, so test that first.
  const cx = bx - ox;
  const cy = by + rig.mid - oy;
  const cz = bz - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const off2 = cx * cx + cy * cy + cz * cz - along * along;
  if (off2 > rig.reach * rig.reach || along < -rig.reach || along > maxT + rig.reach) {
    zoneHit.zone = 0;
    zoneHit.bone = -1;
    zoneHit.t = maxT;
    return 0;
  }
  creaturePose(a, st, tick, rig.a);
  solve(rig, rig.a, rig.solved);
  // Move the ray into the body's space by undoing its position, then its yaw. Yaw is x' = c x + s z, z' = c z - s x.
  const r = (yaw * TAU) / 65536;
  const s = detSin(r);
  const c = detCos(r);
  const rx = ox - bx;
  const rz = oz - bz;
  return rayZones(rig, rig.solved, c * rx - s * rz, oy - by, s * rx + c * rz, c * dx - s * dz, dy, s * dx + c * dz, maxT);
}

/** What each species of `reg` drawn on a rig of its own plays, by content index. `rigOf` finds a species' rig. */
export function creatureAnims(reg: Registry, rigOf: (d: SpeciesDef) => Rig | null | undefined): (CreatureAnim | null)[] {
  return reg.defs.map((d, i) => {
    if (d?.type !== "species" || d.skeleton === undefined || d.skeleton === HUMAN.id) return null;
    const rig = rigOf(d);
    return rig ? new CreatureAnim(rig, reg.runAt[i]!, reg.move[i]?.swimSpeed ?? 0) : null;
  });
}
