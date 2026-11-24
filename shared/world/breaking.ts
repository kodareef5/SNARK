// What a city piece's row says of it beyond its kind, worked out alike by server and client: its stage from its health and
// the kind the map placed, whether its panes stand, which of its cuts it wears, and which half a point is in.
// A city piece is a row in a map slot owned by nobody. Its health is measured against the map's kind, whatever form its row holds.

import { BREAK_FAMILIES, BREAK_VARIANTS, FORM_BREACH_A, FORM_BREACH_B, FORM_HEAP, FORM_OPEN, FORM_WHOLE, formKind } from "../content/breaks.ts";
import type { Registry } from "../content/registry.ts";
import { STRUCT_UNITS } from "../coords.ts";
import { hullPoint } from "./convex.ts";
import { frame, frameOf } from "./frame.ts";

/** How worn a piece looks. Its body's health over 2/3 is whole, over 1/3 worn, over 1/6 cracked, and failing under that. */
export const STAGE_WHOLE = 0, STAGE_WORN = 1, STAGE_CRACKED = 2, STAGE_FAILING = 3;
export const STAGES = ["whole", "worn", "cracked", "failing"] as const;
/** Added to a stage by `shows` while a glazed piece's panes stand. */
export const SHOWS_PANES = 4;
/** The share of its body's health an opened piece is left. */
export const OPEN_SHARE = 0.25;
/** Blows of a tool of power 1 that mine out one half's heap. A heap's health is these, for each half. */
export const HEAP_BLOWS = 24;

/** The health of a piece of `mapKind` without its panes'. The panes' is the top slice of its full health. */
export const bodyHealth = (reg: Registry, mapKind: number): number => reg.maxHp[mapKind]! - reg.glassHp[mapKind]!;

/** The health of its body under which a piece of `mapKind` is breached: a third. */
export const breachHealth = (reg: Registry, mapKind: number): number => bodyHealth(reg, mapKind) / 3;

/** The stage of a piece the map placed as `mapKind`, at health `hp`. */
export function stageOf(reg: Registry, mapKind: number, hp: number): number {
  const body = bodyHealth(reg, mapKind);
  const left = hp < body ? hp : body;
  return left * 3 > body * 2 ? STAGE_WHOLE : left * 3 > body ? STAGE_WORN : left * 6 > body ? STAGE_CRACKED : STAGE_FAILING;
}

/** Whether a piece the map placed as `mapKind` still has panes at health `hp`. */
export const paned = (reg: Registry, mapKind: number, hp: number): boolean => reg.glassHp[mapKind]! > 0 && hp > bodyHealth(reg, mapKind);

/** What of a piece's health is seen: its stage, and SHOWS_PANES while its panes stand. Health that leaves this alone is told to nobody. */
export const shows = (reg: Registry, mapKind: number, hp: number): number => stageOf(reg, mapKind, hp) + (paned(reg, mapKind, hp) ? SHOWS_PANES : 0);

/** Which of a form's cuts a piece at (x, y, z) wears. It is its place's alone, so server and client agree and nothing is kept. */
export function variantAt(x: number, y: number, z: number): number {
  let h = Math.imul(Math.round(x * STRUCT_UNITS) | 0, 0x9e3779b1);
  h = Math.imul(h ^ (Math.round(y * STRUCT_UNITS) | 0), 0x85ebca6b);
  h = Math.imul(h ^ (Math.round(z * STRUCT_UNITS) | 0), 0xc2b2ae35);
  return ((h ^ (h >>> 15)) >>> 3) & (BREAK_VARIANTS - 1);
}

/** Whether `kind` is a heap. */
export const isHeap = (reg: Registry, kind: number): boolean => reg.breakSet[kind] !== 0 && reg.breakForm[kind] === FORM_HEAP;

/** The health a heap of `kind` (a piece's map kind or any form of it) is made with: its yield, by the piece's halves. */
export const heapHealth = (reg: Registry, kind: number): number => HEAP_BLOWS * (reg.breakHalves[kind]! || 1);

/** The heap a piece of `kind` at (x, y, z) becomes, or 0. */
export const heapAt = (reg: Registry, kind: number, x: number, y: number, z: number): number => formKind(reg, kind, FORM_HEAP, variantAt(x, y, z));

const PIER = BREAK_FAMILIES.indexOf("pier"), ROOF = BREAK_FAMILIES.indexOf("roof");
/** Per kind, the middle of what is solid of it along its halves' axis, in metres from its place. NaN until asked. */
const middles = new WeakMap<Registry, Float32Array>();

/** The axis a piece's halves lie along: a pier's are its lower and upper, a pitched roof's its two slopes, any other's along its length. */
const halvesAxis = (reg: Registry, kind: number): number => (reg.breakFamily[kind] === PIER ? 1 : reg.breakFamily[kind] === ROOF ? 2 : 0);

/** The middle of what is solid of `kind` along `axis`. */
function middleOf(reg: Registry, kind: number, axis: number): number {
  let held = middles.get(reg);
  if (!held) middles.set(reg, (held = new Float32Array(reg.defs.length).fill(NaN)));
  if (held[kind] === held[kind]) return held[kind]!;
  const { start, box, hulls } = reg.parts;
  let lo = Infinity, hi = -Infinity;
  for (let p = start[kind]! * 6, end = start[kind + 1]! * 6; p < end; p += 6) {
    lo = Math.min(lo, box[p + axis]! - box[p + 3 + axis]!);
    hi = Math.max(hi, box[p + axis]! + box[p + 3 + axis]!);
  }
  const point: [number, number, number] = [0, 0, 0];
  for (let h = hulls ? hulls.start[kind]! : 0, end = hulls ? hulls.start[kind + 1]! : 0; h < end; h++) {
    for (let c = hulls!.corner[h]!; c < hulls!.corner[h + 1]!; c++) {
      hullPoint([hulls!.at[c * 3]!, hulls!.at[c * 3 + 1]!, hulls!.at[c * 3 + 2]!], hulls!.sixty[h] === 1, point);
      lo = Math.min(lo, point[axis]!);
      hi = Math.max(hi, point[axis]!);
    }
  }
  return (held[kind] = lo <= hi ? (lo + hi) / 2 : 0);
}

/**
 * The breach a whole piece of `kind` turned `yaw` takes from a hit (dx, dy, dz) metres from its place: FORM_BREACH_A for
 * its first half (toward -X of its own frame, a pier's lower, a roof's -Z slope), FORM_BREACH_B for its other, the one it
 * has where it has only one, or 0 for a piece with no breach.
 */
export function breachAt(reg: Registry, kind: number, yaw: number, dx: number, dy: number, dz: number): number {
  const a = formKind(reg, kind, FORM_BREACH_A, 0), b = formKind(reg, kind, FORM_BREACH_B, 0);
  if (a === 0 || b === 0) return a !== 0 ? FORM_BREACH_A : b !== 0 ? FORM_BREACH_B : 0;
  const axis = halvesAxis(reg, kind);
  frameOf(yaw);
  const along = axis === 0 ? dx * frame.cos - dz * frame.sin : axis === 1 ? dy : dx * frame.sin + dz * frame.cos;
  return along < middleOf(reg, kind, axis) ? FORM_BREACH_A : FORM_BREACH_B;
}

/** The form `kind` is: FORM_WHOLE for a kind that is no broken form. */
export const formOf = (reg: Registry, kind: number): number => (reg.breakSet[kind] !== 0 ? reg.breakForm[kind]! : FORM_WHOLE);

/** A street's wreck, which is salvaged a rung at a time and never breaks as a building's piece does. */
export const WRECK = BREAK_FAMILIES.indexOf("wreck");
/** A rung this near an end, as a share of it, is at that end: health is kept in 32 bits, and a rung's blows must add up. */
const RUNG_SLACK = 1e-4;

/** How many rungs' worth of the health of a wreck the map placed as `mapKind` is gone at health `hp`. */
const rungsGone = (reg: Registry, mapKind: number, hp: number): number => ((reg.maxHp[mapKind]! - hp) * reg.salvageYield[mapKind]!.length) / reg.maxHp[mapKind]!;

/** The health one unit of work strikes from a wreck the map placed as `mapKind`: a rung's health over a rung's work. */
export const workHealth = (reg: Registry, mapKind: number): number => reg.maxHp[mapKind]! / (reg.salvageYield[mapKind]!.length * reg.salvageWork[mapKind]!);

/** The share of rung `rung` of a wreck placed as `mapKind` that is struck away at health `hp`, from 0 to 1. */
export function rungShare(reg: Registry, mapKind: number, rung: number, hp: number): number {
  const share = rungsGone(reg, mapKind, hp) - rung;
  return share < RUNG_SLACK ? 0 : share > 1 - RUNG_SLACK ? 1 : share;
}

/** The rung a wreck placed as `mapKind` is on at health `hp`: 0 from full health, and its count of rungs once every one is struck away. */
export function rungAt(reg: Registry, mapKind: number, hp: number): number {
  const rung = Math.floor(rungsGone(reg, mapKind, hp) + RUNG_SLACK);
  return rung < 0 ? 0 : Math.min(rung, reg.salvageYield[mapKind]!.length);
}

/**
 * The kind a wreck placed as `mapKind` is on `rung`: its lesser looks in the order it takes them (stripped, then a shell),
 * the last it has on every rung past them, and itself where it has none.
 */
export function rungKind(reg: Registry, mapKind: number, rung: number): number {
  if (rung <= 0) return mapKind;
  const stripped = formKind(reg, mapKind, FORM_BREACH_A, 0), shell = formKind(reg, mapKind, FORM_OPEN, 0);
  return (rung === 1 ? stripped || shell : shell || stripped) || mapKind;
}
