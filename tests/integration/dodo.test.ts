// A dodo in a running world, at ARK's numbers (ark.wiki.gg, Dodo, 2026-11-14).

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { MIND_FLEE, MIND_WANDER } from "../../server/behavior.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

/** Ada stands on level ground with cheats on, and nothing harms her. */
function camp() {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, z: g.z + 6 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(me.pid);
  return { h, ada, at, me };
}

/** Ada looks at `e` and presses use, which opens it. */
function open(h: Harness, s: ClientSession, e: number): void {
  const ents = h.world.ents;
  const me = h.ent(s);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * 0.5 - eye, Math.hypot(dx, dz));
  h.run(150);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
}

test("a level 30 dodo on berries, as the wiki's table has it: fifteen, one every eight seconds, two minutes, 80% and twelve levels for it", () => {
  const { h, ada, at, me } = camp();
  const berry = h.reg.index.get("core:berry")!;
  const e = h.host.spawnCreature("core:dodo", at.x, at.z + 1.6, 30);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.host.creatures.mind.stay(e, h.world.tick + 30);
  // Knocked out by torpor past its most: 30, and 6% more for each of its 29 wild levels.
  expect(rec.vitals!.max[V_TORPOR]! / 1e6).toBeCloseTo(30 * (1 + 0.06 * 29), 3);
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  const down = h.world.tick;
  expect(rec.out).toBe(true);
  open(h, ada, e);
  expect([ada.subject?.taming, ada.subject?.level, ada.open?.inventory.cap]).toEqual([true, 30, 300]);
  h.say(ada, "give core:berry 20");
  const inv = ada.inventory!;
  ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(berry)), w.bits(BOX_OPEN, 1), w.varint(0), w.u16(0), w.u16(berry)));
  h.run(150);
  expect(h.host.items.inv(rec).total(berry)).toBe(20);
  const taming = h.host.taming;
  const bitesAt: number[] = [];
  for (let k = 0; k < 400 && rec.tame; k++) {
    const before = taming.bites;
    h.run(500);
    if (taming.bites > before) bitesAt.push(Math.round((h.world.tick - down) / TICK_RATE));
  }
  // A berry is 20 food and it loses 2.5 a second lying there.
  expect(bitesAt).toEqual([8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120]);
  expect([taming.tamed, taming.bites, rec.team, rec.out]).toEqual([1, 15, me.team, false]);
  expect(Math.round(rec.te * 1000) / 10).toBe(80);
  expect(rec.genome!.level).toBe(42);
});

test("a dodo that is hurt runs from it at 136.5 units a second, and pecks nobody", () => {
  const { h, ada, at } = camp();
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const e = h.host.spawnCreature("core:dodo", at.x, at.z + 3, 1);
  mind.stay(e, h.world.tick + 60);
  h.run(1500);
  const me = h.ent(ada);
  const bites = mind.bites;
  h.host.creatures.provoke(e, ents.x[me]!, ents.z[me]!, me);
  expect(mind.mind[e]).toBe(MIND_FLEE);
  h.run(1500);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  h.run(2000);
  // Two seconds at full run, away from her.
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z) / 2).toBeCloseTo(1.365, 1);
  expect(ents.z[e]!).toBeGreaterThan(z);
  h.run(3000);
  expect([mind.mind[e], mind.bites]).toEqual([MIND_WANDER, bites]);
});
