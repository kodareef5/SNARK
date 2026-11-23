// The meshes of break sets (fragments.ts), made when a set is first drawn and kept on the card while it is. One mesh
// serves every finish: a skin face is the instance's colour, its soffit the instance's second, a bared face the core's,
// and each vertex names its group, which the instance's bones place. No pack holds them.

import { RUIN_FINISHES } from "../../../content/ruins.ts";
import { VERTEX_BYTES } from "../../../shared/pack/pack.ts";
import { REGION_BASE } from "../../../shared/pack/palette.ts";
import { hullOf } from "../../../shared/world/convex.ts";
import type { BreakSet } from "../fragments.ts";
import { FAR_SLOTS, FAR_SPAN } from "./far.ts";
import type { FramePacket } from "./packet.ts";

/** Slots of fragment meshes on the card: the end of the far blocks' span (far.ts), which their count would reach after half a billion tiles. */
export const FRAGMENT_SLOT_SPAN = 4096;
export const FRAGMENT_SLOTS = FAR_SLOTS + FAR_SPAN - FRAGMENT_SLOT_SPAN;
export const fragmentSlot = (slot: number): boolean => slot >= FRAGMENT_SLOTS && slot < FRAGMENT_SLOTS + FRAGMENT_SLOT_SPAN;
/** Meshes kept on the card. The least lately drawn goes for a new one. */
export const MOST_MESHES = 96;
/** Meshes made in one frame, a third of a millisecond each. A set past them waits a frame. */
export const MAKES_A_FRAME = 8;
/** A break's bared core. */
export const CORE_COLOUR = RUIN_FINISHES.fracture.color;
/** A skin face whose unit normal is this far down or more is a soffit. */
const SOFFIT = -0.7;
const RESERVE = "fragments";

export interface FragmentMesh {
  /** Its indices, two bytes each, padded to a multiple of 4, then its vertices on a lattice within `bounds`. */
  readonly data: Uint8Array;
  readonly indexCount: number;
  readonly bounds: { readonly center: readonly number[]; readonly half: readonly number[] };
}

/** A set's mesh, in its piece's own frame: every face of every chunk, a vertex a corner of a face. */
export function fragmentMesh(set: BreakSet): FragmentMesh {
  const positions: number[] = [], colors: number[] = [], bones: number[] = [], indices: number[] = [];
  set.groups.forEach((group, g) => {
    for (const chunk of group) {
      const hull = hullOf({ corners: chunk.corners });
      if (typeof hull === "string") continue;
      hull.rings.forEach((ring, f) => {
        // The outward normal by Newell's sum: a ring goes round counter-clockwise seen from outside.
        let nx = 0, ny = 0, nz = 0;
        for (let k = 0; k < ring.length; k++) {
          const p = chunk.corners[ring[k]!]!, q = chunk.corners[ring[(k + 1) % ring.length]!]!;
          nx += (p[1] - q[1]) * (p[2] + q[2]);
          ny += (p[2] - q[2]) * (p[0] + q[0]);
          nz += (p[0] - q[0]) * (p[1] + q[1]);
        }
        const skin = ny < SOFFIT * Math.hypot(nx, ny, nz) ? REGION_BASE + 1 : REGION_BASE;
        const color = ((chunk.core >>> f) & 1) === 1 ? CORE_COLOUR : chunk.color !== 0 ? chunk.color : skin;
        const first = positions.length / 3;
        for (const c of ring) {
          const p = chunk.corners[c]!;
          positions.push(p[0], p[1], p[2]);
          colors.push(color);
          bones.push(g);
        }
        for (let k = 2; k < ring.length; k++) indices.push(first, first + k - 1, first + k);
      });
    }
  });
  const count = colors.length, center = [0, 0, 0], half = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    let lo = Infinity, hi = -Infinity;
    for (let v = 0; v < count; v++) {
      lo = Math.min(lo, positions[v * 3 + a]!);
      hi = Math.max(hi, positions[v * 3 + a]!);
    }
    center[a] = count > 0 ? (lo + hi) / 2 : 0;
    half[a] = count > 0 ? Math.max((hi - lo) / 2, 1e-3) : 1;
  }
  const at = (indices.length * 2 + 3) & ~3;
  const data = new Uint8Array(at + count * VERTEX_BYTES), view = new DataView(data.buffer);
  indices.forEach((i, k) => view.setUint16(k * 2, i, true));
  for (let v = 0; v < count; v++) {
    for (let a = 0; a < 3; a++) view.setInt16(at + v * VERTEX_BYTES + a * 2, Math.round(((positions[v * 3 + a]! - center[a]!) / half[a]!) * 32767), true);
    data[at + v * VERTEX_BYTES + 6] = colors[v]!;
    data[at + v * VERTEX_BYTES + 7] = bones[v]!;
  }
  return { data, indexCount: indices.length, bounds: { center, half } };
}

/** A mesh on the card. */
export interface HeldMesh {
  readonly slot: number;
  readonly bytes: number;
  readonly triangles: number;
  /** The frame it was last wanted in. */
  used: number;
}

interface CardBudget {
  spend(bytes: number): void;
  reserve(name: string, bytes: number): void;
}

/** The fragment meshes the card holds, by their sets' keys. */
export class FragmentMeshes {
  private readonly held = new Map<number, HeldMesh>();
  private readonly taken = new Uint8Array(FRAGMENT_SLOT_SPAN);
  private next = 0;
  private frame = 0;
  /** Sets wanted so far this frame. */
  wanted = 0;
  private made = 0;
  /** Bytes on the card, and what was last reserved for them. */
  bytes = 0;
  private reserved = 0;

  get count(): number {
    return this.held.size;
  }

  /** Before a frame's sets are wanted. */
  begin(): void {
    this.frame++;
    this.wanted = this.made = 0;
  }

  /**
   * Whether `set` may be drawn this frame, its mesh put on the card if it was not there: `most` sets a frame, the first
   * to ask. `mesh` is the pack mesh its upload names.
   */
  want(set: BreakSet, p: FramePacket, mesh: number, budget: CardBudget, most: number): boolean {
    let h = this.held.get(set.key);
    if (h?.used === this.frame) return true;
    if (this.wanted >= most) return false;
    if (!h) {
      if (this.made >= MAKES_A_FRAME || (this.held.size >= MOST_MESHES && !this.letGo(p))) return false;
      const made = fragmentMesh(set);
      this.made++;
      if (made.indexCount === 0) return false;
      while (this.taken[this.next] === 1) this.next = (this.next + 1) % FRAGMENT_SLOT_SPAN;
      const slot = FRAGMENT_SLOTS + this.next;
      this.taken[this.next] = 1;
      p.assetUploads.push({ slot, mesh, level: 0, data: made.data, indexCount: made.indexCount, indexBytes: 2, bounds: made.bounds });
      budget.spend(made.data.length);
      this.bytes += made.data.length;
      h = { slot, bytes: made.data.length, triangles: made.indexCount / 3, used: this.frame };
      this.held.set(set.key, h);
    }
    h.used = this.frame;
    this.wanted++;
    return true;
  }

  /** The mesh of the set of `key` if it was wanted this frame, which is on the card, or null. */
  drawn(key: number): HeldMesh | null {
    const h = this.held.get(key);
    return h && h.used === this.frame ? h : null;
  }

  /** After a frame's sets are wanted: the card's bytes are reserved. */
  end(budget: CardBudget): void {
    if (this.bytes !== this.reserved) budget.reserve(RESERVE, (this.reserved = this.bytes));
  }

  /** After a lost context the card holds none. */
  reset(): void {
    this.held.clear();
    this.taken.fill(0);
    this.bytes = 0;
  }

  /** Takes the mesh least lately wanted off the card, unless every one was wanted this frame. */
  private letGo(p: FramePacket): boolean {
    let oldest = -1, since = this.frame;
    for (const key of this.held.keys()) {
      const used = this.held.get(key)!.used;
      if (used < since) {
        since = used;
        oldest = key;
      }
    }
    if (oldest < 0) return false;
    const h = this.held.get(oldest)!;
    p.assetDrops.push(h.slot);
    this.taken[h.slot - FRAGMENT_SLOTS] = 0;
    this.bytes -= h.bytes;
    this.held.delete(oldest);
    return true;
  }
}
