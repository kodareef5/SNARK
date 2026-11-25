// The field menus reach the same screens, hotkeys and server commands as the rest of the HUD.
import { EMOTE_NUMBER } from "../../../shared/anim/emotes.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import type { ItemDef } from "../../../shared/content/defs.ts";
import { CMD_SELECT, CMD_USE } from "../../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT, HOTBAR_SLOTS, type Inventory } from "../../../shared/sim/items.ts";
import type { App } from "../app.ts";
import { KEY_CHAR_TAB, TAB_MAKE, TAB_STATS, type CharacterScreen } from "./character.ts";
import type { EmoteMenu } from "./emotes.ts";

export const DOCK_LABELS = {
  emblem: "Field menus", bag: "Inventory", craft: "Craft", map: "Map", survivor: "Survivor", radio: "Radio", settings: "Settings", menu: "Menu",
  whistles: "Whistles", kit: "Field kit", gestures: "Gestures", actions: "Actions",
  follow: "Follow", stay: "Stay", "attack-target": "Attack target",
  drink: "Drink", eat: "Eat berries", spyglass: "Equip spyglass", controls: "Play controls",
  wave: "Wave", point: "Point", salute: "Salute",
} as const;
export type DockItem = keyof typeof DOCK_LABELS;
export type DockAction = number | DockItem;
export type DockPage = "emblem" | "actions" | "whistles" | "kit" | "gestures";
export const DOCK_PAGES: Record<DockPage, readonly DockItem[]> = {
  emblem: ["bag", "craft", "survivor", "map", "radio", "settings", "menu"], actions: ["whistles", "kit", "gestures"],
  whistles: ["follow", "stay", "attack-target"], kit: ["drink", "eat", "spyglass", "controls"], gestures: ["wave", "point", "salute"],
};
const KEYS: Partial<Record<DockItem, string>> = { bag: "KeyI", craft: "KeyP", survivor: "KeyP", map: "KeyM", radio: "Enter", settings: "KeyO", menu: "Escape", follow: "KeyJ", stay: "KeyU", "attack-target": "Period" };
export const dockEmote = (id: DockItem) => id === "wave" || id === "point" || id === "salute";
export const dockSupply = (id: DockItem) => id === "drink" || id === "eat" || id === "spyglass";

/** Each use refers to the current slot and its expected content, including after an inventory move. */
export function supplySlot(id: DockItem, inv: Inventory | null, reg: Registry | null): number {
  if (!inv || !reg || !dockSupply(id)) return -1;
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

export function runDockAction(action: DockAction, app: App): void {
  const { session, ui, reg } = app;
  ui.inspect = false;
  if (typeof action === "number") {
    if (action < 0 || action >= HOTBAR_SLOTS || !Number.isInteger(action) || (session.inventory?.hotbar ?? -1) < 0) return;
    session.command(CMD_SELECT, w => w.u8(session.held === action ? 255 : action));
    return;
  }
  if (action === "controls") {
    if (ui.touch && ui.touchPlay) ui.touchPlay.tools = !ui.touchPlay.tools;
    return;
  }
  if (dockSupply(action)) {
    const inv = session.inventory;
    const slot = supplySlot(action, inv, reg);
    if (!inv || slot < 0) return;
    if (action === "spyglass") {
      if (session.held !== slot - inv.hotbar) session.command(CMD_SELECT, w => w.u8(slot - inv.hotbar));
    } else {
      session.command(CMD_USE, w => { w.varint(slot); w.u16(inv.item[slot]!); });
    }
    return;
  }
  if (dockEmote(action)) {
    const emote = EMOTE_NUMBER.get(action);
    if (emote !== undefined && ui.screen<EmoteMenu>("emotes").has(emote)) session.emote(0, emote);
    return;
  }
  const key = KEYS[action];
  if (!key) return;
  const device = ui.inputDevice;
  app.key(key, true, false, device);
  app.key(key, false, false, device);
  if (action === "craft" || action === "survivor") {
    const character = ui.screen<CharacterScreen>("character");
    if (character.isOpen()) character.click(KEY_CHAR_TAB + (action === "craft" ? TAB_MAKE : TAB_STATS), session, reg);
  }
}
