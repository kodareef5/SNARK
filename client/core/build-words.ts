// What building says and draws with, which the app needs before build mode's own code has come (editor-load.ts): the
// ghost's colours, and the words for why a piece may not go where it was asked.

import type { Registry } from "../../shared/content/registry.ts";
import { handleIndex } from "../../shared/ids.ts";
import { PLACED_COUNTS, PLACED_ENTITY, PLACED_METRES, PLACED_STRUCTURE, RESULT_BODY, RESULT_ENEMY_NEAR, RESULT_FAR, RESULT_FULL, RESULT_LIMIT, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_NO_SUPPORT, RESULT_OBSTRUCTED, RESULT_RATE, RESULT_SHORT, RESULT_TERRAIN, RESULT_TOO_HIGH, RESULT_WAIT } from "../../shared/net/protocol.ts";
import type { ClientSession } from "./session.ts";
import { structName } from "./ui/structure.ts";

/** Metres. These match the server's BODY_SLACK, ENEMY_FOUNDATION and ENEMY_PILLAR (server/build.ts). */
export const BODY_SLACK = 0.1;
export const ENEMY_FOUNDATION = 50;
export const ENEMY_PILLAR = 10;
/** Palette indices for the ghost: fine, fine and at the last step that stands, refused; and for a slot's outline. */
export const GHOST_OK = 16;
export const GHOST_WARN = 3;
export const GHOST_BAD = 8;
export const GHOST_SLOT = 10;
/** How see-through the other slots' marks are, 0 to 1. */
export const OTHERS_FADE = 0.55;
/** A piece that would fall is drawn over itself this see-through, this many metres toward the eye so it is not hidden by itself. */
export const FALL_FADE = 0.3;
export const FALL_NEAR = 0.04;

/** Keyed by the RESULT_ code from the local check or the server: what is said where no cause is known. */
export const BUILD_REASONS: Readonly<Record<number, string>> = {
  [RESULT_OBSTRUCTED]: "Something is in the way",
  [RESULT_BODY]: "Someone is in the way",
  [RESULT_TOO_HIGH]: "Too far above the ground",
  [RESULT_TERRAIN]: "The ground is in the way",
  [RESULT_RATE]: "Slow down",
  [RESULT_NO_SUPPORT]: "Nothing would hold it up",
  [RESULT_ENEMY_NEAR]: "Too near another tribe's foundation",
  [RESULT_NOT_YOURS]: "That is not your tribe's",
  [RESULT_NO_SNAP]: "It must join something built",
  [RESULT_FAR]: "Too far away",
  [RESULT_SHORT]: "You have none left",
  [RESULT_FULL]: "This area holds no more pieces",
  [RESULT_LIMIT]: "No more structures may stand here",
  // The preview's own: a piece under it is two answers away.
  [RESULT_WAIT]: "Waiting for the piece it joins",
};

/** What stands in a piece's way, as S_PLACED tells it and the preview finds it: a PLACED_ detail and its numbers. */
export interface Blocker {
  detail: number;
  a: number;
  b: number;
}

/**
 * Why a piece may not go where it was asked, naming the cause where one is known: the piece or the body in the way, or
 * the metres to another tribe's foundation. `nameOf` gives a body's name by its entity index, "" for one not in view.
 */
export function buildReason(reg: Registry, session: ClientSession, code: number, by: Blocker, nameOf?: (entity: number) => string, structs = session.world?.structs): string {
  if (code === RESULT_OBSTRUCTED && by.detail === PLACED_STRUCTURE) {
    const t = structs?.chunks[Math.floor(by.a / 65536)];
    const kind = t && (by.a & 0xffff) < t.high ? t.kind[by.a & 0xffff]! : 0;
    if (kind !== 0) return `Blocked by ${structName(reg, kind)}`;
  }
  if (code === RESULT_BODY && by.detail === PLACED_ENTITY) {
    if (by.a === handleIndex(session.ownHandle)) return "You are standing in the way";
    const name = nameOf?.(by.a) ?? "";
    if (name !== "") return `Blocked by ${name}`;
  }
  if (code === RESULT_LIMIT && by.detail === PLACED_COUNTS) return `${by.a.toLocaleString("en-US")} of ${by.b.toLocaleString("en-US")} structures here`;
  if (code === RESULT_ENEMY_NEAR && by.detail === PLACED_METRES) return `${by.a} m from another tribe's ${by.b <= ENEMY_PILLAR ? "pillar" : "foundation"}; ${by.b} needed`;
  return BUILD_REASONS[code] ?? "It cannot be built there";
}
