// Where a survivor without a body chooses to rise: the map with every place on it, and the places listed with their waits.
// Why it chooses (it died, it arrived from another server, it travels from a bed) changes only the words. A row or a place on
// the map picks one, and the button asks to rise there. The server decides.

import { CHOOSE_ARRIVED, CHOOSE_TRAVEL, CMD_RESPAWN, SESSION_DEAD } from "../../../shared/net/protocol.ts";
import { TICK_RATE } from "../../../shared/coords.ts";
import { latLonText, latOf, lonOf } from "../../../shared/world/coords.ts";
import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { WHOLE_MAP } from "../tactical.ts";
import { IMAGE_MAP } from "./hud.ts";
import { K_BUTTON, K_IMAGE, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_FRAME, S_LABEL, S_MARK_DEATH, S_MARK_SELF, S_MARK_SPAWN, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_CHOOSE_PANEL = 900;
export const KEY_CHOOSE_TITLE = 901;
/** The line that says which place is picked and how long it waits. */
export const KEY_CHOOSE_NOTE = 902;
export const KEY_CHOOSE_RISE = 903;
export const KEY_CHOOSE_MAP = 904;
/** One for each row of the page shown. */
export const KEY_CHOOSE_ROW = 910;
/** Previous page, next page, and "page 2 of 5". */
export const KEY_CHOOSE_PAGE = 930;
/** One pin for each place, in the list's order. */
export const KEY_CHOOSE_PIN = 5000;
/** Places listed at once. */
const ROWS = 8;

/** What the screen says for each reason to choose: its title, and the button's words. */
const WORDS: Record<number, [string, string]> = {
  [CHOOSE_ARRIVED]: ["Arrive at", "Arrive here"],
  [CHOOSE_TRAVEL]: ["Travel to", "Travel here"],
};
const DIED_WORDS: [string, string] = ["Return to life at", "Return to life here"];

/** Seconds a place still waits, as the screen tells it: "" for none, else minutes and seconds. */
export function waitText(readyAt: number, tick: number): string {
  const s = Math.ceil((readyAt - tick) / TICK_RATE);
  return readyAt === 0 || s <= 0 ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class ChoosingScreen {
  page = 0;
  /** As of the last build. */
  pages = 1;
  /** The place picked, by its index in the list, or -1. */
  picked = -1;
  /** The list it was picked from, so a new list does not keep a pick of another place. */
  private pickedList = -1;
  /** Where the map was drawn at the last build, in interface units, and the part of the map it showed. */
  private readonly box = { x: 0, y: 0, size: 0, u0: 0, v0: 0, du: 1, dv: 1 };

  build(f: UiFrame, session: ClientSession, hud: HudModel | null): void {
    if (session.sessionState !== SESSION_DEAD) return;
    const points = session.respawnPoints;
    if (this.pickedList !== session.placesList) {
      this.pickedList = session.placesList;
      this.picked = -1;
    }
    this.pages = Math.max(1, Math.ceil(points.length / ROWS));
    if (this.page >= this.pages) this.page = this.pages - 1;
    const [title, rise] = WORDS[session.choosing] ?? DIED_WORDS;
    const tick = session.serverTick;
    const titleH = lineHeight(S_TITLE);
    const labelH = lineHeight(S_LABEL);
    const rowH = 30;
    const pad = 12;
    const listW = 260;
    const listH = titleH + 8 + ROWS * (rowH + 4) + (rowH + 4) + labelH + 8 + rowH;
    // The map beside the list where the window is wide enough, else above it.
    const wide = f.width >= listW + 220 + pad * 3 + 16;
    const size = Math.max(64, Math.floor(wide ? Math.min(f.height - 16 - pad * 2, f.width - listW - pad * 3 - 16) : Math.min(f.width - 16 - pad * 2, f.height - 16 - pad * 3 - listH)));
    const w = wide ? size + listW + pad * 3 : Math.max(size, listW) + pad * 2;
    const h = wide ? Math.max(size, listH) + pad * 2 : size + listH + pad * 3;
    const x = Math.round((f.width - w) / 2);
    const y = Math.round((f.height - h) / 2);
    f.add(KEY_CHOOSE_PANEL, K_PANEL, x, y, w, h, S_PANEL);
    const mx = x + pad;
    const my = y + pad;
    const picture = f.add(KEY_CHOOSE_MAP, K_IMAGE, mx, my, size, size, S_FRAME);
    picture.image = IMAGE_MAP;
    picture.interactive = true;
    const chart = hud?.chart ?? null;
    const view = chart ? chart.full.view : WHOLE_MAP;
    if (chart && hud) {
      // The whole map, so that every place is on it.
      chart.fullZoom = 0;
      chart.look(0.5, 0.5);
      chart.drawFull(session.tactical, session.tribe.team, Math.min(1024, Math.round(size * hud.scale)));
    }
    Object.assign(this.box, { x: mx, y: my, size, u0: view.u0, v0: view.v0, du: view.du, dv: view.dv });
    const hf = session.world?.hf ?? null;
    if (hf) {
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const px = (lonOf(hf, p.x) / 100 - view.u0) / view.du;
        const py = (latOf(hf, p.z) / 100 - view.v0) / view.dv;
        if (px < 0 || px > 1 || py < 0 || py > 1) continue;
        const half = i === this.picked ? 5 : 3;
        const style = i === this.picked ? S_MARK_DEATH : p.kind === 0 ? S_MARK_SPAWN : S_MARK_SELF;
        f.add(KEY_CHOOSE_PIN + i, K_PANEL, mx + px * size - half, my + py * size - half, half * 2, half * 2, style);
      }
    }
    const lx = wide ? mx + size + pad : x + pad;
    let ly = wide ? my : my + size + pad;
    const lw = wide ? listW : w - pad * 2;
    f.text(KEY_CHOOSE_TITLE, lx, ly, lw, S_TITLE, title);
    ly += titleH + 8;
    const first = this.page * ROWS;
    const rows = Math.min(ROWS, points.length - first);
    for (let i = 0; i < rows; i++) {
      const p = points[first + i]!;
      const b = f.add(KEY_CHOOSE_ROW + i, K_BUTTON, lx, ly + i * (rowH + 4), lw, rowH, S_BUTTON);
      const wait = waitText(p.readyAt, tick);
      b.text = `${first + i === this.picked ? "> " : ""}${p.name}${wait !== "" ? `  (${wait})` : ""}`;
      b.interactive = true;
    }
    ly += ROWS * (rowH + 4);
    if (this.pages > 1) {
      const prev = f.add(KEY_CHOOSE_PAGE, K_BUTTON, lx, ly, 44, rowH, S_BUTTON);
      prev.text = "<";
      prev.interactive = true;
      const next = f.add(KEY_CHOOSE_PAGE + 1, K_BUTTON, lx + lw - 44, ly, 44, rowH, S_BUTTON);
      next.text = ">";
      next.interactive = true;
      f.text(KEY_CHOOSE_PAGE + 2, lx + 52, ly + 8, lw - 104, S_LABEL, `page ${this.page + 1} of ${this.pages}`);
    }
    ly += rowH + 4;
    const p = points[this.picked];
    const wait = p ? waitText(p.readyAt, tick) : "";
    const note = !p ? "Pick a place on the map or in the list" : hf ? `${latLonText(latOf(hf, p.z), lonOf(hf, p.x))}${wait !== "" ? `, ready in ${wait}` : ""}` : wait;
    f.text(KEY_CHOOSE_NOTE, lx, ly, lw, S_LABEL, note);
    ly += labelH + 8;
    const go = f.add(KEY_CHOOSE_RISE, K_BUTTON, lx, ly, lw, rowH, S_BUTTON);
    go.text = rise;
    go.interactive = p !== undefined;
  }

  /** `x` and `y` are where the pointer went down, in interface units. Returns true if the key was one of this screen's. */
  click(key: number, x: number, y: number, session: ClientSession): boolean {
    if (session.sessionState !== SESSION_DEAD) return false;
    const points = session.respawnPoints;
    if (key === KEY_CHOOSE_PAGE || key === KEY_CHOOSE_PAGE + 1) {
      this.page = Math.max(0, Math.min(this.pages - 1, this.page + (key === KEY_CHOOSE_PAGE ? -1 : 1)));
      return true;
    }
    if (key === KEY_CHOOSE_RISE) {
      if (points[this.picked]) {
        const i = this.picked;
        session.command(CMD_RESPAWN, (w) => (w.u8(i), w.u8(session.placesList)));
      }
      return true;
    }
    if (key === KEY_CHOOSE_MAP) {
      // The place nearest the pointer, within a few pins' width.
      const hf = session.world?.hf;
      const b = this.box;
      let best = -1;
      let near = 12;
      for (let i = 0; hf && i < points.length; i++) {
        const px = b.x + ((lonOf(hf, points[i]!.x) / 100 - b.u0) / b.du) * b.size;
        const py = b.y + ((latOf(hf, points[i]!.z) / 100 - b.v0) / b.dv) * b.size;
        const d = Math.hypot(px - x, py - y);
        if (d < near) {
          near = d;
          best = i;
        }
      }
      if (best >= 0) this.pick(best);
      return true;
    }
    const row = key - KEY_CHOOSE_ROW;
    const i = this.page * ROWS + row;
    if (row < 0 || row >= ROWS || i >= points.length) return false;
    this.pick(i);
    return true;
  }

  private pick(i: number): void {
    this.picked = i;
    this.page = Math.floor(i / ROWS);
  }
}
