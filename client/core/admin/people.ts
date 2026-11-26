// The people admin page, its parts that are not the page's wiring (client/admin/people.ts): the store's state as both
// people pages read it, a named person's draft and its look as a seed or as fixed bytes, each part locked or drawn again
// alone, the hand controls, the outfit, the save and retire calls with their answers, what the person stage is sent, and
// a person bound to a Cast role. The populations page (populations.ts) shares the state, the calls and the stage parts.

import {
  BEARD_STYLES, FACE_COUNT, HAIR_STYLES, LOOK_AGE, LOOK_BEARD, LOOK_BEARD_LENGTH, LOOK_BROW, LOOK_BYTES, LOOK_COMPLEXION, LOOK_EYE_COLOR, LOOK_FACE, LOOK_HAIR,
  LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH, LOOK_MUSCLE, LOOK_REGIONS, LOOK_SEX, LOOK_SKIN, LOOK_WEIGHT, REGIONS, REGION_COUNT, SEX_LABELS, regionOf,
  setRegion, validLook,
} from "../../../shared/anim/look.ts";
import type { PopulationDef } from "../../../shared/content/kinds/populations.ts";
import {
  NOTES_MAX, PART_NAMES, RECORD_NAME_MAX, editionName, readPeopleManifest, readPerson, storePopulation, type Dye, type OutfitDoc, type PartName, type PersonDoc,
  type PersonLook, type PopulationDoc, type PopulationRef, type WornDoc,
} from "../../../shared/people/doc.ts";
import { partSeed, personFrom, sexOf, wardrobeFrom } from "../../../shared/people/person.ts";
import { STAGE_SLOTS, type StageCommand, type StageGarment } from "../../../shared/people/stage.ts";
import { WARDROBE_NAMES, WARDROBE_SLOTS } from "../../../shared/sim/items.ts";
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES } from "../../../shared/pack/palette.ts";
import { esc } from "./format.ts";
import { BUSY_WAITS, editionPrintKey, stateOf, type Answer, type GarmentChoice, type ListedEdition, type PeopleState } from "./wardrobe.ts";

// ---- The store's state, as both people pages read it ----

/** A thing of a kind at its latest revision, as /admin/people/state lists it. */
export interface Listed<T> {
  readonly id: number;
  readonly rev: number;
  readonly retired: boolean;
  readonly by?: string;
  readonly at?: number;
  readonly doc: T;
}
/** An item a population's outfit may name that is armour, by its armour slot (hat, shirt, gloves, pants, boots). */
export interface ArmourChoice {
  readonly id: string;
  readonly label: string;
  readonly slot: number;
}
export interface StoreState extends PeopleState {
  readonly armour: readonly ArmourChoice[];
  readonly people: readonly Listed<PersonDoc>[];
  readonly outfits: readonly Listed<OutfitDoc>[];
  readonly populations: readonly Listed<PopulationDoc>[];
  readonly builtIns: readonly PopulationDef[];
}

const listOf = <T>(v: unknown): Listed<T>[] => (Array.isArray(v) ? (v as Listed<T>[]).filter((x) => Number.isSafeInteger(x?.id) && Number.isSafeInteger(x?.rev) && x.doc) : []);

/** The state a route answered, or null where the answer is not one. */
export function storeStateOf(answer: Record<string, unknown>): StoreState | null {
  const base = stateOf(answer);
  if (!base) return null;
  return {
    ...base, armour: Array.isArray(answer.armour) ? (answer.armour as ArmourChoice[]) : [], people: listOf<PersonDoc>(answer.people), outfits: listOf<OutfitDoc>(answer.outfits),
    populations: listOf<PopulationDoc>(answer.populations), builtIns: Array.isArray(answer.builtIns) ? (answer.builtIns as PopulationDef[]) : [],
  };
}

/** Every revision of the admin populations a page holds: the manifest's, and the state's latest. Keyed "id/rev". */
export type PopulationBook = ReadonlyMap<string, PopulationDoc>;

export function bookOf(state: StoreState, manifest: unknown): Map<string, PopulationDoc> {
  const book = new Map<string, PopulationDoc>();
  for (const p of readPeopleManifest(manifest).populations) book.set(`${p.id}/${p.rev}`, p.population);
  for (const p of state.populations) book.set(`${p.id}/${p.rev}`, p.doc);
  return book;
}

/** A population by its content id or store id at revision `rev`, as the generator takes it; undefined where not held. */
export function populationDef(state: StoreState, book: PopulationBook, ref: PopulationRef, rev: number): PopulationDef | undefined {
  if (typeof ref === "string") return state.builtIns.find((p) => p.id === ref && p.revision === rev);
  const doc = book.get(`${ref}/${rev}`);
  return doc ? storePopulation(ref, rev, doc) : undefined;
}

/** The populations a person may be drawn from: the built-in ones, then the admin ones not retired, each at its latest. */
export function populationChoices(state: StoreState): { ref: PopulationRef; revision: number; label: string }[] {
  return [
    ...state.builtIns.map((p) => ({ ref: p.id as PopulationRef, revision: p.revision, label: p.label })),
    ...state.populations.filter((p) => !p.retired).map((p) => ({ ref: p.id as PopulationRef, revision: p.rev, label: p.doc.label })),
  ];
}

export const refKey = (ref: PopulationRef): string => (typeof ref === "number" ? `store:${ref}` : ref);
export const refOfKey = (key: string): PopulationRef => (key.startsWith("store:") ? Number(key.slice(6)) : key);

/** The latest revision of population `ref`, or undefined. */
export function latestRevision(state: StoreState, ref: PopulationRef): number | undefined {
  return typeof ref === "string" ? state.builtIns.find((p) => p.id === ref)?.revision : state.populations.find((p) => p.id === ref)?.rev;
}

export function populationLabel(state: StoreState, book: PopulationBook, ref: PopulationRef, rev: number): string {
  if (typeof ref === "string") return state.builtIns.find((p) => p.id === ref)?.label ?? ref;
  return book.get(`${ref}/${rev}`)?.label ?? state.populations.find((p) => p.id === ref)?.doc.label ?? `population ${ref}`;
}

// ---- A person's parts ----

/** The look bytes each part writes (shared/people/person.ts). An outfit writes none. */
export const PART_BYTES: Readonly<Record<PartName, readonly number[]>> = {
  sex: [LOOK_SEX],
  figure: [LOOK_AGE, LOOK_WEIGHT, LOOK_MUSCLE],
  body: Array.from({ length: REGION_COUNT }, (_, r) => LOOK_REGIONS + r),
  skin: [LOOK_SKIN, LOOK_EYE_COLOR, LOOK_COMPLEXION],
  hair: [LOOK_HAIR, LOOK_HAIR_COLOR, LOOK_HAIR_COLOR_2, LOOK_HAIR_LENGTH],
  beard: [LOOK_BEARD, LOOK_BEARD_LENGTH],
  brows: [LOOK_BROW],
  face: Array.from({ length: FACE_COUNT }, (_, f) => LOOK_FACE + f),
  outfit: [],
};

export const PART_WORDS: Readonly<Record<PartName, string>> = {
  sex: "Sex", figure: "Age and figure", body: "Body shape", skin: "Skin and eyes", hair: "Hair", beard: "Beard", brows: "Brows", face: "Face", outfit: "Outfit",
};

export const HAIR_COLOUR_WORDS: readonly string[] = ["blond", "dark blond", "ginger", "brown", "dark brown", "near black", "black", "grey", "white", "dyed red"];
export const EYE_WORDS: readonly string[] = ["brown", "dark brown", "blue", "green", "grey", "amber"];

const signed = (b: number): number => (b > 127 ? b - 256 : b) / 127;
const pct = (b: number): string => `${Math.round(signed(b) * 100)}`;

/** What part `part` of `look` is, in a few words. */
export function partSummary(part: PartName, look: Uint8Array): string {
  switch (part) {
    case "sex":
      return SEX_LABELS[look[LOOK_SEX]!] ?? "?";
    case "figure":
      return `age ${pct(look[LOOK_AGE]!)}, weight ${pct(look[LOOK_WEIGHT]!)}, muscle ${pct(look[LOOK_MUSCLE]!)}`;
    case "body": {
      let far = 0, at = 0;
      for (let r = 0; r < REGION_COUNT; r++) if (Math.abs(regionOf(look, r)) > Math.abs(far)) [far, at] = [regionOf(look, r), r];
      return far === 0 ? "as modelled" : `most of all ${REGIONS[at]!.label.toLowerCase()} ${far > 0 ? "+" : ""}${Math.round(far * 100)}`;
    }
    case "skin":
      return `tone ${look[LOOK_SKIN]! + 1} of ${SKIN_TONES}, ${EYE_WORDS[look[LOOK_EYE_COLOR]!] ?? "?"} eyes`;
    case "hair": {
      const two = look[LOOK_HAIR_COLOR_2]!;
      return `${HAIR_STYLES[look[LOOK_HAIR]!]?.label ?? "?"}, ${HAIR_COLOUR_WORDS[look[LOOK_HAIR_COLOR]!] ?? "?"}${two ? ` with ${HAIR_COLOUR_WORDS[two - 1]}` : ""}`;
    }
    case "beard":
      return look[LOOK_BEARD] ? `${BEARD_STYLES[look[LOOK_BEARD]!]?.label ?? "?"}, grown ${look[LOOK_BEARD_LENGTH]}` : "none";
    case "brows":
      return `style ${look[LOOK_BROW]! + 1}`;
    case "face": {
      let sum = 0;
      for (let f = 0; f < FACE_COUNT; f++) sum += Math.abs(signed(look[LOOK_FACE + f]!));
      return `strays ${Math.round((sum / FACE_COUNT) * 100)} from the mean`;
    }
    case "outfit":
      return "";
  }
}

/** The parts whose bytes differ between two looks. */
export function partsChanged(a: Uint8Array, b: Uint8Array): PartName[] {
  return PART_NAMES.filter((p) => PART_BYTES[p].some((i) => a[i] !== b[i]));
}

// ---- A named person's draft ----

export interface SeedLook {
  readonly kind: "seed";
  seed: number;
  population: PopulationRef;
  revision: number;
  locks: Partial<Record<PartName, number>>;
}
/** A look kept as its bytes. `drawn` is the seed form it was made from, to go back to; `locked` parts keep through a draw. */
export interface BytesLook {
  readonly kind: "bytes";
  bytes: number[];
  drawn: SeedLook | null;
  locked: PartName[];
}
export type LookDraft = SeedLook | BytesLook;

/** What a person wears: the role's own clothes, a store outfit, or a wardrobe of its own. */
export type Dress = { kind: "role" } | { kind: "outfit"; outfit: number } | { kind: "wardrobe"; slots: (WornDoc | null)[] };

export interface PersonDraft {
  id: number | null;
  rev: number;
  name: string;
  notes: string;
  look: LookDraft;
  dress: Dress;
}

export const DEFAULT_POPULATION = "core:people_city";

/** A new person drawn from `seed` in the city crowd (or the first population the state has). */
export function newPerson(state: StoreState, seed: number): PersonDraft {
  const p = state.builtIns.find((x) => x.id === DEFAULT_POPULATION) ?? state.builtIns[0];
  return { id: null, rev: 0, name: "", notes: "", look: { kind: "seed", seed: seed >>> 0, population: p?.id ?? DEFAULT_POPULATION, revision: p?.revision ?? 1, locks: {} }, dress: { kind: "role" } };
}

/** A person promoted from a population's sheet: its seed in that population, every part locked to it. */
export function promotedPerson(seed: number, population: PopulationRef, revision: number, name = ""): PersonDraft {
  const locks: Partial<Record<PartName, number>> = {};
  for (const part of PART_NAMES) locks[part] = seed >>> 0;
  return { id: null, rev: 0, name, notes: "", look: { kind: "seed", seed: seed >>> 0, population, revision, locks }, dress: { kind: "role" } };
}

/** The promoted person a page address names (?seed=&population=&revision=), or null. */
export function promotedFrom(search: string): PersonDraft | null {
  const q = new Map<string, string>();
  for (const pair of search.replace(/^\?/, "").split("&")) {
    const at = pair.indexOf("=");
    if (at > 0) q.set(decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1).replace(/\+/g, " ")));
  }
  const seed = Number(q.get("seed")), revision = Number(q.get("revision")), pop = q.get("population") ?? "";
  if (!q.has("seed") || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(revision) || revision < 1 || pop === "") return null;
  const population: PopulationRef = /^\d+$/.test(pop) ? Number(pop) : pop;
  return promotedPerson(seed, population, revision, (q.get("name") ?? "").slice(0, RECORD_NAME_MAX));
}

/** The address the populations page sends a promoted person to. */
export function promoteHref(seed: number, population: PopulationRef, revision: number, name = ""): string {
  const q: [string, string][] = [["seed", String(seed >>> 0)], ["population", String(population)], ["revision", String(revision)]];
  if (name) q.push(["name", name]);
  return `/admin/people/?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** A listed person as a draft to edit. */
export function draftOf(l: Listed<PersonDoc>): PersonDraft {
  const d = l.doc, look: LookDraft = "bytes" in d.look ? { kind: "bytes", bytes: [...d.look.bytes], drawn: null, locked: [] } : { kind: "seed", ...d.look, locks: { ...d.look.locks } };
  const dress: Dress = d.outfit !== null ? { kind: "outfit", outfit: d.outfit } : d.wardrobe ? { kind: "wardrobe", slots: d.wardrobe.map((w) => (w ? { ...w, dye: [...w.dye] as unknown as Dye } : null)) } : { kind: "role" };
  return { id: l.id, rev: l.rev, name: d.name, notes: d.notes, look, dress };
}

/** The look's bytes, or null where its population is not held. */
export function lookBytes(look: LookDraft, state: StoreState, book: PopulationBook): Uint8Array | null {
  if (look.kind === "bytes") return Uint8Array.from(look.bytes);
  const p = populationDef(state, book, look.population, look.revision);
  return p ? personFrom(look.seed, p, undefined, look.locks).look : null;
}

/** A seed whose sex in `p` is `sex`, from `seed` on. */
export function seedOfSex(p: PopulationDef, sex: number, seed: number): number {
  for (let k = 0; k < 64; k++) {
    const s = k === 0 ? seed >>> 0 : partSeed(seed, 0x100 + k);
    if (sexOf(s, p) === sex) return s;
  }
  return seed >>> 0;
}

/** The population a fixed look draws its parts again from: the one it was drawn in, else the default. */
function drawingPopulation(look: BytesLook, state: StoreState, book: PopulationBook): PopulationDef | undefined {
  const d = look.drawn;
  return (d && populationDef(state, book, d.population, d.revision)) ?? state.builtIns.find((p) => p.id === DEFAULT_POPULATION) ?? state.builtIns[0];
}

/** Draws `parts` of a fixed look again from `seed`; its sex stays unless sex is one of them, so hair is drawn for it. */
function redrawBytes(look: BytesLook, parts: readonly PartName[], seed: number, state: StoreState, book: PopulationBook): void {
  const p = drawingPopulation(look, state, book);
  if (!p) return;
  const locks = parts.includes("sex") ? null : { sex: seedOfSex(p, look.bytes[LOOK_SEX]!, seed) };
  const fresh = personFrom(seed >>> 0, p, undefined, locks).look;
  for (const part of parts) for (const i of PART_BYTES[part]) look.bytes[i] = fresh[i]!;
}

export function isLocked(look: LookDraft, part: PartName): boolean {
  return look.kind === "seed" ? look.locks[part] !== undefined : look.locked.includes(part);
}

/**
 * Locks a part, or lets it go. A drawn look keeps a locked part's seed of its own, so a new seed for the person leaves it
 * as it is; a part let go follows the person's seed again, and may change. A fixed look only marks it.
 */
export function setLock(look: LookDraft, part: PartName, on: boolean): void {
  if (look.kind === "seed") {
    if (on) look.locks[part] ??= look.seed;
    else delete look.locks[part];
  } else {
    look.locked = look.locked.filter((p) => p !== part);
    if (on) look.locked.push(part);
  }
}

/** Draws part `part` again from `seed`, and only it: a drawn look gives the part that seed of its own, and so locks it. */
export function rerollPart(look: LookDraft, part: PartName, seed: number, state: StoreState, book: PopulationBook): void {
  if (look.kind === "seed") look.locks[part] = seed >>> 0;
  else if (part !== "outfit") redrawBytes(look, [part], seed, state, book);
}

/** Draws the person again from `seed`: every part not locked changes. */
export function drawAgain(look: LookDraft, seed: number, state: StoreState, book: PopulationBook): void {
  if (look.kind === "seed") look.seed = seed >>> 0;
  else redrawBytes(look, PART_NAMES.filter((p) => p !== "outfit" && !look.locked.includes(p)), seed, state, book);
}

/** A drawn look in population `ref` at its latest revision; the seed and locks stay. A fixed look draws from it next. */
export function choosePopulation(d: PersonDraft, ref: PopulationRef, state: StoreState): void {
  const revision = latestRevision(state, ref);
  if (revision === undefined) return;
  if (d.look.kind === "seed") {
    d.look.population = ref;
    d.look.revision = revision;
  } else d.look.drawn = { kind: "seed", seed: d.look.drawn?.seed ?? 0, population: ref, revision, locks: {} };
}

/** The controls a look has that are set by hand. Each turns a drawn look into fixed bytes. */
export type HandField = "sex" | "skin" | "eyes" | "hair" | "hairColour" | "beard" | "age" | "weight" | "muscle" | `region:${number}`;

export const HAND_BYTES: Readonly<Record<Exclude<HandField, `region:${number}`>, number>> = {
  sex: LOOK_SEX, skin: LOOK_SKIN, eyes: LOOK_EYE_COLOR, hair: LOOK_HAIR, hairColour: LOOK_HAIR_COLOR, beard: LOOK_BEARD, age: LOOK_AGE, weight: LOOK_WEIGHT, muscle: LOOK_MUSCLE,
};
/** How many choices a picked field has; a slider is -1..1. */
export const HAND_CHOICES: Readonly<Partial<Record<HandField, number>>> = { sex: 2, skin: SKIN_TONES, eyes: EYE_COLORS, hair: HAIR_STYLES.length, hairColour: HAIR_COLORS, beard: BEARD_STYLES.length };

/**
 * Sets a hand control: a choice's index, or a slider's -1..1. A drawn look becomes its bytes first, and keeps the seed
 * form it came from to go back to; an untouched look stays a seed, so a population edit never moves it.
 */
export function setByHand(d: PersonDraft, field: HandField, value: number, state: StoreState, book: PopulationBook): boolean {
  if (d.look.kind === "seed") {
    const bytes = lookBytes(d.look, state, book);
    if (!bytes) return false;
    const drawn = { ...d.look, locks: { ...d.look.locks } };
    d.look = { kind: "bytes", bytes: [...bytes], drawn, locked: PART_NAMES.filter((p) => drawn.locks[p] !== undefined) };
  }
  const b = Uint8Array.from(d.look.bytes);
  if (field.startsWith("region:")) setRegion(b, Number(field.slice(7)), value);
  else {
    const at = HAND_BYTES[field as keyof typeof HAND_BYTES], n = HAND_CHOICES[field];
    if (n !== undefined) b[at] = Math.max(0, Math.min(n - 1, Math.round(value)));
    else b[at] = Math.floor(Math.max(-1, Math.min(1, value)) * 127 + 0.5) & 255;
  }
  if (field === "beard" && b[LOOK_BEARD] === 0) b[LOOK_BEARD_LENGTH] = 0;
  d.look.bytes = [...b];
  return true;
}

/** A fixed look back to the seed form it was made from; false where it was not made from one. */
export function backToDrawn(d: PersonDraft): boolean {
  if (d.look.kind !== "bytes" || !d.look.drawn) return false;
  d.look = { ...d.look.drawn, locks: { ...d.look.drawn.locks } };
  return true;
}

/** A hand control's value in `look`: a choice's index or a slider's -1..1. */
export function handValue(look: Uint8Array, field: HandField): number {
  if (field.startsWith("region:")) return regionOf(look, Number(field.slice(7)));
  const b = look[HAND_BYTES[field as keyof typeof HAND_BYTES]]!;
  return HAND_CHOICES[field] !== undefined ? b : signed(b);
}

// ---- What is sent and what is wrong ----

/** The person as the store keeps it. */
export function personDoc(d: PersonDraft): PersonDoc {
  const l = d.look;
  const look: PersonLook = l.kind === "bytes" ? { bytes: [...l.bytes] } : { seed: l.seed >>> 0, population: l.population, revision: l.revision, locks: { ...l.locks } };
  return {
    name: editionName(d.name) ?? d.name, look, outfit: d.dress.kind === "outfit" ? d.dress.outfit : null,
    wardrobe: d.dress.kind === "wardrobe" ? d.dress.slots.map((w) => (w ? { garment: w.garment, edition: w.edition, dye: [...w.dye] as unknown as Dye } : null)) : null, notes: d.notes,
  };
}

export interface Fault {
  /** The field it is at: name, notes, look, outfit, slot:<n>. */
  readonly at: string;
  readonly text: string;
}

/** Everything wrong with `d` as the store would judge it, a line each. */
export function personFaults(d: PersonDraft, state: StoreState, book: PopulationBook): Fault[] {
  const out: Fault[] = [];
  if (editionName(d.name) === null) out.push({ at: "name", text: `Give the person a name of 1 to ${RECORD_NAME_MAX} letters.` });
  if (d.notes.length > NOTES_MAX) out.push({ at: "notes", text: `Notes are ${NOTES_MAX} letters at most.` });
  if (d.look.kind === "seed" && !populationDef(state, book, d.look.population, d.look.revision)) out.push({ at: "look", text: `This page does not hold ${String(d.look.population)} at revision ${d.look.revision}. Choose a population.` });
  if (d.look.kind === "bytes" && !validLook(Uint8Array.from(d.look.bytes))) out.push({ at: "look", text: `A fixed look is the ${LOOK_BYTES} bytes of a valid look.` });
  if (d.dress.kind === "outfit") {
    const id = d.dress.outfit;
    if (!state.outfits.some((o) => o.id === id)) out.push({ at: "outfit", text: `There is no outfit ${id}.` });
  }
  if (d.dress.kind === "wardrobe") {
    d.dress.slots.forEach((w, slot) => {
      if (!w) return;
      const g = state.garments.find((x) => x.id === w.garment);
      if (!g || g.slot !== WARDROBE_NAMES[slot]) out.push({ at: `slot:${slot}`, text: `Choose a ${WARDROBE_NAMES[slot]} for slot ${slot + 1}, or nothing.` });
      else if (!g.dyes && w.dye.some((c) => c !== 0)) out.push({ at: `slot:${slot}`, text: `The ${g.label} keeps its own colours.` });
      else if (w.edition !== 0 && !state.editions.some((e) => e.id === w.edition && e.garment === w.garment)) out.push({ at: `slot:${slot}`, text: `Edition ${w.edition} is not one of the ${g.label}.` });
    });
    if (d.dress.slots.every((w) => !w)) out.push({ at: "outfit", text: "The wardrobe wears nothing: put something on, or wear the role's own clothes." });
  }
  // The store's own reading catches what the lines above do not.
  if (out.length === 0) {
    const read = readPerson(personDoc(d) as unknown as Record<string, unknown>);
    if (typeof read === "string") out.push({ at: "look", text: read });
  }
  return out;
}

/** An empty wardrobe of five slots. */
export const emptyWardrobe = (): (WornDoc | null)[] => new Array<WornDoc | null>(WARDROBE_SLOTS).fill(null);

/** The garments slot `slot` may wear. */
export const garmentsFor = (state: StoreState, slot: number): GarmentChoice[] => state.garments.filter((g) => g.slot === WARDROBE_NAMES[slot]);

/** The editions of `garment`, retired ones last. */
export const editionsOf = (state: StoreState, garment: string): ListedEdition[] => state.editions.filter((e) => e.garment === garment).sort((a, b) => Number(a.retired) - Number(b.retired) || a.id - b.id);

// ---- Saving and retiring ----

export interface SaveIo {
  save(body: { kind: string; id: number | null; rev: number; doc?: unknown; copyOf?: string; label?: string }): Promise<Answer>;
  retire(body: { revision: number; id: number; retired: boolean; kind: string }): Promise<Answer>;
  wait(ms: number): Promise<void>;
}

export type SaveOutcome =
  | { readonly kind: "saved"; readonly id: number; readonly rev: number; readonly changed: boolean; readonly state: StoreState | null }
  | { readonly kind: "retired"; readonly state: StoreState | null }
  /** Someone saved it since the page read it: the store now, and the draft is kept. */
  | { readonly kind: "stale"; readonly state: StoreState | null; readonly error: string }
  | { readonly kind: "busy"; readonly error: string }
  | { readonly kind: "refused"; readonly status: number; readonly error: string };

const errorOf = (a: Answer): string => (typeof a.answer.error === "string" ? a.answer.error : a.status === 0 ? "The server could not be reached." : `The server answered ${a.status}.`);

async function patient(call: () => Promise<Answer>, io: Pick<SaveIo, "wait">, busy: (attempt: number, ms: number) => void): Promise<Answer> {
  let a = await call();
  for (let k = 0; a.status === 503 && k < BUSY_WAITS.length; k++) {
    busy(k + 1, BUSY_WAITS[k]!);
    await io.wait(BUSY_WAITS[k]!);
    a = await call();
  }
  return a;
}

function outcomeOf(a: Answer): SaveOutcome {
  if (a.status === 200 && Number.isSafeInteger(a.answer.id)) return { kind: "saved", id: a.answer.id as number, rev: a.answer.rev as number, changed: a.answer.changed !== false, state: storeStateOf(a.answer) };
  if (a.status === 409) return { kind: "stale", state: storeStateOf(a.answer), error: errorOf(a) };
  if (a.status === 503) return { kind: "busy", error: errorOf(a) };
  return { kind: "refused", status: a.status, error: errorOf(a) };
}

/** Saves a thing of `kind`: a new one where `id` is null (from revision 0), else the revision after `rev`. */
export async function saveThing(io: SaveIo, kind: "person" | "outfit" | "population", id: number | null, rev: number, doc: unknown, busy: (attempt: number, ms: number) => void = () => {}): Promise<SaveOutcome> {
  return outcomeOf(await patient(() => io.save({ kind, id, rev: id === null ? 0 : rev, doc }), io, busy));
}

/** A new admin population copied from built-in population `id`. */
export async function copyPopulation(io: SaveIo, id: string, label: string | undefined, busy: (attempt: number, ms: number) => void = () => {}): Promise<SaveOutcome> {
  return outcomeOf(await patient(() => io.save({ kind: "population", id: null, rev: 0, copyOf: id, ...(label ? { label } : {}) }), io, busy));
}

/** Retires a thing of `kind`, or brings it back, over store revision `revision`. */
export async function retireThing(io: SaveIo, kind: "person" | "outfit" | "population", id: number, retired: boolean, revision: number, busy: (attempt: number, ms: number) => void = () => {}): Promise<SaveOutcome> {
  const a = await patient(() => io.retire({ revision, id, retired, kind }), io, busy);
  if (a.status === 200) return { kind: "retired", state: storeStateOf(a.answer) };
  return outcomeOf(a);
}

/** What the page says of an outcome; `what` names the thing ("person 3"). */
export function saveText(o: SaveOutcome, what: string): string {
  switch (o.kind) {
    case "saved":
      return o.changed ? `Saved ${what}, revision ${o.rev}.` : `Nothing changed in ${what}.`;
    case "retired":
      return "Saved.";
    case "stale":
      return `Not saved: ${o.error} Your draft is kept: the list shows the store now, and the button saves over it.`;
    case "busy":
      return `Not saved: the store stayed busy after ${BUSY_WAITS.length} tries. Your draft is kept; try again.`;
    case "refused":
      return `Not saved: ${o.error}`;
  }
}

/** After a stale save: the draft is kept and saved over the revision the store has now. */
export function rebase(d: { id: number | null; rev: number }, state: StoreState | null, list: (s: StoreState) => readonly Listed<unknown>[]): void {
  if (!state || d.id === null) return;
  const now = list(state).find((x) => x.id === d.id);
  if (now) d.rev = now.rev;
}

// ---- The person stage ----

/** What the stage is sent for what a person wears: armour as gear, garments as the wardrobe, and the prints they name. */
export interface StageWear {
  readonly gear: Extract<StageCommand, { kind: "gear" }>;
  readonly wardrobe: Extract<StageCommand, { kind: "wardrobe" }>;
  readonly prints: readonly { readonly key: string; readonly url: string }[];
}

/** The stage's commands for pieces worn: armour by its slot, garments by theirs, each edition's print by its key. */
export function stageWear(state: StoreState, worn: readonly (WornDoc | null)[], armour: readonly string[] = []): StageWear {
  const armor: (string | null)[] = new Array<string | null>(STAGE_SLOTS).fill(null);
  for (const id of armour) {
    const a = state.armour.find((x) => x.id === id);
    if (a && a.slot >= 0 && a.slot < STAGE_SLOTS) armor[a.slot] = a.id;
  }
  const slots: (StageGarment | null)[] = new Array<StageGarment | null>(STAGE_SLOTS).fill(null), prints: { key: string; url: string }[] = [];
  for (const w of worn) {
    if (!w) continue;
    const g = state.garments.find((x) => x.id === w.garment), at = g ? (WARDROBE_NAMES as readonly string[]).indexOf(g.slot) : -1;
    if (at < 0) continue;
    const e = w.edition ? state.editions.find((x) => x.id === w.edition) : undefined;
    const key = e?.print && e.printPath ? editionPrintKey(e.print.hash) : null;
    if (key && e?.printPath && !prints.some((p) => p.key === key)) prints.push({ key, url: e.printPath });
    // An edition's colours, then the dye over them: the stage takes one set of three.
    const dye = [0, 1, 2].map((k) => w.dye[k] || e?.colours[k] || 0) as [number, number, number];
    slots[at] = { item: w.garment, edition: w.edition, dye, print: key };
  }
  return { gear: { kind: "gear", held: null, armor }, wardrobe: { kind: "wardrobe", slots, hide: 0 }, prints };
}

/** Splits a population outfit's pieces into armour and garments worn plain. */
export function wearPieces(state: StoreState, wear: readonly string[]): { armour: string[]; worn: (WornDoc | null)[] } {
  const worn = emptyWardrobe(), armour: string[] = [];
  for (const id of wear) {
    const g = state.garments.find((x) => x.id === id);
    if (g) worn[(WARDROBE_NAMES as readonly string[]).indexOf(g.slot)] = { garment: id, edition: 0, dye: [0, 0, 0] };
    else armour.push(id);
  }
  return { armour, worn };
}

/** What a person draft wears on the stage, and a line saying so. `seed` stands for a body's own where the look is fixed. */
export function personWear(d: PersonDraft, state: StoreState, seed: number): { wear: StageWear; note: string } {
  if (d.dress.kind === "wardrobe") return { wear: stageWear(state, d.dress.slots), note: "Wears its own wardrobe." };
  if (d.dress.kind === "outfit") {
    const id = d.dress.outfit, o = state.outfits.find((x) => x.id === id);
    if (!o) return { wear: stageWear(state, []), note: `Outfit ${id} is not in the store.` };
    const s = d.look.kind === "seed" ? (d.look.locks.outfit ?? d.look.seed) : seed;
    return { wear: stageWear(state, wardrobeFrom(s >>> 0, o.doc)), note: d.look.kind === "seed" ? `Wears outfit ${id}, its choices drawn from the person's outfit seed.` : `Wears outfit ${id}; each body that plays the person draws its choices.` };
  }
  return { wear: stageWear(state, []), note: "Wears the clothes of the role it plays." };
}

// ---- Cast ----

/** What the people page reads of a world's cast.json (server/admin/cast.ts). */
export interface CastRoles {
  readonly roles: readonly { readonly key: string; readonly scene: string; readonly role: string; readonly person: number | null }[];
  readonly named: readonly { readonly id: string; readonly name: string; readonly person: number; readonly featured: boolean; readonly dead: boolean }[];
}

export function castRolesOf(json: unknown): CastRoles {
  const o = (json ?? {}) as Record<string, unknown>;
  return { roles: Array.isArray(o.roles) ? (o.roles as CastRoles["roles"]) : [], named: Array.isArray(o.named) ? (o.named as CastRoles["named"]) : [] };
}

/** The Cast op that has person `person` play role `key` ("<scene id>/<role>"), or null lets it go. */
export function roleOp(key: string, person: number | null): { op: "role"; scene: string; role: string; person: number | null } {
  const at = key.lastIndexOf("/");
  return { op: "role", scene: key.slice(0, at), role: key.slice(at + 1), person };
}

export const featureOp = (character: string): { op: "feature"; character: string } => ({ op: "feature", character });

/** The roles person `id` plays. */
export const rolesOf = (cast: CastRoles, id: number): CastRoles["roles"] => cast.roles.filter((r) => r.person === id);

// ---- The page's lists as HTML ----

const when = (ms: number | undefined): string => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "");

/** The named people, newest first, retired ones marked. */
export function peopleHtml(state: StoreState, selected: number | null): string {
  if (state.people.length === 0) return `<p class="dim">Nobody is named yet. Make a person, or promote one from a population's sheet.</p>`;
  return [...state.people].sort((a, b) => b.id - a.id).map((p) => {
    const look = "bytes" in p.doc.look ? "fixed look" : `drawn, seed ${p.doc.look.seed}`;
    return `<div class="named${p.retired ? " retired" : ""}${p.id === selected ? " picked" : ""}" data-person="${p.id}">
      <button data-open="${p.id}"><b>${esc(p.doc.name)}</b>${p.retired ? ` <span class="chip">retired</span>` : ""}<br><span class="faint">#${p.id} · revision ${p.rev} · ${look}${p.by ? ` · ${esc(p.by)}, ${when(p.at)}` : ""}</span></button>
    </div>`;
  }).join("");
}

/** The roles of a world's Cast as options, the ones this person plays marked. */
export function roleOptions(cast: CastRoles, state: StoreState, person: number | null): string {
  const name = (id: number | null) => (id === null ? "" : (state.people.find((p) => p.id === id)?.doc.name ?? `person ${id}`));
  return cast.roles.map((r) => `<option value="${esc(r.key)}">${esc(r.scene)} · ${esc(r.role)}${r.person === null ? "" : r.person === person ? " (this person)" : ` (${esc(name(r.person))})`}</option>`).join("");
}

/** The roles this person plays and who plays it in the world, with their buttons. */
export function castHtml(cast: CastRoles, person: number | null): string {
  if (person === null) return `<p class="faint">Save the person to give it a role.</p>`;
  const roles = rolesOf(cast, person);
  const plays = roles.length === 0 ? `<p class="faint">It plays no role in this world.</p>` : `<ul class="roles">${roles.map((r) => `<li data-plays="${esc(r.key)}">${esc(r.scene)} · ${esc(r.role)} <button data-letgo="${esc(r.key)}">Let go</button></li>`).join("")}</ul>`;
  const bodies = cast.named.filter((c) => c.person === person);
  const who = bodies.length === 0 ? `<p class="faint">Nobody plays it in the world now: a body is drawn when its scene starts.</p>` : `<ul class="roles">${bodies.map((c) => `<li>${esc(c.name)} <span class="faint">${esc(c.id)}${c.dead ? ", dead" : ""}</span> ${c.featured ? `<span class="chip">featured</span>` : `<button data-feature="${esc(c.id)}" title="Keep this body as it is">Feature</button>`}</li>`).join("")}</ul>`;
  return plays + who;
}
