// The cluster's permissions, kept in permissions.sqlite beside its worlds and shared by them all. Each write raises one
// revision in the same transaction, so a world that sees the file's stamp change knows by the revision whether to read it.
import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { RANK_ADMIN, RANK_OPEN } from "../../shared/ranks.ts";
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
  "CREATE TABLE IF NOT EXISTS tags (id TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, show INTEGER NOT NULL, PRIMARY KEY (id, tag));";

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

  /** `path` is permissions.sqlite, or ":memory:". The file opens at the first use. */
  constructor(path: string) {
    this.path = path;
  }

  private open(): Database {
    if (this.db) return this.db;
    const db = new Database(this.path, { create: true });
    // The default journal, not WAL: each commit changes permissions.sqlite itself, whose time the worlds watch.
    db.exec("PRAGMA busy_timeout=2500;" + SCHEMA);
    db.transaction(() => {
      // A file made before a password's claim was dated has no `at`.
      if (!(db.query("PRAGMA table_info(secrets)").all() as { name: string }[]).some((c) => c.name === "at")) db.exec("ALTER TABLE secrets ADD COLUMN at INTEGER NOT NULL DEFAULT 0");
      if (db.query("INSERT OR IGNORE INTO meta (id, revision) VALUES (1, 0)").run().changes === 0) return;
      for (const g of STARTING_GROUPS) db.query("INSERT OR IGNORE INTO groups (name, rank, permissions, chat) VALUES (?, ?, ?, ?)").run(g.name, g.rank, g.permissions.join(","), g.chat);
      this.writes++;
    }).immediate();
    this.db = db;
    return db;
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

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
