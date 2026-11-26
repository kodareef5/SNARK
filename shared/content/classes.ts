// The class table: every kind of content, as ARK organises its own, with what each must and may declare and the assets
// it expects. A definition's `type` is its family and its class is a leaf of this table. A field its class neither must
// nor may declare is refused. The reference page, the shape checks and the asset slots are all derived from these rows.
// A family's fields and rows are in its kind's file (kinds/). Here they are put together and a definition is checked
// against them.

import { FEATURES } from "../features.ts";
import type { Def } from "./defs.ts";
import type { ClassRow, Field } from "./kind.ts";
import { KINDS } from "./kinds.ts";

export type { ClassRow, Field, Slot, Status } from "./kind.ts";

/**
 * The order the catalogue page lists the families' fields in (tools/catalogue.ts), kept as it was when the table was one
 * file. A family not named here comes after these in the order of kinds.ts, so a new kind is no line here.
 */
const FIELDS_FIRST: readonly string[] = ["item", "species", "structure", "node", "prop", "engram", "levels", "buff", "material", "shape", "damage", "loot", "spawns", "map", "game", "rename"];
const fieldsPlace = (type: string): number => (FIELDS_FIRST.includes(type) ? FIELDS_FIRST.indexOf(type) : FIELDS_FIRST.length);

/** Every field of every family that has a definition type. */
export const FIELDS = Object.fromEntries(
  KINDS.filter((k) => k.fields !== undefined)
    .sort((a, b) => fieldsPlace(a.type) - fieldsPlace(b.type))
    .map((k) => [k.type, k.fields]),
) as Readonly<Record<Def["type"], Readonly<Record<string, Field>>>>;

/** Every class, in the order of kinds.ts and, within a family, of its kind's rows. */
export const CLASSES: readonly ClassRow[] = KINDS.flatMap((k) => k.rows ?? []);
const BY_ID = new Map(CLASSES.map((r) => [r.id, r]));

export function classRow(id: string): ClassRow | undefined {
  return BY_ID.get(id);
}

/** What is wrong with the table itself. Empty when it is sound. */
export function classFaults(): string[] {
  const out: string[] = [];
  const families = new Set(CLASSES.map((r) => r.type as string));
  const names = (target: string): boolean => BY_ID.has(target) || families.has(target);
  if (BY_ID.size !== CLASSES.length) out.push("a class id is used twice");
  const shelves = new Map<string, string>();
  for (const r of CLASSES) {
    const fields: Record<string, Field> = FIELDS[r.type];
    if (r.parent !== null && !BY_ID.has(r.parent)) out.push(`${r.id}: its parent "${r.parent}" is no class`);
    if (r.id !== r.type && !r.id.startsWith(r.type + "/")) out.push(`${r.id}: a class is named after its family, "${r.type}/…"`);
    if (r.status === "stub" && !(r.waits in FEATURES)) out.push(`${r.id}: a stub names the feature it waits for`);
    if (r.status === "built" && r.waits !== "") out.push(`${r.id}: a built class waits for nothing`);
    if (r.abstract && (r.must.length > 0 || r.may.length > 0)) out.push(`${r.id}: an abstract class declares nothing`);
    for (const k of r.must) if (r.may.includes(k)) out.push(`${r.id}: "${k}" is both must and may`);
    for (const k of [...r.must, ...r.may, ...r.any]) if (!(k in fields)) out.push(`${r.id}: "${k}" is no field of ${r.type}`);
    for (const k of r.any) if (!r.may.includes(k) && !r.must.includes(k)) out.push(`${r.id}: "${k}" is asked for and not allowed`);
    for (const [name, slot] of Object.entries(r.slots)) {
      if (slot.fallback.length === 0) out.push(`${r.id}#${name}: a slot says what stands in when it is empty`);
      if (slot.when !== undefined && !(slot.when in fields)) out.push(`${r.id}#${name}: "${slot.when}" is no field of ${r.type}`);
      if (slot.from === "") out.push(`${r.id}#${name}: a slot says where its asset is found`);
    }
    if (!r.abstract) {
      const before = shelves.get(r.shelf);
      if (before !== undefined && before !== r.type) out.push(`${r.id}: shelf "${r.shelf}" is also ${before}'s`);
      shelves.set(r.shelf, r.type);
    }
  }
  for (const [type, fields] of Object.entries(FIELDS)) {
    for (const [name, field] of Object.entries(fields)) {
      for (const target of Object.values(field.refs ?? {}).flatMap(targets)) if (!names(target)) out.push(`${type}.${name}: names "${target}", which is no class`);
      if (field.waits !== undefined && !(field.waits in FEATURES)) out.push(`${type}.${name}: a stub field names the feature it waits for`);
      for (const [part, waits] of Object.entries(field.stubs ?? {})) if (field.kind !== "facet" || !(waits in FEATURES)) out.push(`${type}.${name}.${part}: a stub inside a facet names the feature it waits for`);
      // Every field belongs to some class of its family, or nothing could declare it.
      if (!CLASSES.some((r) => r.type === type && (r.must.includes(name) || r.may.includes(name)))) out.push(`${type}.${name}: no class may declare it`);
    }
  }
  return out;
}

/** The class of a definition: its family, and its `class` where the family has several. */
export function classOf(d: Def): string {
  return "class" in d ? `${d.type}/${d.class}` : d.type;
}

const article = (type: string): string => (/^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`);

const KIND: Record<Field["kind"], [is: (v: unknown) => boolean, said: string]> = {
  text: [(v) => typeof v === "string", "text"],
  number: [(v) => typeof v === "number", "a number"],
  switch: [(v) => typeof v === "boolean", "true or false"],
  vec3: [(v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number"), "three numbers"],
  list: [(v) => Array.isArray(v), "a list"],
  facet: [(v) => typeof v === "object" && v !== null && !Array.isArray(v), "a group of fields"],
};

/**
 * What is wrong with the shape of a definition: no class or one that does not exist, a field its class must declare and
 * does not, a field of the wrong kind, a field its class may not declare. Ranges and what names what are checked when
 * content is compiled.
 */
export function defFaults(d: Def): string[] {
  const has = d as unknown as Record<string, unknown>;
  const leaves = CLASSES.filter((r) => r.type === has.type && !r.abstract);
  if (leaves.length === 0) return [`${d.id}: unknown type "${String(has.type)}"`];
  const r = BY_ID.get(typeof has.class === "string" ? `${d.type}/${has.class}` : d.type);
  if (!r || r.abstract || r.type !== d.type) {
    const said = has.class === undefined ? "" : `, not "${String(has.class)}"`;
    if (leaves.length === 1 && leaves[0]!.id === d.type) return [`${d.id}: ${article(d.type)} has no class${said}`];
    return [`${d.id}: ${article(d.type)} says its class: ${leaves.map((l) => l.id.slice(d.type.length + 1)).join(", ")}${said}`];
  }
  const fields = FIELDS[d.type] as Record<string, Field>;
  const out: string[] = [];
  for (const k of r.must) if (has[k] === undefined) out.push(`${d.id}: class ${r.id} must declare "${k}"`);
  if (r.any.length > 0 && !r.any.some((k) => has[k] !== undefined)) out.push(`${d.id}: class ${r.id} must declare one of ${r.any.map((k) => `"${k}"`).join(", ")}`);
  for (const k of Object.keys(has)) {
    if (k === "type" || k === "class" || k === "id" || has[k] === undefined) continue;
    if (k === "aliases" && d.type !== "rename") {
      if (!Array.isArray(has[k]) || !has[k].every((a) => typeof a === "string")) out.push(`${d.id}: "aliases" must be a list of names`);
      continue;
    }
    if (!r.must.includes(k) && !r.may.includes(k)) out.push(`${d.id}: class ${r.id} may not declare "${k}"`);
    else if (!KIND[fields[k]!.kind][0](has[k])) out.push(`${d.id}: "${k}" must be ${KIND[fields[k]!.kind][1]}`);
  }
  return out;
}

/** Whether class `id` is `target` or below it: "item/saddle" is an "item/equipment" and an "item". */
function isA(id: string, target: string): boolean {
  for (let at: string | null = id; at !== null; at = BY_ID.get(at)?.parent ?? null) if (at === target) return true;
  return id.startsWith(target + "/");
}

/** The values at `path` in `v`: "" is `v`, "[]" each entry, "a.b" a field of a field, "a[]" each entry of a field. */
function pick(v: unknown, path: string): unknown[] {
  let at: unknown[] = [v];
  for (const part of path === "" ? [] : path.split(".")) {
    const each = part.endsWith("[]");
    const key = each ? part.slice(0, -2) : part;
    at = at.flatMap((x) => {
      const y = key === "" ? x : (x as Record<string, unknown> | null)?.[key];
      return y === undefined || y === null ? [] : each ? (Array.isArray(y) ? y : []) : [y];
    });
  }
  return at;
}

/** The classes a reference may be. */
const targets = (to: string | readonly string[]): readonly string[] => (typeof to === "string" ? [to] : to);

/** A reference's classes in words: "an item/armor", or "an item/armor or an item/garment". */
export const refWords = (to: string | readonly string[]): string => targets(to).map(article).join(" or ");

/** What one definition names that does not exist or is of the wrong class, by `classById` of every definition. */
export function defRefFaults(d: Def, classById: ReadonlyMap<string, string>): string[] {
  const fields: Record<string, Field> = FIELDS[d.type];
  const out: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const value = (d as unknown as Record<string, unknown>)[name];
    if (!field.refs || value === undefined) continue;
    for (const [path, to] of Object.entries(field.refs)) {
      for (const id of pick(value, path)) {
        const is = typeof id === "string" ? classById.get(id) : undefined;
        if (is === undefined || !targets(to).some((t) => isA(is, t))) out.push(`${d.id}: "${String(id)}" is not ${refWords(to)}`);
      }
    }
  }
  return out;
}

/** Each definition's class by its id. */
export const classesById = (defs: readonly Def[]): Map<string, string> => new Map(defs.map((d) => [d.id, classOf(d)]));

/** What definitions name that does not exist or is of the wrong class. */
export function refFaults(defs: readonly Def[]): string[] {
  const classById = classesById(defs);
  return defs.flatMap((d) => defRefFaults(d, classById));
}
