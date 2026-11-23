// A cut plan: where one opening is broken out of a piece's plane. The opening's ragged outline (its mouth), the cells that
// stand round it (teeth) and the cells that leave (shards). Teeth and shards share the mouth's points, so they match.

import { Rng } from "../../shared/rng.ts";
import { atMost, cornersBetween, cross, hyp, leaves, rectPoly, tidy, type Pt, type Rect } from "./geometry.ts";

export interface PlanAsk {
  /** Where the cut happens. Outside it a piece is left as it was. */
  readonly window: Rect;
  /** The point the mouth is seen whole from: inside the window, or on its edge for an opening that reaches that edge. */
  readonly c: Pt;
  /**
   * The opening that is passable, which the mouth is never inside: its corners counter-clockwise round `c`. With `c` on
   * the window's edge, from the first corner after `c` to the last before it.
   */
  readonly opening: readonly Pt[];
  /** `c` is inside the window, and the mouth goes all the way round it. */
  readonly closed: boolean;
  readonly seed: number;
  /** The most a tooth stands into the piece past the opening, in metres. The art's figure is 0.32. */
  readonly tooth?: number;
  /** Shards in two rings, for a mouth too large for pieces that all meet at its middle. */
  readonly rings?: 1 | 2;
  /** An edge of the opening gets a point of the mouth along it for each this many metres. 1.1 unless given. */
  readonly run?: number;
}

export interface Plan {
  readonly window: Rect;
  readonly c: Pt;
  /** The mouth's points in order. With `c` on the window's edge the edge through `c` closes it. */
  readonly mouth: readonly Pt[];
  readonly closed: boolean;
  readonly teeth: readonly Pt[][];
  readonly shards: readonly Pt[][];
}

/** The least the mouth is wider than the opening, and the least left standing between it and the window's edge. */
const PAD = 0.04, MARGIN = 0.1;

const convex = (poly: readonly Pt[]): boolean => poly.every((p, i) => cross(p, poly[(i + 1) % poly.length]!, poly[(i + 2) % poly.length]!) > 1e-9);

export function plan(ask: PlanAsk): Plan {
  const rng = new Rng(ask.seed);
  const tooth = ask.tooth ?? 0.32, run = ask.run ?? 1.1;
  const frame = rectPoly(ask.window);
  // The opening's corners, and points along its long edges so the mouth has teeth between them.
  const along: Pt[] = [];
  const corners = ask.opening;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    along.push(a);
    if (!ask.closed && i === corners.length - 1) break;
    const b = corners[(i + 1) % corners.length]!;
    const length = hyp(b[0] - a[0], b[1] - a[1]);
    const more = Math.max(length > 0.3 ? 1 : 0, Math.ceil(length / run) - 1);
    for (let k = 1; k <= more; k++) {
      const t = (k + rng.range(-0.3, 0.3)) / (more + 1);
      along.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const mouth: Pt[] = [], edge: Pt[] = [];
  for (const p of along) {
    const far = hyp(p[0] - ask.c[0], p[1] - ask.c[1]);
    const d: Pt = [(p[0] - ask.c[0]) / far, (p[1] - ask.c[1]) / far];
    const out = leaves(frame, ask.c, d);
    const room = out - MARGIN - far;
    const reach = room <= PAD ? (out - far < 1e-4 ? far : Math.min(far + PAD, out)) : far + PAD + rng.float() * Math.min(tooth, room - PAD);
    mouth.push([ask.c[0] + d[0] * reach, ask.c[1] + d[1] * reach]);
    edge.push([ask.c[0] + d[0] * out, ask.c[1] + d[1] * out]);
  }
  const n = mouth.length, last = ask.closed ? n : n - 1;
  const teeth: Pt[][] = [];
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const cell = tidy([mouth[i]!, edge[i]!, ...cornersBetween(ask.window, edge[i]!, edge[j]!), edge[j]!, mouth[j]!]);
    if (cell.length > 0) teeth.push(...atMost(cell, 6));
  }
  // Shards fan out from `c`. In two rings, each is cut across about half way out.
  const inner: Pt[] = mouth.map((p) => { const f = rng.range(0.4, 0.62); return [ask.c[0] + (p[0] - ask.c[0]) * f, ask.c[1] + (p[1] - ask.c[1]) * f]; });
  const shards: Pt[][] = [];
  const fan = (ring: readonly Pt[]): void => {
    for (let i = 0; i < last; ) {
      let cell: Pt[] = [ask.c, ring[i]!, ring[(i + 1) % n]!];
      let k = i + 1;
      // Two or three sectors join where that leaves a convex shard, so they are not all slices of one pie.
      while (k < last && cell.length < 5 && rng.float() < 0.6 && convex([...cell, ring[(k + 1) % n]!])) cell = [...cell, ring[(++k) % n]!];
      const made = tidy(cell);
      if (made.length > 0) shards.push(made);
      i = k;
    }
  };
  if (ask.rings === 2) {
    fan(inner);
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const cell = tidy([inner[i]!, mouth[i]!, mouth[j]!, inner[j]!]);
      if (cell.length === 0) continue;
      if (convex(cell)) shards.push(cell);
      else shards.push(...[tidy([inner[i]!, mouth[i]!, mouth[j]!]), tidy([inner[i]!, mouth[j]!, inner[j]!])].filter((s) => s.length > 0));
    }
  } else fan(mouth);
  return { window: ask.window, c: ask.c, mouth, closed: ask.closed, teeth, shards };
}

export interface ProfileAsk {
  readonly window: Rect;
  /**
   * What is left standing from the window's lower edge up, as heights along it: points with the first axis never going
   * back. A height at the lower edge is a gap to the floor. Two points at one place are a step.
   */
  readonly profile: readonly Pt[];
  readonly seed: number;
  /** About how tall a shard is, in metres. */
  readonly piece?: number;
}

/**
 * A plan for a piece broken down from its top to a ragged line: a wall opened to its jambs and a low remnant. Teeth stand
 * under the line and shards are the bands above it, so no shard is a sliver from one far point.
 */
export function profilePlan(ask: ProfileAsk): Plan {
  const rng = new Rng(ask.seed);
  const [u0, u1, v0, v1] = ask.window;
  const piece = ask.piece ?? 1.6;
  const teeth: Pt[][] = [], shards: Pt[][] = [];
  for (let i = 0; i + 1 < ask.profile.length; i++) {
    const a = ask.profile[i]!, b = ask.profile[i + 1]!;
    if (b[0] - a[0] < 1e-5) continue;
    const under = tidy([[a[0], v0], [b[0], v0], b, a]);
    if (under.length > 0) teeth.push(under);
    // The band over this stretch, cut across into shards about `piece` tall by lines that are not level.
    const bands = Math.max(1, Math.round((v1 - Math.min(a[1], b[1])) / piece));
    let low: [Pt, Pt] = [a, b];
    for (let k = 1; k <= bands; k++) {
      const at = (h: number): number => (k === bands ? v1 : Math.min(v1, h + ((v1 - h) * (k + rng.range(-0.25, 0.25))) / bands));
      const high: [Pt, Pt] = [[a[0], at(a[1])], [b[0], at(b[1])]];
      const cell = tidy([low[0], low[1], high[1], high[0]]);
      if (cell.length > 0) shards.push(cell);
      low = high;
    }
  }
  return { window: ask.window, c: [(u0 + u1) / 2, v1], mouth: ask.profile, closed: false, teeth, shards };
}
