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
import type { HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { CUE_DEAD, CUE_DECAY_SHIFT, STAGE_WORST } from "../../shared/anim/pose.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_OPEN, RESULT_INVALID } from "../../shared/net/protocol.ts";
import { BTN_USE } from "../../shared/sim/character.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { swing, takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

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
