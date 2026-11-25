import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_HOTBAR } from "../../client/core/hud/hotbar.ts";
import { KEY_FIELD_HUB, KEY_FIELD_LEAF } from "../../client/core/ui/field-dock.ts";
import { KEY_CONSOLE_INPUT } from "../../client/core/ui/console.ts";
import { TAB_MAKE, type CharacterScreen } from "../../client/core/ui/character.ts";
import * as touch from "../../client/core/ui/touch.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
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
  return { h, app, run, point, pointer, tap };
}

test("The field kit uses the current berry stack only after a command", () => {
  const { app, h, run, tap } = survivor();
  for (const line of ["enablecheats", "give berry 5"]) {
    app.key("Backquote", true); app.textInput(KEY_CONSOLE_INPUT,line);
    app.key("Enter", true); app.key("Backquote", true); run(260);
  }
  const rec = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  h.host.survival.add(rec,V_FOOD,-30);
  const inv = h.host.items.inv(rec), berries = inv.item.indexOf(h.reg.index.get("core:berry")!);
  const before = h.host.survival.value(rec,V_FOOD);
  tap(KEY_FIELD_HUB+4);
  expect(app.ui.dock.page).toBe("kit");
  expect(inv.count[berries]).toBe(5);
  tap(KEY_FIELD_LEAF);
  expect(app.ui.dock.page).toBe("kit");
  expect(inv.count[berries]).toBe(5);
  tap(KEY_FIELD_LEAF+1);
  run(350);
  expect(app.ui.dock.open).toBe(false);
  expect(inv.count[berries]).toBe(4);
  expect(h.host.survival.value(rec,V_FOOD)).toBeGreaterThan(before+1);
});

test("Craft opens the live crafting page and tray browsing issues no order", () => {
  const { app, run, tap } = survivor();
  tap(KEY_FIELD_HUB+2);
  const character = app.ui.screen<CharacterScreen>("character");
  expect(character.isOpen()).toBe(true);
  expect(character.tab).toBe(TAB_MAKE);
  app.key("Escape",true); run();
  app.key("F4",true); run();
  expect(app.ui.dock.page).toBe("actions");
  app.key("Enter",true); run();
  expect(app.ui.dock.page).toBe("whistles");
  app.key("ArrowRight",true); run();
  expect(app.ui.dock.page).toBe("whistles");
  app.key("Escape",true); run();
  expect(app.ui.dock.page).toBe("actions");
});

test("A cancelled dock slide preserves equipment and a second finger cannot equip", () => {
  const { app, run, point, pointer } = survivor(true);
  const slots: number[] = [];
  app.ui.dispatchDock = action => { if (typeof action === "number") slots.push(action); };
  const key = KEY_HOTBAR, last = point(KEY_HOTBAR+21);
  pointer(0,key);
  pointer(2,key,last);
  run(90);
  expect(app.ui.dock.preview).toBe(7);
  expect(app.ui.dock.scaleAt(7)).toBeGreaterThan(.5);
  expect(app.ui.dock.scaleAt(3)).toBe(0);
  pointer(1,key,last,2);
  expect(slots).toEqual([]);
  pointer(3,key,last); run();
  expect(app.ui.dock.preview).toBe(-1);
  expect(slots).toEqual([]);
  pointer(0,key); pointer(2,key,last); pointer(1,key,last); run();
  expect(slots).toEqual([7]);
});

test("A swipe browses an action family and an outward swipe returns one level", () => {
  const { app, run, tap, pointer, point } = survivor(true);
  const actions: unknown[] = [];
  app.ui.dispatchDock = action => actions.push(action);
  tap(KEY_FIELD_HUB+3);
  expect(app.ui.dock.page).toBe("actions");
  const first = point(KEY_FIELD_LEAF);
  pointer(0,KEY_FIELD_LEAF,first);
  pointer(1,KEY_FIELD_LEAF,{x:first.x-35,y:first.y});
  run();
  expect(app.ui.dock.page).toBe("whistles");
  expect(actions).toEqual([]);
  const follow = point(KEY_FIELD_LEAF);
  pointer(0,KEY_FIELD_LEAF,follow);
  pointer(1,KEY_FIELD_LEAF,{x:follow.x+35,y:follow.y});
  run();
  expect(app.ui.dock.page).toBe("actions");
  tap(KEY_FIELD_LEAF); tap(KEY_FIELD_LEAF+1);
  expect(actions).toEqual(["stay"]);
});

test("Pressing a command and releasing elsewhere leaves the order unissued", () => {
  const { app, tap, pointer, point } = survivor();
  const commands: unknown[] = [];
  app.ui.dispatchDock = action => commands.push(action);
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
  expect(commands).toEqual(["stay"]);
});
