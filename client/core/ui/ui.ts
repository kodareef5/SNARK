// Screens write their nodes into `frame` every frame. The shell draws that list and sends events back here.

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
import { RespawnScreen, buildMap } from "./screens.ts";
import { Settings } from "../settings.ts";
import { buildSettings, settingsClick } from "./settings.ts";
import { StructMenu } from "./structure.ts";
import { KEY_NAME_INPUT, NamePrompt, buildOverhead } from "./tame.ts";
import { TravelScreen } from "./travel.ts";
import { SESSION_CREATING, SESSION_DEAD, TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "../../../shared/net/protocol.ts";

/** The channel each key opens the chat box on. */
const CHAT_KEYS: Record<string, number> = { Enter: TEXT_GLOBAL, NumpadEnter: TEXT_GLOBAL, Insert: TEXT_LOCAL, Slash: TEXT_TRIBE };

export class Ui {
  /** Hears an occasion of the interface by its cue (shared/sound/cues.ts): set by the app where there is sound. */
  hear: ((cue: string) => void) | null = null;
  readonly frame = new UiFrame();
  readonly console = new ConsoleState();
  readonly chat = new ChatState();
  readonly inventory = new InventoryScreen();
  readonly creator = new CreatorScreen();
  readonly sheet = new CharacterScreen();
  readonly respawn = new RespawnScreen();
  readonly structure = new StructMenu();
  readonly naming = new NamePrompt();
  /** The other servers of the cluster, opened at an obelisk's terminal. */
  readonly travel = new TravelScreen();
  /** The session is in the creator, which is then the whole interface. */
  creating = false;
  /** Which screen is up. `options` is the settings screen. */
  map = false;
  character = false;
  options = false;
  readonly settings = new Settings();
  /** The session is dead and choosing where to respawn, so the mouse is free. */
  private dead = false;
  /** The app sets both once it has them. */
  registry: Registry | null = null;
  palette: Uint8Array | null = null;
  /** A console line this client answers itself, without the server: the answer, or null for a line to send. */
  local: ((line: string) => string | null) | null = null;

  /** A text field has the keyboard, so keys must not also drive the body. */
  get captureKeyboard(): boolean {
    return this.console.open || this.chat.open || this.naming.open;
  }

  /** True when the mouse should steer the camera, with the shell holding pointer lock. */
  get wantsPointerLock(): boolean {
    return !this.console.open && !this.chat.open && !this.naming.open && !this.inventory.open && !this.map && !this.character && !this.options && !this.travel.open && !this.dead && !this.creating && !this.structure.open;
  }

  /** Returns true if the interface used the key. The shell must then suppress the browser's own handling. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    const con = this.console;
    const chat = this.chat;
    // The name prompt has the keyboard until it is answered.
    if (this.naming.open && !con.open) return this.naming.key(code, down, repeat, session);
    if (chat.open && !con.open) {
      // The chat box has the keyboard. It handles Enter, Escape and Tab, and every other key is typing.
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
      // The structure menu takes its digits and Escape. Opening any other screen closes it.
      if (this.structure.key(code, down, repeat, session)) return true;
      // Chat does not open while the session is in the creator.
      if (CHAT_KEYS[code] !== undefined && !this.creating) {
        if (down && !repeat) chat.begin(CHAT_KEYS[code]!, session);
        return true;
      }
      // Screens leave the keyboard to the body, so the survivor can keep walking with one open.
      if (code === "KeyI" || code === "KeyM" || code === "KeyP" || code === "KeyO" || (code === "Escape" && (this.inventory.open || this.map || this.character || this.options || this.travel.open))) {
        if (down && !repeat) {
          this.structure.close();
          // Opening one screen closes the others.
          const map = code === "KeyM" && !this.map;
          const character = code === "KeyP" && !this.character;
          const options = code === "KeyO" && !this.options;
          const inventory = code === "KeyI" && !this.inventory.open;
          const opened = map ? "map" : character ? "character" : options ? "options" : inventory ? "inventory" : "";
          const shut = this.map ? "map" : this.character ? "character" : this.options ? "options" : this.inventory.open ? "inventory" : "";
          this.hear?.(opened !== "" ? `screen/${opened}/open` : `screen/${shut || "inventory"}/close`);
          this.map = map;
          this.character = character;
          this.options = options;
          this.travel.open = false;
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
          const answer = this.local?.(line) ?? null;
          if (answer !== null) con.print(answer);
          else if (!session || (session.text(line) === 0 && session.state !== "active")) con.print("not connected; nothing was sent");
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

  /** `kind` is 0 for down, 1 for up, 2 for move, over an interactive node. */
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
    if (kind === 0 && key !== 0) this.hear?.("click");
    if (kind === 0 && this.respawn.click(key, session)) return;
    if (kind === 0 && this.structure.click(key, session)) return;
    if (kind === 0 && this.character && this.registry && this.sheet.click(key, session, this.registry)) return;
    if (kind === 0 && this.options && settingsClick(key, this.settings)) return;
    if (kind === 0 && this.travel.open && this.travel.click(key, session)) return;
    if (this.inventory.open) this.inventory.pointer(kind, key, button, session);
  }

  input(key: number, value: string): void {
    if (key === KEY_NAME_INPUT) this.naming.edit(value);
    else if (key === KEY_CONSOLE_INPUT) this.console.edit(value);
    else if (key === KEY_CHAT_INPUT) this.chat.edit(value);
  }

  build(aspect: number, hud: HudModel, session: ClientSession | null): void {
    const f = this.frame;
    f.begin(aspect);
    this.creating = session?.sessionState === SESSION_CREATING;
    // A survivor still in the creator has no vitals, no position and nothing to aim at.
    if (!this.creating) {
      // Marks over creatures are under the rest of the HUD.
      buildOverhead(f, hud.overhead);
      buildHud(f, hud);
      buildCombat(f, hud.combat);
      // Chat is built over the HUD and under every screen.
      if (session) {
        this.chat.absorb(session);
        const band = chatBand(f, hud);
        this.chat.build(f, band.top, band.bottom, session.serverTick);
      }
    } else this.chat.close();
    // While the console or the chat box is open, the screen under it is not built, so nothing clickable hides behind either.
    this.dead = session?.sessionState === SESSION_DEAD;
    if (this.dead || this.creating) this.structure.close();
    if (!this.console.open && !this.chat.open) {
      if (this.creating && session) this.creator.build(f, this.palette, session.name);
      else if (this.dead && session) this.respawn.build(f, session);
      else if (this.map && session) buildMap(f, session, hud);
      else if (this.character && session && this.registry) this.sheet.build(f, session, this.registry);
      else if (this.options) buildSettings(f, this.settings, hud.micLevel);
      else if (this.travel.open && session) this.travel.build(f, session);
      else {
        this.inventory.build(f, session, this.registry, this.palette);
        if (session && this.registry && !this.inventory.open) this.structure.build(f, session, this.registry);
      }
    }
    // The name prompt goes over every other screen, but under the console.
    if (session && this.registry && !this.creating) {
      this.naming.absorb(session);
      if (!this.console.open) this.naming.build(f, session, this.registry);
    }
    if (session) this.console.absorb(session);
    this.console.build(f);
  }
}
