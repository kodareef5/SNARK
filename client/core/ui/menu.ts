import type { HudModel } from "../hud.ts";
import type { SiteLink } from "../travel.ts";
import { K_BUTTON, K_PANEL, type UiFrame } from "./nodes.ts";
import { glass } from "./skin.ts";
import { S_ICE, S_MENU, S_MENU_BUTTON, S_MENU_MAIN, S_MENU_NOTE, S_MENU_FOCUS, S_HUD_HIT } from "./style.ts";

export const KEY_MENU = 5400;
export const KEY_MENU_OPEN = 5399;
export const KEY_MENU_RESUME = 5401;
export const KEY_MENU_SETTINGS = 5402;
export const KEY_MENU_CONTROLS = 5403;
export const KEY_MENU_BACK = 5404;
export const KEY_MENU_LEAVE = 5405;
export const KEY_MENU_DETAILS = 5410;
/** The links the server names (links.json), a button each beneath Controls: +n the nth. */
export const KEY_MENU_LINK = 5420;
/** The most links the menu has room for. */
const MAX_LINKS = 2;
export const KEY_CONTROLS_DEVICE = 5430;

export function menuButton(f: UiFrame, key: number, x: number, y: number, width: number, text: string, primary = false): void {
  if (primary) f.add(70000 + key, K_PANEL, x - 12, y + 2, width + 12, 40, S_MENU_FOCUS);
  const n = f.add(key, K_BUTTON, x, y, width, 44, primary ? S_MENU_MAIN : S_MENU_BUTTON);
  n.text = text; n.label = text; n.interactive = true;
  if (primary) f.add(80000 + key, K_PANEL, x - 12, y + 8, 2, 28, S_ICE);
}

export function menuBackdrop(f: UiFrame): void {
  f.add(KEY_MENU, K_PANEL, 0, 0, f.width, f.height, S_MENU);
}

export function buildMenu(f: UiFrame, hud: HudModel, connected: boolean, focus = KEY_MENU_RESUME, links: readonly SiteLink[] = []): void {
  menuBackdrop(f);
  // The wiki and the source, as the server names them, beneath Controls; each opens beside the game.
  const shown = links.slice(0, MAX_LINKS);
  const w = Math.min(300, f.width - 48), h = 356 + shown.length * 53;
  const x = Math.round(Math.max(24, f.width * .065)), y = Math.round((f.height - h) / 2);
  glass(f, KEY_MENU, x, y, w, h);
  f.text(KEY_MENU_DETAILS + 2, x + 22, y + 18, 80, S_MENU_NOTE, "ESC");
  const actions = [[KEY_MENU_RESUME, connected ? "Resume" : "Reconnect"], [KEY_MENU_SETTINGS, "Settings"], [KEY_MENU_CONTROLS, "Controls"], ...shown.map((link, n) => [KEY_MENU_LINK + n, link.label]), ...(connected ? [[KEY_MENU_LEAVE, "Leave"]] : [])] as [number, string][];
  actions.forEach(([key, label], i) => menuButton(f, key, x + 42, y + 68 + i * 53, w - 62, label, focus === key));
  f.add(KEY_MENU_DETAILS + 3, K_PANEL, x + 20, y + h - 52, w - 40, 1, S_ICE).alpha = .3;
  f.text(KEY_MENU_DETAILS, x + 22, y + h - 37, w - 44, S_MENU_NOTE, connected ? `${Math.round(hud.pingMs)} ms` : "Disconnected");
}

/** Where the menu's link button `key` goes; null for any other key. */
export function menuLink(key: number, links: readonly SiteLink[]): string | null {
  const n = key - KEY_MENU_LINK;
  return n >= 0 && n < Math.min(links.length, MAX_LINKS) ? links[n]!.url : null;
}

export function smallButton(f: UiFrame, key: number, x: number, y: number, w: number, h: number, text: string, label = text, selected = false): void {
  const b = f.add(key, K_BUTTON, x, y, w, h, S_HUD_HIT);
  b.text = text; b.label = label; b.interactive = true;
  if (selected) f.add(90000 + key, K_PANEL, x, y + h - 2, w, 1, S_ICE);
}
