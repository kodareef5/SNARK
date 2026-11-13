// Content as a server's settings have it, end to end: the server tunes its
// definitions, tells each client how as it welcomes it, and the client makes
// the same content of the same definitions or does not stay.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { CLOSED_BAD_CONTENT, type ClientSession } from "../../client/core/session.ts";
import { KEY_CHAT_ROW } from "../../client/core/ui/chat.ts";
import { KEY_CROSS, KEY_STATUS } from "../../client/core/ui/hud.ts";
import { contentFor, createHost } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { formatReport, loadConfig } from "../../server/settings/config.ts";
import { createProvingWorld } from "../../server/world.ts";
import type { EngramDef, LevelsDef } from "../../shared/content/defs.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_CRAFT, CMD_LEARN, EVENT_HIT, MARKER_DEATH, REJECT_CONTENT, REJECT_PASSWORD, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_SHORT, TEXT_GLOBAL } from "../../shared/net/protocol.ts";
import { CH_RELIABLE } from "../../shared/net/transport.ts";
import { BTN_SPRINT } from "../../shared/sim/character.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { flatGround } from "../fixtures/arena.ts";
import { nodesOf, standFacing } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const pack = parsePack(buildCorePack());

/** Rules from the text of the two files, each given its section. */
function rulesOf(server: string[] = [], mode: string[] = []) {
  const made = loadConfig({ gus: ["[ServerSettings]", ...server].join("\n"), game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") });
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
}

/** A server on those settings, with ada in it, with cheats, on level ground. */
function served(server: string[] = [], mode: string[] = []) {
  const h = new Harness({}, 1, 60, { dev: true, config: rulesOf(server, mode) });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 60);
  const at = { x: g.x + 20, z: g.z + 6, y: g.y };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  /** Ask the server for something and say what it answered. */
  const ask = (op: number, write: (w: BitWriter) => void): number => {
    let code = -1;
    ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
    ada.command(op, write);
    h.run(200);
    return code;
  };
  const has = (name: string): number => h.host.items.inv(me).total(id(name));
  return { h, ada, at, me, ask, has, learn: (name: string): number => ask(CMD_LEARN, (w) => w.u16(id(`engram-${name}`))), craft: (name: string, n = 1): number => ask(CMD_CRAFT, (w) => (w.u16(id(`make-${name}`)), w.u8(n))) };
}

const HATCHET_OF_THATCH = 'ConfigOverrideItemCraftingCosts=(ItemClassString="core:hatchet",BaseCraftingResourceRequirements=((ResourceItemTypeString="core:thatch",BaseResourceRequirement=2.0,bCraftingRequireExactResourceType=false),(ResourceItemTypeString="core:wood",BaseResourceRequirement=3.0,bCraftingRequireExactResourceType=false)))';

test("a client is told its server's tuning as it is welcomed, makes the same content of it, and predicts on it without a correction", () => {
  /** Sprint for two seconds: the stamina that cost the server's body, and what the client was corrected by. */
  const sprint = (server: string[], mode: string[] = []) => {
    const { h, ada } = served(server, mode);
    const pilot = h.pilots[0]!;
    const before = h.client(ada)!.body.stamina;
    const corrections = ada.stats.corrections;
    pilot.moveZ = 127;
    pilot.buttons = BTN_SPRINT;
    h.run(2000);
    const spent = before - h.client(ada)!.body.stamina;
    pilot.moveZ = 0;
    pilot.buttons = 0;
    h.run(500);
    return { h, ada, spent, corrections: ada.stats.corrections - corrections };
  };
  const plain = sprint([]);
  // A server at ARK's defaults has content as it was written, and so has its client: the very registry.
  expect([plain.h.world.reg === plain.h.reg, plain.ada.registry === plain.h.reg, plain.corrections]).toEqual([true, true, 0]);

  const tuned = sprint(["ItemStackSizeMultiplier=2.5", "PlayerCharacterStaminaDrainMultiplier=3", "HarvestHealthMultiplier=2"], [HATCHET_OF_THATCH]);
  const theirs = tuned.h.world.reg;
  const mine = tuned.ada.registry;
  expect([theirs === tuned.h.reg, mine === tuned.h.reg, mine.source === tuned.h.reg, tuned.ada.state, mine.hash === theirs.hash, mine.tuning === theirs.tuning, theirs.baseHash === reg.hash, theirs.hash === reg.hash]).toEqual([false, false, true, "active", true, true, true, false]);
  // The numbers the client shows are the server's: a stack of wood, what a hatchet is made of, what a tree takes.
  expect([mine.stack[id("wood")], [...mine.recipeOf[id("hatchet")]!], mine.nodeHits[id("tree")]]).toEqual([250, [id("thatch"), 2, id("wood"), 3], 24]);
  expect([theirs.stack[id("wood")], [...theirs.recipeOf[id("hatchet")]!], theirs.nodeHits[id("tree")]]).toEqual([250, [id("thatch"), 2, id("wood"), 3], 24]);
  // Sprinting costs three times the stamina there, and the client, stepping its own body by the same numbers, is never put right.
  expect([tuned.spent / plain.spent, tuned.corrections]).toEqual([mine.move[id("survivor")]!.staminaSprint / reg.move[id("survivor")]!.staminaSprint, 0]);
  expect(tuned.spent / plain.spent).toBeCloseTo(3, 1);
  // A client's nodes are of the server's content: a tree there has the health the server gives it.
  const tree = nodesOf(tuned.h, "core:tree", 256, 256)[0]!;
  expect(tuned.h.host.harvest!.field.store.chunks[tree.chunk]!.hp[tree.index]).toBe(24);
});

test("a client that makes other content of the server's tuning than the server did does not stay, and says why", () => {
  /** Join a server on these settings with the byte `back` from the end of its welcome turned over on the way. */
  const tampered = (server: string[], back: number) => {
    const h = new Harness({}, 1, 60, { config: rulesOf(server) });
    const session = h.join("mallory", {}, { manual: true });
    const end = h.ends[h.ends.length - 1]!;
    const deliver = end.onMessage!;
    let seen = false;
    end.onMessage = (channel, data) => {
      // The first reliable message is the welcome (type 1 in its low four bits).
      if (channel === CH_RELIABLE && !seen && (data[0]! & 15) === 1) {
        seen = true;
        data = data.slice();
        data[data.length - back] ^= 0xff;
      }
      deliver(channel, data);
    };
    const app = new App(session, reg, pack);
    h.run(500, (now) => app.frame(now, 1280, 720));
    return { session, app, seen };
  };
  // The hash of what the server has: 4 bytes ending 27 bytes (the tuning's length, the clock, the message's seconds) from the end. This one is wholly inside it.
  let got = tampered([], 30);
  expect([got.seen, got.session.state, got.session.closeReason, got.session.world]).toEqual([true, "closed", CLOSED_BAD_CONTENT, null]);
  expect(got.app.ui.frame.find(KEY_STATUS)!.text).toBe("disconnected: this client's content is not this server's");
  // The tuning itself: whatever it now says, it is not what made the server's content.
  got = tampered(["ItemStackSizeMultiplier=2.5"], 33);
  expect([got.session.state, got.session.closeReason]).toEqual(["closed", CLOSED_BAD_CONTENT]);
  // Untouched, the same client stays.
  got = tampered(["ItemStackSizeMultiplier=2.5"], 1);
  expect([got.session.state, got.session.registry.stack[id("wood")]]).toEqual(["active", 250]);
  // A client whose definitions are not the server's is turned away by the server, before any of this: as it always was.
  const h = new Harness({}, 1, 60, { config: rulesOf(["ItemStackSizeMultiplier=2.5"]) });
  const other = h.join("eve", {}, { registry: contentFor(reg, rulesOf(["ItemStackSizeMultiplier=7"])) });
  const stale = h.join("old", {}, { registry: { ...reg, hash: reg.hash ^ 1 } });
  h.run(500);
  // One that comes with content some other server tuned says hello with the definitions as they were written, and is welcomed to this server's.
  expect([other.state, other.registry.stack[id("wood")], stale.closeReason]).toEqual(["active", 250, REJECT_CONTENT]);
});

test("stacks and what things are made of are the server's: on a server that says so wood stacks to 250, thatch to its own number, and a hatchet is made of what the file says", () => {
  const { h, ada, me, has, learn, craft } = served(["ItemStackSizeMultiplier=2.5"], [HATCHET_OF_THATCH, 'ConfigOverrideItemMaxQuantity=(ItemClassString="core:thatch",Quantity=(MaxItemQuantity=543,bIgnoreMultiplier=True))', 'ConfigOverrideItemMaxQuantity=(ItemClassString="core:flint",Quantity=(MaxItemQuantity=40))']);
  h.say(ada, "setstat weight 255");
  for (const [item, n] of [["wood", 600], ["thatch", 600], ["flint", 150]] as const) h.say(ada, `give ${item} ${n}`);
  h.run(200);
  const stacks = (name: string): number[] => {
    const inv = h.host.items.inv(me);
    const out: number[] = [];
    for (let s = 0; s < inv.cap; s++) if (inv.item[s] === id(name)) out.push(inv.count[s]!);
    return out.sort((a, b) => b - a);
  };
  // Wood by the multiplier; thatch at its own number, the multiplier left out; flint at its own, times the multiplier.
  expect([stacks("wood"), stacks("thatch"), stacks("flint")]).toEqual([[250, 250, 100], [543, 57], [100, 50]]);
  // And the client holds them so.
  expect(ada.inventory!.total(id("wood"))).toBe(600);
  // A hatchet, at level 2: two thatch and three wood, and no flint.
  h.say(ada, "addxp 5");
  expect([learn("hatchet"), craft("hatchet")]).toEqual([RESULT_OK, RESULT_OK]);
  h.run(3000);
  expect([has("hatchet"), has("thatch"), has("wood"), has("flint")]).toEqual([1, 598, 597, 150]);
  expect(h.host.items.audit()).toEqual([]);
});

test("engrams and levels are the server's: its level table and the tames', the most experience, the points of each level, and engrams not offered or learned without asking", () => {
  const { h, ada, me, learn, craft } = served([], [
    'OverrideNamedEngramEntries=(EngramClassName="core:engram-hatchet",EngramHidden=False,EngramPointsCost=1,EngramLevelRequirement=3,RemoveEngramPreReq=True)',
    'OverrideNamedEngramEntries=(EngramClassName="core:engram-pick",EngramHidden=True)',
    'EngramEntryAutoUnlocks=(EngramClassName="core:engram-waterskin",LevelToAutoUnlock=2)',
    "LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=10,ExperiencePointsForLevel[1]=30,ExperiencePointsForLevel[2]=60)",
    "LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=100,ExperiencePointsForLevel[1]=300)",
    "OverridePlayerLevelEngramPoints=0",
    "OverridePlayerLevelEngramPoints=5",
    "OverridePlayerLevelEngramPoints=70000",
    "OverridePlayerLevelEngramPoints=1",
    "OverrideMaxExperiencePointsPlayer=45",
  ]);
  const prog = h.host.progression;
  const shown = (): number[] => [ada.progress.level, ada.progress.engramPoints, Math.floor(ada.progress.xp)];
  // Level 1. An engram the server does not offer is nobody's to learn; one that wants level 3 is not yet hers.
  expect([shown(), learn("pick"), learn("hatchet"), craft("waterskin")]).toEqual([[1, 0, 0], RESULT_DENIED, RESULT_SHORT, RESULT_DENIED]);
  // Ten experience is level 2 here (five, as content has it, is not). It gives 5 points; and the water skin is learned without asking, for nothing.
  h.say(ada, "addxp 5");
  expect(shown()).toEqual([1, 0, 5]);
  h.say(ada, "addxp 5");
  expect([shown(), ada.progress.engrams, me.engrams, learn("waterskin")]).toEqual([[2, 5, 10], [id("engram-waterskin")], [], RESULT_INVALID]);
  h.say(ada, "give fiber 20");
  h.say(ada, "give thatch 5");
  expect(craft("waterskin")).toBe(RESULT_OK);
  // Level 3 at thirty. One level gives no more than 65,535 points, whatever the file says; with the five she had that is
  // more than sixteen bits count, and she is told all of it. The hatchet is at the server's level and cost.
  h.say(ada, "addxp 20");
  expect([shown(), learn("hatchet")]).toEqual([[3, 65540, 30], RESULT_OK]);
  h.run(200);
  expect([shown(), ada.progress.engrams]).toEqual([[3, 65539, 30], [id("engram-hatchet"), id("engram-waterskin")]]);
  // No more experience than the server allows: level 4 wants sixty, and forty-five is the most there is.
  h.say(ada, "addxp 1000");
  expect([shown(), me.xp, prog.most(me)]).toEqual([[3, 65539, 45], 45, 45]);
  // Tames by the second line: level 2 at a hundred, 3 at three hundred, and no more than that.
  const tame = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:parasaur", h.world.ents.x[h.ent(ada)]! + 6, h.world.ents.z[h.ent(ada)]! + 6, 1)]!)!;
  h.host.taming.give(tame, me, 1);
  expect([prog.level(tame), prog.addXp(tame, 99), prog.level(tame), prog.addXp(tame, 1), prog.level(tame), prog.addXp(tame, 5000), prog.level(tame), tame.xp, prog.statPoints(tame)]).toEqual([1, 99, 1, 1, 2, 200, 3, 300, 2]);

  // Survivors' line alone: tames keep the table content gave them, and everyone the most its own table goes to.
  const one = served([], ["LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=10,ExperiencePointsForLevel[1]=30)"]);
  const p = one.h.host.progression;
  expect([p.levelOf(5), p.levelOf(5, true), p.levelOf(10), p.most(one.me)]).toEqual([1, 2, 2, 30]);
  // The most a tame may have, said by itself: its table is content's, and it stops where the server says.
  const capped = served([], ["OverrideMaxExperiencePointsDino=150"]);
  const pet = capped.h.host.records.byPid.get(capped.h.world.ents.pid[capped.h.host.spawnCreature("core:parasaur", capped.at.x + 6, capped.at.z + 6, 1)]!)!;
  capped.h.host.taming.give(pet, capped.me, 1);
  expect([capped.h.host.progression.addXp(pet, 5000), pet.xp, capped.h.host.progression.most(pet), capped.h.host.progression.most(capped.me) > 150]).toEqual([150, 150, 150, true]);
  // At ARK's defaults: content's own table, and no more experience than its last level takes.
  const plain = served();
  const last = (plain.h.world.reg.defs.find((d) => d?.type === "levels") as LevelsDef).xp[99]!;
  plain.h.say(plain.ada, "addxp 1000000");
  expect([plain.me.xp, plain.h.host.progression.level(plain.me), plain.ada.progress.level]).toEqual([last, 100, 100]);
});

test("every engram learned as its level is reached; or only those the server names offered", () => {
  const all = served([], ["bAutoUnlockAllEngrams=True"]);
  const engrams = all.h.world.reg.defs.flatMap((d, k) => (d?.type === "engram" ? [{ k, level: d.level }] : []));
  const at = (level: number): number[] => engrams.filter((e) => e.level <= level).map((e) => e.k);
  expect(at(1).length).toBeGreaterThan(0);
  expect([[...all.ada.progress.engrams].sort((a, b) => a - b), all.me.engrams]).toEqual([at(1), []]);
  // Level 10: everything to there, none of it asked for or paid for, and all of it can be made.
  all.h.say(all.ada, "addxp 480");
  expect([all.ada.progress.level, [...all.ada.progress.engrams].sort((a, b) => a - b), all.me.engrams, all.h.host.progression.engramPoints(all.me)]).toEqual([10, at(10), [], 8 * 5 + 12 * 4]);
  expect(at(10).length).toBeGreaterThan(at(1).length);
  all.h.say(all.ada, "give flint 1");
  all.h.say(all.ada, "give wood 1");
  all.h.say(all.ada, "give thatch 10");
  expect(all.craft("hatchet")).toBe(RESULT_OK);

  const only = served([], ["bOnlyAllowSpecifiedEngrams=True", 'OverrideNamedEngramEntries=(EngramClassName="core:engram-hatchet",EngramPointsCost=0)']);
  only.h.say(only.ada, "addxp 480");
  expect([only.learn("hatchet"), only.learn("pick"), only.learn("waterskin"), (only.ada.registry.defs[id("engram-pick")] as EngramDef).hidden]).toEqual([RESULT_OK, RESULT_DENIED, RESULT_DENIED, true]);
});

test("how long things keep, how long fuel burns, and how much a tree takes and gives are the server's", () => {
  const plain = served();
  const kept = served([], ["GlobalSpoilingTimeMultiplier=3", "FuelConsumptionIntervalMultiplier=2"]);
  /** Ticks a piece of cooked meat keeps from the tick it is made. */
  const keeps = (m: ReturnType<typeof served>): number => {
    const made = m.h.world.tick;
    m.h.host.items.mint(m.me, id("meat_cooked"), 1);
    const inv = m.h.host.items.inv(m.me);
    return inv.spoilAt[inv.item.indexOf(id("meat_cooked"))]! - made;
  };
  // Cooked meat keeps two game hours; three times as long there. Wood burns thirty seconds; sixty there.
  expect([keeps(plain), keeps(kept)]).toEqual([2 * GAME_HOUR_TICKS, 6 * GAME_HOUR_TICKS]);
  expect([plain.h.world.reg.fuelTicks[id("wood")], kept.h.world.reg.fuelTicks[id("wood")], kept.h.world.reg.fuelTicks[id("thatch")]]).toEqual([30 * TICK_RATE, 60 * TICK_RATE, 15 * TICK_RATE]);

  // What tires a creature and what tires a survivor are two settings: each leaves the other's bodies alone. (Twice, to the nearest whole unit a tick.)
  const sprintOf = (m: ReturnType<typeof served>, name: string): number => m.h.world.reg.move[id(name)]!.staminaSprint;
  const beasts = served(["DinoCharacterStaminaDrainMultiplier=2"]);
  const people = served(["PlayerCharacterStaminaDrainMultiplier=2"]);
  expect([sprintOf(beasts, "survivor"), sprintOf(people, "raptor"), sprintOf(people, "parasaur")]).toEqual([sprintOf(plain, "survivor"), sprintOf(plain, "raptor"), sprintOf(plain, "parasaur")]);
  expect([sprintOf(beasts, "raptor") / sprintOf(plain, "raptor"), sprintOf(beasts, "parasaur") / sprintOf(plain, "parasaur"), sprintOf(people, "survivor") / sprintOf(plain, "survivor")].map((r) => Math.round(r * 10) / 10)).toEqual([2, 2, 2]);
  // The client there steps a creature it rides by the same numbers the server does.
  expect(beasts.ada.registry.move[id("raptor")]!.staminaSprint).toBe(sprintOf(beasts, "raptor"));

  /** Fell the nearest tree by hand: the blows it took and the thatch it gave. */
  const fell = (m: ReturnType<typeof served>): number[] => {
    const tree = nodesOf(m.h, "core:tree", 256, 256).find((t) => standFacing(m.h, m.ada, m.h.pilots[0]!, t))!;
    const table = m.h.host.harvest!.field.store.chunks[tree.chunk]!;
    let blows = 0;
    while (table.kind[tree.index] !== 0 && blows < 200) {
      m.h.host.harvest!.strike(m.h.client(m.ada)!, tree.chunk, tree.index);
      blows++;
    }
    return [blows, m.h.host.items.inv(m.me).total(id("thatch"))];
  };
  const [blows, thatch] = fell(plain);
  const [more, most] = fell(served(["HarvestHealthMultiplier=2.5"]));
  // Twelve blows; thirty where a tree has two and a half times the health, each giving what a blow gives: so more in all.
  expect([blows, more, most! > thatch! * 1.8, most! >= 30 * 2, most! <= 30 * 4]).toEqual([12, 30, true, true, true]);
});

test("a server's password is asked of everyone who joins, of one coming back to a waiting body too; and is never shown", () => {
  const made = loadConfig({ gus: "[ServerSettings]\nServerPassword=swordfish\n" });
  expect(formatReport(made.report, made.rules).join("\n")).toContain("ServerPassword=****");
  expect(formatReport(made.report, made.rules).join("\n")).not.toContain("swordfish");
  const h = new Harness({}, 1, 60, { config: made.rules });
  const none = h.join("ada");
  const wrong = h.join("bob", {}, { password: "sword" });
  const longer = h.join("dee", {}, { password: "swordfishes" });
  const right = h.join("cy", {}, { password: "swordfish" });
  h.run(500);
  expect([none.closeReason, wrong.closeReason, longer.closeReason, right.state, h.server.playerCount]).toEqual([REJECT_PASSWORD, REJECT_PASSWORD, REJECT_PASSWORD, "active", 1]);
  // Her connection ends; her body waits. Whoever comes for it needs the password as she did.
  h.ends[h.ends.length - 1]!.close();
  h.run(300);
  const thief = h.join("cy", {}, { password: "" });
  h.run(300);
  const back = h.join("cy", {}, { password: "swordfish" });
  h.run(500);
  expect([thief.closeReason, back.state, h.server.playerCount]).toEqual([REJECT_PASSWORD, "active", 1]);
  // In the whole client, it is said in words.
  const app = new App(h.join("eve", {}, { manual: true }), reg, pack);
  h.run(500, (now) => app.frame(now, 1280, 720));
  expect(app.ui.frame.find(KEY_STATUS)!.text).toBe("disconnected: this server asks a password, and that was not it");
  // A server that asks none takes anyone, whatever they offer.
  const open = new Harness();
  const any = open.join("ada", {}, { password: "anything" });
  open.run(500);
  expect(any.state).toBe("active");
});

test("what a client shows by the server's leave: the body from behind, the crosshair, the mark of a hit, where it is on the map, the beam where it died; changed while it runs", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", {}, { manual: true }), reg, pack);
  const s = app.session;
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(600);
  s.text("enablecheats");
  run(300);
  const set = (name: string, value: string): void => {
    s.text(`setting ${name} ${value}`);
    run(300);
  };
  const tap = (code: string): void => {
    app.key(code, true);
    run(50);
    app.key(code, false);
    run(50);
  };
  /** A hit of hers lands, and somewhere she died is marked. */
  const stir = (): void => {
    s.events.push({ kind: EVENT_HIT, x: s.own.x, y: s.own.y + 1, z: s.own.z + 3, zone: 2, damage: 9, kill: false, blocked: false, bearing: 0, name: "", item: 0, far: 0, level: 0, xp: 0, flies: false, vx: 0, vy: 0, vz: 0, back: 0 });
    if (s.markers.length === 0) s.markers.push({ kind: MARKER_DEATH, x: s.own.x + 20, y: s.own.y, z: s.own.z, tick: 1 });
    run(34);
  };
  const seen = () => ({ third: app.view.thirdPerson, cross: app.ui.frame.find(KEY_CROSS) !== null, mark: app.hud.combat.mark > 0, self: app.hud.markers.some((m) => m.kind === "self"), beams: app.scene!.beams.length / 3 });
  // As ARK is with nothing set: all of them.
  tap("KeyV");
  stir();
  expect([s.thirdPerson, s.crosshair, s.hitMarkers, s.mapLocation, s.corpseLocator]).toEqual([true, true, true, true, true]);
  expect(seen()).toEqual({ third: true, cross: true, mark: true, self: true, beams: 1 });
  // Each taken away by the server, while it runs.
  set("AllowThirdPersonPlayer", "False");
  set("ServerCrosshair", "False");
  set("AllowHitMarkers", "False");
  set("ShowMapPlayerLocation", "False");
  set("bUseCorpseLocator", "False");
  stir();
  expect(seen()).toEqual({ third: false, cross: false, mark: false, self: false, beams: 0 });
  // The key for the view from behind does nothing there.
  tap("KeyV");
  expect(app.view.thirdPerson).toBe(false);
  // And given back.
  set("AllowThirdPersonPlayer", "True");
  set("ServerCrosshair", "True");
  set("bUseCorpseLocator", "True");
  tap("KeyV");
  stir();
  expect(seen()).toEqual({ third: true, cross: true, mark: false, self: false, beams: 1 });
});

test("the server's name and message of the day stay up for as long as the server says, whatever is said after them", () => {
  const h = new Harness({}, 1, 60, { config: loadConfig({ gus: "[SessionSettings]\nSessionName=The Proving Ground\n[MessageOfTheDay]\nMessage=Welcome\\nBe kind\nDuration=30\n" }).rules });
  const app = new App(h.join("ada", {}, { manual: true }), reg, pack);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  const rows = (): string[] => {
    const f = app.ui.frame;
    const out: string[] = [];
    for (let i = 0; i < f.count; i++) if (f.nodes[i]!.key >= KEY_CHAT_ROW && f.nodes[i]!.key < KEY_CHAT_ROW + 14) out.push(f.nodes[i]!.text);
    return out;
  };
  run(1000);
  expect([app.session.motdSeconds, rows()]).toEqual([30, ["The Proving Ground", "Welcome", "Be kind"]]);
  app.session.chat(TEXT_GLOBAL, "hello");
  run(1000);
  expect(rows()).toEqual(["The Proving Ground", "Welcome", "Be kind", "ada: hello"]);
  // What she said has gone after its twelve seconds; the message is there for its thirty.
  run(14000);
  expect(rows()).toEqual(["The Proving Ground", "Welcome", "Be kind"]);
  run(16000);
  expect(rows()).toEqual([]);
});

test("what of the settings names nothing here, or makes no sense, is passed over and said; and a world made before its host must be made of the host's content", () => {
  const rules = rulesOf([], [
    'ConfigOverrideItemMaxQuantity=(ItemClassString="core:unobtainium",Quantity=(MaxItemQuantity=5))',
    'ConfigOverrideItemMaxQuantity=(ItemClassString="core:wood",Quantity=(MaxItemQuantity=0))',
    'ConfigOverrideItemCraftingCosts=(ItemClassString="core:thatch",BaseCraftingResourceRequirements=((ResourceItemTypeString="core:wood",BaseResourceRequirement=1.0)))',
    'ConfigOverrideItemCraftingCosts=(ItemClassString="core:hatchet",BaseCraftingResourceRequirements=((ResourceItemTypeString="core:mithril",BaseResourceRequirement=1.0)))',
    'OverrideNamedEngramEntries=(EngramClassName="core:wood",EngramPointsCost=1)',
    'EngramEntryAutoUnlocks=(EngramClassName="core:engram-hatchet")',
    "LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=10,ExperiencePointsForLevel[1]=10)",
    "LevelExperienceRampOverrides=(ExperiencePointsForLevel[0]=10,ExperiencePointsForLevel[2]=30)",
  ]);
  const h = new Harness({}, 1, 60, { config: rules });
  expect(h.host.passed).toEqual([
    "ConfigOverrideItemMaxQuantity: core:wood wants a MaxItemQuantity of at least 1",
    "ConfigOverrideItemCraftingCosts: nothing here makes core:thatch",
    "ConfigOverrideItemCraftingCosts: core:hatchet must be made of something",
    "EngramEntryAutoUnlocks: core:engram-hatchet wants a LevelToAutoUnlock",
    "LevelExperienceRampOverrides, line 1: [1] does not take more than the level before it",
    "LevelExperienceRampOverrides, line 2: its levels are not in order at [2]",
  ]);
  expect(h.host.lists.missing).toEqual([
    { setting: "ConfigOverrideItemMaxQuantity", name: "core:unobtainium" },
    { setting: "ConfigOverrideItemCraftingCosts", name: "core:mithril" },
    { setting: "OverrideNamedEngramEntries", name: "core:wood" },
  ]);
  // None of it took: this server's content is content as it was written.
  expect(h.world.reg === h.reg).toBe(true);

  const tuned = rulesOf(["ItemStackSizeMultiplier=2"]);
  expect(() => createHost(reg, { config: tuned, world: createProvingWorld(reg) })).toThrow(/contentFor/);
  const theirs = contentFor(reg, tuned);
  const host = createHost(reg, { config: tuned, world: createProvingWorld(theirs) });
  expect([host.world.reg === theirs, theirs.stack[id("wood")]]).toEqual([true, 200]);
  // Asked for again from what it made, it is that: nothing is tuned twice.
  expect(contentFor(theirs, tuned)).toBe(theirs);
  host.shutdown();
  void ({} as EntityRecord | ClientSession);
});
