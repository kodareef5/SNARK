// Asks for the name of a creature the server says is now this survivor's. Enter sends the name, or nothing if none was typed.
// Escape leaves the creature as it is. Several creatures are asked about one after another.

import type { Registry } from "../../../shared/content/registry.ts";
import { CMD_NAME, MAX_NAME_BYTES } from "../../../shared/net/protocol.ts";
import type { ClientSession } from "../session.ts";
import { K_INPUT, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_INPUT, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_NAME_PANEL = 2460;
export const KEY_NAME_TITLE = 2461;
export const KEY_NAME_HINT = 2462;
export const KEY_NAME_INPUT = 2463;
/** The `te` the server sends for a creature claimed as young and not tamed. Matches CLAIMED in server/breeding.ts. */
const CLAIMED = 255;

/** The start of `text` that is no more than `most` bytes of UTF-8, with no character cut in two. */
function fitBytes(text: string, most: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes > most) break;
    end += ch.length;
  }
  return text.slice(0, end);
}

export class NamePrompt {
  /** While open, the panel asks about session.tamed[0]. */
  open = false;
  text = "";

  absorb(session: ClientSession): void {
    if (!this.open && session.tamed.length > 0) {
      this.open = true;
      this.text = "";
    }
  }

  edit(value: string): void {
    this.text = fitBytes(value, MAX_NAME_BYTES);
  }

  /** Returns true for Enter and Escape while the panel is up. Every other key is typing. */
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
    // A creature claimed as young was not tamed, so there is no "% well" to show.
    const young = which.te === CLAIMED;
    f.text(KEY_NAME_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, young ? `Yours: a young ${what}, level ${which.level}` : `Tamed: a ${what}, level ${which.level}`);
    f.text(KEY_NAME_HINT, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, young ? "It is hungry. Name it and press Enter." : `${which.te}% well. Name it and press Enter.`);
    const field = f.add(KEY_NAME_INPUT, K_INPUT, x + pad, y + pad + titleH + labelH + 8, w - pad * 2, fieldH, S_INPUT);
    field.text = this.text;
    field.interactive = true;
    field.focus = true;
  }
}
