// The action state machine, stepped once a tick from the same button bits on the server and on the client that predicts its body.
// It decides only when a swing lands, a shot leaves or a reload ends. What they hit is decided in server/combat.ts.

import { BTN_MELEE, BTN_PRIMARY, BTN_RELOAD, MF_OUT, MODE_SWIM, MODE_WALK, type Body } from "./character.ts";

export const ACT_NONE = 0;
export const ACT_EQUIP = 1;
export const ACT_SWING = 2;
export const ACT_DRAW = 3;
export const ACT_HOLD = 4;
export const ACT_RELOAD = 5;
export const ACT_COOL = 6;

export const W_MELEE = 0;
export const W_BOW = 1;
export const W_GUN = 2;
export const W_THROWN = 3;

/** How a body carries the held item, for its pose. Three bits. */
export const HOLD_HANDS = 0;
export const HOLD_TOOL = 1;
export const HOLD_SPEAR = 2;
export const HOLD_BOW = 3;
export const HOLD_RIFLE = 4;
export const HOLD_PISTOL = 5;
export const HOLD_THROW = 6;
export const HOLD_NAMES: readonly string[] = ["hands", "tool", "spear", "bow", "rifle", "pistol", "throw"];

/** ACT_EQUIP lasts this long. Code outside the step sets it when the held item changes. */
export const EQUIP_TICKS = 15;

/** Timings in ticks, compiled from the weapon's definition and the same on both sides. */
export interface WeaponParams {
  readonly kind: number;
  readonly hold: number;
  /** Melee and thrown: the whole swing, and the tick of it that lands. For a gun, swingTicks is the ticks between shots. */
  readonly swingTicks: number;
  readonly strikeTick: number;
  /** Bow: ticks to full draw, and the fewest it can be loosed after. */
  readonly drawTicks: number;
  readonly minDrawTicks: number;
  /** Also the ticks to nock the next arrow. */
  readonly reloadTicks: number;
  /** Rounds it holds. */
  readonly clip: number;
  /** Works under water. */
  readonly wet: boolean;
}

/** A swing's ticks unless its weapon says otherwise. The swing as drawn takes this long. */
export const SWING_TICKS = 15;

/** Bare hands, and anything held that is not a weapon. */
export const FISTS: WeaponParams = { kind: W_MELEE, hold: HOLD_HANDS, swingTicks: SWING_TICKS, strikeTick: 5, drawTicks: 0, minDrawTicks: 0, reloadTicks: 0, clip: 0, wet: true };

/** What the last stepAction call did. Each flag is for that tick only. */
export const actionOut = {
  /** A melee swing landed. */
  strike: false,
  /** A shot or a thrown item left. `draw` is how far it was drawn, 0 to 1. */
  fire: false,
  draw: 0,
  reloaded: false,
};

/**
 * `buttons` are held and `pressed` went down this tick. The caller passes `pressed` because each side already knows it.
 * A reload starts only if it would leave more rounds in the weapon than it has (`b.reloadTo`, which the server keeps).
 */
export function stepAction(b: Body, buttons: number, pressed: number, w: WeaponParams): void {
  const out = actionOut;
  out.strike = false;
  out.fire = false;
  out.draw = 0;
  out.reloaded = false;
  const reloadTo = b.reloadTo;
  // A body that is not in the world or is unconscious does nothing, and its act ends.
  if ((b.mode !== MODE_WALK && b.mode !== MODE_SWIM) || (b.mflags & MF_OUT) !== 0) {
    b.act = ACT_NONE;
    b.actTicks = 0;
    return;
  }
  // Under water only a `wet` weapon works.
  const usable = w.wet || b.mode !== MODE_SWIM;

  if (b.act === ACT_EQUIP) {
    if (++b.actTicks < EQUIP_TICKS) return;
    b.act = ACT_NONE;
  } else if (b.act === ACT_SWING) {
    b.actTicks++;
    if (b.actTicks === w.strikeTick) {
      if (w.kind === W_THROWN) {
        out.fire = true;
        out.draw = 1;
      } else out.strike = true;
    }
    // A held button goes straight into the next swing, on the tick this one ends.
    if (b.actTicks < w.swingTicks) return;
    b.act = ACT_NONE;
  }
  if (b.act === ACT_DRAW || b.act === ACT_HOLD) {
    // The melee button lets the string down without loosing, and so does going under water.
    if ((pressed & BTN_MELEE) !== 0 || !usable) {
      b.act = ACT_NONE;
      return;
    }
    if ((buttons & BTN_PRIMARY) !== 0) {
      if (b.act === ACT_DRAW && ++b.actTicks >= w.drawTicks) b.act = ACT_HOLD;
      return;
    }
    // The button was let go. The arrow is loosed if it was drawn far enough, else let down.
    const drawn = b.act === ACT_HOLD ? w.drawTicks : b.actTicks;
    b.act = ACT_NONE;
    if (drawn >= w.minDrawTicks && b.rounds > 0) {
      out.fire = true;
      out.draw = w.drawTicks > 0 ? drawn / w.drawTicks : 1;
      b.rounds--;
      b.act = ACT_COOL;
      b.actTicks = 0;
    }
    return;
  }
  if (b.act === ACT_RELOAD) {
    if (++b.actTicks >= w.reloadTicks) {
      b.act = ACT_NONE;
      b.rounds = reloadTo > b.rounds ? reloadTo : b.rounds;
      out.reloaded = true;
    }
    return;
  }
  if (b.act === ACT_COOL) {
    if (++b.actTicks < w.swingTicks) return;
    b.act = ACT_NONE;
    // Falls through, so an empty weapon starts its reload on the tick the pause ends.
  }

  if (w.kind === W_MELEE || w.kind === W_THROWN) {
    if ((buttons & (BTN_PRIMARY | BTN_MELEE)) !== 0 && usable) {
      b.act = ACT_SWING;
      b.actTicks = 0;
    }
    return;
  }
  // A bow or a gun. An empty one reloads by itself if there is anything to reload with.
  const wantsReload = b.rounds === 0 || ((pressed & BTN_RELOAD) !== 0 && b.rounds < w.clip);
  if (wantsReload && reloadTo > b.rounds) {
    b.act = ACT_RELOAD;
    b.actTicks = 0;
    return;
  }
  if (b.rounds === 0 || !usable) return;
  if (w.kind === W_BOW) {
    if ((buttons & BTN_PRIMARY) !== 0) {
      b.act = ACT_DRAW;
      b.actTicks = 0;
    }
  } else if ((pressed & BTN_PRIMARY) !== 0) {
    // A gun fires once for each press.
    out.fire = true;
    out.draw = 1;
    b.rounds--;
    b.act = ACT_COOL;
    b.actTicks = 0;
  }
}

