import { K_BUTTON, K_PANEL, fitText, type UiFrame } from "./nodes.ts";
import { keyBinding, type Binding } from "./controls-guide.ts";
import { S_KEY, S_KEY_SMALL, S_KEY_EDGE, S_KEY_FILL, S_KEY_ACTIVE } from "./style.ts";

export const KEY_CONTROL_KEY = 5700;
type Key = readonly [code:string, label:string, units:number];
const key=(code:string,label:string,units=1):Key=>[code,label,units];
const letters=(s:string):Key[]=>[...s].map(c=>key(`Key${c}`,c));
// A compact physical layout, including unbound keys, makes the bound positions recognizable.
export const KEY_ROWS: readonly (readonly Key[])[] = [
  [key("Escape","Esc"),key("","",1),...[1,2,3,4].map(n=>key(`F${n}`,`F${n}`)),key("","",.5),...[5,6,7,8].map(n=>key(`F${n}`,`F${n}`)),key("","",.5),...[9,10,11,12].map(n=>key(`F${n}`,`F${n}`))],
  [key("Backquote","`"),...[1,2,3,4,5,6,7,8,9,0].map(n=>key(`Digit${n}`,`${n}`)),key("Minus","−"),key("Equal","="),key("Backspace","Back",2)],
  [key("Tab","Tab",1.5),...letters("QWERTYUIOP"),key("BracketLeft","["),key("BracketRight","]"),key("Backslash","\\",1.5)],
  [key("CapsLock","Caps",1.75),...letters("ASDFGHJKL"),key("Semicolon",";"),key("Quote","'"),key("Enter","Enter",2.25)],
  [key("ShiftLeft","Shift",2.25),...letters("ZXCVBNM"),key("Comma",","),key("Period","."),key("Slash","/"),key("ShiftRight","Shift",1.75),key("ArrowUp","↑")],
  [key("ControlLeft","Ctrl",1.25),key("MetaLeft","Win",1.25),key("AltLeft","Alt",1.25),key("Space","Space",6.25),key("AltRight","Alt"),key("ControlRight","Ctrl"),key("ArrowLeft","←"),key("ArrowDown","↓"),key("ArrowRight","→")],
];
export interface Selection { label:string; binding:Binding }

function cap(f:UiFrame,id:number,label:string,binding:Binding|undefined,x:number,y:number,w:number,h:number,group:number,focus:number,small:boolean):void {
  const selected=id===focus, active=binding?.group===group;
  f.add(3100000+id*2,K_PANEL,x,y,w,h,S_KEY_EDGE).alpha=selected?1:active?.9:.35;
  f.add(3100001+id*2,K_PANEL,x+1,y+1,w-2,h-2,active||selected?S_KEY_ACTIVE:S_KEY_FILL).alpha=selected?1:.85;
  const n=f.add(id,K_BUTTON,x,y,w,h,small?S_KEY_SMALL:S_KEY);
  n.text=fitText(label,w-2,n.style); n.label=`${label}: ${binding?.title??"Unbound"}`; n.interactive=!!binding; n.alpha=binding?1:.28;
}

export function keyboard(f:UiFrame,x:number,y:number,w:number,group:number,focus:number):Selection {
  const compact=w<600, boardW=compact?w:w-146, unit=boardW/15, gap=compact?2:4, h=compact?29:34;
  let id=KEY_CONTROL_KEY;
  const defaultCode=group===5?"Tab":group===1?"KeyR":group===2?"KeyE":group===3?"KeyQ":group===4||group===6?"Space":"KeyW";
  let selected:Selection={label:defaultCode.replace("Key",""),binding:keyBinding(defaultCode,group)!};
  for(let row=0;row<KEY_ROWS.length;row++) {
    let left=x;
    for(const [code,label,units] of KEY_ROWS[row]!) {
      const width=unit*units-gap;
      if(code) {
        const binding=keyBinding(code,group);
        cap(f,id,label,binding,left,y+row*(h+gap)+(row?6:0),width,h,group,focus,compact);
        if(id===focus && binding)selected={label,binding};
        id++;
      }
      left+=unit*units;
    }
  }
  const mx=compact?x:x+boardW+24, my=compact?y+6*(h+gap)+14:y+40, mw=compact?(w-12)/3:118;
  for(const [i,code,label] of [[0,"Mouse0","LMB"],[1,"Mouse2","RMB"],[2,"MouseMove","Mouse"]] as const) {
    const binding=keyBinding(code,group), px=mx+(compact?i*(mw+6):0), py=my+(compact?0:i*50);
    cap(f,id,label,binding,px,py,mw,compact?30:40,group,focus,false);
    if(id===focus && binding)selected={label,binding};
    id++;
  }
  return selected;
}
