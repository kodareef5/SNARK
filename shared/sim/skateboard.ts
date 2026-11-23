// The skateboard: push, carve, pop, spin, flip, grab, grind, slide, manual and revert, in the shared fixed step.
// The trick table (skate-tricks.ts) says what each key and direction does and what it scores.
import { TICK_DT, YAW_UNITS } from "../coords.ts";
import { PI, TAU, clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";
import { capsuleFree, groundUnder, type CollisionWorld } from "../world/collide.ts";
import { grindAt } from "../world/grind.ts";
import { castWorld, HIT_NONE, rayHit } from "../world/ray.ts";
import { vehicleSurfaceAt } from "../world/vehicle-surface.ts";
import { BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, type Body } from "./character.ts";
import {
  BAIL, CHARGE_TICKS, FLIP, GRAB, GRIND, LINE_MOST, MANUAL, OLLIE, PUSH, REVERT, ROLL, SLIDE, SPECIAL, SPECIAL_FULL, SkateState,
} from "./skate-state.ts";
import {
  FAM_FLIP, FAM_GRAB, FAM_GRIND, FAM_MANUAL, FAM_SLIDE, FAM_SPECIAL, GRADE_CLEAN, GRADE_PERFECT, GRADE_SLOPPY,
  T_OLLIE, T_REVERT, T_SPIN, entryHalves, entryKey, entryTrick, lineEntry, skateDirection, trickFor, trickOf, trickPoints,
} from "./skate-tricks.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import type { VehicleSpec, VehicleStep } from "./vehicle.ts";

/** Ticks of rolling that bank a line, of a push stroke, of grace to pop after leaving the ground, of a pop let go of early. */
const LINK_TICKS = 24, PUSH_TICKS = 22, GRACE_TICKS = 3, BUFFER_TICKS = 4;
/** Ticks a pop pressed in the air leaves to land Perfect, and after landing in which a revert links. */
const PERFECT_TICKS = 3, REVERT_WINDOW = 8, REVERT_TICKS = 8;
/** Pop speed from a tap to a full charge, in metres a second, and gravity. */
export const POP_LOW = 4.2, POP_HIGH = 6.2;
const GRAVITY = 16;
/** Spin in degrees a tick at full turn, the ticks a turn key is held before it spins, and how fast it comes up to speed. */
export const SPIN_RATE = 20;
const SPIN_START = 3, SPIN_RAMP = 7;
/** Ticks a grab is held to count, and the ticks of each 25 points it earns held longer. */
const GRAB_LEAST = 6, GRAB_BONUS_TICKS = 6;
/** Degrees off straight at landing for Perfect, Clean and Sloppy; past SLOPPY it is a bail. */
const PERFECT_OFF = 10, CLEAN_OFF = 25, SLOPPY_OFF = 45, CATCH_OFF = 30;
/** Approach cosines: along an edge within 25° is a grind, from there to 75° a slide. */
const GRIND_LEAST = .906, SLIDE_LEAST = .26;
/** Edge and manual pay: points for each 100 mm, and how far a manual goes before it counts. */
const DISTANCE_UNIT = 100, MANUAL_LEAST = 600;
/** On the ground a movement key held longer than this is the rider's push or carve, and picks no trick until pressed again. */
const PICK_TICKS = 6;
const KEY_UP = 1, KEY_DOWN = 2, KEY_LEFT = 4, KEY_RIGHT = 8;
/** The rider's body starts this far above the wheels: below it, the wheels meet the ground on their own. A step up taller
 * than STEP_LEAST beyond what the slope climbs stops the wheels, as a kerb does. */
const RIDER_LIFT = .2, STEP_LEAST = .04;

const FLIP_KEYS = BTN_RELOAD | BTN_PRIMARY, GRAB_KEYS = BTN_CROUCH | BTN_SECONDARY;
const f32 = Math.fround;
const deckRotation = new Float64Array(4);
const deckFrame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };

export const skateBail = (impact: number, landing: number): number =>
  Math.min(8, Math.ceil(Math.max(0, impact - 6.3, landing - 9) * 1.5));

/** Degrees from the nearest half turn. */
const offStraight = (spin: number): number => Math.abs(spin - 180 * Math.round(spin / 180));

/** Entries before entry `i` that are the same trick. */
function repeats(s: SkateState, key: number, i: number): number {
  let n = 0;
  for (let k = Math.max(0, i - LINE_MOST + 1); k < i; k++) if (entryKey(s.line[k % LINE_MOST]!) === key) n++;
  return n;
}

function record(s: SkateState, entry: number): number {
  const i = s.count;
  s.line[i % LINE_MOST] = entry;
  s.count = i + 1;
  return i;
}

/** Pays entry `i`: its points, less for each time it was done before in the line, and the multiplier if it is new. */
function pay(s: SkateState, i: number, grade: number): void {
  const slot = i % LINE_MOST, e = s.line[slot]!, n = repeats(s, entryKey(e), i);
  const t = trickOf(entryTrick(e));
  let points = trickPoints(t.id, t.spin ? 0 : entryHalves(e), n) + (e >>> 12) * 25;
  if (grade === GRADE_SLOPPY) points >>= 1;
  s.line[slot] = (e & ~(3 << 10)) | (grade << 10);
  s.points += points;
  if (n === 0) s.chain = Math.min(255, s.chain + 1);
  s.window = LINK_TICKS;
}

/** A trick finished in the air waits for the landing to be paid. */
function finish(s: SkateState, id: number, bonus = 0): void {
  if (s.pending >= 7) return;
  record(s, lineEntry(id, 0, 0) | (Math.min(15, bonus) << 12));
  s.pending++;
}

/** Lands the air: its tricks paid by how straight it came down, its spin turned into stance. The hurt of a fall, or 0. */
function landAir(s: SkateState, keys: number): number {
  // A revert rolled off a kerb comes down still turning, and goes on turning.
  if (s.move === REVERT) return 0;
  const t = trickOf(s.trick);
  let sloppy = false, hurt = 0;
  if (s.move === FLIP || s.move === SPECIAL) {
    if (s.ticks < 6) hurt = 2;
    else {
      sloppy = s.ticks < t.ticks - 3;
      finish(s, s.trick);
    }
  } else if (s.move === GRAB) {
    if (keys & GRAB_KEYS) hurt = 1;
    else if (s.ticks >= GRAB_LEAST) finish(s, s.trick, Math.floor((s.ticks - GRAB_LEAST) / GRAB_BONUS_TICKS));
  }
  const off = offStraight(s.spin), halves = Math.round(Math.abs(s.spin) / 180);
  if (off > SLOPPY_OFF) hurt = Math.max(hurt, 2);
  if (hurt) return hurt;
  if (halves) {
    const last = s.count - 1;
    if (s.pending && !trickOf(entryTrick(s.line[last % LINE_MOST]!)).spin) s.line[last % LINE_MOST] = (s.line[last % LINE_MOST]! & ~(7 << 7)) | (Math.min(7, halves) << 7);
    else if (!s.pending) { record(s, lineEntry(T_SPIN, halves, 0)); s.pending = 1; }
    if (halves & 1) s.switched = !s.switched;
  }
  const grade = sloppy || off > CLEAN_OFF ? GRADE_SLOPPY : off <= PERFECT_OFF && s.perfect > 0 ? GRADE_PERFECT : GRADE_CLEAN;
  for (let i = s.count - s.pending; i < s.count; i++) pay(s, i, grade);
  if (s.pending && grade === GRADE_PERFECT) s.chain = Math.min(255, s.chain + 1);
  s.grade = s.pending ? grade : 0;
  s.pending = 0; s.landed = 0; s.spin = s.spinRate = 0;
  s.move = ROLL; s.trick = 0; s.ticks = 0;
  return 0;
}

function clearLine(s: SkateState): void {
  s.points = s.chain = s.count = s.pending = s.window = s.distance = 0;
  s.line.fill(0);
}

function bank(s: SkateState): void {
  s.bank = s.points * Math.max(1, s.chain);
  s.banks = (s.banks + 1) & 255;
  s.special = Math.min(SPECIAL_FULL, s.special + Math.floor(s.bank / 8));
  clearLine(s);
}

/** An edge or a link trick paid at once, as it starts. */
function link(s: SkateState, id: number): void {
  pay(s, record(s, lineEntry(id, 0, 0)), 0);
}

/** Positive Y is the bottom of the wheels. The standing rider shares the board's swept clearance. */
export function stepSkateboard(w: CollisionWorld, b: Body, xInput: number, zInput: number, keys: number,
  p: VehicleSpec, pilot: boolean, out: VehicleStep): void {
  b.vehicle = true;
  const s = b.skate ??= new SkateState();
  if (!pilot) { keys = 0; zInput = xInput = 0; }
  const pressed = keys & ~s.keys, released = s.keys & ~keys;
  s.keys = keys;
  // A movement key picks a trick, or turns the rider in the air, only pressed for it: not one held since the push or carve.
  const bits = (zInput >= 64 ? KEY_UP : zInput <= -64 ? KEY_DOWN : 0) | (xInput <= -64 ? KEY_LEFT : xInput >= 64 ? KEY_RIGHT : 0);
  const fresh = bits & ~s.held;
  s.pressAge = fresh ? 0 : Math.min(255, s.pressAge + 1);
  s.lock &= bits & ~fresh;
  if (b.grounded && s.pressAge > PICK_TICKS) s.lock |= bits;
  s.held = bits;
  const free = bits & ~s.lock;
  const dir = skateDirection(free & KEY_LEFT ? -127 : free & KEY_RIGHT ? 127 : 0, free & KEY_UP ? 127 : free & KEY_DOWN ? -127 : 0);
  const side = free & KEY_LEFT ? -1 : free & KEY_RIGHT ? 1 : 0;
  s.grace = b.grounded ? GRACE_TICKS : Math.max(0, s.grace - 1);
  s.landed = Math.min(255, s.landed + 1);
  if (s.perfect) s.perfect--;
  let speed = Math.sqrt(b.vx*b.vx + b.vz*b.vz);
  const steer = -xInput / 127, push = zInput / 127;
  const onEdge = s.move === GRIND || s.move === SLIDE;
  if (push >= 0 || !b.grounded || onEdge || s.move === MANUAL) {
    if (s.brake === 2 && pilot) speed = 0;
    s.brake = 0;
  } else if (!s.brake) {
    s.brake = speed < .05 ? 2 : 1;
  }
  const carving = b.grounded && !onEdge && s.move !== REVERT;
  b.steering = f32(b.steering + clamp((carving ? steer*p.maxSteer : 0) - b.steering, -p.steerRate*TICK_DT, p.steerRate*TICK_DT));
  const yawRate = carving ? b.steering / p.maxSteer * (2.5 / (1+speed*.08)) * (s.move === MANUAL ? .25 : 1) : 0;
  let heading = (!pilot && speed > .01 ? detAtan2(b.vx, b.vz) : b.vehicleYaw - (s.switched ? PI : 0) - s.spin*PI/180) + yawRate*TICK_DT;
  let fx = detSin(heading), fz = detCos(heading);
  let hurt = 0;
  if (s.move === BAIL && ++s.ticks > 20) { s.move = ROLL; s.ticks = 0; }

  // On the ground: push, coast, manual, revert.
  if (b.grounded && !onEdge && s.move !== REVERT && s.move !== BAIL) {
    if (pilot && (keys & BTN_PRONE) && speed >= 1.5) {
      if (s.move !== MANUAL) {
        s.move = MANUAL; s.trick = trickFor(FAM_MANUAL, dir); s.ticks = 0; s.balance = 0; s.distance = 0; s.paid = false;
      }
    } else if (pilot && (pressed & BTN_MOD)) {
      s.move = REVERT; s.trick = T_REVERT; s.ticks = 0; s.spin = side > 0 ? -1 : 1;
      if (s.landed <= REVERT_WINDOW && s.window) link(s, T_REVERT);
    } else if (push > 0) {
      if (s.move !== PUSH) s.ticks = 0;
      s.move = PUSH; s.trick = 0; s.ticks = (s.ticks + 1) % PUSH_TICKS;
    } else { s.move = ROLL; s.trick = 0; s.ticks = 0; }
  }
  if (b.grounded && !onEdge) {
    const top = p.maxForward * (s.special >= SPECIAL_FULL ? 1.1 : 1);
    // A short power stroke followed by a glide. A held key repeats the stroke.
    if (push > 0 && s.move === PUSH && speed < top) speed = Math.min(top, speed + push*p.acceleration*(s.ticks < 11 ? 1.8 : .2)*TICK_DT);
    if (s.brake === 2) {
      speed = Math.min(1.2, speed - push * 3 * TICK_DT);
      fx = -fx; fz = -fz;
    } else speed -= (push < 0 && s.move !== MANUAL ? -push*p.brake : pilot ? .32 : 3.2)*TICK_DT;
    speed = clamp(speed, 0, top + 4);
  }
  if (s.move === REVERT) {
    const turn = s.spin < 0 ? -1 : 1;
    s.ticks++; s.window = s.window ? LINK_TICKS : 0;
    s.spin = turn * Math.round(180 * Math.min(1, s.ticks / REVERT_TICKS));
    speed *= .985;
    if (s.ticks >= REVERT_TICKS) { s.switched = !s.switched; s.spin = 0; s.move = ROLL; s.trick = 0; s.ticks = 0; }
  }

  // The pop: held to crouch, let go to jump. Let go just before landing, it jumps on landing.
  const canPop = pilot && (b.grounded || s.grace > 0) && s.move !== BAIL && s.move !== REVERT;
  if (canPop && (keys & BTN_JUMP)) s.charge = Math.min(CHARGE_TICKS, s.charge + 1);
  if (pilot && !b.grounded && (pressed & BTN_JUMP)) s.perfect = PERFECT_TICKS;
  if (pilot && !canPop && (released & BTN_JUMP)) s.buffer = BUFFER_TICKS;
  const pop = canPop && ((released & BTN_JUMP) !== 0 || s.buffer > 0 && b.grounded && !(keys & BTN_JUMP));
  if (pop) {
    const sliding = s.move === SLIDE;
    b.vy = POP_LOW + (POP_HIGH - POP_LOW) * s.charge / CHARGE_TICKS + Math.max(0, speed * s.rise / 1000);
    b.grounded = false; s.grace = s.buffer = s.charge = 0;
    s.move = OLLIE; s.trick = T_OLLIE; s.ticks = 0;
    s.spinHold = 0; s.pending = 0;
    // Out of a slide the deck turns back straight in the air.
    if (sliding) s.spinRate = s.spin > 0 ? -1 : 1;
    else s.spin = s.spinRate = 0;
  } else if (s.buffer) s.buffer--;
  if (!(keys & BTN_JUMP)) s.charge = 0;

  // In the air: one trick at a time, each started as the last ends; A/D spin.
  if (!b.grounded && pilot) {
    if (s.move === OLLIE || s.move === ROLL || s.move === PUSH) {
      const special = (pressed & BTN_MELEE) !== 0 && s.special >= SPECIAL_FULL;
      const family = special ? FAM_SPECIAL : pressed & FLIP_KEYS ? FAM_FLIP : pressed & GRAB_KEYS ? FAM_GRAB : -1;
      if (family >= 0) {
        s.trick = trickFor(family, dir); s.ticks = 0;
        s.move = family === FAM_SPECIAL ? SPECIAL : family === FAM_FLIP ? FLIP : GRAB;
        if (special) s.special = 0;
        // A direction pressed with the trick picks it, and does not turn the rider until it is let go.
        if (side && s.spinHold < SPIN_START) { s.lock |= side < 0 ? KEY_LEFT : KEY_RIGHT; s.spinHold = 0; }
      }
    }
    const t = trickOf(s.trick);
    if (s.move === SPECIAL && t.spin) {
      // A spinning special turns by itself, the way it was started.
      if (s.ticks === 0) s.spinRate = side > 0 ? -1 : 1;
      const turn = s.spinRate < 0 ? -1 : 1, from = s.spin - turn * Math.round(t.spin * Math.min(1, s.ticks / t.ticks));
      s.spin = from + turn * Math.round(t.spin * Math.min(1, (s.ticks + 1) / t.ticks));
    } else {
      const turning = side !== 0 && !(s.lock & (side < 0 ? KEY_LEFT : KEY_RIGHT));
      s.spinHold = turning ? Math.min(15, s.spinHold + 1) : 0;
      if (turning && s.spinHold >= SPIN_START) {
        const want = -side * SPIN_RATE;
        s.spinRate = want > 0 ? Math.min(want, Math.max(0, s.spinRate) + SPIN_RAMP) : Math.max(want, Math.min(0, s.spinRate) - SPIN_RAMP);
        s.spin = clamp(s.spin + s.spinRate, -1440, 1440);
      } else if (s.spinRate) {
        // Let go, it finishes the half turn it is in.
        const turn = s.spinRate < 0 ? -1 : 1;
        const stop = turn > 0 ? 180 * Math.ceil(s.spin / 180) : 180 * Math.floor(s.spin / 180);
        s.spinRate = turn * Math.min(SPIN_RATE, Math.abs(s.spinRate) + SPIN_RAMP);
        const next = s.spin + s.spinRate;
        if (turn * (next - stop) >= 0) { s.spin = stop; s.spinRate = 0; } else s.spin = next;
      }
    }
    if (s.move === GRAB) {
      if (keys & GRAB_KEYS) s.ticks = Math.min(255, s.ticks + 1);
      else {
        if (s.ticks >= GRAB_LEAST) finish(s, s.trick, Math.floor((s.ticks - GRAB_LEAST) / GRAB_BONUS_TICKS));
        s.move = OLLIE; s.trick = T_OLLIE; s.ticks = 20;
      }
    } else {
      s.ticks = Math.min(255, s.ticks + 1);
      if ((s.move === FLIP || s.move === SPECIAL) && s.ticks >= t.ticks) {
        finish(s, s.trick);
        s.move = OLLIE; s.trick = T_OLLIE;
      }
    }
  }
  if (!b.grounded) b.vy = Math.max(-35, b.vy - GRAVITY*TICK_DT);

  const radius = pilot ? .4 : .17, height = pilot ? 1.8 : .34, lift = pilot ? RIDER_LIFT : .05;
  const startX = b.x, startZ = b.z;
  let climb = 0;
  // A substep is shorter than the rider radius even at top speed. A head-on wall stops the board.
  const steps = Math.max(1, Math.ceil(Math.max(speed, Math.abs(b.vy))*TICK_DT / .14));
  const dt = TICK_DT / steps;
  let floorPitch = 0, floorRoll = 0;
  for (let i = 0; i < steps; i++) {
    let x = b.x + speed*fx*dt, z = b.z + speed*fz*dt;
    let y = b.y + b.vy*dt;
    const edging = s.move === GRIND || s.move === SLIDE;
    const canCatch = pilot && (keys & BTN_SPRINT) && (edging || !b.grounded && b.vy < 0 && offStraight(s.spin) <= CATCH_OFF) &&
      speed > 1.4 && b.vy >= -9 && !(s.move === FLIP && s.ticks < trickOf(s.trick).ticks - 3) && s.move !== SPECIAL &&
      !(s.move === GRAB && (keys & GRAB_KEYS));
    const edge = canCatch ? grindAt(w, x, y, z, fx, fz, edging ? .38 : speed > 6 ? .6 : .38, edging ? .2 : SLIDE_LEAST, !edging) : null;
    let wheels = false;
    if (edge && (edging || b.y >= edge.y - .025 && y <= edge.y + .12) && capsuleFree(w, edge.x, edge.y + .004 + lift, edge.z, radius, height - lift)) {
      if (!edging) {
        // Catching an edge lands the air on it.
        if (!b.grounded) hurt = Math.max(hurt, landAir(s, keys));
        const slide = edge.along < GRIND_LEAST;
        s.move = slide ? SLIDE : GRIND; s.trick = trickFor(slide ? FAM_SLIDE : FAM_GRIND, dir);
        s.ticks = 0; s.balance = s.distance = 0; s.spinRate = 0;
        s.spin = slide ? edge.side * 90 : 0;
        if (slide) speed *= Math.max(.6, edge.along);
        link(s, s.trick); s.paid = true;
      }
      x = edge.x; y = edge.y + .004; z = edge.z;
      fx = edge.dx; fz = edge.dz; heading = detAtan2(fx, fz);
      floorPitch = detAtan2(edge.rise, 1);
      s.rise = clamp(Math.round(edge.rise * 1000), -3000, 3000);
      // Grinds keep 95% of their speed a second, and run faster downhill.
      speed = Math.max(0, speed * (1 - .05*dt) - edge.rise * 7 * dt);
      b.vy = 0; b.grounded = true;
    } else {
      if (edging) {
        s.move = ROLL; s.trick = 0; s.window = LINK_TICKS; s.spin = 0;
      }
      const reach = b.grounded ? p.maxRise : .015;
      const origin = b.y + reach;
      const drop = b.grounded ? p.maxDrop : Math.max(.015, b.y-y);
      const hit = castWorld(w, x, origin, z, 0, -1, 0, reach + drop + .01, true);
      const supported = hit !== HIT_NONE && rayHit.ny >= p.minGroundNormal;
      // A ramp is climbed and a crack rolled over. A taller step stops the wheels.
      const tan = supported ? Math.sqrt(rayHit.nx*rayHit.nx + rayHit.nz*rayHit.nz) / Math.max(.5, rayHit.ny) : 0;
      const floor = supported ? Math.max(origin - rayHit.t, groundUnder(w.hf, x, z, radius)) : 0;
      if (supported && b.grounded && floor - b.y > Math.sqrt((x-b.x)*(x-b.x) + (z-b.z)*(z-b.z)) * Math.max(tan, climb) + STEP_LEAST) wheels = true;
      else if (supported && b.vy <= 0) {
        if (floor >= y - (b.grounded ? p.maxDrop : .01)) {
          climb = tan;
          y = floor + .002;
          if (!b.grounded) {
            out.landSpeed = Math.max(out.landSpeed, -b.vy);
            hurt = Math.max(hurt, landAir(s, keys));
            if (s.grade === GRADE_SLOPPY && s.landed === 0) speed *= .7;
          }
          b.grounded = true; b.vy = 0;
          const surface = vehicleSurfaceAt(w, hit, rayHit.ref, x, z);
          out.surface = surface.id;
          const slope = (rayHit.nx*fx + rayHit.nz*fz) / Math.max(.5, rayHit.ny);
          floorPitch = detAtan2(s.brake === 2 ? slope : -slope, 1);
          floorRoll = detAtan2(rayHit.nz*fx - rayHit.nx*fz, rayHit.ny);
          s.rise = clamp(Math.round((s.brake === 2 ? slope : -slope) * 1000), -3000, 3000);
          speed = clamp(speed + (slope*7 - surface.rolling)*dt, 0, Math.max(p.maxForward * 1.1, speed));
        }
      } else if (b.grounded) {
        // Off a lip the board keeps the rise it was climbing.
        const launch = speed * s.rise / 1000;
        b.grounded = false; b.vy = launch > 0 ? launch : -GRAVITY*dt;
        if (s.move !== REVERT && s.move !== BAIL) { s.move = ROLL; s.trick = 0; }
        s.spinHold = 0; s.rise = 0;
      }
    }
    if (wheels || !capsuleFree(w, x, y + lift, z, radius, height - lift)) {
      if (!wheels) {
        // Hitting an overhead beam cancels upward velocity without treating it as a street crash.
        if (b.vy > 0 && capsuleFree(w, x, b.y + lift, z, radius, height - lift)) { b.vy = 0; break; }
        // The wheels can clear the end before the rider capsule does. Let it slide off at the old height.
        if (b.vy <= 0 && y < b.y && capsuleFree(w, x, b.y + lift, z, radius, height - lift)) {
          b.x = x; b.z = z; b.vy = 0;
          continue;
        }
      }
      // A glancing scrape sheds the velocity into the face while retaining travel along it.
      if (s.brake !== 2 && speed > 0 && castWorld(w, b.x, b.y + (wheels ? .07 : .42), b.z, fx, 0, fz, .52) !== HIT_NONE) {
        const into = fx*rayHit.nx + fz*rayHit.nz;
        if (into < 0 && into > -.75) {
          const tx = fx - into*rayHit.nx, tz = fz - into*rayHit.nz, length = Math.sqrt(tx*tx+tz*tz);
          if (length > .1) {
            fx = tx/length; fz = tz/length; heading = detAtan2(fx,fz); speed *= length;
            continue;
          }
        }
      }
      // A kerb stops the wheels and pitches the rider less than a wall does.
      out.impactSpeed = Math.max(out.impactSpeed, wheels ? speed * .7 : speed);
      speed = 0; break;
    }
    b.x = x; b.y = y; b.z = z;
  }
  if (b.y + .18 < w.hf.waterAt(b.x, b.z)) { out.water = true; speed *= .65; }

  // Edges and manuals pay by distance while the rider keeps balance.
  if (s.move === GRIND || s.move === SLIDE || s.move === MANUAL) {
    s.ticks = Math.min(255, s.ticks + 1);
    const again = repeats(s, s.trick, s.count) - (s.paid ? 1 : 0);
    // The first half second settles. After that, weight drifts toward the low side, faster on an edge done before.
    const drift = Math.min(22, Math.max(0, s.ticks - 15) * .24) * (1 + .3 * Math.min(3, Math.max(0, again)));
    s.balance = clamp(Math.round(s.balance + (s.balance < 0 ? -1 : 1)*drift + xInput*.32), -1000, 1000);
    s.distance += Math.round(Math.max(0, (b.x-startX)*fx + (b.z-startZ)*fz)*1000);
    if (s.move === MANUAL && !s.paid && s.distance >= MANUAL_LEAST) { link(s, s.trick); s.paid = true; s.distance -= MANUAL_LEAST; }
    if (s.paid) {
      const units = Math.floor(s.distance / DISTANCE_UNIT);
      s.points += units; s.distance -= units * DISTANCE_UNIT;
      s.window = LINK_TICKS;
    }
    if (Math.abs(s.balance) >= 1000) hurt = Math.max(hurt, 1);
  } else if (s.window && !s.pending && s.move !== REVERT && (b.grounded || s.move === OLLIE) && --s.window === 0) {
    bank(s);
  }
  out.skateHurt = hurt;
  if (hurt || skateBail(out.impactSpeed, out.landSpeed) || out.water) {
    s.move = BAIL; s.trick = 0; s.ticks = 0; s.spin = s.spinRate = 0; s.special = 0;
    clearLine(s);
    speed = Math.min(speed * .6, 3);
  }
  b.x = f32(b.x); b.y = f32(b.y); b.z = f32(b.z);
  b.vx = f32(speed*fx); b.vz = f32(speed*fz); b.vy = f32(b.vy);
  const yaw = heading + (s.switched ? PI : 0) + s.spin*PI/180;
  b.vehicleYaw = f32(yaw % TAU); b.yaw = Math.round(yaw*YAW_UNITS/TAU) & 65535;
  const edged = s.move === GRIND || s.move === SLIDE || s.move === MANUAL, t = trickOf(s.trick);
  const lean = (edged ? -s.balance*.00024 : 0) - b.steering*Math.min(.45, speed*.055);
  const tip = s.move === MANUAL || s.move === GRIND ? -t.along * (s.move === MANUAL ? .19 : .16) : 0;
  b.vehicleRoll = f32(b.vehicleRoll + (floorRoll + lean - b.vehicleRoll)*.4);
  b.vehiclePitch = f32(b.vehiclePitch + (floorPitch + tip - b.vehiclePitch)*.4);
  deckFrame.yaw = yaw; deckFrame.pitch = b.vehiclePitch; deckFrame.roll = b.vehicleRoll;
  vehicleRotation(deckFrame, deckRotation);
  b.vehicleQx = f32(deckRotation[0]!); b.vehicleQy = f32(deckRotation[1]!);
  b.vehicleQz = f32(deckRotation[2]!); b.vehicleQw = f32(deckRotation[3]!);
  // The observer wheel phase carries the trick's phase: the push cycle, the deck's turn, the grab's reach.
  const phase = s.move === PUSH ? s.ticks/PUSH_TICKS
    : s.move === FLIP || s.move === SPECIAL ? Math.min(.999, s.ticks/Math.max(1, t.ticks))
    : s.move === GRAB ? Math.min(.999, s.ticks/8)
    : s.move === REVERT ? Math.min(.999, s.ticks/REVERT_TICKS)
    : s.move === BAIL ? Math.min(.999, s.ticks/20)
    : s.move === OLLIE ? Math.min(.999, s.ticks/13) : 0;
  b.wheelAngle = f32(TAU * phase);
  // A board thrown in a bail tumbles a moment on its own; otherwise a parked board keeps no line.
  if (!pilot && !(s.move === BAIL && s.ticks < 20)) b.skate = null;
}
