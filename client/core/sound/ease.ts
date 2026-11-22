// The one way the world's sound device moves a level a player hears (planning/workstreams/sound-engine.md, "Every level
// eased"): on the audio clock, from where the level is, never in a step. client/sound/sound.ts moves its volumes through it.

/** How far ahead of the audio clock an eased move begins, so the audio thread has not passed it. */
const EASE_AHEAD = 0.005;

/** What of an AudioParam `ease` uses. */
export interface EasedParam {
  cancelScheduledValues(time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, constant: number): unknown;
  cancelAndHoldAtTime?(time: number): unknown;
}

/** The last move `ease` laid on each parameter, from which a browser that cannot hold a parameter where it is (Firefox) is told where it is. */
const eased = new WeakMap<EasedParam, { from: number; to: number; at: number; constant: number }>();

/**
 * Moves a level the player hears to `to` over about `seconds` on the audio clock, never in a step: what was scheduled is
 * cancelled with the present value held, then it heads for `to` with a time constant of a fifth of `seconds`, 5 ms ahead
 * of the clock's `now`. The one way the device moves the volumes (planning/workstreams/sound-engine.md, "Every level
 * eased").
 */
export function ease(param: EasedParam, to: number, seconds: number, now: number): void {
  const at = now + EASE_AHEAD, last = eased.get(param);
  const from = !last ? 0 : at <= last.at ? last.from : last.to + (last.from - last.to) * Math.exp(-(at - last.at) / last.constant);
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
  else {
    param.cancelScheduledValues(at);
    param.setValueAtTime(from, at);
  }
  const constant = Math.max(seconds, 0.001) / 5;
  param.setTargetAtTime(to, at, constant);
  eased.set(param, { from, to, at, constant });
}
