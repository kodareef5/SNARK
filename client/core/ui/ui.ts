// The interface's state and its decisions: which screen is up, what a key
// does, whether the mouse steers the camera. Screens write their nodes into
// `frame` every frame; the shell draws that list and sends events back here.

import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { ConsoleState, KEY_CONSOLE_INPUT } from "./console.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CharacterScreen } from "./character.ts";
import { ChatState, KEY_CHAT_INPUT, KEY_CHAT_TAG } from "./chat.ts";
import { CreatorScreen } from "./creator.ts";
import { buildCombat } from "./combat.ts";
import { buildHud, chatBand } from "./hud.ts";
import { InventoryScreen } from "./inventory.ts";
import { UiFrame } from "./nodes.ts";
import { buildMap, buildRespawn, respawnClick } from "./screens.ts";
import { Settings } from "../settings.ts";
import { buildSettings, settingsClick } from "./settings.ts";
import { SESSION_CREATING, SESSION_DEAD, TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "../../../shared/net/protocol.ts";

/** The keys that open the chat box, and the channel each opens it on. */
const CHAT_KEYS: Record<string, number> = { Enter: TEXT_GLOBAL, NumpadEnter: TEXT_GLOBAL, Insert: TEXT_LOCAL, Slash: TEXT_TRIBE };

export class Ui {
  readonly frame = new UiFrame();
  readonly console = new ConsoleState();
  readonly chat = new ChatState();
  readonly inventory = new InventoryScreen();
  readonly creator = new CreatorScreen();
  readonly sheet = new CharacterScreen();
  /** The session has no survivor yet and is making one: the creator is the whole interface. */
  creating = false;
  /** The full map is up. */
  map = false;
  /** The character screen (stats, engrams, crafting) is up. */
  character = false;
  /** The settings screen is up; and what it sets. */
  options = false;
  readonly settings = new Settings();
  /** The session is dead and choosing where to return: the mouse is free for that. */
  private dead = false;
  /** Content and palette, for naming and colouring items. Set by the app once it has them. */
  registry: Registry | null = null;
  palette: Uint8Array | null = null;

  /** A text field has the keyboard: keys must not also drive the body. */
  get captureKeyboard(): boolean {
    return this.console.open || this.chat.open;
  }

  /** The mouse should steer the camera (the shell holds pointer lock) rather than move a cursor. */
  get wantsPointerLock(): boolean {
    return !this.console.open && !this.chat.open && !this.inventory.open && !this.map && !this.character && !this.options && !this.dead && !this.creating;
  }

  /**
   * A key went down (or repeated while held), or went up. Returns true if the
   * interface used it, in which case the shell must suppress the browser's own
   * handling.
   */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    const con = this.console;
    const chat = this.chat;
    if (chat.open && !con.open) {
      // The box has the keyboard: these three are its own, and every other key is typing.
      if (code !== "Enter" && code !== "NumpadEnter" && code !== "Escape" && code !== "Tab") return false;
      if (!down || repeat) return true;
      if (code === "Tab") chat.cycle(session);
      else if (code === "Escape") chat.close();
      else chat.submit(session);
      return true;
    }
    if (code === "Backquote" || (code === "Tab" && !con.open)) {
      // A held key opens or closes once, not once per repeat.
      if (down && !repeat) con.open = !con.open;
      return true;
    }
    if (!con.open) {
      // Chat: Enter to everyone, Insert to those near, the slash key to the tribe. Not while a survivor is still being made.
      if (CHAT_KEYS[code] !== undefined && !this.creating) {
        if (down && !repeat) chat.begin(CHAT_KEYS[code]!, session);
        return true;
      }
      // Screens leave the keyboard to the body: you can keep walking with them open.
      if (code === "KeyI" || code === "KeyM" || code === "KeyP" || code === "KeyO" || (code === "Escape" && (this.inventory.open || this.map || this.character || this.options))) {
        if (down && !repeat) {
          // One screen at a time: opening one puts the others away.
          const map = code === "KeyM" && !this.map;
          const character = code === "KeyP" && !this.character;
          const options = code === "KeyO" && !this.options;
          const inventory = code === "KeyI" && !this.inventory.open;
          this.map = map;
          this.character = character;
          this.options = options;
          if (inventory) this.inventory.open = true;
          else this.inventory.close(session);
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
        con.submit((line) => {
          if (!session || (session.text(line) === 0 && session.state !== "active")) con.print("not connected; nothing was sent");
        });
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
    if (!session || this.console.open) return;
    if (kind === 0 && key === KEY_CHAT_TAG) {
      this.chat.cycle(session);
      return;
    }
    if (this.creating) {
      this.creator.pointer(kind, key, _x, session);
      return;
    }
    if (kind === 0 && respawnClick(key, session)) return;
    if (kind === 0 && this.character && this.registry && this.sheet.click(key, session, this.registry)) return;
    if (kind === 0 && this.options && settingsClick(key, this.settings)) return;
    if (this.inventory.open) this.inventory.pointer(kind, key, button, session);
  }

  /** A text field's content changed. */
  input(key: number, value: string): void {
    if (key === KEY_CONSOLE_INPUT) this.console.edit(value);
    else if (key === KEY_CHAT_INPUT) this.chat.edit(value);
  }

  /** Lay out every visible screen for a window of this aspect. */
  build(aspect: number, hud: HudModel, session: ClientSession | null): void {
    const f = this.frame;
    f.begin(aspect);
    this.creating = session?.sessionState === SESSION_CREATING;
    // A survivor that does not exist yet has no vitals, no place and nothing to aim at.
    if (!this.creating) {
      buildHud(f, hud);
      buildCombat(f, hud.combat);
      // What is being said, over the world and under every screen.
      if (session) {
        this.chat.absorb(session);
        const band = chatBand(f, hud);
        this.chat.build(f, band.top, band.bottom, session.serverTick);
      }
    } else this.chat.close();
    // The console covers whatever screen is up, and the chat box takes the keyboard from it; that screen
    // waits underneath, undrawn, so nothing clickable hides behind either.
    this.dead = session?.sessionState === SESSION_DEAD;
    if (!this.console.open && !this.chat.open) {
      if (this.creating && session) this.creator.build(f, this.palette, session.name);
      else if (this.dead && session) buildRespawn(f, session);
      else if (this.map && session) buildMap(f, session, hud);
      else if (this.character && session && this.registry) this.sheet.build(f, session, this.registry);
      else if (this.options) buildSettings(f, this.settings);
      else this.inventory.build(f, session, this.registry, this.palette);
    }
    if (session) this.console.absorb(session);
    this.console.build(f);
  }
}
