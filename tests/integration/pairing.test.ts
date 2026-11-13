// What a blow is worth by who dealt it and who took it: ARK's multipliers for
// each class of attacker and of victim, its lists that name a species, PvE
// mode, and the friendly-fire switches.

import { expect, test } from "bun:test";
import type { Source } from "../../server/combat.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { ZONE_HEAD, ZONE_TORSO } from "../../shared/anim/human.ts";
import { DMG_EXPLOSIVE, DMG_MELEE } from "../../shared/sim/damage.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/**
 * Ada and Bob, each of a tribe of their own, on level ground with: a wild
 * raptor and a wild parasaur; a raptor of Ada's and a parasaur of Bob's; and a
 * thatch wall of each of theirs. Nothing moves: the clock is not run again.
 */
function scene(server: string[] = [], mode: string[] = [], ours: string[] = []) {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server, "[SnarkSettings]", ...ours].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  const h = new Harness({}, 1, 60, { dev: true, config: made.rules });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 10, z: g.z + 6, y: g.y };
  for (const [s, dx] of [[ada, 0], [bob, 4]] as const) {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + dx).toFixed(3)} ${at.z.toFixed(3)}`);
  }
  const { records, taming, combat, survival } = h.host;
  const of = (e: number): EntityRecord => records.byPid.get(h.world.ents.pid[e]!)!;
  const a = of(h.ent(ada));
  const b = of(h.ent(bob));
  const creature = (species: string, dx: number, owner: EntityRecord | null): EntityRecord => {
    const rec = of(h.host.spawnCreature(`core:${species}`, at.x + dx, at.z + 8, 1));
    if (owner) taming.give(rec, owner, 1);
    return rec;
  };
  const wild = creature("raptor", 0, null);
  const grazer = creature("parasaur", 6, null);
  const hers = creature("raptor", 12, a);
  const his = creature("parasaur", 18, b);
  const wall = (dx: number, team: number): number => h.world.structs.add(id("wall_thatch"), at.x + dx, at.y + 1.5, at.z + 14, 0, team, reg.maxHp[id("wall_thatch")]!);
  const herWall = wall(0, a.team);
  const hisWall = wall(6, b.team);
  /** What `by` brings: one point of a kind of damage, with nothing else to it. */
  const blow = (by: EntityRecord | null, type = DMG_MELEE): Source => ({ by, x: at.x, z: at.z, item: 0, base: 1, type, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 });
  /** That blow lands on a body, made whole first, or on a wall, made whole first: the harm it did. */
  const lands = (by: EntityRecord | null, on: EntityRecord | number, type = DMG_MELEE, zone = ZONE_TORSO): number => {
    if (typeof on === "number") {
      h.world.structs.chunks[Math.floor(on / 65536)]!.hp[on & 0xffff] = reg.maxHp[id("wall_thatch")]!;
      return combat.hitStructure(blow(by, type), on, at.x, at.y + 1, at.z);
    }
    survival.refill(on);
    combat.land(blow(by, type), records.entOf.get(on.pid)!, zone, at.x, at.y + 1, at.z, 1);
    return combat.last.damage;
  };
  return { h, ada, bob, a, b, wild, grazer, hers, his, herWall, hisWall, lands };
}

test("a blow is worth what the server says of whoever dealt it and of whoever took it: survivors, the wild, the tamed and what is built, and a species the server names", () => {
  const plain = scene();
  const tuned = scene(
    ["PlayerDamageMultiplier=2", "DinoDamageMultiplier=3", "TamedDinoDamageMultiplier=5", "PlayerResistanceMultiplier=0.5", "DinoResistanceMultiplier=0.25", "TamedDinoResistanceMultiplier=0.125", "StructureResistanceMultiplier=7"],
    [
      'DinoClassDamageMultipliers=(ClassName="core:raptor",Multiplier=2.0)',
      'TamedDinoClassDamageMultipliers=(ClassName="core:raptor",Multiplier=3.0)',
      'DinoClassResistanceMultipliers=(ClassName="core:raptor",Multiplier=2.0)',
      'TamedDinoClassResistanceMultipliers=(ClassName="core:parasaur",Multiplier=4.0)',
      // One that names nothing here is counted, and stops nothing.
      'TamedDinoClassDamageMultipliers=(ClassName="core:wyvern",Multiplier=9.0)',
    ],
  );
  type Made = ReturnType<typeof scene>;
  // Who deals, and what the server makes of it: a survivor twice; the wild three times, and a wild raptor twice again; the
  // tamed five times, and a tamed raptor three times again; what nobody dealt, as it is.
  const dealers: [string, (m: Made) => EntityRecord | null, number][] = [
    ["a survivor", (m) => m.a, 2],
    ["a wild raptor", (m) => m.wild, 3 * 2],
    ["a wild parasaur", (m) => m.grazer, 3],
    ["a tamed raptor", (m) => m.hers, 5 * 3],
    ["nobody", () => null, 1],
  ];
  // Who takes it. A whole class is written as damage taken: higher takes more. A species is written as resistance: higher
  // takes less, so a wild raptor's 2 halves what the wild take and a tamed parasaur's 4 quarters what the tamed take.
  const takers: [string, (m: Made) => EntityRecord | number, number][] = [
    ["another survivor", (m) => m.b, 0.5],
    ["a wild raptor", (m) => m.wild, 0.25 / 2],
    ["a wild parasaur", (m) => m.grazer, 0.25],
    ["a tamed parasaur", (m) => m.his, 0.125 / 4],
    ["a wall", (m) => m.hisWall, 7],
  ];
  const seen: string[] = [];
  const want: string[] = [];
  for (const [who, by, deals] of dealers) {
    for (const [whom, on, takes] of takers) {
      if (who === whom) continue;
      const was = plain.lands(by(plain), on(plain));
      const is = tuned.lands(by(tuned), on(tuned));
      expect(was).toBeGreaterThan(0);
      seen.push(`${who} on ${whom}: ${(is / was).toFixed(4)}`);
      want.push(`${who} on ${whom}: ${(deals * takes).toFixed(4)}`);
    }
  }
  expect(seen).toEqual(want);
  expect(seen.length).toBe(23);
  expect(tuned.h.host.lists.missing).toEqual([{ setting: "TamedDinoClassDamageMultipliers", name: "core:wyvern" }]);
  // A species named with 0 resistance is not one that takes without end: the line is passed over.
  const none = scene([], ['DinoClassResistanceMultipliers=(ClassName="core:raptor",Multiplier=0)']);
  expect(none.lands(none.a, none.wild)).toBe(plain.lands(plain.a, plain.wild));
});

test("on a PvE server nothing of one tribe's is harmed by another's; the wild harms and is harmed as ever; and it may be switched on while the server runs", () => {
  const m = scene();
  const { h, ada, a, b, wild, hers, his, herWall, hisWall, lands } = m;
  /** Whether each of these does any harm: Ada on Bob, on his tame, on his wall; her tame on Bob and on his tame; Bob on her tame and her wall; a blast of hers on Bob. */
  const between = (): boolean[] => [lands(a, b), lands(a, his), lands(a, hisWall), lands(hers, b), lands(hers, his), lands(b, hers), lands(b, herWall), lands(a, b, DMG_EXPLOSIVE)].map((n) => n > 0);
  /** And these: Ada on the wild, the wild on Ada, on her tame and on her wall, and what nobody dealt on Ada. */
  const wilds = (): boolean[] => [lands(a, wild), lands(wild, a), lands(wild, hers), lands(wild, herWall), lands(hers, wild), lands(null, a)].map((n) => n > 0);
  expect([between(), wilds()]).toEqual([Array(8).fill(true), Array(6).fill(true)]);
  expect(h.say(ada, "setting serverPVE True")).toEqual(["serverPVE=True  (until the server is started again)"]);
  expect([between(), wilds()]).toEqual([Array(8).fill(false), Array(6).fill(true)]);
  // What does no harm leaves nothing behind either: a dart of hers does not put him to sleep.
  const dart: Source = { by: a, x: 0, z: 0, item: 0, base: 20, type: DMG_MELEE, quality: 1, draw: 1, attack: 1, torporInstant: 5, torporOver: 0, torporSeconds: 0, buff: id("stunned") };
  h.host.combat.land(dart, h.host.records.entOf.get(b.pid)!, ZONE_TORSO, 0, 0, 0, 1);
  expect([h.host.survival.value(b, V_TORPOR), b.buffs.length]).toEqual([0, 0]);
  h.say(ada, "setting serverPVE False");
  expect(between()).toEqual(Array(8).fill(true));
  void m;
});

test("a tribe's own: spared its own blows and not its own blasts; spared those too by the switch for the kind of server it is; and spared nothing if the server says so", () => {
  const { h, ada, a, hers, herWall, lands } = scene();
  const set = (name: string, value: string): void => expect(h.say(ada, `setting ${name} ${value}`)[0]).toContain(`${name}=${value}`);
  /** What a blow and a blast of Ada's do to her tame and her wall, and what her own blast does to her: harm or none. */
  const own = (): boolean[] => [lands(a, hers), lands(a, herWall), lands(a, hers, DMG_EXPLOSIVE), lands(a, herWall, DMG_EXPLOSIVE), lands(a, a, DMG_EXPLOSIVE)].map((n) => n > 0);
  // As ARK is with nothing set.
  expect(own()).toEqual([false, false, true, true, true]);
  // ARK's switch for a server that is not PvE: not its blasts either. What she does to herself is hers.
  set("bDisableFriendlyFire", "True");
  expect(own()).toEqual([false, false, false, false, true]);
  // That switch says nothing on a PvE server, which has one of its own; and that one says nothing on any other.
  set("serverPVE", "True");
  expect(own()).toEqual([false, false, true, true, true]);
  set("bPvEDisableFriendlyFire", "True");
  expect(own()).toEqual([false, false, false, false, true]);
  set("bDisableFriendlyFire", "False");
  set("serverPVE", "False");
  expect(own()).toEqual([false, false, true, true, true]);
  set("bPvEDisableFriendlyFire", "False");
  // Ours: a server where a tribe's own are spared nothing.
  set("FullFriendlyFire", "True");
  expect(own()).toEqual([true, true, true, true, true]);
});

test("the three settings ARK has no key for are in a section of our own: where a hit lands, and what one's own blast does to oneself", () => {
  const plain = scene();
  const ours = scene([], [], ["HeadMultipliers=False", "SelfDamageMultiplier=0.25"]);
  // A survivor's head counts three times; with the switch off, once.
  expect([plain.lands(plain.a, plain.b, DMG_MELEE, ZONE_HEAD) / plain.lands(plain.a, plain.b), ours.lands(ours.a, ours.b, DMG_MELEE, ZONE_HEAD) / ours.lands(ours.a, ours.b)]).toEqual([3, 1]);
  expect(ours.lands(ours.a, ours.a, DMG_EXPLOSIVE) / plain.lands(plain.a, plain.a, DMG_EXPLOSIVE)).toBeCloseTo(0.25, 6);
  // What a survivor deals and what a survivor takes both bear on what she does to herself.
  const both = scene(["PlayerDamageMultiplier=2", "PlayerResistanceMultiplier=3"]);
  expect(both.lands(both.a, both.a, DMG_EXPLOSIVE) / plain.lands(plain.a, plain.a, DMG_EXPLOSIVE)).toBeCloseTo(6, 6);
  // They are not ARK's, and are not read from ARK's section.
  const wrong = loadConfig({ gus: "[ServerSettings]\nHeadMultipliers=False\n" });
  expect([wrong.rules.on("HeadMultipliers"), wrong.report.refused.map((r) => [r.key, r.why])]).toEqual([true, [["HeadMultipliers", "belongs in GameUserSettings.ini [SnarkSettings]"]]]);
});
