// Templates: bases copied from the world as blueprints (shared/world/blueprint.ts) and kept on this device. Copying
// reads the rows the client already holds, costs nothing and tells the server nothing. A template is kept as its text,
// which is also what is shared.

import { fitBytes } from "../../shared/net/codec.ts";
import {
  BLUEPRINT_DESCRIPTION_BYTES,
  BLUEPRINT_NAME_BYTES,
  BLUEPRINT_PIECES_MOST,
  captureBlueprint,
  decodeBlueprintText,
  encodeBlueprintText,
  walkBlueprint,
  type Blueprint,
  type BlueprintFault,
  type BlueprintPiece,
} from "../../shared/world/blueprint.ts";
import { idealX, idealY, keyAnchor, keyLvl } from "../../shared/world/lattice/module.ts";
import type { PieceBook } from "../../shared/world/plan.ts";
import { Found, type StructureStore } from "../../shared/world/structures.ts";

/** Templates one device keeps. */
export const TEMPLATES_MOST = 32;

export type Captured = { readonly ok: true; readonly blueprint: Blueprint } | { readonly ok: false; readonly reason: string };

const found = new Found();
const key = { fr: 0, k0: 0, k1: 0 };
const T = new Int32Array(4);

/** The rows of the frame the piece `ref` is in, as blueprint pieces with tiers as built, and the place of `ref` among them. */
function rowsOf(structs: StructureStore, book: PieceBook, ref: number, team: number): { pieces: BlueprintPiece[]; aimed: number } | string {
  if (!structs.keyAt(ref, key)) return "That is no piece of a base";
  const frame = structs.frames.get(key.fr);
  if (!frame || team === 0 || frame.team !== team) return "That is not your tribe's";
  const n = structs.rowsOf(key.fr, found);
  const pieces: BlueprintPiece[] = [];
  let aimed = -1;
  for (let i = 0; i < n; i++) {
    const row = found.refs[i]!;
    const t = structs.chunks[Math.floor(row / 65536)]!;
    const slot = row & 0xffff;
    const kind = t.kind[slot]!;
    if (book.name[kind] === "") continue;
    if (row === ref) aimed = pieces.length;
    pieces.push({ form: book.name[kind]!, tier: book.tier[kind]!, k0: t.k0![slot]!, k1: t.k1![slot]! });
  }
  return aimed < 0 ? "That piece cannot be copied" : { pieces, aimed };
}

function made(book: PieceBook, pieces: readonly BlueprintPiece[], name: string, author: string, description: string): Captured {
  const moved = captureBlueprint(pieces, 0, book.forms, name, author, description);
  return moved.ok ? { ok: true, blueprint: moved.blueprint } : { ok: false, reason: "The base is too wide to copy from there" };
}

/**
 * Copies the base the piece `ref` is in: the pieces joined to it through shared corners, sides and faces, the nearest
 * first, `most` at most, anchored at that piece. Only a base of `team`'s is copied. Things set down in it are not.
 */
export function copyBase(structs: StructureStore, book: PieceBook, ref: number, team: number, name: string, author: string, description = "", most = BLUEPRINT_PIECES_MOST): Captured {
  const rows = rowsOf(structs, book, ref, team);
  if (typeof rows === "string") return { ok: false, reason: rows };
  const walked = walkBlueprint(rows.pieces, book.forms, rows.aimed, most);
  return made(book, walked.map((i) => rows.pieces[i]!), name, author, description);
}

/**
 * Copies what of a base lies in a box: over the rectangle its pieces `ref` and `other` span on the base's own plan, from
 * the lower of the two up `levels` quarter storeys. Anchored at `ref`; `most` pieces at most, the nearest to it first.
 */
export function copyBox(structs: StructureStore, book: PieceBook, ref: number, other: number, levels: number, team: number, name: string, author: string, description = "", most = BLUEPRINT_PIECES_MOST): Captured {
  const rows = rowsOf(structs, book, ref, team);
  if (typeof rows === "string") return { ok: false, reason: rows };
  const fr = key.fr;
  if (!structs.keyAt(other, key) || key.fr !== fr) return { ok: false, reason: "The two corners are not of one base" };
  const a = rows.pieces[rows.aimed]!;
  const corner = (k0: number, k1: number): [number, number] => (keyAnchor(k0, k1, T, 0), [idealX(T, 0), idealY(T, 0)]);
  const [ax, ay] = corner(a.k0, a.k1);
  const [bx, by] = corner(key.k0, key.k1);
  const slack = 1e-6;
  const low = Math.min(keyLvl(a.k1), keyLvl(key.k1));
  const inside = rows.pieces.filter((p) => {
    const [x, y] = corner(p.k0, p.k1);
    const lvl = keyLvl(p.k1);
    return x >= Math.min(ax, bx) - slack && x <= Math.max(ax, bx) + slack && y >= Math.min(ay, by) - slack && y <= Math.max(ay, by) + slack && lvl >= low && lvl <= low + levels;
  });
  const first = inside.indexOf(a);
  const near = (p: BlueprintPiece): number => {
    const [x, y] = corner(p.k0, p.k1);
    return Math.hypot(x - ax, y - ay) + Math.abs(keyLvl(p.k1) - keyLvl(a.k1));
  };
  const rest = inside.filter((_, i) => i !== first).sort((p, q) => near(p) - near(q));
  return made(book, [a, ...rest].slice(0, most), name, author, description);
}

/** Why a blueprint's text was refused, for a player. */
export function faultWords(fault: BlueprintFault | { readonly reason: string; readonly piece?: number; readonly name?: string }): string {
  const f = fault as { reason: string; piece?: number; name?: string; format?: number; count?: number; other?: number };
  switch (f.reason) {
    case "bad text": return "That is not a template's text: it starts with snbp: and has only letters, digits, - and _";
    case "too long": return "The text is too long to be a template";
    case "bad magic": return "The text is not a template";
    case "unknown format": return `The template is of format ${f.format}, which this game does not read`;
    case "truncated": return "The template's text is cut short";
    case "string too long": return "The template's name or a piece's name is too long";
    case "too many pieces": return `The template has ${f.count} pieces: ${BLUEPRINT_PIECES_MOST} at most`;
    case "bad form table": return "The template's list of pieces is damaged";
    case "trailing bytes": return "The template's text has more after its end";
    case "bad checksum": return "The template's text was changed or damaged on the way";
    case "unknown form": return `The template has a piece this game does not build: ${f.name}`;
    case "no such piece": return `The template has a piece this game does not build: ${f.name}`;
    case "bad tier": return `Piece ${f.piece} of the template is of no material`;
    case "key out of range": return `Piece ${f.piece} of the template is off the lattice`;
    case "off the lattice": return `Piece ${f.piece} of the template would be off the lattice there`;
    case "duplicate cell": return `Pieces ${f.other} and ${f.piece} of the template are in one place`;
    default: return "The template cannot be read";
  }
}

export interface Template {
  /** The blueprint's text, as it is shared. */
  text: string;
  name: string;
  author: string;
  description: string;
  pieces: number;
}

/** The templates this device keeps. The shell saves `serialize()` where it saves the interface's preferences. */
export class Templates {
  readonly list: Template[] = [];
  /** Bumped with every change, for the shell to save by. */
  revision = 0;
  private readonly read = new Map<string, Blueprint>();

  /** The blueprint of a template, or null for text this game cannot read. */
  blueprint(t: Template, book: PieceBook): Blueprint | null {
    const known = this.read.get(t.text);
    if (known) return known;
    const got = decodeBlueprintText(t.text, book.forms);
    if (!got.ok) return null;
    this.read.set(t.text, got.blueprint);
    return got.blueprint;
  }

  /** Keeps a blueprint, the newest first. Returns why not, or "". */
  add(bp: Blueprint, book: PieceBook): string {
    const text = encodeBlueprintText(bp, book.forms);
    if (!text.ok) return faultWords(text.fault);
    const same = this.list.findIndex((t) => t.text === text.text);
    if (same >= 0) this.list.splice(same, 1);
    this.list.unshift({ text: text.text, name: bp.name, author: bp.author, description: bp.description, pieces: bp.pieces.length });
    this.list.length = Math.min(this.list.length, TEMPLATES_MOST);
    this.read.set(text.text, bp);
    this.revision++;
    return "";
  }

  /** Keeps the template a text holds. Returns why the text was refused, or "". */
  import(text: string, book: PieceBook): string {
    const got = decodeBlueprintText(text.trim(), book.forms);
    return got.ok ? this.add(got.blueprint, book) : faultWords(got.fault);
  }

  remove(i: number): void {
    if (this.list.splice(i, 1).length > 0) this.revision++;
  }

  /** Gives template `i` another name and description. Its text changes with them. */
  rename(i: number, name: string, description: string, book: PieceBook): void {
    const t = this.list[i];
    const bp = t ? this.blueprint(t, book) : null;
    if (!t || !bp) return;
    const next = { ...bp, name: fitBytes(name, BLUEPRINT_NAME_BYTES), description: fitBytes(description, BLUEPRINT_DESCRIPTION_BYTES) };
    const text = encodeBlueprintText(next, book.forms);
    if (!text.ok) return;
    this.read.delete(t.text);
    [t.text, t.name, t.description] = [text.text, next.name, next.description];
    this.read.set(t.text, next);
    this.revision++;
  }

  serialize(): string {
    return JSON.stringify({ version: 1, templates: this.list.map((t) => t.text) });
  }

  /** Takes in what `serialize` wrote. Text this game cannot read is kept out. */
  restore(saved: string | null, book: PieceBook): void {
    try {
      const data = JSON.parse(saved ?? "{}");
      if (!data || data.version !== 1 || !Array.isArray(data.templates)) return;
      this.list.length = 0;
      for (const text of data.templates.slice(0, TEMPLATES_MOST)) {
        const got = typeof text === "string" ? decodeBlueprintText(text, book.forms) : null;
        if (!got?.ok) continue;
        const bp = got.blueprint;
        this.list.push({ text, name: bp.name, author: bp.author, description: bp.description, pieces: bp.pieces.length });
      }
    } catch {
      // What is saved is not ours: the list stays as it is.
    }
  }
}
