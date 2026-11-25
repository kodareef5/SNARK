// Targets in the sky that are not bodies in the chunk lists: a map event's craft, which flies a path every client works
// out for itself and so is never an entity while it flies (planning/workstreams/map-events.md). A round, a flying round,
// a blast and a missile meet one analytically, by asking it where it was at the tick the shot is judged at. Its pose is
// a pure function of the tick, so the shooter's view tick is the rewind and no history is kept or widened.
//
// A craft is added here while it flies and taken away when it falls, so a world with nothing in the sky pays one length
// check a shot and a blast.

import type { Source } from "./combat.ts";
import type { EntityRecord } from "./records.ts";

/** Where a sky target is and how fast it goes, at a tick. */
export interface SkyPoint {
  x: number;
  y: number;
  z: number;
  /** Metres a second. */
  vx: number;
  vy: number;
  vz: number;
}

/** What a hit on a sky target did, for the shooter's hit marker. */
export interface SkyTaken {
  /** Health taken, after any shield. */
  taken: number;
  /** A shield stopped some or all of it. */
  blocked: boolean;
  /** This blow brought it down. */
  killed: boolean;
}

export interface SkyTarget {
  /** What it is called on a lock and in a line to the shooter: "Unidentified craft". */
  readonly name: string;
  /** Whether a missile may lock it. */
  readonly lockable: boolean;
  /** A sphere round its middle that holds the whole of it, in metres: the broad test. */
  readonly radius: number;
  /** Its middle and velocity at tick `t` (fractional ticks allowed) into `out`. False if it is not in the sky then. */
  at(t: number, out: SkyPoint): boolean;
  /** The distance along the unit ray from (ox, oy, oz) at which it meets the hull at tick `t`, within `maxT`, or Infinity. */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, t: number): number;
  /** The distance from (x, y, z) to its hull at tick `t`: 0 or less inside. */
  gap(x: number, y: number, z: number, t: number): number;
  /**
   * Takes `src` at `share` of its strength (a blast's fade, 1 for a round). `heavy` is a blast or a missile, which a
   * shield may yield to where a round does not.
   */
  take(src: Source, share: number, heavy: boolean, x: number, y: number, z: number): SkyTaken;
}

const NONE: SkyTaken = { taken: 0, blocked: false, killed: false };

export class Sky {
  /** In the order they were added. A list, since there is seldom more than one. */
  readonly targets: SkyTarget[] = [];
  /** Set by `ray`: the distance along it to the target it returned. */
  t = Infinity;
  /** Rounds and blasts that met a sky target since the server started. */
  hits = 0;
  /** Tells the shooter of a hit on a sky target, as a hit on a body is told (combat.ts). */
  marker: ((by: EntityRecord | null, x: number, y: number, z: number, taken: SkyTaken) => void) | null = null;
  private readonly point: SkyPoint = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  /** The targets a blast walks, copied first: a blow that brings one down takes it out of the list. */
  private readonly walking: SkyTarget[] = [];

  add(target: SkyTarget): void {
    if (!this.targets.includes(target)) this.targets.push(target);
  }

  remove(target: SkyTarget): void {
    const at = this.targets.indexOf(target);
    if (at >= 0) this.targets.splice(at, 1);
  }

  /** The nearest sky target the ray meets within `maxT` at tick `t`, with `this.t` its distance, or null. */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, t: number): SkyTarget | null {
    let best: SkyTarget | null = null;
    let bestT = maxT;
    const p = this.point;
    for (const s of this.targets) {
      if (!s.at(t, p)) continue;
      // The broad test: the ray's nearest approach to the sphere's middle, within its reach.
      const mx = p.x - ox;
      const my = p.y - oy;
      const mz = p.z - oz;
      const along = mx * dx + my * dy + mz * dz;
      if (along < -s.radius || along > bestT + s.radius) continue;
      const cx = mx - dx * along;
      const cy = my - dy * along;
      const cz = mz - dz * along;
      if (cx * cx + cy * cy + cz * cz > s.radius * s.radius) continue;
      const hit = s.ray(ox, oy, oz, dx, dy, dz, bestT, t);
      if (hit < bestT) {
        bestT = hit;
        best = s;
      }
    }
    this.t = best ? bestT : Infinity;
    return best;
  }

  /** A round met `target` at (x, y, z): it takes the round, and the shooter is told. */
  strike(target: SkyTarget, src: Source, heavy: boolean, x: number, y: number, z: number): SkyTaken {
    if (!this.targets.includes(target)) return NONE;
    this.hits++;
    const got = target.take(src, 1, heavy, x, y, z);
    this.marker?.(src.by, x, y, z, got);
    return got;
  }

  /**
   * A blast of `radius` at (x, y, z) at tick `t`: each sky target within it takes it, fading as a body's does from full
   * within a metre of its hull to nothing at the edge. Nothing shields a craft in the open sky, so there is no line test.
   */
  blast(src: Source, x: number, y: number, z: number, radius: number, t: number): void {
    if (this.targets.length === 0) return;
    const p = this.point;
    const walking = this.walking;
    walking.length = 0;
    for (const s of this.targets) walking.push(s);
    for (const s of walking) {
      if (!s.at(t, p)) continue;
      const mid = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (mid - s.radius >= radius) continue;
      const far = Math.max(0, s.gap(x, y, z, t));
      if (far >= radius) continue;
      const share = far <= 1 ? 1 : radius <= 1 ? 0 : 1 - (far - 1) / (radius - 1);
      if (share <= 0) continue;
      this.hits++;
      const got = s.take(src, share, true, x, y, z);
      this.marker?.(src.by, p.x, p.y, p.z, got);
    }
    walking.length = 0;
  }

  /** The nearest sky target whose hull is within `fuse` of (x, y, z) at tick `t`, or null: a missile's proximity fuse. */
  within(x: number, y: number, z: number, fuse: number, t: number): SkyTarget | null {
    const p = this.point;
    for (const s of this.targets) {
      if (!s.at(t, p)) continue;
      if (Math.hypot(p.x - x, p.y - y, p.z - z) - s.radius > fuse) continue;
      if (s.gap(x, y, z, t) <= fuse) return s;
    }
    return null;
  }
}
