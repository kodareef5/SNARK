// A map as the page takes it in parts (shared/world/mapfile.ts). Before anything is drawn: its head, its landmarks'
// definitions, which the welcome's registry holds, and every overview, whose ground stands in for each sector's until it
// comes (shared/world/heightfield.ts). Then the ground of the sectors within reach of the body, which the first frame waits
// for and which come alone; then the rest of the ground nearest first, by where the body is and where it is heading, a few
// at once and ordered again at each ask, so a jump goes first to where it lands; and last the statics, all of them.

import { CHUNK_SIZE, chunkCount } from "../../shared/coords.ts";
import type { Def } from "../../shared/content/defs.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_STEP, blankLayers, setGround, setNodes, type GroundPiece, type MapContent, type MapHead, type MapPiece, type NodeLayer, type NodeList } from "../../shared/world/mapfile.ts";
import { MapWater } from "../../shared/world/water.ts";

/**
 * A map as a client holds it while its parts come: its ground, in which a sample not yet its sector's is its overview's,
 * its node layers, its water and its landmarks. Every overview is taken before anything reads it.
 */
export class StagedMap {
  readonly head: MapHead;
  readonly hf: Heightfield;
  readonly nodes: NodeLayer[];
  /** The landmarks the head places and the definitions the land part adds, or undefined where the head has none. */
  content: MapContent | undefined;
  private readonly grounds: GroundPiece[] = [];
  private readonly water: { readonly chunks: Uint32Array; readonly squares: Uint16Array }[] = [];

  constructor(head: MapHead) {
    this.head = head;
    this.hf = new Heightfield(head.dims, TERRAIN_CELL, head.minY, head.stepY);
    this.hf.seaLevel = head.seaLevel;
    this.hf.holdNone();
    this.nodes = blankLayers(head);
    this.content = head.landmarks ? { landmarks: head.landmarks, defs: [] } : undefined;
  }

  /** Takes in a part read: the land's definitions, an overview's ground, node pictures and water, or a sector's ground and its listed nodes. */
  take(piece: MapPiece): void {
    const { dims } = this.head;
    if (piece.kind === "land") {
      if (this.content) this.content = { landmarks: this.content.landmarks, defs: piece.defs as Def[] };
    } else if (piece.kind === "overview") {
      const sq = piece.sq;
      this.hf.fill(sq.cx0, sq.cz0, sq.cx1, sq.cz1, OVERVIEW_STEP, piece.heights, piece.tint);
      setNodes(dims, this.nodes, piece);
      if (piece.water) this.water.push(piece.water);
    } else if (piece.kind === "ground") {
      setGround(dims, this.hf.heights, this.hf.tint, piece);
      this.grounds.push(piece);
      this.head.layers.forEach((rule, k) => rule.type === 1 && piece.listed[k]!.count.some((n) => n > 0) && this.list(k));
      this.hf.hold(piece.sq.cx0, piece.sq.cz0, piece.sq.cx1, piece.sq.cz1);
    }
  }

  /** The water of every overview, once they have all come: as joinParts makes it (shared/world/mapfile.ts). */
  settle(): void {
    const { head } = this;
    if (!head.water) return;
    const side = CHUNK_SIZE / head.water.cell;
    const per = side * side;
    const held = this.water.flatMap((w) => [...w.chunks].map((c, k) => [c, w.squares.subarray(k * per, k * per + per)] as const)).sort((a, b) => a[0] - b[0]);
    const squares = new Uint16Array(held.length * per);
    held.forEach(([, s], k) => squares.set(s, k * per));
    this.hf.water = new MapWater(head.dims, head.minY, head.stepY, head.water.cell, head.water.bodies, Uint32Array.from(held, ([c]) => c), squares);
  }

  /** Listed layer `k`'s rows from the sectors' grounds come so far, chunk by chunk, set in the layer the node source reads. */
  private list(k: number): void {
    const { dims } = this.head;
    const chunks = chunkCount(dims);
    const of = (g: GroundPiece): number[] => {
      const out: number[] = [];
      for (let cz = g.sq.cz0; cz < g.sq.cz1; cz++) for (let cx = g.sq.cx0; cx < g.sq.cx1; cx++) out.push(cz * dims.chunksX + cx);
      return out;
    };
    const first = new Uint32Array(chunks + 1);
    for (const g of this.grounds) of(g).forEach((c, i) => (first[c + 1] = g.listed[k]!.count[i]!));
    for (let c = 0; c < chunks; c++) first[c + 1]! += first[c]!;
    const n = first[chunks]!;
    const rows = { first, kind: new Uint8Array(n), x: new Uint16Array(n), z: new Uint16Array(n), yaw: new Uint16Array(n) };
    for (const g of this.grounds) {
      const from = g.listed[k]!;
      let r = 0;
      of(g).forEach((c, i) => {
        for (let e = 0; e < from.count[i]!; e++, r++) [rows.kind[first[c]! + e], rows.x[first[c]! + e], rows.z[first[c]! + e], rows.yaw[first[c]! + e]] = [from.kind[r]!, from.x[r]!, from.z[r]!, from.yaw[r]!];
      });
    }
    Object.assign(this.nodes[k] as NodeList, rows);
  }
}
