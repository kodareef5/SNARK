// Where a world's drop book is kept (planning/workstreams/supply.md): a JSON file beside the save, so that it outlives a
// wipe and a rebuilt map (a save is bound to its map's bytes, and this is authored work), can be read, exported and
// compared as text, and is never the save's to lose. A save names the revision it changes and is refused if another
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

export interface BookRevision {
  readonly revision: number;
  /** Seconds since 1970, who saved it and what they said of it. */
  readonly at: number;
  readonly by: string;
  readonly note: string;
  readonly book: SupplyBook;
}

/**
 * `unkept` says why a saved book's history was not written: the book is saved and in force all the same. `failed`
 * says why a book was not written at all: nothing has changed.
 */
export type SaveResult = { ok: true; revision: number; unkept?: string } | { ok: false; conflict: number } | { ok: false; faults: BookFault[] } | { ok: false; failed: string };

export class BookStore {
  /** The book in force. */
  book: SupplyBook;
  /** Whether it is the starter, never saved for this world. */
  starter = true;
  private readonly path: string | null;
  private readonly make: () => SupplyBook;
  private readonly map: string;
  private readonly now: () => number;
  private readonly say: (line: string) => void;
  private history: BookRevision[] = [];

  /**
   * `path` is the book's file, or null for a world with no save, whose edits last until it stops. `starter` makes the
   * book a world begins with; `map` is the map the world runs.
   */
  constructor(path: string | null, map: string, starter: () => SupplyBook, say: (line: string) => void = () => {}, now: () => number = () => Math.floor(Date.now() / 1000)) {
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
      this.say(`drop book: ${this.path} is not whole JSON, so the starter book is in force and the file is left as it is`);
      return;
    }
    const faults = bookFaults(read).filter((f) => !f.warn);
    if (faults.length > 0) {
      this.say(`drop book: ${this.path} has ${faults.length} faults (${faults[0]!.path}: ${faults[0]!.message}), so the starter book is in force`);
      return;
    }
    const book = read as SupplyBook;
    if (book.map !== "" && book.map !== this.map) {
      this.say(`drop book: ${this.path} was written for the map ${book.map} and this world runs ${this.map}, so the starter book is in force`);
      return;
    }
    this.book = book;
    this.starter = false;
    try {
      const lines = existsSync(this.historyPath()) ? readFileSync(this.historyPath(), "utf8").split("\n").filter((l) => l !== "") : [];
      this.history = lines.slice(-HISTORY).map((l) => JSON.parse(l) as BookRevision);
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
    if (text === undefined || text.length > MOST.bytes) return { ok: false, faults: [{ path: "", message: `a book is at most ${MOST.bytes} bytes` }] };
    // A copy, so that nothing the caller keeps a hold of is the book in force.
    const book = JSON.parse(text) as SupplyBook;
    if (typeof book === "object" && book !== null) {
      book.revision = expected + 1;
      book.map = this.map;
    }
    const faults = bookFaults(book).filter((f) => !f.warn);
    if (faults.length > 0) return { ok: false, faults };
    const entry: BookRevision = { revision: book.revision, at: this.now(), by, note: note.slice(0, 200), book };
    const history = [...this.history, entry].slice(-HISTORY);
    let unkept = "";
    if (this.path !== null) {
      try {
        put(this.path, `${JSON.stringify(book, null, 1)}\n`);
      } catch (err) {
        // Not saved: the file is the old book's, the world's is too, and the editor is told.
        this.say(`drop book: revision ${book.revision} could not be written to ${this.path} (${why(err)}), so revision ${this.book.revision} is still in force`);
        return { ok: false, failed: `the book's file could not be written (${why(err)}): nothing is changed` };
      }
      // Saved. The history is the last fifty, each whole, so it is written whole again; what it lacks of this one is
      // kept while the server runs and written with the next save that can be.
      try {
        put(this.historyPath(), history.map((h) => JSON.stringify(h)).join("\n") + "\n");
      } catch (err) {
        unkept = `its history could not be written (${why(err)})`;
        this.say(`drop book: revision ${book.revision} is saved, but ${unkept}: it is kept while the server runs`);
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
  revisions(): readonly BookRevision[] {
    return this.history;
  }
}
