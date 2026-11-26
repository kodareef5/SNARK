// The cluster's people store: people.sqlite beside its worlds, shared by them all. It holds records, each one revision of
// one thing of a kind (shared/people/doc.ts), appended and never changed or deleted: the file refuses an update or a
// delete of one. An id is the highest its kind has given plus one, so none is given twice. Beside the records is one row:
// the store's revision, which every change moves on under compare-and-swap, and a small document of what may change,
// today which editions are retired. Today the records are garment editions; named people, outfits and populations are
// kinds whose revisions append under the ids they were given.
//
// Every world keeps the records it has read and reads only those appended since, in one snapshot. The manifest clients
// fetch is written to the media folder under its hash; a retired edition stays in it, since someone may wear it.
import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ID_MOST, HASH, printName, type Edition, type EditionDraft, type Made, type StoreKind } from "../../shared/people/doc.ts";
import { PrintThread, pngSize, type PrintInfo } from "./png.ts";

export interface PeopleOptions {
  /** people.sqlite, or ":memory:". */
  readonly db: string;
  /** Where prints and manifests are kept. Without one the store makes a temporary folder. */
  readonly media?: string;
  /** Where uploads are written as they are checked; on the same disk as `media`. */
  readonly tmp?: string;
  readonly now?: () => number;
}

/** The store as a world reads it. */
export interface PeopleView {
  readonly revision: number;
  /** Every edition published, retired ones too, in id order. */
  readonly editions: readonly Edition[];
  readonly byId: ReadonlyMap<number, Edition>;
  readonly made: ReadonlyMap<number, Made>;
  readonly retired: ReadonlySet<number>;
  /** The manifest's id, the first 16 hex digits of the SHA-256 of its JSON, or "" while there are no editions. */
  readonly manifestId: string;
}

/** A change refused: the status to answer and why, and for a stale revision the store as it is now. */
export interface Refusal {
  readonly status: number;
  readonly error: string;
  readonly view?: PeopleView;
}

/** Who a change is by: an actor's name and survivor ID ("" for none). */
export interface By {
  readonly name: string;
  readonly id: string;
}

/** What the one row's document holds: its layout, and the ids of each kind hidden from the admin's pick lists. */
interface StoreDoc {
  schema: number;
  retired: Partial<Record<StoreKind, number[]>>;
}

const SCHEMA = 1;
/** How long an old manifest is kept for a page that has not reloaded, and a part file a crash left. */
export const MANIFEST_KEEP_MS = 60 * 60 * 1000;
/** How often a world looks for another world's change, and sweeps. */
export const PEOPLE_CHECK_MS = 5000;
const SWEEP_MS = 60_000;

const STALE = "The editions changed in another page. Reload to see them.";
const sha16 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);

interface RecordRow {
  kind: string;
  id: number;
  rev: number;
  body: string;
  by: string;
  by_id: string;
  at: number;
}

const EMPTY: PeopleView = { revision: -1, editions: [], byId: new Map(), made: new Map(), retired: new Set(), manifestId: "" };

export class PeopleStore {
  private readonly path: string;
  private readonly now: () => number;
  private readonly opts: PeopleOptions;
  /** The temporary folder a store without a media folder makes when it first needs one, removed at its close. */
  private temp = "";
  private db: Database | null = null;
  private cached: PeopleView = EMPTY;
  /** Each edition's line of the manifest, in id order. */
  private readonly lines: string[] = [];
  private readonly thread = new PrintThread();
  private checked = -Infinity;
  private swept = -Infinity;
  private parts = 0;

  constructor(opts: PeopleOptions) {
    this.path = opts.db;
    this.now = opts.now ?? Date.now;
    this.opts = opts;
  }

  private tempDir(): string {
    return (this.temp ||= mkdtempSync(join(tmpdir(), "snark-people-")));
  }

  /** Where prints and manifests are kept. */
  get media(): string {
    return this.opts.media ?? join(this.tempDir(), "media");
  }

  /** Where uploads are written as they are checked. */
  get tmp(): string {
    return this.opts.tmp ?? (this.opts.media ? `${this.opts.media}.tmp` : join(this.tempDir(), "tmp"));
  }

  /** The manifest's id as last read, which a world sends its clients (OWN_PEOPLE). Reading it costs nothing. */
  get manifestId(): string {
    return this.cached.manifestId;
  }

  private open(): Database {
    if (this.db) return this.db;
    for (const dir of [this.media, this.tmp]) mkdirSync(dir, { recursive: true });
    const db = new Database(this.path, { create: true });
    try {
      // A reader never waits for another world's write in WAL, which a restyle in the tick may be.
      db.exec("PRAGMA busy_timeout=2500; PRAGMA journal_mode=WAL;");
      db.exec(
        "CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, doc TEXT NOT NULL);" +
          "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id INTEGER NOT NULL, rev INTEGER NOT NULL, body TEXT NOT NULL, by TEXT NOT NULL, by_id TEXT NOT NULL, at INTEGER NOT NULL, store INTEGER NOT NULL, PRIMARY KEY (kind, id, rev)) WITHOUT ROWID;" +
          "CREATE INDEX IF NOT EXISTS records_by_store ON records (store);" +
          "CREATE TRIGGER IF NOT EXISTS records_never_changed BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'a record is never changed'); END;" +
          "CREATE TRIGGER IF NOT EXISTS records_never_deleted BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'a record is never deleted'); END;",
      );
      db.query("INSERT OR IGNORE INTO store (id, revision, doc) VALUES (1, 0, ?)").run(JSON.stringify({ schema: SCHEMA, retired: {} } satisfies StoreDoc));
      const doc = JSON.parse((db.query("SELECT doc FROM store WHERE id=1").get() as { doc: string }).doc) as StoreDoc;
      if (doc.schema !== SCHEMA) throw new Error(`${this.path} is a people store of layout ${doc.schema}, and this build reads ${SCHEMA} only`);
    } catch (err) {
      db.close();
      throw err;
    }
    return (this.db = db);
  }

  /** The store now: one look at its revision, and the records appended since this world last read, if it moved. */
  view(): PeopleView {
    const db = this.open();
    const head = db.query("SELECT revision FROM store WHERE id=1").get() as { revision: number };
    if (head.revision === this.cached.revision) return this.cached;
    // One snapshot, so the row and the records appended under it agree whatever another world writes meanwhile.
    const { revision, doc, rows } = db.transaction(() => {
      const row = db.query("SELECT revision, doc FROM store WHERE id=1").get() as { revision: number; doc: string };
      const rows = db.query("SELECT kind, id, rev, body, by, by_id, at FROM records WHERE store > ? ORDER BY store, kind, id, rev").all(this.cached.revision) as RecordRow[];
      return { revision: row.revision, doc: JSON.parse(row.doc) as StoreDoc, rows };
    }).deferred();
    const was = this.cached, added: Edition[] = [], made = new Map(was.made);
    for (const r of rows) {
      if (r.kind !== "edition" || was.byId.has(r.id)) continue;
      const body = JSON.parse(r.body) as EditionDraft;
      const edition: Edition = { id: r.id, garment: body.garment, colours: body.colours, print: body.print, name: body.name };
      added.push(edition);
      made.set(r.id, { by: r.by, byId: r.by_id, at: r.at });
      this.lines.push(JSON.stringify(edition));
    }
    const editions = added.length > 0 ? [...was.editions, ...added] : was.editions;
    this.cached = {
      revision, editions, made,
      byId: added.length > 0 ? new Map(editions.map((e) => [e.id, e])) : was.byId,
      retired: new Set(doc.retired.edition ?? []),
      manifestId: added.length > 0 || was.manifestId === "" ? this.writeManifest() : was.manifestId,
    };
    return this.cached;
  }

  /** Writes the manifest as media/people.<id>.json unless it is there, and returns its id; "" for no editions. */
  private writeManifest(): string {
    if (this.lines.length === 0) return "";
    const json = `{"editions":[${this.lines.join(",")}]}`;
    const id = sha16(json), file = join(this.media, `people.${id}.json`);
    if (!existsSync(file)) {
      const part = join(this.tmp, `people.${id}.${process.pid}.json`);
      writeFileSync(part, json);
      renameSync(part, file);
    }
    return id;
  }

  /** The garment an edition is of, retired or not, or null for an edition the store does not hold. A held one costs a map lookup. */
  garmentOf(edition: number): string | null {
    const held = this.cached.byId.get(edition);
    if (held) return held.garment;
    try {
      return this.view().byId.get(edition)?.garment ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Appends a revision of a thing of `kind` if `expected` is still the store's revision: a new thing under the next id
   * where `id` is null, else the next revision of thing `id`. Answers the id, or null where the store moved on.
   */
  private append(kind: StoreKind, id: number | null, expected: number, body: unknown, by: By): number | null {
    const db = this.open();
    return db.transaction(() => {
      const row = db.query("SELECT revision FROM store WHERE id=1").get() as { revision: number };
      if (row.revision !== expected) return null;
      let at = id, rev = 1;
      if (at === null) {
        const top = db.query("SELECT MAX(id) AS id FROM records WHERE kind=?").get(kind) as { id: number | null };
        at = (top.id ?? 0) + 1;
        if (at > ID_MOST) throw new Error(`the people store has given every ${kind} id there is`);
      } else {
        const top = db.query("SELECT MAX(rev) AS rev FROM records WHERE kind=? AND id=?").get(kind, at) as { rev: number | null };
        if (top.rev === null) throw new Error(`the people store holds no ${kind} ${at}`);
        rev = top.rev + 1;
      }
      db.query("INSERT INTO records (kind, id, rev, body, by, by_id, at, store) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(kind, at, rev, JSON.stringify(body), by.name, by.id, this.now(), row.revision + 1);
      db.query("UPDATE store SET revision=? WHERE id=1").run(row.revision + 1);
      return at;
    }).immediate();
  }

  /** Runs a write, answering a file another world holds too long as a refusal to try again. */
  private written<T>(write: () => T): T | Refusal {
    try {
      return write();
    } catch (err) {
      if (err instanceof Error && /SQLITE_BUSY|database is locked/i.test(`${(err as { code?: string }).code ?? ""} ${err.message}`)) return { status: 503, error: "The people store is busy. Try again." };
      throw err;
    }
  }

  /**
   * Publishes a new edition if `expected` is still the store's revision, else refuses it with 409 and the store as it is.
   * A print must have been uploaded: its size is read from its file.
   */
  publish(expected: number, draft: EditionDraft, by: By): { id: number; view: PeopleView } | Refusal {
    let print = draft.print;
    if (print) {
      const size = this.printSize(print.hash);
      if (!size) return { status: 400, error: "Upload the print before publishing an edition of it." };
      print = { ...print, ...size };
    }
    const body: EditionDraft = { garment: draft.garment, colours: [...draft.colours] as [number, number, number], print, name: draft.name };
    const id = this.written(() => this.append("edition", null, expected, body, by));
    if (id !== null && typeof id === "object") return id;
    if (id === null) return { status: 409, error: STALE, view: this.view() };
    return { id, view: this.view() };
  }

  /**
   * Retires an edition, or brings it back, if `expected` is still the store's revision. It stays in the manifest and on
   * whoever wears it; only the admin's pick list leaves it out. `changed` is false where it already was so.
   */
  retire(expected: number, id: number, retired: boolean): { changed: boolean; view: PeopleView } | Refusal {
    const db = this.open();
    const done = this.written(() =>
      db.transaction((): boolean | Refusal => {
        const row = db.query("SELECT revision, doc FROM store WHERE id=1").get() as { revision: number; doc: string };
        if (row.revision !== expected) return { status: 409, error: STALE };
        if (!db.query("SELECT 1 FROM records WHERE kind='edition' AND id=?").get(id)) return { status: 404, error: `There is no edition ${id}.` };
        const doc = JSON.parse(row.doc) as StoreDoc, was = doc.retired.edition ?? [];
        if (was.includes(id) === retired) return false;
        doc.retired.edition = retired ? [...was, id].sort((a, b) => a - b) : was.filter((e) => e !== id);
        db.query("UPDATE store SET revision=?, doc=? WHERE id=1").run(row.revision + 1, JSON.stringify(doc));
        return true;
      }).immediate(),
    );
    if (typeof done === "object") return done.status === 409 ? { ...done, view: this.view() } : done;
    return { changed: done, view: this.view() };
  }

  /** A print's size in pixels from its file's header, or null where no print of that hash was uploaded. */
  printSize(hash: string): { width: number; height: number } | null {
    if (!HASH.test(hash)) return null;
    let fd = -1;
    try {
      fd = openSync(join(this.media, printName(hash)), "r");
      const head = new Uint8Array(24);
      return readSync(fd, head, 0, 24, 0) === 24 ? pngSize(head) : null;
    } catch {
      return null;
    } finally {
      if (fd >= 0) closeSync(fd);
    }
  }

  /** Checks an upload's bytes on the print's thread, which writes them to a part file of their own. The buffer is given over. */
  async check(bytes: ArrayBuffer): Promise<{ info: PrintInfo; part: string } | { error: string } | { fault: string }> {
    this.open();
    const part = join(this.tmp, `print-${process.pid}-${++this.parts}.part`);
    const got = await this.thread.check(bytes, part);
    if ("info" in got) return { info: got.info, part };
    rmSync(part, { force: true });
    return got;
  }

  /** Puts a checked part file in place under its hash. False where that print was there already, and the part goes. */
  place(part: string, hash: string): boolean {
    const file = join(this.media, printName(hash));
    if (existsSync(file)) {
      rmSync(part, { force: true });
      return false;
    }
    renameSync(part, file);
    return true;
  }

  /** Looks for another world's change at most every PEOPLE_CHECK_MS, and sweeps once a minute. Never throws. */
  poll(at = this.now()): void {
    if (at - this.checked < PEOPLE_CHECK_MS) return;
    this.checked = at;
    try {
      this.view();
      if (at - this.swept >= SWEEP_MS) {
        this.swept = at;
        this.sweep();
      }
    } catch (err) {
      console.log(`people: the store could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Removes manifests no world has sent for an hour, and part files a crash left. Each world touches its own manifest. */
  sweep(): void {
    const now = this.now(), current = `people.${this.view().manifestId}.json`;
    const stale = (file: string): boolean => now - statSync(file).mtimeMs >= MANIFEST_KEEP_MS;
    for (const [dir, pattern] of [[this.media, /^people\.[0-9a-f]{16}\.json$/], [this.tmp, /^print-\d+-\d+\.part$/]] as const) {
      for (const name of readdirSync(dir)) {
        if (!pattern.test(name)) continue;
        const file = join(dir, name);
        try {
          if (name === current) utimesSync(file, now / 1000, now / 1000);
          else if (stale(file)) rmSync(file, { force: true });
        } catch {
          // Another world swept it first.
        }
      }
    }
  }

  close(): void {
    this.thread.close();
    this.db?.close();
    this.db = null;
    if (this.temp) rmSync(this.temp, { recursive: true, force: true });
    this.temp = "";
  }
}
