// Faults found in review of the people store (server/people/store.ts, admin/people-routes.ts): each test fails today.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashOf } from "../../server/people/png.ts";
import { PeopleStore, type By } from "../../server/people/store.ts";
import { printName, type EditionDraft, type PeopleManifest } from "../../shared/people/doc.ts";
import { encodePng } from "../../tools/snap/png.ts";

const scratch = join(import.meta.dir, "../../var");
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, "people-review-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;
const folder = (): string => join(root, `cluster${++made}`);
const open = (dir: string): PeopleStore => new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp") });
const ADA: By = { name: "ada", id: "S-ADA" };
const tee = (name: string): EditionDraft => ({ garment: "core:plain_tee", colours: [12, 40, 3], print: null, name });

test("a manifest write that fails once leaves no edition twice in the manifest", () => {
  const dir = folder();
  const store = open(dir);
  try {
    expect(store.publish(store.view().revision, tee("one"), ADA)).toMatchObject({ id: 1 });
    // The part file's folder goes: it is made again, and the edition and its manifest are written.
    rmSync(join(dir, "tmp"), { recursive: true, force: true });
    expect(store.publish(store.view().revision, tee("two"), ADA)).toMatchObject({ id: 2 });
    // A file stands where the folder was, so the manifest cannot be written: the publish that committed still answers
    // its id, the edition resolves, and the clients keep the last manifest until a later look writes the new one.
    rmSync(join(dir, "tmp"), { recursive: true, force: true });
    writeFileSync(join(dir, "tmp"), "in the way");
    const last = store.view().manifestId;
    expect(store.publish(store.view().revision, tee("three"), ADA)).toMatchObject({ id: 3 });
    expect([store.garmentOf(3), store.view().manifestId]).toEqual(["core:plain_tee", last]);
    rmSync(join(dir, "tmp"), { force: true });
    const view = store.view();
    const manifest = JSON.parse(readFileSync(join(store.media, `people.${view.manifestId}.json`), "utf8")) as PeopleManifest;
    expect(manifest.editions.map((e) => e.id)).toEqual([1, 2, 3]);
  } finally {
    store.close();
  }
});

test("two stores of one process on one folder keep each print under its own hash", async () => {
  const dir = folder();
  const a = open(dir), b = open(dir);
  try {
    const one = encodePng(16, 16, new Uint8Array(16 * 16 * 4).fill(10)), two = encodePng(16, 16, new Uint8Array(16 * 16 * 4).fill(200));
    const ga = await a.check(one.slice().buffer as ArrayBuffer);
    const gb = await b.check(two.slice().buffer as ArrayBuffer);
    if (!("info" in ga) || !("info" in gb)) throw new Error("both prints pass");
    a.place(ga.part, ga.info.hash);
    const kept = readFileSync(join(a.media, printName(ga.info.hash)));
    expect(hashOf(kept)).toBe(ga.info.hash);
    expect(() => b.place(gb.part, gb.info.hash)).not.toThrow();
  } finally {
    a.close();
    b.close();
  }
});

test("a publish while another connection holds the write lock does not stall the thread for seconds", () => {
  const dir = folder();
  const store = open(dir);
  store.view();
  const other = new Database(join(dir, "people.sqlite"));
  try {
    other.exec("BEGIN IMMEDIATE");
    const from = performance.now();
    const done = store.publish(store.view().revision, tee("blocked"), ADA);
    const ms = performance.now() - from;
    expect(done).toMatchObject({ status: 503 });
    // The world's tick shares this thread: at 30 ticks a second, this is a few ticks.
    expect(ms).toBeLessThan(200);
  } finally {
    other.exec("ROLLBACK");
    other.close();
    store.close();
  }
});

test("a manifest's part file a crash left is swept as a print's is", () => {
  const dir = folder();
  let now = Date.now();
  const store = new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), now: () => now });
  try {
    store.view();
    const left = [join(store.tmp, "people.0123456789abcdef.4242.json"), join(store.tmp, "print-4242-1.part")];
    for (const file of left) writeFileSync(file, "{}");
    const old = (now - 2 * 60 * 60 * 1000) / 1000;
    for (const file of left) utimesSync(file, old, old);
    store.sweep();
    expect(left.map((file) => existsSync(file))).toEqual([false, false]);
  } finally {
    store.close();
  }
});
