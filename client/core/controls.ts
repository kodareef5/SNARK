// Turns keys and mouse into the input sample the session consumes. The shell forwards raw events.

import { BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

/** Radians of turn per pixel of mouse movement. */
export const LOOK_SPEED = 0.0025;
const PITCH_LIMIT = 1.5;

const BINDINGS: Record<string, number> = { Space: BTN_JUMP, ShiftLeft: BTN_SPRINT, KeyE: BTN_USE, KeyR: BTN_RELOAD, KeyG: BTN_MELEE, KeyN: BTN_MOD };
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
/** A press toggles the stance. */
const STANCE_KEYS: Record<string, number> = { KeyC: BTN_CROUCH, KeyX: BTN_PRONE };
const MOUSE: readonly number[] = [BTN_PRIMARY, 0, BTN_SECONDARY];

export class Controls {
  /** -1..1: strafe right, walk forward. */
  moveX = 0;
  moveZ = 0;
  /** Radians. Yaw 0 faces +Z. Positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  buttons = 0;
  /** Scales LOOK_SPEED. It is the player's sensitivity, reduced while the view is narrowed to aim. */
  zoom = 1;
  private readonly held = new Set<string>();
  private mouse = 0;
  /** BTN_CROUCH, BTN_PRONE or 0. The bit is sent every tick while the stance is wanted. */
  private stance = 0;

  /** Returns true if the key is bound. */
  key(code: string, down: boolean): boolean {
    const stance = STANCE_KEYS[code];
    if (stance !== undefined) {
      // The held set swallows key repeats, so holding the key toggles once.
      if (down && !this.held.has(code)) this.stance = this.stance === stance ? 0 : stance;
    } else if (!MOVE_KEYS.has(code) && BINDINGS[code] === undefined) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    // From a stance, jump stands the body up and is not sent as a jump. Sprint stands a crouched body up.
    if (down && this.stance !== 0 && (code === "Space" || (code === "ShiftLeft" && this.stance === BTN_CROUCH))) {
      this.stance = 0;
      if (code === "Space") this.held.delete(code);
    }
    this.refresh();
    return true;
  }

  mouseButton(button: number, down: boolean): void {
    const bit = MOUSE[button] ?? 0;
    if (bit === 0) return;
    this.mouse = down ? this.mouse | bit : this.mouse & ~bit;
    this.refresh();
  }

  /** In pixels. */
  look(dx: number, dy: number): void {
    // Facing +Z, right is -X, so turning right lowers yaw.
    this.yaw -= dx * LOOK_SPEED * this.zoom;
    const p = this.pitch - dy * LOOK_SPEED * this.zoom;
    this.pitch = p < -PITCH_LIMIT ? -PITCH_LIMIT : p > PITCH_LIMIT ? PITCH_LIMIT : p;
  }

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
