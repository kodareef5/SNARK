// The randomizers: a scene as plain data, every measure drawn from its seed. A scene is laid out in its own frame, the
// mover at the origin and its goal along +v, then turned a whole number of quarters and set down near the map's middle,
// so walls stay square to the world. setups.ts builds a scene on the lab world and plays it.

import { CHUNK_SIZE, TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { coreRegistry } from "../../tests/fixtures/world.ts";
import { FAMILIES } from "./catalog.ts";

export type Family = (typeof FAMILIES)[number] | "miami";

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
  /** A strip of shallow water, its corners and depth. */
  water?: { x0: number; z0: number; x1: number; z1: number; depth: number };
}

/** Seconds each family is given. The owner may turn them: they are guesses, long enough that backing away to get round pays. */
export const HORIZON_SECONDS: Record<Family, number> = { trees: 60, deadEnd: 90, pen: 90, water: 75, blocker: 75, crowd: 75, miami: 90 };

const PIECE = 3;
/** The map's side, in metres: the lab's flat ground is four chunks a side. */
export const FLAT_SIDE = 4 * CHUNK_SIZE;
/** The Miami slice's side. */
export const MIAMI_SIDE = 9 * CHUNK_SIZE;

function weighted(rng: Rng, list: readonly (readonly [string, number])[]): string {
  let r = rng.float() * list.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of list) if ((r -= w) < 0) return v;
  return list[list.length - 1]![0];
}

/** A body's radius and walking pace (m/s), from the content. */
export function bodyOf(kind: string): { radius: number; height: number; pace: number } {
  const reg = coreRegistry(), k = reg.index.get(kind);
  const m = k === undefined ? undefined : reg.move[k];
  if (!m) throw new Error(`${kind} is not a body that moves`);
  return { radius: m.radius, height: m.height, pace: m.walkSpeed };
}

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
    const half = (fit + rng.int(2)) * PIECE / 2 + PIECE / 2, depth = PIECE * (2 + rng.int(4));
    f.along(-half, -depth, 2);
    f.along(half, -depth, 2);
    f.across(-half, half, 2);
    startV = -rng.range(0, depth / 2);
    startU = rng.range(-0.3, 0.3) * half;
    goalU = rng.range(-6, 6);
  } else if (family === "pen") {
    const n = 4 + rng.int(4), s = n * PIECE, door = rng.int(4), at = rng.int(n - fit + 1);
    const gap = (i: number) => i >= at && i < at + fit;
    f.across(-s / 2, s / 2, -s / 2, 2, door === 0 ? gap : undefined);
    f.across(-s / 2, s / 2, s / 2, 2, door === 1 ? gap : undefined);
    f.along(-s / 2, -s / 2, s / 2, 2, door === 2 ? gap : undefined);
    f.along(s / 2, -s / 2, s / 2, 2, door === 3 ? gap : undefined);
    startU = rng.range(-0.3, 0.3) * s;
    startV = rng.range(-0.3, 0.3) * s;
    goalV = s / 2 + rng.range(15, 40);
  } else if (family === "water") {
    const L = rng.range(8, 16), gapU = rng.range(-15, 15), w = fit + rng.int(2);
    const from = Math.round((gapU + 36) / PIECE);
    f.across(-36, 36, L, 2, (i) => i >= from && i < from + w);
    const half = rng.range(4, 12), gu = -36 + from * PIECE + (w * PIECE) / 2;
    const a = f.at(gu - half, L - rng.range(5, 8)), b = f.at(gu + half, L - 1);
    water = { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z), depth: rng.range(0.3, 0.8) };
    goalV = L + rng.range(10, 30);
    goalU = gu + rng.range(-6, 6);
  } else if (family === "blocker") {
    const half = (fit * PIECE) / 2 + rng.range(0.2, 1), v0 = rng.range(4, 8), len = PIECE * (4 + rng.int(5));
    f.along(-half - PIECE / 2, v0, v0 + len);
    f.along(half + PIECE / 2, v0, v0 + len);
    const big = weighted(rng, [["core:trike", 1], ["core:stego", 1], ["core:parasaur", 1]]);
    const p = f.at(0, v0 + len / 2), away = f.at(rng.float() < 0.5 ? -25 : 25, v0 + len + 12);
    standers.push({ kind: big, x: p.x, z: p.z, until: Math.round(rng.range(5, 25) * TICK_RATE), then: away });
    goalV = v0 + len + rng.range(8, 20);
    goalU = rng.range(-4, 4);
  } else if (family === "crowd") {
    const L = rng.range(8, 14), short = rng.range(4, 9), long = rng.range(15, 30), flip = rng.float() < 0.5 ? -1 : 1;
    const [u0, u1] = flip < 0 ? [-short, long] : [-long, short];
    f.across(u0, u1, L);
    const n = 4 + rng.int(5), end = flip < 0 ? -short : short;
    for (let i = 0; i < n; i++) {
      const p = f.at(end - flip * (1 + i * 1.6) + rng.range(-0.3, 0.3), L - rng.range(1.2, 2.5));
      standers.push({ kind: rng.float() < 0.6 ? "core:dodo" : "core:parasaur", x: p.x, z: p.z, until: ticks * 2 });
    }
    goalV = L + rng.range(8, 25);
    goalU = rng.range(-5, 5);
  }
  const start = f.at(startU, startV), goal = f.at(goalU, goalV);
  const yaw = (f.yaw() + Math.round(rng.range(-0.25, 0.25) * 65536)) & 0xffff;
  const scene: Scene = { family, map, seed, kind, start: { ...start, yaw }, goal, horizon: ticks, pieces: f.pieces, standers };
  if (family === "trees") scene.trees = { perChunk: 40 + rng.int(100), seed: 1 + rng.int(1 << 20) };
  if (water) scene.water = water;
  return scene;
}

/** `count` scenes of each family named, seeds counted from `first`. */
export function scenes(families: readonly Family[], count: number, first = 1): Scene[] {
  return families.flatMap((family) => Array.from({ length: count }, (_, i) => draw(family, first + i)));
}
