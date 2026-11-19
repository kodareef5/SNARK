// What the page's own window drew, frame by frame, for ten seconds from a key, on a development world: the picture's
// brightness read back from a small copy of the canvas, whole and by parts, beside what each frame was drawn with. It is
// for a flicker the owner sees and a page started by a tool does not. It rides the record of play (diagnostics.ts): the
// shell posts its parts to __play, where the server writes each beside its own view of the same ticks, and tools/light.ts
// prints them.

import type { App } from "./app.ts";
import { PLAY_VERSION } from "./diagnostics.ts";
import { FRAME, type FramePacket } from "./render/packet.ts";

export const CAPTURE_KEY = "F9";
export const CAPTURE_MS = 10000;
/** The copy of the canvas the brightness is read from, in pixels. */
export const SAMPLE_W = 64;
export const SAMPLE_H = 36;
/** The most a part takes, under the record of play's longest report (server/playlog.ts REPORT_BYTES_MAX). */
export const PART_BYTES = 60000;

/** Each row's columns, in order. Brightness is Rec. 709 luma of the shown bytes, 0 to 255. */
export const LIGHT_FIELDS = [
  "ms", "frameMs", "tick", "luma", "topLeft", "topRight", "bottomLeft", "bottomRight", "top", "bottom",
  "sunX", "sunY", "sunZ", "sunStepped", "casting", "hour", "level", "tier", "cascades", "cascadesDrawn", "exposure",
  "gradeR", "gradeG", "gradeB", "gamma", "renderClock", "tickClock", "clockJumps", "margin", "texUploads", "assetUploads",
  "worldLevel", "worldEarly", "farScale", "canvasW", "canvasH",
] as const;

/** Brightness of an RGBA copy `w` by `h` into `out`: the whole, its quarters (top left, top right, bottom left, bottom right), its top and bottom halves. */
export function brightness(rgba: ArrayLike<number>, w: number, h: number, out: number[]): void {
  const sums = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      sums[(y * 2 < h ? 0 : 2) + (x * 2 < w ? 0 : 1)] += 0.2126 * rgba[k]! + 0.7152 * rgba[k + 1]! + 0.0722 * rgba[k + 2]!;
    }
  }
  const quarter = (w * h) / 4;
  out.length = 0;
  out.push((sums[0]! + sums[1]! + sums[2]! + sums[3]!) / (w * h), ...sums.map((s) => s / quarter), (sums[0]! + sums[1]!) / (2 * quarter), (sums[2]! + sums[3]!) / (2 * quarter));
}

const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

export class LightCapture {
  private began = -1;
  private last = 0;
  private sun = "";
  private rows: (number | string)[][] = [];
  private readonly luma: number[] = [];

  get on(): boolean {
    return this.began >= 0;
  }

  /** Begins a capture at `now` (ms), unless one is under way. */
  start(now: number): boolean {
    if (this.on) return false;
    [this.began, this.last, this.sun, this.rows] = [now, now, "", []];
    return true;
  }

  /**
   * A frame drawn at `now` as `p` and read back as `rgba` (SAMPLE_W by SAMPLE_H). Once CAPTURE_MS have passed it ends and
   * returns the capture as reports of the record of play, each of PART_BYTES at most; else null. `about` goes in each.
   */
  frame(now: number, p: FramePacket, app: App, rgba: ArrayLike<number>, about: Record<string, unknown> = {}): string[] | null {
    if (!this.on) return null;
    brightness(rgba, SAMPLE_W, SAMPLE_H, this.luma);
    const f = p.frame, s = app.session;
    const sun = `${f[FRAME.sun]},${f[FRAME.sun + 1]},${f[FRAME.sun + 2]}`;
    this.rows.push([
      round(now - this.began, 1), round(now - this.last, 1), s.simTick, ...this.luma.map((v) => round(v, 2)),
      round(f[FRAME.sun]!, 5), round(f[FRAME.sun + 1]!, 5), round(f[FRAME.sun + 2]!, 5), this.sun !== "" && sun !== this.sun ? 1 : 0, round(f[FRAME.casting]!, 3),
      round(app.scene?.hour ?? 0, 5), app.governor.level, p.tier.name, p.cascadeCount, p.cascadesDrawn, round(f[FRAME.exposure]!, 4),
      round(f[FRAME.grade]!, 4), round(f[FRAME.grade + 1]!, 4), round(f[FRAME.grade + 2]!, 4), round(f[FRAME.gamma]!, 4),
      round(s.renderClock, 2), round(s.tickClock, 2), s.stats.clockJumps, s.stats.margin, p.texUploads.length, p.assetUploads.length,
      Array.from(p.worldLevel, (v) => round(v, 2)).join("/"), round(p.worldEarly, 3), round(f[FRAME.farScale]!, 4), app.scene?.canvasWidth ?? 0, app.scene?.canvasHeight ?? 0,
    ]);
    [this.last, this.sun] = [now, sun];
    if (now - this.began < CAPTURE_MS) return null;
    this.began = -1;
    return lightParts(this.rows, s.name, s.joined, about);
  }
}

/** A capture's rows as reports of the record of play: each names the ticks its rows cover, and holds PART_BYTES at most. */
export function lightParts(rows: readonly (number | string)[][], name: string, joined: number, about: Record<string, unknown> = {}): string[] {
  const id = new Date().toISOString(), tick = LIGHT_FIELDS.indexOf("tick");
  const groups: (number | string)[][][] = [[]];
  let bytes = 0;
  for (const row of rows) {
    const n = JSON.stringify(row).length + 1;
    if (bytes + n > PART_BYTES - 2048 && groups.at(-1)!.length > 0) [groups[groups.length], bytes] = [[], 0];
    groups.at(-1)!.push(row);
    bytes += n;
  }
  return groups.map((g, part) => {
    const ticks = g.map((r) => r[tick] as number);
    return JSON.stringify({ v: PLAY_VERSION, name, joined, n: -1, from: Math.min(...ticks), to: Math.max(...ticks), light: { id, part, parts: groups.length, ...about, fields: LIGHT_FIELDS, rows: g } });
  });
}
