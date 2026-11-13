// What a body does with what it holds: one small state machine, stepped once a
// tick from the same button bits on the server and on the client that predicts
// its own body. Because both run it on the same tick with the same state, a
// client sees its own swing, draw and reload begin the moment it asks, and the
// server lands the strike or looses the shot on the tick the client expects.
//
// The step decides only *when*: when a swing lands, when a shot leaves, when a
// reload is done. What a strike hits and what a shot does are the server's
// business (server/combat.ts); this file never sees a target.
//
// The step is given which buttons went down this tick rather than keeping the
// last tick's buttons itself: each side already knows.
//
// Acts:
//   none      ready
//   equip     taking something in hand; set from outside when what is held changes
//   swing     a melee swing or a throw; it lands on one tick partway through
//   draw      a bow being drawn, while the button is held
//   hold      a bow at full draw, waiting for the button to be let go
//   reload    putting rounds in, or nocking the next arrow
//   cool      the pause after a shot

import { BTN_MELEE, BTN_PRIMARY, BTN_RELOAD, MODE_SWIM, MODE_WALK, type Body } from "./character.ts";

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

/** How a body carries what it holds, for its pose. Three bits. */
export const HOLD_HANDS = 0;
export const HOLD_TOOL = 1;
export const HOLD_SPEAR = 2;
export const HOLD_BOW = 3;
export const HOLD_RIFLE = 4;
export const HOLD_PISTOL = 5;
export const HOLD_THROW = 6;
export const HOLD_NAMES: readonly string[] = ["hands", "tool", "spear", "bow", "rifle", "pistol", "throw"];

/** Ticks to take something in hand before it can be used. */
export const EQUIP_TICKS = 15;

/** Timings of a kind of weapon, in ticks. Compiled from its definition; the same on both sides. */
export interface WeaponParams {
  readonly kind: number;
  readonly hold: number;
  /** Melee and thrown: the whole swing, and the tick of it on which it lands. A gun: ticks between shots. */
  readonly swingTicks: number;
  readonly strikeTick: number;
  /** Bow: ticks to full draw, and the fewest it can be loosed after. */
  readonly drawTicks: number;
  readonly minDrawTicks: number;
  /** Ticks to reload, or to nock the next arrow. */
  readonly reloadTicks: number;
  /** Rounds it holds. */
  readonly clip: number;
  /** Works under water. */
  readonly wet: boolean;
}

/** Ticks of a swing unless its weapon says otherwise. The swing a body is drawn making takes this long. */
export const SWING_TICKS = 15;

/** Bare hands, and anything held that is not a weapon. */
export const FISTS: WeaponParams = { kind: W_MELEE, hold: HOLD_HANDS, swingTicks: SWING_TICKS, strikeTick: 5, drawTicks: 0, minDrawTicks: 0, reloadTicks: 0, clip: 0, wet: true };

/** What the last `stepAction` call did, besides changing the body. */
export const actionOut = {
  /** A melee swing landed this tick. */
  strike: false,
  /** A shot left (or a thrown thing left the hand) this tick, drawn this far: 0 to 1. */
  fire: false,
  draw: 0,
  /** A reload finished this tick. */
  reloaded: false,
};

/**
 * Advance what `b` is doing by one tick. `buttons` are the buttons held and
 * `pressed` those that went down this tick; `w` is the timings of what it
 * holds. A reload is started only if it would leave more rounds in the weapon
 * than it has (`b.reloadTo`, which the server keeps).
 */
export function stepAction(b: Body, buttons: number, pressed: number, w: WeaponParams): void {
  const out = actionOut;
  out.strike = false;
  out.fire = false;
  out.draw = 0;
  out.reloaded = false;
  const reloadTo = b.reloadTo;
  if (b.mode !== MODE_WALK && b.mode !== MODE_SWIM) {
    b.act = ACT_NONE;
    b.actTicks = 0;
    return;
  }
  // Under water only what is made for it works.
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
    // The melee button lets the string down without loosing; so does going under water.
    if ((pressed & BTN_MELEE) !== 0 || !usable) {
      b.act = ACT_NONE;
      return;
    }
    if ((buttons & BTN_PRIMARY) !== 0) {
      if (b.act === ACT_DRAW && ++b.actTicks >= w.drawTicks) b.act = ACT_HOLD;
      return;
    }
    // Let go: loosed if it was drawn far enough, let down if not.
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
    // Falls through: an empty weapon starts its reload on the tick the pause ends.
  }

  // Ready.
  if (w.kind === W_MELEE || w.kind === W_THROWN) {
    if ((buttons & (BTN_PRIMARY | BTN_MELEE)) !== 0 && usable) {
      b.act = ACT_SWING;
      b.actTicks = 0;
    }
    return;
  }
  // A bow or a gun. Empty, it reloads by itself if there is something to reload with.
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

