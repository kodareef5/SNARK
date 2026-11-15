// Where a body may be put. Nodes join the collision world only round players, so a place is also tested against the nodes the
// map puts in chunks nobody has loaded, as they stand.

import { CHUNK_SIZE, chunkCount, type MapDims } from "../shared/coords.ts";
import { PAD, SKIN, capsuleFree, capsuleKind } from "../shared/world/collide.ts";
import type { NodeField, NodeSpot } from "../shared/world/nodes.ts";
import type { ServerWorld } from "./world.ts";

/** Chunks whose nodes, as the map places them, are kept for the places tested there. */
const NODE_CHUNKS = 256;

/** The nodes of chunks nobody has loaded, which the collision world does not hold. */
export class UnloadedNodes {
  /** Whether the node in a slot is used up. Harvest sets it; without it every node stands. */
  usedUp: ((chunk: number, index: number) => boolean) | null = null;
  private readonly field: NodeField;
  private readonly dims: MapDims;
  /**
   * The nodes of the last NODE_CHUNKS chunks tested, as the map places them: x, y, z, form, yaw and slot of each, a chunk to a
   * row. `mappedAt` is each chunk's row or -1. The row written longest ago is written next. Made at the first test.
   */
  private mapped: Float32Array | null = null;
  private mappedAt: Int32Array | null = null;
  private readonly mappedCount = new Uint16Array(NODE_CHUNKS);
  private readonly mappedChunk = new Int32Array(NODE_CHUNKS).fill(-1);
  private mappedNext = 0;
  private readonly spot: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
  /** Metres a node's boxes reach sideways from its origin, at most. */
  private readonly reach: number;

  constructor(dims: MapDims, field: NodeField) {
    this.dims = dims;
    this.field = field;
    let reach = 0;
    for (const s of field.store.spread) if (s > reach) reach = s;
    this.reach = reach;
  }

  /** Whether a capsule with its feet at (x, y, z), radius r and height h meets a node in a chunk nobody has loaded. */
  meets(x: number, y: number, z: number, r: number, h: number): boolean {
    const field = this.field;
    const dims = this.dims;
    const reach = r + this.reach + PAD;
    const forms = field.forms;
    const spread = field.store.spread;
    const per = field.source.perChunk * 6;
    for (let cz = Math.max(0, Math.floor((z - reach) / CHUNK_SIZE)); cz <= Math.min(dims.chunksZ - 1, Math.floor((z + reach) / CHUNK_SIZE)); cz++) {
      for (let cx = Math.max(0, Math.floor((x - reach) / CHUNK_SIZE)); cx <= Math.min(dims.chunksX - 1, Math.floor((x + reach) / CHUNK_SIZE)); cx++) {
        const chunk = cz * dims.chunksX + cx;
        if (field.isLoaded(chunk)) continue;
        const row = this.rowOf(chunk);
        const at = this.mapped!;
        for (let k = row * per, end = k + this.mappedCount[row]! * 6; k < end; k += 6) {
          const dx = x - at[k]!;
          const dz = z - at[k + 2]!;
          if (dx * dx + dz * dz >= reach * reach) continue;
          let form = at[k + 3]!;
          if (this.usedUp?.(chunk, at[k + 5]!)) form = forms.left[form]!;
          if (form === 0 || forms.soft[form] === 1) continue;
          // Most nodes reach far less than the widest banyan.
          const near = r + spread[form]! + PAD;
          if (dx * dx + dz * dz >= near * near) continue;
          if (capsuleKind(forms.parts, form, at[k]!, at[k + 1]!, at[k + 2]!, at[k + 4]!, x, y, z, r, h, SKIN)) return true;
        }
      }
    }
    return false;
  }

  /** The row of `mapped` that holds a chunk's nodes, written now if none does. */
  private rowOf(chunk: number): number {
    const field = this.field;
    const per = field.source.perChunk;
    this.mapped ??= new Float32Array(NODE_CHUNKS * per * 6);
    this.mappedAt ??= new Int32Array(chunkCount(this.dims)).fill(-1);
    let row = this.mappedAt[chunk]!;
    if (row >= 0) return row;
    row = this.mappedNext;
    this.mappedNext = (row + 1) % NODE_CHUNKS;
    const was = this.mappedChunk[row]!;
    if (was >= 0) this.mappedAt[was] = -1;
    this.mappedChunk[row] = chunk;
    this.mappedAt[chunk] = row;
    const spot = this.spot;
    const out = this.mapped;
    let n = 0;
    for (let i = 0, k = row * per * 6; i < per; i++) {
      field.source.at(chunk, i, spot);
      if (spot.kind === 0) continue;
      out[k++] = spot.x;
      out[k++] = spot.y;
      out[k++] = spot.z;
      out[k++] = spot.form;
      out[k++] = spot.yaw;
      out[k++] = i;
      n++;
    }
    this.mappedCount[row] = n;
    return row;
  }
}

/** Where a body may be put: capsuleFree, and clear of the nodes nobody has loaded. */
export function placeFree(world: ServerWorld, x: number, y: number, z: number, r: number, h: number): boolean {
  return capsuleFree(world, x, y, z, r, h) && !(world.unloaded?.meets(x, y, z, r, h) ?? false);
}
