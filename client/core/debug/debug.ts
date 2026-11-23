// The debug bar: a strip at the screen's foot that pulls up into a drawer of tabs (F3), in the manner of a web
// framework's debug bar. While it is on it keeps the last minutes of each frame's times by part, lag events, the socket's
// counts, the page's and the server's log lines, and pictures; F8 saves them for a reader to open with tools/reports.ts.
// The app fetches this file once Settings.debug is first on. Turned off, it lets go of every hook and costs nothing.

import type { App } from "../app.ts";
import { LEVEL_ERROR, LEVEL_INFO, LEVEL_WARN, type CodeNames, type DebugAnswer, type ServerState } from "../../../shared/debug.ts";
import { TEXT_NOTICE } from "../../../shared/net/protocol.ts";
import { PASSES, type PassCpu } from "../passes.ts";
import type { FramePacket } from "../render/packet.ts";
import type { ReportBuild } from "../../../shared/report.ts";
import type { UiFrame, UiImage } from "../ui/nodes.ts";
import { Draw, KEY_DEBUG } from "./draw.ts";
import { EV_ASSET, EV_CORRECTION, EV_ERROR, EV_GAP, EV_GOVERNOR, EV_JUMP, EV_TASK, EV_TICK, GAP_MS, LagEvents, Rises } from "./events.ts";
import { LogRing, SOURCE_GAME, SOURCE_PAGE, SOURCE_SERVER } from "./log.ts";
import { NetLog, bodyClass } from "./net.ts";
import type { DebugPort, LongFrame, PageLine } from "./port.ts";
import { C, CELLS, FLAG_AFTER_SHOT, FLAG_SHOT, PerfRing } from "./ring.ts";
import { FrameSampler, type FrameExtra } from "./sample.ts";
import { FULL_QUALITY, FULL_WIDE, captureHead, saveCapture } from "./save.ts";
import { ShotRing } from "./shots.ts";
import { LANE_FRAME, MOST_SLOTS, SpanFrame, SpanRing } from "./spans.ts";
import { D_BAR, D_BADGE, D_BAD, D_DRAWER, D_FAINT, D_GOOD, D_NUM, D_NUM_DIM, D_TAB, D_TAB_ON, D_WARN, FILL_RULE } from "./styles.ts";
import { ACT_CLOSE, ACT_DRAWER, ACT_OPEN, ACT_SAVE, ACT_TAB, TAB_ACT, type Tab } from "./tab.ts";
import { AssetsTab } from "./tab-assets.ts";
import { FrameTab } from "./tab-frame.ts";
import { LogTab } from "./tab-log.ts";
import { NetworkTab } from "./tab-network.ts";
import { ServerTab } from "./tab-server.ts";
import { ShotsTab } from "./tab-shots.ts";
import { TimelineTab } from "./tab-timeline.ts";
import { ms, rate } from "./words.ts";
import { textWidth } from "../ui/nodes.ts";

/** The bar's height, in canvas units. */
export const BAR_H = 22;
/** The interface's images from here on are the bar's: its charts, then its pictures. */
export const IMAGE_DEBUG = 1000;
/** The drawer's least height, and the HUD's least room over it. */
const DRAWER_LEAST = 180, HUD_LEAST = 400;
/** How often the bar and the drawer are laid out again, in ms, and how often the server is asked: with its tabs open, and otherwise. */
const REFRESH_MS = 250, POLL_OPEN_MS = 1000, POLL_MS = 4000;
/** The counters whose rises are events (Rises). */
const R_CORRECTIONS = 0, R_JUMPS = 1, R_FAILED = 2, R_SNAPSHOTS = 3, R_GL = 4, R_FAULTS = 5;

export class DebugBar {
  readonly app: App;
  /** The browser's part, once the shell has fetched it; null in a test without one. */
  port: DebugPort | null = null;
  readonly spans = new SpanRing();
  /** The socket's counts, made again each time the bar comes on, so the time it was off is not a gap. */
  net: NetLog;
  readonly log = new LogRing();
  /** The pictures, once there is a port to take them. */
  shots: ShotRing | null = null;
  readonly perf = new PerfRing();
  readonly events = new LagEvents();
  readonly draw = new Draw();
  readonly tabs: Tab[];
  /** The tab shown, the drawer open, and whether the pointer is the drawer's rather than the game's. */
  tab = 0;
  open = false;
  focused = false;
  /** CSS pixels to a canvas unit, for charts painted at their size. */
  unit = 1;
  /** The server's latest answer for an admin, the one before it, and when it came on the page's clock. */
  server: ServerState | null = null;
  serverBefore: ServerState | null = null;
  serverAt = -Infinity;
  /** The protocol's names, once the server has said them. */
  names: CodeNames | null = null;
  /** A frame or an event the timeline chose, which the Frame tab shows: the page clock's ms, or -1. */
  chosenAt = -1;
  chosenSpans: SpanFrame | null = null;
  /** What the last save said, for the bar; words waiting for the next frame's picture to save with; the client's build. */
  saved = "";
  private saving: string | null = null;
  clientBuild: ReportBuild = {};

  private hooked = false;
  private hookedOnce = false;
  private readonly sampler = new FrameSampler();
  private readonly extra: FrameExtra = { build: 0, scene: 0, gpu: -1, glDraws: 0, longMs: 0, longTasks: 0, shotMs: 0, flags: 0, heap: 0 };
  private readonly rises = new Rises();
  private readonly passMs = new Float64Array(PASSES.length);
  private readonly long = new Float64Array(2);
  private readonly pageLines: PageLine[] = [];
  private readonly longFrames: LongFrame[] = [];
  private readonly span = new SpanFrame();
  private cpu: PassCpu | null = null;
  private gpuMode = 0;
  private level = 0;
  private snapshotAt = -1;
  private heapIn = 0;
  private afterShot = false;
  private faultsTold = 0;
  private serverLongTold = -1;
  private since = 0;
  private polling = false;
  private askedAt = -Infinity;
  private namesAsked = false;
  /** The frame's room under the HUD before the bar took its own, and the drawer's height this frame. */
  private inset = 0;
  private drawerH = 0;
  private madeAt = -Infinity;
  private dirty = true;
  private madeW = 0;
  private madeH = 0;
  /** What the bar's own work took, over the frames since it was last shown. */
  private cost = 0;
  private costFrames = 0;
  costMs = 0;

  constructor(app: App) {
    this.app = app;
    this.net = this.netLog();
    this.tabs = [new TimelineTab(), new FrameTab(), new NetworkTab(), new LogTab(), new ShotsTab(), new AssetsTab(), new ServerTab()];
    void app.debugPort?.().then((port) => this.attach(port), () => {});
  }

  /** The browser's part: pictures, the GPU's clock, the page's lines. */
  attach(port: DebugPort): void {
    this.port = port;
    this.shots = new ShotRing(port);
    this.hooked = false;
    void port.get("build.json").then((a) => {
      try {
        if (a.status === 200) this.clientBuild = JSON.parse(a.text) as ReportBuild;
      } catch {}
    });
  }

  /** A socket's count on the frame's clock, which is the page's in a browser and the harness's in a test. */
  private netLog(): NetLog {
    const app = this.app;
    return new NetLog({ now: () => app.nowMs }, bodyClass(app.session.registry));
  }

  /** Hands the frame's code the bar's hooks, or takes them back. */
  private hook(on: boolean): void {
    const app = this.app;
    if (on && this.hookedOnce) this.net = this.netLog();
    this.hookedOnce ||= on;
    this.hooked = on;
    app.probe = on ? this.spans : null;
    app.session.tap = on ? this.net : null;
    this.cpu = this.port ? this.port.passCpu(on) : null;
    if (!on && this.port && this.gpuMode !== 0) this.port.gpu((this.gpuMode = 0), this.passMs);
    if (!on) for (const t of this.tabs) if (t instanceof AssetsTab) t.watch(null);
  }

  /** The drawer's height for a frame `f`: what leaves the HUD its least room, within a share of the screen. */
  private drawerOf(f: UiFrame): number {
    return Math.round(Math.max(DRAWER_LEAST, Math.min(f.height * 0.42, f.height - f.top - this.inset - BAR_H - HUD_LEAST)));
  }

  /** Takes the bar's room at the foot of the interface, and the drawer's while it is open, before the HUD is built. */
  reserve(f: UiFrame): void {
    this.inset = f.bottom;
    this.drawerH = this.open ? this.drawerOf(f) : 0;
    f.bottom += BAR_H + this.drawerH;
  }

  /** The image slot `slot` of the interface's table, showing `image`. Returns its index for a picture node. */
  imageOf(slot: number, image: UiImage): number {
    const images = this.app.ui.frame.images, at = IMAGE_DEBUG + slot;
    if (images[at] !== image) images[at] = image;
    return at;
  }

  // ---- After each frame is drawn -------------------------------------------------------------------------------------

  /**
   * After the frame is drawn, on a canvas of `width` by `height` device pixels: a picture where one is due, the frame's
   * times and record, and what happened since the last.
   */
  drawn(p: FramePacket, ours: number, width: number, height: number, upload: number, build: number): void {
    const app = this.app;
    if (!app.ui.settings.debug) {
      if (this.hooked) this.hook(false);
      return;
    }
    if (!this.hooked) return this.hook(true);
    const port = this.port, t0 = this.spans.now(), nowMs = app.nowMs, e = this.extra;
    e.flags = this.afterShot || (this.shots?.making ?? 0) > 0 ? FLAG_AFTER_SHOT : 0;
    this.afterShot = false;
    e.shotMs = 0;
    const shots = this.shots;
    if (shots && shots.due(nowMs)) {
      e.shotMs = shots.take(nowMs, this.spans.rows);
      e.flags |= FLAG_SHOT;
      this.afterShot = true;
    }
    // A save asked for takes its full picture now, while the canvas still holds the frame, and sends the rest after.
    if (this.saving !== null && port) {
      const words = this.saving, f = app.ui.frame, full = port.shot(FULL_WIDE, FULL_QUALITY);
      this.saving = null;
      e.shotMs += full.ms;
      e.flags |= FLAG_SHOT;
      this.afterShot = true;
      const head = captureHead(this, p, [width, height], [Math.round(f.width * f.unit), Math.round(f.height * f.unit)]);
      void saveCapture(this, words, full.picture, head).then(
        (said) => this.said(said),
        (err) => this.said(`not saved: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    // The card by pass, but whole on an Apple GPU, where a query between passes ends Metal's render pass.
    let gpu = -1;
    if (port) {
      const apple = /apple/i.test(port.page().card);
      this.gpuMode = apple ? 1 : 2;
      if (port.gpu(this.gpuMode, this.passMs)) {
        gpu = 0;
        for (let i = 0; i < this.passMs.length; i++) gpu += this.passMs[i]!;
        this.spans.card(this.passMs, this.gpuMode);
      }
      port.longTasks(this.long);
      if (this.heapIn-- <= 0) {
        e.heap = port.heap();
        this.heapIn = 60;
      }
    }
    this.spans.close(app.shellMarks, this.cpu);
    const row = this.spans.row(0);
    e.build = build;
    e.scene = row >= 0 ? this.sceneMs(row) : 0;
    e.gpu = gpu;
    e.glDraws = port ? port.glDraws() : 0;
    e.longTasks = this.long[0]!;
    e.longMs = this.long[1]!;
    this.sampler.sample(this.perf, app, p, ours, upload, e);
    this.watch(nowMs);
    this.cost += this.spans.now() - t0;
    this.costFrames++;
  }

  /** The scene's build in the row, where the app timed it. */
  private sceneMs(row: number): number {
    const slot = this.sceneSlot >= 0 ? this.sceneSlot : (this.sceneSlot = this.spans.names.indexOf("build"));
    return slot < 0 ? 0 : this.spans.ms[row * MOST_SLOTS + slot]!;
  }

  private sceneSlot = -1;

  /** What happened this frame that is worth a line or an event: late frames, counters that rose, the page's lines, the server. */
  private watch(nowMs: number): void {
    const app = this.app, s = app.session, st = s.stats, ev = this.events, perf = this.perf;
    const k = perf.row(0), interval = k >= 0 ? perf.cells[k * CELLS + C.interval]! : 0;
    const made = ev.frame({ at: nowMs, interval, target: perf.target, upload: k >= 0 ? perf.cells[k * CELLS + C.upload]! : 0, frame: this.spans.rows - 2, shot: (this.extra.flags & (FLAG_SHOT | FLAG_AFTER_SHOT)) !== 0 }, this.cause);
    if (made) {
      // The frame the long interval followed is the one before this.
      const spans = made.spans ?? (made.spans = new Float32Array(MOST_SLOTS * 2));
      const row = this.spans.row(1);
      if (row >= 0) for (let slot = 0; slot < MOST_SLOTS; slot++) {
        spans[slot] = this.spans.start[row * MOST_SLOTS + slot]!;
        spans[MOST_SLOTS + slot] = this.spans.ms[row * MOST_SLOTS + slot]!;
      }
      this.shots?.ask("event");
    }
    let n = this.rises.rise(R_CORRECTIONS, st.corrections);
    if (n > 0) ev.note(nowMs, EV_CORRECTION, n, "the server moved the body the page had predicted");
    n = this.rises.rise(R_JUMPS, st.clockJumps);
    if (n > 0) ev.note(nowMs, EV_JUMP, n, "the input clock jumped");
    if (this.rises.rise(R_SNAPSHOTS, st.snapshots) > 0) {
      if (this.snapshotAt >= 0 && nowMs - this.snapshotAt > GAP_MS) ev.note(nowMs, EV_GAP, nowMs - this.snapshotAt, "no snapshot came for a while");
      this.snapshotAt = nowMs;
    }
    const r = app.scene?.assets.residency;
    if (r && (n = this.rises.rise(R_FAILED, r.stats.failed + r.stats.dead)) > 0) ev.note(nowMs, EV_ASSET, n, `${r.stats.lastStatus ? `HTTP ${r.stats.lastStatus}` : "no answer"}`);
    const g = app.governor;
    if (g.level !== this.level) {
      const word = g.level > this.level ? "down" : "up";
      ev.note(nowMs, EV_GOVERNOR, g.level, `stepped ${word} to ${g.level}${g.level > 0 ? `: ${g.name}` : ""}`);
      this.line(SOURCE_GAME, LEVEL_INFO, `governor stepped ${word} to level ${g.level}${g.level > 0 ? ` (${g.name})` : ""}`);
      this.level = g.level;
    }
    if (this.long[0]! > 0) ev.note(nowMs, EV_TASK, this.long[1]!, this.longCause());
    const port = this.port;
    if (port) {
      if ((n = this.rises.rise(R_GL, port.glErrors())) > 0) this.line(SOURCE_GAME, LEVEL_ERROR, `${n} WebGL ${n === 1 ? "error" : "errors"}`);
      port.lines(this.pageLines);
      for (const line of this.pageLines) {
        this.log.add(port.origin + line.at, SOURCE_PAGE, line.level, line.text);
        if (line.level >= LEVEL_ERROR) ev.note(line.at, EV_ERROR, 1, line.text.slice(0, 160));
      }
      this.pageLines.length = 0;
    }
    if (app.faults.size > this.faultsTold) {
      let i = 0;
      for (const [name, text] of app.faults) if (i++ >= this.faultsTold) this.line(SOURCE_GAME, LEVEL_ERROR, `the frame's part "${name}" threw: ${text}`);
      this.faultsTold = app.faults.size;
    }
    if ((n = this.rises.rise(R_FAULTS, s.stats.undecodable)) > 0) this.line(SOURCE_GAME, LEVEL_WARN, `${n} snapshot${n === 1 ? "" : "s"} could not be read`);
    this.poll(nowMs);
  }

  /** What the browser said of its long frames since the last, as an event's cause. */
  private longCause(): string {
    const out = this.longFrames;
    this.port?.longFrames(out);
    let worst: LongFrame | null = null;
    for (const f of out) if (!worst || f.ms > worst.ms) worst = f;
    out.length = 0;
    return worst ? `script ${ms(worst.script)}, layout ${ms(worst.layout)}${worst.source ? ` (${worst.source})` : ""}` : "the main thread was busy";
  }

  /** A line of the game's own, now. */
  line(source: number, level: number, text: string): void {
    this.log.add((this.port?.origin ?? 0) + this.app.nowMs, source, level, text);
  }

  /** Names the slot that took most of a frame by itself, and its path: what a lag event says was its cause. */
  readonly cause = (): string => {
    const row = this.spans.row(1);
    if (row < 0) return "";
    const f = this.spans.read(row, this.span), names = this.spans.names, parents = this.spans.parents;
    const own = this.selfMs;
    own.fill(0);
    for (let s = 0; s < names.length; s++) if (!Number.isNaN(f.start[s]!)) own[s]! += f.ms[s]!;
    for (let s = 0; s < names.length; s++) if (!Number.isNaN(f.start[s]!) && parents[s]! >= 0) own[parents[s]!]! -= f.ms[s]!;
    let best = -1;
    for (let s = 0; s < names.length; s++) if (parents[s]! >= 0 && this.spans.lane(s) === LANE_FRAME && (best < 0 || own[s]! > own[best]!)) best = s;
    if (best < 0) return "";
    const frame = f.ms[LANE_FRAME]!, perf = this.perf, k = perf.row(0), interval = k >= 0 ? perf.cells[k * CELLS + C.interval]! : 0;
    // Most of the time between frames outside the page's own code: the card or the browser held it.
    if (interval > 0 && frame < interval * 0.5) return `outside the page's code: it took ${ms(frame)} of ${ms(interval)}`;
    return `${this.pathOf(best)} ${ms(own[best]!)}`;
  };

  private readonly selfMs = new Float64Array(MOST_SLOTS);
  private readonly netRates = new Float64Array(4);

  /** A slot's name with its parents', from the frame down: "app › build › draw › near store". */
  pathOf(slot: number): string {
    const parts: string[] = [];
    for (let s = slot; s >= 0 && this.spans.parents[s]! >= 0; s = this.spans.parents[s]!) parts.unshift(this.spans.names[s]!);
    return parts.join(" › ");
  }

  // ---- The server ----------------------------------------------------------------------------------------------------

  /** The session's voice token, as the server's routes take it. */
  token(): string {
    const v = this.app.session.voice;
    return `${v.slot}:${Array.from(v.token, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  /** Asks the server for the protocol's names once, and an admin's session for the server's log and state now and then. */
  private poll(nowMs: number): void {
    const port = this.port, s = this.app.session;
    if (!port) return;
    if (!this.namesAsked) {
      this.namesAsked = true;
      void port.get("__debug").then((a) => {
        try {
          if (a.status === 200) this.net.setNames((this.names = (JSON.parse(a.text) as { names: CodeNames }).names));
        } catch {}
      });
    }
    const wanted = this.open && (this.tabs[this.tab] instanceof ServerTab || this.tabs[this.tab] instanceof LogTab) ? POLL_OPEN_MS : POLL_MS;
    if (!s.admin || this.polling || nowMs - this.askedAt < wanted) return;
    this.polling = true;
    this.askedAt = nowMs;
    void port.post("__debug", [["token", this.token()], ["since", String(this.since)]], []).then((a) => {
      this.polling = false;
      if (a.status !== 200) return;
      try {
        this.answer(JSON.parse(a.text) as DebugAnswer);
      } catch {}
    });
  }

  /** The server's answer: its new lines into the log, its long ticks as events, its state for the Server tab. */
  answer(a: DebugAnswer): void {
    for (const line of a.lines) this.log.add(line.at, SOURCE_SERVER, line.level, line.text, line.tick);
    this.since = a.next;
    this.serverBefore = this.server;
    this.server = a.server;
    this.serverAt = this.app.nowMs;
    const origin = this.port?.origin ?? 0;
    for (const t of a.server.long) {
      if (t.tick <= this.serverLongTold) continue;
      this.serverLongTold = t.tick;
      this.events.note(t.at - origin, EV_TICK, t.ms, `tick ${t.tick}, ${t.whose}: ${t.text}`);
    }
  }

  // ---- The interface ---------------------------------------------------------------------------------------------------

  /** The pointer is the drawer's, not the game's. */
  get holdsPointer(): boolean {
    return this.open && this.focused;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show(this.tab);
  }

  show(tab: number): void {
    this.tab = Math.max(0, Math.min(this.tabs.length - 1, tab));
    this.open = this.focused = true;
    this.dirty = true;
  }

  close(): void {
    this.open = this.focused = false;
    this.dirty = true;
  }

  /** Escape with the pointer locked to the game: an open drawer takes the pointer instead of the menu opening. */
  escaped(): boolean {
    if (!this.open || this.focused) return false;
    this.focused = true;
    return true;
  }

  /** A press on the world over the drawer: the pointer goes back to the game, and the drawer stays. */
  clickWorld(): void {
    if (this.open) this.focused = false;
  }

  wheel(dy: number): boolean {
    if (!this.holdsPointer) return false;
    const taken = this.tabs[this.tab]!.wheel?.(this, dy) ?? false;
    if (taken) this.dirty = true;
    return taken;
  }

  /** A pointer event on the interface. True where it was on the bar or the drawer, which takes it. */
  pointer(kind: number, key: number, x: number, y: number, button: number): boolean {
    const box = this.draw.boxOf(key);
    if (!box || key < KEY_DEBUG) return false;
    const hit = this.draw.hit(key);
    if (kind === 2) {
      if (this.open && this.tabs[this.tab]!.hover?.(this, { act: hit ? hit[0] : 0, arg: hit ? hit[1] : 0, fx: (x - box.x) / box.w, fy: (y - box.y) / box.h })) this.dirty = true;
      return true;
    }
    if (kind !== 0 || button !== 0) return true;
    if (this.open) this.focused = true;
    if (!hit) return true;
    const [act, arg] = hit;
    this.dirty = true;
    if (act === ACT_TAB) {
      if (this.open && this.tab === arg) this.close();
      else this.show(arg);
    } else if (act === ACT_OPEN) this.toggle();
    else if (act === ACT_SAVE) this.save("");
    else if (act === ACT_CLOSE) {
      this.close();
      this.app.ui.settings.debug = false;
      this.app.ui.settings.changed();
    } else if (act >= TAB_ACT) this.tabs[this.tab]!.press?.(this, { act, arg, fx: (x - box.x) / box.w, fy: (y - box.y) / box.h });
    return true;
  }

  /** Something the drawer shows changed: it is laid out again this frame. */
  touch(): void {
    this.dirty = true;
  }

  /** Builds the bar, and the drawer while it is open, over the interface. */
  build(f: UiFrame): void {
    const ui = this.app.ui;
    if (ui.debugAsked) {
      ui.debugAsked = false;
      this.show(this.tab);
    }
    this.unit = f.unit;
    const nowMs = this.app.nowMs;
    if (this.dirty || nowMs - this.madeAt >= REFRESH_MS || f.width !== this.madeW || f.height !== this.madeH) this.lay(f, nowMs);
    this.draw.play(f);
  }

  private lay(f: UiFrame, nowMs: number): void {
    const t0 = this.spans.now(), d = this.draw;
    this.dirty = false;
    this.madeAt = nowMs;
    this.madeW = f.width;
    this.madeH = f.height;
    this.costMs = this.costFrames > 0 ? this.cost / this.costFrames : 0;
    this.cost = this.costFrames = 0;
    d.begin();
    const left = 0, width = f.width, barY = f.height - this.inset - BAR_H;
    if (this.open) {
      const h = this.drawerH || this.drawerOf(f), top = barY - h;
      d.box(left, top, width, h, D_DRAWER, -1, 1, ACT_DRAWER);
      d.box(left, top, width, 1, D_DRAWER, FILL_RULE);
      this.tabs[this.tab]!.lay(this, d, left + f.left + 14, top + 10, width - f.left - f.right - 28, h - 16, nowMs);
    }
    this.layBar(f, barY);
    this.cost += this.spans.now() - t0;
  }

  /** The strip: the tabs at the left, the frame's numbers at the right, and save and close. */
  private layBar(f: UiFrame, y: number): void {
    const d = this.draw, admin = this.app.session.admin;
    d.box(0, y, f.width, BAR_H, D_BAR, -1, 1, ACT_DRAWER);
    let x = f.left + 8;
    d.button(x, y + 2, 22, BAR_H - 4, this.open ? D_TAB_ON : D_TAB, this.open ? "▾" : "▴", ACT_OPEN, 0, this.open ? "Close the drawer (F3)" : "Open the drawer (F3)");
    x += 26;
    for (let i = 0; i < this.tabs.length; i++) {
      const t = this.tabs[i]!;
      if (t.shown && !t.shown(this)) continue;
      const badge = t.badge?.(this) ?? "", w = Math.ceil(textWidth(t.name, D_TAB)) + 18 + (badge ? Math.ceil(textWidth(badge, D_BADGE)) + 10 : 0);
      d.button(x, y + 2, w, BAR_H - 4, this.open && this.tab === i ? D_TAB_ON : D_TAB, badge ? `${t.name}   ` : t.name, ACT_TAB, i, t.name);
      if (badge) {
        const bw = Math.ceil(textWidth(badge, D_BADGE)) + 8;
        d.text(x + w - bw - 5, y + 4, bw, D_BADGE, badge);
      }
      x += w + 2;
    }
    // From the right: close, save, then the numbers as far as there is room.
    let right = f.width - f.right - 6;
    d.button(right - 20, y + 2, 20, BAR_H - 4, D_TAB, "×", ACT_CLOSE, 0, "Turn the debug bar off");
    right -= 24;
    if (admin) {
      d.button(right - 44, y + 2, 44, BAR_H - 4, D_TAB, "Save", ACT_SAVE, 0, "Save the last minutes for a reader (F8)");
      right -= 50;
    }
    for (const [text, style] of this.stats()) {
      const w = Math.ceil(textWidth(text, style)) + 4;
      if (right - w < x + 12) break;
      d.text(right - w, y + 4, w, style, text);
      right -= w + 14;
    }
  }

  /** The bar's numbers, right to left: what the bar costs, the server's tick, the card, the socket, the frame. */
  private stats(): [string, number][] {
    const out: [string, number][] = [], app = this.app, perf = this.perf, s = app.session;
    if (this.saved) out.push([this.saved, D_GOOD]);
    out.push([`bar ${ms(this.costMs)}`, D_FAINT]);
    const server = this.server;
    if (server && s.admin) {
      const p50 = server.ticks.seconds.p50, worst = server.ticks.seconds.worst, last = p50.length - 1;
      if (last >= 0) out.push([`tick ${ms(p50[last]!)} · worst ${ms(worst[last]!)}`, worst[last]! > 33.3 ? D_WARN : D_NUM_DIM]);
    }
    const r = app.scene?.assets.residency;
    if (r) out.push([`card ${Math.round(r.ledger / 1048576)} of ${Math.round(r.budget / 1048576)} MB`, r.ledger > r.budget ? D_WARN : D_NUM_DIM]);
    this.net.rates(this.netRates, 1);
    out.push([`in ${rate(this.netRates[0]!)} · out ${rate(this.netRates[1]!)}`, D_NUM_DIM]);
    out.push([`ping ${Math.round((s.stats.rttTicks * 1000) / 30)} ms`, D_NUM_DIM]);
    // The last five seconds: frames late against the display, and the rate against it.
    const now = app.nowMs, k0 = perf.row(0);
    let late = 0, frames = 0, sum = 0;
    for (let back = 0; ; back++) {
      const k = perf.row(back);
      if (k < 0 || now - perf.at[k]! > 5000) break;
      const v = perf.cells[k * CELLS + C.interval]!;
      if (v <= 0) continue;
      frames++;
      sum += v;
      if (v > 1.25 * perf.target) late++;
    }
    const errors = this.log.since(1 << SOURCE_PAGE | 1 << SOURCE_GAME | 1 << SOURCE_SERVER, LEVEL_ERROR);
    if (errors > 0) out.push([`${errors} error${errors === 1 ? "" : "s"}`, D_BAD]);
    out.push([`${late} late`, late > 0 ? D_WARN : D_NUM_DIM]);
    const row = this.spans.row(0), frameMs = row >= 0 ? this.spans.ms[row * MOST_SLOTS + LANE_FRAME]! : 0;
    const gpu = k0 >= 0 ? perf.cells[k0 * CELLS + C.gpu]! : -1;
    out.push([`page ${ms(frameMs)}${gpu >= 0 ? ` · card ${ms(gpu)}` : ""}`, D_NUM]);
    const fps = frames > 0 && sum > 0 ? Math.round((frames * 1000) / sum) : 0;
    out.push([`${fps} fps of ${Math.round(1000 / perf.target)}`, late > frames * 0.05 ? D_WARN : D_GOOD]);
    return out;
  }

  // ---- Saving ----------------------------------------------------------------------------------------------------------

  /** Sends what the bar holds to the server as a capture, with `words` from whoever saved it, after the next frame. */
  save(words: string): string {
    if (!this.port) return this.said("not saved: the browser's part of the bar has not come");
    if (!this.app.session.admin) return this.said("not saved: saving is an admin's, type enablecheats first");
    if (this.saving !== null) return "a save is on its way";
    this.saving = words;
    this.saved = "saving…";
    this.dirty = true;
    return "saving the last three minutes";
  }

  /** What a save came to: on the bar, and in the log and the chat. */
  private said(text: string): string {
    this.saved = text;
    this.dirty = true;
    this.line(SOURCE_GAME, text.startsWith("not") ? LEVEL_WARN : LEVEL_INFO, text);
    this.app.ui.chat.print(TEXT_NOTICE, `Debug bar: ${text}.`, this.app.session.serverTick);
    return text;
  }
}
