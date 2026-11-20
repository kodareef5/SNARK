// The body: the only part of grunt that sends controls. Its moves are steps a skill runs (`yield*`): turn to a yaw,
// face a thing until it is under the crosshair, walk to a point steering round what is in the way, hold a button.
// Each step yields what it waits for; the runtime advances it on its tick.

import { type Belief, wrap } from "./belief.ts";
import { type Costs, type Danger, type Route, WALK } from "./nav.ts";
import type { Action, Outcome, Vec3 } from "./protocol.ts";
import type { Acted, Session } from "./session.ts";

export type Wait = { ms: number } | { until: () => boolean; ms?: number };
export type Run<T = void> = Generator<Wait, T, void>;

export interface Recorder {
  record(kind: string, data: Record<string, unknown>): void;
}

/** What a walk ended with. */
export type Arrival = "arrived" | "blocked" | "lost" | "unreachable" | "stopped" | "near";
/** Why a route was planned again. */
export type Replan = "bumped" | "blocked ahead" | "worse ground ahead" | "danger ahead" | "target moved";

export interface GoOptions {
  costs?: Costs;
  dangers?: () => Danger[];
  sprint?: boolean;
  ignore?: string;
  /** Told of every route planned: the first, and each one planned again, with why it was. */
  onRoute?: (r: Route, replans: number, why: Replan | null) => void;
  /** Told as each leg of the route is done, with the metres left. */
  onLeg?: (left: number) => void;
  /** Stops the going the moment this holds (exploring stops on sight of anything hostile). */
  until?: () => boolean;
}

const STEER_MS = 400;
const OBSTACLE = new Set(["tree", "rock", "chest"]);
/** A structure piece in the way: walls, frames, doors, pillars of any tier. */
const PIECE = /^(wall|doorframe|windowframe|door|pillar)_/;

export class Body {
  readonly belief: Belief;
  private readonly session: Session;
  private readonly trace: Recorder;

  constructor(session: Session, belief: Belief, trace: Recorder) {
    this.session = session;
    this.belief = belief;
    this.trace = trace;
  }

  act(actions: Action[], why = ""): Acted {
    const a = this.session.act(actions);
    this.trace.record("act", { command: a.command, actions, basis: this.session.seq, why });
    return a;
  }

  /** Waits for every outcome of an act, up to a limit. */
  *settle(a: Acted, ms = 5000): Run<(Outcome | undefined)[]> {
    yield { until: () => a.state.done, ms };
    return a.state.outcomes;
  }

  stop(why = "stop"): void {
    this.act([{ control: "stop" }], why);
  }

  *turnTo(yaw: number): Run<boolean> {
    const [o] = yield* this.settle(this.act([{ control: "look", yaw: wrap(yaw), pitch: 0 }], "turn"), 3000);
    return o?.status === "completed";
  }

  /** Looks the whole way round, slowly, so that everything about is seen once. */
  *scan(): Run {
    const start = this.belief.self?.yaw ?? 0;
    for (let i = 1; i <= 4; i++) yield* this.turnTo(start + (i * Math.PI) / 2);
    this.belief.scannedAt = this.belief.now;
  }

  /** Turns to a thing until the crosshair is on it. False if it never comes under it from here. */
  *face(id: string): Run<boolean> {
    const thing = this.belief.things.get(id);
    if (!thing) return false;
    const yaw = this.belief.yawTo(thing.pos);
    for (const off of [0, 0.15, -0.15, 0.3, -0.3]) {
      yield* this.turnTo(yaw + off);
      const after = this.belief.now;
      yield { until: () => this.belief.focusAt > after, ms: 600 };
      if (this.belief.focus.target === id) return true;
    }
    return false;
  }

  /** Walks until within `reach` of a point, steering round remembered obstacles. */
  *walkTo(target: () => Vec3 | null, reach: number, opts: { sprint?: boolean; ignore?: string; ms?: number; quick?: boolean; until?: () => boolean } = {}): Run<Arrival> {
    const b = this.belief;
    const startT = b.now;
    let last = b.pos, lastT = b.now, stuck = 0, side = 1;
    const first = target();
    const limit = opts.ms ?? (first ? b.distance(first) / 2 + 15 : 15) * 1000;
    while (true) {
      const p = target();
      if (!p) {
        this.stop("lost");
        return "lost";
      }
      if (b.distance(p) <= reach) {
        this.stop("arrived");
        return "arrived";
      }
      if (opts.until?.()) {
        this.stop("stopped");
        return "stopped";
      }
      if (b.now - startT > limit) {
        this.stop("too long");
        return "blocked";
      }
      // Following a planned route, solid ground in the way is for the route to go round, not for wriggling.
      if (opts.quick && b.since(startT, "blocked").some((e) => e.data.by === "terrain" || e.data.by === "land" || e.data.by === "water")) {
        this.stop("bumped");
        return "blocked";
      }
      // Unstuck: under 0.4 m gained in a second and a half means something is in the way.
      if (b.now - lastT > 1500) {
        if (b.distance(last) < 0.4) {
          stuck++;
          if (stuck >= 4) {
            this.stop("stuck");
            return "blocked";
          }
          side = -side;
          const away = this.belief.self!.yaw + side * (0.9 + stuck * 0.2);
          this.act([{ control: "look", yaw: wrap(away), pitch: 0 }, { control: "move", forward: 1, strafe: 0, duration_ms: 700 }], "unstuck");
          yield { ms: 800 };
        } else stuck = Math.max(0, stuck - 1);
        last = b.pos;
        lastT = b.now;
      }
      const yaw = this.steer(p, opts.ignore);
      const off = Math.abs(wrap(yaw - (b.self?.yaw ?? 0)));
      this.act([
        { control: "look", yaw, pitch: 0 },
        { control: "move", forward: off < 0.7 ? 1 : 0, strafe: 0, sprint: !!opts.sprint, duration_ms: STEER_MS },
      ], "walk");
      yield { ms: 150 };
    }
  }

  /** Goes to a point the way a player who knows the ground would: plans a route over what it knows (the map, what it has
   * seen), walks it leg by leg, and plans again whenever the way turns out blocked or the target moves off it. */
  *goTo(target: () => Vec3 | null, reach: number, opts: GoOptions = {}): Run<Arrival> {
    const b = this.belief, nav = b.nav;
    if (!nav.w) return yield* this.walkTo(target, reach, opts);
    const costs = opts.costs ?? WALK;
    let replans = 0;
    let why: Replan | null = null;
    while (true) {
      const goal = target();
      if (!goal) return "lost";
      if (b.distance(goal) <= reach) {
        this.stop("arrived");
        return "arrived";
      }
      const r = nav.route(b.pos, goal, costs, opts.dangers?.() ?? []);
      if (!r) {
        this.stop("no way");
        return "unreachable";
      }
      opts.onRoute?.(r, replans, why);
      const planned = new Set([...b.dangers.keys()]);
      const snapshot = nav.snapshot(r.points, b.pos, costs);
      let again = false;
      for (let i = 0; i < r.points.length && !again; i++) {
        const last = i === r.points.length - 1;
        const wp = r.points[i]!;
        const d = b.distance(wp);
        // A danger seen near the rest of the way stops the leg where it is, so the way is planned again in time.
        const rest = r.points.slice(i);
        let warned = false;
        // The last leg makes for the target itself, unless this way of going cannot reach it (a boat stops at the bank).
        const toGoal = last && !r.near;
        const res = yield* this.walkTo(toGoal ? () => target() ?? wp : () => wp, toGoal ? reach : last ? 2 : 1.6, {
          ...opts, quick: true, ms: (d / 1.5 + 10) * 1000,
          until: () => {
            if (opts.until?.()) return true;
            if (opts.dangers && this.newDangerAhead(rest, planned)) return (why = "danger ahead"), (warned = true);
            if (nav.dearerAhead(snapshot, b.pos, rest, costs)) return (why = "worse ground ahead"), (warned = true);
            return false;
          },
        });
        if (res === "lost") return res;
        if (res === "stopped" && !warned) return res;
        if (res === "stopped") {
          again = true;
          break;
        }
        if (res === "blocked") {
          // What stopped the body is ground the plan did not know: mark it, and plan again.
          const yaw = b.yawTo(wp), p = b.pos;
          nav.bump(p[0] + Math.sin(yaw) * 1.2, p[2] - Math.cos(yaw) * 1.2);
          (again = true), (why = "bumped");
        } else if (nav.blockedAhead(r.points, i + 1)) (again = true), (why = "blocked ahead");
        // The ground ahead turned out much dearer than planned (a bridge that is water now): plan again, which may
        // still go the same way, knowingly.
        else if (nav.dearerAhead(snapshot, b.pos, r.points.slice(i + 1), costs)) (again = true), (why = "worse ground ahead");
        else if (opts.dangers && this.newDangerAhead(r.points.slice(i + 1), planned)) (again = true), (why = "danger ahead");
        else {
          const t = target();
          // Against where the target was when the way was planned (a route's end may be short of it on purpose).
          if (t && Math.hypot(t[0] - goal[0], t[2] - goal[2]) > 6) (again = true), (why = "target moved");
        }
        if (!again && !last) {
          let left = 0;
          for (let j = i + 1; j < r.points.length; j++) left += Math.hypot(r.points[j]![0] - r.points[j - 1]![0], r.points[j]![2] - r.points[j - 1]![2]);
          opts.onLeg?.(Math.round(left + b.distance(r.points[i + 1]!)));
        }
      }
      if (!again) {
        const t = target();
        if (t && b.distance(t) <= reach + 0.5) return "arrived";
        // As near as this way of going gets (a boat at the shore): the rest is for another way.
        if (r.near) {
          this.stop("as near as it goes");
          return "near";
        }
      }
      if (++replans > 20) {
        this.stop("too many tries");
        return "blocked";
      }
    }
  }

  /** A danger seen since the route was planned, near the rest of it: worth planning again to keep clear. */
  private newDangerAhead(rest: Vec3[], planned: Set<string>): boolean {
    // Measured to the way itself (each straight leg from here on), not to its corners: on open ground the only
    // corner may be the goal, far past the danger.
    const path = [this.belief.pos, ...rest];
    for (const [id, d] of this.belief.dangers) {
      if (planned.has(id) || this.belief.now - d.t > 5000) continue;
      for (let i = 1; i < path.length; i++) if (segmentDistance(d.pos, path[i - 1]!, path[i]!) < 30) return true;
    }
    return false;
  }

  /** The way to head for a point: straight at it, bent away from the nearest obstacle on the line. */
  private steer(p: Vec3, ignore?: string): number {
    const b = this.belief;
    const direct = b.yawTo(p), dist = b.distance(p);
    let worst: { side: number; lateral: number } | null = null;
    for (const t of b.things.values()) {
      if (t.id === ignore || !(OBSTACLE.has(t.type) || PIECE.test(t.type))) continue;
      const d = b.distance(t.pos);
      if (d > Math.min(5, dist) || d < 0.05) continue;
      const rel = wrap(b.yawTo(t.pos) - direct);
      if (Math.abs(rel) > 1.2) continue;
      const lateral = Math.sin(rel) * d;
      if (Math.abs(lateral) > 1.4) continue;
      if (!worst || Math.abs(lateral) < Math.abs(worst.lateral)) worst = { side: rel >= 0 ? -1 : 1, lateral };
    }
    if (!worst) return direct;
    return wrap(direct + worst.side * (0.5 + (1.4 - Math.abs(worst.lateral)) * 0.4));
  }
}

/** How far a point is from a segment, on the ground. */
export function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const len2 = dx * dx + dz * dz;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[2] - (a[2] + t * dz));
}
