// Keyboard and mouse to the input sample the session consumes. Pointer lock for
// mouse look; touch controls are not implemented yet.

import { BTN_JUMP, BTN_SPRINT } from "../../shared/sim/character.ts";

export class Input {
  moveX = 0;
  moveZ = 0;
  yaw = 0;
  pitch = 0;
  buttons = 0;
  private readonly keys = new Set<string>();

  constructor(target: HTMLElement) {
    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
    target.addEventListener("click", () => void target.requestPointerLock());
    addEventListener("mousemove", (e) => {
      if (document.pointerLockElement !== target) return;
      // Facing +Z, right is -X: turning right lowers yaw.
      this.yaw -= e.movementX * 0.0025;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0025));
    });
  }

  sample(): void {
    const k = this.keys;
    this.moveX = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    this.moveZ = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    this.buttons = (k.has("Space") ? BTN_JUMP : 0) | (k.has("ShiftLeft") ? BTN_SPRINT : 0);
  }
}
