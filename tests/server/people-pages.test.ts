// The people and populations pages against the real people routes and store: the admin build makes both pages, the site
// serves them, and the pages' calls (client/core/admin/people.ts) save, meet a stale revision and copy a population.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookOf, copyPopulation, lookBytes, newPerson, personDoc, promotedPerson, saveThing, storeStateOf, type SaveIo } from "../../client/core/admin/people.ts";
import { addOutfit, draftDef, draftOfListed, sheetChanges, sheetOf, sheetSeeds } from "../../client/core/admin/populations.ts";
import type { Answer } from "../../client/core/admin/wardrobe.ts";
import { peopleAdmin, peopleState } from "../../server/admin/people-routes.ts";
import { adminSite } from "../../server/admin/site.ts";
import { PeopleStore } from "../../server/people/store.ts";
import { personFrom } from "../../shared/people/person.ts";
import { buildAdmin } from "../../tools/build-admin.ts";
import { coreRegistry } from "../fixtures/world.ts";

const root = mkdtempSync(join(tmpdir(), "snark-people-pages-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const reg = coreRegistry();

test("the admin build makes the people and populations pages, which the site serves", async () => {
  const dist = join(root, "dist");
  await buildAdmin(dist);
  for (const f of ["people.html", "people.js", "populations.html", "populations.js", "people.css"]) expect(existsSync(join(dist, "admin", f))).toBe(true);
  for (const page of ["people", "populations"]) {
    const html = readFileSync(join(dist, `admin/${page}.html`), "utf8");
    expect([html.includes(`src="/admin/ui/${page}.js"`), html.includes('href="/admin/ui/people.css"'), html.includes('src="/person-stage.html"')]).toEqual([true, true, true]);
  }
  const site = {
    dir: dist, base: "", port: 0, id: "local" as const, who: "test", destinations: () => [], scenes: () => new Response(null),
    gate: { dev: true, password: null, guesses: null as never, tick: () => 0 },
  };
  const get = async (path: string): Promise<Response> => (await adminSite(new Request(`http://snark.test${path}`), new URL(`http://snark.test${path}`), site))!;
  for (const path of ["/admin/ui/people.js", "/admin/ui/populations.js", "/admin/ui/people.css"]) expect((await get(path)).status).toBe(200);
  expect([(await get("/admin/people/")).status, (await get("/admin/populations/")).status]).toEqual([200, 200]);
  expect((await get("/admin/people")).headers.get("location")).toBe("/admin/people/");
  expect((await get("/admin/populations?id=2")).headers.get("location")).toBe("/admin/populations/?id=2");
});

/** The pages' calls, answered by the people routes over `store`. */
function routes(store: PeopleStore): SaveIo {
  const answer = async (path: string, body: unknown): Promise<Answer> => {
    const text = JSON.stringify(body);
    const req = new Request(`http://snark.test/admin/people/${path}`, { method: "POST", body: text, headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).length) } });
    const r = await peopleAdmin(req, `/admin/people/${path}`, store, () => reg)!;
    return { status: r.status, answer: (await r.json()) as Record<string, unknown> };
  };
  return { save: (b) => answer("save", b), retire: (b) => answer("retire", b), wait: async () => {} };
}

test("the state lists armour beside the garments for a population's outfits", () => {
  const dir = join(root, "armour");
  const store = new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp") });
  try {
    const state = storeStateOf(peopleState(store, reg))!;
    expect(state.armour.find((a) => a.id === "core:cloth_shirt")).toEqual({ id: "core:cloth_shirt", label: expect.any(String), slot: 1 });
    expect(state.armour.some((a) => a.id === "core:plain_tee")).toBe(false);
  } finally {
    store.close();
  }
});

test("a person and a copied population are saved as the pages send them, and a stale save is kept", async () => {
  const dir = join(root, "store");
  const store = new PeopleStore({ db: join(dir, "people.sqlite"), media: join(dir, "media"), tmp: join(dir, "tmp") });
  try {
    const io = routes(store);
    const copied = await copyPopulation(io, "core:people_city", "Night market");
    expect(copied).toMatchObject({ kind: "saved", id: 1, rev: 1 });
    let state = copied.kind === "saved" ? copied.state! : null;
    const pop = draftOfListed(state!.populations[0]!);
    const seeds = sheetSeeds(9), before = sheetOf(draftDef(pop, false), seeds);
    addOutfit(pop.doc, ["core:cloth_shirt"]);
    const saved = await saveThing(io, "population", pop.id, pop.rev, pop.doc);
    expect(saved).toMatchObject({ kind: "saved", id: 1, rev: 2 });
    state = saved.kind === "saved" ? saved.state! : null;
    // The store's revision 2 draws the very faces the sheet showed before the shirt.
    const def = store.population(1, 2)!;
    expect(sheetChanges(before, sheetOf(def, seeds)).every((c) => c.parts.length === 0)).toBe(true);

    // A person promoted from the sheet is saved in that revision, locked to its seed.
    const d = promotedPerson(seeds[3]!, 1, 2, "Night vendor");
    const made = await saveThing(io, "person", null, 0, personDoc(d));
    expect(made).toMatchObject({ kind: "saved", id: 1, rev: 1 });
    state = made.kind === "saved" ? made.state! : null;
    expect(lookBytes(d.look, state!, bookOf(state!, null))).toEqual(personFrom(seeds[3]!, def).look);

    // Another page saves the person first; this one is refused with the store as it is, and saves over it after.
    const other = newPerson(state!, 5);
    other.name = "Someone else";
    expect(await saveThing(io, "person", 1, 1, personDoc(other))).toMatchObject({ kind: "saved", rev: 2 });
    d.notes = "sells mangoes";
    const stale = await saveThing(io, "person", 1, 1, personDoc(d));
    expect(stale.kind).toBe("stale");
    expect(stale.kind === "stale" && stale.state?.people.find((p) => p.id === 1)?.doc.name).toBe("Someone else");
    expect(await saveThing(io, "person", 1, 2, personDoc(d))).toMatchObject({ kind: "saved", rev: 3 });
    expect(await saveThing(io, "person", 9, 1, personDoc(d))).toMatchObject({ kind: "refused", status: 404 });
  } finally {
    store.close();
  }
});
