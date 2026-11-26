import type { OpenMap } from "./skyopen.ts";

/** Metres over the ground's floor (Heightfield minY) the map's heights reach: 16-bit steps of 3.1 cm. */
export const FAR_SPAN = 2048;
/**
 * Where a lookup is taken, in the map's cells: moved out across the ground along a surface's normal, and toward the
 * sun along its rays, so a wall meets the street before it and not its own building's cells, and the ground the cell
 * before its own. A wall stands in the outermost of its building's cells (cityTops fills a cell whose middle a piece
 * grown by half a cell reaches), within half a cell of its middle, so a cell and a half out leaves the filter's reach.
 */
export const FAR_OUT = 1.5;
export const FAR_LEAD = 1;
/** Metres a lookup is raised: half the coarsest step of a top (tactical.ts farTopByte), which may stand over what is drawn. */
export const FAR_RISE = 1;
/** The least of the sun's way along the ground a lookup's lead is divided by, so it stays finite with the sun overhead. */
export const FLAT_LEAST = 0.05;

/** A sweep asked of where levels are made: the solid heights and their ground, nothing else of the map. */
export interface SweepJob {
  readonly id: number;
  /** The grid's solid heights and the mean of its ground, `w` by `h` cells `cell` metres a side. */
  readonly solid: Uint16Array;
  readonly ground: Uint16Array;
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  /** The cells whose heights the sky's openness takes otherwise, a landmark's pieces left out, and those heights; null for none. */
  readonly bareAt: Uint32Array | null;
  readonly bareTo: Uint16Array | null;
  /** The layer's side, and the sun, or null for no map. */
  readonly size: number;
  readonly sun: readonly number[] | null;
  /** Whether the sky's openness is made too (skyopen.ts openMeasure). */
  readonly open: boolean;
}

export interface SweepMade {
  readonly id: number;
  readonly solid: Uint16Array;
  readonly ground: Uint16Array;
  /** The map, or null where no sun was sent, and how far its highest solid stands over its lowest, in metres. */
  readonly map: Uint16Array | null;
  readonly rise: number;
  readonly open: OpenMap | null;
}

/** Every buffer of a sweep or what it made, to move it to another thread rather than copy it. */
export function sweepBuffers(m: SweepJob | SweepMade): ArrayBuffer[] {
  const all = "map" in m ? [m.solid, m.ground, m.map, m.open?.bytes] : [m.solid, m.ground, m.bareAt, m.bareTo];
  return all.flatMap((a) => (a ? [a.buffer as ArrayBuffer] : []));
}
