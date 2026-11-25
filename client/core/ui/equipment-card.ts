// The inspected slot stays tied to its server item through detail, assignment and confirmation.
import { BOX_SELF, CMD_MOVE, CMD_SELECT, RESULT_OK } from "../../../shared/net/protocol.ts";
import { HOTBAR_SLOTS, type Inventory } from "../../../shared/sim/items.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { ClientSession } from "../session.ts";
import { K_BUTTON, K_HOLD, K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { itemMount } from "./item-mount.ts";
import { glyph } from "./dock-visual.ts";
import { glass } from "./skin.ts";
import { S_HUD_COUNT, S_HUD_HIT, S_HUD_KEY, S_ICE, S_LABEL, S_MENU_NOTE, S_SLOT, S_TITLE } from "./style.ts";

export const CARD = 17900;
const GRIP = CARD + 1, BACK = CARD + 2, ASSIGN = CARD + 3, TARGET = CARD + 20;
function label(reg: Registry, id: number): string {
  const def = reg.defs[id];
  return (def && "label" in def ? def.label : undefined) ?? reg.ids[id]?.split(":").pop()?.replaceAll("_", " ") ?? "";
}

function portrait(f: UiFrame, key: number, x: number, y: number, size: number, id: string) {
  return f.picture(key, x, y, size, size, S_LABEL, "ui:inspect/" + id)
    ?? f.picture(key, x, y, size, size, S_LABEL, id);
}

export class EquipmentCard {
  depth = 0;
  private source = -1;
  private item = 0;
  private finger = -1;
  private fromY = 0;
  private sequence = 0;
  private destination = -1;
  private failed = false;

  reset(): void {
    this.depth = this.sequence = this.item = 0;
    this.source = this.finger = this.destination = -1;
    this.failed = false;
  }

  back(): boolean {
    if (!this.depth) return false;
    if (this.depth === 1) this.reset();
    else { this.depth--; this.sequence = 0; this.failed = false; }
    return true;
  }

  private deeper(inv: Inventory, slot: number): void {
    if (this.depth === 0 && (inv.item[slot] ?? 0) !== 0) {
      this.source = slot;
      this.item = inv.item[slot]!;
      this.depth = 1;
    } else if (this.depth === 1 && inv.hotbar >= 0) this.depth = 2;
  }

  input(kind: number, key: number, y: number, finger: number, slot: number, s: ClientSession): boolean {
    const inv = s.inventory;
    if (!inv || key < CARD || key >= CARD + 100) return false;
    if (key === GRIP) {
      if (kind === 0 && this.finger === -1) { this.finger = finger; this.fromY = y; }
      if (finger === this.finger && (kind === 1 || kind === 3)) {
        this.finger = -1;
        if (kind === 1) {
          if (y - this.fromY > 24) this.back();
          else if (this.depth < 2) this.deeper(inv, slot);
        }
      }
      return true;
    }
    if (kind !== 0) return true;
    if (key === BACK) this.back();
    else if (key === CARD || key === ASSIGN) this.deeper(inv, slot);
    else if (this.depth === 2 && !this.sequence && key >= TARGET && key < TARGET + 3 * HOTBAR_SLOTS && (key - TARGET) % 3 === 0) {
      const hotkey = (key - TARGET) / 3, dest = inv.hotbar + hotkey;
      if (inv.hotbar < 0 || inv.item[this.source] !== this.item) { this.reset(); return true; }
      if (this.source === dest) { s.command(CMD_SELECT, w => w.u8(hotkey)); this.reset(); return true; }
      this.destination = hotkey;
      this.sequence = s.command(CMD_MOVE, w => {
        w.bits(BOX_SELF, 1); w.varint(this.source); w.bits(BOX_SELF, 1); w.varint(dest); w.u16(0); w.u16(this.item);
      });
      this.failed = !this.sequence;
    }
    return true;
  }

  answer(seq: number, code: number, s: ClientSession | null): boolean {
    if (!this.sequence || seq !== this.sequence) return false;
    this.sequence = 0;
    if (code !== RESULT_OK || !s) { this.failed = true; return false; }
    s.command(CMD_SELECT, w => w.u8(this.destination));
    this.reset();
    return true;
  }

  validate(inv: Inventory): void {
    if (this.depth && !this.sequence && inv.item[this.source] !== this.item) this.reset();
  }

  preview(f: UiFrame, x: number, y: number, w: number, h: number, inv: Inventory, reg: Registry, slot: number): void {
    const size = Math.min(w - 24, h - 68), cx = x + (w - size) / 2, cy = y + (h - size - 18) / 2;
    const id = inv.item[slot]!, name = label(reg, id);
    itemMount(f, CARD + 55, cx, cy, size);
    portrait(f, CARD + 56, cx + 10, cy + 10, size - 20, reg.ids[id]!);
    f.text(CARD + 57, x + 17, cy + size + 6, w - 27, S_TITLE, fitText(name, w - 27, S_TITLE));
    const inspect = f.add(CARD, K_BUTTON, x, y, w, h, S_HUD_HIT);
    inspect.label = "Inspect " + name; inspect.interactive = true;
    const rule = f.add(CARD + 58, K_PANEL, x + w - 1, y + 18, 1, h - 36, S_ICE);
    rule.alpha = .38;
  }

  entry(f: UiFrame, x: number, y: number, w: number, touch: boolean): void {
    const inspect = f.add(CARD, K_BUTTON, x + w - 78, y + 5, 70, 28, S_HUD_HIT);
    inspect.text = "Inspect"; inspect.label = "Inspect item"; inspect.interactive = true;
    if (touch) this.grip(f, x, y, w);
  }

  grip(f: UiFrame, x: number, y: number, width: number): void {
    const g = f.add(GRIP, K_HOLD, x + width / 2 - 36, y, 72, 27, S_HUD_HIT);
    g.label = "Swipe up to inspect, down to return"; g.interactive = true;
    f.add(CARD + 4, K_PANEL, x + width / 2 - 17, y + 5, 34, 2, S_ICE).alpha = .72;
  }

  draw(f: UiFrame, inv: Inventory, reg: Registry, touch: boolean): void {
    const w = Math.min(500, f.width - f.left - f.right - 24), h = Math.min(274, f.height - f.top - f.bottom - 24);
    const x = f.left + (f.width - f.left - f.right - w) / 2, y = f.top + (f.height - f.top - f.bottom - h) / 2;
    glass(f, CARD, x, y, w, h);
    const back = f.add(BACK, K_BUTTON, x + 7, y + 8, 36, 30, S_HUD_HIT);
    back.label = "Back to " + (this.depth === 2 ? "item" : "inventory"); back.interactive = true;
    glyph(f, CARD + 60, back, "back", "‹", 0.6);
    const name = label(reg, this.item);
    f.text(CARD + 5, x + 47, y + 13, w - 80, S_TITLE, fitText(this.depth === 1 ? name : "Assign hotkey", w - 80, S_TITLE));
    if (touch) this.grip(f, x, y, w);
    if (this.depth === 1) {
      const size = Math.min(150, h - 78, w * .38), left = x + 31, top = y + (h - size) / 2 + 12;
      itemMount(f, CARD + 6, left - 8, top - 8, size + 16);
      const def = reg.defs[this.item], id = reg.ids[this.item]!;
      if (!portrait(f, CARD + 7, left, top, size, id)) f.text(CARD + 7, left, top + size / 2, size, S_TITLE, fitText(name, size, S_TITLE));
      const col = left + size + 24, width = x + w - col - 15;
      const uses = reg.uses[this.item]!, qty = inv.count[this.source]!;
      f.text(CARD + 8, col, y + h * .37, width, S_MENU_NOTE, uses ? "Condition" : "Stack");
      f.text(CARD + 9, col, y + h * .37 + 21, width, S_TITLE, uses ? String(inv.dur[this.source]) : "×" + qty);
      f.text(CARD + 10, col, y + h * .37 + 53, width, S_HUD_KEY, (reg.weight[this.item]! * qty).toFixed(1) + " kg");
      if (def && inv.hotbar >= 0) {
        const assign = f.add(ASSIGN, K_BUTTON, col, y + h - 56, width, 36, S_SLOT);
        assign.text = "Assign hotkey"; assign.interactive = true;
      }
    } else {
      const pitch = (w - 36) / 5, height = Math.min((h - 92) / 2, 68);
      for (let i = 0; i < HOTBAR_SLOTS; i++) {
        const key = TARGET + i * 3, bx = x + 18 + i % 5 * pitch, by = y + 54 + Math.floor(i / 5) * (height + 4);
        const id = inv.item[inv.hotbar + i]!, number = String((i + 1) % 10);
        const box = f.add(key, K_BUTTON, bx, by, pitch - 3, height, S_SLOT);
        box.interactive = !this.sequence;
        box.label = "Assign to " + number + (id ? " · " + label(reg, id) : "");
        if (id && !f.picture(key + 1, bx + (pitch - height) / 2, by + 2, height - 4, height - 4, S_LABEL, reg.ids[id]!)) box.text = fitText(label(reg, id), pitch - 18, S_HUD_KEY);
        f.text(key + 2, bx + 3, by + 2, 12, S_HUD_KEY, number);
      }
      f.text(CARD + 11, x + 18, y + h - 29, w - 36, S_HUD_COUNT, this.failed ? "Slot changed. Choose again." : this.sequence ? "Assigning…" : name);
    }
  }
}
