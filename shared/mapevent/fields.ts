// The tuning a kind of map event declares (planning/workstreams/map-events.md): each field's kind, default, bounds and
// words. One schema checks a book's values, fills what a book leaves out, and draws the events page's Tuning view, so a
// module that adds a kind adds its page with it.

import type { BookFault } from "../supply/book.ts";

export type FieldKind = "number" | "whole" | "share" | "range" | "wholeRange" | "flag" | "text" | "choice" | "keys";

/** What every field has: the words the page shows, the group it is shown in, and its unit, if any ("m", "s", "m/s"). */
interface Words {
  readonly label: string;
  readonly help: string;
  readonly group: string;
  readonly unit?: string;
}

export type NumberField = Words & { readonly kind: "number" | "whole" | "share"; readonly def: number; readonly min: number; readonly max: number };
export type RangeField = Words & { readonly kind: "range" | "wholeRange"; readonly def: readonly [number, number]; readonly min: number; readonly max: number };
export type FlagField = Words & { readonly kind: "flag"; readonly def: boolean };
export type TextField = Words & { readonly kind: "text"; readonly def: string; readonly most: number };
export type ChoiceField = Words & { readonly kind: "choice"; readonly def: string; readonly options: readonly string[] };
export type KeysField = Words & { readonly kind: "keys"; readonly def: readonly string[]; readonly most: number };
export type FieldDef = NumberField | RangeField | FlagField | TextField | ChoiceField | KeysField;

/** A kind's fields by key, in the order the page shows them. */
export type Fields = Readonly<Record<string, FieldDef>>;
/** The values a kind's handlers read: each field's own type. */
export type Tuned<F extends Fields> = { readonly [K in keyof F]: F[K]["def"] };
export type FieldValue = number | boolean | string | readonly [number, number] | readonly string[];

/** The most fields a kind has, and the most characters of a text field. */
export const FIELDS_MOST = 48;
export const TEXT_MOST = 200;
const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
/** A key a keys field lists: a tier's, a class's, a content id. */
export const LIST_KEY = /^[a-z0-9][a-z0-9_.:/-]{0,63}$/;

type Opts = Words;
type Bounded = Words & { min: number; max: number };

export const number = (def: number, o: Bounded): NumberField => ({ kind: "number", def, ...o });
export const whole = (def: number, o: Bounded): NumberField => ({ kind: "whole", def, ...o });
/** A share from 0 to 1. */
export const share = (def: number, o: Opts): NumberField => ({ kind: "share", def, min: 0, max: 1, ...o });
/** [least, most]. */
export const range = (def: readonly [number, number], o: Bounded): RangeField => ({ kind: "range", def, ...o });
export const wholeRange = (def: readonly [number, number], o: Bounded): RangeField => ({ kind: "wholeRange", def, ...o });
export const flag = (def: boolean, o: Opts): FlagField => ({ kind: "flag", def, ...o });
export const text = (def: string, o: Opts & { most?: number }): TextField => ({ kind: "text", def, most: o.most ?? 64, ...o });
export const choice = (def: string, options: readonly string[], o: Opts): ChoiceField => ({ kind: "choice", def, options, ...o });
export const keys = (def: readonly string[], o: Opts & { most: number }): KeysField => ({ kind: "keys", def, ...o });

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Why `v` is no value of field `f`, or "". */
export function valueFault(f: FieldDef, v: unknown): string {
  switch (f.kind) {
    case "number":
    case "share":
      return finite(v) && v >= f.min && v <= f.max ? "" : `a number from ${f.min} to ${f.max}`;
    case "whole":
      return Number.isInteger(v) && (v as number) >= f.min && (v as number) <= f.max ? "" : `a whole number from ${f.min} to ${f.max}`;
    case "range":
    case "wholeRange": {
      const ints = f.kind === "wholeRange";
      const ok = Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) && v[0] >= f.min && v[1] >= v[0] && v[1] <= f.max && (!ints || (Number.isInteger(v[0]) && Number.isInteger(v[1])));
      return ok ? "" : `[least, most] from ${f.min} to ${f.max}${ints ? ", whole" : ""}`;
    }
    case "flag":
      return typeof v === "boolean" ? "" : "true or false";
    case "text":
      return typeof v === "string" && v.length <= f.most ? "" : `text of ${f.most} characters at the most`;
    case "choice":
      return typeof v === "string" && f.options.includes(v) ? "" : `one of ${f.options.join(", ")}`;
    case "keys":
      return Array.isArray(v) && v.length >= 1 && v.length <= f.most && v.every((k) => typeof k === "string" && LIST_KEY.test(k)) ? "" : `1 to ${f.most} keys`;
  }
}

/** What is wrong with a kind's schema: thrown at once when a module defines it. Empty for a sound one. */
export function fieldsFaults(fields: Fields): string[] {
  const out: string[] = [];
  const names = Object.keys(fields);
  if (names.length > FIELDS_MOST) out.push(`a kind has ${FIELDS_MOST} fields at the most`);
  for (const key of names) {
    const f = fields[key]!;
    if (!FIELD_KEY.test(key)) out.push(`field "${key}": a key is a letter, then letters, digits and _, 32 at the most`);
    if (typeof f.label !== "string" || f.label === "" || f.label.length > 64) out.push(`field ${key}: a label of 1 to 64 characters`);
    if (typeof f.help !== "string" || f.help.length > TEXT_MOST) out.push(`field ${key}: help of ${TEXT_MOST} characters at the most`);
    if (typeof f.group !== "string" || f.group === "" || f.group.length > 32) out.push(`field ${key}: a group of 1 to 32 characters`);
    if ((f.kind === "number" || f.kind === "whole" || f.kind === "share" || f.kind === "range" || f.kind === "wholeRange") && !(finite(f.min) && finite(f.max) && f.min <= f.max)) out.push(`field ${key}: its bounds are numbers, the least first`);
    else if (f.kind === "text" && !(Number.isInteger(f.most) && f.most >= 1 && f.most <= TEXT_MOST)) out.push(`field ${key}: at most 1 to ${TEXT_MOST} characters`);
    else if (f.kind === "keys" && !(Number.isInteger(f.most) && f.most >= 1 && f.most <= 32)) out.push(`field ${key}: at most 1 to 32 keys`);
    else if (f.kind === "choice" && !(Array.isArray(f.options) && f.options.length >= 1 && f.options.every((o) => typeof o === "string"))) out.push(`field ${key}: a choice has options`);
    else {
      const bad = valueFault(f, f.def);
      if (bad !== "") out.push(`field ${key}: its default is not ${bad}`);
    }
  }
  return out;
}

/**
 * What is wrong with a book's values for a kind, each at its path under `path`. A key the kind has no field for is a
 * warning: a book keeps what another build of the kind wrote. With `lenient`, a value out of its field's bounds is a
 * warning too, and its default is used.
 */
export function valueFaults(fields: Fields, values: unknown, path: string, lenient: boolean): BookFault[] {
  if (typeof values !== "object" || values === null || Array.isArray(values)) return [{ path, message: "a kind's tuning is an object" }];
  const out: BookFault[] = [];
  for (const [key, v] of Object.entries(values)) {
    const f = fields[key];
    if (!f) {
      out.push({ path: `${path}.${key}`, message: "this kind has no such field: it is kept and not used", warn: true });
      continue;
    }
    const bad = valueFault(f, v);
    if (bad !== "") out.push({ path: `${path}.${key}`, message: lenient ? `${bad}: its default is used` : bad, ...(lenient ? { warn: true } : {}) });
  }
  return out;
}

/** The values of a kind: each field's from `values` where it is fit, its default where it is not or is absent. A copy. */
export function tunedOf<F extends Fields>(fields: F, values?: unknown): Tuned<F> {
  const given = typeof values === "object" && values !== null && !Array.isArray(values) ? (values as Record<string, unknown>) : {};
  const out: Record<string, FieldValue> = {};
  for (const [key, f] of Object.entries(fields)) {
    const v = given[key];
    const fit = v !== undefined && valueFault(f, v) === "";
    const chosen = (fit ? v : f.def) as FieldValue;
    out[key] = Array.isArray(chosen) ? [...(chosen as readonly unknown[])] as unknown as FieldValue : chosen;
  }
  return out as Tuned<F>;
}
