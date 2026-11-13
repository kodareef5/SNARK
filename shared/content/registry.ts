// Compiles content definitions into the tables the simulation reads.
//
// Dense indices are assigned in id order, so every process that loads the same
// definitions gets the same indices and the same hash. Index 0 is reserved: it
// marks an empty structure slot and stands in for content that no longer exists.

import { hashString } from "../hash.ts";
import type { MoveParams } from "../sim/character.ts";
import type { Def, SpeciesDef } from "./defs.ts";

export const MISSING = 0;
export const MAX_STRUCTURE_HALF = 16;

const ID = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_\/-]*$/;
const GRAVITY = 20;
const SLOPE_COS = 0.6427876096865394; // 50 degrees

export interface Registry {
  /** Definitions by dense index. Entry 0 is null. */
  readonly defs: readonly (Def | null)[];
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  /** Changes whenever any definition changes. Client and server must match. */
  readonly hash: number;
  /** Structure collider half extents by index; 0 for everything else. */
  readonly halfX: Float32Array;
  readonly halfY: Float32Array;
  readonly halfZ: Float32Array;
  /** Movement parameters by index; null for everything that is not a species. */
  readonly move: readonly (MoveParams | null)[];
}

export interface CompileResult {
  registry: Registry | null;
  errors: string[];
}

export function compileContent(input: readonly Def[]): CompileResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  const positive = (d: Def, name: string, v: number, max: number) => {
    if (!(v > 0 && v <= max)) errors.push(`${d.id}: ${name} must be in (0, ${max}], got ${v}`);
  };

  for (const d of input) {
    if (!ID.test(d.id)) errors.push(`"${d.id}": id must look like "namespace:name"`);
    if (seen.has(d.id)) errors.push(`${d.id}: duplicate id`);
    seen.add(d.id);
    if (d.type === "species") {
      positive(d, "radius", d.radius, 8);
      positive(d, "height", d.height, 32);
      positive(d, "walkSpeed", d.walkSpeed, 40);
      positive(d, "sprintMul", d.sprintMul, 4);
      positive(d, "jumpSpeed", d.jumpSpeed, 30);
      if (d.height < 2 * d.radius) errors.push(`${d.id}: height must be at least twice the radius`);
      if (!(d.eyeHeight > 0 && d.eyeHeight <= d.height)) errors.push(`${d.id}: eyeHeight must be within the body`);
      if (d.food) {
        positive(d, "food.max", d.food.max, 1e6);
        positive(d, "food.perHour", d.food.perHour, 1e6);
      }
    } else if (d.type === "structure") {
      positive(d, "half[0]", d.half[0], MAX_STRUCTURE_HALF);
      positive(d, "half[1]", d.half[1], MAX_STRUCTURE_HALF);
      positive(d, "half[2]", d.half[2], MAX_STRUCTURE_HALF);
      positive(d, "hp", d.hp, 1e9);
    } else {
      if (!(Number.isInteger(d.stack) && d.stack >= 1)) errors.push(`${d.id}: stack must be a positive integer`);
    }
    if (d.type !== "item") {
      if (d.mesh.length === 0) errors.push(`${d.id}: mesh is required`);
      if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
    }
  }
  if (input.length >= 65535) errors.push("too many definitions for a 16-bit index");
  if (errors.length > 0) return { registry: null, errors };

  const sorted = [...input].sort((a, b) => (a.id < b.id ? -1 : 1));
  const defs: (Def | null)[] = [null, ...sorted];
  const ids = ["core:missing", ...sorted.map((d) => d.id)];
  const index = new Map<string, number>();
  const n = defs.length;
  const halfX = new Float32Array(n);
  const halfY = new Float32Array(n);
  const halfZ = new Float32Array(n);
  const move: (MoveParams | null)[] = new Array(n).fill(null);
  let hash = hashString("snark-content-1");
  for (let i = 1; i < n; i++) {
    const d = defs[i]!;
    index.set(d.id, i);
    hash = hashString(canonical(d), hash);
    if (d.type === "structure") {
      halfX[i] = d.half[0];
      halfY[i] = d.half[1];
      halfZ[i] = d.half[2];
    } else if (d.type === "species") move[i] = moveParams(d);
  }
  return { registry: { defs, ids, index, hash, halfX, halfY, halfZ, move }, errors };
}

function moveParams(d: SpeciesDef): MoveParams {
  return {
    radius: d.radius,
    height: d.height,
    walkSpeed: d.walkSpeed,
    sprintMul: d.sprintMul,
    accelGround: d.walkSpeed * 10,
    accelAir: d.walkSpeed * 2,
    jumpSpeed: d.jumpSpeed,
    gravity: GRAVITY,
    slopeCos: SLOPE_COS,
    stepUp: 0.5,
    stepDown: 0.4,
  };
}

/** Key-sorted JSON, so the hash does not depend on property order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
