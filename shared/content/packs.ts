// A pack may only define ids in its own namespace ("mypack:thing"). Changing another pack's definition takes an explicit override.
// Stacking is resolved once, here, into a flat list, so the simulation never follows an inheritance chain.

import { defFaults } from "./classes.ts";
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
    entry.resolved = merge(base, entry.patch as Record<string, unknown>, true);
    return entry.resolved;
  };

  const defs: Def[] = [];
  for (const [id, entry] of entries) {
    const resolved = resolve(id, id);
    if (!resolved || entry.patch.abstract) continue;
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

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
