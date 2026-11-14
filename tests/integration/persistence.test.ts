import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { OP_DEATH } from "../../server/death.ts";
import { createHost } from "../../server/host.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { HOLDERS, OP_BURN, OP_MINT, OP_TRANSFER, START } from "../fixtures/crash-child.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a world survives restart: tick, structures, records and where a survivor stood", () => {
  const db = join(dir, "restart.db");
  const reg = coreRegistry();
  const stone = reg.index.get("core:stone")!;

  const h = new Harness({}, 1, 60, { dbPath: db });
  const ada = h.join("ada");
  h.pilots[0]!.moveZ = 1;
  h.run(2500);
  h.pilots[0]!.moveZ = 0;
  const wall = reg.index.get("core:wall")!;
  const added = h.world.structs.add(wall, 250.25, 1.5, 230, 4096, 9, 777);
  const crate = h.world.structs.chunks.findIndex((t) => t && t.live > 20);
  expect(h.world.structs.remove(crate * 65536 + 3)).toBe(true);
  const pid = h.world.ents.pid[h.ent(ada)]!;
  h.host.items.mint(h.host.records.byPid.get(pid)!, stone, 40);
  h.run(500);
  const where = { x: h.world.ents.x[h.ent(ada)]!, z: h.world.ents.z[h.ent(ada)]! };
  expect(where.z).toBeGreaterThan(248);
  ada.close();
  h.run(100);
  const tick = h.world.tick;
  const before = h.world.structs;
  h.host.shutdown();

  const h2 = new Harness({}, 1, 60, { dbPath: db });
  expect(h2.host.loaded).toEqual({ fresh: false, tick, structures: before.count, records: 1 });
  expect(h2.world.tick).toBe(tick);
  // The tables must match slot for slot, so refs held elsewhere stay valid.
  before.chunks.forEach((t, chunk) => {
    const u = h2.world.structs.chunks[chunk];
    if (!t) return expect(u ?? null).toBeNull();
    expect(u!.version).toBe(t.version);
    expect(u!.high).toBe(t.high);
    expect(u!.live).toBe(t.live);
    for (const col of ["kind", "x", "y", "z", "yaw", "owner", "hp", "mod"] as const) {
      expect([...u![col].subarray(0, t.high)]).toEqual([...t[col].subarray(0, t.high)]);
    }
  });
  const t = h2.world.structs.chunks[Math.floor(added / 65536)]!;
  expect(t.hp[added & 0xffff]).toBe(777);
  expect(h2.host.records.byPid.get(pid)!.inv!.total(stone)).toBe(40);
  expect(h2.host.items.audit()).toEqual([]);

  const again = h2.join("ada");
  h2.run(300);
  expect(h2.world.ents.pid[h2.ent(again)]).toBe(pid);
  expect(Math.abs(h2.world.ents.x[h2.ent(again)]! - where.x)).toBeLessThan(0.01);
  expect(Math.abs(h2.world.ents.z[h2.ent(again)]! - where.z)).toBeLessThan(0.01);
  const twin = h2.join("ada");
  h2.run(200);
  expect(twin.state).toBe("closed");
  expect(h2.server.playerCount).toBe(1);
  h2.host.shutdown();
});

test("a first start that stopped before its first commit left no world, so the next start is the first again", () => {
  const db = join(dir, "stillborn.db");
  const reg = coreRegistry();
  const whole = createHost(reg).world.structs.count;
  // A start that got as far as opening the file: a bad map file, a port in use, a module that throws.
  new WorldStore(db, reg).close();
  // And one that was killed in its first ticks.
  createHost(reg, { dbPath: db }).persistence!.store.close();
  const host = createHost(reg, { dbPath: db });
  expect(host.loaded).toEqual({ fresh: true, tick: 0, structures: whole, records: 0 });
  for (let n = 0; n < 12; n++) host.game.tick();
  host.shutdown();
  const again = createHost(reg, { dbPath: db });
  expect(again.loaded).toEqual({ fresh: false, tick: 12, structures: whole, records: 0 });
  again.shutdown();
});

test("a save that uses removed content refuses to load unless told to drop it", () => {
  const db = join(dir, "content.db");
  const full = coreRegistry();
  createHost(full, { dbPath: db }).shutdown();
  const without = compileContent(CORE_CONTENT.filter((d) => d.id !== "core:wall")).registry!;
  expect(() => createHost(without, { dbPath: db })).toThrow(/core:wall/);
  const forced = createHost(without, { dbPath: db, store: { allowMissingContent: true } });
  expect(forced.world.structs.count).toBeLessThan(createHost(full).world.structs.count);
  forced.persistence!.store.close(); // closed without committing, so the save keeps its walls
  const back = createHost(full, { dbPath: db });
  expect(back.world.structs.count).toBe(createHost(full).world.structs.count);
  back.shutdown();
});

test("an item whose content is gone stops the load, and a ledger that does not balance stops it too", () => {
  const db = join(dir, "items.db");
  const full = coreRegistry();
  // With its engram gone too, nothing else refers to the waterskin.
  const meat = full.index.get("core:waterskin")!;
  const gone = new Set(["core:waterskin", "core:make-waterskin", "core:engram-waterskin"]); // The middle one is the rename of its old recipe.
  const stone = full.index.get("core:stone")!;
  const host = createHost(full, { dbPath: db });
  const rec = host.records.create(full.index.get("core:grazer")!, "mule");
  expect(host.items.mint(rec, meat, 30)).toBe(30);
  expect(host.items.mint(rec, stone, 250)).toBe(250);
  host.shutdown();

  const without = compileContent(CORE_CONTENT.filter((d) => !gone.has(d.id))).registry!;
  expect(() => createHost(without, { dbPath: db })).toThrow(/content this build does not have/);
  const forced = createHost(without, { dbPath: db, store: { allowMissingContent: true } });
  expect(forced.records.byPid.get(rec.pid)!.inv!.total(without.index.get("core:stone")!)).toBe(250);
  expect(forced.items.audit()).toEqual([]);
  forced.persistence!.store.close(); // not committed, so the save keeps what it had

  const back = createHost(full, { dbPath: db });
  expect(back.records.byPid.get(rec.pid)!.inv!.total(meat)).toBe(30);
  // Setting a slot directly bypasses the ledger.
  const inv = back.records.byPid.get(rec.pid)!.inv!;
  inv.set(39, stone, 99, 0, 0, 0);
  back.records.dirty.add(rec.pid);
  expect(back.items.audit().length).toBe(1);
  back.shutdown();
  expect(() => createHost(full, { dbPath: db })).toThrow(/ledger does not balance[\s\S]*core:stone: 349 in the world, ledger says 250/);
  createHost(full, { dbPath: db, allowLedgerMismatch: true }).persistence!.store.close();
});

test("a round 1 inventory is converted whole: nothing is dropped for want of slots", () => {
  const db = join(dir, "legacy.db");
  const reg = coreRegistry();
  const stone = reg.index.get("core:stone")!;
  const host = createHost(reg, { dbPath: db });
  const pid = host.records.create(reg.index.get("core:grazer")!, "mule").pid;
  host.shutdown();

  // Rewrites the record in the round 1 layout, a list of items and counts. 5,000 stone is fifty stacks,
  // more than a fresh inventory's forty slots.
  const legacy = (count: number): void => {
    const store = new WorldStore(db, reg);
    const c = new BitWriter(64);
    c.varint(1);
    c.varint(store.toSaved[stone]!);
    c.varint(count);
    const w = new BitWriter(256);
    w.u8(1);
    w.string("mule");
    w.varint(1);
    w.varint(1); // component 1 is round 1's inventory
    w.blob(c.bytes());
    store.db.query("UPDATE entities SET data = ? WHERE pid = ?").run(w.bytes().slice(), pid);
    store.db.query("DELETE FROM meta WHERE key = 'ledger'").run();
    store.close();
  };
  legacy(5000);
  const back = createHost(reg, { dbPath: db });
  const inv = back.records.byPid.get(pid)!.inv!;
  expect(inv.total(stone)).toBe(5000);
  expect(inv.cap).toBe(50);
  expect(back.items.audit()).toEqual([]); // the ledger opens at what the save holds
  back.shutdown();
  // The shutdown saved it in the new form.
  const again = createHost(reg, { dbPath: db });
  expect(again.records.byPid.get(pid)!.inv!.total(stone)).toBe(5000);
  again.shutdown();
  // More than an inventory can hold is refused, never trimmed.
  legacy(30000);
  expect(() => createHost(reg, { dbPath: db })).toThrow(/needs 300 slots/);
});

test("commit callbacks run only after the transaction is durable", () => {
  const host = createHost(coreRegistry(), { dbPath: join(dir, "ack.db") });
  const p = host.persistence!;
  let acked = 0;
  const seq = p.journal(7, new Uint8Array([1, 2, 3]));
  p.afterCommit(() => acked++);
  expect(acked).toBe(0);
  expect(p.durableSeq).toBeLessThan(seq);
  p.commit();
  expect(acked).toBe(1);
  expect(p.durableSeq).toBe(seq);
  p.commit();
  expect(acked).toBe(1);
  expect(p.store.journal().map((j) => [j.seq, j.op, [...j.data]])).toEqual([[seq, 7, [1, 2, 3]]]);
  host.shutdown();
});

async function runUntilKilled(db: string, seed: number, minAcks: number, mode = ""): Promise<number> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../fixtures/crash-child.ts"), db, String(seed), mode], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let text = "";
  let killed = false;
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (!killed && text.split("acked").length > minAcks) {
      proc.kill(9); // no warning, possibly mid-transaction
      killed = true;
    }
  }
  await proc.exited;
  // The child prints each ack only after its commit returned.
  const acks = [...text.matchAll(/acked (\d+)\n/g)];
  return Number(acks.at(-1)![1]);
}

test("killing the process at any moment loses no acknowledged trade and conserves every item", async () => {
  const db = join(dir, "crash.db");
  const reg = coreRegistry();
  const stone = reg.index.get("core:stone")!;
  let journalled = 0;
  for (const [seed, minAcks] of [[1, 40], [2, 25], [3, 60]] as const) {
    const lastAck = await runUntilKilled(db, seed, minAcks);
    const store = new WorldStore(db, reg);
    const journal = store.journal();
    const records = store.loadEntities().sort((a, b) => a.pid - b.pid);
    const ledgerText = String(store.meta("ledger"));
    store.close();

    expect(journal.length).toBeGreaterThanOrEqual(lastAck);
    expect(journal.length).toBeGreaterThan(journalled);
    journalled = journal.length;
    expect(journal.map((j) => j.seq)).toEqual(journal.map((_, i) => i + 1));

    // The saved inventories must equal the journal applied to the starting balances.
    expect(records.length).toBe(HOLDERS);
    const balance = new Map(records.map((r) => [r.pid, START]));
    let minted = HOLDERS * START;
    let burned = 0;
    const r = new BitReader();
    for (const j of journal) {
      r.reset(j.data);
      const from = r.uint53();
      if (j.op === OP_MINT) {
        const n = r.varint();
        minted += n;
        balance.set(from, balance.get(from)! + n);
      } else if (j.op === OP_BURN) {
        const n = r.varint();
        burned += n;
        balance.set(from, balance.get(from)! - n);
      } else {
        expect(j.op).toBe(OP_TRANSFER);
        const to = r.uint53();
        const count = r.varint();
        balance.set(from, balance.get(from)! - count);
        balance.set(to, balance.get(to)! + count);
      }
    }
    expect(records.reduce((n, rec) => n + (rec.inv?.total(stone) ?? 0), 0)).toBe(minted - burned);
    const ledger = JSON.parse(ledgerText) as Record<string, [number, number]>;
    expect(ledger["core:stone"]).toEqual([minted, burned]);
    for (const rec of records) expect(rec.inv?.total(stone) ?? 0).toBe(balance.get(rec.pid)!);
    expect(burned).toBeGreaterThan(0);
  }
});

test("killing the process while survivors die, are looted and return never leaves one both alive and cached, or its things nowhere", async () => {
  const db = join(dir, "deaths.db");
  const reg = coreRegistry();
  let deaths = 0;
  for (const [seed, minAcks] of [[5, 30], [6, 45], [7, 25]] as const) {
    await runUntilKilled(db, seed, minAcks, "death");
    // Loading audits the ledger, so an item in two places or in none stops it here.
    const host = createHost(reg, { dbPath: db });
    expect(host.items.audit()).toEqual([]);
    const survivors = [...host.persistence!.survivors.values()].map((pid) => host.records.byPid.get(pid)!);
    expect(survivors.length).toBe(HOLDERS);
    const caches = [...host.records.byPid.values()].filter((r) => r.expiresAt > 0);
    for (const s of survivors) {
      // A death moves the survivor's items to a cache in the same commit.
      if (s.dead) {
        expect(s.inv === null || s.inv.used() === 0).toBe(true);
        expect(s.markers.length).toBeGreaterThan(0);
      }
      expect(s.markers.length).toBeLessThanOrEqual(5);
    }
    for (const c of caches) {
      expect(c.inv!.used()).toBeGreaterThan(0);
      expect(host.records.entOf.has(c.pid)).toBe(true);
      expect(c.expiresAt).toBeGreaterThan(0);
    }
    const journal = host.persistence!.store.journal();
    deaths = journal.filter((j) => j.op === OP_DEATH).length;
    host.shutdown();
  }
  expect(deaths).toBeGreaterThan(10);
});
