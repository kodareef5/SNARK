// Every action is a command, and the grids show what the server last said, so nothing here can get out of step with it.
// A click picks a stack up or puts it down, a middle click picks up half, and a right click eats, uses or puts on.

import { CUE_HURT_SHIFT } from "../../../shared/anim/pose.ts";
import { makeHandle } from "../../../shared/ids.ts";
import type { ItemDef } from "../../../shared/content/defs.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { BOX_OPEN, BOX_SELF, CMD_ATTACH, CMD_CLOSE, CMD_DETACH, CMD_DROP, CMD_LOAD, CMD_MOVE, CMD_REPAIR, CMD_UNLOAD, CMD_FEED, CMD_ORDER, ORDER_FOLLOW, ORDER_LEVEL, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, ORDER_UNSADDLE, ORDER_WANDER, ORDER_YOURS, CMD_USE, CMD_CRAFT_BLUEPRINT, CMD_VEHICLE, VEHICLE_REFUEL, VEHICLE_REPAIR } from "../../../shared/net/protocol.ts";
import { VEHICLE_FUEL_PER_GASOLINE, VEHICLE_REPAIR_BILL, VEHICLE_REPAIR_STEP } from "../../../shared/sim/vehicle-maintenance.ts";
import { ARMOR_SLOTS, FLAG_BLUEPRINT, HOTBAR_SLOTS, QUALITY_MUL, QUALITY_NAMES, blueprintCost, type Inventory } from "../../../shared/sim/items.ts";
import { RemoteSample, type ClientSession } from "../session.ts";
import { K_BUTTON, K_PANEL, columns, lineHeight, wrap, type UiFrame } from "./nodes.ts";
import { KEY_STATION_VIEW, StationPanel } from "./station.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_SLOT, S_SLOT_HELD, S_SLOT_TEXT, S_SWATCH, S_TITLE } from "./style.ts";

export const KEY_INV_PANEL = 290;
export const KEY_INV_TITLE = 291;
export const KEY_INV_INFO = 292;
export const KEY_OPEN_PANEL = 293;
export const KEY_OPEN_TITLE = 294;
/** Slot `s` of the survivor's own inventory is node KEY_INV_SLOT + 3 * s (then its swatch and its count). */
export const KEY_INV_SLOT = 300;
/** The open container's slots, the same way, but numbered by place on the page shown. A vault has more slots than one page holds. */
export const KEY_OPEN_SLOT = 600;
/** Three keys: page back, the "1 / 3" line, page on. */
export const KEY_OPEN_PAGE = 296;
/** The status line of the creature whose inventory is open. */
export const KEY_OPEN_SUBJECT = 299;
/** For an owned creature: follow or stay, then its stance. KEY_OPEN_LEVEL is one button per stat a level can go into. */
export const KEY_OPEN_ORDER = 270;
export const KEY_OPEN_LEVEL = 272;
export const KEY_OPEN_UNSADDLE = 279;
export const KEY_OPEN_MATE = 295;
/** Wander, or stop wandering, which is staying. */
export const KEY_OPEN_WANDER = 288;
const LEVEL_STATS: readonly [stat: number, mark: string][] = [[0, "health"], [1, "stam"], [2, "oxy"], [3, "food"], [5, "weight"], [6, "melee"], [7, "speed"]];
/** By stance, the last "attack your target", which takes ORDER_YOURS. */
const STANCE_WORDS: readonly string[] = ["passive", "neutral", "aggressive", "attack your target"];
const STAGE_WORDS: readonly string[] = ["baby", "juvenile", "adolescent"];

/** Formats seconds as "45s", "12m" or "5h 12m". */
export function waitWords(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
/** Rows of the open container shown at once. */
const OPEN_ROWS = 6;
/** Labels of the hotbar and armor rows, and the four buttons that act on the picked-up stack. */
export const KEY_INV_ROW_LABEL = 280;
export const KEY_INV_ACTION = 284;
const ACTIONS: readonly string[] = ["Drop", "Repair", "Unload", "Detach"];
const ARMOR_LABELS: readonly string[] = ["head", "torso", "hands", "legs", "feet"];
const CELL = 42;
const GAP = 3;
const PAD = 12;

/** The button that makes one from the picked-up blueprint. */
export const KEY_INV_CRAFT = 297;
export const KEY_VEHICLE_SERVICE = 2860;
export const KEY_VEHICLE_REFUEL = 2898;
export const KEY_VEHICLE_REPAIR = 2899;
export const KEY_INV_DEPLOY = 2900;
export const KEY_VEHICLE_TAB = 2901;
/** A slot's colour by quality: none for primitive, then green, blue, purple, gold and cyan, as ARK's tiers read. */
const QUALITY_TINT: readonly number[] = [-1, 0x3f7a42, 0x31579a, 0x6c4290, 0x8f7426, 0x2b8790];

/** The info line of a blueprint: its quality, what it makes, and what making one takes at that quality. */
export function blueprintInfo(reg: Registry, item: number, q: number): string {
  const needs = reg.recipeOf[item];
  const cost: string[] = [];
  for (let k = 0; needs && k + 1 < needs.length; k += 2) cost.push(`${blueprintCost(needs[k + 1]!, q)} ${itemLabel(reg, needs[k]!)}`);
  return `${QUALITY_NAMES[q] ?? ""} ${itemLabel(reg, item)} blueprint: ${cost.join(", ")}`;
}

export function itemLabel(reg: Registry, item: number): string {
  const def = reg.defs[item] as ItemDef | null;
  return def?.label ?? reg.ids[item]!.slice(reg.ids[item]!.indexOf(":") + 1);
}

export class InventoryScreen {
  open = false;
  /** The app starts the world preview; the inventory never creates a vehicle directly. */
  onDeploy: ((slot: number) => void) | null = null;
  private readonly vehicleSample = new RemoteSample();
  private vehicleBag = false;
  private service: { handle: number; fuel: boolean; repair: boolean; lines: string[] } | null = null;
  /** Box and slot of the picked-up stack. `held` is -1 for none. */
  heldBox = BOX_SELF;
  held = -1;
  /** Move only half of the picked-up stack. */
  private half = false;
  /** Box and slot under the pointer. `hover` is -1 for none. */
  hoverBox = BOX_SELF;
  hover = -1;
  private hadOpen = false;
  /** Paging of the open container. */
  page = 0;
  private pageSize = 60;
  private pages = 1;
  /** As of the last build. pointer() uses it to tell a load or an attach from a move. */
  private registry: Registry | null = null;
  /** What an open crafting station makes, and its queue. */
  private readonly station = new StationPanel();

  private box(session: ClientSession, which: number): Inventory | null {
    return which === BOX_OPEN ? (session.open?.inventory ?? null) : session.inventory;
  }

  /** The box and slot a node key names, as box * 1000 + slot, or -1. */
  private where(key: number, session: ClientSession): number {
    const own = session.inventory;
    const s = (key - KEY_INV_SLOT) / 3;
    if (own && key < KEY_OPEN_SLOT && Number.isInteger(s) && s >= 0 && s < own.cap) return BOX_SELF * 1000 + s;
    // An open container's key gives the place on the page, and the page gives the slot.
    const other = session.open?.inventory;
    const i = (key - KEY_OPEN_SLOT) / 3;
    if (other && Number.isInteger(i) && i >= 0 && i < this.pageSize && this.page * this.pageSize + i < other.cap) return BOX_OPEN * 1000 + this.page * this.pageSize + i;
    return -1;
  }

  /** Also closes the open container. */
  close(session: ClientSession | null): void {
    this.open = false;
    this.held = -1;
    if (session?.open) session.command(CMD_CLOSE);
  }

  /** `kind` is 0 for down, 1 for up, 2 for move. */
  pointer(kind: number, key: number, button: number, session: ClientSession): void {
    const at = this.where(key, session);
    const box = at < 0 ? BOX_SELF : Math.floor(at / 1000);
    const slot = at < 0 ? -1 : at % 1000;
    if (kind === 2) {
      this.hoverBox = box;
      this.hover = slot;
      return;
    }
    if (kind === 0 && this.registry && this.station.click(key, session, this.registry)) return;
    if (kind === 0 && key === KEY_VEHICLE_TAB) { this.vehicleBag = !this.vehicleBag; return; }
    if (kind === 0 && (key === KEY_VEHICLE_REFUEL || key === KEY_VEHICLE_REPAIR)) {
      const service = this.service, refuel = key === KEY_VEHICLE_REFUEL;
      if (service && (refuel ? service.fuel : service.repair)) session.command(CMD_VEHICLE, w => { w.u8(refuel ? VEHICLE_REFUEL : VEHICLE_REPAIR); w.u32(service.handle); if (refuel) w.u8(0); });
      return;
    }
    if (kind === 0 && key === KEY_INV_DEPLOY && this.heldBox === BOX_SELF && this.held >= 0 && this.registry?.vehicleDeploy[session.inventory?.item[this.held] ?? 0]) {
      this.onDeploy?.(this.held); if (this.onDeploy) this.close(session); return;
    }
    const subject = this.service ? null : session.subject;
    if (kind === 0 && subject?.owned && subject.id >= 0 && key >= KEY_OPEN_ORDER && key <= KEY_OPEN_UNSADDLE) {
      // Orders to an owned creature: follow or stay, the next stance, saddle off, or a level into a stat.
      const next = (subject.stance + 1) % STANCE_WORDS.length;
      const what = key === KEY_OPEN_UNSADDLE ? ORDER_UNSADDLE : key === KEY_OPEN_ORDER ? (subject.following ? ORDER_STAY : ORDER_FOLLOW) : key === KEY_OPEN_ORDER + 1 ? (next === STANCE_WORDS.length - 1 ? ORDER_YOURS : ORDER_STANCE + next) : ORDER_LEVEL + LEVEL_STATS[key - KEY_OPEN_LEVEL]![0];
      session.command(CMD_ORDER, (w) => (w.u32(subject.id), w.u8(what)));
      return;
    }
    if (kind === 0 && subject?.owned && subject.id >= 0 && key === KEY_OPEN_WANDER) {
      session.command(CMD_ORDER, (w) => (w.u32(subject.id), w.u8(subject.wandering ? ORDER_STAY : ORDER_WANDER)));
      return;
    }
    if (kind === 0 && subject?.owned && subject.id >= 0 && key === KEY_OPEN_MATE) {
      session.command(CMD_ORDER, (w) => (w.u32(subject.id), w.u8(subject.mating ? ORDER_UNMATE : ORDER_MATE)));
      return;
    }
    if (kind === 0 && (key === KEY_OPEN_PAGE || key === KEY_OPEN_PAGE + 2)) {
      this.page = Math.max(0, Math.min(this.pages - 1, this.page + (key === KEY_OPEN_PAGE ? -1 : 1)));
      return;
    }
    if (kind === 0 && key === KEY_INV_CRAFT) {
      // One made from the picked-up blueprint, where it lies: the server says if that is not where it is made.
      const bp = this.box(session, this.heldBox);
      const from = this.held;
      const which = this.heldBox;
      this.held = -1;
      if (bp && from >= 0 && (bp.flags[from]! & FLAG_BLUEPRINT) !== 0) session.command(CMD_CRAFT_BLUEPRINT, (w) => (w.bits(which, 1), w.varint(from), w.u8(1)));
      return;
    }
    if (kind === 0 && key >= KEY_INV_ACTION && key < KEY_INV_ACTION + ACTIONS.length) {
      // The four buttons act on a stack picked up from the survivor's own slots.
      const own = session.inventory;
      const from = this.held;
      this.held = -1;
      if (!own || from < 0 || this.heldBox !== BOX_SELF || own.item[from] === 0) return;
      const op = [CMD_DROP, CMD_REPAIR, CMD_UNLOAD, CMD_DETACH][key - KEY_INV_ACTION]!;
      session.command(op, (w) => {
        w.varint(from);
        if (op === CMD_DROP) (w.u16(0), w.u16(own.item[from]!));
      });
      return;
    }
    const inv = this.box(session, box);
    if (kind !== 0 || slot < 0 || !inv) return;
    if (button === 2) {
      // Only a carried item can be used, but a torpor dose in an open creature's inventory can be fed to it.
      if (box === BOX_SELF && this.registry?.vehicleDeploy[inv.item[slot]!] && !(inv.flags[slot]! & FLAG_BLUEPRINT)) {
        this.onDeploy?.(slot); if (this.onDeploy) this.close(session);
      } else if (box === BOX_SELF && inv.item[slot] !== 0) session.command(CMD_USE, (w) => (w.varint(slot), w.u16(inv.item[slot]!)));
      else if (box === BOX_OPEN && session.subject && inv.item[slot] !== 0 && (this.registry?.doseTorpor[inv.item[slot]!] ?? 0) > 0) session.command(CMD_FEED, (w) => (w.varint(slot), w.u16(inv.item[slot]!)));
      this.held = -1;
      return;
    }
    if (this.held < 0) {
      if (inv.item[slot] === 0) return;
      this.heldBox = box;
      this.held = slot;
      this.half = button === 1;
      return;
    }
    const fromBox = this.heldBox;
    const from = this.held;
    const src = this.box(session, fromBox);
    this.held = -1;
    if (!src || (fromBox === box && from === slot) || src.item[from] === 0) return;
    const count = this.half ? Math.max(1, src.count[from]! >> 1) : 0;
    // Ammunition put down on a carried weapon that takes it sets the weapon's ammunition kind. An attachment that fits is attached.
    const target = fromBox === BOX_SELF && box === BOX_SELF && this.registry ? (this.registry.defs[inv.item[slot]!] as ItemDef | null)?.weapon : undefined;
    const what = this.registry?.ids[src.item[from]!] ?? "";
    if (target?.ammo?.includes(what)) {
      session.command(CMD_LOAD, (w) => (w.varint(slot), w.u16(src.item[from]!)));
      return;
    }
    if (target?.fits?.includes(what)) {
      session.command(CMD_ATTACH, (w) => (w.varint(slot), w.varint(from)));
      return;
    }
    session.command(CMD_MOVE, (w) => {
      w.bits(fromBox, 1);
      w.varint(from);
      w.bits(box, 1);
      w.varint(slot);
      w.u16(count);
      w.u16(src.item[from]!);
    });
  }

  build(f: UiFrame, session: ClientSession | null, reg: Registry | null, palette: Uint8Array | null): void {
    // A container the server has just opened brings the screen up with it.
    const isOpen = !!session?.open;
    if (isOpen && !this.hadOpen) {
      this.open = true;
      this.page = 0; this.vehicleBag = false;
    }
    this.hadOpen = isOpen;
    const own = session?.inventory;
    if (!this.open || !own || !session || !reg) return;
    const other = session.open?.inventory ?? null;
    const heldInv = this.box(session, this.heldBox);
    if (this.held >= 0 && (!heldInv || heldInv.item[this.held] === 0)) this.held = -1;

    this.registry = reg;
    const cols = Math.max(4, Math.min(10, Math.floor((f.width - PAD * 4) / (CELL + GAP))));
    const w = cols * (CELL + GAP) - GAP + PAD * 2;
    const titleH = lineHeight(S_TITLE);
    const infoH = lineHeight(S_LABEL);
    const rows = (n: number): number => Math.ceil(n / cols) * (CELL + GAP);
    // Own slots are the bag, then the hotbar and the armor if the inventory has them, each under a label.
    const tail = own.hotbar >= 0;
    const tailH = tail ? infoH * 2 + rows(HOTBAR_SLOTS) + rows(ARMOR_SLOTS) + 4 : 0;
    const actionH = tail ? 28 : 0;
    const ownH = titleH + rows(own.bag) + tailH + infoH + actionH + PAD * 2 + 6;
    this.pageSize = cols * OPEN_ROWS;
    this.pages = other ? Math.max(1, Math.ceil(other.bag / this.pageSize)) : 1;
    if (this.page >= this.pages) this.page = this.pages - 1;
    let onPage = other ? Math.min(this.pageSize, other.bag - this.page * this.pageSize) : 0;
    // An open creature has a status line under its name.
    const subject = other ? session.subject : null;
    this.service = null;
    if (subject && typeof session.sampleRemote === "function") {
      session.sampleRemote(this.vehicleSample);
      const r = this.vehicleSample, index = r.id.subarray(0, r.count).indexOf(subject.id);
      const def = index >= 0 ? reg.vehicle[r.kind[index]!] : null;
      if (def && index >= 0) {
        const hull = session.looked?.id === subject.id && session.looked.health >= 0 ? `${Math.round(session.looked.health * 100)}%` : ["75–100%", "50–75%", "25–50%", "under 25%"][(r.cue[index]! >>> CUE_HURT_SHIFT) & 3]!;
        const fuel = r.vehicleFuel[index]!, engine = r.vehicleEngineCondition[index]!, rotor = r.vehicleRotorCondition[index]!;
        const stopped = r.vehicleGrounded[index] !== 0 && (def.movement !== "rotor" || (!r.vehicleEngineOn[index] && r.vehicleRotorRpm[index]! <= 30));
        const gasoline = reg.index.get("core:gasoline")!, haveFuel = own.total(gasoline);
        const repairItems = VEHICLE_REPAIR_BILL.map(([id]) => own.total(reg.index.get(id)!));
        const maxCost = VEHICLE_REPAIR_BILL.map(([, n]) => Math.ceil(n * VEHICLE_REPAIR_STEP));
        const lines = [`Hull ${hull} | Fuel ${(fuel * def.spec.fuelCapacity).toFixed(1)}/${def.spec.fuelCapacity}`];
        if (def.movement === "rotor") lines.push(`Engine ${Math.round(engine * 100)}% | Rotor ${Math.round(rotor * 100)}%`);
        lines.push(stopped ? "Service available when stationary" : "To service: land and wait for rotors to stop");
        lines.push(`Refuel: ${VEHICLE_FUEL_PER_GASOLINE} fuel per gasoline | carrying ${haveFuel}`);
        lines.push(`Repair: up to ${VEHICLE_REPAIR_STEP * 100}%; at most ${maxCost[0]} ingots, ${maxCost[1]} polymer, ${maxCost[2]} electronics`);
        lines.push(`Materials: ${repairItems[0]} ingots, ${repairItems[1]} polymer, ${repairItems[2]} electronics`);
        this.service = { handle: makeHandle(subject.id, r.gen[index]!), fuel: stopped && fuel < .9999 && haveFuel > 0,
          repair: stopped && repairItems.every(n => n > 0), lines: [] };
        for (const line of lines) wrap(line, columns(w - PAD * 2, S_LABEL), this.service.lines);
      }
    }
    // An owned one has a row of buttons under that, and a second row when it has levels to spend.
    const orderH = !this.service && subject?.owned ? 28 + (subject.points > 0 ? 28 : 0) : 0;
    const subjectH = this.service ? this.service.lines.length * infoH + 30 : subject ? infoH + 2 + orderH : 0;
    if (this.service && other) {
      const roomRows = Math.max(1, Math.min(OPEN_ROWS, Math.floor((f.height - titleH - subjectH - PAD * 2 - 48) / (CELL + GAP))));
      this.pageSize = cols * roomRows; this.pages = Math.max(1, Math.ceil(other.bag / this.pageSize));
      if (this.page >= this.pages) this.page = this.pages - 1;
    }
    onPage = other ? Math.min(this.pageSize, other.bag - this.page * this.pageSize) : 0;
    const otherH = other ? titleH + subjectH + rows(this.pages > 1 ? this.pageSize : other.bag) + PAD * 2 : 0;
    // An open crafting station's panel goes beside the column, the two centred together. Where the canvas is too narrow for
    // both, the open container's title row has a button that shows the panel alone, in place of the inventory.
    const stationW = other && this.station.showing(session) ? this.station.width(f) + 8 : 0;
    const narrow = stationW > 0 && w + stationW > f.width - 8;
    this.station.begin(session, narrow);
    const vehicleWide = !!this.service && f.width >= 2 * w + 16, vehicleNarrow = !!this.service && !vehicleWide;
    let x0 = Math.round((f.width - w - (vehicleWide ? w + 8 : narrow ? 0 : stationW)) / 2);
    let y = Math.max(4, Math.round((f.height - ownH - otherH - (other ? 8 : 0)) / 2));
    if (this.service) y = vehicleNarrow ? 36 : Math.max(4, Math.round((f.height - Math.max(ownH, otherH)) / 2));
    if (vehicleNarrow) {
      const tab = f.add(KEY_VEHICLE_TAB, K_BUTTON, x0, 4, w, 26, S_BUTTON);
      tab.text = this.vehicleBag ? "Aircraft / cargo" : "Your bag"; tab.interactive = true;
    }
    const tick = session.serverTick;
    if (narrow && this.station.alone) {
      this.held = -1;
      this.station.build(f, session, reg, Math.round((f.width - stationW + 8) / 2), 4);
      return;
    }

    /** Slots `from` .. `from + n - 1` of `inv` as a grid starting at `top`. */
    const grid = (inv: Inventory, which: number, base: number, top: number, from: number, n: number): void => {
      for (let i = 0; i < n; i++) {
        const s = from + i;
        const x = x0 + PAD + (i % cols) * (CELL + GAP);
        const yy = top + Math.floor(i / cols) * (CELL + GAP);
        const inHand = which === BOX_SELF && inv.hotbar >= 0 && s === inv.hotbar + session.held;
        const key = base + (which === BOX_OPEN ? i : s) * 3;
        const cell = f.add(key, K_BUTTON, x, yy, CELL, CELL, this.held === s && this.heldBox === which ? S_SLOT_HELD : S_SLOT);
        cell.interactive = true;
        if (inHand && cell.style === S_SLOT) cell.tint = 0x5a6a7a;
        const item = inv.item[s]!;
        if (item === 0) continue;
        // Quality shows as the cell's colour, and a blueprint as "BP" where a count would be.
        const bp = (inv.flags[s]! & FLAG_BLUEPRINT) !== 0;
        if (inv.quality[s]! > 0 && cell.style === S_SLOT && !inHand) cell.tint = QUALITY_TINT[inv.quality[s]!] ?? -1;
        const def = reg.defs[item] as ItemDef | null;
        // The item's picture fills the slot where it has one. Else its colour and the first letters of its name stand in.
        if (!f.picture(key + 1, x + 2, yy + 2, CELL - 4, CELL - 4, S_SLOT_TEXT, reg.ids[item]!)) {
          const swatch = f.add(key + 1, K_PANEL, x + 4, yy + 4, CELL - 8, CELL - 20, S_SWATCH);
          const c = (def?.color ?? 15) * 4;
          if (palette) swatch.tint = (palette[c]! << 16) | (palette[c + 1]! << 8) | palette[c + 2]!;
          swatch.text = itemLabel(reg, item).slice(0, 4);
        }
        // A stack shows its count. A weapon shows its loaded rounds.
        const number = bp ? "BP" : inv.count[s]! > 1 ? String(inv.count[s]) : def?.weapon?.ammo ? String(inv.loaded[s]) : "";
        f.text(key + 2, x + 2, yy + CELL - lineHeight(S_SLOT_TEXT), CELL - 4, S_SLOT_TEXT, number);
      }
    };
    const fit = (text: string): string => text.slice(0, Math.floor((w - PAD * 2) / (18 * 0.6)));

    if (other && !(vehicleNarrow && this.vehicleBag)) {
      f.add(KEY_OPEN_PANEL, K_PANEL, x0, y, w, otherH, S_PANEL);
      const pagerW = this.pages > 1 ? 120 : 0;
      const viewW = narrow ? 84 : 0;
      const titleW = w - PAD * 2 - pagerW - (viewW > 0 ? viewW + GAP : 0);
      f.text(KEY_OPEN_TITLE, x0 + PAD, y + PAD, titleW, S_TITLE, fit(session.open!.name).slice(0, Math.floor(titleW / (18 * 0.6))));
      if (viewW > 0) {
        const b = f.add(KEY_STATION_VIEW, K_BUTTON, x0 + w - PAD - pagerW - (pagerW > 0 ? GAP : 0) - viewW, y + PAD - 2, viewW, 22, S_BUTTON);
        b.text = "Crafting";
        b.interactive = true;
      }
      if (this.pages > 1) {
        const px = x0 + w - PAD - pagerW;
        for (const [n, label] of [[0, "<"], [2, ">"]] as const) {
          const b = f.add(KEY_OPEN_PAGE + n, K_BUTTON, px + (n === 0 ? 0 : pagerW - 28), y + PAD - 2, 28, 22, S_BUTTON);
          b.text = label;
          b.interactive = true;
        }
        f.text(KEY_OPEN_PAGE + 1, px + 34, y + PAD + 2, pagerW - 68, S_LABEL, `${this.page + 1} / ${this.pages}`);
      }
      if (this.service) {
        const service = this.service, sy = y + PAD + titleH;
        for (let i = 0; i < service.lines.length; i++) f.text(KEY_VEHICLE_SERVICE + i, x0 + PAD, sy + i * infoH, w - PAD * 2, S_LABEL, service.lines[i]!);
        const bw = (w - PAD * 2 - GAP) / 2;
        for (const [i, key, label, enabled] of [[0, KEY_VEHICLE_REFUEL, "Refuel", service.fuel], [1, KEY_VEHICLE_REPAIR, "Repair up to 25%", service.repair]] as const) {
          const b = f.add(key, K_BUTTON, x0 + PAD + i * (bw + GAP), sy + service.lines.length * infoH + 3, bw, 24, S_BUTTON);
          b.text = label; b.interactive = enabled; b.alpha = enabled ? 1 : .45;
        }
      } else if (subject) {
        const pct = (v: number): string => `${Math.round(v * 100)}%`;
        const grown = subject.stage >= STAGE_WORDS.length;
        const sex = subject.breeds ? (subject.female ? "  female" : "  male") : "";
        const age = grown ? "" : `  ${STAGE_WORDS[subject.stage]} ${pct(subject.maturity)}`;
        const mate = !subject.mating ? "" : subject.mate > 0 ? `  mating ${pct(subject.mate)}` : subject.wait > 0 ? `  rests ${waitWords(subject.wait)}` : "";
        const line = subject.taming ? `taming ${pct(subject.progress)}  well ${pct(subject.te)}  torpor ${pct(subject.torpor)}  food ${pct(subject.food)}` : `level ${subject.level}${sex}${age}  torpor ${pct(subject.torpor)}  food ${pct(subject.food)}${mate}`;
        f.text(KEY_OPEN_SUBJECT, x0 + PAD, y + PAD + titleH, w - PAD * 2, S_LABEL, line.slice(0, Math.floor((w - PAD * 2) / 7.2)));
        if (subject.owned) {
          const top = y + PAD + titleH + infoH + 2;
          const mates = subject.breeds && grown;
          const across = 3 + (subject.saddled ? 1 : 0) + (mates ? 1 : 0);
          const half = (w - PAD * 2 - GAP * (across - 1)) / across;
          for (const [n, label] of [[0, subject.following ? "Stay here" : "Follow me"], [1, across > 2 ? (STANCE_WORDS[subject.stance] ?? "neutral") : `It is ${STANCE_WORDS[subject.stance] ?? "neutral"}`]] as const) {
            const b = f.add(KEY_OPEN_ORDER + n, K_BUTTON, x0 + PAD + n * (half + GAP), top, half, 24, S_BUTTON);
            b.text = label.slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
            b.interactive = true;
          }
          const wander = f.add(KEY_OPEN_WANDER, K_BUTTON, x0 + PAD + 2 * (half + GAP), top, half, 24, S_BUTTON);
          wander.text = (subject.wandering ? "Stop wandering" : "Wander").slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
          wander.interactive = true;
          if (subject.saddled) {
            const b = f.add(KEY_OPEN_UNSADDLE, K_BUTTON, x0 + PAD + 3 * (half + GAP), top, half, 24, S_BUTTON);
            b.text = "Unsaddle".slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
            b.interactive = true;
          }
          if (mates) {
            const b = f.add(KEY_OPEN_MATE, K_BUTTON, x0 + PAD + (across - 1) * (half + GAP), top, half, 24, S_BUTTON);
            b.text = (subject.mating ? "Mating on" : "Mating off").slice(0, Math.max(4, Math.floor((half - 6) / 8.4)));
            b.interactive = true;
          }
          if (subject.points > 0) {
            const each = (w - PAD * 2 - GAP * (LEVEL_STATS.length - 1)) / LEVEL_STATS.length;
            LEVEL_STATS.forEach(([, mark], n) => {
              const b = f.add(KEY_OPEN_LEVEL + n, K_BUTTON, x0 + PAD + n * (each + GAP), top + 28, each, 24, S_BUTTON);
              b.text = `+${mark}`.slice(0, Math.max(2, Math.floor((each - 6) / 8.4)));
              b.interactive = true;
            });
          }
        }
      }
      grid(other, BOX_OPEN, KEY_OPEN_SLOT, y + PAD + titleH + subjectH + 4, this.page * this.pageSize, onPage);
      if (stationW > 0 && !narrow) this.station.build(f, session, reg, x0 + w + 8, y);
      if (vehicleNarrow) return;
      if (vehicleWide) x0 += w + 8;
      else y += otherH + 8;
    }
    f.add(KEY_INV_PANEL, K_PANEL, x0, y, w, ownH, S_PANEL);
    f.text(KEY_INV_TITLE, x0 + PAD, y + PAD, w - PAD * 2, S_TITLE, fit(`Inventory  ${own.weight(reg).toFixed(1)} kg`));
    let top = y + PAD + titleH + 4;
    grid(own, BOX_SELF, KEY_INV_SLOT, top, 0, own.bag);
    top += rows(own.bag);
    if (tail) {
      f.text(KEY_INV_ROW_LABEL, x0 + PAD, top, w - PAD * 2, S_LABEL, "Hotbar: keys 1 to 0");
      top += infoH;
      grid(own, BOX_SELF, KEY_INV_SLOT, top, own.hotbar, HOTBAR_SLOTS);
      top += rows(HOTBAR_SLOTS);
      f.text(KEY_INV_ROW_LABEL + 1, x0 + PAD, top, w - PAD * 2, S_LABEL, `Worn: ${ARMOR_LABELS.join(", ")}`.slice(0, Math.floor((w - PAD * 2) / 7.2)));
      top += infoH;
      grid(own, BOX_SELF, KEY_INV_SLOT, top, own.armor, ARMOR_SLOTS);
      top += rows(ARMOR_SLOTS) + 4;
      const bw = (w - PAD * 2 - GAP * (ACTIONS.length - 1)) / ACTIONS.length;
      ACTIONS.forEach((label, i) => {
        const b = f.add(KEY_INV_ACTION + i, K_BUTTON, x0 + PAD + i * (bw + GAP), top, bw, 24, S_BUTTON);
        b.text = label;
        b.interactive = true;
      });
    }

    // One line about the picked-up stack, or else the stack under the pointer.
    const shownBox = this.held >= 0 ? this.heldBox : this.hoverBox;
    const shown = this.held >= 0 ? this.held : this.hover;
    const inv = this.box(session, shownBox);
    let info = this.held >= 0 ? "click a slot to put it down" : "left click: pick up   middle: half   right: use";
    if (inv && shown >= 0 && shown < inv.cap && inv.item[shown] !== 0) {
      const item = inv.item[shown]!;
      const spoil = inv.spoilAt[shown]!;
      info = `${itemLabel(reg, item)} x${inv.count[shown]}  ${(reg.weight[item]! * inv.count[shown]!).toFixed(1)} kg`;
      if (spoil > 0) info += `  spoils in ${Math.max(0, Math.ceil((spoil - tick) / 30))} s`;
      // An item with durability shows its quality and what is left. A weapon also shows its ammunition and attachment.
      const uses = reg.uses[item]!;
      if (uses > 0 && reg.stack[item] === 1) {
        info = `${QUALITY_NAMES[inv.quality[shown]!] ?? ""} ${itemLabel(reg, item)}  ${inv.dur[shown]}/${Math.round(uses * (QUALITY_MUL[inv.quality[shown]!] ?? 1))}`;
        if (inv.ammo[shown] !== 0) info += `  ${inv.loaded[shown]} ${itemLabel(reg, inv.ammo[shown]!)}`;
        if (inv.attach[shown] !== 0) info += `  + ${itemLabel(reg, inv.attach[shown]!)}`;
      }
      // A vessel holds its water as its durability (server/use.ts).
      const holds = (reg.defs[item] as ItemDef | null)?.use?.holds;
      if (holds) info += `  water ${inv.dur[shown]}/${holds.water}`;
      // Quality is named, and a blueprint says what one making from it takes.
      const q = inv.quality[shown]!;
      if (q > 0 && !info.startsWith(QUALITY_NAMES[q]!)) info = `${QUALITY_NAMES[q]} ${info}`;
      if ((inv.flags[shown]! & FLAG_BLUEPRINT) !== 0) info = blueprintInfo(reg, item, q);
    }
    // A picked-up blueprint can be made from, in the bag or in the station it belongs to.
    const deploy = this.onDeploy && this.heldBox === BOX_SELF && this.held >= 0 && heldInv && reg.vehicleDeploy[heldInv.item[this.held]!] && !(heldInv.flags[this.held]! & FLAG_BLUEPRINT);
    const craftW = deploy ? 76 : this.held >= 0 && heldInv && (heldInv.flags[this.held]! & FLAG_BLUEPRINT) !== 0 ? 64 : 0;
    if (craftW > 0) {
      const b = f.add(deploy ? KEY_INV_DEPLOY : KEY_INV_CRAFT, K_BUTTON, x0 + w - PAD - craftW, y + ownH - PAD - infoH - 2, craftW, infoH + 2, S_BUTTON);
      b.text = deploy ? "Assemble" : "Craft";
      b.interactive = true;
    }
    f.text(KEY_INV_INFO, x0 + PAD, y + ownH - PAD - infoH, w - PAD * 2 - craftW, S_LABEL, info.slice(0, Math.floor((w - PAD * 2 - craftW) / 7.2)));
  }
}
