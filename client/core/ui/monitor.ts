// The resource monitor: a strip in the HUD's top-left column, under the readout, that says what the game is fetching
// over the network, reading from the disk and sending to the graphics card each second, and how much is downloading,
// asked for and waiting for the card. While H is held a card beside the crosshair says what is looked at and where its
// model and textures stand (ui/monitor-card.ts); by touch, where nothing is held, the strip's last line says it. Its
// numbers come from the record of frames (assets/frames.ts) and the residency's counters, and are made again ten times
// a second, not every frame; between, the monitor is drawn from the words already made.
//
// The app fetches this file once Diagnostics is first "monitor" (F3, the console's `monitor`, or Settings, Interface),
// so none of it is in the script the first frame waits for, and while it is off the HUD only sets two numbers. It and
// the files it imports take what they use of that script from the kit the app hands them (ui/monitor-kit.ts, D902).

import type { App } from "../app.ts";
import type { FrameRing } from "../assets/frames.ts";
import { emptyPick, pickLook } from "../assets/look.ts";
import type { HudModel } from "../hud.ts";
import { cardWords, pickLine } from "./monitor-card.ts";
import type { MonitorKit } from "./monitor-kit.ts";
import { LINE, S_HUD_COUNT, S_MENU_NOTE, S_TEXT } from "./monitor-style.ts";
import type { UiFrame } from "./nodes.ts";
import type { TouchPlan } from "./touch.ts";

/** The monitor's keys, clear of every other screen's: the strip from here, the card from KEY_CARD. */
export const KEY_MONITOR = 8000;
const KEY_STRIP = KEY_MONITOR;
const KEY_STRIP_TEXT = KEY_MONITOR + 1;
export const KEY_CARD = KEY_MONITOR + 30;

/** How often the words are made again, in ms. */
export const REFRESH_MS = 100;
/** The HUD's margin, which the strip keeps to as the readout does (ui/hud.ts). */
const MARGIN = 12;
/** The strip's widest, as wide as the readout's lines may be, and what it keeps inside its glass. */
export const STRIP_W = 400;
const PAD = 10;
/** Room before each rate for a painted icon (network, disk, card) once the monitor has its art; none yet. */
const ICON_W = 0;
/** The readout's three lines over the strip, and the gap under them (ui/hud.ts). */
const READOUT_H = 3 * LINE + 4;
/**
 * How far above the canvas's foot the stick's ring may reach by touch, at rest over a hotbar that reaches under the
 * thumb's cluster (ui/touch.ts touchControls): the hotbar, the line over it, and the ring.
 */
const STICK_ROOM = 232;
/** The inspect card's widest, the least it is drawn beside the crosshair at, and its most rows. */
export const CARD_W = 340;
const CARD_LEAST = 220;
const CARD_ROWS = 12;
/** Room the card keeps from the canvas's right edge, for the minimap and its frame (ui/hud.ts MINIMAP_SIZE and its glass). */
const CARD_RIGHT = 168;

const MB = 1048576;

/** Bytes a second, in words: "2.4 MB/s", "640 KB/s". */
export function rateText(bytes: number): string {
  return bytes >= 1000 * 1024 ? `${(bytes / MB).toFixed(1)} MB/s` : `${Math.round(bytes / 1024)} KB/s`;
}

/** Bytes, in words: "3.1 MB", "640 KB". */
export function bytesText(bytes: number): string {
  return bytes >= 100 * MB ? `${Math.round(bytes / MB)} MB` : bytes >= 1000 * 1024 ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Bytes over the network, from the disk, sent to the card and from the port's memory in the second up to the latest
 * row of `ring`, into `out` in that order.
 */
export function lastSecond(ring: FrameRing, out: Float64Array): void {
  out.fill(0);
  const latest = ring.row(0);
  if (latest < 0) return;
  const from = ring.at[latest]! - 1000;
  for (let back = 0; ; back++) {
    const k = ring.row(back);
    if (k < 0 || ring.at[k]! <= from) break;
    out[0]! += ring.fetched[k]!;
    out[1]! += ring.disk[k]!;
    out[2]! += ring.uploaded[k]!;
    out[3]! += ring.cached[k]! - ring.disk[k]!;
  }
}

export class Monitor {
  readonly app: App;
  readonly kit: MonitorKit;
  /** What the crosshair is on, as last found. */
  readonly pick = emptyPick();
  /** When the words were last made, by the app's clock. */
  private madeAt = -Infinity;
  /** The strip's words: each rate's value, the line of what waits, and by touch the line of what is looked at. */
  readonly rates = ["", "", ""];
  queue = "";
  looked = "";
  /** The card's lines, and what goes under each ("" for nothing). */
  readonly card: string[] = [];
  readonly under: string[] = [];
  readonly sums = new Float64Array(4);
  /** The strip's place this frame: its left edge, width and height, whether it stands in the readout's place, and whether it has the line of what is looked at. */
  private x = 0;
  private w = 0;
  private h = 0;
  private alone = false;
  private lookLine = false;
  /** The card's place beside the crosshair. */
  private readonly cardAt = { x: 0, y: 0, w: 0, h: 0 };

  constructor(app: App, kit: MonitorKit) {
    this.app = app;
    this.kit = kit;
  }

  /** Tells the HUD the room the strip takes, before the HUD is built. */
  reserve(f: UiFrame, hud: HudModel, plan: TouchPlan | null): void {
    const touch = plan !== null;
    this.x = f.left + MARGIN;
    this.w = Math.min(STRIP_W, f.width - f.right - MARGIN - this.x);
    // By touch on a canvas as short as a phone's on its side, the readout and the strip under it would come down to the
    // crosshair or to where the stick rests over the hotbar: the strip stands in the readout's place, and where even
    // that is too low, without the line of what is looked at.
    const top = touch ? plan.stackY : f.top + MARGIN;
    const limit = Math.min(f.height / 2 - 8, touch ? f.height - f.bottom - STICK_ROOM : f.height);
    for (let shape = 0; shape < SHAPES; shape++) {
      this.alone = shape > 0;
      this.lookLine = touch && shape < 2;
      this.h = PAD + (this.lookLine ? 3 : 2) * LINE + 2;
      if (top + (this.alone ? 0 : READOUT_H) + this.h <= limit) break;
    }
    hud.stripAlone = this.alone;
    hud.stripW = this.w;
    hud.stripH = this.h;
  }

  /** The words, made again where they are older than REFRESH_MS: the card's too while H is held, and by touch the line of what is looked at. */
  refresh(f: UiFrame, nowMs: number, inspect: boolean, touch: boolean): void {
    if (nowMs - this.madeAt < REFRESH_MS && nowMs >= this.madeAt) return;
    this.madeAt = nowMs;
    const app = this.app, r = app.scene?.assets.residency ?? null, ring = app.frames, kit = this.kit;
    const s = this.sums;
    if (ring) lastSecond(ring, s);
    else s.fill(0);
    this.rates[0] = rateText(s[0]!);
    this.rates[1] = rateText(s[1]!);
    this.rates[2] = rateText(s[2]!);
    const inner = this.w - PAD * 2;
    if (!r) this.queue = "waiting for the world";
    else {
      const flying = r.flying + (app.sounds?.library.flying ?? 0);
      this.queue = kit.fitText(`${flying} downloading · ${r.wanting()} asked · ${r.waiting > 0 ? bytesText(r.waiting) : "nothing"} waiting for the card`, inner, S_MENU_NOTE);
    }
    if (inspect || touch) pickLook(app, kit, this.pick);
    this.looked = touch ? kit.fitText(pickLine(r, this.pick), inner, S_MENU_NOTE) : "";
    if (inspect && !touch) this.cardWords(f);
  }

  /** The strip, where the HUD left room for it, and while H is held the card beside the crosshair. */
  build(f: UiFrame, hud: HudModel, _controls: boolean, inspect: boolean, plan: TouchPlan | null): void {
    const touch = plan !== null;
    this.refresh(f, this.app["nowMs"], inspect, touch);
    const x = this.x, y = hud.stripY;
    this.kit.glass(f, KEY_STRIP, x, y, this.w, this.h, 0.9);
    // Three rates side by side, each its label and its value at the right of its third.
    const inner = this.w - PAD * 2, third = inner / 3;
    let line = y + PAD / 2 + 1;
    for (let i = 0; i < 3; i++) {
      const cx = x + PAD + i * third;
      f.text(KEY_STRIP_TEXT + i * 2, cx + ICON_W, line, third - ICON_W - 8, S_MENU_NOTE, RATE_LABELS[i]!);
      f.text(KEY_STRIP_TEXT + i * 2 + 1, cx, line, third - 8, S_HUD_COUNT, this.rates[i]!);
    }
    line += LINE;
    f.text(KEY_STRIP_TEXT + 6, x + PAD, line, inner, S_MENU_NOTE, this.queue);
    line += LINE;
    if (this.lookLine) f.text(KEY_STRIP_TEXT + 7, x + PAD, line, inner, S_MENU_NOTE, this.looked);
    if (inspect && !touch) this.buildCard(f);
  }

  /** The card's lines, fitted to its width, and its place: above the crosshair and to its right, clear of the prompt under it and of the minimap. */
  private cardWords(f: UiFrame): void {
    const at = this.cardAt, cx = f.width / 2, cy = f.height / 2, kit = this.kit;
    const room = Math.min(CARD_W, f.width - f.right - MARGIN - CARD_RIGHT - (cx + 24));
    // Where there is no room right of the crosshair (a narrow window), it stands across the canvas under the prompt.
    const narrow = room < CARD_LEAST;
    at.x = narrow ? f.left + MARGIN : cx + 24;
    at.w = narrow ? f.width - f.left - f.right - MARGIN * 2 : room;
    cardWords(this.app.scene?.assets.residency ?? null, this.pick, CARD_ROWS, this.card, this.under);
    const inner = at.w - PAD * 2;
    let rows = 0;
    for (let i = 0; i < this.card.length; i++) {
      this.card[i] = kit.fitText(this.card[i]!, inner, i === 0 ? S_TEXT : S_MENU_NOTE);
      if (this.under[i] !== "") this.under[i] = kit.fitText(this.under[i]!, inner - 12, S_MENU_NOTE);
      rows += this.under[i] === "" ? 1 : 2;
    }
    at.h = PAD + rows * LINE + 2;
    at.y = narrow ? cy + 48 : Math.max(f.top + MARGIN, cy - 8 - at.h);
  }

  /** The card, from its words. */
  private buildCard(f: UiFrame): void {
    const at = this.cardAt;
    this.kit.glass(f, KEY_CARD, at.x, at.y, at.w, at.h, 0.92);
    let y = at.y + PAD / 2 + 1, k = KEY_CARD + 1;
    for (let i = 0; i < this.card.length; i++) {
      f.text(k++, at.x + PAD, y, at.w - PAD * 2, i === 0 ? S_TEXT : S_MENU_NOTE, this.card[i]!);
      y += LINE;
      if (this.under[i] === "") continue;
      f.text(k++, at.x + PAD + 12, y, at.w - PAD * 2 - 12, S_MENU_NOTE, this.under[i]!).alpha = 0.8;
      y += LINE;
    }
  }
}

const RATE_LABELS = ["Network", "Disk", "To card"];
/** The strip's shapes, tried in turn: under the readout, in its place, in its place without the line of what is looked at. */
const SHAPES = 3;
