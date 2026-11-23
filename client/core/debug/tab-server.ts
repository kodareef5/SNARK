// The Server tab, an admin's: the server's ticks over the last two minutes, where its ticks went since the bar last
// asked, its long ticks and whose time they took, its bodies and memory, and this connection's bytes. The bar asks the
// server once a second while the tab shows (debug.ts poll).

import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { Paint } from "./paint.ts";
import { ACCENT, BAD, D_DIM, D_FAINT, D_MONO, D_MONO_DIM, D_WARN, D_WELL, FILL_RULE, WARN, colourOf, opaque } from "./styles.ts";
import type { Tab } from "./tab.ts";
import { ago, bytes, count, ms, share } from "./words.ts";

const CHART = 6;
/** A tick's time, at 30 a second. */
const TICK_MS = 1000 / 30;

export class ServerTab implements Tab {
  readonly name = "Server";
  private readonly chart = new Paint();

  shown(d: DebugBar): boolean {
    return d.app.session.admin;
  }

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void {
    const s = d.server;
    if (!d.app.session.admin) return void draw.text(x, y, w, D_DIM, "The server's state is an admin's: type enablecheats in the console.");
    if (!s) return void draw.text(x, y, w, D_DIM, d.port ? "Asking the server…" : "Asking the server needs the browser's part of the bar.");
    const sec = s.ticks.seconds, n = sec.p50.length, last10 = Math.max(0, n - 10);
    let worst = 0, late = 0, dropped = 0, p50 = 0;
    for (let i = last10; i < n; i++) {
      worst = Math.max(worst, sec.worst[i]!);
      late += sec.late[i]!;
      dropped += sec.dropped[i]!;
      p50 += sec.p50[i]!;
    }
    p50 /= Math.max(1, n - last10);
    const up = Date.parse(s.at) - Date.parse(s.world.startedAt);
    draw.text(x, y, w, D_DIM, `${s.world.name} · tick ${count(s.world.tick)} · ${s.world.online} online · up ${ago(up).replace(" ago", "")} · last 10 s: usual ${ms(p50)}, worst ${ms(worst)}, ${late} late, ${dropped} given up · asked ${ago(nowMs - d.serverAt)}`);

    // Ticks by the second: the usual tick and the worst, against a tick's time.
    const chartY = y + 22, chartH = Math.round(Math.max(50, Math.min(90, h * 0.32))), half = Math.floor((w - 16) / 2);
    this.paint(sec.p50, sec.worst, Math.round(w * d.unit), Math.round(chartH * d.unit));
    draw.box(x, chartY, w, chartH, D_WELL);
    draw.picture(x, chartY, w, chartH, d.imageOf(CHART, this.chart.image), 0, true);
    draw.text(x + 4, chartY + 2, w - 8, D_FAINT, `ticks a second over ${n} s: the usual and the worst, against a tick's ${ms(TICK_MS)}`);

    // Where the ticks went since the answer before: each part's ms a tick.
    let at = chartY + chartH + 8;
    const top = at;
    at += draw.heading(x, at, half, "WHERE A TICK WENT, SINCE THE LAST ASK");
    const before = d.serverBefore, parts = s.parts, ticks = before ? parts.ticks - before.parts.ticks : parts.ticks;
    const each = parts.names.map((name, i) => ({ name, ms: ticks > 0 ? (parts.all[i]! - (before?.parts.all[i] ?? 0)) / ticks : 0 })).filter((p) => p.ms >= 0.005).sort((a, b) => b.ms - a.ms);
    const total = each.reduce((t, p) => t + p.ms, 0);
    for (const p of each) {
      if (at + 17 > y + h) break;
      const bw = Math.max(1, (p.ms / Math.max(total, 0.001)) * (half * 0.4));
      draw.box(x, at + 4, bw, 9, D_WELL, colourOf(p.name));
      draw.text(x + half * 0.4 + 6, at, half * 0.6 - 76, D_MONO, p.name);
      draw.text(x + half - 70, at, 70, D_MONO_DIM, `${ms(p.ms)} ${share(p.ms, total)}`);
      at += 17;
    }
    if (each.length === 0) draw.text(x, at, half, D_FAINT, "No ticks between the last two asks.");

    // Long ticks, newest first, then the world's bodies, memory and this connection.
    const rx = x + half + 16;
    at = top + draw.heading(rx, top, half, `LONG TICKS, PAST ${ms(parts.limit)}`);
    const long = s.long;
    if (long.length === 0) at += draw.text(rx, at, half, D_FAINT, "None in the last two minutes.");
    for (let i = long.length - 1, shown = 0; i >= 0 && shown < 5 && at + 17 <= y + h - 60; i--, shown++) {
      const t = long[i]!;
      draw.text(rx, at, 70, D_MONO_DIM, ago(Date.parse(s.at) - t.at));
      draw.text(rx + 72, at, 60, t.ms > 100 ? D_WARN : D_MONO, ms(t.ms));
      draw.text(rx + 134, at, 40, D_MONO_DIM, t.whose);
      at += draw.text(rx + 176, at, half - 176, D_MONO_DIM, t.text);
    }
    at += 6;
    const groups = Object.entries(s.bodies.groups).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} ${k}`).join(", ");
    if (at + 17 <= y + h) at += draw.pair(rx, at, half, "bodies", `${count(s.bodies.count)} of ${count(s.bodies.max)}${groups ? `: ${groups}` : ""}`);
    if (at + 17 <= y + h) at += draw.pair(rx, at, half, "memory", `${bytes(s.memory.rss)} resident, heap ${bytes(s.memory.heapUsed)}`);
    if (at + 17 <= y + h) draw.pair(rx, at, half, "this connection", `${bytes(s.connection.sent)} sent, ${count(s.connection.skipped)} skipped, ${bytes(s.connection.waiting)} waiting`, s.connection.skipped > 0 ? D_WARN : D_MONO_DIM);
  }

  private paint(p50: readonly number[], worst: readonly number[], w: number, h: number): void {
    const p = this.chart, n = p50.length, colW = w / Math.max(60, n), top = Math.max(TICK_MS * 1.5, ...worst.map((v) => Math.min(v, 250)));
    p.size(w, h);
    p.clear(0);
    const room = h - 14, yOf = (v: number): number => h - Math.min(room, (v / top) * room);
    p.rect(0, yOf(TICK_MS), w, 1, opaque(FILL_RULE));
    for (let i = 0; i < n; i++) {
      const x0 = w - (n - i) * colW + 0.5, cw = Math.max(1, colW - 1), colour = worst[i]! > TICK_MS ? (worst[i]! > TICK_MS * 3 ? BAD : WARN) : ACCENT;
      p.rect(x0, yOf(worst[i]!), cw, h - yOf(worst[i]!), opaque(colour, 100));
      p.rect(x0, yOf(p50[i]!), cw, h - yOf(p50[i]!), opaque(colour));
    }
    p.done();
  }
}
