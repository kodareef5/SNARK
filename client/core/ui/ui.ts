// The interface's state and its decisions: which screen is up, what a key
// does, whether the mouse steers the camera. Screens write their nodes into
// `frame` every frame; the shell draws that list and sends events back here.

import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { ConsoleState, KEY_CONSOLE_INPUT } from "./console.ts";
import { buildHud } from "./hud.ts";
import { UiFrame } from "./nodes.ts";

export class Ui {
  readonly frame = new UiFrame();
  readonly console = new ConsoleState();

  /** A text field has the keyboard: keys must not also drive the body. */
  get captureKeyboard(): boolean {
    return this.console.open;
  }

  /** The mouse should steer the camera (the shell holds pointer lock) rather than move a cursor. */
  get wantsPointerLock(): boolean {
    return !this.console.open;
  }

  /**
   * A key went down (or repeated while held), or went up. Returns true if the
   * interface used it, in which case the shell must suppress the browser's own
   * handling.
   */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    const con = this.console;
    if (code === "Backquote" || (code === "Tab" && !con.open)) {
      // A held key opens or closes once, not once per repeat.
      if (down && !repeat) con.open = !con.open;
      return true;
    }
    if (!con.open) return false;
    if (!down) return code === "Escape" || code === "Enter" || code === "Tab" || code === "ArrowUp" || code === "ArrowDown" || code === "PageUp" || code === "PageDown";
    switch (code) {
      case "Tab":
        // Kept from the browser, which would move focus out of the field.
        return true;
      case "Escape":
        con.open = false;
        return true;
      case "Enter":
        con.submit((line) => session?.text(line));
        return true;
      case "ArrowUp":
        con.recall(-1);
        return true;
      case "ArrowDown":
        con.recall(1);
        return true;
      case "PageUp":
        con.scroll += con.page(this.frame);
        return true;
      case "PageDown":
        con.scroll = Math.max(0, con.scroll - con.page(this.frame));
        return true;
    }
    return false;
  }

  /** Pointer events on interactive nodes. Nothing on the current screens is clickable except text fields. */
  pointer(_kind: number, _key: number, _x: number, _y: number, _button: number): void {}

  /** A text field's content changed. */
  input(key: number, value: string): void {
    if (key === KEY_CONSOLE_INPUT) this.console.edit(value);
  }

  /** Lay out every visible screen for a window of this aspect. */
  build(aspect: number, hud: HudModel, session: ClientSession | null): void {
    const f = this.frame;
    f.begin(aspect);
    buildHud(f, hud);
    if (session) this.console.absorb(session);
    this.console.build(f);
  }
}
