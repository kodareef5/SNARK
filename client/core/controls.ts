// Turns keys and mouse into the input sample the session consumes. The shell forwards raw events.

import { BTN_BRAKE, BTN_CROUCH, BTN_JUMP, BTN_MELEE, BTN_MOD, BTN_PRIMARY, BTN_PRONE, BTN_RELOAD, BTN_ROLL, BTN_SECONDARY, BTN_SPRINT, BTN_USE } from "../../shared/sim/character.ts";

/** Radians of turn per pixel of mouse movement. */
export const LOOK_SPEED = 0.0025;
const PITCH_LIMIT = 1.5;

const BINDINGS: Record<string, number> = { Space: BTN_JUMP, ShiftLeft: BTN_SPRINT, KeyE: BTN_USE, KeyR: BTN_RELOAD, KeyG: BTN_MELEE, KeyN: BTN_MOD };
/** Driving a flyer, ARK's keys: Space takes off and lands (the wing, below), and C rolls and X brakes while held. */
const FLYER_BINDINGS: Record<string, number> = { ...BINDINGS, Space: 0, KeyC: BTN_ROLL, KeyX: BTN_BRAKE };
const HELICOPTER_BINDINGS: Record<string, number> = { Space: BTN_JUMP, ControlLeft: BTN_CROUCH, ControlRight: BTN_CROUCH, ShiftLeft: BTN_SPRINT, ShiftRight: BTN_SPRINT, KeyE: BTN_USE, KeyQ: BTN_PRIMARY, KeyR: BTN_SECONDARY, KeyX: BTN_PRONE, KeyC: 0 };
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
/** A press toggles the stance. */
const STANCE_KEYS: Record<string, number> = { KeyC: BTN_CROUCH, KeyX: BTN_PRONE };
/** Ticks a press of the glider's key is held for the step to sample. */
const GLIDE_PULSE = 2;
const MOUSE: readonly number[] = [BTN_PRIMARY, 0, BTN_SECONDARY];

export class Controls {
  /** The keys the body or vehicle being driven now takes as buttons. A key one claims is no one else's (client/core/app.ts). */
  bindings(): Record<string, number> {
    return this.helicopter ? HELICOPTER_BINDINGS : this.flyer ? FLYER_BINDINGS : BINDINGS;
  }

  /** Whether what is driven now takes `code` as one of its buttons. */
  binds(code: string): boolean {
    return this.bindings()[code] !== undefined;
  }

  /** -1..1: strafe right, walk forward. */
  moveX = 0;
  moveZ = 0;
  /** Radians. Yaw 0 faces +Z. Positive pitch looks up. */
  yaw = 0;
  pitch = 0;
  buttons = 0;
  /** Scales LOOK_SPEED. It is the player's sensitivity, reduced while the view is narrowed to aim. */
  zoom = 1;
  /**
   * While driving a flyer: whether it is wanted in the air. Space toggles it, as C and X toggle the stances on foot, and
   * jump is sent every tick it is on, since a flyer stays up only while its jump is held (D496).
   */
  wing = false;
  private flyer = false;
  private helicopter = false;
  /**
   * On foot in the air with a glider carried (planning/workstreams/glider.md): C is the glider's key, not a stance, and no
   * stance is sent. A press is held until the step has had GLIDE_PULSE ticks to see it, so a tap that comes and goes between
   * two frames, as a touch button's and a pad's do, is not lost.
   */
  private gliding = false;
  private glideUntil = -1;
  private tick = 0;

  /** Call it each frame with the tick the prediction has reached. */
  glider(on: boolean, tick: number): void {
    this.tick = tick;
    const over = this.glideUntil >= 0 && tick > this.glideUntil;
    if (on === this.gliding && !over) return;
    if (over || !on) this.glideUntil = -1;
    // A stance chosen on the ground is not kept through a fall.
    if (on && !this.gliding) this.stance = 0;
    this.gliding = on;
    this.refresh();
  }
  /** Direct control uses the same rotor physics with body-rate cyclic and held collective. */
  directFlight = false;

  heli(on: boolean): void {
    if (on === this.helicopter) return;
    this.helicopter = on; this.directFlight = false; this.stance = 0; this.wing = false;
    this.held.clear(); this.padHeld.clear(); this.mouse = this.padMouse = 0; this.refresh();
  }
  private readonly held = new Set<string>();
  private readonly padHeld = new Set<string>();
  private mouse = 0;
  private padMouse = 0;
  private analogX = 0;
  private analogZ = 0;
  /** The touch stick's, apart from the pad's: a pad not there sends its stick at rest every frame. */
  private touchX = 0;
  private touchZ = 0;
  /** BTN_CROUCH, BTN_PRONE or 0. The bit is sent every tick while the stance is wanted. */
  private stance = 0;
  get onFlyer(): boolean { return this.flyer; }

  /**
   * Gives Space, C and X their flying meaning while `on` (driving a flyer), and back again once off. `aloft` says whether
   * the flyer is in the air as it is taken over, so a mount found on the ground stays there until Space (ASE 312.65).
   */
  fly(on: boolean, aloft: boolean): void {
    this.flyer = on;
    this.wing = on && aloft;
    // A stance chosen on foot would be a roll held for good.
    this.stance = 0;
    this.refresh();
  }

  /** The flyer has come down, or would not go up: jump is no longer sent, so it does not rise again by itself once able. */
  land(): void {
    if (!this.wing) return;
    this.wing = false;
    this.refresh();
  }

  /** Returns true if the key is bound. */
  key(code: string, down: boolean, source = 0): boolean {
    const held = source === 1 ? this.padHeld : this.held;
    const stance = this.flyer || this.helicopter ? undefined : STANCE_KEYS[code];
    if (this.helicopter && code === "KeyC") {
      if (down && !held.has(code)) this.directFlight = !this.directFlight;
    } else if (this.gliding && stance !== undefined) {
      // Neither stance is taken in the air under a glider, and C throws it open or folds it.
      if (down && !held.has(code) && code === "KeyC") this.glideUntil = this.tick + GLIDE_PULSE;
    } else if (stance !== undefined) {
      // The held set swallows key repeats, so holding the key toggles once.
      if (down && !held.has(code)) this.stance = this.stance === stance ? 0 : stance;
    } else if (this.flyer && code === "Space") {
      if (down && !held.has(code)) this.wing = !this.wing;
    } else if (!MOVE_KEYS.has(code) && this.bindings()[code] === undefined) return false;
    if (down) held.add(code);
    else held.delete(code);
    // From a stance, jump stands the body up and is not sent as a jump. Sprint stands a crouched body up.
    if (down && this.stance !== 0 && (code === "Space" || (code === "ShiftLeft" && this.stance === BTN_CROUCH))) {
      this.stance = 0;
      if (code === "Space") held.delete(code);
    }
    this.refresh();
    return true;
  }

  mouseButton(button: number, down: boolean, source = 0): void {
    const bit = this.helicopter ? 0 : MOUSE[button] ?? 0;
    if (bit === 0) return;
    if (source === 1) this.padMouse = down ? this.padMouse | bit : this.padMouse & ~bit;
    else this.mouse = down ? this.mouse | bit : this.mouse & ~bit;
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
    this.padHeld.clear();
    this.mouse = 0;
    this.padMouse = this.analogX = this.analogZ = this.touchX = this.touchZ = 0;
    this.refresh();
  }

  touchMove(x: number, z: number): void {
    this.touchX = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
    this.touchZ = Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0;
    this.refresh();
  }

  padMove(x: number, z: number): void {
    this.analogX = Number.isFinite(x) ? Math.max(-1, Math.min(1,x)) : 0;
    this.analogZ = Number.isFinite(z) ? Math.max(-1, Math.min(1,z)) : 0;
    this.refresh();
  }

  private refresh(): void {
    const k = this.held;
    this.moveX = Math.max(-1,Math.min(1,(k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0) + this.analogX + this.touchX));
    this.moveZ = Math.max(-1,Math.min(1,(k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0) + this.analogZ + this.touchZ));
    let buttons = this.mouse | this.padMouse | this.stance | (this.wing ? BTN_JUMP : 0) | (this.helicopter && this.directFlight ? BTN_MOD : 0);
    if (this.gliding && (this.glideUntil >= 0 || k.has("KeyC") || this.padHeld.has("KeyC"))) buttons |= BTN_CROUCH;
    const bindings = this.bindings();
    for (const code of k) buttons |= bindings[code] ?? 0;
    for (const code of this.padHeld) buttons |= bindings[code] ?? 0;
    this.buttons = buttons;
  }
}
