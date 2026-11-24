// The travel list: the other servers of this one's cluster, opened with the use key at an obelisk's terminal, as ARK's
// "Travel to another server" is. With the session in the world a click asks to leave for one from that terminal; once the
// session is closed, as when a server turned the survivor away, a click goes to that server's page.

import { CMD_TRAVEL } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import type { ClusterList, ClusterServer } from "../travel.ts";
import { K_BUTTON, K_PANEL, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_TRAVEL_PANEL = 6000;
export const KEY_TRAVEL_TITLE = 6001;
export const KEY_TRAVEL_NOTE = 6002;
/** One for each server, then a line under each that says why it cannot be gone to. */
export const KEY_TRAVEL_BUTTON = 6010;
export const KEY_TRAVEL_WHY = 6040;
/** Servers listed at once. */
const TRAVEL_ROWS = 12;
/** Milliseconds between two asks of the server for the list while it is open. */
export const TRAVEL_REFRESH_MS = 3000;

export class TravelScreen implements Screen {
  readonly name = "travel";
  readonly layer = "modal";
  readonly group = "bag";
  readonly bands = [{ from: KEY_TRAVEL_PANEL, count: 100 }];
  open = false;
  /** Null until the server has answered. */
  list: ClusterList | null = null;
  /** A line under the title: what was asked, or what went wrong. */
  note = "";
  /** Chosen while the session was closed: the page goes to it. */
  goTo: ClusterServer | null = null;
  /** When the list was last asked for. */
  askedAt = -Infinity;
  /** The terminal it was opened at, which the server checks the survivor stands at. */
  at = -1;

  /** Opens the list at terminal `ref`. */
  openAt(ref: number): void {
    this.open = true;
    this.at = ref;
    this.note = "";
    this.askedAt = -Infinity;
  }

  isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.open = false;
  }

  build(f: UiFrame, c: ScreenCtx): void {
    const session = c.session;
    if (!session) return;
    const servers = this.list?.servers ?? [];
    const rows = Math.min(TRAVEL_ROWS, servers.length);
    const w = 420;
    const rowH = 34;
    const h = 84 + rows * (rowH + 24) + 8;
    const x = Math.round((f.width - w) / 2);
    const y = Math.round(f.height * 0.2);
    const away = session.state === "closed";
    f.add(KEY_TRAVEL_PANEL, K_PANEL, x, y, w, h, S_PANEL);
    f.text(KEY_TRAVEL_TITLE, x + 16, y + 14, w - 32, S_TITLE, away ? "Go to a server of the cluster" : "Travel to another server");
    const note = this.note !== "" ? this.note : !this.list ? "asking the server" : this.list.world === 0 ? "this server is not part of a cluster" : rows === 0 ? "no other server of the cluster is running" : away ? "" : "you go with all you carry; your base and your tames stay";
    f.text(KEY_TRAVEL_NOTE, x + 16, y + 48, w - 32, S_LABEL, note);
    for (let i = 0; i < rows; i++) {
      const s = servers[i]!;
      const top = y + 76 + i * (rowH + 24);
      const b = f.add(KEY_TRAVEL_BUTTON + i, K_BUTTON, x + 16, top, w - 32, rowH, S_BUTTON);
      b.text = `${s.name} (${s.map}), ${s.players} of ${s.max}`;
      b.interactive = away || s.why === "";
      if (!away && s.why !== "") f.text(KEY_TRAVEL_WHY + i, x + 16, top + rowH + 2, w - 32, S_LABEL, s.why);
    }
  }

  pointer(kind: number, key: number, _x: number, _y: number, _button: number, c: ScreenCtx): boolean {
    return kind === 0 && c.session !== null && this.click(key, c.session);
  }

  /** Returns true if the key was one of this screen's buttons. */
  click(key: number, session: ClientSession): boolean {
    const row = key - KEY_TRAVEL_BUTTON;
    const s = this.list?.servers[row];
    if (row < 0 || row >= TRAVEL_ROWS || !s) return false;
    if (session.state === "closed") this.goTo = s;
    else if (s.why === "") {
      session.command(CMD_TRAVEL, (w) => {
        w.u16(s.world);
        w.u32(this.at >>> 0);
      });
      this.note = `leaving for ${s.name}`;
    }
    return true;
  }
}
