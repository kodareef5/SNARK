// A setting that changes content, changed while the server runs: the server makes its content again and puts it in
// force, every session derives the same and goes on, and what kept a table of the old content takes the new.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { cooldownTicks } from "../../shared/sim/vehicle-thrusters.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const base = coreRegistry();
const id = (name: string): number => base.index.get(`core:${name}`)!;
const THATCH = id("thatch");
const BERRY = id("berry");
const ZEPHYR = id("zephyr");

function served(names: string[] = ["ada"], gus = "") {
  const h = new Harness({}, 1, 60, { dev: true, config: loadConfig({ gus: `[ServerSettings]\n${gus}\n` }).rules });
  const sessions = names.map((name) => h.join(name));
  h.run(500);
  const rec = (s: ClientSession): EntityRecord => h.host.records.byPid.get(h.client(s)!.pid)!;
  /** Sets one from the console's side, and gives the tick's change time to reach every session. */
  const set = (name: string, words: string): string => {
    const why = h.host.setSetting(name, words);
    h.run(300);
    return why;
  };
  return { h, sessions, rec, set };
}

/** The counts of an item's stacks in an inventory, largest first. */
function stacks(h: Harness, rec: EntityRecord, item: number): number[] {
  const inv = h.host.items.inv(rec);
  const out: number[] = [];
  for (let s = 0; s < inv.cap; s++) if (inv.item[s] === item) out.push(inv.count[s]!);
  return out.sort((a, b) => b - a);
}

test("a stack size changed while the server runs is the server's and every session's at once, and for one who joins after", () => {
  const { h, sessions, rec, set } = served(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  expect([h.world.reg === h.reg, ada.registry === h.reg, h.world.reg.stack[THATCH]]).toEqual([true, true, 200]);
  h.host.items.mint(rec(ada), THATCH, 400);
  expect(stacks(h, rec(ada), THATCH)).toEqual([200, 200]);

  expect(set("ItemStackSizeMultiplier", "2")).toBe("");
  const theirs = h.world.reg;
  expect([theirs === h.reg, theirs.stack[THATCH], theirs.tuning === ""]).toEqual([false, 400, false]);
  // Each session made the same content of the tuning it was sent, and stayed.
  for (const s of [ada, bob]) expect([s.state, s.registry.hash, s.registry.stack[THATCH], s.registry === h.reg]).toEqual(["active", theirs.hash, 400, false]);
  // What is made from now on stacks to the new size.
  h.host.items.mint(rec(bob), THATCH, 400);
  expect(stacks(h, rec(bob), THATCH)).toEqual([400]);

  // One who joins now is welcomed with it.
  const cy = h.join("cy");
  h.run(500);
  expect([cy.state, cy.registry.hash]).toEqual(["active", theirs.hash]);

  // Smaller again: a stack already over the size stays as it is, and nothing more goes on it.
  expect(set("ItemStackSizeMultiplier", "0.5")).toBe("");
  expect([h.world.reg.stack[THATCH], ada.registry.stack[THATCH], cy.registry.stack[THATCH]]).toEqual([100, 100, 100]);
  expect(stacks(h, rec(bob), THATCH)).toEqual([400]);
  h.host.items.mint(rec(bob), THATCH, 150);
  expect(stacks(h, rec(bob), THATCH)).toEqual([400, 100, 50]);

  // At its default again the content is the content as written, for the server and every session.
  expect(set("ItemStackSizeMultiplier", "1")).toBe("");
  expect([h.world.reg === h.reg, ada.registry === h.reg, bob.registry === h.reg, cy.registry === h.reg]).toEqual([true, true, true, true]);
  for (const s of [ada, bob, cy]) expect(s.state).toBe("active");
  h.host.shutdown();
});

test("a change that gives content that does not compile is refused and nothing changes", () => {
  const { h, sessions } = served();
  const before = h.world.reg;
  // A soul ball is one of a kind: content with a stack of them does not compile.
  const many = '(ItemClassString="core:soul_ball",Quantity=(MaxItemQuantity=5,bIgnoreMultiplier=True))';
  const did = h.host.pageSetting("ConfigOverrideItemMaxQuantity", many);
  h.run(120);
  expect(did.why).toMatch(/ConfigOverrideItemMaxQuantity gives content that does not compile/);
  expect([h.world.reg === before, h.host.rules.list("ConfigOverrideItemMaxQuantity").length, h.host.kept.words.size, sessions[0]!.state]).toEqual([true, 0, 0, "active"]);
  // One that compiles is taken, and one whose item this build does not have is passed over and said.
  const fine = '(ItemClassString="core:thatch",Quantity=(MaxItemQuantity=7,bIgnoreMultiplier=True))\n(ItemClassString="core:no_such_thing",Quantity=(MaxItemQuantity=7,bIgnoreMultiplier=True))';
  expect(h.host.pageSetting("ConfigOverrideItemMaxQuantity", fine).why).toBe("");
  h.run(120);
  expect([h.world.reg.stack[THATCH], sessions[0]!.registry.stack[THATCH]]).toEqual([7, 7]);
  expect(h.host.pageSetting("ConfigOverrideItemMaxQuantity", null).why).toBe("");
  h.run(120);
  expect(h.world.reg === before).toBe(true);
  h.host.shutdown();
});

test("spoiling under way is re-timed when its setting changes while the server runs", () => {
  const { h, sessions, rec, set } = served();
  const me = rec(sessions[0]!);
  const top = (): number => {
    const inv = h.host.items.inv(me);
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] === BERRY) return inv.spoilAt[s]! - h.world.tick;
    return -1;
  };
  h.host.items.mint(me, BERRY, 10);
  const left = top();
  expect(left).toBeGreaterThan(60 * TICK_RATE);
  expect(set("GlobalSpoilingTimeMultiplier", "2")).toBe("");
  // The time the top berry had left is doubled, less the ticks that have since passed.
  const now = top();
  expect(Math.abs(now - (2 * left - 600))).toBeLessThan(700);
  expect([h.world.reg.spoilTicks[BERRY], sessions[0]!.registry.spoilTicks[BERRY]]).toEqual([2 * base.spoilTicks[BERRY]!, 2 * base.spoilTicks[BERRY]!]);
  // Fuel burns by its own setting, taken the same way.
  const wood = id("wood");
  expect(base.fuelTicks[wood]).toBeGreaterThan(0);
  expect(set("FuelConsumptionIntervalMultiplier", "3")).toBe("");
  expect([h.world.reg.fuelTicks[wood], sessions[0]!.state]).toEqual([3 * base.fuelTicks[wood]!, "active"]);
  h.host.shutdown();
});

test("a thruster cooldown, a survivor's stats and the engrams follow their settings while the server runs", () => {
  const { h, sessions, rec, set } = served();
  const ada = sessions[0]!;
  const me = rec(ada);
  const thrusters = (reg: Registry) => (reg.vehicle[ZEPHYR]!.spec as { thrusters: { boostCooldownTicks: number; flipCooldownTicks: number } }).thrusters;
  expect(set("ThrusterBoostCooldown", "1")).toBe("");
  expect([thrusters(h.world.reg).boostCooldownTicks, thrusters(ada.registry).boostCooldownTicks, thrusters(base).boostCooldownTicks]).toEqual([cooldownTicks(1), cooldownTicks(1), cooldownTicks(4)]);

  // A body already in the world has its limits worked out again from its species' numbers.
  const health = me.vitals!.max[V_HEALTH]!;
  const twice = Array.from({ length: 12 }, (_, i) => (i === 0 ? 2 : i >= 8 || i === 6 ? 0 : 1)).join(",");
  expect(h.host.pageSetting("PlayerBaseStatMultipliers", twice).why).toBe("");
  h.run(300);
  expect(me.vitals!.max[V_HEALTH]).toBe(2 * health);

  // The engrams' table is made again: with all of them given, a survivor knows one it had not learned.
  const engram = base.defs.findIndex((d) => d?.type === "engram" && d.level <= 1 && d.auto === undefined);
  expect(engram).toBeGreaterThan(0);
  expect(h.host.progression.knows(me, engram)).toBe(false);
  expect(set("bAutoUnlockAllEngrams", "True")).toBe("");
  expect(h.host.progression.knows(me, engram)).toBe(true);
  expect(ada.state).toBe("active");
  h.host.shutdown();
});

test("a tuning grown long while the server runs still fits the welcome", () => {
  const { h } = served();
  // A stack size for every item that stacks: a tuning of many thousand characters, where the welcome was sized for none.
  const lines: string[] = [];
  for (let k = 1; k < base.defs.length; k++) if (base.defs[k]?.type === "item" && base.stack[k]! > 1) lines.push(`(ItemClassString="${base.ids[k]}",Quantity=(MaxItemQuantity=${base.stack[k]! + 1},bIgnoreMultiplier=True))`);
  expect(lines.length).toBeGreaterThan(40);
  expect(h.host.pageSetting("ConfigOverrideItemMaxQuantity", lines.join("\n")).why).toBe("");
  h.run(120);
  expect(h.world.reg.tuning.length).toBeGreaterThan(2000);
  const late = h.join("late");
  h.run(500);
  expect([late.state, late.registry.hash, late.registry.stack[THATCH]]).toEqual(["active", h.world.reg.hash, 201]);
  h.host.shutdown();
});

test("once content is replaced nothing on the server reads the content it replaced", () => {
  // The server starts on tuned content, which is its alone and so can be watched: the content as written is every test's.
  const { h, sessions, rec, set } = served(["ada", "bob"], "ItemStackSizeMultiplier=2");
  const pilot = h.pilots[0]!;
  const old = h.world.reg;
  expect(old === h.reg).toBe(false);
  expect(set("PlayerCharacterStaminaDrainMultiplier", "3")).toBe("");
  expect(h.world.reg === old).toBe(false);
  const read: string[] = [];
  for (const key of ["defs", "stack", "spoilTicks", "fuelTicks", "stationFuel", "recipeOf", "move", "tamedMove", "vehicle", "nodeHits"] as const) {
    const value = old[key];
    // A read is noted with where it came from, so a failure names the holder.
    Object.defineProperty(old, key, { get: () => (read.push(`${key} ${(new Error().stack ?? "").split("\n").slice(2, 5).map((l) => l.trim().replace(/^at /, "").replace(/\(.*\/(server|shared)\//, "($1/")).join(" < ")}`), value) });
  }
  // The world goes on: survivors run, things are made, given and dropped, a creature and a car are put in it, a minute passes.
  const me = rec(sessions[0]!);
  h.say(sessions[0]!, "enablecheats");
  h.host.items.mint(me, THATCH, 900);
  h.host.items.mint(me, BERRY, 50);
  h.host.items.give(me, rec(sessions[1]!), THATCH, 300);
  for (const line of ["spawn dodo", "gmsummon dodo", "spawn zephyr", "driver zephyr", "addxp 5000", "give hatchet 1", "kit tools", "kit bow", "place campfire", "hurt 20", "settime 12", "save"]) {
    expect([line, h.say(sessions[0]!, line).join(" ")]).not.toEqual([line, expect.stringMatching(/unknown command/)]);
  }
  pilot.moveZ = 127;
  h.run(60_000);
  expect([...new Set(read)]).toEqual([]);
  expect(sessions.map((s) => s.state)).toEqual(["active", "active"]);
  h.host.shutdown();
});
