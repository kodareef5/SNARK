import { SETTING_ROWS, type Settings } from "../settings.ts";
import { K_BAR, K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { glass } from "./skin.ts";
import { KEY_MENU_BACK, menuBackdrop, smallButton } from "./menu.ts";
import { S_MENU_HEADING, S_MENU_NOTE, S_ICE, S_LABEL, S_HUD_HIT } from "./style.ts";

export const KEY_SETTINGS_PANEL = 2300;
export const KEY_SETTINGS_TITLE = 2301;
export const KEY_SETTINGS_ROW = 2310;
export const KEY_SETTINGS_MIC = 2390;
export const KEY_SETTINGS_TAB = 2270;
export const SETTING_GROUPS = [
  { name: "Display", rows: [11, 12, 2, 0] },
  { name: "Audio", rows: [5, 6, 7, 8, 9, 3, 4] },
  { name: "Input", rows: [1] },
  { name: "Interface", rows: [14, 15, 16, 13, 10] },
] as const;

export function buildSettings(f: UiFrame, s: Settings, micLevel = 0, focus = 0): void {
  menuBackdrop(f);
  const w = Math.min(f.width - 32, 650), h = 480, x = Math.round((f.width - w) / 2), y = Math.round((f.height - h) / 2);
  f.add(KEY_SETTINGS_PANEL, K_PANEL, x, y, w, h, S_HUD_HIT);
  glass(f, KEY_SETTINGS_PANEL, x, y, w, h);
  f.text(KEY_SETTINGS_TITLE, x + 24, y + 20, w - 140, S_MENU_HEADING, "Settings");
  smallButton(f, KEY_MENU_BACK, x + w - 80, y + 16, 56, 36, "Back", "Back", focus === KEY_MENU_BACK);
  const tabW = (w - 48) / SETTING_GROUPS.length;
  SETTING_GROUPS.forEach((group, i) => smallButton(f, KEY_SETTINGS_TAB + i, x + 24 + i * tabW, y + 66, tabW - 8, 34, group.name, group.name, s.tab === i));
  const group = SETTING_GROUPS[s.tab] ?? SETTING_GROUPS[0];
  group.rows.forEach((i, rowAt) => {
    const row = SETTING_ROWS[i]!, ry = y + 118 + rowAt * 39, key = KEY_SETTINGS_ROW + i * 4, right = x + w - 24;
    const labelW = w - 242;
    f.text(key, x + 24, ry + 9, labelW, S_MENU_NOTE, fitText(row.label, labelW, S_MENU_NOTE));
    f.text(key + 1, right - 188, ry + 9, 106, S_MENU_NOTE, fitText(row.value(s), 106, S_MENU_NOTE));
    smallButton(f, key + 2, right - 72, ry, 32, 34, "−", `Decrease ${row.label}`, focus === key + 2);
    smallButton(f, key + 3, right - 32, ry, 32, 34, "+", `Increase ${row.label}`, focus === key + 3);
    f.add(60000 + key, K_PANEL, x + 24, ry + 37, w - 48, 1, S_ICE).alpha = .10;
  });
  if (s.tab === 1) {
    f.text(KEY_SETTINGS_MIC, x + 24, y + h - 46, 100, S_LABEL, "Microphone");
    const bar = f.add(KEY_SETTINGS_MIC + 1, K_BAR, x + 140, y + h - 39, w - 164, 4, S_ICE);
    const db = micLevel > 0 ? 20 * Math.log10(micLevel) : -60;
    bar.value = Math.max(0, Math.min(1, 1 + db / 60));
  }
  if (s.tab === 2) f.text(KEY_SETTINGS_MIC + 2, x + 24, y + 192, w - 48, S_MENU_NOTE, "Keyboard and controller layouts are in Controls.");
}

export function settingsClick(key: number, s: Settings): boolean {
  if (key >= KEY_SETTINGS_TAB && key < KEY_SETTINGS_TAB + SETTING_GROUPS.length) { s.tab = key - KEY_SETTINGS_TAB; return true; }
  const k = key - KEY_SETTINGS_ROW;
  if (k < 0 || k >= SETTING_ROWS.length * 4 || k % 4 < 2) return false;
  SETTING_ROWS[k >> 2]!.step(s, k % 4 === 2 ? -1 : 1);
  s.changed();
  return true;
}
