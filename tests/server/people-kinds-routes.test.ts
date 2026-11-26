// Named people, outfits and admin populations through the admin API (server/admin/people-routes.ts) on two worlds of one
// cluster: each save is logged as its actor's and refuses a stale page; what a thing names is checked against the
// world's content and the store; and a body drawn from an admin population looks the same to a client of either world,
// after a newer revision, a retirement and a restart.
import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { refused, type AdminGate } from "../../server/admin/gate.ts";
import { Guesses } from "../../server/guesses.ts";
import { BEACH, CITY } from "../../content/people/defaults.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import { personFrom, wireNumber } from "../../shared/people/person.ts";
import { TestCluster, keyAt, type Server } from "../fixtures/cluster.ts";

const cluster = new TestCluster();
afterAll(() => cluster.cleanup());
const clock = { ms: Date.now() };
const PASSWORD = "kiwi-7731";
let folders = 0;

function worlds(): { a: Server; b: Server; folder: string } {
  const folder = `kinds${++folders}`, host = { host: { adminPassword: PASSWORD } };
  return { a: cluster.server("Island", folder, clock, host), b: cluster.server("Miami", folder, clock, host), folder };
}

function call(s: Server, path: string, init: RequestInit = {}): Promise<Response> {
  const host = s.h.host;
  const gate: AdminGate = { dev: false, password: host.adminPassword, guesses: new Guesses(), tick: () => 0, world: s.world };
  const req = new Request(`http://snark.test${path}`, { ...init, headers: { authorization: `Basic ${btoa(`kody:${PASSWORD}`)}`, ...(init.headers as Record<string, string>) } } as RequestInit);
  return Promise.resolve(refused(req, "1.2.3.4", gate) ?? peopleAdmin(req, path, host.people, () => host.world.reg, host.acts, host)!);
}
const post = (s: Server, path: string, body: unknown): Promise<Response> => call(s, path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
interface Listed { id: number; rev: number; retired: boolean; by: string; doc: Record<string, unknown> }
interface State { revision: number; manifest: { id: string } | null; people: Listed[]; outfits: Listed[]; populations: Listed[]; builtIns: { id: string }[] }
const state = async (s: Server): Promise<State> => (await (await call(s, "/admin/people/state")).json()) as State;
const acts = (s: Server): string[] => s.h.host.acts.recent(0, 1e9).filter((a) => /person|outfit|population/.test(a.what)).map((a) => a.what);
const said = async (res: Response): Promise<[number, Record<string, unknown>]> => [res.status, (await res.json()) as Record<string, unknown>];

const source = { seed: 7, population: "core:people_city", locks: { face: 3 }, outfit: null };
const mara = { name: "Mara", look: [...personFrom(7, CITY, undefined, source.locks).look], wardrobe: null, source, notes: "" };
const tee = { garment: "core:plain_tee", edition: 0, weight: 1 };
const vendor = { name: "Vendor", slots: [{ choices: [tee], dye: [9, 0, 0] }, null, null, null, null] };

test("saves answer and are logged; a stale page gets 409 and the state; a copy starts from a built-in", async () => {
  const { a, b } = worlds();
  try {
    expect((await state(a)).builtIns.map((p) => p.id)).toContain("core:people_beach");
    const [made, first] = await said(await post(a, "/admin/people/save", { kind: "person", id: null, rev: 0, doc: mara }));
    expect([made, first.id, first.rev]).toEqual([200, 1, 1]);
    const [ok, second] = await said(await post(a, "/admin/people/save", { kind: "person", id: 1, rev: 1, doc: { ...mara, notes: "sells shells" } }));
    expect([ok, second.rev]).toEqual([200, 2]);
    // The second world's page still showed revision 1: it is told to reload and shown what is there.
    const [stale, now] = await said(await post(b, "/admin/people/save", { kind: "person", id: 1, rev: 1, doc: { ...mara, notes: "lost?" } }));
    expect([stale, now.error, (now.people as Listed[]).map((p) => [p.id, p.rev, p.doc.notes])]).toEqual([409, "The person 1 was saved in another page. Reload to see it.", [[1, 2, "sells shells"]]]);
    // The same again is no change, and logs nothing.
    const [, same] = await said(await post(b, "/admin/people/save", { kind: "person", id: 1, rev: 2, doc: { ...mara, notes: "sells shells" } }));
    expect([same.rev, same.changed]).toEqual([2, false]);

    expect((await post(a, "/admin/people/save", { kind: "outfit", id: null, rev: 0, doc: vendor })).status).toBe(200);
    const [copied, copy] = await said(await post(b, "/admin/people/save", { kind: "population", id: null, rev: 0, copyOf: "core:people_beach" }));
    expect([copied, copy.id]).toEqual([200, 1]);
    const pop = (await state(a)).populations[0]!;
    expect([pop.doc.label, pop.doc.face, pop.doc.women]).toEqual(["Young beachgoers copy", BEACH.face, BEACH.women]);
    expect((await post(a, "/admin/people/retire", { revision: (await state(a)).revision, kind: "outfit", id: 1, retired: true })).status).toBe(200);
    const after = await state(b);
    expect([after.outfits.map((o) => [o.id, o.retired, o.by]), after.people.map((p) => p.rev)]).toEqual([[[1, true, "(kody)"]], [2]]);
    expect([...acts(a), ...acts(b)]).toEqual([
      'made the person 1 "Mara"',
      'saved the person 1 "Mara" (revision 2)',
      'made the outfit 1 "Vendor"',
      'retired the outfit 1 "Vendor"',
      'made the population 1 "Young beachgoers copy" from core:people_beach',
    ]);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

test("what a thing names is checked against the world's content and the store, and a refusal logs nothing", async () => {
  const { a, b } = worlds();
  try {
    const edition = ((await (await post(a, "/admin/people/publish", { revision: 0, garment: "core:plain_trousers", colours: [0, 0, 0], name: "Jeans" })).json()) as { id: number }).id;
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ kind: "outfit", id: null, rev: 0, doc: { ...vendor, slots: [null, { choices: [tee], dye: [0, 0, 0] }, null, null, null] } }, /worn as a top, not a bottom/],
      [{ kind: "outfit", id: null, rev: 0, doc: { ...vendor, slots: [{ choices: [{ ...tee, edition }], dye: [0, 0, 0] }, null, null, null, null] } }, /not one of core:plain_tee/],
      [{ kind: "outfit", id: null, rev: 0, doc: { ...vendor, slots: [{ choices: [{ ...tee, garment: "core:stone" }], dye: [0, 0, 0] }, null, null, null, null] } }, /not a garment/],
      [{ kind: "person", id: null, rev: 0, doc: { ...mara, source: { ...source, population: 4 } } }, /no population 4/],
      [{ kind: "person", id: null, rev: 0, doc: { ...mara, source: { ...source, population: "core:nobody" } } }, /no population core:nobody/],
      [{ kind: "person", id: null, rev: 0, doc: { ...mara, source: { ...source, outfit: 3 } } }, /no outfit 3/],
      [{ kind: "person", id: null, rev: 0, doc: { ...mara, look: { seed: 7, population: "core:people_city", locks: {} } } }, /bytes of a valid look/],
      [{ kind: "population", id: null, rev: 0, doc: { ...BEACH, outfits: [{ wear: ["core:nothing"], weight: 1 }] } }, /"core:nothing" is not an item\/armor or an item\/garment/],
      [{ kind: "population", id: null, rev: 0, doc: { ...BEACH, outfits: [{ wear: ["core:stone"], weight: 1 }] } }, /"core:stone" is not an item\/armor or an item\/garment/],
      [{ kind: "population", id: null, rev: 0, copyOf: "core:people_nowhere" }, /not a built-in population/],
      [{ kind: "edition", id: null, rev: 0, doc: mara }, /Name the kind/],
      [{ kind: "person", id: "1", rev: 0, doc: mara }, /by its id/],
      [{ kind: "person", id: null, rev: -1, doc: mara }, /revision/],
    ];
    for (const [body, why] of bad) {
      const [status, reply] = await said(await post(a, "/admin/people/save", body));
      expect([status, why.test(String(reply.error))]).toEqual([400, true]);
    }
    expect((await post(a, "/admin/people/save", { kind: "person", id: 5, rev: 1, doc: mara })).status).toBe(404);
    // A population may wear armour and garments, as a content one may.
    const dressed = await post(b, "/admin/people/save", { kind: "population", id: null, rev: 0, doc: { ...BEACH, label: "Dressed", outfits: [{ wear: ["core:plain_tee", "core:cloth_pants"], weight: 1 }] } });
    expect(dressed.status).toBe(200);
    expect((await post(a, "/admin/people/retire", { revision: 2, kind: "population", id: 2, retired: true })).status).toBe(404);
    const s = await state(b);
    expect([s.revision, s.people, s.outfits, s.populations.map((p) => p.doc.label), acts(a)]).toEqual([2, [], [], ["Dressed"], []]);
  } finally {
    a.h.host.shutdown();
    b.h.host.shutdown();
  }
});

/** A page's fetch of the world's media, held until `open` is called. */
function gatedFetch(s: Server): { fetch: (path: string) => Promise<unknown>; open: () => void } {
  let open = (): void => {};
  const gate = new Promise<void>((done) => (open = done));
  const media = s.h.host.people.media;
  return { fetch: (path) => gate.then(() => JSON.parse(readFileSync(join(media, path.slice("/media/".length)), "utf8"))), open: () => open() };
}

/** The look `watcher` holds of `of`'s body, or null where it does not see it. */
function seenLook(s: Server, watcher: ClientSession, of: ClientSession): number[] | null {
  const seen = new RemoteSample(), e = s.h.ent(of);
  watcher.sampleRemote(seen);
  for (let i = 0; i < seen.count; i++) if (seen.id[i] === e && seen.hasLook[i]) return [...seen.look.subarray(i * LOOK_BYTES, (i + 1) * LOOK_BYTES)];
  return null;
}

test("a body drawn from an admin population looks alike to both worlds and a client, through revisions and a restart", async () => {
  const { a, b, folder } = worlds();
  let b2: Server | null = null;
  try {
    const beach = { ...BEACH, label: "Night beach", face: 0.8 };
    const id = ((await (await post(a, "/admin/people/save", { kind: "population", id: null, rev: 0, doc: beach })).json()) as { id: number }).id;
    b.h.host.people.poll(Date.now() + 60_000);
    // Both worlds resolve the revision to the same population and so the same person.
    const seed = 0x5eed;
    const onA = personFrom(seed, a.h.host.people.population(id, 1)!).look, onB = personFrom(seed, b.h.host.people.population(id, 1)!).look;
    expect([...onB]).toEqual([...onA]);
    expect(a.h.host.people.view().manifestId).toBe(b.h.host.people.view().manifestId);

    const ada = b.h.join("ada", {}, { key: keyAt("ada", b.world) }), bo = b.h.join("bo", {}, { key: keyAt("bo", b.world) });
    const page = gatedFetch(b);
    bo.peopleBook.fetcher = page.fetch;
    b.h.run(600);
    const reg = b.h.host.world.reg, number = wireNumber(reg, id)!;
    b.h.world.ents.setBodyLook(b.h.ent(ada), onB, { seed, population: number, revision: 1 });
    b.h.run(600);
    // Bo's page has not fetched the manifest yet: ada is drawn as a stand-in, which is made again once it comes.
    const standIn = seenLook(b, bo, ada);
    expect(standIn).not.toBeNull();
    expect(standIn).not.toEqual([...onB]);
    expect(bo.peopleBook.waiting).toBeGreaterThan(0);
    page.open();
    await bo.peopleBook.settled();
    expect([seenLook(b, bo, ada), bo.peopleBook.waiting]).toEqual([[...onB], 0]);

    // A newer revision and a retirement leave the first as it was, on a world started again and a new page.
    expect((await post(a, "/admin/people/save", { kind: "population", id, rev: 1, doc: { ...beach, face: 0.1 } })).status).toBe(200);
    expect((await post(a, "/admin/people/retire", { revision: (await state(a)).revision, kind: "population", id, retired: true })).status).toBe(200);
    b.h.host.shutdown();
    b2 = cluster.server("Miami", folder, clock, { host: { adminPassword: PASSWORD } });
    b2.h.host.people.poll();
    expect(b2.h.host.people.view().retiredOf.population.has(id)).toBe(true);
    expect([...personFrom(seed, b2.h.host.people.population(id, 1)!).look]).toEqual([...onA]);
    expect([...personFrom(seed, b2.h.host.people.population(id, 2)!).look]).not.toEqual([...onA]);
    const ada2 = b2.h.join("ada", {}, { key: keyAt("ada", b2.world) }), cy = b2.h.join("cy", {}, { key: keyAt("cy", b2.world) });
    const page2 = gatedFetch(b2);
    cy.peopleBook.fetcher = page2.fetch;
    page2.open();
    b2.h.run(600);
    await cy.peopleBook.settled();
    b2.h.world.ents.setBodyLook(b2.h.ent(ada2), onA, { seed, population: wireNumber(b2.h.host.world.reg, id)!, revision: 1 });
    b2.h.run(600);
    expect([seenLook(b2, cy, ada2), cy.peopleBook.waiting]).toEqual([[...onA], 0]);
  } finally {
    a.h.host.shutdown();
    (b2 ?? b).h.host.shutdown();
  }
});
