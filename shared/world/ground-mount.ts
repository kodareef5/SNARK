// A ground creature's finite footing, shared by locomotion, posed bones, saddle attachments and hit geometry.
import { detCos, detSin } from '../math/scalar.ts';
import { quatIdentity, quatNormalize } from '../math/quat.ts';
import type { MoveParams } from '../sim/character.ts';
import type { CollisionWorld } from './collide.ts';
import { castWorld, HIT_NONE, rayHit } from './ray.ts';

export class GroundMountFrame {
  /** Local tilt before the body's ordinary yaw. No yaw is applied twice. */
  readonly rotation = new Float64Array([0, 0, 0, 1]);
  lift = 0;
  nx = 0;
  ny = 1;
  nz = 0;
  supported = false;
}
const heights = new Float64Array(5);

/** Five short solid rays follow the current floor, including a bridge above terrain. No state accumulates across replay. */
export function groundMountFrame(w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number, out: GroundMountFrame): void {
  quatIdentity(out.rotation, 0);
  out.lift = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.supported = false;
  const radius = p.radius * .75, rise = Math.min(p.height * .4, p.stepUp + p.radius * .5);
  const depth = rise + p.radius + p.stepDown, sn = detSin(yaw), cs = detCos(yaw);
  for (let sample = 0; sample < 5; sample++) {
    const side = sample === 1 ? radius : sample === 2 ? -radius : 0;
    const forward = sample === 3 ? radius : sample === 4 ? -radius : 0;
    const px = x + cs * side + sn * forward, pz = z + cs * forward - sn * side;
    heights[sample] = NaN;
    if (castWorld(w, px, y + rise, pz, 0, -1, 0, depth, true) === HIT_NONE || rayHit.ny < p.slopeCos) continue;
    const at = y + rise - rayHit.t;
    if (sample === 0) {
      // A roof above the current feet is not this body's support. Near an edge the capsule can overhang a lower floor.
      if (at > y + .025 || y - at > p.radius * .7 + .1) return;
      out.lift = at - y; out.nx = rayHit.nx; out.ny = rayHit.ny; out.nz = rayHit.nz; out.supported = true;
    }
    heights[sample] = at;
  }
  if (!out.supported) return;
  // Opposing real supports average a crest continuously over the body's footprint. A missing support never invents
  // a plane across a gap: in that case use the face directly beneath the body instead.
  if (heights.every(Number.isFinite)) {
    const dx = (heights[1]! - heights[2]!) / (2 * radius), dz = (heights[3]! - heights[4]!) / (2 * radius);
    const length = Math.sqrt(dx * dx + dz * dz + 1);
    if (1 / length >= p.slopeCos) {
      out.nx = -(cs * dx + sn * dz) / length;
      out.ny = 1 / length;
      out.nz = -(cs * dz - sn * dx) / length;
    }
  }
  const nx = cs * out.nx - sn * out.nz, nz = sn * out.nx + cs * out.nz;
  out.rotation[0] = nz; out.rotation[1] = 0; out.rotation[2] = -nx; out.rotation[3] = 1 + out.ny;
  quatNormalize(out.rotation, 0);
}
