// The resource monitor: a strip in the HUD's top-left column, under the readout, that says what the game is fetching
// over the network, reading from the disk and sending to the graphics card each second, and how much is downloading,
// asked for and waiting for the card. Its numbers come from the record of frames (assets/frames.ts) and the
// residency's counters, and are made again ten times a second, not every frame; between, the strip is drawn from the
// words already made.
//
// The app fetches this file once Diagnostics is first "monitor" (F3, the console's `monitor`, or Settings, Interface),
// so none of it is in the script the first frame waits for, and while it is off the HUD only sets one number. It and
// the files it imports take what they use of that script from the kit the app hands them (ui/monitor-kit.ts, D902).

import type { App } from "../app.ts";
import type { FrameRing } from "../assets/frames.ts";
import type { HudModel } from "../hud.ts";
import type { MonitorKit } from "./monitor-kit.ts";
import { LINE, S_HUD_COUNT, S_MENU_NOTE } from "./monitor-style.ts";
import type { UiFrame } from "./nodes.ts";
import type { TouchPlan } from "./touch.ts";

/** The monitor's keys, clear of every other screen's: the strip from here. */
export const KEY_MONITOR = 8000;
const KEY_STRIP = KEY_MONITOR;
const KEY_STRIP_TEXT = KEY_MONITOR + 1;

/** How often the words are made again, in ms. */
export const REFRESH_MS = 100;
/** The HUD's margin, which the strip keeps to as the readout does (ui/hud.ts). */
const MARGIN = 12;
/** The strip's widest, as wide as the readout's lines may be, and what it keeps inside its glass. */
export const STRIP_W = 400;
const PAD = 10;
/** Room before each rate for a painted icon (network, disk, card) once the monitor has its art; none yet. */
const ICON_W = 0;
/** A line of the readout over the strip (S_TEXT). */
const READOUT_LINE = LINE;
/**
 * How far above the canvas's foot the stick's ring may reach by touch, at rest over a hotbar that reaches under the
 * thumb's cluster (ui/touch.ts touchControls): the hotbar, the line over it, and the ring.
 */
const STICK_ROOM = 232;

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
  private readonly app: App;
  readonly kit: MonitorKit;
  /** When the words were last made, by the app's clock. */
  private madeAt = -Infinity;
  /** The strip's words: each rate's label and value, and the line of what waits. */
  readonly rates = ["", "", ""];
  queue = "";
  private readonly sums = new Float64Array(4);

  constructor(app: App, kit: MonitorKit) {
    this.app = app;
    this.kit = kit;
  }

  /** The strip's place in the HUD's top-left column this frame: its left edge, width and height. */
  private x = 0;
  private w = 0;
  private h = 0;

  /** Tells the HUD the room the strip takes, before the HUD is built. */
  reserve(f: UiFrame, hud: HudModel, plan: TouchPlan | null): void {
    this.x = f.left + MARGIN;
    this.w = Math.min(STRIP_W, f.width - f.right - MARGIN - this.x);
    this.h = PAD + 2 * LINE + 2;
    // By touch on a canvas as short as a phone's on its side, the readout and the strip under it would come down to the
    // crosshair or to where the stick rests over the hotbar, and the strip stands in the readout's place.
    const top = plan ? plan.stackY : f.top + MARGIN;
    hud.stripAlone = plan !== null && top + hud.readout.length * READOUT_LINE + 4 + this.h > Math.min(f.height / 2 - 8, f.height - f.bottom - STICK_ROOM);
    hud.stripW = this.w;
    hud.stripH = this.h;
  }

  /** The words, made again where they are older than REFRESH_MS. */
  refresh(nowMs: number): void {
    if (nowMs - this.madeAt < REFRESH_MS && nowMs >= this.madeAt) return;
    this.madeAt = nowMs;
    const app = this.app, r = app.scene?.assets.residency ?? null, ring = app.frames;
    const s = this.sums;
    if (ring) lastSecond(ring, s);
    else s.fill(0);
    this.rates[0] = rateText(s[0]!);
    this.rates[1] = rateText(s[1]!);
    this.rates[2] = rateText(s[2]!);
    if (!r) {
      this.queue = "waiting for the world";
      return;
    }
    const flying = r.flying + (app.sounds?.library.flying ?? 0);
    this.queue = this.kit.fitText(`${flying} downloading · ${r.wanting()} asked · ${r.waiting > 0 ? bytesText(r.waiting) : "nothing"} waiting for the card`, this.w - PAD * 2, S_MENU_NOTE);
  }

  /** The strip, where the HUD left room for it (`hud.stripY`). */
  build(f: UiFrame, hud: HudModel, _controls: boolean, _inspect: boolean, _plan: TouchPlan | null): void {
    this.refresh(this.app["nowMs"]);
    const x = this.x, y = hud.stripY;
    this.kit.glass(f, KEY_STRIP, x, y, this.w, this.h, 0.9);
    // Three rates side by side, each its label and its value at the right of its third.
    const inner = this.w - PAD * 2, third = inner / 3;
    for (let i = 0; i < 3; i++) {
      const cx = x + PAD + i * third;
      f.text(KEY_STRIP_TEXT + i * 2, cx + ICON_W, y + PAD / 2 + 1, third - ICON_W - 8, S_MENU_NOTE, RATE_LABELS[i]!);
      f.text(KEY_STRIP_TEXT + i * 2 + 1, cx, y + PAD / 2 + 1, third - 8, S_HUD_COUNT, this.rates[i]!);
    }
    f.text(KEY_STRIP_TEXT + 6, x + PAD, y + PAD / 2 + 1 + LINE, inner, S_MENU_NOTE, this.queue);
  }
}

const RATE_LABELS = ["Network", "Disk", "To card"];
