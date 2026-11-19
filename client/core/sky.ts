// The hour the sky shows. It is the server's hour, except that a change of hour sweeps instead of jumping on a server that
// shows creative mode, and an admin turning the sundial sees the hour in their hand at once, before the server has it.

import { cycleTicks, dayTickOfHour, hourOfDay, type ClockScales } from "../../shared/sim/clock.ts";

/** Milliseconds a set hour takes to sweep about two thirds of the way: about a step of a turn told at 10 a second. */
export const SWEEP_MS = 120;
/** And to follow the hour in the admin's own hand. */
export const HELD_MS = 50;
/** Ticks of difference below which the sweep is over. */
const SETTLED = 0.5;

export class SkyClock {
  /** The offset shown, in ticks within one cycle. NaN before the first step. */
  private shown = NaN;
  private tick = 0;
  /** Hours since midnight, as the sky shows them. */
  hour = 0;
  /** The hour moved this step by a setting or a turn, not by the clock running. The dawn and dusk stingers keep quiet. */
  turned = false;

  /**
   * `offset` is the server's (the session's dayOffset), and `held` an hour the admin's hand holds, or NaN. Without `sweep` the
   * server's hour is shown as it comes, as before creative mode.
   */
  step(tick: number, offset: number, c: ClockScales, dtMs: number, held = NaN, sweep = true): number {
    const cycle = cycleTicks(c);
    const holding = !Number.isNaN(held);
    const target = wrap(holding ? dayTickOfHour(held, c) - tick : offset, cycle);
    if (Number.isNaN(this.shown) || (!sweep && !holding)) {
      this.turned = false;
      this.shown = target;
    } else {
      // A held hour stands still while the clock runs, so the hour shown follows only the hand.
      if (holding) this.shown = wrap(this.shown - (tick - this.tick), cycle);
      // The short way round, so a turn across midnight does not run the whole day back.
      let d = wrap(target - this.shown, cycle);
      if (d > cycle / 2) d -= cycle;
      this.turned = holding || Math.abs(d) >= SETTLED;
      this.shown = Math.abs(d) < SETTLED ? target : wrap(this.shown + d * (1 - Math.exp(-Math.max(0, dtMs) / (holding ? HELD_MS : SWEEP_MS))), cycle);
    }
    this.tick = tick;
    this.hour = hourOfDay(wrap(tick, cycle), this.shown, c);
    return this.hour;
  }
}

function wrap(t: number, cycle: number): number {
  const r = t % cycle;
  return r < 0 ? r + cycle : r;
}
