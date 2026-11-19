// Play by touch: two zones and a few buttons, turned into the moves, looks, keys and mouse buttons the rest of the
// client already takes from a keyboard or a pad. The left zone is a stick that appears where a thumb lands; the right
// zone turns the view; a button acts while it is held. Where they stand is client/core/ui/touch.ts, and the shell only
// forwards pointers. Nothing here allocates once made.

/** What the layer drives: the app's own key, mouse, move and look. */
export interface TouchTarget {
  key(code: string, down: boolean): void;
  mouse(button: number, down: boolean): void;
  /** -1..1 each: right, forward. */
  move(x: number, z: number): void;
  /** In CSS pixels, as a mouse moves. */
  look(dx: number, dy: number): void;
}

/** The zones' keys, then a key to a button: KEY_TOUCH_BUTTON + its number. */
export const KEY_ZONE_MOVE = 5600;
export const KEY_ZONE_LOOK = 5601;
export const KEY_TOUCH_BUTTON = 5610;
export const T_ATTACK = 0, T_JUMP = 1, T_AIM = 2, T_STANCE = 3, T_RELOAD = 4, T_USE = 5, T_MENU = 6, T_BAG = 7, T_CHARACTER = 8, T_MAP = 9, T_CLOSE = 10;
/** More turns the cluster to its second page: a blow by hand, the view, the orbit camera and the whistles. */
export const T_MORE = 11, T_MELEE = 12, T_VIEW = 13, T_ORBIT = 14, T_FOLLOW = 15, T_STAY = 16, T_SIC = 17;
/** Building and placing: turn the piece, the next snap (held: free placement), up and down, and leave off. */
export const T_ROTATE = 18, T_SNAP = 19, T_RAISE = 20, T_LOWER = 21, T_CANCEL = 22;
/** Flying and driving: down, a roll or a flight mode, a brake or a recovery, and a way of going held on (precise, agile). */
export const T_DOWN = 23, T_ROLL = 24, T_HOLD = 25, T_SHIFT = 26;
/** The chat box, from the bar. */
export const T_CHAT = 27;
/** Buttons have a bit each in what a frame showed, so there are at most 31. */
export const T_COUNT = 28;

/** Units from the stick's middle to its rim, the still middle, and the share of the way out at which it sprints. */
export const STICK_REACH = 60;
export const STICK_DEAD = 8;
export const SPRINT_AT = 0.92;
/** A finger's pixel turns the view this many times a mouse's: a thumb has a third of a mouse's travel. */
export const LOOK_GAIN = 2.2;
/** A press held this long is a long press. */
export const LONG_MS = 400;

/** What a tap of a button presses for a moment. */
const TAPS: Readonly<Record<number, string>> = {
  [T_MENU]: "Escape", [T_BAG]: "KeyI", [T_CHARACTER]: "KeyP", [T_MAP]: "KeyM", [T_CLOSE]: "Escape", [T_CANCEL]: "Escape", [T_CHAT]: "Enter",
  [T_VIEW]: "KeyV", [T_ORBIT]: "KeyK", [T_FOLLOW]: "KeyJ", [T_STAY]: "KeyU", [T_SIC]: "Period", [T_ROTATE]: "KeyE", [T_RAISE]: "ArrowUp", [T_LOWER]: "ArrowDown",
};
/** What a button holds down while a finger is on it. The same key means what the body's state makes of it: R reloads on foot and yaws a helicopter. */
const HELD: Readonly<Record<number, string>> = { [T_JUMP]: "Space", [T_RELOAD]: "KeyR", [T_USE]: "KeyE", [T_MELEE]: "KeyG", [T_SNAP]: "KeyQ", [T_DOWN]: "ControlLeft", [T_ROLL]: "KeyC", [T_HOLD]: "KeyX" };

export class TouchPlay {
  /** The finger on each zone, as the shell numbers it plus one; 0 for none. */
  private moveFinger = 0;
  private lookFinger = 0;
  /** Where the stick's middle is and where its knob is from there, in units. */
  stickX = 0;
  stickY = 0;
  knobX = 0;
  knobY = 0;
  private lookX = 0;
  private lookY = 0;
  /** Where the finger on Attack was last, which turns the view as it drags. */
  private aimX = 0;
  private aimY = 0;
  private sprinting = false;
  /** Per button: the finger on it, when it went down, and whether its long press has fired. */
  private readonly finger = new Int32Array(T_COUNT);
  private readonly since = new Float64Array(T_COUNT);
  private readonly long = new Uint8Array(T_COUNT);
  /** Aim stays on from one press to the next, and so do the cluster's second page and the way of going that Shift holds. */
  aiming = false;
  more = false;
  shifted = false;
  /** Whether the stick's rim sprints: on foot and on a mount, not at a wheel or a helm, where Shift means something else. */
  rim = true;

  get stick(): boolean { return this.moveFinger !== 0; }
  held(button: number): boolean { return this.finger[button] !== 0; }

  /**
   * A pointer on one of the layer's nodes: `kind` 0 down, 1 up or cancelled, 2 moved, at `x`, `y` in units, by `finger`
   * (the shell's number for it), with `unit` CSS pixels to a unit. False for any other node's key.
   */
  pointer(kind: number, key: number, x: number, y: number, finger: number, nowMs: number, t: TouchTarget, unit: number): boolean {
    const who = finger + 1;
    if (key === KEY_ZONE_MOVE) {
      if (kind === 0 && this.moveFinger === 0) { this.moveFinger = who; this.stickX = x; this.stickY = y; this.knobX = this.knobY = 0; }
      else if (who !== this.moveFinger) return true;
      else if (kind === 1) this.letGo(t);
      else if (kind === 2) this.push(x, y, t);
      return true;
    }
    if (key === KEY_ZONE_LOOK) {
      if (kind === 0 && this.lookFinger === 0) { this.lookFinger = who; this.lookX = x; this.lookY = y; }
      else if (who !== this.lookFinger) return true;
      else if (kind === 1) this.lookFinger = 0;
      else if (kind === 2) this.turn(x, y, t, unit);
      return true;
    }
    const b = key - KEY_TOUCH_BUTTON;
    if (b < 0 || b >= T_COUNT) return false;
    if (kind === 0 && this.finger[b] === 0) {
      this.finger[b] = who; this.since[b] = nowMs; this.long[b] = 0;
      if (b === T_ATTACK) { t.mouse(0, true); this.aimX = x; this.aimY = y; }
      else if (b === T_AIM) t.mouse(2, (this.aiming = !this.aiming));
      else if (b === T_MORE) this.more = !this.more;
      else if (b === T_SHIFT) t.key("ShiftLeft", (this.shifted = !this.shifted));
      else if (HELD[b]) t.key(HELD[b]!, true);
      else if (TAPS[b]) { t.key(TAPS[b]!, true); t.key(TAPS[b]!, false); }
    } else if (who !== this.finger[b]) return true;
    else if (kind === 2 && b === T_ATTACK) {
      t.look((x - this.aimX) * unit * LOOK_GAIN, (y - this.aimY) * unit * LOOK_GAIN);
      this.aimX = x; this.aimY = y;
    }
    else if (kind === 1) this.lift(b, t, false);
    return true;
  }

  /** Each frame: long presses fire, and a button no longer `shown` (bit `1 << button`) lets go of what it held. */
  frame(nowMs: number, shown: number, t: TouchTarget): void {
    for (let b = 0; b < T_COUNT; b++) {
      if (this.finger[b] === 0) continue;
      if ((shown & (1 << b)) === 0) this.lift(b, t, true);
      else if (b === T_STANCE && !this.long[b] && nowMs - this.since[b]! >= LONG_MS) { this.long[b] = 1; t.key("KeyX", true); t.key("KeyX", false); }
    }
    if (this.aiming && (shown & (1 << T_AIM)) === 0) t.mouse(2, (this.aiming = false));
    if (this.shifted && (shown & (1 << T_SHIFT)) === 0) t.key("ShiftLeft", (this.shifted = false));
    if (this.more && (shown & (1 << T_MORE)) === 0) this.more = false;
  }

  /** Forgets every finger, as the controls forget every key (App.blur): a menu opened, or the page lost its focus. */
  reset(): void {
    this.moveFinger = this.lookFinger = 0;
    this.knobX = this.knobY = 0;
    this.sprinting = this.aiming = this.shifted = this.more = false;
    this.finger.fill(0);
  }

  private lift(b: number, t: TouchTarget, gone: boolean): void {
    this.finger[b] = 0;
    if (b === T_ATTACK) t.mouse(0, false);
    else if (HELD[b]) t.key(HELD[b]!, false);
    // A short press crouches or stands; the long one has already lain down.
    else if (b === T_STANCE && !gone && !this.long[b]) { t.key("KeyC", true); t.key("KeyC", false); }
  }

  private push(x: number, y: number, t: TouchTarget): void {
    let dx = x - this.stickX, dy = y - this.stickY;
    const far = Math.hypot(dx, dy);
    if (far > STICK_REACH) {
      // The middle follows a thumb that has gone past the rim, so turning back answers at once.
      this.stickX += (dx / far) * (far - STICK_REACH); this.stickY += (dy / far) * (far - STICK_REACH);
      dx = (dx / far) * STICK_REACH; dy = (dy / far) * STICK_REACH;
    }
    this.knobX = dx; this.knobY = dy;
    const out = Math.min(far, STICK_REACH), push = out <= STICK_DEAD ? 0 : (out - STICK_DEAD) / (STICK_REACH - STICK_DEAD);
    t.move(push > 0 ? (dx / out) * push : 0, push > 0 ? ((0 - dy) / out) * push : 0);
    const sprint = this.rim && out >= STICK_REACH * SPRINT_AT;
    if (sprint !== this.sprinting) t.key("ShiftLeft", (this.sprinting = sprint));
  }

  private letGo(t: TouchTarget): void {
    this.moveFinger = 0;
    this.knobX = this.knobY = 0;
    t.move(0, 0);
    if (this.sprinting) t.key("ShiftLeft", (this.sprinting = false));
  }

  private turn(x: number, y: number, t: TouchTarget, unit: number): void {
    t.look((x - this.lookX) * unit * LOOK_GAIN, (y - this.lookY) * unit * LOOK_GAIN);
    this.lookX = x; this.lookY = y;
  }
}
