import { expect, test } from "bun:test";
import { HudModel } from "../../client/core/hud.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { KEY_TRAVEL_BUTTON, type TravelScreen } from "../../client/core/ui/travel.ts";
import { Ui } from "../../client/core/ui/ui.ts";
import { emptyAirSupport } from "../../shared/sim/air-support.ts";
import { ARMOR_SLOTS, HOTBAR_SLOTS, Inventory } from "../../shared/sim/items.ts";

/** Enough of a session for the interface to build, which records the commands sent. */
function fakeSession(): { session: ClientSession; sent: number[] } {
  const sent: number[] = [];
  const session = {
    state: "active", airSupport: emptyAirSupport(), inventory: new Inventory(40 + HOTBAR_SLOTS + ARMOR_SLOTS, 40), held: 0, tamed: [],
    serverTick: 1000, logVersion: 0, log: [], globalChat: true, tribe: { name: "" },
    command: (op: number) => (sent.push(op), 1),
  } as unknown as ClientSession;
  return { session, sent };
}

test("screens have names of their own and key bands that do not meet", () => {
  const ui = new Ui();
  const names = ui.screens.map((s) => s.name);
  expect(new Set(names).size).toBe(names.length);
  const bands = ui.screens.map((s) => s.band).sort((a, b) => a.from - b.from);
  for (let i = 1; i < bands.length; i++) expect(bands[i]!.from).toBeGreaterThanOrEqual(bands[i - 1]!.from + bands[i - 1]!.count);
});

test("an open screen frees the pointer, draws inside its band and owns what it drew", () => {
  const ui = new Ui(), hud = new HudModel(), { session } = fakeSession();
  const travel = ui.screen<TravelScreen>("travel");
  travel.openAt(7);
  travel.list = { world: 1, servers: [{ world: 2, name: "B", map: "m", players: 0, max: 10, why: "" }] } as unknown as TravelScreen["list"];
  ui.build(16 / 9, hud, session);
  expect(ui.wantsPointerLock).toBe(false);
  const at = ui.screens.indexOf(travel);
  const drawn = ui.frame.nodes.slice(0, ui.frame.count).filter((n) => n.owner === at);
  expect(drawn.length).toBeGreaterThan(0);
  for (const n of drawn) expect(n.key >= travel.band.from && n.key < travel.band.from + travel.band.count, `key ${n.key}`).toBe(true);
});

test("a press on a screen's node goes to that screen", () => {
  const ui = new Ui(), hud = new HudModel(), { session, sent } = fakeSession();
  const travel = ui.screen<TravelScreen>("travel");
  travel.openAt(7);
  travel.list = { world: 1, servers: [{ world: 2, name: "B", map: "m", players: 0, max: 10, why: "" }] } as unknown as TravelScreen["list"];
  ui.build(16 / 9, hud, session);
  ui.pointer(0, KEY_TRAVEL_BUTTON, 0, 0, 0, session);
  expect(sent.length).toBe(1);
  expect(travel.note).toBe("leaving for B");
});

test("opening a screen of the bag closes the open one, and Escape closes it", () => {
  const ui = new Ui(), hud = new HudModel(), { session } = fakeSession();
  const travel = ui.screen<TravelScreen>("travel");
  travel.openAt(7);
  ui.key("KeyM", true, false, session);
  expect([travel.open, ui.map]).toEqual([false, true]);
  ui.key("KeyM", true, false, session);
  travel.openAt(7);
  ui.build(16 / 9, hud, session);
  ui.key("Escape", true, false, session);
  expect([travel.open, ui.menu]).toEqual([false, false]);
});
