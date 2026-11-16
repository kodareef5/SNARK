// Round 5 end to end: the operator, live changes, the client on tuned content, and the settings catalogue.

import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { App } from "../../client/core/app.ts";
import { CLOSED_BAD_CONTENT } from "../../client/core/session.ts";
import { KEY_CHAR_ENGRAM, KEY_CHAR_RECIPE, TAB_ENGRAMS } from "../../client/core/ui/character.ts";
import { KEY_STATUS, KEY_VITAL } from "../../client/core/ui/hud.ts";
import type { EntityRecord } from "../../server/records.ts";
import { CATALOG, catalogCounts, catalogFaults } from "../../server/settings/catalog.ts";
import { formatReport, loadConfig, loadConfigFolder } from "../../server/settings/config.ts";
import { FEATURES, NOT_HERE } from "../../server/settings/row.ts";
import { EVENTS } from "../../server/events/catalog.ts";
import { CLASSES } from "../../shared/content/classes.ts";
import { Rules } from "../../server/settings/rules.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { ORDER_MATE } from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { GROWN, MATE_TICKS, growthStep, leftAtPeriod, leftAtSpeed } from "../../shared/sim/breeding.ts";
import { STAMINA_UNITS } from "../../shared/sim/character.ts";
import { V_FOOD, V_TORPOR } from "../../shared/sim/vitals.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { flatGround } from "../fixtures/arena.ts";
import { nodesOf, standFacing } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const pack = parsePack(corePackBytes());
const CONFIG = resolve(import.meta.dir, "../../config");

function camp(rules: Rules, host: { dbPath?: string } = {}) {
  const h = new Harness({}, 1, 60, { dev: true, config: rules, ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 40);
  const at = { x: g.x + 20, z: g.z + 6, y: g.y };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const of = (e: number): EntityRecord => h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  return { h, ada, at, me, of };
}

function oneTick(h: Harness): void {
  const t = h.world.tick;
  while (h.world.tick === t) h.run(4);
}

test("operator: a server started from the 50x folder says what it applied, and a survivor there earns, gathers, tames, hatches and raises at the factors its files give; and a file written for ARK itself still starts a server", () => {
  const { rules, report } = loadConfigFolder(join(CONFIG, "boosted-50x"));
  const said = formatReport(report, rules);
  expect(said[0]).toBe("settings: 15 applied, 0 not yet effective, 0 of no meaning here, 0 unknown, 0 refused");
  for (const line of ["XPMultiplier=50", "TamingSpeedMultiplier=50", "HarvestAmountMultiplier=50", "ItemStackSizeMultiplier=10", "EggHatchSpeedMultiplier=50", "BabyMatureSpeedMultiplier=50", "MatingIntervalMultiplier=0.02"]) {
    expect(said.filter((l) => l.startsWith(`  applied   ${line}  (`)).length).toBe(1);
  }
  const plain = camp(new Rules());
  const fast = camp(rules);
  type Camp = typeof plain;

  // The same twelve blows make the same draws, so thatch and experience scale by exactly fifty.
  const fell = (m: Camp) => {
    const tree = nodesOf(m.h, "core:tree", 256, 256).find((t) => standFacing(m.h, m.ada, m.h.pilots[0]!, t))!;
    const field = m.h.host.harvest!.field;
    const xp = m.me.xp;
    let blows = 0;
    while (field.standing(tree.chunk, tree.index) !== 0 && blows < 100) {
      m.h.host.harvest!.strike(m.h.client(m.ada)!, tree.chunk, tree.index);
      blows++;
    }
    return { blows, thatch: m.h.host.items.inv(m.me).total(id("thatch")), xp: m.me.xp - xp };
  };
  const [slow, quick] = [fell(plain), fell(fast)];
  expect([slow.blows, slow.xp, quick.blows, quick.xp, quick.thatch]).toEqual([12, 12, 12, 600, slow.thatch * 50]);
  // The thatch fits because a stack holds ten times as much there.
  expect([plain.h.world.reg.stack[id("thatch")], fast.h.world.reg.stack[id("thatch")]]).toEqual([200, 2000]);

  // Returns the affinity a level 150 raptor gains from its first piece of meat.
  const feed = (m: Camp) => {
    m.h.say(m.ada, `tp ${m.at.x.toFixed(3)} ${m.at.z.toFixed(3)}`);
    const rec = m.of(m.h.host.spawnCreature("core:raptor", m.at.x, m.at.z + 3, 150));
    m.h.host.creatures.mind.stay(m.h.host.records.entOf.get(rec.pid)!, m.h.world.tick + 60);
    m.h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
    m.h.run(100);
    m.h.host.survival.add(rec, V_FOOD, -80);
    m.h.host.items.mint(rec, id("meat"), 20);
    rec.tame!.by = m.me.pid;
    const bites = m.h.host.taming.bites;
    while (m.h.host.taming.bites === bites) m.h.run(100);
    return { rec, affinity: rec.tame ? rec.tame.affinity : -1 };
  };
  const [wary, eager] = [feed(plain), feed(fast)];
  expect([wary.affinity > 0, eager.affinity / wary.affinity]).toEqual([true, 50]);
  for (let k = 0; k < 400 && eager.rec.tame; k++) fast.h.run(1000);
  expect([eager.rec.team, eager.rec.tame, fast.h.host.taming.bites <= 4, wary.rec.team]).toEqual([fast.me.team, null, true, 0]);

  const pair = (m: Camp) => {
    const own = (dx: number, female: boolean): EntityRecord => {
      const rec = m.of(m.h.host.spawnCreature("core:parasaur", m.at.x + dx, m.at.z + 12, 10));
      rec.genome!.female = female;
      m.h.host.taming.give(rec, m.me, 1);
      expect(m.h.host.breeding.order(rec, ORDER_MATE)).toBe(0);
      return rec;
    };
    const mother = own(-2, true);
    own(2, false);
    const from = m.h.world.tick;
    while (m.h.host.breeding.laid === 0 && m.h.world.tick < from + MATE_TICKS + 4 * TICK_RATE) m.h.run(34);
    const egg = [...m.h.host.records.byPid.values()].find((r) => r.egg !== null)!;
    return { mother, egg, took: m.h.world.tick - from };
  };
  const [long, short] = [pair(plain), pair(fast)];
  const incubate = plain.h.reg.incubateTicks[id("parasaur")]!;
  const mature = plain.h.reg.matureTicks[id("parasaur")]!;
  // Mating takes half a minute, an egg an hour and a half, and a mother's wait 18 to 48 hours. Each is a fiftieth on the 50x server.
  expect([long.took >= MATE_TICKS, long.took < MATE_TICKS + 2 * TICK_RATE, short.took <= MATE_TICKS / 50 + 2 * TICK_RATE]).toEqual([true, true, true]);
  expect([long.egg.egg!.span, short.egg.egg!.span]).toEqual([incubate, Math.ceil(incubate / 50)]);
  const waits = (m: Camp, mother: EntityRecord): number => (mother.mateReadyAt - m.h.world.tick) / TICK_RATE / 3600;
  expect([waits(plain, long.mother) > 17.9, waits(plain, long.mother) < 48, waits(fast, short.mother) > 17.9 / 50, waits(fast, short.mother) < 48 / 50]).toEqual([true, true, true, true]);
  // A fiftieth of the incubation is 103 seconds.
  const hatchAt = short.egg.egg!.hatchAt;
  while (fast.h.world.tick < hatchAt + 2) fast.h.run(500);
  // A mating may lay one egg or twins. Every one hatches.
  const babies = [...fast.h.host.records.byPid.values()].filter((r) => r.grown !== 0 && r.egg === null);
  const baby = babies[0]!;
  expect([fast.h.host.breeding.hatched, babies.length, baby.grown - baby.span, baby.span]).toEqual([fast.h.host.breeding.laid, fast.h.host.breeding.laid, hatchAt, Math.ceil(mature / 50)]);
  // Growing up takes 95,238 seconds, a fiftieth of that here.
  for (const one of babies) {
    fast.h.host.taming.give(one, fast.me, 1);
    fast.h.host.items.mint(one, id("berry"), 2000);
    fast.h.host.taming.meal(one);
  }
  const grown = baby.grown;
  expect((grown - hatchAt) / TICK_RATE).toBeCloseTo(95238 / 50, 0);
  while (fast.h.world.tick < grown - 1) fast.h.run(2000 > (grown - 1 - fast.h.world.tick) * 33 ? 4 : 2000);
  expect([baby.grown, baby.dead, growthStep(baby.span, baby.grown, fast.h.world.tick) < GROWN]).toEqual([grown, false, true]);
  while (fast.h.world.tick < grown) oneTick(fast.h);
  expect([fast.h.world.tick, baby.grown, baby.span, baby.dead, fast.h.host.breeding.grownUp, fast.h.host.items.inv(baby).total(id("berry")) < 2000]).toEqual([grown, 0, 0, false, babies.length, true]);
  expect(fast.h.host.items.audit()).toEqual([]);

  // A file written for ARK has keys for features this engine lacks. The server starts and lists each as waiting,
  // with the feature it waits for.
  const arks = loadConfig({
    gus: "[ServerSettings]\nTamingSpeedMultiplier=3\nDinoCountMultiplier=1.5\nPreventOfflinePvP=True\nRCONEnabled=True\nRCONPort=27020\nActiveMods=731604991\nAllowFlyerCarryPvE=True\nSomeModsOwnKey=1\n[SessionSettings]\nSessionName=My ARK server\n",
    game: "[/script/shootergame.shootergamemode]\nBabyCuddleIntervalMultiplier=0.5\nbDisableStructurePlacementCollision=True\nCropGrowthSpeedMultiplier=2\n",
  });
  const h = new Harness({}, 1, 60, { config: arks.rules });
  const joined = h.join("ada");
  h.run(500);
  expect([joined.state, h.host.rules.num("TamingSpeedMultiplier"), arks.report.refused]).toEqual(["active", 3, []]);
  const theirs = formatReport(arks.report, arks.rules);
  expect(theirs[0]).toBe("settings: 3 applied, 7 not yet effective, 1 of no meaning here, 1 unknown, 0 refused");
  expect(theirs.filter((l) => l.startsWith("  not yet   ")).map((l) => [l.slice(12).split("  ")[0], l.includes("): waits for: ")])).toEqual([
    ["PreventOfflinePvP", true],
    ["RCONEnabled", true],
    ["RCONPort", true],
    ["AllowFlyerCarryPvE", true],
    ["BabyCuddleIntervalMultiplier", true],
    ["bDisableStructurePlacementCollision", true],
    ["CropGrowthSpeedMultiplier", true],
  ]);
  expect(theirs).toContain("  not yet   PreventOfflinePvP  (GameUserSettings.ini:4): waits for: offline protection, pvp timers, and hardcore");
  expect(theirs.filter((l) => l.startsWith("  unknown   ") || l.startsWith("  no use    ")).map((l) => l.replace(/^\s+(unknown|no use)\s+(\S+).*$/, "$1 $2"))).toEqual(["no use ActiveMods", "unknown SomeModsOwnKey"]);
  const folders = readdirSync(CONFIG, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  expect(folders.sort()).toEqual(["boosted-10x", "boosted-50x", "dev", "official"]);
  for (const name of folders) {
    const made = loadConfigFolder(join(CONFIG, name));
    expect([name, made.report.refused, made.report.unknown, made.report.waiting.map((w) => w.row.name), made.report.applied.length > 5]).toEqual([name, [], [], [], true]);
  }
});

test("live: a rate changed under a running world times an egg and a young one again, the same watched and unwatched; and a world stopped under one set of files is brought to another once, even if the server dies on the way", () => {
  const files = (hatch: number, mature: number) => loadConfig({ game: `[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=${hatch}\nBabyMatureSpeedMultiplier=${mature}\n` }).rules;
  const world = (watched: boolean, host: { dbPath?: string } = {}) => {
    const h = new Harness({}, 1, 60, { dev: true, config: files(10, 10), ...host });
    const g = flatGround(h, 30, 30);
    if (watched) {
      const ada = h.join("ada");
      h.run(500);
      h.say(ada, "enablecheats");
      h.say(ada, `tp ${(g.x + 15).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
    } else h.run(800);
    const of = (e: number): EntityRecord => h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    const parent = of(h.host.spawnCreature("core:parasaur", g.x + 25, g.z + 25, 3));
    const egg = h.host.records.create(id("egg_parasaur"), "parasaur egg");
    egg.genome = parent.genome;
    egg.x = g.x + 15;
    egg.z = g.z + 8;
    egg.y = g.y;
    egg.egg = { species: id("parasaur"), span: 9000, hatchAt: h.world.tick + 6000, carrier: 0 };
    h.host.death.place(egg);
    h.host.death.die(parent, 0);
    const young = of(h.host.spawnCreature("core:parasaur", g.x + 20, g.z + 12, 3));
    young.span = 30000;
    young.grown = h.world.tick + 20000;
    h.world.ents.setYoung(h.host.records.entOf.get(young.pid)!, young.span, young.grown);
    h.host.refreshBody(young);
    h.host.survival.gods.add(young.pid);
    for (const r of [egg, young]) h.host.records.dirty.add(r.pid);
    h.host.breeding.resume();
    h.run(1000);
    return { h, egg, young };
  };

  // A change while the server runs takes effect on the next tick.
  const story = (watched: boolean) => {
    const { h, egg, young } = world(watched);
    const was = { hatchAt: egg.egg!.hatchAt, grown: young.grown, step: growthStep(young.span, young.grown, h.world.tick) };
    expect([h.host.setSetting("EggHatchSpeedMultiplier", "40"), h.host.setSetting("BabyMatureSpeedMultiplier", "5")]).toEqual(["", ""]);
    oneTick(h);
    const t = h.world.tick;
    expect([egg.egg!.hatchAt, young.grown, growthStep(young.span, young.grown, t)]).toEqual([t + leftAtSpeed(was.hatchAt - t, 10, 40), t + (was.grown - t) * 2, was.step]);
    const e = h.host.records.entOf.get(young.pid)!;
    expect([h.world.ents.span[e], h.world.ents.grown[e]]).toEqual([young.span, young.grown]);
    const hatchAt = egg.egg!.hatchAt;
    while (h.world.tick < hatchAt - 1) oneTick(h);
    expect(h.host.breeding.hatched).toBe(0);
    oneTick(h);
    expect([h.world.tick, h.host.breeding.hatched]).toEqual([hatchAt, 1]);
    return { left: hatchAt - t, grows: young.grown - t };
  };
  expect(story(true)).toEqual(story(false));

  // A world saved under one set of rules and loaded under another is converted by the same arithmetic.
  const dir = mkdtempSync(join(tmpdir(), "snark-exit-"));
  const dbPath = join(dir, "world.db");
  const saved = world(false, { dbPath });
  const T = saved.h.world.tick;
  const pids = [saved.egg.pid, saved.young.pid];
  const was = { hatch: saved.egg.egg!.hatchAt - T, grown: saved.young.grown - T, step: growthStep(saved.young.span, saved.young.grown, T) };
  saved.h.host.shutdown();
  const load = (rules: Rules, commitEvery?: number) => {
    const h = new Harness({}, 1, 60, { dev: true, dbPath, config: rules, ...(commitEvery ? { commitEvery } : {}) });
    const [egg, young] = pids.map((pid) => h.host.records.byPid.get(pid)!);
    return { h, now: [h.world.tick, egg!.egg!.hatchAt - h.world.tick, egg!.egg!.span, young!.grown - h.world.tick, growthStep(young!.span, young!.grown, h.world.tick)] };
  };
  const want = [T, leftAtSpeed(was.hatch, 10, 40), 2250, was.grown * 2, was.step];
  const first = load(files(40, 5), 1e9);
  expect(first.now).toEqual(want);
  // The first load never commits (commitEvery 1e9) and dies. The next converts the save the same way, not twice.
  first.h.host.persistence!.store.close();
  const second = load(files(40, 5));
  expect(second.now).toEqual(want);
  // This one runs long enough to commit the converted save and the rules it was converted under.
  second.h.run(2000);
  const later = second.h.world.tick;
  second.h.host.shutdown();
  // The third load finds the save already converted.
  const third = load(files(40, 5));
  expect([third.now, third.h.host.loadedUnder!.EggHatchSpeedMultiplier]).toEqual([[later, want[1]! - (later - T), 2250, want[3]! - (later - T), growthStep(third.h.host.records.byPid.get(pids[1]!)!.span, third.h.host.records.byPid.get(pids[1]!)!.grown, later)], 40]);
  // Loaded under the first rules again, the timers convert back, to the tick's rounding.
  third.h.host.shutdown();
  const back = load(files(10, 10));
  expect([back.now[1], back.now[2], back.now[3]]).toEqual([leftAtSpeed(want[1]! - (later - T), 40, 10), 9000, leftAtPeriod(want[3]! - (later - T), 2, 1)]);
  back.h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("client: on a server that scales stamina, stacks, what things are made of and engrams, the whole client predicts without a correction and shows the server's numbers; and one that would make other content of it does not stay, and says why", () => {
  const rules = loadConfig({
    gus: "[ServerSettings]\nPlayerCharacterStaminaDrainMultiplier=3\nItemStackSizeMultiplier=2.5\n",
    game: '[/script/shootergame.shootergamemode]\nConfigOverrideItemCraftingCosts=(ItemClassString="core:hatchet",BaseCraftingResourceRequirements=((ResourceItemTypeString="core:thatch",BaseResourceRequirement=2.0,bCraftingRequireExactResourceType=false),(ResourceItemTypeString="core:wood",BaseResourceRequirement=3.0,bCraftingRequireExactResourceType=false)))\nOverrideNamedEngramEntries=(EngramClassName="core:engram-hatchet",EngramPointsCost=1,EngramLevelRequirement=1)\nOverrideNamedEngramEntries=(EngramClassName="core:engram-waterskin",EngramHidden=True)\n',
  }).rules;
  const play = (config: Rules) => {
    const h = new Harness({}, 1, 60, { dev: true, config });
    const app = new App(h.join("ada", { latencyMs: 30 }, { manual: true }), reg, pack);
    const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
    run(600);
    const s = app.session;
    s.text("enablecheats");
    run(300);
    const g = flatGround(h, 60, 60);
    s.text(`tp ${(g.x + 30).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
    run(500);
    const corrections = s.stats.corrections;
    const full = s.own.stamina;
    app.key("KeyW", true);
    app.key("ShiftLeft", true);
    run(2000);
    const spent = full - s.own.stamina;
    const bar = app.ui.frame.find(KEY_VITAL + 3)!.value;
    app.key("ShiftLeft", false);
    app.key("KeyW", false);
    run(500);
    s.text("give wood 600");
    run(500);
    app.key("KeyP", true);
    app.key("KeyP", false);
    app.ui.sheet.tab = TAB_ENGRAMS;
    run(100);
    const rows = (from: number): string[] => {
      const f = app.ui.frame;
      const out: string[] = [];
      for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= from && f.nodes[i]!.key < from + 200 && f.nodes[i]!.key % 2 === 0) out.push(f.nodes[i]!.text);
      return out;
    };
    const engrams = rows(KEY_CHAR_ENGRAM);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    // Enough levels to learn the hatchet on either server.
    h.host.progression.addXp(me, 100);
    expect(h.host.progression.learn(me, id("engram-hatchet"))).toBe(0);
    app.ui.sheet.tab = TAB_ENGRAMS + 1;
    run(300);
    const stacks: number[] = [];
    for (let k = 0; k < s.inventory!.cap; k++) if (s.inventory!.item[k] === id("wood")) stacks.push(s.inventory!.count[k]!);
    return { h, app, s, spent, bar, corrections: s.stats.corrections - corrections, engrams, recipes: rows(KEY_CHAR_RECIPE), stacks: stacks.sort((a, b) => b - a) };
  };
  const plain = play(new Rules());
  const tuned = play(rules);
  expect([plain.corrections, tuned.corrections]).toEqual([0, 0]);
  expect(Math.round((tuned.spent / plain.spent) * 10) / 10).toBe(3);
  expect(tuned.bar).toBeCloseTo(tuned.s.own.staminaMax > 0 ? 1 - tuned.spent / (tuned.s.own.staminaMax * STAMINA_UNITS) : 0, 1);
  expect(tuned.bar).toBeLessThan(plain.bar);
  expect([plain.stacks, tuned.stacks]).toEqual([[100, 100, 100, 100, 100, 100], [250, 250, 100]]);
  expect(plain.engrams).toContain("Stone hatchet: level 2, 3 points");
  expect(plain.engrams.some((l) => l.startsWith("Water skin"))).toBe(true);
  expect(tuned.engrams).toContain("Stone hatchet: level 1, 1 points");
  expect(tuned.engrams.some((l) => l.startsWith("Water skin"))).toBe(false);
  expect([plain.recipes.find((l) => l.startsWith("hatchet")), tuned.recipes.find((l) => l.startsWith("hatchet"))]).toEqual(["hatchet: 1 flint, 1 wood, 10 thatch", "hatchet: 2 thatch, 3 wood"]);
  expect([tuned.s.registry.hash === tuned.h.world.reg.hash, tuned.s.registry === tuned.h.reg, plain.s.registry === plain.h.reg]).toEqual([true, false, true]);

  // A byte of the tuning is flipped on its way to the client, so the client derives other content.
  const h = new Harness({}, 1, 60, { config: rules });
  const session = h.join("mallory", {}, { manual: true });
  const end = h.ends[h.ends.length - 1]!;
  const deliver = end.onMessage!;
  let seen = false;
  end.onMessage = (channel, data) => {
    if (channel === CH_RELIABLE && !seen && data[0] === 1) {
      seen = true;
      data = data.slice();
      data[data.length - 40] ^= 0xff;
    }
    deliver(channel, data);
  };
  const app = new App(session, reg, pack);
  h.run(500, (now) => void app.frame(now, 1280, 720));
  expect([seen, session.state, session.closeReason, session.world, app.ui.frame.find(KEY_STATUS)!.text]).toEqual([true, "closed", CLOSED_BAD_CONTENT, null, "disconnected: this client's content is not this server's"]);
});

test("catalogue: every setting of ARK's the research found is in it as taking effect, waiting for a feature it names, or of no meaning here with the reason; each that takes effect is held by a test; and the reference page is the catalogue", () => {
  expect(catalogFaults()).toEqual([]);
  const counts = catalogCounts();
  expect([counts.all, counts.todo, counts.live + counts.planned + counts.none]).toEqual([526, 0, 526]);
  expect(counts.live).toBeGreaterThanOrEqual(114);
  for (const row of CATALOG) {
    if (row.status === "planned") expect([row.name, row.waits in FEATURES]).toEqual([row.name, true]);
    else if (row.status === "none") expect([row.name, row.waits in NOT_HERE]).toEqual([row.name, true]);
    else expect([row.name, row.status, row.waits]).toEqual([row.name, "live", ""]);
  }
  // Every feature in FEATURES has something waiting for it: a setting, a class of content or an event.
  const waited = new Set<string>([...CATALOG.filter((r) => r.status === "planned").map((r) => r.waits), ...CLASSES.map((r) => r.waits), ...EVENTS.map((r) => r.waits)]);
  expect(Object.keys(FEATURES).filter((f) => !waited.has(f))).toEqual([]);
  // Every live setting's name appears in some test file.
  const tests = ["integration", "unit"].flatMap((d) => readdirSync(resolve(import.meta.dir, "..", d)).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(resolve(import.meta.dir, "..", d, f), "utf8"))).join("\n");
  expect(CATALOG.filter((r) => r.status === "live" && !tests.includes(r.name)).map((r) => r.name)).toEqual([]);
  // The reference page names every setting, with a leading - for a flag.
  const page = readFileSync(resolve(import.meta.dir, "../../planning/reference/settings.md"), "utf8");
  expect(CATALOG.filter((r) => !page.includes(`\`${r.kind === "flag" ? "-" : ""}${r.name}`)).map((r) => r.name)).toEqual([]);
});
