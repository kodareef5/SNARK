// The mechanisms round 4 builds on: the body a session drives, view priority, teams, torpor and container sizes.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { torporDrain, torporMax, wildLevels } from "../../server/survival.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { MAX_VIEW } from "../../shared/net/view.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";
import { rollWild } from "../../shared/sim/genome.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-seams-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const EYE = 1.62;

function seen(s: ClientSession): RemoteSample {
  const out = new RemoteSample();
  s.sampleRemote(out);
  return out;
}

function indexOf(sample: RemoteSample, name: string): number {
  for (let i = 0; i < sample.count; i++) if (sample.name[i] === name) return i;
  return -1;
}

test("possess: a session's keys drive a creature in place of its own body, predicted without a correction, and letting go gives its body back", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const link = { latencyMs: 60 };
  const ada = h.join("ada", link);
  const bob = h.join("bob", link);
  h.run(700);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 40, 40);
  const at = { x: g.x + 10, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${(at.x + 6).toFixed(3)} ${at.z.toFixed(3)}`);
  const ents = h.world.ents;
  const me = h.ent(ada);
  const pilot = h.pilots[0]!;
  const c = h.client(ada)!;
  const game = h.server;

  const e = h.host.spawnCreature("core:grazer", at.x, at.z + 3, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  // The grazer wanders, so each try aims at it again.
  let said: string[] = [];
  for (let tries = 0; tries < 6 && c.drive < 0; tries++) {
    const far = Math.hypot(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!);
    pilot.yaw = Math.atan2(ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!);
    pilot.pitch = Math.atan2(0.8 - EYE, far);
    h.run(120);
    said = h.say(ada, "possess", 200);
  }
  expect(said[0]).toBe("driving core:grazer");
  expect(c.drive).toBe(e);
  expect(ents.driven[e]).toBe(1);
  expect(game.take(c, h.ent(bob))).toBe(false);
  expect(game.take(h.client(bob)!, e)).toBe(false);
  expect(game.take(h.client(bob)!, h.ent(bob))).toBe(false);
  expect(game.take(h.client(bob)!, h.ent(ada))).toBe(false);

  // The switch arrives as the body in a snapshot and costs one correction.
  h.run(400);
  expect(ada.driving).toBe(e);
  expect(ada.bodyKind).toBe(id("grazer"));
  expect(ada.ownKind).toBe(id("survivor"));
  const settled = ada.stats.corrections + ada.stats.stateCorrections;
  const [mx, mz] = [ents.x[me]!, ents.z[me]!];
  const [gx, gz] = [ents.x[e]!, ents.z[e]!];
  pilot.pitch = 0;
  pilot.yaw = 0.3;
  pilot.moveZ = 1;
  h.run(1500);
  pilot.yaw = 1.1;
  pilot.moveX = 0.5;
  pilot.buttons = BTN_SPRINT;
  h.run(1500);
  pilot.buttons = BTN_SPRINT | BTN_JUMP;
  h.run(900);
  pilot.moveX = pilot.moveZ = pilot.buttons = 0;
  h.run(700);
  expect(ada.stats.corrections + ada.stats.stateCorrections - settled).toBe(0);
  expect(Math.hypot(ents.x[e]! - gx, ents.z[e]! - gz)).toBeGreaterThan(6);
  expect([ada.own.x, ada.own.y, ada.own.z]).toEqual([ents.x[e]!, ents.y[e]!, ents.z[e]!]);
  // Ada's view now includes her own body, because she is no longer in it.
  expect([ents.x[me]!, ents.z[me]!]).toEqual([mx, mz]);
  const hers = seen(ada);
  const his = seen(bob);
  expect(indexOf(hers, "ada")).toBeGreaterThanOrEqual(0);
  const body = indexOf(his, "ada");
  expect(his.x[body]).toBeCloseTo(mx, 1);
  expect(his.z[body]).toBeCloseTo(mz, 1);
  let grazer = -1;
  for (let i = 0; i < his.count; i++) if (his.kind[i] === id("grazer") && Math.hypot(his.x[i]! - ents.x[e]!, his.z[i]! - ents.z[e]!) < 0.1) grazer = i;
  expect(grazer).toBeGreaterThanOrEqual(0);

  expect(h.say(ada, "possess off")[0]).toBe("back in your own body");
  expect(h.say(ada, "possess off")[0]).toBe("you are driving nothing");
  h.run(300);
  expect([c.drive, ada.driving, ents.driven[e]]).toEqual([-1, -1, 0]);
  expect(ada.bodyKind).toBe(id("survivor"));
  expect(indexOf(seen(ada), "ada")).toBe(-1);
  const back = ada.stats.corrections + ada.stats.stateCorrections;
  pilot.yaw = Math.PI / 2;
  pilot.moveZ = 1;
  h.run(1500);
  pilot.moveZ = 0;
  h.run(500);
  expect(ada.stats.corrections + ada.stats.stateCorrections - back).toBe(0);
  expect(Math.hypot(ents.x[me]! - mx, ents.z[me]! - mz)).toBeGreaterThan(4);
  expect([ada.own.x, ada.own.z]).toEqual([ents.x[me]!, ents.z[me]!]);

  expect(game.take(c, e)).toBe(true);
  h.run(300);
  expect(ada.driving).toBe(e);
  const grec = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.survival.hurt(grec, 1e6, 0);
  h.run(400);
  expect([c.drive, ada.driving]).toEqual([-1, -1]);
  expect(ada.bodyKind).toBe(id("survivor"));
  const e2 = h.host.spawnCreature("core:grazer", ents.x[me]!, ents.z[me]! + 3, 1);
  expect(game.take(c, e2)).toBe(true);
  ada.close();
  h.run(300);
  expect(ents.driven[e2]).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("a view fills with players first, then what moves, then what stands: a crowd around one survivor hides neither another nor what it drives", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const w = h.world;
  const ents = w.ents;
  const g = flatGround(h, 12, 12);
  const a = { x: g.x + 6, z: g.z + 6 };
  // Bob stands in another chunk, so he is further from Ada than everything in her own.
  const p = reg.move[id("survivor")]!;
  let b: { x: number; z: number } | null = null;
  for (let r = CHUNK_SIZE; r < CHUNK_SIZE * 2 && !b; r += 3) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const [x, z] = [a.x + dx * r, a.z + dz * r];
      if (x < 4 || z < 4 || x > w.hf.sizeX - 4 || z > w.hf.sizeZ - 4) continue;
      const y = w.hf.heightAt(x, z);
      if (y > w.hf.seaLevel + 0.5 && chunkAt(w.dims, x, z) !== chunkAt(w.dims, a.x, a.z) && capsuleFree(w, x, y, z, p.radius, p.height)) b = { x, z };
    }
  }
  expect(b).not.toBeNull();
  h.say(ada, `tp ${a.x.toFixed(3)} ${a.z.toFixed(3)}`);
  h.say(bob, `tp ${b!.x.toFixed(3)} ${b!.z.toFixed(3)}`);
  const rng = new Rng(5);
  let crowd = 0;
  for (let i = 0; i < 4000 && crowd < MAX_VIEW + 90; i++) {
    const [x, z] = [g.x + rng.range(0.5, 11.5), g.z + rng.range(0.5, 11.5)];
    if (chunkAt(w.dims, x, z) === chunkAt(w.dims, a.x, a.z) && h.host.spawnCreature("core:dummy", x, z, 1) >= 0) crowd++;
  }
  expect(crowd).toBe(MAX_VIEW + 90);
  const e = h.host.spawnCreature("core:grazer", b!.x, b!.z + 2, 1);
  expect(h.server.take(h.client(bob)!, e)).toBe(true);
  h.pilots[1]!.moveZ = 1;
  // A view that full takes a while to arrive whole.
  h.run(4000);
  const hers = seen(ada);
  // Clients around one place share one list of MAX_VIEW entities, and her own body is one of them.
  expect(hers.count).toBe(MAX_VIEW - 1);
  expect(indexOf(hers, "bob")).toBeGreaterThanOrEqual(0);
  let grazers = 0;
  let dummies = 0;
  for (let i = 0; i < hers.count; i++) {
    if (hers.kind[i] === id("grazer") && Math.hypot(hers.x[i]! - ents.x[e]!, hers.z[i]! - ents.z[e]!) < 1) grazers++;
    if (hers.kind[i] === id("dummy")) dummies++;
  }
  expect(grazers).toBe(1);
  expect(dummies).toBeGreaterThanOrEqual(MAX_VIEW - 2 - 60);
  expect(dummies).toBeLessThan(crowd);
  expect(indexOf(seen(bob), "ada")).toBeGreaterThanOrEqual(0);
  expect(ada.stats.undecodable + bob.stats.undecodable).toBe(0);
});

test("every survivor is on a team: its own, seen by others as it moves, kept through a restart, and never given out twice", () => {
  const db = join(dir, "teams.db");
  const h = new Harness({}, 1, 60, { dbPath: db });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(600);
  const recOf = (hh: Harness, s: ClientSession) => hh.host.records.byPid.get(hh.world.ents.pid[hh.ent(s)]!)!;
  const [ta, tb] = [recOf(h, ada).team, recOf(h, bob).team];
  expect(ta).toBeGreaterThan(0);
  expect(tb).toBeGreaterThan(0);
  expect(ta).not.toBe(tb);
  const e = h.host.spawnCreature("core:grazer", 250, 250, 1);
  expect(h.host.records.byPid.get(h.world.ents.pid[e]!)!.team).toBe(0);
  expect(h.world.ents.team[h.ent(ada)]).toBe(ta);
  expect(seen(ada).team[indexOf(seen(ada), "bob")]).toBe(tb);
  h.pilots[1]!.moveZ = 1;
  h.run(1500);
  h.pilots[1]!.moveZ = 0;
  h.run(300);
  const hers = seen(ada);
  expect(hers.team[indexOf(hers, "bob")]).toBe(tb);
  for (let i = 0; i < hers.count; i++) if (hers.kind[i] === id("grazer")) expect(hers.team[i]).toBe(0);
  expect(seen(bob).team[indexOf(seen(bob), "ada")]).toBe(ta);
  const pids = [recOf(h, ada).pid, recOf(h, bob).pid];
  for (const s of [ada, bob]) s.close();
  h.run(200);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  expect(pids.map((pid) => h2.host.records.byPid.get(pid)!.team)).toEqual([ta, tb]);
  const again = h2.join("ada");
  const cy = h2.join("cy");
  h2.run(600);
  expect(recOf(h2, again).team).toBe(ta);
  const tc = recOf(h2, cy).team;
  expect([0, ta, tb]).not.toContain(tc);
  // Team numbers come from the same sequence as record ids, so a team number is never also a record's.
  const seqs = new Set([...h2.host.records.byPid.keys()].map((pid) => pid % 2 ** 32));
  for (const t of [ta, tb, tc]) expect(seqs.has(t)).toBe(false);
  h2.host.shutdown();
});

test("torpor follows the reference: its most grows 6% a level whatever the level went into, and it is shaken off faster by level and not at all while a dose acts", () => {
  // The reference's raptor: 180 torpor at level 1, draining 0.3 a second.
  const raptor = { stats: { torpidity: [180, 0.06, 0] }, torporDrain: 0.3 } as unknown as SpeciesDef;
  const level = (n: number) => rollWild(new Rng(n), n, [1]);
  expect(wildLevels(null)).toBe(0);
  expect(wildLevels(level(30))).toBe(29);
  expect(torporMax(raptor, level(1))).toBeCloseTo(180, 9);
  expect(torporMax(raptor, level(30))).toBeCloseTo(180 * (1 + 0.06 * 29), 9);
  expect(torporMax(raptor, level(150))).toBeCloseTo(1789.2, 6);
  expect(torporMax({} as SpeciesDef, level(30))).toBe(0);
  expect(torporDrain(raptor, level(1))).toBe(0.3);
  expect(torporDrain(raptor, level(30))).toBeCloseTo(0.3 + Math.pow(29, 0.800403041) / (22.39671632 / 0.3), 12);
  expect(torporDrain(raptor, level(30))).toBeCloseTo(0.4984, 3);
  expect(torporDrain(raptor, level(150))).toBeCloseTo(1.036, 2);

  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(500);
  const g = flatGround(h, 12, 12);
  const e = h.host.spawnCreature("core:grazer", g.x + 6, g.z + 6, 40);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  const { survival, buffs } = h.host;
  const def = reg.defs[id("grazer")] as SpeciesDef;
  expect(wildLevels(rec.genome)).toBe(39);
  const most = rec.vitals!.max[V_TORPOR]! / 1e6;
  expect(most).toBeCloseTo(150 * (1 + 0.06 * 39), 3);
  const torpor = (): number => survival.value(rec, V_TORPOR);
  survival.add(rec, V_TORPOR, 100);
  const drain = torporDrain(def, rec.genome);
  expect(drain).toBeGreaterThan(0.6 * 1.4);
  h.run(10000);
  expect(torpor()).toBeCloseTo(100 - drain * 10, 1);
  // A dose of 5 a second for 8 seconds adds 40, with no drain meanwhile.
  const before = torpor();
  expect(buffs.give(rec, id("tranquilized"), 0, 8, 5)).toBe(true);
  h.run(4000);
  expect(torpor()).toBeCloseTo(before + 20, 0);
  h.run(4100);
  expect(rec.buffs.length).toBe(0);
  expect(torpor()).toBeCloseTo(before + 40, 0);
  expect(torpor()).toBeLessThanOrEqual(before + 40);
  const after = torpor();
  h.run(10000);
  expect(torpor()).toBeCloseTo(after - drain * 10, 1);
  expect(s.stats.undecodable).toBe(0);
});

test("a thing holds what its kind says: a bag ten stacks, a cache sixty, a survivor its bag and what it wears", () => {
  const h = new Harness();
  const s = h.join("ada");
  h.run(500);
  const { records, items } = h.host;
  expect(items.inv(records.create(id("bag"), "bag")).bag).toBe(10);
  expect(items.inv(records.create(id("cache"), "cache")).bag).toBe(60);
  const mine = items.inv(records.byPid.get(h.world.ents.pid[h.ent(s)]!)!);
  expect(mine.bag).toBe(40);
  expect(mine.cap).toBeGreaterThan(mine.bag);
  const grazer = items.inv(records.create(id("grazer")));
  expect([grazer.bag, grazer.cap]).toEqual([grazer.cap, grazer.bag]);
});

test("a container of 350 slots: every slot is shown, reached by number past a byte's worth, and kept through a restart", () => {
  // This content's cache has a vault's 350 slots.
  const big = compileContent(CORE_CONTENT.map((d) => (d.id === "core:cache" ? { ...d, slots: 350 } : d))).registry!;
  const db = join(dir, "vault.db");
  const h = new Harness({}, 1, 60, { dev: true, dbPath: db }, big);
  const s = h.join("ada");
  h.run(500);
  h.say(s, "enablecheats");
  const stone = big.index.get("core:stone")!;
  const { records, items } = h.host;
  const box = records.create(big.index.get("core:cache")!, "vault");
  const stack = big.stack[stone]!;
  expect(items.mint(box, stone, stack * 340)).toBe(stack * 340);
  expect(items.inv(box).cap).toBe(350);
  const g = flatGround(h, 8, 8);
  box.x = g.x + 4;
  box.z = g.z + 2;
  box.y = g.y;
  box.expiresAt = h.world.tick + 10_000_000;
  h.host.death.place(box);
  h.say(s, `tp ${box.x.toFixed(3)} ${(box.z + 2).toFixed(3)}`);
  const pilot = h.pilots[0]!;
  pilot.yaw = Math.PI;
  pilot.pitch = Math.atan2(0.25 - EYE, 2);
  h.run(300);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(500);
  const open = s.open!.inventory;
  expect(s.open!.name).toBe("vault");
  expect(open.cap).toBe(350);
  expect(open.used()).toBe(340);
  expect([open.item[339], open.count[339], open.item[340]]).toEqual([stone, stack, 0]);
  const codes: number[] = [];
  s.onResult = (_seq, code) => codes.push(code);
  const move = (fromBox: number, from: number, toBox: number, to: number, count: number): number =>
    s.command(CMD_MOVE, (w) => (w.bits(fromBox, 1), w.varint(from), w.bits(toBox, 1), w.varint(to), w.u16(count), w.u16(stone)));
  // To its last slot, out from a slot past 255, and to slot 350, which it does not have.
  move(BOX_OPEN, 339, BOX_OPEN, 349, 0);
  move(BOX_OPEN, 300, BOX_SELF, 2, 7);
  move(BOX_OPEN, 299, BOX_OPEN, 350, 0);
  h.run(400);
  expect(codes).toEqual([RESULT_OK, RESULT_OK, RESULT_INVALID]);
  const server = items.inv(box);
  expect([server.item[339], server.count[349], server.count[300]]).toEqual([0, stack, stack - 7]);
  expect([open.item[339], open.count[349], open.count[300]]).toEqual([0, stack, stack - 7]);
  expect(s.inventory!.count[2]).toBe(7);
  expect(items.audit()).toEqual([]);
  s.close();
  h.run(200);
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dev: true, dbPath: db }, big);
  const kept = h2.host.records.byPid.get(box.pid)!.inv!;
  expect([kept.cap, kept.used(), kept.count[349], kept.count[300], kept.item[339]]).toEqual([350, 340, stack, stack - 7, 0]);
  expect(h2.host.items.audit()).toEqual([]);
  h2.host.shutdown();
});
