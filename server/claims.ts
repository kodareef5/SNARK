// Where each team has built, on a grid of 16 m cells: how many pieces it has in a cell, and where its foundations and its
// pillars stand there. The enemy range and the structure cap are read from it, so neither reads a chunk's slots.
// Only a piece with an owner is in it. The store tells it of each one set down, gone or given to another team.

import { CHUNK_SIZE } from "../shared/coords.ts";
import { ROLE_FOUNDATION, ROLE_PILLAR } from "../shared/world/snap.ts";
import type { StructureStore } from "../shared/world/structures.ts";

/** Metres to a side of a cell. */
export const CLAIM_CELL = 16;
/** The structure cap counts the cells whose middle is within this many cells of the middle of the piece's own: 96 m. */
export const CAP_CELLS = 6;
const PER_CHUNK = CHUNK_SIZE / CLAIM_CELL;

export class Claims {
  /** Team entries and spots in use, which is what the grid costs past its cells: 20 bytes an entry, 16 a spot. */
  entries = 0;
  spots = 0;
  private readonly chunksX: number;
  private readonly cellsX: number;
  private readonly cellsZ: number;
  private readonly role: ArrayLike<number>;
  /** Per cell: its first entry + 1, or 0. */
  private readonly head: Int32Array;
  /** An entry is one team in one cell: the team, its pieces there, the next entry + 1, and its first foundation spot + 1 and pillar spot + 1. */
  private team = new Uint32Array(64);
  private count = new Uint32Array(64);
  private next = new Int32Array(64);
  private first = new Int32Array(128);
  private entryHigh = 0;
  private entryFree = 0;
  /** A spot is a place where foundations, or pillars, of one team have their middle, with how many do, and the next spot + 1. */
  private spotX = new Float32Array(64);
  private spotZ = new Float32Array(64);
  private spotN = new Uint32Array(64);
  private spotNext = new Int32Array(64);
  private spotHigh = 0;
  private spotFree = 0;
  private readonly totals = new Map<number, number>();
  /** The team last counted and its total, which `totals` is told once another team is counted: rows come by team in runs. */
  private team0 = 0;
  private total0 = 0;

  /** Counts what `structs` holds, and is told of every change to it from then on, in place of any grid made on it before. `role` is the registry's, by kind. */
  constructor(structs: StructureStore, role: ArrayLike<number>) {
    this.role = role;
    this.chunksX = structs.dims.chunksX;
    this.cellsX = structs.dims.chunksX * PER_CHUNK;
    this.cellsZ = structs.dims.chunksZ * PER_CHUNK;
    this.head = new Int32Array(this.cellsX * this.cellsZ);
    for (const chunk of structs.held) {
      const t = structs.chunks[chunk]!;
      // A chunk as the map placed it holds only pieces owned by nobody.
      if (t.differs === 0) continue;
      for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && t.owner[s] !== 0) this.put(t.kind[s]!, t.x[s]!, t.z[s]!, t.owner[s]!, 1);
    }
    structs.onOwned = (kind, x, z, owner, by) => this.put(kind, x, z, owner, by);
  }

  /** Bytes held, the room not yet used included. */
  get bytes(): number {
    return this.head.byteLength + this.team.byteLength + this.count.byteLength + this.next.byteLength + this.first.byteLength + this.spotX.byteLength + this.spotZ.byteLength + this.spotN.byteLength + this.spotNext.byteLength;
  }

  /** Pieces `team` owns on the whole map. */
  total(team: number): number {
    return team === this.team0 ? this.total0 : (this.totals.get(team) ?? 0);
  }

  /** Whether `team` owns a piece in `chunk`. */
  has(team: number, chunk: number): boolean {
    const x0 = (chunk % this.chunksX) * PER_CHUNK;
    const z0 = Math.floor(chunk / this.chunksX) * PER_CHUNK;
    for (let cz = z0; cz < z0 + PER_CHUNK; cz++) {
      for (let cx = x0; cx < x0 + PER_CHUNK; cx++) {
        for (let e = this.head[cz * this.cellsX + cx]!; e !== 0; e = this.next[e - 1]!) if (this.team[e - 1] === team) return true;
      }
    }
    return false;
  }

  /** Pieces of every team in the cells the structure cap counts around (x, z). */
  near(x: number, z: number): number {
    const cx = this.cell(x, this.cellsX);
    const cz = this.cell(z, this.cellsZ);
    let n = 0;
    for (let dz = -CAP_CELLS; dz <= CAP_CELLS; dz++) {
      if (cz + dz < 0 || cz + dz >= this.cellsZ) continue;
      for (let dx = -CAP_CELLS; dx <= CAP_CELLS; dx++) {
        if (cx + dx < 0 || cx + dx >= this.cellsX || dx * dx + dz * dz > CAP_CELLS * CAP_CELLS) continue;
        for (let e = this.head[(cz + dz) * this.cellsX + cx + dx]!; e !== 0; e = this.next[e - 1]!) n += this.count[e - 1]!;
      }
    }
    return n;
  }

  /** Whether a team other than `team` has a foundation with its middle under `foundation` metres from (x, z), or a pillar under `pillar` metres. */
  enemyNear(team: number, x: number, z: number, foundation: number, pillar: number): boolean {
    // The scan this replaced read no chunk for a place further off the map than the longer reach, so such a place has no enemy near.
    const far = Math.max(foundation, pillar);
    if (x - far >= this.cellsX * CLAIM_CELL || x + far < 0 || z - far >= this.cellsZ * CLAIM_CELL || z + far < 0) return false;
    return this.spotNear(team, x, z, 0, foundation) || this.spotNear(team, x, z, 1, pillar);
  }

  private spotNear(team: number, x: number, z: number, list: number, reach: number): boolean {
    const x0 = this.cell(x - reach, this.cellsX);
    const x1 = this.cell(x + reach, this.cellsX);
    const z0 = this.cell(z - reach, this.cellsZ);
    const z1 = this.cell(z + reach, this.cellsZ);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let e = this.head[cz * this.cellsX + cx]!; e !== 0; e = this.next[e - 1]!) {
          if (this.team[e - 1] === team) continue;
          for (let s = this.first[(e - 1) * 2 + list]!; s !== 0; s = this.spotNext[s - 1]!) {
            const dx = this.spotX[s - 1]! - x;
            const dz = this.spotZ[s - 1]! - z;
            if (dx * dx + dz * dz < reach * reach) return true;
          }
        }
      }
    }
    return false;
  }

  /** A place outside the map counts in the edge cell, as it is in the edge chunk. */
  private cell(v: number, cells: number): number {
    const c = Math.floor(v / CLAIM_CELL);
    return c < 0 ? 0 : c >= cells ? cells - 1 : c;
  }

  /** A piece of `kind` that `owner` owns, its middle at (x, z) as its row holds it, is set down (`by` 1) or goes (-1). */
  private put(kind: number, x: number, z: number, owner: number, by: number): void {
    const cell = this.cell(z, this.cellsZ) * this.cellsX + this.cell(x, this.cellsX);
    let before = 0;
    let e = this.head[cell]!;
    while (e !== 0 && this.team[e - 1] !== owner) {
      before = e;
      e = this.next[e - 1]!;
    }
    if (e === 0) {
      if (by < 0) throw new Error("a piece went that the claims never counted");
      e = this.entry();
      this.team[e - 1] = owner;
      this.next[e - 1] = this.head[cell]!;
      this.head[cell] = e;
    }
    const role = this.role[kind];
    if (role === ROLE_FOUNDATION || role === ROLE_PILLAR) this.root((e - 1) * 2 + (role === ROLE_PILLAR ? 1 : 0), x, z, by);
    if (owner !== this.team0) {
      if (this.team0 !== 0) this.settle();
      this.total0 = this.totals.get(owner) ?? 0;
      this.team0 = owner;
    }
    this.total0 += by;
    if ((this.count[e - 1]! += by) > 0) return;
    if (before === 0) this.head[cell] = this.next[e - 1]!;
    else this.next[before - 1] = this.next[e - 1]!;
    this.next[e - 1] = this.entryFree;
    this.entryFree = e;
    this.entries--;
  }

  /** Writes the last team's total to `totals`, which forgets a team with none. */
  private settle(): void {
    if (this.total0 === 0) this.totals.delete(this.team0);
    else this.totals.set(this.team0, this.total0);
  }

  /** Adds a foundation or pillar at (x, z) to the list that starts at `first[at]`, or takes one away. */
  private root(at: number, x: number, z: number, by: number): void {
    let before = 0;
    let s = this.first[at]!;
    while (s !== 0 && (this.spotX[s - 1] !== x || this.spotZ[s - 1] !== z)) {
      before = s;
      s = this.spotNext[s - 1]!;
    }
    if (s === 0) {
      if (by < 0) throw new Error("a foundation or pillar went that the claims never counted");
      s = this.spot();
      this.spotX[s - 1] = x;
      this.spotZ[s - 1] = z;
      this.spotNext[s - 1] = this.first[at]!;
      this.first[at] = s;
    }
    if ((this.spotN[s - 1]! += by) > 0) return;
    if (before === 0) this.first[at] = this.spotNext[s - 1]!;
    else this.spotNext[before - 1] = this.spotNext[s - 1]!;
    this.spotNext[s - 1] = this.spotFree;
    this.spotFree = s;
    this.spots--;
  }

  /** A new entry + 1, with no pieces and no spots. */
  private entry(): number {
    this.entries++;
    let e = this.entryFree;
    if (e !== 0) this.entryFree = this.next[e - 1]!;
    else {
      if (this.entryHigh === this.team.length) {
        this.team = grown(this.team);
        this.count = grown(this.count);
        this.next = grown(this.next);
        this.first = grown(this.first);
      }
      e = ++this.entryHigh;
    }
    this.count[e - 1] = this.first[(e - 1) * 2] = this.first[(e - 1) * 2 + 1] = 0;
    return e;
  }

  /** A new spot + 1, with nothing at it. */
  private spot(): number {
    this.spots++;
    let s = this.spotFree;
    if (s !== 0) this.spotFree = this.spotNext[s - 1]!;
    else {
      if (this.spotHigh === this.spotX.length) {
        this.spotX = grown(this.spotX);
        this.spotZ = grown(this.spotZ);
        this.spotN = grown(this.spotN);
        this.spotNext = grown(this.spotNext);
      }
      s = ++this.spotHigh;
    }
    this.spotN[s - 1] = 0;
    return s;
  }
}

/** A copy of `a` with twice the room. */
function grown<T extends Uint32Array | Int32Array | Float32Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}
