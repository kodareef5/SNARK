// The populations admin page's logic (client/core/admin/populations.ts): a population's fields edited within the
// store's limits, its sheet of 24 people, and the gate that an outfit added changes no face on the sheet.
import { expect, test } from "bun:test";
import { readPopulation } from "../../shared/people/doc.ts";
import { POPULATIONS } from "../../content/people/defaults.ts";
import { promoteHref, storeStateOf, type StoreState } from "../../client/core/admin/people.ts";
import {
  SHEET_SIZE, addOutfit, docOf, draftDef, draftOfBuiltIn, draftOfListed, pictureKey, populationFault, promoteRef, removeOutfit, setLabel, setOutfitWeight, setPiece,
  setRegionSpan, setShare, setSpan, setWeight, sheetChanges, sheetOf, sheetSeeds, weightsOf,
} from "../../client/core/admin/populations.ts";

const S: StoreState = storeStateOf({
  revision: 1, manifest: null, caps: {}, editions: [], people: [], outfits: [], populations: [], builtIns: POPULATIONS,
  garments: [{ id: "core:tee", label: "plain tee", slot: "top", dyes: true, cut: null }],
  armour: [{ id: "core:cloth_shirt", label: "Cloth shirt", slot: 1 }, { id: "core:cloth_pants", label: "Cloth pants", slot: 3 }],
})!;
const CITY = POPULATIONS[0]!;
const FACE_PARTS = ["sex", "figure", "body", "skin", "hair", "beard", "brows", "face"];

test("a sheet is 24 people from 24 seeds, the same for the same base", () => {
  const seeds = sheetSeeds(7);
  expect(seeds.length).toBe(SHEET_SIZE);
  expect(new Set(seeds).size).toBe(SHEET_SIZE);
  expect(sheetSeeds(7)).toEqual(seeds);
  expect(sheetSeeds(8)).not.toEqual(seeds);
  const sheet = sheetOf(CITY, seeds);
  expect(new Set(sheet.map(pictureKey)).size).toBe(SHEET_SIZE);
});

test("adding a shirt to a population's outfits changes no face on the sheet", () => {
  for (const base of [1, 2, 3]) {
    const d = draftOfBuiltIn(CITY), seeds = sheetSeeds(base);
    const before = sheetOf(draftDef(d), seeds);
    expect(addOutfit(d.doc, ["core:cloth_shirt"], 1)).toBe(true);
    const after = sheetOf(draftDef(d), seeds);
    const changes = sheetChanges(before, after);
    expect(changes.every((c) => c.parts.length === 0)).toBe(true);
    expect(after.map((p) => [...p.look])).toEqual(before.map((p) => [...p.look]));
    // Everyone now wears something, where the city crowd wore its role's clothes.
    expect(after.every((p) => p.wear.join() === "core:cloth_shirt")).toBe(true);
    // A second outfit changes who wears which, and still no face.
    addOutfit(d.doc, ["core:tee", "core:cloth_pants"], 2);
    const again = sheetOf(draftDef(d), seeds);
    expect(sheetChanges(after, again).every((c) => c.parts.length === 0)).toBe(true);
    expect(sheetChanges(after, again).some((c) => c.wear)).toBe(true);
  }
});

test("a shirt added to an existing outfit changes no face either", () => {
  const beach = draftOfBuiltIn(POPULATIONS[1]!), seeds = sheetSeeds(4);
  const before = sheetOf(draftDef(beach), seeds);
  setPiece(beach.doc, 0, "core:cloth_shirt", true);
  const after = sheetOf(draftDef(beach), seeds);
  expect(sheetChanges(before, after).every((c) => c.parts.length === 0)).toBe(true);
  expect(after.filter((p) => p.outfit === 0).every((p) => p.wear.includes("core:cloth_shirt"))).toBe(true);
});

test("an edit to one part's weights changes that part alone", () => {
  const d = draftOfBuiltIn(CITY), seeds = sheetSeeds(5);
  const before = sheetOf(draftDef(d), seeds);
  for (let i = 0; i < 5; i++) setWeight(d.doc, "hair.men", i, i === 0 ? 1 : 0);
  const changes = sheetChanges(before, sheetOf(draftDef(d), seeds));
  const parts = new Set(changes.flatMap((c) => c.parts));
  expect([...parts]).toEqual(["hair"]);
  const face = draftOfBuiltIn(CITY);
  setShare(face.doc, "face", 0.9);
  expect(new Set(sheetChanges(before, sheetOf(draftDef(face), seeds)).flatMap((c) => c.parts))).toEqual(new Set(["face"]));
  expect(FACE_PARTS).toContain("face");
});

test("the fields stay within the store's limits and the store reads the draft", () => {
  const d = draftOfBuiltIn(CITY);
  setLabel(d.doc, "Night market crowd");
  setShare(d.doc, "women", 4);
  setShare(d.doc, "beard.men", 0.8);
  setSpan(d.doc, "age", 0, 0.9);
  setSpan(d.doc, "age", 1, 0.2);
  setRegionSpan(d.doc, "waist", [0.5, -1]);
  setWeight(d.doc, "brows", 2, 5);
  setSpan(d.doc, "grey", null, 0);
  expect([d.doc.women, d.doc.beard.men, d.doc.age, d.doc.regions?.waist, weightsOf(d.doc, "brows")]).toEqual([1, 0.8, [0.2, 0.2], [0.5, 0.5], [1, 1, 5, 1, 1, 1, 1, 1]]);
  expect(d.doc.grey).toBeUndefined();
  expect(populationFault(d.doc, S)).toBeNull();
  expect(typeof readPopulation(d.doc as unknown as Record<string, unknown>)).toBe("object");
  setRegionSpan(d.doc, "waist", null);
  expect(d.doc.regions).toBeUndefined();
  setWeight(d.doc, "brows", null, 0);
  expect(d.doc.brows).toBeUndefined();
  for (let i = 0; i < 10; i++) setWeight(d.doc, "skin", i, 0);
  expect(populationFault(d.doc, S)).toContain("skin");
});

test("an outfit's pieces are garments or armour the world has", () => {
  const d = draftOfBuiltIn(CITY);
  addOutfit(d.doc, ["core:cloth_shirt"]);
  setPiece(d.doc, 0, "core:tee", true);
  setOutfitWeight(d.doc, 0, 3);
  expect(d.doc.outfits).toEqual([{ wear: ["core:cloth_shirt", "core:tee"], weight: 3 }]);
  expect(populationFault(d.doc, S)).toBeNull();
  setPiece(d.doc, 0, "core:no_such", true);
  expect(populationFault(d.doc, S)).toContain("neither a garment nor armour");
  setPiece(d.doc, 0, "core:no_such", false);
  setPiece(d.doc, 0, "core:cloth_shirt", false);
  setPiece(d.doc, 0, "core:tee", false);
  expect(populationFault(d.doc, S)).toContain("wears nothing");
  removeOutfit(d.doc, 0);
  expect(d.doc.outfits).toBeUndefined();
  for (let k = 0; k < 32; k++) expect(addOutfit(d.doc, ["core:tee"])).toBe(true);
  expect(addOutfit(d.doc, ["core:tee"])).toBe(false);
});

test("a person is promoted only from a saved population, at the revision the sheet showed", () => {
  const built = draftOfBuiltIn(CITY);
  expect(promoteRef(built, false)).toEqual({ ref: "core:people_city", revision: 0 });
  expect(promoteRef(built, true)).toBeNull();
  const mine = draftOfListed({ id: 3, rev: 2, retired: false, doc: docOf(CITY) });
  expect(promoteRef(mine, false)).toEqual({ ref: 3, revision: 2 });
  expect(draftDef(mine)).toMatchObject({ id: "population/3" });
  expect(promoteHref(sheetSeeds(1)[0]!, 3, 2)).toStartWith("/admin/people/?seed=");
});
