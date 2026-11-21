// The resource monitor: a strip in the HUD's top-left column, under the readout, that says what the game is fetching
// over the network, reading from the disk and sending to the graphics card each second, how much is downloading, asked
// for and waiting for the card, and the last minute as a chart with its slow frames marked (ui/monitor-chart.ts).
// While H is held a card beside the crosshair says what is looked at and where its model and textures stand
// (ui/monitor-card.ts), and the strip opens the monitor's panel (ui/monitor-panel.ts); by touch, where nothing is
// held, the strip's last line says what is looked at, and a tap opens the panel. Its numbers come from the record of
// frames (assets/frames.ts) and the residency's counters, and are made again ten times a second, not every frame;
// between, the monitor is drawn from the words and columns already made.
//
// The app fetches this file once Diagnostics is first "monitor" (F3, the console's `monitor`, or Settings, Interface),
// so none of it is in the script the first frame waits for, and while it is off the HUD only sets two numbers. It and
// the files it imports take what they use of that script from the kit the app hands them (ui/monitor-kit.ts, D912).

import type { App } from "../app.ts";
import type { FrameRing } from "../assets/frames.ts";
import { emptyPick, pickLook } from "../assets/look.ts";
import { RequestLog } from "../assets/requests.ts";
import type { HudModel } from "../hud.ts";
import { cardWords, pickLine } from "./monitor-card.ts";
import { AXIS_H, ChartData, buildAxis, buildChart, chartBox, type ChartBox } from "./monitor-chart.ts";
import type { MonitorKit } from "./monitor-kit.ts";
import { PanelWords, buildPanel, layPanel, panelClick, panelWords } from "./monitor-panel.ts";
import { K_BUTTON, K_PANEL, LINE, S_HUD_HIT, S_MENU, S_MENU_NOTE, S_TEXT, SMALL_LINE } from "./monitor-style.ts";
import type { UiFrame } from "./nodes.ts";
import type { TouchPlan } from "./touch.ts";

/**
 * The monitor's keys, clear of every other screen's: the strip from here, the card from KEY_CARD, the panel's from 8100
 * (ui/monitor-panel.ts), the strip's chart from KEY_STRIP_CHART.
 */
export const KEY_MONITOR = 8000;
const KEY_STRIP = KEY_MONITOR;
const KEY_STRIP_TEXT = KEY_MONITOR + 1;
export const KEY_STRIP_OPEN = KEY_MONITOR + 20;
const KEY_STRIP_SHADE = KEY_MONITOR + 21;
export const KEY_CARD = KEY_MONITOR + 30;
const KEY_STRIP_CHART = KEY_MONITOR + 700;

/** How often the words are made again, in ms. */
export const REFRESH_MS = 100;
/** The HUD's margin, which the strip keeps to as the readout does (ui/hud.ts). */
const MARGIN = 12;
/** The strip's widest, as wide as the readout's lines may be, and what it keeps inside its glass. */
export const STRIP_W = 400;
const PAD = 10;
/** Room before each rate for a painted icon (network, disk, card) once the monitor has its art; none yet. And the rates' labels' room: the widest, "Network", and a gap. */
const ICON_W = 0;
const RATE_LABEL_W = 50;
/** The strip's chart well's height, and the gap over it. */
export const STRIP_CHART_H = 30;
const CHART_GAP = 4;
/** A canvas narrower than this is a phone upright's by touch, where the HUD's column is no wider than the strip (ui/hud.ts). */
const NARROW = 640;
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
/** The offer to unmute's row under the compass (ui/menu.ts). */
const UNMUTE_ROW = 52;
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
  /** The panel is open, which tab it shows (0 Now, 1 Chart, 2 Assets), and whether its chart is held still. */
  open = false;
  tab = 0;
  frozen = false;
  /** The chart's column chosen, -1 for none, and the page of the panel's list. */
  column = -1;
  page = 0;
  /** The chart as it stands, and as it stood when frozen; the panel's words. */
  readonly live = new ChartData();
  readonly still = new ChartData();
  readonly words = new PanelWords();
  /** The record of requests, made when the monitor first refreshes and handed to the residency while it is on. */
  log: RequestLog | null = null;
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
  private charted = true;
  /** By touch on a phone upright, it stands across the canvas under the minimap, at `y`, not in the HUD's column. */
  private belowMap = false;
  private y = 0;
  private readonly box: ChartBox = { x: 0, y: 0, w: 0, h: 0, column: 1 };
  /** Whether H was held at the last build; the highest the card may stand, and where the strip ends. */
  private inspected = false;
  private cardAbove = 0;
  /** What is looked at is said in the strip's last line, not on a card: by touch, where nothing is held, and in a window too narrow for the card beside the crosshair. */
  private lined = false;
  /** The card's place beside the crosshair. */
  private readonly cardAt = { x: 0, y: 0, w: 0, h: 0 };

  constructor(app: App, kit: MonitorKit) {
    this.app = app;
    this.kit = kit;
  }

  /** The chart the strip and the panel show: as it stands, or as it stood when frozen. */
  get chart(): ChartData {
    return this.frozen ? this.still : this.live;
  }

  /** Tells the HUD the room the strip takes, before the HUD is built; while the panel is open, none, and the readout gives way to the panel. */
  reserve(f: UiFrame, hud: HudModel, plan: TouchPlan | null): void {
    const touch = plan !== null;
    this.x = f.left + MARGIN;
    this.w = Math.min(STRIP_W, f.width - f.right - MARGIN - this.x);
    this.belowMap = false;
    if (this.open) {
      hud.stripAlone = true;
      hud.stripH = 0;
      return;
    }
    // By touch on a phone upright it stands across the canvas, under the minimap and its clock and under the readout left
    // of the minimap; elsewhere in the HUD's column under the readout. Where that would come down to the crosshair, or
    // by touch to where the stick rests over the hotbar, it stands in the readout's place, then without its chart, then
    // without the line of what is looked at.
    this.belowMap = touch && f.width < NARROW;
    this.lined = touch || f.width - f.right - MARGIN - CARD_RIGHT - (f.width / 2 + 24) < CARD_LEAST;
    // Across, its right edge on the minimap frame's, which stands 2 units past the picture (ui/hud.ts).
    if (this.belowMap) this.w = f.width - f.right - MARGIN + 2 - this.x;
    const top = touch ? plan.stackY : f.top + MARGIN, mapFoot = touch ? f.top + MARGIN + plan.map + 4 + SMALL_LINE + 6 : 0;
    const limit = Math.min(f.height / 2 - 8, touch ? f.height - f.bottom - STICK_ROOM : f.height);
    for (let shape = 0; shape < SHAPES.length; shape++) {
      const s = SHAPES[shape]!;
      this.charted = (s & CHARTED) !== 0;
      this.alone = (s & ALONE) !== 0;
      this.lookLine = this.lined && (s & LOOKED) !== 0;
      this.h = PAD + (this.lookLine ? 3 : 2) * LINE + 2 + (this.charted ? CHART_GAP + STRIP_CHART_H + AXIS_H : 0);
      const under = top + (this.alone ? 0 : READOUT_H);
      this.y = this.belowMap ? Math.max(mapFoot, under + 6) : under;
      if (this.y + this.h <= limit) break;
    }
    hud.stripAlone = this.alone;
    hud.stripW = this.w;
    hud.stripH = this.belowMap ? 0 : this.h;
  }

  /** The words, made again where they are older than REFRESH_MS: the card's too while H is held, and by touch the line of what is looked at. */
  refresh(f: UiFrame, nowMs: number, inspect: boolean, touch: boolean): void {
    if (nowMs - this.madeAt < REFRESH_MS && nowMs >= this.madeAt) return;
    this.madeAt = nowMs;
    const app = this.app, r = app.scene?.assets.residency ?? null, ring = app.frames, kit = this.kit;
    if (r && !this.log) this.log = new RequestLog(r["state"].length);
    if (r) r.log = this.log;
    const s = this.sums;
    if (ring) {
      lastSecond(ring, s);
      this.live.read(ring);
    } else s.fill(0);
    this.rates[0] = rateText(s[0]!);
    this.rates[1] = rateText(s[1]!);
    this.rates[2] = rateText(s[2]!);
    const inner = this.w - PAD * 2;
    if (!r) this.queue = "waiting for the world";
    else {
      const flying = r.flying + (app.sounds?.library.flying ?? 0);
      this.queue = kit.fitText(`${flying} downloading · ${r.wanting()} asked · ${r.waiting > 0 ? bytesText(r.waiting) : "nothing"} waiting for the card`, inner, S_MENU_NOTE);
    }
    if (inspect || this.lined) pickLook(app, kit, this.pick);
    this.looked = this.lined ? kit.fitText(pickLine(r, this.pick), inner, S_MENU_NOTE) : "";
    if (inspect && !this.lined) this.cardWords(f);
    if (this.open) panelWords(this, nowMs, touch);
  }

  /** The monitor is off: the HUD leaves no room for it, and the residency tells it nothing, so that it costs nothing. */
  off(hud: HudModel): void {
    hud.stripH = 0;
    hud.stripAlone = false;
    const r = this.app.scene?.assets.residency;
    if (r) r.log = null;
  }

  /** Has the words made again at the next build, after a press changed what they show. */
  refreshNow(): void {
    this.madeAt = -Infinity;
  }

  /** The strip, where the HUD left room for it, and while H is held the card beside the crosshair. */
  build(f: UiFrame, hud: HudModel, controls: boolean, inspect: boolean, plan: TouchPlan | null, muted = false): void {
    if (this.open) return;
    const touch = plan !== null;
    // The card's words are made the frame H is pressed, not up to a tenth of a second later.
    if (inspect && !this.inspected) this.refreshNow();
    this.inspected = inspect;
    const x = this.x, y = this.belowMap ? this.y : hud.stripY;
    // The card keeps under the compass and the offer to unmute under it.
    this.cardAbove = Math.max(f.top + MARGIN, hud.compassBottom + 8 + (muted ? UNMUTE_ROW : 0));
    this.refresh(f, this.app["nowMs"], inspect, touch);
    // A shade under the glass, as the menus' backdrop is, so that the words read over a bright sky.
    f.add(KEY_STRIP_SHADE, K_PANEL, x, y, this.w, this.h, S_MENU);
    this.kit.glass(f, KEY_STRIP, x, y, this.w, this.h, 0.9);
    // Three rates side by side in thirds, each its label and then its value, which starts where the widest label ends.
    const inner = this.w - PAD * 2, third = inner / 3;
    let line = y + PAD / 2 + 1;
    for (let i = 0; i < 3; i++) {
      const cx = x + PAD + i * third;
      f.text(KEY_STRIP_TEXT + i * 2, cx + ICON_W, line, RATE_LABEL_W, S_MENU_NOTE, RATE_LABELS[i]!);
      f.text(KEY_STRIP_TEXT + i * 2 + 1, cx + ICON_W + RATE_LABEL_W, line, third - ICON_W - RATE_LABEL_W - 4, S_TEXT, this.rates[i]!);
    }
    line += LINE;
    f.text(KEY_STRIP_TEXT + 6, x + PAD, line, inner, S_MENU_NOTE, this.queue);
    line += LINE;
    if (this.charted) {
      chartBox(x + PAD - 4, line + CHART_GAP, inner + 8, STRIP_CHART_H, this.box);
      buildChart(f, this.kit, KEY_STRIP_CHART, this.box, this.chart, -1, false);
      buildAxis(f, KEY_STRIP_CHART + 250, this.box, this.chart);
      line += CHART_GAP + STRIP_CHART_H + AXIS_H;
    }
    if (this.lookLine) f.text(KEY_STRIP_TEXT + 7, x + PAD, line, inner, S_MENU_NOTE, this.looked);
    // While the mouse is free, or by touch, the strip opens the panel.
    if (controls && (inspect || touch)) {
      const b = f.add(KEY_STRIP_OPEN, K_BUTTON, x, y, this.w, this.h, S_HUD_HIT);
      b.label = "Open the resource monitor";
      b.interactive = true;
    }
    if (inspect && !this.lined) this.buildCard(f);
  }

  /** A press of one of the monitor's controls; false for any other key. */
  click(key: number, x: number, _y: number): boolean {
    if (key === KEY_STRIP_OPEN) {
      this.open = true;
      this.refreshNow();
      return true;
    }
    return this.open && panelClick(this, key, x);
  }

  /** The panel, as a screen: left of the world, or by touch a page of its own; clear of the compass and of the unmute offer. */
  panel(f: UiFrame, plan: TouchPlan | null, hud: HudModel, muted: boolean): void {
    if (layPanel(this, f, plan, hud.compassBottom, muted)) this.refreshNow();
    this.refresh(f, this.app["nowMs"], false, plan !== null);
    buildPanel(this, f, plan !== null);
  }

  /**
   * The card's lines, fitted to its width, and its place: above the crosshair and to its right, clear of the prompt
   * under it, the compass and the offer to unmute over it, and the minimap. It has as many rows as there is room for
   * there, CARD_ROWS at most.
   */
  private cardWords(f: UiFrame): void {
    const at = this.cardAt, kit = this.kit, foot = f.height / 2 - 8;
    at.x = f.width / 2 + 24;
    at.w = Math.min(CARD_W, f.width - f.right - MARGIN - CARD_RIGHT - at.x);
    cardWords(this.app.scene?.assets.residency ?? null, this.pick, Math.max(2, Math.min(CARD_ROWS, Math.floor((foot - this.cardAbove - PAD - 2) / LINE))), this.card, this.under);
    const inner = at.w - PAD * 2;
    let rows = 0;
    for (let i = 0; i < this.card.length; i++) {
      this.card[i] = kit.fitText(this.card[i]!, inner, i === 0 ? S_TEXT : S_MENU_NOTE);
      if (this.under[i] !== "") this.under[i] = kit.fitText(this.under[i]!, inner - 12, S_MENU_NOTE);
      rows += this.under[i] === "" ? 1 : 2;
    }
    at.h = PAD + rows * LINE + 2;
    at.y = Math.max(this.cardAbove, foot - at.h);
  }

  /** The card, from its words. */
  private buildCard(f: UiFrame): void {
    const at = this.cardAt;
    f.add(KEY_CARD + 29, K_PANEL, at.x, at.y, at.w, at.h, S_MENU);
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
/**
 * The strip's shapes, tried in turn: with its chart and (by touch) the line of what is looked at, under the readout,
 * then in the readout's place; then without the chart, under it and in its place; then without the line as well.
 */
const CHARTED = 1, ALONE = 2, LOOKED = 4;
const SHAPES = [CHARTED | LOOKED, CHARTED | ALONE | LOOKED, LOOKED, ALONE | LOOKED, ALONE];
