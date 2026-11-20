// Navigation's core: what the character knows of the ground, and ways across it. The nav map is 2 m cells, filled from
// the map screen (coarse, drawn at the start, maybe fogged) and overwritten by what the character has seen up close
// (the terrain channel): seen ground is truth, so a wall the map does not show, or a bridge that is gone, is found by
// going there, and a route is planned again around it. Ways are found by A* with costs by how the character travels.

import type { MapChannel, TerrainChannel, Vec3 } from "./protocol.ts";

export const NAV_CELL = 2;
export const GROUND = 0, BLOCKED = 1, DEEP = 2, SHALLOW = 3, ROAD = 4, BRIDGE = 5, UNKNOWN = 255;

/** A map or terrain letter as a kind, by the legend's word for it. */
function kindOf(word: string | undefined): number {
  switch (word) {
    case "ground": case "walkable": case "floor": case "self": case "creature": case "player": case "bush": return GROUND;
    case "blocked": case "tree": case "rock": case "container": return BLOCKED;
    case "deep_water": return DEEP;
    case "shallow_water": return SHALLOW;
    case "road": return ROAD;
    case "bridge": return BRIDGE;
    default: return UNKNOWN;
  }
}

/** What a step onto each kind costs, a metre at a time, for one way of travelling; Infinity where it cannot go. */
export interface Costs {
  ground: number;
  road: number;
  bridge: number;
  shallow: number;
  deep: number;
  /** Unknown ground: a little more than ground when trekking (it is probably passable), the point when exploring. */
  unknown: number;
}

export const WALK: Costs = { ground: 1, road: 0.9, bridge: 1, shallow: 2.2, deep: 6, unknown: 1.6 };

export interface Danger {
  pos: Vec3;
  radius: number;
  cost: number;
}

export interface Route {
  /** Points to walk through, the last the goal. */
  points: Vec3[];
  /** Metres of the route on each kind, for telling the Director what the way is like. */
  metres: Record<string, number>;
  length: number;
  cost: number;
  /** The goal was not passable: the route ends at the nearest cell that is. */
  near: boolean;
}

const KIND_NAME: Record<number, string> = { [GROUND]: "ground", [BLOCKED]: "blocked", [DEEP]: "deep water", [SHALLOW]: "shallow water", [ROAD]: "road", [BRIDGE]: "bridge", [UNKNOWN]: "unknown" };

export class NavMap {
  x0 = 0;
  z0 = 0;
  w = 0;
  h = 0;
  kind = new Uint8Array(0);
  /** 1 where the character has seen the cell up close: that overrides the map. */
  seen = new Uint8Array(0);
  /** Cells found blocked by walking into them, which the terrain view may not show (a fence, a body of rock). */
  bumped = new Set<number>();

  private ensure(x0: number, z0: number, x1: number, z1: number): void {
    if (this.w && x0 >= this.x0 && z0 >= this.z0 && x1 <= this.x0 + this.w * NAV_CELL && z1 <= this.z0 + this.h * NAV_CELL) return;
    const nx0 = Math.floor(Math.min(x0, this.w ? this.x0 : x0) / NAV_CELL) * NAV_CELL;
    const nz0 = Math.floor(Math.min(z0, this.w ? this.z0 : z0) / NAV_CELL) * NAV_CELL;
    const nx1 = Math.max(x1, this.w ? this.x0 + this.w * NAV_CELL : x1), nz1 = Math.max(z1, this.h ? this.z0 + this.h * NAV_CELL : z1);
    const w = Math.ceil((nx1 - nx0) / NAV_CELL), h = Math.ceil((nz1 - nz0) / NAV_CELL);
    const kind = new Uint8Array(w * h).fill(UNKNOWN), seen = new Uint8Array(w * h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const k = (j + (this.z0 - nz0) / NAV_CELL) * w + i + (this.x0 - nx0) / NAV_CELL;
        kind[k] = this.kind[j * this.w + i]!;
        seen[k] = this.seen[j * this.w + i]!;
      }
    }
    const bumped = [...this.bumped].map((k) => {
      const i = k % this.w, j = Math.floor(k / this.w);
      return (j + (this.z0 - nz0) / NAV_CELL) * w + i + (this.x0 - nx0) / NAV_CELL;
    });
    Object.assign(this, { x0: nx0, z0: nz0, w, h, kind, seen, bumped: new Set(bumped) });
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / NAV_CELL), j = Math.floor((z - this.z0) / NAV_CELL);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  centre(k: number): Vec3 {
    return [this.x0 + ((k % this.w) + 0.5) * NAV_CELL, 0, this.z0 + (Math.floor(k / this.w) + 0.5) * NAV_CELL];
  }

  kindAt(x: number, z: number): number {
    const k = this.cellOf(x, z);
    return k < 0 ? UNKNOWN : this.bumped.has(k) ? BLOCKED : this.kind[k]!;
  }

  /** The map screen: fills every cell not seen up close. */
  fromMap(m: MapChannel): void {
    this.ensure(m.origin[0], m.origin[1], m.origin[0] + m.size[0] * m.cell, m.origin[1] + m.size[1] * m.cell);
    for (let r = 0; r < m.rows.length; r++) {
      const row = m.rows[r]!;
      for (let c = 0; c < row.length; c++) {
        const kind = kindOf(m.legend[row[c]!]);
        const ax = m.origin[0] + c * m.cell, az = m.origin[1] + r * m.cell;
        for (let z = az; z < az + m.cell; z += NAV_CELL) {
          for (let x = ax; x < ax + m.cell; x += NAV_CELL) {
            const k = this.cellOf(x + 0.5, z + 0.5);
            if (k >= 0 && !this.seen[k]) this.kind[k] = kind;
          }
        }
      }
    }
  }

  /** The ground seen up close: each nav cell takes what most of it is, blocked where a third of it is. */
  fromTerrain(t: TerrainChannel): void {
    const x1 = t.origin[0] + t.size[0] * t.cell, z1 = t.origin[1] + t.size[1] * t.cell;
    this.ensure(t.origin[0], t.origin[1], x1, z1);
    const tally = new Map<number, number[]>();
    for (let r = 0; r < t.rows.length; r++) {
      const row = t.rows[r]!;
      for (let c = 0; c < row.length; c++) {
        const x = t.origin[0] + c * t.cell, z = t.origin[1] + r * t.cell;
        const k = this.cellOf(x, z);
        if (k < 0) continue;
        const kind = kindOf(t.legend[row[c]!]);
        if (kind === UNKNOWN) continue;
        const n = tally.get(k) ?? [0, 0, 0, 0, 0, 0];
        n[kind]!++;
        tally.set(k, n);
      }
    }
    // At the nav map's own scale or coarser a single letter is the cell; finer, a cell needs two letters to say.
    const least = t.cell >= NAV_CELL ? 1 : 2;
    for (const [k, n] of tally) {
      const total = n.reduce((a, b) => a + b, 0);
      if (total < least) continue;
      // Trees and rocks are things the steering goes round; only solid ground (most of the cell) blocks the plan.
      this.kind[k] = n[BLOCKED]! * 2 >= total ? BLOCKED : n.indexOf(Math.max(...n));
      this.seen[k] = 1;
      if (this.kind[k] !== BLOCKED) this.bumped.delete(k);
    }
  }

  /** A cell found blocked by walking into it. */
  bump(x: number, z: number): void {
    const k = this.cellOf(x, z);
    if (k >= 0) this.bumped.add(k);
  }

  private cost(k: number, c: Costs): number {
    const base = this.kindCost(k, c);
    if (!isFinite(base)) return base;
    // Hugging a wall is where a body snags: ground next to blocked ground costs half as much again.
    const i = k % this.w, j = Math.floor(k / this.w);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj;
        if ((di || dj) && ni >= 0 && nj >= 0 && ni < this.w && nj < this.h && !isFinite(this.kindCost(nj * this.w + ni, c))) return base * 1.5;
      }
    }
    return base;
  }

  private kindCost(k: number, c: Costs): number {
    const kind = this.bumped.has(k) ? BLOCKED : this.kind[k]!;
    switch (kind) {
      case GROUND: return c.ground;
      case ROAD: return c.road;
      case BRIDGE: return c.bridge;
      case SHALLOW: return c.shallow;
      case DEEP: return c.deep;
      case UNKNOWN: return c.unknown;
      default: return Infinity;
    }
  }

  /** The cheapest way from one point to another, or null if there is none the character knows of. */
  route(from: Vec3, to: Vec3, c: Costs = WALK, dangers: Danger[] = []): Route | null {
    this.ensure(Math.min(from[0], to[0]) - 20, Math.min(from[2], to[2]) - 20, Math.max(from[0], to[0]) + 20, Math.max(from[2], to[2]) + 20);
    const start = this.cellOf(from[0], from[2]);
    let goal = this.cellOf(to[0], to[2]);
    if (start < 0 || goal < 0) return null;
    const step = (k: number) => {
      let v = this.cost(k, c);
      if (!isFinite(v)) return v;
      for (const d of dangers) {
        const p = this.centre(k), dist = Math.hypot(p[0] - d.pos[0], p[2] - d.pos[2]);
        if (dist < d.radius) v += d.cost * (1 - dist / d.radius);
      }
      return v;
    };
    // A goal on blocked ground: the nearest passable cell to it.
    let near = false;
    if (!isFinite(this.kindCost(goal, c))) {
      near = true;
      let best = -1, bestD = Infinity;
      const gi = goal % this.w, gj = Math.floor(goal / this.w);
      for (let r = 1; r < 12 && best < 0; r++) {
        for (let dj = -r; dj <= r; dj++) {
          for (let di = -r; di <= r; di++) {
            const i = gi + di, j = gj + dj;
            if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
            const k = j * this.w + i;
            if (isFinite(this.kindCost(k, c)) && Math.hypot(di, dj) < bestD) (bestD = Math.hypot(di, dj)), (best = k);
          }
        }
      }
      if (best < 0) return null;
      goal = best;
    }
    const n = this.w * this.h;
    const g = new Float64Array(n).fill(Infinity), came = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const gx = goal % this.w, gz = Math.floor(goal / this.w);
    const hcost = (k: number) => Math.hypot((k % this.w) - gx, Math.floor(k / this.w) - gz) * NAV_CELL * Math.min(c.road, c.ground, c.bridge);
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, hcost(start));
    while (heap.size) {
      const k = heap.pop();
      if (k === goal) break;
      if (closed[k]) continue;
      closed[k] = 1;
      const i = k % this.w, j = Math.floor(k / this.w);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
          const nk = nj * this.w + ni;
          if (closed[nk]) continue;
          const s = step(nk);
          if (!isFinite(s)) continue;
          // No cutting a corner between two blocked cells.
          if (di && dj && (!isFinite(this.kindCost(j * this.w + ni, c)) || !isFinite(this.kindCost(nj * this.w + i, c)))) continue;
          const ng = g[k]! + s * NAV_CELL * (di && dj ? Math.SQRT2 : 1);
          if (ng < g[nk]!) {
            g[nk] = ng;
            came[nk] = k;
            heap.push(nk, ng + hcost(nk));
          }
        }
      }
    }
    if (!isFinite(g[goal]!)) return null;
    const cells: number[] = [];
    for (let k = goal; k !== -1; k = came[k]!) cells.push(k);
    cells.reverse();
    const metres: Record<string, number> = {};
    for (let i = 1; i < cells.length; i++) {
      const name = KIND_NAME[this.kind[cells[i]!]!] ?? "ground";
      metres[name] = (metres[name] ?? 0) + NAV_CELL;
    }
    const points = this.smooth(cells, c, step).map((k) => this.centre(k));
    if (!near) points[points.length - 1] = [to[0], 0, to[2]];
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![2] - points[i - 1]![2]);
    const from0: Vec3 = [from[0], 0, from[2]];
    length += points.length ? Math.hypot(points[0]![0] - from0[0], points[0]![2] - from0[2]) : 0;
    return { points, metres, length: Math.round(length), cost: Math.round(g[goal]!), near };
  }

  /** Fewer, straighter legs: a cell is dropped when the line past it crosses only ground as cheap as the path's, by
   * the same step cost the search used (dangers included, or a straightened way would cut back through them). */
  private smooth(cells: number[], c: Costs, step: (k: number) => number): number[] {
    if (cells.length <= 2) return cells.slice(1);
    const out: number[] = [];
    let anchor = cells[0]!;
    for (let i = 1; i < cells.length; i++) {
      const next = cells[i + 1];
      if (next !== undefined && this.lineOk(anchor, next, c, step)) continue;
      out.push(cells[i]!);
      anchor = cells[i]!;
    }
    return out;
  }

  private lineOk(a: number, b: number, c: Costs, step: (k: number) => number = (k) => this.cost(k, c)): boolean {
    const pa = this.centre(a), pb = this.centre(b);
    const worst = Math.max(step(a), step(b), Math.min(c.ground, c.road));
    const n = Math.ceil(Math.hypot(pb[0] - pa[0], pb[2] - pa[2]) / (NAV_CELL / 2));
    for (let s = 1; s < n; s++) {
      const x = pa[0] + ((pb[0] - pa[0]) * s) / n, z = pa[2] + ((pb[2] - pa[2]) * s) / n;
      // The body is a body wide: the cells either side of the line must be passable too.
      for (const [ox, oz] of [[0, 0], [1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]] as const) {
        const k = this.cellOf(x + ox, z + oz);
        if (k < 0) return false;
        const v = step(k);
        if (!isFinite(v) || v > worst * 1.05) return false;
      }
    }
    return true;
  }

  /** Cells next to unknown ground that are themselves passable: where exploring goes next. */
  frontier(c: Costs = WALK): number[] {
    const out: number[] = [];
    for (let k = 0; k < this.kind.length; k++) {
      if (this.kind[k] === UNKNOWN || !isFinite(this.cost(k, c))) continue;
      const i = k % this.w, j = Math.floor(k / this.w);
      if ((i > 0 && this.kind[k - 1] === UNKNOWN) || (i < this.w - 1 && this.kind[k + 1] === UNKNOWN) ||
          (j > 0 && this.kind[k - this.w] === UNKNOWN) || (j < this.h - 1 && this.kind[k + this.w] === UNKNOWN)) out.push(k);
    }
    return out;
  }

  /** The cost of each cell under a route as it was planned, to tell later when the ground turned out dearer. */
  snapshot(points: Vec3[], start: Vec3, c: Costs = WALK): Map<number, number> {
    const out = new Map<number, number>();
    let a = start;
    for (const b of points) {
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]));
      for (let s = 0; s <= n; s++) {
        const k = this.cellOf(a[0] + ((b[0] - a[0]) * s) / (n || 1), a[2] + ((b[2] - a[2]) * s) / (n || 1));
        if (k >= 0) out.set(k, this.kindCost(k, c));
      }
      a = b;
    }
    return out;
  }

  /** Whether the next `within` metres of a route, from where the character is, cross ground much dearer than when the
   * route was planned: a bridge that turned out to be water, mud where the map showed ground. */
  dearerAhead(planned: Map<number, number>, pos: Vec3, rest: Vec3[], c: Costs = WALK, within = 25): boolean {
    let a = pos, gone = 0, extra = 0;
    for (const b of rest) {
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]));
      for (let s = 1; s <= n && gone < within; s++, gone++) {
        const k = this.cellOf(a[0] + ((b[0] - a[0]) * s) / n, a[2] + ((b[2] - a[2]) * s) / n);
        const was = planned.get(k);
        if (k < 0 || was === undefined) continue;
        const now = this.kindCost(k, c);
        if (!isFinite(now)) return true;
        if (now > was * 2) extra += now - was;
      }
      if (gone >= within) break;
      a = b;
    }
    return extra > 15;
  }

  /** What the rest of a route costs on the ground as now known, from point `from` on (sampled every metre). */
  costAlong(points: Vec3[], from: number, start: Vec3, c: Costs = WALK): number {
    let sum = 0, a = start;
    for (let i = from; i < points.length; i++) {
      const b = points[i]!;
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]));
      for (let s = 1; s <= n; s++) {
        const k = this.cellOf(a[0] + ((b[0] - a[0]) * s) / n, a[2] + ((b[2] - a[2]) * s) / n);
        sum += k < 0 ? 10 : Math.min(this.kindCost(k, c), 50);
      }
      a = b;
    }
    return sum;
  }

  /** Whether any of the route's next cells has turned out blocked since it was planned. */
  blockedAhead(points: Vec3[], from: number): boolean {
    for (let i = from; i < Math.min(points.length, from + 6); i++) {
      const a = i === from ? points[i]! : points[i - 1]!, b = points[i]!;
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / NAV_CELL) || 1;
      for (let s = 0; s <= n; s++) if (this.kindAt(a[0] + ((b[0] - a[0]) * s) / n, a[2] + ((b[2] - a[2]) * s) / n) === BLOCKED) return true;
    }
    return false;
  }
}

class MinHeap {
  private readonly keys: number[] = [];
  private readonly pri: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(k: number, p: number): void {
    this.keys.push(k);
    this.pri.push(p);
    let i = this.keys.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.pri[up]! <= this.pri[i]!) break;
      this.swap(i, up);
      i = up;
    }
  }

  pop(): number {
    const top = this.keys[0]!;
    const lk = this.keys.pop()!, lp = this.pri.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk;
      this.pri[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.pri[l]! < this.pri[m]!) m = l;
        if (r < this.keys.length && this.pri[r]! < this.pri[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.pri[a], this.pri[b]] = [this.pri[b]!, this.pri[a]!];
  }
}
