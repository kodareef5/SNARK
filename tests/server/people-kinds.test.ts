// Named people, outfits and admin populations in the cluster's people store (server/people/store.ts): ids given once,
// each save a new revision made from the one before, a stale save refused with nothing lost, two worlds and three
// processes on one file, and every population revision kept in the manifest for good.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PeopleStore, type By, type Saved } from "../../server/people/store.ts";
import { BEACH, CITY } from "../../content/people/defaults.ts";
import {
  readOutfit, readPeopleManifest, readPerson, readPopulation, storePopulation, type OutfitDoc, type PeopleManifest, type PersonDoc, type PopulationDoc,
} from "../../shared/people/doc.ts";
import { personFrom } from "../../shared/people/person.ts";

const scratch = join(import.meta.dir, "../../var");
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, "people-kinds-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let made = 0;
const folder = (): string => join(root, `cluster${++made}`);
const open = (dir: string, now: () => number = Date.now): PeopleStore => new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp"), now });

const ADA: By = { name: "ada", id: "S-ADA" };
const BO: By = { name: "bo", id: "S-BO" };
const mara = (notes = ""): PersonDoc => ({ name: "Mara", look: [...personFrom(7, CITY).look], wardrobe: null, source: { seed: 7, population: "core:people_city", locks: { face: 99 }, outfit: null }, notes });
const vendor = (name = "Vendor"): OutfitDoc => ({ name, slots: [{ choices: [{ garment: "core:plain_tee", edition: 0, weight: 1 }], dye: [0, 0, 0] }, null, null, null, null] });
const { type: _t, id: _i, revision: _r, ...beachBody } = BEACH;
const beach = (face = 0.3): PopulationDoc => ({ ...beachBody, label: "Beach copy", face });

function saved(done: Saved | { status: number; error: string }): Saved {
  if ("status" in done) throw new Error(done.error);
  return done;
}
const manifest = (store: PeopleStore): PeopleManifest & { populations?: { id: number; rev: number }[] } =>
  JSON.parse(readFileSync(join(store.media, `people.${store.view().manifestId}.json`), "utf8"));

test("each kind gives ids in order; a save is the next revision and the old one is kept", () => {
  const store = open(folder(), () => 5_000);
  try {
    expect([saved(store.save("person", null, 0, mara(), ADA)).id, saved(store.save("person", null, 0, mara("two"), BO)).id]).toEqual([1, 2]);
    expect(saved(store.save("outfit", null, 0, vendor(), ADA)).id).toBe(1);
    expect(saved(store.save("population", null, 0, beach(), ADA)).id).toBe(1);
    const next = saved(store.save("person", 1, 1, mara("met at the pier"), BO));
    expect([next.id, next.rev, next.changed]).toEqual([1, 2, true]);
    const revs = store.view().records.person.get(1)!;
    expect(revs.map((r) => [r.rev, r.body.notes, r.made.by])).toEqual([[1, "", "ada"], [2, "met at the pier", "bo"]]);
    expect(revs[1]!.made).toEqual({ by: "bo", byId: "S-BO", at: 5_000 });
    // The same body again is no change and no new revision.
    const same = saved(store.save("person", 1, 2, mara("met at the pier"), ADA));
    expect([same.rev, same.changed, store.view().records.person.get(1)!.length]).toEqual([2, false, 2]);
  } finally {
    store.close();
  }
});

test("a stale save gets 409 and the store as it is, and an unknown id 404; nothing changes", () => {
  const store = open(folder());
  try {
    saved(store.save("outfit", null, 0, vendor(), ADA));
    saved(store.save("outfit", 1, 1, vendor("Vendor two"), BO));
    const before = store.view().revision;
    const stale = store.save("outfit", 1, 1, vendor("Lost?"), ADA);
    expect(stale).toMatchObject({ status: 409, error: "The outfit 1 was saved in another page. Reload to see it." });
    expect("status" in stale && stale.view!.records.outfit.get(1)!.map((r) => r.body.name)).toEqual(["Vendor", "Vendor two"]);
    expect(store.save("outfit", 9, 1, vendor(), ADA)).toMatchObject({ status: 404 });
    expect(store.save("outfit", null, 3, vendor(), ADA)).toMatchObject({ status: 400 });
    expect(store.view().revision).toBe(before);
  } finally {
    store.close();
  }
});

test("ids and revisions are never given twice across restarts", () => {
  const dir = folder();
  let store = open(dir);
  saved(store.save("person", null, 0, mara(), ADA));
  store.close();
  for (let start = 0; start < 3; start++) {
    store = open(dir);
    const held = store.view().records.person;
    expect([...held.keys()]).toEqual(Array.from({ length: start + 1 }, (_, k) => k + 1));
    expect(held.get(1)!.length).toBe(start + 1);
    saved(store.save("person", 1, start + 1, mara(`restart ${start}`), ADA));
    expect(saved(store.save("person", null, 0, mara(), ADA)).id).toBe(start + 2);
    store.close();
  }
});

test("two worlds agree on ids; of two saves of one thing from one revision, one is refused", () => {
  const dir = folder();
  const a = open(dir), b = open(dir);
  try {
    // Two new things at once on two worlds are two ids, which both worlds then agree on.
    const one = saved(a.save("person", null, 0, mara("on A"), ADA)), two = saved(b.save("person", null, 0, mara("on B"), BO));
    expect([one.id, two.id]).toEqual([1, 2]);
    for (const s of [a, b]) expect([...s.view().records.person.values()].map((r) => [r[0]!.id, r[0]!.body.notes])).toEqual([[1, "on A"], [2, "on B"]]);
    // Both pages showed revision 1 of person 1: A saves first, so B is told to reload, and A's revision is there.
    expect(a.save("person", 1, 1, mara("A's edit"), ADA)).toMatchObject({ rev: 2 });
    expect(b.save("person", 1, 1, mara("B's edit"), BO)).toMatchObject({ status: 409 });
    expect(b.save("person", 1, 2, mara("B's edit"), BO)).toMatchObject({ rev: 3 });
    // A save of another thing is never refused for this one's sake.
    expect(a.save("person", 2, 1, mara("B's person, A's edit"), ADA)).toMatchObject({ rev: 2 });
    for (const s of [a, b]) expect(s.view().records.person.get(1)!.map((r) => r.body.notes)).toEqual(["on A", "A's edit", "B's edit"]);
  } finally {
    a.close();
    b.close();
  }
});

test("three processes saving one person lose no save and are given no revision twice", async () => {
  const dir = folder();
  const store = open(dir);
  try {
    saved(store.save("person", null, 0, mara(), ADA));
    const saver = join(import.meta.dir, "../fixtures/people-saver.ts"), count = 150;
    const runs = ["p", "q", "r"].map((name) => Bun.spawn(["bun", saver, join(dir, "people.sqlite"), join(dir, "media"), "1", String(count), name], { stdout: "pipe", stderr: "inherit" }));
    const said = await Promise.all(runs.map(async (p) => (await p.exited, JSON.parse(await new Response(p.stdout).text()) as { revs: number[]; refused: number })));
    expect(runs.map((p) => p.exitCode)).toEqual([0, 0, 0]);
    expect(said.flatMap((s) => s.revs).sort((x, y) => x - y)).toEqual(Array.from({ length: 3 * count }, (_, k) => k + 2));
    // Every save a process was told it made is there, under the revision it was told, as it sent it.
    const revs = store.view().records.person.get(1)!;
    expect(revs.map((r) => r.rev)).toEqual(Array.from({ length: 3 * count + 1 }, (_, k) => k + 1));
    for (const [w, name] of ["p", "q", "r"].entries()) for (const [k, rev] of said[w]!.revs.entries()) expect([revs[rev - 1]!.body.notes, revs[rev - 1]!.made.by]).toEqual([`${name} ${k}`, name]);
    console.log(`three savers: ${said.map((s) => s.refused).join(", ")} saves refused and made again`);
  } finally {
    store.close();
  }
});

test("every population revision is in the manifest, retired or not, after a restart and on a second world", () => {
  const dir = folder();
  let a = open(dir);
  const b = open(dir);
  try {
    const id = saved(a.save("population", null, 0, beach(), ADA)).id;
    const first = a.view().manifestId;
    expect(manifest(a).populations!.map((p) => [p.id, p.rev])).toEqual([[1, 1]]);
    saved(a.save("population", id, 1, beach(0.6), ADA));
    expect(a.view().manifestId).not.toBe(first);
    expect(a.retire(a.view().revision, id, true, "population")).toMatchObject({ changed: true });
    a.close();
    a = open(dir);
    for (const s of [a, b]) {
      expect(s.view().retiredOf.population.has(id)).toBe(true);
      expect(readPeopleManifest(manifest(s)).populations.map((p) => [p.id, p.rev, p.population.face])).toEqual([[1, 1, 0.3], [1, 2, 0.6]]);
      // The generator takes the first revision as it was saved, whichever world reads it.
      expect([...personFrom(0xc0ffee, s.population(id, 1)!).look]).toEqual([...personFrom(0xc0ffee, storePopulation(1, 1, beach())).look]);
    }
    expect(a.view().manifestId).toBe(b.view().manifestId);
    expect(a.population(id, 3)).toBeUndefined();
  } finally {
    a.close();
    b.close();
  }
});

test("a person or outfit saved leaves the clients' manifest as it was", () => {
  const store = open(folder());
  try {
    expect(store.publish(store.view().revision, { garment: "core:plain_tee", colours: [1, 2, 3], print: null, name: "Tee" }, ADA)).toMatchObject({ id: 1 });
    const id = store.view().manifestId;
    expect(Object.keys(manifest(store))).toEqual(["editions"]);
    saved(store.save("person", null, 0, mara(), ADA));
    saved(store.save("outfit", null, 0, vendor(), ADA));
    expect(store.view().manifestId).toBe(id);
    expect(store.retire(store.view().revision, 1, true, "person")).toMatchObject({ changed: true });
    expect([...store.view().retiredOf.person, ...store.view().retired]).toEqual([1]);
  } finally {
    store.close();
  }
});

test("the doc checks keep a body's known fields in one order and refuse what is not of its shape", () => {
  expect(readPopulation({ ...beach(), extra: 1, label: "  Beach   copy " })).toEqual(readPopulation(beach()) as PopulationDoc);
  expect(JSON.stringify(readPopulation({ ...beach() }))).toBe(JSON.stringify(readPopulation(JSON.parse(JSON.stringify(readPopulation(beach()))))));
  expect(readPopulation({ ...beach(), women: 2 })).toMatch(/women is a share/);
  expect(readPopulation({ ...beach(), skin: "lots" })).toMatch(/skin/);
  expect(readPopulation({ ...beach(), regions: { tail: [0, 1] } })).toMatch(/tail is no body region/);
  expect(readPopulation({ ...beach(), hair: undefined })).toMatch(/hair/);
  expect(readPerson({ ...mara(), source: { seed: -1, population: "core:people_city" } })).toMatch(/seed/);
  expect(readPerson({ ...mara(), source: { seed: 1, population: "core:people_city", locks: { toes: 3 } } })).toMatch(/locks/);
  expect(readPerson({ ...mara(), source: { seed: 1, population: "core:people_city", outfit: "vendor" } })).toMatch(/outfit/);
  expect(readPerson({ ...mara(), look: [1, 2, 3] })).toMatch(/72/);
  expect(readPerson({ ...mara(), look: { seed: 7, population: "core:people_city", revision: 1, locks: {} } })).toMatch(/72/);
  expect(readPerson({ ...mara(), name: "" })).toMatch(/name/);
  expect(readOutfit({ name: "Bare", slots: [null, null, null, null, null] })).toMatch(/wears something/);
  expect(readOutfit({ name: "Odd", slots: [{ choices: [{ garment: "core:plain_tee", edition: 0, weight: 0 }], dye: [0, 0, 0] }, null, null, null, null] })).toMatch(/weight/);
  expect(readOutfit(vendor() as unknown as Record<string, unknown>)).toEqual(vendor());
});

test("the store keeps a body as its check reads it and refuses one not of its shape", () => {
  const store = open(folder());
  try {
    const id = saved(store.save("population", null, 0, { ...beach(), extra: 1, label: " Beach  copy " } as PopulationDoc, ADA)).id;
    const kept = manifest(store).populations![0] as unknown as { population: Record<string, unknown> };
    expect([kept.population.extra, kept.population.label]).toEqual([undefined, "Beach copy"]);
    expect(store.population(id, 1)).toEqual(storePopulation(id, 1, readPopulation(beach()) as PopulationDoc));
    expect(store.save("population", id, 1, { ...beach(), women: 3 }, ADA)).toMatchObject({ status: 400 });
    expect(store.save("person", null, 0, { ...mara(), name: "" }, ADA)).toMatchObject({ status: 400 });
    expect(store.view().records.population.get(id)!.length).toBe(1);
  } finally {
    store.close();
  }
});

test("a kind's page is told it is stale only by a change of that kind", () => {
  const store = open(folder());
  try {
    const shown = store.view().revision;
    saved(store.save("person", null, 0, mara(), ADA));
    saved(store.save("population", null, 0, beach(), ADA));
    // Editions: a publish and a retirement from the page's revision pass, since no edition changed meanwhile.
    expect(store.publish(shown, { garment: "core:plain_tee", colours: [0, 0, 0], print: null, name: "Tee" }, ADA)).toMatchObject({ id: 1 });
    const seen = store.view().revision;
    saved(store.save("outfit", null, 0, vendor(), BO));
    expect(store.retire(seen, 1, true, "edition")).toMatchObject({ changed: true });
    // A page that missed that retirement is stale for editions, and its words say so.
    expect(store.publish(seen, { garment: "core:plain_tee", colours: [0, 0, 0], print: null, name: "Late" }, ADA)).toMatchObject({ status: 409, error: "The editions changed in another page. Reload to see them." });
    // Retiring a person is not refused for an outfit's save, but is for another person's retirement.
    const before = store.view().revision;
    saved(store.save("person", null, 0, mara("two"), BO));
    expect(store.retire(before, 1, true, "person")).toMatchObject({ changed: true });
    expect(store.retire(before, 2, true, "person")).toMatchObject({ status: 409, error: "Another page retired or brought back a person. Reload to see it." });
    expect(store.retire(store.view().revision + 1, 2, true, "person")).toMatchObject({ status: 409 });
  } finally {
    store.close();
  }
});

test("a store file from before kinds kept their own changes treats every kind as changed now", () => {
  const dir = folder();
  const first = open(dir);
  first.publish(0, { garment: "core:plain_tee", colours: [0, 0, 0], print: null, name: "Tee" }, ADA);
  first.close();
  const db = new Database(join(dir, "people.sqlite"));
  db.exec(`UPDATE store SET doc='{"schema":1,"retired":{}}'`);
  db.close();
  const store = open(dir);
  try {
    expect(store.publish(0, { garment: "core:plain_tee", colours: [0, 0, 0], print: null, name: "Stale" }, ADA)).toMatchObject({ status: 409 });
    expect(store.publish(1, { garment: "core:plain_tee", colours: [0, 0, 0], print: null, name: "Fresh" }, ADA)).toMatchObject({ id: 2 });
  } finally {
    store.close();
  }
});
