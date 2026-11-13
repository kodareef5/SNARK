// What to call a creature that has just been tamed, or taken as young.
//
// The server says a creature is this survivor's; this asks for its name: a
// small panel with a field. Enter sends what was typed (nothing typed leaves
// it without a name), Escape leaves it as it is. If several are won at once
// they are asked about one after another.

import type { Registry } from "../../../shared/content/registry.ts";
import { CMD_NAME, MAX_NAME_BYTES } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { K_INPUT, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_INPUT, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_NAME_PANEL = 2460;
export const KEY_NAME_TITLE = 2461;
export const KEY_NAME_HINT = 2462;
export const KEY_NAME_INPUT = 2463;
/** In what the server says of a creature that is now this survivor's, the mark of one that was taken as young and not tamed. */
const CLAIMED = 255;

export class NamePrompt {
  /** The panel is up, asking about the first of those waiting. */
  open = false;
  text = "";

  /** Take up whatever has been tamed since the last frame. */
  absorb(session: ClientSession): void {
    if (!this.open && session.tamed.length > 0) {
      this.open = true;
      this.text = "";
    }
  }

  edit(value: string): void {
    this.text = value.slice(0, MAX_NAME_BYTES);
  }

  /** A key while the panel is up. Returns true if it was the panel's: Enter and Escape are; everything else is typing. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    if (!this.open) return false;
    if (code !== "Enter" && code !== "NumpadEnter" && code !== "Escape") return false;
    if (!down || repeat || !session) return true;
    const which = session.tamed.shift();
    const name = this.text.trim();
    if (which && code !== "Escape" && name !== "") session.command(CMD_NAME, (w) => (w.u32(which.handle), w.string(name)));
    this.open = false;
    this.text = "";
    return true;
  }

  build(f: UiFrame, session: ClientSession, reg: Registry): void {
    const which = session.tamed[0];
    if (!this.open || !which) {
      this.open = false;
      return;
    }
    const id = reg.ids[which.kind] ?? "";
    const what = id.slice(id.indexOf(":") + 1);
    const w = Math.min(f.width - 16, 380);
    const titleH = lineHeight(S_TITLE);
    const labelH = lineHeight(S_LABEL);
    const pad = 12;
    const fieldH = 28;
    const h = pad * 2 + titleH + labelH + 8 + fieldH;
    const x = Math.round((f.width - w) / 2);
    const y = Math.round(f.height * 0.3);
    f.add(KEY_NAME_PANEL, K_PANEL, x, y, w, h, S_PANEL);
    // One taken as young was not tamed: there is no "how well" to it.
    const young = which.te === CLAIMED;
    f.text(KEY_NAME_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, young ? `Yours: a young ${what}, level ${which.level}` : `Tamed: a ${what}, level ${which.level}`);
    f.text(KEY_NAME_HINT, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, young ? "It is hungry. Name it and press Enter." : `${which.te}% well. Name it and press Enter.`);
    const field = f.add(KEY_NAME_INPUT, K_INPUT, x + pad, y + pad + titleH + labelH + 8, w - pad * 2, fieldH, S_INPUT);
    field.text = this.text;
    field.interactive = true;
    field.focus = true;
  }
}
