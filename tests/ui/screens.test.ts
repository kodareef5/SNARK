import { expect, test } from "bun:test";
import { HudModel } from "../../client/core/hud.ts";
import type { ClientSession } from "../../client/core/session.ts";
import type { CharacterScreen } from "../../client/core/ui/character.ts";
import type { Screen } from "../../client/core/ui/screen.ts";
import { KEY_TRAVEL_BUTTON, type TravelScreen } from "../../client/core/ui/travel.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { emptyAirSupport } from "../../shared/sim/air-support.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS, Inventory } from "../../shared/sim/items.ts";
import { CORE_CONTENT } from "../../content/core.ts";

const reg = compileContent(CORE_CONTENT).registry!;

/** Enough of a session for the interface to build, which records the commands sent. */
function fakeSession(): { session: ClientSession; sent: number[] } {
  const sent: number[] = [];
  const session = {
    state: "active", airSupport: emptyAirSupport(), inventory: new Inventory(40 + HOTBAR_SLOTS + ARMOR_SLOTS, 40), held: 0, tamed: [],
    serverTick: 1000, logVersion: 0, log: [], globalChat: true, tribe: { name: "" }, ownKind: reg.index.get("core:survivor")!,
    progress: { level: 1, xp: 0, statPoints: 0, engramPoints: 0, jobs: [], engrams: [], version: 1 },
    command: (op: number) => (sent.push(op), 1),
  } as unknown as ClientSession;
  return { session, sent };
}

/** Whether `key` is in one of the screen's bands, or is a piece of a glass panel keyed in one (skin.ts glass). */
function inBands(s: Screen, key: number): boolean {
  const base = key >= 2000000 ? Math.floor((key - 2000000) / 16) : key;
  return s.bands.some((b) => base >= b.from && base < b.from + b.count);
}

/** Builds with the screen open, and returns the nodes it owns. */
function drawn(ui: Ui, s: Screen, session: ClientSession) {
  ui.registry = reg;
  ui.build(16 / 9, new HudModel(), session);
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

test("each open screen frees the pointer, draws inside its bands and owns what it drew", () => {
  const { session } = fakeSession();
  const opens: Record<string, (ui: Ui) => Screen> = {
    travel: openTravel,
    character: (ui) => { const s = ui.screen<CharacterScreen>("character"); s.open = true; return s; },
  };
  for (const name of new Ui().screens.map((s) => s.name)) {
    expect(opens[name], `a way to open ${name} in this test`).toBeDefined();
    const ui = new Ui();
    const s = opens[name]!(ui);
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

test("a screen's hotkey opens it and shuts the rest of its group, and Escape shuts it", () => {
  const ui = new Ui(), { session } = fakeSession();
  const travel = openTravel(ui), sheet = ui.screen<CharacterScreen>("character");
  const heard: string[] = [];
  ui.hear = (cue) => heard.push(cue);
  ui.key("KeyP", true, false, session);
  expect([travel.open, sheet.open]).toEqual([false, true]);
  ui.key("KeyM", true, false, session);
  expect([sheet.open, ui.map]).toEqual([false, true]);
  ui.key("KeyP", true, false, session);
  expect([sheet.open, ui.map]).toEqual([true, false]);
  ui.key("KeyP", true, false, session);
  expect(sheet.open).toBe(false);
  openTravel(ui);
  drawn(ui, travel, session);
  ui.key("Escape", true, false, session);
  expect([travel.open, ui.menu]).toEqual([false, false]);
  expect(heard).toEqual(["screen/character/open", "screen/map/open", "screen/character/open", "screen/character/close", "screen/travel/close"]);
});
