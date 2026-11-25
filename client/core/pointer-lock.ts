// When the shell takes the mouse and when it gives it back. The first click on the world engages the rule; from then
// on, leaving a screen, the dock or chat by key or by click takes the mouse back with no second click.

export const LOCK_KEEP = 0;
export const LOCK_TAKE = 1;
export const LOCK_FREE = 2;

export class LockRule {
  /** A click on the world has asked for the mouse since the browser last refused it. */
  engaged = false;
  /** A request is out and not yet answered. */
  pending = false;

  /** A primary mouse click on the world. */
  click(): void { this.engaged = true; }

  /** The browser refused the lock: only a new click on the world asks again. */
  refused(): void { this.engaged = false; }

  /** What to do now that the interface `wants` the mouse or not and the page holds it or not. */
  step(wants: boolean, locked: boolean): number {
    if (wants && !locked && this.engaged && !this.pending) return LOCK_TAKE;
    if (!wants && locked) return LOCK_FREE;
    return LOCK_KEEP;
  }
}
