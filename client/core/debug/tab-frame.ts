// The Frame tab: where a frame's time went, as a flame chart. A row for each depth of the tree of slots (the frame; its
// input, the app, the interface and the draw; the app's parts; the scene's passes...), each slot a bar as long as its
// time, and under them the card's time by pass. The frame is the latest, the mean of the last second, the slowest of the
// last five, or one an event chose. Beside it, the slots that took most by themselves, and what the frame drew against
// what the tier allows.

import { census, type Count } from "./census.ts";
import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { Paint } from "./paint.ts";
import { LANE_BROWSER, LANE_CARD, LANE_FRAME, SpanFrame } from "./spans.ts";
import { D_BUTTON, D_DIM, D_FAINT, D_MONO, D_MONO_DIM, D_TAB_ON, D_TEXT, D_WARN, D_WELL, FILL_RULE, colourOf, opaque, WELL } from "./styles.ts";
import { TAB_ACT, type Press, type Tab } from "./tab.ts";
import { ago, count, ms, share } from "./words.ts";

/** The chart's image slot. */
const CHART = 4;
const ACT_MODE = TAB_ACT, ACT_CHART = TAB_ACT + 1;
const MODES = ["This frame", "Mean of 1 s", "Slowest of 5 s", "Chosen"] as const;
const LATEST = 0, MEAN = 1, SLOWEST = 2, CHOSEN = 3;
/** Rows of the page's own lane at most, a row's height, and the card's band. */
const ROWS = 7, ROW_H = 16, CARD_H = 18;
/** The narrowest bar that is named on the chart, in canvas units. */
const NAMED = 46;
/** How often what the frame drew is counted again, in ms. */
const CENSUS_MS = 500;

export class FrameTab implements Tab {
  readonly name = "Frame";
  private mode = LATEST;
  private readonly chart = new Paint();
  private readonly frame = new SpanFrame();
  private readonly own = new Float64Array(256);
  private hovered = -1;
  /** What the chart was laid out at: its total ms, its rows, the depth each row is. */
  private total = 1;
  private stores: Count[] = [];
  private countedAt = -Infinity;

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void {
    const spans = d.spans, f = this.frame;
    if (this.mode === CHOSEN && !d.chosenSpans) this.mode = LATEST;
    if (d.chosenAt >= 0 && d.chosenSpans && this.mode !== CHOSEN && d.chosenAt !== this.chosenSeen) this.mode = CHOSEN;
    this.chosenSeen = d.chosenAt;
    let what: string;
    if (this.mode === MEAN) {
      const n = spans.mean(0, 60, f);
      what = `mean of ${n} frames`;
    } else if (this.mode === SLOWEST) {
      spans.read(spans.slowest(300), f);
      what = f.frames > 0 ? `the slowest of the last 5 s, ${ago(nowMs - f.at)}` : "no frames yet";
    } else if (this.mode === CHOSEN && d.chosenSpans) {
      const c = d.chosenSpans;
      f.start.set(c.start);
      f.ms.set(c.ms);
      f.at = c.at;
      f.frames = 1;
      what = `the frame before the event ${ago(nowMs - d.chosenAt)}`;
    } else {
      spans.read(spans.row(0), f);
      what = "the latest frame";
    }
    const modes = MODES.map((_, m) => m).filter((m) => m !== CHOSEN || d.chosenSpans !== null), widths = modes.map((m) => (m === CHOSEN ? 70 : 104));
    const used = widths.reduce((a, b) => a + b + 4, 0), beside = used + 240 <= w;
    const head = draw.buttons(x, y, w, modes.map((m) => MODES[m]!), widths, modes.map((m) => this.mode === m), ACT_MODE, modes, D_TAB_ON, D_BUTTON);
    const frameMs = f.ms[LANE_FRAME]!, cardMs = f.ms[LANE_CARD]!, target = d.perf.target;
    const said = `${what}: page ${ms(frameMs)}${cardMs > 0 ? ` · card ${ms(cardMs)}` : " · card not timed"} · the display ${ms(target)}`;
    if (beside) draw.text(x + used + 4, y, w - used - 4, D_DIM, said);
    else draw.text(x, y + head - 2, w, D_DIM, said);

    // The chart: the page's lane, a row a depth, then the card's band.
    const left = x, chartY = y + (beside ? 22 : head + 18), chartW = Math.round(w * 0.64), rows = this.depthOf(d, f), chartH = rows * ROW_H + 6 + CARD_H;
    this.total = Math.max(frameMs, cardMs, target, 1);
    this.paint(d, f, Math.round(chartW * d.unit), Math.round(chartH * d.unit), rows);
    draw.box(left, chartY, chartW, chartH, D_WELL);
    draw.picture(left, chartY, chartW, chartH, d.imageOf(CHART, this.chart.image), ACT_CHART, 0, true);
    // The bars wide enough to name, and the card's passes.
    const names = spans.names;
    let named = 0;
    for (let s = 0; s < names.length && named < 80; s++) {
      const start = f.start[s]!, lane = spans.lane(s);
      if (Number.isNaN(start) || lane === LANE_BROWSER) continue;
      const bw = (f.ms[s]! / this.total) * chartW;
      if (bw < NAMED) continue;
      const depth = spans.depths[s]!, ty = lane === LANE_CARD ? chartY + rows * ROW_H + 6 + 1 : chartY + depth * ROW_H;
      // The card's root is the band itself, which its passes fill and name.
      if ((lane === LANE_FRAME && depth >= rows) || (lane === LANE_CARD && depth === 0)) continue;
      draw.text(left + (start / this.total) * chartW + 3, ty, bw - 6, D_MONO, `${names[s]} ${f.ms[s]!.toFixed(1)}`);
      named++;
    }
    // The display's interval across the chart.
    const tx = left + (target / this.total) * chartW;
    if (target < this.total) draw.box(tx, chartY, 1, chartH, D_WELL, 0xf0c060, 0.7);
    draw.text(left + 4, chartY + chartH + 1, 160, D_FAINT, "0");
    draw.text(left + chartW - 70, chartY + chartH + 1, 70, D_FAINT, ms(this.total));
    // What the pointer is on.
    const hover = this.hovered >= 0 && !Number.isNaN(f.start[this.hovered]!) ? this.hovered : -1;
    const self = this.selfOf(d, f);
    draw.text(left, chartY + chartH + 18, chartW, hover >= 0 ? D_TEXT : D_FAINT, hover >= 0 ? `${d.pathOf(hover)}: ${ms(f.ms[hover]!)} (${share(f.ms[hover]!, frameMs)} of the page), by itself ${ms(self[hover]!)}` : "Point at a bar to name it. The card's times come a few frames late.");

    // Beside the chart: the slots that took most by themselves.
    const rx = left + chartW + 16, rw = w - chartW - 16;
    let at = chartY + draw.heading(rx, chartY, rw, "MOST TIME BY ITSELF");
    const order: number[] = [];
    for (let s = 0; s < names.length; s++) if (!Number.isNaN(f.start[s]!) && spans.parents[s]! >= 0 && spans.lane(s) === LANE_FRAME && self[s]! > 0.005) order.push(s);
    order.sort((a, b) => self[b]! - self[a]!);
    for (let i = 0; i < order.length && at + 17 <= chartY + chartH + 36; i++) {
      const s = order[i]!;
      draw.text(rx, at, rw - 70, D_MONO, d.pathOf(s));
      draw.text(rx + rw - 66, at, 66, D_MONO_DIM, ms(self[s]!));
      at += 17;
    }

    // Under it: what the frame drew, by store, against the tier's allowance.
    const by = chartY + chartH + 40;
    if (by + 34 <= y + h) this.drawn(d, draw, x, by, w, y + h - by, nowMs);
  }

  private chosenSeen = -1;

  /** The deepest row of the page's lane that ran in `f`, plus one, at most ROWS. */
  private depthOf(d: DebugBar, f: SpanFrame): number {
    let deepest = 0;
    for (let s = 0; s < d.spans.names.length; s++) if (!Number.isNaN(f.start[s]!) && d.spans.lane(s) === LANE_FRAME) deepest = Math.max(deepest, d.spans.depths[s]!);
    return Math.min(ROWS, deepest + 1);
  }

  /** Each slot's time by itself: its own less its children's. */
  private selfOf(d: DebugBar, f: SpanFrame): Float64Array {
    const own = this.own, parents = d.spans.parents, n = d.spans.names.length;
    own.fill(0);
    for (let s = 0; s < n; s++) if (!Number.isNaN(f.start[s]!)) own[s]! += f.ms[s]!;
    for (let s = 0; s < n; s++) if (!Number.isNaN(f.start[s]!) && parents[s]! >= 0) own[parents[s]!]! -= f.ms[s]!;
    for (let s = 0; s < n; s++) own[s] = Math.max(0, own[s]!);
    return own;
  }

  private paint(d: DebugBar, f: SpanFrame, w: number, h: number, rows: number): void {
    const p = this.chart, spans = d.spans, total = this.total, rowH = (ROW_H / (rows * ROW_H + 6 + CARD_H)) * h, cardY = rows * rowH + (6 / (rows * ROW_H + 6 + CARD_H)) * h;
    p.size(w, h);
    p.clear(WELL);
    for (let r = 1; r < rows; r++) p.rect(0, r * rowH - 1, w, 1, opaque(FILL_RULE, 120));
    for (let s = 0; s < spans.names.length; s++) {
      const start = f.start[s]!, lane = spans.lane(s);
      if (Number.isNaN(start) || lane === LANE_BROWSER || f.ms[s]! <= 0) continue;
      const depth = spans.depths[s]!;
      if (lane === LANE_FRAME && depth >= rows) continue;
      const x0 = (start / total) * w, bw = Math.max(1, (f.ms[s]! / total) * w);
      const y0 = lane === LANE_CARD ? (depth === 0 ? -1 : cardY) : depth * rowH;
      if (y0 < 0) continue;
      const colour = colourOf(spans.names[s]!), alpha = s === this.hovered ? 255 : depth === 0 ? 150 : 215;
      p.rect(x0, y0 + 1, bw, (lane === LANE_CARD ? (CARD_H / ROW_H) * rowH : rowH) - 2, opaque(colour, alpha));
      if (bw > 3) p.rect(x0 + bw - 1, y0 + 1, 1, rowH - 2, opaque(0x0a141d, 200));
    }
    p.done();
  }

  /** Triangles and draws by store against the tier's allowance, counted a few times a second. */
  private drawn(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void {
    const scene = d.app.scene, p = scene?.packet;
    if (!scene || !p) return;
    if (nowMs - this.countedAt >= CENSUS_MS) {
      this.countedAt = nowMs;
      this.stores = census(p, 0, scene.assets.table.tris, () => "").stores;
    }
    const budget = scene.budget, half = Math.floor((w - 16) / 2);
    const tris = this.stores.reduce((n, s) => n + s.triangles, 0), draws = this.stores.reduce((n, s) => n + (s.name === "ground tiles" ? 0 : s.draws), 0);
    const mega = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : `${Math.round(n / 1000)} k`);
    let at = y + draw.heading(x, y, half, `TRIANGLES ${mega(tris)}${budget.triangles > 0 ? ` of ${mega(budget.triangles)}` : ""}`);
    for (const s of this.stores.slice(0, Math.floor((h - 20) / 17))) {
      if (s.triangles <= 0) continue;
      at += draw.pair(x, at, half, s.name, `${mega(s.triangles)} · ${share(s.triangles, tris)}`);
    }
    const dx = x + half + 16, byDraws = this.stores.filter((s) => s.name !== "ground tiles").sort((a, b) => b.draws - a.draws);
    at = y + draw.heading(dx, y, half, `DRAWS ${count(draws)}${budget.draws > 0 ? ` of ${count(budget.draws)}` : ""}`);
    for (const s of byDraws.slice(0, Math.floor((h - 38) / 17))) at += draw.pair(dx, at, half, s.name, count(s.draws));
    const g = d.app.governor;
    if (at + 17 <= y + h) draw.text(dx, at, half, budget.squeeze < 1 || g.level > 0 ? D_WARN : D_DIM, `squeeze ${budget.squeeze.toFixed(2)} · governor level ${g.level}${g.level > 0 ? ` (${g.name})` : ""}`);
  }

  press(_d: DebugBar, p: Press): void {
    if (p.act === ACT_MODE) this.mode = p.arg;
  }

  hover(d: DebugBar, p: Press): boolean {
    let found = -1;
    if (p.act === ACT_CHART) {
      const f = this.frame, rows = this.depthOf(d, f), rowsH = rows * ROW_H, all = rowsH + 6 + CARD_H, yy = p.fy * all, t = p.fx * this.total;
      const card = yy > rowsH + 6, depth = Math.floor(yy / ROW_H);
      for (let s = 0; s < d.spans.names.length; s++) {
        const start = f.start[s]!, lane = d.spans.lane(s);
        if (Number.isNaN(start) || t < start || t > start + f.ms[s]!) continue;
        if (card ? lane === LANE_CARD && d.spans.depths[s]! > 0 : lane === LANE_FRAME && d.spans.depths[s] === depth) found = s;
      }
    }
    if (found === this.hovered) return false;
    this.hovered = found;
    return true;
  }
}
