import { expect, test } from "bun:test";
import { HudModel } from "../../client/core/hud.ts";
import type { ClientSession } from "../../client/core/session.ts";
import type { CharacterScreen } from "../../client/core/ui/character.ts";
import { KEY_EMOTE_BUTTON, type EmoteMenu } from "../../client/core/ui/emotes.ts";
import type { Screen, ScreenPart } from "../../client/core/ui/screen.ts";
import { S_BUTTON } from "../../client/core/ui/style.ts";
import type { ChoosingScreen } from "../../client/core/ui/choosing.ts";
import type { CreatorScreen } from "../../client/core/ui/creator.ts";
import type { StructMenu } from "../../client/core/ui/structure.ts";
import type { NamePrompt } from "../../client/core/ui/tame.ts";
import type { AirRadio } from "../../client/core/ui/air-support.ts";
import { flatWorld } from "../fixtures/world.ts";
import { CHOOSE_DIED, RESULT_DENIED, SESSION_ALIVE, SESSION_CREATING, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { KEY_TRAVEL_BUTTON, type TravelScreen } from "../../client/core/ui/travel.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { K_BUTTON, K_INPUT, K_SLIDER, baseKey } from "../../client/core/ui/nodes.ts";
import { KEY_SETTINGS_PARTS, KEY_SETTINGS_TAB, SETTING_GROUPS, type SettingsTab } from "../../client/core/ui/settings.ts";
import { INPUT_SETTINGS } from "../../client/core/ui/settings-input.ts";
import { Chart } from "../../client/core/tactical.ts";
import { KEY_MAP_IMAGE, KEY_MAP_TOOLS, type MapScreen } from "../../client/core/ui/screens.ts";
import { buildProvingHeightfield } from "../../shared/world/proving.ts";
import { corePack } from "../fixtures/pack.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { emptyAirSupport } from "../../shared/sim/air-support.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS, Inventory } from "../../shared/sim/items.ts";
import { UNIT_CLOCK } from "../../shared/sim/clock.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { InventoryScreen } from "../../client/core/ui/inventory.ts";
import type { MenuScreen } from "../../client/core/ui/menu-screen.ts";
import type { HammerPanel } from "../../client/core/ui/hammer.ts";
import type { FieldDock } from "../../client/core/ui/field-dock.ts";
import { Hammer } from "../../client/core/hammer.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const hf = buildProvingHeightfield();
const palette = corePack().palette;

/** Enough of a session for the interface to build, which records the commands sent. */
function fakeSession(): { session: ClientSession; sent: number[] } {
  const sent: number[] = [];
  const session = {
    state: "active", airSupport: emptyAirSupport(), inventory: new Inventory(40 + HOTBAR_SLOTS + ARMOR_SLOTS, 40), held: 0, tamed: [],
    serverTick: 1000, logVersion: 0, log: [], globalChat: true, tribe: { name: "", team: 0 }, world: { hf }, markers: [], tactical: null, mapLocation: true, own: { x: 100, y: 0, z: 100 }, ownKind: reg.index.get("core:survivor")!,
    progress: { level: 1, xp: 0, statPoints: 0, engramPoints: 0, jobs: [], engrams: [], version: 1 },
    command: (op: number) => (sent.push(op), 1), emote: () => (sent.push(-1), 1), airCommand: () => (sent.push(-2), 1),
  } as unknown as ClientSession;
  return { session, sent };
}

/** Whether `key` is in one of the screen's bands, or is a part made from a key in one. */
function inBands(s: Screen, key: number): boolean {
  const base = baseKey(key);
  return s.bands.some((b) => base >= b.from && base < b.from + b.count);
}

/** Builds with the screen open, and returns the nodes it owns. */
function drawn(ui: Ui, s: Screen, session: ClientSession) {
  ui.registry = reg;
  const hud = new HudModel();
  hud.chart = new Chart(hf, palette);
  for (let i = 0; i < HOTBAR_SLOTS; i++) hud.hotbar.push({ label: "", tint: -1, number: "" });
  ui.build(16 / 9, hud, session);
  const at = ui.screens.indexOf(s);
  return ui.frame.nodes.slice(0, ui.frame.count).filter((n) => n.owner === at);
}

function openTravel(ui: Ui): TravelScreen {
  const travel = ui.screen<TravelScreen>("travel");
  travel.openAt(7);
  travel.list = { world: 1, servers: [{ world: 2, name: "B", map: "m", players: 0, max: 10, why: "" }] } as unknown as TravelScreen["list"];
  return travel;
}

test("screens have names of their own and key bands that do not meet", () => {
  const ui = new Ui();
  const names = ui.screens.map((s) => s.name);
  expect(new Set(names).size).toBe(names.length);
  const bands = ui.screens.flatMap((s) => s.bands.map((b) => ({ ...b, name: s.name }))).sort((a, b) => a.from - b.from);
  for (let i = 1; i < bands.length; i++) expect(bands[i]!.from, `${bands[i]!.name} meets ${bands[i - 1]!.name}`).toBeGreaterThanOrEqual(bands[i - 1]!.from + bands[i - 1]!.count);
});

/**
 * How this test opens each listed screen, and closes it as the game would: by its own file, or by the session where the
 * session decides. A screen added to the list needs a line here.
 */
const opens: Record<string, (ui: Ui, session: ClientSession) => { s: Screen; shut(): void }> = {
  travel: (ui) => { const s = openTravel(ui); return { s, shut: () => s.close() }; },
  character: (ui) => { const s = ui.screen<CharacterScreen>("character"); s.open = true; return { s, shut: () => s.close() }; },
  emotes: (ui) => { const s = ui.screen<EmoteMenu>("emotes"); s.open = true; return { s, shut: () => s.close() }; },
  map: (ui) => { const s = ui.screen<MapScreen>("map"); s.open = true; return { s, shut: () => s.close() }; },
  structure: (ui, session) => {
    const world = flatWorld(2);
    const ref = world.structs.add(reg.index.get("core:storage_large")!, 20, 1, 20, 0, 7, 1);
    Object.assign(session, { sessionState: SESSION_ALIVE, world });
    const s = ui.screen<StructMenu>("structure");
    s.begin(ref);
    return { s, shut: () => s.close() };
  },
  creator: (ui, session) => {
    Object.assign(session, { sessionState: SESSION_CREATING, name: "Ada" });
    return { s: ui.screen<CreatorScreen>("creator"), shut: () => (session.sessionState = SESSION_ALIVE) };
  },
  air: (ui, session) => {
    Object.assign(session, { sessionState: SESSION_ALIVE, airSupport: { ...emptyAirSupport(), pod: 1, pods: [{ id: 1, ent: 0, hitched: false, open: 1, slots: 3, selected: 0, x: 0, y: 0, z: 0, yaw: 0 }] } });
    const s = ui.screen<AirRadio>("air");
    s.open = true;
    return { s, shut: () => s.close() };
  },
  hammer: (ui, session) => {
    Object.assign(session, { sessionState: SESSION_ALIVE });
    const s = ui.screen<HammerPanel>("hammer");
    s.hammer = Object.assign(new Hammer(), { active: true, panel: true });
    return { s, shut: () => s.close() };
  },
  inventory: (ui, session) => {
    session.inventory!.set(0, reg.index.get("core:stone")!, 5, 0, 0, 0);
    const s = ui.screen<InventoryScreen>("inventory");
    s.open = true;
    return { s, shut: () => s.shut(session) };
  },
  dock: (ui) => {
    const s = ui.screen<FieldDock>("dock");
    s.page = "emblem";
    return { s, shut: () => s.close() };
  },
  menu: (ui) => {
    const s = ui.screen<MenuScreen>("menu");
    ui.escaped();
    return { s, shut: () => s.close() };
  },
  naming: (ui, session) => {
    Object.assign(session, { sessionState: SESSION_ALIVE, tamed: [{ handle: 7, kind: reg.index.get("core:parasaur")!, level: 3, te: 80 }] });
    return { s: ui.screen<NamePrompt>("naming"), shut: () => ui.screen<NamePrompt>("naming").close() };
  },
  choosing: (ui, session) => {
    Object.assign(session, { sessionState: SESSION_DEAD, choosing: CHOOSE_DIED, placesList: 0, respawnPoints: [{ kind: 0, name: "Beach", x: 10, z: 10, readyAt: 0 }, { kind: 1, name: "Bed", x: 40, z: 30, readyAt: 0 }] });
    return { s: ui.screen<ChoosingScreen>("choosing"), shut: () => (session.sessionState = SESSION_ALIVE) };
  },
};

test("each open screen frees the pointer, draws inside its bands and owns what it drew", () => {
  for (const name of new Ui().screens.map((s) => s.name)) {
    expect(opens[name], `a way to open ${name} in this test`).toBeDefined();
    const { session } = fakeSession();
    const ui = new Ui();
    const { s } = opens[name]!(ui, session);
    const nodes = drawn(ui, s, session);
    expect(ui.wantsPointerLock, name).toBe(false);
    expect(nodes.length, name).toBeGreaterThan(0);
    for (const n of nodes) expect(inBands(s, n.key), `${name} drew key ${n.key}`).toBe(true);
    for (const n of nodes) expect(n.x >= 0 && n.y >= 0 && n.x + n.w <= ui.frame.width && n.y + n.h <= ui.frame.height, `${name} ${n.key} on the canvas`).toBe(true);
  }
});

test("a press on a screen's node goes to that screen", () => {
  const ui = new Ui(), { session, sent } = fakeSession();
  const travel = openTravel(ui);
  drawn(ui, travel, session);
  ui.pointer(0, KEY_TRAVEL_BUTTON, 0, 0, 0, session);
  expect(sent.length).toBe(1);
  expect(travel.note).toBe("leaving for B");
});

test("a press that comes after its screen closed, before the next frame, does nothing", () => {
  for (const name of new Ui().screens.map((s) => s.name)) {
    const ui = new Ui(), { session, sent } = fakeSession();
    const { s, shut } = opens[name]!(ui, session);
    const all = drawn(ui, s, session).filter((n) => n.interactive);
    expect(all.length, name).toBeGreaterThan(0);
    // What a screen draws with the HUD works while it is shut, as the hotbar's slots do.
    const keys = all.filter((n) => !n.inPlay).map((n) => n.key);
    shut();
    for (const key of keys) ui.pointer(0, key, 0, 0, 0, session);
    expect([s.isOpen(), sent], name).toEqual([false, []]);
  }
  // The travel list closed by Escape, as a player would.
  const ui = new Ui(), { session, sent } = fakeSession();
  const travel = openTravel(ui);
  drawn(ui, travel, session);
  ui.key("Escape", true, false, session);
  ui.pointer(0, KEY_TRAVEL_BUTTON, 0, 0, 0, session);
  expect([travel.open, sent]).toEqual([false, []]);
});

test("a screen's hotkey opens it and shuts the rest of its group, and Escape shuts it", () => {
  const ui = new Ui(), { session } = fakeSession();
  const travel = openTravel(ui), sheet = ui.screen<CharacterScreen>("character");
  const heard: string[] = [];
  ui.hear = (cue) => heard.push(cue);
  ui.key("KeyP", true, false, session);
  expect([travel.open, sheet.open]).toEqual([false, true]);
  ui.key("KeyM", true, false, session);
  expect([sheet.open, ui.opened("map")]).toEqual([false, true]);
  ui.key("KeyP", true, false, session);
  expect([sheet.open, ui.opened("map")]).toEqual([true, false]);
  ui.key("KeyP", true, false, session);
  expect(sheet.open).toBe(false);
  openTravel(ui);
  drawn(ui, travel, session);
  ui.key("Escape", true, false, session);
  expect([travel.open, ui.screen<MenuScreen>("menu").menu]).toEqual([false, false]);
  expect(heard).toEqual(["screen/character/open", "screen/map/open", "screen/character/open", "screen/character/close", "screen/travel/close"]);
});

test("a screen of no group opens by its hotkey only from play, and the bag opens over it", () => {
  const ui = new Ui(), { session } = fakeSession();
  const emotes = ui.screen<EmoteMenu>("emotes");
  ui.key("KeyZ", true, false, session);
  expect(emotes.open).toBe(true);
  drawn(ui, emotes, session);
  ui.key("KeyI", true, false, session);
  expect([emotes.open, ui.screen<InventoryScreen>("inventory").open]).toEqual([false, true]);
  // Z does nothing for the emotes while the inventory has the pointer.
  ui.key("KeyZ", true, false, session);
  expect(emotes.open).toBe(false);
});

test("the server's answer reaches the screen that asked", () => {
  const ui = new Ui(), { session } = fakeSession();
  const emotes = ui.screen<EmoteMenu>("emotes");
  (session as unknown as { emote: () => number }).emote = () => 42;
  emotes.open = true;
  drawn(ui, emotes, session);
  ui.pointer(0, KEY_EMOTE_BUTTON, 0, 0, 0, session);
  expect(emotes.open).toBe(false);
  ui.results(42, RESULT_DENIED);
  expect(emotes.notice).toBe("Not now: stand still, hands free");
});

test("the map takes a finger's drag through the list, with no click", () => {
  const ui = new Ui(), { session } = fakeSession();
  const map = ui.screen<MapScreen>("map");
  const heard: string[] = [];
  ui.hear = (cue) => heard.push(cue);
  ui.key("KeyM", true, false, session);
  heard.length = 0;
  const hud = new HudModel();
  hud.chart = new Chart(hf, palette);
  // Twice: the first build looks at the reader, as a freshly opened map does.
  ui.build(16 / 9, hud, session);
  ui.build(16 / 9, hud, session);
  const picture = ui.frame.find(KEY_MAP_IMAGE)!;
  expect(picture.owner).toBe(ui.screens.indexOf(map));
  const [cx, cy] = [picture.x + picture.w / 2, picture.y + picture.h / 2];
  ui.pointer(0, KEY_MAP_TOOLS, cx, cy, 0, session);
  ui.build(16 / 9, hud, session);
  const before = hud.chart.fullU;
  ui.pointer(0, KEY_MAP_IMAGE, cx, cy, 0, session, 1);
  ui.pointer(2, KEY_MAP_IMAGE, cx + 60, cy, 0, session, 1);
  ui.pointer(1, KEY_MAP_IMAGE, cx + 60, cy, 0, session, 1);
  expect(hud.chart.fullU).toBeLessThan(before);
  expect(heard).toEqual([]);
});

test("the radio's play button works while it is closed, J opens it, and Tab keeps to its own buttons", () => {
  const ui = new Ui(), { session } = fakeSession();
  const { s: air, shut } = opens.air!(ui, session);
  shut();
  // Closed, it draws its button with the HUD, and a press on that button opens it.
  drawn(ui, air, session);
  const radio = ui.frame.nodes.slice(0, ui.frame.count).find((n) => n.owner === ui.screens.indexOf(air) && n.interactive)!;
  expect(radio.inPlay).toBe(true);
  ui.pointer(0, radio.key, radio.x + 1, radio.y + 1, 0, session);
  expect(air.isOpen()).toBe(true);
  // Escape closes it, and J from play opens it again.
  ui.key("Escape", true, false, session);
  expect(air.isOpen()).toBe(false);
  ui.key("KeyJ", true, false, session);
  expect(air.isOpen()).toBe(true);
  // Tab walks the radio's buttons only, and the console stays shut.
  const nodes = drawn(ui, air, session);
  const own = new Set(nodes.filter((n) => n.interactive).map((n) => n.key));
  for (let i = 0; i < own.size + 2; i++) {
    ui.key("Tab", true, false, session);
    expect(own.has(ui.navigate(0))).toBe(true);
  }
  expect(ui.console.open).toBe(false);
});

test("every page of the menu draws inside the menu's bands", () => {
  const { session } = fakeSession();
  Object.assign(session, { creative: true, admin: true, clock: UNIT_CLOCK, dayOffset: 0 });
  const pages: [string, (m: MenuScreen) => void][] = [
    ["menu", () => {}],
    ...[0, 1, 2, 3, 4].map((tab): [string, (m: MenuScreen) => void] => [`settings ${tab}`, (m) => (m.options = true)]),
    ...[0, 1, 2].map((device): [string, (m: MenuScreen) => void] => [`controls ${device}`, (m) => ((m.help = true), (m.helpDevice = device))]),
    ["creative", (m) => (m.creative = true)],
  ];
  for (const [name, open] of pages) {
    const ui = new Ui();
    const menu = ui.screen<MenuScreen>("menu");
    ui.escaped();
    open(menu);
    if (name.startsWith("settings")) ui.settings.tab = Number(name.slice(9));
    const nodes = drawn(ui, menu, session);
    expect(nodes.length, name).toBeGreaterThan(0);
    for (const n of nodes) expect(inBands(menu, n.key), `${name} drew key ${n.key}`).toBe(true);
  }
});

test("two parts both drawing their own key 1 show as two tabs, and each click reaches the part that drew it", () => {
  const ui = new Ui(), { session } = fakeSession();
  const sheet = ui.screen<CharacterScreen>("character");
  const pressed: string[] = [];
  /** A part as another file would write it: one button at its own key 1, which says its name. */
  const part = (name: string): ScreenPart => ({
    name,
    label: name,
    build(f, at, k) {
      const b = f.add(k.key(1), K_BUTTON, at.x, at.y, at.w, 30, S_BUTTON);
      b.text = `${name} button`;
      b.interactive = true;
    },
    pointer(kind, local) {
      if (kind === 0) pressed.push(`${name} ${local}`);
      return true;
    },
  });
  sheet.parts.push(part("Brands"), part("Tribe"));
  sheet.open = true;
  let nodes = drawn(ui, sheet, session);
  const tabs = nodes.filter((n) => n.text === "Brands" || n.text === "Tribe");
  expect(tabs.map((n) => n.text)).toEqual(["Brands", "Tribe"]);
  for (const name of ["Brands", "Tribe"]) {
    ui.pointer(0, tabs.find((n) => n.text === name)!.key, 0, 0, 0, session);
    nodes = drawn(ui, sheet, session);
    const button = nodes.find((n) => n.text === `${name} button`)!;
    for (const n of nodes) expect(inBands(sheet, n.key), `key ${n.key}`).toBe(true);
    ui.pointer(0, button.key, 0, 0, 0, session);
  }
  expect(pressed).toEqual(["Brands 1", "Tribe 1"]);
});

test("a part's old button pressed after its tab was left, before the next frame, does nothing; its fields and sliders reach it", () => {
  const ui = new Ui(), { session } = fakeSession();
  const sheet = ui.screen<CharacterScreen>("character");
  const heard: string[] = [];
  /** A part with a button at its key 1, a slider at its key 2 and a field at its key 3, each telling what reached it. */
  const part = (name: string): ScreenPart => ({
    name,
    label: name,
    build(f, at, k) {
      const b = f.add(k.key(1), K_BUTTON, at.x, at.y, 80, 30, S_BUTTON);
      b.text = `${name} button`;
      b.interactive = true;
      f.add(k.key(2), K_SLIDER, at.x, at.y + 40, 120, 30, S_BUTTON).interactive = true;
      f.add(k.key(3), K_INPUT, at.x, at.y + 80, 120, 30, S_BUTTON).interactive = true;
    },
    pointer(kind, local) {
      if (kind === 0) heard.push(`${name} pressed ${local}`);
      return true;
    },
    value(local, value) {
      heard.push(`${name} slid ${local} to ${value}`);
      return true;
    },
    text(local, value) {
      heard.push(`${name} typed ${local}: ${value}`);
      return true;
    },
  });
  sheet.parts.push(part("A"), part("B"));
  sheet.open = true;
  let nodes = drawn(ui, sheet, session);
  const tab = (name: string) => nodes.find((n) => n.text === name)!.key;
  ui.pointer(0, tab("A"), 0, 0, 0, session);
  nodes = drawn(ui, sheet, session);
  const button = nodes.find((n) => n.text === "A button")!.key;
  const slide = nodes.find((n) => n.kind === K_SLIDER)!.key, field = nodes.find((n) => n.kind === K_INPUT)!.key;
  ui.pointer(0, button, 0, 0, 0, session);
  ui.input(slide, ".5");
  ui.input(field, "Rex");
  // To B, and A's controls pressed and edited before the frame shows B.
  ui.pointer(0, tab("B"), 0, 0, 0, session);
  ui.pointer(0, button, 0, 0, 0, session);
  ui.input(slide, ".9");
  ui.input(field, "late");
  expect(heard).toEqual(["A pressed 1", "A slid 2 to 0.5", "A typed 3: Rex"]);
});

test("the settings page's Input tab is a part: its slider moves by pointer, value and arrows, and an edit after leaving it is dropped", () => {
  const ui = new Ui(), hud = new HudModel(), menu = ui.screen<MenuScreen>("menu");
  menu.menu = menu.options = true;
  ui.settings.tab = SETTING_GROUPS.findIndex((t) => t.part === INPUT_SETTINGS);
  ui.build(16 / 9, hud, null);
  const slider = ui.frame.nodes.slice(0, ui.frame.count).find((n) => n.kind === K_SLIDER && n.label === "Mouse sensitivity")!;
  expect(slider.key).toBeGreaterThanOrEqual(KEY_SETTINGS_PARTS);
  ui.pointer(0, slider.key, slider.x + slider.w / 2, slider.y, 0, null);
  ui.input(slider.key, ".5");
  expect(ui.settings.sensitivity).toBe(1.6);
  ui.key("ArrowRight", true, false, null);
  expect(ui.settings.sensitivity).toBe(1.7);
  // Mid-edit, the Display tab is chosen; what comes for the Input tab's slider before the frame is drawn again is dropped.
  ui.pointer(0, KEY_SETTINGS_TAB, 0, 0, 0, null);
  ui.input(slider.key, ".9");
  ui.key("ArrowRight", true, false, null);
  expect([ui.settings.tab, ui.settings.sensitivity]).toEqual([0, 1.7]);
});

test("a field on a settings tab of another file types: the menu lets its keys through and the edit reaches the part", () => {
  const ui = new Ui(), hud = new HudModel(), menu = ui.screen<MenuScreen>("menu");
  const heard: string[] = [];
  const part: ScreenPart = {
    name: "names",
    label: "Names",
    build(f, at, k) {
      f.add(k.key(1), K_INPUT, at.x, at.y, 200, 30, S_BUTTON).interactive = true;
    },
    text(local, value) {
      heard.push(`${local}: ${value}`);
      return true;
    },
  };
  const groups = SETTING_GROUPS as SettingsTab[];
  groups.push({ name: "Names", rows: [], part });
  try {
    menu.menu = menu.options = true;
    ui.settings.tab = groups.length - 1;
    ui.build(16 / 9, hud, null);
    const field = ui.frame.nodes.slice(0, ui.frame.count).find((n) => n.kind === K_INPUT)!;
    ui.pointer(0, field.key, field.x, field.y, 0, null);
    ui.build(16 / 9, hud, null);
    expect(["KeyR", "Space", "ArrowLeft", "Backspace"].map((code) => ui.key(code, true, false, null))).toEqual([false, false, false, false]);
    ui.input(field.key, "r");
    expect(heard).toEqual(["1: r"]);
    // Escape still leaves the page.
    expect(ui.key("Escape", true, false, null)).toBe(true);
    expect(menu.options).toBe(false);
  } finally {
    groups.pop();
  }
});
