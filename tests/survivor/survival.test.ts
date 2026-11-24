import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import type { EntityRecord } from "../../server/records.ts";
import { BOX_OPEN, BOX_SELF, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_RESPAWN, CMD_SPEND, CMD_USE, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_USE, MODE_SWIM } from "../../shared/sim/character.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import type { Inventory } from "../../shared/sim/items.ts";
import { V_FOOD, V_HEALTH } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { nodesOf, standFacing, swing, takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-life-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const contents = (inv: Inventory): string[] => {
  const out: string[] = [];
  for (let i = 0; i < inv.cap; i++) if (inv.item[i] !== 0) out.push(`${i}:${inv.item[i]}x${inv.count[i]} dur ${inv.dur[i]} spoils ${inv.spoilAt[i]}`);
  return out;
};

// Cheats are enabled only for `tp`, to skip the walking. Every gain and loss comes from the inputs and commands a player has.
test("a survivor gathers, crafts, eats, levels up, learns, swims, drowns, dies, finds its cache by the marker, and returns after a restart with nothing lost or duplicated", () => {
  const db = join(dir, "life.db");
  const h = new Harness({}, 1, 30, { dbPath: db, dev: true });
  // No drip: the experience below is the deeds' alone.
  h.host.setSetting("GenericXPMultiplier", "0");
  const s = h.join("eve", { latencyMs: 40 });
  h.run(500);
  h.say(s, "enablecheats");
  const pilot = h.pilots[0]!;
  const id = (name: string) => h.reg.index.get(name)!;
  const rec = (): EntityRecord => h.host.records.byPid.get(h.client(s)!.pid)!;
  const have = (name: string) => h.host.items.inv(rec()).total(id(name));
  const say = (f: (s: ClientSession) => void, ms = 300): void => {
    f(s);
    h.run(ms);
  };

  const trees = nodesOf(h, "core:tree", 256, 256);
  for (let t = 0; t < 8 && (have("core:thatch") < 22 || have("core:wood") < 2); t++) {
    if (standFacing(h, s, pilot, trees[t]!)) swing(h, pilot, 12, SWING_TICKS);
  }
  expect(have("core:thatch")).toBeGreaterThanOrEqual(22);
  expect(have("core:wood")).toBeGreaterThanOrEqual(2);
  const rock = nodesOf(h, "core:rock", 256, 256).find((r) => standFacing(h, s, pilot, r, 1.9))!;
  swing(h, pilot, 3, SWING_TICKS);
  expect(have("core:stone")).toBeGreaterThanOrEqual(3);
  expect(have("core:flint")).toBe(0);

  // Each harvest hit gives one experience point, and each level one stat point.
  expect(s.progress.level).toBeGreaterThanOrEqual(2);
  expect(s.progress.xp).toBe(h.host.harvest!.hits);
  expect(s.progress.statPoints).toBe(s.progress.level - 1);
  expect(h.world.ents.level[h.ent(s)]).toBe(s.progress.level);

  // Only a pick gets flint from a rock.
  say((c) => c.command(CMD_LEARN, (w) => w.u16(id("core:engram-pick"))));
  say((c) => c.command(CMD_CRAFT, (w) => (w.u16(id("core:pick")), w.u8(1))), 2600);
  expect(have("core:pick")).toBe(1);
  takeInHand(h, s, id("core:pick"));
  expect(standFacing(h, s, pilot, rock, 1.9)).toBe(true);
  swing(h, pilot, 2, SWING_TICKS);
  expect(have("core:flint")).toBeGreaterThanOrEqual(2);
  // The hatchet costs three engram points.
  say((c) => c.command(CMD_LEARN, (w) => w.u16(id("core:engram-hatchet"))));
  say((c) => c.command(CMD_CRAFT, (w) => (w.u16(id("core:hatchet")), w.u8(1))), 2600);
  expect(have("core:hatchet")).toBe(1);
  expect(s.progress.engrams.length).toBe(2);

  const bush = nodesOf(h, "core:bush", 256, 256).find((b) => standFacing(h, s, pilot, b, 1.4))!;
  expect(bush).toBeDefined();
  for (let i = 0; i < 2; i++) {
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(300);
  }
  const berries = have("core:berry");
  expect(berries).toBeGreaterThanOrEqual(6);
  h.run(20000); // long enough to be a little hungry
  const hungry = h.host.survival.value(rec(), V_FOOD);
  expect(hungry).toBeLessThan(100);
  say((c) => c.command(CMD_USE, (w) => (w.varint(c.inventory!.item.indexOf(id("core:berry"))), w.u16(id("core:berry")))));
  expect(have("core:berry")).toBe(berries - 1);
  expect(h.host.survival.value(rec(), V_FOOD)).toBeGreaterThan(hungry);

  // One point in speed is 1.5%.
  say((c) => c.command(CMD_SPEND, (w) => w.u8(STAT_NAMES.indexOf("speed"))));
  expect(s.own.speedQ).toBe(1015);

  h.say(s, `tp ${PROVING_POOL.x + 31} ${PROVING_POOL.z}`);
  pilot.yaw = -Math.PI / 2; // toward the middle of the pool
  pilot.pitch = 0;
  pilot.moveZ = 1;
  let swam = false;
  h.run(9000, () => (swam ||= s.own.mode === MODE_SWIM));
  expect(swam).toBe(true);
  pilot.pitch = -1.3;
  h.run(5000);
  pilot.moveZ = 0;
  expect(s.own.y).toBeLessThan(-5);
  const carried = contents(h.host.items.inv(rec()));
  expect(carried.length).toBeGreaterThanOrEqual(7);
  let waited = 0;
  while (s.sessionState !== SESSION_DEAD && waited++ < 70) h.run(1000);
  expect(s.sessionState).toBe(SESSION_DEAD);
  expect(s.log.at(-1)!.text).toBe("You drowned.");

  const cache = [...h.host.records.byPid.values()].find((r) => r.expiresAt > 0 && r.inv)!;
  expect(contents(cache.inv!)).toEqual(carried);
  expect(h.host.items.inv(rec()).used()).toBe(0);
  expect(s.markers.length).toBe(1);
  const m = s.markers[0]!;
  expect(Math.hypot(m.x - cache.x, m.z - cache.z)).toBe(0);

  // Respawn point 2 is by the pool.
  say((c) => c.command(CMD_RESPAWN, (w) => (w.u8(2), w.u8(c.placesList))), 500);
  expect(s.sessionState).toBe(SESSION_ALIVE);
  expect(h.host.survival.value(rec(), V_HEALTH)).toBe(100);
  h.say(s, `tp ${m.x.toFixed(3)} ${(m.y + 0.6).toFixed(3)} ${(m.z - 1.4).toFixed(3)}`);
  pilot.yaw = 0;
  pilot.pitch = Math.atan2(m.y + 0.25 - (h.world.ents.y[h.ent(s)]! + 1.62), 1.4);
  h.run(300);
  pilot.pitch = Math.atan2(m.y + 0.25 - (h.world.ents.y[h.ent(s)]! + 1.62), Math.abs(m.z - h.world.ents.z[h.ent(s)]!));
  h.run(200);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
  expect(s.open?.name).toBe("eve's cache");
  for (let i = 0; i < s.open!.inventory.cap; i++) {
    const item = s.open!.inventory.item[i]!;
    if (item === 0) continue;
    s.command(CMD_MOVE, (w) => {
      w.bits(BOX_OPEN, 1);
      w.varint(i);
      w.bits(BOX_SELF, 1);
      w.varint(i);
      w.u16(0);
      w.u16(item);
    });
  }
  h.run(600);
  expect(contents(h.host.items.inv(rec()))).toEqual(carried);
  expect([...h.host.records.byPid.values()].some((r) => r.expiresAt > 0 && r.inv)).toBe(false);
  expect(s.open).toBeNull();
  pilot.pitch = 0;
  pilot.buttons = BTN_JUMP;
  h.run(5000);
  pilot.buttons = 0;
  h.run(1000);
  expect(s.sessionState).toBe(SESSION_ALIVE);
  expect(h.host.items.audit()).toEqual([]);

  const before = {
    carried: contents(h.host.items.inv(rec())),
    xp: rec().xp,
    level: s.progress.level,
    engrams: [...rec().engrams],
    points: [...rec().genome!.tamed],
    markers: rec().markers.map((k) => ({ ...k })),
    gone: h.host.harvest!.goneCount,
    ledger: h.host.items.serialize(),
    deaths: h.host.death.count,
  };
  expect(before.gone).toBeGreaterThan(0);
  expect(before.deaths).toBe(1);
  const pid = rec().pid;
  h.host.shutdown();

  const h2 = new Harness({}, 1, 30, { dbPath: db, dev: true });
  const again = h2.join("eve");
  h2.run(800);
  const back = h2.host.records.byPid.get(pid)!;
  expect(again.sessionState).toBe(SESSION_ALIVE);
  expect(contents(h2.host.items.inv(back))).toEqual(before.carried);
  expect(contents(again.inventory!)).toEqual(before.carried);
  expect(back.xp).toBe(before.xp);
  expect(again.progress.level).toBe(before.level);
  expect(back.engrams).toEqual(before.engrams);
  expect([...back.genome!.tamed]).toEqual(before.points);
  expect(again.own.speedQ).toBe(1015);
  expect(back.markers).toEqual(before.markers);
  expect(again.markers).toEqual(before.markers);
  expect(h2.host.harvest!.goneCount).toBe(before.gone);
  expect(h2.host.items.serialize()).toBe(before.ledger);
  expect(h2.host.items.audit()).toEqual([]);
  // The survivor, and its old body until it decays.
  expect(h2.host.records.byPid.size).toBe(2);
  h2.host.shutdown();
});
