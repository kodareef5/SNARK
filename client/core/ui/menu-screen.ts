// The game's menu as a row of SCREENS: the menu itself, and the pages it holds (settings, controls, creative). Escape
// brings it up, and while it is up it takes every key and press before anything else. O opens settings alone.

import { CONTROL_GROUPS } from "./controls-guide.ts";
import { buildControls, KEY_CONTROL_GLYPHS, KEY_CONTROL_GROUP } from "./controls-help.ts";
import { CreativeScreen, KEY_CREATIVE_PASSWORD } from "./creative.ts";
import { buildMenu, KEY_CONTROLS_DEVICE, KEY_MENU, KEY_MENU_BACK, KEY_MENU_CONTROLS, KEY_MENU_CREATIVE, KEY_MENU_LEAVE, KEY_MENU_RESUME, KEY_MENU_SETTINGS, menuLink } from "./menu.ts";
import { K_INPUT, K_SECRET, K_SLIDER, type UiFrame } from "./nodes.ts";
import type { Screen, ScreenCtx } from "./screen.ts";
import { buildSettings, KEY_SETTINGS_PANEL, KEY_SETTINGS_PARTS, KEY_SETTINGS_ROW, KEY_SETTINGS_TAB, MOST_SETTING_TABS, settingsAdjust, settingsClick, settingsPart, settingsValue } from "./settings.ts";
import { PART_KEYS } from "./screen.ts";
import type { StoragePage } from "./storage.ts";
import type { SiteLink } from "../travel.ts";

/** Keys the creative password's field types with, which the menu does not take from it. */
const FIELD_KEEPS = ["Escape", "Tab", "Enter", "NumpadEnter", "ArrowUp", "ArrowDown", "ShiftLeft", "ShiftRight"];

export class MenuScreen implements Screen {
  readonly name = "menu";
  readonly layer = "modal";
  readonly group = "bag";
  /** O opens the settings, with the menu under them. */
  readonly hotkey = "KeyO";
  /** The bag's sounds call it by the page O opens. */
  readonly sound = "options";
  readonly bands = [
    { from: KEY_SETTINGS_TAB, count: KEY_SETTINGS_PANEL + 10 - KEY_SETTINGS_TAB },
    { from: KEY_SETTINGS_ROW, count: 4 * 32 },
    { from: KEY_MENU - 2, count: 5600 - KEY_MENU + 2 },
    { from: 5600, count: 400 },
    { from: 7000, count: 200 },
    // The storage page's (storage.ts), to 8101.
    { from: 8000, count: 200 },
    // The keys of the settings page's parts (settings.ts KEY_SETTINGS_PARTS).
    { from: KEY_SETTINGS_PARTS, count: MOST_SETTING_TABS * PART_KEYS },
    // The keyboard's and the pad's pictures on the controls page (keyboard.ts, controller.ts).
    { from: 3100000, count: 20000 },
    { from: 3200000, count: 1000 },
  ];
  /** The menu is up. `options` is the settings page, which O can open alone. */
  menu = false;
  options = false;
  help = false;
  helpDevice = 0;
  helpGroup = 0;
  /** The Creative page, within the menu. */
  creative = false;
  /** The admin's tools, opened from the menu while the server shows creative mode. */
  readonly creativeScreen = new CreativeScreen();
  /** The Storage tab's page (ui/storage.ts), which the app fetches after the first frame. */
  storage: StoragePage | null = null;
  /** The links the menu shows, as the page's server names them (links.json), and what opens one beside the game. */
  links: readonly SiteLink[] = [];
  openLink: ((url: string) => void) | null = null;
  /** Asked from the menu, for the app: load the page again, or go back to the roster. */
  reconnectRequested = false;
  leftWorld = false;
  private shift = false;

  isOpen(): boolean {
    return this.menu || this.options;
  }

  /** While the menu is up it holds every key. */
  get holdsKeys(): boolean {
    return this.menu;
  }

  takesAll(): boolean {
    return this.menu;
  }

  hidesHud(): boolean {
    return this.menu;
  }

  /** Escape with nothing else to close, and the HUD's menu button, bring it up at its first page. */
  escape(c: ScreenCtx): void {
    this.menu = true;
    this.shift = false;
    this.help = this.options = this.creative = false;
    c.focusTo(KEY_MENU_RESUME);
  }

  /** O: the settings, with the menu under them. */
  show(c: ScreenCtx): void {
    this.options = true;
    this.menu = true;
    c.focusTo(KEY_MENU_BACK);
  }

  close(): void {
    this.menu = this.options = this.help = this.creative = false;
  }

  /** The Creative entry follows the server's rule, and so does the page if it was open. */
  absorb(c: ScreenCtx): void {
    if (this.creative && !c.session?.creative) {
      this.creative = false;
      c.focusTo(KEY_MENU_RESUME);
    }
    if (c.session) this.creativeScreen.pump(c.session, this.menu && this.creative && !c.covered);
  }

  key(code: string, down: boolean, repeat: boolean, c: ScreenCtx): boolean {
    const session = c.session;
    // A focused field, the password's or a part's, has the keys a field types with; the menu keeps those that move between its controls.
    const typing = this.creative && c.focus === KEY_CREATIVE_PASSWORD, kind = c.frame.find(c.focus)?.kind;
    if ((typing || kind === K_INPUT || kind === K_SECRET) && !FIELD_KEEPS.includes(code)) return false;
    if (down && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(code) && c.adjust(code === "ArrowLeft" || code === "Home" ? -1 : 1, code === "Home" || code === "End")) return true;
    if (code === "ShiftLeft" || code === "ShiftRight") this.shift = down;
    if (code === "Escape" && down && !repeat) {
      if (this.options || this.help) {
        this.options = this.help = false;
        c.focusTo(KEY_MENU_RESUME);
      } else if (this.creative) {
        this.creative = false;
        c.focusTo(KEY_MENU_CREATIVE);
      } else this.menu = false;
    }
    if (typing && down && !repeat && (code === "Enter" || code === "NumpadEnter")) {
      if (session) this.creativeScreen.submit(session);
      return true;
    }
    if (down && (code === "Tab" || code === "ArrowDown" || code === "ArrowUp")) c.moveFocus(code === "ArrowUp" || (code === "Tab" && this.shift) ? -1 : 1);
    // A key presses the middle of what has the focus, as the pad does, so a dial is not turned to where the key never was.
    const n = c.frame.find(c.focus);
    if (down && !repeat && (code === "Enter" || code === "Space" || code === "NumpadEnter")) c.press(c.focus, n ? n.x + n.w / 2 : 0, n ? n.y + n.h / 2 : 0);
    return true;
  }

  /** Left and right on the focused control. Undefined leaves it to a slider. */
  adjust(key: number, by: number, end: boolean, c: ScreenCtx): boolean | undefined {
    if (this.menu && this.creative) return !end && this.creativeScreen.adjust(key, by, this.shift);
    const part = this.options ? settingsPart(key, c.settings) : null;
    if (part === "stale") return false;
    // Undefined from the part leaves the step to a slider, as the page's own rows do.
    if (part) return part.part.adjust ? part.part.adjust(part.local, by, end, c) : undefined;
    if (c.frame.find(key)?.kind === K_SLIDER) return undefined;
    return !end && this.options && settingsAdjust(key, by, c.settings);
  }

  pointer(kind: number, key: number, x: number, y: number, button: number, c: ScreenCtx): boolean {
    const session = c.session, interactive = c.frame.find(key)?.interactive === true;
    // A part of the settings page has its own presses, and none once its tab has been left.
    const part = this.options ? settingsPart(key, c.settings) : null;
    if (part === "stale") return true;
    if (part) {
      if (kind === 2 && interactive) c.hover(key);
      if (kind === 0 && interactive) c.focusTo(key);
      part.part.pointer?.(kind, part.local, x, y, button, c);
      return true;
    }
    if (!this.menu) return kind === 0 && this.options && settingsClick(key, c.settings);
    if (kind === 2 && interactive) c.hover(key);
    if (this.creative && session && (kind !== 0 || button === 0) && this.creativeScreen.pointer(kind, key, x, y, session)) {
      if (kind === 0 && interactive) c.focusTo(key);
      return true;
    }
    if (kind !== 0 || button !== 0) return true;
    if (interactive) c.focusTo(key);
    if (key === KEY_MENU_RESUME) {
      if (session?.state === "closed") this.reconnectRequested = true;
      else this.menu = false;
    } else if (key === KEY_MENU_CREATIVE && session?.creative) {
      this.creative = true;
      c.focusTo(this.creativeScreen.first(session));
    } else if (key === KEY_MENU_SETTINGS) {
      this.options = true;
      c.focusTo(KEY_MENU_BACK);
    } else if (key === KEY_MENU_CONTROLS) {
      this.help = true;
      this.helpDevice = c.inputDevice;
      c.focusTo(KEY_MENU_BACK);
    } else if (key === KEY_MENU_BACK) {
      c.focusTo(this.creative ? KEY_MENU_CREATIVE : KEY_MENU_RESUME);
      this.options = this.help = this.creative = false;
    } else if (key === KEY_MENU_LEAVE) {
      session?.close();
      this.leftWorld = true;
      c.focusTo(KEY_MENU_RESUME);
    } else if (!this.options && !this.help && !this.creative) {
      const url = menuLink(key, this.links);
      if (url !== null) this.openLink?.(url);
    } else if (this.help && key >= KEY_CONTROLS_DEVICE && key <= KEY_CONTROLS_DEVICE + 2) this.helpDevice = key - KEY_CONTROLS_DEVICE;
    else if (this.help && key >= KEY_CONTROL_GROUP && key < KEY_CONTROL_GROUP + CONTROL_GROUPS.length) this.helpGroup = key - KEY_CONTROL_GROUP;
    else if (this.help && key === KEY_CONTROL_GLYPHS) {
      c.settings.padGlyphs = 1 - c.settings.padGlyphs;
      c.settings.changed();
    } else if (this.options && !settingsClick(key, c.settings)) this.storage?.click(key, c.settings);
    return true;
  }

  text(key: number, value: string, c: ScreenCtx): boolean {
    const part = this.options ? settingsPart(key, c.settings) : null;
    if (part === "stale") return true;
    if (part) return part.part.text?.(part.local, value, c) ?? false;
    if (key !== KEY_CREATIVE_PASSWORD) return false;
    this.creativeScreen.edit(value);
    return true;
  }

  value(key: number, value: number, c: ScreenCtx): boolean {
    if (!this.options) return false;
    const part = settingsPart(key, c.settings);
    if (part === "stale") return false;
    if (part) return part.part.value?.(part.local, value, c) ?? false;
    return settingsValue(key, value, c.settings);
  }

  build(f: UiFrame, c: ScreenCtx): void {
    const session = c.session, hud = c.hud;
    if (!hud) return;
    if (!this.menu) return buildSettings(f, c.settings, hud.micLevel, 0, null, c);
    if (this.options) buildSettings(f, c.settings, hud.micLevel, c.focus, this.storage, c);
    else if (this.help) buildControls(f, this.helpDevice, c.focus, this.helpGroup, c.settings.padGlyphs);
    else if (this.creative && session) {
      this.creativeScreen.build(f, session, hud, c.focus);
      // The password's field gives way to the tools once the server has given the role.
      if (!f.find(c.focus)?.interactive && !c.focusPending) c.focusTo(this.creativeScreen.first(session));
    } else buildMenu(f, hud, session?.state === "active", c.focus, this.links, session?.creative ?? false);
  }
}
