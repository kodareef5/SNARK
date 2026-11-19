// Standard gamepads use survival-game face buttons, explicit tap/hold actions and source-owned release.
export interface PadSample {
  readonly id?: string;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}
export interface PadTarget {
  readonly inMenu: boolean;
  readonly inspecting: boolean;
  readonly flying: boolean;
  readonly patrol: boolean;
  key(code: string, down: boolean): void;
  mouse(button: number, down: boolean): void;
  move(x: number, z: number): void;
  look(x: number, y: number): void;
  /** Press: 0 moves focus, 1 selects/picks up, 2 releases an inventory drag. */
  navigate(direction: number, press: number): void;
  adjust(direction: number): boolean;
  used(): void;
}
export const PAD_KEYS: Readonly<Record<number,string>> = {0:"Space",1:"KeyI",3:"KeyE",5:"KeyG",9:"Escape",10:"ShiftLeft"};
export const PAD_TAPS: Readonly<Record<number,string>> = {2:"KeyR",8:"KeyM",11:"KeyC"};
export const PAD_HOLDS: Readonly<Record<number,string>> = {2:"KeyF",8:"KeyH",11:"KeyX"};
export const PAD_HOLD_MS=350;
export const PAD_DEAD_ZONE=.18;
const PAD_SLOTS:Readonly<Record<number,number>>={12:0,15:1,13:2,14:3};
export function padAxis(value: number): number {
  if(!Number.isFinite(value))return 0;
  const v=Math.min(1,Math.abs(value));
  return v<=PAD_DEAD_ZONE?0:Math.sign(value)*(v-PAD_DEAD_ZONE)/(1-PAD_DEAD_ZONE);
}

export class GamepadInput {
  private readonly previous=new Uint8Array(17);
  /** 0 idle, 1 waiting to distinguish tap from hold, 2 hold already fired. */
  private readonly pending=new Uint8Array(17);
  private readonly since=new Float64Array(17);
  private readonly active=new Map<number,string>();
  private readonly mouse=new Set<number>();
  private last=-1;
  private repeatAt=0;
  private repeatDirection=0;
  private menu=false;
  private flying=false;
  private patrol=false;
  private selecting=false;
  private reload=false;

  update(pads: readonly (PadSample|null)[], now: number, target: PadTarget): void {
    if(this.reload){target.key("KeyR",false);this.reload=false;}
    const pad=pads.find(p=>p?.connected && p.mapping==="standard");
    const dt=this.last<0?0:Math.min(50,Math.max(0,now-this.last)); this.last=now;
    // Keep previous edges through focus loss: a held trigger must be released before it can fire again.
    if(!pad){this.release(target);return;}
    // Sony standard mappings expose the touchpad as the extra button 17; button 8 is Share/Create.
    const touchpad=pad.buttons.length>17 && /054c|DualSense|DualShock|Sony/i.test(pad.id??"");
    const down=(i:number):boolean=>{const b=pad.buttons[i===8 && touchpad?17:i];return !!b && (b.pressed || b.value>.55);};
    if(target.inMenu!==this.menu){this.release(target,target.inspecting);this.menu=target.inMenu;}
    if(target.flying!==this.flying || target.patrol!==this.patrol) {
      // Mounted and on-foot right-stick actions start on a fresh press.
      this.pending[11]=0;
      const key=this.active.get(11);if(key){target.key(key,false);this.active.delete(11);}
      this.flying=target.flying; this.patrol=target.patrol;
    }
    const x=padAxis(pad.axes[0]??0),z=-padAxis(pad.axes[1]??0),yaw=padAxis(pad.axes[2]??0),pitch=padAxis(pad.axes[3]??0);
    if(x||z||yaw||pitch)target.used();
    target.move(target.inMenu?0:x,target.inMenu?0:z);
    if(!target.inMenu)target.look(yaw*dt*.65,pitch*dt*.65);
    const direction=target.inMenu ? (down(12)||z>.5?-1:down(13)||z<-.5?1:down(14)||x<-.5?-2:down(15)||x>.5?2:0) : 0;
    if(direction && (direction!==this.repeatDirection || now>=this.repeatAt)) {
      if(Math.abs(direction)===1 || !target.adjust(direction/2))target.navigate(Math.sign(direction),0);
      this.repeatAt=now+180;
    }
    this.repeatDirection=direction;
    for(let i=0;i<17;i++) {
      const pressed=down(i),was=this.previous[i]===1; this.previous[i]=pressed?1:0;
      if(pressed && was && this.pending[i]===1 && now-this.since[i]!>=PAD_HOLD_MS) {
        this.pending[i]=2;
        const key=PAD_HOLDS[i]!;
        if(i===8)this.hold(i,key,target); else this.pulse(key,target);
      }
      if(pressed===was)continue;
      if(!pressed) {
        if(i===0 && this.selecting){target.navigate(0,2);this.selecting=false;}
        if(this.pending[i]===1 && !target.inMenu)this.pulse(PAD_TAPS[i]!,target);
        this.pending[i]=0;
        const key=this.active.get(i); if(key){target.key(key,false);this.active.delete(i);}
        const mouse=i===6?2:i===7?0:-1;if(this.mouse.delete(mouse))target.mouse(mouse,false);
        continue;
      }
      target.used();
      if(i===9){this.pulse("Escape",target);continue;}
      if(target.inMenu) {
        if(i===0){this.selecting=true;target.navigate(0,1);}
        else if(i===1)this.pulse("Escape",target);
        continue;
      }
      const modifier=down(4);
      // Four directional slots, a second bank on LB, and the last pair on LB + X/Y.
      if(i>=12 && i<=15){const slot=PAD_SLOTS[i]!+(modifier?4:0);this.pulse(`Digit${slot+1}`,target);}
      else if(modifier && (i===2 || i===3))this.pulse(i===2?"Digit9":"Digit0",target);
      else if(modifier && i===5)this.pulse("KeyV",target);
      else if(modifier && i===1)this.pulse("KeyK",target);
      else if(i===11 && target.patrol)this.pulse("KeyK",target);
      else if(i===11 && target.flying)this.hold(i,modifier?"KeyX":"KeyC",target);
      else if(PAD_TAPS[i]){this.pending[i]=1;this.since[i]=now;}
      else if(i===6 || i===7){const mouse=i===6?2:0;this.mouse.add(mouse);target.mouse(mouse,true);}
      else if(PAD_KEYS[i])this.hold(i,PAD_KEYS[i]!,target);
    }
  }

  private pulse(key: string, target: PadTarget): void {
    target.key(key,true);
    // Reload is a sampled button, unlike menu/slot commands and stance toggles. Keep it for one frame.
    if(key==="KeyR")this.reload=true; else target.key(key,false);
  }
  private hold(button: number, key: string, target: PadTarget): void {this.active.set(button,key);target.key(key,true);}
  private release(target: PadTarget, keepInspect=false): void {
    for(const [i,key] of this.active)if(!keepInspect || key!=="KeyH"){target.key(key,false);this.active.delete(i);}
    for(let i=0;i<17;i++)if(!keepInspect || i!==8)this.pending[i]=0;
    for(const button of this.mouse)target.mouse(button,false);
    if(this.selecting){target.navigate(0,2);this.selecting=false;}
    this.mouse.clear();this.repeatDirection=0;target.move(0,0);
  }
}
