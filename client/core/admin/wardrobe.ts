// The wardrobe admin page, its parts that are not the page's wiring (client/admin/wardrobe.ts): the draft edition and its
// print sheet, what is wrong with a draft, how a sheet's PNG is brought under the store's cap, the publish and retire
// calls with their answers, what the person stage is sent, and the page's lists as HTML.

import { defaultLook, LOOK_HAIR, LOOK_SEX } from "../../../shared/anim/look.ts";
import { RAMP_BASE, SKIN_BASE } from "../../../shared/pack/palette.ts";
import {
  EDITION_NAME_MAX, PRINT_BYTES_MAX, PRINT_SCALE_MAX, PRINT_SCALE_MIN, PRINT_SIDE_MAX, editionName, readDraft, type Edition, type PrintPlace,
} from "../../../shared/people/doc.ts";
import { CUTS, SHEETS, type Sheet as CutSheetTable } from "../../../shared/people/cuts.ts";
import { personFrom } from "../../../shared/people/person.ts";
import { STAGE_SLOTS, type StageCommand, type StageFraming, type StageGarment, type StagePose } from "../../../shared/people/stage.ts";
import { WARDROBE_NAMES } from "../../../shared/sim/items.ts";
import { POPULATIONS } from "../../../content/people/defaults.ts";
import { esc } from "./format.ts";

// ---- What the store's routes answer (server/admin/people-routes.ts) ----

export interface Caps {
  readonly side: number;
  readonly bytes: number;
  readonly scaleMin: number;
  readonly scaleMax: number;
  readonly name: number;
}
export interface GarmentChoice {
  readonly id: string;
  readonly label: string;
  readonly slot: string;
  readonly dyes: boolean;
  readonly cut: string | null;
}
export interface ListedEdition extends Edition {
  readonly retired: boolean;
  readonly by?: string;
  readonly byId?: string;
  readonly at?: number;
  readonly printPath?: string;
}
export interface PeopleState {
  readonly revision: number;
  readonly manifest: { id: string; path: string } | null;
  readonly caps: Caps;
  readonly garments: readonly GarmentChoice[];
  readonly editions: readonly ListedEdition[];
}

export const STORE_CAPS: Caps = { side: PRINT_SIDE_MAX, bytes: PRINT_BYTES_MAX, scaleMin: PRINT_SCALE_MIN, scaleMax: PRINT_SCALE_MAX, name: EDITION_NAME_MAX };

/** The state a route answered, or null where the answer is not one. */
export function stateOf(answer: Record<string, unknown>): PeopleState | null {
  if (!Number.isSafeInteger(answer.revision) || !Array.isArray(answer.editions) || !Array.isArray(answer.garments)) return null;
  return { revision: answer.revision as number, manifest: (answer.manifest as PeopleState["manifest"]) ?? null, caps: { ...STORE_CAPS, ...(answer.caps as Partial<Caps> | undefined) }, garments: answer.garments as GarmentChoice[], editions: answer.editions as ListedEdition[] };
}

// ---- The print sheet ----

/** The sheet sizes offered: square or twice as wide as high, as a print must be. */
export const SHEET_SIZES: readonly (readonly [number, number])[] = [[512, 512], [512, 256], [256, 256], [256, 128]];
export const LAYERS_MAX = 16;
export const TEXT_MAX = 48;
export const FONTS = ["sans-serif", "serif", "monospace", "Impact", "Georgia", "Courier New"] as const;
export const SHAPES = ["box", "disc", "ring", "star"] as const;
export type Shape = (typeof SHAPES)[number];

/** Each layer's middle is at `x`, `y` and its size is a share of the sheet's width (text: of its height); `turn` is in radians. */
export type Layer =
  | { readonly id: number; kind: "text"; text: string; font: string; size: number; colour: string; bold: boolean; x: number; y: number; turn: number }
  | { readonly id: number; kind: "shape"; shape: Shape; colour: string; w: number; h: number; x: number; y: number; turn: number }
  | { readonly id: number; kind: "picture"; name: string; width: number; height: number; w: number; x: number; y: number; turn: number };

export interface Sheet {
  width: number;
  height: number;
  /** A CSS colour behind every layer, or null to leave the sheet clear. */
  fill: string | null;
  layers: Layer[];
}

export interface Draft {
  garment: string;
  colours: [number, number, number];
  name: string;
  /** The print's sheet, or null for an edition with no print. */
  sheet: Sheet | null;
  place: PrintPlace;
}

export const DEFAULT_PLACE: PrintPlace = { u: 0.3, v: 0.2, w: 0.4, h: 0.4, scale: 1, turn: 0 };

/** Where a print on `cut` starts: the cut's own place for it (shared/people/cuts.ts), the chest of a top. */
export function placeFor(cut: string | null): PrintPlace {
  const r = cut ? CUTS[cut]?.print : undefined;
  return r ? { u: r[0], v: r[1], w: r[2], h: r[3], scale: 1, turn: 0 } : { ...DEFAULT_PLACE };
}

/** The print sheet `cut` is drawn with, its panels named, or null for a garment with no cut. */
export function sheetOfCut(cut: string | null): CutSheetTable | null {
  const c = cut ? CUTS[cut] : undefined;
  return c ? SHEETS[c.sheet] : null;
}

export function newSheet(): Sheet {
  return { width: 512, height: 512, fill: "#f4f1ea", layers: [] };
}

export function newDraft(garment: string, cut: string | null): Draft {
  return { garment, colours: [0, 0, 0], name: "", sheet: null, place: placeFor(cut) };
}

/** `d` made of garment `to` in place of `from`: a print still where `from`'s cut starts it moves to where `to`'s does. */
export function changeGarment(d: Draft, from: GarmentChoice | undefined, to: GarmentChoice): void {
  const start = placeFor(from?.cut ?? null), p = d.place;
  d.garment = to.id;
  if (!to.dyes) d.colours = [0, 0, 0];
  if (p.u === start.u && p.v === start.v && p.w === start.w && p.h === start.h && p.scale === 1 && p.turn === 0) d.place = placeFor(to.cut);
}

/** A draft begun from a published edition: its garment, colours and place, its name marked as a copy. Its print comes as a picture layer. */
export function draftFrom(e: Edition): Draft {
  const name = [...`${e.name} copy`].slice(0, EDITION_NAME_MAX).join("");
  return { garment: e.garment, colours: [...e.colours] as [number, number, number], name, sheet: e.print ? { width: e.print.width, height: e.print.height, fill: null, layers: [] } : null, place: e.print ? { ...e.print.place } : { ...DEFAULT_PLACE } };
}

const nextId = (sheet: Sheet): number => sheet.layers.reduce((m, l) => Math.max(m, l.id), 0) + 1;

/** Adds a layer of `kind` and returns it, or null where the sheet holds no more. */
export function addText(sheet: Sheet, text = "SNARK"): Layer | null {
  if (sheet.layers.length >= LAYERS_MAX) return null;
  const l: Layer = { id: nextId(sheet), kind: "text", text, font: FONTS[0], size: 0.16, colour: "#1d2a3a", bold: true, x: 0.5, y: 0.5, turn: 0 };
  sheet.layers.push(l);
  return l;
}
export function addShape(sheet: Sheet, shape: Shape = "box"): Layer | null {
  if (sheet.layers.length >= LAYERS_MAX) return null;
  const l: Layer = { id: nextId(sheet), kind: "shape", shape, colour: "#c4452f", w: 0.5, h: 0.5, x: 0.5, y: 0.5, turn: 0 };
  sheet.layers.push(l);
  return l;
}
/** A picture of `width` x `height` pixels as held, at most three quarters of the sheet across or down. */
export function addPicture(sheet: Sheet, name: string, width: number, height: number): Layer | null {
  if (sheet.layers.length >= LAYERS_MAX || !(width > 0 && height > 0)) return null;
  const across = Math.min(0.75, (0.75 * sheet.height * width) / (height * sheet.width));
  const l: Layer = { id: nextId(sheet), kind: "picture", name: name.slice(0, 60), width, height, w: round(across), x: 0.5, y: 0.5, turn: 0 };
  sheet.layers.push(l);
  return l;
}

export function removeLayer(sheet: Sheet, id: number): void {
  sheet.layers = sheet.layers.filter((l) => l.id !== id);
}

/** Moves layer `id` one step up (drawn later) or down. */
export function moveLayer(sheet: Sheet, id: number, by: -1 | 1): void {
  const at = sheet.layers.findIndex((l) => l.id === id), to = at + by;
  if (at < 0 || to < 0 || to >= sheet.layers.length) return;
  const [l] = sheet.layers.splice(at, 1);
  sheet.layers.splice(to, 0, l!);
}

/** The size a picture is held at, its long side at most `most`: a big upload is shrunk once as it is read. */
export function heldSize(width: number, height: number, most = 1024): { width: number; height: number } {
  const k = Math.min(1, most / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** A layer's box on a sheet of `width` x `height` pixels, in pixels about its middle, before its turn. A text's width is a guess. */
export function layerBox(l: Layer, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const x = l.x * width, y = l.y * height;
  if (l.kind === "text") {
    const h = l.size * height;
    return { x, y, w: h * 0.62 * Math.max(1, [...l.text].length), h };
  }
  if (l.kind === "shape") return { x, y, w: l.w * width, h: l.h * width };
  const w = l.w * width;
  return { x, y, w, h: (w * l.height) / l.width };
}

/** The topmost layer at pixel `px`, `py` of the sheet, or null. */
export function layerAt(sheet: Sheet, px: number, py: number): Layer | null {
  for (let i = sheet.layers.length - 1; i >= 0; i--) {
    const l = sheet.layers[i]!, b = layerBox(l, sheet.width, sheet.height);
    // Into the layer's own frame: a layer is drawn turned by -turn, as the canvas's y runs down.
    const dx = px - b.x, dy = py - b.y, c = Math.cos(l.turn), s = Math.sin(l.turn);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return l;
  }
  return null;
}

/** The canvas font of a text layer drawn `px` pixels high: a family with a space is quoted. */
export function fontOf(l: Extract<Layer, { kind: "text" }>, px: number): string {
  const family = /\s/.test(l.font) ? `"${l.font}"` : l.font;
  return `${l.bold ? "bold " : ""}${Math.max(1, Math.round(px))}px ${family}`;
}

/** The points of a five-pointed star in a box of half-sides `rx`, `ry` about the middle, first point up. */
export function starPoints(rx: number, ry: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 === 0 ? 1 : 0.42;
    out.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
  }
  return out;
}

// ---- What is wrong with a draft ----

export interface Fault {
  /** The field it is at: name, garment, colours, sheet, layer:<id>, place. */
  readonly at: string;
  readonly text: string;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** The place as the store takes it: three decimals, the rectangle inside the sheet, scale and turn in range. */
export function placeOf(p: PrintPlace, caps: Caps = STORE_CAPS): PrintPlace {
  const clampUnit = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  // A corner at the far edge leaves room for a sliver of a rectangle.
  const u = round(Math.min(0.999, clampUnit(p.u))), v = round(Math.min(0.999, clampUnit(p.v)));
  let w = round(Math.max(0.001, Math.min(clampUnit(p.w), 1 - u))), h = round(Math.max(0.001, Math.min(clampUnit(p.h), 1 - v)));
  if (u + w > 1) w = round(1 - u);
  if (v + h > 1) h = round(1 - v);
  const scale = round(Math.min(caps.scaleMax, Math.max(caps.scaleMin, Number.isFinite(p.scale) ? p.scale : 1)));
  const turn = Math.min(Math.PI, Math.max(-Math.PI, Number.isFinite(p.turn) ? p.turn : 0));
  return { u, v, w, h, scale, turn };
}

/** Whether a sheet's size is one a print may be. */
export function sheetSizeFault(width: number, height: number, caps: Caps = STORE_CAPS): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > caps.side || height > caps.side) return `A print sheet is 1 to ${caps.side} pixels a side.`;
  if (width !== height && width !== 2 * height) return "A print sheet is square or twice as wide as high.";
  return null;
}

/** Everything wrong with `d` as the store would judge it, a line each, against the garments `state` offers. */
export function draftFaults(d: Draft, state: Pick<PeopleState, "garments" | "caps">): Fault[] {
  const out: Fault[] = [];
  const caps = state.caps;
  if (editionName(d.name) === null) out.push({ at: "name", text: `Give the edition a name of 1 to ${caps.name} letters.` });
  const g = state.garments.find((x) => x.id === d.garment);
  if (!g) out.push({ at: "garment", text: "Choose a garment." });
  if (!d.colours.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) out.push({ at: "colours", text: "Each colour is a palette number, 0 to 255." });
  else if (g && !g.dyes && d.colours.some((c) => c !== 0)) out.push({ at: "colours", text: `The ${g.label} keeps its own colours.` });
  if (d.sheet) {
    const size = sheetSizeFault(d.sheet.width, d.sheet.height, caps);
    if (size) out.push({ at: "sheet", text: size });
    if (d.sheet.layers.length === 0 && d.sheet.fill === null) out.push({ at: "sheet", text: "The print is empty: give it a fill or a layer, or take the print off." });
    if (d.sheet.layers.length > LAYERS_MAX) out.push({ at: "sheet", text: `A sheet holds ${LAYERS_MAX} layers at most.` });
    for (const l of d.sheet.layers) if (l.kind === "text" && (l.text.trim() === "" || [...l.text].length > TEXT_MAX)) out.push({ at: `layer:${l.id}`, text: `A text is 1 to ${TEXT_MAX} letters.` });
  }
  // The store's own reading, with a stand-in hash, catches what the lines above do not.
  if (out.length === 0) {
    const read = readDraft(publishBody(d, 0, d.sheet ? "0000000000000000" : null, caps) as unknown as Record<string, unknown>);
    if (typeof read === "string") out.push({ at: d.sheet ? "place" : "draft", text: read });
  }
  return out;
}

/** What /admin/people/publish is sent for `d`, its print by the hash its upload answered. */
export function publishBody(d: Draft, revision: number, hash: string | null, caps: Caps = STORE_CAPS): { revision: number; garment: string; colours: number[]; name: string; print: { hash: string; place: PrintPlace } | null } {
  return { revision, garment: d.garment, colours: [...d.colours], name: editionName(d.name) ?? d.name, print: hash && d.sheet ? { hash, place: placeOf(d.place, caps) } : null };
}

// ---- A sheet's PNG under the cap ----

export const FIT_TRIES = 6;
/** The smallest a sheet is shrunk to, its short side in pixels. */
export const FIT_LEAST = 64;

export type Fit = { readonly kind: "keep" } | { readonly kind: "shrink"; readonly width: number; readonly height: number } | { readonly kind: "fail"; readonly reason: string };

/**
 * What to do with a sheet exported as `bytes` at `width` x `height`, after `tries` exports: keep it, export it again
 * smaller, or give up. A PNG's bytes go roughly with its pixels, so the side shrinks by the root of the excess and a
 * margin; the shape stays square or twice as wide.
 */
export function fitStep(width: number, height: number, bytes: number, tries: number, cap = PRINT_BYTES_MAX): Fit {
  if (bytes <= cap) return { kind: "keep" };
  if (tries >= FIT_TRIES) return { kind: "fail", reason: `The print is still ${kb(bytes)} after ${tries} tries; a print is ${kb(cap)} at most. Use a simpler picture.` };
  const wide = width === 2 * height ? 2 : 1;
  const k = Math.sqrt(cap / bytes) * 0.92;
  // At least eight pixels less, and on a multiple of eight.
  const short = Math.min(height - 8, Math.floor((height * k) / 8) * 8);
  if (short < FIT_LEAST) return { kind: "fail", reason: `The print would be under ${FIT_LEAST} pixels high to fit ${kb(cap)}. Use a simpler picture.` };
  return { kind: "shrink", width: short * wide, height: short };
}

export const kb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** What the admin is told when a sheet was shrunk to fit, or "" when it was not. */
export function fitNote(from: { width: number; height: number; bytes: number }, to: { width: number; height: number; bytes: number }, cap = PRINT_BYTES_MAX): string {
  if (from.width === to.width && from.height === to.height) return "";
  return `The print was ${kb(from.bytes)} at ${from.width} × ${from.height}, over the ${kb(cap)} a print may be, so it was saved at ${to.width} × ${to.height} (${kb(to.bytes)}).`;
}

// ---- Publishing and retiring ----

/** One call to a route: its status (0 where it broke off) and its JSON. */
export interface Answer {
  readonly status: number;
  readonly answer: Record<string, unknown>;
}
export interface PublishIo {
  upload(png: Uint8Array): Promise<Answer>;
  publish(body: ReturnType<typeof publishBody>): Promise<Answer>;
  retire(body: { revision: number; id: number; retired: boolean }): Promise<Answer>;
  wait(ms: number): Promise<void>;
}

/** How long to wait before each try again of a call the store was too busy for. */
export const BUSY_WAITS: readonly number[] = [250, 500, 1000, 2000];

export type Step = { readonly kind: "uploading" } | { readonly kind: "publishing" } | { readonly kind: "busy"; readonly attempt: number; readonly ms: number } | { readonly kind: "retiring" };

export type Outcome =
  | { readonly kind: "published"; readonly id: number; readonly state: PeopleState | null; readonly upload: { hash: string; known: boolean } | null }
  | { readonly kind: "retired"; readonly state: PeopleState | null }
  /** The store moved on since the page read it: its state now, and the draft is kept. */
  | { readonly kind: "stale"; readonly state: PeopleState | null; readonly error: string }
  | { readonly kind: "busy"; readonly error: string }
  | { readonly kind: "refused"; readonly status: number; readonly error: string };

/** A call tried again after each wait while the store answers 503. */
async function patient(call: () => Promise<Answer>, io: Pick<PublishIo, "wait">, step: (s: Step) => void): Promise<Answer> {
  let a = await call();
  for (let k = 0; a.status === 503 && k < BUSY_WAITS.length; k++) {
    step({ kind: "busy", attempt: k + 1, ms: BUSY_WAITS[k]! });
    await io.wait(BUSY_WAITS[k]!);
    a = await call();
  }
  return a;
}

const errorOf = (a: Answer): string => (typeof a.answer.error === "string" ? a.answer.error : a.status === 0 ? "The server could not be reached." : `The server answered ${a.status}.`);

/** Uploads the sheet's PNG, if there is one, then publishes `d` over `revision`. */
export async function publishDraft(io: PublishIo, d: Draft, png: Uint8Array | null, revision: number, step: (s: Step) => void = () => {}): Promise<Outcome> {
  let upload: { hash: string; known: boolean } | null = null;
  if (d.sheet) {
    if (!png) return { kind: "refused", status: 0, error: "The print's picture was not made." };
    step({ kind: "uploading" });
    const up = await patient(() => io.upload(png), io, step);
    if (up.status === 503) return { kind: "busy", error: errorOf(up) };
    if (up.status !== 200 || typeof up.answer.hash !== "string") return { kind: "refused", status: up.status, error: `The print was not taken: ${errorOf(up)}` };
    upload = { hash: up.answer.hash, known: up.answer.known === true };
  }
  step({ kind: "publishing" });
  const body = publishBody(d, revision, upload?.hash ?? null);
  const a = await patient(() => io.publish(body), io, step);
  if (a.status === 200 && Number.isSafeInteger(a.answer.id)) return { kind: "published", id: a.answer.id as number, state: stateOf(a.answer), upload };
  if (a.status === 409) return { kind: "stale", state: stateOf(a.answer), error: errorOf(a) };
  if (a.status === 503) return { kind: "busy", error: errorOf(a) };
  return { kind: "refused", status: a.status, error: errorOf(a) };
}

/** Retires edition `id`, or brings it back, over `revision`. */
export async function retireEdition(io: PublishIo, id: number, retired: boolean, revision: number, step: (s: Step) => void = () => {}): Promise<Outcome> {
  step({ kind: "retiring" });
  const a = await patient(() => io.retire({ revision, id, retired }), io, step);
  if (a.status === 200) return { kind: "retired", state: stateOf(a.answer) };
  if (a.status === 409) return { kind: "stale", state: stateOf(a.answer), error: errorOf(a) };
  if (a.status === 503) return { kind: "busy", error: errorOf(a) };
  return { kind: "refused", status: a.status, error: errorOf(a) };
}

/** What the page says of an outcome. */
export function outcomeText(o: Outcome, was: PeopleState | null): string {
  switch (o.kind) {
    case "published":
      return `Published edition ${o.id}.${o.upload?.known ? " Its print was in the store already." : ""}`;
    case "retired":
      return "Saved.";
    case "stale": {
      const known = new Set(was?.editions.map((e) => e.id) ?? []);
      const fresh = o.state?.editions.filter((e) => !known.has(e.id)) ?? [];
      const who = fresh.length === 0 ? "Another admin changed the store" : `Another admin published ${fresh.map((e) => `edition ${e.id} "${e.name}"`).join(", ")}`;
      return `Not saved: ${who} since this page read it. The list shows it now, and your draft is kept: press the button again to go on.`;
    }
    case "busy":
      return `Not saved: the store stayed busy after ${BUSY_WAITS.length} tries. Your draft is kept; try again.`;
    case "refused":
      return `Not saved: ${o.error}`;
  }
}

/** What the page says while a call waits. */
export function stepText(s: Step): string {
  switch (s.kind) {
    case "uploading":
      return "Uploading the print…";
    case "publishing":
      return "Publishing…";
    case "retiring":
      return "Saving…";
    case "busy":
      return `The store is busy. Trying again in ${(s.ms / 1000).toFixed(s.ms < 1000 ? 2 : 0)} s (try ${s.attempt + 1} of ${BUSY_WAITS.length + 1}).`;
  }
}

// ---- The person stage ----

export const DRAFT_PRINT = "wardrobe-draft";
/** The print key a published edition's picture is held under on the stage. */
export const editionPrintKey = (hash: string): string => `print.${hash}`;

/** The people a preview can show: the two defaults, and someone made from each built-in population. */
export const LOOKS: readonly { readonly id: string; readonly label: string }[] = [
  { id: "man", label: "Default man" },
  { id: "woman", label: "Default woman" },
  ...POPULATIONS.map((p) => ({ id: p.id, label: `Someone from ${p.label.toLowerCase()}` })),
];

/** The look bytes of choice `id`; `seed` picks the person of a population. */
export function lookOf(id: string, seed: number): Uint8Array {
  const population = POPULATIONS.find((p) => p.id === id);
  if (population) return personFrom(seed >>> 0, population).look;
  const look = defaultLook();
  if (id === "woman") {
    look[LOOK_SEX] = 1;
    look[LOOK_HAIR] = 3;
  }
  return look;
}

/** The wardrobe the stage is sent: `garment` alone, in its slot, with its dye and its print's key and place. */
export function wardrobeCommand(garment: GarmentChoice | undefined, edition: number, dye: readonly [number, number, number], print: StageGarment["print"]): Extract<StageCommand, { kind: "wardrobe" }> {
  const slots: (StageGarment | null)[] = new Array<StageGarment | null>(STAGE_SLOTS).fill(null);
  const at = garment ? (WARDROBE_NAMES as readonly string[]).indexOf(garment.slot) : -1;
  if (garment && at >= 0) slots[at] = { item: garment.id, edition, dye: [dye[0], dye[1], dye[2]], print };
  return { kind: "wardrobe", slots, hide: 0 };
}

/** What the preview shows, as the page last sent it. */
export interface Preview {
  readonly look: string;
  readonly wardrobe: string;
  /** The print's key and which drawing of it, or "" for none. */
  readonly print: string;
  readonly pose: string;
  readonly framing: string;
  readonly hour: number;
}

/** The kinds the stage must be sent to go from `was` to `now`, in the order to send them. A print goes before the wardrobe that names it. */
export function previewChanges(was: Preview | null, now: Preview): StageCommand["kind"][] {
  const out: StageCommand["kind"][] = [];
  if (!was || was.look !== now.look) out.push("look");
  if (now.print !== "" && (!was || was.print !== now.print)) out.push("print");
  if (!was || was.wardrobe !== now.wardrobe) out.push("wardrobe");
  if (!was || was.pose !== now.pose) out.push("pose");
  if (!was || was.framing !== now.framing) out.push("framing");
  if (!was || was.hour !== now.hour) out.push("hour");
  return out;
}

export const POSE_WORDS: Readonly<Record<StagePose, string>> = { idle: "Standing", walk: "Walking", tool: "Holding a tool", seated: "Seated" };
export const FRAMING_WORDS: Readonly<Record<StageFraming, string>> = { "three-quarter": "Three-quarter", full: "Front", back: "Back", portrait: "Portrait" };

// ---- The palette ----

/** The colours a garment may be made in: white, black, the dyes and the natural tones. 0 is the garment's own. */
export const CLOTH_COLOURS: readonly number[] = [10, 11, ...Array.from({ length: SKIN_BASE - RAMP_BASE }, (_, k) => RAMP_BASE + k)];

/** The CSS colour of palette entry `i` of an RGBA palette. */
export const hexOf = (palette: Uint8Array, i: number): string => `#${[0, 1, 2].map((c) => palette[i * 4 + c]!.toString(16).padStart(2, "0")).join("")}`;

// ---- The page's lists as HTML ----

const when = (ms: number | undefined): string => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "");

function swatches(palette: Uint8Array, colours: readonly number[]): string {
  return colours.map((c) => (c === 0 ? `<i class="sw own" title="the garment's own"></i>` : `<i class="sw" style="background:${hexOf(palette, c)}" title="colour ${c}"></i>`)).join("");
}

/** The published editions, newest first, each with what it is, who made it, and its buttons. */
export function editionsHtml(state: PeopleState, palette: Uint8Array, selected: number): string {
  if (state.editions.length === 0) return `<p class="dim">No edition is published yet. Start one from a garment below.</p>`;
  const label = new Map(state.garments.map((g) => [g.id, g.label]));
  return [...state.editions].reverse().map((e) => {
    const thumb = e.printPath ? `<img src="${esc(e.printPath)}" alt="" width="${e.print!.width >= e.print!.height * 2 ? 56 : 40}" height="40" loading="lazy">` : `<span class="no-print">no print</span>`;
    const by = e.by ? ` · ${esc(e.by)}${e.at ? `, ${when(e.at)}` : ""}` : "";
    return `<div class="edition${e.retired ? " retired" : ""}${e.id === selected ? " picked" : ""}" data-edition="${e.id}">
      <button class="thumb" data-show="${e.id}" title="Show on the person">${thumb}</button>
      <div class="what"><b>${esc(e.name)}</b>${e.retired ? ` <span class="chip">retired</span>` : ""}<br><span class="faint">#${e.id} · ${esc(label.get(e.garment) ?? e.garment)}${by}</span><br>${swatches(palette, e.colours)}</div>
      <div class="acts"><button data-copy="${e.id}">Start from</button><button data-retire="${e.id}" data-retired="${e.retired ? "0" : "1"}">${e.retired ? "Bring back" : "Retire"}</button></div>
    </div>`;
  }).join("");
}

/** A button for each garment to start a new edition of. */
export function garmentsHtml(state: PeopleState): string {
  if (state.garments.length === 0) return `<p class="dim">This world's content has no garments.</p>`;
  return state.garments.map((g) => `<button data-start="${esc(g.id)}">New ${esc(g.label)}<span class="faint"> · ${esc(g.slot)}${g.dyes ? "" : ", own colours"}</span></button>`).join("");
}

/** The palette as buttons, the colour in hand marked. */
export function paletteHtml(palette: Uint8Array, current: number): string {
  const own = `<button class="sw own${current === 0 ? " on" : ""}" data-colour="0" title="The garment's own colour" aria-label="The garment's own colour"></button>`;
  return own + CLOTH_COLOURS.map((c) => `<button class="sw${c === current ? " on" : ""}" data-colour="${c}" style="background:${hexOf(palette, c)}" title="Colour ${c}" aria-label="Colour ${c}"></button>`).join("");
}

/** The sheet's layers, topmost first, the one in hand marked. */
export function layersHtml(sheet: Sheet, selected: number, faults: readonly Fault[]): string {
  if (sheet.layers.length === 0) return `<p class="faint">No layers yet.</p>`;
  return [...sheet.layers].reverse().map((l) => {
    const what = l.kind === "text" ? `Text “${esc(l.text)}”` : l.kind === "shape" ? `Shape: ${l.shape}` : `Picture: ${esc(l.name)}`;
    const wrong = faults.some((f) => f.at === `layer:${l.id}`);
    return `<div class="layer${l.id === selected ? " picked" : ""}${wrong ? " wrong" : ""}" data-layer="${l.id}"><button data-pick-layer="${l.id}">${what}</button><span class="grow"></span><button data-layer-up="${l.id}" aria-label="Up" title="Up">↑</button><button data-layer-down="${l.id}" aria-label="Down" title="Down">↓</button><button data-layer-del="${l.id}" class="risk" aria-label="Remove" title="Remove">✕</button></div>`;
  }).join("");
}
