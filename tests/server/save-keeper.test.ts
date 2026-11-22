// Checkpoints and backups: made beside a running world, kept by a rule, and the way back from one.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP_NEWEST, backupName, backupsToKeep, listBackups, restoreBackup, type BackupReport } from "../../server/persist/backup.ts";
import { SCHEMA_VERSION, WorldStore } from "../../server/persist/store.ts";
import { Harness } from "../fixtures/net.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-keeper-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function world(name: string, extra: ConstructorParameters<typeof Harness>[3] = {}) {
  const db = join(dir, `${name}.db`);
  const h = new Harness({}, 1, 60, { dbPath: db, ...extra });
  const ada = h.join("ada");
  h.run(1000);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  // The host logs each backup. These tests read the report.
  const reports: BackupReport[] = [];
  h.host.persistence!.onBackup = (r) => void reports.push(r);
  return { db, h, ada, rec, reports, p: h.host.persistence!, stone: h.reg.index.get("core:stone")! };
}

test("backups are kept by a rule: the newest dozen, and the newest of each of the last seven days", () => {
  const names: string[] = [];
  // Three a day for ten days, then fourteen on the last day.
  for (let day = 1; day <= 10; day++) for (const hour of [3, 11, 19]) names.push(backupName(new Date(Date.UTC(2026, 10, day, hour)), day * 1000 + hour));
  for (let minute = 0; minute < 14; minute++) names.push(backupName(new Date(Date.UTC(2026, 10, 11, 8, minute)), 11000 + minute));
  expect(names[0]).toBe("2026-11-01T03-00-00Z-t1003");
  const keep = backupsToKeep([...names, "making", "notes.txt"]);
  const newest = [...names].sort().reverse();
  for (const name of newest.slice(0, KEEP_NEWEST)) expect(keep.has(name)).toBe(true);
  // The twelve newest are all of day 11. Days 10 down to 5 each keep their last.
  expect([...keep].filter((n) => !n.startsWith("2026-11-11")).sort()).toEqual([5, 6, 7, 8, 9, 10].map((d) => backupName(new Date(Date.UTC(2026, 10, d, 19)), d * 1000 + 19)));
  expect(keep.size).toBe(KEEP_NEWEST + 6);
});

test("a backup is a whole save of its moment, and restoring one moves what it replaces aside", () => {
  const { db, h, rec, reports, stone } = world("round");
  h.host.items.mint(rec, stone, 5);
  expect(h.host.exec("backup")).toContain("a backup was started");
  expect(reports.length).toBe(1);
  expect([reports[0]!.why, reports[0]!.path]).toEqual(["", listBackups(db)[0]!]);
  expect(reports[0]!.tick).toBe(h.world.tick);
  h.host.items.mint(rec, stone, 4);
  h.run(500);
  // A running server holds the save, so nothing can be put in its place.
  expect(() => restoreBackup(db, reports[0]!.path, new Date())).toThrow("is in use by another server");
  h.host.shutdown();

  const put = restoreBackup(db, reports[0]!.path, new Date());
  expect(put.tick).toBe(reports[0]!.tick);
  const back = new Harness({}, 1, 60, { dbPath: db });
  expect([back.world.tick, back.host.records.byPid.get(rec.pid)!.inv!.total(stone)]).toEqual([put.tick, 5]);
  expect(back.host.items.audit()).toEqual([]);
  back.host.shutdown();
  // What was there is whole, beside it.
  const aside = new Harness({}, 1, 60, { dbPath: put.aside });
  expect(aside.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBe(9);
  aside.host.shutdown();
  expect(() => restoreBackup(db, join(dir, "nowhere"), new Date())).toThrow("holds no backup");
});

test("the keeper thread backs up a world that goes on committing, and the copy is whole and not ahead of it", async () => {
  const { h, rec, reports, p, stone } = world("live", { keeper: "worker", commitEvery: 1 });
  h.host.items.mint(rec, stone, 7);
  h.run(100);
  p.keeper.backup();
  // Until the thread reports, however long a busy machine makes that: the hang limit is the only bound.
  while (reports.length === 0) {
    h.host.items.mint(rec, stone, 1);
    h.run(34);
    await Bun.sleep(5);
  }
  expect(reports.length).toBe(1);
  expect(reports[0]!.why).toBe("");
  const live = h.world.tick;
  // Its checkpoints arrive too, without a tick waiting for one.
  h.run(6000);
  h.host.idle();
  while (p.keeper.last.ms === 0) await Bun.sleep(5);
  expect(p.keeper.last.ms).toBeGreaterThan(0);
  h.host.shutdown();
  expect(!existsSync(`${p.store.path}-wal`) || statSync(`${p.store.path}-wal`).size === 0).toBe(true);

  const copy = new Harness({}, 1, 60, { dbPath: join(reports[0]!.path, "world.db") });
  expect(copy.world.tick).toBe(reports[0]!.tick);
  expect(copy.world.tick).toBeLessThanOrEqual(live);
  expect(copy.host.records.byPid.get(rec.pid)!.inv!.total(stone)).toBeGreaterThanOrEqual(7);
  expect(copy.host.items.audit()).toEqual([]);
  copy.host.shutdown();
});

test("two thousand commits never grow the log past what a few seconds write", () => {
  const { db, h, rec, stone } = world("log", { commitEvery: 1 });
  for (let n = 0; n < 400; n++) h.host.spawnCreature("core:dummy", 8 + (n % 20), 8 + Math.floor(n / 20), 1);
  let most = 0;
  for (let n = 0; n < 2000; n++) {
    h.host.items.mint(rec, stone, 1);
    h.run(1000 / 30);
    if (n % 150 === 0) h.host.idle();
    if (n % 50 === 0) most = Math.max(most, statSync(`${db}-wal`).size);
  }
  expect(h.host.persistence!.commits).toBeGreaterThan(1900);
  expect(most).toBeGreaterThan(0);
  expect(most).toBeLessThan(4_000_000);
  h.host.shutdown();
});

test("a save of another schema is refused, and a damaged one names the backup to restore", () => {
  const { db, h, reports } = world("form");
  h.host.exec("backup");
  h.host.shutdown();
  const raw = new Database(db);
  raw.exec(`UPDATE meta SET value = ${SCHEMA_VERSION - 1} WHERE key = 'schema_version'`);
  raw.close();
  expect(() => new WorldStore(db, h.reg)).toThrow(`save has schema ${SCHEMA_VERSION - 1}, and this build reads ${SCHEMA_VERSION}`);
  const fixed = new Database(db);
  fixed.exec(`UPDATE meta SET value = ${SCHEMA_VERSION} WHERE key = 'schema_version'`);
  fixed.close();

  const size = statSync(db).size;
  const fd = openSync(db, "r+");
  const junk = new Uint8Array(8192).fill(0xa5);
  for (let at = 4096; at + junk.length < size; at += 16384) writeSync(fd, junk, 0, junk.length, at);
  closeSync(fd);
  expect(() => new WorldStore(db, h.reg)).toThrow(`start with --restore ${reports[0]!.path}`);
});
