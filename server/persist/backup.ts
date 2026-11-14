// Backups of a save, made beside it while the server runs, and the way back from one.
// A backup is a folder `<db>.backups/<utc>-t<tick>/world.db`, written by VACUUM INTO, checked, and only then given its name.

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { holdSave } from "./lock.ts";

/** Backups kept whatever their age, and the days of which the newest backup is kept as well. */
export const KEEP_NEWEST = 12;
export const KEEP_DAYS = 7;
const NAME = /^(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}Z-t\d+$/;

export interface BackupReport {
  /** "" when none was made, and `why` says why not. */
  path: string;
  why: string;
  tick: number;
  bytes: number;
  ms: number;
}

export function backupsFolder(dbPath: string): string {
  return `${dbPath}.backups`;
}

/** `2026-11-14T09-30-05Z-t81000`: sorts by time as text. */
export function backupName(at: Date, tick: number): string {
  return `${at.toISOString().slice(0, 19).replace(/:/g, "-")}Z-t${tick}`;
}

/** Which of `names` to keep: the newest KEEP_NEWEST, and the newest of each of the KEEP_DAYS latest days that have one. */
export function backupsToKeep(names: readonly string[]): Set<string> {
  const sorted = names.filter((n) => NAME.test(n)).sort().reverse();
  const keep = new Set(sorted.slice(0, KEEP_NEWEST));
  const days = new Set<string>();
  for (const name of sorted) {
    const day = NAME.exec(name)![1]!;
    if (days.has(day)) continue;
    if (days.size === KEEP_DAYS) break;
    days.add(day);
    keep.add(name);
  }
  return keep;
}

/** The backups of a save, newest first. */
export function listBackups(dbPath: string): string[] {
  const folder = backupsFolder(dbPath);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((n) => NAME.test(n) && existsSync(join(folder, n, "world.db"))).sort().reverse().map((n) => join(folder, n));
}

function tickOf(file: string): number {
  const db = new Database(file, { readonly: true });
  try {
    const found = (db.query("PRAGMA quick_check").all() as { quick_check: string }[])[0]?.quick_check;
    if (found !== "ok") throw new Error(`the copy is damaged: ${found}`);
    return Number((db.query("SELECT value FROM meta WHERE key = 'tick'").get() as { value: number } | null)?.value ?? 0);
  } finally {
    db.close();
  }
}

/**
 * Copies the save `db` is open on into a new backup folder and removes the backups no longer kept. `db` must not be in
 * a transaction. Never throws: a backup that could not be made is reported.
 */
export function takeBackup(db: Database, dbPath: string, at: Date, now: () => number = performance.now.bind(performance)): BackupReport {
  const began = now();
  const none = (why: string): BackupReport => ({ path: "", why, tick: 0, bytes: 0, ms: now() - began });
  const folder = backupsFolder(dbPath);
  const making = join(folder, "making");
  try {
    mkdirSync(folder, { recursive: true });
    const size = statSync(dbPath).size;
    const disk = statfsSync(folder);
    const free = Number(disk.bavail) * Number(disk.bsize);
    if (free < size * 2) return none(`${Math.round(free / 1e6)} MB free is under twice the save's ${Math.round(size / 1e6)} MB`);
    rmSync(making, { recursive: true, force: true });
    mkdirSync(making);
    const file = join(making, "world.db");
    db.query("VACUUM INTO ?").run(file);
    const tick = tickOf(file);
    const path = join(folder, backupName(at, tick));
    if (existsSync(path)) {
      rmSync(making, { recursive: true, force: true });
      return none(`there is already a backup of tick ${tick} from this second`);
    }
    renameSync(making, path);
    const names = readdirSync(folder).filter((n) => NAME.test(n));
    const keep = backupsToKeep(names);
    for (const name of names) if (!keep.has(name)) rmSync(join(folder, name), { recursive: true, force: true });
    return { path, why: "", tick, bytes: statSync(join(path, "world.db")).size, ms: now() - began };
  } catch (err) {
    rmSync(making, { recursive: true, force: true });
    return none(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Puts the backup in `folder` in place of the save at `dbPath`. The files it replaces are moved aside to
 * `<db>.replaced-<utc>` and never deleted. Throws if a server holds the save or the backup does not pass its check.
 */
export function restoreBackup(dbPath: string, folder: string, at: Date): { tick: number; aside: string } {
  const from = join(folder, "world.db");
  if (!existsSync(from)) throw new Error(`${folder} holds no backup (no world.db in it)`);
  const tick = tickOf(from);
  mkdirSync(dirname(dbPath), { recursive: true });
  const lock = holdSave(dbPath);
  try {
    const aside = `${dbPath}.replaced-${backupName(at, tick)}`;
    for (const tail of ["", "-wal", "-shm"]) if (existsSync(dbPath + tail)) renameSync(dbPath + tail, aside + tail);
    copyFileSync(from, dbPath);
    return { tick, aside };
  } finally {
    lock.release();
  }
}
