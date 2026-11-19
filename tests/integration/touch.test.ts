import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, KEY_ZONE_MOVE, T_AIM, T_ATTACK, T_BAG, T_CHARACTER, T_CLOSE, T_CANCEL, T_DOWN, T_FOLLOW, T_HOLD, T_JUMP, T_LOWER, T_MAP, T_MELEE, T_MENU, T_MORE, T_ORBIT, T_RAISE, T_RELOAD, T_ROLL, T_ROTATE, T_SHIFT, T_SIC, T_SNAP, T_STANCE, T_STAY, T_USE, T_VIEW } from "../../client/core/touch.ts";
import { KEY_CONSOLE_INPUT } from "../../client/core/ui/console.ts";
import { KEY_HOTBAR, KEY_MINIMAP, KEY_PROMPT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { KEY_INV_ACTION, KEY_INV_HALF, KEY_INV_INFO, KEY_INV_SLOT, KEY_INV_USE } from "../../client/core/ui/inventory.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { KEY_MENU, KEY_UNMUTE } from "../../client/core/ui/menu.ts";
import { K_HOLD, MIN_WIDTH, SCALE_FLOOR, textWidth } from "../../client/core/ui/nodes.ts";
import { BTN_JUMP, BTN_MELEE, BTN_PRIMARY, BTN_SPRINT } from "../../shared/sim/character.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

/** A phone's client: the last thing used was a finger. */
function phone(h: Harness, name: string): App {
  const app = new App(h.join(name, { latencyMs: 20 }, { manual: true }), h.reg, pack);
  app.ui.inputDevice = 2;
  return app;
}

/** Window sizes in CSS pixels with the edges their screens take: left, top, right, bottom. */
const WINDOWS: [string, number, number, number[]][] = [
  ["a phone on its side", 844, 390, [47, 0, 47, 21]],
  ["a small phone on its side", 667, 375, [0, 0, 0, 0]],
  ["the smallest phone on its side", 568, 320, [0, 0, 0, 0]],
  ["a phone upright", 390, 844, [0, 47, 0, 34]],
  ["a small phone upright", 375, 667, [0, 20, 0, 0]],
  ["a tall narrow phone upright", 360, 800, [0, 32, 0, 24]],
  ["the smallest phone upright", 320, 568, [0, 20, 0, 0]],
  ["a tablet", 1024, 768, [0, 24, 0, 20]],
  ["a tablet upright", 768, 1024, [0, 24, 0, 20]],
];

test("the touch layer fits every phone and tablet, either way up: inside the screen's edges, finger-sized, nothing stacked", () => {
  for (const [name, w, h, insets] of WINDOWS) for (const muted of [true, false]) {
    const net = new Harness(), app = phone(net, "fit");
    insets.forEach((v, i) => (app.insets[i] = v));
    app.ui.settings.muted = muted;
    net.run(600, (now) => app.frame(now, w, h));
    // What a full hand shows: a weapon loaded, something to use, ten slots.
    const hud = app.hud;
    hud.prompt = "E  ride a raptor with a long name";
    hud.ammo = "stone arrow  1 / 1   (24 more)";
    hud.cone = 0.05;
    while (hud.hotbar.length < 10) hud.hotbar.push({ tint: -1, label: "", number: "" });
    app.ui.build(w / h, hud, app.session);
    const f = app.ui.frame, where = `${name}${muted ? ", muted" : ""}`;
    // Never drawn smaller than the floor, and never wider than the window: a phone upright is narrower than 9 to 16.
    expect(h / f.height, where).toBeGreaterThanOrEqual(Math.min(SCALE_FLOOR, w / MIN_WIDTH) - 0.01);
    expect(f.width * (h / f.height), where).toBeLessThanOrEqual(w + 1);
    const unit = h / f.height, [l, t, r, b] = insets.map((v) => v / unit) as [number, number, number, number];
    for (const which of [T_ATTACK, T_JUMP, T_STANCE, T_USE, T_MENU, T_BAG, T_CHARACTER, T_MAP]) expect(f.find(KEY_TOUCH_BUTTON + which), `${where}: button ${which}`).not.toBeNull();
    expect(app.ui.touchShown & (1 << T_ATTACK), where).toBeGreaterThan(0);
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
  const attack = f.find(KEY_TOUCH_BUTTON + T_ATTACK)!, jump = f.find(KEY_TOUCH_BUTTON + T_JUMP)!;
  app.pointer(0, attack.key, attack.x + 5, attack.y + 5, 0, 3);
  app.pointer(0, jump.key, jump.x + 5, jump.y + 5, 0, 4);
  expect(app.controls.buttons).toBe(BTN_PRIMARY | BTN_JUMP);
  run(50);
  expect(app.touch.held(T_ATTACK)).toBe(true);
  app.pointer(1, attack.key, 0, 0, 0, 3);
  app.pointer(1, jump.key, 0, 0, 0, 4);
  expect(app.controls.buttons).toBe(0);
  // The bag: its screen opens, and the zones and the cluster give way to it.
  app.pointer(0, KEY_TOUCH_BUTTON + T_BAG, 0, 0, 0, 3);
  app.pointer(1, KEY_TOUCH_BUTTON + T_BAG, 0, 0, 0, 3);
  run(50);
  expect([app.ui.inventory.open, f.find(KEY_ZONE_MOVE), f.find(KEY_TOUCH_BUTTON + T_ATTACK)]).toEqual([true, null, null]);
  // Each screen has a way out in the corner that covers none of its own controls, on every phone.
  for (const [button, open] of [[T_BAG, () => app.ui.inventory.open], [T_CHARACTER, () => app.ui.character], [T_MAP, () => app.ui.map]] as const) for (const [name, w, hh] of WINDOWS) {
    if (!open()) { app.key(button === T_CHARACTER ? "KeyP" : button === T_MAP ? "KeyM" : "KeyI", true, false, 2); h.run(50, (now) => app.frame(now, w, hh)); }
    h.run(50, (now) => app.frame(now, w, hh));
    const close = f.find(KEY_TOUCH_BUTTON + T_CLOSE)!, where = `${name}, screen ${button}`;
    expect([open(), close !== null], where).toEqual([true, true]);
    for (const n of f.nodes.slice(0, f.count)) if (n !== close && n.interactive) expect(close.x < n.x + n.w && n.x < close.x + close.w && close.y < n.y + n.h && n.y < close.y + close.h, `${where}: over ${n.key} "${n.label}"`).toBe(false);
  }
  app.pointer(0, KEY_TOUCH_BUTTON + T_CLOSE, 0, 0, 0, 3);
  app.pointer(1, KEY_TOUCH_BUTTON + T_CLOSE, 0, 0, 0, 3);
  run(50);
  expect([app.ui.map, app.ui.inventory.open, app.ui.character, f.find(KEY_TOUCH_BUTTON + T_CLOSE)]).toEqual([false, false, false, null]);
  expect(f.find(KEY_ZONE_MOVE)).not.toBeNull();
  // The menu: everything held is let go, and the layer is gone until it is resumed.
  app.pointer(0, KEY_ZONE_MOVE, 150, 350, 0, 1);
  app.pointer(2, KEY_ZONE_MOVE, 150, 300, 0, 1);
  app.pointer(0, KEY_TOUCH_BUTTON + T_MENU, 0, 0, 0, 3);
  app.pointer(1, KEY_TOUCH_BUTTON + T_MENU, 0, 0, 0, 3);
  run(50);
  expect([app.ui.menu, app.controls.moveZ, app.touch.stick, f.find(KEY_ZONE_MOVE), f.find(KEY_MENU) !== null]).toEqual([true, 0, false, null, true]);
});

test("the layer follows the last thing used: a key or a pad's stick puts it away, and a finger brings it back", () => {
  const h = new Harness(), app = new App(h.join("hybrid", { latencyMs: 20 }, { manual: true }), h.reg, pack);
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
  expect([app.ui.inventory.open, f.find(KEY_INV_USE) !== null, f.find(KEY_INV_HALF)!.text, f.find(KEY_INV_INFO)!.text]).toEqual([true, true, "Half", "press a stack to pick it up"]);
  // The row's six buttons stand side by side, with their words whole.
  const row = [KEY_INV_USE, KEY_INV_HALF, KEY_INV_ACTION, KEY_INV_ACTION + 3].map((k) => f.find(k)!);
  for (let i = 1; i < row.length; i++) expect(row[i]!.x).toBeGreaterThanOrEqual(row[i - 1]!.x + row[i - 1]!.w);
  for (const b of row) expect(textWidth(b.text, b.style)).toBeLessThanOrEqual(b.w);
  // Eat a berry: pick the stack up, then Use.
  const berries = app.session.inventory!.item.indexOf(h.reg.index.get("core:berry")!), food = h.host.survival.value(rec, V_FOOD);
  press(slot(berries));
  expect(app.ui.inventory.held).toBe(berries);
  press(KEY_INV_USE);
  run(300);
  expect([inv.count[berries], app.ui.inventory.held]).toEqual([4, -1]);
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
  expect(app.ui.inventory.held).toBe(-1);
  // A mouse's screen has no such buttons, and its hint names its buttons.
  app.key("KeyW", true); app.key("KeyW", false);
  run(60);
  expect([f.find(KEY_INV_USE), f.find(KEY_INV_HALF), f.find(KEY_INV_INFO)!.text.startsWith("left click")]).toEqual([null, null, true]);
});

test("each situation has its own cluster on the same arcs: the second page, building, placing, a flyer, a car, a boat and a helicopter", () => {
  const SITUATIONS: [string, (app: App) => void, number[], number[]][] = [
    ["the second page", (app) => { app.touch.more = true; }, [T_ATTACK, T_MORE, T_MELEE, T_VIEW, T_ORBIT, T_FOLLOW, T_STAY, T_SIC], [T_JUMP, T_STANCE, T_AIM, T_RELOAD]],
    ["building", (app) => { app.ui.building = true; }, [T_ATTACK, T_ROTATE, T_RELOAD, T_SNAP, T_RAISE, T_LOWER], [T_JUMP, T_STANCE, T_MORE]],
    ["placing a vehicle", (app) => { app.ui.placing = true; }, [T_ATTACK, T_ROTATE, T_SNAP, T_CANCEL], [T_JUMP, T_STANCE, T_MORE, T_RAISE]],
    ["a flyer", (app) => { app.ui.flyer = true; }, [T_ATTACK, T_JUMP, T_ROLL, T_HOLD, T_MORE], [T_STANCE, T_AIM]],
    ["a car", (app) => { Object.assign(app.hud, { vehicle: Object.assign(app.vehicleTelemetry, { active: true, rotor: false, boat: false, lightMode: 0 }) }); }, [T_JUMP, T_VIEW, T_ORBIT], [T_ATTACK, T_STANCE, T_MORE]],
    ["a boat", (app) => { Object.assign(app.hud, { vehicle: Object.assign(app.vehicleTelemetry, { active: true, rotor: false, boat: true }) }); }, [T_JUMP, T_SHIFT, T_VIEW], [T_ATTACK, T_STANCE, T_MORE]],
    ["a helicopter", (app) => { Object.assign(app.hud, { vehicle: Object.assign(app.vehicleTelemetry, { active: true, rotor: true, boat: false }) }); }, [T_JUMP, T_DOWN, T_SNAP, T_RELOAD, T_ROLL, T_HOLD, T_SHIFT, T_VIEW], [T_ATTACK, T_STANCE, T_MORE]],
  ];
  for (const [what, set, has, lacks] of SITUATIONS) for (const [name, w, h, insets] of WINDOWS) {
    const net = new Harness(), app = phone(net, "arc");
    insets.forEach((v, i) => (app.insets[i] = v));
    app.ui.settings.muted = false;
    net.run(600, (now) => app.frame(now, w, h));
    const hud = app.hud;
    hud.prompt = "E  exit vehicle";
    while (hud.hotbar.length < 10) hud.hotbar.push({ tint: -1, label: "", number: "" });
    set(app);
    app.ui.build(w / h, hud, app.session);
    const f = app.ui.frame, where = `${what}, ${name}`, unit = h / f.height, [l, t, r, b] = insets.map((v) => v / unit) as [number, number, number, number];
    for (const k of has) expect(f.find(KEY_TOUCH_BUTTON + k), `${where}: button ${k}`).not.toBeNull();
    for (const k of lacks) expect(f.find(KEY_TOUCH_BUTTON + k), `${where}: button ${k}`).toBeNull();
    for (const k of has) expect(app.ui.touchShown & (1 << k), `${where}: bit ${k}`).toBeGreaterThan(0);
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
