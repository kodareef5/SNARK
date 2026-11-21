// The resource monitor's chart (ui/monitor.ts): the last CHART_SECONDS seconds from the record of frames' one-second
// buckets (assets/frames.ts), each a column of bytes over the network, from the disk and to the card stacked, and a
// mark under each column that had a frame over 50 ms. The bars are plain coloured panels, the one part of the monitor
// drawn in code, as the HUD's fill bars are; the well behind them is a stand-in for the painted chart well, its four
// lines at fixed shares of its height, so that the painting can be dropped in at the same place.

import type { FrameRing } from "../assets/frames.ts";
import type { MonitorKit } from "./monitor-kit.ts";
import { K_BUTTON, K_PANEL, S_DARK, S_HUD_COUNT, S_HUD_HIT, S_ICE, S_LABEL, SMALL_LINE } from "./monitor-style.ts";
import type { UiFrame } from "./nodes.ts";

/** Seconds the chart shows, a column each. */
export const CHART_SECONDS = 60;
/** The three stacked series, from the foot: network, disk, to the card. */
export const SERIES = 3;
export const SERIES_TINT: readonly number[] = [0x5fb4e6, 0xe8c25e, 0x8fd27a];
export const SERIES_NAMES: readonly string[] = ["network", "disk", "to card"];
/** A frame over 50 ms, marked under its column, in the HUD's warm accent. */
export const SLOW_TINT = 0xf2a477;
/** Inside the well: room at its sides and its top, and the shares of its height its lines stand at (a painted well will etch them). */
export const WELL_PAD = 4;
export const WELL_LINES: readonly number[] = [0.25, 0.5, 0.75];
/** The slow marks' height under the well, and the gap above them. */
export const MARK_H = 3;
const MARK_GAP = 3;
/** The scales the chart's top may be, in bytes a second: the least that holds its tallest column. */
const SCALES: readonly number[] = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256].map((mb) => mb * 1048576);

/** What a chart shows: CHART_SECONDS columns, the oldest first, each its bytes by series, its slow frames and longest frame, and its second. */
export class ChartData {
  readonly bytes = new Float64Array(CHART_SECONDS * SERIES);
  readonly slow = new Uint16Array(CHART_SECONDS);
  readonly worst = new Float32Array(CHART_SECONDS);
  readonly frames = new Uint16Array(CHART_SECONDS);
  /** The second each column is, by the page's clock (a frame's `at` / 1000), -1 for one not kept. */
  readonly second = new Float64Array(CHART_SECONDS).fill(-1);
  /** The chart's top, in bytes a second. */
  scale = SCALES[0]!;

  /** Reads the last CHART_SECONDS buckets of `ring`, the latest (still filling) last. */
  read(ring: FrameRing): void {
    let most = 0;
    for (let col = 0; col < CHART_SECONDS; col++) {
      const back = CHART_SECONDS - 1 - col, b = ring.bucket(back);
      const at = col * SERIES;
      this.second[col] = b < 0 ? -1 : ring.second - back;
      this.bytes[at] = b < 0 ? 0 : ring.bucketFetched[b]!;
      this.bytes[at + 1] = b < 0 ? 0 : ring.bucketDisk[b]!;
      this.bytes[at + 2] = b < 0 ? 0 : ring.bucketUploaded[b]!;
      this.slow[col] = b < 0 ? 0 : ring.bucketSlow[b]!;
      this.worst[col] = b < 0 ? 0 : ring.bucketWorst[b]!;
      this.frames[col] = b < 0 ? 0 : ring.bucketFrames[b]!;
      const sum = this.bytes[at]! + this.bytes[at + 1]! + this.bytes[at + 2]!;
      if (sum > most) most = sum;
    }
    this.scale = SCALES.find((s) => s >= most) ?? SCALES[SCALES.length - 1]!;
  }

  /** A copy of `other`, for a chart that is frozen. */
  copy(other: ChartData): void {
    this.bytes.set(other.bytes);
    this.slow.set(other.slow);
    this.worst.set(other.worst);
    this.frames.set(other.frames);
    this.second.set(other.second);
    this.scale = other.scale;
  }
}

/** The chart's top in words: "8 MB/s", "512 KB/s". */
export function scaleText(scale: number): string {
  return scale >= 1048576 ? `${scale / 1048576} MB/s` : `${scale / 1024} KB/s`;
}

/** Where a chart stands: its well, and the width of a column in it. */
export interface ChartBox { x: number; y: number; w: number; h: number; column: number }

export function chartBox(x: number, y: number, w: number, h: number, out: ChartBox): ChartBox {
  out.x = x;
  out.y = y;
  out.w = w;
  out.h = h;
  out.column = (w - WELL_PAD * 2) / CHART_SECONDS;
  return out;
}

/** The column under `px` across the chart, -1 for none. */
export function columnAt(box: ChartBox, px: number): number {
  const col = Math.floor((px - box.x - WELL_PAD) / box.column);
  return col >= 0 && col < CHART_SECONDS ? col : -1;
}

/**
 * Builds `data` into `box`: the well, its lines, a column of stacked bars a second, and a mark under each column with a
 * slow frame; with `selected` >= 0 that column lit. With `pressed`, the well is a button (the key `key + 1`) that
 * chooses the column under the pointer. Keys from `key` to `key + 5 + CHART_SECONDS * 4`.
 */
export function buildChart(f: UiFrame, kit: MonitorKit, key: number, box: ChartBox, data: ChartData, selected: number, pressed: boolean): void {
  kit.glass(f, key, box.x, box.y, box.w, box.h, 0.55);
  f.add(key + 2, K_PANEL, box.x + 2, box.y + 2, box.w - 4, box.h - 4, S_DARK).alpha = 0.22;
  const foot = box.y + box.h - WELL_PAD, tall = box.h - WELL_PAD * 2;
  for (let i = 0; i < WELL_LINES.length; i++) f.add(key + 3 + i, K_PANEL, box.x + WELL_PAD, f.snap(foot - tall * WELL_LINES[i]!), box.w - WELL_PAD * 2, 1, S_ICE).alpha = 0.12;
  const bar = Math.max(1, box.column - (box.column > 3 ? 1 : 0));
  for (let col = 0; col < CHART_SECONDS; col++) {
    const x = box.x + WELL_PAD + col * box.column, k = key + 6 + col * 4;
    let y = foot;
    for (let s = 0; s < SERIES; s++) {
      const h = Math.min(tall, (data.bytes[col * SERIES + s]! / data.scale) * tall);
      if (h < 0.5) continue;
      const n = f.add(k + s, K_PANEL, x, y - h, bar, h, S_ICE);
      n.tint = SERIES_TINT[s]!;
      n.alpha = selected < 0 || selected === col ? 0.95 : 0.55;
      y -= h;
    }
    if (data.slow[col]! > 0) f.add(k + 3, K_PANEL, x, box.y + box.h + MARK_GAP, bar, MARK_H, S_ICE).tint = SLOW_TINT;
  }
  if (selected >= 0) f.add(key + 5, K_PANEL, box.x + WELL_PAD + selected * box.column - 1, box.y + 2, bar + 2, box.h - 4, S_ICE).alpha = 0.16;
  if (pressed) {
    const b = f.add(key + 1, K_BUTTON, box.x, box.y, box.w, box.h, S_HUD_HIT);
    b.label = "Choose a second of the chart";
    b.interactive = true;
  }
}

/** Under a chart: its top's scale, and how far back its two ends are. */
export function buildAxis(f: UiFrame, key: number, box: ChartBox, data: ChartData): void {
  const y = box.y + box.h + MARK_GAP + MARK_H + 2;
  f.text(key, box.x + WELL_PAD + 2, box.y + WELL_PAD, 80, S_LABEL, scaleText(data.scale)).alpha = 0.8;
  f.text(key + 1, box.x + WELL_PAD, y, 60, S_LABEL, `${CHART_SECONDS} s ago`);
  f.text(key + 2, box.x + box.w - WELL_PAD - 40, y, 40, S_HUD_COUNT, "now");
}

/** The height a chart takes under its well: its marks and the line of its ends. */
export const AXIS_H = MARK_GAP + MARK_H + 2 + SMALL_LINE;
