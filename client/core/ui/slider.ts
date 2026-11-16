import { K_BAR, K_PANEL, K_SLIDER, type UiFrame } from "./nodes.ts";
import { S_HUD_HIT, S_ICE, S_MENU_FOCUS } from "./style.ts";

/** A generous hit region, a visible thumb, and the same geometry in browser and snapshots. */
export function slider(f: UiFrame, key: number, x: number, y: number, w: number, h: number, value: number, step: number, label: string, text: string): void {
  const v = Math.max(0,Math.min(1,value));
  const track = f.add(4000000+key*4,K_BAR,x+8,y+h/2-1,w-16,2,S_MENU_FOCUS);
  track.value=v;
  f.add(4000001+key*4,K_PANEL,x+7+v*(w-16),y+h/2-7,2,14,S_ICE);
  const hit=f.add(key,K_SLIDER,x,y,w,h,S_HUD_HIT);
  hit.value=v; hit.step=step; hit.text=text; hit.label=label; hit.interactive=true;
}
