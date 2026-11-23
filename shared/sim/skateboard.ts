import { TICK_DT, YAW_UNITS } from "../coords.ts";
import { TAU, clamp, detAtan2, detCos, detSin } from "../math/scalar.ts";
import { capsuleFree, groundUnder, type CollisionWorld } from "../world/collide.ts";
import { grindAt } from "../world/grind.ts";
import { castWorld, HIT_NONE, rayHit } from "../world/ray.ts";
import { vehicleSurfaceAt } from "../world/vehicle-surface.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_SECONDARY, BTN_RELOAD, BTN_MELEE, BTN_SPRINT, type Body } from "./character.ts";
import { BAIL, GRIND, KICKFLIP, OLLIE, PUSH, ROLL, SHOVE, SkateState, TRICK_TICKS } from "./skate-state.ts";
import { vehicleRotation } from "./vehicle-frame.ts";
import type { VehicleSpec, VehicleStep } from "./vehicle.ts";

const LINK_TICKS = 24, PUSH_TICKS = 22;
const f32 = Math.fround;
const deckRotation = new Float64Array(4);
const deckFrame = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
function credit(s: SkateState, points: number) {
  s.chain = Math.min(12, s.chain + 1);
  s.score = Math.min(65535, s.score + points * s.chain);
  s.window = LINK_TICKS;
}
export const skateBail = (impact: number, landing: number): number =>
  Math.min(8, Math.ceil(Math.max(0, impact - 6.3, landing - 9) * 1.5));

/** Positive Y is the bottom of the wheels. The standing rider shares the board's swept clearance. */
export function stepSkateboard(w: CollisionWorld, b: Body, xInput: number, zInput: number, keys: number,
  p: VehicleSpec, pilot: boolean, out: VehicleStep): void {
  b.vehicle = true;
  const s = b.skate ??= new SkateState();
  if (!pilot) { keys = 0; zInput = xInput = 0; }
  const pressed = keys & ~s.keys;
  s.keys = keys;
  s.buffer = pressed & BTN_JUMP ? 4 : Math.max(0, s.buffer - 1);
  s.grace = b.grounded ? 3 : Math.max(0, s.grace - 1);
  let speed = Math.sqrt(b.vx*b.vx + b.vz*b.vz);
  const steer = -xInput / 127, push = zInput / 127;
  b.steering = f32(b.steering + clamp(steer*p.maxSteer - b.steering, -p.steerRate*TICK_DT, p.steerRate*TICK_DT));
  const yawRate = b.steering / p.maxSteer * (2.5 / (1+speed*.08)) * Math.min(1, speed/1.5);
  let yaw = b.vehicleYaw + yawRate * TICK_DT * (b.grounded ? 1 : .28);
  let fx = detSin(yaw), fz = detCos(yaw);
  if (b.grounded) {
    if (s.move !== GRIND || !(keys & BTN_SPRINT)) {
      if (push > 0) {
        if (s.move !== PUSH) s.ticks = 0;
        s.move = PUSH; s.ticks = (s.ticks + 1) % PUSH_TICKS;
      } else { s.move = ROLL; s.ticks = 0; }
    }
    // Short power stroke followed by a glide. A held key repeats the stroke.
    if (push > 0 && s.move === PUSH) speed += push*p.acceleration*(s.ticks < 11 ? 1.8 : .2)*TICK_DT;
    speed -= (push < 0 ? -push*p.brake : pilot ? .32 : 3.2)*TICK_DT;
    speed = clamp(speed, 0, p.maxForward);
  }
  if (s.buffer && s.grace && pilot) {
    b.vy = 5.25; b.grounded = false; s.grace = s.buffer = 0;
    s.move = OLLIE; s.ticks = 0;
  }
  if (!b.grounded && (s.move === OLLIE || s.move === ROLL || s.move === PUSH)) {
    const flip = pressed & (BTN_PRIMARY | BTN_RELOAD), shove = pressed & (BTN_SECONDARY | BTN_MELEE);
    if (flip || shove) { s.move = flip ? KICKFLIP : SHOVE; s.ticks = 0; }
  }
  if (!b.grounded) { s.ticks = Math.min(255, s.ticks + 1); b.vy = Math.max(-35, b.vy - 16*TICK_DT); }
  const radius = .17, height = pilot ? 1.65 : .34;
  // A substep is shorter than the rider radius even at top speed. A head-on wall stops the board.
  const steps = Math.max(1, Math.ceil(Math.max(speed, Math.abs(b.vy))*TICK_DT / .14));
  const dt = TICK_DT / steps;
  let floorPitch = 0, floorRoll = 0;
  for (let i = 0; i < steps; i++) {
    let x = b.x + speed*fx*dt, z = b.z + speed*fz*dt;
    let y = b.y + b.vy*dt;
    const canCatch = pilot && (keys & BTN_SPRINT) && speed > 1.4 && b.vy <= 1 && b.vy >= -9 &&
      (s.move !== KICKFLIP && s.move !== SHOVE || s.ticks >= TRICK_TICKS - 3);
    const edge = canCatch ? grindAt(w.structs, x, y, z, fx, fz) : null;
    if (edge && capsuleFree(w, edge.x, edge.y + .004, edge.z, radius, height)) {
      if (s.move !== GRIND) {
        if (s.move === KICKFLIP || s.move === SHOVE) credit(s, 100);
        credit(s, 60); s.ticks = 0;
      }
      s.move = GRIND; x = edge.x; y = edge.y + .004; z = edge.z;
      fx = edge.dx; fz = edge.dz; yaw = detAtan2(fx, fz);
      floorPitch = detAtan2(edge.rise, 1);
      b.vy = 0; b.grounded = true;
    } else {
      if (s.move === GRIND) { s.move = ROLL; s.window = LINK_TICKS; }
      const lift = b.grounded ? p.maxRise : .015;
      const origin = b.y + lift;
      const drop = b.grounded ? p.maxDrop : Math.max(.015, b.y-y);
      const hit = castWorld(w, x, origin, z, 0, -1, 0, lift + drop + .01, true);
      const supported = hit !== HIT_NONE && rayHit.ny >= p.minGroundNormal;
      if (supported && b.vy <= 0) {
        const floor = Math.max(origin - rayHit.t, groundUnder(w.hf, x, z, radius));
        if (floor >= y - (b.grounded ? p.maxDrop : .01)) {
          y = floor + .002;
          if (!b.grounded) {
            out.landSpeed = Math.max(out.landSpeed, -b.vy);
            if (s.move === OLLIE) credit(s, 25);
            if (s.move === KICKFLIP || s.move === SHOVE) {
              // A near-complete rotation catches cleanly. A very late one rolls out for no trick points.
              if (s.ticks >= TRICK_TICKS - 3) credit(s, s.move === KICKFLIP ? 120 : 95);
            }
            s.move = ROLL; s.ticks = 0;
          }
          b.grounded = true; b.vy = 0;
          const surface = vehicleSurfaceAt(w, hit, rayHit.ref, x, z);
          out.surface = surface.id;
          const slope = (rayHit.nx*fx + rayHit.nz*fz) / Math.max(.5, rayHit.ny);
          floorPitch = detAtan2(-slope, 1);
          floorRoll = detAtan2(rayHit.nz*fx - rayHit.nx*fz, rayHit.ny);
          speed = clamp(speed + (slope*7 - surface.rolling)*dt, 0, p.maxForward);
        }
      } else if (b.grounded) { b.grounded = false; b.vy = -16*dt; s.move = ROLL; }
    }
    if (!capsuleFree(w, x, y, z, radius, height)) {
      // Hitting an overhead beam cancels upward velocity without treating it as a street crash.
      if (b.vy > 0 && capsuleFree(w, x, b.y, z, radius, height)) { b.vy = 0; break; }
      // The wheels can clear the end before the rider capsule does. Let it slide off at the old height.
      if (b.vy <= 0 && y < b.y && capsuleFree(w, x, b.y, z, radius, height)) {
        b.x = x; b.z = z; b.vy = 0;
        continue;
      }
      // A glancing scrape sheds the velocity into the face while retaining travel along it.
      if (speed > 0 && castWorld(w, b.x, b.y+.42, b.z, fx, 0, fz, .52) !== HIT_NONE) {
        const into = fx*rayHit.nx + fz*rayHit.nz;
        if (into < 0 && into > -.75) {
          const tx = fx - into*rayHit.nx, tz = fz - into*rayHit.nz, length = Math.sqrt(tx*tx+tz*tz);
          if (length > .1) {
            fx = tx/length; fz = tz/length; yaw = detAtan2(fx,fz); speed *= length;
            continue;
          }
        }
      }
      out.impactSpeed = Math.max(out.impactSpeed, speed);
      speed = 0; break;
    }
    b.x = x; b.y = y; b.z = z;
  }
  if (b.y + .18 < w.hf.waterAt(b.x, b.z)) { out.water = true; speed *= .65; }
  if (s.move === GRIND) {
    s.score = Math.min(65535, s.score + Math.max(1, Math.round(speed*TICK_DT*5))*s.chain);
    s.window = LINK_TICKS;
  } else if (b.grounded && s.window && --s.window === 0) {
    s.bank = s.score; s.score = s.chain = 0;
  }
  if (skateBail(out.impactSpeed, out.landSpeed) || out.water) {
    s.move = BAIL; s.chain = s.score = s.window = 0; speed = 0;
  }
  b.x = f32(b.x); b.y = f32(b.y); b.z = f32(b.z);
  b.vx = f32(speed*fx); b.vz = f32(speed*fz); b.vy = f32(b.vy);
  b.vehicleYaw = f32(yaw % TAU); b.yaw = Math.round(yaw*YAW_UNITS/TAU) & 65535;
  const lean = -b.steering*Math.min(.45, speed*.055);
  b.vehicleRoll = f32(b.vehicleRoll + (floorRoll + lean - b.vehicleRoll)*.4);
  b.vehiclePitch = f32(b.vehiclePitch + (floorPitch - b.vehiclePitch)*.4);
  deckFrame.yaw = yaw; deckFrame.pitch = b.vehiclePitch; deckFrame.roll = b.vehicleRoll;
  vehicleRotation(deckFrame, deckRotation);
  b.vehicleQx = f32(deckRotation[0]!); b.vehicleQy = f32(deckRotation[1]!);
  b.vehicleQz = f32(deckRotation[2]!); b.vehicleQw = f32(deckRotation[3]!);
  // The existing observer wheel phase carries the deck's visual rotation or the push cycle.
  b.wheelAngle = f32(TAU * (s.move === PUSH ? s.ticks/PUSH_TICKS : Math.min(1, s.ticks/TRICK_TICKS)));
  if (!pilot) b.skate = null;
}
