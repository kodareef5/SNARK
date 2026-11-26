// The cluster's people store (server/people/store.ts): editions appended under ids never given twice, each change a
// compare-and-swap on one revision, a retired edition still served, and two worlds of one cluster reading one file.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveFile } from "../../server/files.ts";
import { hashOf } from "../../server/people/png.ts";
import { PeopleStore, type By } from "../../server/people/store.ts";
import { peopleManifestPath, printName, type EditionDraft, type PeopleManifest } from "../../shared/people/doc.ts";
import { encodePng } from "../../tools/snap/png.ts";

const root = mkdtempSync(join(tmpdir(), "snark-people-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;

const ADA: By = { name: "ada", id: "S-ADA" };
const BO: By = { name: "bo", id: "S-BO" };
const tee = (name: string, colours: [number, number, number] = [12, 40, 3]): EditionDraft => ({ garment: "core:plain_tee", colours, print: null, name });

/** A cluster folder of its own, and a store on it as a world opens one. */
function folder(): string {
  return join(root, `cluster${++made}`);
}
const open = (dir: string, now: () => number = Date.now): PeopleStore => new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), now });

/** Publishes on the store as it is now, and gives the id. */
function publish(store: PeopleStore, draft: EditionDraft, by = ADA): number {
  const done = store.publish(store.view().revision, draft, by);
  if ("status" in done) throw new Error(done.error);
  return done.id;
}

const manifest = (store: PeopleStore): PeopleManifest => JSON.parse(readFileSync(join(store.media, `people.${store.view().manifestId}.json`), "utf8"));

test("editions take ids in order, keep who made them, and never repeat across restarts", () => {
  const dir = folder();
  let store = open(dir, () => 1_000);
  expect(store.view()).toMatchObject({ revision: 0, editions: [], manifestId: "" });
  expect([publish(store, tee("Vegas tee")), publish(store, tee("Orb tee"), BO)]).toEqual([1, 2]);
  expect(store.view().made.get(2)).toEqual({ by: "bo", byId: "S-BO", at: 1_000 });
  store.close();
  for (let start = 0; start < 3; start++) {
    store = open(dir);
    expect(store.view().editions.map((e) => e.id)).toEqual([1, 2, ...Array.from({ length: start }, (_, k) => 3 + k)]);
    expect(publish(store, tee(`restart ${start}`))).toBe(3 + start);
    store.close();
  }
});

test("a stale revision is refused with 409 and the store as it is, and changes nothing", () => {
  const store = open(folder());
  try {
    publish(store, tee("first"));
    const seen = store.view().revision;
    publish(store, tee("second"), BO);
    const before = store.view();
    const stale = store.publish(seen, tee("lost?"), ADA);
    expect(stale).toMatchObject({ status: 409, view: { revision: before.revision } });
    expect("status" in stale && stale.view!.editions.map((e) => e.name)).toEqual(["first", "second"]);
    expect(store.retire(seen, 1, true)).toMatchObject({ status: 409 });
    expect([store.view().revision, store.view().editions.length, [...store.view().retired]]).toEqual([before.revision, 2, []]);
  } finally {
    store.close();
  }
});

test("two worlds of one cluster: the second sees the first's editions, and of two saves at once one is refused", () => {
  const dir = folder();
  const a = open(dir), b = open(dir);
  try {
    const one = publish(a, tee("on A"));
    // B has not looked since: a lookup it does not hold looks again, and finds it.
    expect(b.garmentOf(one)).toBe("core:plain_tee");
    expect(b.garmentOf(99)).toBeNull();
    // Both pages read the same revision; A saves first, so B is told to reload, and nothing of A's is lost.
    const seen = b.view().revision;
    expect(a.publish(seen, tee("A again"), ADA)).toMatchObject({ id: 2 });
    expect(b.publish(seen, tee("B too"), BO)).toMatchObject({ status: 409 });
    expect(b.publish(b.view().revision, tee("B too"), BO)).toMatchObject({ id: 3 });
    expect([a.view().editions.map((e) => e.name), b.view().editions.map((e) => e.name)]).toEqual([["on A", "A again", "B too"], ["on A", "A again", "B too"]]);
    expect(a.view().manifestId).toBe(b.view().manifestId);
  } finally {
    a.close();
    b.close();
  }
});

test("three processes publishing at once lose no edition and are given no id twice", async () => {
  const dir = folder();
  const store = open(dir);
  try {
    store.view();
    const writer = join(import.meta.dir, "../fixtures/people-writer.ts"), count = 40;
    const runs = ["p", "q", "r"].map((name) => Bun.spawn(["bun", writer, join(dir, "people.sqlite"), join(dir, "media"), String(count), name], { stdout: "pipe", stderr: "inherit" }));
    const said = await Promise.all(runs.map(async (p) => (await p.exited, JSON.parse(await new Response(p.stdout).text()) as { ids: number[]; refused: number })));
    expect(runs.map((p) => p.exitCode)).toEqual([0, 0, 0]);
    const given = said.flatMap((s) => s.ids).sort((x, y) => x - y);
    expect(given).toEqual(Array.from({ length: 3 * count }, (_, k) => k + 1));
    // Every edition a writer was told it published is in the store, under the id it was told, by its name.
    const view = store.view();
    for (const [w, name] of ["p", "q", "r"].entries()) for (const [k, id] of said[w]!.ids.entries()) expect(view.byId.get(id)?.name).toBe(`${name} ${k}`);
    expect(view.revision).toBe(3 * count);
  } finally {
    store.close();
  }
});

test("a retired edition is still in the manifest and still resolves, after a restart and on a second world", () => {
  const dir = folder();
  let a = open(dir);
  const b = open(dir);
  try {
    const id = publish(a, tee("old stock"));
    publish(a, tee("new stock"));
    const before = a.view().manifestId;
    const done = a.retire(a.view().revision, id, true);
    expect(done).toMatchObject({ changed: true });
    // Retiring changes the pick list only, so the clients' manifest is the same file.
    expect(a.view().manifestId).toBe(before);
    expect(a.retire(a.view().revision, id, true)).toMatchObject({ changed: false });
    a.close();
    a = open(dir);
    for (const s of [a, b]) {
      expect([...s.view().retired]).toEqual([id]);
      expect(s.garmentOf(id)).toBe("core:plain_tee");
      expect(manifest(s).editions.map((e) => [e.id, e.name])).toEqual([[1, "old stock"], [2, "new stock"]]);
    }
    expect(b.retire(b.view().revision, id, false)).toMatchObject({ changed: true });
    expect([...a.view().retired]).toEqual([]);
    expect(a.retire(a.view().revision, 77, true)).toMatchObject({ status: 404 });
  } finally {
    a.close();
    b.close();
  }
});

test("the file itself refuses to change or delete a record", () => {
  const dir = folder();
  const store = open(dir);
  publish(store, tee("kept"));
  store.close();
  const db = new Database(join(dir, "people.sqlite"));
  try {
    expect(() => db.exec("UPDATE records SET body='{}'")).toThrow(/never changed/);
    expect(() => db.exec("DELETE FROM records")).toThrow(/never deleted/);
  } finally {
    db.close();
  }
});

test("the manifest is named by its hash, holds what clients need and nobody's name, and is kept for good", async () => {
  const store = open(folder());
  try {
    publish(store, tee("Vegas tee"));
    const id = store.view().manifestId, file = join(store.media, `people.${id}.json`);
    const text = readFileSync(file, "utf8");
    expect(new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16)).toBe(id);
    expect(JSON.parse(text)).toEqual({ editions: [{ id: 1, garment: "core:plain_tee", colours: [12, 40, 3], print: null, name: "Vegas tee" }], populations: [] });
    expect(text).not.toContain("ada");
    const req = new Request(`http://snark.test${peopleManifestPath(id)}`);
    const res = await serveFile(store.media, req, peopleManifestPath(id).slice("/media".length));
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "public, max-age=31536000, immutable"]);
    publish(store, tee("Orb tee"));
    expect(store.view().manifestId).not.toBe(id);
    // The old one stays for a page that has not reloaded.
    expect(existsSync(file)).toBe(true);
  } finally {
    store.close();
  }
});

test("an old manifest goes after an hour unsent, and the current one stays", () => {
  let now = Date.now();
  const store = open(folder(), () => now);
  try {
    publish(store, tee("one"));
    const first = store.view().manifestId;
    publish(store, tee("two"));
    const second = store.view().manifestId;
    store.sweep();
    now += 61 * 60 * 1000;
    store.sweep();
    expect(readdirSync(store.media).filter((f) => f.startsWith("people.")).sort()).toEqual([`people.${second}.json`]);
    expect(first).not.toBe(second);
  } finally {
    store.close();
  }
});

test("an edition's print must be uploaded, and takes its size from the file", () => {
  const store = open(folder());
  try {
    const picture = encodePng(64, 32, new Uint8Array(64 * 32 * 4).fill(200)), hash = hashOf(picture);
    const draft: EditionDraft = { ...tee("printed"), print: { hash, width: 0, height: 0, place: { u: 0.1, v: 0.2, w: 0.5, h: 0.25, scale: 1, turn: 0.5 } } };
    expect(store.publish(store.view().revision, draft, ADA)).toMatchObject({ status: 400 });
    writeFileSync(join(store.media, printName(hash)), picture);
    const id = publish(store, draft);
    expect(store.view().byId.get(id)!.print).toEqual({ hash, width: 64, height: 32, place: { u: 0.1, v: 0.2, w: 0.5, h: 0.25, scale: 1, turn: 0.5 } });
  } finally {
    store.close();
  }
});

test("a store's file is in WAL, so a world's read never waits on another's write", () => {
  const dir = folder();
  open(dir).view();
  const db = new Database(join(dir, "people.sqlite"));
  try {
    expect((db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
  } finally {
    db.close();
  }
});

test("an uploaded print no edition names goes after a day, and one an edition names stays", () => {
  let now = Date.now();
  const store = open(folder(), () => now);
  try {
    store.view();
    const kept = encodePng(16, 16, new Uint8Array(16 * 16 * 4).fill(9)), loose = encodePng(16, 16, new Uint8Array(16 * 16 * 4).fill(99));
    for (const p of [kept, loose]) writeFileSync(join(store.media, printName(hashOf(p))), p);
    publish(store, { ...tee("printed"), print: { hash: hashOf(kept), width: 0, height: 0, place: { u: 0, v: 0, w: 1, h: 1, scale: 1, turn: 0 } } });
    now += 23 * 60 * 60 * 1000;
    store.sweep();
    expect([existsSync(join(store.media, printName(hashOf(loose)))), existsSync(join(store.media, printName(hashOf(kept))))]).toEqual([true, true]);
    now += 2 * 60 * 60 * 1000;
    store.sweep();
    expect([existsSync(join(store.media, printName(hashOf(loose)))), existsSync(join(store.media, printName(hashOf(kept))))]).toEqual([false, true]);
  } finally {
    store.close();
  }
});
