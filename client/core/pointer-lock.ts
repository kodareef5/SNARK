// When the shell takes the mouse and when it gives it back. The first click on the world engages the rule; from then
// on, leaving a screen, the dock or chat by key or by click takes the mouse back with no second click.

export const LOCK_KEEP = 0;
export const LOCK_TAKE = 1;
export const LOCK_FREE = 2;
/** The error's name where a browser has no raw mouse movement to give (`unadjustedMovement`). */
export const RAW_REFUSED = "NotSupportedError";

export class LockRule {
  /** A click on the world has asked for the mouse since the browser last refused it. */
  engaged = false;
  /** A request is out and not yet answered. */
  pending = false;

  /** A primary mouse click on the world. */
  click(): void { this.engaged = true; }

  /**
   * The browser refused the lock. True where it refused only the mouse's raw movement (`raw` was asked and `name` is the
   * error's): the lock is then asked for again without it. Otherwise only a new click on the world asks again.
   */
  refused(raw = false, name?: string): boolean {
    if (raw && name === RAW_REFUSED) return true;
    this.engaged = false;
    return false;
  }

  /** What to do now that the interface `wants` the mouse or not and the page holds it or not. */
  step(wants: boolean, locked: boolean): number {
    if (wants && !locked && this.engaged && !this.pending) return LOCK_TAKE;
    if (!wants && locked) return LOCK_FREE;
    return LOCK_KEEP;
  }
}

/** The lock was lost by Escape, with the body played and nothing asking for the mouse: the menu opens. */
export const LOST_ESCAPE = 0;
/** A screen that keeps the field took the mouse, as the dock does: only the mouse's held buttons let go. */
export const LOST_TO_FIELD = 1;
/** Another screen took the mouse: every held input lets go. */
export const LOST_TO_SCREEN = 2;

/** What a lost lock means, from whether the interface `wants` the mouse and whether the body is still `playing`. */
export function lostLock(wants: boolean, playing: boolean): number {
  return wants ? LOST_ESCAPE : playing ? LOST_TO_FIELD : LOST_TO_SCREEN;
}
