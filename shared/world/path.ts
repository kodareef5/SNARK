// Ways across the ground for anything that walks. A* over 1 m cells, each tested when the search first reaches it by the slope,
// water and capsule tests movement uses, so a way found is one a body can walk. Ground floor only: a floor above the ground is
// a roof or an obstacle. Costs are integers and ties are broken by cell, so the same world gives the same way on every engine.

import { capsuleFree, type CollisionWorld } from "./collide.ts";

/** What the search needs of a body. MoveParams has all of it. */
export interface Walker {
  readonly radius: number;
  readonly height: number;
  /** Steepest walkable slope, as the cosine of its angle. */
  readonly slopeCos: number;
  /** Tallest rise taken in a stride. */
  readonly stepUp: number;
}

export const GROUND_FREE = 0;
/** Off the map. */
export const GROUND_OFF = 1;
/** Deep enough to swim. */
export const GROUND_WATER = 2;
export const GROUND_STEEP = 3;
/** A structure or a node stands there. */
export const GROUND_SOLID = 4;

/** A walker swims where this share of its height is under water, as SWIM_ENTER in shared/sim/character.ts. */
const SWIM_SHARE = 0.7;

/**
 * GROUND_FREE if a body of radius `r` can stand at (x, z), else the first thing that stops it. The capsule is tried a step
 * above the ground, so what movement climbs onto does not count.
 */
export function groundAt(w: CollisionWorld, p: Walker, x: number, z: number, r = p.radius): number {
  const hf = w.hf;
  if (x < r || z < r || x > hf.sizeX - r || z > hf.sizeZ - r) return GROUND_OFF;
  const y = hf.heightAt(x, z);
  if (hf.seaLevel - y > p.height * SWIM_SHARE) return GROUND_WATER;
  if (hf.slopeCosAt(x, z) < p.slopeCos) return GROUND_STEEP;
  return capsuleFree(w, x, y + p.stepUp, z, r, p.height) ? GROUND_FREE : GROUND_SOLID;
}

export const PATH_NONE = 0;
/** The way reaches the goal, or the free cell nearest it. */
export const PATH_FOUND = 1;
/** The goal lies beyond the grid. The way ends at the grid's edge, toward it. */
export const PATH_LEG = 2;
/** No way through was found. The way ends at the cell reached that is nearest the goal. */
export const PATH_SHORT = 3;

/** Cells each way from the start, so the grid is 193 cells square. */
export const PATH_REACH = 96;
export const PATH_BUDGET = 20000;
const SIDE = 2 * PATH_REACH + 1;
/** A start or a goal that cannot be stood on moves to a free cell at most this many metres off. */
const NEAR = 3;
const STRAIGHT = 10;
const DIAGONAL = 14;
/** Added for a cell beside one that is not free, so a way keeps off walls where it costs little. */
const BESIDE = 5;
/** A shortcut must be clear for a body this much wider, and a way still holds while one this much narrower can pass. */
const WIDE = 0.25;
const NARROW = 0.75;
/** Metres between the points tried along a straight line. */
const SAMPLE = 0.5;

// Directions in a ring, odd ones diagonal. The opposite of d is d + 4.
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DZ = [0, 1, 1, 1, 0, -1, -1, -1];

// Bits of a cell's state.
const KNOWN = 1;
const FREE = 2;
const NEAR_KNOWN = 4;
const NEAR_YES = 8;
const CLOSED = 16;

export class PathFinder {
  readonly world: CollisionWorld;
  body: Walker;
  /** Cells one search may expand. */
  budget = PATH_BUDGET;
  /** The last way found: `count` points in metres, the first where it began. */
  readonly x: number[] = [];
  readonly z: number[] = [];
  count = 0;
  /** Cells the last search expanded, and the cost of its way: 10 a metre straight, 14 diagonally. */
  expanded = 0;
  cost = 0;

  // The grid's corner, in whole metres.
  private ox = 0;
  private oz = 0;
  private readonly state = new Uint8Array(SIDE * SIDE);
  /** Per cell, for directions 0 to 3: bit d is set once the edge is known, and bit d + 4 if a body can pass. */
  private readonly edge = new Uint8Array(SIDE * SIDE);
  private readonly g = new Int32Array(SIDE * SIDE);
  private readonly from = new Int32Array(SIDE * SIDE);
  // The open list: a binary heap of cells, lowest key first. A key is cost so far plus estimate, then the estimate alone.
  private key = new Float64Array(4096);
  private cell = new Int32Array(4096);
  private open = 0;
  private readonly avoided = new Set<number>();
  private readonly trail: number[] = [];
  private readonly px: number[] = [];
  private readonly pz: number[] = [];

  constructor(world: CollisionWorld, body: Walker) {
    this.world = world;
    this.body = body;
  }

  /** Later searches treat the cell at (x, z) as not free, until `forget`. */
  avoid(x: number, z: number): void {
    this.avoided.add(Math.floor(x) * 65536 + Math.floor(z));
  }

  forget(): void {
    this.avoided.clear();
  }

  /** Fills `x`, `z` and `count` and returns a PATH_ value. */
  find(fromX: number, fromZ: number, toX: number, toZ: number): number {
    this.count = 0;
    this.expanded = 0;
    this.cost = 0;
    this.ox = Math.floor(fromX) - PATH_REACH;
    this.oz = Math.floor(fromZ) - PATH_REACH;
    this.state.fill(0);
    this.edge.fill(0);
    const start = this.nearest(fromX, fromZ, true);
    if (start < 0) return PATH_NONE;
    let gi = Math.floor(toX) - this.ox;
    let gj = Math.floor(toZ) - this.oz;
    let goal = -1;
    if (gi >= 0 && gj >= 0 && gi < SIDE && gj < SIDE) {
      goal = this.nearest(toX, toZ, false);
      if (goal < 0) return PATH_NONE;
      gi = goal % SIDE;
      gj = (goal - gi) / SIDE;
    }

    const g = this.g;
    const from = this.from;
    const state = this.state;
    g.fill(0x7fffffff);
    g[start] = 0;
    from[start] = -1;
    this.open = 0;
    this.push(start, 0, estimate(start % SIDE, Math.floor(start / SIDE), gi, gj));
    let end = -1;
    let best = start;
    let bestH = 0x7fffffff;
    while (this.open > 0 && this.expanded < this.budget) {
      const c = this.pop();
      if ((state[c]! & CLOSED) !== 0) continue;
      state[c] = state[c]! | CLOSED;
      this.expanded++;
      const i = c % SIDE;
      const j = (c - i) / SIDE;
      const h = estimate(i, j, gi, gj);
      if (h < bestH) {
        bestH = h;
        best = c;
      }
      if (c === goal || (goal < 0 && (i === 0 || j === 0 || i === SIDE - 1 || j === SIDE - 1))) {
        end = c;
        break;
      }
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d]!;
        const nj = j + DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= SIDE || nj >= SIDE) continue;
        const n = nj * SIDE + ni;
        if ((state[n]! & CLOSED) !== 0 || !this.free(n) || !this.passes(i, j, d)) continue;
        const cost = g[c]! + ((d & 1) !== 0 ? DIAGONAL : STRAIGHT) + (this.beside(ni, nj) ? BESIDE : 0);
        if (cost >= g[n]!) continue;
        g[n] = cost;
        from[n] = c;
        this.push(n, cost, estimate(ni, nj, gi, gj));
      }
    }
    const status = end < 0 ? PATH_SHORT : goal < 0 ? PATH_LEG : PATH_FOUND;
    if (end < 0) end = best;
    if (end === start && status !== PATH_FOUND) return PATH_NONE;
    this.cost = g[end]!;

    // The cells from the start to the end, then their middles as points, after where the body is.
    const trail = this.trail;
    trail.length = 0;
    for (let c = end; c >= 0; c = from[c]!) trail.push(c);
    const px = this.px;
    const pz = this.pz;
    px.length = pz.length = 0;
    px.push(fromX);
    pz.push(fromZ);
    for (let k = trail.length - 1; k >= 0; k--) {
      const i = trail[k]! % SIDE;
      px.push(this.ox + i + 0.5);
      pz.push(this.oz + (trail[k]! - i) / SIDE + 0.5);
    }
    // Then the goal itself, where a body can stand on it and walk to it from the last cell.
    if (status === PATH_FOUND && groundAt(this.world, this.body, toX, toZ) === GROUND_FREE && this.sight(px[px.length - 1]!, pz[pz.length - 1]!, toX, toZ)) {
      px.push(toX);
      pz.push(toZ);
    }
    this.straighten();
    return status;
  }

  /** True while a body at (x, z), bound for point `next` of the last way, can still walk the rest of it. */
  holds(next: number, x: number, z: number): boolean {
    const r = this.body.radius * NARROW;
    for (let k = next; k < this.count; k++) {
      if (!this.sight(x, z, this.x[k]!, this.z[k]!, r)) return false;
      x = this.x[k]!;
      z = this.z[k]!;
    }
    return true;
  }

  /** Whether a body of radius `r` can walk the straight line from a to b. Where it starts is not tried. */
  sight(ax: number, az: number, bx: number, bz: number, r = this.body.radius): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const n = Math.ceil(Math.sqrt(dx * dx + dz * dz) / SAMPLE);
    for (let k = 1; k <= n; k++) {
      const x = ax + (dx * k) / n;
      const z = az + (dz * k) / n;
      if (groundAt(this.world, this.body, x, z, r) !== GROUND_FREE) return false;
      if (this.avoided.size > 0 && this.avoided.has(Math.floor(x) * 65536 + Math.floor(z))) return false;
    }
    return true;
  }

  /** Drops every point a wider body can walk straight past. The farthest point in sight is looked for as if sight, once lost, stayed lost. */
  private straighten(): void {
    const px = this.px;
    const pz = this.pz;
    const last = px.length - 1;
    const r = this.body.radius + WIDE;
    this.x.length = this.z.length = 0;
    this.x.push(px[0]!);
    this.z.push(pz[0]!);
    for (let a = 0; a < last; ) {
      let to = last;
      if (to > a + 1 && !this.sight(px[a]!, pz[a]!, px[to]!, pz[to]!, r)) {
        let lo = a + 1;
        while (to - lo > 1) {
          const mid = (lo + to) >> 1;
          if (this.sight(px[a]!, pz[a]!, px[mid]!, pz[mid]!, r)) lo = mid;
          else to = mid;
        }
        to = lo;
      }
      this.x.push(px[to]!);
      this.z.push(pz[to]!);
      a = to;
    }
    this.count = this.x.length;
  }

  private free(c: number): boolean {
    const s = this.state[c]!;
    if ((s & KNOWN) !== 0) return (s & FREE) !== 0;
    const i = c % SIDE;
    const x = this.ox + i;
    const z = this.oz + (c - i) / SIDE;
    const ok = groundAt(this.world, this.body, x + 0.5, z + 0.5) === GROUND_FREE && !this.avoided.has(x * 65536 + z);
    this.state[c] = s | KNOWN | (ok ? FREE : 0);
    return ok;
  }

  /** Whether any of the eight cells around (i, j) is not free, or cannot be stepped to: a thin wall may stand between two free cells. */
  private beside(i: number, j: number): boolean {
    const c = j * SIDE + i;
    const s = this.state[c]!;
    if ((s & NEAR_KNOWN) !== 0) return (s & NEAR_YES) !== 0;
    let yes = false;
    for (let d = 0; d < 8 && !yes; d++) {
      const ni = i + DX[d]!;
      const nj = j + DZ[d]!;
      yes = ni >= 0 && nj >= 0 && ni < SIDE && nj < SIDE && (!this.free(nj * SIDE + ni) || !this.passes(i, j, d));
    }
    this.state[c] = this.state[c]! | NEAR_KNOWN | (yes ? NEAR_YES : 0);
    return yes;
  }

  /** Whether a body can go from cell (i, j) to the free cell in direction `d`: the point between them is free, and no corner is cut. */
  private passes(i: number, j: number, d: number): boolean {
    // An edge is kept at the end from which its direction is one of the first four.
    if (d >= 4) {
      i += DX[d]!;
      j += DZ[d]!;
      d -= 4;
    }
    const c = j * SIDE + i;
    const e = this.edge[c]!;
    const bit = 1 << d;
    if ((e & bit) !== 0) return (e & (bit << 4)) !== 0;
    let ok = groundAt(this.world, this.body, this.ox + i + 0.5 + DX[d]! / 2, this.oz + j + 0.5 + DZ[d]! / 2) === GROUND_FREE;
    if (ok && (d & 1) !== 0) ok = this.free(c + DX[d]!) && this.free(c + DZ[d]! * SIDE);
    this.edge[c] = e | bit | (ok ? bit << 4 : 0);
    return ok;
  }

  /**
   * The free cell whose middle is nearest (x, z) and within NEAR metres of it, or -1. With `seen`, one a body at the point
   * can walk straight to comes first, so a start beside a wall is not moved to the wall's other side.
   */
  private nearest(x: number, z: number, seen: boolean): number {
    const ci = Math.floor(x) - this.ox;
    const cj = Math.floor(z) - this.oz;
    const own = cj * SIDE + ci;
    if (this.free(own)) return own;
    let best = -1;
    let bestD = 0;
    let bestSeen = false;
    for (let j = cj - NEAR; j <= cj + NEAR; j++) {
      for (let i = ci - NEAR; i <= ci + NEAR; i++) {
        if (i < 0 || j < 0 || i >= SIDE || j >= SIDE || !this.free(j * SIDE + i)) continue;
        const mx = this.ox + i + 0.5;
        const mz = this.oz + j + 0.5;
        const d = (mx - x) * (mx - x) + (mz - z) * (mz - z);
        if (d > NEAR * NEAR || (bestSeen && d >= bestD)) continue;
        // One in sight beats one that is not. Between two alike, the nearer wins.
        const inSight = seen && this.sight(x, z, mx, mz, this.body.radius * NARROW);
        if (best >= 0 && (inSight === bestSeen ? d >= bestD : bestSeen)) continue;
        best = j * SIDE + i;
        bestD = d;
        bestSeen = inSight;
      }
    }
    return best;
  }

  private push(c: number, cost: number, h: number): void {
    if (this.open === this.key.length) {
      const key = new Float64Array(this.open * 2);
      key.set(this.key);
      this.key = key;
      const cell = new Int32Array(this.open * 2);
      cell.set(this.cell);
      this.cell = cell;
    }
    // Both parts are under 2^21, so the key is exact.
    const k = (cost + h) * 2097152 + h;
    const key = this.key;
    const cell = this.cell;
    let at = this.open++;
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (key[up]! < k || (key[up] === k && cell[up]! < c)) break;
      key[at] = key[up]!;
      cell[at] = cell[up]!;
      at = up;
    }
    key[at] = k;
    cell[at] = c;
  }

  private pop(): number {
    const key = this.key;
    const cell = this.cell;
    const top = cell[0]!;
    const n = --this.open;
    const k = key[n]!;
    const c = cell[n]!;
    let at = 0;
    for (;;) {
      let down = at * 2 + 1;
      if (down >= n) break;
      if (down + 1 < n && (key[down + 1]! < key[down]! || (key[down + 1] === key[down] && cell[down + 1]! < cell[down]!))) down++;
      if (k < key[down]! || (k === key[down] && c < cell[down]!)) break;
      key[at] = key[down]!;
      cell[at] = cell[down]!;
      at = down;
    }
    key[at] = k;
    cell[at] = c;
    return top;
  }
}

/** The cost of the way from (i, j) to (gi, gj) over open ground, which no way undercuts. */
function estimate(i: number, j: number, gi: number, gj: number): number {
  const dx = i < gi ? gi - i : i - gi;
  const dz = j < gj ? gj - j : j - gj;
  return STRAIGHT * (dx + dz) - (2 * STRAIGHT - DIAGONAL) * (dx < dz ? dx : dz);
}
