// A command whose handler throws: its player is put out and refused for a while, and the world goes on while its item
// ledger balances, or stops unsaved, as at any other throw, keeping only the refusal.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { REJECT_DENIED } from "../../shared/net/protocol.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { Harness, testKey } from "../fixtures/net.ts";

/** An op no command has, given a handler with a bug. */
const BROKEN = 250;

function world(dbPath: string, said: string[]): Harness {
  return new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], dbPath, log: (line) => void said.push(line) });
}

function from(h: Harness, name: string, address: string, key = testKey(name)) {
  const s = h.join(name, {}, { key });
  (h.ends[h.ends.length - 1]!.peer as { address?: string }).address = address;
  h.run(300);
  return s;
}

test("a command that throws puts its player out and refuses its device and machine, and the world goes on while the ledger balances", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-faults-"));
  const said: string[] = [];
  const h = world(join(dir, "world.db"), said);
  try {
    const honest = from(h, "honest", "203.0.113.1");
    const mallory = from(h, "mallory", "2001:db8:4:4::1");
    h.server.handle(BROKEN, () => {
      throw new Error("a handler's bug");
    });
    mallory.command(BROKEN, (w) => w.u8(7));
    h.run(300);
    expect([h.server.stats.faults, mallory.state, mallory.closeReason, honest.state]).toEqual([1, "closed", REJECT_DENIED, "active"]);
    expect(mallory.log.at(-1)?.text).toContain("come back in 10 minutes");
    const told = said.find((line) => line.startsWith("a command of mallory"))!;
    expect(told).toContain(`Op ${BROKEN}, the message `);
    expect(told).toContain("a handler's bug");
    // Its device is refused, and so is another device of its machine. Another machine is not.
    expect([from(h, "mallory", "2001:db8:4:4::1").closeReason, from(h, "mallory2", "2001:db8:4:4::2").closeReason, from(h, "carol", "2001:db8:4:5::1").state]).toEqual([REJECT_DENIED, REJECT_DENIED, "active"]);
    // The world goes on, and saves.
    const tick = h.world.tick;
    h.pilots[0]!.moveZ = 1;
    h.run(1000);
    expect(h.world.tick).toBeGreaterThan(tick + 25);
    h.host.persistence!.commit();
    expect(Number(h.host.persistence!.store.meta("tick"))).toBe(h.world.tick);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a command that throws with the ledger left off stops the server unsaved, and its refusal outlasts the stop", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-faults-"));
  const dbPath = join(dir, "world.db");
  const said: string[] = [];
  let h = world(dbPath, said);
  const berry = h.reg.index.get("core:berry")!;
  try {
    const mallory = from(h, "mallory", "2001:db8:4:4::1");
    // Half of a move: an item put in a bag with no mint to account for it.
    h.server.handle(BROKEN, (c) => {
      h.host.items.inv(h.host.records.byPid.get(c.pid)!).add(berry, 5, 0, 0, h.world.tick, h.host.items.table);
      throw new Error("a handler's bug");
    });
    mallory.command(BROKEN, () => {});
    expect(() => h.run(300)).toThrow("a handler's bug");
    expect(said.some((line) => line.startsWith("the item ledger does not balance after it"))).toBe(true);
    const threw = h.world.tick;
    h.host.persistence!.close();
    const store = new WorldStore(dbPath, h.reg);
    expect([Number(store.meta("tick")) < threw, JSON.parse(store.meta("refused") as string).length]).toEqual([true, 2]);
    store.close();
    h = world(dbPath, said);
    expect(h.host.items.audit()).toEqual([]);
    expect([from(h, "mallory", "2001:db8:4:4::1").closeReason, from(h, "carol", "203.0.113.2").state]).toEqual([REJECT_DENIED, "active"]);
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
