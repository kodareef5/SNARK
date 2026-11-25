// The compass in the middle of the top, between what holds its corners, while the view is the body's own (ui/compass.ts draws it).

import { Compass, TAPE_HEIGHT, buildCompass, tapeLayout } from "../ui/compass.ts";
import { lineHeight } from "../ui/nodes.ts";
import { S_LABEL } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export interface CompassModel {
  /** The compass at the top of the screen and the arrow on the maps: the heading as shown, on its spring. */
  dial: Compass;
  /** Where the compass ends at the top of the screen, for what stands under it; 0 while it is not shown. */
  compassBottom: number;
}

export const COMPASS: HudWidget<CompassModel> = {
  name: "compass",
  make: () => ({ dial: new Compass(), compassBottom: 0 }),
  fill(m, c) {
    // Without a time the compass shows the heading as it is.
    if (c.nowMs === undefined) m.dial.set(m.heading);
    else m.dial.step(m.heading, c.nowMs);
  },
  build(f, m, at) {
    const { options, inspect, touch, left, right, readout, mapX, mapTools } = at;
    m.compassBottom = 0;
    if (options.compass && !m.bare && !m.out && !m.orbit && !((m.scope || m.visor) && m.banner === "")) {
      // What holds the top left: by touch the bar, else the readout and the voice's lines where they show.
      let held = touch ? touch.topEnd : left - 8;
      if (readout) held = Math.max(held, left + Math.min(right - left, 400));
      if (m.voice !== "") held = Math.max(held, left + Math.min(right - left, m.voice === m.voice.toUpperCase() ? 96 : 330));
      if (m.talkers.length > 0) held = Math.max(held, left + 170);
      const at = tapeLayout(f, held, options.minimap || touch ? mapX - 2 : right - (mapTools ? 36 : 0) + 8);
      const degrees = inspect || options.diagnostics;
      if (at) {
        at.y = f.top + 2;
        at.width = Math.min(at.width, touch ? 144 : 198);
        buildCompass(f, m, at, degrees);
        m.compassBottom = at.y + TAPE_HEIGHT + 8 + (degrees ? lineHeight(S_LABEL) : 0);
      }
    }
  },
};
