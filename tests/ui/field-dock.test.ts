import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_DOCK_SLOT, KEY_FIELD_HUB, KEY_FIELD_LEAF, type FieldDock } from "../../client/core/ui/field-dock.ts";
import { KEY_TOUCH_HELP, type MenuScreen } from "../../client/core/ui/menu-screen.ts";
import { KEY_MENU_BACK } from "../../client/core/ui/menu.ts";
import { KEY_CONSOLE_INPUT } from "../../client/core/ui/console.ts";
import { TAB_MAKE, type CharacterScreen } from "../../client/core/ui/character.ts";
import * as touch from "../../client/core/ui/touch.ts";
import { K_IMAGE } from "../../client/core/ui/nodes.ts";
import { IMAGE_TOUCH, I_CROUCH, I_JUMP, I_MELEE, I_PRONE, I_RELOAD, I_VIEW } from "../../client/core/ui/touch-art.ts";
import { KEY_ZONE_LOOK, KEY_ZONE_MOVE } from "../../client/core/touch.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { CMD_SELECT } from "../../shared/net/protocol.ts";
import { corePack } from "../fixtures/pack.ts";

function survivor(phone = false) {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("dock", { latencyMs: 20 }, { manual: true }), h.reg, corePack());
  app.ui.layer = touch;
  app.ui.inputDevice = phone ? 2 : 0;
  const run = (ms = 60) => h.run(ms, now => app.frame(now, phone ? 844 : 1440, phone ? 390 : 810));
  run(500);
  const point = (key: number) => {
    const n = app.ui.frame.find(key)!;
    expect(n).not.toBeNull();
    return { x: n.x+n.w/2, y: n.y+n.h/2 };
  };
  const pointer = (kind: number, key: number, pos = point(key), finger = phone ? 1 : 0) =>
    app.pointer(kind, key, pos.x, pos.y, 0, finger);
  const tap = (key: number) => { const at = point(key); pointer(0,key,at); pointer(1,key,at); run(); };
  /** Pulls the right rim in: the fan comes out on the family its rim stands for. */
  const pull = () => { const at = point(KEY_FIELD_HUB + 3); pointer(0, KEY_FIELD_HUB + 3, at); pointer(1, KEY_FIELD_HUB + 3, { x: at.x - 60, y: at.y }); run(400); };
  const held: [string, boolean][] = [];
  const holdKey = app.ui.holdKey;
  app.ui.holdKey = (code, down) => { held.push([code, down]); holdKey(code, down); };
  const dock = app.ui.screen<FieldDock>("dock");
  const pressed: string[] = [];
  const pressKey = app.ui.pressKey;
  app.ui.pressKey = (code) => { pressed.push(code); pressKey(code); };
  return { h, app, run, point, pointer, tap, pull, dock, pressed, held };
}

test("The field kit uses the current berry stack only after a command", () => {
  const { app, h, run, tap, dock } = survivor();
  for (const line of ["enablecheats", "give berry 5"]) {
    app.key("Backquote", true); app.textInput(KEY_CONSOLE_INPUT,line);
    app.key("Enter", true); app.key("Backquote", true); run(260);
  }
  const rec = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  h.host.survival.add(rec,V_FOOD,-30);
  const inv = h.host.items.inv(rec), berries = inv.item.indexOf(h.reg.index.get("core:berry")!);
  const before = h.host.survival.value(rec,V_FOOD);
  tap(KEY_FIELD_HUB+4);
  expect(dock.page).toBe("kit");
  expect(inv.count[berries]).toBe(5);
  tap(KEY_FIELD_LEAF);
  expect(dock.page).toBe("kit");
  expect(inv.count[berries]).toBe(5);
  tap(KEY_FIELD_LEAF+1);
  run(350);
  expect(dock.open).toBe(false);
  expect(inv.count[berries]).toBe(4);
  expect(h.host.survival.value(rec,V_FOOD)).toBeGreaterThan(before+1);
});

test("Craft opens the live crafting page and tray browsing issues no order", () => {
  const { app, run, tap, dock } = survivor();
  tap(KEY_FIELD_HUB+2);
  const character = app.ui.screen<CharacterScreen>("character");
  expect(character.isOpen()).toBe(true);
  expect(character.tab).toBe(TAB_MAKE);
  app.key("Escape",true); run();
  app.key("F4",true); run();
  expect(dock.page).toBe("actions");
  app.key("Enter",true); run();
  expect(dock.page).toBe("whistles");
  app.key("ArrowRight",true); run();
  expect(dock.page).toBe("whistles");
  app.key("Escape",true); run();
  expect(dock.page).toBe("actions");
});

test("A cancelled dock slide preserves equipment and a second finger cannot equip", () => {
  const { app, run, point, pointer, dock } = survivor(true);
  const selects: number[] = [], command = app.session.command.bind(app.session);
  app.session.command = ((op, write) => {
    if (op === CMD_SELECT) write?.({ u8: (v: number) => selects.push(v) } as never);
    return command(op, write);
  }) as typeof app.session.command;
  const key = KEY_DOCK_SLOT, origin = point(key);
  const last = { x: origin.x - 165, y: origin.y };
  pointer(0,key);
  pointer(2,key,last);
  run(90);
  const preview = dock.preview;
  expect(preview).toBeGreaterThan(0);
  expect(app.hud.dockBelt!.lift).toBeGreaterThan(.5);
  expect(app.ui.frame.nodes.slice(0, app.ui.frame.count).some(n => n.text === "Empty slot")).toBe(true);
  pointer(1,key,last,2); run();
  expect(selects).toEqual([]);
  pointer(3,key,last); run(500);
  expect(dock.preview).toBe(-1);
  expect(selects).toEqual([]);
  pointer(0,key); pointer(2,key,last); pointer(1,key,last); run();
  expect(selects).toEqual([preview]);
});

test("A swipe browses an action family and an outward swipe returns one level", () => {
  const { run, tap, pull, pointer, point, dock, pressed } = survivor(true);
  pull();
  expect(dock.page).toBe("moves");
  // The hub goes back to the families: the kit stands beside the moves, and the whistles are a turn on.
  tap(KEY_FIELD_HUB+3);
  expect(dock.page).toBe("actions");
  const kit = point(KEY_FIELD_LEAF+1);
  pointer(0,KEY_FIELD_LEAF+1,kit);
  pointer(2,KEY_FIELD_LEAF+1,{x:kit.x,y:kit.y-70});
  pointer(1,KEY_FIELD_LEAF+1,{x:kit.x,y:kit.y-70});
  run(400);
  expect(dock.page).toBe("actions");
  const first = point(KEY_FIELD_LEAF+2);
  pointer(0,KEY_FIELD_LEAF+2,first);
  pointer(1,KEY_FIELD_LEAF+2,{x:first.x-45,y:first.y});
  run(400);
  expect(dock.page).toBe("whistles");
  expect(pressed).toEqual([]);
  const follow = point(KEY_FIELD_LEAF);
  pointer(0,KEY_FIELD_LEAF,follow);
  pointer(1,KEY_FIELD_LEAF,{x:follow.x+45,y:follow.y});
  run(400);
  expect(dock.page).toBe("actions");
  tap(KEY_FIELD_LEAF+2); run(400); tap(KEY_FIELD_LEAF+1);
  expect(pressed).toEqual(["KeyU"]);
});

test("A tap on the right rim jumps, and a thumb that rests there holds the key down", () => {
  const { app, run, point, pointer, dock, held, pressed } = survivor(true);
  const rim = app.ui.frame.find(KEY_FIELD_HUB + 3)!, at = point(KEY_FIELD_HUB + 3);
  expect(rim.label).toBe("Jump");
  pointer(0, KEY_FIELD_HUB + 3, at); pointer(1, KEY_FIELD_HUB + 3, at); run();
  expect([pressed, held, dock.isOpen()]).toEqual([["Space"], [], false]);
  pointer(0, KEY_FIELD_HUB + 3, at);
  expect(held).toEqual([]);
  run(200);
  expect(held).toEqual([["Space", true]]);
  pointer(1, KEY_FIELD_HUB + 3, at); run();
  expect([held, pressed]).toEqual([[["Space", true], ["Space", false]], ["Space"]]);
  // A cancelled touch lets a held key go, and a quick one does nothing at all.
  pointer(0, KEY_FIELD_HUB + 3, at); run(200); pointer(3, KEY_FIELD_HUB + 3, at); run();
  pointer(0, KEY_FIELD_HUB + 3, at); pointer(3, KEY_FIELD_HUB + 3, at); run();
  expect([held.slice(2), pressed, dock.isOpen()]).toEqual([[["Space", true], ["Space", false]], ["Space"], false]);
});

test("Sliding along the rim turns it to another move, and what the fan last did is what a tap does", () => {
  const { app, run, tap, pull, point, pointer, dock, held, pressed } = survivor(true);
  const f = app.ui.frame, at = point(KEY_FIELD_HUB + 3);
  pointer(0, KEY_FIELD_HUB + 3, at);
  pointer(2, KEY_FIELD_HUB + 3, { x: at.x, y: at.y - 66 });
  run(300);
  // A turn is no press: nothing jumped, and the moves stand out to be turned through.
  expect([held, pressed]).toEqual([[], []]);
  expect(dock.page).toBe("moves");
  pointer(1, KEY_FIELD_HUB + 3, { x: at.x, y: at.y - 66 }); run(500);
  expect(dock.isOpen()).toBe(false);
  expect(f.find(KEY_FIELD_HUB + 3)!.label).toBe("Crouch");
  tap(KEY_FIELD_HUB + 3);
  expect([held, pressed]).toEqual([[], ["KeyC"]]);
  // Chosen on the fan, a whistle is given at once and the rim is that whistle after.
  pull(); tap(KEY_FIELD_HUB + 3);
  const kit = point(KEY_FIELD_LEAF + 1);
  pointer(0, KEY_FIELD_LEAF + 1, kit); pointer(2, KEY_FIELD_LEAF + 1, { x: kit.x, y: kit.y - 70 }); pointer(1, KEY_FIELD_LEAF + 1, { x: kit.x, y: kit.y - 70 }); run(400);
  tap(KEY_FIELD_LEAF + 2); run(400); tap(KEY_FIELD_LEAF + 1); run(500);
  expect(pressed).toEqual(["KeyC", "KeyU"]);
  expect(f.find(KEY_FIELD_HUB + 3)!.label).toBe("Stay");
  tap(KEY_FIELD_HUB + 3);
  expect(pressed).toEqual(["KeyC", "KeyU", "KeyU"]);
});

test("An empty slot on the phone's shelf shows a mark where a thing would stand", () => {
  const { app } = survivor(true);
  const f = app.ui.frame, slot = f.find(KEY_DOCK_SLOT)!;
  expect(slot.label).toBe("Slot 1: empty");
  const marks = f.nodes.slice(0, f.count).filter(n => n.kind === K_IMAGE && n.image === IMAGE_TOUCH && n.y > slot.y && n.alpha < .5);
  expect(marks.length).toBeGreaterThanOrEqual(5);
});

test("Pressing a command and releasing elsewhere leaves the order unissued", () => {
  const { tap, pointer, point, pressed: commands } = survivor();
  tap(KEY_FIELD_HUB+3);
  const first = point(KEY_FIELD_LEAF), second = point(KEY_FIELD_LEAF+1);
  pointer(0,KEY_FIELD_LEAF,first);
  expect(commands).toEqual([]);
  pointer(1,KEY_FIELD_LEAF+1,second);
  expect(commands).toEqual([]);
  pointer(0,KEY_FIELD_LEAF,first); pointer(3,KEY_FIELD_LEAF,first);
  pointer(1,KEY_FIELD_LEAF,first);
  expect(commands).toEqual([]);
  tap(KEY_FIELD_LEAF+1);
  expect(commands).toEqual(["KeyU"]);
});

test("The field menu lists each screen that names a way in, in rank order", () => {
  const labels = (phone: boolean) => {
    const { app, run } = survivor(phone);
    if (phone) app.pointer(0, KEY_FIELD_HUB, 0, 0, 0, 1), app.pointer(1, KEY_FIELD_HUB, 0, 0, 0, 1);
    else app.key("F2", true), app.key("F2", false);
    run();
    const out: string[] = [];
    for (let i = 0; i < 20; i++) { const n = app.ui.frame.find(KEY_FIELD_LEAF + i); if (n) out.push(n.label); }
    return out;
  };
  expect(labels(false)).toEqual(["Inventory", "Craft", "Survivor", "Map", "Radio", "Settings"]);
  expect(labels(true)).toEqual(["Inventory", "Craft", "Survivor", "Map", "Radio", "Settings", "Menu"]);
});

test("A press on the world shuts the dock, by mouse and by finger", () => {
  const { app, run, dock } = survivor();
  app.key("F4", true); app.key("F4", false); run();
  expect(dock.isOpen()).toBe(true);
  expect(app.ui.wantsPointerLock).toBe(false);
  expect(app.ui.playingField).toBe(true);
  app.ui.clickWorld(); run();
  expect(dock.isOpen()).toBe(false);
  expect(app.ui.wantsPointerLock).toBe(true);
  const phone = survivor(true);
  phone.pull();
  expect(phone.dock.isOpen()).toBe(true);
  phone.pointer(0, KEY_ZONE_LOOK, { x: 600, y: 200 });
  phone.run();
  expect(phone.dock.isOpen()).toBe(false);
});

test("The phone shelf wraps the ten slots under a thumb and cancels upward swipes", () => {
  const { app, run, pointer, point, dock } = survivor(true);
  const f = app.ui.frame;
  const slots = () => Array.from({ length: 10 }, (_, i) => f.find(KEY_DOCK_SLOT + i)).filter(Boolean);
  const shown = slots().length;
  expect(shown).toBeGreaterThanOrEqual(5);
  expect(shown).toBeLessThan(10);
  const selected: number[] = [];
  const send = app.session.command.bind(app.session);
  app.session.command = ((op, write) => {
    if (op === CMD_SELECT) write?.({ u8: (n: number) => selected.push(n) } as never);
    return send(op, write);
  }) as typeof app.session.command;
  const center = point(KEY_DOCK_SLOT);
  pointer(0, KEY_DOCK_SLOT, center);
  pointer(2, KEY_DOCK_SLOT, { x: center.x + 72, y: center.y });
  run(120);
  expect(dock.preview).toBe(9);
  pointer(1, KEY_DOCK_SLOT, { x: center.x + 72, y: center.y - 100 });
  run();
  expect(selected).toEqual([]);
  pointer(0, KEY_DOCK_SLOT, center);
  pointer(1, KEY_DOCK_SLOT, { x: center.x + 72, y: center.y });
  run();
  expect(selected).toEqual([9]);
});

test("The touch menu eases out as a whole wheel and the two rims are painted glass", () => {
  const { app, run, tap, point } = survivor(true);
  const f = app.ui.frame;
  const painted = f.nodes.slice(0, f.count).filter(n => n.kind === K_IMAGE && f.images[n.image]?.paint).map(n => n.image);
  expect(new Set(painted).size).toBeGreaterThanOrEqual(3);
  const disc = () => f.nodes.slice(0, f.count).find(n => n.label === "Turn the menu wheel" && n.round)!;
  tap(KEY_FIELD_HUB);
  const opening = disc().x;
  run(600);
  const open = point(KEY_FIELD_HUB);
  expect(opening).toBeLessThan(disc().x - 10);
  expect(disc().x).toBeGreaterThanOrEqual(f.left);
  const stations = Array.from({ length: 7 }, (_, i) => point(KEY_FIELD_LEAF + i));
  expect(stations.some(p => p.x < open.x)).toBe(true);
  expect(stations.some(p => p.x > open.x)).toBe(true);
});

test("A thumb anywhere on the wheel's glass turns it, and the move stick never takes that press", () => {
  const { app, run, tap, point, pointer, dock } = survivor(true);
  const f = app.ui.frame;
  tap(KEY_FIELD_HUB); run(600);
  const disc = f.nodes.slice(0, f.count).find(n => n.label === "Turn the menu wheel")!;
  expect(disc.round && disc.interactive).toBe(true);
  expect(f.nodes.indexOf(disc)).toBeGreaterThan(f.nodes.indexOf(f.find(KEY_ZONE_MOVE)!));
  const hub = point(KEY_FIELD_HUB), first = point(KEY_FIELD_LEAF);
  // Between two stations, on bare glass, a quarter turn about the hub.
  const r = Math.hypot(first.x - hub.x, first.y - hub.y), from = { x: hub.x + r * Math.cos(.4), y: hub.y + r * Math.sin(.4) };
  pointer(0, disc.key, from);
  for (let a = .4; a <= 1.3; a += .1) pointer(2, disc.key, { x: hub.x + r * Math.cos(a), y: hub.y + r * Math.sin(a) });
  run(400);
  expect(dock.page).toBe("emblem");
  expect(app.touch.stick).toBe(false);
  expect(point(KEY_FIELD_LEAF).y).toBeGreaterThan(first.y + 20);
  pointer(3, disc.key, from); run(400);
  expect(dock.isOpen()).toBe(false);
});

test("A swipe up the shut rim turns the wheel and letting go opens what it stopped on", () => {
  const { app, run, point, pointer, dock } = survivor(true);
  const f = app.ui.frame;
  const from = { x: f.left + 20, y: point(KEY_FIELD_HUB).y };
  pointer(0, KEY_FIELD_HUB, from);
  for (let dy = 10; dy <= 60; dy += 10) pointer(2, KEY_FIELD_HUB, { x: from.x, y: from.y - dy });
  run(300);
  expect(dock.page).toBe("emblem");
  expect(app.ui.screen("character").isOpen()).toBe(false);
  pointer(1, KEY_FIELD_HUB, { x: from.x, y: from.y - 60 }); run(300);
  expect(dock.isOpen()).toBe(false);
  const open = app.ui.screens.filter(s => s.name !== "dock" && s.isOpen()).map(s => s.name);
  expect(open.length).toBe(1);
});

test("A family's leaves fan out beside it and a swipe along them changes the one in reach", () => {
  const { app, run, tap, pull, point, pointer, dock, pressed } = survivor(true);
  const f = app.ui.frame, names = () => f.nodes.slice(0, f.count).filter(n => n.style !== 0 && n.text).map(n => n.text);
  pull(); tap(KEY_FIELD_HUB + 3); run(400);
  tap(KEY_FIELD_LEAF + 3); run(400);
  expect(dock.page).toBe("gestures");
  expect(names()).toContain("Wave");
  const leaf = point(KEY_FIELD_LEAF);
  pointer(0, KEY_FIELD_LEAF, leaf);
  pointer(2, KEY_FIELD_LEAF, { x: leaf.x, y: leaf.y - 70 });
  pointer(1, KEY_FIELD_LEAF, { x: leaf.x, y: leaf.y - 70 });
  run(400);
  expect(dock.page).toBe("gestures");
  expect(pressed).toEqual([]);
  expect(names()).toContain("Point");
});

test("The corner help opens touch controls and Back returns to the field", () => {
  const { app, run, tap } = survivor(true);
  const menu = app.ui.screen<MenuScreen>("menu"), frame = app.ui.frame;
  const icon = frame.find(KEY_TOUCH_HELP)!;
  expect(icon.label).toBe("Touch controls");
  expect(icon.w * frame.unit).toBeCloseTo(44);
  tap(KEY_TOUCH_HELP);
  expect(menu.help && menu.helpDevice === 2).toBe(true);
  expect(frame.find(KEY_TOUCH_HELP)).toBeNull();
  tap(KEY_MENU_BACK);
  expect(menu.isOpen()).toBe(false);
  expect(frame.find(KEY_DOCK_SLOT)).not.toBeNull();
  app.ui.settings.playControls = true;
  run();
  expect(frame.find(KEY_TOUCH_HELP)).toBeNull();
  expect(survivor().app.ui.frame.find(KEY_TOUCH_HELP)).toBeNull();
});

test("The moves' glyphs are the touch sheet's own", () => {
  const { app, pull } = survivor(true);
  pull();
  const f = app.ui.frame, cell = (which: number) => [which % 12 * 128, 400 + Math.floor(which / 12) * 128].join();
  const drawn = new Set(f.nodes.slice(0, f.count).filter(n => n.kind === K_IMAGE && n.image === IMAGE_TOUCH).map(n => [n.sx, n.sy].join()));
  // Three leaves show at a time: the jump, its neighbours either side, and no stranger.
  for (const which of [I_JUMP, I_CROUCH, I_VIEW]) expect(drawn.has(cell(which))).toBe(true);
  expect([I_PRONE, I_RELOAD, I_MELEE].every(which => which > 0 && which < 48)).toBe(true);
});
