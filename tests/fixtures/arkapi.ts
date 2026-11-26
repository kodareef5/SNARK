// ArkApi's Permissions database as the plugin writes it, in write-ahead-log mode, and a copy of it and its log taken while
// the ARK server runs.
import { Database } from "bun:sqlite";
import { readFileSync, rmSync } from "node:fs";

export const STEAM = ["76561198011111111", "76561198022222222"];
export const TRIBE = "1234567";

// The plugin's tables, as its source creates them.
const PLUGIN_TABLES = `create table if not exists Players (Id integer primary key autoincrement not null, SteamId integer default 0 UNIQUE, Groups text default 'Default,' COLLATE NOCASE, TimedGroups text default '' COLLATE NOCASE);
create table if not exists Tribes (Id integer primary key autoincrement not null, TribeId integer default 0, Groups text default '' COLLATE NOCASE, TimedGroups text default '' COLLATE NOCASE);
create table if not exists Groups (Id integer primary key autoincrement not null, GroupName text not null COLLATE NOCASE, Permissions text default '' COLLATE NOCASE);`;

/** ArkApi's database opened as the plugin opens it: write-ahead-log mode first, then its tables and starting groups. */
export function pluginDatabase(path: string, pageSize?: number): Database {
  const db = new Database(path, { create: true });
  if (pageSize) db.exec(`PRAGMA page_size=${pageSize};`);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(PLUGIN_TABLES);
  const group = db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)");
  group.run("Admins", "*,");
  group.run("Default", "");
  group.run("Vip", "ArkShop.Kits.vip,Cheat.KickPlayer,");
  group.run("Builders", "Build.Fast,");
  db.query("INSERT INTO Players (SteamId, Groups, TimedGroups) VALUES (?, ?, ?)").run(STEAM[0]!, "Default,Vip,", "0;1800000000;Vip,");
  db.query("INSERT INTO Tribes (TribeId, Groups) VALUES (?, ?)").run(TRIBE, "Builders,");
  return db;
}

export const removeDatabase = (path: string) => {
  for (const end of ["", "-wal", "-shm"]) rmSync(path + end, { force: true });
};

/** ArkApi's database at `path` and its log, copied while the server runs: the group Late is only in the log. The files go after. */
export function runningArkApi(path: string, pageSize?: number, late = "Late"): { main: Uint8Array; wal: Uint8Array } {
  const db = pluginDatabase(path, pageSize);
  db.exec("PRAGMA wal_autocheckpoint=0;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.query("INSERT INTO Groups (GroupName, Permissions) VALUES (?, ?)").run(late, "ArkShop.Kits.late,");
  db.query("INSERT INTO Players (SteamId, Groups) VALUES (?, ?)").run(STEAM[1]!, `${late},`);
  const copy = { main: readFileSync(path), wal: readFileSync(`${path}-wal`) };
  db.close();
  removeDatabase(path);
  return copy;
}
