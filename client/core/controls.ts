// Keys and mouse to the input sample the session consumes. The shell forwards
// raw events; which key does what is decided here, where it can be tested.

import { BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

/** Radians of turn per pixel of mouse movement. */
export const LOOK_SPEED = 0.0025;
const PITCH_LIMIT = 1.5;

const BINDINGS: Record<string, number> = { Space: BTN_JUMP, ShiftLeft: BTN_SPRINT, KeyE: BTN_USE, KeyR: BTN_RELOAD, KeyF: BTN_MELEE, KeyN: BTN_MOD };
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
/** Pressing one of these changes how low the body holds itself; pressing it again stands it up. */
const STANCE_KEYS: Record<string, number> = { KeyC: BTN_CROUCH, KeyX: BTN_PRONE };
const MOUSE: readonly number[] = [BTN_PRIMARY, 0, BTN_SECONDARY];

export class Controls {
  /** -1..1: strafe right, walk forward. */
  moveX = 0;
  moveZ = 0;
  /** Radians. Yaw 0 faces +Z; positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  buttons = 0;
  /** How much of its usual turn a pixel of mouse movement gives: below 1 while the view is narrowed to aim. */
  zoom = 1;
  private readonly held = new Set<string>();
  private mouse = 0;
  /** BTN_CROUCH, BTN_PRONE or 0: the stance asked for, sent for as long as it is wanted. */
  private stance = 0;

  /** A key went down or up. Returns true if it is bound to something. */
  key(code: string, down: boolean): boolean {
    const stance = STANCE_KEYS[code];
    if (stance !== undefined) {
      // A press toggles; the key may be let go. Holding it does not repeat (the held set swallows repeats).
      if (down && !this.held.has(code)) this.stance = this.stance === stance ? 0 : stance;
    } else if (!MOVE_KEYS.has(code) && BINDINGS[code] === undefined) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    // Jumping or sprinting is a wish to be on one's feet: it stands the body up instead.
    if (down && this.stance !== 0 && (code === "Space" || (code === "ShiftLeft" && this.stance === BTN_CROUCH))) {
      this.stance = 0;
      if (code === "Space") this.held.delete(code);
    }
    this.refresh();
    return true;
  }

  /** Mouse button 0 is the primary action, button 2 the secondary. */
  mouseButton(button: number, down: boolean): void {
    const bit = MOUSE[button] ?? 0;
    if (bit === 0) return;
    this.mouse = down ? this.mouse | bit : this.mouse & ~bit;
    this.refresh();
  }

  /** Mouse movement in pixels while it steers the camera. */
  look(dx: number, dy: number): void {
    // Facing +Z, right is -X: turning right lowers yaw.
    this.yaw -= dx * LOOK_SPEED * this.zoom;
    const p = this.pitch - dy * LOOK_SPEED * this.zoom;
    this.pitch = p < -PITCH_LIMIT ? -PITCH_LIMIT : p > PITCH_LIMIT ? PITCH_LIMIT : p;
  }

  /** Let go of everything: the window lost focus, or a text field took the keyboard. */
  release(): void {
    this.held.clear();
    this.mouse = 0;
    this.refresh();
  }

  private refresh(): void {
    const k = this.held;
    this.moveX = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    this.moveZ = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    let buttons = this.mouse | this.stance;
    for (const code of k) buttons |= BINDINGS[code] ?? 0;
    this.buttons = buttons;
  }
}
