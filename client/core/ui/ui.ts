// Screens write their nodes into `frame` every frame. The shell draws that list and sends events back here.

import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { ConsoleState, KEY_CONSOLE_DONE, KEY_CONSOLE_INPUT } from "./console.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { buildFeed } from "../hud/air-feed.ts";
import { ChatState, KEY_CHAT_INPUT, KEY_CHAT_SEND, KEY_CHAT_TAG } from "./chat.ts";
import { buildCombat } from "./combat.ts";
import { buildHud, chatBand, hotbarCell, hotbarLeft, hotbarTop } from "./hud.ts";
import type { TouchPlay } from "../touch.ts";
import { KEY_MENU_OPEN, KEY_MENU_RESUME, KEY_UNMUTE, unmuteButton } from "./menu.ts";
import { CANVAS_HEIGHT, K_SLIDER, UiFrame } from "./nodes.ts";
import { Settings } from "../settings.ts";
import { buildOverhead } from "./tame.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { SCREENS } from "./screens-list.ts";
import { SESSION_CREATING, SESSION_DEAD, TEXT_GLOBAL, TEXT_LOCAL } from "../../../shared/net/protocol.ts";

/** The keys that turn a focused control: left and right a step, Home and End to its ends. */
const ARROWS = ["ArrowLeft", "ArrowRight", "Home", "End"];

/** The channel each key opens the chat box on. */
const CHAT_KEYS: Record<string, number> = { Enter: TEXT_GLOBAL, NumpadEnter: TEXT_GLOBAL, Insert: TEXT_LOCAL, Slash: TEXT_GLOBAL };

export class Ui {
  /** Hears an occasion of the interface by its cue (shared/sound/cues.ts): set by the app where there is sound. */
  hear: ((cue: string) => void) | null = null;
  readonly frame = new UiFrame();
  readonly console = new ConsoleState();
  readonly chat = new ChatState();
  /** The screens of SCREENS, made for this interface, in its order. */
  readonly screens: readonly Screen[] = SCREENS.map((make) => make());
  /** The session is in the creator, which is then the whole interface. */
  creating = false;
  /** What the player last used: 0 the keyboard and mouse, 1 a pad, 2 a finger. The HUD's controls and words follow it. */
  inputDevice = 0;
  /** The canvas's height in units, which a short window lowers (nodes.ts canvasHeight). The app sets it each frame. */
  canvasHeight = CANVAS_HEIGHT;
  /** The touch layer's state, which the app owns; whether the body it drives flies; and the buttons the last frame showed, a bit each. */
  touchPlay: TouchPlay | null = null;
  /**
   * The touch layer's layout (ui/touch.ts), once the shell has fetched it: a page fetches it when a finger is first
   * used, and until it comes the HUD is drawn as for a mouse. Null on a page never touched, which never pays for it.
   */
  layer: typeof import("./touch.ts") | null = null;
  /** The debug bar (debug/debug.ts), which the app fetches once Settings.debug is first on; null until then. */
  debug: import("../debug/debug.ts").DebugBar | null = null;
  flyer = false;
  /** A piece is being built, or a vehicle set down: the touch cluster is then the builder's. The app sets both. */
  building = false;
  placing = false;
  /** Whether there is voice to talk on, and whether a creature is looked at: the app sets both, for the touch layer. */
  canTalk = false;
  creatureAhead = false;
  touchShown = 0;
  get touch(): boolean { return this.inputDevice === 2; }
  inspect = false;
  menuFocus = KEY_MENU_RESUME;
  private focusNext = 0;
  private menuShift = false;
  readonly settings = new Settings();
  /** What the screens read, set before each call to them. */
  private readonly ctx: ScreenCtx = {
    session: null, registry: null, palette: null, hud: null, settings: this.settings, focus: 0, inputDevice: 0, finger: 0,
    frame: this.frame, covered: false, focusPending: false,
    hear: (cue) => this.hear?.(cue),
    focusTo: (key) => this.focusTo(key),
    moveFocus: (by) => this.moveFocus(by),
    hover: (key) => (this.menuFocus = key),
    press: (key, x, y) => this.pointer(0, key, x, y, 0, this.ctx.session),
    adjust: (by, end) => this.adjustFocused(by, end),
  };
  /** The session has no body and chooses where to rise, so the mouse is free. */
  private dead = false;
  /** The app sets both once it has them. */
  registry: Registry | null = null;
  palette: Uint8Array | null = null;
  /** A console line this client answers itself, without the server: the answer, or null for a line to send. */
  local: ((line: string) => string | null) | null = null;

  /** Whether the screen of SCREENS named `name` is up. */
  opened(name: string): boolean {
    return this.screen(name).isOpen();
  }

  /** The screen of SCREENS by its name. */
  screen<S extends Screen>(name: string): S {
    for (const s of this.screens) if (s.name === name) return s as S;
    throw new Error(`no screen is named ${name}`);
  }

  /** A text field has the keyboard, so keys must not also drive the body. */
  get captureKeyboard(): boolean {
    if (this.inspect || this.console.open || this.chat.open) return true;
    for (const s of this.screens) if (s.isOpen() && (s.holdsKeys || s.keyboard?.())) return true;
    return false;
  }

  /** A text field is wanted: the shell of a touch device raises its keyboard within the press that asked. */
  get typing(): boolean {
    if (this.console.open || this.chat.open) return true;
    for (const s of this.screens) if (s.isOpen() && s.typing?.()) return true;
    return false;
  }

  /** True when the mouse should steer the camera, with the shell holding pointer lock. */
  get wantsPointerLock(): boolean {
    for (const s of this.screens) if (s.isOpen() && !s.keepsPointer) return false;
    return !this.inspect && !this.console.open && !this.chat.open && !this.dead && !this.creating && !(this.debug?.holdsPointer ?? false);
  }

  /** Whether a screen of `group` is open. */
  private openIn(group: string): boolean {
    for (const s of this.screens) if (s.group === group && s.isOpen()) return true;
    return false;
  }

  /** The name the sounds call the open screen of `group` by, or "". */
  private openNameIn(group: string): string {
    for (const s of this.screens) if (s.group === group && s.isOpen()) return s.sound ?? s.name;
    return "";
  }

  /** The screen of `group` that `code` opens, or null. Undefined asks among the screens of no group. */
  private hotkeyed(group: string | undefined, code: string): Screen | null {
    for (const s of this.screens) if (s.group === group && s.hotkey === code) return s;
    return null;
  }

  /** A slider's new value, for the open screens of the list. */
  private slid(key: number, value: number): boolean {
    for (const s of this.screens) if (s.isOpen() && s.value?.(key, value, this.ctx)) return true;
    return false;
  }

  /** The server's answer to command `seq`, told to each screen of the list. */
  results(seq: number, code: number): void {
    for (const s of this.screens) s.result?.(seq, code, this.ctx);
  }

  /** Shuts every open modal screen of the list but `keep`, as one of the bag opens over them. */
  private closeModals(c: ScreenCtx = this.ctx, keep: Screen | null = null): void {
    for (const s of this.screens) if (s !== keep && s.layer === "modal" && s.isOpen()) s.close(c);
  }

  /** The ctx with what this call knows. */
  private at(session: ClientSession | null, hud?: HudModel): ScreenCtx {
    const c = this.ctx;
    c.session = session;
    c.registry = this.registry;
    c.palette = this.palette;
    if (hud) c.hud = hud;
    c.focus = this.menuFocus;
    c.inputDevice = this.inputDevice;
    c.covered = this.console.open || this.chat.open;
    c.focusPending = this.focusNext !== 0;
    return c;
  }

  /** The open screen of the list that takes every key and press first, if any. */
  private takingAll(): Screen | null {
    for (const s of this.screens) if (s.isOpen() && s.takesAll?.()) return s;
    return null;
  }

  /** An open screen wants the HUD under it bare. */
  private bareUnder(): boolean {
    for (const s of this.screens) if (s.bareHud && s.isOpen()) return true;
    return false;
  }

  /** In the creator, or under a screen that hides it, the HUD is not drawn. */
  private hudHidden(): boolean {
    if (this.creating) return true;
    for (const s of this.screens) if (s.isOpen() && s.hidesHud?.()) return true;
    return false;
  }

  /** Escape where no screen takes it: the debug bar's open drawer takes the pointer back first, else the menu opens. */
  escaped(): void {
    if (this.debug?.escaped()) return;
    this.inspect = false;
    this.menuShift = false;
    for (const s of this.screens) if (s.escape) return s.escape(this.at(this.ctx.session));
  }

  /** The drawer is to open as soon as the debug bar comes: F3 turned the bar on. */
  debugAsked = false;

  /** F3 opens or closes the debug bar's drawer, turning the bar on first; F8 saves what the bar holds. */
  debugKey(code: string): void {
    if (code === "F8") return void this.debug?.save("");
    if (this.settings.debug && this.debug) return this.debug.toggle();
    this.debugAsked = true;
    if (!this.settings.debug) {
      this.settings.debug = true;
      this.settings.changed();
    }
  }

  /** A press on the world itself, where no node took it: the debug bar's drawer gives the pointer back to the game. */
  clickWorld(): void {
    this.debug?.clickWorld();
  }

  /** The wheel while the pointer is free; true where something took it. */
  wheel(dy: number): boolean {
    return this.debug?.wheel(dy) ?? false;
  }

  private focusTo(key: number): void { this.menuFocus = this.focusNext = key; }

  private moveFocus(by: number): void {
    // A screen that moves its own focus keeps it among its own buttons.
    const own = this.focusing();
    const at0 = own ? this.screens.indexOf(own) : -1;
    const keys = this.frame.nodes.slice(0, this.frame.count).filter((n) => n.interactive && (!own || (n.owner === at0 && !n.inPlay))).map((n) => n.key);
    const at = keys.indexOf(this.menuFocus);
    if (keys.length) this.focusTo(keys[at < 0 ? (by > 0 ? 0 : keys.length - 1) : (at + by + keys.length) % keys.length]!);
  }

  navigate(direction: number): number {
    if (direction) this.moveFocus(direction);
    if (!this.frame.find(this.menuFocus)?.interactive) this.moveFocus(1);
    return this.menuFocus;
  }

  adjustFocused(by: number, end = false): boolean {
    const top = this.takingAll();
    if (this.console.open || this.chat.open || (!top && !this.creating)) return false;
    const own = top?.adjust?.(this.menuFocus, by, end, this.at(this.ctx.session));
    if (own !== undefined) return own;
    const n = this.frame.find(this.menuFocus);
    if (n?.kind !== K_SLIDER) return false;
    this.input(n.key, String(end ? (by > 0 ? 1 : 0) : n.value + by * n.step));
    return true;
  }

  /** Returns true if the interface used the key. The shell must then suppress the browser's own handling. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    // A screen that takes every key has them first, and adjusts its focused control through the ctx.
    const top = this.takingAll();
    if (top) return top.key?.(code, down, repeat, this.at(session)) ?? false;
    if (down && ARROWS.includes(code) && this.adjustFocused(code === "ArrowLeft" || code === "Home" ? -1 : 1, code === "Home" || code === "End")) return true;
    const con = this.console;
    const chat = this.chat;
    if(this.creating && !con.open) {
      if(code==="ShiftLeft" || code==="ShiftRight")this.menuShift=down;
      if(code==="Tab") { if(down)this.moveFocus(this.menuShift?-1:1); return true; }
    }
    // A listed screen whose field has the keyboard takes every key, and a key it does not use is typing.
    if (!con.open) for (const s of this.screens) if (s.isOpen() && s.keyboard?.()) return s.key?.(code, down, repeat, this.at(session)) ?? false;
    if (chat.open && !con.open) {
      // The chat box has the keyboard. It handles Enter, Escape and Tab, and every other key is typing.
      if (code !== "Enter" && code !== "NumpadEnter" && code !== "Escape" && code !== "Tab") return false;
      if (!down || repeat) return true;
      if (code === "Tab") chat.cycle(session);
      else if (code === "Escape") chat.close();
      else chat.submit(session);
      return true;
    }
    const focusing = this.focusing();
    if (code === "Backquote" || (code === "Tab" && !con.open && !focusing)) {
      // A held key opens or closes once, not once per repeat.
      if (down && !repeat) con.open = !con.open;
      return true;
    }
    if (!con.open) {
      if (focusing && (code === "ShiftLeft" || code === "ShiftRight")) this.menuShift = down;
      if (focusing && (code === "Tab" || code === "ArrowDown" || code === "ArrowUp")) {
        if (down) this.moveFocus(code === "ArrowUp" || (code === "Tab" && this.menuShift) ? -1 : 1);
        return true;
      }
      const focused = this.frame.find(this.menuFocus);
      if (focusing && down && !repeat && (code === "Enter" || code === "Space") && focused?.interactive && session) {
        return focusing.pointer?.(0, this.menuFocus, focused.x + focused.w / 2, focused.y + focused.h / 2, 0, this.at(session)) ?? false;
      }
      // An open screen of the list has its keys, then a screen's keys in play.
      for (const s of this.screens) if (s.isOpen() && s.key?.(code, down, repeat, this.at(session))) return true;
      if (session && this.wantsPointerLock) for (const s of this.screens) if (s.playKey?.(code, down, repeat, this.at(session))) return true;
      if (code === "KeyH" && (this.inspect || this.wantsPointerLock)) { this.inspect = down; return true; }
      if (code === "Escape" && this.inspect) { if (down && !repeat) this.inspect = false; return true; }
      if (code === "KeyL" && (this.inspect || this.wantsPointerLock)) { if (down && !repeat) { this.settings.minimap = !this.settings.minimap; this.settings.changed(); } return true; }
      if (code === "Escape" && this.debug?.holdsPointer) { if (down && !repeat) this.debug.close(); return true; }
      // A screen of no group opens by its hotkey from play.
      const own = this.hotkeyed(undefined, code);
      if (own && this.wantsPointerLock && !this.creating) {
        if (down && !repeat) own.show?.(this.at(session));
        return true;
      }
      // Chat does not open while the session is in the creator.
      if (CHAT_KEYS[code] !== undefined && !this.creating) {
        // The slash key opens the box with the slash typed, for a command (chat.ts); Tab in the box reaches the tribe's channel.
        if (down && !repeat) { chat.begin(CHAT_KEYS[code]!, session); if (code === "Slash") chat.input = "/"; }
        return true;
      }
      // Screens leave the keyboard to the body, so the survivor can keep walking with one open.
      const hot = this.hotkeyed("bag", code);
      if (hot || (code === "Escape" && this.openIn("bag"))) {
        if (down && !repeat) {
          // Opening one screen closes the others.
          const listed = hot && !hot.isOpen() ? hot : null;
          const opened = listed ? listed.sound ?? listed.name : "";
          const shut = this.openNameIn("bag");
          this.hear?.(opened !== "" ? `screen/${opened}/open` : `screen/${shut || "inventory"}/close`);
          this.inspect = false;
          this.closeModals(this.at(session));
          listed?.show?.(this.at(session));
        }
        return true;
      }
      if (code === "Escape") {
        if (down && !repeat) this.escaped();
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

  /** `kind` is 0 for down, 1 for up, 2 for move, over an interactive node. `finger` is 0 for a mouse, else the touch's number. */
  pointer(kind: number, key: number, x: number, y: number, button: number, session: ClientSession | null, finger = 0): void {
    if (this.debug?.pointer(kind, key, x, y, button)) return;
    if (key === KEY_CONSOLE_DONE) { if (kind === 0) this.console.open = false; return; }
    if (key === KEY_UNMUTE) { if (kind === 0 && button === 0) { this.settings.muted = false; this.settings.changed(); } return; }
    if(this.frame.find(key)?.kind===K_SLIDER) { if(kind===0 && button===0)this.focusTo(key); return; }
    const top = this.takingAll();
    if (top) return void top.pointer?.(kind, key, x, y, button, this.at(session));
    if (kind === 0 && key === KEY_MENU_OPEN) return this.escaped();
    if (!session || this.console.open) return;
    if (kind === 0 && key === KEY_CHAT_TAG) {
      this.chat.cycle(session);
      return;
    }
    if (kind === 0 && key === KEY_CHAT_SEND) {
      this.chat.submit(session);
      return;
    }
    // A node a screen of the list drew goes to that screen alone, and only while it is still open: a press can come
    // between a close and the next frame.
    const owner = this.frame.find(key)?.owner ?? -1;
    const listed = owner >= 0 ? this.screens[owner]! : null;
    if (kind === 0 && key !== 0 && !listed?.quiet) this.hear?.("click");
    // While in the creator, nothing but the creator takes a press.
    if (this.creating && !listed) return;
    if (listed) {
      const c = this.at(session);
      c.finger = finger;
      // What a screen draws with the HUD takes a press while the screen is closed.
      if (listed.isOpen() || this.frame.find(key)!.inPlay) listed.pointer?.(kind, key, x, y, button, c);
      c.finger = 0;
      return;
    }
    for (const s of this.screens) if (s.catchAll && s.isOpen()) s.pointer?.(kind, key, x, y, button, this.at(session));
  }

  input(key: number, value: string): void {
    const n=this.frame.find(key);
    if(n?.kind===K_SLIDER) {
      if(value.trim()==="" || !Number.isFinite(Number(value)))return;
      const v=Math.max(0,Math.min(1,Math.round(Number(value)/n.step)*n.step));
      if (this.slid(key, v)) n.value = v;
      return;
    }
    if (key === KEY_CONSOLE_INPUT) this.console.edit(value);
    else if (key === KEY_CHAT_INPUT) this.chat.edit(value);
    else for (const s of this.screens) if (s.text?.(key, value, this.ctx)) return;
  }

  build(aspect: number, hud: HudModel, session: ClientSession | null): void {
    const f = this.frame;
    f.begin(aspect, this.canvasHeight);
    // The debug bar keeps its room at the foot, and everything anchored there stands over it.
    if (this.settings.debug) this.debug?.reserve(f);
    const layer = this.touch ? this.layer : null;
    const plan = layer ? layer.touchPlan(f, this.settings.muted, this.canTalk) : null;
    this.touchShown = 0;
    this.creating = session?.sessionState === SESSION_CREATING;
    this.dead = session?.sessionState === SESSION_DEAD;
    // A screen that came up by itself, as the inventory does with a container the server opens, shuts the others.
    for (const s of this.screens) if (s.absorb?.(this.at(session, hud))) this.closeModals(this.ctx, s);
    // A survivor still in the creator has no vitals, no position and nothing to aim at.
    if (session) this.chat.absorb(session);
    if (session && (this.creating || this.dead)) this.chat.wait(session.serverTick);
    if (!this.hudHidden()) {
      const controls = (this.wantsPointerLock || this.inspect) && !session?.open;
      // A finger's zones lie under the whole HUD while the body is being played.
      const play = plan !== null && this.touchPlay !== null && session !== null && controls && this.wantsPointerLock;
      if (play) layer!.touchZones(f);
      if (session?.airSupport.flight && controls && !this.dead) {
        // The drone's feed and its tracking boxes stand in for the HUD (hud/air-feed.ts).
        buildFeed(f, hud, this.inputDevice);
        if (play) this.touchShown = layer!.touchDrone(this.frame, this.touchPlay!);
        this.buildPlay(f, session, hud);
        return;
      }
      // Marks over creatures are under the rest of the HUD.
      buildOverhead(f, hud.overhead);
      hud.bare = this.dead || this.bareUnder();
      buildHud(f, hud, this.settings, controls, this.inspect, plan);
      buildCombat(f, hud.combat);
      // Chat is built over the HUD and under every screen.
      if (session) {
        // A finger's keyboard covers the foot of the screen, so the box it types in stands at the top.
        const band = plan && this.chat.open ? layer!.chatTop(f, plan) : chatBand(f, hud);
        this.chat.build(f, band.top, band.bottom, session.serverTick, plan !== null);
      }
      if (plan && this.touchPlay && controls) {
        this.touchShown = layer!.touchBar(f, this.touchPlay, f.width - f.right - 12 - plan.map, f.top + 12, plan.map, this.settings.minimap, plan.mic);
        const slots = hud.hotbar.length;
        if (play) this.touchShown |= layer!.touchControls(f, this.touchPlay, hud, this.placing ? "placing" : this.building ? "building" : this.flyer ? "flyer" : "foot", slots ? hotbarLeft(f, slots) + slots * (hotbarCell(f, slots) + 3) - 3 : 0, slots ? hotbarTop(f, slots) : f.height, this.settings.minimap ? f.top + 12 + plan.map : 0, this.creatureAhead);
      }
      if (controls && session) this.buildPlay(f, session, hud);
    } else if (this.creating) this.chat.close();
    // While the console or the chat box is open, the screen under it is not built, so nothing clickable hides behind either.
    if (!this.console.open && !this.chat.open) this.buildModal(f, session, hud);
    // The screens over the rest, such as the name prompt, go over every other screen but under the console.
    if (!this.creating && !this.console.open && !this.takingAll()) this.buildOver(f, session, hud);
    // A screen, the chat box or a prompt that a keyboard would leave by Escape has a button for it by touch.
    if (plan && this.touchPlay && !this.wantsPointerLock && !this.hudHidden() && !this.dead && !this.console.open) this.touchShown |= layer!.touchClose(f, this.touchPlay);
    // The offer to unmute is over every screen, where a free pointer, a finger or the pad's focus reaches it.
    // Not while a finger types in the chat box, which has its place.
    if (this.settings.muted && !this.console.open && !(plan && this.chat.open)) unmuteButton(f, plan, layer?.pill ?? null, this.hudHidden() ? 0 : hud.compassBottom, this.hudHidden() ? null : hud);
    if (this.settings.debug) this.debug?.build(f);
    if (session) this.console.absorb(session);
    this.console.build(f);
    if (this.focusNext) { const node = f.find(this.focusNext); if (node) node.focus = true; this.focusNext = 0; }
  }

  /** What the screens of the list draw with the HUD while the body is played. */
  private buildPlay(f: UiFrame, session: ClientSession, hud: HudModel): void {
    f.inPlay = true;
    for (let i = 0; i < this.screens.length; i++) {
      const s = this.screens[i]!;
      if (!s.play) continue;
      f.owner = i;
      s.play(f, this.at(session, hud));
    }
    f.owner = -1;
    f.inPlay = false;
  }

  /** The open screen of the list that moves its own focus, if any. */
  private focusing(): Screen | null {
    for (const s of this.screens) if (s.focusNav && s.isOpen()) return s;
    return null;
  }

  /** Builds every open screen of the "over" layer, in the list's order. */
  private buildOver(f: UiFrame, session: ClientSession | null, hud: HudModel): void {
    for (let i = 0; i < this.screens.length; i++) {
      const s = this.screens[i]!;
      if (s.layer !== "over" || !s.isOpen()) continue;
      f.owner = i;
      s.build(f, this.at(session, hud));
    }
    f.owner = -1;
  }

  /** Builds the first open modal screen of the list; false where none is open. */
  private buildModal(f: UiFrame, session: ClientSession | null, hud: HudModel): boolean {
    for (let i = 0; i < this.screens.length; i++) {
      const s = this.screens[i]!;
      if (s.layer !== "modal" || !s.isOpen()) continue;
      f.owner = i;
      s.build(f, this.at(session, hud));
      f.owner = -1;
      return true;
    }
    return false;
  }
}
