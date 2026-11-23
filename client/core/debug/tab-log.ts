// The Log tab: one list of what the page printed and the errors it met, the game's own notices and faults, and for an
// admin the server's lines, newest at the foot. Filters by source and level; the wheel goes back through it; a line
// pressed opens whole under the list.

import { LEVEL_DEBUG, LEVEL_ERROR, LEVEL_INFO, LEVEL_NAMES, LEVEL_WARN } from "../../../shared/debug.ts";
import { wrapText } from "../ui/nodes.ts";
import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { ALL_SOURCES, SOURCE_NAMES, SOURCE_SERVER, type LogLine } from "./log.ts";
import { D_BUTTON, D_DIM, D_FAINT, D_MONO, D_MONO_BAD, D_MONO_DIM, D_MONO_FAINT, D_MONO_WARN, D_TAB_ON, D_WELL } from "./styles.ts";
import { TAB_ACT, type Press, type Tab } from "./tab.ts";
import { clock } from "./words.ts";

const ACT_SOURCE = TAB_ACT, ACT_LEVEL = TAB_ACT + 1, ACT_LINE = TAB_ACT + 2, ACT_END = TAB_ACT + 3, ACT_MORE = TAB_ACT + 4;
const LINE = 17;
/** The levels a filter may start from: everything, info and worse, warnings and errors, errors. */
const LEAST = [LEVEL_DEBUG, LEVEL_INFO, LEVEL_WARN, LEVEL_ERROR];
const LEAST_NAMES = ["All levels", "Info and worse", "Warnings", "Errors"];
const STYLE_OF = [D_MONO_FAINT, D_MONO, D_MONO_WARN, D_MONO_BAD];

export class LogTab implements Tab {
  readonly name = "Log";
  /** A bit for each SOURCE_ shown, the least level shown, how far back from the newest, and the line opened. */
  private sources = ALL_SOURCES;
  private least = 0;
  private back = 0;
  private open: LogLine | null = null;
  private readonly lines: LogLine[] = [];
  private readonly wrapped: string[] = [];

  badge(d: DebugBar): string {
    const n = d.log.since(ALL_SOURCES, LEVEL_ERROR);
    return n > 0 && !(d.open && d.tabs[d.tab] === this) ? String(Math.min(99, n)) : "";
  }

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number): void {
    d.log.mark();
    // The filters: the sources, then the levels, on one row where the drawer is wide enough and wrapped where not.
    const sources = [-1, 0, 1, 2].filter((s) => s !== SOURCE_SERVER || d.app.session.admin);
    const srcLabels = sources.map((s) => (s < 0 ? "Everything" : SOURCE_NAMES[s]![0]!.toUpperCase() + SOURCE_NAMES[s]!.slice(1)));
    const srcWidths = sources.map((s) => (s < 0 ? 84 : 64)), srcOn = sources.map((s) => (s < 0 ? this.sources === ALL_SOURCES : this.sources === 1 << s));
    const lvlWidths = LEAST.map(() => 104), lvlOn = LEAST.map((_, l) => this.least === l);
    const srcW = srcWidths.reduce((a, b) => a + b + 4, 0), lvlW = lvlWidths.reduce((a, b) => a + b + 4, 0), oneRow = srcW + 12 + lvlW + 150 <= w;
    const srcH = draw.buttons(x, y, w, srcLabels, srcWidths, srcOn, ACT_SOURCE, sources, D_TAB_ON, D_BUTTON);
    const lx = oneRow ? x + srcW + 12 : x, ly = oneRow ? y : y + srcH;
    const lvlH = draw.buttons(lx, ly, w - (lx - x), LEAST_NAMES, lvlWidths, lvlOn, ACT_LEVEL, LEAST.map((_, l) => l), D_TAB_ON, D_BUTTON);
    const head = oneRow ? Math.max(srcH, lvlH) : srcH + lvlH;
    const detail = this.open ? Math.min(6, Math.max(2, Math.floor(h / LINE / 3))) : 0, listTop = y + head + (oneRow ? 0 : 18), listH = Math.max(LINE, y + h - listTop - (detail ? detail * LINE + 8 : 0));
    const rows = Math.max(1, Math.floor(listH / LINE));
    const total = d.log.read(this.lines, this.sources, LEAST[this.least]!, rows, this.back);
    if (this.back > 0 && this.back >= total) this.back = Math.max(0, total - rows);
    const said = `${total} line${total === 1 ? "" : "s"}${this.back > 0 ? ` · ${this.back} newer below` : ""}`;
    if (oneRow) draw.text(lx + lvlW + 8, y, Math.max(0, x + w - lx - lvlW - 8), D_DIM, said);
    else draw.text(x, listTop - 18, w, D_DIM, said);
    draw.box(x, listTop, w, listH, D_WELL, -1, 1, ACT_MORE);
    let at = listTop + listH - rows * LINE;
    if (total === 0) draw.text(x + 6, listTop + 4, w - 12, D_FAINT, d.port ? "Nothing logged yet." : "The page's own lines need the browser.");
    for (const line of this.lines) {
      const k = this.lines.indexOf(line);
      draw.text(x + 6, at, 92, D_MONO_DIM, clock(line.at), ACT_LINE, k);
      draw.text(x + 100, at, 52, D_MONO_DIM, SOURCE_NAMES[line.source]!, ACT_LINE, k);
      draw.text(x + 152, at, 46, STYLE_OF[line.level]!, LEVEL_NAMES[line.level]!, ACT_LINE, k);
      const text = line.text.split("\n")[0]! + (line.count > 1 ? `  ×${line.count}` : "");
      draw.text(x + 200, at, w - 206, STYLE_OF[line.level]!, text, ACT_LINE, k, "Press to read it whole");
      at += LINE;
    }
    if (this.back > 0) draw.button(x + w - 110, listTop + listH - 20, 104, 18, D_BUTTON, "To the newest", ACT_END);
    if (this.open && detail > 0) {
      const top = listTop + listH + 8;
      this.wrapped.length = 0;
      for (const part of this.open.text.split("\n")) wrapText(part, w - 12, D_MONO, this.wrapped);
      for (let i = 0; i < Math.min(detail, this.wrapped.length); i++) draw.text(x + 6, top + i * LINE, w - 12, i === 0 ? STYLE_OF[this.open.level]! : D_MONO_DIM, this.wrapped[i]!);
    }
  }

  press(_d: DebugBar, p: Press): void {
    if (p.act === ACT_SOURCE) this.sources = p.arg < 0 ? ALL_SOURCES : 1 << p.arg;
    else if (p.act === ACT_LEVEL) this.least = p.arg;
    else if (p.act === ACT_END) this.back = 0;
    else if (p.act === ACT_LINE) {
      const line = this.lines[p.arg] ?? null;
      this.open = this.open === line ? null : line;
      return;
    } else return;
    this.back = 0;
    this.open = null;
  }

  wheel(_d: DebugBar, dy: number): boolean {
    const step = Math.max(1, Math.round(Math.abs(dy) / 40)) * 3;
    this.back = Math.max(0, this.back + (dy < 0 ? step : -step));
    return true;
  }
}
