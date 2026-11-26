// The compass in the middle of the top, between what holds its corners, while the view is the body's own (ui/compass.ts draws it).

import { Compass, KEY_COMPASS, TAPE_HEIGHT, buildCompass, tapeLayout } from "../ui/compass.ts";
import { glass } from "../ui/skin.ts";
import { lineHeight } from "../ui/nodes.ts";
import { S_LABEL } from "../ui/style.ts";
import { band, type HudWidget } from "./widget.ts";

export interface CompassModel {
  /** The compass at the top of the screen and the arrow on the maps: the heading as shown, on its spring. */
  dial: Compass;
  /** Where the compass ends at the top of the screen, for what stands under it; 0 while it is not shown. */
  compassBottom: number;
}

export const COMPASS: HudWidget<CompassModel> = {
  name: "compass",
  bands: [band(KEY_COMPASS, 101)],
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
      let held = left - 8;
      if (touch) {
        const extra = Number(m.vitals[4]!.fraction < 1) + Number(m.vitals[5]!.fraction > 0);
        held = touch.topEnd + extra * touch.vitalPitch;
      } else {
        if (readout) held = Math.max(held, left + Math.min(right - left, 400));
        if (m.voice !== "") held = Math.max(held, left + Math.min(right - left, m.voice === m.voice.toUpperCase() ? 96 : 330));
        if (m.talkers.length > 0) held = Math.max(held, left + 170);
      }
      const width = touch ? Math.max(116 / f.unit, Math.min(222 / f.unit, f.width * .18)) : undefined;
      const tape = tapeLayout(f, held, options.minimap ? mapX - 2 : right - (mapTools ? 36 : 0) + 8, width);
      const degrees = inspect || options.diagnostics;
      if (tape) {
        tape.y = f.top + (touch ? 1 / f.unit : 2);
        if (!touch) {
          tape.width = Math.min(tape.width, 198);
          glass(f, KEY_COMPASS + 100, tape.x - tape.width / 2 - 4, tape.y - 1, tape.width + 8, TAPE_HEIGHT + 4, .5);
        }
        buildCompass(f, m, tape, degrees, !!touch);
        m.compassBottom = tape.y + (touch ? 17 / f.unit : TAPE_HEIGHT + 8) + (degrees ? lineHeight(S_LABEL) : 0);
      }
    }
  },
};
