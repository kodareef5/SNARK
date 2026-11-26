// What the cluster's people store holds (server/people/store.ts), as the server keeps it, the admin pages send it and the
// clients read its manifest. Every record is one revision of one thing of a kind, under an id that kind gives once and
// never again; a revision is appended and never changed or deleted. A garment edition has one revision only: its cut,
// colours and print are what it is, and a change is a new edition. A named person, an outfit and an admin population
// take a new revision at every save, under the id they were first given.

import { LOOK_BYTES, validLook } from "../anim/look.ts";
import { populations as populationKind, REGION_KEYS, type PopulationDef, type Span } from "../content/kinds/populations.ts";
import type { Checking } from "../content/kind.ts";
import { WARDROBE_SLOTS } from "../sim/items.ts";

/** The kinds of record the store holds. A new kind is appended; a kind's name is never reused. */
export const STORE_KINDS = ["edition", "person", "outfit", "population"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];
/** The kinds a save gives a new revision of. */
export const REVISED_KINDS = ["person", "outfit", "population"] as const;
export type RevisedKind = (typeof REVISED_KINDS)[number];

/** The highest id a kind gives: an edition id is a slot's u32 (Inventory.edition). 0 is the plain item. */
export const ID_MOST = 0xffffffff;
export const EDITION_NAME_MAX = 40;

/** A print's picture: a PNG of at most this many pixels a side, square or twice as wide as high. Chosen. */
export const PRINT_SIDE_MAX = 512;
/** The most bytes an uploaded print is: what a server takes in within half a millisecond of its thread. Chosen. */
export const PRINT_BYTES_MAX = 640 * 1024;
/** How far a print is scaled on its rectangle, either way. Chosen. */
export const PRINT_SCALE_MIN = 0.05;
export const PRINT_SCALE_MAX = 8;

/**
 * Where a print lies on its cut's print sheet (the cut's one UV map): the rectangle it is drawn in, from its corner `u`,
 * `v` and of width `w` and height `h`, all within 0 to 1; the picture scaled by `scale` about the rectangle's middle, 1
 * filling its width; and turned `turn` radians about the middle, counter-clockwise on the sheet.
 */
export interface PrintPlace {
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
  readonly scale: number;
  readonly turn: number;
}

/** An edition's print: its picture by hash (served at printPath) and its size in pixels, and where it lies. */
export interface EditionPrint {
  readonly hash: string;
  readonly width: number;
  readonly height: number;
  readonly place: PrintPlace;
}

/** A garment edition as every client reads it. */
export interface Edition {
  readonly id: number;
  /** The content id of the garment it is an edition of (an `item/garment`). */
  readonly garment: string;
  /** Three palette colours its regions are made in, 0 for the garment's own. A slot's dye goes over them. */
  readonly colours: readonly [number, number, number];
  readonly print: EditionPrint | null;
  readonly name: string;
}

/** An edition as an admin page sends it to be published: everything but the id the store gives. */
export type EditionDraft = Omit<Edition, "id">;

/** Who made a record and when (wall ms). Admin pages see it; players are never sent it. */
export interface Made {
  readonly by: string;
  readonly byId: string;
  readonly at: number;
}

/** The manifest clients fetch: every edition ever published, retired ones too, in id order. */
export interface PeopleManifest {
  readonly editions: readonly Edition[];
}

/** A hash is the first 16 hex digits of a SHA-256, which the media route keeps for good (server/files.ts). */
export const HASH = /^[0-9a-f]{16}$/;
export const peopleManifestPath = (id: string): string => `/media/people.${id}.json`;
export const printName = (hash: string): string => `print.${hash}.png`;
export const printPath = (hash: string): string => `/media/${printName(hash)}`;

const isNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const unit = (n: unknown): n is number => isNumber(n) && n >= 0 && n <= 1;

/** An edition's name as kept: one line, trimmed, or null where there is none or it is too long. */
export function editionName(sent: unknown): string | null {
  if (typeof sent !== "string") return null;
  const name = sent.replace(/\s+/g, " ").trim();
  return name.length > 0 && name.length <= EDITION_NAME_MAX ? name : null;
}

/**
 * The draft a page sent, as the store keeps it, or a sentence saying what is wrong with it. The garment is only checked to
 * be a content id here; the world checks it is a garment. A print's picture is checked to be uploaded by the store.
 */
export function readDraft(sent: Record<string, unknown>): EditionDraft | string {
  const name = editionName(sent.name);
  if (name === null) return `An edition's name is 1 to ${EDITION_NAME_MAX} letters.`;
  if (typeof sent.garment !== "string" || !/^[a-z0-9_]+:[a-z0-9_/]+$/.test(sent.garment)) return "Name the garment by its content id.";
  const c = sent.colours;
  if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return "An edition has three colours, each a palette number 0 to 255 (0 for the garment's own).";
  const draft = { garment: sent.garment, colours: [c[0], c[1], c[2]] as [number, number, number], name };
  if (sent.print === undefined || sent.print === null) return { ...draft, print: null };
  const p = sent.print as Record<string, unknown>;
  if (typeof p !== "object" || typeof p.hash !== "string" || !HASH.test(p.hash)) return "A print names its uploaded picture by its hash.";
  const at = p.place as Record<string, unknown> | undefined;
  if (!at || typeof at !== "object") return "A print says where it lies on the sheet.";
  const { u, v, w, h, scale, turn } = at;
  if (!unit(u) || !unit(v) || !unit(w) || !unit(h) || w === 0 || h === 0 || u + w > 1 || v + h > 1) return "A print's rectangle lies within the sheet, 0 to 1 each way, and is not empty.";
  if (!isNumber(scale) || scale < PRINT_SCALE_MIN || scale > PRINT_SCALE_MAX) return `A print's scale is ${PRINT_SCALE_MIN} to ${PRINT_SCALE_MAX}.`;
  if (!isNumber(turn) || Math.abs(turn) > Math.PI) return "A print's turn is -π to π radians.";
  // Its size is the picture's own, which the store reads from the uploaded file.
  return { ...draft, print: { hash: p.hash, width: 0, height: 0, place: { u, v, w, h, scale, turn } } };
}

// Named people, outfits and admin populations. Each is checked here for its shape only; the world checks what it names
// against its content and the store (server/admin/people-routes.ts).

/** A record's name: one line of 1 to this many letters. */
export const RECORD_NAME_MAX = EDITION_NAME_MAX;
export const NOTES_MAX = 1000;
/** The most garments one outfit slot chooses among, and the most outfits one population has. Chosen. */
export const CHOICES_MAX = 16;
export const POPULATION_OUTFITS_MAX = 32;
export const WEAR_MAX = 8;
/** The most a weight is, as the content kind takes it. */
export const WEIGHT_MAX = 1e6;

/** One revision of a thing of a kind, as the store holds it and admin pages are sent it. */
export interface Revision<T> {
  readonly id: number;
  readonly rev: number;
  readonly body: T;
  readonly made: Made;
}

/** The parts of a person the generator draws on streams of their own (shared/people/person.ts). */
export const PART_NAMES = ["sex", "figure", "body", "skin", "hair", "beard", "brows", "face", "outfit"] as const;
export type PartName = (typeof PART_NAMES)[number];
/** A seed of its own for some parts, which then stay as they are when the person's seed is drawn again. */
export type PartSeeds = Readonly<Partial<Record<PartName, number>>>;

/** A population by its content id, or an admin population by its store id. */
export type PopulationRef = string | number;

/** Three palette colours a piece is dyed, 0 for its own. */
export type Dye = readonly [number, number, number];

/** One piece worn: a garment, its edition (0 for the plain item) and its dye. */
export interface WornDoc {
  readonly garment: string;
  readonly edition: number;
  readonly dye: Dye;
}

/**
 * What a named person's look and wardrobe were drawn from: a seed in a population with some parts locked, and the outfit
 * its wardrobe was drawn from. Only the people page reads it, to draw the person again; Cast never does.
 */
export interface PersonSource {
  readonly seed: number;
  readonly population: PopulationRef;
  readonly locks: PartSeeds;
  readonly outfit: number | null;
}

/** A named person: what the people page makes and a Cast role may name. Its look and wardrobe are kept as drawn. */
export interface PersonDoc {
  readonly name: string;
  /** Its look's 72 bytes. */
  readonly look: readonly number[];
  /** What it wears: one entry a wardrobe slot (WARDROBE_NAMES), null for nothing there; null wears the role's clothes. */
  readonly wardrobe: readonly (WornDoc | null)[] | null;
  readonly source: PersonSource | null;
  readonly notes: string;
}

/** One garment an outfit slot may give, by weight. */
export interface OutfitChoice {
  readonly garment: string;
  readonly edition: number;
  readonly weight: number;
}

/** An outfit's slot: one garment, or a choice among several, and the dye it is worn in. */
export interface OutfitSlot {
  readonly choices: readonly OutfitChoice[];
  readonly dye: Dye;
}

/** An outfit: one entry a wardrobe slot, null for nothing there. */
export interface OutfitDoc {
  readonly name: string;
  readonly slots: readonly (OutfitSlot | null)[];
}

/** An admin population as the store keeps it: a content population without its type, id and revision. */
export type PopulationDoc = Omit<PopulationDef, "type" | "id" | "revision">;

/** A record's body by its kind. */
export interface Bodies {
  readonly person: PersonDoc;
  readonly outfit: OutfitDoc;
  readonly population: PopulationDoc;
}

/** The id an admin population goes by where a content id would: no content id has no colon. */
export const storePopulationId = (id: number): string => `population/${id}`;

/** An admin population's revision as the person generator takes it. */
export const storePopulation = (id: number, rev: number, body: PopulationDoc): PopulationDef => ({ type: "population", id: storePopulationId(id), revision: rev, ...body });

/** One revision of an admin population in the manifest clients fetch. */
export interface ManifestPopulation {
  readonly id: number;
  readonly rev: number;
  readonly population: PopulationDoc;
}

const CONTENT_ID = /^[a-z0-9_]+:[a-z0-9_/]+$/;
const isId = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 1 && (n as number) <= ID_MOST;
const palette = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255;
const weightOk = (n: unknown): n is number => isNumber(n) && n > 0 && n <= WEIGHT_MAX;
const asObject = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function dyeOf(v: unknown): Dye | null {
  return Array.isArray(v) && v.length === 3 && v.every(palette) ? [v[0], v[1], v[2]] : null;
}

/** A piece worn, or why not. */
function wornOf(v: unknown): WornDoc | string {
  const o = asObject(v);
  if (!o || typeof o.garment !== "string" || !CONTENT_ID.test(o.garment)) return "Name each garment by its content id.";
  if (!(o.edition === 0 || isId(o.edition))) return "An edition is a store id, or 0 for the plain garment.";
  const dye = dyeOf(o.dye ?? [0, 0, 0]);
  if (!dye) return "A dye is three palette numbers 0 to 255 (0 for the garment's own).";
  return { garment: o.garment, edition: o.edition as number, dye };
}

/** A part seed table as kept: only the parts there are, each a u32. */
function locksOf(v: unknown): PartSeeds | null {
  if (v === undefined || v === null) return {};
  const o = asObject(v);
  if (!o) return null;
  const out: Partial<Record<PartName, number>> = {};
  for (const key of Object.keys(o)) if (!(PART_NAMES as readonly string[]).includes(key)) return null;
  for (const part of PART_NAMES) {
    const s = o[part];
    if (s === undefined) continue;
    if (!(Number.isInteger(s) && (s as number) >= 0 && (s as number) <= 0xffffffff)) return null;
    out[part] = s as number;
  }
  return out;
}

const u32 = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;

/** A person's source as kept, or why not. */
function sourceOf(v: unknown): PersonSource | string {
  const o = asObject(v);
  if (!o || !u32(o.seed)) return "A source's seed is a whole number 0 to 4294967295.";
  const p = o.population;
  if (!((typeof p === "string" && CONTENT_ID.test(p)) || isId(p))) return "A source names its population by content id or store id.";
  const locks = locksOf(o.locks);
  if (!locks) return `A source's locks are a seed for some of its parts (${PART_NAMES.join(", ")}).`;
  const outfit = o.outfit ?? null;
  if (outfit !== null && !isId(outfit)) return "A source names its outfit by its store id.";
  return { seed: o.seed, population: p as PopulationRef, locks, outfit: outfit as number | null };
}

/** A named person as a page sent it, as the store keeps it, or why not. */
export function readPerson(sent: Record<string, unknown>): PersonDoc | string {
  const name = editionName(sent.name);
  if (name === null) return `A person's name is 1 to ${RECORD_NAME_MAX} letters.`;
  const notes = sent.notes === undefined ? "" : sent.notes;
  if (typeof notes !== "string" || notes.length > NOTES_MAX) return `A person's notes are at most ${NOTES_MAX} letters.`;
  const b = sent.look;
  if (!Array.isArray(b) || b.length !== LOOK_BYTES || !b.every(palette) || !validLook(Uint8Array.from(b as number[]))) return `A look is the ${LOOK_BYTES} bytes of a valid look.`;
  let source: PersonSource | null = null;
  if (sent.source !== undefined && sent.source !== null) {
    const read = sourceOf(sent.source);
    if (typeof read === "string") return read;
    source = read;
  }
  let wardrobe: (WornDoc | null)[] | null = null;
  if (sent.wardrobe !== undefined && sent.wardrobe !== null) {
    if (!Array.isArray(sent.wardrobe) || sent.wardrobe.length !== WARDROBE_SLOTS) return `A wardrobe has ${WARDROBE_SLOTS} slots, each a piece or null.`;
    wardrobe = [];
    for (const w of sent.wardrobe) {
      if (w === null) wardrobe.push(null);
      else {
        const worn = wornOf(w);
        if (typeof worn === "string") return worn;
        wardrobe.push(worn);
      }
    }
  }
  return { name, look: [...(b as number[])], wardrobe, source, notes };
}

/** An outfit as a page sent it, as the store keeps it, or why not. */
export function readOutfit(sent: Record<string, unknown>): OutfitDoc | string {
  const name = editionName(sent.name);
  if (name === null) return `An outfit's name is 1 to ${RECORD_NAME_MAX} letters.`;
  const s = sent.slots;
  if (!Array.isArray(s) || s.length !== WARDROBE_SLOTS) return `An outfit has ${WARDROBE_SLOTS} slots, each a choice or null.`;
  const slots: (OutfitSlot | null)[] = [];
  for (const v of s) {
    if (v === null) {
      slots.push(null);
      continue;
    }
    const o = asObject(v);
    const c = o?.choices;
    if (!o || !Array.isArray(c) || c.length < 1 || c.length > CHOICES_MAX) return `An outfit's slot chooses among 1 to ${CHOICES_MAX} garments.`;
    const choices: OutfitChoice[] = [];
    for (const one of c) {
      const worn = wornOf({ ...asObject(one), dye: [0, 0, 0] });
      if (typeof worn === "string") return worn;
      const weight = asObject(one)?.weight ?? 1;
      if (!weightOk(weight)) return `A choice's weight is above 0 and at most ${WEIGHT_MAX}.`;
      choices.push({ garment: worn.garment, edition: worn.edition, weight });
    }
    const dye = dyeOf(o.dye ?? [0, 0, 0]);
    if (!dye) return "A dye is three palette numbers 0 to 255 (0 for the garment's own).";
    slots.push({ choices, dye });
  }
  if (slots.every((x) => x === null)) return "An outfit wears something.";
  return { name, slots };
}

const spanOf = (v: unknown): Span | undefined => (Array.isArray(v) && v.length === 2 && v.every(isNumber) ? [v[0], v[1]] : undefined);
const listOf = (v: unknown): readonly number[] | undefined => (Array.isArray(v) && v.every(isNumber) ? [...v] : undefined);

/**
 * An admin population as a page sent it, as the store keeps it, or why not: only the fields a content population has, in
 * one order, held to the content kind's checks. What its outfits wear is checked against the world's content apart.
 */
export function readPopulation(sent: Record<string, unknown>): PopulationDoc | string {
  const label = editionName(sent.label);
  if (label === null) return `A population's label is 1 to ${RECORD_NAME_MAX} letters.`;
  const hair = asObject(sent.hair), beard = asObject(sent.beard);
  const body: Record<string, unknown> = {
    label,
    women: sent.women,
    skin: listOf(sent.skin),
    eyes: listOf(sent.eyes),
    complexions: sent.complexions === undefined ? undefined : listOf(sent.complexions) ?? null,
    hair: hair ? { men: listOf(hair.men), women: listOf(hair.women) } : undefined,
    hairColors: listOf(sent.hairColors),
    streak: sent.streak,
    grey: sent.grey === undefined ? undefined : spanOf(sent.grey) ?? null,
    beard: beard ? { men: beard.men, women: beard.women } : undefined,
    brows: sent.brows === undefined ? undefined : listOf(sent.brows) ?? null,
    build: spanOf(sent.build),
    regions: undefined,
    face: sent.face,
    age: spanOf(sent.age),
    weight: spanOf(sent.weight),
    muscle: spanOf(sent.muscle),
    hairLength: sent.hairLength === undefined ? undefined : spanOf(sent.hairLength) ?? null,
    beardLength: sent.beardLength === undefined ? undefined : spanOf(sent.beardLength) ?? null,
    outfits: undefined,
  };
  if (sent.regions !== undefined) {
    const r = asObject(sent.regions);
    if (!r) return "regions maps body regions to a low and a high.";
    const regions: Record<string, Span | null> = {};
    for (const key of REGION_KEYS) if (r[key] !== undefined) regions[key] = spanOf(r[key]) ?? null;
    for (const key of Object.keys(r)) if (!REGION_KEYS.includes(key)) return `regions: ${key} is no body region (${REGION_KEYS.join(", ")})`;
    body.regions = regions;
  }
  if (sent.outfits !== undefined) {
    const o = sent.outfits;
    if (!Array.isArray(o) || o.length > POPULATION_OUTFITS_MAX) return `A population has at most ${POPULATION_OUTFITS_MAX} outfits.`;
    const outfits: { wear: string[]; weight: number }[] = [];
    for (const one of o) {
      const x = asObject(one);
      if (!x || !Array.isArray(x.wear) || x.wear.length > WEAR_MAX || !x.wear.every((w) => typeof w === "string" && CONTENT_ID.test(w)) || !weightOk(x.weight)) {
        return `An outfit is at most ${WEAR_MAX} pieces by content id and a weight above 0.`;
      }
      outfits.push({ wear: [...(x.wear as string[])], weight: x.weight });
    }
    body.outfits = outfits;
  }
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  const errors: string[] = [];
  const def = { type: "population", id: "population/0", revision: 1, ...body } as unknown as PopulationDef;
  for (const [k, v] of Object.entries(body)) if (v === null) errors.push(`population/0: ${k} is not of its shape`);
  if (Object.values(body.regions ?? {}).some((v) => v === null)) errors.push("population/0: regions: each is a low and a high");
  try {
    populationKind.check!(def, { errors } as unknown as Checking);
  } catch {
    errors.push("population/0: is not of a population's shape");
  }
  for (const must of ["women", "skin", "eyes", "hair", "hairColors", "beard", "build", "face", "age", "weight", "muscle"]) if (body[must] === undefined) errors.push(`population/0: ${must} is wanted`);
  if (errors.length > 0) return errors[0]!.replace(/^population\/0: /, "");
  return body as unknown as PopulationDoc;
}

/** What a manifest names, read as a client takes it: what is not of its shape is left out. */
export function readPeopleManifest(json: unknown): { editions: Edition[]; populations: ManifestPopulation[] } {
  const o = asObject(json);
  const populations: ManifestPopulation[] = [];
  for (const p of Array.isArray(o?.populations) ? (o!.populations as unknown[]) : []) {
    const x = asObject(p), body = asObject(x?.population);
    if (!x || !body || !isId(x.id) || !(Number.isSafeInteger(x.rev) && (x.rev as number) >= 1)) continue;
    const read = readPopulation(body);
    if (typeof read !== "string") populations.push({ id: x.id as number, rev: x.rev as number, population: read });
  }
  const editions = Array.isArray(o?.editions) ? (o!.editions as Edition[]) : [];
  return { editions, populations };
}
