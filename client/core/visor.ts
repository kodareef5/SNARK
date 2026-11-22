// The Meridian helmet's visor (D1033): held up with the middle button, it magnifies by its glass to VISOR_GLASS times and
// past that makes the picture larger, as far as its optic's most; the wheel steps the zoom and N its view: plain, night
// or heat (D1034), in which a body shows as hot as its kind is, the world cold but where the sun has lit it, through no air.
// Night vision amplifies the light by more the darker the hour, so by day it does not white out, as ARK's Tek helmet's
// does not; its grain is heavier in the dark, and a picture made larger past the glass is grainier the further it goes.

import type { OpticFacet } from "../../shared/content/defs.ts";
import { opticMost } from "./optics.ts";
import { OPTIC_HEAT, OPTIC_NIGHT, OPTIC_NONE } from "./render/packet.ts";
import type { Optic } from "./render/post.ts";

/** The zoom a visor first comes up at, and how much a step of the wheel takes it. */
export const VISOR_FIRST = 4;
export const VISOR_STEP = 1.25;
/** The most its glass magnifies; past it the picture is made larger, not finer (digital zoom). */
export const VISOR_GLASS = 25;
/** How many times night vision amplifies the light at night (by day, none), and its grain then. */
export const NIGHT_GAIN = 6;
export const NIGHT_GRAIN = 0.03;
/** The grain of a picture made larger, at forty times past the glass. */
export const DIGITAL_GRAIN = 0.05;
/** The heat view's sensor grain. */
export const HEAT_GRAIN = 0.02;

export class Visor {
  /** The middle button, a pad's or the touch button, held. */
  held = false;
  /** Raised this frame. */
  up = false;
  zoom = VISOR_FIRST;
  mode = OPTIC_NONE;
  /** Metres to what the middle of the view is on, 0 for nothing found. */
  range = 0;

  /**
   * Raises the visor for this frame where it is held, `optic` is the worn helmet's and `can` says nothing stands in the way
   * (a body on foot, its helmet working, no sight aimed through), and holds its zoom to the optic's. Returns `up`.
   */
  step(optic: OpticFacet | null, can: boolean): boolean {
    this.up = this.held && can && optic !== null;
    if (optic) this.zoom = Math.min(opticMost(optic), Math.max(optic.min, this.zoom));
    return this.up;
  }

  /** `notches` of the wheel, down (positive) to widen and up to narrow, within `optic`'s zoom. */
  wheel(optic: OpticFacet, notches: number): void {
    this.zoom = Math.min(opticMost(optic), Math.max(optic.min, this.zoom * VISOR_STEP ** -notches));
  }

  /** N: plain, night, heat, and plain again. */
  cycle(): void {
    this.mode = this.mode === OPTIC_NONE ? OPTIC_NIGHT : this.mode === OPTIC_NIGHT ? OPTIC_HEAT : OPTIC_NONE;
  }

  /** Past its glass, the picture is made larger. */
  get digital(): boolean {
    return this.zoom > VISOR_GLASS;
  }

  /** Writes what the visor does to the picture into `out` (post.ts opticFrame), `day` 1 in daylight and 0 at night (laser.ts daylight). */
  frame(out: Optic, day: number): void {
    const up = this.up;
    const night = up && this.mode === OPTIC_NIGHT, heat = up && this.mode === OPTIC_HEAT;
    out.mode = night ? OPTIC_NIGHT : heat ? OPTIC_HEAT : OPTIC_NONE;
    out.gain = night ? 1 + (NIGHT_GAIN - 1) * (1 - day) : 1;
    const past = up && this.digital ? Math.min(1, Math.log(this.zoom / VISOR_GLASS) / Math.log(40)) : 0;
    out.grain = (night ? NIGHT_GRAIN : heat ? HEAT_GRAIN : 0) + DIGITAL_GRAIN * past;
  }
}
