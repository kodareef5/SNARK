// The interface's state and its decisions: which screen is up, what a key
// does, whether the mouse steers the camera. Screens write their nodes into
// `frame` every frame; the shell draws that list and sends events back here.

import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { ConsoleState, KEY_CONSOLE_INPUT } from "./console.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { buildHud } from "./hud.ts";
import { InventoryScreen } from "./inventory.ts";
import { UiFrame } from "./nodes.ts";

export class Ui {
  readonly frame = new UiFrame();
  readonly console = new ConsoleState();
  readonly inventory = new InventoryScreen();
  /** Content and palette, for naming and colouring items. Set by the app once it has them. */
  registry: Registry | null = null;
  palette: Uint8Array | null = null;

  /** A text field has the keyboard: keys must not also drive the body. */
  get captureKeyboard(): boolean {
    return this.console.open;
  }

  /** The mouse should steer the camera (the shell holds pointer lock) rather than move a cursor. */
  get wantsPointerLock(): boolean {
    return !this.console.open && !this.inventory.open;
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
    if (!con.open) {
      // The inventory leaves the keyboard to the body: you can keep walking with it open.
      if (code === "KeyI" || (code === "Escape" && this.inventory.open)) {
        if (down && !repeat) {
          this.inventory.open = code === "KeyI" ? !this.inventory.open : false;
          this.inventory.held = -1;
        }
        return true;
      }
      return false;
    }
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

  /** Pointer went down (0), up (1) or moved (2) over an interactive node. */
  pointer(kind: number, key: number, _x: number, _y: number, button: number, session: ClientSession | null): void {
    if (session && this.inventory.open && !this.console.open) this.inventory.pointer(kind, key, button, session);
  }

  /** A text field's content changed. */
  input(key: number, value: string): void {
    if (key === KEY_CONSOLE_INPUT) this.console.edit(value);
  }

  /** Lay out every visible screen for a window of this aspect. */
  build(aspect: number, hud: HudModel, session: ClientSession | null): void {
    const f = this.frame;
    f.begin(aspect);
    buildHud(f, hud);
    // The console covers whatever screen is up; that screen waits underneath, undrawn, so nothing clickable hides behind it.
    if (!this.console.open) this.inventory.build(f, session, this.registry, this.palette);
    if (session) this.console.absorb(session);
    this.console.build(f);
  }
}
