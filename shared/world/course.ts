// Places for movers. A waypoint is a place with a kind, a priority and a pull. A course is waypoints in an order. An
// objective is several to choose among, some of them only worth a detour.

/** What a waypoint is for, by number: the order is the wire's and the scorer's (shared/decide/profiles.ts). */
export const WAYPOINT_KINDS = ["go", "danger", "enemy", "resource", "meet"] as const;
export const PRIORITY_MOST = 7;

export interface Waypoint {
  x: number;
  z: number;
  /** Metres within which it counts as reached. */
  radius: number;
  /** An index of WAYPOINT_KINDS. */
  kind: number;
  /** 0 to PRIORITY_MOST: what its author wants done first. */
  priority: number;
  /** -1 to 1: how strongly it draws movers that heed it, or under 0 drives them off. */
  pull: number;
}

export const COURSE_ONCE = 0, COURSE_LOOP = 1, COURSE_BACK = 2;

export interface Course {
  points: Waypoint[];
  /** COURSE_ONCE ends at the last point, COURSE_LOOP goes round again, COURSE_BACK walks back the way it came. */
  mode: number;
  /** The point being made for, or -1 once a course is done. */
  at: number;
  /** 1 going forward, -1 coming back. */
  step: number;
}

export function course(points: Waypoint[], mode: number = COURSE_ONCE): Course {
  return { points, mode, at: points.length > 0 ? 0 : -1, step: 1 };
}

export function current(c: Course): Waypoint | null {
  return c.at >= 0 ? c.points[c.at]! : null;
}

/** Moves a course on from the point it was making for. False once it is done. */
export function advance(c: Course): boolean {
  const n = c.points.length;
  if (c.at < 0 || n === 0) return false;
  let next = c.at + c.step;
  if (next >= n || next < 0) {
    if (c.mode === COURSE_LOOP && n > 0) next = 0;
    else if (c.mode === COURSE_BACK && n > 1) {
      c.step = -c.step;
      next = c.at + c.step;
    } else next = -1;
  }
  c.at = next;
  return next >= 0;
}

export interface Choice {
  place: Waypoint;
  /** Worth leaving the way for, but never an end of its own. */
  detour: boolean;
  /** Seconds a detour is worth leaving the way for; WORTH_SECONDS for each step of priority and one more where not given. */
  worth?: number;
}

/** Seconds of a detour's worth for each step of its priority, and one more. A guess the owner may turn. */
export const WORTH_SECONDS = 5;

/** What a detour is worth leaving the way for, in seconds. */
export function worthOf(c: Choice): number {
  return c.worth ?? WORTH_SECONDS * (1 + c.place.priority);
}

export interface Objective {
  choices: Choice[];
}

/** The plain pick from (x, z): the highest priority, then the nearest; never a detour. -1 where there is nothing to pick. */
export function pickPlain(o: Objective, x: number, z: number): number {
  let best = -1, top = -1, near = Infinity;
  for (let i = 0; i < o.choices.length; i++) {
    const c = o.choices[i]!;
    if (c.detour) continue;
    const dx = c.place.x - x, dz = c.place.z - z, d = dx * dx + dz * dz;
    if (c.place.priority > top || (c.place.priority === top && d < near)) {
      best = i;
      top = c.place.priority;
      near = d;
    }
  }
  return best;
}
