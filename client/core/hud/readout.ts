// The lines at the top left under Diagnostics: place, speed, frame rate and the connection.

import { TICK_RATE } from "../../../shared/coords.ts";
import { latLonText } from "../../../shared/world/coords.ts";
import type { HudModel } from "../hud.ts";
import { K_BUTTON, K_PANEL, fitText } from "../ui/nodes.ts";
import { S_HUD_HIT, S_HUD_KEY, S_ICE, S_TEXT } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_READOUT = 1;
export const KEY_FIELD_TELEMETRY = 9180;

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
  compactReadout: string;
}

export function formatReadout(m: HudModel): void {
  m.compactReadout = `${Math.round(m.fps)} FPS    X ${m.x.toFixed(1)}   Y ${m.y.toFixed(1)}   Z ${m.z.toFixed(1)}`;
  m.readout[0] = `${latLonText(m.lat, m.lon)}  ${m.compass} ${m.heading.toFixed(0)}`;
  m.readout[1] = `x ${m.x.toFixed(1)}  y ${m.y.toFixed(1)}  z ${m.z.toFixed(1)}  ${m.speed.toFixed(1)} m/s`;
  m.readout[2] = `${m.fps.toFixed(0)} fps${m.steady}  ${m.pingMs.toFixed(0)} ms  ${m.corrections} corrections  ${m.nearby} nearby`;
}

export const READOUT: HudWidget<ReadoutModel> = {
  name: "readout",
  make: () => ({ pingMs: 0, fps: 0, steady: "", corrections: 0, nearby: 0, readout: ["", "", ""], readoutAge: 0, compactReadout: "" }),
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
    if (at.controls && !m.out && !m.bare) {
      const x = at.touch ? at.touch.topEnd + 2 : left;
      const y = at.touch ? at.touch.vitalsY : f.top + 37;
      const w = at.touch ? 32 : 26;
      if (x + w < (at.options.minimap ? at.mapX - 4 : at.right)) {
        const hit = f.add(KEY_FIELD_TELEMETRY, K_BUTTON, x, y, w, at.touch ? 32 : 21, S_HUD_HIT);
        hit.label = at.readout ? "Hide diagnostics" : "Show FPS and coordinates";
        hit.text = "⌁"; hit.interactive = true; hit.alpha = at.readout ? 1 : .76;
      }
    }
    if (at.readout && !at.inspect) {
      if (!m.compactReadout) formatReadout(m);
      const width = Math.min(245, readW);
      f.add(KEY_FIELD_TELEMETRY + 1, K_PANEL, left, top, width, 19, S_ICE).alpha = .09;
      f.text(KEY_READOUT, left + 4, top + 2, width - 8, S_HUD_KEY, fitText(m.compactReadout, width - 8, S_HUD_KEY));
    }
    if (at.readout && at.inspect) for (let i = 0; i < m.readout.length; i++) f.text(KEY_READOUT + i, left, top + i * lh, readW, S_TEXT, fitText(m.readout[i]!, readW, S_TEXT));
  },
};
