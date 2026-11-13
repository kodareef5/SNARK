// What can be done to a thing built: a short list beside the crosshair.
//
// Held on a piece, the use key opens it. It names the piece, says how whole
// it is, and offers to take it back into the hands, mend it, or take it
// down, each with what that costs or gives as the shared arithmetic has it
// (shared/world/upkeep.ts). A number key or a press chooses; the server
// decides, and what it refused is said under the crosshair.

import type { Registry } from "../../../shared/content/registry.ts";
import type { ItemDef } from "../../../shared/content/defs.ts";
import { CMD_STRUCT, RESULT_DAMAGED, RESULT_FAR, RESULT_FULL, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, RESULT_WAIT } from "../../../shared/net/protocol.ts";
import { STRUCT_DEMOLISH, STRUCT_PICKUP, STRUCT_REPAIR, cost, refundOf, repairCostOf } from "../../../shared/world/upkeep.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_TITLE } from "./style.ts";

export const KEY_STRUCT_PANEL = 2400;
export const KEY_STRUCT_TITLE = 2401;
export const KEY_STRUCT_HEALTH = 2402;
/** One button for each action, in the order listed: take back, mend, take down; and under each, what it costs or gives. */
export const KEY_STRUCT_BUTTON = 2410;
export const KEY_STRUCT_DETAIL = 2420;

/** The actions in the order they are listed, and the digit that chooses each. */
const LISTED = [STRUCT_PICKUP, STRUCT_REPAIR, STRUCT_DEMOLISH] as const;

/** What to say when the server will not do what was asked of a piece, by the code it gives. */
export const STRUCT_REASONS: Readonly<Record<number, string>> = {
  [RESULT_NOT_YOURS]: "That is not your tribe's",
  [RESULT_FAR]: "Too far away",
  [RESULT_DAMAGED]: "It is damaged: mend it first",
  [RESULT_WAIT]: "Not yet",
  [RESULT_FULL]: "No room to carry it",
  [RESULT_SHORT]: "Not enough to mend it with",
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
  private noticeUntil = 0;
  private asked = 0;

  begin(ref: number): void {
    this.open = true;
    this.ref = ref;
  }

  close(): void {
    this.open = false;
  }

  /** Ask for one of the listed actions, by its place in the list. */
  choose(n: number, session: ClientSession): void {
    const action = LISTED[n];
    if (!this.open || action === undefined) return;
    const ref = this.ref;
    this.asked = session.command(CMD_STRUCT, (w) => {
      w.u32(ref);
      w.u8(action);
    });
    this.open = false;
  }

  /** A key while the list is up. Returns true if it was the list's. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    if (!this.open) return false;
    const digit = /^Digit([1-3])$/.exec(code);
    if (digit) {
      if (down && !repeat && session) this.choose(Number(digit[1]) - 1, session);
      return true;
    }
    if (code === "Escape") {
      if (down) this.close();
      return true;
    }
    return false;
  }

  click(key: number, session: ClientSession): boolean {
    const n = key - KEY_STRUCT_BUTTON;
    if (!this.open || n < 0 || n >= LISTED.length) return false;
    this.choose(n, session);
    return true;
  }

  /** The server answered a command: if it refused what this asked, the reason is said for a while. */
  result(seq: number, code: number, nowMs: number): void {
    if (seq !== this.asked || seq === 0) return;
    this.asked = 0;
    if (code === RESULT_OK) return;
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
    const lines = ["1  Take it back", "2  Mend it", "3  Take it down"];
    const details = [
      hp < max ? "not while it is damaged" : "into your hands, as it was",
      repairCostOf(reg, kind, hp) ? `costs ${listed(reg)}` : "it is whole",
      refundOf(reg, kind) && cost.n > 0 ? `gives ${listed(reg)}` : "gives nothing back",
    ];
    const w = Math.min(f.width - 16, 360);
    const titleH = lineHeight(S_TITLE);
    const labelH = lineHeight(S_LABEL);
    const rowH = 28;
    const pad = 12;
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
