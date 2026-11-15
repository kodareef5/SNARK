import { expect, test } from "bun:test";
import { GamepadInput, padAxis, type PadTarget } from "../../client/core/gamepad.ts";
import { Controls } from "../../client/core/controls.ts";
import { BTN_JUMP, BTN_PRIMARY } from "../../shared/sim/character.ts";

function rig() {
  const controls = new Controls(), driver = new GamepadInput(), actions: string[] = [];
  const pad = { connected: true, mapping: "standard", axes: [0,0,0,0], buttons: Array.from({length:17},()=>({ pressed:false, value:0 })) };
  const target: PadTarget = {
    inMenu:false, inspecting:false, heldSlot:-1,
    key(code,down) { actions.push(`${code}:${down}`); controls.key(code,down,1); if (code === "KeyH") Object.assign(target, { inMenu:down, inspecting:down }); },
    mouse(button,down) { controls.mouseButton(button,down,1); },
    move(x,z) { controls.padMove(x,z); }, look(x,y) { controls.look(x,y); },
    navigate(direction,press) { actions.push(`nav:${direction}:${press}`); }, used() {},
  };
  let now=0;
  return { controls, target, pad, actions, step:()=>driver.update([pad],now+=16,target), disconnect:()=>driver.update([],now+=16,target) };
}

test("standard pads apply dead zones, bounded analogue movement and edge-triggered actions",()=>{
  for (const n of [0,.17,-.18,NaN,Infinity]) expect(padAxis(n)).toBe(0);
  expect(padAxis(2)).toBe(1); expect(padAxis(-2)).toBe(-1);
  const r=rig(); r.pad.axes=[.5,-1,.5,0]; r.pad.buttons[7]!.value=1;
  r.step(); r.step();
  expect(r.controls.moveX).toBeCloseTo((.5-.18)/.82); expect(r.controls.moveZ).toBe(1);
  expect(r.controls.buttons & BTN_PRIMARY).toBe(BTN_PRIMARY); expect(r.controls.yaw).toBeLessThan(0);
  r.pad.buttons[5]!.pressed=true; r.step(); r.step();
  expect(r.actions).toEqual(["Digit1:true","Digit1:false"]);
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
  const r=rig(); r.pad.buttons[12]!.pressed=true; r.step(); r.step(); r.step();
  expect(r.target.inspecting).toBe(true); expect(r.actions).toEqual(["KeyH:true"]);
  r.disconnect(); expect(r.target.inspecting).toBe(false);
  r.pad.buttons[12]!.pressed=false; r.step(); r.pad.buttons[12]!.pressed=true; r.step();
  r.pad.buttons[12]!.pressed=false; r.step(); expect(r.target.inspecting).toBe(false);
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
