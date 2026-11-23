// The Shots tab: the pictures the bar keeps, newest first, a picture every two seconds and one at each lag event. A
// picture pressed fills the tab, with what its second held beside it.

import type { UiImage } from "../ui/nodes.ts";
import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { EVENT_NAMES, type LagEvent } from "./events.ts";
import { S_FRAMES, S_LATE, S_SUM, S_WORST } from "./ring.ts";
import type { Shot } from "./shots.ts";
import { D_BUTTON, D_DIM, D_FAINT, D_MONO, D_MONO_DIM, D_TAB_ON, D_TEXT, D_WELL } from "./styles.ts";
import { TAB_ACT, type Press, type Tab } from "./tab.ts";
import { ago, bytes, ms } from "./words.ts";

/** The interface's image slots of the grid's pictures, from here on, and of the one opened. */
const GRID = 10, OPENED = 9;
const ACT_SHOT = TAB_ACT, ACT_BACK = TAB_ACT + 1, ACT_STEP = TAB_ACT + 2, ACT_PAUSE = TAB_ACT + 3;
const GAP = 6;

export class ShotsTab implements Tab {
  readonly name = "Shots";
  /** The picture opened, by its time, or -1 for the grid; how far down the grid is scrolled, in rows. */
  private opened = -1;
  private row = 0;
  private readonly images = new Map<string, UiImage>();
  private readonly near: LagEvent[] = [];

  private imageOf(s: Shot): UiImage {
    let im = this.images.get(s.picture.url);
    if (!im) {
      // The ring frees a picture's URL when it lets it go; one no longer kept is forgotten here too.
      if (this.images.size > 200) this.images.clear();
      this.images.set(s.picture.url, (im = { width: s.picture.w, height: s.picture.h, data: new Uint8ClampedArray(0), version: 0, url: s.picture.url, smooth: true }));
    }
    return im;
  }

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void {
    const ring = d.shots;
    if (!ring) return void draw.text(x, y, w, D_DIM, "Pictures need the browser's part of the bar, which has not come.");
    const shots = ring.shots;
    draw.button(x + w - 104, y - 2, 104, 18, ring.paused ? D_TAB_ON : D_BUTTON, ring.paused ? "Pictures off" : "Pictures on", ACT_PAUSE);
    draw.text(x, y, w - 120, D_DIM, `${shots.length} pictures · ${bytes(ring.bytes)} · one every ${ring.limits.every / 1000} s and one at each event${ring.failed > 0 ? ` · ${ring.failed} failed` : ""}`);
    if (shots.length === 0) return void draw.text(x, y + 24, w, D_FAINT, ring.paused ? "Pictures are off." : "The first picture comes within two seconds.");
    const opened = this.opened >= 0 ? shots.findIndex((s) => s.at === this.opened) : -1;
    if (this.opened >= 0 && opened < 0) this.opened = -1;
    if (opened >= 0) return this.layOpened(d, draw, shots, opened, x, y + 24, w, h - 24, nowMs);
    // The grid: newest first, as many across as keep a picture at least 150 wide.
    const across = Math.max(2, Math.floor((w + GAP) / (150 + GAP))), cw = (w - GAP * (across - 1)) / across, ch = Math.round(cw * 9 / 16) + 18;
    const rows = Math.max(1, Math.floor((h - 24 + GAP) / (ch + GAP))), most = Math.ceil(shots.length / across);
    this.row = Math.max(0, Math.min(this.row, most - rows));
    for (let r = 0; r < rows; r++) for (let c = 0; c < across; c++) {
      const k = shots.length - 1 - ((this.row + r) * across + c);
      if (k < 0) continue;
      const s = shots[k]!, px = x + c * (cw + GAP), py = y + 24 + r * (ch + GAP), slot = GRID + r * across + c;
      draw.box(px, py, cw, ch - 18, D_WELL);
      draw.picture(px, py, cw, ch - 18, d.imageOf(slot, this.imageOf(s)), ACT_SHOT, k);
      draw.text(px, py + ch - 17, cw, s.why ? D_TEXT : D_FAINT, `${ago(nowMs - s.at)}${s.why ? ` · ${s.why}` : ""}`, ACT_SHOT, k);
    }
  }

  private layOpened(d: DebugBar, draw: Draw, shots: readonly Shot[], k: number, x: number, y: number, w: number, h: number, nowMs: number): void {
    const s = shots[k]!, pw = Math.min(Math.round(w * 0.68), Math.round(((h - 22) * s.picture.w) / Math.max(1, s.picture.h))), ph = Math.round((pw * s.picture.h) / Math.max(1, s.picture.w));
    draw.button(x, y - 24 + 22, 56, 18, D_BUTTON, "‹ Grid", ACT_BACK);
    draw.button(x + 60, y - 24 + 22, 30, 18, D_BUTTON, "‹", ACT_STEP, -1, "Older");
    draw.button(x + 94, y - 24 + 22, 30, 18, D_BUTTON, "›", ACT_STEP, 1, "Newer");
    const top = y + 20;
    draw.box(x, top, pw, ph, D_WELL);
    draw.picture(x, top, pw, ph, d.imageOf(OPENED, this.imageOf(s)), ACT_BACK);
    const rx = x + pw + 14, rw = w - pw - 14;
    let at = top + draw.heading(rx, top, rw, `PICTURE ${k + 1} OF ${shots.length}`);
    at += draw.pair(rx, at, rw, "taken", ago(nowMs - s.at));
    at += draw.pair(rx, at, rw, "why", s.why || "the regular one");
    at += draw.pair(rx, at, rw, "size", `${s.picture.w} × ${s.picture.h}, ${bytes(s.picture.bytes)}`);
    const t = Math.floor(s.at / 1000), r = d.perf.secondAt(t), q = d.perf.seconds;
    if (r >= 0) {
      const n = q[r + S_FRAMES]!;
      at += draw.pair(rx, at, rw, "its second", `${n} frames, usual ${ms(q[r + S_SUM]! / Math.max(1, n))}`);
      at += draw.pair(rx, at, rw, "worst, late", `${ms(q[r + S_WORST]!)}, ${q[r + S_LATE]!} late`);
    }
    at += 6;
    at += draw.heading(rx, at, rw, "EVENTS WITHIN A SECOND");
    const near = d.events.between(s.at - 1000, s.at + 1000, this.near);
    if (near.length === 0) draw.text(rx, at, rw, D_FAINT, "None.");
    for (const e of near) {
      if (at + 17 > top + ph) break;
      draw.text(rx, at, 120, D_MONO, `${EVENT_NAMES[e.kind]}${e.count > 1 ? ` ×${e.count}` : ""}`);
      at += draw.text(rx + 122, at, rw - 122, D_MONO_DIM, e.cause || "");
    }
  }

  press(d: DebugBar, p: Press): void {
    const shots = d.shots?.shots ?? [];
    if (p.act === ACT_SHOT) this.opened = shots[p.arg]?.at ?? -1;
    else if (p.act === ACT_BACK) this.opened = -1;
    else if (p.act === ACT_PAUSE && d.shots) d.shots.paused = !d.shots.paused;
    else if (p.act === ACT_STEP) {
      const k = shots.findIndex((s) => s.at === this.opened) + p.arg;
      if (k >= 0 && k < shots.length) this.opened = shots[k]!.at;
    }
  }

  wheel(_d: DebugBar, dy: number): boolean {
    if (this.opened >= 0) return false;
    this.row = Math.max(0, this.row + (dy > 0 ? 1 : -1));
    return true;
  }
}
