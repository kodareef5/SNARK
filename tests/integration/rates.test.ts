// ARK settings that are plain multipliers and switches. Each must act as ARK's reference says, in the same direction.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { XP_CRAFT, XP_GIVEN, XP_HARVEST, XP_KILL } from "../../server/progression.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { NodeDef } from "../../shared/content/defs.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_ORDER, CMD_STRUCT, ORDER_MATE, REJECT_FULL, REJECT_KICKED, RESULT_DENIED, RESULT_FULL, RESULT_LOCKED, RESULT_OK, RESULT_PIN, RESULT_WAIT, TEXT_MOTD, TEXT_NOTICE } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { STRUCT_PIN, STRUCT_REPAIR, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { builder } from "../fixtures/build.ts";
import { nodesOf, standFacing } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** The section headers are added for the caller. */
function rulesOf(server: string[] = [], mode: string[] = [], argv: string[] = []) {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") }, argv);
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
}

function world(server: string[] = [], mode: string[] = [], argv: string[] = [], host = {}) {
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf(server, mode, argv), ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6, y: g.y };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  return { h, ada, at, me };
}

/** Text on one channel since log version `from`. */
const notices = (s: ClientSession, from = 0, channel = TEXT_NOTICE): string[] => s.log.slice(Math.max(0, s.log.length - (s.logVersion - from))).filter((l) => l.channel === channel).map((l) => l.text);

function knockedOut(h: Harness, at: { x: number; z: number }, species: string, far: number): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(`core:${species}`, at.x, at.z + far, 1);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, h.world.tick + 60);
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  return { e, rec };
}

test("experience earned is multiplied by the rule for all of it and by the rule for how it was earned; what is given outright is not", () => {
  const { h, me } = world(["XPMultiplier=3"], ["KillXPMultiplier=2", "HarvestXPMultiplier=5", "CraftXPMultiplier=0.5"]);
  const p = h.host.progression;
  const gain = (source: number): number => {
    const before = me.xp;
    const said = p.addXp(me, 10, source);
    expect(said).toBe(me.xp - before);
    return said;
  };
  expect([gain(XP_KILL), gain(XP_HARVEST), gain(XP_CRAFT), gain(XP_GIVEN)]).toEqual([60, 150, 15, 10]);
  const plain = world();
  expect([XP_KILL, XP_HARVEST, XP_CRAFT].map((s) => plain.h.host.progression.addXp(plain.me, 10, s))).toEqual([10, 10, 10]);
});

test("harvesting: what a blow yields by the rule for all of it and for each thing, how much of the node a blow takes, and the experience of it", () => {
  const fell = (server: string[], mode: string[]) => {
    const { h, ada, me } = world(server, mode);
    const tree = nodesOf(h, "core:tree", 256, 256).find((t) => standFacing(h, ada, h.pilots[0]!, t))!;
    const table = h.host.harvest!.field.store.chunks[tree.chunk]!;
    const xp = me.xp;
    let blows = 0;
    while (table.kind[tree.index] !== 0 && blows < 100) {
      expect(h.host.harvest!.strike(h.client(ada)!, tree.chunk, tree.index)).toBe(true);
      blows++;
    }
    const inv = h.host.items.inv(me);
    return { blows, thatch: inv.total(id("thatch")), wood: inv.total(id("wood")), xp: me.xp - xp };
  };
  const plain = fell([], []);
  expect([plain.blows, plain.xp, plain.thatch > 20, plain.wood > 0]).toEqual([12, 12, true, true]);
  // The same blows make the same draws, so the yields scale exactly: thatch by 3 times 2, wood by 3.
  const rich = fell(["HarvestAmountMultiplier=3"], ['HarvestResourceItemAmountClassMultipliers=(ClassName="core:thatch",Multiplier=2.0)', "HarvestXPMultiplier=4"]);
  expect([rich.blows, rich.thatch, rich.wood, rich.xp]).toEqual([12, plain.thatch * 6, plain.wood * 3, 48]);
  // Six blows at double damage are each worth two, so the yield is still twelve draws.
  const strong = fell([], ["PlayerHarvestingDamageMultiplier=2"]);
  const yields = (reg.defs[id("tree")] as NodeDef).yields;
  const within = (name: string, n: number): boolean => {
    const y = yields.find((v) => v.item === `core:${name}`)!;
    return n >= y.min * 12 && n <= y.max * 12;
  };
  expect([strong.blows, strong.xp, within("thatch", strong.thatch), within("wood", strong.wood), within("thatch", plain.thatch), within("wood", plain.wood)]).toEqual([6, 12, true, true, true, true]);
  // At half damage a swing lands one time in two by the server's dice, so it takes about twice the swings.
  const weak = fell([], ["PlayerHarvestingDamageMultiplier=0.5"]);
  expect([weak.blows > 14, weak.blows < 40, weak.xp]).toEqual([true, true, 12]);
});

test("a node does not grow back while a survivor is near it: how near is the server's rule", () => {
  for (const [radius, grows] of [[1, false], [0.1, true]] as const) {
    const { h, ada, me } = world([], [`ResourceNoReplenishRadiusPlayers=${radius}`]);
    const tree = nodesOf(h, "core:tree", 256, 256).find((t) => standFacing(h, ada, h.pilots[0]!, t))!;
    const table = h.host.harvest!.field.store.chunks[tree.chunk]!;
    while (table.kind[tree.index] !== 0) h.host.harvest!.strike(h.client(ada)!, tree.chunk, tree.index);
    // She stands 1.5 m away for the two game hours a regrow takes, plus a little.
    h.run(((2 * 140 + 5) * 1000));
    expect([radius, table.kind[tree.index] !== 0]).toEqual([radius, grows]);
    void me;
  }
});

test("taming: nothing is tamed if the server says so, nor a kind it names; and a tribe, and the server, hold no more tames than they may", () => {
  let made = world([], ["bDisableDinoTaming=True"]);
  expect(knockedOut(made.h, made.at, "raptor", 3).rec.tame).toBeNull();
  // An unknown species is reported in lists.missing and stops nothing.
  made = world([], ['PreventDinoTameClassNames="core:raptor"', 'PreventDinoTameClassNames="core:wyvern"']);
  expect([knockedOut(made.h, made.at, "raptor", 3).rec.tame, knockedOut(made.h, made.at, "parasaur", 7).rec.tame !== null]).toEqual([null, true]);
  expect(made.h.host.lists.missing).toEqual([{ setting: "PreventDinoTameClassNames", name: "core:wyvern" }]);

  made = world(["MaxPersonalTamedDinos=1", "TamingSpeedMultiplier=100"]);
  const { h, ada, at, me } = made;
  const feed = (species: string, far: number): EntityRecord => {
    const { rec } = knockedOut(h, at, species, far);
    h.host.survival.add(rec, V_FOOD, -80);
    h.host.items.mint(rec, id(species === "parasaur" ? "berry" : "meat"), 5);
    rec.tame!.by = me.pid;
    h.run(1500);
    return rec;
  };
  const first = feed("raptor", 3);
  expect([first.team, h.host.taming.count(me.team)]).toEqual([me.team, { all: 1, ours: 1 }]);
  const told = ada.logVersion;
  const second = feed("raptor", 6);
  expect([second.team, second.tame !== null, second.tame!.by]).toEqual([0, true, 0]);
  expect(notices(ada, told)).toEqual(["Your tribe has as many tamed creatures as it may (1)."]);
  expect(h.host.taming.full(me.team)).toBe("Your tribe has as many tamed creatures as it may (1).");
  expect(world(["MaxTamedDinos=0"]).h.host.taming.full(7)).toBe("This server has as many tamed creatures as it may (0).");
  expect(world().h.host.taming.full(7)).toBe("");
});

test("riding and breeding are switched off by the server, breeding also for a kind it names; and a young one is not taken by a tribe that is full", () => {
  const pair = (mode: string[], server: string[] = []) => {
    const made = world(server, mode);
    const { h, ada, at, me } = made;
    const own = (species: string, dx: number, female: boolean) => {
      const e = h.host.spawnCreature(`core:${species}`, at.x + dx, at.z + 4, 5);
      const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
      rec.genome!.female = female;
      h.host.taming.give(rec, me, 1);
      return { e, rec };
    };
    const f = own("parasaur", -2, true);
    const m = own("parasaur", 2, false);
    const tell = (e: number): number => {
      let code = -1;
      ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
      ada.command(CMD_ORDER, (w: BitWriter) => (w.u32(e), w.u8(ORDER_MATE)));
      h.run(150);
      return code;
    };
    const codes = [tell(f.e), tell(m.e)];
    h.run(2000);
    return { ...made, f, m, codes, pairs: h.host.breeding.pairCount };
  };
  expect([pair([]).codes, pair([]).pairs]).toEqual([[RESULT_OK, RESULT_OK], 1]);
  expect([pair(["bDisableDinoBreeding=True"]).codes, pair(["bDisableDinoBreeding=True"]).pairs]).toEqual([[RESULT_DENIED, RESULT_DENIED], 0]);
  expect(pair(['PreventBreedingForClassNames="core:parasaur"']).codes).toEqual([RESULT_DENIED, RESULT_DENIED]);
  expect(pair(['PreventBreedingForClassNames="core:raptor"']).pairs).toBe(1);

  const press = (h: Harness, s: ClientSession, e: number, up = 0.5): number => {
    const ents = h.world.ents;
    const self = h.ent(s);
    const pilot = h.pilots[h.sessions.indexOf(s)]!;
    const [dx, dz] = [ents.x[e]! - ents.x[self]!, ents.z[e]! - ents.z[self]!];
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * up - (ents.y[self]! + stanceEye(h.reg.move[ents.kind[self]!]!, 0)), Math.hypot(dx, dz));
    h.run(150);
    let told = -1;
    s.onResult = (seq, c) => void (seq === 0 && (told = c));
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(250);
    return told;
  };
  for (const [off, drive] of [[false, true], [true, false]] as const) {
    const { h, ada, f } = pair(off ? ["bDisableDinoRiding=True"] : []);
    f.rec.saddle = id("saddle_parasaur");
    h.host.refreshBody(f.rec);
    h.say(ada, `tp ${h.world.ents.x[f.e]!.toFixed(3)} ${(h.world.ents.z[f.e]! - 2.5).toFixed(3)}`);
    press(h, ada, f.e);
    expect([off, h.client(ada)!.drive === f.e]).toEqual([off, drive]);
  }

  // The pair already fills the tribe's limit of two.
  const { h, ada, at, f, me } = pair([], ["MaxPersonalTamedDinos=2"]);
  const e = h.host.spawnCreature("core:parasaur", at.x, at.z + 1.5, 1);
  const baby = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  baby.span = 100000;
  baby.grown = h.world.tick + 100000;
  h.world.ents.setYoung(e, baby.span, baby.grown);
  h.host.refreshBody(baby);
  expect(h.host.breeding.unclaimed(baby)).toBe(true);
  const told = ada.logVersion;
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  expect([press(h, ada, e, 0.08), baby.team]).toEqual([RESULT_FULL, 0]);
  expect(notices(ada, told)).toEqual(["Your tribe has as many tamed creatures as it may (2)."]);
  void f;
  void me;
});

test("a tribe holds no more members than the server allows", () => {
  for (const [most, joined] of [[0, true], [2, true], [1, false]] as const) {
    const h = new Harness({}, 1, 60, { dev: true, config: rulesOf([], [`MaxNumberOfPlayersInTribe=${most}`]) });
    const ada = h.join("ada");
    const bob = h.join("bob");
    h.run(500);
    for (const s of [ada, bob]) h.say(s, "enablecheats");
    const g = flatGround(h, 12, 12);
    h.say(ada, `tp ${(g.x + 4).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
    h.say(bob, `tp ${(g.x + 5.5).toFixed(3)} ${(g.z + 4).toFixed(3)}`);
    h.say(ada, "tribe create Few");
    h.say(ada, "tribe invite bob");
    const said = h.say(bob, "tribe accept")[0]!;
    expect([most, said.startsWith("You joined Few"), bob.tribe.name === "Few"]).toEqual([most, joined, joined]);
    if (!joined) expect(said).toBe("Few has as many members as a tribe may here (1)");
  }
});

test("things built: how soon after harm one may be mended, whether what can be locked starts locked, and whether a PIN serves those outside the tribe", () => {
  const act = (h: Harness, s: ClientSession, ref: number, action: number, pin = 0xffff): number => {
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), (action === STRUCT_PIN || action === STRUCT_USE) && w.u16(pin)));
    h.run(150);
    return code;
  };
  const yard = (server: string[], mode: string[]) => {
    const made = builder(["ada", "bob"], 40, 40, { config: rulesOf(server, mode) });
    const { h, at } = made;
    const [ada, bob] = made.sessions as [ClientSession, ClientSession];
    expect(h.say(ada, "place storage_box")[0]).toContain("placed core:storage_box");
    const box = lastOf(h, id("storage_box"));
    h.say(ada, "place wall_wood");
    const wall = lastOf(h, id("wall_wood"));
    h.world.structs.damage(wall, 500);
    h.host.build.hurt(wall);
    for (const item of ["wood", "thatch", "fiber"]) h.say(ada, `give ${item} 50`);
    void at;
    return { h, ada, bob, box, wall };
  };
  const lastOf = (h: Harness, kind: number): number => {
    let found = -1;
    h.world.structs.chunks.forEach((t, chunk) => {
      if (t) for (let s = 0; s < t.high; s++) if (t.kind[s] === kind) found = chunk * 65536 + s;
    });
    return found;
  };
  // 180 s is ARK's default.
  for (const [seconds, after, code] of [[180, 10, RESULT_WAIT], [5, 10, RESULT_OK], [0, 0, RESULT_OK]] as const) {
    const { h, ada, wall } = yard([], [`StructureDamageRepairCooldown=${seconds}`]);
    h.run(after * 1000);
    expect([seconds, act(h, ada, wall, STRUCT_REPAIR)]).toEqual([seconds, code]);
  }
  for (const [force, code] of [[false, RESULT_OK], [true, RESULT_LOCKED]] as const) {
    const { h, bob, box } = yard(force ? ["ForceAllStructureLocking=True"] : [], []);
    expect([force, act(h, bob, box, STRUCT_USE)]).toEqual([force, code]);
  }
  for (const [prevent, code] of [[false, RESULT_OK], [true, RESULT_LOCKED]] as const) {
    const { h, ada, bob, box } = yard(["ForceAllStructureLocking=True", ...(prevent ? ["PreventOutOfTribePinCodeUse=True"] : [])], []);
    expect(act(h, ada, box, STRUCT_PIN, 4321)).toBe(RESULT_OK);
    expect([prevent, act(h, bob, box, STRUCT_USE, 4321)]).toEqual([prevent, code]);
    if (!prevent) expect(act(h, bob, box, STRUCT_USE)).toBe(RESULT_PIN);
  }
});

test("a fall hurts from the speed the server says", () => {
  const harm = (mode: string[]): number => {
    const { h, me } = world([], mode);
    const before = h.host.survival.value(me, V_HEALTH);
    h.host.survival.landed(me, 20);
    return before - h.host.survival.value(me, V_HEALTH);
  };
  // Safe to 12 m/s, then 7 health for each m/s over, so 56 at 20. Doubled, 24 m/s is safe. Halved, (20 - 6) * 7 is 98.
  expect([harm([]), harm(["MaxFallSpeedMultiplier=2"]), harm(["MaxFallSpeedMultiplier=0.5"])]).toEqual([56, 0, 98]);
});

test("a session: the server's name and message of the day, its admin password, how many it seats, the idle put off, and a world begun with no creatures", () => {
  let h = new Harness({}, 1, 60, { config: loadConfig({ gus: "[SessionSettings]\nSessionName=The Proving Ground\n[MessageOfTheDay]\nMessage=Welcome\\nBe kind\n[ServerSettings]\nServerAdminPassword=opensesame\n[/Script/Engine.GameSession]\nMaxPlayers=2\n" }).rules });
  const ada = h.join("ada");
  h.run(600);
  expect(notices(ada, 0, TEXT_MOTD)).toEqual(["The Proving Ground", "Welcome", "Be kind"]);
  expect([h.say(ada, "enablecheats")[0], h.say(ada, "enablecheats nope")[0], h.say(ada, "enablecheats opensesame")[0]]).toEqual(["wrong password", "wrong password", "cheats enabled"]);
  const bob = h.join("bob");
  const cy = h.join("cy");
  h.run(600);
  expect([h.server.playerCount, bob.closeReason, cy.closeReason]).toEqual([2, 0, REJECT_FULL]);
  // ARK's command-line flag overrides the file.
  h = new Harness({}, 1, 60, { config: loadConfig({ gus: "[/Script/Engine.GameSession]\nMaxPlayers=2\n" }, ["-WinLiveMaxPlayers=1"]).rules });
  const [dee, eve] = [h.join("dee"), h.join("eve")];
  h.run(600);
  expect([dee.closeReason, eve.closeReason]).toEqual([0, REJECT_FULL]);

  // The idle kick needs -EnableIdlePlayerKick as well as a period.
  for (const [argv, gone] of [[[], false], [["-EnableIdlePlayerKick"], true]] as const) {
    h = new Harness({}, 1, 60, { config: rulesOf(["KickIdlePlayersPeriod=10"], [], [...argv]) });
    const still = h.join("still");
    const busy = h.join("busy");
    h.run(600);
    const pilot = h.pilots[1]!;
    for (let k = 0; k < 14; k++) {
      pilot.yaw += 0.3;
      h.run(1000);
    }
    expect([argv.length, still.closeReason === REJECT_KICKED, busy.closeReason]).toEqual([argv.length, gone, 0]);
  }

  const creatures = (argv: string[]): number => new Harness({}, 1, 60, { config: rulesOf([], [], argv), startingCreatures: 6, startingHunters: 2 }).world.ents.count;
  expect([creatures([]), creatures(["-NoDinos"])]).toEqual([8, 0]);
});

test("decay by the server's own rules: only where it is PvE or says so, never where it is switched off; and the server takes down what has decayed only if it was started to", () => {
  /** A wall of an absent tribe, left 80 s where wood lasts 69 s. Returns [decay is on, the wall has expired, it still stands]. */
  const left = (server: string[], argv: string[] = []): boolean[] => {
    const { h, at } = world(["PvEStructureDecayPeriodMultiplier=0.0001", ...server], [], argv);
    const ref = h.world.structs.add(id("wall_wood"), at.x + 6, at.y + 1.5, at.z + 6, 0, 99999, 100);
    const decay = h.host.build.decay;
    // The first look starts its timer.
    decay.expired(ref, h.world.tick);
    h.run(80000);
    return [decay.active(), decay.expired(ref, h.world.tick), h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0];
  };
  expect(left([])).toEqual([false, false, true]);
  expect(left(["serverPVE=True"])).toEqual([true, true, true]);
  expect(left(["PvPStructureDecay=True"])).toEqual([true, true, true]);
  expect(left(["serverPVE=True", "DisableStructureDecayPvE=True"])).toEqual([false, false, true]);
  // Auto-destroy needs both the multiplier, which counts periods, and the command-line flag.
  expect(left(["serverPVE=True", "AutoDestroyOldStructuresMultiplier=1"])).toEqual([true, true, true]);
  expect(left(["serverPVE=True"], ["-AutoDestroyStructures"])).toEqual([true, true, true]);
  expect(left(["serverPVE=True", "AutoDestroyOldStructuresMultiplier=1"], ["-AutoDestroyStructures"])).toEqual([true, false, false]);
  // Two periods are not up at 80 s.
  expect(left(["serverPVE=True", "AutoDestroyOldStructuresMultiplier=2"], ["-AutoDestroyStructures"])).toEqual([true, true, true]);
});
