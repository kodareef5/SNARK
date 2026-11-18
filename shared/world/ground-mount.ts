// A ground creature's footing, shared by posed bones, saddle attachments and hit geometry.
import { detCos, detSin } from '../math/scalar.ts';
import { quatIdentity, quatNormalize } from '../math/quat.ts';
import type { MoveParams } from '../sim/character.ts';
import { nothingBuilt, type CollisionWorld } from './collide.ts';
import { builtSupport, supportGradient } from './ground-support.ts';
import { castWorld, HIT_NONE, HIT_TERRAIN, rayHit } from './ray.ts';

export class GroundMountFrame {
  /** Local tilt before the body's ordinary yaw. No yaw is applied twice. */
  readonly rotation = new Float64Array([0, 0, 0, 1]);
  lift = 0;
  nx = 0;
  ny = 1;
  nz = 0;
  supported = false;
}

/** One support ray, cheap terrain samples and the finite area of built faces. No state accumulates across replay. */
export function groundMountFrame(w: CollisionWorld, p: MoveParams, x: number, y: number, z: number, yaw: number, out: GroundMountFrame): void {
  quatIdentity(out.rotation, 0);
  out.lift = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.supported = false;
  const fadeHeight = Math.max(1, p.height), radius = Math.max(p.height, p.radius * 2);
  const kind = castWorld(w, x, y + .025, z, 0, -1, 0, fadeHeight + p.radius + .025, true);
  if (kind === HIT_NONE || rayHit.ny < p.slopeCos) return;
  const floor = y + .025 - rayHit.t, faceNy = rayHit.ny;
  const clearance = Math.max(0, y - floor - p.radius * (1 / faceNy - 1));
  if (clearance >= fadeHeight) return;
  const heightFraction = clearance / fadeHeight;
  let weight = 1 - heightFraction * heightFraction * (3 - 2 * heightFraction);
  // Terrain is continuous, so centred differences smooth its real creases. Flat built decks do not inherit the
  // slope underneath, and two flat levels never manufacture a sloping support across their vertical step.
  let gx = 0, gz = 0;
  if (kind === HIT_TERRAIN) {
    gx = (w.hf.heightAt(x + radius, z) - w.hf.heightAt(x - radius, z)) / (2 * radius);
    gz = (w.hf.heightAt(x, z + radius) - w.hf.heightAt(x, z - radius)) / (2 * radius);
  }
  supportGradient.x = supportGradient.z = supportGradient.area = 0;
  builtSupport(w.structs, x, floor, z, radius, p.slopeCos, Math.max(1.5, p.height));
  if (w.nodes) builtSupport(w.nodes, x, floor, z, radius, p.slopeCos, Math.max(1.5, p.height));
  const footprint = 4 * radius * radius, covered = Math.min(footprint, supportGradient.area);
  const divisor = Math.max(footprint, supportGradient.area);
  gx = (gx * (footprint - covered) + supportGradient.x) / divisor;
  gz = (gz * (footprint - covered) + supportGradient.z) / divisor;
  const length = Math.sqrt(1 + gx * gx + gz * gz);
  if (1 / length < p.slopeCos) return;
  let nx = -gx / length, nz = -gz / length;
  const side = Math.sqrt(nx * nx + nz * nz), upper = p.height + 2;
  // The rider shares the frame. Limit the added lean before its upper body can extend the upright capsule through
  // a nearby solid. This is a sampled upper envelope, not an extra collision or a translation of either body.
  if (side > 1e-5 && !nothingBuilt(w, x, z, p.radius + upper * side, y + p.radius, y + upper)) {
    const dx = nx / side, dz = nz / side, reach = p.radius + upper * side + .03;
    for (let k = 0; k < 3; k++) {
      const at = y + p.radius + (upper - p.radius) * k / 2;
      if (castWorld(w, x, at, z, dx, 0, dz, reach, true) !== HIT_NONE) {
        weight = Math.min(weight, Math.max(0, (rayHit.t - p.radius - .03) / (upper * side)));
      }
    }
  }
  nx *= weight; nz *= weight;
  out.nx = nx; out.nz = nz; out.ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
  out.lift = Math.max(floor - y, -p.radius * (1 / out.ny - 1));
  out.supported = true;
  if (nx === 0 && nz === 0) { out.nx = out.nz = 0; return; }
  const cs = detCos(yaw), sn = detSin(yaw);
  const localX = cs * nx - sn * nz, localZ = sn * nx + cs * nz;
  out.rotation[0] = localZ; out.rotation[1] = 0; out.rotation[2] = -localX; out.rotation[3] = 1 + out.ny;
  quatNormalize(out.rotation, 0);
}
