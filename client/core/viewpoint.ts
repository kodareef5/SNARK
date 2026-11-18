// Places the camera at the eye, over the right shoulder in third person, or round the body in the orbit (orbit.ts), pulled
// in when something solid is in the way.
// The body always aims from its own eye, so the view cannot move a shot and the server never learns which view is used.

import { capsuleFree, type CollisionWorld } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld, rayHit } from "../../shared/world/ray.ts";
import type { Camera } from "./render/camera.ts";
import type { CameraBody } from "./camera-body.ts";
import { CompactSaddleView } from "./camera-saddle.ts";
import { clearCameraContact, roofEnvelope } from "./camera-roof.ts";
import { quatRotate } from "../../shared/math/quat.ts";
import { vehicleRotation, type VehicleFrame } from "../../shared/sim/vehicle-frame.ts";
import { mountCameraHeight } from "./mount-camera.ts";
import type { OrbitRig } from "./orbit.ts";

const rotation = new Float64Array(4), forward = new Float64Array(3), up = new Float64Array(3);

/** Full aircraft attitude composed with mouse look in the cabin's own frame. */
function cockpitOrientation(frame: VehicleFrame, yaw: number, pitch: number, out: { yaw: number; pitch: number; roll?: number }): void {
  vehicleRotation(frame, rotation);
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  quatRotate(rotation, 0, sy * cp, sp, cy * cp, forward, 0);
  quatRotate(rotation, 0, -sy * sp, cp, -cy * sp, up, 0);
  out.yaw = Math.atan2(forward[0]!, forward[2]!);
  out.pitch = Math.atan2(forward[1]!, Math.hypot(forward[0]!, forward[2]!));
  const wy = out.yaw, wp = out.pitch;
  const right = -Math.cos(wy) * up[0]! + Math.sin(wy) * up[2]!;
  const upright = -Math.sin(wy) * Math.sin(wp) * up[0]! + Math.cos(wp) * up[1]! - Math.cos(wy) * Math.sin(wp) * up[2]!;
  if ("roll" in out) out.roll = Math.atan2(right, upright);
}

/** Cockpit mouse offsets and the independent chase bearing survive view switches. Flight controls never read them. */
export class CockpitLook {
  active = false;
  yaw = 0;
  pitch = 0;
  private host = -1;
  private chaseYaw = 0;
  private chasePitch = 0;

  sync(host: number, inside: boolean, look: { yaw: number; pitch: number }, frame?: VehicleFrame): void {
    const changed = host !== this.host;
    const active = host >= 0 && inside && frame !== undefined;
    if (this.active && !active && !changed) { look.yaw = this.chaseYaw; look.pitch = this.chasePitch; }
    if (changed) { this.yaw = this.pitch = 0; this.host = host; }
    if (active && (!this.active || changed)) { this.chaseYaw = look.yaw; this.chasePitch = look.pitch; }
    this.active = active;
    if (active) cockpitOrientation(frame!, this.yaw, this.pitch, look);
  }

  look(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + pitch));
  }
}

/** Metres behind, beside and above the eye. */
const BACK = 3.4;
const SIDE = 0.55;
const RISE = 0.25;
/** Metres from the eye the orbit sits before the wheel moves it: third person's, so a start from there only centres it. */
export const ORBIT_BACK = BACK;
/** Metres a chase camera's boom holds it back at rest where the caller gives no length. */
export const CHASE_BOOM = 6;
/** Gap kept between the camera and the obstacle, so the near plane does not cut into a wall. */
const CLEAR = 0.3;
/** Preserve useful world depth precision in a squeezed orbit, even at maximum FOV on an ultrawide screen. */
const MIN_MOUNT_NEAR = .05;
/** Milliseconds the camera takes to go from one view to the next, and the furthest (metres) it eases rather than cuts. */
export const EASE_MS = 350;
const EASE_REACH = 15;
/** Radians a chase camera looks below the look it is given, and the least and most pitch it shows. */
export const CHASE_TILT = .12;
export const CHASE_DOWN = -1.35;
export const CHASE_UP = 1.15;

/** The pitch a chase camera shows for the look pitch `pitch`. */
export function chasePitch(pitch: number): number { return Math.max(CHASE_DOWN, Math.min(CHASE_UP, pitch - CHASE_TILT)); }
/** The vehicle's own motion, and how far back (metres) the boom holds the camera at rest: its size's, not one number for all. */
export interface VehicleCameraMotion { vx: number; vy: number; vz: number; id?: number; boom?: number; anticipate?: boolean; safeY?: number; wantedY?: number }

export class Viewpoint {
  thirdPerson = false;
  private vehicleLook = false;
  private lastYaw = 0;
  private lastPitch = 0;
  private lookIdle = 0;
  private vehicleId = -1;
  private readonly target = new Float64Array(3);
  private readonly targetVelocity = new Float64Array(3);
  private readonly lead = new Float64Array(3);
  private boom = 6;
  private clearReach = 0;
  private returningFromCrest = false;
  private readonly shoulder = new CompactSaddleView();
  /** Where the camera was last placed, and while easing, where the ease began and the milliseconds it has left. */
  private placed = false;
  private readonly last = new Float64Array(3);
  private readonly easeFrom = new Float64Array(3);
  private easing = 0;
  /** Where the camera last looked, and while an ease also turns it (turn()), the bearing that turn began from. */
  private lastYawShown = 0;
  private lastPitchShown = 0;
  private turnNext = false;
  private turning = false;
  private turnYaw = 0;
  private turnPitch = 0;
  private readonly mine: OrbitRig = { yaw: 0, pitch: 0, back: 0, side: 0, rise: 0 };

  /** A centred chase view. Mouse look wins; only a moving driver's idle view gently follows the car. Returns look yaw. */
  placeVehicle(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number, heading: number, speed: number, dt: number, follow = true, motion?: VehicleCameraMotion, body?: CameraBody | null): number {
    if (!body?.rig || !body.solved) body = null;
    // The sphere contains the entire near rectangle, including wide aspect ratios and FOV changes.
    cam.nearLimit = Infinity;
    const half = body ? cam.near * Math.tan(cam.fovY / 2) : 0;
    let padding = body ? Math.hypot(cam.near, half, half * cam.aspect) + .02 : 0;
    // Keep the authored focus as the minimum when an attacking head lowers.
    const floor = body ? Math.max(ey, body.top(padding)) : -Infinity;
    if (body) ey = Math.max(ey, floor);
    let lowRoof = false, highEdge = false, pinched = false;
    const elapsed = Math.max(0, Math.min(100, dt));
    const switched = !this.vehicleLook || (motion?.id ?? -1) !== this.vehicleId;
    const reset = switched || Math.hypot(ex - this.target[0]!, ey - this.target[1]!, ez - this.target[2]!) > 10;
    if (reset || Math.abs(angle(yaw - this.lastYaw)) > 0.00001 || Math.abs(pitch - this.lastPitch) > 0.00001) this.lookIdle = 0;
    else this.lookIdle += elapsed;
    if (follow && speed > 1 && this.lookIdle > 1200) yaw += angle(heading - yaw) * (1 - Math.exp(-elapsed / 1800));
    const orbit = Math.abs(angle(yaw - this.lastYaw)) + Math.abs(pitch - this.lastPitch);
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.vehicleLook = true;
    this.vehicleId = motion?.id ?? -1;
    const wanted = this.lead;
    wanted[0] = ex + Math.max(-1.8, Math.min(1.8, (motion?.vx ?? 0) * .1));
    wanted[1] = ey + Math.max(-.25, Math.min(.25, (motion?.vy ?? 0) * .035));
    wanted[2] = ez + Math.max(-1.8, Math.min(1.8, (motion?.vz ?? 0) * .1));
    const seconds = elapsed / 1000;
    for (let i = 0; i < 3; i++) {
      if (reset) { this.target[i] = wanted[i]!; this.targetVelocity[i] = 0; continue; }
      // Exact critically damped spring: stable through variable frame times, with softer vertical suspension response.
      const omega = i === 1 ? 12 : 22, decay = Math.exp(-omega * seconds);
      const offset = this.target[i]! - wanted[i]!, change = (this.targetVelocity[i]! + omega * offset) * seconds;
      this.target[i] = wanted[i]! + (offset + change) * decay;
      this.targetVelocity[i] = (this.targetVelocity[i]! - omega * change) * decay;
    }
    const rest = motion?.boom ?? CHASE_BOOM, back = rest + Math.min(rest / 3, Math.abs(speed) * .06);
    this.boom = reset ? back : this.boom + (back - this.boom) * (1 - Math.exp(-seconds * 4));
    const viewPitch = chasePitch(pitch);
    cam.yaw = yaw;
    cam.pitch = viewPitch;
    cam.roll = 0;
    let wantedX = this.target[0]! - Math.sin(yaw) * Math.cos(viewPitch) * this.boom;
    let wantedZ = this.target[2]! - Math.cos(yaw) * Math.cos(viewPitch) * this.boom;
    let wantedY = this.target[1]! - Math.sin(viewPitch) * this.boom + .65;
    if (body) wantedY = aboveFloor(wantedY, floor, .4 * body.size);
    if (body && world) {
      const baseY = body.y + .25 * body.size, band = .4 * body.size;
      // Low ramps and tables cannot choose an under-roof route. The mount needs standing headroom along its route. A sloped
      // underside can guide the orbit when its low edge leaves room for the camera sphere.
      const minimum = Math.max(body.y + body.standingHeight, baseY + 2 * padding + .02);
      const backX = -Math.sin(yaw), backZ = -Math.cos(yaw);
      const rear = (wantedX - body.x) * backX + (wantedZ - body.z) * backZ;
      const extend = Math.max(0, body.horizontalExtent + padding + .02 - rear);
      const farX = wantedX + extend * backX, farZ = wantedZ + extend * backZ;
      const swingBand = Math.max(band, 1.5 * extend);
      const routeHeight = Math.max(ey, wantedY, floor + 1.5 * extend);
      const near = cam.near, radiusPerMetre = (padding - .02) / near;
      const minimumPadding = Math.min(padding, MIN_MOUNT_NEAR * radiusPerMetre + .02);
      const route = roofEnvelope(world, body.x, body.z, farX, farZ, baseY, routeHeight, padding, minimum, band,
        minimumPadding, baseY - body.y, ex, ez);
      let crest = route.crest, roof = route.ceiling;
      let clearance = route.padding;
      if (Number.isFinite(crest) && roof < crest + band) {
        // A second ceiling may leave a narrow passage over the crest. Share the available headroom between both sides.
        const saved = Math.min(padding - minimumPadding, (crest + band - roof) / 2);
        clearance = Math.min(clearance, padding - saved);
        crest -= saved; roof += route.padding - clearance;
      }
      if (clearance < padding) {
        padding = clearance;
        cam.nearLimit = (padding - .02) / radiusPerMetre;
      }
      pinched = Number.isFinite(crest);
      if (pinched) {
        const px = ex + route.shiftX, pz = ez + route.shiftZ, py = Math.min(roof, aboveFloor(ey, crest, band));
        // The pitched part may meet another wall or a ceiling. The route must actually exit sideways and then rise.
        const exitY = baseY + world.hf.heightAt(px, pz) - world.hf.heightAt(body.x, body.z);
        const dx = px - body.x, dy = exitY - baseY, dz = pz - body.z, length = Math.hypot(dx, dy, dz);
        if ((length < 1e-6 || castWorld(world, body.x, baseY, body.z, dx / length, dy / length, dz / length, length) === HIT_NONE) &&
          castWorld(world, px, exitY, pz, 0, 1, 0, py - exitY + padding) === HIT_NONE && roof >= crest) {
          ex = px; ez = pz; ey = py;
          wantedY = aboveFloor(wantedY, crest, band);
          highEdge = true;
        }
      }
      if (extend > 0 && roof < floor + swingBand) {
        const t = Math.min(1, (floor + swingBand - roof) / swingBand);
        const out = extend * t * t * (3 - 2 * t);
        wantedX += out * backX; wantedZ += out * backZ;
      }
      // Enable the roof route throughout the soft-min band, before its anchor can enter the padded animal.
      lowRoof = roof < Math.max(ey, wantedY) + band;
      if (Number.isFinite(roof)) {
        const lower = highEdge ? crest : -Infinity;
        ey = Math.max(lower, -aboveFloor(-ey, -roof, band));
        wantedY = Math.max(lower, -aboveFloor(-wantedY, -roof, band));
      }
    }
    if (body && world && !highEdge) {
      // A tall authored focus can already be beyond a ceiling before pose avoidance adds any lift. Start inside the
      // mount's ordinary collision body, just above its grounded origin, and retain the world-valid part of that path.
      const baseY = body.y + .25 * body.size, dx = ex - body.x, dy = ey - baseY, dz = ez - body.z;
      const length = Math.hypot(dx, dy, dz);
      if (length > 1e-6 && castWorld(world, body.x, baseY, body.z, dx / length, dy / length, dz / length, length + padding) !== HIT_NONE) {
        const k = Math.min(1, Math.max(0, rayHit.t - padding) / length);
        ex = body.x + dx * k; ey = baseY + dy * k; ez = body.z + dz * k;
        // Partly low sloping faces retain the old horizontal fallback when their safe high-side passage cannot
        // use the complete-face anticipation above. Raising the far endpoint again would cut through that roof.
        if (k < 1 && !lowRoof) wantedY = ey;
        lowRoof ||= k < 1;
      }
    }
    // Preserve the legacy arithmetic for mounts and vehicles which do not opt into the posed-body route.
    const dx = body ? wantedX - ex : this.target[0]! - ex - Math.sin(yaw) * Math.cos(viewPitch) * this.boom;
    const dy = body ? wantedY - ey : this.target[1]! - ey - Math.sin(viewPitch) * this.boom + .65;
    const dz = body ? wantedZ - ez : this.target[2]! - ez - Math.cos(yaw) * Math.cos(viewPitch) * this.boom;
    const length = Math.hypot(dx, dy, dz);
    let reach = length;
    if (world && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) reach = Math.max(0, rayHit.t - CLEAR);
    if (body && length > 1e-6) {
      const hit = body.cast(ex, ey, ez, dx / length, dy / length, dz / length, length, padding);
      // The roof fallback may begin inside the padded envelope, though outside the skin. Its endpoint must still be
      // outside the whole padded body. It cuts there: an interpolated path through the plate is not a valid camera.
      const k = reach / length;
      const outside = lowRoof && body.cast(ex + dx * k, ey + dy * k, ez + dz * k, 0, 1, 0, .001, padding) > 0;
      if (!outside) reach = Math.min(reach, Math.max(0, hit - .001));
    } else if (!body && motion?.anticipate) {
      let wantedReach = reach;
      // Retract before the pivot starts descending: sharing its shorter horizon makes both moves start
      // together and a reversing rider's camera can reach the roof before the boom has shortened.
      const speed = Math.hypot(motion.vx, motion.vz), ahead = Math.min(1.5, 12 / Math.max(1, speed));
      // A roof edge becomes visible to the future boom before the rider crosses it. Retract while the route is clear.
      const samples = Math.max(1, Math.ceil(speed * ahead / .15));
      if (world && speed > .01) for (let k = 1; k <= samples; k++) {
        const step = ahead * k / samples, x = ex + motion.vx * step, z = ez + motion.vz * step;
        const futureY = mountCameraHeight(world, x, z, motion.safeY ?? ey, motion.wantedY ?? ey);
        // The pivot can descend before the mount enters a roof. Test both the current and lowered boom
        // so a camera ahead of a reversing mount retracts before its pivot descends.
        if (castWorld(world, x, ey, z, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) wantedReach = Math.min(wantedReach, Math.max(0, rayHit.t - CLEAR));
        if (futureY < ey && castWorld(world, x, futureY, z, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) wantedReach = Math.min(wantedReach, Math.max(0, rayHit.t - CLEAR));
      }
      if (reset) this.clearReach = wantedReach;
      else {
        const change = (wantedReach - this.clearReach) * (1 - Math.exp(-seconds / .18));
        this.clearReach += Math.max(-20 * seconds, Math.min(20 * seconds, change));
      }
      // Sudden new geometry still wins over easing; never smooth through a solid obstacle.
      this.clearReach = Math.min(reach, this.clearReach);
      reach = this.clearReach;
    }
    const k = reach / length;
    cam.x = ex + dx * k;
    cam.y = ey + dy * k;
    cam.z = ez + dz * k;
    if (lowRoof || highEdge) this.easing = 0;
    const previousX = this.last[0]!, previousY = this.last[1]!, previousZ = this.last[2]!;
    this.ease(cam, world, ex, ey, ez, switched && !lowRoof && !highEdge, elapsed, body, padding);
    if (body && world) {
      clearCameraContact(world, cam, body, ex, ey, ez, wantedX, wantedY, wantedZ, padding);
      const compact = highEdge && this.shoulder.place(cam, world, body, padding, reset);
      if (!compact) this.shoulder.clear();
      if (pinched || this.returningFromCrest && !reset) {
        const travel = reset ? Infinity : (6 + Math.abs(speed)) * seconds + Math.min(2 * seconds, (2 + this.boom) * orbit);
        this.returningFromCrest = this.clearCrest(cam, world, body, previousX, previousY, previousZ, padding, travel, highEdge && !compact, ex, ey, ez, compact);
      } else this.returningFromCrest = false;
      this.last[0] = cam.x; this.last[1] = cam.y; this.last[2] = cam.z;
    } else this.returningFromCrest = false;
    return yaw;
  }

  /** When the edge is enclosed, move toward the requested orbit through available space. The survivor still controls look. */
  private clearCrest(cam: Camera, world: CollisionWorld, body: CameraBody, x: number, y: number, z: number, radius: number, travel: number, highEdge: boolean, ex: number, ey: number, ez: number, compact: boolean): boolean {
    const tx = cam.x, ty = cam.y, tz = cam.z, dx = tx - x, dy = ty - y, dz = tz - z;
    const distance = Math.hypot(dx, dy, dz), t = distance <= travel ? 1 : travel / distance;
    const ratio = (radius - .02) / cam.near, smallest = Math.min(radius, MIN_MOUNT_NEAR * ratio + .02);
    const fits = (cx: number, cy: number, cz: number, r: number) =>
      body.cast(cx, cy, cz, 0, 1, 0, .001, r + .25 * body.size) > 0 && capsuleFree(world, cx, cy - r, cz, r, 2 * r);
    const place = (cx: number, cy: number, cz: number, reserve = .05 * body.size): boolean => {
      const ox = Number.isFinite(travel) ? x : tx, oy = Number.isFinite(travel) ? y : ty, oz = Number.isFinite(travel) ? z : tz;
      const sx = cx - ox, sy = cy - oy, sz = cz - oz, step = Math.hypot(sx, sy, sz);
      if (step > smallest && castWorld(world, ox, oy, oz, sx / step, sy / step, sz / step, step) !== HIT_NONE) return false;
      if (!fits(cx, cy, cz, radius)) {
        if (!fits(cx, cy, cz, smallest + reserve)) return false;
        let lo = smallest, hi = radius;
        for (let i = 0; i < 5; i++) {
          const mid = (lo + hi) / 2;
          if (fits(cx, cy, cz, mid)) lo = mid;
          else hi = mid;
        }
        cam.nearLimit = (lo - .02) / ratio;
      }
      cam.x = cx; cam.y = cy; cam.z = cz;
      return true;
    };
    // When streaming geometry or entering from below, go through the same open edge as the boom rather than
    // stopping on the underside between the preceding camera and its requested position.
    if (highEdge && distance > travel && castWorld(world, x, y, z, dx / distance, dy / distance, dz / distance, distance) !== HIT_NONE) {
      const px = ex - x, py = ey - y, pz = ez - z, diagonal = Math.hypot(px, py, pz), horizontal = Math.hypot(px, pz);
      if (diagonal > 1e-6) {
        const k = Math.min(1, travel / diagonal);
        if (place(x + k * px, y + k * py, z + k * pz)) return true;
      }
      if (horizontal > 1e-6) {
        const k = Math.min(1, travel / horizontal);
        if (place(x + k * px, y, z + k * pz)) return true;
      }
    }
    // Convex obstacles can admit the vertical or tangential part of a step even when the diagonal is blocked.
    if (place(x + t * dx, y + t * dy, z + t * dz)) return t < 1;
    if (Number.isFinite(travel)) {
      if (compact && distance > travel) {
        const sideX = Math.cos(cam.yaw), sideZ = -Math.sin(cam.yaw);
        const side = (tx - body.x) * sideX + (tz - body.z) * sideZ < 0 ? -1 : 1;
        const turnX = tx + side * sideX * (radius + 1.1 * body.size), turnZ = tz + side * sideZ * (radius + 1.1 * body.size);
        const hx = turnX - x, hz = turnZ - z, run = Math.hypot(hx, hz);
        if (run > .05) {
          const k = Math.min(1, travel / run);
          if (place(x + k * hx, y, z + k * hz)) return true;
          if (place(x + side * sideX * travel, y, z + side * sideZ * travel)) return true;
        }
      }
      if (place(x + t * dx, y, z + t * dz) || place(x, y + t * dy, z) || fits(x, y, z, radius) && place(x, y, z)) return true;
      // An advancing plate or horn may overtake the previous camera. Try the nearest free direction first.
      for (let ring = 0; ring < 5; ring++) {
        const step = Math.max(.02, Math.min(travel, .1 * body.size)) * (1 << Math.max(0, ring - 1));
        const reserve = ring === 1 ? 0 : .05 * body.size;
        if (place(x, y + step, z, reserve) || place(x, y - step, z, reserve)) return true;
        for (let i = 0; i < 8; i++) {
          const angle = cam.yaw + i * Math.PI / 4, sx = Math.sin(angle) * step, sz = Math.cos(angle) * step;
          if (place(x + sx, y, z + sz, reserve) ||
            place(x + sx * Math.SQRT1_2, y + step * Math.SQRT1_2, z + sz * Math.SQRT1_2, reserve) ||
            place(x + sx * Math.SQRT1_2, y - step * Math.SQRT1_2, z + sz * Math.SQRT1_2, reserve)) return true;
        }
      }
    }
    // On entry, or if the moving animal overtakes the last camera, look for a clear point near this orbit.
    for (let i = 1; i <= 8; i++) {
      const shift = i * smallest;
      if (place(tx, ty + shift, tz) || place(tx, ty - shift, tz)) return true;
    }
    cam.nearLimit = (smallest - .02) / ratio;
    if (Number.isFinite(travel) && fits(x, y, z, smallest)) {
      cam.x = x; cam.y = y; cam.z = z;
    }
    return true;
  }

  /**
   * The eye is at (ex, ey, ez). `yaw` and `pitch` are radians. Coming from a chase view (getting off or out), the camera
   * eases over `dt` ms from where it was.
   */
  place(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, yaw: number, pitch: number, dt = 0): void {
    this.placeRig(cam, world, ex, ey, ez, this.own(this.mine, yaw, pitch), dt);
  }

  /** As place, with the camera where `rig` puts it about the pivot (ex, ey, ez): the orbit's. */
  placeRig(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, rig: OrbitRig, dt = 0): void {
    cam.nearLimit = Infinity;
    const switched = this.vehicleLook;
    this.vehicleLook = false;
    this.put(cam, world, ex, ey, ez, rig);
    this.ease(cam, world, ex, ey, ez, switched, Math.max(0, Math.min(100, dt)));
  }

  /** Fills `out` with the eye's own view looking at `yaw` and `pitch`: at the eye, or over the shoulder in third person. */
  own(out: OrbitRig, yaw: number, pitch: number): OrbitRig {
    const third = this.thirdPerson;
    out.yaw = yaw;
    out.pitch = pitch;
    out.back = third ? BACK : 0;
    out.side = third ? SIDE : 0;
    out.rise = third ? RISE : 0;
    return out;
  }

  /** The next ease between views also turns the camera from where it last looked, which a cut orbit leaves elsewhere. */
  turn(): void { this.turnNext = true; }

  /** An enclosed eye stays in its seat even during a loop; it never eases through the cabin wall from chase view. */
  placeCockpit(cam: Camera, ex: number, ey: number, ez: number, frame: VehicleFrame, yaw: number, pitch: number): void {
    cam.nearLimit = Infinity;
    this.vehicleLook = false;
    this.easing = 0;
    cam.x = ex; cam.y = ey; cam.z = ez;
    cockpitOrientation(frame, yaw, pitch, cam);
    this.ease(cam, null, ex, ey, ez, false, 0);
  }

  /**
   * After a change between the eye's view and a chase view, or between hosts, the camera goes from where it was to where
   * it is placed over EASE_MS rather than at once, and is kept on the near side of anything solid on the way.
   */
  private ease(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, switched: boolean, dt: number, body?: CameraBody | null, padding = 0): void {
    const from = this.easeFrom;
    if (switched && this.placed && Math.hypot(cam.x - this.last[0]!, cam.y - this.last[1]!, cam.z - this.last[2]!) < EASE_REACH) {
      this.easing = EASE_MS;
      from.set(this.last);
      this.turning = this.turnNext;
      this.turnYaw = this.lastYawShown;
      this.turnPitch = this.lastPitchShown;
    }
    this.turnNext = false;
    if (this.easing > 0) {
      this.easing = Math.max(0, this.easing - dt);
      const t = 1 - this.easing / EASE_MS, s = t * t * (3 - 2 * t);
      if (this.turning) {
        cam.yaw = this.turnYaw + angle(cam.yaw - this.turnYaw) * s;
        cam.pitch = this.turnPitch + (cam.pitch - this.turnPitch) * s;
      }
      let dx = from[0]! + (cam.x - from[0]!) * s - ex, dy = from[1]! + (cam.y - from[1]!) * s - ey, dz = from[2]! + (cam.z - from[2]!) * s - ez;
      const length = Math.hypot(dx, dy, dz);
      let reach = length;
      if (world && length > 1e-6 && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) {
        reach = Math.max(0, rayHit.t - CLEAR);
      }
      if (body && length > 1e-6) reach = Math.min(reach, Math.max(0, body.cast(ex, ey, ez, dx / length, dy / length, dz / length, length, padding) - .001));
      if (length > 1e-6 && reach < length) { const k = reach / length; dx *= k; dy *= k; dz *= k; }
      cam.x = ex + dx;
      cam.y = ey + dy;
      cam.z = ez + dz;
    } else this.turning = false;
    this.last[0] = cam.x;
    this.last[1] = cam.y;
    this.last[2] = cam.z;
    this.lastYawShown = cam.yaw;
    this.lastPitchShown = cam.pitch;
    this.placed = true;
  }

  private put(cam: Camera, world: CollisionWorld | null, ex: number, ey: number, ez: number, rig: OrbitRig): void {
    const { yaw, pitch, back, side, rise } = rig;
    cam.yaw = yaw;
    cam.pitch = pitch;
    cam.roll = 0;
    cam.x = ex;
    cam.y = ey;
    cam.z = ez;
    if (back === 0 && side === 0 && rise === 0) return;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    // The offset from the eye: back along the view, to the right, and up.
    const dx = -sy * cp * back - cy * side;
    const dy = -sp * back + rise;
    const dz = -cy * cp * back + sy * side;
    const length = Math.hypot(dx, dy, dz);
    let reach = length;
    if (world && castWorld(world, ex, ey, ez, dx / length, dy / length, dz / length, length + CLEAR) !== HIT_NONE) reach = Math.max(0, rayHit.t - CLEAR);
    const k = reach / length;
    cam.x = ex + dx * k;
    cam.y = ey + dy * k;
    cam.z = ez + dz * k;
  }
}

function angle(n: number): number { return Math.atan2(Math.sin(n), Math.cos(n)); }

/** C1 transition to a lower bound; unlike a spring it never spends a frame below the collision envelope. */
function aboveFloor(y: number, floor: number, band: number): number {
  if (y >= floor + band) return y;
  if (y <= floor - band) return floor;
  const t = (y - floor + band) / (2 * band);
  return floor + band * t * t;
}
