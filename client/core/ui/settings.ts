import type { Settings } from "../settings.ts";
import { K_PANEL, type UiFrame } from "./nodes.ts";
import { glass } from "./skin.ts";
import { KEY_MENU_BACK, menuBackdrop, smallButton } from "./menu.ts";
import { S_MENU_HEADING, S_ICE, S_LABEL, S_HUD_HIT, S_HUD_COUNT } from "./style.ts";
import type { StoragePage } from "./storage.ts";
import { PART_KEYS, PartKeys, partOf, type ScreenCtx, type ScreenPart } from "./screen.ts";
import { INPUT_ROWS, INPUT_SETTINGS } from "./settings-input.ts";
import { adjustRow, drawRows, pressRow, rowPages, slideRow, type RowRoom } from "./settings-rows.ts";

export const KEY_SETTINGS_PANEL = 2300;
export const KEY_SETTINGS_TITLE = 2301;
export const KEY_SETTINGS_ROW = 6200;
/** The microphone's meter and the Input tab's note: clear of the rows' keys (KEY_SETTINGS_ROW, four a row). */
export const KEY_SETTINGS_MIC = 5950;
export const KEY_SETTINGS_TAB = 2270;
/** Page back, page on, and "1 / 2", shown where a tab's rows do not all fit. */
export const KEY_SETTINGS_PAGE = 2290;
export const KEY_SETTINGS_SLIDER = 5900;
/** The keys the page's parts are given: PART_KEYS for each tab, from here (screen.ts PartKeys). */
export const KEY_SETTINGS_PARTS = 970000;
/** The most tabs the page has, its own and its parts'. */
export const MOST_SETTING_TABS = 16;
/**
 * A tab of the page: its rows of SETTING_ROWS, drawn by the page, or by a part written in a file of its own (screen.ts
 * ScreenPart), which then draws them and answers for them.
 */
export interface SettingsTab { readonly name: string; readonly rows: readonly number[]; readonly part?: ScreenPart }
/** The page's tabs in order. A tab from another file is its part and one line here. */
export const SETTING_GROUPS: readonly SettingsTab[] = [
  { name: "Display", rows: [11, 21, 18, 19, 12, 2, 0, 24] },
  { name: "Audio", rows: [17, 5, 6, 7, 8, 9, 3, 4] },
  { name: INPUT_SETTINGS.label, rows: INPUT_ROWS, part: INPUT_SETTINGS },
  { name: "Interface", rows: [14, 15, 16, 23, 13, 20, 26] },
  // Its one row, Download all, is the page's own buttons (ui/storage.ts).
  { name: "Storage", rows: [10] },
];
export const STORAGE_TAB = 4;
const OWN_KEYS = { row: (i: number) => KEY_SETTINGS_ROW + i * 4, slider: (i: number) => KEY_SETTINGS_SLIDER + i, underline: (i: number) => 60000 + KEY_SETTINGS_ROW + i * 4 };
const partKeys = new PartKeys();

/** `storage` is the Storage tab's page, once it has come (ui/storage.ts). A part's tab is drawn only where `c` is given. */
export function buildSettings(f: UiFrame, s: Settings, micLevel = 0, focus = 0, storage: StoragePage | null = null, c: ScreenCtx | null = null): void {
  menuBackdrop(f);
  // As tall as the canvas lets it be: a phone on its side pages the rows a taller window shows at once.
  // Centred between the screen's edges, so a phone's home bar does not take the panel's foot.
  const w = Math.min(f.width-f.left-f.right-32,780), h = Math.min(560,f.height-f.top-f.bottom-16), x = Math.round((f.width-w)/2), y = Math.max(f.top+8,Math.min(80,f.top+Math.round((f.height-f.top-f.bottom-h)/2)));
  const right=x+w-24, inner=w-48;
  f.add(KEY_SETTINGS_PANEL,K_PANEL,x,y,w,h,S_HUD_HIT);
  glass(f,KEY_SETTINGS_PANEL,x,y,w,h);
  smallButton(f,KEY_MENU_BACK,right-56,y+16,56,36,"Back","Back",focus===KEY_MENU_BACK);
  const tabs=Math.min(SETTING_GROUPS.length,MOST_SETTING_TABS), tabW=inner/tabs;
  for(let i=0;i<tabs;i++)smallButton(f,KEY_SETTINGS_TAB+i,x+24+i*tabW,y+66,tabW-8,34,SETTING_GROUPS[i]!.name,SETTING_GROUPS[i]!.name,s.tab===i);
  const group=SETTING_GROUPS[s.tab]??SETTING_GROUPS[0]!;
  // All of a tab's rows where the panel has the room, as a full window has; else as many to a page as fit.
  const room:RowRoom={x:x+24,y:y+112,w:inner,h:h-112};
  const { perPage, pages } = group.part ? { perPage: 0, pages: c ? group.part.pages?.(room, c) ?? 1 : 1 } : rowPages(group.rows, room, s.tab===1?44:8);
  s.page=Math.max(0,Math.min(pages-1,s.page));
  f.text(KEY_SETTINGS_TITLE,x+24,y+20,pages>1?w-290:w-140,S_MENU_HEADING,"Settings");
  if(pages>1) {
    for(let k=0;k<2;k++)smallButton(f,KEY_SETTINGS_PAGE+k,right-200+k*88,y+16,36,36,k?"›":"‹",k?"Next page":"Previous page",focus===KEY_SETTINGS_PAGE+k);
    f.text(KEY_SETTINGS_PAGE+2,right-160,y+25,44,S_HUD_COUNT,`${s.page+1} / ${pages}`);
  }
  if(s.tab===STORAGE_TAB)return storage?.build(f,s,x,y,w,h,focus);
  if(group.part) {
    if(!c)return;
    partKeys.base=KEY_SETTINGS_PARTS+s.tab*PART_KEYS;
    group.part.build(f,room,partKeys,c);
  } else drawRows(f,s,group.rows,room,s.page,perPage,focus,OWN_KEYS);
  if(s.tab===1) {
    f.text(KEY_SETTINGS_MIC,x+24,y+h-44,140,S_LABEL,"Microphone input");
    const level=Math.max(0,Math.min(1,1+(micLevel>0?20*Math.log10(micLevel):-60)/60));
    for(let i=0;i<16;i++)f.add(KEY_SETTINGS_MIC+1+i,K_PANEL,x+174+i*(inner-150)/16,y+h-43,(inner-150)/16-3,12,S_ICE).alpha=i/16<level?.8:.12;
  }
}

/**
 * The part a frame key reaches, and its own key, while that part's tab is the one shown. A key of a part whose tab has
 * been left, before the frame is drawn again, reaches nothing (`stale`).
 */
export function settingsPart(key: number, s: Settings): { part: ScreenPart; local: number } | "stale" | null {
  const at = partOf(key, KEY_SETTINGS_PARTS, MOST_SETTING_TABS);
  if (!at) return null;
  const part = SETTING_GROUPS[at.index]?.part;
  return part && at.index === s.tab && at.local >= 0 ? { part, local: at.local } : "stale";
}

export function settingsValue(key: number, value: number, s: Settings): boolean {
  return slideRow(key-KEY_SETTINGS_SLIDER, value, s);
}

export function settingsClick(key: number, s: Settings): boolean {
  if(key>=KEY_SETTINGS_TAB && key<KEY_SETTINGS_TAB+Math.min(SETTING_GROUPS.length,MOST_SETTING_TABS)){s.tab=key-KEY_SETTINGS_TAB;s.page=0;return true;}
  // The build keeps the page within the tab's pages.
  if(key===KEY_SETTINGS_PAGE || key===KEY_SETTINGS_PAGE+1){s.page+=key===KEY_SETTINGS_PAGE?-1:1;return true;}
  return pressRow(key-KEY_SETTINGS_ROW, s);
}

/** Horizontal navigation changes the value in that direction, regardless of which arrow has focus. */
export function settingsAdjust(key:number,by:number,s:Settings):boolean {
  return adjustRow(key-KEY_SETTINGS_ROW, by, s);
}
