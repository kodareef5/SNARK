import { SETTING_ROWS, type Settings } from "../settings.ts";
import { K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { glass } from "./skin.ts";
import { slider } from "./slider.ts";
import { KEY_MENU_BACK, menuBackdrop, smallButton } from "./menu.ts";
import { S_MENU_HEADING, S_MENU_NOTE, S_ICE, S_LABEL, S_HUD_HIT, S_HUD_COUNT } from "./style.ts";
import type { StoragePage } from "./storage.ts";

export const KEY_SETTINGS_PANEL = 2300;
export const KEY_SETTINGS_TITLE = 2301;
export const KEY_SETTINGS_ROW = 2310;
/** The microphone's meter and the Input tab's note: clear of the rows' keys (KEY_SETTINGS_ROW, four a row). */
export const KEY_SETTINGS_MIC = 5950;
export const KEY_SETTINGS_TAB = 2270;
/** Page back, page on, and "1 / 2", shown where a tab's rows do not all fit. */
export const KEY_SETTINGS_PAGE = 2290;
const ROW = 52;
export const KEY_SETTINGS_SLIDER = 5900;
export const SETTING_GROUPS = [
  { name: "Display", rows: [11, 21, 18, 19, 12, 2, 0] },
  { name: "Audio", rows: [17, 5, 6, 7, 8, 9, 3, 4] },
  { name: "Input", rows: [1, 22] },
  { name: "Interface", rows: [14, 15, 16, 23, 13, 20] },
  // Its one row, Download all, is the page's own buttons (ui/storage.ts).
  { name: "Storage", rows: [10] },
] as const;
export const STORAGE_TAB = 4;
const TOGGLES = new Set([0,4,12,14,15,16,17,20,23]);

/** `storage` is the Storage tab's page, once it has come (ui/storage.ts). */
export function buildSettings(f: UiFrame, s: Settings, micLevel = 0, focus = 0, storage: StoragePage | null = null): void {
  menuBackdrop(f);
  // As tall as the canvas lets it be: a phone on its side pages the rows a taller window shows at once.
  // Centred between the screen's edges, so a phone's home bar does not take the panel's foot.
  const w = Math.min(f.width-f.left-f.right-32,780), h = Math.min(560,f.height-f.top-f.bottom-16), x = Math.round((f.width-w)/2), y = Math.max(f.top+8,Math.min(80,f.top+Math.round((f.height-f.top-f.bottom-h)/2))), narrow = w<580;
  const right=x+w-24, inner=w-48;
  f.add(KEY_SETTINGS_PANEL,K_PANEL,x,y,w,h,S_HUD_HIT);
  glass(f,KEY_SETTINGS_PANEL,x,y,w,h);
  smallButton(f,KEY_MENU_BACK,right-56,y+16,56,36,"Back","Back",focus===KEY_MENU_BACK);
  const tabW=inner/SETTING_GROUPS.length;
  SETTING_GROUPS.forEach((group,i)=>smallButton(f,KEY_SETTINGS_TAB+i,x+24+i*tabW,y+66,tabW-8,34,group.name,group.name,s.tab===i));
  const group=SETTING_GROUPS[s.tab]??SETTING_GROUPS[0];
  // All of a tab's rows where the panel has the room, as a full window has; else as many to a page as fit. A row
  // with a slider under its label (a narrow panel) is the taller kind.
  const need=(i:number):number=>narrow && SETTING_ROWS[i]!.range?54:34, limit=h-(s.tab===1?44:8), count=group.rows.length;
  const perPage=112+(count-1)*ROW+need(group.rows[count-1]!)<=limit?count:Math.max(1,Math.floor((limit-112-(narrow?54:34))/ROW)+1), pages=Math.ceil(count/perPage);
  s.page=Math.max(0,Math.min(pages-1,s.page));
  f.text(KEY_SETTINGS_TITLE,x+24,y+20,pages>1?w-290:w-140,S_MENU_HEADING,"Settings");
  if(pages>1) {
    for(let k=0;k<2;k++)smallButton(f,KEY_SETTINGS_PAGE+k,right-200+k*88,y+16,36,36,k?"›":"‹",k?"Next page":"Previous page",focus===KEY_SETTINGS_PAGE+k);
    f.text(KEY_SETTINGS_PAGE+2,right-160,y+25,44,S_HUD_COUNT,`${s.page+1} / ${pages}`);
  }
  if(s.tab===STORAGE_TAB)return storage?.build(f,s,x,y,w,h,focus);
  group.rows.forEach((i,at)=>{
    const rowAt=at-s.page*perPage;
    if(rowAt<0 || rowAt>=perPage)return;
    const row=SETTING_ROWS[i]!, ry=y+112+rowAt*ROW, key=KEY_SETTINGS_ROW+i*4;
    f.text(key,x+24,ry+5,narrow?inner-112:196,S_MENU_NOTE,fitText(row.label,narrow?inner-112:196,S_MENU_NOTE));
    const valueX = narrow ? right-106 : right-186;
    f.text(key+1,valueX,ry+5,106,S_HUD_COUNT,fitText(row.value(s),106,S_HUD_COUNT));
    const controlsY=narrow?ry+22:ry-3;
    if(row.range) {
      const r=row.range, sx=narrow?x+16:x+224, sw=narrow?inner-64:w-442;
      slider(f,KEY_SETTINGS_SLIDER+i,sx,controlsY,sw,30,(r.get(s)-r.min)/(r.max-r.min),r.step/(r.max-r.min),row.label,row.value(s));
      for(let k=0;k<2;k++)smallButton(f,key+2+k,right-68+k*36,controlsY,32,30,k?"+":"−",`${k?"Increase":"Decrease"} ${row.label}`,focus===key+2+k);
    } else if(TOGGLES.has(i)) {
      // The complete value is a button. Its underline reads as an action, not a fake slider track.
      smallButton(f,key+3,valueX,ry,106,30,"",`Change ${row.label}: ${row.value(s)}`,focus===key+3);
      f.add(60000+key,K_PANEL,valueX+8,ry+28,90,1,S_ICE).alpha=.4;
    } else {
      for(let k=0;k<2;k++)smallButton(f,key+2+k,right-68+k*36,controlsY,32,30,k?"›":"‹",`${k?"Next":"Previous"} ${row.label}`,focus===key+2+k);
    }
  });
  if(s.tab===1) {
    f.text(KEY_SETTINGS_MIC,x+24,y+h-44,140,S_LABEL,"Microphone input");
    const level=Math.max(0,Math.min(1,1+(micLevel>0?20*Math.log10(micLevel):-60)/60));
    for(let i=0;i<16;i++)f.add(KEY_SETTINGS_MIC+1+i,K_PANEL,x+174+i*(inner-150)/16,y+h-43,(inner-150)/16-3,12,S_ICE).alpha=i/16<level?.8:.12;
  }
  if(s.tab===2)f.text(KEY_SETTINGS_MIC+20,x+24,y+192,inner,S_MENU_NOTE,fitText("Select and drag a slider. Arrow keys make precise adjustments.",inner,S_MENU_NOTE));
}

export function settingsValue(key: number, value: number, s: Settings): boolean {
  const row=SETTING_ROWS[key-KEY_SETTINGS_SLIDER], r=row?.range;
  if(!r || !Number.isFinite(value))return false;
  r.set(s,r.min+Math.max(0,Math.min(1,value))*(r.max-r.min)); s.changed(); return true;
}

export function settingsClick(key: number, s: Settings): boolean {
  if(key>=KEY_SETTINGS_TAB && key<KEY_SETTINGS_TAB+SETTING_GROUPS.length){s.tab=key-KEY_SETTINGS_TAB;s.page=0;return true;}
  // The build keeps the page within the tab's pages.
  if(key===KEY_SETTINGS_PAGE || key===KEY_SETTINGS_PAGE+1){s.page+=key===KEY_SETTINGS_PAGE?-1:1;return true;}
  const k=key-KEY_SETTINGS_ROW;
  if(k<0 || k>=SETTING_ROWS.length*4 || k%4<2)return false;
  SETTING_ROWS[k>>2]!.step(s,k%4===2?-1:1); s.changed(); return true;
}

/** Horizontal navigation changes the value in that direction, regardless of which arrow has focus. */
export function settingsAdjust(key:number,by:number,s:Settings):boolean {
  const k=key-KEY_SETTINGS_ROW;
  if(k<0 || k>=SETTING_ROWS.length*4 || k%4<2 || k>>2===10)return false;
  SETTING_ROWS[k>>2]!.step(s,by); s.changed(); return true;
}
