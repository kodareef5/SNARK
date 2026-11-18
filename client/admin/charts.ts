// The admin page's charts: the tiles' last two minutes, and the last hours a point a minute (client/core/admin/chart.ts).

import { chartRuns, clockText, timeTicks, valueAxis } from "../core/admin/chart.ts";
import { $, BAD, FACE, ICE, S, WARN, WELL, fit, offset } from "./dom.ts";

/** The last two minutes, a point a second, as lines over the tile's foot. */
export function spark(c: HTMLCanvasElement, series: number[][], colours: string[], top: number): void {
  const g = fit(c), w = c.clientWidth, h = c.clientHeight;
  series.forEach((v, k) => {
    g.strokeStyle = colours[k]!;
    g.lineWidth = 1.5;
    g.beginPath();
    v.forEach((y, i) => g.lineTo((i / Math.max(1, v.length - 1)) * w, h - 1 - (Math.min(y, top) / top) * (h - 2)));
    g.stroke();
  });
}

function chart(id: string, lines: { v: number[]; colour: string; fill?: boolean }[], floor: number, words: (v: number) => string, budget = 0): void {
  const c = $<HTMLCanvasElement>(id), g = fit(c), w = c.clientWidth, h = c.clientHeight;
  const [left, foot] = [44, 18];
  const at = S.minutes?.columns.at ?? [];
  const t1 = S.stats?.at ?? Date.now(), t0 = t1 - S.span.ms;
  const shown = (v: number[]): number[] => v.filter((_, i) => at[i]! >= t0);
  const axis = valueAxis(Math.max(0, ...lines.flatMap((l) => shown(l.v))), floor);
  g.font = `12px ${FACE}`;
  g.fillStyle = "#93a9bd";
  g.strokeStyle = "rgba(168,204,234,0.12)";
  for (const v of axis.ticks) {
    const y = Math.round(h - foot - (v / axis.top) * (h - foot - 6)) + 0.5;
    g.fillText(words(v), 0, y + 4);
    g.beginPath();
    g.moveTo(left, y);
    g.lineTo(w, y);
    g.stroke();
  }
  for (const t of timeTicks(t0, t1, Math.max(2, Math.floor(w / 90)), offset)) g.fillText(clockText(t, offset), left + ((t - t0) / S.span.ms) * (w - left) - 14, h - 3);
  if (at.length === 0) g.fillText("the first minute is being timed", left + 8, (h - foot) / 2);
  g.save();
  g.translate(left, 6);
  const [cw, ch] = [w - left, h - foot - 6];
  if (budget > 0) {
    g.strokeStyle = BAD;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(0, ch - (budget / axis.top) * ch);
    g.lineTo(cw, ch - (budget / axis.top) * ch);
    g.stroke();
    g.setLineDash([]);
  }
  for (const l of lines) {
    for (const run of chartRuns(at, l.v, t0, t1, axis.top, cw, ch, 90_000)) {
      g.beginPath();
      for (let i = 0; i < run.length; i += 2) g.lineTo(run[i]!, run[i + 1]!);
      if (l.fill && run.length > 2) {
        g.lineTo(run[run.length - 2]!, ch);
        g.lineTo(run[0]!, ch);
        g.fillStyle = "rgba(169,214,242,0.22)";
        g.fill();
      } else {
        g.strokeStyle = l.colour;
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
  }
  g.restore();
}

export function drawCharts(): void {
  const m = S.minutes?.columns, none: number[] = [];
  const mb = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} GB` : `${Math.round(v / 1e6)} MB`);
  const budget = S.stats?.ticks.budget ?? 33;
  chart("c-tick", [{ v: m?.p50 ?? none, colour: ICE, fill: true }, { v: m?.p50 ?? none, colour: ICE }, { v: m?.worst ?? none, colour: WARN }], budget, (v) => `${v} ms`, budget);
  chart("c-late", [{ v: m?.late ?? none, colour: WARN }, { v: m?.lateMean ?? none, colour: ICE }], 10, (v) => `${v} ms`);
  chart("c-online", [{ v: m?.online ?? none, colour: WELL }], 4, (v) => String(v));
  chart("c-memory", [{ v: m?.rss ?? none, colour: ICE }, { v: m?.heap ?? none, colour: WELL }], 1e8, mb);
}
