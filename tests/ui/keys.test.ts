import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { PAD_BUILD, PAD_HOLDS, PAD_KEYS, PAD_TAPS } from "../../client/core/gamepad.ts";
import { ANY_KEY, pressKey, type KeyRow } from "../../client/core/key-row.ts";
import { KEY_ROWS } from "../../client/core/keys.ts";
import { touchKey } from "../../client/core/touch.ts";
import type { TravelScreen } from "../../client/core/ui/travel.ts";
import type { MapScreen } from "../../client/core/ui/screens.ts";
import type { MenuScreen } from "../../client/core/ui/menu-screen.ts";
import { keyBinding } from "../../client/core/ui/controls-guide.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { BTN_MOD, BTN_PRONE } from "../../shared/sim/character.ts";
import type { OpticFacet } from "../../shared/content/defs.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { Harness } from "../fixtures/net.ts";

const pack = parsePack(corePackBytes());

/** A living survivor in play, and `press`: the name of the row that answers a key going down, "" for none. */
function playing(): { app: App; press: (code: string) => string } {
  const h = new Harness();
  const app = new App(h.join("keys", { latencyMs: 20 }, { manual: true }), h.reg, pack);
  h.run(500, (now) => app.frame(now, 1280, 720));
  expect(app.ui.wantsPointerLock).toBe(true);
  let answered = "";
  const spied: KeyRow[] = KEY_ROWS.map((row) => ({
    ...row,
    press(c, code, down, repeat, source) {
      const answer = row.press(c, code, down, repeat, source);
      if (answer !== undefined) answered = row.name;
      return answer;
    },
  }));
  const press = (code: string): string => {
    answered = "";
    pressKey(spied, app, code, true, false, 0);
    const by = answered;
    pressKey(spied, app, code, false, false, 0);
    return by;
  };
  return { app, press };
}

const at = (name: string): number => KEY_ROWS.findIndex((row) => row.name === name);

test("every row has a name of its own", () => {
  const names = KEY_ROWS.map((row) => row.name);
  expect(new Set(names).size).toBe(names.length);
});

test("rows that want the same key stand in the order the keys were always tried in", () => {
  // Earlier, later, and a key both take.
  const pairs: [string, string, string][] = [
    ["debug", "interface", "F3"],
    ["place vehicle", "interface", "Escape"],
    ["place vehicle", "build", "KeyQ"],
    ["interface", "inspect zoom", "Minus"],
    ["interface", "typing", "KeyW"],
    ["interface", "hotbar", "Digit1"],
    ["inspect zoom", "typing", "Minus"],
    ["inspect zoom", "chart", "Equal"],
    ["typing", "sight zoom", "ArrowUp"],
    ["typing", "body", "KeyW"],
    ["sight zoom", "build", "ArrowUp"],
    ["sight zoom", "chart", "ArrowDown"],
    ["glass mark", "visor", "KeyN"],
    ["visor", "body", "KeyN"],
    ["build", "chart", "ArrowUp"],
    ["build cancel", "interface", "Escape"],
    ["build", "follow: one", "KeyT"],
    ["build", "arms full", "KeyX"],
    ["build", "door or throw", "KeyQ"],
    ["build", "body", "KeyR"],
    ["shift", "body", "ShiftLeft"],
    ["take", "terminal", "KeyE"],
    ["terminal", "use", "KeyE"],
    ["use", "body", "KeyE"],
    ["patrol lights", "orbit", "KeyK"],
    ["door or throw", "body", "KeyQ"],
    ["arms full", "body", "KeyX"],
  ];
  for (const [first, second, code] of pairs) {
    const a = KEY_ROWS[at(first)], b = KEY_ROWS[at(second)];
    expect(a, first).toBeDefined();
    expect(b, second).toBeDefined();
    for (const row of [a!, b!]) expect(row.keys === ANY_KEY || row.keys.includes(code), `${row.name} takes ${code}`).toBe(true);
    expect(at(first), `${first} before ${second}`).toBeLessThan(at(second));
  }
});

test("the body's buttons are the last row, so no row after it is shadowed", () => {
  expect(KEY_ROWS[KEY_ROWS.length - 1]!.name).toBe("body");
});

test("with a piece in hand E still takes, opens and uses, and R turns the piece", () => {
  const { app, press } = playing();
  app.builder.active = true;
  app.eggAimed = 7;
  expect(press("KeyE")).toBe("take");
  app.eggAimed = -1;
  app.aimed = 5;
  expect(press("KeyE")).toBe("use");
  app.aimed = -1;
  expect(press("KeyE")).toBe("body");
  expect([press("KeyR"), press("KeyT"), press("KeyX")]).toEqual(["build", "build", "build"]);
});

test("at a wheel a piece in hand takes no key, so Q and R are the vehicle's", () => {
  const { app, press } = playing();
  app.builder.active = true;
  app.session.driving = 5;
  expect([press("KeyQ"), press("KeyR"), press("KeyX")]).toEqual(["body", "body", "body"]);
});

test("a finger's cancel puts the piece away, and the keyboard's Escape still opens the menu", () => {
  const { app } = playing();
  app.builder.active = true;
  expect(app.key("Escape", true, false, 2)).toBe(true);
  expect(app.ui.screen<MenuScreen>("menu").menu).toBe(false);
  app.key("Escape", false, false, 2);
  app.key("Escape", true);
  expect(app.ui.screen<MenuScreen>("menu").menu).toBe(true);
});

test("E takes what lies there, then opens a terminal, then uses, then is the body's", () => {
  const { app, press } = playing();
  app.eggAimed = 7;
  app.terminalAimed = 3;
  expect(press("KeyE")).toBe("take");
  expect(app.ui.screen<TravelScreen>("travel").open).toBe(false);
  app.eggAimed = -1;
  expect(press("KeyE")).toBe("terminal");
  expect(app.ui.screen<TravelScreen>("travel").open).toBe(true);
  app.ui.screen<TravelScreen>("travel").open = false;
  app.terminalAimed = -1;
  // Aimed at a built piece the use key is kept back; aimed at nothing the body has it.
  app.aimed = 5;
  expect(press("KeyE")).toBe("use");
  app.aimed = -1;
  expect(press("KeyE")).toBe("body");
});

test("N marks through a glass, then works a visor, then is the body's modifier", () => {
  const { app, press } = playing();
  const optic = { min: 2, max: 8 } as OpticFacet;
  app.visorOptic = optic;
  app.glass.up = true;
  expect(press("KeyN")).toBe("glass mark");
  expect(app.nPulse).toBe(0);
  app.glass.up = false;
  app.key("KeyN", true);
  expect(app.nDownAt).toBeGreaterThanOrEqual(0);
  expect(app.controls.buttons & BTN_MOD).toBe(0);
  app.key("KeyN", false);
  app.visorOptic = null;
  expect(press("KeyN")).toBe("body");
});

test("the arrows zoom a sight, then lift a piece being placed, then move the map", () => {
  const { app, press } = playing();
  app.builder.active = true;
  app.visorOptic = { min: 2, max: 8 } as OpticFacet;
  app.visor.up = true;
  expect(app.zooming).toBe(true);
  expect(press("ArrowUp")).toBe("sight zoom");
  expect(app.builder.lift).toBe(0);
  app.visor.up = false;
  expect(press("ArrowUp")).toBe("build");
  expect(app.builder.lift).toBe(1);
  app.builder.active = false;
  app.ui.screen<MapScreen>("map").open = true;
  expect(press("ArrowUp")).toBe("chart");
});

test("Q is the builder's while a piece is placed, and else throws and goes on", () => {
  const { app, press } = playing();
  app.builder.active = true;
  expect(press("KeyQ")).toBe("build");
  app.builder.active = false;
  // The throw's row lets the key go on, and the body, which has no use for Q on foot, says so.
  expect(press("KeyQ")).toBe("body");
  expect(app.key("KeyQ", true)).toBe(false);
});

test("K is the orbit camera on foot", () => {
  const { app, press } = playing();
  expect(press("KeyK")).toBe("orbit");
  expect(app.orbit.on).toBe(true);
});

test("X does not lay down a body whose arms are full", () => {
  const { app, press } = playing();
  app.holding = 5;
  expect(press("KeyX")).toBe("arms full");
  expect(app.controls.buttons & BTN_PRONE).toBe(0);
  app.holding = -1;
  app.key("KeyX", true);
  expect(app.controls.buttons & BTN_PRONE).toBe(BTN_PRONE);
});

test("a screen that has the keyboard gets every key, and the page types it", () => {
  const { app, press } = playing();
  app.key("Enter", true);
  app.key("Enter", false);
  expect(app.ui.captureKeyboard).toBe(true);
  expect(app.key("KeyW", true)).toBe(false);
  expect(app.controls.moveZ).toBe(0);
  expect(press("KeyK")).toBe("typing");
  expect(app.orbit.on).toBe(false);
});

test("a touch button or a pad button a row names presses that row's key", () => {
  for (const row of KEY_ROWS) {
    for (const [code, button] of Object.entries(row.touch ?? {})) expect(touchKey(button), `${row.name} touch ${button}`).toBe(code);
    for (const [code, button] of Object.entries(row.pad ?? {})) expect([PAD_KEYS[button], PAD_TAPS[button], PAD_HOLDS[button], PAD_BUILD[button]], `${row.name} pad ${button}`).toContain(code);
  }
});

test("the controls guide shows a row's words for its key", () => {
  const seen = new Set<string>();
  for (const row of KEY_ROWS) {
    for (const words of row.guide ?? []) {
      const tab = words.sheet ?? 0, id = `${tab}:${words.code}`;
      // Where two rows describe a key, the first has it.
      if (seen.has(id)) continue;
      seen.add(id);
      expect(keyBinding(words.code, tab), `${row.name} ${words.code}`).toEqual({ group: words.group, title: words.title, detail: words.detail ?? "" });
    }
  }
  expect(seen.size).toBeGreaterThan(0);
});
