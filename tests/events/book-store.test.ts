// The event book kept beside the save by the books' store (server/supply/store.ts): read leniently from its file, saved
// strictly, by compare and swap, and with what no module defines now kept as it was written.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type BookKind } from "../../server/supply/store.ts";
import { eventBookFaults, starterEventBook, type EventBook, type KindSheet } from "../../shared/mapevent/book.ts";
import { number } from "../../shared/mapevent/fields.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-event-book-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sheet: KindSheet = { id: "ufo", label: "UFO", about: "", module: "ufo", schedules: [], fields: { health: number(60000, { min: 1, max: 1e7, label: "health", help: "", group: "g" }) } };
const kind: BookKind = { label: "event book", faults: (b, mode) => eventBookFaults(b, new Map([["ufo", sheet]]), mode), bytes: 256 * 1024 };

test("a book whose value is out of bounds is read with a warning, and refused when saved so", () => {
  const path = join(dir, "lenient.events.json");
  const lines: string[] = [];
  const odd: EventBook = { ...starterEventBook([sheet]), revision: 4, tuning: { ufo: { health: 0 }, meteor: { size: 3 } } };
  writeFileSync(path, JSON.stringify(odd));
  const store = new Store<EventBook>(kind, path, "vegas", () => starterEventBook([sheet]), (l) => lines.push(l));
  expect([store.starter, store.book.revision, lines]).toEqual([false, 4, []]);
  // Saved as it is, the bad value is refused; mended, the book is saved and the kind no module defines is kept.
  const refused = store.save(store.book, 4, "test", "");
  expect(refused.ok ? [] : "faults" in refused ? refused.faults.map((f) => f.path) : []).toEqual(["tuning.ufo.health"]);
  const saved = store.save({ ...store.book, tuning: { ...store.book.tuning, ufo: { health: 9000 } } }, 4, "test", "mended");
  expect(saved).toEqual({ ok: true, revision: 5 });
  expect((JSON.parse(readFileSync(path, "utf8")) as EventBook).tuning).toEqual({ ufo: { health: 9000 }, meteor: { size: 3 } });
  // Another editor's revision is a conflict.
  expect(store.save(store.book, 4, "late", "")).toEqual({ ok: false, conflict: 5 });
});

test("a file that is no book leaves the starter in force and says so under the book's own name", () => {
  const path = join(dir, "broken.events.json");
  writeFileSync(path, JSON.stringify({ format: 99 }));
  const lines: string[] = [];
  const store = new Store<EventBook>(kind, path, "vegas", () => starterEventBook([sheet]), (l) => lines.push(l));
  expect(store.starter).toBe(true);
  expect(lines[0]).toStartWith("event book: ");
});
