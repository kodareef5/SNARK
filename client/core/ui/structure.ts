// What can be done to a thing built: a short list beside the crosshair.
//
// Held on a piece, the use key opens it. It names the piece, says how whole
// it is, and offers to take it back into the hands, mend it, or take it
// down, each with what that costs or gives as the shared arithmetic has it
// (shared/world/upkeep.ts). A number key or a press chooses; the server
// decides, and what it refused is said under the crosshair.
//
// What can be used (a door, a box) can also be locked, unlocked and given a
// PIN. The same panel then asks for four digits: to set one, or, for someone
// not of its tribe, to get in. A PIN that worked is remembered for that
// thing while the client runs, and given without asking the next time.

import type { Registry } from "../../../shared/content/registry.ts";
import type { ItemDef } from "../../../shared/content/defs.ts";
import { CMD_STRUCT, RESULT_DAMAGED, RESULT_DENIED, RESULT_FAR, RESULT_FULL, RESULT_LOCKED, RESULT_NOT_EMPTY, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK, RESULT_PIN, RESULT_SHORT, RESULT_WAIT } from "../../../shared/net/protocol.ts";
import { NO_PIN, STRUCT_DEMOLISH, STRUCT_LOCK, STRUCT_PICKUP, STRUCT_PIN, STRUCT_REPAIR, STRUCT_UNLOCK, STRUCT_USE, cost, refundOf, repairCostOf } from "../../../shared/world/upkeep.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_STRUCT_PANEL = 2400;
export const KEY_STRUCT_TITLE = 2401;
export const KEY_STRUCT_HEALTH = 2402;
/** One button for each action, in the order listed: take back, mend, take down; and under each, what it costs or gives. */
export const KEY_STRUCT_BUTTON = 2410;
export const KEY_STRUCT_DETAIL = 2420;
/** The PIN panel: what it asks, the digits so far, a button for each digit, and one to take a PIN away. */
export const KEY_PIN_PANEL = 2430;
export const KEY_PIN_TITLE = 2431;
export const KEY_PIN_DIGITS = 2432;
export const KEY_PIN_BUTTON = 2440;
export const KEY_PIN_CLEAR = 2450;

/** The actions in the order they are listed, and the digit that chooses each. The last three are only for what can be used. */
const LISTED = [STRUCT_PICKUP, STRUCT_REPAIR, STRUCT_DEMOLISH, STRUCT_LOCK, STRUCT_UNLOCK, STRUCT_PIN] as const;

/** What to say when the server will not do what was asked of a piece, by the code it gives. */
export const STRUCT_REASONS: Readonly<Record<number, string>> = {
  [RESULT_NOT_YOURS]: "That is not your tribe's",
  [RESULT_FAR]: "Too far away",
  [RESULT_DAMAGED]: "It is damaged: mend it first",
  [RESULT_WAIT]: "Not yet",
  [RESULT_FULL]: "No room to carry it",
  [RESULT_SHORT]: "Not enough to mend it with",
  [RESULT_LOCKED]: "It is locked",
  [RESULT_DENIED]: "That is not its PIN",
  [RESULT_NOT_EMPTY]: "Empty it first",
  [RESULT_OBSTRUCTED]: "Something is in the way",
};

/** What a structure is called: its item's name, with the form it was set down in if that is not the item's own. */
export function structName(reg: Registry, kind: number): string {
  const id = reg.ids[kind] ?? "";
  const item = reg.pieceItem[kind]!;
  const label = item !== 0 ? ((reg.defs[item] as ItemDef).label ?? "") : "";
  if (label === "") return id.slice(id.indexOf(":") + 1).replace(/_/g, " ");
  if (reg.places[item]![0] === kind) return label;
  // Another form of the same piece: a doorframe is set down from a wall.
  const form = id.slice(id.indexOf(":") + 1).split("_")[0]!;
  return `${label.slice(0, label.lastIndexOf(" ") + 1)}${form}`;
}

/** A cost or a return as words: "40 wood, 10 thatch". */
function listed(reg: Registry): string {
  const parts: string[] = [];
  for (let k = 0; k < cost.n; k++) {
    const d = reg.defs[cost.item[k]!] as ItemDef;
    parts.push(`${cost.count[k]} ${d.label ?? d.id.slice(d.id.indexOf(":") + 1)}`);
  }
  return parts.join(", ");
}

export class StructMenu {
  open = false;
  /** The piece it is about. */
  ref = -1;
  /** What the server said to the last thing asked, for a while: shown under the crosshair. */
  notice = "";
  /** The panel is asking for a PIN: to get in (STRUCT_USE) or to set one (STRUCT_PIN); 0 when it is not. And the digits so far. */
  pad = 0;
  digits = "";
  /** How many actions the list last showed: three for a plain piece, six for what can be used. */
  private lines = 3;
  private noticeUntil = 0;
  private asked = 0;
  private askedRef = -1;
  private askedPin = NO_PIN;
  /** PINs that got this client into things, by the thing. */
  private readonly pins = new Map<number, number>();

  begin(ref: number): void {
    this.open = true;
    this.pad = 0;
    this.ref = ref;
  }

  /** Ask for the PIN of the thing at `ref`, to get in. */
  ask(ref: number): void {
    this.open = true;
    this.pad = STRUCT_USE;
    this.digits = "";
    this.ref = ref;
  }

  close(): void {
    this.open = false;
    this.pad = 0;
  }

  private send(session: ClientSession, ref: number, action: number, pin = NO_PIN): void {
    this.askedRef = ref;
    this.askedPin = action === STRUCT_USE ? pin : NO_PIN;
    this.asked = session.command(CMD_STRUCT, (w) => {
      w.u32(ref);
      w.u8(action);
      if (action === STRUCT_PIN || action === STRUCT_USE) w.u16(pin);
    });
  }

  /** Ask for one of the listed actions, by its place in the list. Setting a PIN asks for the digits first. */
  choose(n: number, session: ClientSession): void {
    const action = LISTED[n];
    if (!this.open || this.pad !== 0 || action === undefined || n >= this.lines) return;
    if (action === STRUCT_PIN) {
      this.pad = STRUCT_PIN;
      this.digits = "";
      return;
    }
    this.send(session, this.ref, action);
    this.open = false;
  }

  /** A digit for the PIN; the fourth sends it. */
  private digit(d: string, session: ClientSession): void {
    this.digits += d;
    if (this.digits.length < 4) return;
    this.send(session, this.ref, this.pad, Number(this.digits));
    this.close();
  }

  /** A key while the panel is up. Returns true if it was the panel's. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    if (!this.open) return false;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (digit) {
      if (!down || repeat || !session) return true;
      if (this.pad !== 0) this.digit(digit[1]!, session);
      else if (code.startsWith("Digit") && digit[1] !== "0") this.choose(Number(digit[1]) - 1, session);
      return true;
    }
    if (code === "Backspace" && this.pad !== 0) {
      if (down) this.digits = this.digits.slice(0, -1);
      return true;
    }
    if (code === "Escape") {
      if (down) this.close();
      return true;
    }
    return false;
  }

  click(key: number, session: ClientSession): boolean {
    if (!this.open) return false;
    if (this.pad !== 0) {
      if (key === KEY_PIN_CLEAR && this.pad === STRUCT_PIN) {
        // No PIN at all: what it had is taken away.
        this.send(session, this.ref, STRUCT_PIN, NO_PIN);
        this.close();
        return true;
      }
      const d = key - KEY_PIN_BUTTON;
      if (d < 0 || d > 9) return false;
      this.digit(String(d), session);
      return true;
    }
    const n = key - KEY_STRUCT_BUTTON;
    if (n < 0 || n >= LISTED.length) return false;
    this.choose(n, session);
    return true;
  }

  /**
   * The server answered. To a command this sent: if it was refused, the
   * reason is said for a while; a PIN that got in is remembered, one that
   * did not is forgotten. Unasked (`seq` 0), about the thing at `aimed` that
   * the use button was pressed on: it wants a PIN, which is given if one is
   * remembered and asked for if not; or it is locked, and says so.
   */
  result(seq: number, code: number, nowMs: number, session: ClientSession | null = null, aimed = -1): void {
    if (seq === 0) {
      if (code === RESULT_PIN && aimed >= 0 && session) {
        const known = this.pins.get(aimed);
        if (known !== undefined) this.send(session, aimed, STRUCT_USE, known);
        else this.ask(aimed);
      } else if (STRUCT_REASONS[code] !== undefined || code === RESULT_WAIT) this.say(code, nowMs);
      return;
    }
    if (seq !== this.asked) return;
    this.asked = 0;
    if (this.askedPin !== NO_PIN) {
      if (code === RESULT_OK) this.pins.set(this.askedRef, this.askedPin);
      else this.pins.delete(this.askedRef);
    }
    if (code !== RESULT_OK) this.say(code, nowMs);
  }

  private say(code: number, nowMs: number): void {
    this.notice = STRUCT_REASONS[code] ?? "That cannot be done";
    this.noticeUntil = nowMs + 2500;
  }

  /** Let go of a notice whose time is up. */
  tick(nowMs: number): void {
    if (this.notice !== "" && nowMs >= this.noticeUntil) this.notice = "";
  }

  build(f: UiFrame, session: ClientSession, reg: Registry): void {
    if (!this.open) return;
    const t = session.world?.structs.chunks[Math.floor(this.ref / 65536)];
    const slot = this.ref & 0xffff;
    // It has gone since: there is nothing to do to it.
    if (!t || slot >= t.high || t.kind[slot] === 0) {
      this.open = false;
      return;
    }
    const kind = t.kind[slot]!;
    const hp = t.hp[slot]!;
    const max = reg.maxHp[kind]!;
    const usable = reg.opens[kind] !== 0 || reg.structSlots[kind] !== 0;
    const w = Math.min(f.width - 16, usable ? 400 : 360);
    const titleH = lineHeight(S_TITLE);
    const labelH = lineHeight(S_LABEL);
    const rowH = 28;
    const pad = 12;
    if (this.pad !== 0) {
      // Four digits: a line that says what for, the digits so far, and a button for each.
      const cell = Math.floor((w - pad * 2 - 4 * 4) / 5);
      const h = pad * 2 + titleH + labelH + 8 + 2 * (rowH + 4) + (this.pad === STRUCT_PIN ? rowH + 4 : 0);
      const x = Math.round((f.width - w) / 2);
      const y = Math.round(Math.min(f.height - h - 8, f.height / 2 + 40));
      f.add(KEY_PIN_PANEL, K_PANEL, x, y, w, h, S_PANEL);
      f.text(KEY_PIN_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, this.pad === STRUCT_PIN ? "Give it a PIN" : "It wants its PIN");
      f.text(KEY_PIN_DIGITS, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, `${structName(reg, kind)}:  ${"*".repeat(this.digits.length)}${"_".repeat(4 - this.digits.length)}`);
      for (let d = 0; d < 10; d++) {
        const b = f.add(KEY_PIN_BUTTON + d, K_BUTTON, x + pad + (d % 5) * (cell + 4), y + pad + titleH + labelH + 8 + Math.floor(d / 5) * (rowH + 4), cell, rowH, S_BUTTON);
        b.text = String(d);
        b.interactive = true;
      }
      if (this.pad === STRUCT_PIN) {
        const b = f.add(KEY_PIN_CLEAR, K_BUTTON, x + pad, y + pad + titleH + labelH + 8 + 2 * (rowH + 4), w - pad * 2, rowH, S_BUTTON);
        b.text = "No PIN";
        b.interactive = true;
      }
      return;
    }
    const lines = ["1  Take it back", "2  Mend it", "3  Take it down"];
    const details = [
      hp < max ? "not while it is damaged" : "into your hands, as it was",
      repairCostOf(reg, kind, hp) ? `costs ${listed(reg)}` : "it is whole",
      refundOf(reg, kind) && cost.n > 0 ? `gives ${listed(reg)}` : "gives nothing back",
    ];
    // What can be used can be kept from others.
    if (usable) {
      lines.push("4  Lock it", "5  Unlock it", "6  Give it a PIN");
      details.push("for your tribe alone", "for anyone", "four digits let others in");
    }
    this.lines = lines.length;
    const step = rowH + labelH + 8;
    const h = pad * 2 + titleH + labelH + 8 + lines.length * step;
    // Beside the crosshair where there is room, else under it.
    const x = Math.round(f.width / 2 + 40 + w <= f.width - 8 ? f.width / 2 + 40 : (f.width - w) / 2);
    const y = Math.round(Math.min(f.height - h - 8, f.height / 2 + 40));
    f.add(KEY_STRUCT_PANEL, K_PANEL, x, y, w, h, S_PANEL);
    f.text(KEY_STRUCT_TITLE, x + pad, y + pad, w - pad * 2, S_TITLE, structName(reg, kind));
    f.text(KEY_STRUCT_HEALTH, x + pad, y + pad + titleH, w - pad * 2, S_LABEL, `${Math.ceil(hp)} of ${max}`);
    lines.forEach((line, i) => {
      const top = y + pad + titleH + labelH + 8 + i * step;
      const b = f.add(KEY_STRUCT_BUTTON + i, K_BUTTON, x + pad, top, w - pad * 2, rowH, S_BUTTON);
      b.text = line;
      b.interactive = true;
      f.text(KEY_STRUCT_DETAIL + i, x + pad, top + rowH + 2, w - pad * 2, S_LABEL, details[i]!);
    });
  }
}
