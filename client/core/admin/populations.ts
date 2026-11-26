// The populations admin page, its parts that are not the page's wiring (client/admin/populations.ts): a population's
// draft and the fields an admin edits, what is wrong with it, the sheet of 24 people it makes and which of their parts an
// edit changed, and the page's lists as HTML. The store's state, the calls and the stage's wear are people.ts's.

import { BROW_STYLES, COMPLEXIONS, HAIR_STYLES, LOOK_BYTES } from "../../../shared/anim/look.ts";
import { REGION_KEYS, type PopulationDef, type Span } from "../../../shared/content/kinds/populations.ts";
import { POPULATION_OUTFITS_MAX, RECORD_NAME_MAX, WEAR_MAX, readPopulation, storePopulationId, type PartName, type PopulationDoc, type PopulationRef } from "../../../shared/people/doc.ts";
import { partSeed, personFrom } from "../../../shared/people/person.ts";
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES } from "../../../shared/pack/palette.ts";
import { esc } from "./format.ts";
import { EYE_WORDS, HAIR_COLOUR_WORDS, partsChanged, type Listed, type StoreState } from "./people.ts";

/** The people a sheet shows. */
export const SHEET_SIZE = 24;

/** A population being edited: a new copy, an admin one at revision `rev`, or a built-in one read only. */
export interface PopulationDraft {
  /** The store id, or null for a built-in one, which is not saved. */
  id: number | null;
  rev: number;
  /** The built-in population it is, for one read only. */
  builtIn: string | null;
  doc: PopulationDoc;
}

/** A deep copy of a population's fields, without its type and id. */
export function docOf(p: PopulationDef | PopulationDoc): PopulationDoc {
  const { type: _t, id: _i, aliases: _a, ...rest } = p as unknown as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest)) as PopulationDoc;
}

export const draftOfBuiltIn = (p: PopulationDef): PopulationDraft => ({ id: null, rev: 0, builtIn: p.id, doc: docOf(p) });
export const draftOfListed = (l: Listed<PopulationDoc>): PopulationDraft => ({ id: l.id, rev: l.rev, builtIn: null, doc: docOf(l.doc) });

/** The draft as the person generator takes it. */
export function draftDef(d: PopulationDraft): PopulationDef {
  return { type: "population", id: d.builtIn ?? storePopulationId(d.id ?? 0), ...d.doc } as PopulationDef;
}

/** What a person promoted from the sheet names: the saved population and its revision, or null while edits are unsaved. */
export function promoteRef(d: PopulationDraft, edited: boolean): { ref: PopulationRef; revision: number } | null {
  if (edited) return null;
  return d.builtIn ? { ref: d.builtIn, revision: d.rev } : d.id !== null ? { ref: d.id, revision: d.rev } : null;
}

/** What is wrong with the draft as the store would read it, or null. Pieces are checked against the world's content. */
export function populationFault(doc: PopulationDoc, state: Pick<StoreState, "garments" | "armour">): string | null {
  const read = readPopulation(doc as unknown as Record<string, unknown>);
  if (typeof read === "string") return read;
  const known = new Set([...state.garments.map((g) => g.id), ...state.armour.map((a) => a.id)]);
  for (const [k, o] of (doc.outfits ?? []).entries()) {
    if (o.wear.length === 0) return `Outfit ${k + 1} wears nothing: give it a piece or take it off.`;
    for (const w of o.wear) if (!known.has(w)) return `Outfit ${k + 1}: ${w} is neither a garment nor armour.`;
  }
  return null;
}

// ---- The fields an admin edits ----

/** A list of weights and what each choice is called. */
export interface WeightList {
  readonly key: "skin" | "eyes" | "complexions" | "hairColors" | "brows" | "hair.men" | "hair.women";
  readonly label: string;
  readonly names: readonly string[];
  /** A list the population may leave out. */
  readonly optional: boolean;
}

export const WEIGHT_LISTS: readonly WeightList[] = [
  { key: "skin", label: "Skin tones, lightest first", names: Array.from({ length: SKIN_TONES }, (_, k) => `${k + 1}`), optional: false },
  { key: "eyes", label: "Eye colours", names: EYE_WORDS.slice(0, EYE_COLORS), optional: false },
  { key: "hair.men", label: "Men's hair", names: HAIR_STYLES.map((s) => s.label), optional: false },
  { key: "hair.women", label: "Women's hair", names: HAIR_STYLES.map((s) => s.label), optional: false },
  { key: "hairColors", label: "Hair colours", names: HAIR_COLOUR_WORDS.slice(0, HAIR_COLORS), optional: false },
  { key: "brows", label: "Brow styles", names: Array.from({ length: BROW_STYLES }, (_, k) => `${k + 1}`), optional: true },
  { key: "complexions", label: "Complexions", names: Array.from({ length: COMPLEXIONS }, (_, k) => `${k + 1}`), optional: true },
];

/** The spans an admin edits: each a low and a high. */
export const SPANS: readonly { readonly key: "build" | "age" | "weight" | "muscle" | "grey" | "hairLength" | "beardLength"; readonly label: string; readonly least: number; readonly optional: boolean }[] = [
  { key: "age", label: "Age", least: -1, optional: false },
  { key: "weight", label: "Weight", least: -1, optional: false },
  { key: "muscle", label: "Muscle", least: -1, optional: false },
  { key: "build", label: "Every body region", least: -1, optional: false },
  { key: "grey", label: "Greying, from the age to the age", least: -1, optional: true },
  { key: "hairLength", label: "Hair grown out", least: 0, optional: true },
  { key: "beardLength", label: "Beard grown out", least: 0, optional: true },
];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const mut = (doc: PopulationDoc): Mutable<PopulationDoc> & Record<string, unknown> => doc as Mutable<PopulationDoc> & Record<string, unknown>;

/** A weight list's weights, padded with 0 to its choices; null for an optional list left out. */
export function weightsOf(doc: PopulationDoc, key: WeightList["key"]): number[] | null {
  const list = WEIGHT_LISTS.find((l) => l.key === key)!;
  const v = key === "hair.men" ? doc.hair.men : key === "hair.women" ? doc.hair.women : (doc as unknown as Record<string, readonly number[] | undefined>)[key];
  if (!v) return null;
  return list.names.map((_, i) => v[i] ?? 0);
}

/** Sets weight `i` of a list, or with null leaves an optional list out; a list left out comes back as even weights. */
export function setWeight(doc: PopulationDoc, key: WeightList["key"], i: number | null, value: number): void {
  const list = WEIGHT_LISTS.find((l) => l.key === key)!;
  const d = mut(doc);
  let now = weightsOf(doc, key);
  if (i === null) {
    if (list.optional && value === 0) {
      delete d[key];
      return;
    }
    now = list.names.map(() => 1);
  } else {
    now ??= list.names.map(() => 1);
    now[i] = Math.max(0, Math.min(1e6, Number.isFinite(value) ? value : 0));
  }
  if (key === "hair.men" || key === "hair.women") d.hair = { ...doc.hair, [key === "hair.men" ? "men" : "women"]: now };
  else d[key] = now;
}

/** Sets end `end` (0 low, 1 high) of a span, or with null leaves an optional span out or puts it back. */
export function setSpan(doc: PopulationDoc, key: (typeof SPANS)[number]["key"], end: 0 | 1 | null, value: number): void {
  const s = SPANS.find((x) => x.key === key)!, d = mut(doc);
  if (end === null) {
    if (s.optional && value === 0) delete d[key];
    else d[key] = (d[key] as Span | undefined) ?? [s.least === 0 ? 0 : -0.5, 0.5];
    return;
  }
  const was = (d[key] as Span | undefined) ?? [s.least, 1];
  const v = Math.max(s.least, Math.min(1, Number.isFinite(value) ? value : 0));
  d[key] = end === 0 ? [v, Math.max(v, was[1])] : [Math.min(v, was[0]), v];
}

/** A body region's own span, or null to draw it in the population's build. */
export function setRegionSpan(doc: PopulationDoc, region: string, span: Span | null): void {
  const d = mut(doc), regions = { ...(doc.regions ?? {}) } as Record<string, Span>;
  if (span === null) delete regions[region];
  else regions[region] = [Math.max(-1, Math.min(1, span[0])), Math.max(-1, Math.min(1, Math.max(span[0], span[1])))];
  if (Object.keys(regions).length === 0) delete d.regions;
  else d.regions = Object.fromEntries(REGION_KEYS.filter((k) => regions[k]).map((k) => [k, regions[k]!]));
}

/** Sets one of the shares: women, streak, face, the men's or women's beard. A share is 0 to 1. */
export function setShare(doc: PopulationDoc, key: "women" | "streak" | "face" | "beard.men" | "beard.women", value: number): void {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)), d = mut(doc);
  if (key === "beard.men") d.beard = { ...doc.beard, men: v };
  else if (key === "beard.women") d.beard = { ...doc.beard, women: v };
  else d[key] = v;
}

/** Adds an outfit of `wear` at `weight`; false where the population has as many as it may. */
export function addOutfit(doc: PopulationDoc, wear: readonly string[], weight = 1): boolean {
  const now = [...(doc.outfits ?? [])];
  if (now.length >= POPULATION_OUTFITS_MAX) return false;
  now.push({ wear: [...wear].slice(0, WEAR_MAX), weight });
  mut(doc).outfits = now;
  return true;
}

export function removeOutfit(doc: PopulationDoc, k: number): void {
  const now = (doc.outfits ?? []).filter((_, i) => i !== k);
  if (now.length === 0) delete mut(doc).outfits;
  else mut(doc).outfits = now;
}

/** Puts a piece in outfit `k`, or takes it out; an outfit holds WEAR_MAX at most. */
export function setPiece(doc: PopulationDoc, k: number, piece: string, on: boolean): void {
  const now = (doc.outfits ?? []).map((o) => ({ wear: [...o.wear], weight: o.weight }));
  const o = now[k];
  if (!o) return;
  o.wear = o.wear.filter((w) => w !== piece);
  if (on && o.wear.length < WEAR_MAX) o.wear.push(piece);
  mut(doc).outfits = now;
}

export function setOutfitWeight(doc: PopulationDoc, k: number, weight: number): void {
  mut(doc).outfits = (doc.outfits ?? []).map((o, i) => (i === k ? { wear: [...o.wear], weight: Math.max(0.001, Math.min(1e6, Number.isFinite(weight) ? weight : 1)) } : o));
}

export function setLabel(doc: PopulationDoc, label: string): void {
  mut(doc).label = [...label].slice(0, RECORD_NAME_MAX).join("");
}

// ---- The sheet ----

/** One person on the sheet: its seed, look and which outfit it wears. */
export interface SheetPerson {
  readonly seed: number;
  readonly look: Uint8Array;
  readonly outfit: number;
  readonly wear: readonly string[];
}

/** The 24 seeds a sheet's `base` gives. */
export const sheetSeeds = (base: number): number[] => Array.from({ length: SHEET_SIZE }, (_, k) => partSeed(base >>> 0, 0x5e00 + k));

/** The sheet's people in `p`. */
export function sheetOf(p: PopulationDef, seeds: readonly number[]): SheetPerson[] {
  return seeds.map((seed) => {
    const person = personFrom(seed, p, new Uint8Array(LOOK_BYTES));
    return { seed, look: person.look, outfit: person.outfit, wear: person.outfit >= 0 ? (p.outfits?.[person.outfit]?.wear ?? []) : [] };
  });
}

/** What an edit changed on a sheet, person by person: the parts of its look, and whether it wears something else. */
export function sheetChanges(was: readonly SheetPerson[], now: readonly SheetPerson[]): { readonly parts: PartName[]; readonly wear: boolean }[] {
  return now.map((p, i) => {
    const o = was[i];
    if (!o || o.seed !== p.seed) return { parts: ["sex", "figure", "body", "skin", "hair", "beard", "brows", "face"], wear: true };
    return { parts: partsChanged(o.look, p.look), wear: o.wear.join(",") !== p.wear.join(",") };
  });
}

/** A key a sheet picture is kept by: the look's bytes and what it wears. */
export const pictureKey = (p: SheetPerson): string => `${Array.from(p.look, (b) => b.toString(16).padStart(2, "0")).join("")}|${p.wear.join(",")}`;

// ---- The page's lists as HTML ----

/** The built-in populations, read only with a copy button, then the admin ones. */
export function populationsHtml(state: StoreState, selected: string): string {
  const built = state.builtIns.map((p) => `<div class="named${selected === p.id ? " picked" : ""}"><button data-open-built="${esc(p.id)}"><b>${esc(p.label)}</b> <span class="chip">built in</span><br><span class="faint">${esc(p.id)}</span></button><div class="acts"><button data-copy="${esc(p.id)}">Copy</button></div></div>`);
  const admin = [...state.populations].sort((a, b) => b.id - a.id).map((p) => `<div class="named${p.retired ? " retired" : ""}${selected === `store:${p.id}` ? " picked" : ""}" data-population="${p.id}"><button data-open="${p.id}"><b>${esc(p.doc.label)}</b>${p.retired ? ` <span class="chip">retired</span>` : ""}<br><span class="faint">#${p.id} · revision ${p.rev}${p.by ? ` · ${esc(p.by)}` : ""}</span></button></div>`);
  return `<h3>Built in</h3>${built.join("")}<h3>Made here</h3>${admin.join("") || `<p class="faint">None yet: copy a built-in one to start.</p>`}`;
}

/** A short line for what a sheet person is. */
export function sheetCaption(p: SheetPerson): string {
  const sex = p.look[0] === 1 ? "woman" : "man";
  return `${sex} · seed ${p.seed}${p.outfit >= 0 ? ` · outfit ${p.outfit + 1}` : ""}`;
}

