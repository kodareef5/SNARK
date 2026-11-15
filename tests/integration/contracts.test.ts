// The creature packages' places in a running host: their commands are answered and refused, and a held creature is left
// to whoever holds it.

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost } from "../../server/host.ts";
import { CARRY_GRAB, CARRY_PICK_UP, CARRY_RELEASE, CARRY_THROW, CMD_CARRY, CMD_ORDER, CMD_TAKE, ORDER_ALL, ORDER_ATTACK, ORDER_LAND, ORDER_WANDER, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS } from "../../shared/net/protocol.ts";
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

test("the flyers' codes are refused until their packages build them, and the pteranodon stand-in, made by the spawn cheat, walks the ground as any creature", () => {
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
  expect(codes).toEqual([RESULT_INVALID, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID]);
  const ents = h.world.ents;
  expect([ents.mode[e], (ents.flags[e]! & F_GROUNDED) !== 0]).toEqual([MODE_WALK, true]);
});

test("a creature in its own flight is saved flying and loads in the air, and a save written by main before the flying bit loads as it was", () => {
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
    const format = (path: string, id: number): number => {
      const store = new Database(path);
      const row = store.query("SELECT data FROM entities WHERE pid = ?").get(id) as { data: Uint8Array };
      store.close();
      return row.data[0]!;
    };
    expect(format(db, pid)).toBe(7);
    const back = createHost(reg, { dbPath: db });
    const f = back.records.entOf.get(pid)!;
    expect([back.records.byPid.get(pid)!.flying, back.world.ents.mode[f], (back.world.ents.flags[f]! & F_GROUNDED) !== 0, back.world.ents.y[f]]).toEqual([true, MODE_FLYER, false, aloft]);
    // Landed, it is saved walking.
    back.world.ents.mode[f] = MODE_WALK;
    back.shutdown();
    const again = createHost(reg, { dbPath: db });
    expect([again.records.byPid.get(pid)!.flying, again.world.ents.mode[again.records.entOf.get(pid)!]]).toEqual([false, MODE_WALK]);
    again.shutdown();

    // A survivor holding hotbar slot 2 with 40 stone, a saddled raptor of team 7 in stance 2, and a dead survivor whose
    // record expires at tick 900, written by main in record format 5 (tests/fixtures/saves/before-flyers.db).
    const old = join(dir, "before-flyers.db");
    copyFileSync(join(import.meta.dir, "../fixtures/saves/before-flyers.db"), old);
    const [ada, mount, bo] = [1099511627777, 1099511627778, 1099511627779];
    expect([ada, mount, bo].map((id) => format(old, id))).toEqual([5, 5, 5]);
    // It was made on the proving ground before the ground listed its resource nodes (shared/world/proving.ts), so on other
    // bytes of the same map; what it holds is what is read here, so it is loaded as an operator would, told to go on.
    const loaded = createHost(reg, { dbPath: old, allowMapMismatch: true });
    const rec = (id: number) => loaded.records.byPid.get(id)!;
    // The save knew the ingot's engram, which the stations wave took out (planning/reference/stations-plan.md, Decided 2).
    // Nothing in it uses the engram, so it loads without --allow-missing-content.
    expect(loaded.persistence!.store.missingContent).toEqual(["core:engram-ingot"]);
    expect([rec(ada).held, rec(ada).inv!.total(reg.index.get("core:stone")!), rec(ada).flying]).toEqual([2, 40, false]);
    expect([reg.ids[rec(mount).saddle], rec(mount).stance, rec(mount).team, rec(mount).flying]).toEqual(["core:saddle_raptor", 2, 7, false]);
    expect([rec(bo).dead, rec(bo).expiresAt, rec(bo).flying]).toEqual([true, 900, false]);
    expect(loaded.world.ents.mode[loaded.records.entOf.get(mount)!]).toBe(MODE_WALK);
    loaded.shutdown();
    // Written again by this build, it is revision 7 and reads the same.
    expect([ada, mount, bo].map((id) => format(old, id))).toEqual([7, 7, 7]);
    const resaved = createHost(reg, { dbPath: old });
    expect([resaved.records.byPid.get(ada)!.held, reg.ids[resaved.records.byPid.get(mount)!.saddle], resaved.records.byPid.get(bo)!.expiresAt]).toEqual([2, "core:saddle_raptor", 900]);
    resaved.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
