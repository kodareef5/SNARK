// What the admin map draws of survivors at one moment: a frame. The live frame is made from the server's answer of now;
// any other source of where survivors were at a time makes the same frame, and the map draws it alike.

import type { SurvivorRow } from "../../../shared/admin.ts";

export const DOT_ONLINE = 0;
export const DOT_OFFLINE = 1;
export const DOT_DEAD = 2;
/** Knocked out, watching without a body, and gone with its body lingering: what the log tells besides. */
export const DOT_OUT = 3;
export const DOT_SPECTATING = 4;
export const DOT_AWAY = 5;

/** A survivor on the map: who, where in the world's metres, and how it is drawn (DOT_). */
export interface Dot {
  pid: number;
  name: string;
  team: number;
  x: number;
  z: number;
  state: number;
  /** The content id of what it sits on, or "". */
  riding: string;
  /** Where it had just been, oldest first, x and z by turns; the place it is at last. */
  tail?: number[];
}

export interface MapFrame {
  /** Wall ms the frame shows. */
  at: number;
  /** Whether it is now, as the server last said, or a moment past. */
  live: boolean;
  dots: Dot[];
}

/** The frame of now from the server's survivors: those online, and with `offline` those not, where they were last. */
export function liveFrame(at: number, rows: readonly SurvivorRow[], offline: boolean): MapFrame {
  const dots: Dot[] = [];
  for (const r of rows) {
    if (!r.online && !offline) continue;
    dots.push({ pid: r.pid, name: r.name, team: r.team, x: r.x, z: r.z, state: !r.online ? DOT_OFFLINE : r.dead ? DOT_DEAD : DOT_ONLINE, riding: r.riding });
  }
  return { at, live: true, dots: drawOrder(dots) };
}

/** The offline are drawn first, then those not up and about, and the living online last, over the rest. */
export function drawOrder(dots: Dot[]): Dot[] {
  const rank = (d: Dot): number => (d.state === DOT_OFFLINE ? 0 : d.state === DOT_ONLINE ? 2 : 1);
  return dots.sort((a, b) => rank(a) - rank(b));
}

/** The dot nearest the window's point (sx, sy) within `reach` pixels, by the given placing, or null. */
export function dotAt(frame: MapFrame, place: (d: Dot) => [number, number], sx: number, sy: number, reach: number): Dot | null {
  let best: Dot | null = null;
  let least = reach * reach;
  for (const d of frame.dots) {
    const [px, py] = place(d);
    const d2 = (px - sx) * (px - sx) + (py - sy) * (py - sy);
    if (d2 <= least) {
      least = d2;
      best = d;
    }
  }
  return best;
}
