// The crosshair and the held weapon's cone about it. The app's sight section fills the model (App.frame, App.fillSights).

import { K_PANEL } from "../ui/nodes.ts";
import { S_CROSS } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_CROSS = 30;
/** Four strokes about the crosshair at the held weapon's cone. */
export const KEY_CONE = 24;
/** The cone's strokes: their length, and how near the dot they come, in canvas units. */
const CONE_STROKE = 6;
const CONE_MIN = 5;

export interface CrosshairModel {
  /** The orbit camera is in use: the middle of the screen is not where the body aims, so no crosshair is drawn there. */
  orbit: boolean;
  /** The view is from behind a body on foot: a shot goes along the eye's line, not through the middle of the screen, so no crosshair is drawn. */
  behind: boolean;
  /**
   * The held weapon's cone about the crosshair, as a share of half the view's height (the tangent of the cone over that of
   * half the field of view), or -1 for nothing held that has one.
   */
  cone: number;
  /**
   * The view of a holo-scope fitted: its crosshair shows even unaimed and even where the rules hide the crosshair,
   * coloured by what it is on (`crossTint`, 0xRRGGBB, or -1 for the crosshair's own colour).
   */
  holo: boolean;
  crossTint: number;
}

export const CROSSHAIR: HudWidget<CrosshairModel> = {
  name: "crosshair",
  make: () => ({ orbit: false, behind: false, cone: -1, holo: false, crossTint: -1 }),
  build(f, m, at) {
    const { W, H } = at;
    // Through a scope its reticle (built under the rest) stands in for the crosshair. A holo-scope's crosshair shows whatever
    // the rules say of the crosshair, coloured by what it is on.
    if (!m.orbit && !m.behind && !((m.scope || m.visor) && m.banner === "") && (m.crosshair || (m.holo && m.banner === ""))) {
      const cross = f.add(KEY_CROSS, K_PANEL, W / 2 - 2, H / 2 - 2, 4, 4, S_CROSS);
      if (m.holo) cross.tint = m.crossTint;
      if (m.cone >= 0) {
        // The strokes stand where the cone's edge is on the screen, and never on the dot.
        const r = Math.min(H / 2 - CONE_STROKE, Math.max(CONE_MIN, (m.cone * H) / 2));
        f.add(KEY_CONE, K_PANEL, W / 2 - 1, H / 2 - r - CONE_STROKE, 2, CONE_STROKE, S_CROSS);
        f.add(KEY_CONE + 1, K_PANEL, W / 2 - 1, H / 2 + r, 2, CONE_STROKE, S_CROSS);
        f.add(KEY_CONE + 2, K_PANEL, W / 2 - r - CONE_STROKE, H / 2 - 1, CONE_STROKE, 2, S_CROSS);
        f.add(KEY_CONE + 3, K_PANEL, W / 2 + r, H / 2 - 1, CONE_STROKE, 2, S_CROSS);
      }
    }
  },
};
