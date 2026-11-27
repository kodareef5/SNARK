// Promote this exact person: a population saved with an edit made while the save was out, a person picked on its sheet
// and promoted, given a lock by hand, saved and reopened, against the real people routes and store. What the store keeps
// and the reopened draft draws are the sheet's face, body, hair and clothes to the byte.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Edits, bookOf, copyPopulation, draftOf, isLocked, lookBytes, personDoc, personWear, promoteHref, promotedFrom, saveDraft, setByHand, setLock, sheetDress, stageWear,
  wearPieces, type LookDraft, type SaveIo, type StoreState,
} from "../../client/core/admin/people.ts";
import { draftDef, draftOfListed, promoteRef, setShare, sheetOf, sheetSeeds } from "../../client/core/admin/populations.ts";
import type { Answer } from "../../client/core/admin/wardrobe.ts";
import { peopleAdmin } from "../../server/admin/people-routes.ts";
import { PeopleStore } from "../../server/people/store.ts";
import { LOOK_SEX, LOOK_SKIN } from "../../shared/anim/look.ts";
import { PART_NAMES } from "../../shared/people/doc.ts";
import { coreRegistry } from "../fixtures/world.ts";

const root = mkdtempSync(join(tmpdir(), "snark-promote-exact-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const reg = coreRegistry();

/** The pages' calls, answered by the people routes over `store`; a save waits for `hold` where one is given. */
function routes(store: PeopleStore, hold?: () => Promise<void>): SaveIo {
  const answer = async (path: string, body: unknown): Promise<Answer> => {
    const text = JSON.stringify(body);
    await hold?.();
    const req = new Request(`http://snark.test/admin/people/${path}`, { method: "POST", body: text, headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(text).length) } });
    const r = await peopleAdmin(req, `/admin/people/${path}`, store, () => reg)!;
    return { status: r.status, answer: (await r.json()) as Record<string, unknown> };
  };
  return { save: (b) => answer("save", b), retire: (b) => answer("retire", b), wait: async () => {} };
}

const stateOf = (o: { kind: string; state?: StoreState | null }): StoreState => {
  if (o.kind !== "saved" || !o.state) throw new Error(`not saved: ${JSON.stringify(o)}`);
  return o.state;
};

test("a person promoted from the sheet is saved and reopens as the sheet showed it", async () => {
  const store = new PeopleStore({ db: join(root, "people.sqlite"), media: join(root, "media"), tmp: join(root, "tmp") });
  try {
    const io = routes(store);
    let state = stateOf(await copyPopulation(io, "core:people_city", "Night market"));
    const pop = draftOfListed(state.populations[0]!), edits = new Edits();
    edits.open();

    // Saved at no women; made all women while the save is out.
    setShare(pop.doc, "women", 0);
    edits.made++;
    let release = (): void => {};
    const gate = new Promise<void>((r) => (release = r));
    const out = saveDraft(routes(store, () => gate), "population", pop, pop.doc, edits);
    setShare(pop.doc, "women", 1);
    edits.made++;
    release();
    state = stateOf(await out);
    expect([pop.rev, store.population(1, 2)!.women]).toEqual([2, 0]);
    // The edit made meanwhile is not saved, so nothing on the sheet may be promoted against revision 2.
    expect(edits.unsaved).toBe(true);
    expect(promoteRef(pop, edits.unsaved)).toBeNull();
    state = stateOf(await saveDraft(io, "population", pop, pop.doc, edits));
    expect([edits.unsaved, pop.rev, store.population(1, 3)!.women]).toEqual([false, 3, 1]);

    // The sheet as the page shows it, and one person on it in clothes.
    const sheet = sheetOf(draftDef(pop), sheetSeeds(11)), ref = promoteRef(pop, edits.unsaved)!;
    expect(sheet.every((p) => p.look[LOOK_SEX] === 1)).toBe(true);
    const shown = sheet.find((p) => p.outfit >= 0 && p.wear.length > 0)!;
    const worn = wearPieces(state, shown.wear, shown.dyes), shownWear = stageWear(state, worn.worn, worn.armour);
    expect(shownWear.wardrobe.slots.filter((s) => s).length).toBe(shown.wear.length);

    // Promoted by the page's address, it wears what the sheet showed.
    const href = promoteHref(shown.seed, ref.ref, ref.revision, "Night vendor");
    const d = promotedFrom(href.slice(href.indexOf("?")))!;
    if (d.look.kind !== "seed") throw new Error("a promoted person is drawn from its seed");
    d.dress = sheetDress(d.look, state, bookOf(state, null));
    expect(personWear(d, state).wear).toEqual(shownWear);

    // A lock let go, the look fixed by hand to what it is, and the lock set again: every part is locked.
    setLock(d.look, "face", false);
    expect(setByHand(d, "skin", shown.look[LOOK_SKIN]!, state, bookOf(state, null))).toBe(true);
    expect((d.look as LookDraft).kind).toBe("bytes");
    setLock(d.look, "face", true);
    expect(PART_NAMES.every((p) => isLocked(d.look, p))).toBe(true);
    const person = await saveDraft(io, "person", d, personDoc(d, state, bookOf(state, null)), new Edits());
    state = stateOf(person);

    // What the store keeps, and the person reopened, are the sheet's to the byte.
    const listed = state.people.find((p) => p.id === d.id)!;
    expect(listed.doc.look).toEqual([...shown.look]);
    expect(listed.doc.wardrobe).toEqual(worn.worn);
    const book = bookOf(state, null), again = draftOf(listed, state, book);
    expect([...lookBytes(again.look, state, book)!]).toEqual([...shown.look]);
    expect(personWear(again, state).wear).toEqual(shownWear);
    expect(PART_NAMES.filter((p) => !isLocked(again.look, p))).toEqual([]);
  } finally {
    store.close();
  }
});
