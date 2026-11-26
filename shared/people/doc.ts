// What the cluster's people store holds (server/people/store.ts), as the server keeps it, the admin pages send it and the
// clients read its manifest. Every record is one revision of one thing of a kind, under an id that kind gives once and
// never again; a revision is appended and never changed or deleted. A garment edition has one revision only: its cut,
// colours and print are what it is, and a change is a new edition. Named people, outfits and populations are kinds to
// come, whose revisions append.

/** The kinds of record the store holds. A new kind is appended; a kind's name is never reused. */
export const STORE_KINDS = ["edition"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

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
