// The Timeline tab: the last three minutes a second each, the worst frame and the usual one against the display, lag
// events marked over them and pictures under them. A second chosen shows its frames, its events and its picture; an
// event chosen opens the Frame tab on the frame it happened in.

import type { UiImage } from "../ui/nodes.ts";
import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { EVENT_COLOURS, EVENT_NAMES, EV_ERROR, EV_GAP, EV_STALL, EV_TICK, type LagEvent } from "./events.ts";
import { Paint } from "./paint.ts";
import { C, CELLS, FLAG_AFTER_SHOT, FLAG_SHOT, LATE, S_FRAMES, S_LATE, S_SUM, S_WORST } from "./ring.ts";
import { SpanFrame } from "./spans.ts";
import { ACCENT, BAD, D_BUTTON, D_DIM, D_FAINT, D_MONO, D_MONO_BAD, D_MONO_DIM, D_TEXT, D_WELL, FILL_RULE, INK_FAINT, WARN, opaque, WELL } from "./styles.ts";
import { TAB_ACT, type Press, type Tab } from "./tab.ts";
import { ago, ms, share } from "./words.ts";

/** Seconds shown, and the chart's image slots. */
const SECONDS = 180;
const CHART = 0, FRAMES = 1, PICTURE = 2;
const ACT_CHART = TAB_ACT, ACT_EVENT = TAB_ACT + 1, ACT_PICTURES = TAB_ACT + 2, ACT_NOW = TAB_ACT + 3;
/** Long frame, stall: the colours a second's bar takes past each. */
const ORANGE = 0xf2a477;

export class TimelineTab implements Tab {
  readonly name = "Timeline";
  private readonly chart = new Paint();
  private readonly frames = new Paint();
  /** The second chosen on the page's clock, or -1 for the latest; and the one under the pointer. */
  private chosen = -1;
  private hovered = -1;
  /** The chart's newest second as last laid out, so a press is read against what was shown. */
  private newest = 0;
  private readonly listed: LagEvent[] = [];
  private readonly pictures = new Map<string, UiImage>();
  private top = 50;

  badge(d: DebugBar): string {
    return d.events.fresh > 0 && !(d.open && d.tabs[d.tab] === this) ? String(Math.min(99, d.events.fresh)) : "";
  }

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void {
    d.events.fresh = 0;
    const perf = d.perf, target = perf.target, newest = (this.newest = Math.floor(nowMs / 1000));
    // The summary over the window, or the second under the pointer.
    let frames = 0, sum = 0, late = 0, worst = 0;
    for (let t = newest - SECONDS + 1; t <= newest; t++) {
      const r = perf.secondAt(t);
      if (r < 0) continue;
      const q = perf.seconds;
      frames += q[r + S_FRAMES]!;
      sum += q[r + S_SUM]!;
      late += q[r + S_LATE]!;
      worst = Math.max(worst, q[r + S_WORST]!);
    }
    const hz = Math.round(1000 / target), shown = d.events.between((newest - SECONDS + 1) * 1000, nowMs, this.listed).length;
    const over = this.hovered >= 0 ? this.secondWords(d, this.hovered, nowMs) : frames > 0 ? `Last 3 min: ${Math.round((frames * 1000) / sum)} fps of ${hz} · ${late} late (${share(late, frames)}) · worst ${ms(worst)} · ${shown} event${shown === 1 ? "" : "s"}` : "No frames kept yet.";
    draw.text(x, y, w - 210, this.hovered >= 0 ? D_TEXT : D_DIM, over);
    const paused = d.shots?.paused ?? true;
    draw.button(x + w - 200, y - 2, 96, 18, D_BUTTON, d.shots ? (paused ? "Pictures off" : "Pictures on") : "No pictures", ACT_PICTURES, 0, "Pictures every two seconds and at each event");
    draw.button(x + w - 98, y - 2, 98, 18, D_BUTTON, this.chosen < 0 ? "Following now" : "Back to now", ACT_NOW, 0);

    // The chart: a column a second, the worst frame and under it the usual one, events over, pictures under.
    const chartY = y + 22, chartH = Math.round(Math.max(56, Math.min(110, h * 0.4)));
    this.top = Math.min(250, Math.max(50, target * 2.5, worst * 1.1));
    this.paintChart(d, nowMs, Math.round(w * d.unit), Math.round(chartH * d.unit));
    draw.box(x, chartY, w, chartH, D_WELL);
    draw.picture(x, chartY, w, chartH, d.imageOf(CHART, this.chart.image), ACT_CHART, 0, true);
    draw.text(x + 4, chartY + chartH + 1, 80, D_FAINT, "3 min ago");
    draw.text(x + w / 2 - 30, chartY + chartH + 1, 80, D_FAINT, "1:30 ago");
    draw.text(x + w - 26, chartY + chartH + 1, 30, D_FAINT, "now");
    draw.text(x + 4, chartY + 2, 200, D_FAINT, `${Math.round(this.top)} ms`);

    // The second chosen, or the last few: its frames, its events, its picture.
    const at = this.chosen >= 0 ? this.chosen : newest, below = chartY + chartH + 18, room = y + h - below;
    const picW = Math.min(Math.round(w * 0.36), Math.round(room * 16 / 9)), listW = w - picW - 14;
    this.paintFrames(d, at, Math.round(listW * d.unit), Math.round(36 * d.unit));
    draw.box(x, below, listW, 36, D_WELL);
    draw.picture(x, below, listW, 36, d.imageOf(FRAMES, this.frames.image), 0, 0, true);
    draw.text(x + 4, below + 1, listW - 8, D_FAINT, this.chosen >= 0 ? `the frames of ${ago(nowMs - at * 1000)}` : "the frames of the last second");
    let line = below + 42;
    const from = this.chosen >= 0 ? at * 1000 - 1000 : nowMs - SECONDS * 1000, to = this.chosen >= 0 ? at * 1000 + 2000 : nowMs;
    const list = d.events.between(from, to, this.listed);
    if (list.length === 0) draw.text(x, line, listW, D_FAINT, this.chosen >= 0 ? "No events near this second." : "No lag events in the last three minutes.");
    for (let i = list.length - 1, n = 0; i >= 0 && line + 17 <= y + h; i--, n++) {
      const e = list[i]!;
      const size = e.kind <= EV_GAP || e.kind === EV_TICK ? ms(e.size) : String(e.size);
      draw.text(x, line, 70, D_MONO_DIM, ago(nowMs - e.at), ACT_EVENT, i);
      draw.text(x + 72, line, 110, e.kind === EV_STALL || e.kind === EV_ERROR ? D_MONO_BAD : D_MONO, `${EVENT_NAMES[e.kind]}${e.count > 1 ? ` ×${e.count}` : ""}`, ACT_EVENT, i);
      draw.text(x + 186, line, 64, D_MONO_DIM, size, ACT_EVENT, i);
      draw.text(x + 254, line, listW - 254, D_MONO_DIM, e.cause, ACT_EVENT, i, e.frame >= 0 ? "Show this frame in the Frame tab" : "");
      line += 17;
    }
    const shot = d.shots?.nearest(at * 1000 + 500) ?? null, px = x + listW + 14;
    if (shot) {
      const ph = Math.min(room, Math.round((picW * shot.picture.h) / Math.max(1, shot.picture.w)));
      draw.box(px, below, picW, ph, D_WELL);
      draw.picture(px, below, picW, ph, d.imageOf(PICTURE, this.imageOf(shot.picture.url, shot.picture.w, shot.picture.h)));
      draw.text(px + 4, below + ph - 17, picW - 8, D_TEXT, `${ago(nowMs - shot.at)}${shot.why ? ` · ${shot.why}` : ""}`);
    } else draw.text(px, below, picW, D_FAINT, d.shots ? "No picture yet." : "Pictures need the browser.");
  }

  /** A picture by its URL as the interface's image, made once and kept while the ring keeps the picture. */
  private imageOf(url: string, w: number, h: number): UiImage {
    let im = this.pictures.get(url);
    if (!im) {
      if (this.pictures.size > 8) this.pictures.clear();
      this.pictures.set(url, (im = { width: w, height: h, data: new Uint8ClampedArray(0), version: 0, url, smooth: true }));
    }
    return im;
  }

  /** What one second held, for the line over the chart. */
  private secondWords(d: DebugBar, t: number, nowMs: number): string {
    const r = d.perf.secondAt(t);
    if (r < 0) return `${ago(nowMs - t * 1000)}: no frame drawn`;
    const q = d.perf.seconds, n = q[r + S_FRAMES]!;
    return `${ago(nowMs - t * 1000)}: ${n} frames · usual ${ms(q[r + S_SUM]! / Math.max(1, n))} · worst ${ms(q[r + S_WORST]!)} · ${q[r + S_LATE]!} late`;
  }

  private paintChart(d: DebugBar, nowMs: number, w: number, h: number): void {
    const p = this.chart, perf = d.perf, q = perf.seconds, target = perf.target, top = this.top, colW = w / SECONDS, room = h - 6, first = this.newest - SECONDS + 1;
    p.size(w, h);
    p.clear(WELL);
    const y = (v: number): number => h - Math.min(room, (v / top) * room);
    for (const guide of [target, 33.3, 50]) if (guide < top) p.rect(0, y(guide), w, 1, opaque(FILL_RULE));
    for (let c = 0; c < SECONDS; c++) {
      const t = first + c, r = perf.secondAt(t);
      if (t === this.chosen || t === this.hovered) p.rect(c * colW, 0, Math.max(1, colW), h, opaque(ACCENT, t === this.chosen ? 60 : 30));
      if (r < 0 || q[r + S_FRAMES]! === 0) continue;
      const worst = q[r + S_WORST]!, usual = q[r + S_SUM]! / q[r + S_FRAMES]!;
      const colour = worst > 250 ? BAD : worst > 50 ? ORANGE : worst > LATE * target ? WARN : ACCENT;
      const x0 = c * colW + 0.5, cw = Math.max(1, colW - 1);
      p.rect(x0, y(worst), cw, h - y(worst), opaque(colour, 110));
      p.rect(x0, y(usual), cw, h - y(usual), opaque(colour, 255));
    }
    for (const e of d.events.list) {
      const c = Math.floor(e.at / 1000) - first;
      if (c >= 0 && c < SECONDS) p.rect(c * colW, 0, Math.max(2, colW), 4, opaque(EVENT_COLOURS[e.kind]!));
    }
    for (const s of d.shots?.shots ?? []) {
      const c = Math.floor(s.at / 1000) - first;
      if (c >= 0 && c < SECONDS) p.rect(c * colW + colW / 2 - 1, h - 3, 2, 3, opaque(INK_FAINT));
    }
    p.done();
  }

  /** The frames of second `t`, a column each, against the display's interval. */
  private paintFrames(d: DebugBar, t: number, w: number, h: number): void {
    const p = this.frames, perf = d.perf, target = perf.target, top = Math.max(this.top, 34);
    p.size(w, h);
    p.clear(WELL);
    const from = t * 1000, to = from + 1000;
    let n = 0;
    for (let back = 0; back < 400; back++) {
      const k = perf.row(back);
      if (k < 0 || perf.at[k]! < from) break;
      if (perf.at[k]! < to) n++;
    }
    const colW = n > 0 ? Math.min(12, w / n) : 1, room = h - 4;
    let c = n - 1;
    for (let back = 0; back < 400 && c >= 0; back++) {
      const k = perf.row(back);
      if (k < 0 || perf.at[k]! < from) break;
      if (perf.at[k]! >= to) continue;
      const v = perf.cells[k * CELLS + C.interval]!, flags = perf.cells[k * CELLS + C.flags]!;
      const bh = Math.min(room, (v / top) * room), colour = v > 50 ? BAD : v > LATE * target ? WARN : ACCENT;
      p.rect(c * colW + 0.5, h - bh, Math.max(1, colW - 1), bh, opaque(colour, (flags & (FLAG_SHOT | FLAG_AFTER_SHOT)) !== 0 ? 120 : 255));
      c--;
    }
    p.rect(0, h - Math.min(room, (target / top) * room), w, 1, opaque(FILL_RULE));
    p.done();
  }

  press(d: DebugBar, p: Press): void {
    if (p.act === ACT_CHART) {
      const t = this.newest - SECONDS + 1 + Math.min(SECONDS - 1, Math.floor(p.fx * SECONDS));
      this.chosen = this.chosen === t ? -1 : t;
    } else if (p.act === ACT_NOW) this.chosen = -1;
    else if (p.act === ACT_PICTURES && d.shots) d.shots.paused = !d.shots.paused;
    else if (p.act === ACT_EVENT) {
      const e = this.listed[p.arg];
      if (!e || !e.spans) return;
      const f = (d.chosenSpans ??= new SpanFrame());
      for (let s = 0; s < f.start.length; s++) {
        f.start[s] = e.spans[s]!;
        f.ms[s] = e.spans[f.start.length + s]!;
      }
      f.at = e.at;
      f.frames = 1;
      d.chosenAt = e.at;
      d.show(d.tabs.findIndex((t) => t.name === "Frame"));
    }
  }

  hover(_d: DebugBar, p: Press): boolean {
    if (p.act !== ACT_CHART) {
      const was = this.hovered;
      this.hovered = -1;
      return was >= 0;
    }
    const t = this.newest - SECONDS + 1 + Math.min(SECONDS - 1, Math.floor(p.fx * SECONDS));
    if (t === this.hovered) return false;
    this.hovered = t;
    return true;
  }
}
