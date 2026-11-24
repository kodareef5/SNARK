// The touch layer in a whole HUD: where its zones, cluster, bar and chat box stand at every phone and tablet window,
// either way up, and what two thumbs do with them. The windows and situations are built from the interface's models
// (kit `direct`); whole clients on the harness play through real input, pass the same checks, and show that what the
// models build is, node for node, what the app builds.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { VehicleTelemetry } from "../../client/core/hud.ts";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, KEY_ZONE_MOVE, T_AIM, T_ATTACK, T_BAG, T_CHARACTER, T_CHAT, T_CLOSE, T_CANCEL, T_DOWN, T_FOLLOW, T_FOLLOW_ONE, T_HOLD, T_JUMP, T_LOWER, T_MAP, T_MELEE, T_MENU, T_MIC, T_MORE, T_ORBIT, T_PACK, T_RAISE, T_RELOAD, T_ROLL, T_ROTATE, T_SHIFT, T_SIC, T_SNAP, T_STANCE, T_STAY, T_STAY_ONE, T_USE, T_VIEW, touchKey, type TouchTarget } from "../../client/core/touch.ts";
import { KEY_CHAT_INPUT, KEY_CHAT_PANEL, KEY_CHAT_ROW, KEY_CHAT_SEND, KEY_CHAT_TAG } from "../../client/core/ui/chat.ts";
import { TEXT_GLOBAL, TEXT_MOTD } from "../../shared/net/protocol.ts";
import { KEY_CONSOLE_INPUT } from "../../client/core/ui/console.ts";
import { KEY_HOTBAR, KEY_MINIMAP, KEY_PROMPT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { KEY_INV_ACTION, KEY_INV_HALF, KEY_INV_INFO, KEY_INV_SLOT, KEY_INV_USE, type InventoryScreen } from "../../client/core/ui/inventory.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { KEY_MENU, KEY_UNMUTE } from "../../client/core/ui/menu.ts";
import { KEY_MAP_IMAGE } from "../../client/core/ui/screens.ts";
import { K_HOLD, MIN_WIDTH, SCALE_FLOOR, textWidth, type UiFrame } from "../../client/core/ui/nodes.ts";
import type { Ui } from "../../client/core/ui/ui.ts";
import { BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_SPRINT } from "../../shared/sim/character.ts";
import type { CharacterScreen } from "../../client/core/ui/character.ts";
import { Harness, asShipped } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { PHONES, camp, direct, nodes, screen, stood, vehicle, type Direct, type Phone, type Stood } from "../kit/kit.ts";
import type { MenuScreen } from "../../client/core/ui/menu-screen.ts";
// The touch layer's layout, which a page fetches when a finger is first used; here it is at hand.
import * as layout from "../../client/core/ui/touch.ts";

const pack = corePack();

/** A phone's client: the last thing used was a finger. */
function phone(h: Harness, name: string): App {
  const app = new App(h.join(name, { latencyMs: 20 }, { manual: true }), h.reg, pack);
  app.ui.inputDevice = 2;
  app.ui.layer = layout;
  return app;
}

/** A phone's interface at a window, from models. `like` is a client whose level line it shows too. */
function touched([, w, h, insets]: Phone, muted: boolean, as?: Stood, like?: App): Direct {
  const d = direct(w, h, insets, { finger: true, as });
  d.ui.settings.muted = muted;
  if (like) Object.assign(d.hud.levelBar, like.hud.levelBar);
  return d;
}

/** A frame's nodes and where they stand, whatever their words. */
const boxes = (f: UiFrame): string[] => f.nodes.slice(0, f.count).map((n) => [n.key, n.kind, n.x, n.y, n.w, n.h, n.interactive].join(" "));

/** The layer with a full hand fits the window: inside the screen's edges, finger-sized, nothing stacked. */
function layerFits(ui: Ui, [, w, h, insets]: Phone, muted: boolean, where: string): void {
  const f = ui.frame;
  // Never drawn smaller than the floor, and never wider than the window: a phone upright is narrower than 9 to 16.
  expect(h / f.height, where).toBeGreaterThanOrEqual(Math.min(SCALE_FLOOR, w / MIN_WIDTH) - 0.01);
  expect(f.width * (h / f.height), where).toBeLessThanOrEqual(w + 1);
  const unit = h / f.height, [l, t, r, b] = insets.map((v) => v / unit) as [number, number, number, number];
  for (const which of [T_ATTACK, T_JUMP, T_STANCE, T_USE, T_MENU, T_BAG, T_CHARACTER, T_CHAT, T_MAP]) expect(f.find(KEY_TOUCH_BUTTON + which), `${where}: button ${which}`).not.toBeNull();
  expect(ui.touchShown & (1 << T_ATTACK), where).toBeGreaterThan(0);
  expect(f.find(KEY_UNMUTE) !== null, where).toBe(muted);
  // The zones lie under everything, and cover the canvas between them.
  const move = f.find(KEY_ZONE_MOVE)!, look = f.find(KEY_ZONE_LOOK)!;
  expect([f.nodes[0]!.key, f.nodes[1]!.key, move.x, move.w, look.x + look.w, move.h, look.h], where).toEqual([KEY_ZONE_MOVE, KEY_ZONE_LOOK, 0, look.x, f.width, f.height, f.height]);
  const controls = f.nodes.slice(0, f.count).filter((n) => n.interactive && n.key !== KEY_ZONE_MOVE && n.key !== KEY_ZONE_LOOK);
  for (const n of controls) {
    const at = `${where}: key ${n.key} "${n.label}"`;
    expect(n.x, at).toBeGreaterThanOrEqual(l - 0.01);
    expect(n.y, at).toBeGreaterThanOrEqual(t - 0.01);
    expect(n.x + n.w, at).toBeLessThanOrEqual(f.width - r + 0.01);
    expect(n.y + n.h, at).toBeLessThanOrEqual(f.height - b + 0.01);
    if (n.kind === K_HOLD) expect(Math.min(n.w, n.h), at).toBeGreaterThanOrEqual(44);
    if (n.text) expect(textWidth(n.text, n.style), at).toBeLessThanOrEqual(n.w + 0.01);
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const p = controls[i]!, q = controls[j]!;
    expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${where}: ${p.key} "${p.label}" over ${q.key} "${q.label}"`).toBe(false);
  }
  // The prompt is offered without its key, the vitals stand clear of the thumbs, and the minimap and hotbar are there.
  expect(f.find(KEY_PROMPT)!.text.startsWith("ride a raptor"), where).toBe(true);
  expect(f.find(KEY_VITAL + 1)!.y, where).toBeLessThan(f.height / 3);
  // The cluster is an arc about Attack in the corner: each of the rest is a finger's gap clear of it and of its neighbours.
  const middle = (which: number): [number, number, number] => { const n = f.find(KEY_TOUCH_BUTTON + which)!; return [n.x + n.w / 2, n.y + n.h / 2, n.w / 2]; };
  const around = [T_JUMP, T_STANCE, T_AIM, T_RELOAD, T_MORE, T_ATTACK].map(middle);
  for (let i = 0; i < around.length; i++) for (let j = i + 1; j < around.length; j++) expect(Math.hypot(around[i]![0] - around[j]![0], around[i]![1] - around[j]![1]) - around[i]![2] - around[j]![2], `${where}: buttons ${i} and ${j}`).toBeGreaterThanOrEqual(3.9);
  const attack = f.find(KEY_TOUCH_BUTTON + T_ATTACK)!;
  expect(attack.x + attack.w, where).toBeCloseTo(f.width - r - 12, 5);
  // What shares an edge shares it exactly: the bar, the vitals' glass or the unmute offer on the left; Attack and the pill on the right.
  const menu = f.find(KEY_TOUCH_BUTTON + T_MENU)!, use = f.find(KEY_TOUCH_BUTTON + T_USE)!;
  expect(menu.x, where).toBeCloseTo(l + 12, 5);
  if (muted) expect(f.find(KEY_UNMUTE)!.x, where).toBeCloseTo(menu.x, 5);
  if (use.y < attack.y - 100) expect(use.x + use.w, where).toBeCloseTo(attack.x + attack.w, 5);
  expect(f.find(KEY_MINIMAP) !== null && f.find(KEY_HOTBAR) !== null, where).toBe(true);
}

/** A situation's cluster fits the window: the buttons it has and lacks, inside the edges, a finger's gap apart. */
function clusterFits(ui: Ui, [, , h, insets]: Phone, has: readonly number[], lacks: readonly number[], where: string): void {
  const f = ui.frame, unit = h / f.height, [l, t, r, b] = insets.map((v) => v / unit) as [number, number, number, number];
  for (const k of has) expect(f.find(KEY_TOUCH_BUTTON + k), `${where}: button ${k}`).not.toBeNull();
  for (const k of lacks) expect(f.find(KEY_TOUCH_BUTTON + k), `${where}: button ${k}`).toBeNull();
  for (const k of has) expect(ui.touchShown & (1 << k), `${where}: bit ${k}`).not.toBe(0);
  const controls = f.nodes.slice(0, f.count).filter((n) => n.interactive && n.key !== KEY_ZONE_MOVE && n.key !== KEY_ZONE_LOOK);
  for (const n of controls) {
    const at = `${where}: key ${n.key} "${n.label}"`;
    expect(n.x >= l - 0.01 && n.y >= t - 0.01 && n.x + n.w <= f.width - r + 0.01 && n.y + n.h <= f.height - b + 0.01, at).toBe(true);
    if (n.kind === K_HOLD) expect(Math.min(n.w, n.h), at).toBeGreaterThanOrEqual(44);
    if (n.text) expect(textWidth(n.text, n.style), at).toBeLessThanOrEqual(n.w + 0.01);
  }
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const p = controls[i]!, q = controls[j]!;
    expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${where}: ${p.key} "${p.label}" over ${q.key} "${q.label}"`).toBe(false);
  }
  // Round buttons keep a finger's gap between them.
  const round = has.map((k) => f.find(KEY_TOUCH_BUTTON + k)!).map((n) => [n.x + n.w / 2, n.y + n.h / 2, n.w / 2] as const);
  for (let i = 0; i < round.length; i++) for (let j = i + 1; j < round.length; j++) expect(Math.hypot(round[i]![0] - round[j]![0], round[i]![1] - round[j]![1]) - round[i]![2] - round[j]![2], `${where}: buttons ${has[i]} and ${has[j]}`).toBeGreaterThanOrEqual(3.9);
}

/** The second page's buttons, and those of the first that give way to them. */
const SECOND_PAGE = [[T_ATTACK, T_MORE, T_MELEE, T_VIEW, T_ORBIT, T_FOLLOW, T_STAY, T_SIC], [T_JUMP, T_STANCE, T_AIM, T_RELOAD]] as const;

/** The shut log's lines. */
const chatLog = (f: UiFrame): string[] => f.nodes.slice(0, f.count).filter((n) => n.key >= KEY_CHAT_ROW && n.key < KEY_CHAT_ROW + 14).map((n) => n.text);

/** The open chat box stands at the top, a finger's size, inside the edges, its way out clear of it. */
function chatBoxFits(f: UiFrame, [name, , hh, insets]: Phone): void {
  const field = f.find(KEY_CHAT_INPUT)!, send = f.find(KEY_CHAT_SEND)!, tag = f.find(KEY_CHAT_TAG)!, unit = hh / f.height;
  expect(field.focus, name).toBe(true);
  // The field is in the top half of the screen with room to spare, a finger's height, inside the screen's edges, beside its buttons.
  expect((field.y + field.h) * unit, name).toBeLessThan(hh * 0.45);
  expect(Math.min(field.h, send.h, tag.h), name).toBeGreaterThanOrEqual(44);
  expect(tag.x >= insets[0]! / unit && send.x + send.w <= f.width - insets[2]! / unit, name).toBe(true);
  expect(tag.x + tag.w <= field.x && field.x + field.w <= send.x, name).toBe(true);
  expect(textWidth(send.text, send.style), name).toBeLessThanOrEqual(send.w);
  // The way out is there, and covers neither the field nor its buttons.
  const close = f.find(KEY_TOUCH_BUTTON + T_CLOSE)!;
  for (const n of [field, send, tag]) expect(close.x < n.x + n.w && n.x < close.x + close.w && close.y < n.y + n.h && n.y < close.y + close.h, name).toBe(false);
}

test("the touch layer fits every phone and tablet, either way up", () => {
  for (const window of PHONES) for (const muted of [true, false]) {
    const d = touched(window, muted);
    // What a full hand shows: a weapon loaded, something to use, ten slots.
    d.hud.prompt = "E  ride a raptor with a long name";
    d.hud.ammo = "stone arrow  1 / 1   (24 more)";
    d.hud.cone = 0.05;
    d.build();
    layerFits(d.ui, window, muted, `${window[0]}${muted ? ", muted" : ""}`);
  }
});

test("two thumbs play: the stick walks and sprints, a drag turns, Attack strikes, Jump jumps, and the bar opens the screens", () => {
  const h = new Harness(), app = phone(h, "thumbs");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 844, 390));
  run(600);
  const f = app.ui.frame, z = app.session.own.z;
  // Forward on the stick, to its rim: the body walks north and sprints.
  app.pointer(0, KEY_ZONE_MOVE, 150, 350, 0, 1);
  app.pointer(2, KEY_ZONE_MOVE, 150, 280, 0, 1);
  expect([app.controls.moveZ, app.controls.moveX, app.controls.buttons & BTN_SPRINT]).toEqual([1, 0, BTN_SPRINT]);
  run(500);
  expect(app.session.own.z).toBeGreaterThan(z + 1);
  // The other thumb turns the view while the first still walks.
  const yaw = app.controls.yaw;
  app.pointer(0, KEY_ZONE_LOOK, 700, 200, 0, 2);
  app.pointer(2, KEY_ZONE_LOOK, 760, 180, 0, 2);
  expect(app.controls.yaw).toBeLessThan(yaw - 0.2);
  expect(app.controls.pitch).toBeGreaterThan(0);
  expect(app.controls.moveZ).toBe(1);
  app.pointer(1, KEY_ZONE_LOOK, 760, 180, 0, 2);
  app.pointer(1, KEY_ZONE_MOVE, 150, 280, 0, 1);
  expect([app.controls.moveZ, app.controls.buttons]).toEqual([0, 0]);
  // Attack and Jump are held while a finger is on them, and the glass lights.
  // Nodes are reused by place in the list from frame to frame, so the keys are copied before frames are run.
  const attack = f.find(KEY_TOUCH_BUTTON + T_ATTACK)!, jump = f.find(KEY_TOUCH_BUTTON + T_JUMP)!;
  const [attackKey, jumpKey] = [attack.key, jump.key];
  app.pointer(0, attackKey, attack.x + 5, attack.y + 5, 0, 3);
  app.pointer(0, jumpKey, jump.x + 5, jump.y + 5, 0, 4);
  expect(app.controls.buttons).toBe(BTN_PRIMARY | BTN_JUMP);
  run(50);
  expect(app.touch.held(T_ATTACK)).toBe(true);
  app.pointer(1, attackKey, 0, 0, 0, 3);
  app.pointer(1, jumpKey, 0, 0, 0, 4);
  expect(app.controls.buttons).toBe(0);
  // The bag: its screen opens, and the zones and the cluster give way to it.
  app.pointer(0, KEY_TOUCH_BUTTON + T_BAG, 0, 0, 0, 3);
  app.pointer(1, KEY_TOUCH_BUTTON + T_BAG, 0, 0, 0, 3);
  run(50);
  expect([app.ui.screen<InventoryScreen>("inventory").open, f.find(KEY_ZONE_MOVE), f.find(KEY_TOUCH_BUTTON + T_ATTACK)]).toEqual([true, null, null]);
  // Each screen has a way out in the corner that covers none of its own controls, on every phone.
  for (const [button, open] of [[T_BAG, () => app.ui.screen<InventoryScreen>("inventory").open], [T_CHARACTER, () => app.ui.screen<CharacterScreen>("character").open], [T_MAP, () => app.ui.opened("map")]] as const) for (const [name, w, hh] of PHONES) {
    if (!open()) { app.key(button === T_CHARACTER ? "KeyP" : button === T_MAP ? "KeyM" : "KeyI", true, false, 2); h.run(50, (now) => app.frame(now, w, hh)); }
    h.run(50, (now) => app.frame(now, w, hh));
    const close = f.find(KEY_TOUCH_BUTTON + T_CLOSE)!, where = `${name}, screen ${button}`;
    expect([open(), close !== null], where).toEqual([true, true]);
    for (const n of f.nodes.slice(0, f.count)) if (n !== close && n.interactive) expect(close.x < n.x + n.w && n.x < close.x + close.w && close.y < n.y + n.h && n.y < close.y + close.h, `${where}: over ${n.key} "${n.label}"`).toBe(false);
  }
  app.pointer(0, KEY_TOUCH_BUTTON + T_CLOSE, 0, 0, 0, 3);
  app.pointer(1, KEY_TOUCH_BUTTON + T_CLOSE, 0, 0, 0, 3);
  run(50);
  expect([app.ui.opened("map"), app.ui.screen<InventoryScreen>("inventory").open, app.ui.screen<CharacterScreen>("character").open, f.find(KEY_TOUCH_BUTTON + T_CLOSE)]).toEqual([false, false, false, null]);
  expect(f.find(KEY_ZONE_MOVE)).not.toBeNull();
  // The menu: everything held is let go, and the layer is gone until it is resumed.
  app.pointer(0, KEY_ZONE_MOVE, 150, 350, 0, 1);
  app.pointer(2, KEY_ZONE_MOVE, 150, 300, 0, 1);
  app.pointer(0, KEY_TOUCH_BUTTON + T_MENU, 0, 0, 0, 3);
  app.pointer(1, KEY_TOUCH_BUTTON + T_MENU, 0, 0, 0, 3);
  run(50);
  expect([app.ui.screen<MenuScreen>("menu").menu, app.controls.moveZ, app.touch.stick, f.find(KEY_ZONE_MOVE), f.find(KEY_MENU) !== null]).toEqual([true, 0, false, null, true]);
});

test("the layer follows the last thing used: a key or a pad's stick puts it away, and a finger brings it back", () => {
  const h = new Harness(), app = new App(h.join("hybrid", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  app.ui.layer = layout;
  let last = 0;
  const run = (ms: number) => h.run(ms, (now) => void app.frame((last = now), 1280, 720));
  run(600);
  const f = app.ui.frame, shown = (): boolean => f.find(KEY_ZONE_MOVE) !== null;
  expect([app.ui.touch, shown(), f.find(KEY_TOUCH_BUTTON + T_MENU)]).toEqual([false, false, null]);
  // A finger on anything the interface has.
  app.pointer(0, KEY_HOTBAR, 0, 0, 0, 1);
  run(50);
  expect([app.ui.touch, shown()]).toEqual([true, true]);
  app.key("KeyW", true); app.key("KeyW", false);
  run(50);
  expect([app.ui.touch, shown()]).toEqual([false, false]);
  app.pointer(0, KEY_HOTBAR, 0, 0, 0, 1);
  run(50);
  app.gamepads([{ connected: true, mapping: "standard", axes: [0, -1, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }], last + 16);
  run(50);
  expect([app.ui.inputDevice, shown()]).toEqual([1, false]);
  // A mouse pointer on a button is not a finger.
  app.pointer(0, KEY_HOTBAR, 0, 0, 0, 0);
  run(50);
  expect(shown()).toBe(false);
});

test("the bag by touch: a stack picked up is used with Use, and Half puts down half of it", () => {
  const h = new Harness({}, 1, 60, { dev: true }), app = phone(h, "bag");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 844, 390));
  run(500);
  for (const line of ["enablecheats", "give stone 150", "give berry 5"]) {
    app.key("Backquote", true); app.textInput(KEY_CONSOLE_INPUT, line); app.key("Enter", true); app.key("Backquote", true);
    run(300);
  }
  const rec = h.host.records.byPid.get(h.client(app.session)!.pid)!, inv = h.host.items.inv(rec);
  h.host.survival.add(rec, V_FOOD, -30);
  // A finger, after the keys that typed the cheats: the bar's Bag opens the screen.
  const press = (key: number): void => { app.pointer(0, key, 0, 0, 0, 1); app.pointer(1, key, 0, 0, 0, 1); run(60); };
  press(KEY_HOTBAR);
  press(KEY_TOUCH_BUTTON + T_BAG);
  const f = app.ui.frame, slot = (s: number): number => KEY_INV_SLOT + s * 3;
  expect([app.ui.screen<InventoryScreen>("inventory").open, f.find(KEY_INV_USE) !== null, f.find(KEY_INV_HALF)!.text, f.find(KEY_INV_INFO)!.text]).toEqual([true, true, "Half", "press a stack to pick it up"]);
  // The row's six buttons stand side by side, with their words whole.
  const row = [KEY_INV_USE, KEY_INV_HALF, KEY_INV_ACTION, KEY_INV_ACTION + 3].map((k) => f.find(k)!);
  for (let i = 1; i < row.length; i++) expect(row[i]!.x).toBeGreaterThanOrEqual(row[i - 1]!.x + row[i - 1]!.w);
  for (const b of row) expect(textWidth(b.text, b.style)).toBeLessThanOrEqual(b.w);
  // Eat a berry: pick the stack up, then Use.
  const berries = app.session.inventory!.item.indexOf(h.reg.index.get("core:berry")!), food = h.host.survival.value(rec, V_FOOD);
  press(slot(berries));
  expect(app.ui.screen<InventoryScreen>("inventory").held).toBe(berries);
  press(KEY_INV_USE);
  run(300);
  expect([inv.count[berries], app.ui.screen<InventoryScreen>("inventory").held]).toEqual([4, -1]);
  expect(h.host.survival.value(rec, V_FOOD)).toBeGreaterThan(food + 1.4);
  // Half of the hundred stones to an empty slot.
  const stones = app.session.inventory!.item.indexOf(h.reg.index.get("core:stone")!), empty = app.session.inventory!.item.indexOf(0, 12);
  expect(inv.count[stones]).toBe(100);
  press(slot(stones));
  press(KEY_INV_HALF);
  expect(f.find(KEY_INV_HALF)!.label).toBe("Half of the stack will be put down");
  press(slot(empty));
  run(300);
  expect([inv.count[stones], inv.count[empty]]).toEqual([50, 50]);
  // Nothing picked up, Use and Half do nothing.
  press(KEY_INV_USE); press(KEY_INV_HALF);
  expect(app.ui.screen<InventoryScreen>("inventory").held).toBe(-1);
  // A mouse's screen has no such buttons, and its hint names its buttons.
  app.key("KeyW", true); app.key("KeyW", false);
  run(60);
  expect([f.find(KEY_INV_USE), f.find(KEY_INV_HALF), f.find(KEY_INV_INFO)!.text.startsWith("left click")]).toEqual([null, null, true]);
});

test("each situation has its own cluster on the same arcs, at every window", () => {
  const helm = (boat: boolean, rotor: boolean, more: object = {}) => (d: Direct): void => { d.hud.vehicle = Object.assign(new VehicleTelemetry(), { active: true, rotor, boat }, more); };
  const SITUATIONS: [string, (d: Direct) => void, readonly number[], readonly number[]][] = [
    ["the second page", (d) => { d.ui.touchPlay!.more = true; }, ...SECOND_PAGE],
    ["building", (d) => { d.ui.building = true; }, [T_ATTACK, T_ROTATE, T_RELOAD, T_SNAP, T_RAISE, T_LOWER], [T_JUMP, T_STANCE, T_MORE]],
    ["placing a vehicle", (d) => { d.ui.placing = true; }, [T_ATTACK, T_ROTATE, T_SNAP, T_CANCEL], [T_JUMP, T_STANCE, T_MORE, T_RAISE]],
    ["a flyer", (d) => { d.ui.flyer = true; }, [T_ATTACK, T_JUMP, T_ROLL, T_HOLD, T_MORE], [T_STANCE, T_AIM]],
    ["a car", helm(false, false, { lightMode: 0 }), [T_JUMP, T_VIEW, T_ORBIT], [T_ATTACK, T_STANCE, T_MORE]],
    ["a skateboard", helm(false, false, { board: true }), [T_JUMP, T_RELOAD, T_MELEE, T_SHIFT, T_HOLD, T_ROLL, T_SNAP], [T_ATTACK, T_STANCE, T_MORE]],
    ["a boat", helm(true, false), [T_JUMP, T_SHIFT, T_VIEW], [T_ATTACK, T_STANCE, T_MORE]],
    ["a helicopter", helm(false, true), [T_JUMP, T_DOWN, T_SNAP, T_RELOAD, T_ROLL, T_HOLD, T_SHIFT, T_VIEW], [T_ATTACK, T_STANCE, T_MORE]],
  ];
  for (const [what, set, has, lacks] of SITUATIONS) for (const window of PHONES) {
    const d = touched(window, false);
    d.hud.prompt = "E  exit vehicle";
    set(d);
    d.build();
    clusterFits(d.ui, window, has, lacks, `${what}, ${window[0]}`);
  }
});

test("More turns the cluster's page and back, a way of going is held on by its button, and the stick's rim sprints only on foot", () => {
  const h = new Harness(), app = phone(h, "pages");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 844, 390));
  const press = (which: number): void => { app.pointer(0, KEY_TOUCH_BUTTON + which, 0, 0, 0, 2); app.pointer(1, KEY_TOUCH_BUTTON + which, 0, 0, 0, 2); run(50); };
  run(600);
  const f = app.ui.frame, has = (which: number): boolean => f.find(KEY_TOUCH_BUTTON + which) !== null;
  expect([has(T_JUMP), has(T_MELEE)]).toEqual([true, false]);
  press(T_MORE);
  expect([has(T_JUMP), has(T_MELEE), has(T_VIEW), f.find(KEY_TOUCH_BUTTON + T_MORE)!.label]).toEqual([false, true, true, "Back"]);
  // A blow by hand is held as long as the finger is.
  app.pointer(0, KEY_TOUCH_BUTTON + T_MELEE, 0, 0, 0, 2);
  expect(app.controls.buttons & BTN_MELEE).toBe(BTN_MELEE);
  app.pointer(1, KEY_TOUCH_BUTTON + T_MELEE, 0, 0, 0, 2);
  expect(app.controls.buttons).toBe(0);
  press(T_MORE);
  expect([has(T_JUMP), has(T_MELEE)]).toEqual([true, false]);
  // On foot the rim sprints.
  app.pointer(0, KEY_ZONE_MOVE, 150, 350, 0, 1);
  app.pointer(2, KEY_ZONE_MOVE, 150, 280, 0, 1);
  expect(app.controls.buttons & BTN_SPRINT).toBe(BTN_SPRINT);
  app.pointer(1, KEY_ZONE_MOVE, 150, 280, 0, 1);
  // At a helm it does not, and Precision holds Shift from one press to the next; leaving the helm lets it go.
  Object.assign(app.vehicleTelemetry, { active: true, rotor: false, boat: true });
  Object.assign(app.hud, { vehicle: app.vehicleTelemetry });
  app.ui.build(844 / 390, app.hud, app.session);
  expect([has(T_SHIFT), app.touch.rim]).toEqual([true, false]);
  app.pointer(0, KEY_ZONE_MOVE, 150, 350, 0, 1);
  app.pointer(2, KEY_ZONE_MOVE, 150, 280, 0, 1);
  expect([app.controls.moveZ, app.controls.buttons & BTN_SPRINT]).toEqual([1, 0]);
  app.pointer(1, KEY_ZONE_MOVE, 150, 280, 0, 1);
  app.pointer(0, KEY_TOUCH_BUTTON + T_SHIFT, 0, 0, 0, 2);
  app.pointer(1, KEY_TOUCH_BUTTON + T_SHIFT, 0, 0, 0, 2);
  expect([app.touch.shifted, app.controls.buttons & BTN_SPRINT]).toEqual([true, BTN_SPRINT]);
  app.vehicleTelemetry.stop();
  run(100);
  expect([app.touch.shifted, app.controls.buttons & BTN_SPRINT, has(T_SHIFT)]).toEqual([false, 0, false]);
});

test("chat by touch: the welcome is a shut line; the box opens at the top", () => {
  for (const window of PHONES) {
    const [name] = window, d = touched(window, true), f = d.ui.frame;
    const tap = (button: number): void => { d.ui.key(touchKey(button)!, true, false, d.session); d.ui.key(touchKey(button)!, false, false, d.session); d.build(); };
    d.ui.chat.print(TEXT_MOTD, "Welcome to SNARK. Type /help", 0, 600);
    d.build();
    expect([chatLog(f), f.find(KEY_CHAT_PANEL)], name).toEqual([["Welcome to SNARK. Type /help"], null]);
    expect([d.ui.typing, f.find(KEY_CHAT_SEND)], name).toEqual([false, null]);
    // The bar's Chat is the Enter key.
    tap(T_CHAT);
    expect([d.ui.chat.open, d.ui.typing], name).toEqual([true, true]);
    chatBoxFits(f, window);
    d.ui.input(KEY_CHAT_INPUT, "anyone near the docks?");
    d.ui.pointer(0, KEY_CHAT_SEND, 0, 0, 0, d.session);
    d.build();
    expect([d.ui.chat.open, d.ui.typing, f.find(KEY_CHAT_SEND)], name).toEqual([false, false, null]);
    // Shut, the log is back where it was, low on the left, and the layer is back with it.
    expect(f.find(KEY_ZONE_MOVE), name).not.toBeNull();
  }
});

test("a whole client's chat by touch: the welcome, the box, and Send says it", () => {
  const window = PHONES[3]!, [name, w, hh, insets] = window;
  const h = new Harness({}, 1, 60, { config: asShipped() }), app = phone(h, "talker");
  insets.forEach((v, i) => (app.insets[i] = v));
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, w, hh));
  const press = (key: number): void => { app.pointer(0, key, 0, 0, 0, 1); app.pointer(1, key, 0, 0, 0, 1); run(60); };
  run(600);
  const f = app.ui.frame;
  expect([chatLog(f), f.find(KEY_CHAT_PANEL)], name).toEqual([["Welcome to SNARK. Type /help"], null]);
  expect([app.ui.typing, f.find(KEY_CHAT_SEND)], name).toEqual([false, null]);
  press(KEY_TOUCH_BUTTON + T_CHAT);
  expect([app.ui.chat.open, app.ui.typing], name).toEqual([true, true]);
  chatBoxFits(f, window);
  app.textInput(KEY_CHAT_INPUT, "anyone near the docks?");
  press(KEY_CHAT_SEND);
  run(300);
  expect([app.ui.chat.open, app.ui.typing, f.find(KEY_CHAT_SEND)], name).toEqual([false, false, null]);
  expect(chatLog(f).join(" "), name).toContain("anyone near the docks?");
  expect(f.find(KEY_ZONE_MOVE), name).not.toBeNull();
});

test("the map by touch: a finger drags it, a tap looks there, and two fingers pinch its zoom a step at a time", () => {
  const h = new Harness(), app = phone(h, "mapper");
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, 844, 390));
  run(600);
  app.pointer(0, KEY_TOUCH_BUTTON + T_MAP, 0, 0, 0, 1); app.pointer(1, KEY_TOUCH_BUTTON + T_MAP, 0, 0, 0, 1);
  run(100);
  const f = app.ui.frame, chart = app.hud.chart!, map = f.find(KEY_MAP_IMAGE)!;
  expect([app.ui.opened("map"), map.interactive]).toEqual([true, true]);
  const cx = map.x + map.w / 2, cy = map.y + map.h / 2;
  // Zoomed in, so there is somewhere to go. Two fingers part: one step in; they close: one step out, and back in.
  const zoom = chart.fullZoom;
  app.pointer(0, KEY_MAP_IMAGE, cx - 40, cy, 0, 1);
  app.pointer(0, KEY_MAP_IMAGE, cx + 40, cy, 0, 2);
  app.pointer(2, KEY_MAP_IMAGE, cx + 80, cy, 0, 2);
  expect(chart.fullZoom).toBe(zoom + 1);
  app.pointer(2, KEY_MAP_IMAGE, cx + 85, cy, 0, 2);
  expect(chart.fullZoom).toBe(zoom + 1);
  app.pointer(2, KEY_MAP_IMAGE, cx + 20, cy, 0, 2);
  expect(chart.fullZoom).toBe(zoom);
  app.pointer(2, KEY_MAP_IMAGE, cx + 60, cy, 0, 2);
  expect(chart.fullZoom).toBe(zoom + 1);
  // Letting go of a pinch looks nowhere new.
  const [u0, v0] = [chart.fullU, chart.fullV];
  app.pointer(1, KEY_MAP_IMAGE, cx + 60, cy, 0, 2);
  app.pointer(1, KEY_MAP_IMAGE, cx - 40, cy, 0, 1);
  expect([chart.fullU, chart.fullV]).toEqual([u0, v0]);
  run(50);
  // One finger drags the map under it: to the right and down shows what was to the left and above.
  const view = chart.full.view;
  app.pointer(0, KEY_MAP_IMAGE, cx, cy, 0, 1);
  app.pointer(2, KEY_MAP_IMAGE, cx + 50, cy + 30, 0, 1);
  expect(chart.fullU).toBeCloseTo(u0 - (50 / map.w) * view.du, 6);
  expect(chart.fullV).toBeCloseTo(v0 - (30 / map.h) * view.dv, 6);
  app.pointer(1, KEY_MAP_IMAGE, cx + 50, cy + 30, 0, 1);
  expect(chart.fullU).toBeCloseTo(u0 - (50 / map.w) * view.du, 6);
  // A tap looks where it landed.
  run(50);
  const now = chart.full.view, tapU = now.u0 + 0.25 * now.du;
  app.pointer(0, KEY_MAP_IMAGE, map.x + map.w * 0.25, cy, 0, 1);
  app.pointer(1, KEY_MAP_IMAGE, map.x + map.w * 0.25, cy, 0, 1);
  expect(chart.fullU).toBeCloseTo(tapU, 6);
  // A mouse still looks where it clicks, at once.
  app.pointer(0, KEY_MAP_IMAGE, cx, cy, 0, 0);
  expect(chart.fullU).toBeCloseTo(app.hud.pointedU, 9);
});

test("with voice the bar has Talk; one creature is whistled to; chat stands under", () => {
  for (const window of PHONES) {
    const [name, , hh, insets] = window, d = touched(window, false), f = d.ui.frame;
    d.build();
    expect(f.find(KEY_TOUCH_BUTTON + T_MIC), name).toBeNull();
    // With voice: a fifth button in the bar, clear of the vitals, the minimap and the rest.
    d.ui.canTalk = true;
    d.build();
    const mic = f.find(KEY_TOUCH_BUTTON + T_MIC)!, unit = hh / f.height;
    expect(mic !== null && mic.x + mic.w <= f.width - insets[2]! / unit, name).toBe(true);
    const controls = f.nodes.slice(0, f.count).filter((n) => n.interactive && n.key !== KEY_ZONE_MOVE && n.key !== KEY_ZONE_LOOK);
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const p = controls[i]!, q = controls[j]!;
      expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${name}: ${p.key} "${p.label}" over ${q.key} "${q.label}"`).toBe(false);
    }
    // Held, it holds the talk key; let go, it lets it go.
    const keys: string[] = [], target: TouchTarget = { key: (code, down) => void keys.push(`${code} ${down}`), mouse() {}, move() {}, look() {} };
    d.ui.touchPlay!.pointer(0, KEY_TOUCH_BUTTON + T_MIC, 0, 0, 1, 0, target, unit);
    d.ui.touchPlay!.pointer(1, KEY_TOUCH_BUTTON + T_MIC, 0, 0, 1, 0, target, unit);
    expect(keys, name).toEqual(["KeyB true", "KeyB false"]);
    // The second page's whistles are to every creature that hears, or to the one looked at.
    d.ui.touchPlay!.more = true;
    d.build();
    expect([f.find(KEY_TOUCH_BUTTON + T_FOLLOW) !== null, f.find(KEY_TOUCH_BUTTON + T_FOLLOW_ONE)], name).toEqual([true, null]);
    d.ui.creatureAhead = true;
    d.build();
    expect([f.find(KEY_TOUCH_BUTTON + T_FOLLOW), f.find(KEY_TOUCH_BUTTON + T_FOLLOW_ONE)!.label, f.find(KEY_TOUCH_BUTTON + T_STAY_ONE)!.label], name).toEqual([null, "Whistle: this one follow", "Whistle: this one stay"]);
    // The chat box, open, starts under the bar and under the vitals where they stand under the bar.
    d.ui.touchPlay!.more = false;
    d.ui.chat.begin(TEXT_GLOBAL, d.session);
    d.build();
    const box = f.find(KEY_CHAT_PANEL)!, vital = f.find(KEY_VITAL + 1)!, field = f.find(KEY_CHAT_INPUT)!;
    expect(box.y, name).toBeGreaterThanOrEqual(f.top + 12 + 44);
    // Upright, under the vitals too; on its side the keyboard leaves no room for that, and the box may cover them.
    if (f.width < f.height && vital.y > f.top + 12 + 44) expect(box.y, name).toBeGreaterThanOrEqual(vital.y + vital.h - 6);
    expect((field.y + field.h) * unit, name).toBeLessThan(hh * 0.45);
  }
});

test("a whole client by touch builds what its models build", () => {
  const window = PHONES[0]!, [name, w, hh, insets] = window;
  const h = new Harness(), app = phone(h, "whole"), f = app.ui.frame;
  insets.forEach((v, i) => (app.insets[i] = v));
  app.ui.settings.muted = true;
  const run = (ms: number) => h.run(ms, (now) => app.frame(now, w, hh));
  run(600);
  // As it joined, it is the kit's new survivor: the same nodes in the same boxes.
  expect(boxes(touched(window, true, undefined, app).build())).toEqual(boxes(f));
  // A full hand, set on both models: the same frame, and it fits.
  const full = touched(window, true, stood(app), app);
  for (const hud of [app.hud, full.hud]) Object.assign(hud, { prompt: "E  ride a raptor with a long name", ammo: "stone arrow  1 / 1   (24 more)", cone: 0.05 });
  app.ui.build(w / hh, app.hud, app.session);
  layerFits(app.ui, window, true, name);
  expect(nodes(full.build())).toEqual(nodes(f));
  // A finger on More turns the page, and the frames after are those of a model whose page is turned.
  app.pointer(0, KEY_TOUCH_BUTTON + T_MORE, 0, 0, 0, 1);
  app.pointer(1, KEY_TOUCH_BUTTON + T_MORE, 0, 0, 0, 1);
  run(50);
  clusterFits(app.ui, window, ...SECOND_PAGE, name);
  const turned = touched(window, true, stood(app), app);
  turned.ui.touchPlay!.more = true;
  expect(nodes(turned.build())).toEqual(nodes(f));
  // Talk, held, talks.
  app.pointer(0, KEY_TOUCH_BUTTON + T_MIC, 0, 0, 0, 1);
  expect(app.talking).toBe(true);
  app.pointer(1, KEY_TOUCH_BUTTON + T_MIC, 0, 0, 0, 1);
  expect(app.talking).toBe(false);
});

test("a driver's cluster in a whole client is the one its models build", () => {
  const window = PHONES[7]!, [name, w, hh, insets] = window;
  const { h, ada } = camp({ screen: true }), view = screen(h, ada), app = view.app;
  app.ui.inputDevice = 2;
  app.ui.layer = layout;
  app.ui.settings.muted = false;
  insets.forEach((v, i) => (app.insets[i] = v));
  vehicle(h, ada, "compact", { drive: true });
  [view.width, view.height] = [w, hh];
  h.run(600);
  // A compact has no lights to switch, so its cluster has no button for them.
  clusterFits(app.ui, window, [T_JUMP, T_VIEW], [T_ATTACK, T_STANCE, T_MORE, T_ORBIT], name);
  const d = touched(window, false, stood(app), app);
  [d.hud.vehicle, d.hud.prompt] = [app.hud.vehicle, app.hud.prompt];
  expect(nodes(d.build())).toEqual(nodes(app.ui.frame));
});

test("a parked board offers separate ride and pickup targets on each phone", () => {
  for (const window of PHONES) {
    const d = touched(window, false);
    d.hud.prompt = "E  ride skateboard   F  pick up";
    d.build();
    clusterFits(d.ui, window, [T_PACK], [], window[0]);
    expect(d.ui.frame.find(KEY_TOUCH_BUTTON + T_USE)?.label).toBe("Ride skateboard");
  }
});
