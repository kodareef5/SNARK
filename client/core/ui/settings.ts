import { SETTING_ROWS, type Settings } from "../settings.ts";
import { K_BAR, K_BUTTON, K_PANEL, lineHeight, type UiFrame } from "./nodes.ts";
import { S_BUTTON, S_LABEL, S_PANEL, S_STAMINA, S_TITLE } from "./style.ts";

export const KEY_SETTINGS_PANEL = 2300;
export const KEY_SETTINGS_TITLE = 2301;
/** Per row: its label, its value, its "-" button, its "+" button. */
export const KEY_SETTINGS_ROW = 2310;
const ROW = 30;
const PAD = 14;
const BUTTON = 30;

/** The microphone row: its label, then a bar of its level now. */
export const KEY_SETTINGS_MIC = 2390;

export function buildSettings(f: UiFrame, s: Settings, micLevel = 0): void {
  const w = Math.min(f.width - 16, 420);
  const titleH = lineHeight(S_TITLE);
  const h = PAD * 2 + titleH + 8 + (SETTING_ROWS.length + 1) * ROW;
  const x = Math.round((f.width - w) / 2);
  const y = Math.round((f.height - h) / 2);
  f.add(KEY_SETTINGS_PANEL, K_PANEL, x, y, w, h, S_PANEL);
  f.text(KEY_SETTINGS_TITLE, x + PAD, y + PAD, w - PAD * 2, S_TITLE, "Settings");
  const valueW = 110;
  SETTING_ROWS.forEach((row, i) => {
    const ry = y + PAD + titleH + 8 + i * ROW;
    const key = KEY_SETTINGS_ROW + i * 4;
    const right = x + w - PAD;
    f.text(key, x + PAD, ry + 5, w - PAD * 2 - valueW - BUTTON * 2 - 16, S_LABEL, row.label);
    f.text(key + 1, right - BUTTON * 2 - 8 - valueW, ry + 5, valueW, S_LABEL, row.value(s));
    for (const [n, label] of [[2, "-"], [3, "+"]] as const) {
      const b = f.add(key + n, K_BUTTON, right - (n === 2 ? BUTTON * 2 + 4 : BUTTON), ry, BUTTON, ROW - 6, S_BUTTON);
      b.text = label;
      b.interactive = true;
    }
  });
  // The bar spans 60 dB. Quiet speech fills about half of it. It is empty until the talk key has asked for the microphone.
  const my = y + PAD + titleH + 8 + SETTING_ROWS.length * ROW;
  f.text(KEY_SETTINGS_MIC, x + PAD, my + 5, 120, S_LABEL, "Microphone");
  const bar = f.add(KEY_SETTINGS_MIC + 1, K_BAR, x + PAD + 130, my + 9, w - PAD * 2 - 130, 8, S_STAMINA);
  const db = micLevel > 0 ? 20 * Math.log10(micLevel) : -60;
  bar.value = db <= -60 ? 0 : db >= 0 ? 1 : 1 + db / 60;
}

/** Returns true if the key was one of this screen's buttons. */
export function settingsClick(key: number, s: Settings): boolean {
  const k = key - KEY_SETTINGS_ROW;
  if (k < 0 || k >= SETTING_ROWS.length * 4 || k % 4 < 2) return false;
  SETTING_ROWS[k >> 2]!.step(s, k % 4 === 2 ? -1 : 1);
  return true;
}
