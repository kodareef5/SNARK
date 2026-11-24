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
  /** The frame as the last build left it, which the shell shows and the presses come from. */
  readonly frame: UiFrame;
  /** The console or the chat box is over the screens, which are then not built. */
  covered: boolean;
  /** A node is to take the focus at the end of this build. */
  focusPending: boolean;
  /** Gives the focus to `key`, and to its field in the shell. */
  focusTo(key: number): void;
  /** The focus to the next interactive node, or the one before. */
  moveFocus(by: number): void;
  /** The pointer is over `key`: the focus follows it, the shell's field does not. */
  hover(key: number): void;
  /** Presses `key` at `x`, `y` as the pointer would. */
  press(key: number, x: number, y: number): void;
  /** Turns the focused control a step, or with `end` to its end: true if something took it. */
  adjust(by: number, end: boolean): boolean;
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
  /** The name its open and close sounds go by, where not its own. */
  readonly sound?: string;
  /** The node keys it uses, each band from `from` for `count`: no two screens' bands may meet (tests/ui/screens.test.ts). */
  readonly bands: readonly { readonly from: number; readonly count: number }[];
  /** Whether it is up this frame. */
  isOpen(): boolean;
  /**
   * Each frame, open or not, before any screen builds: a screen the session opens reads the session here. True when it
   * came up by itself this frame, which shuts every other open modal screen.
   */
  absorb?(c: ScreenCtx): boolean | void;
  /** Brings it up by its hotkey. Without one only its own file opens it. */
  show?(c: ScreenCtx): void;
  close(c: ScreenCtx): void;
  /** While open, the mouse stays with the camera. Without it an open screen frees the pointer. */
  keepsPointer?: boolean;
  /** A press on it makes no click sound, as on a map that is dragged. */
  quiet?: boolean;
  /** While open, a press on what no listed screen drew comes to it too, so a drag can end anywhere. */
  catchAll?: boolean;
  /** A field of it has the keyboard: keys type and do not drive the body. */
  keyboard?(): boolean;
  /** While open it holds the keys from the body, though no field types: they come to its `key`. */
  holdsKeys?: boolean;
  /** While open, Tab and the arrows move the focus among its buttons, and Enter or Space presses the focused one. */
  focusNav?: boolean;
  /** A text field is wanted, so a touch device raises its keyboard. */
  typing?(): boolean;
  /** While true it takes every key and every press before anything else, as the menu does. */
  takesAll?(): boolean;
  /** While true the HUD is not drawn under it. */
  hidesHud?(): boolean;
  /** Escape with nothing else to close brings it up. */
  escape?(c: ScreenCtx): void;
  /** Left and right on its focused node: true or false if it decided, undefined to leave it to a slider. */
  adjust?(key: number, by: number, end: boolean, c: ScreenCtx): boolean | undefined;
  /** A key while open. True if the screen used it. */
  key?(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean;
  /** A key while the body is played and no screen has the pointer, open or not. True if the screen used it. */
  playKey?(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean;
  /** What the controls guide says of its keys. */
  guide?: readonly GuideWords[];
  build(f: UiFrame, c: ScreenCtx): void;
  /** Drawn with the HUD while the body is played, open or not. A press on what it draws reaches `pointer` even closed. */
  play?(f: UiFrame, c: ScreenCtx): void;
  /** `kind` 0 for a press, 1 a release, 2 a move, over a node this screen drew. True if it used the event. */
  pointer?(kind: number, key: number, x: number, y: number, button: number, c: ScreenCtx): boolean;
  /** A field's new text. True if the field was this screen's. */
  text?(key: number, value: string): boolean;
  /** A slider's new value, 0 to 1. True if the slider was this screen's. */
  value?(key: number, value: number, c: ScreenCtx): boolean;
  /** The server's answer to command `seq`. */
  result?(seq: number, code: number, c: ScreenCtx): void;
  /** The session died or went to the creator. */
  reset?(why: ScreenReset, c: ScreenCtx): void;
}

/** A row of SCREENS: makes the screen once for each `Ui`. */
export type ScreenRow = () => Screen;

/** Where a part draws: the room its host leaves it under the host's tabs. */
export interface PartBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A part of a host screen: one of its tabs, written in a file of its own. It draws with keys of its own from 0, and its
 * host turns them into the frame's keys (`PartKeys`), so two parts never agree on numbers between them.
 */
export interface ScreenPart {
  readonly name: string;
  /** Its tab's words. */
  readonly label: string;
  build(f: UiFrame, at: PartBox, k: PartKeys, c: ScreenCtx): void;
  /** `local` is the part's own key. True if it used the event. */
  pointer?(kind: number, local: number, x: number, y: number, button: number, c: ScreenCtx): boolean;
}

/** Keys a host gives each part: the first for its tab, then PART_KEYS - 1 of the part's own. */
export const PART_KEYS = 1000;

/** A part's keys in its host's frame. */
export class PartKeys {
  base = 0;
  /** The frame's key for the part's own key `local`. */
  key(local: number): number {
    if (!(local >= 0 && local < PART_KEYS - 1)) throw new Error(`a part's keys run from 0 to ${PART_KEYS - 2}, not ${local}`);
    return this.base + 1 + local;
  }
}

/** Which part of a host's, whose parts' keys start at `from`, a frame key is: its index and its own key (-1 its tab). */
export function partOf(key: number, from: number, parts: number): { index: number; local: number } | null {
  const index = Math.floor((key - from) / PART_KEYS);
  if (key < from || index >= parts) return null;
  return { index, local: key - from - index * PART_KEYS - 1 };
}
