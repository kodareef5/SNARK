// Checkpoints and backups: made beside a running world, kept by a rule, and the way back from one.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEEP, KEEP_NEWEST, REMOVE_MOST, backupName, backupPhase, backupsFolder, backupsForRoom, backupsToRemove, listBackups, restoreBackup, takeBackup, untilBackup, type BackupFile, type BackupReport } from "../../server/persist/backup.ts";
import { SCHEMA_VERSION, WorldStore } from "../../server/persist/store.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TICK_RATE } from "../../shared/coords.ts";
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

const MINUTE = 60_000;
const END = Date.UTC(2026, 10, 30);
const MB = 1e6;
const extended = { days: 180, hours: 48, bytes: 0 };
/** A backup every quarter of an hour for `days` days, the last at 23:45 on 29 November, each a megabyte. */
function quarterly(days: number): BackupFile[] {
  const out: BackupFile[] = [];
  for (let k = days * 96; k >= 1; k--) out.push({ name: backupName(new Date(END - k * 15 * MINUTE), k), bytes: MB });
  return out;
}
/** What the rule leaves of `files` when it may remove as many as it likes. */
function left(files: readonly BackupFile[], made: string, days: number, bytes = 0): string[] {
  const gone = new Set(backupsToRemove(files, made, { ...extended, days, bytes }, Infinity));
  return files.map((f) => f.name).filter((n) => !gone.has(n));
}

test("backups are kept by a rule: the newest dozen, the newest of each of 48 hours, and the newest of each day for the days set", () => {
  const files = [...quarterly(10), { name: "making", bytes: 5 }, { name: "notes.txt", bytes: 5 }];
  const made = files[959]!.name;
  expect(made).toBe("2026-11-29T23-45-00Z-t1");
  // The dozen are 21:00 to 23:45 of the 29th. 45 more hours keep their :45, back to 00:45 of the 28th. Eight more days keep their 23:45.
  const kept = left(files, made, 180);
  expect(kept.filter((n) => n !== "making" && n !== "notes.txt").length).toBe(KEEP_NEWEST + 45 + 8);
  expect(kept.slice(0, 8)).toEqual([20, 21, 22, 23, 24, 25, 26, 27].map((d) => `2026-11-${d}T23-45-00Z-t${(29 - d) * 96 + 1}`));
  expect(kept).toContain("2026-11-28T00-45-00Z-t189");
  expect(kept).not.toContain("2026-11-27T22-45-00Z-t101");
  // Fewer days keep fewer of the old ones, and none keeps only the dozen and the hours.
  expect([left(files, made, 7).length, left(files, made, 0).length]).toEqual([KEEP_NEWEST + 45 + 5 + 2, KEEP_NEWEST + 45 + 2]);
  // What is not a backup is never touched, and the oldest go first.
  const gone = backupsToRemove(files, made, extended, Infinity);
  expect(gone.includes("making") || gone.includes("notes.txt")).toBe(false);
  expect(gone.slice(0, 2)).toEqual(["2026-11-20T00-00-00Z-t960", "2026-11-20T00-15-00Z-t959"]);
});

test("days and hours are counted by the backups there are, so a world switched off or a clock set wrong loses nothing", () => {
  // One a day for a month of last year, then nothing until one made now.
  const old: BackupFile[] = [];
  for (let d = 1; d <= 30; d++) old.push({ name: backupName(new Date(Date.UTC(2025, 5, d, 12)), d), bytes: MB });
  const now = backupName(new Date(END), 99);
  expect(backupsToRemove([...old, { name: now, bytes: MB }], now, extended, Infinity)).toEqual([]);
  // Twenty dated ten years on, a minute apart: they sort newest. The one just made stays, and only the oldest of those go.
  const ahead: BackupFile[] = [];
  for (let m = 0; m < 20; m++) ahead.push({ name: backupName(new Date(Date.UTC(2036, 0, 1, 0, m)), 500 + m), bytes: MB });
  const gone = backupsToRemove([...old, ...ahead, { name: now, bytes: MB }], now, extended, Infinity);
  expect(gone).toEqual(ahead.slice(0, 8).map((f) => f.name));
});

test("over the gigabytes the hourly ones go first, then the oldest days, then the newest, and never the one just made", () => {
  const files = quarterly(10);
  const made = files[959]!.name;
  const dozen = files.slice(948).map((f) => f.name);
  const day = (d: number): string => `2026-11-${d}T23-45-00Z-t${(29 - d) * 96 + 1}`;
  // 65 megabytes are kept: the dozen, 44 that only their hour keeps, and nine days. Under 30, thirty-five of the hourly go.
  const at30 = left(files, made, 180, 30 * MB);
  expect(at30.length).toBe(30);
  expect(at30.filter((n) => n.includes("T23-45")).length).toBe(10);
  // Under 15, every hourly one and the six oldest days: three days and the dozen are left.
  expect(left(files, made, 180, 15 * MB)).toEqual([day(26), day(27), day(28), ...dozen]);
  // Under 5, only the newest five. Under less than one save, the one just made.
  expect(left(files, made, 180, 5 * MB)).toEqual(files.slice(955).map((f) => f.name));
  expect(left(files, made, 180, MB / 2)).toEqual([made]);
});

test("no backup removes more than two dozen, so a limit typed wrong is seen before it has cost much", () => {
  let files = quarterly(10);
  const made = files[959]!.name;
  const first = backupsToRemove(files, made, { ...extended, days: 0 });
  expect(first.length).toBe(REMOVE_MOST);
  expect(first).toEqual(files.slice(0, REMOVE_MOST).map((f) => f.name));
  // Backup after backup it comes to the same as one pass would.
  for (let pass = 0; pass < 100; pass++) {
    const gone = new Set(backupsToRemove(files, made, { ...extended, days: 0 }));
    if (gone.size === 0) break;
    files = files.filter((f) => !gone.has(f.name));
  }
  expect(files.map((f) => f.name)).toEqual(left(quarterly(10), made, 0));
});

test("the worlds of a machine take different shares of the backup period", () => {
  const period = 15 * 60_000;
  const gaps = (worlds: number): number => {
    const marks = Array.from({ length: worlds }, (_, i) => backupPhase(i + 1, "main", "")).sort((a, b) => a - b);
    return Math.min(...marks.map((m, i) => (i === 0 ? m + 1 - marks[marks.length - 1]! : m - marks[i - 1]!)));
  };
  // Five worlds of a cluster are at least 131 seconds apart in a quarter of an hour, and nine at least 45.
  expect(gaps(5) * period).toBeGreaterThan(131_000);
  expect(gaps(9) * period).toBeGreaterThan(45_000);
  // Another cluster starts elsewhere, and a world alone goes by its save.
  expect(backupPhase(1, "main", "")).not.toBe(backupPhase(1, "other", ""));
  expect(backupPhase(0, "", "0011223344556677")).not.toBe(backupPhase(0, "", "8899aabbccddeeff"));
  for (const phase of [backupPhase(3, "main", ""), backupPhase(0, "", "0011223344556677")]) {
    expect(phase >= 0 && phase < 1).toBe(true);
    for (const now of [0, 1_764_288_000_123, 1_764_288_000_123 + 7 * 60_000]) {
      const wait = untilBackup(now, period, phase);
      expect(wait > 0 && wait <= period).toBe(true);
      // The mark is the moment the world's share comes round, the same whenever it is asked.
      const into = (now + wait - phase * period) % period;
      expect(Math.min(into, period - into)).toBeLessThan(1e-3);
    }
  }
});

/** Backup folders made by hand, an hour apart across midnight, each holding `bytes`. */
function oldBackups(db: string, count: number, bytes = 64): string[] {
  const names: string[] = [];
  for (let k = count; k >= 1; k--) {
    const name = backupName(new Date(Date.UTC(2000, 0, 2, 13 - k)), k);
    mkdirSync(join(backupsFolder(db), name), { recursive: true });
    writeFileSync(join(backupsFolder(db), name, "world.db"), new Uint8Array(bytes));
    names.push(name);
  }
  return names;
}

test("a disk short of room gives up its oldest backups for a new one, down to the newest dozen, and the clean-up runs all the same", () => {
  const { db, h, p } = world("room");
  const names = oldBackups(db, 20);
  expect(backupsForRoom(names.map((name) => ({ name, bytes: 64 })))).toEqual(names.slice(0, 8));
  // Room comes once three are gone.
  const roomy = takeBackup(p.store.db, db, new Date(), extended, { free: () => (listBackups(db).length <= 17 ? 1e12 : 0) });
  expect([roomy.why, roomy.removed, roomy.kept]).toEqual(["", 3, 18]);
  expect(listBackups(db).map((path) => path.slice(backupsFolder(db).length + 1)).slice(-2).reverse()).toEqual(names.slice(3, 5));
  // No room however many go: the old ones beyond the dozen went for it, no copy is made, and nothing is left half done.
  const none = takeBackup(p.store.db, db, new Date(), extended, { free: () => 0 });
  expect([none.path, none.why.includes("free is under twice the save's"), none.removed, none.kept]).toEqual(["", true, 6, KEEP_NEWEST]);
  expect(existsSync(join(backupsFolder(db), "making"))).toBe(false);
  // With no room and limits that keep less, the rule still removes what it no longer holds, and leaves the newest there is.
  const ruled = takeBackup(p.store.db, db, new Date(), { ...extended, days: 0, bytes: 200 }, { free: () => 0 });
  expect([ruled.path, ruled.removed, ruled.kept]).toEqual(["", 11, 1]);
  expect(listBackups(db)).toEqual([roomy.path]);
  h.host.shutdown();
});

/** The settings with a backup mark every `minutes`. */
const every = (minutes: number) => loadConfig({ gus: `[ServerSettings]\nAutoSavePeriodMinutes=${minutes}`, game: "" }).rules;

test("a world that has not changed is not backed up again, one nobody was in at most hourly, and the command always", () => {
  const db = join(dir, "marks.db");
  const h = new Harness({}, 1, 60, { dbPath: db, backups: true, config: every(0.1), startingCreatures: 0 });
  const p = h.host.persistence!;
  const reports: BackupReport[] = [];
  p.onBackup = (r) => void reports.push(r);
  const ticks = (n: number): void => {
    for (let k = 0; k < n; k++) h.server.tick();
  };
  // The first mark, six seconds in, backs up what the start made.
  ticks(6 * TICK_RATE - 1);
  expect(reports.length).toBe(0);
  ticks(1);
  expect([reports.length, reports[0]!.why, p.unchanged]).toEqual([1, "", true]);
  // The marks of the next minutes make none: nothing changed, and then only what nobody saw.
  ticks(5 * 60 * TICK_RATE);
  expect([reports.length, p.unchanged]).toEqual([1, false]);
  expect(h.host.exec("backup")).toContain("a backup was started");
  expect(reports.length).toBe(2);
  // A survivor's coming is a change someone saw: the next mark backs it up.
  h.join("ada");
  h.run(7000);
  expect(reports.length).toBe(3);
  h.host.shutdown();
});

test("a backup in progress only covers the changes it was asked to copy", () => {
  const { h, p, rec, stone } = world("queued");
  const requests: number[] = [];
  p.keeper.backup = () => { requests.push(p.changes); };
  const finish = (ok: boolean): void => p.keeper.onBackup!({
    path: ok ? "world.db" : "", why: ok ? "" : "disk full", tick: h.world.tick,
    bytes: 0, ms: 0, kept: 0, keptBytes: 0, removed: 0,
  });
  expect(h.host.exec("backup")).toContain("started");
  h.host.items.mint(rec, stone, 1);
  expect(h.host.exec("backup")).toContain("queued");
  expect(h.host.exec("backup")).toContain("queued");
  expect(requests).toHaveLength(1);
  finish(true);
  expect(requests).toHaveLength(2);
  expect(requests[1]!).toBeGreaterThan(requests[0]!);
  expect([p.backingUp, p.unchanged]).toEqual([true, false]);
  finish(false);
  expect([p.backingUp, p.unchanged]).toEqual([false, false]);
  expect(p.backup()).toBe(true);
  finish(true);
  expect(p.unchanged).toBe(true);
  h.host.shutdown();
});

test("shutdown hands the queued copy to the worker before closing it", () => {
  const { h, p } = world("queued-stop");
  const calls: string[] = [];
  p.keeper.backup = () => { calls.push("copy"); };
  p.keeper.close = () => { calls.push("close"); };
  h.host.exec("backup");
  h.host.exec("backup");
  expect(calls).toEqual(["copy"]);
  h.host.shutdown();
  expect(calls).toEqual(["copy", "copy", "close"]);
});

test("an hour after its last backup, a world nobody was in is backed up for what it did by itself", () => {
  const db = join(dir, "drift.db");
  const h = new Harness({}, 1, 60, { dbPath: db, backups: true, config: every(1), startingCreatures: 0 });
  const p = h.host.persistence!;
  const reports: BackupReport[] = [];
  p.onBackup = (r) => void reports.push(r);
  for (let k = 0; k < 60 * TICK_RATE; k++) h.server.tick();
  expect(reports.length).toBe(1);
  // The supply circuits look once a minute, which is a change, and fifty-nine marks pass it by.
  for (let k = 0; k < 59 * 60 * TICK_RATE; k++) h.server.tick();
  expect([reports.length, p.unchanged]).toEqual([1, false]);
  for (let k = 0; k < 60 * TICK_RATE; k++) h.server.tick();
  expect(reports.length).toBe(2);
  h.host.shutdown();
});

test("with a wall clock the mark is the world's own share of the period, and a changed period moves it", () => {
  const db = join(dir, "clock.db");
  const clock = { ms: 1_764_288_000_000 };
  const h = new Harness({}, 1, 60, { dbPath: db, backups: true, backupClock: () => clock.ms, config: every(0.2), startingCreatures: 0 });
  const p = h.host.persistence!;
  const reports: BackupReport[] = [];
  p.onBackup = (r) => void reports.push(r);
  const phase = backupPhase(0, "", p.saveId);
  const base = clock.ms;
  /** The tick of the mark that follows now, by the clock. */
  const mark = (periodMs: number): number => h.world.tick + Math.max(1, Math.round((untilBackup(clock.ms, periodMs, phase) / 1000) * TICK_RATE));
  /** Runs to tick `to`, the wall clock moving with the world as a server's does. */
  const runTo = (to: number): void => h.run(((to - h.world.tick) * 1000) / TICK_RATE, (now) => void (clock.ms = base + now));
  const first = mark(12_000);
  const ada = h.join("ada");
  runTo(first - 3);
  expect([ada.state, reports.length]).toEqual(["active", 0]);
  runTo(first + 3);
  expect(reports.length).toBe(1);
  // Half the period: the next mark is worked out again from the clock, and something has changed by then.
  expect(h.host.exec("setting AutoSavePeriodMinutes 0.1")).not.toContain("cannot");
  runTo(h.world.tick + 2);
  h.host.records.newTeam();
  const next = mark(6000);
  expect(next - h.world.tick).toBeLessThanOrEqual(6 * TICK_RATE);
  runTo(next - 3);
  expect(reports.length).toBe(1);
  runTo(next + 3);
  expect(reports.length).toBe(2);
  h.host.shutdown();
});

test("the limits set are the ones a backup is kept by, on the keeper's own thread too", async () => {
  const { db, h, reports, p } = world("limits", { keeper: "worker" });
  expect(p.backupKeep).toEqual(KEEP);
  expect(h.host.exec("setting BackupKeepDays 0")).not.toContain("cannot");
  expect(h.host.exec("setting BackupKeepHours 6")).not.toContain("cannot");
  expect(h.host.exec("setting BackupMaxGigabytes 0.000001")).not.toContain("cannot");
  h.run(100);
  expect(p.backupKeep).toEqual({ days: 0, hours: 6, bytes: 1074 });
  oldBackups(db, 5);
  expect(h.host.exec("backup")).toContain("a backup was started");
  expect(p.backingUp).toBe(true);
  while (reports.length === 0) await Bun.sleep(5);
  // Under a kilobyte only the one just made is left.
  expect([reports[0]!.why, reports[0]!.removed, reports[0]!.kept, p.backingUp]).toEqual(["", 5, 1, false]);
  expect(listBackups(db)).toEqual([reports[0]!.path]);
  h.host.shutdown();
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
  p.backup();
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
