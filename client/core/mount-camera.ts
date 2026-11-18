import type { CollisionWorld } from "../../shared/world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../../shared/world/ray.ts";
import { MODE_WALK, type MoveParams } from "../../shared/sim/character.ts";
import { GroundMountFrame, groundMountFrame } from "../../shared/world/ground-mount.ts";

const footing = new GroundMountFrame();
/** The chase target follows the supported body height, while its horizon and safe capsule-centred boom stay upright. */
export function groundMountCameraHeight(world: CollisionWorld, move: MoveParams, x: number, y: number, z: number, yaw: number, mode: number, up: number): number {
  if (mode !== MODE_WALK || move.flies) return y + up;
  groundMountFrame(world, move, x, y, z, yaw, footing);
  return y + footing.lift + up * footing.ny;
}

/** A permitted clipping rider must not start its chase boom above a roof. Cast upward from inside its mount's capsule. */
export function mountCameraHeight(world: CollisionWorld | null, x: number, z: number, safeY: number, wantedY: number): number {
  const rise = wantedY - safeY;
  if (!world || rise <= 0) return wantedY;
  if (castWorld(world, x, safeY, z, 0, 1, 0, rise + .3) === HIT_NONE) return wantedY;
  return safeY + Math.max(0, Math.min(rise, rayHit.t - .3));
}

/** One chase view's pivot. Look ahead before entering a roof; current collision clearance remains a hard limit. */
export class MountCameraPivot {
  private host = -1;
  private x = 0;
  private y = 0;
  private z = 0;
  private lift = 0;
  vx = 0;
  vz = 0;
  safeY = 0;
  wantedY = 0;

  reset(): void { this.host = -1; }

  height(world: CollisionWorld | null, host: number, x: number, z: number, safeY: number, wantedY: number, vx: number | undefined, vz: number | undefined, dtMs: number): number {
    const reset = this.host !== host || Math.hypot(x - this.x, safeY - this.y, z - this.z) > 10;
    const seconds = Math.max(0, Math.min(100, dtMs)) / 1000;
    this.vx = vx ?? (!reset && seconds > 0 ? (x - this.x) / seconds : 0);
    this.vz = vz ?? (!reset && seconds > 0 ? (z - this.z) / seconds : 0);
    this.host = host; this.x = x; this.y = safeY; this.z = z;
    this.safeY = safeY; this.wantedY = wantedY;
    const current = mountCameraHeight(world, x, z, safeY, wantedY) - safeY;
    let wanted = current;
    const speed = Math.hypot(this.vx, this.vz), ahead = Math.min(.75, 6 / Math.max(1, speed));
    const samples = Math.max(1, Math.ceil(speed * ahead / .15));
    if (world && speed > .01) for (let k = 1; k <= samples; k++) wanted = Math.min(wanted, mountCameraHeight(world, x + this.vx * ahead * k / samples, z + this.vz * ahead * k / samples, safeY, wantedY) - safeY);
    if (reset) this.lift = wanted;
    else this.lift += (wanted - this.lift) * (1 - Math.exp(-seconds / (wanted < this.lift ? .08 : .3)));
    this.lift = Math.min(current, this.lift);
    return safeY + this.lift;
  }
}
