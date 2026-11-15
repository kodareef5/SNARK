// A dead creature's body lies where it fell and is harvested by hitting it, as ARK's is (server/corpses.ts): what each
// tool takes from a dodo against the figures wikily.gg gives, prime meat from the young, the server's multipliers, what
// does not fit, the reach and the walls, its decay, a restart, and the same body for every client.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Corpses as Drawn } from "../../client/core/ragdoll.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CORPSE_TICKS, type Body } from "../../server/corpses.ts";
import { FALLING } from "../../shared/anim/corpse.ts";
import { createHost, type HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { CUE_DEAD, CUE_DECAY_SHIFT, CUE_HELD, CUE_OUT, STAGE_WORST } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader, type BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CARRY_PICK_UP, CARRY_THROW, CMD_CARRY, CMD_FEED, CMD_MOVE, CMD_OPEN, CMD_ORDER, CMD_TAKE, ORDER_ALL, ORDER_ATTACK, ORDER_FOLLOW, ORDER_MATE, RESULT_DENIED, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_USE, MF_OUT, MF_ROOTED, MODE_SWIM } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { rollWild } from "../../shared/sim/genome.ts";
import { Rng } from "../../shared/rng.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { DROPS, OP_BLOW, OP_LAY } from "../fixtures/corpse-child.ts";
import { swing, takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-corpses-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Ada stands on level ground with cheats on, and nothing harms her. */
function camp(host: HostOptions = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  const id = (name: string): number => h.reg.index.get(name)!;
  const have = (name: string): number => h.host.items.inv(me).total(id(name));
  return { h, ada, at, me, g, id, have };
}

/** Spawns `kind` at (x, z) and kills it as `by` would, then waits `ms`. Returns its body. */
function killed(h: Harness, kind: string, x: number, z: number, by: EntityRecord | null, ms = 3000, young = 0): Body {
  const e = h.host.spawnCreature(kind, x, z, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  if (young > 0) {
    // A tenth of the way grown, with `young` ticks of growing in all.
    rec.span = young;
    rec.grown = h.world.tick + Math.round(young * 0.9);
    h.world.ents.setYoung(e, rec.span, rec.grown);
  }
  h.run(100);
  const before = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, by ? by.pid : 0);
  const body = [...h.host.corpses.bodies.values()].find((b) => !before.has(b.rec.pid));
  expect(body).toBeDefined();
  h.run(ms);
  return body!;
}

/** Puts `s` `far` metres from a body's middle, on the side `from` radians round, looking at it. */
function face(h: Harness, s: ClientSession, b: Body, far = 1.4, from = Math.PI): void {
  const m = h.host.corpses.middle(b);
  h.say(s, `tp ${(m.x + Math.sin(from) * far).toFixed(3)} ${(m.z + Math.cos(from) * far).toFixed(3)}`, 300);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const ents = h.world.ents;
  const e = h.ent(s);
  pilot.yaw = Math.atan2(m.x - ents.x[e]!, m.z - ents.z[e]!);
  pilot.pitch = Math.atan2(m.y - (ents.y[e]! + 1.62), Math.hypot(m.x - ents.x[e]!, m.z - ents.z[e]!));
  h.run(200);
}

test("a dodo's body lies where it fell, and two swings of a stone hatchet use it up, as wikily.gg's Dodo page has them", () => {
  const { h, ada, at, me, id, have } = camp();
  const body = killed(h, "core:dodo", at.x, at.z + 1.6, me);
  const ents = h.world.ents;
  expect([body.e >= 0, (ents.cue[body.e]! & CUE_DEAD) !== 0, ents.kind[body.e], body.max, body.fall!.still]).toEqual([true, true, id("core:dodo"), 32, true]);
  // Its record holds it, and it is no creature: nothing counts it among the wild, and it does not move.
  expect(h.reg.ids[body.rec.kind]).toBe("core:corpse");
  h.say(ada, "give core:hatchet 1");
  takeInHand(h, ada, id("core:hatchet"));
  face(h, ada, body);
  swing(h, h.pilots[0]!, 1, SWING_TICKS);
  // A hatchet's blow is 20 of harvest damage, and each 8 is a roll.
  expect([h.host.corpses.blows, body.left, h.host.corpses.last.rolls >= 2, h.host.corpses.last.rolls <= 3]).toEqual([1, 12, true, true]);
  swing(h, h.pilots[0]!, 1, SWING_TICKS);
  expect([h.host.corpses.blows, h.host.corpses.bodies.has(body.rec.pid), ents.kind[body.e] === id("core:dodo") && (ents.flags[body.e]! & 1) !== 0]).toEqual([2, false, false]);
  expect(have("core:hide") + have("core:meat")).toBeGreaterThanOrEqual(4);
  expect(h.host.items.audit()).toEqual([]);
  // The hatchet wore by one each blow.
  const inv = h.host.items.inv(me);
  expect(inv.dur[inv.item.indexOf(id("core:hatchet"))]).toBe(h.host.items.maxDur(id("core:hatchet"), 0) - 2);
});

test("what a dodo gives each tool, on average over many bodies, is what wikily.gg's Dodo page gives: a hatchet 3 hide and 2 meat, a pick 2 and 2", () => {
  const { h, at, me, id, have } = camp();
  const items = h.host.items;
  // The harvest damage of a blow is the weapon's: the swing path is tested above. Here each body takes blows until it is gone.
  const average = (tool: string, damage: number, bodies: number, young = 0): { hide: number; meat: number; prime: number; blows: number } => {
    const tally = { hide: 0, meat: 0, prime: 0, blows: 0 };
    for (let n = 0; n < bodies; n++) {
      for (const k of ["core:hide", "core:meat", "core:meat_prime"]) if (have(k) > 0) items.burnItem(me, id(k), have(k));
      const b = killed(h, "core:dodo", at.x + (n % 10) * 0.7, at.z + 4 + Math.floor(n / 10) * 0.7, me, 0, young);
      for (; h.host.corpses.bodies.has(b.rec.pid); tally.blows++) h.host.corpses.take(me, b, damage, tool === "" ? 0 : id(tool));
      tally.hide += have("core:hide");
      tally.meat += have("core:meat");
      tally.prime += have("core:meat_prime");
    }
    return { hide: tally.hide / bodies, meat: tally.meat / bodies, prime: tally.prime / bodies, blows: tally.blows / bodies };
  };
  const hatchet = average("core:hatchet", 20, 200);
  const pick = average("core:pick", 16, 200);
  const fists = average("", 8, 200);
  // Two blows of each tool, as the page has it; bare hands take four.
  expect([hatchet.blows, pick.blows, fists.blows]).toEqual([2, 2, 4]);
  // A hatchet: 5 rolls, three in five of them hide. A pick: 4 rolls, three in five of them meat. The page rounds to whole pieces.
  expect([Math.round(hatchet.hide), Math.round(hatchet.meat), Math.round(pick.hide), Math.round(pick.meat)]).toEqual([3, 2, 2, 2]);
  expect(Math.abs(hatchet.hide - 3)).toBeLessThan(0.2);
  expect(Math.abs(pick.meat - 2.4)).toBeLessThan(0.2);
  expect(hatchet.hide).toBeGreaterThan(hatchet.meat);
  expect(pick.meat).toBeGreaterThan(pick.hide);
  expect(Math.abs(fists.hide - fists.meat)).toBeLessThan(0.4);
  expect([hatchet.prime, pick.prime, fists.prime]).toEqual([0, 0, 0]);
  // A young dodo's body is the size it was, and gives raw prime meat in place of raw meat (Raw Prime Meat): no raw meat.
  const young = average("core:pick", 16, 60, 10000);
  expect([young.meat, young.prime > 0.5, young.blows]).toEqual([0, true, 1]);
  expect(items.audit()).toEqual([]);
});

test("the server's rules: more harvest health gives more blows and more in all, more harvest amount more of each, and a fiftyfold server's blow fills bags at the harvester's feet", () => {
  const rules = loadConfig({ gus: "[ServerSettings]\nHarvestAmountMultiplier=50\nHarvestHealthMultiplier=2", game: "" }).rules;
  const { h, at, me, id, have } = camp({ config: rules });
  const items = h.host.items;
  const b = killed(h, "core:dodo", at.x, at.z + 3, me, 0);
  expect(b.max).toBe(64);
  // Fill her bag with stone but for one slot, so the first blow's two hundred pieces or so cannot all go in.
  const inv = items.inv(me);
  for (let s = 0; s < inv.bag; s++) if (inv.item[s] === 0) items.mint(me, id("core:stone"), 100);
  items.burn(me, inv.item.indexOf(id("core:stone")), 100);
  const taken = h.host.corpses.take(me, b, 20, id("core:hatchet"));
  const made = taken.got.reduce((a, n) => a + n, 0) + taken.bagged.reduce((a, n) => a + n, 0);
  expect(made).toBe(taken.rolls * 50);
  expect(taken.bagged.reduce((a, n) => a + n, 0)).toBeGreaterThan(0);
  const bags = [...h.host.records.byPid.values()].filter((r) => r.kind === id("core:bag"));
  expect(bags.length).toBeGreaterThan(0);
  const e = h.ent(h.sessions[0]!);
  expect(Math.hypot(bags[0]!.x - h.world.ents.x[e]!, bags[0]!.z - h.world.ents.z[e]!)).toBeLessThan(0.1);
  expect(have("core:hide") + have("core:meat") + bags.reduce((n, r) => n + items.inv(r).total(id("core:hide")) + items.inv(r).total(id("core:meat")), 0)).toBe(made);
  // Four blows of a hatchet, at twice the health.
  for (let n = 1; h.host.corpses.bodies.has(b.rec.pid); n++) {
    h.host.corpses.take(me, b, 20, id("core:hatchet"));
    expect(n).toBeLessThan(4);
  }
  expect(items.audit()).toEqual([]);
});

test("nothing is taken from a body out of reach or behind a wall, nor opened, nor named to be opened", () => {
  const { h, ada, at, me, id, have } = camp();
  const body = killed(h, "core:dodo", at.x, at.z + 3, me);
  h.say(ada, "give core:hatchet 1");
  takeInHand(h, ada, id("core:hatchet"));
  const pilot = h.pilots[0]!;
  // Four metres off, looking straight at it: the swing reaches 2.6 from the eye.
  face(h, ada, body, 4);
  swing(h, pilot, 3, SWING_TICKS);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  expect([h.host.corpses.blows, body.left, have("core:hide") + have("core:meat"), ada.open]).toEqual([0, 32, 0, null]);
  // A wall between, a metre and a half off.
  face(h, ada, body, 1.5);
  const ents = h.world.ents;
  const e = h.ent(ada);
  const m = h.host.corpses.middle(body);
  const wall = id("core:wall");
  h.world.structs.add(wall, (ents.x[e]! + m.x) / 2, ents.y[e]! + 1.5, (ents.z[e]! + m.z) / 2, 0, 0, 10000);
  h.run(200);
  swing(h, pilot, 3, SWING_TICKS);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  expect([h.host.corpses.blows, body.left, have("core:hide") + have("core:meat"), ada.open]).toEqual([0, 32, 0, null]);
  // A body cannot be named to be opened, near or far.
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  ada.command(CMD_OPEN, (w: BitWriter) => w.u32(body.e));
  h.run(300);
  expect(codes).toEqual([RESULT_INVALID]);
  expect(me.inv!.used()).toBe(1);
});

test("a body decays: its stage goes up a step for each quarter of its time or of its harvest health gone, and it goes when its time is out", () => {
  const rules = loadConfig({ gus: "", game: "[/script/shootergame.shootergamemode]\nGlobalCorpseDecompositionTimeMultiplier=0.02" }).rules;
  const { h, at, me, id } = camp({ config: rules });
  const life = Math.round(CORPSE_TICKS * 0.02);
  const b = killed(h, "core:dodo", at.x, at.z + 3, me, 0);
  const ents = h.world.ents;
  const stage = (): number => (ents.cue[b.e]! >>> CUE_DECAY_SHIFT) & 3;
  expect([b.life, b.rec.expiresAt - h.world.tick, stage()]).toEqual([life, life, 0]);
  // A hatchet's blow takes 20 of its 32: a stage for every quarter gone, so the third quarter's.
  h.host.corpses.take(me, b, 20, id("core:hatchet"));
  expect(stage()).toBe(2);
  const other = killed(h, "core:dodo", at.x + 2, at.z + 3, me, 0);
  const seen: number[] = [];
  const end = other.rec.expiresAt;
  while (h.host.corpses.bodies.has(other.rec.pid)) {
    const s = (ents.cue[other.e]! >>> CUE_DECAY_SHIFT) & 3;
    if (seen.at(-1) !== s) seen.push(s);
    h.run(1000 / 30);
  }
  expect(seen).toEqual([0, 1, 2, STAGE_WORST]);
  expect(Math.abs(h.world.tick - end)).toBeLessThanOrEqual(2);
  expect(h.host.items.audit()).toEqual([]);
});

test("a body holds what a creature carried; one used up leaves that in a cache, and one that decays takes it with it", () => {
  const { h, ada, at, me, id } = camp();
  const items = h.host.items;
  const carrying = (x: number): Body => {
    const e = h.host.spawnCreature("core:dodo", x, at.z + 3, 1);
    const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    items.mint(rec, id("core:berry"), 7);
    h.run(100);
    const before = new Set(h.host.corpses.bodies.keys());
    h.host.survival.hurt(rec, 1e6, me.pid);
    h.run(3000);
    return [...h.host.corpses.bodies.values()].find((b) => !before.has(b.rec.pid))!;
  };
  const b = carrying(at.x);
  expect(items.inv(b.rec).total(id("core:berry"))).toBe(7);
  // She opens it as she would a cache.
  face(h, ada, b, 1.4);
  h.pilots[0]!.buttons = BTN_USE;
  h.run(100);
  h.pilots[0]!.buttons = 0;
  h.run(300);
  expect(ada.open?.name).toBe("dodo");
  const from = ada.open!.inventory.item.indexOf(id("core:berry"));
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(0), w.u16(2), w.u16(id("core:berry"))));
  h.run(300);
  expect(items.inv(b.rec).total(id("core:berry"))).toBe(5);
  // Emptied or not, a body stays open and stays: only its time or its harvest health ends it.
  for (; h.host.corpses.bodies.has(b.rec.pid); ) h.host.corpses.take(me, b, 20, id("core:hatchet"));
  const caches = [...h.host.records.byPid.values()].filter((r) => r.kind === id("core:cache"));
  expect(caches.map((r) => [r.name, items.inv(r).total(id("core:berry"))])).toEqual([["dodo's cache", 5]]);
  const c = carrying(at.x + 3);
  h.host.corpses.due(c.rec.pid, c.next);
  c.rec.expiresAt = h.world.tick;
  c.next = h.world.tick;
  h.host.corpses.due(c.rec.pid, c.next);
  expect(h.host.corpses.bodies.has(c.rec.pid)).toBe(false);
  expect(items.audit()).toEqual([]);
});

/** Sends a command and returns the server's answer. */
function ask(h: Harness, s: ClientSession, op: number, write: (w: BitWriter) => void): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(op, write);
  h.run(150);
  return code;
}

/** `rec`, its entity `e`, made a creature of `owner`'s tribe and told to stay. */
function tamed(h: Harness, owner: EntityRecord, e: number, female = true): EntityRecord {
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.genome!.female = female;
  h.host.taming.give(rec, owner, 1);
  h.host.creatures.mind.stay(e, 0xffffffff);
  return rec;
}

/** The bodies laid since `before`, a set of record ids. */
const since = (h: Harness, before: Set<number>): Body[] => [...h.host.corpses.bodies.values()].filter((b) => !before.has(b.rec.pid));

test("a body is nothing to the marks over creatures, to orders and whistles, to the alarm, to carrying or to feeding", () => {
  const { h, ada, at, me, id } = camp();
  const ents = h.world.ents;
  const e = h.host.spawnCreature("core:dodo", at.x, at.z + 2, 5);
  const rec = tamed(h, me, e);
  const was = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, 0);
  h.run(3000);
  const [body] = since(h, was);
  face(h, ada, body!, 1.4);
  // No mark over it for the one who looks at it, and no heart.
  expect([h.host.overhead.lookedAt(h.client(ada)!), h.host.overhead.details(body!.e, me)]).toEqual([-1, null]);
  expect((ents.cue[body!.e]! >>> 28) & 7).toBe(0);
  // Not an order's, a whistle's or an attack's, and not picked up.
  const alive = h.host.spawnCreature("core:dodo", at.x + 3, at.z + 2, 5);
  tamed(h, me, alive);
  expect(ask(h, ada, CMD_ORDER, (w) => (w.u32(body!.e), w.u8(ORDER_FOLLOW)))).toBe(RESULT_INVALID);
  expect(ask(h, ada, CMD_ORDER, (w) => (w.u32(alive), w.u8(ORDER_ATTACK), w.u32(body!.e)))).toBe(RESULT_INVALID);
  expect(ask(h, ada, CMD_ORDER, (w) => (w.u32(ORDER_ALL), w.u8(ORDER_FOLLOW)))).toBe(RESULT_OK);
  expect(h.host.creatures.mind.owned.has(body!.e)).toBe(false);
  expect(ask(h, ada, CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(body!.e)))).toBe(RESULT_INVALID);
  // Opened, it is a container, not a creature to feed.
  h.pilots[0]!.buttons = BTN_USE;
  h.run(100);
  h.pilots[0]!.buttons = 0;
  h.run(300);
  expect(ada.open?.name).toBe("dodo");
  expect(ask(h, ada, CMD_FEED, (w) => (w.varint(0), w.u16(id("core:berry"))))).toBe(RESULT_DENIED);
  // A wild dodo struck beside a body and a living one: only the living one takes fright with it.
  const [w1, w2, w3] = [0, 1, 2].map((k) => h.host.spawnCreature("core:dodo", at.x - 6 + k * 2, at.z + 8, 3));
  h.run(500);
  h.host.survival.hurt(h.host.records.byPid.get(ents.pid[w1!]!)!, 1e6, 0);
  h.run(500);
  const alarmed = h.host.creatures.mind.alarmed;
  h.host.creatures.provoke(w2!, ents.x[w2!]! - 2, ents.z[w2!]!, h.ent(ada));
  expect(h.host.creatures.mind.alarmed - alarmed).toBe(1);
  void w3;
});

test("a creature that dies held, mating, knocked out under water, or of a fall after it was thrown leaves one body where it came to lie, and dies once", () => {
  const { h, ada, at, me, id } = camp();
  const ents = h.world.ents;
  const sv = h.host.survival;
  // Each death that is carried out, and each creature credited for it.
  const deaths = new Map<number, number>();
  const die = h.host.death.die.bind(h.host.death);
  h.host.death.die = (rec, cause) => {
    deaths.set(rec.pid, (deaths.get(rec.pid) ?? 0) + 1);
    die(rec, cause);
  };
  const killed = h.host.combat.killed.bind(h.host.combat);
  const credited = new Map<number, number>();
  h.host.combat.killed = (rec, by) => {
    credited.set(rec.pid, (credited.get(rec.pid) ?? 0) + 1);
    killed(rec, by);
  };
  const ground = (x: number, z: number): number => h.world.hf.heightAt(x, z);
  const lay = (kill: () => void): Body => {
    const before = new Set(h.host.corpses.bodies.keys());
    kill();
    const made = since(h, before);
    expect(made.length).toBe(1);
    return made[0]!;
  };

  // Held in her arms: set down beside her, then laid there.
  const held = h.host.spawnCreature("core:dodo", at.x, at.z + 1.2, 5);
  const heldRec = tamed(h, me, held);
  h.run(300);
  const pilot = h.pilots[0]!;
  const her = h.ent(ada);
  pilot.yaw = Math.atan2(ents.x[held]! - ents.x[her]!, ents.z[held]! - ents.z[her]!);
  pilot.pitch = Math.atan2(ents.y[held]! + 0.3 - (ents.y[her]! + 1.62), Math.hypot(ents.x[held]! - ents.x[her]!, ents.z[held]! - ents.z[her]!));
  h.run(200);
  expect(ask(h, ada, CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(held)))).toBe(RESULT_OK);
  h.run(300);
  const inArms = lay(() => {
    sv.gods.delete(heldRec.pid);
    sv.add(heldRec, V_HEALTH, -1e9);
  });
  h.run(3000);
  // Set down as it died, it is refreshed, which finds it dead again: that second death is not carried out.
  expect([deaths.get(heldRec.pid), credited.get(heldRec.pid), h.host.carry.holding(h.client(ada)!), (ents.cue[inArms.e]! & CUE_HELD) !== 0]).toEqual([1, 1, -1, false]);
  expect(Math.hypot(inArms.x - ents.x[her]!, inArms.z - ents.z[her]!)).toBeLessThan(1.6);
  expect(Math.abs(inArms.y - ground(inArms.x, inArms.z))).toBeLessThan(0.3);

  // Mating: the pair parts, and the body carries no heart.
  const f = h.host.spawnCreature("core:dodo", at.x - 4, at.z + 4, 5);
  const m = h.host.spawnCreature("core:dodo", at.x - 3, at.z + 4, 5);
  const fr = tamed(h, me, f, true);
  const mr = tamed(h, me, m, false);
  expect([h.host.breeding.order(fr, ORDER_MATE), h.host.breeding.order(mr, ORDER_MATE)]).toEqual([RESULT_OK, RESULT_OK]);
  h.run(1500);
  expect(h.host.breeding.pairCount).toBe(1);
  const mated = lay(() => sv.hurt(fr, 1e6, 0));
  h.run(1500);
  expect([deaths.get(fr.pid), h.host.breeding.pairCount, (ents.cue[mated.e]! >>> 28) & 7, (ents.cue[m]! >>> 28) & 7]).toEqual([1, 0, 0, 0]);

  // Knocked out under water: it drowns once, and its body lies there knocked out, under the water.
  const sea = h.world.hf.seaLevel;
  const [px, pz] = [PROVING_POOL.x, PROVING_POOL.z];
  const cold = h.host.spawnCreature("core:dodo", at.x + 6, at.z + 4, 1);
  h.host.creatures.mind.stay(cold, 0xffffffff);
  const coldRec = h.host.records.byPid.get(ents.pid[cold]!)!;
  sv.add(coldRec, V_TORPOR, coldRec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(500);
  h.say(ada, `tp ${(px + 12).toFixed(3)} ${(pz + 0.5).toFixed(3)}`);
  ents.flags[cold] = ents.flags[cold]! & ~F_GROUNDED;
  ents.setPosition(cold, px - 3, sea - 3, pz);
  ents.vy[cold] = 0;
  const before = new Set(h.host.corpses.bodies.keys());
  for (let k = 0; k < 90 && h.host.records.byPid.has(coldRec.pid); k++) h.run(1000);
  const [drowned] = since(h, before);
  expect([deaths.get(coldRec.pid), drowned!.out, (ents.cue[drowned!.e]! & CUE_OUT) !== 0, drowned!.y < sea, sv.isSubmerged(coldRec)]).toEqual([1, true, true, true, false]);

  // Thrown, and dead of the fall from twenty metres: laid where it came down.
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const flung = h.host.spawnCreature("core:dodo", at.x, at.z + 1.2, 5);
  const flungRec = tamed(h, me, flung);
  h.run(300);
  pilot.yaw = Math.atan2(ents.x[flung]! - ents.x[h.ent(ada)]!, ents.z[flung]! - ents.z[h.ent(ada)]!);
  pilot.pitch = -0.5;
  h.run(200);
  expect(ask(h, ada, CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(flung)))).toBe(RESULT_OK);
  pilot.pitch = 0;
  h.run(200);
  expect(ask(h, ada, CMD_CARRY, (w) => w.u8(CARRY_THROW))).toBe(RESULT_OK);
  ents.setPosition(flung, ents.x[flung]!, ents.y[flung]! + 20, ents.z[flung]!);
  const fell = new Set(h.host.corpses.bodies.keys());
  for (let k = 0; k < 40 && h.host.records.byPid.has(flungRec.pid); k++) h.run(100);
  const [landed] = since(h, fell);
  expect(deaths.get(flungRec.pid)).toBe(1);
  expect(Math.abs(landed!.y - ground(landed!.x, landed!.z))).toBeLessThan(0.5);
  h.run(2000);
  expect(h.host.items.audit()).toEqual([]);
  void id;
});

test("a body is the same for two clients that saw it fall, one that joined after, and the server, to the bit", () => {
  const { h, at, me } = camp();
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x + 2).toFixed(3)} ${at.z.toFixed(3)}`);
  const anims = h.world.anims;
  const drawn = new Map<ClientSession, Drawn>();
  const r = new RemoteSample();
  const follow = (): void => {
    for (const s of h.sessions) {
      if (!s.world) continue;
      let d = drawn.get(s);
      if (!d) drawn.set(s, (d = new Drawn(anims)));
      s.sampleRemote(r);
      d.update(r, s.world, at.x, at.z, new Map());
    }
  };
  const run = (ms: number): void => h.run(ms, follow);
  run(500);
  const kinds = ["core:dodo", "core:raptor", "core:parasaur"];
  const bodies = kinds.map((kind, k) => {
    const e = h.host.spawnCreature(kind, at.x - 4 + k * 4, at.z + 5, 1);
    h.host.creatures.mind.stay(e, 0xffffffff);
    return h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  });
  run(500);
  const before = new Set(h.host.corpses.bodies.keys());
  for (const rec of bodies) h.host.survival.hurt(rec, 1e6, me.pid);
  run(6000);
  const cat = h.join("cat");
  run(1500);
  const laid = [...h.host.corpses.bodies.values()].filter((b) => !before.has(b.rec.pid));
  expect(laid.length).toBe(3);
  for (const b of laid) {
    expect(b.fall!.still).toBe(true);
    for (const s of h.sessions) {
      const c = drawn.get(s)!.list.find((x) => x.id === b.e)!;
      const id = h.reg.ids[b.kind];
      expect([id, s === cat ? !c.watched : c.watched, c.fall!.still, c.x, c.y, c.z, c.yaw]).toEqual([id, true, true, b.x, b.y, b.z, b.yaw]);
      expect([id, Array.from(c.solved.pos), Array.from(c.solved.rot)]).toEqual([id, Array.from(b.pose!.pos), Array.from(b.pose!.rot)]);
    }
  }
  void TICK_RATE;
});

test("a body survives a restart where it lay, with the harvest health and the time it had left, and lies there as it did", () => {
  const db = join(dir, "restart.db");
  const { h, at, me, id } = camp({ dbPath: db });
  const b = killed(h, "core:raptor", at.x, at.z + 4, me);
  h.host.corpses.take(me, b, 20, id("core:hatchet"));
  const [pid, left, ends, x, y, z] = [b.rec.pid, b.left, b.rec.expiresAt, b.x, b.y, b.z];
  const pose = Array.from(b.pose!.pos);
  h.run(500);
  h.host.shutdown();
  const h2 = new Harness({}, 1, 60, { dbPath: db });
  const b2 = h2.host.corpses.bodies.get(pid)!;
  expect([b2.left, b2.rec.expiresAt, b2.x, b2.y, b2.z, h2.reg.ids[b2.kind]]).toEqual([left, ends, x, y, z, "core:raptor"]);
  expect((h2.world.ents.cue[b2.e]! & CUE_DEAD) !== 0).toBe(true);
  h2.run(4000);
  expect(Array.from(b2.pose!.pos)).toEqual(pose);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});

test("a save holding bodies beside fertilised eggs in hands and in a body loads as it was, the eggs still standing for their young", () => {
  const db = join(dir, "eggs-and-bodies.db");
  const { h, ada, at, me, id } = camp({ dbPath: db });
  const items = h.host.items;
  /** A fertilised dodo egg lying 1.5 m north of her, as breeding lays one, taken up into her bag. Returns its record. */
  const takeEgg = (): EntityRecord => {
    const e = h.ent(ada);
    const egg = h.host.records.create(id("core:egg_dodo"), "dodo egg");
    egg.genome = rollWild(new Rng(7), 5, h.reg.colorSet[id("core:dodo")]!);
    egg.team = me.team;
    [egg.x, egg.z] = [h.world.ents.x[e]!, h.world.ents.z[e]! + 1.2];
    egg.y = h.world.hf.heightAt(egg.x, egg.z);
    egg.egg = { species: id("core:dodo"), span: 9000, hatchAt: h.world.tick + 9000, carrier: 0 };
    h.host.death.place(egg);
    h.world.ents.setYoung(h.host.records.entOf.get(egg.pid)!, 9000, egg.egg.hatchAt);
    expect(ask(h, ada, CMD_TAKE, (w) => w.u32(h.host.records.entOf.get(egg.pid)!))).toBe(RESULT_OK);
    return egg;
  };
  const kept = takeEgg();
  const given = takeEgg();
  // The second goes into a dodo, which then dies: its body holds the egg.
  const dodo = h.host.spawnCreature("core:dodo", at.x + 3, at.z + 3, 5);
  const rec = h.host.records.byPid.get(h.world.ents.pid[dodo]!)!;
  const mine = items.inv(me);
  expect(items.move(me, mine.ref!.indexOf(given.pid), rec, 0, 0)).toBe(1);
  const was = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, me.pid);
  h.run(500);
  const [body] = since(h, was);
  const holds = items.inv(body!.rec);
  expect(holds.refOf(holds.item.indexOf(id("core:dodo_egg_fertile")))).toBe(given.pid);
  // A second body, harvested part way.
  const other = killed(h, "core:raptor", at.x - 4, at.z + 4, me, 500);
  h.host.corpses.take(me, other, 20, id("core:hatchet"));
  const left = other.left;
  h.run(500);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  const b1 = h2.host.corpses.bodies.get(body!.rec.pid)!;
  const b2 = h2.host.corpses.bodies.get(other.rec.pid)!;
  const inv1 = h2.host.items.inv(b1.rec);
  const inv2 = h2.host.items.inv(h2.host.records.byPid.get(me.pid)!);
  expect([h2.reg.ids[b1.kind], b1.e >= 0, inv1.refOf(inv1.item.indexOf(id("core:dodo_egg_fertile"))), h2.host.records.byPid.has(given.pid)]).toEqual(["core:dodo", true, given.pid, true]);
  expect([h2.reg.ids[b2.kind], b2.left, inv2.refOf(inv2.item.indexOf(id("core:dodo_egg_fertile"))), h2.host.records.byPid.has(kept.pid)]).toEqual(["core:raptor", left, kept.pid, true]);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});

/** Runs the corpse child until it has acknowledged `acks` commits, kills it without warning, and returns the last journal entry acknowledged. */
async function untilKilled(db: string, seed: number, acks: number): Promise<number> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../fixtures/corpse-child.ts"), db, String(seed)], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let text = "";
  let killed = false;
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (!killed && text.split("acked").length > acks) {
      proc.kill(9);
      killed = true;
    }
  }
  await proc.exited;
  return Number([...text.matchAll(/acked (\d+)\n/g)].at(-1)![1]);
}

test("killing the process at any moment of a harvest loses nothing: each body's health and each harvester's pieces are the blows committed, and the ledger balances", async () => {
  const reg = coreRegistry();
  const items = DROPS.map((d) => reg.index.get(d)!);
  for (const [seed, acks] of [[5, 30], [6, 70]] as const) {
    const db = join(dir, `harvest-${seed}.db`);
    const last = await untilKilled(db, seed, acks);
    // Loading audits the ledger, so a piece in two places or in none stops it here.
    const host = createHost(reg, { dbPath: db });
    const journal = host.persistence!.store.journal();
    expect(journal.at(-1)!.seq).toBeGreaterThanOrEqual(last);
    const max = new Map<number, number>();
    const dealt = new Map<number, number>();
    const got = new Map<number, number[]>();
    for (const j of journal) {
      const r = new BitReader(j.data);
      if (j.op === OP_LAY) max.set(r.uint53(), r.f64());
      if (j.op !== OP_BLOW) continue;
      const body = r.uint53();
      const by = r.uint53();
      dealt.set(body, (dealt.get(body) ?? 0) + r.varint());
      const g = got.get(by) ?? items.map(() => 0);
      for (let k = 0; k < items.length; k++) g[k] = g[k]! + r.varint();
      got.set(by, g);
    }
    expect(dealt.size).toBeGreaterThan(5);
    for (const [pid, most] of max) {
      const b = host.corpses.bodies.get(pid);
      // One still lying has taken exactly the blows committed. One gone was used up by them.
      if (b) expect([b.max, b.max - b.left, b.e >= 0]).toEqual([most, dealt.get(pid) ?? 0, true]);
      else expect(dealt.get(pid)!).toBeGreaterThanOrEqual(most);
    }
    expect(host.corpses.count).toBe([...max.keys()].filter((pid) => (dealt.get(pid) ?? 0) < max.get(pid)!).length);
    for (const pid of host.persistence!.survivors.values()) {
      const inv = host.items.inv(host.records.byPid.get(pid)!);
      expect(items.map((item) => inv.total(item))).toEqual(got.get(pid) ?? items.map(() => 0));
    }
    host.shutdown();
  }
});

// Bodies from the sky (planning/reference/flyers-plan.md, FL7): the pteranodon stand-in and a body with bones, killed,
// knocked out or bola'd 100 m up. Nothing flies yet, so each is put there and let go.

/** Puts entity `e` `high` metres over the ground under it, still and off the ground. Returns the ground's height. */
function aloft(h: Harness, e: number, high: number): number {
  const ents = h.world.ents;
  const ground = h.world.hf.heightAt(ents.x[e]!, ents.z[e]!);
  ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
  ents.setPosition(e, ents.x[e]!, ground + high, ents.z[e]!);
  ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
  return ground;
}

/** The body each session draws and samples, followed every frame: its Drawn bodies, and where it samples entity `e` now. */
function watchers(h: Harness, at: { x: number; z: number }) {
  const drawn = new Map<ClientSession, Drawn>();
  const r = new RemoteSample();
  const follow = (): void => {
    for (const s of h.sessions) {
      if (!s.world) continue;
      let d = drawn.get(s);
      if (!d) drawn.set(s, (d = new Drawn(h.world.anims)));
      s.sampleRemote(r);
      d.update(r, s.world, at.x, at.z, new Map());
    }
  };
  /** Where `s` samples entity `e`, or null where it has none. */
  const sampled = (s: ClientSession, e: number): [number, number, number] | null => {
    s.sampleRemote(r);
    for (let i = 0; i < r.count; i++) if (r.id[i] === e) return [r.x[i]!, r.y[i]!, r.z[i]!];
    return null;
  };
  return { drawn, follow, sampled, run: (ms: number): void => h.run(ms, follow) };
}

/** Each session's drawn body for `b` lies as the server's does, to the bit. `joined` came after it lay. */
function sameEverywhere(h: Harness, drawn: Map<ClientSession, Drawn>, b: Body, joined: ClientSession): void {
  const id = h.reg.ids[b.kind];
  expect([id, b.fall!.still]).toEqual([id, true]);
  for (const s of h.sessions) {
    const c = drawn.get(s)!.list.find((x) => x.id === b.e)!;
    expect([id, s === joined ? !c.watched : c.watched, c.falling, c.fall!.still, c.x, c.y, c.z, c.yaw]).toEqual([id, true, false, true, b.x, b.y, b.z, b.yaw]);
    expect([id, Array.from(c.solved.pos), Array.from(c.solved.rot)]).toEqual([id, Array.from(b.pose!.pos), Array.from(b.pose!.rot)]);
  }
}

test("a stand-in killed 100 m up falls to the ground in 3.2 s and lies there the same for the server, two clients that watched and one that joined after, and is harvested there", () => {
  const { h, ada, at, me, id, have } = camp();
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x + 2).toFixed(3)} ${at.z.toFixed(3)}`);
  const w = watchers(h, at);
  w.run(500);
  const ents = h.world.ents;
  // The pteranodon is a box; the raptor has bones and a ragdoll, which shows the pose too lies the same.
  const recs = ["core:pteranodon", "core:raptor"].map((kind, k) => {
    const e = h.host.spawnCreature(kind, at.x - 3 + k * 6, at.z + 6, 1);
    h.host.creatures.mind.stay(e, 0xffffffff);
    return h.host.records.byPid.get(ents.pid[e]!)!;
  });
  w.run(500);
  const before = new Set(h.host.corpses.bodies.keys());
  const ground = recs.map((rec) => aloft(h, h.host.records.entOf.get(rec.pid)!, 100));
  for (const rec of recs) h.host.survival.hurt(rec, 1e6, me.pid);
  const [ptero, raptor] = since(h, before);
  expect([ptero!.kind, raptor!.kind]).toEqual([id("core:pteranodon"), id("core:raptor")]);
  for (const [k, b] of [ptero!, raptor!].entries()) expect([b.drop !== null, ents.anim[b.e], b.y - ground[k]!, b.fall]).toEqual([true, FALLING, 100, null]);
  // Bob sees each fall through the air, not appear on the ground.
  const heights: number[][] = [[], []];
  const t0 = h.world.tick;
  while (h.host.corpses.falling > 0 && h.world.tick - t0 < 200) {
    w.run(1000 / 30);
    for (const [k, b] of [ptero!, raptor!].entries()) heights[k]!.push(w.sampled(bob, b.e)![1] - ground[k]!);
  }
  // The step falls at 20 m/s2 to 60 m/s, which it reaches at 91 m: 100 m takes 94.5 ticks.
  expect(h.world.tick - t0).toBeGreaterThanOrEqual(94);
  expect(h.world.tick - t0).toBeLessThanOrEqual(96);
  for (const seen of heights) expect([seen.some((y) => y > 70 && y < 90), seen.some((y) => y > 10 && y < 30)]).toEqual([true, true]);
  w.run(6000);
  const cat = h.join("cat");
  w.run(1500);
  for (const [k, b] of [ptero!, raptor!].entries()) {
    expect([b.drop, ents.anim[b.e], Math.abs(b.y - ground[k]!) < 0.01, b.rec.x === b.x && b.rec.y === b.y && b.rec.z === b.z]).toEqual([null, 0, true, true]);
    // Every client is sent it where the server has it.
    for (const s of h.sessions) expect(w.sampled(s, b.e)).toEqual([b.x, b.y, b.z]);
  }
  sameEverywhere(h, w.drawn, raptor!, cat);
  // Harvested where it lies, with a swing of a hatchet.
  h.say(ada, "give core:hatchet 1");
  takeInHand(h, ada, id("core:hatchet"));
  face(h, ada, ptero!);
  const blows = h.host.corpses.blows;
  swing(h, h.pilots[0]!, 1, SWING_TICKS);
  expect([h.host.corpses.blows - blows, ptero!.left < ptero!.max, have("core:hide") + have("core:meat") > 0]).toEqual([1, true, true]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a body over a building lands on its roof, one over the pool sinks to its bottom, and one that dies afloat sinks there as slowly as a ragdoll does, each the same for every client", () => {
  const { h, at, me, id } = camp();
  const bob = h.join("bob");
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${(at.x + 2).toFixed(3)} ${at.z.toFixed(3)}`);
  const w = watchers(h, at);
  w.run(500);
  const ents = h.world.ents;
  const sea = h.world.hf.seaLevel;
  // A roof of four ceilings, six metres square and five metres up, at the far end of the level ground.
  const ceiling = id("core:ceiling_wood");
  const roof = { x: at.x - 8, z: at.z + 16 };
  const floor = h.world.hf.heightAt(roof.x, roof.z) + 5;
  for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) h.world.structs.add(ceiling, roof.x + dx, floor, roof.z + dz, 0, 0, 10000);
  const top = floor + h.reg.halfY[ceiling]!;
  const spawn = (kind: string, x: number, z: number): EntityRecord => {
    const e = h.host.spawnCreature(kind, x, z, 1);
    h.host.creatures.mind.stay(e, 0xffffffff);
    return h.host.records.byPid.get(ents.pid[e]!)!;
  };
  const entOf = (rec: EntityRecord): number => h.host.records.entOf.get(rec.pid)!;
  const onRoof = [spawn("core:pteranodon", roof.x + 1.2, roof.z), spawn("core:raptor", roof.x - 1, roof.z + 0.5)];
  const inPool = spawn("core:pteranodon", PROVING_POOL.x, PROVING_POOL.z);
  const afloat = spawn("core:dodo", PROVING_POOL.x + 3, PROVING_POOL.z);
  w.run(3000);
  // The dodo swims at the surface; the rest are lifted 100 m and all four killed.
  expect([ents.mode[entOf(afloat)], ents.y[entOf(afloat)]! > sea - 1]).toEqual([MODE_SWIM, true]);
  for (const rec of [...onRoof, inPool]) aloft(h, entOf(rec), 100);
  const before = new Set(h.host.corpses.bodies.keys());
  for (const rec of [...onRoof, inPool, afloat]) h.host.survival.hurt(rec, 1e6, me.pid);
  const [ptero, raptor, sunk, dodo] = since(h, before);
  const t0 = h.world.tick;
  let dodoAt = -1;
  for (let k = 0; k < 120 && h.host.corpses.falling > 0; k++) {
    w.run(250);
    if (dodoAt < 0 && dodo!.drop === null) dodoAt = h.world.tick;
  }
  expect([h.host.corpses.falling, dodoAt > 0]).toEqual([0, true]);
  // On the roof, not through it.
  expect([Math.abs(ptero!.y - top) < 0.01, Math.abs(raptor!.y - top) < 0.01]).toEqual([true, true]);
  // At the bottom of the pool, 8 m under.
  const bottom = (b: Body): number => h.world.hf.heightAt(b.x, b.z);
  expect([sunk!.y < sea - 6, Math.abs(sunk!.y - bottom(sunk!)) < 0.3, dodo!.y < sea - 6, Math.abs(dodo!.y - bottom(dodo!)) < 0.3]).toEqual([true, true, true, true]);
  // The dodo sank from the surface at about 0.55 m/s.
  const took = (dodoAt - t0) / TICK_RATE;
  expect(took).toBeGreaterThan(9);
  expect(took).toBeLessThan(18);
  w.run(10000);
  const cat = h.join("cat");
  w.run(1500);
  for (const b of [ptero!, sunk!]) for (const s of h.sessions) expect(w.sampled(s, b.e)).toEqual([b.x, b.y, b.z]);
  sameEverywhere(h, w.drawn, raptor!, cat);
  sameEverywhere(h, w.drawn, dodo!, cat);
  // The raptor's ragdoll lies on the roof.
  const lowest = Math.min(...Array.from({ length: raptor!.pose!.pos.length / 3 }, (_, k) => raptor!.pose!.pos[k * 3 + 1]!));
  expect(raptor!.y + lowest).toBeGreaterThan(top - 0.3);
});

/** Each landing Survival is told of for `rec`: the speed, and the health it took. */
function landings(h: Harness, rec: EntityRecord): [number, number][] {
  const sv = h.host.survival;
  const before = sv.landed.bind(sv);
  const seen: [number, number][] = [];
  sv.landed = (r, speed) => {
    const health = sv.value(r, V_HEALTH);
    before(r, speed);
    if (r === rec) seen.push([speed, health - sv.value(r, V_HEALTH)]);
  };
  return seen;
}

/** D385: a creature lands unhurt below 16 m/s, and loses 7 x 2/3 health for each metre a second over. */
const creatureFall = (speed: number): number => (speed - 16) * 7 * (2 / 3);

test("a stand-in knocked out 100 m up falls, lands at the step's 60 m/s, is hurt for D385's 205 of its 210, and wakes where it landed", () => {
  const { h, at } = camp();
  const ents = h.world.ents;
  const sv = h.host.survival;
  const e = h.host.spawnCreature("core:pteranodon", at.x, at.z + 6, 1);
  h.host.creatures.mind.stay(e, 0xffffffff);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.run(500);
  expect(sv.value(rec, V_HEALTH)).toBe(210);
  const seen = landings(h, rec);
  const ground = aloft(h, e, 100);
  sv.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  expect([rec.out, (ents.mflags[e]! & MF_OUT) !== 0]).toEqual([true, true]);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  for (let k = 0; k < 40 && seen.length === 0; k++) h.run(100);
  // It fell straight down, knocked out the whole way, and hit the ground at the step's terminal speed.
  expect(seen.length).toBe(1);
  const [speed, lost] = seen[0]!;
  expect(speed).toBeCloseTo(60, 3);
  expect(lost).toBeCloseTo(creatureFall(speed), 4);
  expect([rec.out, h.host.records.byPid.has(rec.pid), Math.abs(ents.y[e]! - ground) < 0.01, Math.hypot(ents.x[e]! - x, ents.z[e]! - z) < 1e-3]).toEqual([true, true, true, true]);
  expect(sv.value(rec, V_HEALTH)).toBeCloseTo(210 - creatureFall(60), 1);
  // Its torpor run out, it wakes where it lies, and is not hurt again.
  h.run(2000);
  sv.add(rec, V_TORPOR, -1e9);
  h.run(1000);
  expect([rec.out, (ents.mflags[e]! & MF_OUT) !== 0, seen.length, Math.hypot(ents.x[e]! - x, ents.z[e]! - z) < 1e-3, Math.abs(ents.y[e]! - ground) < 0.01]).toEqual([false, false, 1, true, true]);
});

test("a ridden stand-in bola'd 100 m up comes down where it was caught with its rider on it, is hurt by the landing and she is not, and stands rooted until its 30 s are out", () => {
  const { h, ada, at, me, id } = camp();
  const ents = h.world.ents;
  const sv = h.host.survival;
  sv.gods.delete(me.pid);
  const c = h.client(ada)!;
  const e = h.host.spawnCreature("core:pteranodon", at.x, at.z + 3, 1);
  h.host.creatures.mind.stay(e, 0xffffffff);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  rec.team = me.team;
  rec.saddle = id("core:saddle_pteranodon");
  h.host.refreshBody(rec);
  h.run(300);
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  h.run(500);
  const hers = sv.value(me, V_HEALTH);
  const mount = landings(h, rec);
  const rider = landings(h, me);
  // Up 100 m with her pressing on, and caught there. The bola's own list is the weapons team's, and gains the pteranodon
  // with them: the buff a hit gives is given here.
  const pilot = h.pilots[0]!;
  pilot.moveZ = 127;
  const ground = aloft(h, e, 100);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  expect(h.host.buffs.give(rec, id("core:entangled"), 0)).toBe(true);
  const caught = h.world.tick;
  h.run(100);
  expect((ents.mflags[e]! & MF_ROOTED) !== 0).toBe(true);
  for (let k = 0; k < 40 && mount.length === 0; k++) h.run(100);
  // Straight down, not where she steered, and she is still on it, on its back.
  expect([mount.length, Math.hypot(ents.x[e]! - x, ents.z[e]! - z) < 0.01, Math.abs(ents.y[e]! - ground) < 0.01, h.host.riding.riding(c)]).toEqual([1, true, true, true]);
  expect(mount[0]![1]).toBeCloseTo(creatureFall(mount[0]![0]), 4);
  const her = h.ent(ada);
  expect([Math.hypot(ents.x[her]! - x, ents.z[her]! - z) < 1, ents.y[her]! > ents.y[e]!]).toEqual([true, true]);
  // It lies rooted until the bola's 30 s are out, then walks on under her.
  h.run(((caught + 30 * TICK_RATE - h.world.tick) / TICK_RATE) * 1000 - 300);
  expect([Math.hypot(ents.x[e]! - x, ents.z[e]! - z) < 0.01, (ents.mflags[e]! & MF_ROOTED) !== 0, h.host.riding.riding(c)]).toEqual([true, true, true]);
  h.run(2500);
  expect([Math.hypot(ents.x[e]! - x, ents.z[e]! - z) > 1, (ents.mflags[e]! & MF_ROOTED) !== 0]).toEqual([true, false]);
  expect([rider.length, sv.value(me, V_HEALTH) >= hers]).toEqual([0, true]);
});

test("a body saved while it fell falls on after a restart, from where it was saved, and lies on the ground; one saved lying stays as it lay", () => {
  const db = join(dir, "falling.db");
  const { h, at, me } = camp({ dbPath: db });
  const ents = h.world.ents;
  const lying = killed(h, "core:raptor", at.x + 4, at.z + 4, me);
  const pose = Array.from(lying.pose!.pos);
  const e = h.host.spawnCreature("core:raptor", at.x - 4, at.z + 4, 1);
  h.host.creatures.mind.stay(e, 0xffffffff);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.run(500);
  const ground = aloft(h, e, 100);
  const before = new Set(h.host.corpses.bodies.keys());
  h.host.survival.hurt(rec, 1e6, me.pid);
  const [b] = since(h, before);
  h.run(1000);
  expect([b!.drop !== null, b!.y < ground + 95, b!.y > ground + 50]).toEqual([true, true, true]);
  h.host.shutdown();
  const h2 = new Harness({}, 1, 60, { dbPath: db });
  const b2 = h2.host.corpses.bodies.get(b!.rec.pid)!;
  const l2 = h2.host.corpses.bodies.get(lying.rec.pid)!;
  // The store keeps where its entity was when the record was last written, in the air.
  expect([b2.y > ground + 50, b2.drop]).toEqual([true, null]);
  h2.run(100);
  expect([h2.host.corpses.falling, b2.drop !== null, b2.fall, h2.world.ents.anim[b2.e], l2.drop]).toEqual([1, true, null, FALLING, null]);
  h2.run(8000);
  expect([h2.host.corpses.falling, Math.abs(b2.y - ground) < 0.01, b2.fall!.still, h2.world.ents.anim[b2.e]]).toEqual([0, true, true, 0]);
  expect(Array.from(l2.pose!.pos)).toEqual(pose);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});
