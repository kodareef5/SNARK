// What an admin brings from ARK, made into a plan: ArkApi's Permissions database, a pasted list of `Permissions.*`
// commands, or a CrossChat config. A plan is ops and plain notes, and nothing is written until `applyPlan` runs it
// through `Permissions.apply`. Memberships by Steam id are counted and left behind, and no Steam id reaches a note.
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChatSettings, readCrossChat, readLooseJson, type ChatFormat, type ChatSettings, type ChatTag } from "../../shared/permissions/chat.ts";
import { permissionsCommand, readPermissions } from "../../shared/permissions/commands.ts";
import {
  ADMINS_GROUP,
  DEFAULT_GROUP,
  arkCommand,
  isGroupName,
  isPermission,
  type Group,
  type MemberKind,
  type PermissionActor,
  type PermissionOp,
} from "../../shared/permissions/model.ts";
import { CHAT_DOCUMENT, WAL_MISSING } from "../../shared/permissions/page.ts";
import { RANK_OPEN } from "../../shared/ranks.ts";
import type { Permissions } from "./permissions.ts";

/** The ops to run, in order, and what the admin should know. */
export interface ImportPlan {
  readonly ops: readonly PermissionOp[];
  readonly notes: readonly string[];
}

export type Planned = { readonly ok: true; readonly plan: ImportPlan } | { readonly ok: false; readonly reason: string };

/** What the importer reads of the store. A `Permissions` serves. */
export interface ImportLook {
  group(name: string): Group | undefined;
  document(name: string): string;
}

export interface ImportOptions {
  readonly look: ImportLook;
  /** This game's console command names, to name the `Cheat.X` permissions that allow nothing here. */
  readonly commands: Iterable<string>;
  /** A plan this one adds to: its ops and notes come first, and the groups it makes count as there. */
  readonly onto?: ImportPlan;
}

export interface Applied {
  readonly done: number;
  readonly refused: readonly { readonly op: PermissionOp; readonly reason: string }[];
  /** The lowest rank any of its changes was judged at inside its write, or null for a plan of none. */
  readonly rank: number | null;
}

export { CHAT_DOCUMENT };

interface DraftGroup {
  name: string;
  rank: number;
  permissions: string[];
  chat: string;
}

interface LeftBehind {
  name: string;
  players: number;
  tribes: number;
  timed: number;
}

const plural = (n: number, one: string, many = one + "s"): string => `${n} ${n === 1 ? one : many}`;
const shown = (word: string): string => JSON.stringify(word.length > 64 ? word.slice(0, 64) + "..." : word);
const isDefault = (name: string): boolean => name.toLowerCase() === DEFAULT_GROUP.toLowerCase();
const isCheat = (p: string): boolean => p === "*" || p.toLowerCase().startsWith("cheat.");
const steamShaped = (word: string): boolean => /^[0-9]{17}$/.test(word);

/** The store as the plan so far leaves it, and the plan's ops and notes. */
class Draft {
  readonly ops: PermissionOp[] = [];
  readonly notes: string[] = [];
  private readonly groups = new Map<string, DraftGroup | null>();
  private readonly documents = new Map<string, string>();
  private readonly touched = new Set<string>();
  private readonly left = new Map<string, LeftBehind>();
  private readonly missing = new Set<string>();
  private readonly commands: ReadonlySet<string>;
  private readonly opts: ImportOptions;
  /** Notes left unsaid past the most a plan carries. */
  private unsaid = 0;

  constructor(opts: ImportOptions) {
    this.opts = opts;
    this.commands = new Set([...opts.commands].map((c) => c.toLowerCase()));
    if (opts.onto) {
      this.notes.push(...opts.onto.notes);
      for (const op of opts.onto.ops) this.push(op);
    }
  }

  group(name: string): DraftGroup | undefined {
    const lower = name.toLowerCase();
    if (this.groups.has(lower)) return this.groups.get(lower) ?? undefined;
    const g = this.opts.look.group(name);
    if (!g) return undefined;
    const draft = { name: g.name, rank: g.rank, permissions: [...g.permissions], chat: g.chat };
    this.groups.set(lower, draft);
    return draft;
  }

  document(name: string): string {
    return this.documents.get(name.toLowerCase()) ?? this.opts.look.document(name);
  }

  /** The group of that name, added at rank open where there is none; null where its name breaks the rules. */
  ensure(name: string): DraftGroup | null {
    if (!isGroupName(name) || steamShaped(name)) {
      const why = steamShaped(name) ? "it looks like a Steam id" : "a group's name is up to 32 letters, digits and _ . : -";
      this.note(`The group ${steamShaped(name) ? "named by a long number" : shown(name)} was skipped: ${why}.`);
      return null;
    }
    const old = this.group(name);
    this.touched.add(name.toLowerCase());
    if (old) return old;
    this.push({ op: "addGroup", group: name });
    return this.group(name)!;
  }

  grant(g: DraftGroup, permission: string): void {
    if (!isPermission(permission)) {
      this.note(`${g.name}: the permission ${shown(permission)} was skipped: a permission is up to 64 letters, digits and _ . : - *.`);
      return;
    }
    const lower = permission.toLowerCase();
    if (lower.startsWith("cheat.") && !lower.endsWith(".*") && !this.commands.has(arkCommand(lower.slice("cheat.".length)))) this.missing.add(permission);
    if (g.permissions.some((p) => p.toLowerCase() === lower)) return;
    this.push({ op: "grant", group: g.name, permission });
  }

  // A whole value is planned from what the store held, and says so: another map's change since then refuses it.
  setChat(g: DraftGroup, chat: string): void {
    if (g.chat !== chat) this.push({ op: "setChat", group: g.name, chat, was: g.chat });
  }

  setDocument(name: string, text: string): void {
    const was = this.document(name);
    if (was !== text) this.push({ op: "setDocument", name, text, was });
  }

  /** Counts a membership that is not imported, by its group's name alone. */
  leaveBehind(group: string, kind: MemberKind, timed: boolean): void {
    if (isDefault(group)) return;
    const name = isGroupName(group) && !steamShaped(group) ? (this.group(group)?.name ?? group) : "A group that is not a name";
    const key = name.toLowerCase();
    let row = this.left.get(key);
    if (!row) this.left.set(key, (row = { name, players: 0, tribes: 0, timed: 0 }));
    if (kind === "survivor") row.players++;
    else row.tribes++;
    if (timed) row.timed++;
  }

  note(text: string): void {
    if (this.notes.length < IMPORT_NOTES_MOST) this.notes.push(text);
    else this.unsaid++;
  }

  /** Writes an op to the plan and to the draft. */
  push(op: PermissionOp): void {
    this.ops.push(op);
    const g = "group" in op ? this.group(op.group) : undefined;
    switch (op.op) {
      case "addGroup":
        this.groups.set(op.group.toLowerCase(), { name: op.group, rank: op.rank ?? RANK_OPEN, permissions: [], chat: "" });
        break;
      case "removeGroup":
        this.groups.set(op.group.toLowerCase(), null);
        break;
      case "setRank":
        if (g) g.rank = op.rank;
        break;
      case "grant":
        if (g) g.permissions.push(op.permission);
        break;
      case "revoke":
        if (g) g.permissions = g.permissions.filter((p) => p.toLowerCase() !== op.permission.toLowerCase());
        break;
      case "setChat":
        if (g) g.chat = op.chat;
        break;
      case "setDocument":
        this.documents.set(op.name.toLowerCase(), op.text);
        break;
    }
  }

  /** The plan, with the notes that sum up what this source left behind and what holds cheats. */
  plan(): ImportPlan {
    // What sums the import up is said whatever else was: the warning of an open group that holds cheats is among it.
    const sum: string[] = [];
    const rows = [...this.left.values()];
    if (rows.length > 0) {
      const all = rows.reduce((n, r) => n + r.players + r.tribes, 0);
      sum.push(`Memberships by Steam id are not imported: ${plural(all, "membership")} in all were left behind. Hand them out again by survivor ID.`);
      for (const r of rows) {
        const parts = [plural(r.players, "player"), plural(r.tribes, "tribe")].filter((p) => !p.startsWith("0 "));
        const timed = r.timed > 0 ? `; ${r.timed} timed` : "";
        sum.push(`${r.name}: ${plural(r.players + r.tribes, "membership")} left behind (${parts.join(", ")}${timed}).`);
      }
    }
    for (const key of this.touched) {
      const g = this.group(key);
      if (g && g.rank === RANK_OPEN && g.permissions.some(isCheat)) {
        sum.push(`${g.name} is open and holds cheats: its members need no password. Permissions.Rank ${g.name} staff asks them for one.`);
      }
    }
    if (this.missing.size > 0) sum.push(`These permissions name commands this game does not have, and allow nothing here: ${[...this.missing].join(", ")}.`);
    const notes = this.unsaid > 0 ? [...this.notes, `And ${this.unsaid} more notes like these.`] : this.notes;
    return { ops: this.ops, notes: [...notes, ...sum.slice(0, IMPORT_NOTES_MOST)] };
  }
}

// ---- ArkApi's database ----

const GROUP_TABLES = ["groups", "permissiongroups"];
const PLAYER_TABLES = ["players"];
const TRIBE_TABLES = ["tribes", "tribepermissions"];

const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : "");
const list = (v: unknown): string[] =>
  text(v)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
/** The group a timed entry, `delayUntil;expireAt;name`, names. */
const timedGroup = (entry: string): string => entry.slice(entry.lastIndexOf(";") + 1).trim();

/** What came with ArkApi's database. */
export interface ArkApiFiles {
  /** The file beside the database whose name ends in `-wal`, where the admin gave it. */
  readonly wal?: Uint8Array;
  /** The folder that a database in write-ahead-log mode is read in, inside a folder of its own; the system's temporary folder by default. */
  readonly folder?: string;
}

/** The most changes one import makes: they are one write, made inside the server's tick. */
export const IMPORT_CHANGES_MOST = 1000;
/** The most notes a plan carries of what it skipped, line by line. What sums it up is said besides. */
export const IMPORT_NOTES_MOST = 200;
/** The most letters of a pasted import, a command list or a config: a thousand changes are far shorter. */
export const IMPORT_TEXT_MOST = 256 * 1024;

/** A draft as its plan, or the reason it is too large to be one. */
function finished(draft: Draft): Planned {
  const plan = draft.plan();
  if (plan.ops.length <= IMPORT_CHANGES_MOST) return { ok: true, plan };
  return { ok: false, reason: `That import would make ${plan.ops.length} changes, and one import makes ${IMPORT_CHANGES_MOST} at most. Bring it in as several.` };
}

const NOT_SQLITE: Planned = { ok: false, reason: "That file is not an SQLite database." };
const DAMAGED: Planned = { ok: false, reason: "That database is damaged, so nothing was read from it. Copy it again with the ARK server stopped." };
const NO_FOLDER: Planned = { ok: false, reason: "The server could not open that database in a folder of its own." };
const WAL_WRONG = "The -wal file does not belong to this database or is damaged, so it was left out. The plan reads what the database file holds.";

const isSqlite = (b: Uint8Array): boolean => b.length >= 100 && new TextDecoder().decode(b.subarray(0, 16)) === "SQLite format 3\0";
// The header's bytes 18 and 19 are 2 in write-ahead-log mode.
const inWalMode = (b: Uint8Array): boolean => isSqlite(b) && (b[18] === 2 || b[19] === 2);
// A database's page size is at byte 16, where 1 stands for 65536; a log's is at byte 8.
const pageSize = (b: Uint8Array): number => {
  const n = (b[16]! << 8) | b[17]!;
  return n === 1 ? 65536 : n;
};
const logPageSize = (w: Uint8Array): number => (w.length >= 32 ? new DataView(w.buffer, w.byteOffset, 32).getUint32(8) : 0);

/**
 * Reads the tables of ArkApi's Permissions plugin from its SQLite file. A file in the default journal mode is read in
 * memory. One in write-ahead-log mode, as the plugin writes it, is written to a folder of its own beside its `-wal`
 * file, where given, so that SQLite applies the log; the folder is removed after.
 */
export function planArkApi(bytes: Uint8Array, opts: ImportOptions, files: ArkApiFiles = {}): Planned {
  const wal = files.wal && files.wal.length > 0 ? files.wal : undefined;
  if (!inWalMode(bytes)) return planImage(bytes, opts, wal ? WAL_WRONG : undefined);
  let dir: string;
  try {
    dir = mkdtempSync(join(files.folder ?? tmpdir(), "snark-arkapi-"));
  } catch {
    return NO_FOLDER;
  }
  try {
    if (!wal) return planFile(join(dir, "alone.db"), bytes, opts, WAL_MISSING);
    const logged = logPageSize(wal) === pageSize(bytes) ? planLogged(join(dir, "logged.db"), bytes, wal, opts) : undefined;
    return logged ?? planFile(join(dir, "alone.db"), bytes, opts, WAL_WRONG);
  } catch {
    return NO_FOLDER;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function planImage(bytes: Uint8Array, opts: ImportOptions, note?: string): Planned {
  let db: Database;
  try {
    db = Database.deserialize(bytes, true);
  } catch {
    return NOT_SQLITE;
  }
  try {
    return readArkApi(db, opts, note);
  } finally {
    db.close();
  }
}

function planFile(path: string, bytes: Uint8Array, opts: ImportOptions, note?: string): Planned {
  writeFileSync(path, bytes);
  const db = new Database(path);
  try {
    return readArkApi(db, opts, note);
  } finally {
    db.close();
  }
}

/**
 * The plan with the log applied, or its refusal. Undefined only where the log is not taken: SQLite takes nothing from it,
 * finds the two damaged, or the log leaves no Groups table, as another database's would. A log taken holds committed
 * changes, so the database alone is no plan of it.
 */
function planLogged(path: string, bytes: Uint8Array, wal: Uint8Array, opts: ImportOptions): Planned | undefined {
  let db: Database;
  try {
    writeFileSync(path, bytes);
    writeFileSync(`${path}-wal`, wal);
    db = new Database(path);
  } catch {
    return undefined;
  }
  try {
    return logTaken(db) ? readArkApi(db, opts) : undefined;
  } finally {
    db.close();
  }
}

/** Whether SQLite moved the log's frames into the database, finds the two whole, and a Groups table is there after. */
function logTaken(db: Database): boolean {
  try {
    const frames = (db.query("PRAGMA wal_checkpoint(PASSIVE)").get() as { log?: unknown } | null)?.log;
    const check = (db.query("PRAGMA quick_check").get() as { quick_check?: unknown } | null)?.quick_check;
    if (typeof frames !== "number" || frames <= 0 || check !== "ok") return false;
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: unknown }[];
    return tables.some((t) => GROUP_TABLES.includes(text(t.name).toLowerCase()));
  } catch {
    return false;
  }
}

/** Whether a file from outside is whole. It is read with its schema untrusted, its cells measured, and nothing written. */
function sound(db: Database): boolean {
  db.exec("PRAGMA trusted_schema=OFF; PRAGMA cell_size_check=ON; PRAGMA query_only=ON;");
  return (db.query("PRAGMA quick_check(1)").get() as { quick_check?: unknown } | null)?.quick_check === "ok";
}

/** Reads the plugin's tables from an open database. */
function readArkApi(db: Database, opts: ImportOptions, note?: string): Planned {
  try {
    let tables: string[];
    try {
      if (!sound(db)) return DAMAGED;
      tables = (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: unknown }[]).map((r) => text(r.name));
    } catch {
      return NOT_SQLITE;
    }
    const find = (names: string[]): string | undefined => tables.find((t) => names.includes(t.toLowerCase()));
    const columns = (table: string): Set<string> =>
      new Set((db.query(`PRAGMA table_info("${table}")`).all() as { name: unknown }[]).map((r) => text(r.name).toLowerCase()));
    const groupTable = find(GROUP_TABLES);
    if (!groupTable) return { ok: false, reason: "That database has no Groups table, so it is not ArkApi's Permissions database." };
    const groupColumns = columns(groupTable);
    if (!groupColumns.has("groupname") || !groupColumns.has("permissions")) {
      return { ok: false, reason: `${groupTable} has no GroupName and Permissions, so it is not ArkApi's Permissions database.` };
    }
    const draft = new Draft(opts);
    if (note) draft.note(note);
    const order = groupColumns.has("id") ? " ORDER BY Id" : "";
    for (const row of db.query(`SELECT GroupName AS name, Permissions AS permissions FROM "${groupTable}"${order}`).iterate() as Iterable<Record<string, unknown>>) {
      const g = draft.ensure(text(row.name).trim());
      if (g) for (const p of list(row.permissions)) draft.grant(g, p);
    }
    const members = (table: string | undefined, kind: MemberKind): void => {
      if (!table) return;
      const cols = columns(table);
      const picks = [cols.has("groups") ? "Groups AS groups" : "", cols.has("timedgroups") ? "TimedGroups AS timed" : ""].filter((s) => s !== "");
      if (picks.length === 0) return;
      // A big server's Players table has a row for everyone who ever joined: they are walked, not gathered.
      for (const row of db.query(`SELECT ${picks.join(", ")} FROM "${table}"`).iterate() as Iterable<Record<string, unknown>>) {
        for (const g of list(row.groups)) draft.leaveBehind(g, kind, false);
        for (const entry of list(row.timed)) draft.leaveBehind(timedGroup(entry), kind, true);
      }
    };
    members(find(PLAYER_TABLES), "survivor");
    members(find(TRIBE_TABLES), "tribe");
    return finished(draft);
  } catch {
    return { ok: false, reason: "That database could not be read as ArkApi's Permissions database." };
  }
}

// ---- A pasted list of commands ----

/** Reads a pasted list of `Permissions.*` commands, one a line. Lines that name a survivor or a tribe are counted and left behind. */
export function planCommands(source: string, opts: ImportOptions): Planned {
  const draft = new Draft(opts);
  let listings = 0;
  let removals = 0;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim().replace(/^(?:admincheat|cheat)\s+/i, "");
    if (line === "" || line.startsWith("#") || line.startsWith("//")) continue;
    const [name = "", ...words] = line.split(/\s+/);
    if (!permissionsCommand(name)) {
      draft.note(`Line ${i + 1} is not a Permissions command, so it was skipped.`);
      continue;
    }
    const read = readPermissions(name, words);
    if (!read.ok) {
      draft.note(`Line ${i + 1}: ${read.reason}`);
      continue;
    }
    const req = read.request;
    if (req.type === "list") listings++;
    else if (req.type === "password") draft.note(`Line ${i + 1}: a password is not imported, so it was skipped.`);
    else if (req.type === "member") {
      if (req.change.op === "addMember") draft.leaveBehind(req.change.group, req.who.kind, req.change.hours !== undefined);
      else removals++;
    } else {
      const op = req.op;
      if (op.op === "addGroup") {
        draft.ensure(op.group);
        continue;
      }
      const g = op.op === "grant" ? draft.ensure(op.group) : draft.group(op.group);
      if (!g) {
        if (op.op !== "grant") draft.note(`Line ${i + 1}: there is no group ${shown(op.group)}, so it was skipped.`);
        continue;
      }
      if (op.op === "grant") draft.grant(g, op.permission);
      else if (op.op === "revoke") {
        if (g.permissions.some((p) => p.toLowerCase() === op.permission.toLowerCase())) draft.push({ ...op, group: g.name });
      } else if (op.op === "setRank") {
        if (g.rank !== op.rank) draft.push({ ...op, group: g.name, was: g.rank });
      } else draft.push({ ...op, group: g.name });
    }
  }
  const was = (n: number): string => (n === 1 ? "was" : "were");
  if (listings > 0) draft.note(`${plural(listings, "line that only lists", "lines that only list")} ${was(listings)} skipped.`);
  if (removals > 0) draft.note(`${plural(removals, "line that takes a member out", "lines that take members out")} ${was(removals)} skipped.`);
  return finished(draft);
}

// ---- CrossChat ----

const CROSSCHAT_KEYS = ["PermissionsFormatting", "ChatTags", "StackChatTags", "MutedPermissionGroup", "MapColors"];
const SETTINGS_KEYS = ["ChatTags", "StackChatTags", "MutedPermissionGroup", "MapColors"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A group's chat block as JSON text in CrossChat's keys. */
function blockText(f: ChatFormat): string {
  return JSON.stringify({ ChatFormat: f.chatFormat, Priority: f.priority, Icon: f.icon, FormattingParts: { ...f.parts } });
}

/** Chat settings as JSON text in CrossChat's keys, StackChatTags inside ChatTags as CrossChat writes it. */
function settingsText(s: ChatSettings): string {
  const tags: Record<string, unknown> = { StackChatTags: s.stackTags };
  for (const t of s.tags) tags[t.name] = { Priority: t.priority, Icon: t.icon, Text: t.text, CanBeDisabled: t.canBeDisabled };
  const colors: Record<string, number[]> = {};
  for (const [map, c] of s.mapColors) colors[map] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  return JSON.stringify({ ChatTags: tags, MutedPermissionGroup: s.mutedGroup, MapColors: colors });
}

/** The settings the store holds now, or null where it holds none. */
function heldSettings(text: string): ChatSettings | null {
  if (text === "") return null;
  const json = readLooseJson(text);
  return json.ok && isObject(json.value) ? readChatSettings(json.value).value : null;
}

/** Reads a CrossChat config: each group's chat block, and its tags and settings as the `chat` document. */
export function planCrossChat(source: string, opts: ImportOptions): Planned {
  const json = readLooseJson(source);
  if (!json.ok) return { ok: false, reason: json.reason };
  if (!isObject(json.value)) return { ok: false, reason: "The config is not an object, so it is not CrossChat's." };
  const top = json.value;
  const premium = isObject(top.Premium) ? top.Premium : {};
  const has = (key: string): boolean => top[key] !== undefined || premium[key] !== undefined;
  const read = readCrossChat(top);
  const draft = new Draft(opts);
  for (const fault of read.faults) draft.note(`CrossChat: ${fault}`);
  const ignored = [
    ...Object.keys(top).filter((k) => k !== "Premium" && !CROSSCHAT_KEYS.includes(k)),
    ...Object.keys(premium).filter((k) => !CROSSCHAT_KEYS.includes(k)).map((k) => `Premium.${k}`),
  ];
  if (ignored.length > 0) draft.note(`These keys of the config do not carry over: ${ignored.join(", ")}.`);

  const blocks = [...read.value.groups];
  const tags = [...read.value.settings.tags];
  const named = (names: string[], wanted: string): number => names.findIndex((n) => n.toLowerCase() === wanted.toLowerCase());
  const adminBlock = named(blocks.map(([n]) => n), "Admin");
  const adminTag = named(tags.map((t) => t.name), "Admin");
  if ((adminBlock >= 0 || adminTag >= 0) && !draft.group("Admin") && draft.group(ADMINS_GROUP)) {
    const moved: string[] = [];
    if (adminBlock >= 0 && named(blocks.map(([n]) => n), ADMINS_GROUP) < 0) {
      blocks[adminBlock] = [ADMINS_GROUP, blocks[adminBlock]![1]];
      moved.push("block");
    }
    if (adminTag >= 0 && named(tags.map((t) => t.name), ADMINS_GROUP) < 0) {
      tags[adminTag] = { ...tags[adminTag]!, name: ADMINS_GROUP };
      moved.push("tag");
    }
    if (moved.length > 0) draft.note(`CrossChat's Admin ${moved.join(" and ")} went to ${ADMINS_GROUP}, as ArkApi names its admin group.`);
  }

  let icons = 0;
  for (const [name, format] of blocks) {
    if (format.icon !== "") icons++;
    const g = draft.ensure(name);
    if (g) draft.setChat(g, blockText(format));
  }
  for (const t of tags) if (t.icon !== "") icons++;
  if (icons > 0) draft.note(`Icons do not carry over: chat here shows none, and ${plural(icons, "block or tag", "blocks and tags")} had one.`);

  if (SETTINGS_KEYS.some(has)) {
    const held = heldSettings(draft.document(CHAT_DOCUMENT));
    const ours = new Set(tags.map((t) => t.name.toLowerCase()));
    const kept: ChatTag[] = held ? held.tags.filter((t) => !ours.has(t.name.toLowerCase())) : [];
    const given = read.value.settings;
    const stacked = has("StackChatTags") || (isObject(top.ChatTags) && top.ChatTags.StackChatTags !== undefined) || (isObject(premium.ChatTags) && premium.ChatTags.StackChatTags !== undefined);
    const merged: ChatSettings = {
      stackTags: stacked || !held ? given.stackTags : held.stackTags,
      tags: [...tags, ...kept].sort((a, b) => b.priority - a.priority),
      mutedGroup: has("MutedPermissionGroup") || !held ? given.mutedGroup : held.mutedGroup,
      mapColors: has("MapColors") || !held ? given.mapColors : held.mapColors,
    };
    draft.setDocument(CHAT_DOCUMENT, settingsText(merged));
    for (const t of tags) if (!draft.group(t.name)) draft.note(`The tag ${t.name} has no group of its name yet; it shows once there is one.`);
    if (has("MutedPermissionGroup") && !draft.group(given.mutedGroup)) {
      draft.note(`The muted group ${given.mutedGroup} is not a group yet; Permissions.AddGroup ${given.mutedGroup} makes it.`);
    }
  }
  return finished(draft);
}

// ---- Applying ----

/**
 * Makes a plan's changes as `actor` in one write, since each write of its own would hold the server's tick for its commit.
 * A refusal stops nothing. The caller checks the actor's rank.
 */
export function applyPlan(perms: Pick<Permissions, "makeAll">, actor: PermissionActor, plan: ImportPlan): Applied {
  let done = 0;
  let rank: number | null = null;
  const refused: { op: PermissionOp; reason: string }[] = [];
  const made = perms.makeAll(actor, plan.ops);
  for (let i = 0; i < made.length; i++) {
    const m = made[i]!;
    rank = Math.min(rank ?? m.rank, m.rank);
    if (m.why === "") done++;
    else refused.push({ op: plan.ops[i]!, reason: m.why });
  }
  return { done, refused, rank };
}
