// A road's own frame on the ground, for drawing: at every second sample of the ground (4 m), where a carriageway runs
// near, how far across its centre line the point is, how far along it, how wide the carriageway is and how its lanes
// run. A map bakes it from its streets (tools/mapworld/road-frame.ts) and carries it in a road part for each sector a
// road runs in (mapfile.ts); a page holds those its terrain window reaches (client/core/mapload.ts) and draws a
// carriageway's wheel paths, oil and repairs by them (client/core/render/world-surfaces.ts). A server reads past them.

import { TERRAIN_CELL } from "./heightfield.ts";

/** Metres between the frame's samples: every second sample of the ground, as the ground's class has them. */
export const ROAD_CELL = 4;
export const ROAD_STEP = ROAD_CELL / TERRAIN_CELL;
/** Steps a metre of "across", the signed distance from the centre line, held from -15.875 to 15.875 m; 0 is no road. */
export const ROAD_ACROSS = 8;
/** Steps a metre of "along", the distance along the centre line from its piece's start, which wraps every ROAD_WRAP metres. */
export const ROAD_ALONG = 4;
export const ROAD_WRAP = 256 / ROAD_ALONG;
/** Steps a metre of a carriageway's half width. */
export const ROAD_HALF = 8;
/** The lanes byte: their number in its low three bits, then one way, then lanes numbered against "along", then how worn the road is. */
export const ROAD_ONE_WAY = 8;
export const ROAD_AGAINST = 16;
export const ROAD_WEAR_SHIFT = 5;
/** The frame's planes in a ground part, in this order, a byte each a sample. */
export const ROAD_PLANES = 4;

/** The frame's samples along an axis of `samples` ground samples, its ends among them. */
export const roadSamples = (samples: number): number => (samples - 1) / ROAD_STEP + 1;

export const roadAcross = (metres: number): number => Math.max(1, Math.min(255, Math.round(metres * ROAD_ACROSS) + 128));
export const roadAlong = (metres: number): number => Math.round((metres - Math.floor(metres / ROAD_WRAP) * ROAD_WRAP) * ROAD_ALONG) & 255;
export const roadHalf = (metres: number): number => Math.max(1, Math.min(255, Math.round(metres * ROAD_HALF)));
export const roadLanes = (lanes: number, oneWay: boolean, against: boolean, wear: number): number =>
  Math.max(1, Math.min(7, Math.round(lanes))) | (oneWay ? ROAD_ONE_WAY : 0) | (against ? ROAD_AGAINST : 0) | (Math.max(0, Math.min(7, wear)) << ROAD_WEAR_SHIFT);

/** A map's frame: its planes, a byte each a sample, row by row from z = 0, roadSamples of the ground's a row. */
export interface MapRoad {
  readonly across: Uint8Array;
  readonly along: Uint8Array;
  readonly half: Uint8Array;
  readonly lanes: Uint8Array;
}

/** Changes RoadSectors keeps, each its version and the cells it touched; one further back is all of them. */
const CHANGES_KEPT = 64;

/** A square of the frame held: its first cell, its width in cells, and ROAD_PLANES bytes a cell row by row. */
interface Held {
  readonly i0: number;
  readonly j0: number;
  readonly w: number;
  readonly d: number;
  readonly bytes: Uint8Array;
}

/**
 * The roads' frame a page draws from (Heightfield `road`): the sectors' its terrain window reaches, each as its road part
 * gave it and let go with it, or a whole map's as one square. Read a cell at a time (world-surfaces.ts roadFrameAt) and
 * copied a rectangle at a time into the terrain window's (gl.ts).
 */
export class RoadSectors {
  private readonly held = new Map<number, Held>();
  private last: Held | null = null;
  /** Counts each square that comes or goes, so what copied the frame knows to copy it again. */
  version = 0;
  /** The last CHANGES_KEPT changes, five numbers each: the version it made, and the cells i0, j0 up to i1, j1 of its square. */
  private readonly changes: number[] = [];

  private changed(h: Held): void {
    this.version++;
    if (this.changes.length >= CHANGES_KEPT * 5) this.changes.splice(0, 5);
    this.changes.push(this.version, h.i0, h.j0, h.i0 + h.w, h.j0 + h.d);
  }

  /**
   * The cells that can have changed since `version`, into `out` as i0, j0, i1, j1 a change (up to the cell past its
   * last); false where the changes kept do not reach back that far, and all are to be copied again.
   */
  changedSince(version: number, out: number[]): boolean {
    out.length = 0;
    if (version === this.version) return true;
    if (version > this.version || this.changes.length === 0 || this.changes[0]! > version + 1) return false;
    for (let k = 0; k < this.changes.length; k += 5) if (this.changes[k]! > version) out.push(this.changes[k + 1]!, this.changes[k + 2]!, this.changes[k + 3]!, this.changes[k + 4]!);
    return true;
  }

  /** Holds the frame's square `key`, its planes `road` from cell (i0, j0), `w` cells a row. */
  put(key: number, i0: number, j0: number, w: number, road: MapRoad): void {
    const n = road.across.length, bytes = new Uint8Array(n * ROAD_PLANES);
    for (let k = 0; k < n; k++) {
      bytes[k * ROAD_PLANES] = road.across[k]!;
      bytes[k * ROAD_PLANES + 1] = road.along[k]!;
      bytes[k * ROAD_PLANES + 2] = road.half[k]!;
      bytes[k * ROAD_PLANES + 3] = road.lanes[k]!;
    }
    const had = this.held.get(key), h = { i0, j0, w, d: n / w, bytes };
    this.held.set(key, h);
    this.last = null;
    if (had) this.changed(had);
    this.changed(h);
  }

  drop(key: number): void {
    const had = this.held.get(key);
    if (!had) return;
    this.held.delete(key);
    this.last = null;
    this.changed(had);
  }

  has(key: number): boolean {
    return this.held.has(key);
  }

  /** The bytes held. */
  get bytes(): number {
    let n = 0;
    for (const h of this.held.values()) n += h.bytes.length;
    return n;
  }

  /** Cell (i, j)'s planes into `out` from `at`; false, and nothing written, where no square held has it. */
  cell(i: number, j: number, out: Uint8Array, at: number): boolean {
    let h = this.last;
    if (!h || i < h.i0 || j < h.j0 || i >= h.i0 + h.w || j >= h.j0 + h.d) {
      h = null;
      for (const s of this.held.values()) if (i >= s.i0 && j >= s.j0 && i < s.i0 + s.w && j < s.j0 + s.d) h = s;
      if (!h) return false;
      this.last = h;
    }
    const k = ((j - h.j0) * h.w + i - h.i0) * ROAD_PLANES;
    for (let p = 0; p < ROAD_PLANES; p++) out[at + p] = h.bytes[k + p]!;
    return true;
  }

  /** The cells from (i, j), `w` by `d` of them, into `out` row by row, ROAD_PLANES bytes a cell, and none where no square held has them. */
  copy(i: number, j: number, w: number, d: number, out: Uint8Array): void {
    out.fill(0, 0, w * d * ROAD_PLANES);
    for (const h of this.held.values()) {
      const a0 = Math.max(i, h.i0), a1 = Math.min(i + w, h.i0 + h.w);
      if (a1 <= a0) continue;
      for (let b = Math.max(j, h.j0); b < Math.min(j + d, h.j0 + h.d); b++) {
        out.set(h.bytes.subarray(((b - h.j0) * h.w + a0 - h.i0) * ROAD_PLANES, ((b - h.j0) * h.w + a1 - h.i0) * ROAD_PLANES), ((b - j) * w + a0 - i) * ROAD_PLANES);
      }
    }
  }
}
