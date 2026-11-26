// Who is signed in on which browser, kept in signin.sqlite beside the cluster's permissions and shared by its worlds, so
// one sign-in serves every world at the same address. Each world keeps its own last answer to "may this one join".

import { Database } from "bun:sqlite";

const SCHEMA =
  "CREATE TABLE IF NOT EXISTS links (key TEXT PRIMARY KEY, subject TEXT NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL);" +
  "CREATE INDEX IF NOT EXISTS links_subject ON links (subject, at);" +
  "CREATE TABLE IF NOT EXISTS guild_verdicts (world INTEGER NOT NULL, policy TEXT NOT NULL, subject TEXT NOT NULL, ok INTEGER NOT NULL, why TEXT NOT NULL," +
  " at INTEGER NOT NULL, PRIMARY KEY (world, policy, subject));";

/** The most browsers one account stays signed in on; one more signs the oldest out. */
export const LINKS_EACH = 16;

export interface Link {
  /** "discord:<id>". */
  readonly subject: string;
  /** The account's name as it was at sign-in, to show. */
  readonly name: string;
  /** When it signed in, in milliseconds. */
  readonly at: number;
}

export interface Verdict {
  readonly ok: boolean;
  /** Why not, in words for the survivor. "" when ok. */
  readonly why: string;
  readonly at: number;
}

export class SignInStore {
  private db: Database | null = null;
  private readonly path: string;

  /** `path` is signin.sqlite, or ":memory:". The file opens at the first use. */
  constructor(path: string) {
    this.path = path;
  }

  private open(): Database {
    if (this.db) return this.db;
    const db = new Database(this.path, { create: true });
    db.exec("PRAGMA busy_timeout=2500;" + SCHEMA);
    return (this.db = db);
  }

  /** `key` is a key hash in hex. */
  link(key: string): Link | null {
    const r = this.open().query("SELECT subject, name, at FROM links WHERE key = ?").get(key) as Link | null;
    return r ?? null;
  }

  bind(key: string, subject: string, name: string, at: number): void {
    const db = this.open();
    db.transaction(() => {
      db.query("INSERT OR REPLACE INTO links (key, subject, name, at) VALUES (?, ?, ?, ?)").run(key, subject, name, at);
      db.query("DELETE FROM links WHERE subject = ? AND key NOT IN (SELECT key FROM links WHERE subject = ? ORDER BY at DESC LIMIT ?)").run(subject, subject, LINKS_EACH);
    }).immediate();
  }

  unbind(key: string): void {
    this.open().query("DELETE FROM links WHERE key = ?").run(key);
  }

  /** The newest name a subject signed in under, or "". */
  nameOf(subject: string): string {
    const r = this.open().query("SELECT name FROM links WHERE subject = ? ORDER BY at DESC LIMIT 1").get(subject) as { name: string } | null;
    return r?.name ?? "";
  }

  /** Forgets every sign-in made before `at`. */
  expire(at: number): void {
    this.open().query("DELETE FROM links WHERE at < ?").run(at);
  }

  verdict(world: number, policy: string, subject: string): Verdict | null {
    const r = this.open().query("SELECT ok, why, at FROM guild_verdicts WHERE world = ? AND policy = ? AND subject = ?").get(world, policy, subject) as { ok: number; why: string; at: number } | null;
    return r ? { ok: r.ok !== 0, why: r.why, at: r.at } : null;
  }

  judge(world: number, policy: string, subject: string, v: Verdict): void {
    this.open().query("INSERT OR REPLACE INTO guild_verdicts (world, policy, subject, ok, why, at) VALUES (?, ?, ?, ?, ?, ?)").run(world, policy, subject, v.ok ? 1 : 0, v.why, v.at);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
