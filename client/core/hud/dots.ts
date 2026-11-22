// Laser dots on the screen (client/core/render/laser.ts). The app casts the beams and fills them (App.fillSights).

import { MAX_DOTS } from "../render/laser.ts";
import { K_PANEL } from "../ui/nodes.ts";
import { S_CROSS } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

/** One mark per laser dot, MAX_DOTS at most. */
export const KEY_DOT = 5010;
/** A laser's dot and its size, in canvas units. */
const LASER_RED = 0xff2a22;
const DOT = 4;

export interface DotsModel {
  /** As fractions of the screen. Only the first `dotCount` are current. */
  dots: { u: number; v: number; alpha: number }[];
  dotCount: number;
}

/** Laser dots lie on the world, so under everything else. */
export const DOTS: HudWidget<DotsModel> = {
  name: "laser dots",
  make: () => ({ dots: [], dotCount: 0 }),
  build(f, m, at) {
    const { W, H } = at;
    for (let i = 0; i < m.dotCount && i < MAX_DOTS; i++) {
      const d = m.dots[i]!;
      if (d.u < 0 || d.u > 1 || d.v < 0 || d.v > 1 || !(d.alpha > 0.02)) continue;
      const n = f.add(KEY_DOT + i, K_PANEL, d.u * W - DOT / 2, d.v * H - DOT / 2, DOT, DOT, S_CROSS);
      n.tint = LASER_RED;
      n.alpha = d.alpha;
    }
  },
};
