// The line over the view while the server counts down to a stop for an update (S_RESTART): how long is left, and that
// the page will come back by itself (client/core/waiting.ts).

import { clockText } from "../waiting.ts";
import { K_PANEL } from "../ui/nodes.ts";
import { S_DARK, S_WARNING } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

export const KEY_RESTART = 3650;

export interface RestartModel {
  /** The line, or "" while no stop is said. */
  restart: string;
}

/** The line for a stop due at `at`, read at `now`, both in ms since 1970; "" for no stop. */
export function restartLine(at: number, now: number): string {
  return at <= 0 ? "" : `The server restarts in ${clockText(Math.max(0, at - now))} for an update. Stay on this page: you will be brought back.`;
}

export const RESTART: HudWidget<RestartModel> = {
  name: "restart",
  make: () => ({ restart: "" }),
  fill(m, c) {
    m.restart = restartLine(c.session.restartAt, Date.now());
  },
  build(f, m, at) {
    if (m.restart === "") return;
    // Under the top of the view, on a dark strip so it reads over sky and ground alike. A narrow screen gets the short of it.
    const width = Math.min(560, at.right - at.left - 20);
    const line = width < 500 ? m.restart.slice(0, m.restart.indexOf(" for an update")) + ". Stay here." : m.restart;
    const x = at.W / 2 - width / 2, y = 98;
    f.add(KEY_RESTART, K_PANEL, x - 10, y - 4, width + 20, 24, S_DARK).alpha = 0.62;
    f.text(KEY_RESTART + 1, x, y, width, S_WARNING, line);
  },
};
