// Standard gamepad samples become existing actions. No browser types or device access live here.

export interface PadSample {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}
export interface PadTarget {
  readonly inMenu: boolean;
  readonly inspecting: boolean;
  readonly heldSlot: number;
  key(code: string, down: boolean): void;
  mouse(button: number, down: boolean): void;
  move(x: number, z: number): void;
  look(x: number, y: number): void;
  /** Press is 0 for navigation, 1 for down and 2 for up, so inventory dragging works with a held A button. */
  navigate(direction: number, press: number): void;
  used(): void;
}
export const PAD_KEYS: Readonly<Record<number, string>> = { 0:"Space", 1:"KeyC", 2:"KeyE", 3:"KeyR", 8:"KeyI", 9:"Escape", 10:"ShiftLeft", 11:"KeyV", 12:"KeyH" };
export const PAD_DEAD_ZONE = .18;

export function padAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const v = Math.min(1, Math.abs(value));
  return v <= PAD_DEAD_ZONE ? 0 : Math.sign(value) * (v - PAD_DEAD_ZONE) / (1 - PAD_DEAD_ZONE);
}

export class GamepadInput {
  private readonly previous = new Uint8Array(17);
  private readonly active = new Set<string>();
  private readonly mouse = new Set<number>();
  private last = -1;
  private repeatAt = 0;
  private menu = false;
  private selecting = false;

  update(pads: readonly (PadSample | null)[], now: number, target: PadTarget): void {
    const pad = pads.find(p=>p?.connected && p.mapping === "standard");
    const dt = this.last < 0 ? 0 : Math.min(50, Math.max(0, now - this.last)); this.last = now;
    // Retain the last button edges through focus loss/disconnection. A trigger still held on return must be released first.
    if (!pad) { this.release(target); return; }
    if (target.inMenu !== this.menu) { this.release(target, target.inspecting); this.menu = target.inMenu; }
    const x = padAxis(pad.axes[0] ?? 0), z = -padAxis(pad.axes[1] ?? 0), yaw = padAxis(pad.axes[2] ?? 0), pitch = padAxis(pad.axes[3] ?? 0);
    if (x || z || yaw || pitch) target.used();
    target.move(target.inMenu ? 0 : x, target.inMenu ? 0 : z);
    if (!target.inMenu) target.look(yaw * dt * .65, pitch * dt * .65);
    if (target.inMenu && Math.abs(z) > .5 && now >= this.repeatAt) { target.navigate(z > 0 ? -1 : 1, 0); this.repeatAt = now + 180; }
    if (Math.abs(z) <= .5) this.repeatAt = 0;
    for (let i = 0; i < this.previous.length; i++) {
      const button = pad.buttons[i], down = !!button && (button.pressed || button.value > .55), was = this.previous[i] === 1;
      this.previous[i] = down ? 1 : 0;
      if (down === was) continue;
      if (!down) {
        if (i === 0 && this.selecting) { target.navigate(0, 2); this.selecting = false; }
        const key = PAD_KEYS[i]; if (key && this.active.delete(key)) target.key(key, false);
        const mouse = i === 6 ? 2 : i === 7 ? 0 : -1; if (this.mouse.delete(mouse)) target.mouse(mouse, false);
        continue;
      }
      target.used();
      if (i === 9) { target.key("Escape", true); target.key("Escape", false); continue; }
      if (target.inMenu) {
        if (i === 0) { this.selecting = true; target.navigate(0, 1); }
        else if (i === 1 || i === 8) { target.key("Escape", true); target.key("Escape", false); }
        else if (i >= 12 && i <= 15) target.navigate(i === 12 || i === 14 ? -1 : 1, 0);
        continue;
      }
      if (i === 4 || i === 5 || i === 14 || i === 15) {
        const by = i === 4 || i === 14 ? -1 : 1;
        const slot = ((target.heldSlot < 0 ? (by > 0 ? 9 : 0) : target.heldSlot) + by + 10) % 10;
        const key = `Digit${(slot + 1) % 10}`; target.key(key, true); target.key(key, false);
      } else if (i === 6 || i === 7) { const mouse = i === 6 ? 2 : 0; this.mouse.add(mouse); target.mouse(mouse, true); }
      else if (PAD_KEYS[i]) { const key = PAD_KEYS[i]!; this.active.add(key); target.key(key, true); }
    }
  }

  private release(target: PadTarget, keepInspect = false): void {
    for (const key of this.active) if (!keepInspect || key !== "KeyH") { target.key(key, false); this.active.delete(key); }
    for (const button of this.mouse) target.mouse(button, false);
    if (this.selecting) { target.navigate(0, 2); this.selecting = false; }
    this.mouse.clear(); target.move(0,0);
  }
}
