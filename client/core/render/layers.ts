// A body's hurt and decay layer as it is drawn (surface.ts `wounded`): the level its cues ask for, which a body in view
// reaches over a moment, so that a wound spreads from where it starts rather than appearing whole.

import { CUE_DEAD, CUE_DECAY_SHIFT, STAGE_WORST, type AnimState } from "../../../shared/anim/pose.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import type { RemoteSample } from "../session.ts";
import { LAYER_LEVELS, LAYER_STAGES } from "./surface.ts";

/** Stages a second a body's layer moves toward what its cues ask for. */
export const LAYER_RATE = 2.5;
/** LAYER_LEVELS in a stage. */
const STAGE = LAYER_LEVELS / LAYER_STAGES;
/** A body not drawn for this many frames is forgotten. */
const FORGET = 120;

/** The level, in LAYER_LEVELS, that a body's cues ask for: its hurt stage, or for a corpse the worst of it and then its decay. */
export function layerWanted(st: AnimState): number {
  return (st.dead ? STAGE_WORST + st.decay : st.hurt) * STAGE;
}

/** The same for a corpse whose cue word is `cue`: freshly dead where it has none. */
export function corpseWanted(cue: number | undefined): number {
  return (STAGE_WORST + (cue !== undefined && (cue & CUE_DEAD) !== 0 ? (cue >>> CUE_DECAY_SHIFT) & 3 : 0)) * STAGE;
}

const dead = new Map<number, number>();

/** The cue word of each body in view that is a corpse, by id. The map is the same one each call. */
export function corpseCues(remote: RemoteSample): ReadonlyMap<number, number> {
  dead.clear();
  for (let i = 0; i < remote.count; i++) if ((remote.cue[i]! & CUE_DEAD) !== 0) dead.set(remote.id[i]!, remote.cue[i]!);
  return dead;
}

export class Layers {
  /** Only bodies whose layer shows or is asked for. */
  private readonly shown = new Map<number, { level: number; tick: number; seen: number }>();
  private frame = 0;

  /**
   * The level to draw body `id` at, at `tick`, its cues asking for `wanted`. A body already in view moves toward it at
   * LAYER_RATE. One coming into view, not `known`, is drawn at it at once: its wounds are not news.
   */
  level(id: number, wanted: number, tick: number, known: boolean): number {
    let s = this.shown.get(id);
    if (!s) {
      if (wanted === 0) return 0;
      this.shown.set(id, (s = { level: known ? 0 : wanted, tick, seen: this.frame }));
    }
    const step = (Math.max(0, tick - s.tick) / TICK_RATE) * LAYER_RATE * STAGE;
    s.level = wanted > s.level ? Math.min(wanted, s.level + step) : Math.max(wanted, s.level - step);
    s.tick = tick;
    s.seen = this.frame;
    if (s.level === 0) this.shown.delete(id);
    return Math.round(s.level);
  }

  /** Called once a frame. */
  begin(): void {
    if (++this.frame % FORGET === 0) for (const [id, s] of this.shown) if (this.frame - s.seen > FORGET) this.shown.delete(id);
  }
}
