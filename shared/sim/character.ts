import { copySkate, sameSkate, type SkateState } from "./skate-state.ts";
// One fixed step for one upright capsule. Server and client run this same code, and the same state and input give the same bits.
// A position is committed only if capsuleFree accepts it, and a substep moves at most a radius sideways, so no input crosses a wall.

import { flags } from "../codes.ts";
import { BLOCK_SOFT_SPEED, blockOut, pushOut, turnFree } from "./blockers.ts";
import { TICK_RATE, WORLD_MAX_Y, WORLD_MIN_Y, YAW_UNITS } from "../coords.ts";
import { PI, TAU, detAtan2, detCos, detSin } from "../math/scalar.ts";
import { sortU32 } from "../sort.ts";
import { REACT_CONTROL_TICKS, REACT_FRAMES, reactClass } from "./react.ts";
import { withTurn } from "../anim/reactions.ts";
import { PAD, SKIN, wallDepth, wallOut, capsuleBox, capsuleFree, groundStands, groundUnder, nothingBuilt, push, restingAt, settleOnto, steepGround, stepOnto, type CollisionWorld } from "../world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../world/ray.ts";
import { Found, type StructureStore } from "../world/structures.ts";

// Bit positions match the five slots in worn inventory order. Only serviceable pieces count.
export const JET_HELMET = 1 << 0;
export const JET_CUIRASS = 1 << 1;
export const JET_GLOVES = 1 << 2;
export const JET_GREAVES = 1 << 3;
export const JET_BOOTS = 1 << 4;
export const JET_FULL_SUIT = 31;
export const JET_CAPACITY = 10 * TICK_RATE;
/**
 * What the pieces add on the ground and in the water, as ARK's Tek suit does (ark.wiki.gg, Tek Armor and Tek
 * Chestpiece, 2026-11-18): the leggings "allow powerful forward movement", and under water "the jetpack boosts
 * swimming speed". The wiki gives no figures; these are ours. A sprint in the greaves still spends stamina.
 */
export const JET_STRIDE = 1.5;
export const JET_SWIM = 1.5;
export const JET_LIFT = 1;
export const JET_HOVER = 2;
export const JET_UP = 3, JET_FIST = 4, JET_DASH = 5;
const JET_TAP = 9, JET_RECOVERY = 33, JET_BURST_TICKS = 9;

export function bootThrust(mode: number, gear: number, speed: number): boolean {
  return (gear & JET_BOOTS) !== 0 && (mode >= JET_UP || (mode === JET_HOVER && (gear & JET_GREAVES) !== 0 && speed > 6));
}

/** A button's bit is its place among these lines. A new button is one more line, and the wire widens for it. */
const button = flags();
export const BTN_JUMP = button();
export const BTN_SPRINT = button();
/** Swing, harvest, attack. The server acts on the tick it consumes the press. */
export const BTN_PRIMARY = button();
export const BTN_USE = button();
/** Aim, draw, block. */
export const BTN_SECONDARY = button();
export const BTN_RELOAD = button();
/** Strike with the held item, or a fist. */
export const BTN_MELEE = button();
/** Held while the body should stay low. The client turns a key press into this. */
export const BTN_CROUCH = button();
export const BTN_PRONE = button();
/** Toggles the held item's attachment. */
export const BTN_MOD = button();
/**
 * A helmet's visor held up (client/core/visor.ts): the step makes nothing of it, and the server takes it as the proof a
 * visor's gaze needs (server/gaze.ts, D1084), as a sight's is the secondary held.
 */
export const BTN_VISOR = button();
/** At the wheel of a car with thrusters (shared/sim/vehicle-thrusters.ts), a flip's burst; its axis from the keys held with it. */
export const BTN_BURST = button();
export const BTN_AIR_REMOTE = button();
/** How many buttons there are. */
export const buttonCount = button.count;

/** A lower stance is a shorter capsule, a lower eye and a slower walk. */
export const STANCE_STAND = 0;
export const STANCE_CROUCH = 1;
export const STANCE_PRONE = 2;

/** No movement, for a dead survivor waiting to respawn. */
export const MODE_NONE = 0;
export const MODE_WALK = 1;
export const MODE_SWIM = 2;
/** Free flight with no collision. Set only by the server (admins, spectators). */
export const MODE_GHOST = 3;
/** Flight as a ghost's, but meeting the ground, pieces and nodes. Set only by the server (admins). */
export const MODE_FLY = 4;
/**
 * A creature's own flight (planning/reference/flyers-plan.md), stepped by its species' numbers (the `fly` fields of
 * MoveParams), not the admin's. A flyer is in the air while its jump is held: the client turns Space into a toggle, as it
 * does the stance keys, and a mind holds jump to stay up. 6 and 7 are free.
 */
export const MODE_FLYER = 5;
/** The most ticks either flight counter of a body holds (Body.regenWait, Body.rollWait): 10 bits on the wire, 34 s. */
export const FLIGHT_TICKS_MAX = 1023;
/** In the air a flyer's prone key is its brake, and its crouch key its barrel roll (ARK's X and C). */
export const BTN_BRAKE = BTN_PRONE;
export const BTN_ROLL = BTN_CROUCH;

/** Stamina is stored in thousandths of a point, so it steps in exact integers. */
export const STAMINA_UNITS = 1000;
/** Stamina units a tick of a held breath costs: a full hundred lasts six seconds (D1085). */
export const BREATH_STAMINA = 550;

/**
 * A glider carried and opened in the air (planning/workstreams/glider.md): the frond glider, grade 1 of Body.glideGear's
 * three. The numbers are chosen, not ARK's, whose parachute this stands for. With the stick forward it flies GLIDE_SPEED
 * metres per second and sinks GLIDE_SINK, 4.5 forward for each one lost; sideways it slips at GLIDE_SIDE. With no stick it
 * comes straight down. The stick back is a flare, which stops it and sinks GLIDE_FLARE_SINK. Sprint is a dive, GLIDE_DIVE
 * forward and GLIDE_DIVE_SINK down, and the speed a dive leaves it with floats it level as it bleeds away (GLIDE_FLOAT
 * metres per second of sink lost for each one above GLIDE_SPEED). Its speed moves toward the one wished at GLIDE_ACCEL,
 * so it carries speed, and under way its velocity turns toward the way wished at GLIDE_TURN. Sinking more than GLIDE_HARD faster than it should, it is braked at GLIDE_BRAKE,
 * the fastest fall in a second and 30 m, and the rest of the way at GLIDE_SETTLE. It never climbs: rising, the body is
 * under gravity alone.
 */
export const GLIDE_SPEED = 10;
export const GLIDE_SIDE = 6;
export const GLIDE_DIVE = 16;
export const GLIDE_SINK = 2.2;
export const GLIDE_FLARE_SINK = 1.5;
export const GLIDE_DIVE_SINK = 7;
export const GLIDE_FLOAT = 0.55;
export const GLIDE_ACCEL = 6;
/** Radians a second its velocity swings toward the way wished, 100 degrees, once both are above GLIDE_STEER metres per second. */
export const GLIDE_TURN = 1.7453292519943295;
export const GLIDE_STEER = 1.5;
export const GLIDE_BRAKE = 60;
export const GLIDE_SETTLE = 25;
export const GLIDE_HARD = 3;
/** Stamina units a tick under an open glider, 1.6 points a second, and in a dive, 3.2. None comes back in the air. */
export const GLIDE_STAMINA = 53;
export const GLIDE_DIVE_STAMINA = 107;
/** Ticks on the ground or in water after a glide before stamina comes back (Body.regenWait). */
export const GLIDE_REGEN_WAIT = 30;
/** Bits of Body.glideKeys: Jump and Crouch as last sampled. */
export const GLIDE_KEY_JUMP = 1;
export const GLIDE_KEY_CROUCH = 2;
/** How an open glider flies, for the pose and the sound (glidePhase). */
export const GLIDE_TRIM = 0;
export const GLIDE_DIVING = 1;
export const GLIDE_FLARED = 2;

/** GLIDE_TRIM, GLIDE_DIVING or GLIDE_FLARED from the velocity alone, so that every observer reads the same one. */
export function glidePhase(vx: number, vy: number, vz: number): number {
  if (vy < -(GLIDE_SINK + GLIDE_DIVE_SINK) / 2) return GLIDE_DIVING;
  return vy > -(GLIDE_SINK + GLIDE_FLARE_SINK) / 2 && vx * vx + vz * vz < 4 ? GLIDE_FLARED : GLIDE_TRIM;
}

/** The share of its usual hold on its own speed a body keeps while it reels from a blow (Body.reactTicks). */
const STAGGER_HOLD = 0.15;
/** Bits of Body.mflags. The server sets all but MF_WINDED, which the step sets and clears. */
export const MF_NO_SPRINT = 1;
export const MF_NO_JUMP = 2;
/** Carrying too much to move. */
export const MF_ROOTED = 4;
/** Set when stamina reaches zero, cleared once a quarter of it has returned. */
export const MF_WINDED = 8;
/** Unconscious. */
export const MF_OUT = 16;
/** Knocked down, lying as its ragdoll: its client follows the server and does not predict it. */
export const MF_DOWN = 32;

/** A walker starts swimming when this fraction of its height is under water. */
const SWIM_ENTER = 0.7;
/** A swimmer floats with this fraction under water. */
const SWIM_FLOAT = 0.75;
/** A swimmer stands up when less than this fraction is under water. */
const SWIM_EXIT = 0.55;
/** A swimmer above its float line settles onto it at this speed, in metres per second. */
const SWIM_SETTLE = 1;
/** Each tick, a body moving faster than 1.5 times its swim speed keeps this share of its velocity. */
const WATER_DRAG = 0.85;

/** Set by the last stepBody call. */
export const stepOut = {
  /** Downward speed at which an airborne body touched down this tick, or 0. A flyer setting down from flight has 0. */
  landSpeed: 0,
  /** A flyer took off this tick, set down from flight on the ground or water unhurt, or began a barrel roll. */
  tookOff: false,
  setDown: false,
  rolled: false,
  /** A glider opened this tick, or folded: by its keys, on landing, in water, or with its stamina spent. */
  glideOpened: false,
  glideFolded: false,
  /**
   * The wall a walking body met hardest this tick, all 0 where it met none: the level unit way out of it, the speed in
   * metres a second it was moving into it before it slid, at least 0, and how high above its feet it touched.
   */
  wallNx: 0,
  wallNz: 0,
  wallInto: 0,
  wallY: 0,
};

export interface MoveParams {
  readonly radius: number;
  readonly height: number;
  readonly eyeHeight: number;
  /** Creatures keep their full standing capsule when a rider presses crouch/prone. Unconsciousness is separate. */
  readonly lowStance: boolean;
  /** crouchMul and proneMul are shares of the walk speed. */
  readonly crouchHeight: number;
  readonly crouchEye: number;
  readonly crouchMul: number;
  readonly proneHeight: number;
  readonly proneEye: number;
  readonly proneMul: number;
  readonly walkSpeed: number;
  readonly sprintMul: number;
  readonly accelGround: number;
  readonly accelAir: number;
  readonly jumpSpeed: number;
  readonly gravity: number;
  /** Steepest walkable slope, as the cosine of its angle. */
  readonly slopeCos: number;
  /** Tallest terrain rise taken in one substep. */
  readonly stepUp: number;
  /** Largest drop a grounded body follows without leaving the ground. */
  readonly stepDown: number;
  readonly swimSpeed: number;
  /** Authored float depth below the water; absent retains the exact height-based thresholds. */
  readonly swimDepth?: number;
  /** Breathing only: measured head elevation of a conscious swimmer, independent of its standing view. */
  readonly swimEyeHeight?: number;
  readonly swimSprintMul: number;
  readonly accelSwim: number;
  /**
   * Stamina units per tick while sprinting, per tick while resting, and per jump. A body whose walking costs stamina
   * (staminaWalk units a tick) gets none back while it walks on land.
   */
  readonly staminaSprint: number;
  readonly staminaRegen: number;
  readonly staminaJump: number;
  readonly staminaWalk: number;
  /** In 1/65536 turns per tick. 0 means it faces the look at once, as a survivor does. */
  readonly turnRate: number;
  /**
   * A head held clear of walls (SpeciesDef.footprint.head): a sphere this far ahead of the origin along the facing and
   * this high, of this radius. The body neither walks nor turns it into a structure. Omitted for a body whose head is
   * within its capsule.
   */
  readonly headAhead?: number;
  readonly headUp?: number;
  readonly headRadius?: number;
  /**
   * The ends of its footprint (SpeciesDef.footprint) held clear of walls as its head is: spheres of radius `endRadius`
   * centred `endFront` and `endBack` metres along the facing (behind is negative), hung from its belly (endUp). An end is
   * tested only where it reaches past the capsule. Omitted for a body whose footprint is within its capsule.
   */
  readonly endFront?: number;
  readonly endBack?: number;
  readonly endRadius?: number;
  /** False for a body that moves only the way it faces. */
  readonly strafe: boolean;
  // A creature's own flight (MODE_FLYER), from SpeciesDef.fly. For a body that does not fly, `flies` is false and every
  // number is 0.
  readonly flies: boolean;
  /** Metres per second flying, and the sprint as a multiple of it (a tame's own in its tamedMove). */
  readonly flySpeed: number;
  readonly flySprintMul: number;
  /** Metres per second squared by which its velocity moves toward the one it wishes, so that it carries speed. */
  readonly accelFly: number;
  /** In 1/65536 turns per tick, as turnRate is: how fast its facing follows the look in the air. */
  readonly flyTurnRate: number;
  /** Stamina units per tick flying or hovering, and per tick sprinting in the air. */
  readonly staminaFly: number;
  readonly staminaFlySprint: number;
  /** Stamina units one barrel roll costs, and one grab. */
  readonly staminaRoll: number;
  readonly staminaGrab: number;
  /** Ticks after it last flew before any stamina comes back on the ground (Body.regenWait), at most FLIGHT_TICKS_MAX. */
  readonly regenWaitTicks: number;
  /** Metres per second a barrel roll adds to its speed, and the ticks from one roll to the next (Body.rollWait). */
  readonly rollBurst: number;
  readonly rollTicks: number;
}

/**
 * The predicted state of a body. The server sends all of it for the client's own body, and the client derives none of it
 * from stats, so both sides step with the same numbers.
 */
export class Body {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = false;
  mode = MODE_WALK;
  /** STANCE_*. Changed only by the step, from the buttons. */
  stance = STANCE_STAND;
  /** Thousandths of a point, 0 .. staminaMax * STAMINA_UNITS. */
  stamina = 100 * STAMINA_UNITS;
  /** Whole points. Set by the server from stat points. */
  staminaMax = 100;
  /** Speed on land and in water, in thousandths of the species value. Set by the server. */
  speedQ = 1000;
  swimQ = 1000;
  /** MF_ bits. */
  mflags = 0;
  /** Its reaction to a blow (shared/anim/reactions.ts), set by the server, and the ticks left of it, which the step counts down. */
  react = 0;
  reactTicks = 0;
  /**
   * The species whose movement steps this body (a content index), and its facing in 1/65536 turns. Both travel with the body,
   * so the client steps the body it was last told it drives, its survivor's or a mount's.
   */
  kind = 0;
  yaw = 0;
  /** Full vehicle controller state, copied and replayed with the ordinary body. */
  vehicle = false;
  skate: SkateState | null = null;
  vehicleYaw = 0;
  vehicleYawRate = 0;
  vehicleGear = 0;
  vehicleRpm = 0;
  vehicleShiftTime = 0;
  vehiclePayloadMass = 0;
  vehicleRotorRpm = 0;
  vehicleRotorPhase = 0;
  vehicleEngineCondition = 1;
  /** Marine hull integrity and flooded volume, separate from propulsion health. */
  vehicleHullCondition = 1;
  vehicleFlooding = 0;
  vehicleRotorCondition = 1;
  vehicleEngineOn = false;
  vehicleQx = 0;
  vehicleQy = 0;
  vehicleQz = 0;
  vehicleQw = 1;
  vehicleCollective = 0;
  /** A car's thruster state and its two cooldowns, packed (shared/sim/vehicle-thrusters.ts); 0 on every other vehicle. */
  vehicleThrust = 0;
  vehicleThrustCool = 0;
  vehiclePitchRate = 0;
  vehicleRollRate = 0;
  vehicleGroundPitch = 0;
  vehicleGroundRoll = 0;
  vehicleRideOffset = 0;
  vehicleRideVelocity = 0;

  vehiclePitch = 0;
  vehicleRoll = 0;
  steering = 0;
  wheelAngle = 0;
  fuel = 0;
  seat = 0;
  seatSlot = 0;
  seatGen = 0;

  /**
   * Action state (shared/sim/weapon.ts). `held` is the content index of the item in hand, 0 for none. `reloadTo` is the rounds a
   * reload would leave loaded, set by the server from what the body carries.
   */
  held = 0;
  act = 0;
  actTicks = 0;
  rounds = 0;
  reloadTo = 0;
  /**
   * Aim state, protocol 13 (planning/reference/weapons-plan.md, M1 and M2), stepped by stepAim (shared/sim/aim.ts). `bloom`
   * is how far shots have opened the weapon's cone, in 64ths of one shot's (BLOOM_SHOT); `kick` is the recoil added to the
   * pitch a shot leaves at, in 16 pitch units (KICK_UNIT). Neither is saved: both fall to nothing within seconds.
   */
  bloom = 0;
  kick = 0;
  jetGear = 0;
  /** Ticks of thrust spent from this survivor's rechargeable reserve. */
  jetSpent = 0;
  jetThrust = 0;
  /** Last sampled Jump, Sprint and Melee, their tap windows, and the shared burst recovery in simulation ticks. */
  jetKeys = 0;
  jetJumpTap = 0;
  jetSprintTap = 0;
  jetRecovery = 0;
  /**
   * Flight state (planning/reference/flyers-plan.md): the ticks before stamina may come back, held full in the air and
   * counted down on the ground and in water after it lands, and the ticks before it may roll again. Each is 0 for a body
   * that never flew and at most FLIGHT_TICKS_MAX. Not saved: both run out within seconds.
   */
  regenWait = 0;
  rollWait = 0;
  /**
   * The glider (planning/workstreams/glider.md): the grade of the best serviceable one it carries, 0 for none, set by the
   * server from its inventory; whether it is open; and Jump and Crouch as the step last sampled them (GLIDE_KEY_), so a
   * press is told from a hold on both sides. Not saved: a body saved in the air loads falling.
   */
  glideGear = 0;
  glide = 0;
  glideKeys = 0;
  /** Ground creature mode, secondary cooldown, and charge strength, predicted with its action. */
  creatureMode = 0;
  creatureCooldown = 0;
  creaturePrimaryCooldown = 0;
  creaturePower = 0;
  creatureSide = 0;

  copy(o: Body): void {
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    this.vx = o.vx;
    this.vy = o.vy;
    this.vz = o.vz;
    this.grounded = o.grounded;
    this.mode = o.mode;
    this.stance = o.stance;
    this.stamina = o.stamina;
    this.staminaMax = o.staminaMax;
    this.speedQ = o.speedQ;
    this.swimQ = o.swimQ;
    this.mflags = o.mflags;
    this.react = o.react;
    this.reactTicks = o.reactTicks;
    this.kind = o.kind;
    this.yaw = o.yaw;
    this.vehicle = o.vehicle;
    this.skate = copySkate(this.skate, o.skate);
    this.vehicleYaw = o.vehicleYaw;
    this.vehicleYawRate = o.vehicleYawRate;
    this.vehicleGear = o.vehicleGear;
    this.vehicleRpm = o.vehicleRpm;
    this.vehicleShiftTime = o.vehicleShiftTime;
    this.vehiclePayloadMass = o.vehiclePayloadMass;
    this.vehicleRotorRpm = o.vehicleRotorRpm;
    this.vehicleRotorPhase = o.vehicleRotorPhase;
    this.vehicleEngineCondition = o.vehicleEngineCondition;
    this.vehicleHullCondition = o.vehicleHullCondition;
    this.vehicleFlooding = o.vehicleFlooding;
    this.vehicleRotorCondition = o.vehicleRotorCondition;
    this.vehicleEngineOn = o.vehicleEngineOn;
    this.vehicleQx = o.vehicleQx;
    this.vehicleQy = o.vehicleQy;
    this.vehicleQz = o.vehicleQz;
    this.vehicleQw = o.vehicleQw;
    this.vehicleCollective = o.vehicleCollective;
    this.vehicleThrust = o.vehicleThrust;
    this.vehicleThrustCool = o.vehicleThrustCool;
    this.vehiclePitchRate = o.vehiclePitchRate;
    this.vehicleRollRate = o.vehicleRollRate;
    this.vehicleGroundPitch = o.vehicleGroundPitch;
    this.vehicleGroundRoll = o.vehicleGroundRoll;
    this.vehicleRideOffset = o.vehicleRideOffset;
    this.vehicleRideVelocity = o.vehicleRideVelocity;

    this.vehiclePitch = o.vehiclePitch;
    this.vehicleRoll = o.vehicleRoll;
    this.steering = o.steering;
    this.wheelAngle = o.wheelAngle;
    this.fuel = o.fuel;
    this.seat = o.seat;
    this.seatSlot = o.seatSlot;
    this.seatGen = o.seatGen;

    this.held = o.held;
    this.act = o.act;
    this.actTicks = o.actTicks;
    this.rounds = o.rounds;
    this.reloadTo = o.reloadTo;
    this.bloom = o.bloom;
    this.kick = o.kick;
    this.jetGear = o.jetGear;
    this.jetSpent = o.jetSpent;
    this.jetThrust = o.jetThrust;
    this.jetKeys = o.jetKeys;
    this.jetJumpTap = o.jetJumpTap;
    this.jetSprintTap = o.jetSprintTap;
    this.jetRecovery = o.jetRecovery;
    this.regenWait = o.regenWait;
    this.rollWait = o.rollWait;
    this.glideGear = o.glideGear;
    this.glide = o.glide;
    this.glideKeys = o.glideKeys;
    this.creatureMode = o.creatureMode;
    this.creatureCooldown = o.creatureCooldown;
    this.creaturePrimaryCooldown = o.creaturePrimaryCooldown;
    this.creaturePower = o.creaturePower;
    this.creatureSide = o.creatureSide;
  }

  /** Position, velocity and grounded. */
  samePosition(o: Body): boolean {
    return this.x === o.x && this.y === o.y && this.z === o.z && this.vx === o.vx && this.vy === o.vy && this.vz === o.vz && this.grounded === o.grounded;
  }

  equals(o: Body): boolean {
    return (
      this.samePosition(o) &&
      this.mode === o.mode &&
      this.stance === o.stance &&
      this.stamina === o.stamina &&
      this.staminaMax === o.staminaMax &&
      this.speedQ === o.speedQ &&
      this.swimQ === o.swimQ &&
      this.mflags === o.mflags &&
      this.react === o.react &&
      this.reactTicks === o.reactTicks &&
      this.kind === o.kind &&
      this.yaw === o.yaw &&
      this.vehicle === o.vehicle && sameSkate(this.skate, o.skate) &&
      this.vehicleYaw === o.vehicleYaw &&
      this.vehicleYawRate === o.vehicleYawRate &&
      this.vehicleGear === o.vehicleGear &&
      this.vehicleRpm === o.vehicleRpm &&
      this.vehicleShiftTime === o.vehicleShiftTime &&
      this.vehiclePayloadMass === o.vehiclePayloadMass &&
      this.vehicleRotorRpm === o.vehicleRotorRpm &&
      this.vehicleRotorPhase === o.vehicleRotorPhase &&
      this.vehicleEngineCondition === o.vehicleEngineCondition &&
      this.vehicleHullCondition === o.vehicleHullCondition &&
      this.vehicleFlooding === o.vehicleFlooding &&
      this.vehicleRotorCondition === o.vehicleRotorCondition &&
      this.vehicleEngineOn === o.vehicleEngineOn &&
      this.vehicleQx === o.vehicleQx &&
      this.vehicleQy === o.vehicleQy &&
      this.vehicleQz === o.vehicleQz &&
      this.vehicleQw === o.vehicleQw &&
      this.vehicleCollective === o.vehicleCollective &&
      this.vehicleThrust === o.vehicleThrust &&
      this.vehicleThrustCool === o.vehicleThrustCool &&
      this.vehiclePitchRate === o.vehiclePitchRate &&
      this.vehicleRollRate === o.vehicleRollRate &&
      this.vehicleGroundPitch === o.vehicleGroundPitch &&
      this.vehicleGroundRoll === o.vehicleGroundRoll &&
      this.vehicleRideOffset === o.vehicleRideOffset &&
      this.vehicleRideVelocity === o.vehicleRideVelocity &&

      this.vehiclePitch === o.vehiclePitch &&
      this.vehicleRoll === o.vehicleRoll &&
      this.steering === o.steering &&
      this.wheelAngle === o.wheelAngle &&
      this.fuel === o.fuel &&
      this.seat === o.seat &&
      this.seatSlot === o.seatSlot &&
      this.seatGen === o.seatGen &&

      this.held === o.held &&
      this.act === o.act &&
      this.actTicks === o.actTicks &&
      this.rounds === o.rounds &&
      this.reloadTo === o.reloadTo &&
      this.bloom === o.bloom &&
      this.kick === o.kick &&
      this.jetGear === o.jetGear && this.jetSpent === o.jetSpent && this.jetThrust === o.jetThrust &&
      this.jetKeys === o.jetKeys && this.jetJumpTap === o.jetJumpTap && this.jetSprintTap === o.jetSprintTap && this.jetRecovery === o.jetRecovery &&
      this.regenWait === o.regenWait &&
      this.glideGear === o.glideGear && this.glide === o.glide && this.glideKeys === o.glideKeys &&
      this.creatureMode === o.creatureMode &&
      this.creatureCooldown === o.creatureCooldown &&
      this.creaturePrimaryCooldown === o.creaturePrimaryCooldown &&
      this.creaturePower === o.creaturePower &&
      this.creatureSide === o.creatureSide &&
      this.rollWait === o.rollWait
    );
  }
}

/** Float depth, or an entry/exit threshold scaled about it. The omitted-field path keeps the original arithmetic. */
export function swimDepth(p: { readonly height: number; readonly swimDepth?: number }, fraction = SWIM_FLOAT): number {
  return p.swimDepth === undefined ? p.height * fraction : p.swimDepth * (fraction / SWIM_FLOAT);
}

export function stanceHeight(p: MoveParams, stance: number): number {
  return stance === STANCE_STAND ? p.height : stance === STANCE_CROUCH ? p.crouchHeight : p.proneHeight;
}

/** Above the feet. A body looks and aims from here. */
export function stanceEye(p: MoveParams, stance: number): number {
  return stance === STANCE_STAND ? p.eyeHeight : stance === STANCE_CROUCH ? p.crouchEye : p.proneEye;
}

const YAW_TO_RAD = TAU / YAW_UNITS;
const MAX_SUBSTEPS = 16;
const TERMINAL_SPEED = 60;
const GROUND_PROBE = 0.02;
const RESOLVE_ITERATIONS = 4;
/**
 * A ghost's or a flyer's speed, in metres per second: GHOST_SPEED, and with sprint GHOST_SPRINT times that at once, gaining
 * GHOST_RAMP each second it is held, up to GHOST_MAX. 8 km takes 17 s once at the most.
 */
const GHOST_SPEED = 12;
const GHOST_SPRINT = 5;
const GHOST_RAMP = 150;
const GHOST_MAX = 600;
/**
 * A creature's flight, where ARK gives no number (planning/quality/deviations.md): a take-off rises this many metres before it
 * hovers ("a few feet above ground"); going down to land, by choice or spent, it descends at DESCENT times its flying speed;
 * the brake stops it at BRAKE metres per second squared, a sprint in a third of a second.
 */
const TAKEOFF_RISE = 1.5;
const DESCENT = 2;
const BRAKE = 60;
const found = new Found();

/** Movement, replay and the server use the same edge detector. Recovery survives taking a piece off. */
function jetMode(b: Body, prior: number, buttons: number, ready: boolean, moving: boolean): number {
  if (!ready) {
    b.jetJumpTap = b.jetSprintTap = 0;
    return 0;
  }
  const keys = (buttons & (BTN_JUMP | BTN_SPRINT)) | ((buttons & BTN_MELEE) ? 4 : 0);
  const pressed = keys & ~b.jetKeys;
  b.jetKeys = keys;
  const up = (pressed & BTN_JUMP) !== 0 && b.jetJumpTap > 0;
  const dash = (pressed & BTN_SPRINT) !== 0 && b.jetSprintTap > 0 && moving;
  b.jetJumpTap = pressed & BTN_JUMP ? JET_TAP : Math.max(0, b.jetJumpTap-1);
  b.jetSprintTap = pressed & BTN_SPRINT ? JET_TAP : Math.max(0, b.jetSprintTap-1);
  if (b.grounded) return 0;
  const fist = (pressed & 4) !== 0 && !b.held && !b.act && (b.jetGear & JET_GLOVES) !== 0;
  const mode = up ? JET_UP : fist ? JET_FIST : dash && (b.jetGear & JET_GREAVES) && !(b.mflags & MF_NO_SPRINT) ? JET_DASH : 0;
  const cost = mode === JET_UP ? 24 : mode === JET_FIST ? 21 : 27;
  if (mode && b.jetRecovery === 0 && b.jetSpent + cost <= JET_CAPACITY) {
    b.jetSpent += cost;
    b.jetRecovery = JET_RECOVERY;
    b.jetJumpTap = b.jetSprintTap = 0;
    return mode;
  }
  if (prior >= JET_UP && b.jetRecovery > JET_RECOVERY-JET_BURST_TICKS
    && (prior !== JET_FIST || (!b.held && (b.jetGear & JET_GLOVES)))
    && (prior !== JET_DASH || ((b.jetGear & JET_GREAVES) && !(b.mflags & MF_NO_SPRINT)))) return prior;
  if (!(buttons & BTN_JUMP) || b.jetSpent >= JET_CAPACITY) return 0;
  b.jetSpent++;
  return buttons & BTN_SPRINT ? JET_HOVER : JET_LIFT;
}

/**
 * `moveX` (strafe right) and `moveZ` (forward) are -127 to 127. `yaw` and `pitch` are in 1/65536 turns, and pitch 16384 is
 * straight up. These are the quantized values sent on the wire.
 */
/** How deep in a wall the head of a body of `p` at (x, y, z) facing `yaw` (65536ths of a turn) is (MoveParams.headRadius, collide.ts wallDepth). */
export function headDepth(w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number): number {
  const r = p.headRadius!, a = (yaw * TAU) / 65536, ahead = p.headAhead!;
  return wallDepth(w, x + detSin(a) * ahead, y + p.headUp! - r, z + detCos(a) * ahead, r, y + p.height);
}

/** Whether the head of a body of `p` at (x, y, z) facing `yaw` is clear of every wall. */
export function headClear(w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number): boolean {
  return headDepth(w, p, x, y, z, yaw) === 0;
}

/** A footprint's ends hang from the belly: this share of the body's height above its feet. */
const BELLY = 0.4;

/**
 * How high above the feet the bottom of a footprint's end stands: at its belly, and never lower than a step up. Walls
 * meet it; blocks and kerbs, which its legs stop at or step onto, pass under it.
 */
export function endUp(p: MoveParams): number {
  return p.height * BELLY > p.stepUp ? p.height * BELLY : p.stepUp;
}

/** How deep in a wall the front end of the footprint of a body of `p` at (x, y, z) facing `yaw` is, or its back end (MoveParams.endRadius). */
export function endDepth(w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number, front: boolean): number {
  const r = p.endRadius!, a = (yaw * TAU) / 65536, at = front ? p.endFront! : p.endBack!;
  return wallDepth(w, x + detSin(a) * at, y + endUp(p), z + detCos(a) * at, r, y + p.height);
}

/** Metres deeper into a wall a head may go in a step: rounding, not a graze. */
const HEAD_SKIN = 0.002;

// The limbs a walker holds clear of walls: its head, and its footprint's ends where they reach past its capsule, hung from
// its belly (endUp). No step or turn takes one deeper into a wall than it is, and none is pushed out, so a body put in a
// wall is never thrown from it.
const HEAD = 0, FRONT = 1, BACK = 2;
/** Per limb: 1 if it is held clear, metres ahead along the facing, its radius, the height of its middle above the feet. */
const limbOn = new Uint8Array(3);
const limbAhead = new Float64Array(3);
const limbR = new Float64Array(3);
const limbMid = new Float64Array(3);
/** Per limb, its level offset from the origin at the facing `limbsFace` was given. */
const limbX = new Float64Array(3);
const limbZ = new Float64Array(3);
/** Where a move tried starts, as limbsWere noted it: the body's place, each limb's offset, and its depth, NaN until asked. */
let wasX = 0;
let wasY = 0;
let wasZ = 0;
const wasOffX = new Float64Array(3);
const wasOffZ = new Float64Array(3);
const limbWas = new Float64Array(3);
/** The height of the body whose limbs they are, and how far above its feet the bottom of an end stands (endUp). */
let limbOver = 0;
let endBottom = 0;
/** How much deeper the limb `limbDeeper` named would go. */
let limbGain = 0;

/** Sets the limbs of a body moving by `p`. False when it holds none clear. */
function limbsFor(p: MoveParams): boolean {
  const er = p.endRadius ?? 0;
  limbOn[HEAD] = p.headRadius ? 1 : 0;
  limbOn[FRONT] = er > 0 && p.endFront! + er > p.radius ? 1 : 0;
  limbOn[BACK] = er > 0 && er - p.endBack! > p.radius ? 1 : 0;
  if (limbOn[HEAD] === 0 && limbOn[FRONT] === 0 && limbOn[BACK] === 0) return false;
  limbOver = p.height;
  endBottom = er > 0 ? endUp(p) : 0;
  for (let k = HEAD; k <= BACK; k++) {
    if (limbOn[k] === 0) continue;
    const r = k === HEAD ? p.headRadius! : er;
    limbAhead[k] = k === HEAD ? p.headAhead! : k === FRONT ? p.endFront! : p.endBack!;
    limbR[k] = r;
    limbMid[k] = k === HEAD ? p.headUp! : endBottom + r;
  }
  return true;
}

/** Turns the limbs to facing `yaw`, in 65536ths of a turn. */
function limbsFace(yaw: number): void {
  const a = (yaw * TAU) / 65536, s = detSin(a), c = detCos(a);
  for (let k = HEAD; k <= BACK; k++) {
    limbX[k] = s * limbAhead[k]!;
    limbZ[k] = c * limbAhead[k]!;
  }
}

/** How deep limb `k`, offset (ox, oz), of a body at (x, y, z) is in a wall (collide.ts wallDepth), leaving its way out in wallOut. */
function limbDepth(w: CollisionWorld, k: number, x: number, y: number, z: number, ox: number, oz: number): number {
  const r = limbR[k]!;
  return wallDepth(w, x + ox, k === HEAD ? y + limbMid[HEAD]! - r : y + endBottom, z + oz, r, y + limbOver);
}

/** Notes a body at (x, y, z), its limbs as they now face, as where the moves `limbDeeper` tries start. */
function limbsWere(x: number, y: number, z: number): void {
  wasX = x;
  wasY = y;
  wasZ = z;
  for (let k = HEAD; k <= BACK; k++) {
    wasOffX[k] = limbX[k]!;
    wasOffZ[k] = limbZ[k]!;
    limbWas[k] = Number.NaN;
  }
}

/**
 * The first limb, plus one, that a body at (x, y, z) has more than `skin` deeper in a wall than where limbsWere noted, or 0.
 * Sets limbGain and wallOut. A limb clear of every wall is no deeper, so where it started is measured only for one in a wall.
 */
function limbDeeper(w: CollisionWorld, x: number, y: number, z: number, skin = HEAD_SKIN, ends = true): number {
  for (let k = HEAD; k <= (ends ? BACK : HEAD); k++) {
    if (limbOn[k] === 0) continue;
    const d = limbDepth(w, k, x, y, z, limbX[k]!, limbZ[k]!);
    if (!(d > skin)) continue;
    let was = limbWas[k]!;
    if (was !== was) {
      const ox = wallOut.x, oz = wallOut.z;
      was = limbWas[k] = limbDepth(w, k, wasX, wasY, wasZ, wasOffX[k]!, wasOffZ[k]!);
      wallOut.x = ox;
      wallOut.z = oz;
    }
    if (d > was + skin) {
      limbGain = d - was;
      return k + 1;
    }
  }
  return 0;
}

/**
 * Lets go each limb of a body at (x, y, z) that no structure stands within `more` metres of, where it is as it faces now
 * or, `turning`, anywhere it may swing to. Whether one is left.
 */
function limbsNear(w: CollisionWorld, x: number, y: number, z: number, more: number, turning: boolean): boolean {
  // Each limb's box, and first the box round them all: in the open one look finds nothing.
  let x0 = Infinity, z0 = Infinity, y0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = -Infinity;
  for (let k = HEAD; k <= BACK; k++) {
    if (limbOn[k] === 0) continue;
    const reach = (turning ? Math.abs(limbAhead[k]!) : 0) + limbR[k]! + more;
    const cx = turning ? x : x + limbX[k]!, cz = turning ? z : z + limbZ[k]!;
    const low = y + limbMid[k]! - limbR[k]! - more - PAD;
    nearBox[k * 6] = cx - reach;
    nearBox[k * 6 + 1] = cz - reach;
    nearBox[k * 6 + 2] = low;
    nearBox[k * 6 + 3] = cx + reach;
    nearBox[k * 6 + 4] = cz + reach;
    nearBox[k * 6 + 5] = low + 2 * (limbR[k]! + more + PAD);
    x0 = Math.min(x0, cx - reach); z0 = Math.min(z0, cz - reach); y0 = Math.min(y0, nearBox[k * 6 + 2]!);
    x1 = Math.max(x1, cx + reach); z1 = Math.max(z1, cz + reach); y1 = Math.max(y1, nearBox[k * 6 + 5]!);
  }
  const s = w.structs;
  if (!s.any(x0, z0, x1, z1, y0, y1)) return false;
  let near = false;
  for (let k = HEAD; k <= BACK; k++) {
    if (limbOn[k] === 0) continue;
    const o = k * 6;
    if (s.any(nearBox[o]!, nearBox[o + 1]!, nearBox[o + 3]!, nearBox[o + 4]!, nearBox[o + 2]!, nearBox[o + 5]!)) near = true;
    else limbOn[k] = 0;
  }
  return near;
}
/** Per limb, the box limbsNear looks in: its least x, z and y, then its most. */
const nearBox = new Float64Array(18);

/**
 * Facings a turn's way round is tried at: each whole SWEEP of 65536 for the head, and each fourth of those for the ends,
 * whose circles are small. Tried at the same facings every tick, a way's facings only grow or shrink as the body turns.
 */
const SWEEP = 2048;
const SWEEP_ENDS = 4 * SWEEP;
/** Metres deeper a limb must go somewhere on a way round for it to be blocked: a graze between two facings tried is not. */
const SWEEP_SKIN = 0.05;

/** Whether no limb of a body at (x, y, z) facing `yaw` is more than `skin` deeper than limbsWere found; with `ends` false, the head alone. */
function faceClear(w: CollisionWorld, x: number, y: number, z: number, yaw: number, skin: number, ends = true): boolean {
  limbsFace(yaw);
  return limbDeeper(w, x, y, z, skin, ends) === 0;
}

/** Whether a body at (x, y, z) turning `arc` from `from` keeps its limbs clear (faceClear) at the facings tried on the way, short of its end. */
function sweepClear(w: CollisionWorld, x: number, y: number, z: number, from: number, arc: number): boolean {
  const way = arc > 0 ? 1 : -1;
  for (let k = way > 0 ? SWEEP - (from % SWEEP) : -(from % SWEEP || SWEEP); k * way < arc * way; k += way * SWEEP) {
    const yaw = (from + k) & 0xffff;
    if (!faceClear(w, x, y, z, yaw, SWEEP_SKIN, yaw % SWEEP_ENDS === 0)) return false;
  }
  return true;
}

/**
 * The turn this tick of a walker that holds limbs clear, `want` from its facing to its look and `turn` the first step of
 * it. Where a limb would go into a wall on the short way round and not on the long, it turns the long way, if its first
 * step there is clear and the bodies about it let it, and else not at all; otherwise the short way while its step is
 * clear. The ways round are tried at the same facings every tick, so once it has chosen a way it keeps to it. A look that
 * would itself put a limb in a wall is the end of both ways, so it is tried first.
 */
function turnClear(w: CollisionWorld, b: Body, p: MoveParams, want: number, turn: number, rate: number): number {
  const x = b.x, y = b.y, z = b.z, from = b.yaw;
  limbsFace(from);
  limbsWere(x, y, z);
  const step = faceClear(w, x, y, z, (from + turn) & 0xffff, HEAD_SKIN);
  const other = want > 0 ? want - 65536 : want + 65536;
  if (turn === want || !faceClear(w, x, y, z, (from + want) & 0xffff, SWEEP_SKIN)) return step ? turn : 0;
  if (sweepClear(w, x, y, z, from, want) || !sweepClear(w, x, y, z, from, other)) return step ? turn : 0;
  const back = other > 0 ? rate : -rate;
  const bodies = w.blockers;
  return faceClear(w, x, y, z, (from + back) & 0xffff, HEAD_SKIN)
    && (!bodies || bodies.count === 0 || turnFree(bodies, b.kind, x, y, z, from, (from + back) & 0xffff, stanceHeight(p, b.stance))) ? back : 0;
}

/** How hard the strongest wall this step pushed, or a limb would have gone into, as stepOut has it. */
let wallMost = 0;

/** A wall met with strength `most`, its level unit way out (nx, nz), touched `at` metres above the feet: kept if the strongest yet. */
function metWall(most: number, nx: number, nz: number, at: number): void {
  if (most <= wallMost) return;
  wallMost = most;
  stepOut.wallNx = nx;
  stepOut.wallNz = nz;
  stepOut.wallY = at;
}

/**
 * Metres above its feet at `ny` that a capsule `r` wide and `h` tall touches what puts it out along a way whose upward
 * share is `uy`: on a sphere where the way leans up or down, else halfway up what it shares with the piece `ref` of
 * `store` (none for the ground).
 */
function touchAt(uy: number, store: StructureStore | null, ref: number, ny: number, r: number, h: number): number {
  if (uy > LEVEL) return r * (1 - uy);
  if (uy < -LEVEL) return h - r * (1 + uy);
  if (!store) return h * 0.5;
  const t = store.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff, kind = t.kind[slot]!;
  const low = Math.max(0, t.y[slot]! + store.low[kind]! - ny), high = Math.min(h, t.y[slot]! + store.high[kind]! - ny);
  return high > low ? (low + high) * 0.5 : h * 0.5;
}
/** The upward share of a way out under which it is level, through a capsule's side. */
const LEVEL = 0.05;

export function stepBody(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  stepOut.landSpeed = 0;
  stepOut.wallNx = stepOut.wallNz = stepOut.wallInto = stepOut.wallY = 0;
  wallMost = 0;
  const priorThrust = b.jetThrust;
  b.jetThrust = 0;
  if (b.jetRecovery > 0) b.jetRecovery--;
  if (b.mode !== MODE_WALK || b.seat || !(b.jetGear & JET_CUIRASS)) b.jetKeys = b.jetJumpTap = b.jetSprintTap = 0;
  stepOut.tookOff = false;
  stepOut.setDown = false;
  stepOut.rolled = false;
  stepOut.glideOpened = false;
  stepOut.glideFolded = false;
  // A glider is flown in the walking step alone. Any other mode folds it and forgets its keys.
  if (b.mode !== MODE_WALK) {
    if (b.glide) stepOut.glideFolded = true;
    b.glide = 0;
    b.glideKeys = 0;
  }
  if (b.mode === MODE_NONE) {
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    return;
  }
  // The facing follows the look, at once or at turnRate, or in its own flight at flyTurnRate. The body then moves the way it faces.
  const previousYaw = b.yaw;
  const rate = b.mode === MODE_FLYER ? p.flyTurnRate : p.turnRate;
  if (rate <= 0 || b.mode === MODE_GHOST || b.mode === MODE_FLY) b.yaw = yaw & 0xffff;
  else {
    const want = ((yaw - b.yaw + 32768) & 0xffff) - 32768;
    let turn = want > rate ? rate : want < -rate ? -rate : want;
    // A long body does not swing itself into a body standing still (shared/sim/blockers.ts), nor its head or ends into a wall.
    const bodies = w.blockers;
    if (bodies && bodies.count > 0 && b.mode === MODE_WALK && !turnFree(bodies, b.kind, b.x, b.y, b.z, b.yaw, (b.yaw + turn) & 0xffff, stanceHeight(p, b.stance))) turn = 0;
    else if (turn !== 0 && b.mode === MODE_WALK && limbsFor(p) && limbsNear(w, b.x, b.y, b.z, 0, true)) turn = turnClear(w, b, p, want, turn, rate);
    b.yaw = (b.yaw + turn) & 0xffff;
  }
  yaw = b.yaw;
  if (!p.strafe) moveX = 0;
  if (b.mode === MODE_GHOST) {
    stepGhost(w, b, moveX, moveZ, yaw, pitch, buttons, dt);
    return;
  }
  if (b.mode === MODE_FLY) {
    stepFly(w, b, moveX, moveZ, yaw, pitch, buttons, p, dt);
    return;
  }
  if (p.flies || b.mode === MODE_FLYER) {
    buttons = takeWing(w, b, buttons, p);
    if (b.mode === MODE_FLYER) {
      stepFlyer(w, b, moveZ, yaw, pitch, buttons, p, dt);
      return;
    }
  }
  if (b.mode === MODE_SWIM) {
    stepSwim(w, b, moveX, moveZ, yaw, pitch, buttons, p, dt);
    return;
  }
  const hf = w.hf;
  const structs = w.structs;
  const r = p.radius;
  const flags = b.mflags;

  // Going lower happens at once. Rising needs room for the taller capsule.
  let stance = b.stance;
  // An unconscious body lies prone and ignores every button.
  const out = (flags & MF_OUT) !== 0;
  if (out) buttons = 0;
  // The glider's keys: Crouch pressed in the air opens it and folds it, and Jump too, which opens it only without the
  // cuirass, whose jet is Jump's in the air. In the air a body that carries one does not crouch, so the key is the glider's.
  const wasGliding = b.glide !== 0;
  let glide = 0;
  if (b.glideGear !== 0 && !b.seat) {
    const keys = ((buttons & BTN_JUMP) !== 0 ? GLIDE_KEY_JUMP : 0) | ((buttons & BTN_CROUCH) !== 0 ? GLIDE_KEY_CROUCH : 0);
    const pressed = keys & ~b.glideKeys;
    b.glideKeys = keys;
    if (!b.grounded && (flags & (MF_OUT | MF_ROOTED)) === 0) {
      buttons &= ~(BTN_CROUCH | BTN_PRONE);
      if (wasGliding) glide = pressed !== 0 ? 0 : 1;
      else if (((pressed & GLIDE_KEY_CROUCH) !== 0 || ((pressed & GLIDE_KEY_JUMP) !== 0 && (b.jetGear & JET_CUIRASS) === 0)) && b.stance === STANCE_STAND && (flags & MF_WINDED) === 0 && b.stamina > 0) glide = 1;
    }
  } else b.glideKeys = 0;
  // The same buttons are a flyer's roll/brake in the air; only suppress their ground stance meaning.
  if (!p.lowStance) buttons &= ~(BTN_CROUCH | BTN_PRONE);
  const want = out || (buttons & BTN_PRONE) !== 0 ? STANCE_PRONE : (buttons & BTN_CROUCH) !== 0 ? STANCE_CROUCH : STANCE_STAND;
  if (want !== stance) {
    if (want > stance || capsuleFree(w, b.x, b.y, b.z, r, stanceHeight(p, want))) stance = want;
    else if (stance === STANCE_PRONE && capsuleFree(w, b.x, b.y, b.z, r, p.crouchHeight)) stance = STANCE_CROUCH;
  }
  const height = stanceHeight(p, stance);
  const standing = stance === STANCE_STAND;

  // Horizontal velocity moves toward the wished velocity at a bounded rate.
  let mx = moveX / 127;
  let mz = moveZ / 127;
  if ((flags & (MF_ROOTED | MF_OUT)) !== 0) mx = mz = 0;
  const m2 = mx * mx + mz * mz;
  if (m2 > 1) {
    const inv = 1 / Math.sqrt(m2);
    mx *= inv;
    mz *= inv;
  }
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const jetEquipped = (b.jetGear & JET_CUIRASS) !== 0 && !b.seat;
  const jetReady = jetEquipped && standing && (flags & (MF_OUT | MF_ROOTED | MF_NO_JUMP)) === 0;
  if (jetEquipped && b.grounded) b.jetSpent = Math.max(0, b.jetSpent - (b.jetGear === JET_FULL_SUIT ? 2 : 1));
  // An open glider keeps the jet quiet. Jump folds it, and the jet answers that same press.
  b.jetThrust = jetMode(b, priorThrust, buttons, jetReady && glide === 0, m2 > 0.025);
  const diving = glide !== 0 && (buttons & BTN_SPRINT) !== 0;
  const sprint = glide === 0 && !b.jetThrust && m2 > 0 && standing && canSprint(b, buttons);
  // None comes back in the air once it has glided, nor for a moment after it lands.
  if (glide !== 0 && b.regenWait < GLIDE_REGEN_WAIT) b.regenWait = GLIDE_REGEN_WAIT;
  // Aimed and still with the sprint key held, the breath is held (shared/sim/aim.ts holdsBreath, D1085): it costs stamina,
  // and as it runs out the body is winded.
  const breath = glide === 0 && m2 === 0 && (buttons & (BTN_SPRINT | BTN_SECONDARY)) === (BTN_SPRINT | BTN_SECONDARY) && b.stamina > 0 && (b.mflags & MF_WINDED) === 0;
  let stamina = spendStamina(b, p, sprint, glide !== 0 ? (diving ? GLIDE_DIVE_STAMINA : GLIDE_STAMINA) : m2 > 0 ? p.staminaWalk : breath ? BREATH_STAMINA : 0);
  // Spent, it folds, and the body falls.
  if (glide !== 0 && stamina <= 0) glide = 0;
  const fastCruise = b.jetThrust === JET_HOVER && (b.jetGear & JET_GREAVES) !== 0 && !(flags & MF_NO_SPRINT);
  const speed = b.jetThrust ? (fastCruise ? 10 : 6) :
    p.walkSpeed * (b.speedQ / 1000) * (sprint ? p.sprintMul * ((b.jetGear & JET_GREAVES) !== 0 ? JET_STRIDE : 1) : standing ? 1 : stance === STANCE_CROUCH ? p.crouchMul : p.proneMul);
  let dvx = (s * mz - c * mx) * speed - b.vx;
  let dvz = (c * mz + s * mx) * speed - b.vz;
  let maxDv = (b.jetThrust ? 18 : b.grounded ? p.accelGround : p.accelAir) * dt;
  // Knocked off balance, it keeps going the way it was shoved and has little say in it until it finds its feet. The
  // reaction ends on the same tick on the server and in prediction.
  if (b.reactTicks > 0) {
    const kind = reactClass(b.react);
    if ((REACT_FRAMES[kind] ?? 0) - b.reactTicks < (REACT_CONTROL_TICKS[kind] ?? 0)) maxDv *= STAGGER_HOLD;
    if (--b.reactTicks === 0) b.react = 0;
  }
  // Laid down by its reaction, how far round it has turned since goes with its facing, alike in prediction.
  if (b.react !== 0) b.react = withTurn(b.react, b.yaw / YAW_UNITS, previousYaw / YAW_UNITS, (REACT_FRAMES[reactClass(b.react)] ?? 0) - b.reactTicks);
  // A body with no hold on where it goes (knocked off its feet, tangled, out cold) does not steer or brake in the air: it
  // flies as it was thrown until it lands.
  if (!b.grounded && !b.jetThrust && (flags & (MF_ROOTED | MF_OUT)) !== 0) maxDv = 0;
  if (glide !== 0) {
    // Forward by the stick, faster in a dive, and slipping sideways. The stick back wishes it still, and stops it sooner.
    const forward = mz > 0 ? mz * (diving ? GLIDE_DIVE : GLIDE_SPEED) : 0;
    const side = mx * GLIDE_SIDE;
    const wx = s * forward - c * side;
    const wz = c * forward + s * side;
    const want = Math.sqrt(wx * wx + wz * wz);
    const have = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    maxDv = GLIDE_ACCEL * (mz < 0 ? 1 - mz : 1) * dt;
    if (want > GLIDE_STEER && have > GLIDE_STEER) {
      // Under way, it turns: its velocity swings toward the way wished at GLIDE_TURN and keeps its speed, which moves toward
      // the speed wished. So a turn is flown round at full speed, where a velocity pulled straight across would stall in it.
      const heading = detAtan2(b.vx, b.vz);
      let turn = detAtan2(wx, wz) - heading;
      if (turn > PI) turn -= TAU;
      else if (turn < -PI) turn += TAU;
      const most = GLIDE_TURN * dt;
      if (turn > most) turn = most;
      else if (turn < -most) turn = -most;
      const speed = want > have ? (want - have > maxDv ? have + maxDv : want) : have - want > maxDv ? have - maxDv : want;
      dvx = detSin(heading + turn) * speed - b.vx;
      dvz = detCos(heading + turn) * speed - b.vz;
      maxDv = Infinity;
    } else {
      dvx = wx - b.vx;
      dvz = wz - b.vz;
    }
  }
  const dv2 = dvx * dvx + dvz * dvz;
  if (dv2 > maxDv * maxDv) {
    const k = maxDv / Math.sqrt(dv2);
    dvx *= k;
    dvz *= k;
  }
  let vx = b.vx + dvx;
  let vz = b.vz + dvz;
  let vy = b.vy;

  const wasGrounded = b.grounded;
  let jumped = false;
  /** Fastest downward speed stopped by something this tick. */
  let fall = 0;
  if (wasGrounded) {
    if (p.jumpSpeed > 0 && (buttons & BTN_JUMP) !== 0 && standing && (flags & (MF_NO_JUMP | MF_ROOTED)) === 0 && stamina >= p.staminaJump) {
      vy = p.jumpSpeed;
      jumped = true;
      stamina -= p.staminaJump;
    } else vy = 0;
  }
  if (b.jetThrust >= JET_UP) {
    // Commit the impulse once. Turning the camera cannot turn a burst or reinstate velocity stopped by a wall.
    vx = b.vx; vy = b.vy; vz = b.vz;
    if (b.jetRecovery === JET_RECOVERY) {
      if (b.jetThrust === JET_UP) vy = Math.max(12, vy);
      else if (b.jetThrust === JET_FIST) {
        const aim = Math.max(-0.85, Math.min(0.85, pitch * YAW_TO_RAD));
        vx = 15 * s * detCos(aim); vz = 15 * c * detCos(aim); vy = 15 * detSin(aim);
      } else {
        const power = 18 / Math.sqrt(mx * mx + mz * mz);
        vx = (s*mz - c*mx)*power; vz = (c*mz + s*mx)*power; vy *= 0.28;
      }
    }
    vy -= p.gravity * dt * 0.25;
  } else if (b.jetThrust) {
    const target = b.jetThrust === JET_HOVER ? 0 : 4;
    const impulse = 24 * dt;
    vy += Math.max(-impulse, Math.min(impulse, target - vy));
  } else if (glide !== 0) {
    // It sinks at its trim, less in a flare and more in a dive, and what speed a dive left it floats it level for a moment.
    let sink = diving ? GLIDE_DIVE_SINK : mz < 0 ? GLIDE_SINK + (GLIDE_SINK - GLIDE_FLARE_SINK) * mz : GLIDE_SINK;
    const over = Math.sqrt(vx * vx + vz * vz) - GLIDE_SPEED;
    if (!diving && over > 0) {
      sink -= GLIDE_FLOAT * over;
      if (sink < 0) sink = 0;
    }
    if (vy > -sink) {
      // Rising, or sinking slower than it should: gravity alone, so it never climbs and is no higher a jump.
      vy -= p.gravity * dt;
      if (vy < -sink) vy = -sink;
    } else {
      vy += (vy < -sink - GLIDE_HARD ? GLIDE_BRAKE : GLIDE_SETTLE) * dt;
      if (vy > -sink) vy = -sink;
    }
  } else if (!wasGrounded || jumped) {
    vy -= p.gravity * dt;
    if (vy < -TERMINAL_SPEED) vy = -TERMINAL_SPEED;
  }
  /** On the ground for the whole tick, so it may step up and follow the ground down. */
  const walking = wasGrounded && !jumped;

  // Split the move so no substep exceeds half a radius.
  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
  const maxStep = r * 0.5;
  let n = Math.ceil(dist / maxStep);
  let scale = dt;
  if (n < 1) n = 1;
  else if (n > MAX_SUBSTEPS) {
    scale = (dt * MAX_SUBSTEPS * maxStep) / dist;
    n = MAX_SUBSTEPS;
  }
  const sx = (vx * scale) / n;
  const sy = (vy * scale) / n;
  const sz = (vz * scale) / n;
  const maxX = hf.sizeX - r;
  const maxZ = hf.sizeZ - r;
  const maxSide2 = r * r;
  const maxRise = (p.stepUp > r ? p.stepUp : r) + maxStep;
  const tall = height > 2 * r ? height : 2 * r;
  const slope = p.slopeCos;
  /** How far a substep goes, and so the deepest a body clear at its start can go into anything. */
  const stride = Math.sqrt(sx * sx + sy * sy + sz * sz) + SKIN;
  /** The last surface this tick a falling body slid along, as a unit normal. */
  let slid = false;
  let slideX = 0;
  let slideY = 0;
  let slideZ = 0;
  // Its limbs are held clear only where a structure stands near enough for one to reach this tick: a substep goes at most a
  // radius sideways and maxRise up or down.
  let limbs = limbsFor(p);
  if (limbs) {
    limbsFace(b.yaw);
    limbs = limbsNear(w, b.x, b.y, b.z, n * (r > maxRise ? r : maxRise), false);
  }
  /** Its velocity as it set out, for how fast it went into the wall it met. */
  const wishX = vx;
  const wishZ = vz;

  let x = b.x;
  let y = b.y;
  let z = b.z;

  for (let i = 0; i < n; i++) {
    let nx = x + sx;
    let ny = y + sy;
    let nz = z + sz;
    if (nx < r) nx = r;
    else if (nx > maxX) nx = maxX;
    if (nz < r) nz = r;
    else if (nz > maxZ) nz = maxZ;

    // Terrain: rise onto walkable ground, or slide along or stop at a rise too high. What is walkable is where the body touches
    // it. Ground too steep is met below as a part's face is.
    let h = groundUnder(hf, nx, nz, r);
    if (ny < h && groundStands(slope)) {
      // A fast fall can cross a step's height in one substep. Measure the rise from the higher of
      // its feet before and after that fall, so landing on lower ground never looks like climbing it.
      const stepFrom = Math.max(y, ny);
      if (h - stepFrom > p.stepUp) {
        const hx = groundUnder(hf, nx, z, r);
        if (ny >= hx || (hx - stepFrom <= p.stepUp && groundStands(slope))) {
          nz = z;
          h = hx;
        } else {
          const hz = groundUnder(hf, x, nz, r);
          if (ny >= hz || (hz - stepFrom <= p.stepUp && groundStands(slope))) {
            nx = x;
            h = hz;
          } else {
            nx = x;
            nz = z;
            h = groundUnder(hf, x, z, r);
          }
        }
      }
      if (ny < h) {
        ny = h;
        if (vy < 0) {
          if (-vy > fall) fall = -vy;
          vy = 0;
        }
      }
    }

    // Bodies: pushed level out of any it walks into (shared/sim/blockers.ts), before the structures, which have the last say.
    const bodies = w.blockers;
    if (bodies && bodies.count > 0 && pushOut(bodies, b.kind, nx, ny, nz, b.yaw, height, (BLOCK_SOFT_SPEED * scale) / n, x, z)) {
      nx = blockOut.x < r ? r : blockOut.x > maxX ? maxX : blockOut.x;
      nz = blockOut.z < r ? r : blockOut.z > maxZ ? maxZ : blockOut.z;
    }

    // Structures: push out along the shortest exit, a few rounds.
    let blocked = false;
    /** The last round touched nothing, and the body has not moved since. */
    let clear = false;
    /** The highest a body on foot may rise onto in this substep, and the highest a falling one is going. */
    const top = y + p.stepUp;
    const rise = sy > 0 ? y + sy : y;
    /** Ground too steep is tried in the first round if the body is in it, and in each after one it pushed in, as in a gully. */
    let banks = ny < h;
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      let moved = false;
      const bank = banks;
      banks = false;
      // Ground too steep to stand on, met as a part's face is, then structures, then resource nodes.
      for (let pass = bank ? -1 : 0; pass < 2; pass++) {
        const store = pass === 0 ? structs : w.nodes;
        let count = 1;
        if (pass >= 0) {
          if (!store) continue;
          // A radius of margin each way, for what a push within the round may bring into reach.
          count = store.query(nx - r, nz - r, nx + r, nz + r, found, ny - r, ny + tall + r);
          // A push moves the body before the next piece is tried, so the order decides where it ends. The grid lists pieces
          // in the order they were stored, which differs between a client and its server. Refs are the same on both.
          sortU32(found.refs, count);
        }
        for (let k = 0; k < count; k++) {
          if (pass >= 0) {
            if (!capsuleBox(store!, found.refs[k]!, nx, ny, nz, r, height, 0)) continue;
          } else if (steepGround(hf, nx, ny, nz, r, slope)) banks = true;
          else continue;
          moved = true;
          // Where it touches, both the way out and the surface must be level enough for it to stand.
          const stands = push.y > slope * push.depth && push.up > slope;
          let level = false;
          let joined = false;
          if (push.y > 0 && (walking ? !(push.face && stands) : !stands && ny + push.y > rise && push.depth <= stride)) {
            // The piece meets the lower sphere `down` below its centre. Higher than a step, or too steep there to stand on, it is
            // a wall to a body on foot, which leaves it level and is not pushed up it: off a face as far as clears its plane, off an
            // edge to where the sphere is as wide as it is there. Nor is a falling body lifted higher than it was going by what
            // is too steep to stand on and it went into this substep, as Unreal keeps a slide from boosting it up a slope.
            const gap = r - push.depth;
            const lean = push.y / push.depth;
            const down = (push.y * gap) / push.depth;
            const side = Math.sqrt(push.x * push.x + push.z * push.z);
            const rimY = ny + r - down;
            if (walking && !push.face && stands && side > 0 && push.depth < r && rimY > top + SKIN) {
              // A wide foot first meets a ramp-to-deck seam high on its lower sphere.
              // Check for walkable ground immediately outside that edge at the same height.
              const edge = gap / push.depth - 0.02 / side;
              const hit = castWorld(w, nx - push.x * edge, rimY + 0.02, nz - push.z * edge, 0, -1, 0, 0.05, true);
              joined = hit !== HIT_NONE && rayHit.ny >= slope;
            }
            if (!joined && side > 0 && (!walking || push.up <= slope || (push.depth < r && rimY > top + SKIN))) {
              const px = push.x, pz = push.z;
              let out: number;
              if (push.face) out = (push.depth * push.depth) / (side * side);
              else {
                const offset = (side * gap) / push.depth;
                out = (Math.sqrt(r * r - down * down) - offset) / side;
                if (walking && !stands && push.up > slope && ny - h > GROUND_PROBE) {
                  // On level footing the capsule can approach the rim at its rounded width, just as groundAt tests.
                  // Only clear it at full width when there is room below to follow the floor downhill beside it.
                  const full = (r - offset) / side;
                  if (capsuleFree(w, nx + px * full, ny - GROUND_PROBE, nz + pz * full, r, height)) out = full;
                }
              }
              nx += px * out;
              nz += pz * out;
              blocked = true;
              if (side > wallMost) metWall(side, px / side, pz / side, touchAt(lean, pass >= 0 ? store! : null, found.refs[k]!, ny, r, height));
              if (walking) continue;
              level = true;
            }
          }
          if (!level) {
            const at = ny;
            if ((push.hull || joined) && stands) {
              // A sloped part it can stand on lifts it straight up, as the ground does, so a ramp is climbed at a full stride.
              ny += (push.depth * push.depth) / push.y;
            } else {
              nx += push.x;
              ny += push.y;
              nz += push.z;
            }
            if (stands) {
              if (vy < 0) {
                if (-vy > fall) fall = -vy;
                vy = 0;
              }
              continue;
            }
            blocked = true;
            const side = Math.sqrt(push.x * push.x + push.z * push.z);
            if (side > wallMost) metWall(side, push.x / side, push.z / side, touchAt(push.y / push.depth, pass >= 0 ? store! : null, found.refs[k]!, at, r, height));
          }
          if (push.y < -0.7 * push.depth && vy > 0) vy = 0;
          else if (push.y > 0 && !walking) {
            // What holds a falling body up too steeply to stand on, it slides along, losing what of its speed went into it, so
            // it banks no speed there to land with, and level where sliding would lift it. Pressed into a second such surface,
            // it slides along their crease, unless that would lift it.
            const ux = push.x / push.depth;
            const uy = push.y / push.depth;
            const uz = push.z / push.depth;
            const into = vx * ux + vy * uy + vz * uz;
            if (into < 0) {
              const going = vy > 0 ? vy : 0;
              if (vy - uy * into > going) {
                const across = (vx * ux + vz * uz) / (ux * ux + uz * uz);
                if (across < 0) {
                  vx -= ux * across;
                  vz -= uz * across;
                }
              } else {
                vx -= ux * into;
                vy -= uy * into;
                vz -= uz * into;
              }
              const cx = slideY * uz - slideZ * uy;
              const cy = slideZ * ux - slideX * uz;
              const cz = slideX * uy - slideY * ux;
              const c2 = cx * cx + cy * cy + cz * cz;
              if (slid && c2 > 1e-6 && vx * slideX + vy * slideY + vz * slideZ < -1e-9) {
                const along = (vx * cx + vy * cy + vz * cz) / c2;
                if (cy * along <= going) {
                  vx = cx * along;
                  vy = cy * along;
                  vz = cz * along;
                }
              }
            }
            slideX = ux;
            slideY = uy;
            slideZ = uz;
            slid = true;
          }
        }
      }
      if (!moved) {
        clear = true;
        break;
      }
    }
    h = groundUnder(hf, nx, nz, r);
    if (ny < h && h - ny <= p.stepUp) {
      ny = h;
      clear = false;
    }

    // A head and footprint ends held clear of walls: no step takes one deeper into a wall than it is, at any angle. A step
    // that would slides along the wall it met, as the body slides along what it meets, or is not taken; a limb already in
    // one (turned there by something else, or put there) is let back out, and one past a wall's end walks on. Only the
    // level step is held, at the height it began: a body walking down a slope beside a wall may dip its head toward the
    // wall's top.
    if (limbs) {
      limbsWere(x, y, z);
      const k = limbDeeper(w, nx, y, nz);
      if (k !== 0) {
        const ox = wallOut.x, oz = wallOut.z;
        metWall(limbGain, ox, oz, limbMid[k - 1]!);
        let dx = nx - x, dz = nz - z;
        const into = dx * ox + dz * oz;
        if (into < 0) {
          dx -= ox * into;
          dz -= oz * into;
        }
        // Along the wall; failing that (at a corner the deepest wall turns), the step's one way or its other.
        if (limbDeeper(w, x + dx, y, z + dz) === 0) {
          nx = x + dx;
          nz = z + dz;
        } else if (limbDeeper(w, x, y, nz) === 0) nx = x;
        else if (limbDeeper(w, nx, y, z) === 0) nz = z;
        else {
          nx = x;
          nz = z;
        }
        clear = false;
      }
    }

    // Step up: a grounded body blocked by something no higher than a step climbs onto it, unless that takes a limb, where
    // it rises to, into a wall.
    if (blocked && walking) {
      let tx = x + sx;
      let tz = z + sz;
      if (tx < r) tx = r;
      else if (tx > maxX) tx = maxX;
      if (tz < r) tz = r;
      else if (tz > maxZ) tz = maxZ;
      if (capsuleFree(w, x, top, z, r, height) && capsuleFree(w, tx, top, tz, r, height)) {
        const on = stepOnto(w, tx, tz, y, top, r, height, slope);
        if (!Number.isNaN(on) && !(limbs && limbDeeper(w, tx, on, tz) !== 0)) {
          nx = tx;
          ny = on;
          nz = tz;
          clear = false;
        }
      }
    }

    // Test the float32 position the body will publish when resolving a contact at the skin boundary.
    // A body the last round found clear of every structure is
    // clear of them at capsuleFree's smaller reach too, so only the ground is asked again.
    const ddx = nx - x;
    const ddz = nz - z;
    const ddy = ny - y;
    if (ddx * ddx + ddz * ddz > maxSide2 || ddy > maxRise || ddy < -maxRise || (clear ? nx < 0 || nz < 0 || nx > hf.sizeX || nz > hf.sizeZ || ny < h - SKIN : !capsuleFree(w, Math.fround(nx), Math.fround(ny), Math.fround(nz), r, height))) {
      vx = 0;
      vz = 0;
      if (vy > 0) vy = 0;
      break;
    }
    x = nx;
    y = ny;
    z = nz;
  }
  if (wallMost > 0) {
    const into = -(wishX * stepOut.wallNx + wishZ * stepOut.wallNz);
    stepOut.wallInto = into > 0 ? into : 0;
  }

  // Grounded means resting on terrain or on a structure it can stand on, held where it has no way down, or close enough above
  // support to follow it down (slopes, stairs, kerbs). A sloped part it can stand on is followed as far down as the steepest
  // such slope falls over the way the body went this tick, so a ramp is kept at any speed. Ground too steep where it touches
  // holds it up as a steep part does.
  let grounded = false;
  if (vy <= 0) {
    const under = groundUnder(hf, x, z, r);
    const level = groundStands(slope);
    const low = y - p.stepDown;
    let lowest = low;
    if (walking) {
      const ddx = x - b.x;
      const ddz = z - b.z;
      const fallsTo = y - Math.sqrt((ddx * ddx + ddz * ddz) * (1 / (slope * slope) - 1));
      if (fallsTo < low) lowest = fallsTo;
    }
    if (level && y - under <= GROUND_PROBE) grounded = true;
    else if (level && walking && nothingBuilt(w, x, z, r, lowest, y + tall)) {
      // Only the ground is near, and where the body rests on it is known.
      if (under >= low) {
        y = under;
        grounded = true;
      }
    } else {
      let on = restingAt(w, x, y, z, r, height, GROUND_PROBE, slope);
      if (Number.isNaN(on) && walking) on = settleOnto(w, x, z, lowest, low, y, r, height, slope);
      if (!Number.isNaN(on)) {
        y = on;
        grounded = true;
      }
    }
    if (grounded) {
      if (-vy > fall) fall = -vy;
      vy = 0;
    }
  }
  if (grounded) {
    b.jetThrust = 0;
    glide = 0;
  }
  if (grounded && !wasGrounded) stepOut.landSpeed = fall;

  // Deep enough to float, the body swims from the next tick, and a swimmer has no stance.
  // A swimmer is as tall as a standing body, so one held low by a ceiling stays as it is.
  if (hf.waterAt(x, z) - y > swimDepth(p, SWIM_ENTER) && (standing || capsuleFree(w, x, y, z, r, p.height))) {
    b.mode = MODE_SWIM;
    stance = STANCE_STAND;
    grounded = false;
    b.jetThrust = 0;
    glide = 0;
    stepOut.landSpeed = 0;
  }
  if (glide !== 0 && !wasGliding) stepOut.glideOpened = true;
  else if (glide === 0 && wasGliding) stepOut.glideFolded = true;
  b.glide = glide;

  // Round to float32, the stored and transmitted precision. Both sides do this.
  b.x = Math.fround(x);
  b.y = Math.fround(y);
  b.z = Math.fround(z);
  b.vx = Math.fround(vx);
  b.vy = Math.fround(vy);
  b.vz = Math.fround(vz);
  b.grounded = grounded;
  b.stance = stance;
  b.stamina = stamina;
}

function canSprint(b: Body, buttons: number): boolean {
  return (buttons & BTN_SPRINT) !== 0 && (b.mflags & (MF_NO_SPRINT | MF_ROOTED | MF_WINDED)) === 0 && b.stamina > 0;
}

/**
 * Sets and clears MF_WINDED on the body. Returns the new stamina, which the caller stores after taking any jump cost from it.
 * `walk` is what walking costs this tick, 0 when it does not move or walking is free.
 */
function spendStamina(b: Body, p: MoveParams, sprint: boolean, walk = 0): number {
  const cap = b.staminaMax * STAMINA_UNITS;
  let stamina = b.stamina > cap ? cap : b.stamina;
  // A flyer gets none back until its wait after flying is over, counted on the ground and in water.
  const waits = b.regenWait > 0;
  if (waits && (b.grounded || b.mode === MODE_SWIM)) b.regenWait--;
  if (sprint || walk > 0) {
    stamina -= sprint ? p.staminaSprint : walk;
    if (stamina <= 0) {
      stamina = 0;
      b.mflags |= MF_WINDED;
    }
  } else if (!waits) {
    stamina += p.staminaRegen;
    if (stamina > cap) stamina = cap;
    if ((b.mflags & MF_WINDED) !== 0 && stamina * 4 >= cap) b.mflags &= ~MF_WINDED;
  }
  return stamina;
}

/** Moves in three dimensions along the look direction, with no gravity. As on land, a position is committed only if capsuleFree accepts it. */
function stepSwim(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  const hf = w.hf;
  const structs = w.structs;
  const r = p.radius;
  let mx = moveX / 127;
  let mz = moveZ / 127;
  if ((b.mflags & (MF_ROOTED | MF_OUT)) !== 0) {
    mx = mz = 0;
    // Nor does it rise by the jump button. An unconscious swimmer would otherwise never drown.
    buttons &= ~BTN_JUMP;
  }
  const m2 = mx * mx + mz * mz;
  if (m2 > 1) {
    const inv = 1 / Math.sqrt(m2);
    mx *= inv;
    mz *= inv;
  }
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const e = pitch * YAW_TO_RAD;
  const sp = detSin(e);
  const cp = detCos(e);
  const sprint = m2 > 0 && canSprint(b, buttons);
  const stamina = spendStamina(b, p, sprint);
  const speed = p.swimSpeed * (b.swimQ / 1000) * (sprint ? p.swimSprintMul : 1) * ((b.jetGear & JET_CUIRASS) !== 0 ? JET_SWIM : 1);

  // Water slows a body that arrives faster than 1.5 times its swim speed.
  let vx = b.vx;
  let vy = b.vy;
  let vz = b.vz;
  if (vx * vx + vy * vy + vz * vz > speed * speed * 2.25) {
    vx *= WATER_DRAG;
    vy *= WATER_DRAG;
    vz *= WATER_DRAG;
  }
  // Forward follows the view, so looking down dives. Jump rises.
  let wy = sp * mz + ((buttons & BTN_JUMP) !== 0 ? 1 : 0);
  if (wy > 1) wy = 1;
  let dvx = (s * cp * mz - c * mx) * speed - vx;
  let dvy = wy * speed - vy;
  let dvz = (c * cp * mz + s * mx) * speed - vz;
  const maxDv = p.accelSwim * dt;
  const dv2 = dvx * dvx + dvy * dvy + dvz * dvz;
  if (dv2 > maxDv * maxDv) {
    const k = maxDv / Math.sqrt(dv2);
    dvx *= k;
    dvy *= k;
    dvz *= k;
  }
  vx += dvx;
  vy += dvy;
  vz += dvz;

  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz) * dt;
  const maxStep = r * 0.5;
  let n = Math.ceil(dist / maxStep);
  let scale = dt;
  if (n < 1) n = 1;
  else if (n > MAX_SUBSTEPS) {
    scale = (dt * MAX_SUBSTEPS * maxStep) / dist;
    n = MAX_SUBSTEPS;
  }
  const sx = (vx * scale) / n;
  const sy = (vy * scale) / n;
  const sz = (vz * scale) / n;
  const maxX = hf.sizeX - r;
  const maxZ = hf.sizeZ - r;
  const maxSide2 = r * r;
  const maxRise = (p.stepUp > r ? p.stepUp : r) + maxStep;
  const sink = swimDepth(p);

  let x = b.x;
  let y = b.y;
  let z = b.z;
  for (let i = 0; i < n; i++) {
    let nx = x + sx;
    let ny = y + sy;
    let nz = z + sz;
    if (nx < r) nx = r;
    else if (nx > maxX) nx = maxX;
    if (nz < r) nz = r;
    else if (nz > maxZ) nz = maxZ;
    // A swimmer rises no higher than its float line in the water it is going into. One that walked in above the line
    // settles down to it.
    const floatY = hf.waterAt(nx, nz) - sink;
    if (ny > floatY) {
      const settle = y - (SWIM_SETTLE * scale) / n;
      ny = y > floatY ? (settle > floatY ? settle : floatY) : floatY;
      if (vy > 0) vy = 0;
    }

    // At the bottom, slide up when the rise is small, else along one axis, else stay.
    let h = groundUnder(hf, nx, nz, r);
    if (ny < h) {
      if (h - ny > maxRise) {
        const hx = groundUnder(hf, nx, z, r);
        if (ny >= hx || hx - ny <= maxRise) {
          nz = z;
          h = hx;
        } else {
          const hz = groundUnder(hf, x, nz, r);
          if (ny >= hz || hz - ny <= maxRise) {
            nx = x;
            h = hz;
          } else {
            nx = x;
            nz = z;
            h = groundUnder(hf, x, z, r);
          }
        }
      }
      if (ny < h) {
        ny = h;
        if (vy < 0) vy = 0;
      }
    }

    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      let moved = false;
      for (let pass = 0; pass < 2; pass++) {
        const store = pass === 0 ? structs : w.nodes;
        if (!store) continue;
        const count = store.query(nx - r, nz - r, nx + r, nz + r, found, ny - r, ny + (p.height > 2 * r ? p.height : 2 * r) + r);
        // In ref order, as on land.
        sortU32(found.refs, count);
        for (let k = 0; k < count; k++) {
          if (!capsuleBox(store, found.refs[k]!, nx, ny, nz, r, p.height, 0)) continue;
          nx += push.x;
          ny += push.y;
          nz += push.z;
          if (push.y > 0.7 * push.depth) {
            if (vy < 0) vy = 0;
          } else if (push.y < -0.7 * push.depth && vy > 0) vy = 0;
          moved = true;
        }
      }
      if (!moved) break;
    }
    h = groundUnder(hf, nx, nz, r);
    if (ny < h && h - ny <= maxRise) ny = h;

    const ddx = nx - x;
    const ddz = nz - z;
    const ddy = ny - y;
    if (ddx * ddx + ddz * ddz > maxSide2 || ddy > maxRise || ddy < -maxRise || !capsuleFree(w, nx, ny, nz, r, p.height)) {
      vx = 0;
      vy = 0;
      vz = 0;
      break;
    }
    x = nx;
    y = ny;
    z = nz;
  }

  // Too shallow to float, so it stands if there is support and falls if there is none.
  let grounded = false;
  if (hf.waterAt(x, z) - y < swimDepth(p, SWIM_EXIT)) {
    b.mode = MODE_WALK;
    if ((y - groundUnder(hf, x, z, r) <= GROUND_PROBE && groundStands(p.slopeCos)) || !Number.isNaN(restingAt(w, x, y, z, r, p.height, GROUND_PROBE, p.slopeCos))) {
      grounded = true;
      vy = 0;
    }
  }

  b.x = Math.fround(x);
  b.y = Math.fround(y);
  b.z = Math.fround(z);
  b.vx = Math.fround(vx);
  b.vy = Math.fround(vy);
  b.vz = Math.fround(vz);
  b.grounded = grounded;
  b.stance = STANCE_STAND;
  b.stamina = stamina;
}

/** A ghost's or a flyer's velocity, set by `flight`. */
const flown = [0, 0, 0];

/**
 * Along the look, rising by the jump button, at once. The way is at most a unit long, so the speed a sprint ramps from is the
 * length of the velocity the body kept from its last tick: no new state, and both sides ramp alike.
 */
function flight(b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, dt: number): void {
  let mx = moveX / 127;
  let mz = moveZ / 127;
  const m2 = mx * mx + mz * mz;
  if (m2 > 1) {
    const inv = 1 / Math.sqrt(m2);
    mx *= inv;
    mz *= inv;
  }
  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const e = pitch * YAW_TO_RAD;
  const sp = detSin(e);
  const cp = detCos(e);
  let dx = s * cp * mz - c * mx;
  let dy = sp * mz + ((buttons & BTN_JUMP) !== 0 ? 1 : 0);
  let dz = c * cp * mz + s * mx;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 1) {
    const inv = 1 / Math.sqrt(d2);
    dx *= inv;
    dy *= inv;
    dz *= inv;
  }
  let speed = GHOST_SPEED;
  if ((buttons & BTN_SPRINT) !== 0) {
    const was = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) + GHOST_RAMP * dt;
    speed = was < GHOST_SPEED * GHOST_SPRINT ? GHOST_SPEED * GHOST_SPRINT : was > GHOST_MAX ? GHOST_MAX : was;
  }
  flown[0] = dx * speed;
  flown[1] = dy * speed;
  flown[2] = dz * speed;
}

/** Flies as a ghost does, with no gravity, but meets the ground, pieces and nodes (flyThrough). It stands while it flies. */
function stepFly(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  flight(b, moveX, moveZ, yaw, pitch, buttons, dt);
  flyThrough(w, b, flown[0]!, flown[1]!, flown[2]!, p, dt, Infinity);
  b.grounded = false;
  b.stance = STANCE_STAND;
}

/**
 * Before a flyer's step, its roll's clock runs, and it takes off or falls. Its jump held on the ground, in water or falling,
 * it takes off unless winded, too heavy (MF_NO_JUMP), rooted or out, from the ground rising TAKEOFF_RISE to a hover. Knocked
 * out or caught by a bola in the air, it stops flying and falls as a walker does; too heavy and so rooted by its load, it is
 * put down by its flight as one spent is. Returns the buttons its walking or swimming step takes: it never hops, has no low
 * stance, and floats.
 */
function takeWing(w: CollisionWorld, b: Body, buttons: number, p: MoveParams): number {
  if (b.rollWait > 0) b.rollWait--;
  const flags = b.mflags;
  if (b.mode === MODE_FLYER) {
    if (!p.flies || (flags & MF_OUT) !== 0 || (flags & (MF_ROOTED | MF_NO_JUMP)) === MF_ROOTED) b.mode = MODE_WALK;
  } else if ((buttons & BTN_JUMP) !== 0 && (b.mode === MODE_WALK || b.mode === MODE_SWIM) && b.stance === STANCE_STAND && (flags & (MF_NO_JUMP | MF_ROOTED | MF_OUT | MF_WINDED)) === 0) {
    // From the ground it springs up, and from the water clear of the surface first. Falling, it flies on from its fall.
    const sea = w.hf.waterAt(b.x, b.z);
    const rise = TAKEOFF_RISE + (b.mode === MODE_SWIM && b.y < sea ? sea - b.y : 0);
    if (b.grounded || b.mode === MODE_SWIM) b.vy = Math.fround(Math.sqrt(2 * p.accelFly * rise));
    b.mode = MODE_FLYER;
    b.grounded = false;
    stepOut.tookOff = true;
    return buttons;
  }
  if (b.mode === MODE_FLYER) return buttons;
  return (buttons & ~(BTN_JUMP | BTN_CROUCH | BTN_PRONE)) | (b.mode === MODE_SWIM ? BTN_JUMP : 0);
}

/**
 * A creature's own flight: along its look, pitch included, at its flying speed or its sprint's, its velocity moving toward
 * the one it wishes at accelFly, so it carries speed and lags its facing through a turn. With no way forward it slows to a
 * hover, and the brake stops it. Flying, hovering and sprinting cost stamina and none comes back. Let go of its jump, spent
 * or too heavy, it goes down to the ground or the water under it and sets down there unhurt.
 */
function stepFlyer(w: CollisionWorld, b: Body, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  const flags = b.mflags;
  const down = (buttons & BTN_JUMP) === 0 || (flags & (MF_WINDED | MF_NO_JUMP)) !== 0;
  const brake = !down && (buttons & BTN_BRAKE) !== 0;
  // It goes forward only; held back, it hovers. Rooted, it goes nowhere.
  const mz = down || brake || moveZ <= 0 || (flags & MF_ROOTED) !== 0 ? 0 : moveZ >= 127 ? 1 : moveZ / 127;
  const sprint = mz > 0 && canSprint(b, buttons);
  const cap = b.staminaMax * STAMINA_UNITS;
  let stamina = (b.stamina > cap ? cap : b.stamina) - (sprint ? p.staminaFlySprint : p.staminaFly);
  // The barrel roll, rollTicks apart, not encumbered (ASE 203.1): a burst of speed along its look.
  const roll = !down && (buttons & BTN_ROLL) !== 0 && b.rollWait === 0 && (flags & MF_NO_SPRINT) === 0 && stamina >= p.staminaRoll;
  if (roll) {
    stamina -= p.staminaRoll;
    b.rollWait = p.rollTicks;
    stepOut.rolled = true;
  }
  if (stamina <= 0) {
    stamina = 0;
    b.mflags |= MF_WINDED;
  }
  b.stamina = stamina;
  b.regenWait = p.regenWaitTicks;

  const a = yaw * YAW_TO_RAD;
  const s = detSin(a);
  const c = detCos(a);
  const e = pitch * YAW_TO_RAD;
  const sp = detSin(e);
  const cp = detCos(e);
  let wx = 0;
  let wy = 0;
  let wz = 0;
  if (down) wy = -DESCENT * p.flySpeed;
  else if (mz > 0) {
    const speed = p.flySpeed * (b.speedQ / 1000) * (sprint ? p.flySprintMul : 1) * mz;
    wx = s * cp * speed;
    wy = sp * speed;
    wz = c * cp * speed;
  }
  let dvx = wx - b.vx;
  let dvy = wy - b.vy;
  let dvz = wz - b.vz;
  const maxDv = (brake ? BRAKE : p.accelFly) * dt;
  const dv2 = dvx * dvx + dvy * dvy + dvz * dvz;
  if (dv2 > maxDv * maxDv) {
    const k = maxDv / Math.sqrt(dv2);
    dvx *= k;
    dvy *= k;
    dvz *= k;
  }
  let vx = b.vx + dvx;
  let vy = b.vy + dvy;
  let vz = b.vz + dvz;
  if (roll) {
    vx += s * cp * p.rollBurst;
    vy += sp * p.rollBurst;
    vz += c * cp * p.rollBurst;
  }
  // Flyers do not go under water (ARK's Flying page): it skims the surface, and going down it settles to its float line.
  const hf = w.hf;
  const sink = swimDepth(p);
  flyThrough(w, b, vx, vy, vz, p, dt, down ? sink : 0);
  b.grounded = false;
  b.stance = STANCE_STAND;
  if (b.y >= WORLD_MAX_Y && b.vy > 0) b.vy = 0;
  if (!down || b.vy > 0) return;
  // Going down, it sets down on what it can stand on, as a walker comes to rest, or afloat on water deep enough to swim in.
  const under = groundUnder(hf, b.x, b.z, p.radius);
  const on = b.y - under <= GROUND_PROBE && groundStands(p.slopeCos) ? b.y : restingAt(w, b.x, b.y, b.z, p.radius, p.height, GROUND_PROBE, p.slopeCos);
  if (!Number.isNaN(on)) {
    b.y = Math.fround(on);
    b.vy = 0;
    b.grounded = true;
    b.mode = MODE_WALK;
    stepOut.setDown = true;
    return;
  }
  const sea = hf.waterAt(b.x, b.z);
  if (b.y <= sea - sink + GROUND_PROBE && sea - under > swimDepth(p, SWIM_ENTER)) {
    b.mode = MODE_SWIM;
    stepOut.setDown = true;
  }
}

/**
 * Moves a body by (vx, vy, vz) for dt with no gravity, meeting the ground, pieces and nodes as a swimmer does, half a radius at
 * a time however fast, so it crosses nothing; over the ground it skims up a small rise. Over water deep enough to swim in it
 * goes no lower than `sink` under the surface where it is going, though it may rise from under it: Infinity for the admin's
 * fly. Stores its position and velocity.
 */
function flyThrough(w: CollisionWorld, b: Body, vx: number, vy: number, vz: number, p: MoveParams, dt: number, sink: number): void {
  const hf = w.hf;
  const r = p.radius;
  const height = p.height;
  const tall = height > 2 * r ? height : 2 * r;
  const maxStep = r * 0.5;
  // At GHOST_MAX a survivor takes a hundred.
  const n = Math.max(1, Math.ceil((Math.sqrt(vx * vx + vy * vy + vz * vz) * dt) / maxStep));
  const sx = (vx * dt) / n;
  const sy = (vy * dt) / n;
  const sz = (vz * dt) / n;
  const maxX = hf.sizeX - r;
  const maxZ = hf.sizeZ - r;
  const maxSide2 = r * r;
  const maxRise = (p.stepUp > r ? p.stepUp : r) + maxStep;
  const deep = swimDepth(p, SWIM_ENTER);
  let x = b.x;
  let y = b.y;
  let z = b.z;
  for (let i = 0; i < n; i++) {
    let nx = x + sx;
    let ny = y + sy;
    let nz = z + sz;
    if (nx < r) nx = r;
    else if (nx > maxX) nx = maxX;
    if (nz < r) nz = r;
    else if (nz > maxZ) nz = maxZ;
    // The world's top is the ceiling (ARK has one; its height is not published).
    if (ny > WORLD_MAX_Y) ny = WORLD_MAX_Y;
    // Over the ground it skims up a small rise, else along one axis, else stays.
    let h = groundUnder(hf, nx, nz, r);
    if (ny < h) {
      if (h - ny > maxRise) {
        const hx = groundUnder(hf, nx, z, r);
        if (ny >= hx || hx - ny <= maxRise) {
          nz = z;
          h = hx;
        } else {
          const hz = groundUnder(hf, x, nz, r);
          if (ny >= hz || hz - ny <= maxRise) {
            nx = x;
            h = hz;
          } else {
            nx = x;
            nz = z;
            h = groundUnder(hf, x, z, r);
          }
        }
      }
      if (ny < h) {
        ny = h;
        if (vy < 0) vy = 0;
      }
    }
    const sea = hf.waterAt(nx, nz);
    const floor = sea - sink;
    if (ny < floor && ny < y && sea - h > deep) {
      ny = y < floor ? y : floor;
      if (vy < 0) vy = 0;
    }
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      let moved = false;
      for (let pass = 0; pass < 2; pass++) {
        const store = pass === 0 ? w.structs : w.nodes;
        if (!store) continue;
        const count = store.query(nx - r, nz - r, nx + r, nz + r, found, ny - r, ny + tall + r);
        // In ref order, as on land.
        sortU32(found.refs, count);
        for (let k = 0; k < count; k++) {
          if (!capsuleBox(store, found.refs[k]!, nx, ny, nz, r, height, 0)) continue;
          nx += push.x;
          ny += push.y;
          nz += push.z;
          moved = true;
        }
      }
      if (!moved) break;
    }
    h = groundUnder(hf, nx, nz, r);
    if (ny < h && h - ny <= maxRise) ny = h;
    const ddx = nx - x;
    const ddz = nz - z;
    const ddy = ny - y;
    if (ddx * ddx + ddz * ddz > maxSide2 || ddy > maxRise || ddy < -maxRise || !capsuleFree(w, nx, ny, nz, r, height)) {
      vx = 0;
      vy = 0;
      vz = 0;
      break;
    }
    x = nx;
    y = ny;
    z = nz;
  }
  b.x = Math.fround(x);
  b.y = Math.fround(y);
  b.z = Math.fround(z);
  b.vx = Math.fround(vx);
  b.vy = Math.fround(vy);
  b.vz = Math.fround(vz);
}

/** No collision. Bounded to the map's box. */
function stepGhost(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, dt: number): void {
  flight(b, moveX, moveZ, yaw, pitch, buttons, dt);
  const vx = flown[0]!;
  const vy = flown[1]!;
  const vz = flown[2]!;
  let x = b.x + vx * dt;
  let y = b.y + vy * dt;
  let z = b.z + vz * dt;
  const hf = w.hf;
  if (x < 0) x = 0;
  else if (x > hf.sizeX) x = hf.sizeX;
  if (z < 0) z = 0;
  else if (z > hf.sizeZ) z = hf.sizeZ;
  if (y < WORLD_MIN_Y) y = WORLD_MIN_Y;
  else if (y > WORLD_MAX_Y) y = WORLD_MAX_Y;
  b.x = Math.fround(x);
  b.y = Math.fround(y);
  b.z = Math.fround(z);
  b.vx = Math.fround(vx);
  b.vy = Math.fround(vy);
  b.vz = Math.fround(vz);
  b.grounded = false;
}
