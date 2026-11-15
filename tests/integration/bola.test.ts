// The bola and entangling (planning/reference/weapons-plan.md, W4: M5 and M6), against ark.wiki.gg Bola as read on
// 2026-11-15: thrown and charged, it flies and hits; it does no harm but provokes; it roots a creature on its list 30 s and
// a survivor 25 s, who struggles free sooner by pressing jump and is then spared another for 10 s; a bola'd creature is
// not mounted; and the client predicts the rooted body as the server steps it.
import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { STRUGGLE_EVERY, STRUGGLE_SECONDS } from "../../server/entangle.ts";
import type { EntityRecord } from "../../server/records.ts";
import { FIELDS } from "../../shared/content/classes.ts";
import type { BuffDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { EVENT_SHOT, RESULT_DENIED, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_PRIMARY, MF_ROOTED, stanceEye } from "../../shared/sim/character.ts";
import { launchSpeed } from "../../shared/sim/projectiles.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { W_THROWN } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const BOLA = id("bola");
const ENTANGLED = id("entangled");
const SPENT = id("entangle_spent");

/** Ada stands at the south end of level ground looking north with bolas in hand; `link` is hers. */
function field(link = {}) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada", link);
  h.run(500);
  h.say(s, "enablecheats");
  const g = flatGround(h, 24, 40);
  const at = { x: g.x + 12, z: g.z + 2, y: g.y };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const pilot = h.pilots[0]!;
  pilot.yaw = pilot.pitch = 0;
  h.run(300);
  h.say(s, "kit bola");
  takeInHand(h, s, BOLA);
  h.run(1000);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  return { h, s, pilot, rec, at };
}

/** Holds the throw for `ticks` at the middle of entity `e`, aimed high by the drop of a full throw, and lets go. */
function throwAt(h: Harness, s: ClientSession, pilot: Pilot, e: number, ticks = 60): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const eye = ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, ents.stance[me]!);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  const far = Math.hypot(dx, dz);
  const t = far / launchSpeed(reg.ammoSpeed[BOLA]!, 1);
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye + 0.5 * 9.81 * t * t, far);
  h.run(200);
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * ticks);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(1000);
}

/** The tick the record's `buff` ends, or -1 if it has none. */
const until = (rec: EntityRecord, buff: number): number => rec.buffs.find((b) => b.buff === buff)?.until ?? -1;
const rooted = (h: Harness, e: number): boolean => (h.world.ents.mflags[e]! & MF_ROOTED) !== 0;

test("the bola is ARK's: thrown and charged, no harm, stack 10, weight 0.5, its recipe and engram, and its buffs' fields built", () => {
  const def = reg.defs[BOLA]!;
  expect(def).toMatchObject({ type: "item", class: "weapon", stack: 10, weight: 0.5, weapon: { kind: "thrown", draw: 1.6, uses: 1 }, ammo: { damage: 0, buff: "core:entangled" } });
  expect(def.type === "item" && def.craft).toMatchObject({ needs: [{ item: "core:thatch", count: 10 }, { item: "core:stone", count: 3 }, { item: "core:fiber", count: 15 }, { item: "core:hide", count: 3 }] });
  expect(reg.defs.find((d) => d?.type === "engram" && d.item === "core:bola")).toMatchObject({ level: 9, cost: 8 });
  // A quarter of the 1.6 s draw is ARK's 0.4 s least hold (DEV127).
  expect([reg.weapon[BOLA]!.kind, reg.weapon[BOLA]!.drawTicks, reg.weapon[BOLA]!.minDrawTicks]).toEqual([W_THROWN, 48, 12]);
  expect([reg.damage[BOLA], reg.ammoBuff[BOLA], reg.ammoRecover[BOLA]]).toEqual([0, ENTANGLED, 0]);
  const tangle = reg.defs[ENTANGLED] as BuffDef;
  expect(tangle).toMatchObject({ seconds: 30, survivorSeconds: 25, root: true, after: "core:entangle_spent" });
  // ARK's list by our ids: the grazer is no ARK creature.
  expect([...tangle.only!].sort()).toEqual(["core:dodo", "core:parasaur", "core:raptor", "core:survivor"]);
  expect(reg.defs[SPENT]).toMatchObject({ seconds: 10, only: ["core:survivor"] });
  expect([FIELDS.buff.only!.waits, FIELDS.buff.survivorSeconds!.waits, FIELDS.buff.after!.waits]).toEqual([undefined, undefined, undefined]);
  // What the fields name is checked, and a weapon with an ammo facet of its own must fly.
  const bad = (change: (d: Record<string, unknown>) => void): string[] => {
    const defs = CORE_CONTENT.map((d) => (d.id === "core:bola" && d.type === "item") || (d.id === "core:entangled" && d.type === "buff") ? structuredClone(d) : d);
    for (const d of defs) if (d.id === "core:bola" || d.id === "core:entangled") change(d as unknown as Record<string, unknown>);
    return compileContent(defs).errors;
  };
  expect(bad((d) => d.type === "item" && (d.ammo = { damage: 0, type: "melee" }))).toEqual(["core:bola: a weapon with an ammo facet of its own is thrown, and flies at its ammo.speed"]);
  expect(bad((d) => d.type === "buff" && (d.survivorSeconds = 0))).toEqual(["core:entangled: survivorSeconds must be in (0, 86400], got 0"]);
  expect(bad((d) => d.type === "buff" && (d.after = "core:entangled"))).toEqual(["core:entangled: after must name another buff"]);
});

test("a bola flies and hits a dodo: no harm, it provokes, and roots it 30 s where it stood; no grace follows for a creature", () => {
  const { h, s, pilot, rec, at } = field();
  const ents = h.world.ents;
  const e = h.host.spawnCreature("core:dodo", at.x, at.z + 7, 1);
  const dodo = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.run(300);
  const provoked: number[] = [];
  const creatures = h.host.creatures;
  const was = creatures.provoke.bind(creatures);
  creatures.provoke = (who, x, z, by) => (provoked.push(who), was(who, x, z, by));
  const health = h.host.survival.value(dodo, V_HEALTH);
  const flights = h.host.projectiles.fired;
  throwAt(h, s, pilot, e);
  const caughtAt = until(dodo, ENTANGLED);
  expect(h.host.projectiles.fired).toBe(flights + 1);
  expect(h.host.items.inv(rec).total(BOLA)).toBe(9);
  expect(caughtAt).toBeGreaterThan(0);
  // Thrown at full draw about 1.2 s ago: 30 s from the hit.
  expect((caughtAt - h.world.tick) / TICK_RATE).toBeGreaterThan(28);
  expect((caughtAt - h.world.tick) / TICK_RATE).toBeLessThanOrEqual(30);
  expect(h.host.survival.value(dodo, V_HEALTH)).toBe(health);
  expect(provoked).toContain(e);
  expect(rooted(h, e)).toBe(true);
  // The thrower's client is told of its own throw, so it draws it.
  expect(s.events.some((ev) => ev.kind === EVENT_SHOT && ev.item === BOLA && ev.flies)).toBe(true);
  // Provoked and let go, a wild dodo would run: rooted, it stays.
  h.host.creatures.mind.stay(e, 0);
  const [x0, z0] = [ents.x[e]!, ents.z[e]!];
  h.run(((caughtAt - h.world.tick) / TICK_RATE - 1) * 1000);
  expect(Math.hypot(ents.x[e]! - x0, ents.z[e]! - z0)).toBeLessThan(0.05);
  h.run(2000);
  expect([until(dodo, ENTANGLED), rooted(h, e), until(dodo, SPENT)]).toEqual([-1, false, -1]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a bola at a grazer, which is not on ARK's list, does nothing but provoke", () => {
  const { h, s, pilot } = field();
  const ents = h.world.ents;
  const e = h.host.spawnCreature("core:grazer", ents.x[h.ent(s)]!, ents.z[h.ent(s)]! + 7, 1);
  const grazer = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.run(300);
  const provoked: number[] = [];
  const creatures = h.host.creatures;
  const was = creatures.provoke.bind(creatures);
  creatures.provoke = (who, x, z, by) => (provoked.push(who), was(who, x, z, by));
  const refused = h.host.entangle.refused;
  throwAt(h, s, pilot, e);
  expect(provoked).toContain(e);
  expect(h.host.entangle.refused).toBe(refused + 1);
  expect([until(grazer, ENTANGLED), rooted(h, e)]).toEqual([-1, false]);
});

test("a survivor is rooted 25 s, predicted rooted by its own client at 100 ms with loss, struggles free sooner with jump, and is spared another for 10 s", () => {
  const { h, s, pilot, at } = field();
  const bob = h.join("bob", { latencyMs: 50, loss: 0.05 });
  h.run(500);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${at.x.toFixed(3)} ${(at.z + 8).toFixed(3)}`);
  const bp = h.pilots[1]!;
  bp.yaw = Math.PI;
  h.run(1500);
  const be = h.ent(bob);
  const brec = h.host.records.byPid.get(h.client(bob)!.pid)!;
  throwAt(h, s, pilot, be);
  const caughtAt = until(brec, ENTANGLED);
  expect(caughtAt).toBeGreaterThan(0);
  expect((caughtAt - h.world.tick) / TICK_RATE).toBeGreaterThan(23);
  expect((caughtAt - h.world.tick) / TICK_RATE).toBeLessThanOrEqual(25);
  expect(rooted(h, be)).toBe(true);
  // Its client has the root and steps the body as the server does: walking forward, it stays, and nothing is corrected.
  expect(bob.own.mflags & MF_ROOTED).toBe(MF_ROOTED);
  const corrections = (): number => bob.stats.corrections + bob.stats.stateCorrections;
  const ents = h.world.ents;
  const before = corrections();
  const [x0, z0] = [ents.x[be]!, ents.z[be]!];
  bp.moveZ = 127;
  h.run(4000);
  expect(Math.hypot(ents.x[be]! - x0, ents.z[be]! - z0)).toBeLessThan(0.01);
  expect(Math.hypot(bob.own.x - x0, bob.own.z - z0)).toBeLessThan(0.01);
  expect(corrections()).toBe(before);
  // Pressing jump as fast as it counts takes STRUGGLE_SECONDS off each press, and does not move the body either. It stops
  // walking first: the client learns of its freedom a round trip late, and would be corrected for the steps in between.
  bp.moveZ = 0;
  h.run(300);
  const struggleFrom = h.world.tick;
  const left = (until(brec, ENTANGLED) - struggleFrom) / TICK_RATE;
  let freedAt = -1;
  let whileRooted = corrections();
  for (let n = 0; n < 200 && freedAt < 0; n++) {
    bp.buttons |= BTN_JUMP;
    h.run(TICK_MS * 2);
    bp.buttons &= ~BTN_JUMP;
    h.run(TICK_MS * (STRUGGLE_EVERY - 2));
    if (until(brec, ENTANGLED) < 0) freedAt = h.world.tick;
    else {
      expect(Math.hypot(ents.x[be]! - x0, ents.z[be]! - z0)).toBeLessThan(0.01);
      whileRooted = corrections();
    }
  }
  const took = (freedAt - struggleFrom) / TICK_RATE;
  const pace = 1 + (STRUGGLE_SECONDS * TICK_RATE) / STRUGGLE_EVERY;
  expect(took).toBeGreaterThan(left / pace - 1);
  expect(took).toBeLessThan(left / pace + 1.5);
  expect(took).toBeLessThan(left / 2);
  // The press that frees it may jump on the server a round trip before its client knows it is free: one correction at
  // most, then, and none before.
  expect(whileRooted).toBe(before);
  expect(corrections() - before).toBeLessThanOrEqual(1);
  // Free: the grace is on. The last press may have jumped it, so it lands first.
  h.run(1500);
  expect(rooted(h, be)).toBe(false);
  // Freed during the last press, within STRUGGLE_EVERY ticks before freedAt.
  expect(until(brec, SPENT) - freedAt).toBeGreaterThan(10 * TICK_RATE - STRUGGLE_EVERY);
  expect(until(brec, SPENT) - freedAt).toBeLessThanOrEqual(10 * TICK_RATE);
  expect(h.host.entangle.freed).toBeGreaterThanOrEqual(1);
  // A second bola within the 10 s does nothing; one after them catches it again, for 25 s.
  const refused = h.host.entangle.refused;
  throwAt(h, s, pilot, be);
  expect(h.host.entangle.refused).toBe(refused + 1);
  expect([until(brec, ENTANGLED), rooted(h, be)]).toEqual([-1, false]);
  h.run(Math.max(0, (until(brec, SPENT) - h.world.tick) / TICK_RATE + 0.5) * 1000);
  expect(until(brec, SPENT)).toBe(-1);
  throwAt(h, s, pilot, be);
  expect((until(brec, ENTANGLED) - h.world.tick) / TICK_RATE).toBeGreaterThan(23);
  expect(rooted(h, be)).toBe(true);
  expect(h.host.items.audit()).toEqual([]);
});

test("a held throw flies faster, and a click throws nothing", () => {
  const { h, pilot, rec, at } = field();
  const other = h.join("cyd");
  h.run(500);
  h.say(other, "enablecheats");
  h.say(other, `tp ${(at.x + 5).toFixed(3)} ${at.z.toFixed(3)}`);
  h.run(500);
  const speeds = (): number[] => other.events.filter((ev) => ev.kind === EVENT_SHOT && ev.item === BOLA).map((ev) => Math.hypot(ev.vx, ev.vy, ev.vz));
  pilot.yaw = 0;
  pilot.pitch = 0.3;
  h.run(200);
  const hold = (ticks: number): void => {
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * ticks);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(800);
  };
  hold(3);
  expect(speeds()).toEqual([]);
  hold(13);
  hold(70);
  const [slow, fast] = speeds();
  const full = reg.ammoSpeed[BOLA]!;
  expect(fast).toBeCloseTo(full, 3);
  expect(slow).toBeGreaterThan(launchSpeed(full, 0.25) - 0.01);
  expect(slow).toBeLessThan(launchSpeed(full, 0.3));
  expect(h.host.items.inv(rec).total(BOLA)).toBe(8);
});

test("a bola'd creature cannot be mounted; ridden when caught, it stands under its rider", () => {
  const { h, s, rec } = field();
  const ents = h.world.ents;
  const c = h.client(s)!;
  const e = h.host.spawnCreature("core:parasaur", ents.x[c.ent]!, ents.z[c.ent]! + 3, 1);
  const para = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, 0xffffffff);
  para.team = rec.team;
  para.saddle = id("saddle_parasaur");
  h.host.refreshBody(para);
  h.run(300);
  expect(h.host.entangle.give(para, ENTANGLED, rec.pid)).toBe(true);
  h.run(100);
  expect(rooted(h, e)).toBe(true);
  expect(h.host.riding.mount(c, e)).toBe(RESULT_DENIED);
  h.host.buffs.take(para, ENTANGLED);
  h.run(100);
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  // Ridden, it is caught: its rider stays on, and the mount does not go where it is driven.
  h.run(500);
  expect(h.host.entangle.give(para, ENTANGLED, 0)).toBe(true);
  h.run(100);
  const [x0, z0] = [ents.x[e]!, ents.z[e]!];
  h.pilots[0]!.moveZ = 127;
  h.run(3000);
  expect(Math.hypot(ents.x[e]! - x0, ents.z[e]! - z0)).toBeLessThan(0.01);
  expect(h.host.riding.riding(c)).toBe(true);
});
