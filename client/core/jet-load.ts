// The jet's code comes in a file of its own (jet-late.ts), fetched the first time a page meets a jet: its family's row is
// wanted (shared/sim/families.ts), one is drawn, or what this survivor sits in is armed or warned. A survivor who never
// meets one never fetches it. Until it has come a jet stands as it is sent, its parts unposed, and its glass and its
// missiles' smoke are not drawn.

import { familyWanted } from "../../shared/sim/families.ts";
import type { FramePart } from "./frame.ts";
import type { FighterModel } from "./hud/fighter.ts";
import type { HudWidget } from "./hud/widget.ts";
import type { JetPose, JetRig } from "./render/jet-bones.ts";

/** What moves on each jet drawn (render/jet-parts.ts JetParts). */
export interface JetPartsCode {
  pose(rot: Float32Array | Float64Array, rig: JetRig, id: number, pose: JetPose, clock: number): void;
  sweep(clock: number): void;
}

export const KEY_FIGHTER = 6720;
export const KEY_LOCK = KEY_FIGHTER + 13;
export const KEY_LOCK_WARNING = KEY_LOCK + 4;

/** What the late file gives: the parts, the missiles' smoke and the jet's glass. */
export interface JetCode {
  parts(): JetPartsCode;
  trail(): FramePart;
  readonly fighter: Required<Pick<HudWidget<FighterModel>, "fill" | "build">>;
}

/** The jet's code, once it has come. */
export const JET_CODE: { code: JetCode | null } = { code: null };

let asked: Promise<unknown> | null = null;

/** The jet's code, fetched once. A fetch that fails may be asked again. */
export function askJet(): Promise<unknown> {
  return (asked ??= import("./jet-late.ts").catch((e: unknown) => {
    asked = null;
    throw e;
  }));
}

familyWanted.ask = () => void askJet().catch(() => {});
