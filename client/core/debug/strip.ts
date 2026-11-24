// The game's rate said against the display's, from the frame ring ("58 fps of 60"), and the frames late against the
// display over the last few seconds: what the bar shows first.

import type { FrameRing } from "../assets/frames.ts";
import { LATE } from "./ring.ts";

/** Seconds the worst frame is looked for over. */
const WORST_MS = 5000;

/**
 * What the strip says of `ring`'s frames: the display's interval (the target), the middle of the last two seconds' (the
 * rate the game runs at), and of the last WORST_MS before `nowMs` how many came and how many were late against the
 * display, the worst and how far back it is; the title and the line under it.
 */
export interface FrameStrip { target: number; middle: number; counted: number; late: number; worst: number; worstBack: number; title: string; line: string }

export function frameStrip(ring: FrameRing | null, nowMs: number): FrameStrip {
  const target = ring ? ring.target.ms : 1000 / 60, recent: number[] = [];
  let worst = 0, worstBack = -1, counted = 0, late = 0;
  if (ring) for (let back = 0; back < 600; back++) {
    const k = ring.row(back);
    if (k < 0 || nowMs - ring.at[k]! > WORST_MS) break;
    const v = ring.interval[k]!;
    // The first frame's interval runs from before the ring began.
    if (v <= 0) continue;
    if (back < 120) recent.push(v);
    counted++;
    if (v > LATE * target) late++;
    if (v > worst) {
      worst = v;
      worstBack = back;
    }
  }
  recent.sort((a, b) => a - b);
  const middle = recent[recent.length >> 1] ?? 0, hz = Math.round(1000 / target);
  return {
    target, middle, counted, late, worst, worstBack,
    title: middle > 0 ? `${Math.round(1000 / middle)} fps of ${hz} · ${middle.toFixed(1)} ms a frame` : `the display ${hz} Hz`,
    line: worstBack < 0 ? "" : `last ${WORST_MS / 1000} s: ${late} of ${counted} frames late, the worst ${worst.toFixed(1)} ms (${(worst / target).toFixed(1)} display intervals)`,
  };
}
