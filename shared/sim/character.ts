// One fixed step for one upright capsule. Server and client run this same code, and the same state and input give the same bits.
// A position is committed only if capsuleFree accepts it, and a substep moves at most a radius sideways, so no input crosses a wall.

import { WORLD_MAX_Y, WORLD_MIN_Y, YAW_UNITS } from "../coords.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import { sortU32 } from "../sort.ts";
import { SKIN, capsuleBox, capsuleFree, ground, groundUnder, nothingBuilt, push, restingAt, settleOnto, stepOnto, type CollisionWorld } from "../world/collide.ts";
import { Found } from "../world/structures.ts";

export const BTN_JUMP = 1;
export const BTN_SPRINT = 2;
/** Swing, harvest, attack. The server acts on the tick it consumes the press. */
export const BTN_PRIMARY = 4;
export const BTN_USE = 8;
/** Aim, draw, block. */
export const BTN_SECONDARY = 16;
export const BTN_RELOAD = 32;
/** Strike with the held item, or a fist. */
export const BTN_MELEE = 64;
/** Held while the body should stay low. The client turns a key press into this. */
export const BTN_CROUCH = 128;
export const BTN_PRONE = 256;
/** Toggles the held item's attachment. */
export const BTN_MOD = 512;

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

/** Stamina is stored in thousandths of a point, so it steps in exact integers. */
export const STAMINA_UNITS = 1000;

/** Bits of Body.mflags. The server sets all but MF_WINDED, which the step sets and clears. */
export const MF_NO_SPRINT = 1;
export const MF_NO_JUMP = 2;
/** Carrying too much to move. */
export const MF_ROOTED = 4;
/** Set when stamina reaches zero, cleared once a quarter of it has returned. */
export const MF_WINDED = 8;
/** Unconscious. */
export const MF_OUT = 16;

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
  /** Downward speed at which an airborne body touched down this tick, or 0. */
  landSpeed: 0,
};

export interface MoveParams {
  readonly radius: number;
  readonly height: number;
  readonly eyeHeight: number;
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
  /** False for a body that moves only the way it faces. */
  readonly strafe: boolean;
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
  /**
   * The species whose movement steps this body (a content index), and its facing in 1/65536 turns. Both travel with the body,
   * so the client steps the body it was last told it drives, its survivor's or a mount's.
   */
  kind = 0;
  yaw = 0;
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
    this.kind = o.kind;
    this.yaw = o.yaw;
    this.held = o.held;
    this.act = o.act;
    this.actTicks = o.actTicks;
    this.rounds = o.rounds;
    this.reloadTo = o.reloadTo;
    this.bloom = o.bloom;
    this.kick = o.kick;
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
      this.kind === o.kind &&
      this.yaw === o.yaw &&
      this.held === o.held &&
      this.act === o.act &&
      this.actTicks === o.actTicks &&
      this.rounds === o.rounds &&
      this.reloadTo === o.reloadTo &&
      this.bloom === o.bloom &&
      this.kick === o.kick
    );
  }
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
const found = new Found();

/**
 * `moveX` (strafe right) and `moveZ` (forward) are -127 to 127. `yaw` and `pitch` are in 1/65536 turns, and pitch 16384 is
 * straight up. These are the quantized values sent on the wire.
 */
export function stepBody(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  stepOut.landSpeed = 0;
  if (b.mode === MODE_NONE) {
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    return;
  }
  // The facing follows the look, at once or at turnRate. The body then moves the way it faces.
  if (p.turnRate <= 0 || b.mode === MODE_GHOST || b.mode === MODE_FLY) b.yaw = yaw & 0xffff;
  else {
    let turn = ((yaw - b.yaw + 32768) & 0xffff) - 32768;
    if (turn > p.turnRate) turn = p.turnRate;
    else if (turn < -p.turnRate) turn = -p.turnRate;
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
  const sprint = m2 > 0 && standing && canSprint(b, buttons);
  let stamina = spendStamina(b, p, sprint, m2 > 0 ? p.staminaWalk : 0);
  const speed = p.walkSpeed * (b.speedQ / 1000) * (sprint ? p.sprintMul : standing ? 1 : stance === STANCE_CROUCH ? p.crouchMul : p.proneMul);
  let dvx = (s * mz - c * mx) * speed - b.vx;
  let dvz = (c * mz + s * mx) * speed - b.vz;
  const maxDv = (b.grounded ? p.accelGround : p.accelAir) * dt;
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
    if ((buttons & BTN_JUMP) !== 0 && standing && (flags & (MF_NO_JUMP | MF_ROOTED)) === 0 && stamina >= p.staminaJump) {
      vy = p.jumpSpeed;
      jumped = true;
      stamina -= p.staminaJump;
    } else vy = 0;
  }
  if (!wasGrounded || jumped) {
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
  /** The last surface this tick a falling body slid along, as a unit normal. */
  let slid = false;
  let slideX = 0;
  let slideY = 0;
  let slideZ = 0;

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

    // Terrain: rise onto walkable ground, slide along or stop at anything else. What is walkable is where the body touches it.
    let h = groundUnder(hf, nx, nz, r);
    if (ny < h) {
      if (!(h - ny <= p.stepUp && (ground.ny >= p.slopeCos || h - ny <= SKIN))) {
        const hx = groundUnder(hf, nx, z, r);
        if (ny >= hx || (hx - ny <= p.stepUp && ground.ny >= p.slopeCos)) {
          nz = z;
          h = hx;
        } else {
          const hz = groundUnder(hf, x, nz, r);
          if (ny >= hz || (hz - ny <= p.stepUp && ground.ny >= p.slopeCos)) {
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

    // Structures: push out along the shortest exit, a few rounds.
    let blocked = false;
    /** The last round touched nothing, and the body has not moved since. */
    let clear = false;
    /** The highest a body on foot may rise onto in this substep. */
    const top = y + p.stepUp;
    for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
      let moved = false;
      // Structures, then resource nodes. Both stores hold boxes.
      for (let pass = 0; pass < 2; pass++) {
        const store = pass === 0 ? structs : w.nodes;
        if (!store) continue;
        // A radius of margin each way, for what a push within the round may bring into reach.
        const count = store.query(nx - r, nz - r, nx + r, nz + r, found, ny - r, ny + tall + r);
        // A push moves the body before the next piece is tried, so the order decides where it ends. The grid lists pieces
        // in the order they were stored, which differs between a client and its server. Refs are the same on both.
        sortU32(found.refs, count);
        for (let k = 0; k < count; k++) {
          if (!capsuleBox(store, found.refs[k]!, nx, ny, nz, r, height, 0)) continue;
          moved = true;
          // Where it touches, both the way out and the surface must be level enough for it to stand.
          const stands = push.y > slope * push.depth && push.up > slope;
          if (walking && push.y > 0 && !(push.face && stands)) {
            // The piece meets the lower sphere `down` below its centre. Higher than a step, or too steep there to stand on, it is
            // a wall to a body on foot, which leaves it level and is not pushed up it: off a face as far as clears its plane, off an
            // edge to where the sphere is as wide as it is there.
            const gap = r - push.depth;
            const down = (push.y * gap) / push.depth;
            const side = Math.sqrt(push.x * push.x + push.z * push.z);
            if (side > 0 && (push.up <= slope || (push.depth < r && ny + r - down > top + SKIN))) {
              const out = push.face ? (push.depth * push.depth) / (side * side) : (Math.sqrt(r * r - down * down) - (side * gap) / push.depth) / side;
              nx += push.x * out;
              nz += push.z * out;
              blocked = true;
              continue;
            }
          }
          if (push.hull && stands) {
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
          if (push.y < -0.7 * push.depth && vy > 0) vy = 0;
          else if (push.y > 0 && !walking) {
            // What holds a falling body up too steeply to stand on, it slides along, losing what of its speed went into it, so
            // it banks no speed there to land with. Pressed into a second such surface, it slides along their crease.
            const ux = push.x / push.depth;
            const uy = push.y / push.depth;
            const uz = push.z / push.depth;
            const into = vx * ux + vy * uy + vz * uz;
            if (into < 0) {
              vx -= ux * into;
              vy -= uy * into;
              vz -= uz * into;
              const cx = slideY * uz - slideZ * uy;
              const cy = slideZ * ux - slideX * uz;
              const cz = slideX * uy - slideY * ux;
              const c2 = cx * cx + cy * cy + cz * cz;
              if (slid && c2 > 1e-6 && vx * slideX + vy * slideY + vz * slideZ < -1e-9) {
                const along = (vx * cx + vy * cy + vz * cz) / c2;
                vx = cx * along;
                vy = cy * along;
                vz = cz * along;
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

    // Step up: a grounded body blocked by something no higher than a step climbs onto it.
    if (blocked && walking) {
      let tx = x + sx;
      let tz = z + sz;
      if (tx < r) tx = r;
      else if (tx > maxX) tx = maxX;
      if (tz < r) tz = r;
      else if (tz > maxZ) tz = maxZ;
      if (capsuleFree(w, x, top, z, r, height) && capsuleFree(w, tx, top, tz, r, height)) {
        const on = stepOnto(w, tx, tz, y, top, r, height, slope);
        if (!Number.isNaN(on)) {
          nx = tx;
          ny = on;
          nz = tz;
          clear = false;
        }
      }
    }

    // Commit only a legal position reached by a bounded move. A body the last round found clear of every structure is
    // clear of them at capsuleFree's smaller reach too, so only the ground is asked again.
    const ddx = nx - x;
    const ddz = nz - z;
    const ddy = ny - y;
    if (ddx * ddx + ddz * ddz > maxSide2 || ddy > maxRise || ddy < -maxRise || (clear ? nx < 0 || nz < 0 || nx > hf.sizeX || nz > hf.sizeZ || ny < h - SKIN : !capsuleFree(w, nx, ny, nz, r, height))) {
      vx = 0;
      vz = 0;
      if (vy > 0) vy = 0;
      break;
    }
    x = nx;
    y = ny;
    z = nz;
  }

  // Grounded means resting on terrain or on a structure it can stand on, held where it has no way down, or close enough above
  // support to follow it down (slopes, stairs, kerbs). A sloped part it can stand on is followed as far down as the steepest
  // such slope falls over the way the body went this tick, so a ramp is kept at any speed.
  let grounded = false;
  if (vy <= 0) {
    const under = groundUnder(hf, x, z, r);
    const low = y - p.stepDown;
    let lowest = low;
    if (walking) {
      const ddx = x - b.x;
      const ddz = z - b.z;
      const fallsTo = y - Math.sqrt((ddx * ddx + ddz * ddz) * (1 / (slope * slope) - 1));
      if (fallsTo < low) lowest = fallsTo;
    }
    if (y - under <= GROUND_PROBE) grounded = true;
    else if (walking && nothingBuilt(w, x, z, r, lowest, y + tall)) {
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
  if (grounded && !wasGrounded) stepOut.landSpeed = fall;

  // Deep enough to float, the body swims from the next tick, and a swimmer has no stance.
  // A swimmer is as tall as a standing body, so one held low by a ceiling stays as it is.
  if (hf.seaLevel - y > p.height * SWIM_ENTER && (standing || capsuleFree(w, x, y, z, r, p.height))) {
    b.mode = MODE_SWIM;
    stance = STANCE_STAND;
    grounded = false;
    stepOut.landSpeed = 0;
  }

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
  if (sprint || walk > 0) {
    stamina -= sprint ? p.staminaSprint : walk;
    if (stamina <= 0) {
      stamina = 0;
      b.mflags |= MF_WINDED;
    }
  } else {
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
  const speed = p.swimSpeed * (b.swimQ / 1000) * (sprint ? p.swimSprintMul : 1);

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
  const floatY = hf.seaLevel - p.height * SWIM_FLOAT;

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
    // A swimmer rises no higher than its float line. One that walked in above the line settles down to it.
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
  if (hf.seaLevel - y < p.height * SWIM_EXIT) {
    b.mode = MODE_WALK;
    if (y - groundUnder(hf, x, z, r) <= GROUND_PROBE || !Number.isNaN(restingAt(w, x, y, z, r, p.height, GROUND_PROBE, p.slopeCos))) {
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

/**
 * Flies as a ghost does, with no gravity, but meets the ground, pieces and nodes as a swimmer does, half a radius at a time
 * however fast, so it crosses nothing. It stands while it flies.
 */
function stepFly(w: CollisionWorld, b: Body, moveX: number, moveZ: number, yaw: number, pitch: number, buttons: number, p: MoveParams, dt: number): void {
  flight(b, moveX, moveZ, yaw, pitch, buttons, dt);
  let vx = flown[0]!;
  let vy = flown[1]!;
  let vz = flown[2]!;
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
  b.grounded = false;
  b.stance = STANCE_STAND;
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
