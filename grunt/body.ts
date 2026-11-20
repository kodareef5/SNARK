// The body: the only part of grunt that sends controls. Its moves are steps a skill runs (`yield*`): turn to a yaw,
// face a thing until it is under the crosshair, walk to a point steering round what is in the way, hold a button.
// Each step yields what it waits for; the runtime advances it on its tick.

import { type Belief, wrap } from "./belief.ts";
import type { Action, Outcome, Vec3 } from "./protocol.ts";
import type { Acted, Session } from "./session.ts";

export type Wait = { ms: number } | { until: () => boolean; ms?: number };
export type Run<T = void> = Generator<Wait, T, void>;

export interface Recorder {
  record(kind: string, data: Record<string, unknown>): void;
}

/** What a walk ended with. */
export type Arrival = "arrived" | "blocked" | "lost";

const STEER_MS = 400;
const OBSTACLE = new Set(["tree", "rock", "chest", "wood_wall", "wood_doorframe", "wood_door"]);

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
  *walkTo(target: () => Vec3 | null, reach: number, opts: { sprint?: boolean; ignore?: string; ms?: number } = {}): Run<Arrival> {
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
      if (b.now - startT > limit) {
        this.stop("too long");
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

  /** The way to head for a point: straight at it, bent away from the nearest obstacle on the line. */
  private steer(p: Vec3, ignore?: string): number {
    const b = this.belief;
    const direct = b.yawTo(p), dist = b.distance(p);
    let worst: { side: number; lateral: number } | null = null;
    for (const t of b.things.values()) {
      if (t.id === ignore || !OBSTACLE.has(t.type)) continue;
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
