// Screens write their nodes into `frame` every frame. The shell draws that list and sends events back here.

import type { HudModel } from "../hud.ts";
import type { ClientSession } from "../session.ts";
import { ConsoleState, KEY_CONSOLE_INPUT } from "./console.ts";
import type { Registry } from "../../../shared/content/registry.ts";
import { CharacterScreen } from "./character.ts";
import { ChatState, KEY_CHAT_INPUT, KEY_CHAT_SEND, KEY_CHAT_TAG } from "./chat.ts";
import { CreatorScreen } from "./creator.ts";
import { buildCombat } from "./combat.ts";
import { buildHud, chatBand, hotbarCell, hotbarLeft, hotbarTop } from "./hud.ts";
import type { TouchPlay } from "../touch.ts";
import { buildControls, KEY_CONTROL_GROUP, KEY_CONTROL_GLYPHS } from "./controls-help.ts";
import { CONTROL_GROUPS } from "./controls-guide.ts";
import { buildMenu, KEY_CONTROLS_DEVICE, KEY_MENU_BACK, KEY_MENU_CONTROLS, KEY_MENU_CREATIVE, KEY_MENU_LEAVE, KEY_MENU_OPEN, KEY_MENU_RESUME, KEY_MENU_SETTINGS, KEY_UNMUTE, menuLink, unmuteButton } from "./menu.ts";
import { CreativeScreen, KEY_CREATIVE_PASSWORD } from "./creative.ts";
import { InventoryScreen } from "./inventory.ts";
import { CANVAS_HEIGHT, K_SLIDER, UiFrame } from "./nodes.ts";
import { buildMap } from "./screens.ts";
import { ChoosingScreen, KEY_CHOOSE_FILTER } from "./choosing.ts";
import { Settings, toggleMonitor } from "../settings.ts";
import { buildSettings, settingsAdjust, settingsClick, settingsValue } from "./settings.ts";
import { KEY_STRUCT_NAME_INPUT, StructMenu } from "./structure.ts";
import { EmoteMenu } from "./emotes.ts";
import { KEY_NAME_INPUT, NamePrompt, buildOverhead } from "./tame.ts";
import { TravelScreen } from "./travel.ts";
import type { SiteLink } from "../travel.ts";
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
  readonly choosing = new ChoosingScreen();
  readonly structure = new StructMenu();
  readonly emotes = new EmoteMenu();
  readonly naming = new NamePrompt();
  /** The other servers of the cluster, opened at an obelisk's terminal. */
  readonly travel = new TravelScreen();
  /** The admin's tools, opened from the menu while the server shows creative mode. */
  readonly creativeScreen = new CreativeScreen();
  /** The session is in the creator, which is then the whole interface. */
  creating = false;
  /** Which screen is up. `options` is the settings screen. */
  map = false;
  character = false;
  options = false;
  menu = false;
  /** The Creative screen, within the menu. */
  creative = false;
  help = false;
  helpDevice = 0;
  helpGroup = 0;
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
  /** The resource monitor (ui/monitor.ts), which the app fetches once Diagnostics is first "monitor"; null until then. */
  monitor: import("./monitor.ts").Monitor | null = null;
  flyer = false;
  /** A piece is being built, or a vehicle set down: the touch cluster is then the builder's. The app sets both. */
  building = false;
  placing = false;
  /** Whether there is voice to talk on, and whether a creature is looked at: the app sets both, for the touch layer. */
  canTalk = false;
  creatureAhead = false;
  touchShown = 0;
  get touch(): boolean { return this.inputDevice === 2; }
  /** The resource monitor's panel is open, which is a screen: the mouse is free and the keyboard walks. */
  get monitorOpen(): boolean { return this.settings.monitor && this.monitor !== null && this.monitor.open; }
  inspect = false;
  reconnectRequested = false;
  leftWorld = false;
  /** The links the menu shows, as the page's server names them (links.json), and what opens one beside the game. */
  links: readonly SiteLink[] = [];
  openLink: ((url: string) => void) | null = null;
  menuFocus = KEY_MENU_RESUME;
  private focusNext = 0;
  private menuShift = false;
  readonly settings = new Settings();
  /** The session has no body and chooses where to rise, so the mouse is free. */
  private dead = false;
  /** The app sets both once it has them. */
  registry: Registry | null = null;
  palette: Uint8Array | null = null;
  /** A console line this client answers itself, without the server: the answer, or null for a line to send. */
  local: ((line: string) => string | null) | null = null;

  /** A text field has the keyboard, so keys must not also drive the body. */
  get captureKeyboard(): boolean {
    return this.menu || this.inspect || this.console.open || this.chat.open || this.naming.open || this.structure.naming || this.choosing.filtering;
  }

  /** A text field is wanted: the shell of a touch device raises its keyboard within the press that asked. */
  get typing(): boolean {
    return this.console.open || this.chat.open || this.naming.open || this.structure.naming || this.choosing.filtering;
  }

  /** True when the mouse should steer the camera, with the shell holding pointer lock. */
  get wantsPointerLock(): boolean {
    return !this.menu && !this.inspect && !this.console.open && !this.chat.open && !this.naming.open && !this.inventory.open && !this.map && !this.character && !this.options && !this.travel.open && !this.dead && !this.creating && !this.structure.open && !this.emotes.open && !this.monitorOpen;
  }

  openMenu(): void {
    this.menu = true;
    this.menuShift = false;
    this.inspect = false;
    this.help = this.options = this.creative = false;
    this.focusTo(KEY_MENU_RESUME);
  }

  private focusTo(key: number): void { this.menuFocus = this.focusNext = key; }

  private moveFocus(by: number): void {
    const keys = this.frame.nodes.slice(0, this.frame.count).filter((n) => n.interactive).map((n) => n.key);
    const at = keys.indexOf(this.menuFocus);
    if (keys.length) this.focusTo(keys[at < 0 ? (by > 0 ? 0 : keys.length - 1) : (at + by + keys.length) % keys.length]!);
  }

  navigate(direction: number): number {
    if (direction) this.moveFocus(direction);
    if (!this.frame.find(this.menuFocus)?.interactive) this.moveFocus(1);
    return this.menuFocus;
  }

  adjustFocused(by: number, end = false): boolean {
    if(this.console.open || this.chat.open || (!this.menu && !this.creating))return false;
    if(this.menu && this.creative)return !end && this.creativeScreen.adjust(this.menuFocus,by,this.menuShift);
    const n=this.frame.find(this.menuFocus);
    if(n?.kind===K_SLIDER) { this.input(n.key,String(end?(by>0?1:0):n.value+by*n.step)); return true; }
    return !end && this.options && settingsAdjust(this.menuFocus,by,this.settings);
  }

  /** Returns true if the interface used the key. The shell must then suppress the browser's own handling. */
  key(code: string, down: boolean, repeat: boolean, session: ClientSession | null): boolean {
    // The password's field has the keys a field types with; the menu keeps those that move between its controls.
    const typing = this.menu && this.creative && this.menuFocus === KEY_CREATIVE_PASSWORD;
    if (typing && !["Escape", "Tab", "Enter", "NumpadEnter", "ArrowUp", "ArrowDown", "ShiftLeft", "ShiftRight"].includes(code)) return false;
    if(down && ["ArrowLeft","ArrowRight","Home","End"].includes(code) && this.adjustFocused(code==="ArrowLeft"||code==="Home"?-1:1,code==="Home"||code==="End"))return true;
    if (this.menu) {
      if (code === "ShiftLeft" || code === "ShiftRight") this.menuShift = down;
      if (code === "Escape" && down && !repeat) {
        if (this.options || this.help) { this.options = this.help = false; this.focusTo(KEY_MENU_RESUME); }
        else if (this.creative) { this.creative = false; this.focusTo(KEY_MENU_CREATIVE); }
        else this.menu = false;
      }
      if (typing && down && !repeat && (code === "Enter" || code === "NumpadEnter")) { if (session) this.creativeScreen.submit(session); return true; }
      if (down && (code === "Tab" || code === "ArrowDown" || code === "ArrowUp")) this.moveFocus(code === "ArrowUp" || (code === "Tab" && this.menuShift) ? -1 : 1);
      // A key presses the middle of what has the focus, as the pad does, so a dial is not turned to where the key never was.
      const n = this.frame.find(this.menuFocus);
      if (down && !repeat && (code === "Enter" || code === "Space" || code === "NumpadEnter")) this.pointer(0, this.menuFocus, n ? n.x + n.w / 2 : 0, n ? n.y + n.h / 2 : 0, 0, session);
      return true;
    }
    const con = this.console;
    const chat = this.chat;
    if(this.creating && !con.open) {
      if(code==="ShiftLeft" || code==="ShiftRight")this.menuShift=down;
      if(code==="Tab") { if(down)this.moveFocus(this.menuShift?-1:1); return true; }
    }
    // The name prompt has the keyboard until it is answered.
    if (this.naming.open && !con.open) return this.naming.key(code, down, repeat, session);
    if (this.structure.naming && !con.open) return this.structure.key(code, down, repeat, session);
    if (this.choosing.filtering && !con.open) return this.choosing.key(code, down, repeat);
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
      if (code === "KeyH" && (this.inspect || this.wantsPointerLock)) { this.inspect = down; return true; }
      if (code === "Escape" && this.inspect) { if (down && !repeat) this.inspect = false; return true; }
      if (code === "KeyL" && (this.inspect || this.wantsPointerLock)) { if (down && !repeat) { this.settings.minimap = !this.settings.minimap; this.settings.changed(); } return true; }
      if (code === "F3") { if (down && !repeat) toggleMonitor(this.settings); return true; }
      if (code === "Escape" && this.monitorOpen) { if (down && !repeat) this.monitor!.open = false; return true; }
      // The structure menu takes its digits and Escape. Opening any other screen closes it.
      if (this.structure.key(code, down, repeat, session)) return true;
      // The emote menu likewise, and Z opens it from play.
      if (this.emotes.key(code, down, repeat, session)) return true;
      if (code === "KeyZ" && this.wantsPointerLock && !this.creating) {
        if (down && !repeat) this.emotes.toggle();
        return true;
      }
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
          this.inspect = false;
          if (options) { this.menu = true; this.focusTo(KEY_MENU_BACK); }
          this.travel.open = false;
          if (inventory) this.inventory.open = true;
          else this.inventory.close(session);
        }
        return true;
      }
      if (code === "Escape") {
        if (down && !repeat) this.openMenu();
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
  pointer(kind: number, key: number, x: number, y: number, button: number, session: ClientSession | null): void {
    if (key === KEY_UNMUTE) { if (kind === 0 && button === 0) { this.settings.muted = false; this.settings.changed(); } return; }
    if(this.frame.find(key)?.kind===K_SLIDER) { if(kind===0 && button===0)this.focusTo(key); return; }
    if (this.menu) {
      if (kind === 2 && this.frame.find(key)?.interactive) this.menuFocus = key;
      if (this.creative && session && (kind !== 0 || button === 0) && this.creativeScreen.pointer(kind, key, x, y, session)) {
        if (kind === 0 && this.frame.find(key)?.interactive) this.focusTo(key);
        return;
      }
      if (kind === 0 && button === 0) {
        if(this.frame.find(key)?.interactive)this.focusTo(key);
        if (key === KEY_MENU_RESUME) { if (session?.state === "closed") this.reconnectRequested = true; else this.menu = false; }
        else if (key === KEY_MENU_CREATIVE && session?.creative) { this.creative = true; this.focusTo(this.creativeScreen.first(session)); }
        else if (key === KEY_MENU_SETTINGS) { this.options = true; this.focusTo(KEY_MENU_BACK); }
        else if (key === KEY_MENU_CONTROLS) { this.help = true; this.helpDevice = this.inputDevice; this.focusTo(KEY_MENU_BACK); }
        else if (key === KEY_MENU_BACK) { this.focusTo(this.creative ? KEY_MENU_CREATIVE : KEY_MENU_RESUME); this.options = this.help = this.creative = false; }
        else if (key === KEY_MENU_LEAVE) { session?.close(); this.leftWorld=true; this.focusTo(KEY_MENU_RESUME); }
        else if (!this.options && !this.help && !this.creative) { const url = menuLink(key, this.links); if (url !== null) this.openLink?.(url); }
        else if (this.help && key >= KEY_CONTROLS_DEVICE && key <= KEY_CONTROLS_DEVICE + 2) this.helpDevice = key - KEY_CONTROLS_DEVICE;
        else if (this.help && key >= KEY_CONTROL_GROUP && key < KEY_CONTROL_GROUP + CONTROL_GROUPS.length) this.helpGroup=key-KEY_CONTROL_GROUP;
        else if (this.help && key === KEY_CONTROL_GLYPHS) { this.settings.padGlyphs=1-this.settings.padGlyphs; this.settings.changed(); }
        else if (this.options) settingsClick(key, this.settings);
      }
      return;
    }
    if (kind === 0 && key === KEY_MENU_OPEN) {
      this.openMenu();
      return;
    }
    if (kind === 0 && this.monitor?.click(key, x, y)) return;
    if (!session || this.console.open) return;
    if (kind === 0 && key === KEY_CHAT_TAG) {
      this.chat.cycle(session);
      return;
    }
    if (kind === 0 && key === KEY_CHAT_SEND) {
      this.chat.submit(session);
      return;
    }
    if (this.creating) {
      this.creator.pointer(kind, key, session);
      return;
    }
    if (kind === 0 && key !== 0) this.hear?.("click");
    if (kind === 0 && this.choosing.click(key, x, y, session)) return;
    if (kind === 0 && this.structure.click(key, session)) return;
    if (kind === 0 && this.emotes.click(key, session)) return;
    if (kind === 0 && this.character && this.registry && this.sheet.click(key, session, this.registry)) return;
    if (kind === 0 && this.options && settingsClick(key, this.settings)) return;
    if (kind === 0 && this.travel.open && this.travel.click(key, session)) return;
    if (this.inventory.open) this.inventory.pointer(kind, key, button, session);
  }

  input(key: number, value: string): void {
    const n=this.frame.find(key);
    if(n?.kind===K_SLIDER) {
      if(value.trim()==="" || !Number.isFinite(Number(value)))return;
      const v=Math.max(0,Math.min(1,Math.round(Number(value)/n.step)*n.step));
      if(this.options?settingsValue(key,v,this.settings):this.creating && this.creator.value(key,v))n.value=v;
      return;
    }
    if (key === KEY_CREATIVE_PASSWORD) this.creativeScreen.edit(value);
    else if (key === KEY_NAME_INPUT) this.naming.edit(value);
    else if (key === KEY_STRUCT_NAME_INPUT) this.structure.edit(value);
    else if (key === KEY_CHOOSE_FILTER) this.choosing.edit(value);
    else if (key === KEY_CONSOLE_INPUT) this.console.edit(value);
    else if (key === KEY_CHAT_INPUT) this.chat.edit(value);
  }

  build(aspect: number, hud: HudModel, session: ClientSession | null): void {
    const f = this.frame;
    f.begin(aspect, this.canvasHeight);
    const layer = this.touch ? this.layer : null;
    const plan = layer ? layer.touchPlan(f, this.settings.muted, this.canTalk) : null;
    this.inventory.touch = this.touch;
    this.touchShown = 0;
    this.creating = session?.sessionState === SESSION_CREATING;
    this.dead = session?.sessionState === SESSION_DEAD;
    // A survivor still in the creator has no vitals, no position and nothing to aim at.
    if (session) this.chat.absorb(session);
    if (!this.creating && !this.menu) {
      const controls = (this.wantsPointerLock || this.inspect) && !session?.open;
      // A finger's zones lie under the whole HUD while the body is being played.
      const play = plan !== null && this.touchPlay !== null && session !== null && controls && this.wantsPointerLock;
      if (play) layer!.touchZones(f);
      // Marks over creatures are under the rest of the HUD.
      buildOverhead(f, hud.overhead);
      hud.bare = this.map || this.dead;
      // The resource monitor takes its room in the HUD's top-left column, and stands in it.
      const monitor = this.settings.monitor ? this.monitor : null;
      if (monitor) monitor.reserve(f, hud, plan);
      else this.monitor?.off(hud);
      buildHud(f, hud, this.settings, controls, this.inspect, plan);
      monitor?.build(f, hud, controls, this.inspect, plan);
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
    } else if (this.creating) this.chat.close();
    // While the console or the chat box is open, the screen under it is not built, so nothing clickable hides behind either.
    if (this.dead || this.creating) this.structure.close();
    // The filter is for one spell of choosing.
    if (!this.dead && (this.choosing.filtering || this.choosing.filter !== "")) {
      this.choosing.filtering = false;
      this.choosing.edit("");
    }
    // The Creative entry follows the server's rule, and so does the screen if it was open.
    if (this.creative && !session?.creative) { this.creative = false; this.focusTo(KEY_MENU_RESUME); }
    const creative = this.menu && this.creative && !this.console.open && !this.chat.open;
    if (session) this.creativeScreen.pump(session, creative);
    if (!this.console.open && !this.chat.open) {
      if (this.menu) {
        if (this.options) {
          buildSettings(f, this.settings, hud.micLevel, this.menuFocus);
        } else if (this.help) buildControls(f, this.helpDevice, this.menuFocus, this.helpGroup, this.settings.padGlyphs);
        else if (creative && session) {
          this.creativeScreen.build(f, session, hud, this.menuFocus);
          // The password's field gives way to the tools once the server has given the role.
          if (!f.find(this.menuFocus)?.interactive && !this.focusNext) this.focusTo(this.creativeScreen.first(session));
        } else buildMenu(f, hud, session?.state === "active", this.menuFocus, this.links, session?.creative ?? false);
      } else if (this.creating && session) this.creator.build(f, this.palette, session.name);
      else if (this.dead && session) this.choosing.build(f, session, hud);
      else if (this.map && session) buildMap(f, session, hud);
      else if (this.character && session && this.registry) this.sheet.build(f, session, this.registry);
      else if (this.options) buildSettings(f, this.settings, hud.micLevel);
      else if (this.travel.open && session) this.travel.build(f, session);
      else if (this.monitorOpen && !this.inventory.open) this.monitor!.panel(f, plan, hud, this.settings.muted);
      else {
        this.inventory.build(f, session, this.registry, this.palette);
        if (session && this.registry && !this.inventory.open) this.structure.build(f, session, this.registry);
        if (session && !this.inventory.open) this.emotes.build(f);
      }
    }
    // The name prompt goes over every other screen, but under the console.
    if (session && this.registry && !this.creating) {
      this.naming.absorb(session);
      if (!this.console.open && !this.menu) this.naming.build(f, session, this.registry);
    }
    // A screen, the chat box or a prompt that a keyboard would leave by Escape has a button for it by touch.
    if (plan && this.touchPlay && !this.wantsPointerLock && !this.menu && !this.creating && !this.dead && !this.console.open) this.touchShown |= layer!.touchClose(f, this.touchPlay);
    // The offer to unmute is over every screen, where a free pointer, a finger or the pad's focus reaches it.
    // Not while a finger types in the chat box, which has its place.
    if (this.settings.muted && !this.console.open && !(plan && this.chat.open)) unmuteButton(f, plan, layer?.pill ?? null, this.creating || this.menu ? 0 : hud.compassBottom, this.creating || this.menu ? null : hud);
    if (session) this.console.absorb(session);
    this.console.build(f);
    if (this.focusNext) { const node = f.find(this.focusNext); if (node) node.focus = true; this.focusNext = 0; }
  }
}
