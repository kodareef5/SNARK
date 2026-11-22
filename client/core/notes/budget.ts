// The frame's budget, live (`/budget`): a panel in the right column, under the minimap and what stands below it, that says where a frame goes against its budget as the
// owner walks. A strip of the last two seconds of frame times against the display's interval and 33 ms, the worst of the
// last five seconds marked; the processor's part by stage (the app's frame, the scene's build, handing the frame to
// WebGL, the assets' uploads) and the card's by pass where timer queries give it (on an Apple GPU through ANGLE a query
// between passes ends Metal's render pass and every query reads long, so there it times the whole frame alone and says
// so: client/core/passes.ts); and the frame's triangles and draws
// by the store that made them against what the tier allows, with the budget's squeeze and the governor's level.
//
// It reads what the page already keeps (the data utility's FrameRing, the frame's packet, the scene's budget) and what
// bug report mode times while it is on (notes.ts: the scene's build, the GPU by pass). Its words and bars are made four
// times a second; between, the panel is drawn from them. Off, it costs nothing; on, it says what it costs.

import type { App } from "../app.ts";
import type { NotesKit } from "../notes-kit.ts";
import type { FramePacket } from "../render/packet.ts";
import type { UiFrame } from "../ui/nodes.ts";
import { K_PANEL, LINE, SMALL_LINE, S_HUD_COUNT, S_LABEL, S_MENU_NOTE, S_TEXT } from "../ui/monitor-style.ts";
import { census, type Count } from "./census.ts";

/** The panel's keys, clear of every other screen's: its words from here, its bars from +100, the strip's columns from +200. */
const KEY_BUDGET = 9700;
/** The GPU's passes, as client/core/passes.ts PASSES names them, a copy (D915). */
export const PASS_NAMES = ["uploads", "casters", "near", "far", "dome", "far see-through", "near see-through", "body", "finish"] as const;
/** The processor's stages, in the order the bar draws them. */
export const STAGES = ["frame", "scene", "draw", "uploads"] as const;
/** How often the words are made again, in ms; the strip's columns; the seconds the worst is looked for over. */
const REFRESH_MS = 250;
const COLUMNS = 120;
const WORST_MS = 5000;
/** The panel's width and its inner margin, in canvas units; the minimap's side above it (hud.ts MINIMAP_SIZE, a copy). */
const W = 380;
const PAD = 10;
const MINIMAP = 160;
const BAR_H = 7;
const STRIP_H = 36;
/** Colours of a bar's parts, in turn. */
const PALETTE = [0x5aa9e6, 0x4fd1c5, 0x7bd389, 0xf2d23a, 0xf2a477, 0xe06a6a, 0xb48ae6, 0xe68ab4, 0xa0a8b0, 0x8fb8c8];
const LATE_TINT = 0xf2a477, ON_TIME = 0x7fb8d8, RULE = 0xe9f8ff;

/** Frames whose stage times the panel keeps, about half a second. */
const KEPT = 32;

/** A bar of parts: each its name, value and colour, the bar's full scale, and the budget's mark on it. */
interface Bar { label: string; parts: { name: string; value: number }[]; full: number; mark: number; legend: string; note: string }

export class BudgetPanel {
  /** The latest frames' stage times (STAGES), and the GPU's by pass where timed (PASS_NAMES), one row a frame. */
  readonly cpu = new Float64Array(KEPT * STAGES.length);
  readonly gpu = new Float64Array(KEPT * PASS_NAMES.length);
  private cpuRows = 0;
  private gpuRows = 0;
  private gpuMode = 0;
  /** What the panel's own work took, in ms, over the frames since the words were made. */
  private cost = 0;
  private costFrames = 0;
  private costShown = 0;
  private madeAt = -Infinity;
  private title = "";
  private worst = "";
  private worstAt = -1;
  private bars: Bar[] = [];
  private lines: string[] = [];
  /** The tier's allowance and what the last refresh counted, for a report's picture (notes.ts). */
  stores: Count[] = [];

  /** One frame's stages, after it was drawn: the app's frame, the scene's build, handing it to WebGL, the uploads. */
  frame(frameMs: number, sceneMs: number, drawMs: number, uploadMs: number): void {
    const k = (this.cpuRows++ % KEPT) * STAGES.length;
    this.cpu[k] = Math.max(0, frameMs - sceneMs);
    this.cpu[k + 1] = sceneMs;
    this.cpu[k + 2] = Math.max(0, drawMs);
    this.cpu[k + 3] = uploadMs;
  }

  /** A frame's GPU time as it came back: by pass, or the whole frame in `ms[0]`. */
  passes(ms: Float64Array, mode: number): void {
    // Rows timed one way are not averaged with rows timed the other.
    if (mode !== this.gpuMode) {
      this.gpuRows = 0;
      this.gpuMode = mode;
    }
    const k = (this.gpuRows++ % KEPT) * PASS_NAMES.length;
    for (let i = 0; i < PASS_NAMES.length; i++) this.gpu[k + i] = ms[i] ?? 0;
  }

  /** The mean of each column over the rows kept. */
  private static mean(rows: Float64Array, n: number, width: number): number[] {
    const out = new Array<number>(width).fill(0), count = Math.min(n, KEPT);
    for (let r = 0; r < count; r++) for (let c = 0; c < width; c++) out[c]! += rows[r * width + c]!;
    return out.map((v) => (count > 0 ? v / count : 0));
  }

  /** The stage times now, means over the last half second, by name: for a report's picture. */
  stages(): Record<string, number> {
    const m = BudgetPanel.mean(this.cpu, this.cpuRows, STAGES.length);
    return Object.fromEntries(STAGES.map((s, i) => [s, Math.round(m[i]! * 100) / 100]));
  }

  /** The GPU's passes now, means over the last half second, or none where nothing timed them. */
  passTimes(): { name: string; ms: number }[] {
    if (this.gpuRows === 0) return [];
    const m = BudgetPanel.mean(this.gpu, this.gpuRows, PASS_NAMES.length);
    return PASS_NAMES.map((name, i) => ({ name, ms: Math.round(m[i]! * 100) / 100 }));
  }

  /**
   * Makes the words and bars again where they are REFRESH_MS old. `timed` is how the GPU is timed (notes.ts: 0 not,
   * 1 the whole frame, 2 by pass), and `apple` whether its timer queries read long.
   */
  private refresh(app: App, p: FramePacket, nowMs: number, timed: number, apple: boolean): void {
    this.madeAt = nowMs;
    this.costShown = this.costFrames > 0 ? this.cost / this.costFrames : 0;
    this.cost = this.costFrames = 0;
    const ring = app.frames;
    // The display's interval: the middle of the last frames' intervals.
    const recent: number[] = [];
    let worst = 0, worstBack = -1;
    if (ring) for (let back = 0; back < 600; back++) {
      const k = ring.row(back);
      if (k < 0 || nowMs - ring.at[k]! > WORST_MS) break;
      const v = ring.interval[k]!;
      if (back < 120) recent.push(v);
      if (v > worst) {
        worst = v;
        worstBack = back;
      }
    }
    recent.sort((a, b) => a - b);
    const display = recent[recent.length >> 1] ?? 16.7, hz = display > 0 ? Math.round(1000 / display) : 0;
    this.title = `${display.toFixed(1)} ms a frame (${hz} Hz)`;
    this.worstAt = worstBack;
    this.worst = worstBack < 0 ? "" : `worst of the last 5 s: ${worst.toFixed(1)} ms, ${(worst / Math.max(1, display)).toFixed(1)} display intervals`;
    const cpu = BudgetPanel.mean(this.cpu, this.cpuRows, STAGES.length), cpuSum = cpu.reduce((a, b) => a + b, 0);
    const bars: Bar[] = [{
      label: `Processor ${cpuSum.toFixed(1)} ms`, parts: STAGES.map((name, i) => ({ name, value: cpu[i]! })), full: Math.max(display, cpuSum), mark: display,
      legend: STAGES.map((name, i) => `${name} ${cpu[i]!.toFixed(1)}`).join(" · "), note: "",
    }];
    if (timed === 1 && this.gpuRows > 0) {
      const whole = BudgetPanel.mean(this.gpu, this.gpuRows, PASS_NAMES.length)[0]!;
      bars.push({
        label: `Card ${whole.toFixed(1)} ms, the whole frame`, parts: [{ name: "the whole frame", value: whole }], full: Math.max(display, whole), mark: display, legend: "by pass: not measured on an Apple GPU, where a query",
        note: "between passes ends Metal's render pass. Its reading is long: trust the page's clock",
      });
    } else if (timed === 2 && this.gpuRows > 0) {
      const gpu = BudgetPanel.mean(this.gpu, this.gpuRows, PASS_NAMES.length), gpuSum = gpu.reduce((a, b) => a + b, 0);
      const top = PASS_NAMES.map((name, i) => ({ name, value: gpu[i]! })).filter((x) => x.value >= 0.05).sort((a, b) => b.value - a.value);
      bars.push({
        label: `Card ${gpuSum.toFixed(1)} ms`, parts: PASS_NAMES.map((name, i) => ({ name, value: gpu[i]! })), full: Math.max(display, gpuSum), mark: display,
        legend: top.slice(0, 4).map((x) => `${x.name} ${x.value.toFixed(1)}`).join(" · "),
        note: apple ? "timer queries read long here: read the parts, not the sum" : "by timer queries, a pass each",
      });
    } else bars.push({ label: "Card", parts: [], full: 1, mark: 0, legend: "", note: timed ? "not measured: no timer query has come back yet" : "not measured: this browser has no timer queries" });
    const c = census(p, 0, app.scene?.assets.table.tris ?? [], () => ""), budget = app.scene?.budget;
    this.stores = c.stores;
    const tris = c.stores.reduce((n, s) => n + s.triangles, 0), draws = c.stores.reduce((n, s) => n + s.draws, 0) - (c.stores.find((s) => s.name === "ground tiles")?.draws ?? 0);
    const mega = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} M` : `${Math.round(n / 1000)} k`);
    const allowTris = budget?.triangles ?? 0, allowDraws = budget?.draws ?? 0;
    bars.push({
      label: `Triangles ${mega(tris)}${allowTris > 0 ? ` of ${mega(allowTris)}` : ""}`, parts: c.stores.map((s) => ({ name: s.name, value: s.triangles })), full: Math.max(tris, allowTris, 1), mark: allowTris,
      legend: c.stores.filter((s) => s.triangles > 0).slice(0, 3).map((s) => `${s.name} ${mega(s.triangles)}`).join(" · "), note: "",
    });
    const byDraws = c.stores.filter((s) => s.name !== "ground tiles").sort((a, b) => b.draws - a.draws);
    bars.push({
      label: `Draws ${draws}${allowDraws > 0 ? ` of ${allowDraws}` : ""}`, parts: byDraws.map((s) => ({ name: s.name, value: s.draws })), full: Math.max(draws, allowDraws, 1), mark: allowDraws,
      legend: byDraws.slice(0, 3).map((s) => `${s.name} ${s.draws}`).join(" · "), note: "",
    });
    this.bars = bars;
    const g = app.governor;
    this.lines = [
      budget ? `squeeze ${budget.squeeze.toFixed(2)} (least ${budget.least.toFixed(2)}) · crowns ${mega(budget.last.crowns)} · ambient ${mega(budget.last.ambient)}` : "",
      `governor level ${g.level}${g.level > 0 ? ` (${g.name})` : ""} · this panel ${this.costShown.toFixed(2)} ms a frame${timed > 0 ? " and a timer query" : ""}`,
    ].filter(Boolean);
  }

  /**
   * The panel, at the screen's right under the minimap and what the HUD stands below it (a vehicle's dash, the jet's
   * gauge); `spent` is what the panel's own work took this frame, in ms.
   */
  build(f: UiFrame, app: App, kit: NotesKit, p: FramePacket, nowMs: number, timed: number, apple: boolean, spent: number): void {
    this.cost += spent;
    this.costFrames++;
    if (nowMs - this.madeAt >= REFRESH_MS) this.refresh(app, p, nowMs, timed, apple);
    const inner = W - PAD * 2, x = f.width - f.right - 12 - W;
    const barRow = SMALL_LINE + BAR_H + 4 + SMALL_LINE + 2;
    const h = PAD * 2 + LINE + STRIP_H + 4 + SMALL_LINE + 6 + this.bars.reduce((n, b) => n + barRow + (b.note ? SMALL_LINE : 0), 0) + this.lines.length * SMALL_LINE;
    // Under the lowest of the HUD's pieces in the right column's top half.
    let below = f.top + 12 + (app.ui.settings.minimap ? MINIMAP + 24 : 0);
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      if (n.key >= KEY_BUDGET && n.key < KEY_BUDGET + 300) continue;
      if (n.w < f.width / 2 && n.x + n.w > x && n.x < x + W && n.y < f.height / 2 && n.y + n.h + 8 > below) below = n.y + n.h + 8;
    }
    const y = Math.max(f.top + 12, Math.min(below, f.height - f.bottom - 12 - h));
    kit.glass(f, KEY_BUDGET, x, y, W, h);
    let at = y + PAD;
    f.text(KEY_BUDGET + 1, x + PAD, at, inner, S_TEXT, "FRAME BUDGET");
    f.text(KEY_BUDGET + 2, x + PAD, at + 1, inner, S_HUD_COUNT, this.title);
    at += LINE;
    // The strip: the last COLUMNS frames, a column each, the display's interval and 33 ms ruled across.
    const ring = app.frames, colW = inner / COLUMNS, top = 50;
    const scale = (ms: number): number => Math.min(STRIP_H, (ms / top) * STRIP_H);
    const display = Number.parseFloat(this.title) || 16.7;
    for (let back = 0; ring && back < COLUMNS; back++) {
      const k = ring.row(back);
      if (k < 0) break;
      const v = ring.interval[k]!, ch = Math.max(1, scale(v));
      const n = f.add(KEY_BUDGET + 200 + back, K_PANEL, x + PAD + inner - (back + 1) * colW, at + STRIP_H - ch, Math.max(1, colW - 0.5), ch, S_LABEL);
      n.tint = back === this.worstAt ? 0xffffff : v > 1.25 * display ? LATE_TINT : ON_TIME;
      n.alpha = back === this.worstAt ? 1 : 0.85;
    }
    for (const [i, ms] of [display, 33.3].entries()) {
      const n = f.add(KEY_BUDGET + 190 + i, K_PANEL, x + PAD, at + STRIP_H - scale(ms), inner, 1, S_LABEL);
      n.tint = RULE;
      n.alpha = 0.35;
    }
    at += STRIP_H + 4;
    f.text(KEY_BUDGET + 3, x + PAD, at, inner, S_MENU_NOTE, kit.fitText(this.worst || "no frame timed yet", inner, S_MENU_NOTE));
    at += SMALL_LINE + 6;
    this.bars.forEach((b, i) => {
      const key = KEY_BUDGET + 10 + i * 4;
      f.text(key, x + PAD, at, inner, S_LABEL, b.label);
      at += SMALL_LINE;
      const track = f.add(KEY_BUDGET + 100 + i * 20, K_PANEL, x + PAD, at, inner, BAR_H, S_LABEL);
      track.tint = 0x000000;
      track.alpha = 0.35;
      let px = x + PAD;
      b.parts.forEach((part, j) => {
        const w = (part.value / b.full) * inner;
        if (w < 0.5 || j >= 18) return;
        const n = f.add(KEY_BUDGET + 101 + i * 20 + j, K_PANEL, px, at, Math.min(w, x + PAD + inner - px), BAR_H, S_LABEL);
        n.tint = PALETTE[j % PALETTE.length]!;
        px += w;
      });
      if (b.mark > 0 && b.mark < b.full) {
        const n = f.add(KEY_BUDGET + 119 + i * 20, K_PANEL, x + PAD + (b.mark / b.full) * inner - 1, at - 2, 2, BAR_H + 4, S_LABEL);
        n.tint = RULE;
      }
      at += BAR_H + 4;
      f.text(key + 1, x + PAD, at, inner, S_MENU_NOTE, kit.fitText(b.legend || " ", inner, S_MENU_NOTE));
      at += SMALL_LINE + 2;
      if (b.note) {
        f.text(key + 2, x + PAD, at, inner, S_MENU_NOTE, kit.fitText(b.note, inner, S_MENU_NOTE));
        at += SMALL_LINE;
      }
    });
    this.lines.forEach((line, i) => {
      f.text(KEY_BUDGET + 60 + i, x + PAD, at, inner, S_MENU_NOTE, kit.fitText(line, inner, S_MENU_NOTE));
      at += SMALL_LINE;
    });
  }
}
