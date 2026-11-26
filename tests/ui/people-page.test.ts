// The people admin page's logic (client/core/admin/people.ts): a person drawn from a seed with parts locked or drawn
// again alone, hand controls that fix the bytes, the outfit and what the stage wears, saves through 409 and 503, and
// a role bound through Cast's op.
import { expect, test } from "bun:test";
import { LOOK_FACE, LOOK_HAIR, LOOK_SEX, LOOK_SKIN, REGION_COUNT } from "../../shared/anim/look.ts";
import { PART_NAMES, readPerson, type PartName, type PersonDoc } from "../../shared/people/doc.ts";
import { personFrom } from "../../shared/people/person.ts";
import { POPULATIONS } from "../../content/people/defaults.ts";
import { cluster } from "../../client/core/admin/navigation.ts";
import {
  PART_BYTES, backToDrawn, bookOf, castHtml, castRolesOf, choosePopulation, draftOf, drawAgain, emptyWardrobe, featureOp, isLocked, lookBytes, newPerson, partsChanged,
  personDoc, personFaults, personWear, promoteHref, promotedFrom, rerollPart, retireThing, roleOp, rolesOf, saveText, saveThing, setByHand, setLock, storeStateOf,
  type PersonDraft, type SaveIo, type StoreState,
} from "../../client/core/admin/people.ts";
import type { Answer } from "../../client/core/admin/wardrobe.ts";

const answer = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  revision: 3, manifest: null, caps: {},
  garments: [
    { id: "core:plain_tee", label: "plain tee", slot: "top", dyes: true, cut: null },
    { id: "core:plain_trousers", label: "plain trousers", slot: "bottom", dyes: true, cut: null },
  ],
  armour: [{ id: "core:cloth_shirt", label: "Cloth shirt", slot: 1 }, { id: "core:cloth_hat", label: "Cloth hat", slot: 0 }],
  editions: [{ id: 1, garment: "core:plain_tee", colours: [34, 58, 11], print: { hash: "0123456789abcdef", width: 512, height: 512, place: {} }, name: "Sunrise", retired: false, printPath: "/media/print.0123456789abcdef.png" }],
  people: [], outfits: [{ id: 2, rev: 1, retired: false, doc: { name: "Vendor", slots: [{ choices: [{ garment: "core:plain_tee", edition: 1, weight: 1 }, { garment: "core:plain_tee", edition: 0, weight: 1 }], dye: [0, 0, 0] }, null, null, null, null] } }],
  populations: [], builtIns: POPULATIONS, ...extra,
});
const S: StoreState = storeStateOf(answer())!;
const BOOK = bookOf(S, null);
const bytes = (d: PersonDraft): Uint8Array => lookBytes(d.look, S, BOOK)!;

test("a new person is drawn from the city crowd and its doc is one the store reads", () => {
  const d = newPerson(S, 77);
  d.name = "Rosa";
  expect(bytes(d)).toEqual(personFrom(77, POPULATIONS[0]!).look);
  expect(personFaults(d, S, BOOK)).toEqual([]);
  expect(readPerson(personDoc(d) as unknown as Record<string, unknown>)).toEqual({ name: "Rosa", look: { seed: 77, population: "core:people_city", revision: POPULATIONS[0]!.revision, locks: {} }, outfit: null, wardrobe: null, notes: "" });
});

test("drawing one part again changes only that part's bytes and locks it", () => {
  for (const part of PART_NAMES) {
    if (part === "outfit" || part === "sex") continue;
    const d = newPerson(S, 1234), before = bytes(d);
    rerollPart(d.look, part, 999, S, BOOK);
    const after = bytes(d), changed = partsChanged(before, after);
    // A part drawn again may land on what it was; it never changes another part.
    expect(changed.every((p) => p === part)).toBe(true);
    expect(isLocked(d.look, part)).toBe(true);
  }
});

test("a locked part keeps through a new seed, and the others change", () => {
  const d = newPerson(S, 5);
  setLock(d.look, "face", true);
  setLock(d.look, "skin", true);
  const before = bytes(d);
  drawAgain(d.look, 6, S, BOOK);
  const after = bytes(d);
  for (const part of ["face", "skin"] as PartName[]) for (const i of PART_BYTES[part]) expect(after[i]).toBe(before[i]!);
  expect(partsChanged(before, after)).toContain("body");
  setLock(d.look, "face", false);
  expect(isLocked(d.look, "face")).toBe(false);
});

test("a hand control fixes the bytes, keeps the rest, and can go back to the seed", () => {
  const d = newPerson(S, 42), drawn = bytes(d);
  expect(setByHand(d, "skin", 9, S, BOOK)).toBe(true);
  expect(d.look.kind).toBe("bytes");
  const fixed = bytes(d);
  expect(fixed[LOOK_SKIN]).toBe(9);
  expect(partsChanged(drawn, fixed)).toEqual(drawn[LOOK_SKIN] === 9 ? [] : ["skin"]);
  setByHand(d, "region:3", 0.5, S, BOOK);
  expect(bytes(d)[1 + 3]).toBe(64);
  expect(personFaults({ ...d, name: "Fixed" }, S, BOOK)).toEqual([]);
  expect("bytes" in personDoc(d).look).toBe(true);
  expect(backToDrawn(d)).toBe(true);
  expect(bytes(d)).toEqual(drawn);
});

test("a fixed look drawn again keeps its sex and its locked parts", () => {
  const d = newPerson(S, 8);
  setByHand(d, "sex", 1, S, BOOK);
  setByHand(d, "hair", 3, S, BOOK);
  setLock(d.look, "hair", true);
  const before = bytes(d);
  drawAgain(d.look, 31337, S, BOOK);
  const after = bytes(d);
  expect([after[LOOK_SEX], after[LOOK_HAIR]]).toEqual([1, 3]);
  expect(partsChanged(before, after)).toContain("face");
  rerollPart(d.look, "face", 4, S, BOOK);
  expect(partsChanged(after, bytes(d)).every((p) => p === "face")).toBe(true);
  expect(bytes(d).slice(LOOK_FACE).some((b) => b !== after[LOOK_FACE])).toBe(true);
});

test("another population keeps the seed and locks and names its revision", () => {
  const d = newPerson(S, 3);
  setLock(d.look, "face", true);
  choosePopulation(d, "core:people_beach", S);
  expect(d.look).toMatchObject({ kind: "seed", seed: 3, population: "core:people_beach", revision: POPULATIONS.find((p) => p.id === "core:people_beach")!.revision, locks: { face: 3 } });
  expect(bytes(d)).toEqual(personFrom(3, POPULATIONS[1]!, undefined, { face: 3 }).look);
  d.look = { ...d.look, revision: 9 } as PersonDraft["look"];
  expect(personFaults({ ...d, name: "x" }, S, BOOK).map((f) => f.at)).toEqual(["look"]);
});

test("an admin population is drawn at the revision the person names", () => {
  const pop = { id: 4, rev: 2, retired: false, doc: { ...POPULATIONS[0]!, label: "Mine" } };
  const s = storeStateOf(answer({ populations: [pop] }))!;
  const older = { ...POPULATIONS[0]!, label: "Mine", women: 0 };
  const book = bookOf(s, { populations: [{ id: 4, rev: 1, population: older }] });
  const d = newPerson(s, 11);
  choosePopulation(d, 4, s);
  expect(d.look).toMatchObject({ population: 4, revision: 2 });
  d.look = { ...d.look, revision: 1 } as PersonDraft["look"];
  expect(lookBytes(d.look, s, book)![LOOK_SEX]).toBe(0);
});

test("a promoted person comes from its page address with every part locked to its seed", () => {
  const href = promoteHref(4242, 7, 3, "From the sheet");
  expect(href).toBe("/admin/people/?seed=4242&population=7&revision=3&name=From%20the%20sheet");
  const d = promotedFrom(href.slice(href.indexOf("?")))!;
  expect(d.look).toMatchObject({ kind: "seed", seed: 4242, population: 7, revision: 3 });
  expect(Object.keys((d.look as { locks: object }).locks).sort()).toEqual([...PART_NAMES].sort());
  expect(d.name).toBe("From the sheet");
  expect(promotedFrom(`?seed=x&population=core:people_city&revision=${POPULATIONS[0]!.revision}`)).toBeNull();
  expect(promotedFrom(`?seed=12&population=core%3Apeople_city&revision=${POPULATIONS[0]!.revision}`)!.look).toMatchObject({ population: "core:people_city" });
  // Locked to its own seed, it is the very person of the sheet.
  const p = promotedFrom(`?seed=12&population=core:people_city&revision=${POPULATIONS[0]!.revision}`)!;
  expect(lookBytes(p.look, S, BOOK)).toEqual(personFrom(12, POPULATIONS[0]!).look);
});

test("a wardrobe is judged by slot, dye and edition, and the stage wears it", () => {
  const d = newPerson(S, 1);
  d.name = "Dressed";
  const slots = emptyWardrobe();
  slots[0] = { garment: "core:plain_tee", edition: 1, dye: [0, 0, 9] };
  d.dress = { kind: "wardrobe", slots };
  expect(personFaults(d, S, BOOK)).toEqual([]);
  const { wear } = personWear(d, S, 1);
  expect(wear.wardrobe.slots[0]).toEqual({ item: "core:plain_tee", edition: 1, dye: [34, 58, 9], print: "print.0123456789abcdef" });
  expect(wear.prints).toEqual([{ key: "print.0123456789abcdef", url: "/media/print.0123456789abcdef.png" }]);
  slots[1] = { garment: "core:plain_tee", edition: 0, dye: [0, 0, 0] };
  expect(personFaults(d, S, BOOK).map((f) => f.at)).toEqual(["slot:1"]);
  slots[1] = { garment: "core:plain_trousers", edition: 1, dye: [0, 0, 0] };
  expect(personFaults(d, S, BOOK).map((f) => f.at)).toEqual(["slot:1"]);
  d.dress = { kind: "wardrobe", slots: emptyWardrobe() };
  expect(personFaults(d, S, BOOK).map((f) => f.at)).toEqual(["outfit"]);
});

test("a store outfit is drawn from the person's outfit seed, which a reroll changes alone", () => {
  const d = newPerson(S, 1);
  d.dress = { kind: "outfit", outfit: 2 };
  const editions = new Set<number>();
  const look = bytes(d);
  for (let s = 0; s < 16; s++) {
    rerollPart(d.look, "outfit", s, S, BOOK);
    editions.add(personWear(d, S, 0).wear.wardrobe.slots[0]!.edition);
  }
  expect([...editions].sort()).toEqual([0, 1]);
  expect(bytes(d)).toEqual(look);
  expect(personWear({ ...d, dress: { kind: "outfit", outfit: 9 } }, S, 0).note).toContain("not in the store");
});

test("a listed person opens as the draft it was saved from", () => {
  const doc: PersonDoc = { name: "Ana", look: { seed: 9, population: "core:people_city", revision: 1, locks: { hair: 4 } }, outfit: 2, wardrobe: null, notes: "vendor" };
  const d = draftOf({ id: 5, rev: 3, retired: false, doc });
  expect(personDoc(d)).toEqual(doc);
  expect([d.id, d.rev, d.dress]).toEqual([5, 3, { kind: "outfit", outfit: 2 }]);
  const fixed = draftOf({ id: 6, rev: 1, retired: false, doc: { ...doc, look: { bytes: [...personFrom(1, POPULATIONS[0]!).look] }, outfit: null } });
  expect([fixed.look.kind, fixed.dress.kind]).toEqual(["bytes", "role"]);
});

/** Calls answered in turn from `answers`, keeping what was sent. */
function calls(...answers: Answer[]): SaveIo & { sent: unknown[]; waited: number[] } {
  const sent: unknown[] = [], waited: number[] = [];
  const next = async (body: unknown): Promise<Answer> => (sent.push(body), answers.shift()!);
  return { sent, waited, save: next, retire: next, wait: async (ms) => void waited.push(ms) };
}

test("a save goes as the store's route takes it and says what it did", async () => {
  const io = calls({ status: 200, answer: { id: 7, rev: 1, changed: true, ...answer() } });
  const o = await saveThing(io, "person", null, 4, { name: "x" });
  expect(io.sent).toEqual([{ kind: "person", id: null, rev: 0, doc: { name: "x" } }]);
  expect(o).toMatchObject({ kind: "saved", id: 7, rev: 1 });
  expect(saveText(o, "person 7")).toBe("Saved person 7, revision 1.");
});

test("a stale save keeps the draft and says so; a busy store is tried again", async () => {
  const stale = calls({ status: 409, answer: { error: "The person 7 was saved in another page. Reload to see it.", ...answer({ people: [{ id: 7, rev: 3, retired: false, doc: {} }] }) } });
  const o = await saveThing(stale, "person", 7, 2, {});
  expect(o.kind).toBe("stale");
  expect(saveText(o, "person 7")).toStartWith("Not saved: The person 7 was saved in another page.");
  expect(o.kind === "stale" && o.state?.people[0]?.rev).toBe(3);
  const busy = calls({ status: 503, answer: { error: "busy" } }, { status: 503, answer: {} }, { status: 200, answer: { id: 7, rev: 4, changed: true } });
  const ok = await saveThing(busy, "person", 7, 3, {});
  expect([ok.kind, busy.waited]).toEqual(["saved", [250, 500]]);
  const gone = await retireThing(calls({ status: 404, answer: { error: "There is no person 9." } }), "person", 9, true, 3);
  expect(gone).toMatchObject({ kind: "refused", status: 404 });
});

test("a role is bound and let go through Cast's op, and a body playing it is featured", () => {
  expect(roleOp("cast:food_cart/vendor", 7)).toEqual({ op: "role", scene: "cast:food_cart", role: "vendor", person: 7 });
  expect(roleOp("cast:food_cart/vendor", null).person).toBeNull();
  expect(featureOp("c12")).toEqual({ op: "feature", character: "c12" });
  const cast = castRolesOf({ roles: [{ key: "cast:food_cart/vendor", scene: "Food cart", role: "vendor", person: 7 }, { key: "cast:a/b", scene: "A", role: "b", person: null }], named: [{ id: "c12", name: "Rosa Diaz", person: 7, featured: false, dead: false }] });
  expect(rolesOf(cast, 7).map((r) => r.key)).toEqual(["cast:food_cart/vendor"]);
  const html = castHtml(cast, 7);
  expect([html.includes('data-letgo="cast:food_cart/vendor"'), html.includes('data-feature="c12"')]).toEqual([true, true]);
  expect(castHtml(cast, null)).toContain("Save the person");
});

test("the people and populations pages are in the cluster's navigation", () => {
  expect(cluster.map(([slug]) => slug)).toEqual(expect.arrayContaining(["wardrobe", "people", "populations"]));
  expect(REGION_COUNT).toBe(22);
});
