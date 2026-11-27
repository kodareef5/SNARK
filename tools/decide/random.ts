// The randomizers: a scene as plain data, every measure drawn from its seed. A scene is laid out in its own frame, the
// mover at the origin and its goal along +v, then turned a whole number of quarters and set down near the map's middle,
// so walls stay square to the world. setups.ts builds a scene on the lab world and plays it.

import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { swimDepth } from "../../shared/sim/character.ts";
import { FAMILIES, SITUATIONS } from "./catalog.ts";

export type Family = (typeof FAMILIES)[number] | (typeof SITUATIONS)[number] | "miami";

/** Bodies that walk, and how often each is the mover. */
export const MOVERS: readonly (readonly [string, number])[] = [["core:raptor", 3], ["core:dodo", 2], ["core:parasaur", 2], ["core:trike", 1], ["core:stego", 1], ["core:rex", 1]];

/** One wall piece: its middle on the ground, 3 m wide, along x (quarter 0) or z (quarter 1), one or two storeys. */
export interface Piece {
  x: number;
  z: number;
  quarter: 0 | 1;
  storeys: 1 | 2;
}

/** A body that stands where it is put until `until` (a tick), then walks to `then`. */
export interface Stander {
  kind: string;
  x: number;
  z: number;
  until: number;
  then?: { x: number; z: number };
}

export interface Scene {
  family: Family;
  /** "flat" for the lab's own ground, "miami" for the slice of the city. */
  map: "flat" | "miami";
  seed: number;
  kind: string;
  start: { x: number; z: number; yaw: number };
  goal: { x: number; z: number };
  /** Ticks it is given, from its start; the labels' replays are given as many from the decision. */
  horizon: number;
  pieces: Piece[];
  standers: Stander[];
  /** Trees on the ground: how many a chunk, and the scatter's seed. */
  trees?: { perChunk: number; seed: number };
  /** A strip of shallow water, its corners and depth; `more` are further strips of the same depth. */
  water?: { x0: number; z0: number; x1: number; z1: number; depth: number; more?: { x0: number; z0: number; x1: number; z1: number }[] };
  /** One side of a pair (`ford`, `gap`): see Pair. */
  pair?: Pair;
}

/**
 * One side of a pair: its number (seeds 2n - 1 and 2n are pair n), which side, and the fact that differs between the two.
 * `mouth` is a point on the line across the U's open end and the way out over it: a way past that line went round.
 */
export interface Pair {
  id: number;
  side: 0 | 1;
  fact: "body" | "depth" | "dry" | "fit";
  mouth: { x: number; z: number; nx: number; nz: number };
}

/** Seconds each family is given. The owner may turn them: they are guesses, long enough that backing away to get round pays. */
export const HORIZON_SECONDS: Record<Family, number> = { trees: 60, deadEnd: 90, pen: 90, water: 75, blocker: 75, crowd: 75, miami: 90, ford: 90, gap: 90 };

const PIECE = 3;
/** A wall piece's thickness. */
const WALL = 0.2;
/** A scene's horizon is at least this many times the straight way at the mover's pace. */
const HORIZON_LINES = 3;
/** The map's side, in metres: the lab's flat ground is four chunks a side. */
export const FLAT_SIDE = 4 * CHUNK_SIZE;
/** The Miami slice's side. */
export const MIAMI_SIDE = 9 * CHUNK_SIZE;

function weighted(rng: Rng, list: readonly (readonly [string, number])[]): string {
  let r = rng.float() * list.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of list) if ((r -= w) < 0) return v;
  return list[list.length - 1]![0];
}

/** A body's radius and walking pace (m/s), from the content; its swimming pace, and the depth of water it swims in. */
export function bodyOf(kind: string): { radius: number; height: number; pace: number; swim: number; swims: number } {
  const reg = coreRegistry(), k = reg.index.get(kind);
  const m = k === undefined ? undefined : reg.move[k];
  if (!m) throw new Error(`${kind} is not a body that moves`);
  return { radius: m.radius, height: m.height, pace: m.walkSpeed, swim: m.swimSpeed, swims: swimDepth(m, SWIMS) };
}

/** Of a body's height, the water over which it swims (SWIM_ENTER in shared/sim/character.ts). */
const SWIMS = 0.7;

/** Lays a scene out in its frame (u across, v toward the goal) and turns it into the world's. */
class Frame {
  readonly ox: number;
  readonly oz: number;
  readonly turn: number;
  readonly pieces: Piece[] = [];
  constructor(ox: number, oz: number, turn: number) {
    this.ox = ox;
    this.oz = oz;
    this.turn = turn;
  }
  at(u: number, v: number): { x: number; z: number } {
    const [a, b] = [[u, v], [v, -u], [-u, -v], [-v, u]][this.turn]!;
    return { x: this.ox + a!, z: this.oz + b! };
  }
  /** Wall pieces from (u0, v) to (u1, v), across the frame. */
  across(u0: number, u1: number, v: number, storeys: 1 | 2 = 2, skip: (i: number) => boolean = () => false): void {
    for (let i = 0, u = u0 + PIECE / 2; u < u1; u += PIECE, i++) if (!skip(i)) this.piece(u, v, this.turn % 2 === 0 ? 0 : 1, storeys);
  }
  /** Wall pieces from (u, v0) to (u, v1), along the frame. */
  along(u: number, v0: number, v1: number, storeys: 1 | 2 = 2, skip: (i: number) => boolean = () => false): void {
    for (let i = 0, v = v0 + PIECE / 2; v < v1; v += PIECE, i++) if (!skip(i)) this.piece(u, v, this.turn % 2 === 0 ? 1 : 0, storeys);
  }
  private piece(u: number, v: number, quarter: 0 | 1, storeys: 1 | 2): void {
    const p = this.at(u, v);
    this.pieces.push({ x: p.x, z: p.z, quarter, storeys });
  }
  yaw(): number {
    return (this.turn * 16384) & 0xffff;
  }
}

/** A scene of `family` from `seed`. */
export function draw(family: Family, seed: number): Scene {
  if ((SITUATIONS as readonly string[]).includes(family)) return situation(family, seed);
  const rng = new Rng((seed * 2654435761 + FAMILIES.indexOf(family as (typeof FAMILIES)[number]) * 97 + 13) >>> 0);
  const kind = weighted(rng, MOVERS);
  const body = bodyOf(kind);
  const map = family === "miami" ? "miami" : "flat";
  const side = map === "miami" ? MIAMI_SIDE : FLAT_SIDE;
  const f = new Frame(side / 2 + rng.range(-20, 20), side / 2 + rng.range(-20, 20), rng.int(4));
  const ticks = HORIZON_SECONDS[family] * TICK_RATE;
  // Gaps a body fits through: its width and a margin, in whole pieces.
  const fit = Math.max(1, Math.ceil((2 * body.radius + 0.6) / PIECE));
  const standers: Stander[] = [];
  let goalV = rng.range(25, 60), goalU = rng.range(-10, 10), startV = 0, startU = 0;
  let water: Scene["water"];
  if (family === "deadEnd") {
    // A U open behind the mover, closed toward its goal, from a short bay to one deep enough that today's search fills it.
    const half = rng.float() < 0.3 ? ((fit + rng.int(4)) * PIECE) / 2 + PIECE / 2 : rng.range(15, 30), depth = rng.range(30, 66);
    f.along(-half, -depth, 2);
    f.along(half, -depth, 2);
    f.across(-half, half, 2);
    startV = -rng.range(1, Math.min(8, depth / 2));
    startU = rng.range(-0.3, 0.3) * half;
    goalV = 2 + rng.range(4, 20);
    goalU = rng.range(-6, 6);
  } else if (family === "pen") {
    // A walled pen whose one door is never on the side of the goal.
    const n = 6 + rng.int(14), s = n * PIECE, door = [0, 2, 3][rng.int(3)]!, at = rng.int(n - fit + 1);
    const gap = (i: number) => i >= at && i < at + fit;
    f.across(-s / 2, s / 2, -s / 2, 2, door === 0 ? gap : undefined);
    f.across(-s / 2, s / 2, s / 2, 2);
    f.along(-s / 2, -s / 2, s / 2, 2, door === 2 ? gap : undefined);
    f.along(s / 2, -s / 2, s / 2, 2, door === 3 ? gap : undefined);
    startU = rng.range(-0.3, 0.3) * s;
    startV = rng.range(-0.3, 0.3) * s;
    goalV = s / 2 + rng.range(10, 30);
  } else if (family === "water") {
    // A U closed toward the goal whose mouth is flooded past both walls, deeper than today's search will cross: out is
    // through the water, or nowhere.
    const half = ((fit + 1 + rng.int(3)) * PIECE) / 2 + PIECE / 2, depth = PIECE * (3 + rng.int(4)), into = rng.range(2, depth / 2);
    f.along(-half, -depth, 2);
    f.along(half, -depth, 2);
    f.across(-half, half, 2);
    const a = f.at(-half - rng.range(6, 20), -depth - rng.range(4, 10)), b = f.at(half + rng.range(6, 20), -depth + into);
    water = { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z), depth: body.height * rng.range(0.75, 1.1) };
    startV = -rng.range(0, Math.max(0, depth - into - 2 - body.radius));
    startU = rng.range(-0.3, 0.3) * half;
    goalV = 2 + rng.range(8, 25);
    goalU = rng.range(-6, 6);
  } else if (family === "blocker") {
    // A corridor a big body stands in for a while, too narrow to pass it and long enough that going round costs.
    const big = weighted(rng, [["core:trike", 1], ["core:stego", 1], ["core:parasaur", 1]]);
    const half = Math.max(bodyOf(big).radius, body.radius + 0.3) + rng.range(0, 0.5) + WALL / 2, v0 = rng.range(4, 8), len = PIECE * (6 + rng.int(8));
    f.along(-half, v0, v0 + len);
    f.along(half, v0, v0 + len);
    const p = f.at(0, v0 + rng.range(0.25, 0.75) * len), away = f.at(rng.float() < 0.5 ? -25 : 25, v0 + len + 12);
    standers.push({ kind: big, x: p.x, z: p.z, until: Math.round(rng.range(10, 50) * TICK_RATE), then: away });
    goalV = v0 + len + rng.range(8, 20);
    goalU = rng.range(-4, 4);
  } else if (family === "crowd") {
    // A wall across the way, its near end plugged by a crowd that stays; the far end is clear and a long way round.
    const L = rng.range(8, 14), short = rng.range(2, 6), long = rng.range(18, 32), flip = rng.float() < 0.5 ? -1 : 1;
    const [u0, u1] = flip < 0 ? [-short, long] : [-long, short];
    f.across(u0, u1, L);
    const n = 8 + rng.int(7), end = flip < 0 ? -short : short, gap = 1.4 + 2 * body.radius;
    for (let i = 0; i < n; i++) {
      const across = i % 3, row = Math.floor(i / 3);
      const p = f.at(end - flip * (across * gap + rng.range(0.3, 1)), L + (row - 1.5) * gap + rng.range(-0.3, 0.3));
      standers.push({ kind: rng.float() < 0.3 ? "core:dodo" : "core:parasaur", x: p.x, z: p.z, until: 1 << 30 });
    }
    goalV = L + rng.range(8, 25);
    goalU = rng.range(-5, 5);
  } else if (family === "trees") goalV = rng.range(35, 80);
  // Long enough for a slow body to go a good way round.
  const line = Math.hypot(goalU - startU, goalV - startV);
  const horizon = Math.max(ticks, Math.ceil((HORIZON_LINES * line) / body.pace) * TICK_RATE);
  const start = f.at(startU, startV), goal = f.at(goalU, goalV);
  const yaw = (f.yaw() + Math.round(rng.range(-0.25, 0.25) * 65536)) & 0xffff;
  const scene: Scene = { family, map, seed, kind, start: { ...start, yaw }, goal, horizon, pieces: f.pieces, standers };
  // Fewer trees for a broad body, which no wood as thick as a raptor's would let through.
  if (family === "trees") scene.trees = { perChunk: Math.round((40 + rng.int(100)) * Math.min(1, 1.2 / (body.radius + 0.6))), seed: 1 + rng.int(1 << 20) };
  if (water) scene.water = water;
  return scene;
}

/** Pieces each side by which a ford's long dry way is wider. */
const WIDER = 7;
/** Bodies that swim faster than they walk, and ones that swim slower. */
const FAST_SWIMMERS: readonly (readonly [string, number])[] = [["core:dodo", 2], ["core:trike", 1], ["core:stego", 1]];
const SLOW_SWIMMERS: readonly (readonly [string, number])[] = [["core:raptor", 2], ["core:parasaur", 1]];

/** Where the frame's corners (u0, v0) and (u1, v1) fall in the world, as a box. */
function boxOf(f: Frame, u0: number, v0: number, u1: number, v1: number): { x0: number; z0: number; x1: number; z1: number } {
  const a = f.at(u0, v0), b = f.at(u1, v1);
  return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) };
}

/**
 * A pair's side. Both sides draw the layout from the pair's number, so only the fact differs.
 *
 * `ford`: a U closed toward the goal, the mover inside it, with a gap in the closed end. Water fills the U's end and a strip
 * past the gap wider than the U, so the gap is a swim (or a wade) and the dry way is out of the U's mouth and round the
 * strip. The fact is the body (one that swims faster than it walks against one slower), the depth (a wade against a swim),
 * or the U's depth, which is how long the dry way is.
 *
 * `gap`: a U closed toward the goal with a gap one piece wide in its closed end, which a raptor fits through and a rex does not.
 */
function situation(family: Family, seed: number): Scene {
  const id = (seed + 1) >> 1, side = ((seed + 1) & 1) as 0 | 1;
  const rng = new Rng((id * 2654435761 + (FAMILIES.length + SITUATIONS.indexOf(family as (typeof SITUATIONS)[number])) * 97 + 13) >>> 0);
  const f = new Frame(FLAT_SIDE / 2 + rng.range(-20, 20), FLAT_SIDE / 2 + rng.range(-20, 20), rng.int(4));
  const yaw0 = Math.round(rng.range(-0.25, 0.25) * 65536);
  let kind: string, fact: Pair["fact"], depth = 0, water: Scene["water"];
  let D: number, H: number, gapAt: number, gapN: number, startU: number, startV: number, goalU: number, goalV: number;
  if (family === "ford") {
    fact = (["body", "depth", "dry"] as const)[rng.int(3)]!;
    // A body that swims faster than it walks crosses whatever the depth or the dry way, so only the body pair has one.
    const slow = weighted(rng, SLOW_SWIMMERS), fast = weighted(rng, FAST_SWIMMERS);
    const kinds = fact === "body" ? [slow, fast] : [slow, slow];
    kind = kinds[side]!;
    const bodies = kinds.map(bodyOf), widest = Math.max(...bodies.map((b) => b.radius));
    // Gaps a body fits through: its width and a margin, in whole pieces.
    gapN = Math.max(1, Math.ceil((2 * widest + 1.2) / PIECE));
    H = ((gapN + 2 + rng.int(3)) * PIECE) / 2;
    const short = rng.range(3.5, 6), long = rng.range(40, 66);
    // The long dry way is a U deeper and wider, by WIDER pieces each side, so that today's search fills it.
    const wide = fact === "dry" && side === 1;
    D = wide ? long : short;
    const swims = Math.max(...bodies.map((b) => b.swims)), wade = Math.min(...bodies.map((b) => b.swims));
    const deep = swims * rng.range(1.15, 1.5), shallow = Math.max(0.2, wade * rng.range(0.3, 0.7));
    depth = fact === "depth" ? [shallow, deep][side]! : deep;
    const inside = rng.range(1, Math.max(1, Math.min(4, short - 2.5))), outside = rng.range(26, 42), past = [rng.range(1, 3), rng.range(1, 3)];
    const n = Math.round((2 * H) / PIECE);
    gapAt = rng.int(n - gapN + 1);
    startV = -rng.range(1.5, Math.max(1.5, short - inside - 1.5));
    startU = rng.range(-0.6, 0.6) * H;
    goalV = 2 + outside + rng.range(3, 10);
    goalU = rng.range(-H, H);
    if (wide) {
      H += WIDER * PIECE;
      gapAt += WIDER;
    }
    water = { ...boxOf(f, -H, 2 - inside, H, 2), depth, more: [boxOf(f, -H - past[0]!, 2, H + past[1]!, 2 + outside)] };
  } else {
    fact = "fit";
    kind = ["core:raptor", "core:rex"][side]!;
    gapN = 1;
    H = ((3 + rng.int(6)) * PIECE) / 2 + PIECE / 2;
    D = rng.range(8, 40);
    gapAt = rng.int(Math.round((2 * H) / PIECE));
    startV = -rng.range(3, Math.max(3, D / 2));
    startU = rng.range(-0.5, 0.5) * H;
    goalV = 2 + rng.range(4, 15);
    goalU = rng.range(-6, 6);
  }
  f.along(-H, -D, 2);
  f.along(H, -D, 2);
  f.across(-H, H, 2, 2, (i) => i >= gapAt && i < gapAt + gapN);
  const body = bodyOf(kind);
  const line = Math.hypot(goalU - startU, goalV - startV);
  const ticks = HORIZON_SECONDS[family] * TICK_RATE;
  const horizon = Math.max(ticks, Math.ceil((HORIZON_LINES * line) / body.pace) * TICK_RATE);
  const start = f.at(startU, startV), goal = f.at(goalU, goalV), m = f.at(0, -D), out = f.at(0, -D - 1);
  const scene: Scene = {
    family, map: "flat", seed, kind, start: { ...start, yaw: (f.yaw() + yaw0) & 0xffff }, goal, horizon, pieces: f.pieces, standers: [],
    pair: { id, side, fact, mouth: { x: m.x, z: m.z, nx: out.x - m.x, nz: out.z - m.z } },
  };
  if (water) scene.water = water;
  return scene;
}

/** `count` scenes of each family named, seeds counted from `first`. */
export function scenes(families: readonly Family[], count: number, first = 1): Scene[] {
  return families.flatMap((family) => Array.from({ length: count }, (_, i) => draw(family, first + i)));
}
