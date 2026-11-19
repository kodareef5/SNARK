// Diagrams explain the real defaults. Context changes highlighted actions, never the binding itself.
import { K_PANEL, fitText, wrapText, type UiFrame } from "./nodes.ts";
import { glass } from "./skin.ts";
import { KEY_CONTROLS_DEVICE, KEY_MENU_BACK, menuBackdrop, smallButton } from "./menu.ts";
import { CONTROL_GROUPS } from "./controls-guide.ts";
import { keyboard } from "./keyboard.ts";
import { controller } from "./controller.ts";
import { S_CONTROL_TITLE, S_ICE, S_MENU_HEADING, S_MENU_NOTE } from "./style.ts";

export const KEY_CONTROL_DETAIL=5800;
export const KEY_CONTROL_GROUP=5440;
export const KEY_CONTROL_GLYPHS=5450;
const lines:string[]=[];

/** The touch page: what each zone and button does, in words. */
const TOUCH: readonly (readonly [string, string])[] = [
  ["Left side", "Move. A stick appears where your thumb lands; push it to its rim to sprint."],
  ["Right side", "Drag to look around."],
  ["Attack", "Hold to strike, gather or shoot. Drag from it to aim as you do."],
  ["Jump and Stance", "Tap Stance to crouch, hold it to lie prone, tap again to stand."],
  ["Aim and Reload", "Shown when what you hold can. Aim stays on until pressed again."],
  ["The pill", "Does what the world offers: ride, open, exit. Hold it on a structure for its actions."],
  ["Top left", "Menu, bag and character. Tap the minimap for the map."],
];
/** A canvas shorter than this has no room for the keyboard's or the pad's picture, and is offered the touch page alone. */
const PICTURES = 640;

/** `device` is 0 for the keyboard and mouse, 1 for a pad, 2 for touch. The panel is as tall as the canvas lets it be. */
export function buildControls(f:UiFrame,device:number,focus:number,group=0,glyphs=0):void {
  menuBackdrop(f);
  const short=f.height<PICTURES;
  if(short)device=2;
  const w=Math.min(980,f.width-f.left-f.right-32),h=Math.min(560,f.height-f.top-f.bottom-16),x=Math.round((f.width-w)/2),y=Math.max(f.top+8,Math.min(80,Math.round((f.height-h)/2))),inner=w-48,compact=inner<600;
  glass(f,KEY_CONTROL_DETAIL,x,y,w,h);
  f.text(KEY_CONTROL_DETAIL,x+24,y+20,w-140,S_MENU_HEADING,"Controls");
  smallButton(f,KEY_MENU_BACK,x+w-80,y+16,56,36,"Back","Back",focus===KEY_MENU_BACK);
  if(!short) {
    smallButton(f,KEY_CONTROLS_DEVICE,x+24,y+64,100,32,"Keyboard","Keyboard and mouse",device===0);
    smallButton(f,KEY_CONTROLS_DEVICE+1,x+140,y+64,100,32,"Controller","Controller",device===1);
  }
  smallButton(f,KEY_CONTROLS_DEVICE+2,short?x+24:x+256,y+64,compact?64:100,32,"Touch","Touch",device===2);
  if(device===2) {
    // A line to a row where the panel is wide, or the words under their title where it is narrow.
    const top=y+112,pitch=Math.min(compact?62:44,(h-124)/TOUCH.length);
    TOUCH.forEach(([title,detail],i)=>{
      const ry=top+i*pitch;
      f.text(KEY_CONTROL_DETAIL+10+i*4,x+24,ry,compact?inner:170,compact?S_MENU_NOTE:S_CONTROL_TITLE,fitText(title,compact?inner:170,compact?S_MENU_NOTE:S_CONTROL_TITLE));
      if(!compact) { f.text(KEY_CONTROL_DETAIL+11+i*4,x+204,ry+3,inner-180,S_MENU_NOTE,fitText(detail,inner-180,S_MENU_NOTE)); return; }
      lines.length=0;
      wrapText(detail,inner-12,S_MENU_NOTE,lines);
      for(let k=0;k<lines.length && k<2;k++)f.text(KEY_CONTROL_DETAIL+11+i*4+k,x+36,ry+19+k*18,inner-12,S_MENU_NOTE,fitText(lines[k]!,inner-12,S_MENU_NOTE)).alpha=.8;
    });
    return;
  }
  if(device===1)smallButton(f,KEY_CONTROL_GLYPHS,x+w-(compact?156:154),compact?y+20:y+64,compact?60:130,32,glyphs?(compact?"PS":"PlayStation"):"Xbox","Switch Xbox / PlayStation symbols",true);
  const tw=inner/CONTROL_GROUPS.length;
  CONTROL_GROUPS.forEach((label,i)=>smallButton(f,KEY_CONTROL_GROUP+i,x+24+i*tw,y+108,tw-4,30,label,`${label} controls`,group===i));
  const selection=device===0?keyboard(f,x+24,y+166,inner,group,focus):controller(f,x+24,y+166,inner,group,glyphs,focus);
  f.add(KEY_CONTROL_DETAIL+1,K_PANEL,x+24,y+430,inner,1,S_ICE).alpha=.25;
  f.text(KEY_CONTROL_DETAIL+2,x+24,y+447,inner,S_CONTROL_TITLE,fitText(`${selection.label}  /  ${selection.binding.title}`,inner,S_CONTROL_TITLE));
  lines.length=0;
  wrapText(selection.binding.detail,inner,S_MENU_NOTE,lines);
  lines.slice(0,2).forEach((line,i)=>f.text(KEY_CONTROL_DETAIL+3+i,x+24,y+478+i*19,inner,S_MENU_NOTE,line));
  f.text(KEY_CONTROL_DETAIL+5,x+24,y+h-28,inner,S_MENU_NOTE,compact?"Select a control for details.":"Select a control for details.  ·  Highlighted controls belong to this context.");
}
