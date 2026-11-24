// Ways that climb: A* over 1 m cells whose nodes are a cell and a height a body stands at there, so a building's storeys, a
// stair flight, a ramp, a bridge deck and the ground under it are all nodes. A move is walked in sub-samples by the probes the
// movement step uses (collide.ts), so a way found is one a body can walk; deep water is swum at the float line. Costs are
// integers, heights float32 and ties broken by node, so the same world gives the same way on every engine.

import { capsuleFree, groundStands, groundUnder, nothingBuilt, restingAt, settleOnto, stepOnto, type CollisionWorld } from "./collide.ts";
import { frame, frameOf } from "./frame.ts";
import { PATH_FOUND, PATH_LEG, PATH_NONE, PATH_REACH, PATH_SHORT } from "./path.ts";
import { Found } from "./structures.ts";

/** What the search needs of a body. MoveParams has all of it. */
export interface Climber {
  readonly radius: number;
  readonly height: number;
  readonly slopeCos: number;
  readonly stepUp: number;
  readonly stepDown: number;
  readonly gravity: number;
}

const SIDE = 2 * PATH_REACH + 1;
/** The most nodes one search makes. A cell holds one for each storey reached. */
const MOST_NODES = 160000;
/** Two heights in one cell this near are one node: a body's height and a floor's thickness lie between any two storeys. */
const SAME = 0.6;
/** A fall a survivor lands from unhurt, from server/survival.ts's 12 m/s. */
const SAFE_LANDING = 12;
/** A swimmer floats with this share of its height under, leaves the water where less than SWIM_EXIT is, and swims above SWIM_ENTER (character.ts). */
const SWIM_FLOAT = 0.75;
const SWIM_EXIT = 0.55;
const SWIM_ENTER = 0.7;
const STRAIGHT = 10;
const DIAGONAL = 14;
/** A swum metre costs what walking 1.7 does: a survivor swims at 0.6 of its walk. */
const SWIM_COST = 1.7;
/** Shortcuts are walked by a body this much wider, so a way keeps off walls and the sides of flights. */
const WIDE = 0.15;
/** A goal nobody can stand on is reached within this many metres of it, as the ground finder moves one to a free cell. */
const GOAL_NEAR = 3;
/** Metres from a doorway's wall within which a cell's point may move onto the line through the doorway's middle. */
const DOOR_REACH = 2;
// Orthogonal directions first, so a diagonal is tried only between two that pass.
const DX = [1, 0, -1, 0, 1, -1, -1, 1];
const DZ = [0, 1, 0, -1, 1, 1, -1, -1];

export class LayeredFinder {
  readonly world: CollisionWorld;
  body: Climber;
  /** Nodes one search may expand. */
  budget = 20000;
  /** How much more the estimate counts than the cost so far: above 1 it finds a way sooner, not always the shortest. */
  weight = 1.5;
  /** Whether a way may swim. */
  swim = true;
  /**
   * Per structure kind, 1 for a wall with a doorway in its middle (Registry.doorway), or null. A cell beside one, whose middle
   * a body cannot stand in, stands on the line through the doorway's middle instead, as the ground's finder has it.
   */
  doorways: Uint8Array | null = null;
  /** The last way found: `count` points in metres, the first where it began, and whether each is swum. */
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly swum: boolean[] = [];
  count = 0;
  expanded = 0;
  cost = 0;
  /** Whether the last `walk` swam, or dropped further than a step down. */
  swam = false;
  fell = false;

  private ox = 0;
  private oz = 0;
  private readonly head = new Int32Array(SIDE * SIDE);
  private readonly cell = new Int32Array(MOST_NODES);
  private readonly ny = new Float32Array(MOST_NODES);
  private readonly g = new Int32Array(MOST_NODES);
  private readonly from = new Int32Array(MOST_NODES);
  private readonly next = new Int32Array(MOST_NODES);
  private readonly flags = new Uint8Array(MOST_NODES);
  private nodes = 0;
  private start = -1;
  private end = -1;
  private best = -1;
  private bestH = 0;
  private fromX = 0;
  private fromY = 0;
  private fromZ = 0;
  private toX = 0;
  private toY = NaN;
  private toZ = 0;
  private beyond = false;
  /** Metres from the goal a node may be and reach it. */
  private near = 1;
  private key = new Float64Array(4096);
  private heap = new Int32Array(4096);
  private open = 0;
  private readonly avoided = new Set<number>();
  /** Per cell, where a body stands in it, from its middle, once worked out (`placed`). Zero but beside a doorway. */
  private readonly offX = new Float32Array(SIDE * SIDE);
  private readonly offZ = new Float32Array(SIDE * SIDE);
  private readonly placed = new Uint8Array(SIDE * SIDE);
  private readonly doors = new Found();
  private readonly px: number[] = [];
  private readonly py: number[] = [];
  private readonly pz: number[] = [];
  private readonly ps: boolean[] = [];

  constructor(world: CollisionWorld, body: Climber) {
    this.world = world;
    this.body = body;
  }

  /** Later searches treat the cell at (x, z) as closed, until `forget`. */
  avoid(x: number, z: number): void {
    this.avoided.add(Math.floor(x) * 65536 + Math.floor(z));
  }

  forget(): void {
    this.avoided.clear();
  }

  /** Fills `x`, `y`, `z` and `count` and returns a PATH_ value. `toY` NaN takes the goal at whatever height it is reached. */
  find(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number): number {
    if (!this.begin(fromX, fromY, fromZ, toX, toY, toZ)) return PATH_NONE;
    this.run(this.budget);
    return this.finish();
  }

  /** Starts a search that `run` carries on. False if the start cannot be stood on. */
  begin(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number): boolean {
    this.count = this.expanded = this.cost = 0;
    this.nodes = 0;
    this.open = 0;
    this.end = -1;
    this.fromX = fromX;
    this.fromY = fromY;
    this.fromZ = fromZ;
    this.toX = toX;
    this.toY = toY;
    this.toZ = toZ;
    this.ox = Math.floor(fromX) - PATH_REACH;
    this.oz = Math.floor(fromZ) - PATH_REACH;
    const gi = Math.floor(toX) - this.ox;
    const gj = Math.floor(toZ) - this.oz;
    this.beyond = gi < 0 || gj < 0 || gi >= SIDE || gj >= SIDE;
    // A goal nobody can stand on, inside a pillar or a wall, is reached from any cell within a few metres of it.
    this.near = this.beyond || this.standable(toX, toY, toZ) ? 1 : GOAL_NEAR;
    this.head.fill(-1);
    this.placed.fill(0);
    const sc = (Math.floor(fromZ) - this.oz) * SIDE + (Math.floor(fromX) - this.ox);
    this.place(sc, fromY);
    let sy = this.walk(fromX, fromY, fromZ, this.pointX(sc), this.pointZ(sc));
    let swum = this.swam;
    if (Number.isNaN(sy)) {
      // Standing where the cell's middle is out of a straight step, it counts as standing there.
      sy = fromY;
      swum = false;
    }
    this.start = this.node(sc, sy, swum);
    if (this.start < 0) return false;
    this.g[this.start] = 0;
    this.from[this.start] = -1;
    this.best = this.start;
    this.bestH = this.estimate(this.start);
    this.push(this.start, this.bestH);
    return true;
  }

  /** Expands up to `cells` more nodes, and never more than `budget` in all. True once the search is over. */
  run(cells: number): boolean {
    if (this.start < 0) return true;
    const stop = Math.min(this.budget, this.expanded + cells);
    const ok = new Uint8Array(4);
    while (this.end < 0 && this.open > 0 && this.expanded < stop) {
      const k = this.pop();
      if ((this.flags[k]! & 1) !== 0) continue;
      this.flags[k] = this.flags[k]! | 1;
      this.expanded++;
      const c = this.cell[k]!;
      const i = c % SIDE;
      const j = (c - i) / SIDE;
      const h = this.estimate(k);
      if (h < this.bestH) {
        this.bestH = h;
        this.best = k;
      }
      if (this.reached(k, i, j)) {
        this.end = k;
        break;
      }
      const x = this.pointX(c);
      const z = this.pointZ(c);
      const y = this.ny[k]!;
      for (let d = 0; d < 8; d++) {
        if (d >= 4 && (ok[d - 4]! === 0 || ok[(d - 3) & 3]! === 0)) continue;
        if (d < 4) ok[d] = 0;
        const ni = i + DX[d]!;
        const nj = j + DZ[d]!;
        if (ni < 0 || nj < 0 || ni >= SIDE || nj >= SIDE) continue;
        const nc = nj * SIDE + ni;
        if (this.avoided.size > 0 && this.avoided.has((this.ox + ni) * 65536 + this.oz + nj)) continue;
        this.place(nc, y);
        const to = this.walk(x, y, z, this.pointX(nc), this.pointZ(nc));
        if (Number.isNaN(to) || (this.swam && !this.swim)) continue;
        if (d < 4) ok[d] = 1;
        const m = this.node(nc, to, this.swam);
        if (m < 0 || (this.flags[m]! & 1) !== 0) continue;
        const step = (d < 4 ? STRAIGHT : DIAGONAL) * (this.swam ? SWIM_COST : 1);
        const cost = this.g[k]! + Math.round(step);
        if (cost >= this.g[m]!) continue;
        this.g[m] = cost;
        this.from[m] = k;
        this.push(m, cost + this.estimate(m));
      }
    }
    return this.end >= 0 || this.open === 0 || this.expanded >= this.budget;
  }

  /** After `run` has said the search is over: fills the way and returns a PATH_ value, as `find` does. */
  finish(): number {
    if (this.start < 0) return PATH_NONE;
    let end = this.end;
    const status = end < 0 ? PATH_SHORT : this.beyond ? PATH_LEG : PATH_FOUND;
    if (end < 0) end = this.best;
    if (end === this.start && status !== PATH_FOUND) return PATH_NONE;
    this.cost = this.g[end]!;
    const trail: number[] = [];
    for (let k = end; k >= 0; k = this.from[k]!) trail.push(k);
    const { px, py, pz, ps } = this;
    px.length = py.length = pz.length = ps.length = 0;
    px.push(this.fromX);
    py.push(this.fromY);
    pz.push(this.fromZ);
    ps.push(false);
    for (let t = trail.length - 1; t >= 0; t--) {
      const k = trail[t]!;
      px.push(this.pointX(this.cell[k]!));
      py.push(this.ny[k]!);
      pz.push(this.pointZ(this.cell[k]!));
      ps.push((this.flags[k]! & 2) !== 0);
    }
    // Then the goal itself, where a body walks to it from the last cell at the goal's height.
    if (status === PATH_FOUND) {
      const last = px.length - 1;
      const y = this.walk(px[last]!, py[last]!, pz[last]!, this.toX, this.toZ);
      if (!Number.isNaN(y) && !this.fell && (Number.isNaN(this.toY) || Math.abs(y - this.toY) < 1.2)) {
        px.push(this.toX);
        py.push(y);
        pz.push(this.toZ);
        ps.push(this.swam);
      }
    }
    this.straighten();
    return status;
  }

  /** True while a body at (x, y, z), bound for point `next` of the last way, can still walk the rest of it at the way's heights. */
  holds(next: number, x: number, y: number, z: number): boolean {
    for (let k = next; k < this.count; k++) {
      const to = this.walk(x, y, z, this.x[k]!, this.z[k]!, this.body.radius * 0.75);
      if (Number.isNaN(to) || Math.abs(to - this.y[k]!) > 0.6) return false;
      x = this.x[k]!;
      y = this.y[k]!;
      z = this.z[k]!;
    }
    return true;
  }

  /**
   * The height a body standing at (ax, ay, az) arrives at walking straight to (bx, bz), or NaN if it cannot: a wall, a step
   * too tall, ground too steep, or a fall it would not land from unhurt. Sets `swam` and `fell`.
   */
  walk(ax: number, ay: number, az: number, bx: number, bz: number, r = this.body.radius): number {
    const p = this.body;
    const tan = Math.sqrt(1 / (p.slopeCos * p.slopeCos) - 1);
    const sub = Math.min(0.5, (0.9 * p.stepUp) / tan);
    const d = Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az));
    // Over bare ground, dry, with nothing built near the line or above it: the ground's own height, tried halfway and at the end.
    const w = this.world;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (d <= 1.5 && nothingBuilt(w, mx, mz, r + d / 2, ay - 4, ay + p.stepUp + p.height + 1)) {
      const hf = w.hf;
      const mid = groundUnder(hf, mx, mz, r);
      const midStands = groundStands(p.slopeCos);
      const end = groundUnder(hf, bx, bz, r);
      if (midStands && groundStands(p.slopeCos) && Math.abs(mid - ay) <= p.stepUp + (d / 2) * tan && Math.abs(end - mid) <= p.stepUp + (d / 2) * tan && hf.waterAt(mx, mz) - mid <= SWIM_ENTER * p.height && hf.waterAt(bx, bz) - end <= SWIM_ENTER * p.height) {
        this.swam = this.fell = false;
        return Math.fround(end);
      }
    }
    const n = Math.max(1, Math.ceil(d / sub));
    let y = ay;
    let x = ax;
    let z = az;
    let swam = false;
    let fell = false;
    for (let k = 1; k <= n; k++) {
      const nx = ax + ((bx - ax) * k) / n;
      const nz = az + ((bz - az) * k) / n;
      y = this.stepTo(x, z, nx, nz, y, d / n, r, swam);
      if (Number.isNaN(y)) return NaN;
      swam = this.swam;
      fell ||= this.fell;
      x = nx;
      z = nz;
    }
    this.swam = swam;
    this.fell = fell;
    return Math.fround(y);
  }

  /** One sub-sample of a walk, as the movement step takes it: from (px, pz) at height y to (x, z), `seg` metres on. */
  private stepTo(px: number, pz: number, x: number, z: number, y: number, seg: number, r: number, swimming: boolean): number {
    const w = this.world;
    const p = this.body;
    const hf = w.hf;
    const h = p.height;
    const tan = Math.sqrt(1 / (p.slopeCos * p.slopeCos) - 1);
    const safe = (SAFE_LANDING * SAFE_LANDING) / (2 * p.gravity);
    this.swam = false;
    this.fell = false;
    if (x < r || z < r || x > hf.sizeX - r || z > hf.sizeZ - r) return NaN;
    // Water deep enough is swum at the float line. A walker goes into it where nothing holds it above it; a swimmer stands
    // again where the bottom comes near enough the surface.
    const water = hf.waterAt(x, z);
    const bed = groundUnder(hf, x, z, r);
    const bedStands = groundStands(p.slopeCos);
    const deep = water - bed > (swimming ? SWIM_EXIT : SWIM_ENTER) * h;
    const float = water - SWIM_FLOAT * h;
    if (!swimming) {
      const on = this.stand(px, pz, x, z, y, seg, r, bed, bedStands, tan, safe);
      if (!deep || (!Number.isNaN(on) && on >= water - SWIM_ENTER * h)) return on;
      this.fell = false;
      if (y - float > safe) return NaN;
    } else if (!deep) return bedStands ? bed : NaN;
    if (!capsuleFree(w, x, float, z, r, h)) return NaN;
    this.swam = true;
    return float;
  }

  /** Where a walker at height y stands after a sub-sample: on the level, up a step or a slope, down a step or a ramp, or after a fall. */
  private stand(px: number, pz: number, x: number, z: number, y: number, seg: number, r: number, bed: number, bedStands: boolean, tan: number, safe: number): number {
    const w = this.world;
    const p = this.body;
    const h = p.height;
    const down = Math.max(p.stepDown, seg * tan);
    if (nothingBuilt(w, x, z, r, y - down - safe, y + p.stepUp + h)) {
      if (!bedStands || bed > y + p.stepUp) return NaN;
      if (bed < y - down) {
        if (y - bed > safe) return NaN;
        this.fell = true;
      }
      return bed;
    }
    if (capsuleFree(w, x, y, z, r, h)) {
      const on = restingAt(w, x, y, z, r, h, 0.02, p.slopeCos);
      if (!Number.isNaN(on)) return on;
      const low = settleOnto(w, x, z, y - down, y - p.stepDown, y, r, h, p.slopeCos);
      if (!Number.isNaN(low)) return low;
      // A drop: the first support below, looked for in steps shorter than a body, so no floor is passed over.
      for (let yy = y - 1.5; yy >= y - safe - 1.5; yy -= 1.5) {
        if (capsuleFree(w, x, yy, z, r, h)) continue;
        const land = settleOnto(w, x, z, yy, yy, yy + 1.5, r, h, p.slopeCos);
        if (Number.isNaN(land) || y - land > safe) return NaN;
        this.fell = true;
        return land;
      }
      return NaN;
    }
    const top = y + p.stepUp;
    if (!capsuleFree(w, px, top, pz, r, h) || !capsuleFree(w, x, top, z, r, h)) return NaN;
    return stepOnto(w, x, z, y, top, r, h, p.slopeCos);
  }

  private pointX(c: number): number {
    return this.ox + (c % SIDE) + 0.5 + this.offX[c]!;
  }

  private pointZ(c: number): number {
    return this.oz + Math.floor(c / SIDE) + 0.5 + this.offZ[c]!;
  }

  /** Works out where a body stands in cell `c`, reached at height y: its middle, or beside a doorway on the doorway's line. */
  private place(c: number, y: number): void {
    if (this.placed[c] === 1) return;
    this.placed[c] = 1;
    this.offX[c] = this.offZ[c] = 0;
    if (this.doorways === null) return;
    const p = this.body;
    const x = this.ox + (c % SIDE) + 0.5;
    const z = this.oz + Math.floor(c / SIDE) + 0.5;
    if (capsuleFree(this.world, x, y + p.stepUp, z, p.radius, p.height)) return;
    const structs = this.world.structs;
    const n = structs.query(x - DOOR_REACH, z - DOOR_REACH, x + DOOR_REACH, z + DOOR_REACH, this.doors, y - 1, y + p.height);
    for (let k = 0; k < n; k++) {
      const ref = this.doors.refs[k]!;
      const t = structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      if (this.doorways[t.kind[slot]!] !== 1) continue;
      // The doorway's middle runs along the piece's +Z, through its centre.
      frameOf(t.yaw[slot]!, t.twAt(slot));
      const dx = x - t.x[slot]!;
      const dz = z - t.z[slot]!;
      const along = dx * frame.sin + dz * frame.cos;
      const across = dx * frame.cos - dz * frame.sin;
      if (along > DOOR_REACH || along < -DOOR_REACH || across > 0.5 || across < -0.5) continue;
      const px = t.x[slot]! + along * frame.sin;
      const pz = t.z[slot]! + along * frame.cos;
      if (!capsuleFree(this.world, px, y + p.stepUp, pz, p.radius, p.height)) continue;
      this.offX[c] = px - x;
      this.offZ[c] = pz - z;
      return;
    }
  }

  /** The node of cell `c` at height `y`, made if there is none within SAME of it, or -1 when the search has made its most. */
  private node(c: number, y: number, swum: boolean): number {
    for (let k = this.head[c]!; k >= 0; k = this.next[k]!) if (Math.abs(this.ny[k]! - y) < SAME) return k;
    if (this.nodes === MOST_NODES) return -1;
    const k = this.nodes++;
    this.cell[k] = c;
    this.ny[k] = Math.fround(y);
    this.g[k] = 0x7fffffff;
    this.from[k] = -1;
    this.flags[k] = swum ? 2 : 0;
    this.next[k] = this.head[c]!;
    this.head[c] = k;
    return k;
  }

  /** Whether node `k` in cell (i, j) ends the search: the goal's cell at its height, or the grid's edge toward a goal beyond it. */
  private reached(k: number, i: number, j: number): boolean {
    if (this.beyond) return i === 0 || j === 0 || i === SIDE - 1 || j === SIDE - 1;
    const c = this.cell[k]!;
    const dx = this.pointX(c) - this.toX;
    const dz = this.pointZ(c) - this.toZ;
    if (dx * dx + dz * dz > this.near * this.near) return false;
    return Number.isNaN(this.toY) || Math.abs(this.ny[k]! - this.toY) < 1.2;
  }

  /** Whether a body can stand at (x, z), at height y or, for NaN, on the ground there. */
  private standable(x: number, y: number, z: number): boolean {
    const w = this.world;
    const p = this.body;
    const ground = groundUnder(w.hf, x, z, p.radius);
    const at = Number.isNaN(y) ? ground : y;
    if (!capsuleFree(w, x, at + 0.05, z, p.radius, p.height)) return false;
    if (Number.isNaN(y) || Math.abs(y - ground) < 0.1) return true;
    return !Number.isNaN(restingAt(w, x, at + 0.05, z, p.radius, p.height, 0.3, p.slopeCos));
  }

  /** Octile metres to the goal, or the run a climb to its height takes at the steepest walkable slope, whichever is more. */
  private estimate(k: number): number {
    const c = this.cell[k]!;
    const dx = Math.abs(this.pointX(c) - this.toX);
    const dz = Math.abs(this.pointZ(c) - this.toZ);
    const flat = STRAIGHT * (dx + dz) + (DIAGONAL - 2 * STRAIGHT) * Math.min(dx, dz);
    const p = this.body;
    const tan = Math.sqrt(1 / (p.slopeCos * p.slopeCos) - 1);
    const up = Number.isNaN(this.toY) ? 0 : (STRAIGHT * Math.max(0, this.toY - this.ny[k]!)) / tan;
    return Math.round(this.weight * Math.max(flat, up));
  }

  /** Drops every point a wider body walks straight past at the same heights, with no drop the way did not take. */
  private straighten(): void {
    const { px, py, pz, ps } = this;
    const last = px.length - 1;
    const r = this.body.radius + WIDE;
    const can = (a: number, b: number): boolean => {
      if (ps[a] !== ps[b]) return b === a + 1;
      const y = this.walk(px[a]!, py[a]!, pz[a]!, px[b]!, pz[b]!, r);
      return !Number.isNaN(y) && !this.fell && Math.abs(y - py[b]!) < 0.3;
    };
    this.x.length = this.y.length = this.z.length = this.swum.length = 0;
    this.x.push(px[0]!);
    this.y.push(py[0]!);
    this.z.push(pz[0]!);
    this.swum.push(ps[0]!);
    for (let a = 0; a < last; ) {
      let to = last;
      if (to > a + 1 && !can(a, to)) {
        let lo = a + 1;
        while (to - lo > 1) {
          const mid = (lo + to) >> 1;
          if (can(a, mid)) lo = mid;
          else to = mid;
        }
        to = lo;
      }
      this.x.push(px[to]!);
      this.y.push(py[to]!);
      this.z.push(pz[to]!);
      this.swum.push(ps[to]!);
      a = to;
    }
    this.count = this.x.length;
  }

  private push(k: number, f: number): void {
    if (this.open === this.key.length) {
      const key = new Float64Array(this.open * 2);
      key.set(this.key);
      this.key = key;
      const heap = new Int32Array(this.open * 2);
      heap.set(this.heap);
      this.heap = heap;
    }
    const v = f;
    const key = this.key;
    const heap = this.heap;
    let at = this.open++;
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (key[up]! < v || (key[up] === v && heap[up]! < k)) break;
      key[at] = key[up]!;
      heap[at] = heap[up]!;
      at = up;
    }
    key[at] = v;
    heap[at] = k;
  }

  private pop(): number {
    const key = this.key;
    const heap = this.heap;
    const top = heap[0]!;
    const n = --this.open;
    const v = key[n]!;
    const k = heap[n]!;
    let at = 0;
    for (;;) {
      let down = at * 2 + 1;
      if (down >= n) break;
      if (down + 1 < n && (key[down + 1]! < key[down]! || (key[down + 1] === key[down] && heap[down + 1]! < heap[down]!))) down++;
      if (v < key[down]! || (v === key[down] && k < heap[down]!)) break;
      key[at] = key[down]!;
      heap[at] = heap[down]!;
      at = down;
    }
    key[at] = v;
    heap[at] = k;
    return top;
  }
}
