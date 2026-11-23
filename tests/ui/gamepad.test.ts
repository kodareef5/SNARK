import { expect, test } from "bun:test";
import { GamepadInput, padAxis, type PadTarget } from "../../client/core/gamepad.ts";
import { Controls } from "../../client/core/controls.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_RELOAD, BTN_ROLL, BTN_BRAKE } from "../../shared/sim/character.ts";

function rig() {
  const controls = new Controls(), driver = new GamepadInput(), actions: string[] = [];
  const pad = { connected: true, mapping: "standard", axes: [0,0,0,0], buttons: Array.from({length:17},()=>({ pressed:false, value:0 })) };
  const target: PadTarget = {
    inMenu:false, inspecting:false, patrol:false, get flying() { return controls.onFlyer; },
    key(code,down) { actions.push(`${code}:${down}`); controls.key(code,down,1); if (code === "KeyH") Object.assign(target, { inMenu:down, inspecting:down }); },
    mouse(button,down) { controls.mouseButton(button,down,1); },
    move(x,z) { controls.padMove(x,z); }, look(x,y) { controls.look(x,y); },
    navigate(direction,press) { actions.push(`nav:${direction}:${press}`); }, adjust:()=>false, used() {},
  };
  let now=0;
  return { controls, target, pad, actions, step:(ms=16)=>driver.update([pad],now+=ms,target), disconnect:()=>driver.update([],now+=16,target) };
}

test("standard pads apply dead zones, bounded analogue movement and edge-triggered actions",()=>{
  for (const n of [0,.17,-.18,NaN,Infinity]) expect(padAxis(n)).toBe(0);
  expect(padAxis(2)).toBe(1); expect(padAxis(-2)).toBe(-1);
  const r=rig(); r.pad.axes=[.5,-1,.5,0]; r.pad.buttons[7]!.value=1;
  r.step(); r.step();
  expect(r.controls.moveX).toBeCloseTo((.5-.18)/.82); expect(r.controls.moveZ).toBe(1);
  expect(r.controls.buttons & BTN_PRIMARY).toBe(BTN_PRIMARY); expect(r.controls.yaw).toBeLessThan(0);
  r.pad.buttons[5]!.pressed=true; r.step(); r.step();
  expect(r.actions).toEqual(["KeyG:true"]);
  r.pad.mapping=""; r.step();
  expect([r.controls.moveX,r.controls.moveZ,r.controls.buttons]).toEqual([0,0,0]);
});

test("disconnect releases only controller-owned inputs and a held menu selection",()=>{
  const r=rig(); r.controls.key("Space",true); r.controls.mouseButton(0,true);
  r.pad.buttons[0]!.pressed=true; r.pad.buttons[7]!.pressed=true; r.step(); r.disconnect();
  expect(r.controls.buttons & (BTN_JUMP|BTN_PRIMARY)).toBe(BTN_JUMP|BTN_PRIMARY);
  r.controls.release(); Object.assign(r.target,{inMenu:true}); r.pad.buttons[7]!.pressed=false;
  r.pad.buttons[0]!.pressed=false; r.step(); r.pad.buttons[0]!.pressed=true; r.step(); r.disconnect();
  expect(r.actions.slice(-2)).toEqual(["nav:0:1","nav:0:2"]);
});

test("opening a menu stops attacks; a held trigger cannot resume until released and pressed again",()=>{
  const r=rig(); r.pad.buttons[7]!.pressed=true; r.step();
  Object.assign(r.target,{inMenu:true}); r.step(); expect(r.controls.buttons).toBe(0);
  r.pad.buttons[13]!.pressed=true; r.step(); r.step(); expect(r.actions).toEqual(["nav:1:0"]);
  Object.assign(r.target,{inMenu:false}); r.step(); expect(r.controls.buttons).toBe(0);
  r.pad.buttons[7]!.pressed=false; r.step(); r.pad.buttons[7]!.pressed=true; r.step();
  expect(r.controls.buttons & BTN_PRIMARY).toBe(BTN_PRIMARY);
  r.disconnect(); r.step(); expect(r.controls.buttons).toBe(0);
  r.pad.buttons[7]!.pressed=false; r.step(); r.pad.buttons[7]!.pressed=true; r.step();
  expect(r.controls.buttons & BTN_PRIMARY).toBe(BTN_PRIMARY);
});

test("holding HUD inspection survives the transition to cursor navigation and releases on disconnect",()=>{
  const r=rig(); r.pad.buttons[8]!.pressed=true; r.step(); r.step(350); r.step();
  expect(r.target.inspecting).toBe(true); expect(r.actions).toEqual(["KeyH:true"]);
  r.disconnect(); expect(r.target.inspecting).toBe(false);
  r.pad.buttons[8]!.pressed=false; r.step(); r.pad.buttons[8]!.pressed=true; r.step();
  r.pad.buttons[8]!.pressed=false; r.step(); expect(r.target.inspecting).toBe(false);
  expect(r.actions.slice(-2)).toEqual(["KeyM:true","KeyM:false"]);
});

test("controller jump keeps the incoming flyer takeoff/landing toggle semantics through menu releases",()=>{
  const r=rig(); r.controls.fly(true,false);
  r.pad.buttons[0]!.pressed=true; r.step(); r.step();
  expect(r.controls.wing).toBe(true);
  Object.assign(r.target,{inMenu:true}); r.step();
  expect(r.controls.wing).toBe(true); // Releasing controls does not order a flying mount to land.
  r.pad.buttons[0]!.pressed=false; r.step();
  Object.assign(r.target,{inMenu:false}); r.step();
  r.pad.buttons[0]!.pressed=true; r.step(); expect(r.controls.wing).toBe(false);
  r.controls.fly(false,false); r.pad.buttons[0]!.pressed=false; r.step();
  r.pad.buttons[0]!.pressed=true; r.step(); expect(r.controls.buttons & BTN_JUMP).toBe(BTN_JUMP);
});

test("ARK face buttons, contextual holds and all ten hotbar slots have distinct edges",()=>{
  const r=rig();
  const press=(i:number,ms=16)=>{r.pad.buttons[i]!.pressed=true;r.step();r.step(ms);r.pad.buttons[i]!.pressed=false;r.step();};
  press(1);press(3);press(5);
  expect(r.actions).toEqual(["KeyI:true","KeyI:false","KeyE:true","KeyE:false","KeyG:true","KeyG:false"]);
  r.actions.length=0;
  press(2);expect(r.controls.buttons & BTN_RELOAD).toBe(BTN_RELOAD);
  r.step();expect(r.controls.buttons & BTN_RELOAD).toBe(0);
  press(2,350);press(11);press(11,350);
  expect(r.actions).toEqual(["KeyR:true","KeyR:false","KeyF:true","KeyF:false","KeyC:true","KeyC:false","KeyX:true","KeyX:false"]);
  r.actions.length=0;
  for(const i of [12,15,13,14])press(i);
  r.pad.buttons[4]!.pressed=true;r.step();
  for(const i of [12,15,13,14,2,3])press(i);
  expect(r.actions.filter(a=>a.endsWith(":true"))).toEqual([1,2,3,4,5,6,7,8,9,0].map(i=>`Digit${i}:true`));
  press(5);expect(r.actions.slice(-2)).toEqual(["KeyV:true","KeyV:false"]);
});

test("a pending hold is cancelled by menus and disconnect, without a delayed gameplay tap",()=>{
  for(const button of [2,8,11])for(const disconnect of [false,true]) {
    const r=rig();r.pad.buttons[button]!.pressed=true;r.step();
    if(disconnect)r.disconnect();else {Object.assign(r.target,{inMenu:true});r.step();}
    r.step(400);r.pad.buttons[button]!.pressed=false;r.step();
    expect(r.actions).toEqual([]);
  }
});

test("controller horizontal navigation adjusts values and repeats, while unadjustable controls move focus",()=>{
  const r=rig();Object.assign(r.target,{inMenu:true,adjust:(by:number)=>{r.actions.push(`adjust:${by}`);return true;}});
  r.pad.buttons[15]!.pressed=true;r.step();r.step();r.step(180);
  expect(r.actions).toEqual(["adjust:1","adjust:1"]);
  r.pad.buttons[15]!.pressed=false;r.step();
  Object.assign(r.target,{adjust:()=>false});r.pad.buttons[14]!.pressed=true;r.step();
  expect(r.actions.at(-1)).toBe("nav:-1:0");
});

test("flyer roll and brake remain held abilities, without on-foot stance taps",()=>{
  const r=rig();r.controls.fly(true,true);
  r.pad.buttons[11]!.pressed=true;r.step();r.step(400);
  expect(r.controls.buttons & BTN_ROLL).toBe(BTN_ROLL);
  r.pad.buttons[11]!.pressed=false;r.step();expect(r.controls.buttons & BTN_ROLL).toBe(0);
  r.pad.buttons[4]!.pressed=true;r.pad.buttons[11]!.pressed=true;r.step();
  expect(r.controls.buttons & BTN_BRAKE).toBe(BTN_BRAKE);
  r.disconnect();expect(r.controls.buttons & (BTN_ROLL|BTN_BRAKE)).toBe(0);
  expect(r.actions).toEqual(["KeyC:true","KeyC:false","KeyX:true","KeyX:false"]);
});

test("Sony touchpad mappings use the touchpad for map and leave Share/Create alone",()=>{
  const r=rig();Object.assign(r.pad,{id:"Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"});
  r.pad.buttons.push({pressed:false,value:0});
  r.pad.buttons[8]!.pressed=true;r.step();r.pad.buttons[8]!.pressed=false;r.step();expect(r.actions).toEqual([]);
  r.pad.buttons[17]!.pressed=true;r.step();r.pad.buttons[17]!.pressed=false;r.step();
  expect(r.actions).toEqual(["KeyM:true","KeyM:false"]);
});

test("changing between foot and flyer cancels a pending stance or held flight ability",()=>{
  const r=rig();r.pad.buttons[11]!.pressed=true;r.step();r.controls.fly(true,true);r.step(400);
  r.pad.buttons[11]!.pressed=false;r.step();expect(r.actions).toEqual([]);
  r.pad.buttons[11]!.pressed=true;r.step();expect(r.controls.buttons & BTN_ROLL).toBe(BTN_ROLL);
  r.controls.fly(false,false);r.step();expect(r.actions).toEqual(["KeyC:true","KeyC:false"]);
  r.step(400);expect(r.actions).toHaveLength(2);
});

test("pressing the right stick cycles patrol lights once and leaves crouch available on foot", () => {
  const r = rig();
  Object.assign(r.target, { patrol: true });
  r.pad.buttons[11]!.pressed = true; r.step(); r.step(500);
  r.pad.buttons[11]!.pressed = false; r.step();
  expect(r.actions).toEqual(["KeyK:true", "KeyK:false"]);
  Object.assign(r.target, { patrol: false });
  r.pad.buttons[11]!.pressed = true; r.step();
  r.pad.buttons[11]!.pressed = false; r.step();
  expect(r.actions.slice(-2)).toEqual(["KeyC:true", "KeyC:false"]);
});

test("LB and the right stick's press hold a helmet's visor up as the middle mouse button does; with a sight that zooms raised the d-pad's up and down step it, and with LB its zero",()=>{
  const r=rig(), mice: string[]=[], zooms: string[]=[];
  let zooming=false;
  Object.assign(r.target,{ mouse(button: number, down: boolean){ mice.push(`m${button}:${down}`); }, zoom(n: number, alt?: boolean){ zooms.push(`${n}:${!!alt}`); } });
  Object.defineProperty(r.target,"zooming",{ get: () => zooming });
  r.pad.buttons[4]!.pressed=true; r.pad.buttons[11]!.pressed=true; r.step();
  r.pad.buttons[11]!.pressed=false; r.step(); r.pad.buttons[4]!.pressed=false; r.step();
  expect(mice).toEqual(["m1:true","m1:false"]);
  // Not zooming, the d-pad picks the hotbar; zooming, it zooms, and with LB dials the zero.
  r.pad.buttons[12]!.pressed=true; r.step(); r.pad.buttons[12]!.pressed=false; r.step();
  expect([zooms, r.actions.includes("Digit1:true")]).toEqual([[], true]);
  zooming=true;
  r.pad.buttons[12]!.pressed=true; r.step(); r.pad.buttons[12]!.pressed=false; r.step();
  r.pad.buttons[13]!.pressed=true; r.step(); r.pad.buttons[13]!.pressed=false; r.step();
  r.pad.buttons[4]!.pressed=true; r.pad.buttons[12]!.pressed=true; r.step();
  expect(zooms).toEqual(["-1:false","1:false","-1:true"]);
});

test("a skater can hold a grab and release it for the landing", () => {
  const r = rig();
  r.controls.skate(true); Object.assign(r.target, { skating: true });
  const keys = [[0, "Space"], [7, "KeyR"], [6, "KeyG"], [2, "KeyQ"], [4, "KeyX"], [5, "KeyC"], [10, "ShiftLeft"]] as const;
  for (const [i, key] of keys) {
    r.pad.buttons[i]!.pressed = true; r.step();
    expect(r.controls.buttons).toBe(r.controls.bindings()[key]!);
    r.pad.buttons[i]!.pressed = false; r.step();
    expect(r.controls.buttons).toBe(0);
  }
});
