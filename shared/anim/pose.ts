// humanPose is a pure function of the replicated AnimState and the tick, so the server's hit test and every client's
// drawing get the same pose. The lower body follows the direction of travel and the upper body follows the look. A client
// may also give it a Gait, which puts the legs where the ground the body covered says (shared/anim/gait.ts).

import { PI, TAU, clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";
import { quatAxis, quatIdentity, quatMul, quatMulConj, quatNlerp, quatRotate } from "../math/quat.ts";
import { Pose, blendPose, sampleClip, type Clip, type ClipSet } from "./clip.ts";
import { FlightJoints, footStart, gaitClip, gaitShares, playGaits, tickPhase, type Gait, type GaitClip } from "./gait.ts";
import { B_FOOT_R, B_UPPER_ARM_L, B_UPPER_ARM_R, B_LOWER_ARM_L, B_LOWER_ARM_R, B_CHEST, B_HAND_L, B_HAND_R, B_FINGERS_L, B_FOOT_L, B_HEAD, B_HIPS, B_LOWER_LEG_L, B_LOWER_LEG_R, B_NECK, B_SHOULDER_L, B_SHOULDER_R, B_SPINE, B_UPPER_CHEST, B_UPPER_LEG_L, B_UPPER_LEG_R, HUMAN, HUMAN_BONES } from "./human.ts";
import { Solved } from "./skeleton.ts";

import { TICK_RATE } from "../coords.ts";
import { bootThrust, JET_DASH, JET_FIST, JET_UP, JET_HOVER, JET_LIFT, MODE_FLYER, MODE_SWIM, MODE_WALK, STANCE_CROUCH, STANCE_PRONE, STANCE_STAND } from "../sim/character.ts";
import { ACT_COOL, ACT_DRAW, ACT_EQUIP, ACT_HOLD, ACT_NONE, ACT_RELOAD, ACT_SWING, EQUIP_TICKS, HOLD_BOW, HOLD_CARRY, HOLD_HANDS, HOLD_PISTOL, HOLD_RIFLE, HOLD_THROW, SWING_TICKS } from "../sim/weapon.ts";
import { cradle } from "./hold.ts";
import { emotePose } from "./emote.ts";
import { EMOTES, emoteClipId } from "./emotes.ts";

/** The three parts of a packed AnimState. Replication sends each part only when it changes. */
export const ANIM_MOTION_BITS = 12;
export const ANIM_LOOK_BITS = 6;
export const ANIM_ACTION_BITS = 14;
export const ANIM_MOTION_MASK = 0xfff;
export const ANIM_LOOK_SHIFT = 12;
export const ANIM_ACTION_SHIFT = 18;

/** Metres per second per unit of `AnimState.speed`. */
export const SPEED_STEP = 0.6;
export const SPEED_MAX = 15;
/** Steps in a full turn of `AnimState.dir`. */
export const DIR_STEPS = 16;
/** Steps of `AnimState.pitch` from level to straight up. */
export const PITCH_STEPS = 31;

/**
 * A creature in its own flight (MODE_FLYER), with the flyers' contracts (planning/reference/flyers-plan.md, FL0), has
 * its motion bits laid out anew, since in flight it neither crouches, strafes, swims nor stands: its speed through the air
 * in FLY_SPEED_STEP units in the speed bits (30 m/s at most), its bank in the direction bits, ANIM_FLYING in the stance
 * bits, and its climb in the two bits a swimmer and a faller use. Any other body packs as it did. FL4 poses it.
 */
export const FLY_SPEED_STEP = 2;
/** The stance bits' value for a body in flight. No stance is 3. */
export const ANIM_FLYING = 3;
/**
 * `AnimState.bank`, from -BANK_STEPS to BANK_STEPS: how far, in BANK_STEP radians, it faces to the left of the way it
 * travels, as when it turns left and its velocity lags its facing. FL4 rolls it toward that side. 0 at no speed.
 */
export const BANK_STEPS = 7;
export const BANK_STEP = PI / 32;
/** `AnimState.climb`: the way it travels, level, rising above 15 degrees, falling below 15, and falling below 45. */
export const CLIMB_LEVEL = 0;
export const CLIMB_UP = 1;
export const CLIMB_DOWN = 2;
export const CLIMB_DIVE = 3;
/** The sines of 15 and 45 degrees, written out so both engines compare the same numbers. */
const SIN_15 = 0.25881904510252074;
const SIN_45 = 0.7071067811865476;

/**
 * A creature's cues (shared/anim/creature.ts), sent beside the pose state as one word: knocked out in bit 0, then a CUE_
 * for what its whole body goes through and the low byte of its first tick, then a LAYER_ for what plays over that and
 * the low byte of its first tick. The server clears a cue before its start can be counted twice. Then states that last
 * (protocol 11): held in bit 22 (CUE_HELD), a corpse in bit 23 (CUE_DEAD), its hurt stage in two bits from bit 24, a
 * corpse's decay stage in bits 26–27 (a living creature uses bit 26 for rivalry), and its pair's mating in three from bit 28.
 */
export const CUE_BITS = 31;
export const CUE_NONE = 0;
export const CUE_STARTLE = 1;
/** Landing from a fall or setting down from flight; knocked out, coming to the ground from its limp fall. */
export const CUE_LAND = 2;
/** Going down when knocked out, getting up when not. */
export const CUE_TORPOR = 3;
/**
 * The flyers' contracts (planning/reference/flyers-plan.md): a flyer taking off, and its barrel roll.
 * A creature that carries in its feet has HOLD_CARRY as its hold, as a survivor carrying in her arms does, so its grab
 * and its letting go can begin at its action's start and need no cue.
 */
export const CUE_TAKEOFF = 4;
export const CUE_ROLL = 5;
/** On a body (CUE_DEAD), for as long as it lies: it died in its own flight, and goes limp from its death in the air. */
export const CUE_FELL = 6;
/** A rider activated the species’ roar. Its native call and voice share this timestamp. */
export const CUE_ROAR = 7;
export const LAYER_NONE = 0;
export const LAYER_FLINCH = 1;
export const LAYER_EAT = 2;
export const CUE_OUT = 1;
/** In a survivor's arms or carried by a creature. */
export const CUE_HELD = 1 << 22;
/** A body that lies where it fell, to be harvested. */
export const CUE_DEAD = 1 << 23;
export const CUE_HURT_SHIFT = 24;
export const CUE_DECAY_SHIFT = 26;
/** On a living creature only. A corpse uses these bits for its decay stage. */
export const CUE_RIVALRY = 1 << CUE_DECAY_SHIFT;
/** The second decay bit on living survivors marks active chest thrust. */
export const CUE_JET = 1 << (CUE_DECAY_SHIFT + 1);
export const CUE_MATING_SHIFT = 28;
/**
 * A survivor's emote (protocol 37), its own word beside the pose and the cues: the emote's number in shared/anim/emotes.ts
 * (0 for none) in the low EMOTE_ID_BITS, the low 16 bits of its first tick, its role (EMOTE_SOLO, EMOTE_SYNCED: in step
 * with every body playing it so, EMOTE_LEAD and EMOTE_PARTNER: the two sides of a pair), and whether it plays mirrored.
 */
export const EMOTE_BITS = 29;
export const EMOTE_ID_BITS = 10;
export const EMOTE_START_SHIFT = 10;
export const EMOTE_ROLE_SHIFT = 26;
export const EMOTE_MIRROR = 1 << 28;
export const EMOTE_SOLO = 0;
export const EMOTE_SYNCED = 1;
export const EMOTE_LEAD = 2;
export const EMOTE_PARTNER = 3;

/** The worst hurt and decay stage. 0 is unhurt, or fresh. */
export const STAGE_WORST = 3;
/** The last step of a pair's mating: 1 as it begins, rising to this as it ends, 0 when not mating. */
export const MATING_STEPS = 7;

/**
 * A living body's hurt stage, as every client sees it: 0 above three quarters of its health, then one more for each
 * quarter lost. Its health itself is never sent, so the stage tells no more than a glance at it would.
 */
export function hurtStage(health: number, max: number): number {
  if (!(max > 0) || health >= max * 0.75) return 0;
  return health >= max * 0.5 ? 1 : health >= max * 0.25 ? 2 : 3;
}

/** Everything a pose depends on besides the tick, as whole numbers. */
export class AnimState {
  mode = MODE_WALK;
  grounded = true;
  /** Horizontal speed in SPEED_STEP units, 0..SPEED_MAX. */
  speed = 0;
  /** Direction of travel relative to facing, in sixteenths of a turn toward the body's left. */
  dir = 0;
  /** -PITCH_STEPS (down) to PITCH_STEPS (up). */
  pitch = 0;
  stance = STANCE_STAND;
  /** In flight only (MODE_FLYER), else 0: -BANK_STEPS to BANK_STEPS, and a CLIMB_. `speed` then counts FLY_SPEED_STEP, and `dir` is 0. */
  bank = 0;
  climb = CLIMB_LEVEL;
  /** The act (shared/sim/weapon.ts) in the low three bits, then the hold (HOLD_*) in three. actionStart is the low byte of the act's first tick. */
  action = 0;
  actionStart = 0;
  /** Ticks added to the clock so that bodies are out of step. Not replicated. It comes from the entity's index (bodySeed). */
  seed = 0;
  /** A creature's cues, as the word CUE_BITS describes. */
  out = false;
  cue = CUE_NONE;
  cueStart = 0;
  layer = LAYER_NONE;
  layerStart = 0;
  held = false;
  dead = false;
  /** 0 to STAGE_WORST. */
  hurt = 0;
  decay = 0;
  jet = false;
  jetMode = JET_LIFT;
  bootJets = false;

  setJet(mode: number, gear: number): void {
    this.jet = mode !== 0;
    this.jetMode = mode || JET_LIFT;
    this.bootJets = bootThrust(mode, gear, this.speed * SPEED_STEP);
  }
  rivalry = false;
  /** 0, or 1 to MATING_STEPS. */
  mating = 0;
  /** A survivor's emote: its number (0 for none), the low 16 bits of its first tick, its role and whether mirrored. */
  emote = 0;
  emoteStart = 0;
  emoteRole = EMOTE_SOLO;
  emoteMirror = false;

  /** Everything but the seed and the cues as one 32-bit number: motion in the low 12 bits, then the look, then the action. */
  pack(): number {
    const motion =
      this.jet && !this.grounded && this.mode === MODE_WALK
        ? this.speed | (this.dir << 4) | ((this.jetMode-1) << 8) | (this.bootJets ? 1 << 11 : 0)
        : this.mode === MODE_FLYER
        ? this.speed | ((this.bank & 15) << 4) | (ANIM_FLYING << 8) | ((this.climb & 3) << 10)
        : this.speed | (this.dir << 4) | (this.stance << 8) | (this.mode === MODE_SWIM ? 1 << 10 : 0) | (this.grounded ? 0 : 1 << 11);
    return (motion | ((this.pitch & 63) << ANIM_LOOK_SHIFT) | (this.action << ANIM_ACTION_SHIFT) | ((this.actionStart & 255) << (ANIM_ACTION_SHIFT + 6))) >>> 0;
  }

  /** The cues as one word. A cue that is none stores a start of 0. */
  packCue(): number {
    const cue = this.cue === CUE_NONE ? 0 : (this.cue << 1) | ((this.cueStart & 255) << 4);
    const layer = this.layer === LAYER_NONE ? 0 : (this.layer << 12) | ((this.layerStart & 255) << 14);
    const condition = this.dead ? (this.decay & 3) << CUE_DECAY_SHIFT : (this.rivalry ? CUE_RIVALRY : 0) | (this.jet ? CUE_JET : 0);
    const lasting = (this.held ? CUE_HELD : 0) | (this.dead ? CUE_DEAD : 0) | ((this.hurt & 3) << CUE_HURT_SHIFT) | condition | ((this.mating & 7) << CUE_MATING_SHIFT);
    return ((this.out ? CUE_OUT : 0) | cue | layer | lasting) >>> 0;
  }

  /** ACT_NONE stores a start of 0. */
  setAction(act: number, hold: number, start: number): void {
    this.action = (act & 7) | ((hold & 7) << 3);
    this.actionStart = act === ACT_NONE ? 0 : start & 255;
  }

  /** The emote as one word: EMOTE_BITS describes it. 0 when there is none. */
  packEmote(): number {
    if (this.emote === 0) return 0;
    return ((this.emote & ((1 << EMOTE_ID_BITS) - 1)) | ((this.emoteStart & 0xffff) << EMOTE_START_SHIFT) | ((this.emoteRole & 3) << EMOTE_ROLE_SHIFT) | (this.emoteMirror ? EMOTE_MIRROR : 0)) >>> 0;
  }

  unpackEmote(word: number): void {
    this.emote = word & ((1 << EMOTE_ID_BITS) - 1);
    this.emoteStart = (word >>> EMOTE_START_SHIFT) & 0xffff;
    this.emoteRole = (word >>> EMOTE_ROLE_SHIFT) & 3;
    this.emoteMirror = (word & EMOTE_MIRROR) !== 0;
  }

  unpackCue(cue: number): void {
    this.out = (cue & CUE_OUT) !== 0;
    this.cue = (cue >>> 1) & 7;
    this.cueStart = (cue >>> 4) & 255;
    this.layer = (cue >>> 12) & 3;
    this.layerStart = (cue >>> 14) & 255;
    this.held = (cue & CUE_HELD) !== 0;
    this.dead = (cue & CUE_DEAD) !== 0;
    this.hurt = (cue >>> CUE_HURT_SHIFT) & 3;
    this.decay = this.dead ? (cue >>> CUE_DECAY_SHIFT) & 3 : 0;
    this.jet = !this.dead && (cue & CUE_JET) !== 0;
    this.rivalry = !this.dead && (cue & CUE_RIVALRY) !== 0;
    this.mating = (cue >>> CUE_MATING_SHIFT) & 7;
  }

  unpack(word: number, cue = 0, emote = 0): void {
    this.unpackCue(cue);
    this.unpackEmote(emote);
    this.speed = word & 15;
    this.jetMode = JET_LIFT;
    this.bootJets = false;
    if (this.jet) {
      this.dir = (word >>> 4) & 15;
      this.jetMode = ((word >>> 8) & 7) + 1;
      this.bootJets = (word & (1 << 11)) !== 0;
      this.mode = MODE_WALK;
      this.grounded = false;
      this.stance = STANCE_STAND;
      this.bank = 0;
      this.climb = CLIMB_LEVEL;
    } else if (((word >>> 8) & 3) === ANIM_FLYING) {
      this.mode = MODE_FLYER;
      this.grounded = false;
      this.stance = STANCE_STAND;
      this.dir = 0;
      this.bank = ((word >>> 4) & 15) >= 8 ? ((word >>> 4) & 15) - 16 : (word >>> 4) & 15;
      this.climb = (word >>> 10) & 3;
    } else {
      this.dir = (word >>> 4) & 15;
      this.stance = (word >>> 8) & 3;
      this.mode = (word & (1 << 10)) !== 0 ? MODE_SWIM : MODE_WALK;
      this.grounded = (word & (1 << 11)) === 0;
      this.bank = 0;
      this.climb = CLIMB_LEVEL;
    }
    const look = (word >>> ANIM_LOOK_SHIFT) & 63;
    this.pitch = look >= 32 ? look - 64 : look;
    this.action = (word >>> ANIM_ACTION_SHIFT) & 63;
    this.actionStart = (word >>> (ANIM_ACTION_SHIFT + 6)) & 255;
  }

  /** `yaw` and `pitch` are in radians. Set `mode` first: a flyer's speed counts `vy` too, which no other body's does. */
  setMotion(vx: number, vz: number, yaw: number, pitch: number, vy = 0): void {
    const s = detSin(yaw);
    const c = detCos(yaw);
    const forward = vx * s + vz * c;
    const left = vx * c - vz * s;
    this.pitch = clamp(Math.floor((pitch / (PI / 2)) * PITCH_STEPS + 0.5), -PITCH_STEPS, PITCH_STEPS);
    if (this.mode === MODE_FLYER) {
      const through = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const speed = Math.floor(through / FLY_SPEED_STEP + 0.5);
      this.speed = speed > SPEED_MAX ? SPEED_MAX : speed;
      this.dir = 0;
      if (this.speed === 0) {
        this.bank = 0;
        this.climb = CLIMB_LEVEL;
        return;
      }
      // Travelling to the right of its facing is facing to the left of its travel.
      this.bank = clamp(Math.floor(-detAtan2(left, forward) / BANK_STEP + 0.5), -BANK_STEPS, BANK_STEPS);
      const rise = vy / through;
      this.climb = rise >= SIN_15 ? CLIMB_UP : rise <= -SIN_45 ? CLIMB_DIVE : rise <= -SIN_15 ? CLIMB_DOWN : CLIMB_LEVEL;
      return;
    }
    const speed = Math.floor(Math.sqrt(vx * vx + vz * vz) / SPEED_STEP + 0.5);
    this.speed = speed > SPEED_MAX ? SPEED_MAX : speed;
    const turn = detAtan2(left, forward) / TAU;
    this.dir = this.speed === 0 ? 0 : (Math.floor(turn * DIR_STEPS + 0.5) + DIR_STEPS) % DIR_STEPS;
    this.bank = 0;
    this.climb = CLIMB_LEVEL;
  }
}

/** `id` is the entity index, so the server and every client get the same seed. */
export function bodySeed(id: number): number {
  return (id * 37) % 1024;
}

/** A missing gait clip leaves the body at rest. A missing hold or swing clip is skipped. */
export class HumanAnim {
  readonly set: ClipSet;
  readonly idle: Clip | null;
  readonly walk: Clip | null;
  readonly jog: Clip | null;
  readonly sprint: Clip | null;
  readonly fall: Clip | null;
  readonly swimIdle: Clip | null;
  readonly swim: Clip | null;
  readonly crouchIdle: Clip | null;
  readonly crouchWalk: Clip | null;
  readonly proneIdle: Clip | null;
  readonly proneCrawl: Clip | null;
  readonly punch: Clip | null;
  readonly punchCross: Clip | null;
  readonly toolSwing: Clip | null;
  readonly throwing: Clip | null;
  readonly bowReady: Clip | null;
  readonly bowDrawn: Clip | null;
  readonly gunAimed: Clip | null;
  readonly gunLowered: Clip | null;
  readonly pistolAimed: Clip | null;
  readonly pistolLowered: Clip | null;
  /** Each emote's clip by its number (shared/anim/emotes.ts), null for none or one not loaded. */
  readonly emotes: (Clip | null)[];
  /** The gaits of each way of moving, slowest first: on foot, crouched, prone and swimming. */
  readonly standing: readonly GaitClip[];
  readonly crouching: readonly GaitClip[];
  readonly crawling: readonly GaitClip[];
  readonly swimming: readonly GaitClip[];
  /** Shares of the gaits, as gaitShares fills them. */
  readonly w = new Float64Array(3);

  constructor(set: ClipSet) {
    this.set = set;
    const find = (id: string): Clip | null => {
      const i = set.index.get(id);
      const clip = i === undefined ? null : set.clips[i]!;
      return clip && clip.bones === HUMAN_BONES ? clip : null;
    };
    this.idle = find("human/idle");
    this.walk = find("human/walk");
    this.jog = find("human/jog");
    this.sprint = find("human/sprint");
    this.fall = find("human/fall");
    this.swimIdle = find("human/swim_idle");
    this.swim = find("human/swim");
    this.crouchIdle = find("human/crouch_idle");
    this.crouchWalk = find("human/crouch_walk");
    this.proneIdle = find("human/prone_idle");
    this.proneCrawl = find("human/prone_crawl");
    this.punch = find("human/punch");
    this.punchCross = find("human/punch_cross");
    this.toolSwing = find("human/tool_swing");
    this.throwing = find("human/throw");
    this.bowReady = find("human/bow_ready");
    this.bowDrawn = find("human/bow_drawn");
    this.gunAimed = find("human/gun_aimed");
    this.gunLowered = find("human/gun_lowered");
    this.pistolAimed = find("human/pistol_aimed");
    this.pistolLowered = find("human/pistol_lowered");
    this.emotes = [null, ...EMOTES.map((e) => find(emoteClipId(e.id)))];
    const scratch = new Pose(HUMAN_BONES);
    const solved = new Solved(HUMAN_BONES);
    const gaits = (...list: [Clip | null, number][]): GaitClip[] =>
      list.flatMap(([clip, stride]) => (clip ? [gaitClip(clip, stride, footStart(HUMAN, clip, B_FOOT_L, scratch, solved))] : [])).sort((p, q) => p.speed - q.speed);
    this.standing = gaits([this.walk, WALK_STRIDE], [this.jog, JOG_STRIDE], [this.sprint, SPRINT_STRIDE]);
    this.crouching = gaits([this.crouchWalk, CROUCH_STRIDE]);
    // A crawl drags its feet and a swimmer has no ground, so their strides are the speed each plays at its own rate.
    this.crawling = gaits([this.proneCrawl, this.proneCrawl ? (PRONE_SPEED * this.proneCrawl.frames) / TICK_RATE : 0]);
    this.swimming = gaits([this.swim, this.swim ? (SWIM_SPEED * this.swim.frames) / TICK_RATE : 0]);
  }

  /** Takes in emote clips that came later (a client streams them after the first frame). */
  addEmotes(set: ClipSet): void {
    EMOTES.forEach((e, i) => {
      const k = set.index.get(emoteClipId(e.id));
      const clip = k === undefined ? null : set.clips[k]!;
      if (clip && clip.bones === HUMAN_BONES) this.emotes[i + 1] = clip;
    });
  }

  /** The gaits that move a body in this state. */
  gaitsOf(st: AnimState): readonly GaitClip[] {
    if (st.mode === MODE_SWIM) return this.swimming;
    if (!st.grounded) return NO_GAITS;
    return st.stance === STANCE_PRONE ? this.crawling : st.stance === STANCE_CROUCH ? this.crouching : this.standing;
  }
}

const NO_GAITS: readonly GaitClip[] = [];

/**
 * Metres one turn of each clip carries the body, measured from the clips: how fast the planted foot goes back
 * (tests/unit/gait.test.ts). Each plays alone at its stride over its length, the walk at 0.9 m/s, the jog at 5.9 and the
 * sprint at 8.9, and they blend in step between.
 */
const WALK_STRIDE = 1.2;
const JOG_STRIDE = 5.47;
const SPRINT_STRIDE = 5.94;
const CROUCH_STRIDE = 1.27;
/** The speeds at which a crawl and a swim play at their own rate. */
const PRONE_SPEED = 0.6;
const SWIM_SPEED = 2.4;
/** Metres the feet stand from the upright axis, for stepping while turning on the spot. */
const FOOT_RADIUS = 0.12;
/** Swim clips put the water's surface at the origin. It is SWIM_FLOAT of a 1.8 m body above a swimmer's feet. */
const SWIM_LIFT = 1.35;
/** A swimmer pitches about this height, where its body lies when level. */
const SWIM_PIVOT = 1.25;
/** Share of the look pitch taken by each of the three spine bones, the neck, and the head. */
const PITCH_SPINE = 0.14;
const PITCH_NECK = 0.2;
const PITCH_HEAD = 0.3;

/** A swing takes the upper body: the spine through the hands, then the fingers and props. The legs keep their gait. */
const UPPER_FROM = B_SPINE;
const UPPER_TO = B_UPPER_LEG_L;
const HANDS_FROM = B_FINGERS_L;
/** Ticks to blend a swing in and out. */
const SWING_IN = 2;
const SWING_OUT = 3;

/** Ticks for a bow to come up as the draw begins and go down after the shot, and for a gun to come down for loading. */
const BOW_RAISE = 9;
const BOW_LOWER = 6;
const GUN_LOWER = 5;
/** A gun kicks up by this many radians when it fires and settles over KICK_TICKS. */
const KICK = 0.09;
const KICK_TICKS = 5;

const a = new Pose(HUMAN_BONES);
const b = new Pose(HUMAN_BONES);
const q = new Float64Array(4);
const v = new Float64Array(3);

/**
 * Moves a body's gait on to where it is drawn at `tick`, (x, z) facing `yaw` radians. A body seen for the first time starts
 * at the phase the server poses it at.
 */
export function advanceHuman(anim: HumanAnim, g: Gait, st: AnimState, tick: number, x: number, z: number, yaw: number): void {
  const gaits = anim.gaitsOf(st);
  const elapsed = (tick - g.tick) / TICK_RATE;
  const metres = g.track(x, z, yaw, tick, st.speed * SPEED_STEP, FOOT_RADIUS, 1);
  if (st.jet && !st.grounded) {
    const travel = st.speed / SPEED_MAX, direction = st.dir * TAU / DIR_STEPS;
    const fresh = !g.flightJoints || metres < 0;
    const joints = g.flightJoints ??= new FlightJoints();
    joints.step(travel*detCos(direction), travel*detSin(direction), fresh ? -1 : elapsed);
  } else if (g.flightJoints) g.flightJoints = undefined;
  const stride = gaitShares(gaits, g.speed, true, anim.w);
  if (metres < 0) g.phase = tickPhase(tick + st.seed, g.speed, stride);
  else g.step(metres, stride);
}

/** Plays the gaits at `speed` over the idle, in step at `phase`, or at the phase the tick gives where that is NaN. Returns their share. */
function locomote(anim: HumanAnim, idle: Clip | null, gaits: readonly GaitClip[], t: number, speed: number, phase: number, reverse: boolean, out: Pose): number {
  const stride = gaitShares(gaits, speed, true, anim.w);
  let total = 0;
  for (let i = 0; i < gaits.length; i++) total += anim.w[i]!;
  if (total < 1) loop(idle, t, out);
  return playGaits(gaits, anim.w, phase === phase ? phase : tickPhase(t, speed, stride), reverse, out, a, b);
}

/** Plays the clip at one frame per tick. */
function loop(clip: Clip | null, tick: number, out: Pose): void {
  if (!clip) out.rest();
  else sampleClip(clip, tick, out);
}

/** The axis (ax, ay, az) is in the parent's space. */
function turn(pose: Pose, bone: number, ax: number, ay: number, az: number, angle: number): void {
  if (angle === 0) return;
  quatAxis(q, 0, ax, ay, az, angle);
  quatMul(pose.rot, bone * 4, q, 0, pose.rot, bone * 4);
}

/** `tick` may fall between ticks, for drawing. With `gait` the legs are where that says, and without it where the tick puts them. */
export function humanPose(anim: HumanAnim, st: AnimState, tick: number, out: Pose, gait: Gait | null = null): void {
  const t = tick + st.seed;
  const speed = gait ? gait.speed : st.speed * SPEED_STEP;
  const phase = gait ? gait.phase : Number.NaN;
  // Travelling backward plays the gait in reverse with the hips turned the other way.
  let twist = st.dir <= DIR_STEPS / 2 ? st.dir : st.dir - DIR_STEPS;
  const reverse = twist > DIR_STEPS / 4 || twist < -DIR_STEPS / 4;
  if (reverse) twist = twist > 0 ? twist - DIR_STEPS / 2 : twist + DIR_STEPS / 2;
  let twistAngle = (twist / DIR_STEPS) * TAU;
  const pitch = (st.pitch / PITCH_STEPS) * (PI / 2);
  let bodyPitch = 0;
  let spineShare = PITCH_SPINE;

  if (st.mode === MODE_SWIM) {
    const k = locomote(anim, anim.swimIdle, anim.swimming, t, speed, phase, false, out);
    out.root[1]! += SWIM_LIFT;
    // A swimmer's whole body tips toward its look, more the faster it goes.
    bodyPitch = pitch * k;
    twistAngle = 0;
  } else if (st.jet && !st.grounded) {
    loop(anim.idle, t, out);
    const travel = st.speed / SPEED_MAX, direction = st.dir * TAU / DIR_STEPS;
    const forward = travel*detCos(direction), left = travel*detSin(direction);
    const joints = gait?.flightJoints?.bend;
    const pitchLag = clamp((joints?.[0] ?? forward)-forward,-0.22,0.22);
    const rollLag = clamp((joints?.[1] ?? left)-left,-0.22,0.22);
    const legLag = clamp((joints?.[2] ?? forward)-forward,-0.32,0.32);
    const sideLag = clamp((joints?.[3] ?? left)-left,-0.32,0.32);
    const drift = detSin(t*0.12), sway = detSin(t*0.077+1.2);
    const up = st.jetMode === JET_UP, fist = st.jetMode === JET_FIST, dash = st.jetMode === JET_DASH;
    const bank = -(left*(dash ? 0.78 : 0.49) + 0.55*rollLag + 0.025*sway);
    bodyPitch = -(forward*(dash || fist ? 0.96 : st.jetMode === JET_HOVER ? 0.73 : 0.51) + 0.45*pitchLag + 0.035*drift);
    turnRoot(out, 0, 0, 1, bank, 1.14);
    turn(out, B_NECK, 0, 0, 1, -bank*0.38);
    turn(out, B_HEAD, 0, 0, 1, -bank*0.23);
    out.root[1]! += 0.012*drift*(1-travel);
    // Hips suspend the legs. Knees and ankles trail acceleration, then return to an asymmetric relaxed hang.
    for (let side = -1; side <= 1; side += 2) {
      const hip = side > 0 ? B_UPPER_LEG_L : B_UPPER_LEG_R;
      const arm = side > 0 ? B_UPPER_ARM_L : B_UPPER_ARM_R;
      const handFree = (st.action >>> 3) === HOLD_HANDS;
      const tuck = (up ? 0.43 : 0.0) + 0.08*side + 0.08*drift*side;
      turn(out, hip, 1,0,0, -0.18 - tuck + 0.39*forward - 0.30*legLag);
      turn(out, hip, 0,0,1, side*0.065 - 0.20*left - 0.28*sideLag);
      turn(out, side > 0 ? B_LOWER_LEG_L : B_LOWER_LEG_R, 1,0,0, 0.46 + tuck + (dash ? 0.23 : 0) - 0.12*forward);
      turn(out, side > 0 ? B_FOOT_L : B_FOOT_R, 1,0,0, 0.16 + 0.22*tuck - 0.15*legLag);
      if (handFree) {
        turn(out, arm, 0,0,1, side*(0.14 + 0.06*sway + 0.12*travel) - 0.16*sideLag);
        turn(out, arm, 1,0,0, 0.25*forward - 0.13*legLag - side*0.055*drift);
        turn(out, side > 0 ? B_LOWER_ARM_L : B_LOWER_ARM_R, 1,0,0, -0.18 - 0.12*side*sway - 0.15*travel);
      }
    }
    spineShare = 0.09;
    twistAngle = 0;
  } else if (!st.grounded) {
    loop(anim.fall, t, out);
    twistAngle = 0;
  } else if (st.stance === STANCE_PRONE) {
    locomote(anim, anim.proneIdle, anim.crawling, t, speed, phase, reverse, out);
    // A prone body turns as one piece, and only the neck and head follow the look.
    twistAngle = 0;
    spineShare = 0;
  } else if (st.stance === STANCE_CROUCH) {
    locomote(anim, anim.crouchIdle, anim.crouching, t, speed, phase, reverse, out);
  } else {
    locomote(anim, anim.idle, anim.standing, t, speed, phase, reverse, out);
    if (speed <= 0) twistAngle = 0;
  }

  const act = st.action & 7;
  const hold = st.action >>> 3;
  // Ticks since the act began. A pose drawn a moment before the act's first tick wraps above 250, and that counts as 0.
  let e = act === ACT_NONE ? 0 : (tick - st.actionStart) % 256;
  if (e < 0) e += 256;
  if (e > 250) e = 0;
  /** How far the arms are up and aimed, 0 to 1. Raised arms follow the whole look pitch, not only the spine's share. */
  let raised = 0;
  let kick = 0;
  if (hold === HOLD_BOW) {
    // The bow is carried low, comes up as the draw begins, and goes down once the arrow is gone.
    raised = act === ACT_DRAW ? clamp(e / BOW_RAISE, 0, 1) : act === ACT_HOLD ? 1 : act === ACT_COOL ? clamp(1 - e / BOW_LOWER, 0, 1) : 0;
    if (anim.bowReady && anim.bowDrawn) {
      sampleClip(anim.bowReady, 0, a);
      sampleClip(anim.bowDrawn, 0, b);
      blendPose(a, a, b, raised, UPPER_FROM, UPPER_TO);
      blendPose(out, out, a, 1, UPPER_FROM, UPPER_TO);
    }
  } else if (hold === HOLD_RIFLE || hold === HOLD_PISTOL) {
    // A gun is at the shoulder except during a reload or an equip.
    const low = act === ACT_RELOAD ? clamp(e / GUN_LOWER, 0, 1) : act === ACT_EQUIP ? clamp(1 - e / EQUIP_TICKS, 0, 1) : 0;
    raised = 1 - low;
    if (act === ACT_COOL && e < KICK_TICKS) kick = KICK * (1 - e / KICK_TICKS);
    const up = hold === HOLD_RIFLE ? anim.gunAimed : anim.pistolAimed;
    const down = hold === HOLD_RIFLE ? anim.gunLowered : anim.pistolLowered;
    if (up && down) {
      sampleClip(up, 0, a);
      sampleClip(down, 0, b);
      blendPose(a, a, b, low, UPPER_FROM, UPPER_TO);
      blendPose(out, out, a, 1, UPPER_FROM, UPPER_TO);
    }
  }

  if (act === ACT_SWING && hold !== HOLD_CARRY) {
    const clip = hold === HOLD_HANDS ? ((st.actionStart & 1) !== 0 ? (anim.punchCross ?? anim.punch) : anim.punch) : hold === HOLD_THROW ? anim.throwing : anim.toolSwing;
    const k = e < SWING_IN ? e / SWING_IN : (SWING_TICKS - e) / SWING_OUT;
    if (clip && k > 0) {
      sampleClip(clip, (e / SWING_TICKS) * (clip.frames - 1), a);
      blendPose(out, out, a, k, UPPER_FROM, UPPER_TO);
      blendPose(out, out, a, k, HANDS_FROM, HUMAN_BONES);
    }
  }

  // An emote over all that: a whole-body one stands the body straight, and only its neck and head follow the look.
  if (!(st.jet && st.jetMode >= JET_UP) && emotePose(anim.emotes, st, tick, out) > 0) {
    twistAngle = 0;
    spineShare = 0;
    raised = 0;
    kick = 0;
  }

  if (twistAngle !== 0) {
    // The hips turn toward the direction of travel and the spine turns back to where the body faces.
    turnRoot(out, 0, 1, 0, twistAngle, 0);
    turn(out, B_SPINE, 0, 1, 0, -twistAngle / 3);
    turn(out, B_CHEST, 0, 1, 0, -twistAngle / 3);
    turn(out, B_UPPER_CHEST, 0, 1, 0, -twistAngle / 3);
  }
  if (bodyPitch !== 0) turnRoot(out, 1, 0, 0, -bodyPitch, SWIM_PIVOT);
  const look = pitch - bodyPitch;
  if (look !== 0) {
    // Looking up is a negative turn about X, which raises +Z toward +Y.
    turn(out, B_SPINE, 1, 0, 0, -look * spineShare);
    turn(out, B_CHEST, 1, 0, 0, -look * spineShare);
    turn(out, B_UPPER_CHEST, 1, 0, 0, -look * spineShare);
    turn(out, B_NECK, 1, 0, 0, -look * PITCH_NECK);
    turn(out, B_HEAD, 1, 0, 0, -look * PITCH_HEAD);
  }
  // Raised arms take the pitch the spine did not, plus a gun's kick.
  const lift = (look * (1 - 3 * spineShare) + kick) * raised;
  if (lift !== 0) {
    turn(out, B_SHOULDER_L, 1, 0, 0, -lift);
    turn(out, B_SHOULDER_R, 1, 0, 0, -lift);
  }
  // Arms round a creature hold it where they hold it, however the back has turned.
  if (hold === HOLD_CARRY) cradle(out, st.stance);
  if (st.jet && st.jetMode === JET_FIST && hold === HOLD_HANDS) jetPunch(out, st, e, pitch);
}

const fistParent = new Float64Array(4);
const fistReach = new Float64Array(4);

/** Extend the lead glove along the travel vector even when the chest is pitched over. */
function jetPunch(out: Pose, st: AnimState, elapsed: number, pitch: number): void {
  const left = (st.actionStart & 1) === 0;
  const arm = left ? B_UPPER_ARM_L : B_UPPER_ARM_R;
  const elbow = left ? B_LOWER_ARM_L : B_LOWER_ARM_R;
  const hand = left ? B_HAND_L : B_HAND_R;
  const weight = clamp(elapsed / 2, 0, 1);
  quatIdentity(fistParent, 0);
  for (let bone = HUMAN.parent[arm]!; bone >= 0; bone = HUMAN.parent[bone]!)
    quatMul(fistParent, 0, out.rot, bone * 4, fistParent, 0);
  quatAxis(fistReach, 0, 0, 1, 0, left ? -PI/2 : PI/2);
  quatAxis(q, 0, 1, 0, 0, -clamp(pitch, -0.85, 0.85) - 0.13);
  quatMul(fistReach, 0, q, 0, fistReach, 0);
  quatAxis(q, 0, 0, 1, 0, st.dir * TAU / DIR_STEPS);
  quatMul(fistReach, 0, q, 0, fistReach, 0);
  quatMulConj(q, 0, fistParent, 0, fistReach, 0);
  quatNlerp(out.rot, arm*4, out.rot, arm*4, q, 0, weight);
  quatAxis(q, 0, 0, 1, 0, left ? -0.16 : 0.16);
  quatNlerp(out.rot, elbow*4, out.rot, elbow*4, q, 0, weight);
  quatIdentity(q, 0);
  quatNlerp(out.rot, hand*4, out.rot, hand*4, q, 0, weight);
}

/** Turns the whole body about an axis through (0, pivotY, 0) in model space. */
function turnRoot(pose: Pose, ax: number, ay: number, az: number, angle: number, pivotY: number): void {
  quatAxis(q, 0, ax, ay, az, angle);
  quatMul(pose.rot, B_HIPS * 4, q, 0, pose.rot, B_HIPS * 4);
  const rest = HUMAN.rest;
  const x = rest[0]! + pose.root[0]!;
  const y = rest[1]! + pose.root[1]! - pivotY;
  const z = rest[2]! + pose.root[2]!;
  quatRotate(q, 0, x, y, z, v, 0);
  pose.root[0] = v[0]! - rest[0]!;
  pose.root[1] = v[1]! + pivotY - rest[1]!;
  pose.root[2] = v[2]! - rest[2]!;
}
