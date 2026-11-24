// The settings page's Input tab, as a part of the page (screen.ts ScreenPart): its rows drawn with its own keys, and its
// slider and buttons answered by those keys alone.

import type { PartBox, PartKeys, ScreenCtx, ScreenPart } from "./screen.ts";
import { adjustRow, drawRows, pressRow, rowPages, slideRow, type RowKeys } from "./settings-rows.ts";
import { fitText, type UiFrame } from "./nodes.ts";
import { S_MENU_NOTE } from "./style.ts";

/** Its rows of SETTING_ROWS: mouse sensitivity, zoom sensitivity, view kick. */
export const INPUT_ROWS: readonly number[] = [1, 22, 25];
const ROWS = INPUT_ROWS;
/** Its own keys: four for each row by its index in SETTING_ROWS, then a slider for each from SLIDERS, its note, and a toggle's underline for each. */
const SLIDERS = 200;
const NOTE = 300;
const UNDERLINES = 400;

const keysOf = (k: PartKeys): RowKeys => ({ row: (i) => k.key(i * 4), slider: (i) => k.key(SLIDERS + i), underline: (i) => k.key(UNDERLINES + i) });

export const INPUT_SETTINGS: ScreenPart = {
  name: "input",
  label: "Input",
  pages(at: PartBox): number {
    return rowPages(ROWS, at, 8).pages;
  },
  build(f: UiFrame, at: PartBox, k: PartKeys, c: ScreenCtx): void {
    const s = c.settings, { perPage } = rowPages(ROWS, at, 8);
    drawRows(f, s, ROWS, at, s.page, perPage, c.focus, keysOf(k));
    f.text(k.key(NOTE), at.x, at.y + 80, at.w, S_MENU_NOTE, fitText("Select and drag a slider. Arrow keys make precise adjustments.", at.w, S_MENU_NOTE));
  },
  pointer(kind: number, local: number, _x: number, _y: number, button: number, c: ScreenCtx): boolean {
    return kind === 0 && button === 0 && local < SLIDERS && pressRow(local, c.settings);
  },
  value(local: number, value: number, c: ScreenCtx): boolean {
    return local >= SLIDERS && local < NOTE && slideRow(local - SLIDERS, value, c.settings);
  },
  adjust(local: number, by: number, end: boolean, c: ScreenCtx): boolean | undefined {
    if (local >= SLIDERS && local < NOTE) return undefined;
    return !end && adjustRow(local, by, c.settings);
  },
};
