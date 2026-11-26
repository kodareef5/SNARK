// Where a world's drop book is kept (planning/workstreams/supply.md), and its event book the same way (map-events.md): a
// JSON file beside the save, so that it outlives a wipe and a rebuilt map (a save is bound to its map's bytes, and this
// is authored work), can be read, exported and compared as text, and is never the save's to lose. A save names the revision it changes and is refused if another
// came first. One process owns a world and answers its admin page on the tick's thread, so compare and swap need no
// lock. Each revision is also appended to a history beside the book, the last of them kept.
//
// A save is made at one moment, the rename of the book's file. Before it nothing has changed, in the file or in the
// world, and whatever fails is answered as a save that was not made. From it on the book is saved, in force and
// answered so, all three alike; its history is written after, and if that cannot be, the save stands and says so.

import { existsSync, readFileSync } from "node:fs";
import { MOST, bookFaults, type BookFault, type SupplyBook } from "../../shared/supply/book.ts";
import { put, why } from "../doc-file.ts";

/** Revisions kept in the history file. */
const HISTORY = 50;

export type { BookFault };

/** What a kept book has whatever it is a book of: the revision it is, and the map it was written for ("" for any). */
export interface Kept {
  revision: number;
  map: string;
}

/**
 * What a kind of book is: what it is called in a line to the operator, how it is checked, and how big it may be. A book
 * is checked as it is read from its file ("load") and as an editor saves it ("save"); only faults that are not warnings
 * refuse it.
 */
export interface BookKind {
  readonly label: string;
  readonly faults: (book: unknown, mode: "load" | "save") => BookFault[];
  readonly bytes: number;
}

export interface BookRevision<T extends Kept = SupplyBook> {
  readonly revision: number;
  /** Seconds since 1970, who saved it and what they said of it. */
  readonly at: number;
  readonly by: string;
  readonly note: string;
  readonly book: T;
}

/**
 * `unkept` says why a saved book's history was not written: the book is saved and in force all the same. `failed`
 * says why a book was not written at all: nothing has changed.
 */
export type SaveResult = { ok: true; revision: number; unkept?: string } | { ok: false; conflict: number } | { ok: false; faults: BookFault[] } | { ok: false; failed: string };

export class Store<T extends Kept> {
  /** The book in force. */
  book: T;
  /** Whether it is the starter, never saved for this world. */
  starter = true;
  private readonly path: string | null;
  private readonly make: () => T;
  private readonly kind: BookKind;
  private readonly map: string;
  private readonly now: () => number;
  private readonly say: (line: string) => void;
  private history: BookRevision<T>[] = [];

  /**
   * `path` is the book's file, or null for a world with no save, whose edits last until it stops. `starter` makes the
   * book a world begins with; `map` is the map the world runs.
   */
  constructor(kind: BookKind, path: string | null, map: string, starter: () => T, say: (line: string) => void = () => {}, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.kind = kind;
    this.path = path;
    this.map = map;
    this.make = starter;
    this.now = now;
    this.say = say;
    this.book = starter();
    this.load();
  }

  /** Whether edits outlive the process. */
  get kept(): boolean {
    return this.path !== null;
  }

  private load(): void {
    if (this.path === null || !existsSync(this.path)) return;
    let read: unknown;
    try {
      read = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      this.say(`${this.kind.label}: ${this.path} is not whole JSON, so the starter book is in force and the file is left as it is`);
      return;
    }
    const faults = this.kind.faults(read, "load").filter((f) => !f.warn);
    if (faults.length > 0) {
      this.say(`${this.kind.label}: ${this.path} has ${faults.length} faults (${faults[0]!.path}: ${faults[0]!.message}), so the starter book is in force`);
      return;
    }
    const book = read as T;
    if (book.map !== "" && book.map !== this.map) {
      this.say(`${this.kind.label}: ${this.path} was written for the map ${book.map} and this world runs ${this.map}, so the starter book is in force`);
      return;
    }
    this.book = book;
    this.starter = false;
    try {
      const lines = existsSync(this.historyPath()) ? readFileSync(this.historyPath(), "utf8").split("\n").filter((l) => l !== "") : [];
      this.history = lines.slice(-HISTORY).map((l) => JSON.parse(l) as BookRevision<T>);
    } catch {
      this.history = [];
    }
  }

  private historyPath(): string {
    return `${this.path}.history`;
  }

  /**
   * Saves `next` as the revision after `expected`, which must be the book's now: another editor's save in between is a
   * conflict and changes nothing. The book's own `revision` and `map` are set here, whatever it came with.
   */
  save(next: unknown, expected: number, by: string, note: string): SaveResult {
    if (expected !== this.book.revision) return { ok: false, conflict: this.book.revision };
    const text = JSON.stringify(next);
    if (text === undefined || text.length > this.kind.bytes) return { ok: false, faults: [{ path: "", message: `a book is at most ${this.kind.bytes} bytes` }] };
    // A copy, so that nothing the caller keeps a hold of is the book in force.
    const book = JSON.parse(text) as T;
    if (typeof book === "object" && book !== null) {
      book.revision = expected + 1;
      book.map = this.map;
    }
    const faults = this.kind.faults(book, "save").filter((f) => !f.warn);
    if (faults.length > 0) return { ok: false, faults };
    const entry: BookRevision<T> = { revision: book.revision, at: this.now(), by, note: note.slice(0, 200), book };
    const history = [...this.history, entry].slice(-HISTORY);
    let unkept = "";
    if (this.path !== null) {
      try {
        put(this.path, `${JSON.stringify(book, null, 1)}\n`);
      } catch (err) {
        // Not saved: the file is the old book's, the world's is too, and the editor is told.
        this.say(`${this.kind.label}: revision ${book.revision} could not be written to ${this.path} (${why(err)}), so revision ${this.book.revision} is still in force`);
        return { ok: false, failed: `the book's file could not be written (${why(err)}): nothing is changed` };
      }
      // Saved. The history is the last fifty, each whole, so it is written whole again; what it lacks of this one is
      // kept while the server runs and written with the next save that can be.
      try {
        put(this.historyPath(), history.map((h) => JSON.stringify(h)).join("\n") + "\n");
      } catch (err) {
        unkept = `its history could not be written (${why(err)})`;
        this.say(`${this.kind.label}: revision ${book.revision} is saved, but ${unkept}: it is kept while the server runs`);
      }
    }
    this.history = history;
    this.book = book;
    this.starter = false;
    return unkept === "" ? { ok: true, revision: book.revision } : { ok: true, revision: book.revision, unkept };
  }

  /** The starter book again, as the next revision. */
  reset(by: string): SaveResult {
    return this.save({ ...this.make(), revision: this.book.revision }, this.book.revision, by, "the starter book again");
  }

  /** Revisions saved, oldest first, each whole. */
  revisions(): readonly BookRevision<T>[] {
    return this.history;
  }
}

const DROPS: BookKind = { label: "drop book", faults: (book) => bookFaults(book), bytes: MOST.bytes };

/** The drop book's store. */
export class BookStore extends Store<SupplyBook> {
  constructor(path: string | null, map: string, starter: () => SupplyBook, say: (line: string) => void = () => {}, now: () => number = () => Math.floor(Date.now() / 1000)) {
    super(DROPS, path, map, starter, say, now);
  }
}
