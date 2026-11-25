// A blueprint is a copy of a base: pieces by key about an anchor, the anchor at tuple (0, 0, 0, 0) and level 0. Here are its
// bytes, its text for sharing, its exact turns, mirror and moves, and its checks. Nothing here reads a store.
// A piece's own +X is direction dir − rot·(12 / turns), as formPose turns it. A flipped piece is mirrored in its own X
// about the middle of its slot, so it fills the same cells.

import { hashBytes } from "../hash.ts";
import { BitReader, BitWriter, fitBytes } from "../net/codec.ts";
import { FORM_LAYERS, SLOT_CLASSES, STOREY_LEVELS, type FormSlot } from "./lattice/forms.ts";
import {
  CLS_EDGE,
  CLS_SQUARE,
  CLS_TRIANGLE,
  CLS_VERTEX,
  DIRECTIONS,
  DIRS,
  LVL_MOST,
  M_MOST,
  SIDE,
  type Tuples,
  canon,
  canonical,
  dirTurn,
  edgesOverlap,
  elementCorners,
  facesOverlap,
  idealX,
  idealY,
  key0,
  key1,
  keyAnchor,
  keyCls,
  keyDir,
  keyFlip,
  keyLayer,
  keyLvl,
  keyM0,
  keyM1,
  keyM2,
  keyM3,
  keyRot,
  keyValid,
  tupleMirror,
  tupleStep,
  tupleTurn,
  tupleWithin,
} from "./lattice/module.ts";

export const BLUEPRINT_FORMAT = 1;
export const BLUEPRINT_PIECES_MOST = 2000;
export const BLUEPRINT_NAME_BYTES = 32;
export const BLUEPRINT_AUTHOR_BYTES = 24;
export const BLUEPRINT_DESCRIPTION_BYTES = 120;
export const BLUEPRINT_FORM_BYTES = 32;
/** What a blueprint's text starts with. */
export const BLUEPRINT_PREFIX = "snbp:";
/** The tier of a piece that may be built of any material. Tiers below it are thatch 0, wood 1, stone 2, metal 3 and on. */
export const TIER_ANY = 7;

export interface BlueprintPiece {
  /** The name of its form row, as content names it. */
  readonly form: string;
  /** 0 to 6, or TIER_ANY. */
  readonly tier: number;
  /** Its key about the blueprint's anchor, with its turn and flip, as key0 and key1 pack it. */
  readonly k0: number;
  readonly k1: number;
}

/** Pieces are in order of level, anchor, direction and layer. */
export interface Blueprint {
  readonly name: string;
  readonly author: string;
  readonly description: string;
  readonly pieces: readonly BlueprintPiece[];
}

/** The form rows by name: content's ALL_FORMS, or those of them a caller builds. */
export type BlueprintForms = Readonly<Record<string, FormSlot>>;

export type BlueprintFault =
  | { readonly reason: "bad text" }
  | { readonly reason: "too long" }
  | { readonly reason: "bad magic" }
  | { readonly reason: "unknown format"; readonly format: number }
  | { readonly reason: "truncated" }
  | { readonly reason: "string too long" }
  | { readonly reason: "too many pieces"; readonly count: number }
  | { readonly reason: "bad form table" }
  | { readonly reason: "trailing bytes" }
  | { readonly reason: "bad checksum" }
  | { readonly reason: "unknown form"; readonly name: string }
  | { readonly reason: "bad tier"; readonly piece: number }
  | { readonly reason: "key out of range"; readonly piece: number }
  | { readonly reason: "duplicate cell"; readonly piece: number; readonly other: number };

export type BlueprintBytes = { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly fault: BlueprintFault };
export type BlueprintText = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly fault: BlueprintFault };
export type BlueprintRead = { readonly ok: true; readonly blueprint: Blueprint } | { readonly ok: false; readonly fault: BlueprintFault };
/** `pieces` are those that left the key range or whose form cannot take the turn, by their place in what was given. */
export type BlueprintMoved = { readonly ok: true; readonly blueprint: Blueprint } | { readonly ok: false; readonly pieces: readonly number[] };

export interface BlueprintCheck {
  /** Pairs of pieces that claim one cell. */
  readonly clashes: readonly (readonly [number, number])[];
  /** Pairs of faces that share area, or of edges that share length, in one layer and at one height, with no cell in common. */
  readonly overlaps: readonly (readonly [number, number])[];
  /** The pieces of each joined part, the largest part first. A blueprint that holds together has one. */
  readonly parts: readonly (readonly number[])[];
  /** How many pieces of each form and tier, in order of form and tier. */
  readonly counts: readonly { readonly form: string; readonly tier: number; readonly count: number }[];
}

/** What placing reads of a form, as numbers. */
interface Facts {
  readonly cls: number;
  readonly layer: number;
  /** Half-sides along one edge of its slot. */
  readonly side: number;
  /** Edges in a row. */
  readonly wide: number;
  readonly span: number;
  readonly turns: number;
  /** Quarter storeys from its level up to its highest cell. */
  readonly top: number;
}

const known = new WeakMap<FormSlot, Facts>();
const owns = Object.prototype.hasOwnProperty;

function factsOf(forms: BlueprintForms, name: string): Facts | null {
  if (!owns.call(forms, name)) return null;
  const form = forms[name]!;
  let facts = known.get(form);
  if (!facts) {
    let wide = 1;
    let top = Math.max(0, Math.ceil(form.span / STOREY_LEVELS) - 1) * STOREY_LEVELS;
    for (const [edge, up] of form.cells ?? []) {
      wide = Math.max(wide, edge + 1);
      top = Math.max(top, up);
    }
    facts = { cls: SLOT_CLASSES.indexOf(form.cls), layer: FORM_LAYERS.indexOf(form.layer), side: form.size ?? SIDE, wide, span: form.span, turns: form.turns, top };
    known.set(form, facts);
  }
  return facts;
}

const T = new Int32Array(8);

/** Whether a key is one a piece of this form can have, with every cell of the piece in range. */
function fits(f: Facts, k0: number, k1: number): boolean {
  if (k0 !== k0 >>> 0 || k1 !== k1 >>> 0 || !keyValid(k0, k1)) return false;
  if (keyCls(k0) !== f.cls || keyLayer(k1) !== f.layer || keyRot(k1) >= f.turns || keyLvl(k1) + f.top > LVL_MOST) return false;
  if (f.wide === 1) return true;
  keyAnchor(k0, k1, T, 0);
  tupleStep(T, 0, keyDir(k1), (f.wide - 1) * f.side, T, 0);
  return tupleWithin(T, 0, M_MOST);
}

/** What a piece claims, to `out`: each edge or face it covers, at each quarter storey of its height. */
function claims(f: Facts, k0: number, k1: number, out: string[]): void {
  out.length = 0;
  const dir = keyDir(k1);
  const lvl = keyLvl(k1);
  const high = Math.max(1, f.span);
  keyAnchor(k0, k1, T, 0);
  for (let edge = 0; edge < f.wide; edge++) {
    const cell = `${f.cls},${f.layer},${dir},${T[0]},${T[1]},${T[2]},${T[3]},`;
    for (let up = 0; up < high; up++) out.push(cell + (lvl + up));
    tupleStep(T, 0, dir, f.side, T, 0);
  }
}

function order(a: BlueprintPiece, b: BlueprintPiece): number {
  return (
    keyLvl(a.k1) - keyLvl(b.k1) ||
    keyM0(a.k0) - keyM0(b.k0) ||
    keyM1(a.k0) - keyM1(b.k0) ||
    keyM2(a.k0) - keyM2(b.k0) ||
    keyM3(a.k1) - keyM3(b.k1) ||
    keyDir(a.k1) - keyDir(b.k1) ||
    keyLayer(a.k1) - keyLayer(b.k1) ||
    keyCls(a.k0) - keyCls(b.k0) ||
    (a.form < b.form ? -1 : a.form > b.form ? 1 : 0) ||
    a.k1 - b.k1 ||
    a.tier - b.tier
  );
}

function sorted(pieces: readonly BlueprintPiece[]): readonly BlueprintPiece[] {
  for (let i = 1; i < pieces.length; i++) if (order(pieces[i - 1]!, pieces[i]!) > 0) return [...pieces].sort(order);
  return pieces;
}

/** A blueprint of these pieces, put in order, with its strings cut to their limits. */
export function makeBlueprint(name: string, author: string, description: string, pieces: readonly BlueprintPiece[]): Blueprint {
  return { name: fitBytes(name, BLUEPRINT_NAME_BYTES), author: fitBytes(author, BLUEPRINT_AUTHOR_BYTES), description: fitBytes(description, BLUEPRINT_DESCRIPTION_BYTES), pieces: sorted(pieces) };
}

/** What stops a blueprint from being written, or null: what decoding refuses of the pieces themselves. */
export function blueprintFault(bp: Blueprint, forms: BlueprintForms): BlueprintFault | null {
  if (bp.pieces.length > BLUEPRINT_PIECES_MOST) return { reason: "too many pieces", count: bp.pieces.length };
  const claimed = new Map<string, number>();
  const mine: string[] = [];
  for (const [i, p] of bp.pieces.entries()) {
    const f = factsOf(forms, p.form);
    if (!f) return { reason: "unknown form", name: p.form };
    if (fitBytes(p.form, BLUEPRINT_FORM_BYTES) !== p.form) return { reason: "string too long" };
    if (!Number.isInteger(p.tier) || p.tier < 0 || p.tier > TIER_ANY) return { reason: "bad tier", piece: i };
    if (!fits(f, p.k0, p.k1)) return { reason: "key out of range", piece: i };
    claims(f, p.k0, p.k1, mine);
    for (const cell of mine) {
      const other = claimed.get(cell);
      if (other !== undefined) return { reason: "duplicate cell", piece: i, other };
      claimed.set(cell, i);
    }
  }
  return null;
}

// The bytes, least bit first as BitWriter writes:
//   "SNBP", format u8, name, author and description (a varint of bytes, then UTF-8), pieces varint, forms varint, each
//   form's name, then each piece in order, zero bits to a whole byte, and FNV-1a 32 of every byte before it.
// A piece:
//   form     its place in the table, in the fewest bits that hold the table's size
//   anchor   2 bits: 0 the last piece's | 1 a whole side on from it: 1 bit, and if set the direction in 4, else the last
//            step's | 2 four differences, each 1 bit and if set 7 bits, signed | 3 four coordinates of 10 bits, signed
//   level    1 bit, and if set the difference in 10 bits, signed
//   dir      4 bits
//   turn     1 bit, and if set rot in 2 bits and flip in 1, else those of the last piece of its form
//   tier     1 bit, and if set the tier in 3
// Before the first piece the anchor, the level and the tier are 0, no form is turned or flipped, and the last step ran
// along direction 3, as a row of squares runs in the pieces' order.
const MAGIC = [0x53, 0x4e, 0x42, 0x50];
const SAME = 0;
const STEP = 1;
const NEAR = 2;
const FAR = 3;
const NEAR_BITS = 7;
const NEAR_MOST = (1 << (NEAR_BITS - 1)) - 1;
const FAR_BITS = 10;
const LEVEL_BITS = 10;
const FIRST_STEP = 3;
const PIECE_BITS_MOST = 11 + 2 + 4 * FAR_BITS + 1 + LEVEL_BITS + 4 + 4 + 4;
const HEAD_BYTES = 4 + 1 + 3 + BLUEPRINT_NAME_BYTES + BLUEPRINT_AUTHOR_BYTES + BLUEPRINT_DESCRIPTION_BYTES + 2 + 2;
/** The most bytes a blueprint takes. */
export const BLUEPRINT_BYTES_MOST = HEAD_BYTES + BLUEPRINT_PIECES_MOST * (1 + BLUEPRINT_FORM_BYTES) + Math.ceil((BLUEPRINT_PIECES_MOST * PIECE_BITS_MOST) / 8) + 4;
/** The most characters of text read, with room for the spaces and line ends a message adds. */
const TEXT_MOST = 2 * BLUEPRINT_BYTES_MOST;

const bitsFor = (n: number): number => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));
const near = (d: number): boolean => d >= -NEAR_MOST - 1 && d <= NEAR_MOST;

/** The direction a whole side along which is this difference, or -1. */
function stepOf(d0: number, d1: number, d2: number, d3: number): number {
  for (let k = 0; k < DIRECTIONS; k++) {
    if (d0 === SIDE * DIRS[4 * k]! && d1 === SIDE * DIRS[4 * k + 1]! && d2 === SIDE * DIRS[4 * k + 2]! && d3 === SIDE * DIRS[4 * k + 3]!) return k;
  }
  return -1;
}

/** A blueprint's bytes. Its strings are cut to their limits, and a blueprint decoding would refuse is refused here. */
export function encodeBlueprint(bp: Blueprint, forms: BlueprintForms): BlueprintBytes {
  const fault = blueprintFault(bp, forms);
  if (fault) return { ok: false, fault };
  const pieces = sorted(bp.pieces);
  const names: string[] = [];
  const places = new Map<string, number>();
  for (const p of pieces) {
    if (places.has(p.form)) continue;
    places.set(p.form, names.length);
    names.push(p.form);
  }
  const w = new BitWriter(HEAD_BYTES + names.length * (1 + BLUEPRINT_FORM_BYTES) + Math.ceil((pieces.length * PIECE_BITS_MOST) / 8) + 4);
  for (const byte of MAGIC) w.u8(byte);
  w.u8(BLUEPRINT_FORMAT);
  w.string(fitBytes(bp.name, BLUEPRINT_NAME_BYTES));
  w.string(fitBytes(bp.author, BLUEPRINT_AUTHOR_BYTES));
  w.string(fitBytes(bp.description, BLUEPRINT_DESCRIPTION_BYTES));
  w.varint(pieces.length);
  w.varint(names.length);
  for (const name of names) w.string(name);
  const formBits = bitsFor(names.length);
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let lvl = 0;
  let tier = 0;
  let along = FIRST_STEP;
  const turns = new Uint8Array(names.length);
  for (const p of pieces) {
    const form = places.get(p.form)!;
    w.bits(form, formBits);
    const a0 = keyM0(p.k0);
    const a1 = keyM1(p.k0);
    const a2 = keyM2(p.k0);
    const a3 = keyM3(p.k1);
    const step = stepOf(a0 - m0, a1 - m1, a2 - m2, a3 - m3);
    if (a0 === m0 && a1 === m1 && a2 === m2 && a3 === m3) w.bits(SAME, 2);
    else if (step >= 0) {
      w.bits(STEP, 2);
      w.bool(step !== along);
      if (step !== along) w.bits(step, 4);
      along = step;
    } else if (near(a0 - m0) && near(a1 - m1) && near(a2 - m2) && near(a3 - m3)) {
      w.bits(NEAR, 2);
      for (const d of [a0 - m0, a1 - m1, a2 - m2, a3 - m3]) {
        w.bool(d !== 0);
        if (d !== 0) w.sbits(d, NEAR_BITS);
      }
    } else {
      w.bits(FAR, 2);
      w.sbits(a0, FAR_BITS);
      w.sbits(a1, FAR_BITS);
      w.sbits(a2, FAR_BITS);
      w.sbits(a3, FAR_BITS);
    }
    m0 = a0;
    m1 = a1;
    m2 = a2;
    m3 = a3;
    const level = keyLvl(p.k1);
    w.bool(level !== lvl);
    if (level !== lvl) w.sbits(level - lvl, LEVEL_BITS);
    lvl = level;
    w.bits(keyDir(p.k1), 4);
    const turn = keyRot(p.k1) | (keyFlip(p.k1) << 2);
    w.bool(turn !== turns[form]);
    if (turn !== turns[form]) w.bits(turn, 3);
    turns[form] = turn;
    w.bool(p.tier !== tier);
    if (p.tier !== tier) w.bits(p.tier, 3);
    tier = p.tier;
  }
  w.pos = (w.pos + 7) & ~7;
  w.u32(hashBytes(w.bytes()));
  return { ok: true, bytes: w.bytes().slice() };
}

const refuse = (fault: BlueprintFault): BlueprintRead => ({ ok: false, fault });

/** Reads a string of at most `most` bytes, or says why not. */
function readString(r: BitReader, most: number): string | BlueprintFault {
  const at = r.pos;
  const n = r.varint();
  if (r.overflow) return { reason: "truncated" };
  if (n > most) return { reason: "string too long" };
  r.pos = at;
  const s = r.string(most);
  return r.overflow ? { reason: "truncated" } : s;
}

/** The blueprint these bytes hold, or why they hold none. It never throws. */
export function decodeBlueprint(bytes: Uint8Array, forms: BlueprintForms): BlueprintRead {
  for (let i = 0; i < MAGIC.length; i++) {
    if (i >= bytes.length) return refuse({ reason: "truncated" });
    if (bytes[i] !== MAGIC[i]) return refuse({ reason: "bad magic" });
  }
  if (bytes.length < 5) return refuse({ reason: "truncated" });
  if (bytes[4] !== BLUEPRINT_FORMAT) return refuse({ reason: "unknown format", format: bytes[4]! });
  const r = new BitReader(bytes);
  r.pos = 40;
  const name = readString(r, BLUEPRINT_NAME_BYTES);
  if (typeof name !== "string") return refuse(name);
  const author = readString(r, BLUEPRINT_AUTHOR_BYTES);
  if (typeof author !== "string") return refuse(author);
  const description = readString(r, BLUEPRINT_DESCRIPTION_BYTES);
  if (typeof description !== "string") return refuse(description);
  const count = r.varint();
  const tabled = r.varint();
  if (r.overflow) return refuse({ reason: "truncated" });
  if (count > BLUEPRINT_PIECES_MOST) return refuse({ reason: "too many pieces", count });
  if (tabled > count) return refuse({ reason: "bad form table" });
  const names: string[] = [];
  for (let i = 0; i < tabled; i++) {
    const form = readString(r, BLUEPRINT_FORM_BYTES);
    if (typeof form !== "string") return refuse(form);
    names.push(form);
  }

  // The pieces are walked whole before anything is said of them, so that damage is a bad checksum and not what it damaged.
  const formBits = bitsFor(tabled);
  const raw = new Int32Array(count * 9);
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let lvl = 0;
  let tier = 0;
  let along = FIRST_STEP;
  const turns = new Uint8Array(tabled);
  for (let i = 0; i < count; i++) {
    const form = r.bits(formBits);
    const sel = r.bits(2);
    // A direction past the twelfth is no step: a level no key has marks the piece.
    let lost = false;
    if (sel === STEP) {
      if (r.bool()) along = r.bits(4);
      lost = along >= DIRECTIONS;
      const e = lost ? 0 : 4 * along;
      m0 += SIDE * DIRS[e]!;
      m1 += SIDE * DIRS[e + 1]!;
      m2 += SIDE * DIRS[e + 2]!;
      m3 += SIDE * DIRS[e + 3]!;
    } else if (sel === NEAR) {
      if (r.bool()) m0 += r.sbits(NEAR_BITS);
      if (r.bool()) m1 += r.sbits(NEAR_BITS);
      if (r.bool()) m2 += r.sbits(NEAR_BITS);
      if (r.bool()) m3 += r.sbits(NEAR_BITS);
    } else if (sel === FAR) {
      m0 = r.sbits(FAR_BITS);
      m1 = r.sbits(FAR_BITS);
      m2 = r.sbits(FAR_BITS);
      m3 = r.sbits(FAR_BITS);
    }
    if (r.bool()) lvl += r.sbits(LEVEL_BITS);
    const dir = r.bits(4);
    // A place past the table's end keeps nothing, and is refused once the sum is read.
    if (r.bool()) turns[form] = r.bits(3);
    if (r.bool()) tier = r.bits(3);
    raw.set([form, m0, m1, m2, m3, lost ? LVL_MOST + 1 : lvl, dir, turns[form] ?? 0, tier], i * 9);
  }
  r.pos = (r.pos + 7) & ~7;
  if (r.overflow || r.remainingBits < 32) return refuse({ reason: "truncated" });
  if (r.remainingBits > 32) return refuse({ reason: "trailing bytes" });
  if (r.u32() !== hashBytes(bytes.subarray(0, bytes.length - 4))) return refuse({ reason: "bad checksum" });

  const facts: Facts[] = [];
  for (const form of names) {
    const f = factsOf(forms, form);
    if (!f) return refuse({ reason: "unknown form", name: form });
    facts.push(f);
  }
  const pieces: BlueprintPiece[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * 9;
    const f = facts[raw[o]!];
    if (!f) return refuse({ reason: "bad form table" });
    // A key is packed only from numbers in range.
    if (!tupleWithin(raw, o + 1, M_MOST) || Math.abs(raw[o + 5]!) > LVL_MOST) return refuse({ reason: "key out of range", piece: i });
    const turn = raw[o + 7]!;
    pieces.push({ form: names[raw[o]!]!, tier: raw[o + 8]!, k0: key0(f.cls, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!), k1: key1(raw[o + 4]!, raw[o + 5]!, raw[o + 6]!, f.layer, turn & 3, turn >> 2) });
  }
  const fault = blueprintFault({ name, author, description, pieces }, forms);
  if (fault) return refuse(fault);
  return { ok: true, blueprint: { name, author, description, pieces: sorted(pieces) } };
}

const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) DIGIT[DIGITS.charCodeAt(i)] = i;

/** A blueprint's text: the prefix, then its bytes as URL-safe base64 with no padding. */
export function encodeBlueprintText(bp: Blueprint, forms: BlueprintForms): BlueprintText {
  const made = encodeBlueprint(bp, forms);
  if (!made.ok) return made;
  const parts: string[] = [BLUEPRINT_PREFIX];
  let held = 0;
  let n = 0;
  for (const byte of made.bytes) {
    held = (held << 8) | byte;
    n += 8;
    while (n >= 6) {
      n -= 6;
      parts.push(DIGITS[(held >>> n) & 63]!);
    }
    held &= (1 << n) - 1;
  }
  if (n > 0) parts.push(DIGITS[(held << (6 - n)) & 63]!);
  return { ok: true, text: parts.join("") };
}

/** The blueprint a text holds, or why it holds none. Spaces and line ends anywhere in it are passed over. It never throws. */
export function decodeBlueprintText(text: string, forms: BlueprintForms): BlueprintRead {
  if (text.length > TEXT_MOST) return refuse({ reason: "too long" });
  const s = text.replace(/\s+/g, "");
  const digits = s.length - BLUEPRINT_PREFIX.length;
  if (!s.startsWith(BLUEPRINT_PREFIX) || digits % 4 === 1) return refuse({ reason: "bad text" });
  const bytes = new Uint8Array(Math.floor((digits * 6) / 8));
  let held = 0;
  let n = 0;
  let o = 0;
  for (let i = BLUEPRINT_PREFIX.length; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const digit = c < 128 ? DIGIT[c]! : -1;
    if (digit < 0) return refuse({ reason: "bad text" });
    held = (held << 6) | digit;
    n += 6;
    if (n >= 8) {
      n -= 8;
      bytes[o++] = held >>> n;
      held &= (1 << n) - 1;
    }
  }
  // Bits left over are zero, so one text is one run of bytes.
  if (held !== 0) return refuse({ reason: "bad text" });
  return decodeBlueprint(bytes, forms);
}

/** Direction steps between a face's first side and its second, by class: what a mirror swaps. */
const SECOND_SIDE: readonly number[] = [0, 0, 3, 2];

/**
 * The rot that points a piece's own +X along `own`, in a slot whose canonical direction is `dir`, or -1 if its form has
 * no such turn. A form of one turn looks the same at every turn of its slot.
 */
function rotOf(turns: number, dir: number, own: number): number {
  if (turns === 1) return 0;
  const each = DIRECTIONS / turns;
  const off = dirTurn(dir, -own);
  return off % each === 0 ? off / each : -1;
}

/** The pieces mirrored across +X if asked, then turned `k` steps about the anchor, then moved. */
function moved(given: readonly BlueprintPiece[], forms: BlueprintForms, mirror: boolean, k: number, by: ArrayLike<number>, levels: number): { pieces: BlueprintPiece[]; lost: number[] } {
  const pieces: BlueprintPiece[] = [];
  const lost: number[] = [];
  for (const [i, p] of given.entries()) {
    const f = factsOf(forms, p.form);
    if (!f) {
      lost.push(i);
      continue;
    }
    keyAnchor(p.k0, p.k1, T, 0);
    // `named` is the direction the slot is named by from T, and `own` the piece's own +X.
    let named = keyDir(p.k1);
    let own = dirTurn(named, (-keyRot(p.k1) * DIRECTIONS) / f.turns);
    let flip = keyFlip(p.k1);
    if (mirror) {
      tupleMirror(T, 0, T, 0);
      named = dirTurn(-named, -SECOND_SIDE[f.cls]!);
      own = dirTurn(6, -own);
      flip ^= 1;
    }
    tupleTurn(T, 0, k, T, 0);
    named = dirTurn(named, k);
    own = dirTurn(own, k);
    canonical(f.cls, T, 0, named, T, 0, f.side * f.wide);
    T[0]! += by[0]!;
    T[1]! += by[1]!;
    T[2]! += by[2]!;
    T[3]! += by[3]!;
    const lvl = keyLvl(p.k1) + levels;
    const rot = rotOf(f.turns, canon.dir, own);
    if (rot < 0 || !tupleWithin(T, 0, M_MOST) || !(Math.abs(lvl) <= LVL_MOST)) {
      lost.push(i);
      continue;
    }
    const k0 = key0(f.cls, T[0]!, T[1]!, T[2]!);
    const k1 = key1(T[3]!, lvl, canon.dir, f.layer, rot, flip);
    if (fits(f, k0, k1)) pieces.push({ form: p.form, tier: p.tier, k0, k1 });
    else lost.push(i);
  }
  return { pieces, lost };
}

const NOWHERE: readonly number[] = [0, 0, 0, 0];

function remade(bp: Blueprint, forms: BlueprintForms, mirror: boolean, k: number, by: ArrayLike<number>, levels: number): BlueprintMoved {
  const { pieces, lost } = moved(bp.pieces, forms, mirror, k, by, levels);
  return lost.length > 0 ? { ok: false, pieces: lost } : { ok: true, blueprint: { name: bp.name, author: bp.author, description: bp.description, pieces: sorted(pieces) } };
}

/** The blueprint turned `k` steps of 30° about its anchor, toward +Z for a positive k. */
export function turnBlueprint(bp: Blueprint, forms: BlueprintForms, k: number): BlueprintMoved {
  return remade(bp, forms, false, k, NOWHERE, 0);
}

/** The blueprint mirrored across the +X axis through its anchor. Every piece's flip changes. */
export function mirrorBlueprint(bp: Blueprint, forms: BlueprintForms): BlueprintMoved {
  return remade(bp, forms, true, 0, NOWHERE, 0);
}

/** The blueprint moved by a tuple and by quarter storeys. */
export function moveBlueprint(bp: Blueprint, forms: BlueprintForms, by: ArrayLike<number>, levels: number): BlueprintMoved {
  return remade(bp, forms, false, 0, by, levels);
}

/** The blueprint mirrored if asked, then turned `k` steps about its anchor, then moved by a tuple and quarter storeys: what a paste does to it. */
export function placeBlueprint(bp: Blueprint, forms: BlueprintForms, mirror: boolean, k: number, by: ArrayLike<number>, levels: number): BlueprintMoved {
  return remade(bp, forms, mirror, k, by, levels);
}

/** The blueprint with its anchor at the anchor and level of the piece at `piece`. */
export function reanchorBlueprint(bp: Blueprint, forms: BlueprintForms, piece: number): BlueprintMoved {
  const p = bp.pieces[piece];
  if (!p) return { ok: false, pieces: [piece] };
  return remade(bp, forms, false, 0, [-keyM0(p.k0), -keyM1(p.k0), -keyM2(p.k0), -keyM3(p.k1)], -keyLvl(p.k1));
}

/** A blueprint of rows keyed in one frame, anchored at the row at `anchor`. A lost piece is by its place in `rows`. */
export function captureBlueprint(rows: readonly BlueprintPiece[], anchor: number, forms: BlueprintForms, name = "", author = "", description = ""): BlueprintMoved {
  const p = rows[anchor];
  if (!p) return { ok: false, pieces: [anchor] };
  const { pieces, lost } = moved(rows, forms, false, 0, [-keyM0(p.k0), -keyM1(p.k0), -keyM2(p.k0), -keyM3(p.k1)], -keyLvl(p.k1));
  return lost.length > 0 ? { ok: false, pieces: lost } : { ok: true, blueprint: makeBlueprint(name, author, description, pieces) };
}

/** A lattice point at a level as one number: coordinates within POINT_BIAS of zero, levels from -256 to 767. */
const POINT_BIAS = 520;
const POINT_WIDE = 2 * POINT_BIAS;
const pointOf = (m: Tuples, o: number, lvl: number): number => ((((m[o]! + POINT_BIAS) * POINT_WIDE + m[o + 1]! + POINT_BIAS) * POINT_WIDE + m[o + 2]! + POINT_BIAS) * POINT_WIDE + m[o + 3]! + POINT_BIAS) * 1024 + lvl + LVL_MOST + 1;

const C = new Int32Array(4 * 64);

/** The lattice points a piece touches others at, to C, and how many: its corners, and for whole sides their middles and a square's centre. */
function touches(f: Facts, k0: number, k1: number): number {
  const dir = keyDir(k1);
  keyAnchor(k0, k1, T, 0);
  if (f.cls === CLS_VERTEX) {
    C.set(T.subarray(0, 4));
    return 1;
  }
  const half = f.side === SIDE ? 1 : 0;
  if (f.cls === CLS_EDGE) {
    const n = f.wide * (1 + half) + 1;
    for (let i = 0; i < n; i++) tupleStep(T, 0, dir, (i * f.side) / (1 + half), C, 4 * i);
    return n;
  }
  const corners = elementCorners(f.cls, T, 0, dir, C, 0, f.side);
  if (half === 0) return corners;
  const turn = f.cls === CLS_SQUARE ? 3 : 4;
  for (let i = 0; i < corners; i++) tupleStep(C, 4 * i, dirTurn(dir, i * turn), 1, C, 4 * (corners + i));
  if (f.cls !== CLS_SQUARE) return 2 * corners;
  tupleStep(C, 4 * corners, dirTurn(dir, 3), 1, C, 8 * corners);
  return 2 * corners + 1;
}

/**
 * The pieces joined to the piece at `from`, itself first and then the nearest by joins, `most` at most: places in
 * `pieces`. Two are joined as checkBlueprint joins them. Pieces of a form not in `forms` join nothing.
 */
export function walkBlueprint(pieces: readonly BlueprintPiece[], forms: BlueprintForms, from: number, most: number): number[] {
  const at = new Map<number, number[]>();
  const points: number[][] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const f = factsOf(forms, p.form);
    const mine: number[] = [];
    points.push(mine);
    if (!f) continue;
    const n = touches(f, p.k0, p.k1);
    const lvl = keyLvl(p.k1);
    for (let c = 0; c < n; c++) {
      for (let up = 0; up <= f.span; up++) {
        const point = pointOf(C, 4 * c, lvl + up);
        mine.push(point);
        const list = at.get(point);
        if (list) list.push(i);
        else at.set(point, [i]);
      }
    }
  }
  const out: number[] = [];
  if (!(from >= 0 && from < pieces.length) || most <= 0) return out;
  const seen = new Uint8Array(pieces.length);
  seen[from] = 1;
  out.push(from);
  for (let head = 0; head < out.length && out.length < most; head++) {
    for (const point of points[out[head]!]!) {
      for (const j of at.get(point)!) {
        if (seen[j] === 1 || out.length >= most) continue;
        seen[j] = 1;
        out.push(j);
      }
    }
  }
  return out;
}

/** Float slack on the boxes that choose which pairs the exact tests see. */
const SLACK = 1e-6;

/**
 * What a blueprint's pieces do to each other: cells claimed twice, faces and edges that overlap, the parts it falls into
 * and what it is made of. Pieces of a form not in `forms` are counted and otherwise passed over.
 */
export function checkBlueprint(bp: Blueprint, forms: BlueprintForms): BlueprintCheck {
  const pieces = bp.pieces;
  const n = pieces.length;
  const facts = pieces.map((p) => factsOf(forms, p.form));

  const clashes: [number, number][] = [];
  const clashed = new Set<number>();
  const claimed = new Map<string, number>();
  const mine: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = facts[i];
    if (!f) continue;
    claims(f, pieces[i]!.k0, pieces[i]!.k1, mine);
    for (const cell of mine) {
      const other = claimed.get(cell);
      if (other === undefined) claimed.set(cell, i);
      else if (other !== i && !clashed.has(other * n + i)) {
        clashed.add(other * n + i);
        clashes.push([other, i]);
      }
    }
  }

  // Each edge's two ends and each face's corners, and a box about them in ideal coordinates.
  const corners = new Int32Array(n * 16);
  const box = new Float64Array(n * 4);
  const swept: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = facts[i];
    if (!f || f.cls === CLS_VERTEX) continue;
    const p = pieces[i]!;
    keyAnchor(p.k0, p.k1, T, 0);
    const count = elementCorners(f.cls, T, 0, keyDir(p.k1), corners, 16 * i, f.side * f.wide);
    box.fill(Infinity, 4 * i, 4 * i + 2);
    box.fill(-Infinity, 4 * i + 2, 4 * i + 4);
    for (let c = 0; c < count; c++) {
      const x = idealX(corners, 16 * i + 4 * c);
      const y = idealY(corners, 16 * i + 4 * c);
      box[4 * i] = Math.min(box[4 * i]!, x);
      box[4 * i + 1] = Math.min(box[4 * i + 1]!, y);
      box[4 * i + 2] = Math.max(box[4 * i + 2]!, x);
      box[4 * i + 3] = Math.max(box[4 * i + 3]!, y);
    }
    swept.push(i);
  }
  swept.sort((a, b) => box[4 * a]! - box[4 * b]! || a - b);
  const overlaps: [number, number][] = [];
  for (let s = 0; s < swept.length; s++) {
    const i = swept[s]!;
    const f = facts[i]!;
    const low = keyLvl(pieces[i]!.k1);
    for (let t = s + 1; t < swept.length && box[4 * swept[t]!]! <= box[4 * i + 2]! + SLACK; t++) {
      const j = swept[t]!;
      const g = facts[j]!;
      if (g.layer !== f.layer || (g.cls === CLS_EDGE) !== (f.cls === CLS_EDGE)) continue;
      if (box[4 * j + 1]! > box[4 * i + 3]! + SLACK || box[4 * i + 1]! > box[4 * j + 3]! + SLACK) continue;
      const other = keyLvl(pieces[j]!.k1);
      if (other >= low + Math.max(1, f.span) || low >= other + Math.max(1, g.span)) continue;
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      if (clashed.has(a * n + b)) continue;
      const over = f.cls === CLS_EDGE ? edgesOverlap(corners, 16 * i, corners, 16 * j) : facesOverlap(corners, 16 * i, f.cls === CLS_TRIANGLE ? 3 : 4, corners, 16 * j, g.cls === CLS_TRIANGLE ? 3 : 4);
      if (over) overlaps.push([a, b]);
    }
  }
  overlaps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Pieces are joined that touch one lattice point at one level, a piece's levels running from its foot to its top.
  const root = new Int32Array(n);
  for (let i = 0; i < n; i++) root[i] = i;
  const find = (i: number): number => {
    while (root[i] !== i) {
      root[i] = root[root[i]!]!;
      i = root[i]!;
    }
    return i;
  };
  const first = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const f = facts[i];
    if (!f) continue;
    const p = pieces[i]!;
    const points = touches(f, p.k0, p.k1);
    const lvl = keyLvl(p.k1);
    for (let c = 0; c < points; c++) {
      for (let up = 0; up <= f.span; up++) {
        const point = pointOf(C, 4 * c, lvl + up);
        const other = first.get(point);
        if (other === undefined) first.set(point, i);
        else root[find(i)] = find(other);
      }
    }
  }
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (!facts[i]) continue;
    const r = find(i);
    const part = byRoot.get(r);
    if (part) part.push(i);
    else byRoot.set(r, [i]);
  }
  const parts = [...byRoot.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!);

  const tally = new Map<string, number[]>();
  for (const p of pieces) {
    let tiers = tally.get(p.form);
    if (!tiers) tally.set(p.form, (tiers = []));
    tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;
  }
  const counts: { form: string; tier: number; count: number }[] = [];
  for (const form of [...tally.keys()].sort()) tally.get(form)!.forEach((count, tier) => counts.push({ form, tier, count }));
  return { clashes, overlaps, parts, counts };
}
