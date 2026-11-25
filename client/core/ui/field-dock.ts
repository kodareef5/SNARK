// The field dock: the hotbar's slots, and the menus beside them. A mouse clicks or browses with F2, F4, the arrows and
// Enter; a finger slides along the slots and swipes the two edge wheels. It is a screen of the list (screens-list.ts)
// that draws with the HUD, and its field menu offers every screen that names a way in (Screen.dock).
// One contact browses it at a time, so the other thumb keeps moving or acting.

import { EMOTE_NUMBER } from "../../../shared/anim/emotes.ts";
import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CMD_SELECT, CMD_USE } from "../../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT, HOTBAR_SLOTS, type Inventory } from "../../../shared/sim/items.ts";
import { hotbarCell, hotbarLeft, hotbarTop } from "../hud/layout.ts";
import { line, rim, tile } from "./dock-visual.ts";
import type { EmoteMenu } from "./emotes.ts";
import { K_BUTTON, K_HOLD, type UiFrame } from "./nodes.ts";
import type { DockEntry, Screen, ScreenCtx } from "./screen.ts";
import { S_HUD_CAPTION, S_HUD_HIT, S_HUD_KEY, S_LABEL } from "./style.ts";

/** The dock's keys: hubs, then a page's leaves, then the slots, then the rims, each with parts at +100 to +400. */
export const KEY_DOCK = 48000;
export const KEY_FIELD_HUB = KEY_DOCK;
export const KEY_FIELD_LEAF = KEY_DOCK + 20;
export const KEY_DOCK_SLOT = KEY_DOCK + 60;
const KEY_RIM = KEY_DOCK + 80;
const MOST_LEAVES = 40;

export type DockPage = "emblem" | "actions" | "whistles" | "kit" | "gestures";

/** One thing a page offers: another page, a way to a screen, or an action. */
interface Leaf {
  readonly id: string;
  readonly label: string;
  readonly art: string;
  readonly page?: DockPage;
  readonly touchOnly?: boolean;
  run?(c: ScreenCtx): void;
}

const press = (id: string, label: string, art: string, code: string): Leaf => ({ id, label, art, run: (c) => c.pressKey(code) });
const page = (id: DockPage, label: string, art: string): Leaf => ({ id, label, art, page: id });

const EMBLEM = page("emblem", "Field menus", "emblem");
const ACTIONS = page("actions", "Actions", "gestures");
const RADIO: Leaf & DockEntry = { id: "radio", label: "Radio", art: "radio", rank: 50, open: (c) => c.pressKey("Enter"), run: (c) => c.pressKey("Enter") };
const SUPPLIES = ["drink", "eat", "spyglass"] as const;
const EMOTES = ["wave", "point", "salute"] as const;

/** The pages that are the dock's own: the families of action and what each holds. */
const OWN: Record<Exclude<DockPage, "emblem">, readonly Leaf[]> = {
  actions: [page("whistles", "Whistles", "whistles"), page("kit", "Field kit", "kit"), page("gestures", "Gestures", "gestures")],
  whistles: [press("follow", "Follow", "follow", "KeyJ"), press("stay", "Stay", "stay", "KeyU"), press("attack-target", "Attack target", "attack-target", "Period")],
  kit: [
    { id: "drink", label: "Drink", art: "drink" }, { id: "eat", label: "Eat berries", art: "eat" }, { id: "spyglass", label: "Equip spyglass", art: "spyglass" },
    { id: "controls", label: "Play controls", art: "settings", touchOnly: true, run: (c) => { c.settings.playControls = !c.settings.playControls; c.settings.changed(); } },
  ],
  gestures: EMOTES.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1), art: id })),
};

/** The desktop's hubs beside the hotbar, left then right, as leaves of the field menu or the action families. */
const LEFT_HUBS = ["emblem", "bag", "craft"];
const RIGHT_HUBS = ["whistles", "kit", "gestures"];

/** The first slot of the stack each field kit leaf uses, or -1. */
export function supplySlot(id: string, inv: Inventory | null, reg: Registry | null): number {
  if (!inv || !reg) return -1;
  const first = id === "spyglass" ? inv.hotbar : 0;
  if (first < 0) return -1;
  const end = id === "spyglass" ? first + HOTBAR_SLOTS : inv.armor < 0 ? inv.cap : inv.armor;
  for (let slot = first; slot < end; slot++) {
    const item = inv.item[slot]!;
    if (!item || !inv.count[slot] || (inv.flags[slot]! & FLAG_BLUEPRINT)) continue;
    const def = reg.defs[item] as ItemDef;
    if (id === "drink" && def.use?.holds && inv.dur[slot]! > 0) return slot;
    if (id === "eat" && def.id === "core:berry") return slot;
    if (id === "spyglass" && def.class === "instrument" && def.optic) return slot;
  }
  return -1;
}

export class FieldDock implements Screen {
  readonly name = "dock";
  readonly layer = "over";
  readonly quiet = true;
  readonly keepsField = true;
  readonly coversThumbs = true;
  readonly bands = [{ from: KEY_DOCK, count: 100 + 4 * 100 }];
  page: DockPage | null = null;
  private focus = 0;
  private familyParent = false;
  private finger = -1;
  private mouseKey = -1;
  private originKey = -1;
  private downX = 0;
  private downY = 0;
  private dragged = false;
  private startPage: DockPage | null = null;
  private expanded = 0;
  private clock = -1;
  /** The field menu, made from the list's screens once they are known. */
  private menu: Leaf[] | null = null;
  private readonly shown: Leaf[] = [];
  private supplyInv: Inventory | null = null;
  private supplyVersion = -1;
  private readonly supplies = new Set<string>();
  private enabled = false;
  touch = false;
  private width = 0;
  private height = 0;
  /** The slot under a sliding thumb, which the hotbar magnifies; -1 for none. */
  preview = -1;

  isOpen(): boolean { return this.page !== null; }
  get open(): boolean { return this.page !== null; }
  close(): void { this.reset(); }
  build(): void {}
  pressWorld(): boolean { this.reset(); return true; }
  letGo(): void { this.reset(); }

  reset(): void {
    this.page = null; this.focus = 0; this.familyParent = false; this.mouseKey = -1; this.release();
    this.expanded = 0; this.clock = -1;
  }
  private release(): void { this.finger = this.originKey = this.preview = -1; this.dragged = false; }

  private leaves(p: DockPage, c: ScreenCtx): readonly Leaf[] {
    if (p !== "emblem") return OWN[p];
    if (!this.menu) {
      const entries: (Leaf & DockEntry)[] = [RADIO];
      for (const s of c.screens) for (const e of s.dock ?? []) entries.push({ ...e, run: e.open });
      this.menu = entries.sort((a, b) => a.rank - b.rank);
    }
    return this.menu;
  }

  /** What the open page shows on this device. */
  private list(c: ScreenCtx): readonly Leaf[] {
    this.shown.length = 0;
    if (this.page) for (const l of this.leaves(this.page, c)) if (this.touch || !l.touchOnly) this.shown.push(l);
    if (this.shown.length > MOST_LEAVES) this.shown.length = MOST_LEAVES;
    return this.shown;
  }

  private find(id: string, c: ScreenCtx): Leaf | undefined {
    if (id === "emblem") return EMBLEM;
    if (id === "actions") return ACTIONS;
    for (const p of ["emblem", "actions", "kit", "whistles", "gestures"] as const) for (const l of this.leaves(p, c)) if (l.id === id) return l;
    return undefined;
  }

  available(l: Leaf, c: ScreenCtx): boolean {
    if (l.touchOnly && !this.touch) return false;
    if (l.id === "attack-target") return c.aimed;
    if ((EMOTES as readonly string[]).includes(l.id)) {
      const emotes = c.screens.find((s) => s.name === "emotes") as EmoteMenu | undefined;
      return emotes?.has(EMOTE_NUMBER.get(l.id)!) ?? true;
    }
    if (!(SUPPLIES as readonly string[]).includes(l.id)) return true;
    const inv = c.session?.inventory ?? null;
    if (this.supplyInv !== inv || this.supplyVersion !== (inv?.version ?? -1)) {
      this.supplyInv = inv; this.supplyVersion = inv?.version ?? -1;
      this.supplies.clear();
      for (const id of SUPPLIES) if (supplySlot(id, inv, c.registry) >= 0) this.supplies.add(id);
    }
    return this.supplies.has(l.id);
  }

  private choose(l: Leaf | undefined, c: ScreenCtx): void {
    if (!l || !this.available(l, c)) return;
    if (l.page) { this.openPage(l.page, c); return; }
    this.reset();
    this.run(l, c);
  }

  private run(l: Leaf, c: ScreenCtx): void {
    const session = c.session;
    if (!session) return;
    if ((SUPPLIES as readonly string[]).includes(l.id)) {
      const inv = session.inventory, slot = supplySlot(l.id, inv, c.registry);
      if (!inv || slot < 0) return;
      if (l.id === "spyglass") { if (session.held !== slot - inv.hotbar) session.command(CMD_SELECT, (w) => w.u8(slot - inv.hotbar)); }
      else session.command(CMD_USE, (w) => { w.varint(slot); w.u16(inv.item[slot]!); });
      return;
    }
    if ((EMOTES as readonly string[]).includes(l.id)) {
      const emote = EMOTE_NUMBER.get(l.id);
      if (emote !== undefined) session.emote(0, emote);
      return;
    }
    l.run?.(c);
  }

  /** Puts slot `slot` in hand, or empties the hand where it is already there. */
  private equip(slot: number, c: ScreenCtx): void {
    const session = c.session;
    if (!session || slot < 0 || slot >= HOTBAR_SLOTS || (session.inventory?.hotbar ?? -1) < 0) return;
    session.command(CMD_SELECT, (w) => w.u8(session.held === slot ? 255 : slot));
  }

  private openPage(p: DockPage, c: ScreenCtx): void {
    if (!this.page) this.expanded = 0;
    this.familyParent = this.page === "actions";
    this.page = p; this.focus = 0;
    const entries = this.list(c);
    while (this.focus < entries.length && !this.available(entries[this.focus]!, c)) this.focus++;
  }

  private back(c: ScreenCtx): void {
    if ((this.touch || this.familyParent) && this.page && this.page !== "actions" && this.page !== "emblem") this.openPage("actions", c);
    else this.reset();
  }

  /** F2 or Comma opens the field menu, F4 or Semicolon the actions: a laptop's F keys may need Fn. */
  playKey(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean {
    const menu = code === "F2" || code === "Comma", actions = code === "F4" || code === "Semicolon";
    if (this.touch || (!menu && !actions)) return false;
    if (down && !repeat) this.openPage(menu ? "emblem" : "actions", c);
    return true;
  }

  key(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean {
    if (!this.page) return false;
    if (code === "Escape" || code === "Backspace") { if (down && !repeat) this.back(c); return true; }
    const entries = this.list(c);
    if (code === "Enter" || code === "Space" || code === "NumpadEnter") {
      if (down && !repeat) this.choose(entries[this.focus], c);
      return true;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(code)) {
      // A key that opens a screen or picks a slot shuts the dock and goes on to do so.
      if (down && !repeat && /^(Digit[0-9]|Key[IMPO]|Tab|Slash|Insert)$/.test(code)) this.reset();
      return false;
    }
    if (down) {
      const count = entries.length, step = code === "ArrowLeft" || code === "ArrowUp" || code === "End" ? -1 : 1;
      if (code === "Home") this.focus = -1;
      if (code === "End") this.focus = count;
      for (let i = 0; i < count; i++) {
        this.focus = (this.focus + step + count) % count;
        if (this.available(entries[this.focus]!, c)) break;
      }
    }
    return true;
  }

  private hub(key: number, c: ScreenCtx): Leaf | undefined {
    const index = key - KEY_FIELD_HUB;
    if (index < 0 || index >= 6) return undefined;
    if (this.touch) return index === 0 ? this.find("emblem", c) : index === 3 ? this.find("actions", c) : undefined;
    return this.find(index < 3 ? LEFT_HUBS[index]! : RIGHT_HUBS[index - 3]!, c);
  }

  pointer(kind: number, key: number, x: number, y: number, button: number, c: ScreenCtx): boolean {
    const f = c.frame, finger = c.finger;
    if (!finger && (kind === 0 || kind === 3)) this.mouseKey = -1;
    const slot = key - KEY_DOCK_SLOT, equipment = slot >= 0 && slot < HOTBAR_SLOTS;
    const hub = this.hub(key, c);
    const entries = this.list(c);
    const leaf = key >= KEY_FIELD_LEAF && key < KEY_FIELD_LEAF + entries.length;
    if (!equipment && !hub && !leaf && this.originKey !== key) return false;
    if (!this.enabled || (kind === 0 && button !== 0) || !f.find(key)?.interactive) {
      if (finger === this.finger && kind !== 2) this.release();
      return true;
    }
    if (kind === 3) {
      if (finger === this.finger) { this.page = this.startPage; this.release(); }
      return true;
    }
    if (!finger) {
      if (kind === 2 && leaf) this.focus = key - KEY_FIELD_LEAF;
      if (kind === 0) this.mouseKey = key;
      // A native keyboard click arrives from the shell without mouse coordinates or a release.
      if (this.mouseKey === key && (kind === 1 || (kind === 0 && x === 0 && y === 0))) {
        this.mouseKey = -1;
        if (equipment) { this.reset(); this.equip(slot, c); }
        else if (hub) { if (hub.page && this.page === hub.page) this.reset(); else this.choose(hub, c); }
        else if (leaf && this.page) this.choose(entries[key - KEY_FIELD_LEAF], c);
      } else if (kind === 1) this.mouseKey = -1;
      return true;
    }
    if (kind === 0) {
      if (this.finger >= 0) return true;
      this.finger = finger; this.originKey = key; this.downX = x; this.downY = y; this.startPage = this.page;
      if (equipment) { this.page = null; this.preview = slot; }
      return true;
    }
    if (this.finger !== finger || this.originKey !== key) return true;
    const dx = x - this.downX, dy = y - this.downY;
    this.dragged ||= Math.hypot(dx, dy) >= 12;
    if (equipment) {
      this.preview = Math.max(0, Math.min(HOTBAR_SLOTS - 1, Math.floor((x - hotbarLeft(f, HOTBAR_SLOTS) + 1.5) / (hotbarCell(f, HOTBAR_SLOTS) + 3))));
      if (kind === 1) {
        const selected = this.dragged ? this.preview : slot;
        const hit = f.find(key)!;
        const inRow = y >= hit.y - 23 && y <= hit.y + hit.h + 18;
        const equip = inRow && (!this.dragged || selected !== c.session?.held);
        this.release();
        if (equip) this.equip(selected, c);
      }
      return true;
    }
    const left = hub?.id === "emblem" || this.startPage === "emblem";
    const inward = left ? dx : -dx;
    const entry = this.page && leaf ? entries[key - KEY_FIELD_LEAF] : undefined;
    if (kind === 2 && this.dragged && hub?.page && !this.page && inward > 16) this.openPage(hub.page, c);
    if (kind === 1) {
      const dragged = this.dragged, previous = this.startPage;
      this.release();
      if (dragged) {
        if (inward < -25) this.back(c);
        else if (inward > 23 && entry?.page) this.openPage(entry.page, c);
        else if (inward > 18 && hub?.page && this.page !== hub.page) this.openPage(hub.page, c);
        else if (hub && this.page === "actions") {
          const near = this.nearest(f, x, y), node = f.find(KEY_FIELD_LEAF + near);
          const family = this.list(c)[near];
          if (family?.page && node && x >= node.x && x <= node.x + node.w && y >= node.y && y <= node.y + node.h) this.openPage(family.page, c);
        } else if (this.page && !hub) this.focus = this.nearest(f, x, y);
      } else if (hub) {
        if (hub.page === previous || (hub.id === "actions" && previous && previous !== "emblem")) this.back(c); else this.choose(hub, c);
      } else if (entry) this.choose(entry, c);
    } else if (this.dragged && this.page) {
      this.focus = this.nearest(f, x, y);
    }
    return true;
  }

  private nearest(f: UiFrame, x: number, y: number): number {
    let chosen = this.focus, distance = Infinity;
    for (let i = 0; i < this.shown.length; i++) {
      const n = f.find(KEY_FIELD_LEAF + i);
      if (!n) continue;
      const d = Math.hypot(x - n.x - n.w / 2, y - n.y - n.h / 2);
      if (d < distance) { distance = d; chosen = i; }
    }
    return chosen;
  }

  /** Drawn with the HUD: the slots' hit boxes, the hubs, and the open page. */
  play(f: UiFrame, c: ScreenCtx): void {
    const touch = c.inputDevice === 2, session = c.session, hud = c.hud;
    if (touch !== this.touch) { this.touch = touch; this.reset(); }
    if (this.width && (this.width !== f.width || this.height !== f.height)) this.reset();
    this.width = f.width; this.height = f.height;
    let others = false;
    for (const s of c.screens) if (s.name !== this.name && s.isOpen()) others = true;
    this.enabled = !!session && !!hud && !others && !session.airSupport.flight && !session.open;
    if (!this.enabled || !hud || hud.hotbar.length === 0) { if (this.page) this.reset(); return; }
    const now = hud.hotbarNow;
    const step = this.clock < 0 ? 1 : Math.min(1, Math.max(0, now - this.clock) / 170);
    this.clock = now;
    this.expanded = this.page ? Math.min(1, this.expanded + step) : 0;
    hud.dockPreview = this.preview;
    const n = hud.hotbar.length, cell = hotbarCell(f, n), x0 = hotbarLeft(f, n);
    const end = x0 + n * (cell + 3) - 3, bottom = hotbarTop(f, n) + cell;
    for (let i = 0; i < n; i++) {
      const s = hud.hotbar[i]!, hitH = touch ? 40 : cell;
      const box = f.add(KEY_DOCK_SLOT + i, touch ? K_HOLD : K_BUTTON, x0 + i * (cell + 3), bottom - hitH, cell, hitH, S_HUD_HIT);
      box.label = `Slot ${(i + 1) % 10}: ${s.name || s.id || s.label || "empty"}`;
      box.interactive = true;
    }
    this.draw(f, x0, end, bottom, c);
  }

  private draw(f: UiFrame, x: number, end: number, bottom: number, c: ScreenCtx): void {
    const narrow = x < f.left + 120;
    const size = this.touch ? 35 : Math.max(24, Math.min(36, Math.floor((x - f.left - 16) / 3)));
    const left = this.touch ? f.left : narrow ? x : x - size * 3 - 10;
    const right = this.touch ? f.width - f.right : narrow ? end - size * 3 : end + 10;
    const cell = hotbarCell(f, HOTBAR_SLOTS);
    const cy = this.touch ? f.top + (f.height - f.top - f.bottom) * .60 : bottom - (narrow ? cell + size / 2 + 6 : size / 2);
    if (this.touch) {
      this.edge(f, true, left, cy, c); this.edge(f, false, right, cy, c);
    } else {
      for (let i = 0; i < 3; i++) {
        this.tile(f, KEY_FIELD_HUB + i, this.find(LEFT_HUBS[i]!, c), left + i * size, cy - size / 2, size, size, false, false, c);
        this.tile(f, KEY_FIELD_HUB + 3 + i, this.find(RIGHT_HUBS[i]!, c), right + i * size, cy - size / 2, size, size, false, false, c);
      }
    }
    if (!this.page) return;
    const entries = this.list(c), count = entries.length, onLeft = this.page === "emblem";
    if (this.touch) {
      const edge = onLeft ? left : right;
      const radius = Math.min(152, (f.height - f.top - f.bottom) * .30, (f.width - f.left - f.right) * .39);
      const side = Math.min(46, 2.58 * radius / (count + 1));
      const spread = count > 4 ? 1.30 : .87;
      for (let i = 0; i < count; i++) {
        const a = count === 1 ? 0 : -spread + 2 * spread * i / (count - 1);
        const distance = radius * (.65 + .13 * this.expanded);
        const px = edge + (onLeft ? 1 : -1) * Math.cos(a) * distance;
        this.tile(f, KEY_FIELD_LEAF + i, entries[i], px - side / 2, cy + Math.sin(a) * distance - side / 2, side, side, i === this.focus, true, c);
      }
    } else {
      // The tray stands over the hotbar's top edge, never on a slot: from its hub outward, kept on the canvas.
      const w = Math.min(76, (f.width - f.left - f.right - 12) / count), h = 70;
      const x0 = Math.max(f.left + 4, Math.min(f.width - f.right - count * w - 4, onLeft ? left : right + size * 3 - count * w));
      const y = Math.min(cy - size / 2, bottom - cell) - h - 8;
      for (let i = 0; i < count; i++) this.tile(f, KEY_FIELD_LEAF + i, entries[i], x0 + i * w, y, w, h, i === this.focus, true, c);
    }
  }

  private edge(f: UiFrame, left: boolean, edge: number, cy: number, c: ScreenCtx): void {
    const opened = left ? this.page === "emblem" : !!this.page && this.page !== "emblem";
    const radius = opened ? Math.min(152, (f.height - f.top - f.bottom) * .30, (f.width - f.left - f.right) * .39) : 30;
    rim(f, KEY_RIM + (left ? 0 : 1), left, edge, cy, radius, opened ? 1 : .71, opened ? .30 + .70 * this.expanded : 1);
    const x = left ? edge : edge - 35;
    this.tile(f, KEY_FIELD_HUB + (left ? 0 : 3), this.find(left ? "emblem" : "actions", c), x, cy - 24, 35, 48, false, false, c);
  }

  private tile(f: UiFrame, key: number, l: Leaf | undefined, x: number, y: number, w: number, h: number, active: boolean, leaf: boolean, c: ScreenCtx): void {
    if (!l) return;
    const enabled = this.available(l, c);
    // On a desktop a leaf's caption stands under its tile; by touch the chosen one's under its picture.
    const caption = leaf && (!this.touch || active), under = caption && !this.touch ? 15 : 0, th = h - under;
    if (!this.touch && !tile(f, key + 100, x + 2, y + 2, w - 4, th - 4, active)) {
      line(f, key + 100, x + 1, y + 1, w - 2, th - 2, active ? 0x24526d : 0x0b2438, active ? .84 : .61);
      line(f, key + 200, x + 1, y + th - 2, w - 2, active ? 2 : 1, active ? 0xa3e5ff : 0x86acc2, active ? 1 : .65);
    }
    const icon = Math.min(w - 8, th - (caption && this.touch ? 14 : 8));
    const pic = f.picture(key + 300, x + (w - icon) / 2, y + (th - icon) / 2 - (caption && this.touch ? 4 : 0), icon, icon, S_LABEL, "ui:glass-" + l.art);
    if (pic) pic.alpha = enabled ? 1 : .39;
    if (caption || !pic) {
      const n = f.text(key + 400, x - 8, y + h - 14, w + 16, under ? S_HUD_CAPTION : S_HUD_KEY, l.label);
      n.alpha = enabled ? .95 : .6;
    }
    const hit = f.add(key, this.touch ? K_HOLD : K_BUTTON, x, y, w, h, S_HUD_HIT);
    hit.interactive = true; hit.label = l.label + (enabled ? "" : " (unavailable)");
  }
}
