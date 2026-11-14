// A pack may only define ids in its own namespace ("mypack:thing"). Changing another pack's definition takes an explicit override.
// Stacking is resolved once, here, into a flat list, so the simulation never follows an inheritance chain.

import { FIELDS, defFaults, type Field } from "./classes.ts";
import type { Def } from "./defs.ts";
import { compileContent, type CompileResult } from "./registry.ts";

/**
 * A definition as written in a pack. `extends` starts it as a copy of another, and one level of nested objects merges
 * field by field. `abstract` makes it a template that can be extended but never exists in the world. `override` changes
 * a definition owned by an earlier pack, stating only the fields it changes.
 */
export interface DefPatch {
  id: string;
  type?: Def["type"];
  extends?: string;
  abstract?: boolean;
  override?: boolean;
  [field: string]: unknown;
}

export interface ContentPack {
  /** Namespace of every id this pack defines. */
  name: string;
  /** Packs that must be loaded before this one. */
  requires?: readonly string[];
  defs: readonly DefPatch[];
  /**
   * Entries put at the end of a list a definition has, without stating the list again: a food a creature eats, a thing
   * a bush gives. `field` is a list the class table marks open, or a list in an open group ("weapon.ammo"). Packs that
   * add to one list do not know of each other, and what they add arrives in pack order.
   */
  adds?: readonly { to: string; field: string; items: readonly unknown[] }[];
  /**
   * Whatever names `from` in an open field names `to` in its place, or with null is taken out. `from` stays defined, so
   * what a save holds of it still loads.
   */
  remaps?: readonly { from: string; to: string | null }[];
}

const PACK_NAME = /^[a-z][a-z0-9_]*$/;
const DIRECTIVES = new Set(["extends", "abstract", "override"]);

interface Entry {
  patch: DefPatch;
  resolved: Record<string, unknown> | null;
  resolving: boolean;
}

export function resolvePacks(packs: readonly ContentPack[]): { defs: Def[]; errors: string[] } {
  const errors: string[] = [];
  const entries = new Map<string, Entry>();
  const loaded = new Set<string>();
  const adds = new Map<string, { pack: string; field: string; items: readonly unknown[] }[]>();
  const remaps = new Map<string, { pack: string; to: string | null }>();

  for (const pack of packs) {
    if (!PACK_NAME.test(pack.name)) errors.push(`pack "${pack.name}": name must be lower-case letters, digits and underscores`);
    if (loaded.has(pack.name)) errors.push(`pack "${pack.name}": loaded twice`);
    for (const need of pack.requires ?? []) if (!loaded.has(need)) errors.push(`pack "${pack.name}": requires "${need}", which is not loaded before it`);
    loaded.add(pack.name);
    for (const patch of pack.defs) {
      const existing = entries.get(patch.id);
      if (patch.override) {
        if (!existing) errors.push(`${patch.id}: pack "${pack.name}" overrides a definition that does not exist`);
        else existing.patch = merge(existing.patch as Record<string, unknown>, patch as Record<string, unknown>, false) as DefPatch;
        continue;
      }
      if (!patch.id.startsWith(pack.name + ":")) errors.push(`${patch.id}: pack "${pack.name}" may only define ids starting with "${pack.name}:" (or use override)`);
      else if (existing) errors.push(`${patch.id}: defined twice`);
      else entries.set(patch.id, { patch, resolved: null, resolving: false });
    }
    for (const a of pack.adds ?? []) {
      if (!entries.has(a.to)) errors.push(`pack "${pack.name}": adds to "${a.to}", which is not defined`);
      else adds.set(a.to, [...(adds.get(a.to) ?? []), { pack: pack.name, field: a.field, items: a.items }]);
    }
    for (const r of pack.remaps ?? []) {
      const lost = [r.from, r.to].find((id) => id !== null && !entries.has(id));
      if (lost !== undefined) errors.push(`pack "${pack.name}": remaps "${r.from}" to "${r.to}", and "${lost}" is not defined`);
      else remaps.set(r.from, { pack: pack.name, to: r.to });
    }
  }

  const resolve = (id: string, from: string): Record<string, unknown> | null => {
    const entry = entries.get(id);
    if (!entry) {
      errors.push(`${from}: extends "${id}", which is not defined`);
      return null;
    }
    if (entry.resolved) return entry.resolved;
    if (entry.resolving) {
      errors.push(`${id}: extends itself through a cycle`);
      return null;
    }
    entry.resolving = true;
    const parent = typeof entry.patch.extends === "string" ? resolve(entry.patch.extends, id) : {};
    entry.resolving = false;
    if (!parent) return null;
    // An alias is one definition's own, so a copy does not start with its parent's.
    const { aliases: _, ...base } = parent;
    let made = merge(base, entry.patch as Record<string, unknown>, true);
    // After its parent's, so a copy starts with what was added to its parent.
    for (const a of adds.get(id) ?? []) {
      const more = added(made, a.field, a.items);
      if (more === null) errors.push(`pack "${a.pack}": "${a.field}" of ${id} is not a list that packs may add to`);
      else made = more;
    }
    entry.resolved = made;
    return made;
  };

  // What an id is in the end: A remapped to B and B to C is A to C. Null for nothing, and undefined for a circle.
  const final = (id: string): string | null | undefined => {
    let at: string | null = id;
    for (let n = 0; at !== null && remaps.has(at); n++) {
      if (n === remaps.size) return undefined;
      at = remaps.get(at)!.to;
    }
    return at;
  };
  for (const [from, r] of remaps) {
    const [a, b] = [resolve(from, from), r.to === null ? null : resolve(r.to, r.to)];
    if (final(from) === undefined) errors.push(`pack "${r.pack}": "${from}" is remapped in a circle`);
    else if (a && b && a.type !== b.type) errors.push(`pack "${r.pack}": remaps "${from}" to "${r.to}", which is not of type ${String(a.type)}`);
  }

  const defs: Def[] = [];
  for (const [id, entry] of entries) {
    const whole = resolve(id, id);
    if (!whole || entry.patch.abstract) continue;
    const resolved = remaps.size > 0 ? remapped(whole, (to) => final(to) ?? null) : whole;
    const faults = defFaults(resolved as unknown as Def);
    if (faults.length > 0) errors.push(...faults);
    else defs.push(resolved as unknown as Def);
  }
  return { defs, errors };
}

export function compilePacks(packs: readonly ContentPack[]): CompileResult {
  const { defs, errors } = resolvePacks(packs);
  if (errors.length > 0) return { registry: null, errors };
  return compileContent(defs);
}

/** Child fields replace parent fields, and plain objects merge one level. With `strip`, directives are not inherited. */
function merge(parent: Record<string, unknown>, child: Record<string, unknown>, strip: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parent };
  for (const key of Object.keys(child)) {
    if (strip && DIRECTIVES.has(key)) continue;
    // An override patch keeps the original's directives. Its own "override" flag is not a field.
    if (!strip && key === "override") continue;
    const a = out[key];
    const b = child[key];
    out[key] = isPlain(a) && isPlain(b) ? { ...a, ...b } : b;
  }
  if (strip) for (const key of DIRECTIVES) delete out[key];
  return out;
}

const fieldsOf = (def: Record<string, unknown>): Record<string, Field> => (FIELDS as Record<string, Record<string, Field>>)[String(def.type)] ?? {};

/** `def` with `items` at the end of its list `field`, or null if packs may not add to that. */
function added(def: Record<string, unknown>, field: string, items: readonly unknown[]): Record<string, unknown> | null {
  const [name, inner, deeper] = field.split(".");
  const f = fieldsOf(def)[name!];
  const end = (list: unknown): unknown[] => [...(Array.isArray(list) ? list : []), ...items];
  if (!f?.open || deeper !== undefined) return null;
  if (inner === undefined) return f.kind === "list" ? { ...def, [name!]: end(def[name!]) } : null;
  const group = def[name!];
  if (!isPlain(group) || !(`${inner}[]` in (f.refs ?? {}))) return null;
  return { ...def, [name!]: { ...group, [inner]: end(group[inner]) } };
}

const DROP = Symbol("drop");

/** `v` with the id at `path` passed through `to`. Where that gives null, the entry of the nearest list around it is dropped. */
function rewrite(v: unknown, path: readonly string[], to: (id: string) => string | null): unknown {
  if (path.length === 0) return typeof v === "string" ? (to(v) ?? DROP) : v;
  const each = path[0]!.endsWith("[]");
  const key = each ? path[0]!.slice(0, -2) : path[0]!;
  const inside = (x: unknown): unknown => (!each ? rewrite(x, path.slice(1), to) : Array.isArray(x) ? x.map((e) => rewrite(e, path.slice(1), to)).filter((e) => e !== DROP) : x);
  if (key === "") return inside(v);
  if (!isPlain(v) || v[key] === undefined) return v;
  const now = inside(v[key]);
  return now === DROP ? DROP : { ...v, [key]: now };
}

/** `def` with every id its open fields name passed through `to`. */
function remapped(def: Record<string, unknown>, to: (id: string) => string | null): Record<string, unknown> {
  const out = { ...def };
  for (const [name, f] of Object.entries(fieldsOf(def))) {
    if (!f.open || out[name] === undefined) continue;
    for (const path of Object.keys(f.refs ?? {})) {
      const now = rewrite(out[name], path === "" ? [] : path.split("."), to);
      if (now === DROP) delete out[name];
      else out[name] = now;
    }
  }
  return out;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
