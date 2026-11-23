// The Network tab: the game's socket by category over the last minute, a stacked bar a second, then each kind of message
// with its rates, a snapshot's sections and the bodies in it, and beside the socket the assets' downloads over HTTP.

import { textWidth } from "../ui/nodes.ts";
import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { BODY_CLASSES, CATEGORIES, NET_IN, NET_OUT, OPS, SECTIONS, SnapshotParts, type NetRow } from "./net.ts";
import { Paint } from "./paint.ts";
import { D_BUTTON, D_DIM, D_FAINT, D_MONO, D_MONO_DIM, D_TAB_ON, D_TEXT, D_WARN, D_WELL, FILL_RULE, colourOf, opaque } from "./styles.ts";
import { TAB_ACT, type Press, type Tab } from "./tab.ts";
import { count, ms, rate, share } from "./words.ts";

const CHART = 5;
/** Seconds the chart shows. */
const SHOWN = 60;
const ACT_DIR = TAB_ACT;
const DIRS = ["In and out", "In", "Out"];
const LINE = 17;

export class NetworkTab implements Tab {
  readonly name = "Network";
  private dir = 0;
  private readonly chart = new Paint();
  private readonly bytes = new Float64Array(CATEGORIES.length * SHOWN);
  private readonly msgs = new Float64Array(CATEGORIES.length * SHOWN);
  private readonly rows: NetRow[] = [];
  private readonly parts = new SnapshotParts();
  private readonly rates = new Float64Array(4);
  private top = 1024;

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number): void {
    const net = d.net, s = d.app.session, dir = this.dir === 1 ? NET_IN : this.dir === 2 ? NET_OUT : -1;
    let bx = x;
    for (let i = 0; i < DIRS.length; i++) {
      draw.button(bx, y - 2, 84, 18, this.dir === i ? D_TAB_ON : D_BUTTON, DIRS[i]!, ACT_DIR, i);
      bx += 88;
    }
    net.rates(this.rates, 1);
    net.snapshots(this.parts, 1);
    const p = this.parts;
    draw.text(bx + 8, y, x + w - bx - 8, D_DIM, `in ${rate(this.rates[0]!)} · out ${rate(this.rates[1]!)} · ${p.count.toFixed(0)} snapshots a second, the longest gap ${ms(p.gap)} · ping ${Math.round((s.stats.rttTicks * 1000) / 30)} ms · margin ${s.stats.margin} · ${count(s.stats.corrections)} corrections`);

    // A stacked bar a second, by category, and the legend with each one's last second.
    const chartY = y + 22, chartH = Math.round(Math.max(48, Math.min(90, h * 0.3)));
    net.series(SHOWN, this.bytes, this.msgs, dir);
    this.paint(Math.round(w * d.unit), Math.round(chartH * d.unit));
    draw.box(x, chartY, w, chartH, D_WELL);
    draw.picture(x, chartY, w, chartH, d.imageOf(CHART, this.chart.image));
    draw.text(x + 4, chartY + 2, 300, D_FAINT, `bytes a second over ${SHOWN} s, top ${rate(this.top)}`);
    let lx = x, ly = chartY + chartH + 4;
    for (let c = 0; c < CATEGORIES.length; c++) {
      const last = this.bytes[c * SHOWN + SHOWN - 1]!;
      if (last <= 0 && !this.seen(c)) continue;
      const label = `${CATEGORIES[c]} ${rate(last)}`, lw = Math.ceil(textWidth(label, D_TEXT)) + 18;
      if (lx + lw > x + w) break;
      draw.box(lx, ly + 4, 8, 8, D_WELL, colourOf(CATEGORIES[c]!));
      draw.text(lx + 12, ly, lw - 12, D_TEXT, label);
      lx += lw + 6;
    }

    // The messages, busiest first over the last ten seconds.
    const tableY = ly + LINE + 6, tableW = Math.round(w * 0.62);
    const n = net.rows(this.rows), shown: NetRow[] = [];
    for (let i = 0; i < n; i++) if (dir < 0 || this.rows[i]!.dir === dir) shown.push(this.rows[i]!);
    shown.sort((a, b) => b.bytes10 - a.bytes10 || b.bytesAll - a.bytesAll);
    const cols = [0, 34, 190, 270, 350, 420];
    draw.text(x + cols[0]!, tableY, 30, D_FAINT, "way");
    draw.text(x + cols[1]!, tableY, 150, D_FAINT, "message");
    draw.text(x + cols[2]!, tableY, 76, D_FAINT, "category");
    draw.text(x + cols[3]!, tableY, 76, D_FAINT, "last second");
    draw.text(x + cols[4]!, tableY, 66, D_FAINT, "a message");
    draw.text(x + cols[5]!, tableY, tableW - cols[5]!, D_FAINT, "ten seconds · all");
    let at = tableY + LINE;
    if (shown.length === 0) draw.text(x, at, tableW, D_FAINT, "Nothing yet: the socket is counted from when the bar came on.");
    for (const r of shown) {
      if (at + LINE > y + h) break;
      const name = r.subName ? `${r.kindName} ${r.subName}` : r.kindName;
      draw.text(x + cols[0]!, at, 30, D_MONO_DIM, r.dir === NET_IN ? "in" : "out");
      draw.text(x + cols[1]!, at, 154, D_MONO, name);
      draw.text(x + cols[2]!, at, 78, D_MONO_DIM, CATEGORIES[r.category]!);
      draw.text(x + cols[3]!, at, 78, D_MONO, rate(r.bytes));
      draw.text(x + cols[4]!, at, 68, D_MONO_DIM, r.messages10 > 0 ? `${Math.round(r.bytes10 / r.messages10)} B` : "–");
      draw.text(x + cols[5]!, at, tableW - cols[5]!, D_MONO_DIM, `${rate(r.bytes10)} · ${count(r.bytesAll / 1024)} KB`);
      at += LINE;
    }

    // Beside it: a snapshot's parts, the bodies in it, and the assets over HTTP.
    const rx = x + tableW + 16, rw = w - tableW - 16, snapBits = p.sections.reduce((a, b) => a + b, 0);
    at = tableY + draw.heading(rx, tableY, rw, "A SECOND OF SNAPSHOTS");
    for (let i = 0; i < SECTIONS.length; i++) if (at + LINE <= y + h) at += draw.pair(rx, at, rw, SECTIONS[i]!, `${rate(p.sections[i]! / 8)} · ${share(p.sections[i]!, snapBits)}`);
    for (let c = 0; c < BODY_CLASSES.length; c++) {
      if (p.classes[c]! <= 0 || at + LINE > y + h) continue;
      let ops = "";
      for (let o = 0; o < OPS.length; o++) {
        const k = o * BODY_CLASSES.length + c;
        if (p.ops[k]! > 0) ops += `${ops ? ", " : ""}${Math.round(p.ops[k]!)} ${OPS[o]}`;
      }
      at += draw.pair(rx, at, rw, `  ${BODY_CLASSES[c]}s`, `${rate(p.classes[c]! / 8)} (${ops})`);
    }
    const frames = d.app.frames;
    if (frames && at + LINE * 2 <= y + h) {
      let fetched = 0;
      const latest = frames.row(0) >= 0 ? frames.at[frames.row(0)]! : 0;
      for (let back = 0; ; back++) {
        const k = frames.row(back);
        if (k < 0 || latest - frames.at[k]! >= 1000) break;
        fetched += frames.fetched[k]!;
      }
      at += 6;
      draw.pair(rx, at, rw, "assets over HTTP", rate(fetched), fetched > 4 * 1024 * 1024 ? D_WARN : undefined);
    }
  }

  /** Whether category `c` had any bytes in the seconds shown. */
  private seen(c: number): boolean {
    for (let i = 0; i < SHOWN; i++) if (this.bytes[c * SHOWN + i]! > 0) return true;
    return false;
  }

  private paint(w: number, h: number): void {
    const p = this.chart, colW = w / SHOWN;
    let top = 1024;
    for (let i = 0; i < SHOWN; i++) {
      let sum = 0;
      for (let c = 0; c < CATEGORIES.length; c++) sum += this.bytes[c * SHOWN + i]!;
      top = Math.max(top, sum);
    }
    this.top = top;
    p.size(w, h);
    p.clear(0);
    const room = h - 14;
    for (const guide of [0.25, 0.5, 0.75]) p.rect(0, h - room * guide, w, 1, opaque(FILL_RULE, 120));
    for (let i = 0; i < SHOWN; i++) {
      let foot = h;
      for (let c = 0; c < CATEGORIES.length; c++) {
        const v = this.bytes[c * SHOWN + i]!;
        if (v <= 0) continue;
        const bh = (v / top) * room;
        p.rect(i * colW + 0.5, foot - bh, Math.max(1, colW - 1), bh, opaque(colourOf(CATEGORIES[c]!)));
        foot -= bh;
      }
    }
    p.done();
  }

  press(_d: DebugBar, p: Press): void {
    if (p.act === ACT_DIR) this.dir = p.arg;
  }
}
