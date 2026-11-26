// Faults found in review of the people store (server/people/store.ts, admin/people-routes.ts): each test fails today.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { actorOf, refused, type AdminGate } from "../../server/admin/gate.ts";
import { Guesses } from "../../server/guesses.ts";
import { hashOf } from "../../server/people/png.ts";
import { PeopleStore, type By } from "../../server/people/store.ts";
import { printName, type EditionDraft, type PeopleManifest } from "../../shared/people/doc.ts";
import { RANK_ADMIN } from "../../shared/ranks.ts";
import { encodePng } from "../../tools/snap/png.ts";
import { coreRegistry } from "../fixtures/world.ts";

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
    // The part file's folder goes (or the disk is full): the edition is recorded, the manifest is not written.
    rmSync(join(dir, "tmp"), { recursive: true, force: true });
    expect(() => store.publish(store.view().revision, tee("two"), ADA)).toThrow();
    expect(() => store.view()).toThrow();
    mkdirSync(join(dir, "tmp"));
    const view = store.view();
    const manifest = JSON.parse(readFileSync(join(store.media, `people.${view.manifestId}.json`), "utf8")) as PeopleManifest;
    expect(manifest.editions.map((e) => e.id)).toEqual([1, 2]);
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

test("a development page below the admin rank cannot publish to the cluster's editions", async () => {
  const store = new PeopleStore({ db: ":memory:" });
  const reg = coreRegistry();
  try {
    const gate: AdminGate = { dev: true, password: null, guesses: new Guesses(), tick: () => 0 };
    const req = new Request("http://snark.test/admin/people/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: 0, garment: "core:plain_tee", colours: [0, 0, 0], name: "open page" }) });
    expect(refused(req, "1.2.3.4", gate)).toBeNull();
    expect(actorOf(req).rank).toBeLessThan(RANK_ADMIN);
    const res = await peopleAdmin(req, "/admin/people/publish", store, () => reg)!;
    expect(res.status).toBe(403);
    expect(store.view().editions).toEqual([]);
  } finally {
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
