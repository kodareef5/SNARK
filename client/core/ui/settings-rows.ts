// The rows of a settings tab: laid out, paged and pressed by keys their tab's owner gives them, so the settings page's own
// tabs and a part's draw them alike (settings.ts, settings-input.ts).

import { SETTING_ROWS, type Settings } from "../settings.ts";
import { smallButton } from "./menu.ts";
import { K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { slider } from "./slider.ts";
import { S_HUD_COUNT, S_ICE, S_MENU_NOTE } from "./style.ts";

export const ROW = 52;
const TOGGLES = new Set([0, 4, 12, 14, 15, 16, 17, 20, 23, 24, 25]);
/** Row `i`'s own keys, four from `row(i)` (label, value, two buttons), its slider's, and a toggle's underline's. */
export interface RowKeys { row(i: number): number; slider(i: number): number; underline(i: number): number }
/** The room the rows have: `x` and `w` within the panel's margins, `y` the first row's top, `h` down to the panel's foot. */
export interface RowRoom { x: number; y: number; w: number; h: number }

/** Whether the panel is narrow, where a row's slider goes under its label. */
export const narrowRoom = (at: RowRoom): boolean => at.w + 48 < 580;

/** How many of `rows` a page shows in `at`, leaving `reserve` at its foot, and how many pages they take. */
export function rowPages(rows: readonly number[], at: RowRoom, reserve: number): { perPage: number; pages: number } {
  const narrow = narrowRoom(at), count = rows.length;
  // A row with a slider under its label (a narrow panel) is the taller kind.
  const need = (i: number): number => narrow && SETTING_ROWS[i]!.range ? 54 : 34, limit = at.h - reserve;
  const perPage = (count - 1) * ROW + need(rows[count - 1]!) <= limit ? count : Math.max(1, Math.floor((limit - (narrow ? 54 : 34)) / ROW) + 1);
  return { perPage, pages: Math.ceil(count / perPage) };
}

/** Draws page `page` of `rows`, `perPage` to a page, in `at`. */
export function drawRows(f: UiFrame, s: Settings, rows: readonly number[], at: RowRoom, page: number, perPage: number, focus: number, keys: RowKeys): void {
  const narrow = narrowRoom(at), right = at.x + at.w, inner = at.w;
  rows.forEach((i, n) => {
    const rowAt = n - page * perPage;
    if (rowAt < 0 || rowAt >= perPage) return;
    const row = SETTING_ROWS[i]!, ry = at.y + rowAt * ROW, key = keys.row(i);
    f.text(key, at.x, ry + 5, narrow ? inner - 112 : 196, S_MENU_NOTE, fitText(row.label, narrow ? inner - 112 : 196, S_MENU_NOTE));
    const valueX = narrow ? right - 106 : right - 186;
    f.text(key + 1, valueX, ry + 5, 106, S_HUD_COUNT, fitText(row.value(s), 106, S_HUD_COUNT));
    const controlsY = narrow ? ry + 22 : ry - 3;
    if (row.range) {
      const r = row.range, sx = narrow ? at.x - 8 : at.x + 200, sw = narrow ? inner - 64 : inner - 394;
      slider(f, keys.slider(i), sx, controlsY, sw, 30, (r.get(s) - r.min) / (r.max - r.min), r.step / (r.max - r.min), row.label, row.value(s));
      for (let k = 0; k < 2; k++) smallButton(f, key + 2 + k, right - 68 + k * 36, controlsY, 32, 30, k ? "+" : "−", `${k ? "Increase" : "Decrease"} ${row.label}`, focus === key + 2 + k);
    } else if (TOGGLES.has(i)) {
      // The complete value is a button. Its underline reads as an action, not a fake slider track.
      smallButton(f, key + 3, valueX, ry, 106, 30, "", `Change ${row.label}: ${row.value(s)}`, focus === key + 3);
      f.add(keys.underline(i), K_PANEL, valueX + 8, ry + 28, 90, 1, S_ICE).alpha = .4;
    } else {
      for (let k = 0; k < 2; k++) smallButton(f, key + 2 + k, right - 68 + k * 36, controlsY, 32, 30, k ? "›" : "‹", `${k ? "Next" : "Previous"} ${row.label}`, focus === key + 2 + k);
    }
  });
}

/** A press on a row's own key `k` (four a row, from 0): its buttons step it. True if it was one. */
export function pressRow(k: number, s: Settings): boolean {
  if (k < 0 || k >= SETTING_ROWS.length * 4 || k % 4 < 2) return false;
  SETTING_ROWS[k >> 2]!.step(s, k % 4 === 2 ? -1 : 1);
  s.changed();
  return true;
}

/** Row `i`'s slider set to `value`, from 0 to 1. True if it has one. */
export function slideRow(i: number, value: number, s: Settings): boolean {
  const r = SETTING_ROWS[i]?.range;
  if (!r || !Number.isFinite(value)) return false;
  r.set(s, r.min + Math.max(0, Math.min(1, value)) * (r.max - r.min));
  s.changed();
  return true;
}

/** Left and right on a row's button `k` step its value that way, whichever arrow has the focus. */
export function adjustRow(k: number, by: number, s: Settings): boolean {
  if (k < 0 || k >= SETTING_ROWS.length * 4 || k % 4 < 2 || k >> 2 === 10) return false;
  SETTING_ROWS[k >> 2]!.step(s, by);
  s.changed();
  return true;
}
