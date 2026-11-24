// The drop book's circuits (server/supply.ts): each calls drops on its own clock, of the tiers and classes its weights
// give, at its sites or on open ground, near whoever is in the world; what ARK's settings do to them; ARK's own override
// of what a crate holds; and the ground a PvE server keeps clear round a site. A Harness keeps circuits from calling
// (bDisableLootCrates), so each test here turns them on.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { APART, RETRY_SECONDS, SITE_CLEAR } from "../../server/supply.ts";
import { DECK_CLEAR } from "../../server/supply/ground.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PLACE, RESULT_DENIED, RESULT_OK, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { writeNew } from "../../shared/net/place.ts";
import { QUALITY_RATING } from "../../shared/sim/items.ts";
import type { CircuitDoc, SupplyBook } from "../../shared/supply/book.ts";
import { simulate } from "../../shared/supply/simulate.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import type { TideEyeSite } from "../../shared/world/tide-eye.ts";
import { builder } from "../fixtures/build.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const CAPSULE = reg.index.get("core:supply_capsule")!;
const dir = mkdtempSync(join(tmpdir(), "snark-circuits-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
type HostMore = ConstructorParameters<typeof Harness>[3];

const GREEN: TideEyeSite = { name: "Green", color: "green", x: 400, z: 120, y: 0, yaw: 0, radius: 70 };
/** Level ground 512 m on a side, with no obelisk unless given: a drop with none lands on its notice exactly. */
const ground = (more: Parameters<typeof flatMap>[1] = {}) => writeMap(flatMap(8, more));
const seconds = (h: Harness, s: number): void => h.run(s * 1000);
const capsules = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === CAPSULE);
const edit = (h: Harness, change: (book: SupplyBook) => void): void => {
  const store = h.host.supplyBook;
  const next = JSON.parse(JSON.stringify(store.book)) as SupplyBook;
  const revision = store.book.revision;
  change(next);
  expect(store.save(next, revision, "test", "")).toEqual({ ok: true, revision: revision + 1 });
};
/** Twelve seconds from call to landing, half a minute on the ground, and a circuit that looks every two or three. */
const quick = (book: SupplyBook, circuit: Partial<CircuitDoc> = {}): void => {
  Object.assign(book.rules, { noticeSeconds: 12, flightSeconds: 5, brakeSeconds: 2, lifeSeconds: 30 });
  book.circuits = [{ key: "c", on: true, sites: [], maxLive: 3, firstDelay: [1, 2], interval: [2, 3], tierWeights: { white: 3, green: 1 }, ...circuit }];
};
const on = (h: Harness): void => void expect(h.host.setSetting("bDisableLootCrates", "False")).toBe("");

/** Ada with cheats at (x, z) on level ground. */
function world(host: HostMore = {}, x = 250, z = 250) {
  const h = new Harness({}, 1, 60, { dev: true, map: ground(), log: () => {}, ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${x} ${z}`);
  h.run(300);
  return { h, ada, me: h.host.records.byPid.get(h.client(ada)!.pid)! };
}

test("a circuit over open ground calls drops near whoever is in the world, as many as it may hold and no more, and again as they go", () => {
  const { h } = world();
  edit(h, (book) => {
    quick(book);
    book.rules.reach = 150;
  });
  const { supply } = h.host;
  // Off, as a Harness has it: it looks, calls nothing, and looks again in a minute.
  seconds(h, 4);
  expect([supply.drops.length, supply.circuits.get("c")!.why, (supply.circuits.get("c")!.due - h.world.tick) / TICK_RATE > RETRY_SECONDS - 5]).toEqual([0, "drops are off (bDisableLootCrates)", true]);
  on(h);
  seconds(h, RETRY_SECONDS + 12);
  // Three live, each its circuit's, on open ground within reach of her and apart from each other.
  expect([supply.live(), supply.circuits.get("c")!.why]).toEqual([3, "the circuit has all the drops it may"]);
  for (const d of supply.drops) {
    expect([d.source, d.circuit, d.site, ["white", "green"].includes(d.tierKey), Math.hypot(d.x - 250, d.z - 250) <= 151]).toEqual(["circuit", "c", "", true, true]);
    for (const other of supply.drops) if (other !== d) expect(Math.hypot(d.x - other.x, d.z - other.z)).toBeGreaterThanOrEqual(APART);
  }
  // They land, lie their half minute and go, and the circuit calls others: more called than it may hold at once.
  seconds(h, 150);
  expect([supply.calls > 6, supply.landings > 3, supply.live() <= 3, capsules(h).length <= 3, h.host.items.audit()]).toEqual([true, true, true, true, []]);
  h.host.shutdown();
});

test("the test of a place: off the map's edge, off an obelisk's deck, dry, open to the sky, and clear of what a tribe built", () => {
  const dry = new Harness({}, 1, 60, { dev: true, map: ground({ tideEyes: [GREEN], statics: [{ kind: "core:foundation", x: 300, y: 40, z: 300, yaw: 0 }] }), log: () => {} });
  const at = (h: Harness, x: number, z: number): string => h.host.supply.siteFault(x, z);
  expect([at(dry, 250, 250), at(dry, 5, 250), at(dry, 250, 508), at(dry, GREEN.x - DECK_CLEAR + 5, GREEN.z), at(dry, GREEN.x - DECK_CLEAR - 5, GREEN.z)]).toEqual(["", "edge", "edge", "deck", ""]);
  // Under something of the map's, forty metres up: not open to the sky. A step out from under it is.
  expect([at(dry, 300, 300), at(dry, 300.9, 300), at(dry, 304, 300)]).toEqual(["roofed", "roofed", ""]);
  // A drop that is live keeps others off its ground.
  const d = dry.host.supply.call({ x: 100, z: 400, tier: "white", cls: "arms", source: "test" });
  expect([typeof d, at(dry, 100 + APART - 1, 400), at(dry, 100 + APART + 1, 400)]).toEqual(["object", "taken", ""]);
  dry.host.shutdown();
  const wet = new Harness({}, 1, 60, { dev: true, map: ground({ seaLevel: 1.5 }), log: () => {} });
  expect(at(wet, 250, 250)).toBe("water");
  wet.host.shutdown();
});

test("nobody in the world, nothing is called; a book that asks for nobody calls anywhere on the map, up to the map's own limit", () => {
  const h = new Harness({}, 1, 60, { dev: true, map: ground(), log: () => {} });
  on(h);
  edit(h, (book) => quick(book, { maxLive: 20 }));
  seconds(h, 8);
  expect([h.host.supply.drops.length, h.host.supply.circuits.get("c")!.why]).toEqual([0, "nobody is in the world"]);
  edit(h, (book) => {
    book.rules.minPlayers = 0;
    book.rules.maxLive = 4;
    book.rules.lifeSeconds = 600;
  });
  seconds(h, RETRY_SECONDS + 40);
  expect([h.host.supply.live(), h.host.supply.circuits.get("c")!.why]).toEqual([4, "the map has all the drops it may"]);
  // A circuit turned off is forgotten, and one turned on again waits its first delay.
  edit(h, (book) => void (book.circuits[0]!.on = false));
  seconds(h, 1);
  expect(h.host.supply.circuits.size).toBe(0);
  h.host.shutdown();
});

test("a circuit with sites calls drops at them alone: those within reach of a survivor, not one a tribe has built near, never two at one site", () => {
  const { h, me } = world();
  on(h);
  edit(h, (book) => {
    quick(book, { sites: ["near", "nearer", "far", "based"], maxLive: 4 });
    book.rules.reach = 110;
    book.rules.baseExclusion = 40;
    book.sites = [{ key: "near", x: 320, z: 250 }, { key: "nearer", x: 250, z: 190 }, { key: "far", x: 420, z: 420 }, { key: "based", x: 200, z: 320 }];
  });
  // A tribe's foundation thirty metres from one of them.
  me.team = h.host.records.newTeam();
  const foundation = reg.index.get("core:foundation_wood")!;
  h.world.structs.add(foundation, 200, reg.halfY[foundation]!, 350, 0, me.team, reg.maxHp[foundation]!);
  const { supply } = h.host;
  expect([supply.siteFault(200, 320), supply.siteFault(320, 250), supply.siteFault(200, 350)]).toEqual(["base", "", "built"]);
  seconds(h, 40);
  // Two sites are fit and in reach, so two drops are live, one at each, however often it looked.
  expect([supply.live(), supply.drops.filter((d) => d.left === 0).map((d) => d.site).sort(), supply.circuits.get("c")!.why]).toEqual([2, ["near", "nearer"], "no fit place"]);
  for (const d of supply.drops) expect([[320, 250], [250, 190]]).toContainEqual([d.x, d.z]);
  seconds(h, 120);
  expect([supply.calls > 4, new Set(supply.drops.map((d) => d.site)).size === supply.drops.length]).toEqual([true, true]);
  // RandomSupplyCratePoints: the sites are passed over for open ground.
  expect(h.host.setSetting("RandomSupplyCratePoints", "True")).toBe("");
  for (const d of [...supply.drops]) supply.cancel(d);
  // It had found no fit place, so its next look is up to a minute off.
  seconds(h, RETRY_SECONDS + 10);
  expect([supply.live() > 0, supply.drops.filter((d) => d.left === 0).every((d) => d.site === "" && Math.hypot(d.x - 250, d.z - 250) <= 111)]).toEqual([true, true]);
  h.host.shutdown();
});

test("AllowCrateSpawnsOnTopOfStructures: a drop may land on a floor a tribe built, and near one; without it nothing lands there", () => {
  const { h, me } = world();
  on(h);
  edit(h, (book) => {
    quick(book, { sites: ["floor"], maxLive: 1 });
    book.sites = [{ key: "floor", x: 280, z: 250 }];
  });
  me.team = h.host.records.newTeam();
  const foundation = reg.index.get("core:foundation_wood")!;
  const top = 2 * reg.halfY[foundation]!;
  h.world.structs.add(foundation, 280, reg.halfY[foundation]!, 250, 0, me.team, reg.maxHp[foundation]!);
  const { supply } = h.host;
  seconds(h, 20);
  expect([supply.drops.length, supply.siteFault(280, 250), supply.circuits.get("c")!.why]).toEqual([0, "built", "no fit place"]);
  expect(h.host.setSetting("AllowCrateSpawnsOnTopOfStructures", "True")).toBe("");
  expect(supply.siteFault(280, 250)).toBe("");
  seconds(h, RETRY_SECONDS + 20);
  const [d] = supply.drops;
  expect([d?.site, d?.landed, Math.abs(d!.y - top) < 0.05, capsules(h)[0]?.y === d!.y]).toEqual(["floor", true, true, true]);
  h.host.shutdown();
});

test("SupplyCrateLootQualityMultiplier raises what every table rolls, from the next drop on", () => {
  const { h } = world();
  const { supply } = h.host;
  const rating = (): number => {
    const c = supply.compiled();
    const s = simulate(c, c.tables.get("purple/arms")!, false, 400, 5);
    return s.quality.reduce((sum, share, tier) => sum + share * QUALITY_RATING[tier]!, 0);
  };
  const plain = rating();
  expect(h.host.setSetting("SupplyCrateLootQualityMultiplier", "3")).toBe("");
  const tripled = rating();
  expect([tripled > plain * 1.8, h.host.setSetting("SupplyCrateLootQualityMultiplier", "9")]).toEqual([true, expect.stringContaining("5")]);
  expect(h.host.setSetting("SupplyCrateLootQualityMultiplier", "1")).toBe("");
  expect(rating()).toBe(plain);
  h.host.shutdown();
});

test("ARK's own override wins: a tier it names holds what it says whatever the class, a tier it does not name holds the book's, and the console says so", () => {
  const { rules } = loadConfig({
    game: [
      "[/script/shootergame.shootergamemode]",
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level03_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=2,MaxNumItems=2,bItemsRandomWithoutReplacement=true,ItemEntries=((ItemClassStrings=("core:bow"),MinQuantity=1,MaxQuantity=1,MinQuality=2.5,MaxQuality=2.5),(ItemClassStrings=("core:arrow_stone"),MinQuantity=30,MaxQuantity=30)))))',
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level03_Double_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("core:stone"),MinQuantity=77,MaxQuantity=77)))))',
      'ConfigOverrideSupplyCrateItems=(SupplyCrateClassString="SupplyCrate_Level15_C",MinItemSets=1,MaxItemSets=1,ItemSets=((MinNumItems=1,MaxNumItems=1,ItemEntries=((ItemClassStrings=("PrimalItem_NoSuch_C"),MinQuantity=1,MaxQuantity=1)))))',
    ].join("\n"),
  });
  const said: string[] = [];
  const { h, ada } = world({ config: rules, log: (line) => void said.push(line) });
  expect(said.filter((l) => l.startsWith("ConfigOverrideSupplyCrateItems"))).toEqual([
    'ConfigOverrideSupplyCrateItems: 1 of the things "SupplyCrate_Level15_C" names are not in this build, and are left out of the green drops',
    'ConfigOverrideSupplyCrateItems: "SupplyCrate_Level15_C" names nothing this build has, so the green drops are the drop book\'s',
  ]);
  const { supply } = h.host;
  const drop = (tier: string, cls: string, ringed: boolean): string[] => {
    const d = supply.call({ x: 100 + supply.calls * 70, z: 100, tier, cls, ringed, notice: 1, source: "test" });
    if (typeof d === "string") throw new Error(d);
    expect(supply.hurry(d)).toBe("");
    seconds(h, 1);
    const inv = h.host.items.inv(h.host.records.byPid.get(d.pid)!);
    const out: string[] = [];
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] !== 0) out.push(`${reg.ids[inv.item[s]!]!.slice(5)} x${inv.count[s]} q${inv.quality[s]}`);
    return out.sort();
  };
  // Journeyman is the tier a rating of 2.5 reaches.
  expect([drop("white", "arms", false), drop("white", "voyage", false), drop("white", "works", true)]).toEqual([["arrow_stone x30 q0", "bow x1 q2"], ["arrow_stone x30 q0", "bow x1 q2"], ["stone x77 q0"]]);
  // Green is the book's still: more than the two stacks ARK's would give, and no two classes alike.
  const [arms, works] = [drop("green", "arms", false), drop("green", "works", false)];
  expect([arms.length > 2, works.length > 2, arms.join() !== works.join()]).toEqual([true, true, true]);
  expect(h.say(ada, "supply book").pop()).toBe("ConfigOverrideSupplyCrateItems gives the tables of white");
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("on a PvE server nothing is built within thirty metres of a place drops land at, unless PvEAllowStructuresAtSupplyDrops", () => {
  const { rules } = loadConfig({ gus: ["[ServerSettings]", "serverPVE=True"].join("\n") });
  const made = builder(["ada"], 120, 20, { config: rules, map: ground(), log: () => {} });
  const { h, sessions, at } = made;
  const [ada] = sessions as [ClientSession];
  const U = STRUCT_UNITS;
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  /** Stands `far` metres along the yard and places a foundation on the ground 3 m further on. */
  const found = (far: number): number => {
    h.say(ada, `tp ${(at.x - 58 + far).toFixed(3)} ${at.z.toFixed(3)}`);
    made.hold(ada, "foundation");
    code = -1;
    ada.command(CMD_PLACE, (w: BitWriter) => writeNew(w, 0, Math.round((at.x - 58 + far + 3) * U), Math.round(at.z * U), 0));
    h.run(200);
    return code;
  };
  // A site 20 m along the yard.
  edit(h, (book) => {
    book.sites = [{ key: "yard", x: Math.round(at.x - 58 + 20), z: Math.round(at.z) }];
    book.circuits = [{ key: "c", on: true, sites: ["yard"], maxLive: 1, firstDelay: [600, 600], interval: [600, 600], tierWeights: { white: 1 } }];
  });
  const from = ada.logVersion;
  // 23 m along is three metres from it; 60 m along is forty-three.
  expect([found(20), found(60)]).toEqual([RESULT_DENIED, RESULT_OK]);
  expect(ada.log.slice(-(ada.logVersion - from)).filter((l) => l.channel === TEXT_NOTICE).map((l) => l.text)).toEqual([`Supply drops land here: nothing can be built within ${SITE_CLEAR} m of the place.`]);
  // A circuit switched off keeps its places. One taken out of the book leaves a site that no circuit names, as a book
  // read from a file may: nothing lands there, so it holds nobody's ground.
  edit(h, (book) => void (book.circuits[0]!.on = false));
  expect(h.host.supply.buildFault(at.x - 58 + 23, at.z)).not.toBe("");
  edit(h, (book) => void (book.circuits = []));
  expect([h.host.supplyBook.book.sites.length, h.host.supply.buildFault(at.x - 58 + 23, at.z)]).toEqual([1, ""]);
  edit(h, (book) => void (book.circuits = [{ key: "c", on: true, sites: ["yard"], maxLive: 1, firstDelay: [600, 600], interval: [600, 600], tierWeights: { white: 1 } }]));
  expect(h.host.supply.buildFault(at.x - 58 + 23, at.z)).not.toBe("");
  expect(h.host.setSetting("PvEAllowStructuresAtSupplyDrops", "True")).toBe("");
  expect(found(20)).toBe(RESULT_OK);
  // On a server that is not PvE the rule is not asked at all.
  const pvp = builder(["bob"], 120, 20, { map: ground(), log: () => {} });
  edit(pvp.h, (book) => void (book.sites = [{ key: "yard", x: Math.round(pvp.at.x), z: Math.round(pvp.at.z + 3) }]));
  expect(pvp.h.host.supply.buildFault(pvp.at.x, pvp.at.z + 3)).toBe("");
  h.host.shutdown();
  pvp.h.host.shutdown();
});

test("a circuit keeps its clock through a stop: it looks at the tick it was due, and draws what it would have drawn", () => {
  const run = (db: string, restart: boolean) => {
    const more = { dev: true, map: ground(), log: () => {}, dbPath: db, seed: 5 } as const;
    let h = new Harness({}, 1, 60, more);
    on(h);
    edit(h, (book) => {
      quick(book, { firstDelay: [20, 20], interval: [9, 9], maxLive: 6 });
      book.rules.minPlayers = 0;
      book.rules.lifeSeconds = 600;
    });
    seconds(h, 25);
    const before = [h.host.supply.calls, h.host.supply.circuits.get("c")!.due, h.host.supply.circuits.get("c")!.n];
    if (restart) {
      h.host.shutdown();
      h = new Harness({}, 1, 60, more);
      on(h);
      // The book is the file's, the circuit's clock the save's.
      expect([h.host.supplyBook.starter, h.host.supplyBook.book.revision, h.host.supply.circuits.get("c")!.due, h.host.supply.circuits.get("c")!.n, h.host.supply.mended]).toEqual([false, 1, before[1]!, before[2]!, 0]);
    }
    seconds(h, 30);
    const out = { before, drops: h.host.supply.drops.map((d) => [d.id, d.x, d.z, d.tierKey, d.clsKey, d.ringed, d.called, d.land]), due: h.host.supply.circuits.get("c")!.due };
    h.host.shutdown();
    return out;
  };
  const stopped = run(join(dir, "stopped.db"), true);
  const ran = run(join(dir, "ran.db"), false);
  expect(stopped).toEqual(ran);
  expect(stopped.drops.length).toBeGreaterThanOrEqual(4);
});
