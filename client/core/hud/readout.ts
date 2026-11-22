// The lines at the top left under Diagnostics: place, speed, frame rate and the connection. The resource monitor's
// strip stands under them (ui/monitor.ts) and keeps its room here.

import { TICK_RATE } from "../../../shared/coords.ts";
import { latLonText } from "../../../shared/world/coords.ts";
import type { HudModel } from "../hud.ts";
import { fitText } from "../ui/nodes.ts";
import { S_TEXT } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_READOUT = 1;

export interface ReadoutModel {
  pingMs: number;
  fps: number;
  /** What the governor has done, after the frame rate, or "" (client/core/governor.ts). */
  steady: string;
  corrections: number;
  nearby: number;
  /** Lines at the top left, rewritten a few times a second. */
  readout: string[];
  readoutAge: number;
  /**
   * The room the resource monitor's strip takes under them (ui/monitor.ts), 0 high while it is off, and its top, which
   * the HUD sets. `stripAlone` has it stand in their place, where the canvas is too short for both.
   */
  stripW: number;
  stripH: number;
  stripY: number;
  stripAlone: boolean;
  /** On a narrow canvas the strip stands across under the minimap, out of the column: where it ends, or 0. */
  stripFoot: number;
}

export function formatReadout(m: HudModel): void {
  m.readout[0] = `${latLonText(m.lat, m.lon)}  ${m.compass} ${m.heading.toFixed(0)}`;
  m.readout[1] = `x ${m.x.toFixed(1)}  y ${m.y.toFixed(1)}  z ${m.z.toFixed(1)}  ${m.speed.toFixed(1)} m/s`;
  m.readout[2] = `${m.fps.toFixed(0)} fps${m.steady}  ${m.pingMs.toFixed(0)} ms  ${m.corrections} corrections  ${m.nearby} nearby`;
}

export const READOUT: HudWidget<ReadoutModel> = {
  name: "readout",
  make: () => ({ pingMs: 0, fps: 0, steady: "", corrections: 0, nearby: 0, readout: ["", "", ""], readoutAge: 0, stripW: 0, stripH: 0, stripY: 0, stripAlone: false, stripFoot: 0 }),
  fill(m, c) {
    m.pingMs = Math.max(0, (c.session.stats.rttTicks * 1000) / TICK_RATE);
    m.fps = c.fps;
    m.corrections = c.session.stats.corrections;
    m.nearby = c.remote.count;
    // Every sixth frame, with the governor's words as they were when the frame began.
    if (m.readoutAge++ % 6 === 0) formatReadout(m);
    if (c.frame) m.steady = c.frame.steady;
  },
  build(f, m, at) {
    const { left, top, lh, readW } = at;
    if (at.readout) for (let i = 0; i < m.readout.length; i++) f.text(KEY_READOUT + i, left, top + i * lh, readW, S_TEXT, fitText(m.readout[i]!, readW, S_TEXT));
  },
};
