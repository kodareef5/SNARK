// How many tree crowns stand between the eye and a point, counted from where the near node field puts the trees. A big
// tree's crown is an opaque mass under its leaves, so a dense wood is a wall: a cell of trees behind many crowns shows
// a few pixels through gaps, if any (tools/bench/grove.ts: cells behind eight or more crowns hold over a third of a
// wood's triangles and about 1% of its trees' pixels). The scene draws such a cell's trees at coarser levels.
//
// The count is read off a grid of 4 m squares over the near field, each with slabs of height over the ground: a crown is
// a disc round its trunk from a third of its tree's height to its top, and adds 2 / (pi r) to every square and slab it
// covers, so a straight line across a crown adds about 1 (a disc's mean chord is pi r / 2). The grid is made again when
// the field changes: a chunk taken or let go, a tree felled, grown back or crushed, or one hidden by a prediction.

import type { MapDims } from "../../../shared/coords.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { SIZE_UNITS } from "../../../shared/world/nodes.ts";
import type { StructureStore } from "../../../shared/world/structures.ts";

/** A square's side and a slab's height, in metres, and how many slabs a square holds: crowns up to 36 m tall. */
export const COVER_CELL = 4;
export const COVER_SLAB = 3;
export const COVER_SLABS = 12;
/** A form drawn as nothing (scene.ts HIDDEN). */
const NO_MESH = 0xffff;

/** What the grid needs of the scene: each form's mesh, size and whether it is a standing tree's, each mesh's extent. */
export interface CoverLooks {
  readonly meshOfForm: Uint16Array;
  readonly sizeOfForm: Uint8Array;
  /** 1 for the mesh of a standing tree. */
  readonly treeOf: Uint8Array;
  /** Per mesh, at its modelled size: how far it reaches sideways from its origin, and its lowest and highest point. */
  readonly side: Float32Array;
  readonly low: Float32Array;
  readonly high: Float32Array;
  /** Whether a node, chunk * 65536 + slot, is hidden by a prediction (Scene.hideNode). */
  hidden(ref: number): boolean;
}

/** How a cell's count makes its trees' levels coarser (Tier.nodes.cover). */
export interface CoverRule {
  /** Crowns in the way at which a cell is drawn as if twice as far. */
  readonly from: number;
  /** Crowns more for each doubling after that. */
  readonly per: number;
  /** The most times as far. */
  readonly most: number;
}

/** How many times as far as it stands a cell of trees behind `count` crowns is drawn. */
export function coverDistance(count: number, rule: CoverRule): number {
  return count < rule.from ? 1 : Math.min(rule.most, 2 ** (1 + (count - rule.from) / rule.per));
}

export class CrownCover {
  /** Per square, its slabs' crowns a metre; and the ground under the lowest crown over it, Infinity under none. */
  private weight = new Float32Array(0);
  private ground = new Float32Array(0);
  private x0 = 0;
  private z0 = 0;
  private nx = 0;
  private nz = 0;
  /** What the grid was made from: the store's shape count and held chunks; `stale` to make it again regardless. */
  private shapes = -1;
  private held = -1;
  stale = true;
  /** Crowns on the grid, for tests and the bench. */
  crowns = 0;

  private readonly dims: MapDims;

  constructor(dims: MapDims) {
    this.dims = dims;
  }

  /** Makes the grid again if the field has changed since it was made. True if it did. */
  update(store: StructureStore, looks: CoverLooks): boolean {
    if (!this.stale && store.shapes === this.shapes && store.held.length === this.held) return false;
    this.make(store, looks);
    this.shapes = store.shapes;
    this.held = store.held.length;
    this.stale = false;
    return true;
  }

  private make(store: StructureStore, looks: CoverLooks): void {
    // The held chunks' bounds, and a crown's reach past them.
    let cx0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cz1 = -Infinity;
    for (const chunk of store.held) {
      const cx = chunk % this.dims.chunksX, cz = Math.floor(chunk / this.dims.chunksX);
      cx0 = Math.min(cx0, cx);
      cz0 = Math.min(cz0, cz);
      cx1 = Math.max(cx1, cx);
      cz1 = Math.max(cz1, cz);
    }
    this.crowns = 0;
    if (cx0 > cx1) {
      this.nx = this.nz = 0;
      return;
    }
    const margin = 32;
    this.x0 = cx0 * CHUNK_SIZE - margin;
    this.z0 = cz0 * CHUNK_SIZE - margin;
    this.nx = Math.ceil(((cx1 - cx0 + 1) * CHUNK_SIZE + 2 * margin) / COVER_CELL);
    this.nz = Math.ceil(((cz1 - cz0 + 1) * CHUNK_SIZE + 2 * margin) / COVER_CELL);
    const squares = this.nx * this.nz;
    if (this.ground.length !== squares) {
      this.weight = new Float32Array(squares * COVER_SLABS);
      this.ground = new Float32Array(squares);
    }
    else this.weight.fill(0);
    this.ground.fill(Infinity);
    for (const chunk of store.held) {
      const t = store.chunks[chunk];
      if (!t) continue;
      for (let s = 0; s < t.high; s++) {
        const form: number = t.kind[s]!;
        if (form === 0) continue;
        const mesh = looks.meshOfForm[form]!;
        if (mesh === NO_MESH || looks.treeOf[mesh] !== 1 || looks.hidden(chunk * 65536 + s)) continue;
        const k = looks.sizeOfForm[form]! / SIZE_UNITS, r = (looks.side[mesh]! / Math.SQRT2) * k;
        if (!(r > 0)) continue;
        const top = looks.high[mesh]! * k, from = ((looks.high[mesh]! - Math.max(0, looks.low[mesh]!)) * k) / 3;
        this.add(t.x[s]!, t.y[s]!, t.z[s]!, r, from, top);
      }
    }
  }

  /** A crown round (x, z), its tree's foot at `foot`, covering `from` to `top` metres over it. */
  private add(x: number, foot: number, z: number, r: number, from: number, top: number): void {
    const w = 2 / (Math.PI * r);
    const s0 = Math.max(0, Math.floor(from / COVER_SLAB)), s1 = Math.min(COVER_SLABS - 1, Math.floor(top / COVER_SLAB));
    const i0 = Math.max(0, Math.floor((x - r - this.x0) / COVER_CELL)), i1 = Math.min(this.nx - 1, Math.floor((x + r - this.x0) / COVER_CELL));
    const j0 = Math.max(0, Math.floor((z - r - this.z0) / COVER_CELL)), j1 = Math.min(this.nz - 1, Math.floor((z + r - this.z0) / COVER_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = this.x0 + (i + 0.5) * COVER_CELL - x, dz = this.z0 + (j + 0.5) * COVER_CELL - z;
        if (dx * dx + dz * dz > r * r) continue;
        const sq = j * this.nx + i;
        for (let s = s0; s <= s1; s++) this.weight[sq * COVER_SLABS + s]! += w;
        this.ground[sq] = Math.min(this.ground[sq]!, foot);
      }
    }
    this.crowns++;
  }

  /**
   * About how many crowns the line from the eye (ex, ey, ez) to (tx, ty, tz) passes through, at a height inside them,
   * leaving out its last `short` metres seen from above, where the crowns of the point's own trees stand.
   */
  count(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number, short: number): number {
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const length = Math.hypot(dx, dz), end = length - short;
    if (end <= 0 || this.nx === 0) return 0;
    const step = COVER_CELL / 2;
    let sum = 0;
    for (let s = step / 2; s < end; s += step) {
      const f = s / length;
      const i = Math.floor((ex + dx * f - this.x0) / COVER_CELL), j = Math.floor((ez + dz * f - this.z0) / COVER_CELL);
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      const sq = j * this.nx + i, ground = this.ground[sq]!;
      if (ground === Infinity) continue;
      const slab = Math.floor((ey + dy * f - ground) / COVER_SLAB);
      if (slab >= 0 && slab < COVER_SLABS) sum += this.weight[sq * COVER_SLABS + slab]! * step;
    }
    return sum;
  }
}
