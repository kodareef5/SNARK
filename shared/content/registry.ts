// Compiles content definitions into the tables the simulation reads.
//
// Dense indices are assigned in id order, so every process that loads the same
// definitions gets the same indices and the same hash. Index 0 is reserved: it
// marks an empty structure slot and stands in for content that no longer exists.

import { TICK_RATE } from "../coords.ts";
import { hashString } from "../hash.ts";
import { STAMINA_UNITS, type MoveParams } from "../sim/character.ts";
import { STAT_NAMES } from "../sim/genome.ts";
import { GAME_HOUR_TICKS } from "../sim/lazy.ts";
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
  /** Item columns, zero for content that is not an item. See shared/sim/items.ts. */
  readonly stack: Uint16Array;
  readonly weight: Float32Array;
  readonly spoilTicks: Uint32Array;
  /** Radius and height of anything that stands in the world as an entity; zero otherwise. */
  readonly bodyRadius: Float32Array;
  readonly bodyHeight: Float32Array;
  /** 1 for box kinds that bodies pass through (bushes). */
  readonly soft: Uint8Array;
  /** Hits a node of this kind takes before it is used up. */
  readonly nodeHits: Float32Array;
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
      if (d.swimSpeed !== undefined) positive(d, "swimSpeed", d.swimSpeed, 40);
      if (d.skeleton !== undefined && d.skeleton !== "human") errors.push(`${d.id}: unknown skeleton "${d.skeleton}"`);
      if (d.stamina && !(d.stamina.sprint >= 0 && d.stamina.regen >= 0 && d.stamina.jump >= 0)) errors.push(`${d.id}: stamina costs must not be negative`);
      if (d.height < 2 * d.radius) errors.push(`${d.id}: height must be at least twice the radius`);
      if (!(d.eyeHeight > 0 && d.eyeHeight <= d.height)) errors.push(`${d.id}: eyeHeight must be within the body`);
      for (const [name, st] of [["crouch", d.crouch], ["prone", d.prone]] as const) {
        if (st && !(st.height > 0 && st.height <= d.height && st.eye > 0 && st.eye <= st.height && st.speed > 0 && st.speed <= 1)) errors.push(`${d.id}: ${name} needs 0 < eye <= height <= the body's height and 0 < speed <= 1`);
      }
      if (d.food) {
        positive(d, "food.max", d.food.max, 1e6);
        positive(d, "food.perHour", d.food.perHour, 1e6);
      }
      for (const [stat, curve] of Object.entries(d.stats ?? {})) {
        if (!(STAT_NAMES as readonly string[]).includes(stat)) errors.push(`${d.id}: unknown stat "${stat}"`);
        else if (!Array.isArray(curve) || curve.length !== 3 || !(curve[0] > 0) || !(curve[1] >= 0) || !(curve[2] >= 0)) errors.push(`${d.id}: stats.${stat} must be [base > 0, perWild >= 0, perTamed >= 0]`);
      }
    } else if (d.type === "prop") {
      positive(d, "radius", d.radius, 8);
      positive(d, "height", d.height, 32);
    } else if (d.type === "node") {
      for (let a = 0; a < 3; a++) positive(d, `half[${a}]`, d.half[a]!, MAX_STRUCTURE_HALF);
      positive(d, "hits", d.hits, 10000);
      positive(d, "respawnHours", d.respawnHours, 1e6);
      for (const y of d.yields) if (!(y.min >= 0 && y.max >= y.min)) errors.push(`${d.id}: a yield's range must be 0 <= min <= max`);
    } else if (d.type === "recipe") {
      positive(d, "count", d.count, 1000);
      positive(d, "seconds", d.seconds, 86400);
      if (d.needs.length === 0) errors.push(`${d.id}: a recipe needs at least one ingredient`);
    } else if (d.type === "engram") {
      positive(d, "level", d.level, 1000);
      if (!(d.cost >= 0)) errors.push(`${d.id}: cost must not be negative`);
    } else if (d.type === "levels") {
      if (d.xp.length < 2 || d.xp[0] !== 0 || d.xp.some((v, i) => i > 0 && v <= d.xp[i - 1]!)) errors.push(`${d.id}: xp must start at 0 and rise`);
      if (d.engramPoints.length !== d.xp.length) errors.push(`${d.id}: engramPoints must have one entry per level`);
    } else if (d.type === "structure") {
      positive(d, "half[0]", d.half[0], MAX_STRUCTURE_HALF);
      positive(d, "half[1]", d.half[1], MAX_STRUCTURE_HALF);
      positive(d, "half[2]", d.half[2], MAX_STRUCTURE_HALF);
      positive(d, "hp", d.hp, 1e9);
    } else {
      if (!(Number.isInteger(d.stack) && d.stack >= 1 && d.stack <= 65535)) errors.push(`${d.id}: stack must be a whole number from 1 to 65535`);
      if (d.weight !== undefined && !(d.weight >= 0)) errors.push(`${d.id}: weight must not be negative`);
      if (d.spoilHours !== undefined && !(d.spoilHours > 0)) errors.push(`${d.id}: spoilHours must be positive`);
    }
    if (d.type === "species" || d.type === "structure" || d.type === "prop" || d.type === "node") {
      if (d.mesh.length === 0) errors.push(`${d.id}: mesh is required`);
      if (!(Number.isInteger(d.color) && d.color >= 0 && d.color < 256)) errors.push(`${d.id}: color must be a palette index`);
    }
  }
  // References between definitions must name something of the right type.
  const typeOf = new Map(input.map((d) => [d.id, d.type]));
  const want = (d: Def, id: string, type: string) => {
    if (typeOf.get(id) !== type) errors.push(`${d.id}: "${id}" is not ${type === "item" ? "an item" : `a ${type}`}`);
  };
  for (const d of input) {
    if (d.type === "node") for (const y of d.yields) want(d, y.item, "item");
    else if (d.type === "recipe") {
      want(d, d.makes, "item");
      for (const n of d.needs) want(d, n.item, "item");
    } else if (d.type === "engram") for (const r of d.unlocks) want(d, r, "recipe");
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
  const stack = new Uint16Array(n);
  const weight = new Float32Array(n);
  const spoilTicks = new Uint32Array(n);
  const bodyRadius = new Float32Array(n);
  const bodyHeight = new Float32Array(n);
  const soft = new Uint8Array(n);
  const nodeHits = new Float32Array(n);
  let hash = hashString("snark-content-1");
  for (let i = 1; i < n; i++) {
    const d = defs[i]!;
    index.set(d.id, i);
    hash = hashString(canonical(d), hash);
    if (d.type === "structure" || d.type === "node") {
      halfX[i] = d.half[0];
      halfY[i] = d.half[1];
      halfZ[i] = d.half[2];
      if (d.type === "node") {
        nodeHits[i] = d.hits;
        if (d.soft) soft[i] = 1;
      }
    } else if (d.type === "species" || d.type === "prop") {
      if (d.type === "species") move[i] = moveParams(d);
      bodyRadius[i] = d.radius;
      bodyHeight[i] = d.height;
    } else if (d.type === "item") {
      stack[i] = d.stack;
      weight[i] = d.weight ?? 0.1;
      spoilTicks[i] = Math.round((d.spoilHours ?? 0) * GAME_HOUR_TICKS);
    }
  }
  return { registry: { defs, ids, index, hash, halfX, halfY, halfZ, move, stack, weight, spoilTicks, bodyRadius, bodyHeight, soft, nodeHits }, errors };
}

function moveParams(d: SpeciesDef): MoveParams {
  // A capsule is never shorter than it is wide.
  const low = (h: number): number => (h < 2 * d.radius ? 2 * d.radius : h);
  const crouchHeight = low(d.crouch?.height ?? (d.height * 2) / 3);
  const proneHeight = low(d.prone?.height ?? 0);
  return {
    radius: d.radius,
    height: d.height,
    eyeHeight: d.eyeHeight,
    crouchHeight,
    crouchEye: d.crouch?.eye ?? crouchHeight * (d.eyeHeight / d.height),
    crouchMul: d.crouch?.speed ?? 0.5,
    proneHeight,
    proneEye: d.prone?.eye ?? proneHeight * 0.45,
    proneMul: d.prone?.speed ?? 0.2,
    walkSpeed: d.walkSpeed,
    sprintMul: d.sprintMul,
    accelGround: d.walkSpeed * 10,
    accelAir: d.walkSpeed * 2,
    jumpSpeed: d.jumpSpeed,
    gravity: GRAVITY,
    slopeCos: SLOPE_COS,
    stepUp: 0.5,
    stepDown: 0.4,
    swimSpeed: d.swimSpeed ?? d.walkSpeed * 0.6,
    swimSprintMul: 1.5,
    accelSwim: d.walkSpeed * 3,
    // Whole stamina units per tick, so both sides count the same integers.
    staminaSprint: Math.round(((d.stamina?.sprint ?? 5) * STAMINA_UNITS) / TICK_RATE),
    staminaRegen: Math.round(((d.stamina?.regen ?? 8) * STAMINA_UNITS) / TICK_RATE),
    staminaJump: Math.round((d.stamina?.jump ?? 6) * STAMINA_UNITS),
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
