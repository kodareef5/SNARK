// A screen is one file and one row in SCREENS (screens-list.ts): its state, when it is up, what it holds, its keys,
// what it draws and what it does with a press. `Ui` walks the list; it names no screen that has moved here.

import type { Registry } from "../../../shared/content/registry.ts";
import type { GuideWords } from "../key-row.ts";
import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import type { Settings } from "../settings.ts";
import type { UiFrame } from "./nodes.ts";

/** What a screen reads as it builds and as it is pressed. `Ui` keeps one and sets it before each call. */
export interface ScreenCtx {
  session: ClientSession | null;
  registry: Registry | null;
  palette: Uint8Array | null;
  /** Null until the first build. */
  hud: HudModel | null;
  readonly settings: Settings;
  /** The node with the menu's focus. */
  focus: number;
  /** 0 the keyboard and mouse, 1 a pad, 2 a finger. */
  inputDevice: number;
  /** In a press, 0 for a mouse, else the touch's own number. */
  finger: number;
  /** Plays an occasion of the interface by its cue (shared/sound/cues.ts). */
  hear(cue: string): void;
}

/** Why every screen is told to let go. */
export type ScreenReset = "dead" | "creating";

export interface Screen {
  readonly name: string;
  /**
   * "modal": a screen over the world, of which the first open one in the list is built. "over": built over whichever
   * modal screen is up, as a prompt is.
   */
  readonly layer: "modal" | "over";
  /** Screens of one group close each other as one opens, and Escape closes them. "bag" is the inventory, map, character and settings. */
  readonly group?: string;
  /** The key that opens and closes it from play, with the others of its group shut. */
  readonly hotkey?: string;
  /** The node keys it uses, each band from `from` for `count`: no two screens' bands may meet (tests/ui/screens.test.ts). */
  readonly bands: readonly { readonly from: number; readonly count: number }[];
  /** Whether it is up this frame. */
  isOpen(): boolean;
  /** Each frame, open or not, before any screen builds: a screen the session opens reads the session here. */
  absorb?(c: ScreenCtx): void;
  /** Brings it up by its hotkey. Without one only its own file opens it. */
  show?(c: ScreenCtx): void;
  close(c: ScreenCtx): void;
  /** While open, the mouse stays with the camera. Without it an open screen frees the pointer. */
  keepsPointer?: boolean;
  /** A press on it makes no click sound, as on a map that is dragged. */
  quiet?: boolean;
  /** A field of it has the keyboard: keys type and do not drive the body. */
  keyboard?(): boolean;
  /** A text field is wanted, so a touch device raises its keyboard. */
  typing?(): boolean;
  /** A key while open. True if the screen used it. */
  key?(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean;
  /** What the controls guide says of its keys. */
  guide?: readonly GuideWords[];
  build(f: UiFrame, c: ScreenCtx): void;
  /** `kind` 0 for a press, 1 a release, 2 a move, over a node this screen drew. True if it used the event. */
  pointer?(kind: number, key: number, x: number, y: number, button: number, c: ScreenCtx): boolean;
  /** A field's new text. True if the field was this screen's. */
  text?(key: number, value: string): boolean;
  /** A slider's new value, 0 to 1. True if the slider was this screen's. */
  value?(key: number, value: number): boolean;
  /** The server's answer to command `seq`. */
  result?(seq: number, code: number, c: ScreenCtx): void;
  /** The session died or went to the creator. */
  reset?(why: ScreenReset, c: ScreenCtx): void;
}

/** A row of SCREENS: makes the screen once for each `Ui`. */
export type ScreenRow = () => Screen;
