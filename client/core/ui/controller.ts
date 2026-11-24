import { K_BUTTON, K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { skinPart, PAD_X, PAD_Y, PAD_WIDTH, PAD_HEIGHT, RING_X, RING_Y, STICK_Y } from "./skin.ts";
import { padBinding } from "./controls-guide.ts";
import type { Selection } from "./keyboard.ts";
import { S_KEY, S_KEY_SMALL, S_KEY_EDGE, S_KEY_ACTIVE, S_MENU_NOTE, S_HUD_COUNT } from "./style.ts";

export const KEY_CONTROL_PAD=5850;
const XBOX=["A","B","X","Y","LB","RB","LT","RT","View","Menu","LS","RS","↑","↓","←","→"];
const PS=["×","○","□","△","L1","R1","L2","R2","Touch","Options","L3","R3","↑","↓","←","→"];
export function padLabel(button:number,glyphs:number):string { return (glyphs?PS:XBOX)[button]??""; }

export function controller(f:UiFrame,x:number,y:number,w:number,group:number,glyphs:number,focus:number):Selection {
  const compact=w<650, dw=Math.min(w,440), dh=dw/2, left=x+(w-dw)/2, top=y+30;
  skinPart(f,3200000,left,top,dw,dh,PAD_X,PAD_Y,PAD_WIDTH,PAD_HEIGHT);
  const initial=group===0?10:group===1||group===3?7:group===2?1:0;
  let selected:Selection={label:padLabel(initial,glyphs),binding:padBinding(initial,group)!};
  const button=(i:number,u:number,v:number,size:number,ring=RING_Y):void=>{
    const label=padLabel(i,glyphs),binding=padBinding(i,group),id=KEY_CONTROL_PAD+i,diameter=dw*size,px=left+u*dw-diameter/2,py=top+v*dh-diameter/2;
    skinPart(f,3200100+i,px,py,diameter,diameter,RING_X,ring,64,64).alpha=id===focus?1:binding?.group===group?.95:.45;
    const n=f.add(id,K_BUTTON,px,py,diameter,diameter,compact?S_KEY_SMALL:S_KEY);
    n.text=label;n.label=`${label}: ${binding?.title??"Not used here"}`;n.interactive=!!binding;n.alpha=binding?1:.3;
    if(focus===id && binding)selected={label,binding};
  };
  // Face diamond, two independently positioned sticks, four non-overlapping D-pad quadrants.
  for(const [i,u,v] of [[3,.79,.24],[2,.72,.38],[1,.86,.38],[0,.79,.52]] as const)button(i,u,v,.068);
  const lx=glyphs?.38:.24,ly=glyphs?.68:.36,dx=glyphs?.24:.39,dy=glyphs?.36:.68;
  button(10,lx,ly,.13,STICK_Y); button(11,.61,.68,.13,STICK_Y);
  for(const [i,u,v] of [[12,dx,dy-.09],[13,dx,dy+.09],[14,dx-.045,dy],[15,dx+.045,dy]] as const) {
    const size=dw*.043,id=KEY_CONTROL_PAD+i,binding=padBinding(i,group),px=left+u*dw-size/2,py=top+v*dh-size/2;
    f.add(3200100+i,K_PANEL,px,py,size,size,binding?.group===group?S_KEY_ACTIVE:S_KEY_EDGE).alpha=.7;
    const n=f.add(id,K_BUTTON,px,py,size,size,S_KEY_SMALL);n.text=padLabel(i,glyphs);n.label=`D-pad ${n.text}: ${binding?.title??"Not used here"}`;n.interactive=!!binding;
    if(focus===id && binding)selected={label:`D-pad ${n.text}`,binding};
  }
  for(const [i,u,v] of [[8,.42,.24],[9,.57,.24],[6,.20,-.12],[7,.80,-.12],[4,.20,.05],[5,.80,.05]] as const) {
    const id=KEY_CONTROL_PAD+i,binding=padBinding(i,group),bw=dw*.13,bh=dh*.14,px=left+u*dw-bw/2,py=top+v*dh-bh/2;
    f.add(3200100+i,K_PANEL,px,py,bw,bh,focus===id||binding?.group===group?S_KEY_ACTIVE:S_KEY_EDGE).alpha=.55;
    const n=f.add(id,K_BUTTON,px,py,bw,bh,compact?S_KEY_SMALL:S_KEY);
    n.text=fitText(padLabel(i,glyphs),bw,n.style);n.label=`${padLabel(i,glyphs)}: ${binding?.title??"Not used here"}`;n.interactive=!!binding;
    if(focus===id && binding)selected={label:padLabel(i,glyphs),binding};
  }
  if(!compact) {
    const ids=group===1?[6,5,7,2]:group===2?[8,4,1,3]:group===3?[4,5,7,3]:[10,11,0,1];
    const cw=(w-dw)/2-14;
    for(let i=0;i<4;i++) {
      const button=ids[i]!,binding=padBinding(button,group);if(!binding)continue;
      f.text(3200200+i,i<2?x:left+dw+14,y+76+(i%2)*45,cw,i<2?S_MENU_NOTE:S_HUD_COUNT,fitText(`${padLabel(button,glyphs)}  /  ${binding.title}`,cw,i<2?S_MENU_NOTE:S_HUD_COUNT));
    }
  }
  return selected;
}
