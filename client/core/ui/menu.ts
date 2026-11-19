import { MINIMAP_SIZE, type HudModel } from "../hud.ts";
import type { SiteLink } from "../travel.ts";
import { K_BUTTON, K_HOLD, K_PANEL, textWidth, type UiFrame } from "./nodes.ts";
import { pill, type TouchPlan } from "./touch.ts";
import { glass } from "./skin.ts";
import { S_UNMUTE, S_ICE, S_MENU, S_MENU_BUTTON, S_MENU_MAIN, S_MENU_NOTE, S_MENU_FOCUS, S_HUD_HIT } from "./style.ts";

export const KEY_MENU = 5400;
export const KEY_MENU_OPEN = 5399;
/** Shown over every screen while the sound is muted (Settings.muted); a press unmutes. */
export const KEY_UNMUTE = 5398;
const UNMUTE_TEXT = "Unmute sound";
export const KEY_MENU_RESUME = 5401;
export const KEY_MENU_SETTINGS = 5402;
export const KEY_MENU_CONTROLS = 5403;
export const KEY_MENU_BACK = 5404;
export const KEY_MENU_LEAVE = 5405;
/** Shown while the server shows creative mode (RULE_CREATIVE). */
export const KEY_MENU_CREATIVE = 5406;
export const KEY_MENU_DETAILS = 5410;
/** The links the server names (links.json), a button each beneath Controls: +n the nth. */
export const KEY_MENU_LINK = 5420;
/** The most links the menu has room for. */
const MAX_LINKS = 2;
export const KEY_CONTROLS_DEVICE = 5430;

export function menuButton(f: UiFrame, key: number, x: number, y: number, width: number, text: string, primary = false, height = 44): void {
  if (primary) f.add(70000 + key, K_PANEL, x - 12, y + 2, width + 12, height - 4, S_MENU_FOCUS);
  const n = f.add(key, K_BUTTON, x, y, width, height, primary ? S_MENU_MAIN : S_MENU_BUTTON);
  n.text = text; n.label = text; n.interactive = true;
  if (primary) f.add(80000 + key, K_PANEL, x - 12, y + 8, 2, height - 16, S_ICE);
}

/**
 * The offer to unmute: at the top, in the middle where there is room and otherwise left of the minimap; by touch under
 * the bar in the top left, where `touch` keeps a row for it. Call it after the screens: where one has a control there
 * (choosing where to rise fills the window) the offer is left out, and the HUD and the menu have it again.
 */
export function unmuteButton(f: UiFrame, touch: TouchPlan | null): void {
  const w = Math.ceil(textWidth(UNMUTE_TEXT, S_UNMUTE)) + 32, h = 44, left = f.left + 12;
  const y = touch ? touch.stackY - 52 : f.top + 12;
  const x = touch ? left : Math.max(left, Math.min(Math.round((f.width - w) / 2), f.width - f.right - 12 - MINIMAP_SIZE - 10 - w));
  for (let i = 0; i < f.count; i++) {
    const q = f.nodes[i]!;
    if (q.interactive && q.kind !== K_HOLD && x < q.x + q.w && q.x < x + w && y < q.y + q.h && q.y < y + h) return;
  }
  // The HUD's glass under it, or by touch the touch sheet's pill, which that page already has.
  if (touch) pill(f, 3400000, x, y, w, h, false);
  else { glass(f, KEY_UNMUTE, x, y, w, h); f.add(90000 + KEY_UNMUTE, K_PANEL, x + 14, y + h - 7, w - 28, 2, S_ICE); }
  const n = f.add(KEY_UNMUTE, K_BUTTON, x, y, w, h, S_UNMUTE);
  n.text = UNMUTE_TEXT; n.label = "Sound is off: unmute"; n.interactive = true;
}

export function menuBackdrop(f: UiFrame, alpha = 1): void {
  f.add(KEY_MENU, K_PANEL, 0, 0, f.width, f.height, S_MENU).alpha = alpha;
}

export function buildMenu(f: UiFrame, hud: HudModel, connected: boolean, focus = KEY_MENU_RESUME, links: readonly SiteLink[] = [], creative = false): void {
  menuBackdrop(f);
  // The wiki and the source, as the server names them, beneath Controls; each opens beside the game.
  const shown = links.slice(0, MAX_LINKS);
  // Its actions step 53 units, or closer where a short canvas has not the room for all of them at that.
  const rows = 4 + shown.length + (creative ? 1 : 0), room = f.height - f.top - f.bottom - 16;
  const pitch = Math.max(32, Math.min(53, Math.floor((room - 144) / rows))), tall = Math.min(44, pitch - 4);
  const w = Math.min(300, f.width - f.left - f.right - 48), h = 144 + rows * pitch;
  const x = f.left + Math.round(Math.max(24, f.width * .065)), y = Math.max(f.top + 8, Math.round((f.height - h) / 2));
  glass(f, KEY_MENU, x, y, w, h);
  f.text(KEY_MENU_DETAILS + 2, x + 22, y + 18, 80, S_MENU_NOTE, "ESC");
  const actions = [[KEY_MENU_RESUME, connected ? "Resume" : "Reconnect"], [KEY_MENU_SETTINGS, "Settings"], [KEY_MENU_CONTROLS, "Controls"], ...(creative ? [[KEY_MENU_CREATIVE, "Creative"]] : []), ...shown.map((link, n) => [KEY_MENU_LINK + n, link.label]), ...(connected ? [[KEY_MENU_LEAVE, "Leave"]] : [])] as [number, string][];
  actions.forEach(([key, label], i) => menuButton(f, key, x + 42, y + 68 + i * pitch, w - 62, label, focus === key, tall));
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
