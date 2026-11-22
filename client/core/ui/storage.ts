// The Storage tab of the settings: what the game has saved on this device, what is still to download for the chosen
// graphics level, and what the graphics card holds, with Download all, Pause, Resume and Delete saved files. The page
// draws in the settings panel's glass with words, the fill bar and glass buttons; the numbers and the presses are
// assets/keeping.ts's. It comes as its own file after the first frame, and until it has come the tab is empty.
//
// One column where the panel is tall enough, as on a desktop or a phone upright; on a phone on its side the device's
// block goes left and the download and the graphics card right, so nothing pages.
//
// It imports nothing the first frame's script holds but types: the bundler would split that script into more files to
// share it, which cost the first frame 3 KB (D906). The app hands it the three functions it draws with (StorageKit), and
// it keeps its own copy of the few numbers it uses, which tests/ui/storage-page.test.ts holds equal to the real ones.

import type { Settings } from "../settings.ts";
import type { SoundLibrary } from "../sound/library.ts";
import { Keeping, type KeepState, type StorageView } from "../assets/keeping.ts";
import type { AssetPort } from "../assets/port.ts";
import type { Residency } from "../assets/residency.ts";
import type { Tier } from "../assets/tiers.ts";
import type { textWidth as TextWidth, UiFrame, wrapText as WrapText } from "./nodes.ts";
import type { glass as Glass } from "./skin.ts";
import type { Ui } from "./ui.ts";

/** What the page draws with from the first frame's script. */
export interface StorageKit {
  textWidth: typeof TextWidth;
  wrapText: typeof WrapText;
  glass: typeof Glass;
}

/** nodes.ts K_PANEL, K_BAR and K_BUTTON; style.ts's styles; ui/settings.ts STORAGE_TAB. */
export const COPIED = { K_PANEL: 0, K_BAR: 2, K_BUTTON: 5, S_OXYGEN: 12, S_MENU_NOTE: 50, S_HUD_HIT: 51, S_HUD_KEY: 52, S_HUD_COUNT: 53, S_ICE: 54, STORAGE_TAB: 4 } as const;
const { K_PANEL, K_BAR, K_BUTTON, S_OXYGEN, S_MENU_NOTE, S_HUD_HIT, S_HUD_KEY, S_HUD_COUNT, S_ICE, STORAGE_TAB } = COPIED;

/** The left button (Download all, Pause, Resume, or Keep while Delete asks) and the right (Delete saved files, or Delete). */
export const KEY_STORAGE_PRIMARY = 8100;
export const KEY_STORAGE_DELETE = 8101;
const KEY = 8000;
/**
 * Where painted art can come in later: the meter rail's height, and an icon before each heading and on each button,
 * this many units a side (0 for none yet: words alone).
 */
export const RAIL_HEIGHT = 6;
export const ICON_SIZE = 0;
/** A line of words, a heading with the gap under it, the gap after a row, a rule with the space round it. */
const LINE = 18;
const HEAD = 22;
const GAP = 8;
const RULE = 17;
/** Buttons by mouse and by finger; a column narrower than HALVES shares its width between the two. */
const BUTTON = 36;
const BUTTON_TOUCH = 44;
const HALVES = 400;
/** The space between the two columns on a short panel. */
const COLUMNS_GAP = 32;

const TIER_NAME: Readonly<Record<Tier["name"], string>> = { lowpoly: "Low poly", medium: "Medium", high: "High", ultra: "Ultra" };
const STATES: readonly KeepState[] = ["built", "none", "confirm", "full", "done", "over", "downloading", "paused", "idle"];
const MB = 1024 * 1024;

/** Bytes in words: "640 KB", "3.5 MB", "812 MB", "1.1 GB", "24 GB". */
export function bytesText(n: number): string {
  if (n >= 1000 * MB) return `${(n / (1024 * MB)).toFixed(n >= 10 * 1024 * MB ? 0 : 1)} GB`;
  if (n >= MB) return n >= 10 * MB ? `${Math.round(n / MB)} MB` : `${(n / MB).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** Seconds left in words. */
export function leftText(seconds: number): string {
  if (seconds < 60) return "less than a minute left";
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} min left`;
  return `about ${Math.round(seconds / 3600)} h left`;
}

/** The download's line, as parts to be joined by " · " and broken between them where they do not fit. */
export function downloadLine(v: StorageView): string[] {
  const tier = TIER_NAME[v.tier], done = v.total !== null && v.missing !== null ? v.total - v.missing : null;
  switch (v.state) {
    case "built": return ["Everything is built in. Nothing to download."];
    case "none": return ["This browser is not saving files for the game. A private window saves nothing. Files download again each visit."];
    case "confirm": return [`Delete ${bytesText(v.saved)}? They download again as you play.`];
    case "full": return ["Stopped: this device is out of space."];
    case "done": return [`All saved for ${tier} graphics.`];
    case "over": return [`Needs ${bytesText(v.total ?? v.saved)}; the game keeps ${bytesText(v.limit)}. Older files will make way as you play.`];
    case "paused": return [done === null ? "Paused. The game still downloads what you walk up to." : `Paused at ${bytesText(done)} of ${bytesText(v.total!)}. The game still downloads what you walk up to.`];
    case "downloading": {
      const parts = [done === null ? "Downloading" : `Downloading ${bytesText(done)} of ${bytesText(v.total!)}`];
      if (v.rate > 0) parts.push(`${bytesText(v.rate)}/s`);
      if (v.left !== null) parts.push(leftText(v.left));
      return parts;
    }
    case "idle": return [`Download everything for ${tier} graphics now, so the game does not wait for it later.`];
  }
}

interface Button {
  text: string;
  label: string;
  on: boolean;
}

/** The two buttons as the download stands. */
export function storageButtons(v: StorageView, keepAll: boolean): [Button | null, Button | null] {
  const remove: Button | null = v.saved > 0 ? { text: "Delete saved files", label: "Delete saved files: press again to confirm", on: true } : null;
  switch (v.state) {
    case "built": return [null, null];
    case "none": return [{ text: "Download all", label: "Download all: this browser saves nothing", on: false }, null];
    case "confirm": return [{ text: "Keep", label: "Keep the saved files", on: true }, { text: "Delete", label: `Delete ${bytesText(v.saved)} of saved files`, on: true }];
    case "full":
    case "paused": return [{ text: "Resume", label: "Resume the download", on: true }, remove];
    case "downloading": return [{ text: "Pause", label: "Pause the download", on: true }, remove];
    case "done": return [null, remove];
    case "over": return [keepAll ? null : { text: "Download all", label: "Download all that fits", on: true }, remove];
    case "idle": return [{ text: "Download all", label: `Download all for ${TIER_NAME[v.tier]} graphics`, on: true }, remove];
  }
}

/** Lays out from (x, y) in a column `w` wide, adding nodes to `f`, or with `f` null only measuring. */
class Pen {
  f: UiFrame | null;
  x: number;
  y: number;
  w: number;
  private readonly kit: StorageKit;
  constructor(kit: StorageKit, f: UiFrame | null, x: number, y: number, w: number) {
    this.kit = kit;
    this.f = f;
    this.x = x;
    this.y = y;
    this.w = w;
  }

  /** Units across `text` takes, rounded up. */
  width(text: string, style: number): number {
    return Math.ceil(this.kit.textWidth(text, style));
  }

  head(key: number, text: string): void {
    this.f?.text(key, this.x + ICON_SIZE, this.y, this.width(text, S_HUD_KEY), S_HUD_KEY, text);
    this.y += HEAD;
  }

  /**
   * A label on the left and its value on the right, the value under it where they do not fit side by side. With a
   * note, `whole` is the value and the note in one where that fits, else the note goes under in lines of its own.
   */
  row(key: number, label: string, value: string, note = "", whole = ""): void {
    const lw = this.width(label, S_MENU_NOTE), one = whole !== "" && lw + 16 + this.width(whole, S_HUD_COUNT) <= this.w ? whole : value;
    const vw = this.width(one, S_HUD_COUNT), beside = lw + 16 + vw <= this.w;
    this.f?.text(key, this.x, this.y, lw, S_MENU_NOTE, label);
    // The value's smaller face sits a unit lower, so the two share a baseline.
    this.f?.text(key + 1, this.x + this.w - vw, this.y + (beside ? 1 : LINE + 1), vw, S_HUD_COUNT, one);
    this.y += beside ? LINE : 2 * LINE;
    if (note !== "" && one !== whole) this.words(key + 2, [note], true);
    this.y += GAP;
  }

  /** The fill bar, with its note to its right where there is room, else under it. */
  bar(key: number, value: number, note = ""): void {
    const nw = note === "" ? 0 : this.width(note, S_MENU_NOTE), beside = note !== "" && this.w - nw - 16 >= 120;
    const f = this.f;
    if (f) f.add(key, K_BAR, this.x, this.y + (LINE - RAIL_HEIGHT) / 2, beside ? this.w - nw - 16 : this.w, RAIL_HEIGHT, S_OXYGEN).value = Math.max(0, Math.min(1, value));
    if (note !== "") this.f?.text(key + 1, beside ? this.x + this.w - nw : this.x, beside ? this.y : this.y + LINE, nw, S_MENU_NOTE, note);
    this.y += note !== "" && !beside ? 2 * LINE + GAP : LINE + GAP;
  }

  /** `parts` joined by " · " in lines as wide as the column, broken between parts where they do not fit, and a part too long wrapped. */
  lines(parts: readonly string[]): string[] {
    const lines: string[] = [];
    for (const part of parts) {
      const last = lines.length - 1;
      if (last >= 0 && this.kit.textWidth(`${lines[last]} · ${part}`, S_MENU_NOTE) <= this.w) lines[last] = `${lines[last]} · ${part}`;
      else this.kit.wrapText(part, this.w, S_MENU_NOTE, lines);
    }
    return lines;
  }

  /** Lines of words (`lines`), taking the room of at least `least` lines. */
  words(key: number, parts: readonly string[], dim = false, least = 0): void {
    const lines = this.lines(parts);
    lines.forEach((line, i) => {
      const n = this.f?.text(key + i, this.x, this.y + i * LINE, this.width(line, S_MENU_NOTE), S_MENU_NOTE, line);
      if (n && dim) n.alpha = 0.7;
    });
    this.y += Math.max(least, lines.length) * LINE;
  }

  rule(key: number): void {
    const n = this.f?.add(key, K_PANEL, this.x, this.y + GAP, this.w, 1, S_ICE);
    if (n) n.alpha = 0.3;
    this.y += RULE;
  }

  buttons(left: Button | null, right: Button | null, touch: boolean, focus: number): void {
    if (!left && !right) return;
    const h = touch ? BUTTON_TOUCH : BUTTON, half = this.w < HALVES;
    const lw = half ? (this.w - 12) / 2 : 160, rw = half ? (this.w - 12) / 2 : 190;
    if (left) this.button(KEY_STORAGE_PRIMARY, this.x, lw, h, left, focus);
    if (right) this.button(KEY_STORAGE_DELETE, this.x + this.w - rw, rw, h, right, focus);
    this.y += h + GAP;
  }

  /** A pane of the HUD's glass with its words, and an ice line under them, bright while it has the focus. */
  private button(key: number, x: number, w: number, h: number, b: Button, focus: number): void {
    const f = this.f;
    if (!f) return;
    this.kit.glass(f, key, x, this.y, w, h, b.on ? 1 : 0.4);
    const n = f.add(key, K_BUTTON, x, this.y, w, h, S_HUD_HIT);
    n.text = b.text;
    n.label = b.label;
    n.interactive = b.on;
    n.alpha = b.on ? 1 : 0.4;
    if (b.on) f.add(90000 + key, K_PANEL, x + 14, this.y + h - 7, w - 28, focus === key ? 2 : 1, S_ICE).alpha = focus === key ? 1 : 0.45;
  }
}

export class StoragePage {
  readonly keeping = new Keeping();
  /** The last thing used was a finger: the buttons are finger-sized. Set by `step`. */
  touch = false;
  readonly kit: StorageKit;

  constructor(kit: StorageKit) {
    this.kit = kit;
  }

  /** Once a frame, from the app: what the page shows, and what the port is told. `tier` is the chosen one, as this device draws it. */
  step(ui: Ui, tier: Tier, port: AssetPort | null, r: Residency | null, sounds: SoundLibrary | null, now: number): void {
    this.touch = ui.touch;
    this.keeping.step(ui.settings, tier, ui.menu && ui.options, ui.menu && ui.options && ui.settings.tab === STORAGE_TAB, port, r, sounds, now);
  }

  /** Draws the tab in the settings panel at `x`, `y`, `w` by `h`, under its tabs. */
  build(f: UiFrame, s: Settings, x: number, y: number, w: number, h: number, focus: number): void {
    const top = y + 112, inner = w - 48, room = h - 112 - 16;
    if (this.blocks(null, s, x + 24, top, inner, 0, focus, false) <= room || w < 580) {
      this.blocks(f, s, x + 24, top, inner, 0, focus, false);
      return;
    }
    // Side by side: the device on the left, the download and the card on the right, a rule between.
    const cw = (inner - COLUMNS_GAP) / 2, used = this.blocks(f, s, x + 24, top, cw, cw + COLUMNS_GAP, focus, true);
    f.add(KEY + 92, K_PANEL, x + 24 + cw + COLUMNS_GAP / 2, top, 1, used, S_ICE).alpha = 0.3;
  }

  /** A press on one of the page's buttons. False for any other key. */
  click(key: number, s: Settings): boolean {
    if (key === KEY_STORAGE_PRIMARY) this.keeping.primary(s);
    else if (key === KEY_STORAGE_DELETE) this.keeping.remove();
    else return false;
    return true;
  }

  /**
   * The page's three blocks from (x, y) in columns `w` wide, or with `f` null their height measured. Side by side, the
   * second and third go `shift` to the right and start at the top again. Returns the height the taller column takes.
   */
  private blocks(f: UiFrame | null, s: Settings, x: number, y: number, w: number, shift: number, focus: number, side: boolean): number {
    const v = this.keeping.view, tier = TIER_NAME[v.tier], p = new Pen(this.kit, f, x, y, w);
    p.head(KEY, "ON THIS DEVICE");
    p.row(KEY + 2, "Saved game files", v.saved > 0 ? bytesText(v.saved) : v.state === "none" ? "none" : "none yet");
    p.bar(KEY + 6, v.limit > 0 ? v.saved / v.limit : 0, `of ${bytesText(v.limit)} the game keeps`);
    p.row(KEY + 10, `Still to download for ${tier} graphics`, v.state === "built" ? "nothing" : v.missing === null ? "counting…" : v.missing === 0 ? "nothing: all saved" : `about ${bytesText(v.missing)}`);
    p.row(KEY + 14, "Room this browser gives the game", v.room === null ? "unknown" : `about ${bytesText(v.room)}`);
    const kept = keptWords(v.kept);
    p.row(KEY + 18, "Kept by the browser", kept[0], kept[1], kept[2]);
    const left = p.y - y;
    if (side) {
      p.x = x + shift;
      p.y = y;
    } else p.rule(KEY + 90);
    p.head(KEY + 30, "DOWNLOAD");
    // The words take as many lines as the longest state's, and the progress bar's row is kept where it is not shown, so
    // the buttons stay put as the state changes: Delete's second press lands where the first did.
    p.words(KEY + 32, downloadLine(v), false, Math.max(...STATES.map((state) => p.lines(downloadLine({ ...v, state })).length)));
    const done = v.total !== null && v.missing !== null && v.total > 0 ? 1 - v.missing / v.total : -1;
    if ((v.state === "downloading" || v.state === "paused") && done >= 0) p.bar(KEY + 36, done);
    else p.y += LINE + GAP;
    const buttons = storageButtons(v, s.keepAll);
    p.buttons(buttons[0], buttons[1], this.touch, focus);
    p.rule(KEY + 91);
    p.head(KEY + 40, "WHILE YOU PLAY");
    p.row(KEY + 42, "Graphics memory", `${bytesText(v.card)} of about ${bytesText(v.cardOf)}`);
    p.y -= GAP;
    p.words(KEY + 46, ["Held by the graphics card for what you see. Not saved."], true);
    return Math.max(left, p.y - y);
  }
}

/** Whether the browser keeps the files: the value, its note, and the two as one value. */
function keptWords(kept: boolean | null): [string, string, string] {
  if (kept === null) return ["Unknown", "This browser does not say.", "Unknown: this browser does not say"];
  if (kept) return ["Yes", "The browser will not clear them to make room.", "Yes: the browser will not clear them to make room"];
  return ["No", "It may clear them to make room.", "No: it may clear them to make room"];
}
