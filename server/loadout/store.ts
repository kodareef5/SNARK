// Where a world's loadout book is kept: a JSON file beside the save, so it outlives a wipe and reads as text.
// A save names the revision it changes and is refused if another came first. One process owns a world and answers its
// admin page on the tick's thread, so compare and swap need no lock. A save is made at the rename of the file.

import { existsSync, readFileSync } from "node:fs";
import type { Registry } from "../../shared/content/registry.ts";
import { MOST, loadoutFaults, type Loadout, type LoadoutBook, type LoadoutFault } from "../../shared/loadout/book.ts";
import { put, why } from "../doc-file.ts";

/** `failed` says why a book was not written at all: nothing has changed. */
export type LoadoutSave = { ok: true; revision: number } | { ok: false; conflict: number } | { ok: false; faults: LoadoutFault[] } | { ok: false; failed: string };

export class LoadoutStore {
  /** The book in force. */
  book: LoadoutBook;
  /** Whether it is the built-in book, never saved for this world. */
  builtin = true;
  private readonly path: string | null;
  private readonly make: () => LoadoutBook;
  private readonly reg: Registry | undefined;
  private readonly say: (line: string) => void;

  /** `path` is the book's file, or null for a world with no save, whose edits last until it stops. */
  constructor(path: string | null, builtin: () => LoadoutBook, reg: Registry | undefined, say: (line: string) => void = () => {}) {
    this.path = path;
    this.make = builtin;
    this.reg = reg;
    this.say = say;
    this.book = builtin();
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
      this.say(`loadouts: ${this.path} is not whole JSON, so the built-in loadouts are in force and the file is left as it is`);
      return;
    }
    const faults = loadoutFaults(read, this.reg).filter((f) => !f.warn);
    if (faults.length > 0) {
      this.say(`loadouts: ${this.path} has ${faults.length} faults (${faults[0]!.path}: ${faults[0]!.message}), so the built-in loadouts are in force and the file is left as it is`);
      return;
    }
    this.book = read as LoadoutBook;
    this.builtin = false;
  }

  /**
   * Saves `next` as the revision after `expected`, which must be the book's now: another editor's save in between is a
   * conflict and changes nothing. The book's own `revision` is set here, whatever it came with.
   */
  save(next: unknown, expected: number, by: string, note: string): LoadoutSave {
    if (expected !== this.book.revision) return { ok: false, conflict: this.book.revision };
    const text = JSON.stringify(next);
    if (text === undefined || text.length > MOST.bytes) return { ok: false, faults: [{ path: "", message: `a book is at most ${MOST.bytes} bytes` }] };
    // A copy, so that nothing the caller keeps a hold of is the book in force.
    const book = JSON.parse(text) as LoadoutBook;
    if (typeof book === "object" && book !== null) book.revision = expected + 1;
    const faults = loadoutFaults(book, this.reg).filter((f) => !f.warn);
    if (faults.length > 0) return { ok: false, faults };
    if (this.path !== null) {
      try {
        put(this.path, `${JSON.stringify(book, null, 1)}\n`);
      } catch (err) {
        this.say(`loadouts: revision ${book.revision} could not be written to ${this.path} (${why(err)}), so revision ${this.book.revision} is still in force`);
        return { ok: false, failed: `the book's file could not be written (${why(err)}): nothing is changed` };
      }
    }
    this.book = book;
    this.builtin = false;
    this.say(`loadouts: revision ${book.revision} saved by ${by}${note === "" ? "" : ` (${note.slice(0, 200)})`}`);
    return { ok: true, revision: book.revision };
  }

  /** The built-in book again, as the next revision. */
  reset(by: string): LoadoutSave {
    return this.save({ ...this.make(), revision: this.book.revision }, this.book.revision, by, "the built-in loadouts again");
  }

  /** What the book in force names that the game lacks or cannot do as written. */
  warnings(): LoadoutFault[] {
    return loadoutFaults(this.book, this.reg).filter((f) => f.warn === true);
  }

  find(id: string): Loadout | undefined {
    return this.book.loadouts.find((l) => l.id === id);
  }

  /** The loadout a new survivor of the role is given. */
  assigned(admin: boolean): Loadout | undefined {
    return this.find(admin ? this.book.assign.admin : this.book.assign.player);
  }
}
