import { expect, test } from "bun:test";
import { HudModel, VehicleTelemetry } from "../../client/core/hud.ts";
import { Settings, SETTING_ROWS } from "../../client/core/settings.ts";
import { KEY_CONTROL_DETAIL, KEY_CONTROL_GROUP, KEY_CONTROL_GLYPHS } from "../../client/core/ui/controls-help.ts";
import { KEY_CONTROL_PAD } from "../../client/core/ui/controller.ts";
import { KEY_SETTINGS_PAGE, KEY_SETTINGS_ROW, KEY_SETTINGS_TAB, SETTING_GROUPS } from "../../client/core/ui/settings.ts";
import { siteLinks } from "../../client/core/travel.ts";
import { KEY_BUFF, KEY_HOTBAR, KEY_MINIMAP, KEY_MINIMAP_TOGGLE, KEY_READOUT, KEY_VEHICLE, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { KEY_CONTROLS_DEVICE, KEY_MENU, KEY_MENU_BACK, KEY_MENU_CONTROLS, KEY_MENU_LINK, KEY_MENU_RESUME, KEY_MENU_SETTINGS, KEY_UNMUTE } from "../../client/core/ui/menu.ts";
import { K_HOLD, K_IMAGE, K_SLIDER, UiFrame, textWidth, type UiImage } from "../../client/core/ui/nodes.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import * as layout from "../../client/core/ui/touch.ts";
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
  settings.restoreInterface('{"version":1,"minimap":false,"tier":"ultra"}');
  expect([settings.minimap, settings.tier, settings.chosen]).toEqual([true, "medium", false]);
  settings.restoreInterface('{"version":2,"minimap":false,"vitalLabels":true,"diagnostics":true}');
  settings.restoreInterface('{"version":2,"sensitivity":99,"fov":-1,"masterVolume":0,"minimapZoom":30,"snapshotBytes":999999,"tier":"bogus","download":true,"tab":3}');
  const copy = new Settings(); copy.restoreInterface(settings.interfacePreferences());
  expect([copy.minimap,copy.vitalLabels,copy.diagnostics,copy.sensitivity,copy.fov,copy.masterVolume,copy.minimapZoom]).toEqual([false,true,true,3,50,0,3]);
  expect([copy.snapshotBytes,copy.tier,copy.chosen,copy.download,copy.tab]).toEqual([1100,"medium",false,false,0]);
  // A tier is saved only once chosen, and a chosen tier is kept over the device's start.
  expect(JSON.parse(copy.interfacePreferences()).tier).toBeUndefined();
  copy.restoreInterface('{"version":2,"tier":"lowpoly"}');
  copy.start({ renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M5)", light: true });
  expect([copy.tier, copy.chosen, JSON.parse(copy.interfacePreferences()).tier]).toEqual(["lowpoly", true, "lowpoly"]);
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
  // The links the menu shows beneath Controls, which make it taller.
  ui.links=siteLinks({wiki:"/wiki/",repository:"https://git.example.com/a/long/way/down/to/the/repository/of/the/game"});
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

test("a phone on its side: the menu, every settings tab and page, and the controls fit a canvas as short as 400 units", () => {
  const ui=new Ui(),hud=new HudModel();
  ui.inputDevice=2;ui.layer=layout;
  // With the links the menu shows beneath Controls, which a short canvas has to make room for.
  ui.links=siteLinks({wiki:"/wiki/",repository:"https://git.example.com/code"});
  let paged=0;
  for (const [w,h] of [[1056,488],[834,469],[710,400],[1280,576]] as const) for (const mode of [0,1,2,3,4,5,6,7]) {
    ui.canvasHeight=h;ui.menu=true;ui.options=mode>=1 && mode<=4;ui.settings.tab=mode-1;ui.settings.page=0;ui.help=mode>=5;ui.helpDevice=mode-5;
    for (let page=0;page<4;page++) {
      ui.build(w/h,hud,null);
      const f=ui.frame,nodes=f.nodes.slice(0,f.count),where=`${w}x${h} mode=${mode} page=${page}`;
      expect([f.width,f.height],where).toEqual([w,h]);
      const keys=new Set<number>();
      for (const n of nodes) {
        expect(keys.has(n.key),`${where} key=${n.key}`).toBe(false);keys.add(n.key);
        // The touch sheet's pictures carry their glow in clear margins, which may pass an edge; nothing else may.
        if (!(n.kind===K_IMAGE && n.key>=3300000)) expect(n.x>=-0.01 && n.y>=-0.01 && n.x+n.w<=f.width+0.01 && n.y+n.h<=f.height+0.01,`${where} key=${n.key} at ${n.x},${n.y} ${n.w}x${n.h}`).toBe(true);
        if (n.text) expect(textWidth(n.text,n.style),`${where}: ${n.text}`).toBeLessThanOrEqual(n.w+0.01);
      }
      const controls=nodes.filter(n=>n.interactive);
      for (let i=0;i<controls.length;i++) for (let j=i+1;j<controls.length;j++) {
        const a=controls[i]!,b=controls[j]!;
        expect(a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h,`${where}: overlap ${a.key}/${b.key}`).toBe(false);
      }
      // On so short a canvas the controls are the touch page, whichever was asked for.
      if (mode>=5 && h<640) expect(nodes.some(n=>n.text==="Left side") && !nodes.some(n=>n.label==="Controller"),where).toBe(true);
      // Every row of a tab is on one of its pages.
      if (!ui.options || !f.find(KEY_SETTINGS_PAGE)) break;
      const was=ui.settings.page;
      ui.pointer(0,KEY_SETTINGS_PAGE+1,0,0,0,null);ui.build(w/h,hud,null);
      if (ui.settings.page===was) break;
      paged++;
    }
  }
  expect(paged).toBeGreaterThanOrEqual(2);
  // A full window, and a phone upright, show every tab whole: no tab pages there.
  for (const [aspect,height] of [[16/9,720],[9/16,720],[405/876,876]] as const) for (let tab=0;tab<4;tab++) {
    ui.canvasHeight=height;ui.options=true;ui.help=false;ui.settings.tab=tab;ui.settings.page=0;ui.build(aspect,hud,null);
    expect(ui.frame.find(KEY_SETTINGS_PAGE),`tab ${tab} at ${height}`).toBeNull();
  }
  // The audio tab's eight rows, over the pages of the shortest canvas, each once.
  ui.canvasHeight=400;ui.options=true;ui.help=false;ui.settings.tab=1;ui.settings.page=0;
  const seen:string[]=[];
  for (let page=0;page<4;page++) {
    ui.build(710/400,hud,null);
    for (const n of ui.frame.nodes.slice(0,ui.frame.count)) if (n.key>=KEY_SETTINGS_ROW && n.key<KEY_SETTINGS_ROW+SETTING_ROWS.length*4 && (n.key-KEY_SETTINGS_ROW)%4===0) seen.push(n.text);
    const was=ui.settings.page;ui.pointer(0,KEY_SETTINGS_PAGE+1,0,0,0,null);ui.build(710/400,hud,null);
    if (ui.settings.page===was) break;
  }
  expect(seen).toEqual(["Sound","Master volume","Effects volume","Ambience volume","Music volume","Interface volume","Voice volume","Talk key (B)"]);
  // A tab chosen starts at its first page.
  ui.pointer(0,KEY_SETTINGS_TAB+1,0,0,0,null);expect(ui.settings.page).toBe(0);
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

test("a page starts muted and offers to unmute over the HUD and the menu; a press unmutes, and the choice is saved", () => {
  const ui=new Ui(),hud=new HudModel();
  ui.layer=layout;
  expect(ui.settings.muted).toBe(true);
  for (const aspect of [9/16,4/3,16/9,32/9]) for (const menu of [false,true]) for (const touch of [false,true]) {
    ui.menu=menu;ui.inputDevice=touch?2:0;ui.build(aspect,hud,null);
    const b=ui.frame.find(KEY_UNMUTE)!,where=`aspect=${aspect} menu=${menu} touch=${touch}`;
    expect([b.interactive,b.text],where).toEqual([true,"Unmute sound"]);
    expect(textWidth(b.text,b.style),where).toBeLessThanOrEqual(b.w);
    expect(b.h,where).toBeGreaterThanOrEqual(44);
    expect(b.x>=0 && b.x+b.w<=ui.frame.width,where).toBe(true);
    for (const n of ui.frame.nodes.slice(0,ui.frame.count)) if (n!==b && n.interactive && n.kind!==K_HOLD) expect(b.x<n.x+n.w && n.x<b.x+b.w && b.y<n.y+n.h && n.y<b.y+b.h,`${where} over ${n.key}`).toBe(false);
  }
  // Only a press of the main button unmutes: not a pointer passing over, nor the secondary button.
  const before=ui.settings.revision;
  ui.pointer(2,KEY_UNMUTE,0,0,0,null);ui.pointer(0,KEY_UNMUTE,0,0,2,null);
  expect([ui.settings.muted,ui.settings.revision]).toEqual([true,before]);
  ui.pointer(0,KEY_UNMUTE,0,0,0,null);
  expect([ui.settings.muted,ui.settings.revision,ui.menu]).toEqual([false,before+1,true]);
  ui.build(16/9,hud,null);
  expect(ui.frame.find(KEY_UNMUTE)).toBeNull();
  // The choice outlasts the page; a visitor with nothing saved, or with preferences from before, is muted.
  const copy=new Settings();copy.restoreInterface(ui.settings.interfacePreferences());expect(copy.muted).toBe(false);
  const old=new Settings();old.restoreInterface('{"version":2,"masterVolume":1}');expect(old.muted).toBe(true);
  // The settings' Sound row mutes again, and the offer comes back.
  SETTING_ROWS.find(r=>r.label==="Sound")!.step(ui.settings,1);ui.build(16/9,hud,null);
  expect([ui.settings.muted,ui.frame.find(KEY_UNMUTE)!==null]).toEqual([true,true]);
});

test("the menu's links are buttons beneath Controls that open where the server says, once a press, by pointer or by key", () => {
  const ui=new Ui(),hud=new HudModel(),opened:string[]=[];ui.openMenu();ui.openLink=(url)=>void opened.push(url);
  ui.links=siteLinks({wiki:"/wiki/",repository:"https://snark.dev/code"});ui.build(16/9,hud,null);
  const buttons=()=>ui.frame.nodes.slice(0,ui.frame.count).filter(n=>n.interactive).map(n=>n.text);
  expect(buttons()).toEqual(["Reconnect","Settings","Controls","Wiki","Source code","Unmute sound"]);
  ui.pointer(0,KEY_MENU_LINK+1,0,0,0,null);
  expect([opened,ui.menu]).toEqual([["https://snark.dev/code"],true]);
  // Chosen with the keyboard: Tab moves the focus down to the button, and Enter presses it.
  ui.pointer(2,KEY_MENU_CONTROLS,0,0,0,null);ui.build(16/9,hud,null);ui.key("Tab",true,false,null);ui.key("Enter",true,false,null);
  expect(opened.at(-1)).toBe("/wiki/");
  // A link the server hid has no button, and its key opens nothing; the settings beneath the menu show none.
  ui.links=siteLinks({wiki:"/wiki/",repository:""});ui.build(16/9,hud,null);ui.pointer(0,KEY_MENU_LINK+1,0,0,0,null);
  expect([buttons().includes("Source code"),opened.length]).toEqual([false,2]);
  ui.pointer(0,KEY_MENU_SETTINGS,0,0,0,null);ui.build(16/9,hud,null);
  for(let tab=0;tab<SETTING_GROUPS.length;tab++){ui.settings.tab=tab;ui.build(16/9,hud,null);expect(buttons().includes("Wiki")).toBe(false);}
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

test("the Display tab exposes independent gloss and road controls and restores old preferences", () => {
  const s = new Settings();
  s.restoreInterface('{"version":2,"tier":"medium"}');
  expect([s.finishGloss, s.roadFinish]).toEqual([1.35, 1]);
  const rows = SETTING_GROUPS[0].rows.map(i => SETTING_ROWS[i]!);
  const gloss = rows.find(row => row.label === "Finish gloss")!, road = rows.find(row => row.label === "Road finish")!;
  gloss.range!.set(s, 1.97);
  road.step(s, 1);
  road.step(s, 1);
  const restored = new Settings();
  restored.restoreInterface(s.interfacePreferences());
  expect([gloss.value(restored), road.value(restored), restored.tier]).toEqual(["195%", "Dry + deeper shade", "medium"]);
});
