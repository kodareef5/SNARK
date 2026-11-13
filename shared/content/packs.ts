// Content packs: how definitions stack.
//
// A pack is a named list of definitions. Packs load in order and build on what
// came before, the way a child blueprint builds on its parent:
//
//   extends    a definition starts as a copy of another and states only what
//              differs. One level of nested objects (food, stats) merges field
//              by field.
//   abstract   a template: it can be extended but never exists in the world.
//   override   a pack changes a definition owned by an earlier pack, stating
//              only the fields it changes. Balance mods are overrides.
//
// A pack may only define ids in its own namespace ("mypack:thing"), so two
// packs cannot collide by accident; touching someone else's definition requires
// the explicit override.
//
// Stacking is resolved once, here. The result is the same flat list a single
// hand-written pack would be, so the simulation never follows an inheritance
// chain at run time and a pack costs nothing after load.

import type { Def } from "./defs.ts";
import { compileContent, type CompileResult } from "./registry.ts";

/** A definition as written in a pack: any subset of fields, plus stacking directives. */
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

/** Resolve stacking into concrete definitions, in a stable order. */
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
    entry.resolved = merge(parent, entry.patch as Record<string, unknown>, true);
    return entry.resolved;
  };

  const defs: Def[] = [];
  for (const [id, entry] of entries) {
    const resolved = resolve(id, id);
    if (!resolved || entry.patch.abstract) continue;
    const problem = shapeProblem(resolved);
    if (problem) errors.push(`${id}: ${problem}`);
    else defs.push(resolved as unknown as Def);
  }
  return { defs, errors };
}

/** Resolve stacking, then compile. */
export function compilePacks(packs: readonly ContentPack[]): CompileResult {
  const { defs, errors } = resolvePacks(packs);
  if (errors.length > 0) return { registry: null, errors };
  return compileContent(defs);
}

/** Child fields over parent fields; plain objects merge one level; directives never inherit when `strip` is set. */
function merge(parent: Record<string, unknown>, child: Record<string, unknown>, strip: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parent };
  for (const key of Object.keys(child)) {
    if (strip && DIRECTIVES.has(key)) continue;
    // An override patch keeps the original's directives; its own "override" flag is not a field.
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

const REQUIRED: Record<string, Record<string, string>> = {
  species: { mesh: "string", color: "number", radius: "number", height: "number", eyeHeight: "number", walkSpeed: "number", sprintMul: "number", jumpSpeed: "number" },
  structure: { mesh: "string", color: "number", half: "array", hp: "number" },
  item: { stack: "number" },
  prop: { mesh: "string", color: "number", radius: "number", height: "number" },
  node: { mesh: "string", color: "number", half: "array", hits: "number", respawnHours: "number", yields: "list", xp: "number" },
  recipe: { makes: "string", count: "number", needs: "list", seconds: "number", xp: "number" },
  engram: { label: "string", level: "number", cost: "number", unlocks: "list" },
  levels: { xp: "list", engramPoints: "list" },
  buff: { label: "string", color: "number" },
};

/** Why a resolved definition cannot be type-checked field by field, or null if it has every required field. */
function shapeProblem(d: Record<string, unknown>): string | null {
  const fields = REQUIRED[String(d.type)];
  if (!fields) return `unknown type "${String(d.type)}"`;
  for (const [key, kind] of Object.entries(fields)) {
    const v = d[key];
    // "array" is three numbers (half extents); "list" is any array.
    const ok = kind === "array" ? Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number") : kind === "list" ? Array.isArray(v) : typeof v === kind;
    if (!ok) return `missing or malformed field "${key}"`;
  }
  return null;
}
