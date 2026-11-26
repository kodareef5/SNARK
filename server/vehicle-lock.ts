// What a vehicle's missile seeker sees (planning/workstreams/jet.md): any vehicle, any creature ridden or flying, and any
// lockable craft in the sky (server/sky.ts), within a cone about the nose and a range, with nothing of the world between.
// The one nearest the nose's line is chosen. It walks only the chunks the cone can reach, and casts the world only for
// the best few, so a crowded world costs it what is in front of the nose.

import { CHUNK_SIZE } from "../shared/coords.ts";
import type { Registry } from "../shared/content/registry.ts";
import { MODE_FLYER } from "../shared/sim/character.ts";
import { F_ALIVE, F_PROP, type EntityStore } from "../shared/sim/entities.ts";
import type { CollisionWorld } from "../shared/world/collide.ts";
import { castWorld, HIT_NONE, rayHit } from "../shared/world/ray.ts";
import type { Sky, SkyPoint, SkyTarget } from "./sky.ts";

export interface LockWorld extends CollisionWorld {
  readonly ents: EntityStore;
  readonly reg: Registry;
  readonly dims: { readonly chunksX: number; readonly chunksZ: number };
}

/** What a scan found: an entity index and its generation, or a sky target, and its middle. Entity -1 and sky null for none. */
export interface LockPick {
  entity: number;
  gen: number;
  sky: SkyTarget | null;
  x: number;
  y: number;
  z: number;
  /** Radians off the nose's line. */
  angle: number;
}

/** What the last scan did: the chunks it looked in and passed over, the bodies it weighed, and the world casts it made. */
export const lockScan = { chunks: 0, culled: 0, weighed: 0, casts: 0 };

/** Where a lockable entity's middle is: half its body up from its feet. */
export function lockMiddle(w: LockWorld, i: number, out: { x: number; y: number; z: number }): void {
  out.x = w.ents.x[i]!; out.y = w.ents.y[i]! + w.reg.bodyHeight[w.ents.kind[i]!]! / 2; out.z = w.ents.z[i]!;
}

/** Whether entity `i` is one a missile may lock: a live vehicle that is no wreck, or a creature ridden or in flight. */
export function lockable(w: LockWorld, i: number): boolean {
  const ents = w.ents, f = ents.flags[i]!;
  if ((f & F_ALIVE) === 0 || (f & F_PROP) !== 0) return false;
  return !!w.reg.vehicle[ents.kind[i]!] || ents.driven[i] !== 0 || ents.mode[i] === MODE_FLYER;
}

/** Whether nothing of the world stands between (ox, oy, oz) and (x, y, z). */
export function clearLine(w: CollisionWorld, ox: number, oy: number, oz: number, x: number, y: number, z: number): boolean {
  const dx = x - ox, dy = y - oy, dz = z - oz, far = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (far < 1e-3) return true;
  lockScan.casts++;
  return castWorld(w, ox, oy, oz, dx / far, dy / far, dz / far, far) === HIT_NONE || rayHit.t >= far - .5;
}

const point: SkyPoint = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const middle = { x: 0, y: 0, z: 0 };
/** Bodies in the cone, by the cosine of their angle off the nose, for the world casts to try best first. */
const MAX_WEIGHED = 256;
const weighedEntity = new Int32Array(MAX_WEIGHED), weighedCos = new Float64Array(MAX_WEIGHED);
/** A chunk's half diagonal: a column of it is met as a circle this wide. */
const CHUNK_REACH = CHUNK_SIZE * Math.SQRT1_2;

/** How far a cone of half angle `cone` and length `range` reaches from its apex along an axis its unit way has `di` of. */
function reach(di: number, cone: number, range: number): number {
  // The unit vector nearest the axis within the cone: the axis's angle to it, less the cone.
  const off = Math.acos(Math.max(-1, Math.min(1, di))) - cone;
  return off <= 0 ? range : off >= Math.PI / 2 ? 0 : range * Math.cos(off);
}

/**
 * The best lock from (ox, oy, oz) along the unit (dx, dy, dz) within `cone` radians and `range` metres at tick `t`, into
 * `out`, skipping entities `skipA` and `skipB` (the shooter and what it rides). Returns whether there is one.
 */
export function scanLock(w: LockWorld, sky: Sky, t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cone: number, range: number, skipA: number, skipB: number, out: LockPick): boolean {
  const ents = w.ents, cosCone = Math.cos(cone), sinCone = Math.sin(cone);
  out.entity = -1; out.gen = 0; out.sky = null; out.angle = Infinity;
  lockScan.chunks = lockScan.culled = lockScan.weighed = lockScan.casts = 0;
  // The cone's box over the ground, and the chunks in it.
  const x0 = Math.max(0, Math.floor((ox - reach(-dx, cone, range)) / CHUNK_SIZE)), x1 = Math.min(w.dims.chunksX - 1, Math.floor((ox + reach(dx, cone, range)) / CHUNK_SIZE));
  const z0 = Math.max(0, Math.floor((oz - reach(-dz, cone, range)) / CHUNK_SIZE)), z1 = Math.min(w.dims.chunksZ - 1, Math.floor((oz + reach(dz, cone, range)) / CHUNK_SIZE));
  const range2 = range * range;
  let n = 0;
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    // A chunk's column is passed over where every point of it is off the cone: the line up its middle at its nearest to
    // the nose's line, widened by the chunk's half diagonal as seen from the apex.
    const hx = (cx + .5) * CHUNK_SIZE - ox, hz = (cz + .5) * CHUNK_SIZE - oz, flat = Math.sqrt(hx * hx + hz * hz);
    if (flat > CHUNK_REACH) {
      if (flat - CHUNK_REACH > range) { lockScan.culled++; continue; }
      const ahead = (hx * dx + hz * dz) / flat;
      const best = ahead > 0 ? Math.sqrt(ahead * ahead + dy * dy) : Math.abs(dy);
      const sinWide = CHUNK_REACH / flat, cosWide = Math.sqrt(1 - sinWide * sinWide);
      // Within the cone and the chunk's own width: cos(best angle) at least cos(cone + wide).
      if (best < cosCone * cosWide - sinCone * sinWide) { lockScan.culled++; continue; }
    }
    lockScan.chunks++;
    for (let i = ents.chunkHead[cz * w.dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
      if (i === skipA || i === skipB || !lockable(w, i)) continue;
      lockMiddle(w, i, middle);
      const rx = middle.x - ox, ry = middle.y - oy, rz = middle.z - oz, far2 = rx * rx + ry * ry + rz * rz;
      if (far2 > range2 || far2 < 1) continue;
      const along = (rx * dx + ry * dy + rz * dz) / Math.sqrt(far2);
      if (along < cosCone) continue;
      lockScan.weighed++;
      if (n < MAX_WEIGHED) { weighedEntity[n] = i; weighedCos[n] = along; n++; }
      else {
        // Full: the worst of those kept makes way.
        let worst = 0;
        for (let k = 1; k < n; k++) if (weighedCos[k]! < weighedCos[worst]!) worst = k;
        if (along > weighedCos[worst]!) { weighedEntity[worst] = i; weighedCos[worst] = along; }
      }
    }
  }
  // Best first, until one is in clear sight.
  while (n > 0) {
    let top = 0;
    for (let k = 1; k < n; k++) if (weighedCos[k]! > weighedCos[top]!) top = k;
    const i = weighedEntity[top]!, along = weighedCos[top]!;
    n--; weighedEntity[top] = weighedEntity[n]!; weighedCos[top] = weighedCos[n]!;
    lockMiddle(w, i, middle);
    if (!clearLine(w, ox, oy, oz, middle.x, middle.y, middle.z)) continue;
    out.entity = i; out.gen = ents.gen[i]!; out.angle = Math.acos(Math.min(1, along));
    out.x = middle.x; out.y = middle.y; out.z = middle.z;
    break;
  }
  for (const s of sky.targets) {
    if (!s.lockable || !s.at(t, point)) continue;
    const rx = point.x - ox, ry = point.y - oy, rz = point.z - oz, far = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (far > range || far < 1) continue;
    const along = (rx * dx + ry * dy + rz * dz) / far;
    if (along < cosCone) continue;
    const angle = Math.acos(Math.min(1, along));
    if (angle >= out.angle || !clearLine(w, ox, oy, oz, point.x, point.y, point.z)) continue;
    out.entity = -1; out.gen = 0; out.sky = s; out.angle = angle;
    out.x = point.x; out.y = point.y; out.z = point.z;
  }
  return out.entity >= 0 || out.sky !== null;
}
