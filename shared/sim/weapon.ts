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
/** No item's: both arms round a creature held to the chest (server/carry.ts, shared/anim/hold.ts). */
export const HOLD_CARRY = 7;

/** ACT_EQUIP lasts this long. Code outside the step sets it when the held item changes. */
export const EQUIP_TICKS = 15;

/** Timings in ticks, compiled from the weapon's definition and the same on both sides. */
export interface WeaponParams {
  readonly kind: number;
  readonly hold: number;
  /** Melee and thrown: the whole swing, and the tick of it that lands. For a gun, swingTicks is the ticks between shots. */
  readonly swingTicks: number;
  readonly strikeTick: number;
  /** Bow, and a thrown weapon that is charged: ticks to full draw, and the fewest it can be loosed after. */
  readonly drawTicks: number;
  readonly minDrawTicks: number;
  /** Also the ticks to nock the next arrow. */
  readonly reloadTicks: number;
  /** Rounds it holds. */
  readonly clip: number;
  /** Works under water. */
  readonly wet: boolean;
  // The fire modes of planning/reference/weapons-plan.md, M4 (W2). Each is absent where the facet does not say.
  /** The held primary button fires every `swingTicks`. */
  readonly auto?: boolean;
  /** A reload adds one round each `reloadTicks` until full, and the primary button ends it after the round under way. */
  readonly reloadEach?: boolean;
  /** A bow's or gun's blow with the melee button: its whole swing and the tick of it that lands. */
  readonly meleeTicks?: number;
  readonly meleeStrikeTick?: number;
  // The aim of the same plan, M1 and M2 (W1, shared/sim/aim.ts). Each is absent where the facet does not say.
  /**
   * The cone a shot leaves within, half angles in degrees: from the hip and aimed at rest, what full speed adds, what each
   * shot adds (bloom), how much it narrows back a tick, and how far the aim sways through a scope, standing.
   */
  readonly coneHip?: number;
  readonly coneAim?: number;
  readonly coneMove?: number;
  readonly coneBloom?: number;
  readonly coneRecover?: number;
  readonly coneSway?: number;
  /** Degrees of pitch a shot kicks the aim up, and how much of it comes back a tick. */
  readonly recoilKick?: number;
  readonly recoilRecover?: number;
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
 *
 * The fire modes and reloads of planning/reference/weapons-plan.md, M4: an `auto` gun fires every `swingTicks` while its
 * button is held; a `reloadEach` reload loads a round each `reloadTicks`, and a press of the primary button makes the round
 * under way its last; a bow or gun with `meleeTicks` strikes with the melee button; a thrown weapon with `drawTicks` is held
 * like a bow and leaves on release, `out.draw` saying how long it was held.
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
  // A bow's or gun's swing is its blow, which has its own timings.
  const ranged = w.kind === W_BOW || w.kind === W_GUN;

  if (b.act === ACT_EQUIP) {
    if (++b.actTicks < EQUIP_TICKS) return;
    b.act = ACT_NONE;
  } else if (b.act === ACT_SWING) {
    b.actTicks++;
    if (b.actTicks === (ranged ? (w.meleeStrikeTick ?? w.strikeTick) : w.strikeTick)) {
      if (w.kind === W_THROWN) {
        out.fire = true;
        out.draw = 1;
      } else out.strike = true;
    }
    // A held button goes straight into the next swing, on the tick this one ends.
    if (b.actTicks < (ranged ? (w.meleeTicks ?? w.swingTicks) : w.swingTicks)) return;
    b.act = ACT_NONE;
  }
  if (b.act === ACT_DRAW || b.act === ACT_HOLD) {
    // The melee button lets the string down without loosing, and so does going under water. A bow with a blow strikes
    // with it instead ("It is possible to cancel a shot by performing a weapon melee attack", Bow).
    if ((pressed & BTN_MELEE) !== 0 || !usable) {
      b.act = usable && w.meleeTicks !== undefined ? ACT_SWING : ACT_NONE;
      b.actTicks = 0;
      return;
    }
    if ((buttons & BTN_PRIMARY) !== 0) {
      if (b.act === ACT_DRAW && ++b.actTicks >= w.drawTicks) b.act = ACT_HOLD;
      return;
    }
    // The button was let go. The arrow is loosed if it was drawn far enough, else let down. A thrown thing is its own round.
    const drawn = b.act === ACT_HOLD ? w.drawTicks : b.actTicks;
    const thrown = w.kind === W_THROWN;
    b.act = ACT_NONE;
    if (drawn >= w.minDrawTicks && (thrown || b.rounds > 0)) {
      out.fire = true;
      out.draw = w.drawTicks > 0 ? drawn / w.drawTicks : 1;
      if (!thrown) b.rounds--;
      b.act = ACT_COOL;
      b.actTicks = 0;
    }
    return;
  }
  if (b.act === ACT_RELOAD) {
    if (w.reloadEach !== true) {
      if (++b.actTicks >= w.reloadTicks) {
        b.act = ACT_NONE;
        b.rounds = reloadTo > b.rounds ? reloadTo : b.rounds;
        out.reloaded = true;
      }
      return;
    }
    // A round at a time. `actTicks` counts toward the round under way; once the primary button is pressed it counts on from
    // `reloadTicks` toward the same round, which is then the last. The registry keeps twice `reloadTicks` within a byte.
    let last = b.actTicks >= w.reloadTicks;
    if (!last && (pressed & BTN_PRIMARY) !== 0) {
      b.actTicks += w.reloadTicks;
      last = true;
    }
    if (++b.actTicks < (last ? 2 * w.reloadTicks : w.reloadTicks)) return;
    b.actTicks = 0;
    if (reloadTo > b.rounds) {
      b.rounds++;
      out.reloaded = true;
    }
    if (!last && b.rounds < reloadTo && b.rounds < w.clip) return;
    b.act = ACT_NONE;
    if (!last) return;
    // The press that cut it short fires now that the round is in, if the button is still down.
    pressed |= buttons & BTN_PRIMARY;
  }
  if (b.act === ACT_COOL) {
    if (++b.actTicks < w.swingTicks) return;
    b.act = ACT_NONE;
    // Falls through, so an empty weapon starts its reload on the tick the pause ends, and an automatic one fires again.
  }

  if (w.kind === W_MELEE || (w.kind === W_THROWN && w.drawTicks === 0)) {
    if ((buttons & (BTN_PRIMARY | BTN_MELEE)) !== 0 && usable) {
      b.act = ACT_SWING;
      b.actTicks = 0;
    }
    return;
  }
  if (w.kind === W_THROWN) {
    // A charged throw is held as a bow is drawn.
    if ((buttons & BTN_PRIMARY) !== 0 && usable) {
      b.act = ACT_DRAW;
      b.actTicks = 0;
    }
    return;
  }
  // A bow or a gun. The melee button strikes with its blow, once a press.
  if ((pressed & BTN_MELEE) !== 0 && w.meleeTicks !== undefined && usable) {
    b.act = ACT_SWING;
    b.actTicks = 0;
    return;
  }
  // An empty one reloads by itself if there is anything to reload with.
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
  } else if ((pressed & BTN_PRIMARY) !== 0 || (w.auto === true && (buttons & BTN_PRIMARY) !== 0)) {
    // A gun fires once for each press; an automatic one again each pause while the button is held.
    out.fire = true;
    out.draw = 1;
    b.rounds--;
    b.act = ACT_COOL;
    b.actTicks = 0;
  }
}
