// The person stage's messages (client/entry/person-stage.ts): what an admin page posts to the stage in its iframe, and
// what the stage answers. Both sides import this file. The stage takes messages only from its parent on its own origin.
//
// To the stage, each `{ to: STAGE_TO, kind, id?, ... }`; `id` is the sender's own number, echoed in the answer:
//   look       look: the 72 look bytes (shared/anim/look.ts), as a Uint8Array or a list of numbers
//   gear       held: an item id or null; armor: five item ids or nulls, hat, shirt, gloves, pants, boots
//   wardrobe   slots: five garments or nulls, each { item, edition, dye: three palette bytes, print: a print key or null };
//              an unpublished draft is edition 0 and carries its dye and print here; hide: skin zones to leave undrawn
//   print      key, and url (a path on this origin or a blob: address) or png bytes: a garment draft's picture
//   pose       pose: idle, walk, tool or seated; at: hold the move this share of the way through, or null to play it
//   hour       hour: 0 to 24, the game's own sky and sun at that hour
//   framing    framing: full, portrait, back or three-quarter
//   picture    width, height: optional, 64 to 2,048; answered with a PNG of the next settled frame
// From the stage, each `{ from: STAGE_FROM, kind, id?, ... }`:
//   ready      once, when the first frame with the person in it is drawn
//   applied    a message was taken; `held` says what the stage now holds of that kind, `notes` what it could not take
//              (an id its content lacks); a print is answered once its picture is decoded
//   picture    png: the picture, a Blob; width, height
//   error      detail: the stage cannot draw (no WebGL, a file it could not fetch)
// A message that is not one of these, or is malformed, is ignored with a note on the stage's console.

import { LOOK_BYTES } from "../anim/look.ts";

export const STAGE_TO = "snark-person-stage";
export const STAGE_FROM = "snark-person-stage-reply";

/** Hat, shirt, gloves, pants, boots: the armor slots, and the wardrobe's five garment slots. */
export const STAGE_SLOTS = 5;
export const STAGE_POSES = ["idle", "walk", "tool", "seated"] as const;
export const STAGE_FRAMINGS = ["full", "portrait", "back", "three-quarter"] as const;
export const PICTURE_SIDE = { least: 64, most: 2048 } as const;
/** The most bytes one print picture may be. */
export const PRINT_MOST_BYTES = 8 << 20;

export type StagePose = (typeof STAGE_POSES)[number];
export type StageFraming = (typeof STAGE_FRAMINGS)[number];

export interface StageGarment {
  readonly item: string;
  /** A published edition's number, or 0 for an unpublished draft. */
  readonly edition: number;
  /** Three palette bytes. */
  readonly dye: readonly [number, number, number];
  readonly print: string | null;
}

export type StageCommand =
  | { readonly kind: "look"; readonly id?: number; readonly look: Uint8Array }
  | { readonly kind: "gear"; readonly id?: number; readonly held: string | null; readonly armor: readonly (string | null)[] }
  | { readonly kind: "wardrobe"; readonly id?: number; readonly slots: readonly (StageGarment | null)[]; readonly hide: number }
  | { readonly kind: "print"; readonly id?: number; readonly key: string; readonly url: string | null; readonly png: Uint8Array | null }
  | { readonly kind: "pose"; readonly id?: number; readonly pose: StagePose; readonly at: number | null }
  | { readonly kind: "hour"; readonly id?: number; readonly hour: number }
  | { readonly kind: "framing"; readonly id?: number; readonly framing: StageFraming }
  | { readonly kind: "picture"; readonly id?: number; readonly width: number | null; readonly height: number | null };

/** What the stage answers, before it is addressed. `png` is a Blob, which this zone has no type for. */
export type StageAnswer =
  | { readonly kind: "ready"; readonly meshes: readonly string[] }
  | { readonly kind: "applied"; readonly id?: number; readonly of: StageCommand["kind"]; readonly held: unknown; readonly notes: readonly string[] }
  | { readonly kind: "picture"; readonly id?: number; readonly png: unknown; readonly width: number; readonly height: number }
  | { readonly kind: "error"; readonly detail: string };
export type StageReply = StageAnswer & { readonly from: typeof STAGE_FROM };

/** What a parse gives: the command, or why the message is not one. */
export type Parsed = { readonly command: StageCommand; readonly problem?: undefined } | { readonly command?: undefined; readonly problem: string };

const ITEM_ID = /^[a-z0-9_]+:[a-z0-9_./-]+$/;
const PRINT_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

type Fields = Record<string, unknown>;

const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isByte = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;
const itemOrNull = (v: unknown): v is string | null => v === null || (typeof v === "string" && v.length <= 96 && ITEM_ID.test(v));

/** Bytes from a Uint8Array, an ArrayBuffer or a list of bytes; null for anything else. */
function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v) && v.every(isByte)) return Uint8Array.from(v);
  return null;
}

/** A path on the page's own origin, or a blob: address, which is always the origin that made it. */
function sameOriginUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= 2048 && (v.startsWith("blob:") || (v.startsWith("/") && !v.startsWith("//") && !v.includes("\\")));
}

function garmentOf(v: unknown): StageGarment | null | string {
  if (v === null) return null;
  if (!isObject(v)) return "a garment is an object or null";
  if (typeof v.item !== "string" || !itemOrNull(v.item)) return "a garment's item is an item id";
  if (typeof v.edition !== "number" || !Number.isInteger(v.edition) || v.edition < 0 || v.edition > 0xffffffff) return "a garment's edition is a whole number, 0 for a draft";
  if (!Array.isArray(v.dye) || v.dye.length !== 3 || !v.dye.every(isByte)) return "a garment's dye is three palette bytes";
  if (v.print !== null && (typeof v.print !== "string" || !PRINT_KEY.test(v.print))) return "a garment's print is a print key or null";
  return { item: v.item, edition: v.edition, dye: [v.dye[0], v.dye[1], v.dye[2]], print: v.print };
}

function side(v: unknown): number | null | string {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < PICTURE_SIDE.least || v > PICTURE_SIDE.most) return `a picture's side is a whole number from ${PICTURE_SIDE.least} to ${PICTURE_SIDE.most}`;
  return v;
}

/** The command `data` is, or why it is not one. Only shape is judged here; the stage judges ids against its content. */
export function parseStageCommand(data: unknown): Parsed {
  if (!isObject(data) || data.to !== STAGE_TO) return { problem: "not addressed to the person stage" };
  const id = data.id === undefined ? undefined : typeof data.id === "number" && Number.isInteger(data.id) ? data.id : null;
  if (id === null) return { problem: "an id is a whole number" };
  const withId = id === undefined ? {} : { id };
  switch (data.kind) {
    case "look": {
      const look = bytesOf(data.look);
      if (!look || look.length !== LOOK_BYTES) return { problem: `a look is ${LOOK_BYTES} bytes` };
      return { command: { kind: "look", ...withId, look: Uint8Array.from(look) } };
    }
    case "gear": {
      const held = data.held ?? null;
      if (!itemOrNull(held)) return { problem: "held is an item id or null" };
      const armor = data.armor ?? [null, null, null, null, null];
      if (!Array.isArray(armor) || armor.length !== STAGE_SLOTS || !armor.every(itemOrNull)) return { problem: `armor is ${STAGE_SLOTS} item ids or nulls` };
      return { command: { kind: "gear", ...withId, held, armor: [...armor] } };
    }
    case "wardrobe": {
      if (!Array.isArray(data.slots) || data.slots.length !== STAGE_SLOTS) return { problem: `a wardrobe is ${STAGE_SLOTS} slots` };
      const slots: (StageGarment | null)[] = [];
      for (const s of data.slots) {
        const g = garmentOf(s);
        if (typeof g === "string") return { problem: g };
        slots.push(g);
      }
      const hide = data.hide ?? 0;
      if (typeof hide !== "number" || !Number.isInteger(hide) || hide < 0 || hide > 0xffffffff) return { problem: "hide is a mask of skin zones" };
      return { command: { kind: "wardrobe", ...withId, slots, hide: hide >>> 0 } };
    }
    case "print": {
      if (typeof data.key !== "string" || !PRINT_KEY.test(data.key)) return { problem: "a print's key is 1 to 64 letters, digits or _.:-" };
      const url = data.url ?? null, png = data.png === undefined || data.png === null ? null : bytesOf(data.png);
      if (url !== null && !sameOriginUrl(url)) return { problem: "a print's url is a path on this origin or a blob: address" };
      if (data.png !== undefined && data.png !== null && !png) return { problem: "a print's png is bytes" };
      if ((url === null) === (png === null)) return { problem: "a print has a url or png bytes, not both" };
      if (png && png.length > PRINT_MOST_BYTES) return { problem: "a print's png is too large" };
      return { command: { kind: "print", ...withId, key: data.key, url, png } };
    }
    case "pose": {
      if (!(STAGE_POSES as readonly unknown[]).includes(data.pose)) return { problem: `a pose is one of ${STAGE_POSES.join(", ")}` };
      const at = data.at ?? null;
      if (at !== null && (typeof at !== "number" || !(at >= 0 && at <= 1))) return { problem: "at is a share from 0 to 1, or null" };
      return { command: { kind: "pose", ...withId, pose: data.pose as StagePose, at } };
    }
    case "hour": {
      if (typeof data.hour !== "number" || !(data.hour >= 0 && data.hour <= 24)) return { problem: "an hour is from 0 to 24" };
      return { command: { kind: "hour", ...withId, hour: data.hour } };
    }
    case "framing": {
      if (!(STAGE_FRAMINGS as readonly unknown[]).includes(data.framing)) return { problem: `a framing is one of ${STAGE_FRAMINGS.join(", ")}` };
      return { command: { kind: "framing", ...withId, framing: data.framing as StageFraming } };
    }
    case "picture": {
      const width = side(data.width), height = side(data.height);
      if (typeof width === "string") return { problem: width };
      if (typeof height === "string") return { problem: height };
      if ((width === null) !== (height === null)) return { problem: "a picture gives both sides or neither" };
      return { command: { kind: "picture", ...withId, width, height } };
    }
    default:
      return { problem: `no such kind: ${String(data.kind).slice(0, 40)}` };
  }
}

/** A message for the stage: what a page posts, `{ to }` filled in. */
export function stageMessage(command: StageCommand): StageCommand & { to: typeof STAGE_TO } {
  return { ...command, to: STAGE_TO };
}

/** Whether `data` is an answer from the stage, for a parent page's listener. */
export function isStageReply(data: unknown): data is StageReply {
  return isObject(data) && data.from === STAGE_FROM && typeof data.kind === "string";
}
