import { expect, test } from "bun:test";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { Settings, SETTING_ROWS } from "../../client/core/settings.ts";
import { KEY_CONTROL_DETAIL, KEY_CONTROL_GROUP, KEY_CONTROL_GLYPHS } from "../../client/core/ui/controls-help.ts";
import { KEY_CONTROL_PAD } from "../../client/core/ui/controller.ts";
import { SETTING_GROUPS } from "../../client/core/ui/settings.ts";
import { KEY_BUFF, KEY_HOTBAR, KEY_MINIMAP, KEY_MINIMAP_TOGGLE, KEY_READOUT, KEY_VEHICLE, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { KEY_CONTROLS_DEVICE, KEY_MENU, KEY_MENU_BACK, KEY_MENU_CONTROLS, KEY_MENU_RESUME, KEY_MENU_SETTINGS } from "../../client/core/ui/menu.ts";
import { K_IMAGE, K_SLIDER, UiFrame, textWidth, type UiImage } from "../../client/core/ui/nodes.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { filledVital } from "../../client/core/ui/vitals.ts";
import { IMAGE_SKIN, ICON_SIZE, SKIN_HEIGHT, SKIN_WIDTH } from "../../client/core/ui/skin.ts";
import { drawUi } from "../../tools/snap/ui.ts";
import { bindTextInput } from "../../client/core/ui/events.ts";

test("the quiet HUD keeps ten numbered slots fixed when status and contextual vitals change", () => {
  for (const aspect of [9 / 16, 4 / 3, 16 / 9, 32 / 9]) {
    const ui = new Ui(), hud = new HudModel();
    hud.hotbar.push(...Array.from({ length: 10 }, () => ({ tint: -1, label: "", number: "" })));
    ui.build(aspect, hud, null);
    expect(ui.frame.find(KEY_READOUT)).toBeNull();
    expect(ui.frame.find(KEY_VITAL + 9)).toBeNull();
    expect(ui.frame.find(KEY_VITAL + 11)).toBeNull();
    const bottom = ui.frame.find(KEY_HOTBAR)!.y;
    for (let i = 0; i < 10; i++) expect(ui.frame.find(5520 + i)!.text).toBe(String((i + 1) % 10));
    hud.status = "Connection lost";
    hud.vitals[4]!.fraction = .3;
    hud.vitals[5]!.fraction = .2;
    ui.build(aspect, hud, null);
    expect(ui.frame.find(KEY_HOTBAR)!.y).toBe(bottom);
    expect(ui.frame.find(KEY_VITAL + 9)!.label).toBe("Oxygen 30%");
    ui.settings.minimap = false;
    ui.inspect = true;
    ui.build(aspect, hud, null);
    expect(ui.frame.find(KEY_MINIMAP)).toBeNull();
    expect(ui.frame.find(KEY_MINIMAP_TOGGLE)!.label).toBe("Show minimap");
    const keys = new Set<number>();
    for (const n of ui.frame.nodes.slice(0, ui.frame.count)) {
      expect(keys.has(n.key), `duplicate ${n.key}`).toBe(false); keys.add(n.key);
      expect(n.x).toBeGreaterThanOrEqual(0); expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x+n.w).toBeLessThanOrEqual(ui.frame.width); expect(n.y+n.h).toBeLessThanOrEqual(ui.frame.height);
    }
  }
});

test("Escape consumes gameplay input, navigates one layer, and traps menu focus", () => {
  const ui = new Ui(), hud = new HudModel();
  ui.build(16 / 9, hud, null);
  ui.key("Escape", true, false, null);
  ui.build(16 / 9, hud, null);
  expect([ui.menu, ui.captureKeyboard, ui.wantsPointerLock]).toEqual([true, true, false]);
  expect(ui.frame.find(KEY_MENU_RESUME)!.focus).toBe(true);
  expect(ui.frame.find(KEY_HOTBAR)).toBeNull();
  expect(ui.key("KeyW", true, false, null)).toBe(true);
  ui.key("Escape", true, true, null); expect(ui.menu).toBe(true);
  ui.key("Tab", true, false, null); expect(ui.menuFocus).toBe(KEY_MENU_SETTINGS);
  ui.key("Enter", true, false, null); expect(ui.options).toBe(true);
  ui.build(16 / 9, hud, null); expect(ui.frame.find(KEY_MENU_BACK)!.focus).toBe(true);
  ui.key("Escape", true, false, null); expect([ui.menu,ui.options]).toEqual([true,false]);
  ui.pointer(0, KEY_MENU_CONTROLS, 0, 0, 0, null); expect(ui.help).toBe(true);
  ui.pointer(0, KEY_MENU_BACK, 0, 0, 0, null); expect(ui.help).toBe(false);
  ui.build(16 / 9, hud, null); expect(ui.frame.find(KEY_MENU)).not.toBeNull();
  ui.key("Escape", true, false, null); expect([ui.menu, ui.wantsPointerLock]).toEqual([false,true]);
});

test("inspection releases the camera and exposes details only until its key is released", () => {
  const ui = new Ui(), hud = new HudModel();
  ui.key("KeyH", true, false, null); ui.build(16/9, hud, null);
  expect(ui.inspect).toBe(true); expect(ui.wantsPointerLock).toBe(false);
  expect(ui.frame.find(KEY_VITAL)).not.toBeNull();
  ui.key("KeyH", false, false, null); ui.build(16/9, hud, null);
  expect(ui.inspect).toBe(false); expect(ui.wantsPointerLock).toBe(true);
  expect(ui.frame.find(KEY_VITAL)).toBeNull();
  ui.key("KeyL", true, false, null); expect(ui.settings.minimap).toBe(false);
  ui.key("KeyL", true, true, null); expect(ui.settings.minimap).toBe(false);
});

test("saved preferences bound numeric values and never restore transient actions", () => {
  const settings = new Settings();
  for (const bad of [null, "{", "null", "[]", '{"version":99,"minimap":false}', '{"minimap":"false","diagnostics":3}']) settings.restoreInterface(bad);
  expect([settings.minimap,settings.diagnostics]).toEqual([true,false]);
  settings.restoreInterface('{"version":1,"minimap":false,"vitalLabels":true,"diagnostics":true}');
  settings.restoreInterface('{"version":1,"sensitivity":99,"fov":-1,"masterVolume":0,"minimapZoom":30,"snapshotBytes":999999,"tier":"bogus","download":true,"tab":3}');
  const copy = new Settings(); copy.restoreInterface(settings.interfacePreferences());
  expect([copy.minimap,copy.vitalLabels,copy.diagnostics,copy.sensitivity,copy.fov,copy.masterVolume,copy.minimapZoom]).toEqual([false,true,true,3,50,0,3]);
  expect([copy.snapshotBytes,copy.tier,copy.download,copy.tab]).toEqual([1100,"medium",false,0]);
});

test("every vital value crops one bounded shared sheet, preserves capacity and never stretches an empty fill", () => {
  const f = new UiFrame();
  let sheet: UiImage | undefined;
  for (let kind = 0; kind < 7; kind++) for (const value of [-1, 0, .01, .25, .5, 1, 2, NaN, Infinity]) {
    f.begin(1); filledVital(f, 80, kind, 30, 30, 32, value, "Status", true);
    const image = f.images[IMAGE_SKIN]!;
    sheet ??= image;
    expect(image).toBe(sheet);
    expect(image.data.byteLength).toBe(SKIN_WIDTH*SKIN_HEIGHT*4);
    const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1,value)) : 0;
    const warning = kind >= 5 ? fraction > .8 : fraction < .2;
    expect(f.count).toBe((fraction > 0 ? 4 : 3) + Number(warning));
    for (const n of f.nodes.slice(0,f.count).filter(n=>n.kind===K_IMAGE)) {
      expect(n.image).toBe(IMAGE_SKIN); expect(n.sw).toBe(ICON_SIZE);
      expect(n.sh).toBeGreaterThan(0); expect(n.sy+n.sh).toBeLessThanOrEqual(image.height);
      expect(n.y).toBeGreaterThanOrEqual(30); expect(n.y+n.h).toBeLessThanOrEqual(62);
    }
  }
});

test("software image layers respect opacity and source cropping", () => {
  const f = new UiFrame(); f.begin(1);
  f.images[1] = { width:2, height:1, version:1, data:new Uint8ClampedArray([255,0,0,255,0,0,255,255]) };
  const n=f.add(1,K_IMAGE,0,0,720,720,0);n.image=1;n.sx=1;n.sw=1;n.sh=1;n.alpha=.5;
  const pixels=new Uint8ClampedArray(4); drawUi(pixels,1,1,f);
  expect(Array.from(pixels)).toEqual([0,0,128,255]);
});

test("every menu, settings group and device layout fits from phone portrait to ultrawide",()=>{
  const grouped: number[] = SETTING_GROUPS.flatMap(g=>[...g.rows]);
  expect(grouped.sort((a,b)=>a-b)).toEqual(SETTING_ROWS.map((_,i)=>i));
  const ui=new Ui(),hud=new HudModel();
  for (const aspect of [9/16,4/3,16/9,21/9,32/9]) for (const mode of [0,1,2,3,4,5,6]) for(const context of (mode>=5?[0,1,2,3,4,5]:[0])) for(const glyphs of (mode===6?[0,1]:[0])) {
    ui.menu=true; ui.options=mode>=1 && mode<=4; ui.settings.tab=mode-1; ui.help=mode>=5; ui.helpDevice=mode-5;
    ui.helpGroup=context;ui.settings.padGlyphs=glyphs;ui.build(aspect,hud,null);
    const nodes=ui.frame.nodes.slice(0,ui.frame.count), keys=new Set<number>();
    for (const n of nodes) {
      const where=`aspect=${aspect} mode=${mode} key=${n.key}`;
      expect(keys.has(n.key),where).toBe(false); keys.add(n.key);
      expect(n.x,where).toBeGreaterThanOrEqual(0); expect(n.y,where).toBeGreaterThanOrEqual(0);
      expect(n.x+n.w,where).toBeLessThanOrEqual(ui.frame.width); expect(n.y+n.h,where).toBeLessThanOrEqual(ui.frame.height);
      if (n.text) expect(textWidth(n.text,n.style),`${where}: ${n.text}`).toBeLessThanOrEqual(n.w);
    }
    const controls=nodes.filter(n=>n.interactive);
    for (let i=0;i<controls.length;i++) for (let j=i+1;j<controls.length;j++) {
      const a=controls[i]!,b=controls[j]!;
      expect(a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h,`overlap ${a.key}/${b.key}`).toBe(false);
    }
  }
});

test("sliders accept pointer values, reject invalid input, and support repeated precise keyboard adjustments",()=>{
  const ui=new Ui(),hud=new HudModel();ui.menu=ui.options=true;ui.settings.tab=2;
  ui.build(16/9,hud,null);
  const slider=ui.frame.nodes.slice(0,ui.frame.count).find(n=>n.kind===K_SLIDER)!;
  expect(slider.label).toBe("Mouse sensitivity");
  ui.pointer(0,slider.key,slider.x+slider.w*.5,slider.y,0,null);
  ui.input(slider.key,".5");expect(ui.settings.sensitivity).toBe(1.6);
  for(const value of ["", " ","NaN","Infinity","broken"])ui.input(slider.key,value);
  expect(ui.settings.sensitivity).toBe(1.6);
  ui.key("ArrowRight",true,false,null);ui.key("ArrowRight",true,true,null);
  expect(ui.settings.sensitivity).toBe(1.8); // Two events before the next layout must both count.
  ui.key("Home",true,false,null);expect(ui.settings.sensitivity).toBe(.2);
  ui.key("End",true,false,null);expect(ui.settings.sensitivity).toBe(3);
  ui.input(slider.key,"-8");expect(ui.settings.sensitivity).toBe(.2);
  ui.input(slider.key,"8");expect(ui.settings.sensitivity).toBe(3);
  const copy=new Settings();copy.restoreInterface(ui.settings.interfacePreferences());expect(copy.sensitivity).toBe(3);
  ui.console.open=true;expect(ui.adjustFocused(-1)).toBe(false);expect(ui.settings.sensitivity).toBe(3);
  ui.console.open=false;ui.options=ui.menu=false;ui.key("ArrowLeft",true,false,null);expect(ui.settings.sensitivity).toBe(3);
});

test("a range field's position reaches its slider through the shell's binding as a fraction of the field's maximum", () => {
  const ui = new Ui(), hud = new HudModel();
  ui.menu = ui.options = true;
  ui.settings.tab = 2;
  ui.build(16 / 9, hud, null);
  const slider = ui.frame.nodes.slice(0, ui.frame.count).find((n) => n.kind === K_SLIDER)!;
  const field = { type: "range", max: String(Math.round(1 / slider.step)), value: "0" };
  const edit = bindTextInput(slider, field, { text: (key, value) => ui.input(key, value) });
  field.value = field.max;
  edit();
  ui.build(16 / 9, hud, null);
  expect(ui.settings.sensitivity).toBe(3);
  field.value = String(Number(field.max) / 2);
  edit();
  expect(ui.settings.sensitivity).toBe(1.6);
});

test("the dashboard sits under the minimap, or in its place with the show button beside it, and stays clear of buffs", () => {
  const v = new VehicleTelemetry();
  v.active = true; v.speed = 12; v.gear = 3; v.rpm = 3400; v.redline = 6500; v.fuel = .72;
  for (const [aspect, minimap] of [[16 / 9, true], [16 / 9, false], [9 / 19.5, true], [9 / 19.5, false]] as const) {
    const ui = new Ui(), hud = new HudModel();
    hud.vehicle = v;
    hud.buffs.push(...Array.from({ length: 16 }, () => ({ label: "Buff", seconds: 10, tint: 0x335577 })));
    ui.settings.minimap = minimap;
    ui.inspect = true;
    ui.build(aspect, hud, null);
    const f = ui.frame, nodes = f.nodes.slice(0, f.count);
    const dash = nodes.filter((n) => n.key >= KEY_VEHICLE && n.key < KEY_VEHICLE + 8);
    const top = Math.min(...dash.map((n) => n.y)), bottom = Math.max(...dash.map((n) => n.y + n.h)), left = Math.min(...dash.map((n) => n.x));
    expect(dash.length).toBe(8);
    for (const n of dash) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(f.width);
      if (n.text) expect(textWidth(n.text, n.style), n.text).toBeLessThanOrEqual(n.w);
    }
    if (minimap) expect(top).toBeGreaterThan(f.find(KEY_MINIMAP)!.y + f.find(KEY_MINIMAP)!.h);
    else expect(top).toBeLessThan(40);
    const toggle = f.find(KEY_MINIMAP_TOGGLE)!;
    expect(toggle.x + toggle.w <= left - 2 || toggle.y + toggle.h <= top || toggle.y >= bottom).toBe(true);
    for (const n of nodes) if (n.key >= KEY_BUFF && n.key < KEY_BUFF + 16) expect(n.y >= bottom || n.x + n.w <= left, `buff ${n.key}`).toBe(true);
  }
});

test("control contexts and symbol preference change the guide and persist only the preference",()=>{
  const ui=new Ui(),hud=new HudModel();ui.menu=ui.help=true;
  ui.build(16/9,hud,null);ui.pointer(0,KEY_CONTROL_GROUP+3,0,0,0,null);ui.build(16/9,hud,null);
  const e=ui.frame.nodes.slice(0,ui.frame.count).find(n=>n.interactive && n.label==="E: Rotate")!;
  expect(e).toBeDefined();ui.pointer(0,e.key,0,0,0,null);ui.build(16/9,hud,null);
  expect(ui.frame.find(KEY_CONTROL_DETAIL+2)!.text).toBe("E  /  Rotate");
  ui.pointer(0,KEY_CONTROLS_DEVICE+1,0,0,0,null);ui.pointer(0,KEY_CONTROL_GROUP+2,0,0,0,null);ui.build(16/9,hud,null);
  expect(ui.frame.find(KEY_CONTROL_PAD+1)!.label).toBe("B: Inventory");
  ui.pointer(0,KEY_CONTROL_GLYPHS,0,0,0,null);ui.build(16/9,hud,null);
  expect(ui.frame.find(KEY_CONTROL_PAD+1)!.label).toBe("○: Inventory");
  const copy=new Settings();copy.restoreInterface(ui.settings.interfacePreferences());expect(copy.padGlyphs).toBe(1);
  expect(JSON.parse(copy.interfacePreferences()).helpGroup).toBeUndefined();
});

test("horizontal value adjustment follows direction, and never invokes the asset download action",()=>{
  const ui=new Ui(),hud=new HudModel();ui.menu=ui.options=true;ui.build(16/9,hud,null);
  ui.menuFocus=2310+11*4+2; // Graphics' previous button remains focused for both directions.
  ui.settings.tier="medium";expect(ui.adjustFocused(-1)).toBe(true);expect(String(ui.settings.tier)).toBe("lowpoly");
  expect(ui.adjustFocused(1)).toBe(true);expect(ui.settings.tier).toBe("medium");
  ui.settings.tab=3;ui.build(16/9,hud,null);ui.menuFocus=2310+10*4+3;
  expect(ui.adjustFocused(1)).toBe(false);expect(ui.settings.download).toBe(false);
});
