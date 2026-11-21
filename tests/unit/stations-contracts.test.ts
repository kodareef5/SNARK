// The stations wave's contracts (planning/reference/stations-plan.md, S0): the numbers it took, OWN_STATION's layout, the
// save's new fields, the stubs later projects build on, and the two built with no content using them, a station's own
// fuel and a lit station counted as the station it is out. A project that builds one moves its pin here in the same change.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stationRecipes } from "../../client/core/ui/station.ts";
import { BUILDING_CONTENT } from "../../content/building.ts";
import { CORE_CONTENT, CORE_PACK } from "../../content/core.ts";
import { RESOURCES } from "../../content/items/resources.ts";
import { RecordCodec, idMap } from "../../server/persist/codec.ts";
import { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { DEADLINE_FIRE } from "../../server/stations.ts";
import { DEADLINE_CRAFT } from "../../server/progression.ts";
import { FIELDS, classRow } from "../../shared/content/classes.ts";
import type { CraftFacet, ItemDef } from "../../shared/content/defs.ts";
import { compilePacks, type ContentPack } from "../../shared/content/packs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { deriveRegistry } from "../../shared/content/tuning.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import * as P from "../../shared/net/protocol.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const root = join(import.meta.dir, "../..");
const id = (r: Registry, name: string): number => r.index.get(name.includes(":") ? name : `core:${name}`)!;

test("protocol 17 and record format 7 are the stations wave's, and it took no command, own component, event, saved component or deadline", () => {
  // 16 is the flyers', and 18, after this wave's 17, the vehicles' (tests/integration/vehicle-contracts.test.ts).
  expect([P.PROTOCOL_VERSION, P.OWN_STATION]).toEqual([41, 16]);
  // 19 adds rotorcraft state and CMD_VEHICLE (32), 22 CMD_STATICS (33), 25 CMD_CORPSE (34), 34 CMD_CLOCK (35), 35 the ticks given up in a snapshot, 36 a late input's buttons carried, 37 a survivor's emote and CMD_EMOTE (36).
  // EVENT_NAME_BYTES is a size, not a kind of event.
  const most = (prefix: string): number => Math.max(...Object.entries(P).filter(([k]) => k.startsWith(prefix) && k !== "EVENT_NAME_BYTES").map(([, v]) => v as number));
  // 40 is the soul balls': OWN_KEPT (17), EVENT_BALL (8), and the saved mark of a tame kept in one (COMP_STORED, 25), which a
  // record not kept does not write (tests/integration/balls.test.ts, tests/unit/creature-save.test.ts).
  expect([most("CMD_"), most("OWN_"), most("EVENT_"), P.BUTTON_BITS]).toEqual([36, 17, 8, 10]);
  const store = readFileSync(join(root, "server/persist/codec.ts"), "utf8");
  expect([/const RECORD_FORMAT = (\d+);/.exec(store)?.[1], Math.max(...[...store.matchAll(/const COMP_\w+ = (\d+);/g)].map((m) => Number(m[1])))]).toEqual(["7", 25]);
  // A lane ends on the fire's own deadline, a powered job on the craft deadline: no deadline of its own. 15 is the found
  // cars' return and 12 the supply drops'.
  const deadlines = readdirSync(join(root, "server")).filter((f) => f.endsWith(".ts")).flatMap((f) => [...readFileSync(join(root, "server", f), "utf8").matchAll(/export const DEADLINE_\w+ = (\d+);/g)].map((m) => Number(m[1])));
  expect([deadlines.sort((a, b) => a - b), DEADLINE_FIRE, DEADLINE_CRAFT]).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15], 6, 4]);
});

test("the fields: a station's own fuel is built, the forge's (S1) are built, and the rest are stubs that wait for stations, each its project's", () => {
  expect(FIELDS.structure.burns.waits).toBeUndefined();
  // S1 built cooks, dry, burnsInto and craft.fired (the refining forge); S2 `powered` (server/power.ts,
  // tests/integration/fabricator.test.ts); S3 `keeps` on structures and `cooks: false` too (server/preserve.ts, the hearth;
  // tests/integration/preserving.test.ts).
  expect([FIELDS.structure.cooks.waits, FIELDS.structure.keeps.waits, FIELDS.structure.powered.waits, FIELDS.structure.dry.waits]).toEqual([undefined, undefined, undefined, undefined]);
  expect([FIELDS.item.burnsInto.waits, FIELDS.item.craft.stubs]).toEqual([undefined, undefined]);
  for (const f of ["burns", "cooks", "keeps", "powered", "dry"]) expect([f, classRow("structure/station")!.may.includes(f)]).toEqual([f, true]);
  // A container may keep things longer too, as the feeding trough will.
  expect(classRow("structure/container")!.may.includes("keeps")).toBe(true);
  expect(classRow("structure/station")).toMatchObject({ status: "partial", waits: "stations" });
});

test("the eight resources are plain items at their pages' weights and stacks, and cementing paste moved here unchanged; the ingot has no engram and is not made in the hand", () => {
  const def = (name: string): ItemDef => RESOURCES.find((d) => d.id === `core:${name}` && d.type === "item") as ItemDef;
  const plain = ["charcoal", "gasoline", "oil", "crystal", "obsidian", "silica_pearls", "polymer", "electronics"];
  expect(plain.map((n) => [n, def(n).weight, def(n).stack, def(n).class, def(n).fuel])).toEqual(
    [0.25, 0.1, 0.2, 1, 1, 0.02, 0.25, 0.01].map((w, k) => [plain[k], w, 100, "resource", undefined]),
  );
  // Gasoline is made by the forge itself since S1 (charcoal is what wood leaves), polymer and electronics at the fabricator
  // since S2; the rest are not made yet. The four found in the world come from the resource nodes' project's nodes
  // (content/items/nodes.ts).
  const yielded = new Set(CORE_CONTENT.flatMap((d) => (d.type === "node" ? d.yields.map((y) => y.item) : [])));
  expect([plain.filter((n) => reg.recipeOf[id(reg, n)] !== null), plain.filter((n) => yielded.has(`core:${n}`))]).toEqual([["gasoline", "polymer", "electronics"], ["oil", "crystal", "obsidian", "silica_pearls"]]);
  const paste = CORE_CONTENT.find((d) => d.id === "core:paste" && d.type === "item") as ItemDef;
  // S0 moved it unchanged; S6 made it at the mortar and pestle at ARK's numbers (tests/unit/ark-stations.test.ts).
  expect(paste).toMatchObject({ class: "resource", stack: 100, weight: 0.01, label: "cementing paste", color: 15, craft: { needs: [{ item: "core:chitin", count: 4 }, { item: "core:stone", count: 8 }], seconds: 1, xp: 4.8, at: "core:mortar" } });
  expect(RESOURCES.filter((d) => d.id === "core:paste" || d.id === "core:engram-paste").map((d) => d.type).sort()).toEqual(["engram", "item"]);
  expect(BUILDING_CONTENT.some((d) => d.id.includes("paste"))).toBe(false);
  // The ingot: no engram and no hand recipe; since S1 the forge makes it by itself.
  expect([reg.index.has("core:engram-ingot"), reg.firedAt[id(reg, "ingot")], reg.craftAt[id(reg, "ingot")]]).toEqual([false, id(reg, "forge"), id(reg, "forge")]);
  expect(CORE_CONTENT.some((d) => d.type === "engram" && d.item === "core:ingot")).toBe(false);
});

test("the core pack compiles to the columns: each station is its own base, a fire lit and out is one, only the fabricator and the preserving bin name their own fuel, the fabricator alone is powered, the forge and fabricator are dry, none of the three cooks, and the bin's lit kind alone keeps longer", () => {
  const structures = reg.defs.flatMap((d, k) => (d?.type === "structure" ? [k] : []));
  const forge = [id(reg, "forge"), id(reg, "forge_lit")];
  const fabricator = [id(reg, "fabricator"), id(reg, "fabricator_lit")];
  const both = [...forge, ...fabricator].sort((a, b) => a - b);
  expect([reg.stationBase[id(reg, "campfire")], reg.stationBase[id(reg, "campfire_lit")], reg.stationBase[id(reg, "mortar")], reg.stationBase[id(reg, "stone")]]).toEqual([id(reg, "campfire"), id(reg, "campfire"), id(reg, "mortar"), 0]);
  const bin = [id(reg, "preserving_bin"), id(reg, "preserving_bin_lit")];
  // The soul vault (content/items/balls.ts): gasoline alone, an hour a piece; it makes and cooks nothing, keeps food no
  // longer, and is not powered, having no jobs. Its burning kind alone holds a charge (Registry.charges).
  const vault = [id(reg, "soul_vault"), id(reg, "soul_vault_lit")];
  expect(structures.filter((k) => k !== id(reg, "campfire_lit") && k !== forge[1] && k !== fabricator[1] && k !== bin[1] && k !== vault[1] && reg.stationBase[k] !== k)).toEqual([]);
  const byIndex = (ks: number[]): number[] => [...ks].sort((a, b) => a - b);
  // S2's fabricator: gasoline alone, powered, not lit under water, and it cooks nothing (stations-plan.md, S2).
  // S3's preserving bin: sparkpowder alone, half an hour a piece (Preserving Bin), and it cooks nothing.
  expect(reg.stationFuel.flatMap((t, k) => (t === null ? [] : [k]))).toEqual(byIndex([...fabricator, ...bin, ...vault]));
  expect([reg.stationFuel[vault[0]!]![id(reg, "gasoline")], reg.stationFuel[vault[0]!]!.filter((v) => v !== 0).length]).toEqual([3600 * TICK_RATE, 1]);
  expect(vault.map((k) => [reg.stationBase[k], reg.stationCooks[k], reg.structKeeps[k], reg.keeps[k], reg.powered[k], reg.dry[k], reg.charges[k]])).toEqual([[vault[0], 0, 1, 1, 0, 1, 0], [vault[0], 0, 1, 1, 0, 1, 1]]);
  expect(structures.filter((k) => reg.charges[k] !== 0)).toEqual([vault[1]!]);
  expect(structures.filter((k) => reg.structKeeps[k] !== 1 || reg.powered[k] !== 0)).toEqual(byIndex([...fabricator, bin[1]!]));
  expect(fabricator.map((k) => [reg.stationBase[k], reg.stationCooks[k], reg.powered[k], reg.dry[k]])).toEqual(fabricator.map(() => [fabricator[0], 0, 1, 1]));
  expect([reg.stationFuel[bin[0]!]![id(reg, "sparkpowder")], reg.stationFuel[bin[0]!]!.filter((v) => v !== 0).length]).toEqual([1800 * TICK_RATE, 1]);
  // Its lit kind keeps 10 times as long, Registry.keeps with it; out, it keeps as the hand does.
  expect(bin.map((k) => [reg.stationBase[k], reg.stationCooks[k], reg.structKeeps[k], reg.keeps[k], reg.powered[k], reg.dry[k]])).toEqual([[bin[0], 0, 1, 1, 0, 0], [bin[0], 0, 10, 10, 0, 0]]);
  // S1's forge: it burns every item's own fuel, is not powered, is dry and does not cook; the ingot and gasoline are fired
  // at it, and wood leaves charcoal. Since S6 the preserving bin makes both jerkies (tests/unit/ark-stations.test.ts).
  expect([structures.filter((k) => reg.stationCooks[k] !== 1), structures.filter((k) => reg.dry[k] !== 0)]).toEqual([byIndex([...both, ...bin, ...vault]), byIndex([...both, ...vault])]);
  expect([[...reg.firedAt].flatMap((v, k) => (v === 0 ? [] : [[reg.ids[k], reg.ids[v]]])).sort(), [...reg.burnsInto].flatMap((v, k) => (v === 0 ? [] : [[reg.ids[k], reg.ids[v]]]))]).toEqual([[["core:gasoline", "core:forge"], ["core:ingot", "core:forge"], ["core:jerky", "core:preserving_bin"], ["core:jerky_prime", "core:preserving_bin"]], [["core:wood", "core:charcoal"]]]);
  // Sparkpowder is made at the mortar, as before, and since S6 the narcotic, cementing paste and gunpowder (tests/unit/ark-stations.test.ts).
  expect([reg.craftAt[id(reg, "sparkpowder")], stationRecipes(reg, id(reg, "mortar")).map((k) => reg.ids[k]).sort()]).toEqual([id(reg, "mortar"), ["core:gunpowder", "core:narcotic", "core:paste", "core:sparkpowder"]]);
});

/** A test station that lights, named by its unlit and lit ids, burning only sparkpowder 2 s a piece, and a loaf made at it. */
const OVEN = (more: Record<string, unknown> = {}, lit: Record<string, unknown> = {}): ContentPack => ({
  name: "test",
  requires: ["core"],
  defs: [
    { id: "test:oven", type: "structure", class: "station", mesh: "box", color: 4, half: [0.5, 0.5, 0.5], hp: 1000, slots: 10, lights: "test:oven_lit", burns: [{ item: "core:sparkpowder", seconds: 2 }], ...more },
    { id: "test:oven_lit", type: "structure", class: "station", mesh: "box", color: 8, half: [0.5, 0.5, 0.5], hp: 1000, slots: 10, lights: "test:oven", lit: true, burns: [{ item: "core:sparkpowder", seconds: 2 }], ...more, ...lit },
    { id: "test:loaf", type: "item", class: "resource", stack: 10, craft: { needs: [{ item: "core:berry", count: 1 }], seconds: 1, xp: 1, at: "test:oven_lit" } },
    { id: "test:engram-loaf", type: "engram", label: "Loaf", level: 1, cost: 0, item: "test:loaf" },
  ],
});
const oven = compilePacks([CORE_PACK, OVEN()]).registry!;

test("what the registry refuses of the new fields", () => {
  const faults = (pack: ContentPack): string[] => compilePacks([CORE_PACK, pack]).errors;
  expect(faults(OVEN())).toEqual([]);
  expect(faults(OVEN({}, { burns: [{ item: "core:sparkpowder", seconds: 3 }] }))).toEqual(["test:oven: it and test:oven_lit, lit and out, must agree on burns, cooks, powered and dry"]);
  expect(faults(OVEN({}, { powered: true }))).toEqual(["test:oven: it and test:oven_lit, lit and out, must agree on burns, cooks, powered and dry"]);
  // Stubs are checked before anything reads them: the lit kind may keep longer than the unlit, as the preserving bin's does.
  expect(faults(OVEN({ cooks: false, powered: true, dry: true }, { keeps: 10 }))).toEqual([]);
  expect(faults(OVEN({ burns: [{ item: "core:mortar", seconds: 2 }] }))).toEqual(['test:oven: "core:mortar" is not an item', 'test:oven_lit: "core:mortar" is not an item']);
  expect(faults(OVEN({ burns: [{ item: "core:wood", seconds: 0 }, { item: "core:wood", seconds: 1 }] }))).toContain("test:oven: burns names each fuel once");
  expect(faults(OVEN({}, { keeps: 0 }))).toEqual(["test:oven_lit: keeps must be in (0, 1000], got 0"]);
  const loaf = (craft: Record<string, unknown>, more: Record<string, unknown> = {}): ContentPack => ({ ...OVEN(), defs: OVEN().defs.map((d) => (d.id === "test:loaf" ? { ...d, ...more, craft: { ...(d as unknown as { craft: CraftFacet }).craft, ...craft } } : d)) });
  expect(faults(loaf({ fired: true }))).toEqual([]);
  expect(faults(loaf({ fired: true, at: "core:mortar" }))).toEqual(["test:loaf: only a fire makes a thing by itself, so craft.fired needs craft.at to name a station that lights"]);
  // What a fuel leaves is an item, and only a fuel leaves anything.
  expect(compilePacks([CORE_PACK, { name: "test", requires: ["core"], defs: [...OVEN().defs, { id: "test:ash", type: "item", class: "resource", stack: 100, fuel: 1, burnsInto: "core:stone" }] }]).errors).toEqual([]);
  expect(compilePacks([CORE_PACK, { name: "test", requires: ["core"], defs: [...OVEN().defs, { id: "test:ash", type: "item", class: "resource", stack: 100, burnsInto: "core:stone" }] }]).errors).toEqual(["test:ash: burnsInto names another item, and only a fuel has it"]);
  expect(compilePacks([CORE_PACK, { name: "test", requires: ["core"], defs: [...OVEN().defs, { id: "test:ash", type: "item", class: "resource", stack: 100, fuel: 1, burnsInto: "test:oven" }] }]).errors).toEqual(['test:ash: "test:oven" is not an item']);
  // Compiled: the oven's table, the loaf made at the oven's base, and its stubs where they are said.
  const fired = compilePacks([CORE_PACK, loaf({ fired: true })]).registry!;
  expect([fired.firedAt[id(fired, "test:loaf")], fired.craftAt[id(fired, "test:loaf")]]).toEqual([id(fired, "test:oven"), id(fired, "test:oven")]);
  const k = id(oven, "test:oven");
  expect([oven.stationFuel[k]![id(oven, "sparkpowder")], oven.stationFuel[k]![id(oven, "wood")], oven.stationFuel[id(oven, "test:oven_lit")]![id(oven, "sparkpowder")]]).toEqual([2 * TICK_RATE, 0, 2 * TICK_RATE]);
  const stubbed = compilePacks([CORE_PACK, OVEN({ cooks: false, powered: true, dry: true }, { keeps: 10 })]).registry!;
  expect([stubbed.stationCooks[k], stubbed.powered[k], stubbed.dry[k], stubbed.structKeeps[k], stubbed.structKeeps[id(stubbed, "test:oven_lit")]]).toEqual([0, 1, 1, 1, 10]);
  // The fuel setting scales a station's own fuel as it scales every item's.
  expect([deriveRegistry(oven, { fuel: 2 }).stationFuel[k]![id(oven, "sparkpowder")], deriveRegistry(oven, { fuel: 2 }).fuelTicks[id(oven, "wood")]]).toEqual([4 * TICK_RATE, 2 * oven.fuelTicks[id(oven, "wood")]!]);
});

/** The section headers are added for the caller. */
function rulesOf(mode: string[]) {
  const made = loadConfig({ gus: "[ServerSettings]", game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") }, []);
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
}

/** A Harness on the oven's content with ada joined, cheats on, standing beside a level spot. */
function bakery(host: ConstructorParameters<typeof Harness>[3] = {}) {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, ...host }, oven);
  const s = h.join("ada");
  h.run(400);
  const at = flatGround(h, 30, 30);
  h.say(s, "enablecheats");
  h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const place = (): number => h.world.structs.add(id(oven, "test:oven"), at.x + 11, at.y + 0.5, at.z + 10, 0, me.team, 1000);
  return { h, s, me, place };
}

test("a station that names its own fuel burns only that, at its own times, tells whoever has it open when it goes out, and calls every listener at the tick it swaps", () => {
  const { h, s, place } = bakery();
  try {
    const ref = place();
    const rec = h.host.fixtures.ensure(ref);
    const swaps: [number, number, number][] = [];
    h.host.stations.onSwap((r, t, from, to) => void (r === rec && swaps.push([t, from, to])));
    h.host.items.mint(rec, id(oven, "wood"), 5);
    // Wood is a campfire's fuel, not the oven's.
    expect(h.host.stations.toggle(ref)).toBe(P.RESULT_SHORT);
    h.host.items.mint(rec, id(oven, "sparkpowder"), 2);
    const lit = h.world.tick;
    expect(h.host.stations.toggle(ref)).toBe(P.RESULT_OK);
    const [unlit, burning] = [id(oven, "test:oven"), id(oven, "test:oven_lit")];
    // One piece burning at once (2 s), one left: out 4 s after lighting.
    expect([rec.kind, rec.fire!.fuel, rec.fire!.out, rec.inv!.total(id(oven, "sparkpowder")), swaps]).toEqual([burning, 2 * TICK_RATE, lit + 4 * TICK_RATE, 1, [[lit, unlit, burning]]]);
    // Opened, the session is told the tick it goes out, with no lanes and no jobs.
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(P.CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));
    h.run(200);
    expect([code, s.station]).toEqual([P.RESULT_OK, { kind: burning, ref, out: lit + 4 * TICK_RATE, lanes: [], jobs: [] }]);
    // What later projects fill travels as laid out: a lane (its done tick is S1's), and a job's paused unit.
    rec.fire!.lanes = [{ item: id(oven, "test:loaf"), ticks: 7 }];
    rec.jobs.push({ item: id(oven, "test:loaf"), left: 2, doneAt: 0, rest: 45 });
    rec.progVersion++;
    h.run(200);
    expect(s.station).toEqual({ kind: burning, ref, out: lit + 4 * TICK_RATE, lanes: [{ item: id(oven, "test:loaf"), doneAt: 0 }], jobs: [{ item: id(oven, "test:loaf"), left: 2, doneAt: 0, rest: 45 }] });
    rec.jobs.length = 0;
    rec.progVersion++;
    rec.fire!.lanes = [];
    // It goes out on its deadline with nobody touching it, at the tick its fuel ran out, and the wood is still there.
    h.run(5000);
    expect([rec.kind, rec.fire, rec.inv!.total(id(oven, "sparkpowder")), rec.inv!.total(id(oven, "wood")), swaps]).toEqual([unlit, null, 0, 5, [[lit, unlit, burning], [lit + 4 * TICK_RATE, burning, unlit]]]);
    expect(s.station).toEqual({ kind: unlit, ref, out: 0, lanes: [], jobs: [] });
    // Put out by hand, the swap is at that tick.
    h.host.items.mint(rec, id(oven, "sparkpowder"), 1);
    h.host.stations.toggle(ref);
    h.run(500);
    const out = h.world.tick;
    h.host.stations.toggle(ref);
    expect(swaps.slice(2).map(([t, from, to]) => [t === out, from, to])).toEqual([[false, unlit, burning], [true, burning, unlit]]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a station's own fuel burns as long as the fuel setting says, and a save made under one setting and loaded under another has the piece burning rescaled", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-oven-"));
  const dbPath = join(dir, "world.db");
  try {
    let { h, place } = bakery({ dbPath });
    const ref = place();
    let rec = h.host.fixtures.ensure(ref);
    h.host.items.mint(rec, id(oven, "sparkpowder"), 2);
    expect(h.host.stations.toggle(ref)).toBe(P.RESULT_OK);
    h.run(1000);
    h.host.items.inv(rec);
    const left = rec.fire!.fuel;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(2 * TICK_RATE);
    h.host.shutdown();
    // Under twice the fuel time, what was left of the piece burning lasts twice as long, and the next piece 4 s.
    h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, dbPath, config: rulesOf(["FuelConsumptionIntervalMultiplier=2"]) }, oven);
    rec = h.host.fixtures.find(ref)!;
    expect(h.world.reg.stationFuel[id(oven, "test:oven")]![id(oven, "sparkpowder")]).toBe(4 * TICK_RATE);
    const fire = rec.fire!;
    expect([fire.fuel, fire.out - fire.at - fire.fuel]).toEqual([2 * left, 4 * TICK_RATE]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lit station and the same station out are one station to what is made at it, whichever of the two its craft names", () => {
  const { h, me, place } = bakery();
  try {
    const ref = place();
    const rec = h.host.fixtures.ensure(ref);
    const loaf = id(oven, "test:loaf");
    // The loaf names the lit kind; it compiles to the unlit, and both list it.
    expect([oven.craftAt[loaf], stationRecipes(oven, id(oven, "test:oven")), stationRecipes(oven, id(oven, "test:oven_lit"))]).toEqual([id(oven, "test:oven"), [loaf], [loaf]]);
    me.engrams.push(id(oven, "test:engram-loaf"));
    h.host.items.mint(rec, id(oven, "berry"), 4);
    expect(h.host.progression.craftAt(me, rec, loaf, 1)).toBe(P.RESULT_OK);
    h.host.items.mint(rec, id(oven, "sparkpowder"), 3);
    expect([h.host.stations.toggle(ref), rec.kind]).toEqual([P.RESULT_OK, id(oven, "test:oven_lit")]);
    expect(h.host.progression.craftAt(me, rec, loaf, 1)).toBe(P.RESULT_OK);
    h.run(2500);
    expect(h.host.items.inv(rec).total(loaf)).toBe(2);
    // Made in the hand it is refused, and what is no station of it is no station of it.
    expect(h.host.progression.craft(me, loaf, 1)).toBe(P.RESULT_DENIED);
    expect(h.host.progression.craftAt(me, rec, id(oven, "spear"), 1)).toBe(P.RESULT_INVALID);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a fire's piece and lanes and a job's paused unit are saved and loaded, and one whose content is gone is dropped", () => {
  const ids = reg.ids.map((s, i): [string, number] => [s, i]);
  const codec = new RecordCodec(Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, ids, reg.ids.length), false);
  const rec = new EntityRecord(77, id(reg, "campfire_lit"));
  rec.at = 0x30005;
  const [wood, ingot, spark, spear] = ["wood", "ingot", "sparkpowder", "spear"].map((n) => id(reg, n)) as [number, number, number, number];
  rec.fire = { at: 1000, fuel: 300, cook: 12, due: 0, out: 0, piece: wood, lanes: [{ item: ingot, ticks: 450 }, { item: spark, ticks: 3 }] };
  rec.jobs.push({ item: spark, left: 3, doneAt: 4000, by: 99, rest: 120 }, { item: spear, left: 1, doneAt: 0 });
  rec.xp = 5;
  const bytes = codec.encode(rec).slice();
  expect(bytes[0]).toBe(7);
  const row = { pid: 77, kind: rec.kind, x: 0, y: 0, z: 0, yaw: 0, data: bytes };
  const back = codec.decode(row)!;
  expect([back.fire, back.jobs]).toEqual([{ at: 1000, fuel: 300, cook: 12, due: 0, out: 0, piece: wood, lanes: [{ item: ingot, ticks: 450 }, { item: spark, ticks: 3 }] }, [{ item: spark, left: 3, doneAt: 4000, by: 99, rest: 120 }, { item: spear, left: 1, doneAt: 0 }]]);
  // Read by a build that lacks the ingot (its saved row names something else), the ingot's lane alone is dropped.
  const without = new RecordCodec(Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, ids.map(([s, i]): [string, number] => [i === ingot ? "gone:thing" : s, i]), reg.ids.length), false);
  expect(without.decode(row)!.fire!.lanes).toEqual([{ item: spark, ticks: 3 }]);
});

test("a creature told only to wander keeps every part of its record", () => {
  const ids = reg.ids.map((s, i): [string, number] => [s, i]);
  const codec = new RecordCodec(Uint16Array.from(reg.ids, (_, i) => i), idMap(reg, ids, reg.ids.length), false);
  const rec = new EntityRecord(78, id(reg, "dodo"));
  rec.wander = true;
  rec.team = 2;
  rec.xp = 5;
  const back = codec.decode({ pid: 78, kind: rec.kind, x: 0, y: 0, z: 0, yaw: 0, data: codec.encode(rec).slice() })!;
  expect([back.wander, back.team, back.xp]).toEqual([true, 2, 5]);
});
