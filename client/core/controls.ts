// Keys and mouse to the input sample the session consumes. The shell forwards
// raw events; which key does what is decided here, where it can be tested.

import { BTN_JUMP, BTN_PRIMARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

/** Radians of turn per pixel of mouse movement. */
export const LOOK_SPEED = 0.0025;
const PITCH_LIMIT = 1.5;

const BINDINGS: Record<string, number> = { Space: BTN_JUMP, ShiftLeft: BTN_SPRINT, KeyE: BTN_USE };
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export class Controls {
  /** -1..1: strafe right, walk forward. */
  moveX = 0;
  moveZ = 0;
  /** Radians. Yaw 0 faces +Z; positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  buttons = 0;
  private readonly held = new Set<string>();
  private mouse = 0;

  /** A key went down or up. Returns true if it is bound to something. */
  key(code: string, down: boolean): boolean {
    if (!MOVE_KEYS.has(code) && BINDINGS[code] === undefined) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.refresh();
    return true;
  }

  /** Mouse button 0 is the primary action. */
  mouseButton(button: number, down: boolean): void {
    if (button !== 0) return;
    this.mouse = down ? BTN_PRIMARY : 0;
    this.refresh();
  }

  /** Mouse movement in pixels while it steers the camera. */
  look(dx: number, dy: number): void {
    // Facing +Z, right is -X: turning right lowers yaw.
    this.yaw -= dx * LOOK_SPEED;
    const p = this.pitch - dy * LOOK_SPEED;
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
    let buttons = this.mouse;
    for (const code of k) buttons |= BINDINGS[code] ?? 0;
    this.buttons = buttons;
  }
}
