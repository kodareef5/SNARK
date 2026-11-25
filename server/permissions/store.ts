// The cluster's permissions, kept in permissions.sqlite beside its worlds and shared by them all. Each write raises one
// revision in the same transaction, so a world that sees the file's stamp change knows by the revision whether to read it.
// The register (`issued`, `marks`) is apart: it is read a row at a time, and its writes raise no revision. The history of
// changes is written inside each change's own transaction and read on demand, never held.
import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { RANK_ADMIN, RANK_OPEN } from "../../shared/ranks.ts";
import { RETIRED_MOST } from "./secrets.ts";
import {
  ADMINS_GROUP,
  DEFAULT_GROUP,
  isGroupName,
  isHash,
  isMemberKey,
  isPermission,
  isRank,
  isSurvivorId,
  isWorld,
  type Document,
  type Group,
  type HistoryRow,
  type Member,
  type MemberKind,
  type PermissionSnapshot,
  type Secret,
  type TagChoice,
} from "../../shared/permissions/model.ts";

/** The two groups an empty store starts with. */
export const STARTING_GROUPS: readonly Group[] = [
  { name: DEFAULT_GROUP, rank: RANK_OPEN, permissions: [], chat: "" },
  { name: ADMINS_GROUP, rank: RANK_ADMIN, permissions: ["*"], chat: "" },
];

const SCHEMA =
  "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS groups (name TEXT PRIMARY KEY COLLATE NOCASE, rank INTEGER NOT NULL, permissions TEXT NOT NULL, chat TEXT NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS members (kind TEXT NOT NULL, key TEXT NOT NULL, grp TEXT NOT NULL COLLATE NOCASE, world INTEGER NOT NULL," +
  " forever INTEGER NOT NULL, start INTEGER NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (kind, key, grp, world));" +
  "CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, hash TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0);" +
  "CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY COLLATE NOCASE, body TEXT NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS tags (id TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, show INTEGER NOT NULL, PRIMARY KEY (id, tag));" +
  "CREATE TABLE IF NOT EXISTS issued (id TEXT PRIMARY KEY, name TEXT NOT NULL, world INTEGER NOT NULL, at INTEGER NOT NULL, team INTEGER NOT NULL DEFAULT 0);" +
  "CREATE INDEX IF NOT EXISTS issued_name ON issued (name COLLATE NOCASE);" +
  "CREATE TABLE IF NOT EXISTS marks (world INTEGER NOT NULL, kind TEXT NOT NULL, next INTEGER NOT NULL, PRIMARY KEY (world, kind));" +
  "CREATE TABLE IF NOT EXISTS history (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, world INTEGER NOT NULL, name TEXT NOT NULL," +
  " id TEXT NOT NULL, rank INTEGER NOT NULL, via TEXT NOT NULL, what TEXT NOT NULL, revision INTEGER NOT NULL);" +
  "CREATE TABLE IF NOT EXISTS retired (hash TEXT PRIMARY KEY, at INTEGER NOT NULL);";

/** The newest rows of history a store keeps. */
export const HISTORY_KEPT = 10_000;

export interface StoreOptions {
  /** The newest rows of history kept; HISTORY_KEPT by default. */
  readonly historyKept?: number;
}

const HISTORY_VIAS: readonly string[] = ["session", "page", "operator", "module", "server"];
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, or: number): number => (typeof v === "number" && Number.isFinite(v) ? v : or);
/** A row as read: a damaged field reads as not known rather than hiding the row. */
const historyOf = (r: Record<string, unknown>): HistoryRow => ({
  seq: num(r.seq, 0), at: num(r.at, 0), world: num(r.world, 0), name: text(r.name), id: text(r.id), rank: num(r.rank, -1),
  via: HISTORY_VIAS.includes(text(r.via)) ? (r.via as HistoryRow["via"]) : "", what: text(r.what), revision: num(r.revision, 0),
});

/**
 * A survivor ID the register knows: its survivor's name, the world it was on and the team it was in, as last known, and
 * when it was first registered. A team is a tribe's number or a survivor's own; 0 where not known.
 */
export interface Issued {
  readonly id: string;
  readonly name: string;
  readonly world: number;
  readonly at: number;
  readonly team: number;
}

/** What a world's mark counts. */
export type MarkKind = "survivor" | "team";

const issuedOf = (r: { id: unknown; name: unknown; world: unknown; at: unknown; team?: unknown } | null): Issued | null =>
  r && typeof r.id === "string" && typeof r.name === "string" && typeof r.world === "number" && typeof r.at === "number"
    ? { id: r.id, name: r.name, world: r.world, at: r.at, team: typeof r.team === "number" ? r.team : 0 }
    : null;

interface GroupRow {
  name: unknown;
  rank: unknown;
  permissions: unknown;
  chat: unknown;
}
interface MemberRow {
  kind: unknown;
  key: unknown;
  grp: unknown;
  world: unknown;
  forever: unknown;
  start: unknown;
  until: unknown;
}

/** A member's key of the right shape: cheaper than parsing every ID, which the edit rule did before it was written. */
const memberShaped = (kind: unknown, key: unknown): boolean =>
  typeof key === "string" && (kind === "survivor" ? /^[0-9]{17}$/.test(key) : kind === "tribe" && isMemberKey(kind, key));
const isTime = (t: unknown): t is number => typeof t === "number" && Number.isSafeInteger(t) && t >= 0;

export class PermissionStore {
  private db: Database | null = null;
  private readonly path: string;
  /** Changes made through this object, so a memory store has a stamp. */
  private writes = 0;
  private readonly historyKept: number;

  /** `path` is permissions.sqlite, or ":memory:". The file opens at the first use. */
  constructor(path: string, opts: StoreOptions = {}) {
    this.path = path;
    this.historyKept = Math.max(1, Math.floor(opts.historyKept ?? HISTORY_KEPT));
  }

  private open(): Database {
    if (this.db) return this.db;
    const db = new Database(this.path, { create: true });
    // The default journal, not WAL: each commit changes permissions.sqlite itself, whose time the worlds watch.
    db.exec("PRAGMA busy_timeout=2500;" + SCHEMA);
    db.transaction(() => {
      // A file made before the register kept each survivor's team has no `team`. The index is made after the column.
      if (!(db.query("PRAGMA table_info(issued)").all() as { name: string }[]).some((c) => c.name === "team")) db.exec("ALTER TABLE issued ADD COLUMN team INTEGER NOT NULL DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS issued_team ON issued (team)");
      // A file made before a password's claim was dated has no `at`.
      if (!(db.query("PRAGMA table_info(secrets)").all() as { name: string }[]).some((c) => c.name === "at")) db.exec("ALTER TABLE secrets ADD COLUMN at INTEGER NOT NULL DEFAULT 0");
      if (db.query("INSERT OR IGNORE INTO meta (id, revision) VALUES (1, 0)").run().changes === 0) return;
      for (const g of STARTING_GROUPS) db.query("INSERT OR IGNORE INTO groups (name, rank, permissions, chat) VALUES (?, ?, ?, ?)").run(g.name, g.rank, g.permissions.join(","), g.chat);
      this.writes++;
    }).immediate();
    this.db = db;
    return db;
  }

  /**
   * How long a read or write waits for another process's lock, in milliseconds. A world sets a short wait once it has
   * started, since every later use is inside its tick.
   */
  patience(ms: number): void {
    this.open().exec(`PRAGMA busy_timeout=${Math.max(0, Math.floor(ms))};`);
  }

  /** Changes when the file may have changed. */
  stamp(): string {
    if (this.path === ":memory:") return `m${this.writes}`;
    try {
      const s = statSync(this.path);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "none";
    }
  }

  /** Changes with each commit to the file, by this object or another, and costs one small query. */
  commits(): string {
    const row = this.open().query("PRAGMA data_version").get() as { data_version?: unknown } | null;
    return `${String(row?.data_version ?? 0)}:${this.writes}`;
  }

  revision(): number {
    const row = this.open().query("SELECT revision FROM meta WHERE id = 1").get() as { revision: number } | null;
    return row?.revision ?? 0;
  }

  /** Everything in the file. A row that breaks the rules is left out. */
  read(): PermissionSnapshot {
    const db = this.open();
    return db.transaction((): PermissionSnapshot => {
      const groups: Group[] = [];
      const named = new Map<string, string>();
      for (const r of db.query("SELECT name, rank, permissions, chat FROM groups").all() as GroupRow[]) {
        if (!isGroupName(r.name) || !isRank(r.rank) || typeof r.permissions !== "string" || typeof r.chat !== "string") continue;
        const permissions = r.permissions === "" ? [] : r.permissions.split(",").filter(isPermission);
        groups.push({ name: r.name, rank: r.rank, permissions, chat: r.chat });
        named.set(r.name.toLowerCase(), r.name);
      }
      for (const g of STARTING_GROUPS) if (!named.has(g.name.toLowerCase())) groups.push(g);
      const members: Member[] = [];
      for (const r of db.query("SELECT kind, key, grp, world, forever, start, until FROM members").all() as MemberRow[]) {
        const group = typeof r.grp === "string" ? named.get(r.grp.toLowerCase()) : undefined;
        if (group === undefined || !memberShaped(r.kind, r.key) || !isWorld(r.world)) continue;
        if (!isTime(r.start) || !isTime(r.until) || (r.forever !== 0 && r.forever !== 1)) continue;
        members.push({ kind: r.kind as MemberKind, key: r.key as string, group, world: r.world, forever: r.forever === 1, from: r.start, until: r.until });
      }
      const secrets: Secret[] = [];
      for (const r of db.query("SELECT id, hash, at FROM secrets").all() as { id: unknown; hash: unknown; at: unknown }[]) {
        if (isSurvivorId(r.id) && isHash(r.hash)) secrets.push({ id: r.id, hash: r.hash, at: isTime(r.at) ? r.at : 0 });
      }
      const documents: Document[] = [];
      for (const r of db.query("SELECT name, body FROM documents").all() as { name: unknown; body: unknown }[]) {
        if (isGroupName(r.name) && typeof r.body === "string") documents.push({ name: r.name, text: r.body });
      }
      const tags: TagChoice[] = [];
      for (const r of db.query("SELECT id, tag, show FROM tags").all() as { id: unknown; tag: unknown; show: unknown }[]) {
        if (isSurvivorId(r.id) && isGroupName(r.tag) && (r.show === 0 || r.show === 1)) tags.push({ id: r.id, tag: r.tag, show: r.show === 1 });
      }
      const revision = (db.query("SELECT revision FROM meta WHERE id = 1").get() as { revision: number } | null)?.revision ?? 0;
      return { revision, groups, members, secrets, documents, tags };
    })();
  }

  /** Runs `fn` in one write transaction, which no other world's write interleaves. */
  transaction<T>(fn: () => T): T {
    const db = this.open();
    const done = db.transaction(fn).immediate();
    this.writes++;
    return done;
  }

  /** Raises the revision and answers the new one. Call it inside `transaction`. */
  raise(): number {
    const db = this.open();
    db.query("UPDATE meta SET revision = revision + 1 WHERE id = 1").run();
    return this.revision();
  }

  putGroup(g: Group): void {
    this.open().query("INSERT OR REPLACE INTO groups (name, rank, permissions, chat) VALUES (?, ?, ?, ?)").run(g.name, g.rank, g.permissions.join(","), g.chat);
  }

  /** Removes a group and its members. */
  dropGroup(name: string): void {
    const db = this.open();
    db.query("DELETE FROM members WHERE grp = ?").run(name);
    db.query("DELETE FROM groups WHERE name = ?").run(name);
  }

  putMember(m: Member): void {
    this.open()
      .query("INSERT OR REPLACE INTO members (kind, key, grp, world, forever, start, until) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(m.kind, m.key, m.group, m.world, m.forever ? 1 : 0, m.from, m.until);
  }

  dropMember(kind: MemberKind, key: string, group: string, world: number): void {
    this.open().query("DELETE FROM members WHERE kind = ? AND key = ? AND grp = ? AND world = ?").run(kind, key, group, world);
  }

  /** Clears the timed memberships that ran out by `now`: the row goes, or its timed part when it is also for good. */
  dropExpired(now: number): void {
    const db = this.open();
    db.query("DELETE FROM members WHERE forever = 0 AND until <= ?").run(now);
    db.query("UPDATE members SET start = 0, until = 0 WHERE forever = 1 AND until > 0 AND until <= ?").run(now);
  }

  putSecret(s: Secret): void {
    this.open().query("INSERT OR REPLACE INTO secrets (id, hash, at) VALUES (?, ?, ?)").run(s.id, s.hash, s.at);
  }

  dropSecret(id: string): void {
    this.open().query("DELETE FROM secrets WHERE id = ?").run(id);
  }

  putDocument(name: string, text: string): void {
    this.open().query("INSERT OR REPLACE INTO documents (name, body) VALUES (?, ?)").run(name, text);
  }

  putTag(id: string, tag: string, show: boolean): void {
    this.open().query("INSERT OR REPLACE INTO tags (id, tag, show) VALUES (?, ?, ?)").run(id, tag, show ? 1 : 0);
  }

  /** Keeps the hash of a password replaced or cleared at `at`, so every world refuses it without counting a guess. */
  putRetired(hash: string, at: number): void {
    this.open().query("INSERT OR REPLACE INTO retired (hash, at) VALUES (?, ?)").run(hash.toLowerCase(), at);
  }

  /** Forgets the passwords retired before `before`. */
  dropRetired(before: number): void {
    this.open().query("DELETE FROM retired WHERE at < ?").run(before);
  }

  /** The newest passwords retired at `since` or later, as many as a view remembers, oldest first. */
  retired(since: number): { hash: string; at: number }[] {
    const rows = this.open().query("SELECT hash, at FROM retired WHERE at >= ? ORDER BY at DESC LIMIT ?").all(since, RETIRED_MOST) as { hash: unknown; at: unknown }[];
    return rows.filter((r): r is { hash: string; at: number } => isHash(r.hash) && typeof r.at === "number").reverse();
  }

  /** The register's row for survivor ID `id`, or null where it was never issued. */
  issued(id: string): Issued | null {
    return issuedOf(this.open().query("SELECT id, name, world, at, team FROM issued WHERE id = ?").get(id) as Issued | null);
  }

  /** The register's rows for survivors of a name, in any case. */
  issuedNamed(name: string): Issued[] {
    const rows = this.open().query("SELECT id, name, world, at, team FROM issued WHERE name = ? COLLATE NOCASE ORDER BY id").all(name) as Issued[];
    return rows.map(issuedOf).filter((r): r is Issued => r !== null);
  }

  /** Every row of the register. */
  allIssued(): Issued[] {
    return (this.open().query("SELECT id, name, world, at, team FROM issued ORDER BY id").all() as Issued[]).map(issuedOf).filter((r): r is Issued => r !== null);
  }

  /** The next number world `world` may hand out of a kind, or undefined where it has no mark yet. */
  mark(world: number, kind: MarkKind): number | undefined {
    const row = this.open().query("SELECT next FROM marks WHERE world = ? AND kind = ?").get(world, kind) as { next: unknown } | null;
    return typeof row?.next === "number" ? row.next : undefined;
  }

  /** Raises a mark to at least `next`, or sets it where there is none. A mark never goes down. */
  raiseMark(world: number, kind: MarkKind, next: number): void {
    this.open().query("INSERT INTO marks (world, kind, next) VALUES (?, ?, ?) ON CONFLICT (world, kind) DO UPDATE SET next = MAX(next, excluded.next)").run(world, kind, next);
  }

  /** Registers an ID just made, over any row it had. */
  putMinted(row: Issued): void {
    this.open().query("INSERT OR REPLACE INTO issued (id, name, world, at, team) VALUES (?, ?, ?, ?, ?)").run(row.id, row.name, row.world, row.at, row.team);
  }

  /** The survivor IDs last known in team `team`, on any world. */
  issuedInTeam(team: number): string[] {
    if (!Number.isSafeInteger(team) || team <= 0) return [];
    return (this.open().query("SELECT id FROM issued WHERE team = ?").all(team) as { id: unknown }[]).map((r) => r.id).filter((id): id is string => typeof id === "string");
  }

  /** Registers an ID made before or elsewhere: it is added where absent, and its name, world and team follow. */
  putKnown(row: Issued): void {
    this.open()
      .query(
        "INSERT INTO issued (id, name, world, at, team) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, world = excluded.world, team = excluded.team" +
          " WHERE name IS NOT excluded.name OR world IS NOT excluded.world OR team IS NOT excluded.team",
      )
      .run(row.id, row.name, row.world, row.at, row.team);
  }

  /** Adds a row of history and drops what falls past the newest kept. Call it inside the change's own `transaction`. */
  putHistory(row: Omit<HistoryRow, "seq">): void {
    const db = this.open();
    const made = db.query("INSERT INTO history (at, world, name, id, rank, via, what, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(row.at, row.world, row.name, row.id, row.rank, row.via, row.what, row.revision);
    // Sequence numbers only rise and none is skipped, so the newest kept are those within the count of the last.
    db.query("DELETE FROM history WHERE seq <= ?").run(Number(made.lastInsertRowid) - this.historyKept);
  }

  /** At most `most` rows of history whose seq is below `before`, newest first. */
  history(before: number, most: number): HistoryRow[] {
    const rows = this.open().query("SELECT seq, at, world, name, id, rank, via, what, revision FROM history WHERE seq < ? ORDER BY seq DESC LIMIT ?").all(before, most) as Record<string, unknown>[];
    return rows.map(historyOf);
  }

  /** Removes every membership, password and tag that names survivor `id`, and answers how many rows went. */
  dropRowsOf(id: string): number {
    const db = this.open();
    let n = db.query("DELETE FROM members WHERE kind = 'survivor' AND key = ?").run(id).changes;
    n += db.query("DELETE FROM secrets WHERE id = ?").run(id).changes;
    n += db.query("DELETE FROM tags WHERE id = ?").run(id).changes;
    return n;
  }

  /** Removes the tribe memberships of team numbers from `from` up to but not including `to`, and answers how many went. */
  dropTribes(from: number, to: number): number {
    return this.open().query("DELETE FROM members WHERE kind = 'tribe' AND CAST(key AS INTEGER) >= ? AND CAST(key AS INTEGER) < ?").run(from, to).changes;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
