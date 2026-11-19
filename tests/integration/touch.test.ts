import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { KEY_TOUCH_BUTTON, KEY_ZONE_LOOK, KEY_ZONE_MOVE, T_AIM, T_ATTACK, T_BAG, T_CHARACTER, T_CLOSE, T_JUMP, T_MAP, T_MENU, T_RELOAD, T_STANCE, T_USE } from "../../client/core/touch.ts";
import { KEY_HOTBAR, KEY_MINIMAP, KEY_PROMPT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { KEY_MENU, KEY_UNMUTE } from "../../client/core/ui/menu.ts";
import { K_HOLD, MIN_WIDTH, SCALE_FLOOR, textWidth } from "../../client/core/ui/nodes.ts";
import { BTN_JUMP, BTN_PRIMARY, BTN_SPRINT } from "../../shared/sim/character.ts";
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
    const around = [T_JUMP, T_STANCE, T_AIM, T_RELOAD, T_ATTACK].map(middle);
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
