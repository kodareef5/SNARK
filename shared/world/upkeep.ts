// Numbers and arithmetic for picking up, demolishing and mending a built piece, shared so a client can show a cost before asking.
// The server judges (server/build.ts).

import type { Registry } from "../content/registry.ts";
import { TICK_RATE } from "../coords.ts";

/** Actions of a CMD_STRUCT. */
export const STRUCT_PICKUP = 0;
export const STRUCT_DEMOLISH = 1;
export const STRUCT_REPAIR = 2;
export const STRUCT_LOCK = 3;
export const STRUCT_UNLOCK = 4;
/** Sets a PIN, which also locks it. With NO_PIN, removes the PIN. */
export const STRUCT_PIN = 5;
/** A door opens or shuts, a box opens. A survivor outside its tribe sends the PIN. */
export const STRUCT_USE = 6;
/** Light a fire, or put it out. */
export const STRUCT_LIGHT = 7;
/** Name a bed: a name string follows (MAX_NAME_BYTES). */
export const STRUCT_NAME = 8;
/** Travel from a bed to another of the tribe's: the survivor leaves its body and chooses where to rise (CHOOSE_TRAVEL). */
export const STRUCT_TRAVEL = 9;
/** The PIN value that means none. */
export const NO_PIN = 0xffff;
/** Wrong PINs in a row before a survivor must wait, and the first wait in ticks. Each further wrong one doubles the wait, up to an hour. */
export const PIN_TRIES = 3;
export const PIN_WAIT_TICKS = 30 * TICK_RATE;

/** Metres from the eye to the piece's nearest face, roughly. */
export const ACT_REACH = 4;

/** Scratch that refundOf and repairCostOf fill with `n` pairs of item and count. */
export const cost = { n: 0, item: new Uint16Array(16), count: new Uint16Array(16) };

/** Half of each ingredient, rounded down. Fills `cost`. False if the kind has no known recipe. */
export function refundOf(reg: Registry, kind: number): boolean {
  return fill(reg, kind, 0.5, false);
}

/**
 * The missing share of each ingredient, rounded up. Fills `cost`. False if the kind has no known recipe or the structure is whole.
 * `hp` is the health a client holds (toldHealth), on the server too, so the cost shown is the cost charged.
 */
export function repairCostOf(reg: Registry, kind: number, hp: number): boolean {
  const max = reg.maxHp[kind]!;
  if (!(hp < max) || !(max > 0)) return false;
  return fill(reg, kind, 1 - (hp > 0 ? hp : 0) / max, true);
}

function fill(reg: Registry, kind: number, part: number, up: boolean): boolean {
  cost.n = 0;
  const item = reg.pieceItem[kind]!;
  const needs = item !== 0 ? reg.recipeOf[item] : null;
  if (!needs) return false;
  const makes = reg.recipeMakes[item]! || 1;
  for (let k = 0; k + 1 < needs.length && cost.n < cost.item.length; k += 2) {
    const exact = (needs[k + 1]! / makes) * part;
    const count = up ? Math.ceil(exact - 1e-9) : Math.floor(exact + 1e-9);
    if (count <= 0) continue;
    cost.item[cost.n] = needs[k]!;
    cost.count[cost.n] = count;
    cost.n++;
  }
  return true;
}
