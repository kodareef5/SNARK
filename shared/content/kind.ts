// A kind of content is one file under kinds/: the shape of its definitions, their fields and classes, what is wrong
// with one, and the columns of the registry it fills. kinds.ts lists them, and compileContent (registry.ts) walks that
// list: every `check`, every `survey`, every `among`, then `columns`, every `fill`, every `link`, every `finish`.

import type { Feature } from "../features.ts";
import type { Content, Def } from "./defs.ts";
import type { Filling } from "./registry.ts";

/** Other names a definition answers to at the console and in a settings file. No two definitions share one, and none is inherited. */
export interface Named {
  readonly aliases?: readonly string[];
}

/**
 * `D` is the definitions its hooks are given, those of its `type`, and `C` the columns it adds to the registry. Two
 * kinds may have one type, as weapons are items: the one with `fields` and `rows` is the type's own, and the other's
 * hooks run after it.
 */
export interface Kind<D extends { readonly type: string }, C extends object = {}> {
  readonly type: D["type"];
  /** Every field a definition of the type may have, and its classes in the order a fault lists them. */
  readonly fields?: Readonly<Record<string, Field>>;
  readonly rows?: readonly ClassRow[];
  /** What is wrong with one definition by itself. Called for each in the order they are given. */
  check?(d: D, cx: Checking): void;
  /** What is wrong among them all, after every `check` and after what each names is known to be of the right class. */
  survey?(cx: Checking): void;
  /** What is wrong with one among the others, after every `survey`. Called for each in the order they are given. */
  among?(d: D, cx: Checking): void;
  /** Its columns, each `n` long and holding what content that is not of the kind reads. */
  columns?(n: number): C;
  /** Fills row `i` from `d`, in the order of the index. Every definition has its index; another's row may not be filled yet. */
  fill?(d: D, i: number, reg: Filling, cx: Making): void;
  /** Row `i` again once every row is filled: what `d` names, and what it writes on another's row. */
  link?(d: D, i: number, reg: Filling, cx: Making): void;
  /** Once, after every row is linked. */
  finish?(reg: Filling, cx: Making): void;
}

export interface Checking {
  /** The definitions in the order given. Renames are not among them. */
  readonly input: readonly Content[];
  readonly errors: string[];
  /** `make(input)`, made the first time one compilation asks for it and kept for the rest of that compilation. */
  once<T>(make: (input: readonly Content[]) => T): T;
  /** Says that `name` must be in (0, max] unless `v` is. */
  positive(d: { readonly id: string }, name: string, v: number, max: number): void;
}

export interface Making {
  once<T>(make: (input: readonly Content[]) => T): T;
  /** The boxes bodies and rays meet, six numbers each. A structure or node adds its own as it is filled (Registry.parts). */
  readonly boxes: number[];
}

// Columns. A column is as long as the index, and a reader takes it from the registry by its name.
export const u8 = (n: number, fill = 0): Uint8Array => new Uint8Array(n).fill(fill);
export const i8 = (n: number, fill = 0): Int8Array => new Int8Array(n).fill(fill);
export const u16 = (n: number, fill = 0): Uint16Array => new Uint16Array(n).fill(fill);
export const u32 = (n: number, fill = 0): Uint32Array => new Uint32Array(n).fill(fill);
export const f32 = (n: number, fill = 0): Float32Array => new Float32Array(n).fill(fill);
export const f64 = (n: number, fill = 0): Float64Array => new Float64Array(n).fill(fill);
/** A column of objects, null for content that has none. */
export const list = <T>(n: number): (T | null)[] => new Array<T | null>(n).fill(null);

export const ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_\/-]*$/;

export const paletteIndex = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 256;

/** What is wrong with the mesh and colour of something drawn. */
export function drawnFaults(d: { readonly id: string; readonly mesh: string; readonly color: number }, cx: Checking): void {
  if (d.mesh.length === 0) cx.errors.push(`${d.id}: mesh is required`);
  if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) cx.errors.push(`${d.id}: color must be a palette index`);
}

// The class table's rows. classes.ts has the table itself.

/** "built": systems read it. "partial": part of it lives in code. "stub": the row exists and nothing reads it yet. */
export type Status = "built" | "partial" | "stub";

export interface Field {
  kind: "text" | "number" | "switch" | "vec3" | "list" | "facet";
  /** ARK's name for the same thing, or "" for a field of our own. */
  ark: string;
  /** Paths in the field that name other definitions, and the class or family each must be. "" is the field itself, "[]" each entry. */
  refs?: Record<string, string>;
  /** Packs may add entries to it, and a remap rewrites what it names. */
  open?: boolean;
  /** A stub field is declared and checked, and nothing reads it until the feature it waits for is built. */
  waits?: Feature;
  /** Fields inside a facet that are stubs in the same sense, and the feature each waits for. The facet itself is read. */
  stubs?: Readonly<Record<string, Feature>>;
}

export interface Slot {
  asset: "mesh" | "rig" | "clip" | "icon" | "sound" | "effect";
  need: "must" | "may";
  /**
   * A slot with several values has one asset for each key: the keys listed, or every hair or beard style, or ("any")
   * whatever names the content gives.
   */
  keys?: readonly string[] | "hair" | "beard" | "any";
  /** The slot applies only to a definition that declares this field. */
  when?: string;
  /**
   * The asset's id by today's naming. `{id}` is the definition's id, `{mesh}` its mesh (its id, for a generated one),
   * `{a.b}` a field of it, `{key}` the slot's key, `{sex}` each sex, `{body}` each body a survivor may have.
   */
  from: string;
  /**
   * What stands in when the slot is empty, tried in order: an asset id written as `from` is, or a word for something
   * that needs no asset ("box", "shape", "swatch", "none", "hidden", "rigid", "rest", or "#slot" for another slot).
   */
  fallback: readonly string[];
}

export interface ClassRow {
  /** "item/weapon". A family with one class is its own leaf: "node". */
  id: string;
  type: Def["type"];
  parent: string | null;
  /** An abstract class groups others and no definition is of it. */
  abstract: boolean;
  ark: string;
  status: Status;
  waits: Feature | "";
  /** Where its definitions sit under their pack: "items/weapons". */
  shelf: string;
  must: readonly string[];
  may: readonly string[];
  /** At least one of these must be present. */
  any: readonly string[];
  slots: Readonly<Record<string, Slot>>;
  doc: string;
}

export const f = (kind: Field["kind"], ark = "", more: Partial<Field> = {}): Field => ({ kind, ark, ...more });
export const stub = (waits: Feature, kind: Field["kind"], ark = "", more: Partial<Field> = {}): Field => ({ kind, ark, waits, ...more });

/** A field for each property of `D` but those every definition has. */
export type Fields<D> = { [K in Exclude<keyof D, "type" | "class" | "id" | "aliases">]-?: Field };

export const mesh = (need: Slot["need"], from: string, ...fallback: string[]): Slot => ({ asset: "mesh", need, from, fallback });
export const icon: Slot = { asset: "icon", need: "may", from: "{id}/icon", fallback: ["swatch"] };

interface RowIn<K extends string> {
  parent?: string;
  abstract?: boolean;
  ark: string;
  status?: Status;
  waits?: Feature;
  shelf: string;
  must?: readonly K[];
  may?: readonly K[];
  any?: readonly K[];
  slots?: Record<string, Slot>;
  doc: string;
}

/** A class of a family whose fields are `_fields`. The keys of must, may and any are checked against them. */
export function row<T extends Record<string, Field>>(id: string, type: ClassRow["type"], _fields: T, r: RowIn<Extract<keyof T, string>>): ClassRow {
  return {
    id,
    type,
    parent: r.parent ?? null,
    abstract: r.abstract ?? false,
    ark: r.ark,
    status: r.status ?? "built",
    waits: r.waits ?? "",
    shelf: r.shelf,
    must: r.must ?? [],
    may: r.may ?? [],
    any: r.any ?? [],
    slots: r.slots ?? {},
    doc: r.doc,
  };
}
