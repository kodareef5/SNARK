// The creature packages' places in a running host: their commands are answered and refused, and a held creature is left
// to whoever holds it.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost } from "../../server/host.ts";
import { CARRY_GRAB, CARRY_PICK_UP, CARRY_RELEASE, CARRY_THROW, CMD_CARRY, CMD_ORDER, CMD_TAKE, ORDER_ALL, ORDER_ATTACK, ORDER_LAND, ORDER_WANDER, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_FLYER, MODE_WALK } from "../../shared/sim/character.ts";
import { F_GROUNDED, F_HELD } from "../../shared/sim/entities.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("a wild creature is not picked up from out of reach nor ordered, a creature is not taken as an egg is, and a held creature is not stepped", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  h.say(ada, `tp ${(g.x + 20).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  const e = h.host.spawnCreature("core:dodo", g.x + 20, g.z + 10, 5);
  expect(e).toBeGreaterThanOrEqual(0);
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  ada.command(CMD_CARRY, (w) => (w.u8(CARRY_PICK_UP), w.u32(e)));
  ada.command(CMD_CARRY, (w) => w.u8(CARRY_THROW));
  ada.command(CMD_TAKE, (w) => w.u32(e));
  ada.command(CMD_ORDER, (w) => (w.u32(e), w.u8(ORDER_WANDER)));
  ada.command(CMD_ORDER, (w) => (w.u32(e), w.u8(ORDER_ATTACK), w.u32(e)));
  h.run(400);
  // Carrying and the orders are built (tests/integration/carry.test.ts, orders.test.ts): a wild dodo four metres off is out of reach, and nobody's to order.
  expect(codes).toEqual([RESULT_FAR, RESULT_INVALID, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NOT_YOURS]);
  expect([h.host.corpses, h.host.carry, h.host.feces, h.host.eggs, h.host.overhead, h.host.hurt].every((m) => m !== undefined)).toBe(true);

  // Lifted into the air and held, it stays there; let go, it falls.
  const ents = h.world.ents;
  ents.flags[e] = (ents.flags[e]! | F_HELD) & ~F_GROUNDED;
  ents.setPosition(e, ents.x[e]!, ents.y[e]! + 3, ents.z[e]!);
  const up = ents.y[e]!;
  h.run(500);
  expect(ents.y[e]).toBe(up);
  ents.flags[e] = ents.flags[e]! & ~F_HELD;
  h.run(1500);
  expect(ents.y[e]!).toBeLessThan(up - 2);
});

// The flyers' contracts (planning/reference/flyers-plan.md, FL0) in a running host.

test("the grab codes are refused until their package builds them, a wild flyer is nobody's to land, and the pteranodon stand-in, made by the spawn cheat, rests on the ground and then takes off", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 40, 30);
  h.say(ada, `tp ${(g.x + 20).toFixed(3)} ${(g.z + 6).toFixed(3)}`);
  h.run(100);
  const before = new Set(h.host.records.byPid.keys());
  expect(h.say(ada, "spawn pteranodon 5")[0]).toMatch(/^spawned core:pteranodon/);
  const rec = [...h.host.records.byPid.values()].find((r) => !before.has(r.pid) && h.reg.ids[r.kind] === "core:pteranodon")!;
  const e = h.host.records.entOf.get(rec.pid)!;
  expect(e).toBeGreaterThanOrEqual(0);
  const codes: number[] = [];
  ada.onResult = (_seq, code) => codes.push(code);
  ada.command(CMD_CARRY, (w) => (w.u8(CARRY_GRAB), w.u32(e)));
  ada.command(CMD_CARRY, (w) => w.u8(CARRY_RELEASE));
  ada.command(CMD_ORDER, (w) => (w.u32(e), w.u8(ORDER_LAND)));
  ada.command(CMD_ORDER, (w) => (w.u32(ORDER_ALL), w.u8(ORDER_LAND)));
  h.run(1500);
  // Landing is built (tests/integration/flyers.test.ts): a whistle with nothing of hers in earshot lands nothing.
  expect(codes).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK]);
  const ents = h.world.ents;
  expect([ents.mode[e], (ents.flags[e]! & F_GROUNDED) !== 0]).toEqual([MODE_WALK, true]);
  let flew = false;
  h.run(25000, () => void (flew ||= ents.mode[e] === MODE_FLYER));
  expect(flew).toBe(true);
});

test("a creature in its own flight is saved flying and loads in the air", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-test-"));
  try {
    const reg = coreRegistry();
    const db = join(dir, "flying.db");
    const host = createHost(reg, { dbPath: db });
    const e = host.spawnCreature("core:pteranodon", 250, 230, 5);
    expect(e).toBeGreaterThanOrEqual(0);
    const ents = host.world.ents;
    const pid = ents.pid[e]!;
    // As FL1 will leave one in the air.
    ents.mode[e] = MODE_FLYER;
    ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.setPosition(e, ents.x[e]!, ents.y[e]! + 40, ents.z[e]!);
    const aloft = ents.y[e]!;
    host.shutdown();
    const back = createHost(reg, { dbPath: db });
    const f = back.records.entOf.get(pid)!;
    expect([back.records.byPid.get(pid)!.flying, back.world.ents.mode[f], (back.world.ents.flags[f]! & F_GROUNDED) !== 0, back.world.ents.y[f]]).toEqual([true, MODE_FLYER, false, aloft]);
    // Landed, it is saved walking.
    back.world.ents.mode[f] = MODE_WALK;
    back.shutdown();
    const again = createHost(reg, { dbPath: db });
    expect([again.records.byPid.get(pid)!.flying, again.world.ents.mode[again.records.entOf.get(pid)!]]).toEqual([false, MODE_WALK]);
    again.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
