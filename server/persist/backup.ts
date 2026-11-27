// Backups of a save, made beside it while the server runs, and the way back from one.
// A backup is a folder `<db>.backups/<utc>-t<tick>/world.db`, written by VACUUM INTO, checked, and only then given its name.

import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { dirname, join } from "node:path";
import { holdSave } from "./lock.ts";

/** How long backups are kept and how much disk they may take (BackupKeepDays, BackupMaxGigabytes). No bytes is no limit. */
export interface BackupKeep {
  days: number;
  bytes: number;
}
export const KEEP: BackupKeep = { days: 180, bytes: 100 * 2 ** 30 };
/** Backups kept whatever their age, and the hours of which the newest backup is kept as well. */
export const KEEP_NEWEST = 12;
export const KEEP_HOURS = 48;
/** The most removed at one backup, so a setting typed wrong costs little before it is seen. */
export const REMOVE_MOST = 24;
const NAME = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-t(\d+)$/;

export interface BackupReport {
  /** "" when none was made, and `why` says why not. */
  path: string;
  why: string;
  tick: number;
  bytes: number;
  ms: number;
  /** The backups the folder holds once this one and its clean-up are done, their bytes, and how many were removed. */
  kept: number;
  keptBytes: number;
  removed: number;
}

/** A backup as the rule sees it: its folder's name and the bytes of its copy. */
export interface BackupFile {
  name: string;
  bytes: number;
}

export function backupsFolder(dbPath: string): string {
  return `${dbPath}.backups`;
}

/** `2026-11-14T09-30-05Z-t81000`: sorts by time as text. */
export function backupName(at: Date, tick: number): string {
  return `${at.toISOString().slice(0, 19).replace(/:/g, "-")}Z-t${tick}`;
}

/** When a backup of this name was made, in milliseconds, and at which tick. Null for a name that is no backup's. */
export function backupAt(name: string): { at: number; tick: number } | null {
  const m = NAME.exec(name);
  return m ? { at: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`), tick: Number(m[5]) } : null;
}

/** What holds a backup: the higher is given up later. */
const UNKEPT = 0;
const HOURLY = 1;
const DAILY = 2;
const NEWEST = 3;

/**
 * Every backup but `made` and the newest by name, in the order they are given up: those nothing keeps, then the hourly
 * ones, then the days, then the newest, each oldest first. Kept are the newest KEEP_NEWEST, the newest of each of the last
 * KEEP_HOURS hours that have one, and the newest of each of the last `days` days that have one. Hours and days are counted
 * by the backups there are and not from the clock, so a world that was switched off, or a clock set wrong, gives up
 * nothing. One backup is always left, whatever the limits and whether or not one was just made.
 */
function givenUp(files: readonly BackupFile[], made: string, days: number): (BackupFile & { hold: number })[] {
  const sorted = files.filter((f) => NAME.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const hoursSeen = new Set<string>();
  const daysSeen = new Set<string>();
  const out: (BackupFile & { hold: number })[] = [];
  sorted.forEach((f, i) => {
    let hold = i < KEEP_NEWEST ? NEWEST : UNKEPT;
    const hour = f.name.slice(0, 13);
    const day = f.name.slice(0, 10);
    if (!hoursSeen.has(hour) && hoursSeen.size < KEEP_HOURS) {
      hoursSeen.add(hour);
      hold = Math.max(hold, HOURLY);
    }
    if (!daysSeen.has(day) && daysSeen.size < days) {
      daysSeen.add(day);
      hold = Math.max(hold, DAILY);
    }
    if (f.name !== made && i !== 0) out.push({ ...f, hold });
  });
  // Oldest first, then by what holds them: the sort keeps the oldest first within each.
  return out.reverse().sort((a, b) => a.hold - b.hold);
}

/**
 * Which backups to remove once `made` is in the folder ("" when none was made): those nothing keeps, and while the rest
 * take more than `keep.bytes`, the hourly ones, then the oldest days, then the newest. `made` is never one of them, nor
 * the newest there is, and at most `most` go at once.
 */
export function backupsToRemove(files: readonly BackupFile[], made: string, keep: BackupKeep, most = REMOVE_MOST): string[] {
  let bytes = 0;
  for (const f of files) if (NAME.test(f.name)) bytes += f.bytes;
  const out: string[] = [];
  for (const f of givenUp(files, made, keep.days)) {
    if (out.length >= most) break;
    if (f.hold !== UNKEPT && !(keep.bytes > 0 && bytes > keep.bytes)) break;
    out.push(f.name);
    bytes -= f.bytes;
  }
  return out;
}

/** Which backups to give up, in order, for room on a disk that has none: any but the newest KEEP_NEWEST. */
export function backupsForRoom(files: readonly BackupFile[], keep: BackupKeep): string[] {
  return givenUp(files, "", keep.days).filter((f) => f.hold !== NEWEST).map((f) => f.name);
}

/**
 * Where in the period a world backs up, from 0 to 1, so that the worlds of one machine do not all copy their saves at
 * once. A cluster's worlds are spread by their ids, which the golden ratio sets well apart however many there are, and
 * each cluster starts somewhere of its own. A world outside a cluster goes by its save's id.
 */
export function backupPhase(world: number, cluster: string, saveId: string): number {
  const share = (text: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0) / 2 ** 32;
  };
  const at = world > 0 ? world * 0.6180339887498949 + share(cluster) : share(saveId);
  return at - Math.floor(at);
}

/** Milliseconds from `now` until a world's share of the period next comes round: more than none, a period at most. */
export function untilBackup(now: number, periodMs: number, phase: number): number {
  const into = (((now - phase * periodMs) % periodMs) + periodMs) % periodMs;
  return periodMs - into;
}

/** The backups of a save, newest first. */
export function listBackups(dbPath: string): string[] {
  const folder = backupsFolder(dbPath);
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((n) => NAME.test(n) && existsSync(join(folder, n, "world.db"))).sort().reverse().map((n) => join(folder, n));
}

/** The backups in `folder`, each with the bytes of its copy. */
function filesIn(folder: string): BackupFile[] {
  const out: BackupFile[] = [];
  for (const name of readdirSync(folder)) {
    if (!NAME.test(name)) continue;
    const file = join(folder, name, "world.db");
    out.push({ name, bytes: existsSync(file) ? statSync(file).size : 0 });
  }
  return out;
}

/** The bytes free to this process on the disk `folder` is on. */
function freeOn(folder: string): number {
  const disk = statfsSync(folder);
  return Number(disk.bavail) * Number(disk.bsize);
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
 * Copies the save `db` is open on into a new backup folder and removes the backups `keep` no longer holds. A disk with
 * less free than twice the save gives up its oldest backups first, down to the newest KEEP_NEWEST, and only then is the
 * copy not made; the clean-up runs either way. `db` must not be in a transaction. Never throws: a backup that could not
 * be made is reported.
 */
export function takeBackup(db: Database, dbPath: string, at: Date, keep: BackupKeep = KEEP, env: { now?: () => number; free?: (folder: string) => number } = {}): BackupReport {
  const now = env.now ?? performance.now.bind(performance);
  const free = env.free ?? freeOn;
  const began = now();
  const folder = backupsFolder(dbPath);
  const making = join(folder, "making");
  let removed = 0;
  const remove = (names: readonly string[]): void => {
    for (const name of names) {
      rmSync(join(folder, name), { recursive: true, force: true });
      removed++;
    }
  };
  const report = (path: string, why: string, tick: number, bytes: number): BackupReport => {
    let kept = 0;
    let keptBytes = 0;
    try {
      for (const f of filesIn(folder)) {
        kept++;
        keptBytes += f.bytes;
      }
    } catch {
      // A folder that cannot be read holds nothing to count.
    }
    return { path, why, tick, bytes, ms: now() - began, kept, keptBytes, removed };
  };
  try {
    mkdirSync(folder, { recursive: true });
    const size = statSync(dbPath).size;
    if (free(folder) < size * 2) {
      for (const name of backupsForRoom(filesIn(folder), keep)) {
        if (removed === REMOVE_MOST) break;
        remove([name]);
        if (free(folder) >= size * 2) break;
      }
    }
    const room = free(folder);
    if (room < size * 2) {
      remove(backupsToRemove(filesIn(folder), "", keep, REMOVE_MOST - removed));
      return report("", `${Math.round(room / 1e6)} MB free is under twice the save's ${Math.round(size / 1e6)} MB`, 0, 0);
    }
    rmSync(making, { recursive: true, force: true });
    mkdirSync(making);
    const file = join(making, "world.db");
    db.query("VACUUM INTO ?").run(file);
    const tick = tickOf(file);
    const name = backupName(at, tick);
    const path = join(folder, name);
    if (existsSync(path)) {
      rmSync(making, { recursive: true, force: true });
      return report("", `there is already a backup of tick ${tick} from this second`, 0, 0);
    }
    renameSync(making, path);
    remove(backupsToRemove(filesIn(folder), name, keep, REMOVE_MOST - removed));
    return report(path, "", tick, statSync(join(path, "world.db")).size);
  } catch (err) {
    rmSync(making, { recursive: true, force: true });
    return report("", err instanceof Error ? err.message : String(err), 0, 0);
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
