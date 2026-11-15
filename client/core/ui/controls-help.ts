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

export function buildControls(f:UiFrame,device:number,focus:number,group=0,glyphs=0):void {
  menuBackdrop(f);
  const w=Math.min(980,f.width-32),h=560,x=Math.round((f.width-w)/2),y=80,inner=w-48,compact=inner<600;
  glass(f,KEY_CONTROL_DETAIL,x,y,w,h);
  f.text(KEY_CONTROL_DETAIL,x+24,y+20,w-140,S_MENU_HEADING,"Controls");
  smallButton(f,KEY_MENU_BACK,x+w-80,y+16,56,36,"Back","Back",focus===KEY_MENU_BACK);
  smallButton(f,KEY_CONTROLS_DEVICE,x+24,y+64,100,32,"Keyboard","Keyboard and mouse",device===0);
  smallButton(f,KEY_CONTROLS_DEVICE+1,x+140,y+64,100,32,"Controller","Controller",device===1);
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
