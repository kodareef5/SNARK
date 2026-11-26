// The cluster's people store: people.sqlite beside its worlds, shared by them all. It holds records of things of each kind
// (shared/people/doc.ts). An id is the highest its kind has given plus one, so none is given twice. Beside the records is
// one row: the store's revision, which every change moves on, and a small document of which things of each kind are
// retired. A garment edition is one record, never changed. An admin population takes a new record at each save, as a
// body on the wire names its revision; the file refuses to change or delete either. A named person and an outfit are one
// record each, saved over with its revision moved on. A save names the revision it was made from and is refused if
// another came since, so of two pages saving one thing, one is told to reload.
//
// Every world keeps the records it has read and reads only those written since, in one snapshot. The manifest clients
// fetch is written to the media folder under its hash. It holds every edition and every revision of every admin
// population, retired ones too, since a body may wear or be drawn from one; named people and outfits are not in it.
import { Database } from "bun:sqlite";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ID_MOST, HASH, STORE_KINDS, printName, readOutfit, readPerson, readPopulation, storePopulation, type Bodies, type Edition, type EditionDraft, type Made, type PopulationDoc, type Revision, type RevisedKind,
  type StoreKind,
} from "../../shared/people/doc.ts";
import type { PopulationDef } from "../../shared/content/kinds/populations.ts";
import type { StorePopulations } from "../../shared/people/person.ts";
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
  /** The retired editions. */
  readonly retired: ReadonlySet<number>;
  /** The retired things of each kind. */
  readonly retiredOf: { readonly [K in StoreKind]: ReadonlySet<number> };
  /** Every named person, outfit and admin population at its latest revision, by id. */
  readonly records: { readonly [K in RevisedKind]: ReadonlyMap<number, Revision<Bodies[K]>> };
  /** The manifest's id, the first 16 hex digits of the SHA-256 of its JSON, or "" while it would be empty. */
  readonly manifestId: string;
}

/** A save answered: the thing's id and revision, and false for `changed` where it was already so. */
export interface Saved {
  readonly id: number;
  readonly rev: number;
  readonly changed: boolean;
  readonly view: PeopleView;
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

/**
 * What the one row's document holds: the ids of each kind hidden from the admin's pick lists, and the store revision each
 * kind last changed at (an edition published or retired, anything else retired), 0 for never.
 */
interface StoreDoc {
  retired: Partial<Record<StoreKind, number[]>>;
  moved: Partial<Record<StoreKind, number>>;
}

/** Whether a page that showed store revision `expected` missed a change of `kind`: one after it, or a revision to come. */
const movedSince = (doc: StoreDoc, kind: StoreKind, expected: number, revision: number): boolean => expected > revision || (doc.moved[kind] ?? 0) > expected;

/** How long an old manifest is kept for a page that has not reloaded, and a part file a crash left. */
export const MANIFEST_KEEP_MS = 60 * 60 * 1000;
/** How often a world looks for another world's change, and sweeps. */
export const PEOPLE_CHECK_MS = 5000;
const SWEEP_MS = 60_000;
/** How long an uploaded print no edition names is kept for its page to publish it. Chosen. */
export const PRINT_KEEP_MS = 24 * 60 * 60 * 1000;
/** How long a write waits for another world's: a few ticks of the thread it shares at most, then the page tries again. */
const WRITE_WAIT_MS = 20;
/** How long opening a new file waits for another world making it. Only a store's first open, at a world's start, waits. */
const OPEN_WAIT_MS = 2500;

const STALE = "The editions changed in another page. Reload to see them.";
const STALE_RETIRED = (kind: string): string => `Another page retired or brought back a ${kind}. Reload to see it.`;
const STALE_THING = (kind: string, id: number): string => `The ${kind} ${id} was saved in another page. Reload to see it.`;
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

/** Part files are numbered across every store of the process and carry random letters, so neither another store nor
 * another process with the same id (two containers are both pid 1) on one folder takes the same name. */
let partsMade = 0;
const partName = (): string => `${process.pid}-${++partsMade}-${crypto.randomUUID().slice(0, 8)}`;
const TMP_PARTS = [/^print-[0-9a-f-]+\.part$/, /^people\.[0-9a-f]{16}\.[0-9a-f-]+\.json$/];
const PRINT_FILE = /^print\.([0-9a-f]{16})\.png$/;

const noneRetired = (): PeopleView["retiredOf"] => Object.fromEntries(STORE_KINDS.map((k) => [k, new Set<number>()])) as unknown as PeopleView["retiredOf"];
const EMPTY: PeopleView = {
  revision: -1, editions: [], byId: new Map(), made: new Map(), retired: new Set(), retiredOf: noneRetired(),
  records: { person: new Map(), outfit: new Map(), population: new Map() }, manifestId: "",
};

export class PeopleStore implements StorePopulations {
  private readonly path: string;
  private readonly now: () => number;
  private readonly opts: PeopleOptions;
  /** The temporary folder a store without a media folder makes when it first needs one, removed at its close. */
  private temp = "";
  private db: Database | null = null;
  private cached: PeopleView = EMPTY;
  /** Each edition's line of the manifest, in id order: one for each edition in `cached`, added with it. */
  private readonly lines: string[] = [];
  /** Each admin population revision's line, in the order the store took them, and each as the generator takes it. */
  private readonly populationLines: string[] = [];
  private readonly populationDefs = new Map<number, PopulationDef[]>();
  /** The editions' manifest has not been written since its last change: the next look tries again. */
  private manifestOwed = false;
  /** The part files this store's checks wrote, which alone it puts in place. */
  private readonly ours = new Set<string>();
  private readonly thread = new PrintThread();
  private checked = -Infinity;
  private swept = -Infinity;
  private readonly said = new Set<string>();

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

  /** Says a fault once for each kind of it, not every look. */
  private sayOnce(what: string, line: string): void {
    if (this.said.has(what)) return;
    this.said.add(what);
    console.log(`people: ${line}`);
  }

  /** The media and part folders, made again where something removed them. */
  private folders(): void {
    for (const dir of [this.media, this.tmp]) mkdirSync(dir, { recursive: true });
  }

  private open(): Database {
    if (this.db) return this.db;
    this.folders();
    const db = new Database(this.path, { create: true });
    try {
      db.exec(`PRAGMA busy_timeout=${OPEN_WAIT_MS};`);
      // A reader never waits for another world's write in WAL, which a restyle in the tick may be. A file that cannot
      // take it (a disk without shared memory) keeps the default journal: reads may then wait for a write's commit.
      const mode = (db.query("PRAGMA journal_mode=WAL").get() as { journal_mode: string } | null)?.journal_mode;
      if (mode !== "wal" && this.path !== ":memory:") this.sayOnce("wal", `${this.path} keeps the ${mode ?? "default"} journal, not WAL: a world's reads may wait on another's writes`);
      db.exec(
        "CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, doc TEXT NOT NULL);" +
          "CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id INTEGER NOT NULL, rev INTEGER NOT NULL, body TEXT NOT NULL, by TEXT NOT NULL, by_id TEXT NOT NULL, at INTEGER NOT NULL, store INTEGER NOT NULL, PRIMARY KEY (kind, id, rev)) WITHOUT ROWID;" +
          "CREATE INDEX IF NOT EXISTS records_by_store ON records (store);" +
          "CREATE TRIGGER IF NOT EXISTS records_never_changed BEFORE UPDATE ON records WHEN OLD.kind IN ('edition', 'population') BEGIN SELECT RAISE(ABORT, 'a record is never changed'); END;" +
          "CREATE TRIGGER IF NOT EXISTS records_never_deleted BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT, 'a record is never deleted'); END;",
      );
      db.query("INSERT OR IGNORE INTO store (id, revision, doc) VALUES (1, 0, ?)").run(JSON.stringify({ retired: {}, moved: {} } satisfies StoreDoc));
      db.exec(`PRAGMA busy_timeout=${WRITE_WAIT_MS};`);
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
    if (head.revision === this.cached.revision) return this.manifestOwed ? this.writeOwed() : this.cached;
    // One snapshot, so the row and the records appended under it agree whatever another world writes meanwhile.
    const { revision, doc, rows } = db.transaction(() => {
      const row = db.query("SELECT revision, doc FROM store WHERE id=1").get() as { revision: number; doc: string };
      const rows = db.query("SELECT kind, id, rev, body, by, by_id, at FROM records WHERE store > ? ORDER BY store").all(this.cached.revision) as RecordRow[];
      return { revision: row.revision, doc: JSON.parse(row.doc) as StoreDoc, rows };
    }).deferred();
    const was = this.cached, added: Edition[] = [], made = new Map(was.made);
    const records = { person: new Map(was.records.person), outfit: new Map(was.records.outfit), population: new Map(was.records.population) };
    const addedPopulations: Revision<PopulationDoc>[] = [];
    for (const r of rows) {
      if (r.kind === "edition") {
        if (was.byId.has(r.id)) continue;
        const body = JSON.parse(r.body) as EditionDraft;
        const edition: Edition = { id: r.id, garment: body.garment, colours: body.colours, print: body.print, name: body.name };
        added.push(edition);
        made.set(r.id, { by: r.by, byId: r.by_id, at: r.at });
        continue;
      }
      const kind = r.kind as RevisedKind;
      if ((records[kind].get(r.id)?.rev ?? 0) >= r.rev) continue;
      const one: Revision<Bodies[RevisedKind]> = { id: r.id, rev: r.rev, body: JSON.parse(r.body) as Bodies[RevisedKind], made: { by: r.by, byId: r.by_id, at: r.at } };
      (records[kind] as Map<number, Revision<Bodies[RevisedKind]>>).set(r.id, one);
      if (kind === "population") addedPopulations.push(one as Revision<PopulationDoc>);
    }
    const editions = added.length > 0 ? [...was.editions, ...added] : was.editions;
    // The records are held first, each with its manifest line, so a manifest that fails to be written loses none of them.
    for (const e of added) this.lines.push(JSON.stringify(e));
    for (const p of addedPopulations) {
      this.populationLines.push(JSON.stringify({ id: p.id, rev: p.rev, population: p.body }));
      const defs = this.populationDefs.get(p.id) ?? [];
      defs[p.rev - 1] = storePopulation(p.id, p.body);
      this.populationDefs.set(p.id, defs);
    }
    const retiredOf = Object.fromEntries(STORE_KINDS.map((k) => [k, new Set(doc.retired[k] ?? [])])) as unknown as PeopleView["retiredOf"];
    this.cached = {
      revision, editions, made,
      byId: added.length > 0 ? new Map(editions.map((e) => [e.id, e])) : was.byId,
      retired: retiredOf.edition,
      retiredOf,
      records,
      manifestId: was.manifestId,
    };
    if (added.length > 0 || addedPopulations.length > 0) this.manifestOwed = true;
    return this.manifestOwed ? this.writeOwed() : this.cached;
  }

  /** The store as this world last read it, without a look at the file but the first; poll() and every change read it again. Never throws. */
  held(): PeopleView {
    if (this.cached.revision >= 0) return this.cached;
    try {
      return this.view();
    } catch {
      return this.cached;
    }
  }

  /** Writes the manifest that is owed, and holds its id; where it cannot be written, the clients keep the last one. */
  private writeOwed(): PeopleView {
    try {
      this.cached = { ...this.cached, manifestId: this.writeManifest() };
      this.manifestOwed = false;
    } catch (err) {
      this.sayOnce("manifest", `the editions' manifest could not be written, and is tried again at each look: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.cached;
  }

  /** Writes the manifest as media/people.<id>.json unless it is there, and returns its id; "" while it would be empty. */
  private writeManifest(): string {
    if (this.lines.length === 0 && this.populationLines.length === 0) return "";
    const json = `{"editions":[${this.lines.join(",")}],"populations":[${this.populationLines.join(",")}]}`;
    const id = sha16(json), file = join(this.media, `people.${id}.json`);
    if (!existsSync(file)) {
      this.folders();
      const part = join(this.tmp, `people.${id}.${partName()}.json`);
      try {
        writeFileSync(part, json);
        renameSync(part, file);
      } finally {
        rmSync(part, { force: true });
      }
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
   * Appends a thing of `kind` under the next id if nothing of its kind changed after store revision `expected`. Answers
   * the id, or null where something did.
   */
  private append(kind: StoreKind, expected: number, body: unknown, by: By): number | null {
    const db = this.open();
    return db.transaction(() => {
      const row = db.query("SELECT revision, doc FROM store WHERE id=1").get() as { revision: number; doc: string };
      const doc = JSON.parse(row.doc) as StoreDoc;
      if (movedSince(doc, kind, expected, row.revision)) return null;
      const id = this.insert(db, kind, null, 0, JSON.stringify(body), by, row.revision);
      doc.moved = { ...doc.moved, [kind]: row.revision + 1 };
      db.query("UPDATE store SET doc=? WHERE id=1").run(JSON.stringify(doc));
      return id;
    }).immediate();
  }

  /**
   * Writes revision `rev + 1` of thing `id` (a new thing under the next id where null) and moves the store on. A named
   * person or an outfit is written over its record; anything else is a record of its own.
   */
  private insert(db: Database, kind: StoreKind, id: number | null, rev: number, body: string, by: By, revision: number): number {
    let at = id;
    if (at === null) {
      const top = db.query("SELECT MAX(id) AS id FROM records WHERE kind=?").get(kind) as { id: number | null };
      at = (top.id ?? 0) + 1;
      if (at > ID_MOST) throw new Error(`the people store has given every ${kind} id there is`);
    }
    if (rev > 0 && (kind === "person" || kind === "outfit")) {
      db.query("UPDATE records SET rev=?, body=?, by=?, by_id=?, at=?, store=? WHERE kind=? AND id=?").run(rev + 1, body, by.name, by.id, this.now(), revision + 1, kind, at);
    } else db.query("INSERT INTO records (kind, id, rev, body, by, by_id, at, store) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(kind, at, rev + 1, body, by.name, by.id, this.now(), revision + 1);
    db.query("UPDATE store SET revision=? WHERE id=1").run(revision + 1);
    return at;
  }

  /**
   * Saves a named person, an outfit or an admin population: a new one under the next id where `id` is null, else the
   * revision after `expected`, which must be the thing's own. The body is kept as its kind's check reads it, so every
   * reader of the manifest takes what the world does; a body the same as the latest is no change. A stale revision is
   * refused with 409 and the store as it is; nothing is changed or lost.
   */
  save<K extends RevisedKind>(kind: K, id: number | null, expected: number, body: Bodies[K], by: By): Saved | Refusal {
    const sent = body as unknown as Record<string, unknown>;
    const read = kind === "person" ? readPerson(sent) : kind === "outfit" ? readOutfit(sent) : readPopulation(sent);
    if (typeof read === "string") return { status: 400, error: read };
    const db = this.open(), text = JSON.stringify(read);
    const done = this.written(() =>
      db.transaction((): { id: number; rev: number; changed: boolean } | Refusal => {
        const row = db.query("SELECT revision FROM store WHERE id=1").get() as { revision: number };
        if (id === null) {
          if (expected !== 0) return { status: 400, error: `A new ${kind} is saved from revision 0.` };
          return { id: this.insert(db, kind, null, 0, text, by, row.revision), rev: 1, changed: true };
        }
        const top = db.query("SELECT rev, body FROM records WHERE kind=? AND id=? ORDER BY rev DESC LIMIT 1").get(kind, id) as { rev: number; body: string } | null;
        if (!top) return { status: 404, error: `There is no ${kind} ${id}.` };
        if (top.rev !== expected) return { status: 409, error: STALE_THING(kind, id) };
        if (top.body === text) return { id, rev: top.rev, changed: false };
        this.insert(db, kind, id, top.rev, text, by, row.revision);
        return { id, rev: top.rev + 1, changed: true };
      }).immediate(),
    );
    if ("status" in done) return done.status === 409 ? { ...done, view: this.view() } : done;
    return { ...done, view: this.view() };
  }

  /** Revision `rev` of admin population `id` as the person generator takes it, retired or not; a held one costs a lookup. */
  population(id: number, rev: number): PopulationDef | undefined {
    const held = this.populationDefs.get(id)?.[rev - 1];
    if (held) return held;
    try {
      this.view();
    } catch {
      return undefined;
    }
    return this.populationDefs.get(id)?.[rev - 1];
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
      // Named now, so a sweep of prints no edition names leaves it be while this is published.
      try {
        utimesSync(join(this.media, printName(print.hash)), new Date(), new Date());
      } catch {
        // Swept between the two looks: the next look finds no size.
      }
      print = { ...print, ...size };
    }
    const body: EditionDraft = { garment: draft.garment, colours: [...draft.colours] as [number, number, number], print, name: draft.name };
    const id = this.written(() => this.append("edition", expected, body, by));
    if (id !== null && typeof id === "object") return id;
    if (id === null) return { status: 409, error: STALE, view: this.view() };
    return { id, view: this.view() };
  }

  /**
   * Retires a thing of `kind`, or brings it back, if nothing of its kind changed after store revision `expected`: a
   * publish or a retirement of an edition, a retirement of anything else. It stays in the manifest and on whoever wears
   * or is drawn from it; only the admin's pick lists leave it out. `changed` is false where it already was so.
   */
  retire(expected: number, id: number, retired: boolean, kind: StoreKind = "edition"): { changed: boolean; view: PeopleView } | Refusal {
    const db = this.open();
    const done = this.written(() =>
      db.transaction((): boolean | Refusal => {
        const row = db.query("SELECT revision, doc FROM store WHERE id=1").get() as { revision: number; doc: string };
        const doc = JSON.parse(row.doc) as StoreDoc;
        if (movedSince(doc, kind, expected, row.revision)) return { status: 409, error: kind === "edition" ? STALE : STALE_RETIRED(kind) };
        if (!db.query("SELECT 1 FROM records WHERE kind=? AND id=?").get(kind, id)) return { status: 404, error: `There is no ${kind} ${id}.` };
        const was = doc.retired[kind] ?? [];
        if (was.includes(id) === retired) return false;
        doc.retired[kind] = retired ? [...was, id].sort((a, b) => a - b) : was.filter((e) => e !== id);
        doc.moved = { ...doc.moved, [kind]: row.revision + 1 };
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
    this.folders();
    const part = join(this.tmp, `print-${partName()}.part`);
    const got = await this.thread.check(bytes, part);
    if ("info" in got) {
      this.ours.add(part);
      return { info: got.info, part };
    }
    rmSync(part, { force: true });
    return got;
  }

  /**
   * Puts a part file this store's check wrote in place under its hash. False where that print was there already, and the
   * part goes. A part it did not write is refused.
   */
  place(part: string, hash: string): boolean {
    if (!this.ours.delete(part)) throw new Error(`${part} is not a print this store checked`);
    const file = join(this.media, printName(hash));
    if (existsSync(file)) {
      rmSync(part, { force: true });
      // Uploaded again: it is kept another day for its page to publish.
      utimesSync(file, new Date(), new Date());
      return false;
    }
    this.folders();
    renameSync(part, file);
    return true;
  }

  /** Lets go of a checked part file that is not to be placed. */
  drop(part: string): void {
    this.ours.delete(part);
    rmSync(part, { force: true });
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

  /**
   * Removes manifests no world has sent for an hour, part files a crash left, and uploaded prints no edition names after a
   * day. Each world touches its own manifest.
   */
  sweep(): void {
    const view = this.view(), now = this.now(), current = `people.${view.manifestId}.json`;
    this.folders();
    const age = (file: string): number => now - statSync(file).mtimeMs;
    const named = new Set(view.editions.flatMap((e) => (e.print ? [e.print.hash] : [])));
    const each = (dir: string, fn: (name: string, file: string) => void): void => {
      for (const name of readdirSync(dir)) {
        try {
          fn(name, join(dir, name));
        } catch {
          // Another world swept it first.
        }
      }
    };
    each(this.tmp, (name, file) => {
      if (TMP_PARTS.some((p) => p.test(name)) && !this.ours.has(file) && age(file) >= MANIFEST_KEEP_MS) rmSync(file, { force: true });
    });
    const unnamed: string[] = [];
    each(this.media, (name, file) => {
      if (name === current) utimesSync(file, now / 1000, now / 1000);
      else if (/^people\.[0-9a-f]{16}\.json$/.test(name) && age(file) >= MANIFEST_KEEP_MS) rmSync(file, { force: true });
      const print = PRINT_FILE.exec(name)?.[1];
      if (print && !named.has(print) && age(file) >= PRINT_KEEP_MS) unnamed.push(name);
    });
    if (unnamed.length === 0) return;
    // Looked at again just before: an edition another world published meanwhile keeps its print.
    const still = new Set(this.view().editions.flatMap((e) => (e.print ? [e.print.hash] : [])));
    for (const name of unnamed) if (!still.has(PRINT_FILE.exec(name)![1]!)) rmSync(join(this.media, name), { force: true });
  }

  close(): void {
    this.thread.close();
    this.db?.close();
    this.db = null;
    if (this.temp) rmSync(this.temp, { recursive: true, force: true });
    this.temp = "";
  }
}
