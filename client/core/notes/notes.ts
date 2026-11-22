// Bug report mode (planning/workstreams/bug-notes.md). `/notes` in chat, or `notes` in the console, turns
// Settings.notes on, and the app fetches this file. It asks `__report` whether the server keeps notes; where it does and
// the session is an admin's the mode is armed: the Esc menu has "Take note", F8 does the same, and the performance
// record (ring.ts) runs. F8 starts a note: a picture at once and one every SHOT_EVERY_MS, each shown by a flash at the
// screen's edges, with a bar filling toward the next beside the note's line; a line typed in chat goes into the note.
// F8 again sends it as one upload; if that fails the note is kept and F8 tries again. Esc twice discards it, and it ends
// by itself at NOTE_MS_MOST. `/perf [seconds]` keeps the same record over that time with a picture at each end.
//
// `/budget` shows the frame's budget live (budget.ts), with or without the mode armed, and every picture keeps what it said.
//
// None of this is in the script the first frame waits for: it takes what it needs of that script from the kit the app
// hands it (notes-kit.ts, D915), and the browser's part from the shell's port (client/notes/port.ts).

import type { App } from "../app.ts";
import type { NotesKit } from "../notes-kit.ts";
import type { FramePacket } from "../render/packet.ts";
import type { UiFrame } from "../ui/nodes.ts";
import { K_BAR, K_PANEL, S_HUD_HIT, S_ICE, S_OXYGEN } from "../ui/monitor-style.ts";
import { BEFORE_MS, NOTE_MS_MOST, PERF_SECONDS, PERF_SECONDS_MOST, REPORT_VERSION, SHOT_EVERY_MS, SHOT_WIDE_MOST, THUMB_WIDE, TEXT_CHARS_MOST, TEXT_LINES_MOST, clockText, type Report, type ReportBuild, type ReportKind, type ReportShot } from "../../../shared/report.ts";
import { BudgetPanel, PASS_NAMES } from "./budget.ts";
import { census, type Census } from "./census.ts";
import { TEXT_NOTICE } from "./copies.ts";
import { aimOf, pageOf, placeOf, settingsOf, skyOf, survivorOf, viewOf } from "./place.ts";
import type { NotePort, Picture } from "./port.ts";
import { C, CELLS, FLAG_AFTER_SHOT, FLAG_SHOT, FRAME_FIELDS, PerfRing, SECOND_FIELDS } from "./ring.ts";
import { FrameSampler, type FrameExtra } from "./sample.ts";

/** The note's keys in the interface, clear of every other screen's. */
const KEY_NOTE = 9600;
/** How long a picture's flash lasts, and how thick it is at the screen's edges, in canvas units. */
const FLASH_MS = 320;
const EDGE = 5;
/** How long Esc waits for the press that discards. */
const CONFIRM_MS = 3000;
/** Frames between reads of the heap, which a browser updates only now and then. */
const HEAP_EVERY = 60;

/** A note or a performance record under way. */
interface Open {
  kind: ReportKind;
  /** When it began on the page's clock, and in ms since 1970; when it ends by itself; when its next picture is due. */
  began: number;
  wall: number;
  ends: number;
  next: number;
  shots: ReportShot[];
  pictures: Promise<Picture>[];
  census: (Census & Record<string, unknown>)[];
  text: { at: number; line: string }[];
  /** The place, view, aim, sky, page and the rest, as they were at its first picture. */
  head: Partial<Report>;
  /** Taking pictures; sending; or sent and refused, kept for another try. */
  state: "taking" | "saving" | "failed";
  why: string;
}

export class Notes {
  readonly app: App;
  readonly kit: NotesKit;
  readonly ring = new PerfRing();
  /** The browser's part, once the shell has fetched it. */
  port: NotePort | null = null;
  /** Whether the server keeps notes: null until it answers, and why not where it does not. */
  keeps: boolean | null = null;
  why = "";
  /** The client build the page came from (build.json beside it, tools/build-client.ts), once fetched. */
  build: ReportBuild = {};
  open: Open | null = null;
  /** What the record cost the page, in ms, over the frames it ran: the sampler and the ring, a picture's own cost left out. */
  costMs = 0;
  costFrames = 0;
  private readonly sampler = new FrameSampler();
  private readonly extra: FrameExtra = { build: 0, scene: 0, gpu: -1, glDraws: 0, longMs: 0, longTasks: 0, shotMs: 0, flags: 0, heap: 0 };
  /** The frame's budget, while `/budget` has it on; and what the GPU's passes took in the latest frame timed. */
  panel: BudgetPanel | null = null;
  private readonly passMs = new Float64Array(PASS_NAMES.length);
  private gpuMode = 0;
  private apple = false;
  /** The scene whose build is timed (timeScene), and what its last build took. */
  private timed: { build: (...args: never[]) => unknown } | null = null;
  private sceneMs = 0;
  /** A picture's widest: SHOT_WIDE_MOST, unless a tool asks for less. */
  wide = SHOT_WIDE_MOST;
  private panelSpent = 0;
  private readonly long = new Float64Array(2);
  private heapIn = 0;
  /** What the chat was last told of the mode, so it is told each change once. */
  private told = "";
  private wantShot = false;
  private afterShot = false;
  /** Pictures copied and not yet encoded: the frames meanwhile are a picture's too, and flagged so. */
  private making = 0;
  private flashAt = -Infinity;
  private escAt = -Infinity;
  private nowMs = 0;
  private readonly css = [0, 0];
  private readonly canvas = [0, 0];

  constructor(app: App, kit: NotesKit) {
    this.app = app;
    this.kit = kit;
    app.ui.takeNote = () => this.press();
    app.ui.escape = () => this.escape();
    app.ui.chat.note = (line) => this.typed(line);
    void app.notePort?.().then((port) => {
      this.port = port;
      void port.get("__report").then((a) => {
        this.keeps = a.status === 204 || a.status === 200;
        this.why = this.keeps ? "" : a.status === 0 ? "the server did not answer __report" : a.text.trim().slice(0, 200) || `__report answered ${a.status}`;
      });
      void port.get("build.json").then((a) => {
        try {
          if (a.status === 200) this.build = JSON.parse(a.text) as ReportBuild;
        } catch {}
      });
    });
  }

  /** Armed: the mode is on, the server keeps notes, and the session is an admin's. */
  get armed(): boolean {
    return this.app.ui.settings.notes && this.keeps === true && this.app.session.admin && this.port !== null;
  }

  /** Why the mode, being on, is not armed; "" where it is. */
  private notArmed(): string {
    if (!this.port || this.keeps === null) return "asking the server whether it keeps notes";
    if (!this.keeps) return this.why;
    return this.app.session.admin ? "" : "notes are an admin's: enablecheats first";
  }

  private say(line: string): void {
    this.app.ui.chat.print(TEXT_NOTICE, line, this.app.session.serverTick);
  }

  /** After the app's frame is built: says what changed of the mode, keeps the note's schedule and draws its line. */
  frame(nowMs: number, width: number, height: number): void {
    this.nowMs = nowMs;
    this.css[0] = width;
    this.css[1] = height;
    const on = this.app.ui.settings.notes, why = on ? this.notArmed() : "";
    const state = !on ? "off" : why === "" ? "armed" : why;
    if (state !== this.told) {
      if (state === "armed") this.say("Bug report mode is armed: F8, or Take note in the Esc menu, starts a note.");
      else if (state !== "off" && !state.startsWith("asking")) this.say(`Bug report mode is on, but it cannot take notes: ${state}.`);
      if (state !== "armed" && this.open) this.discard(on ? `put away (${state})` : "put away: bug report mode is off");
      this.told = state;
    }
    this.app.ui.noteRow = state !== "armed" ? "" : this.open ? (this.open.kind === "perf" ? "End the record" : "Save note") : "Take note";
    const o = this.open;
    if (o && o.state === "taking") {
      if (nowMs >= o.ends) {
        // A record's last picture, then it is sent; a note sends what it has.
        if (o.kind === "perf" && !this.wantShot && o.next !== Infinity) {
          this.wantShot = true;
          o.next = Infinity;
        } else if (o.kind === "note" || (!this.wantShot && o.next === Infinity)) void this.save();
      } else if (nowMs >= o.next && o.shots.length < 40) {
        this.wantShot = true;
        o.next = o.kind === "perf" ? o.ends : o.next + SHOT_EVERY_MS;
      }
    }
    this.hud(this.app.ui.frame, nowMs);
    const panel = this.app.ui.settings.budget ? this.panel : null, p = this.app.scene?.packet;
    if (panel && p && this.port) {
      const t0 = this.port.now();
      panel.build(this.app.ui.frame, this.app, this.kit, p, nowMs, this.gpuMode, this.apple, this.panelSpent);
      this.panelSpent = this.port.now() - t0;
    }
  }

  /**
   * Times the scene's build while the record or the panel runs, by its own method wrapped on the scene, and lets it go
   * when neither does: off, nothing is wrapped and nothing is timed.
   */
  private timeScene(on: boolean): void {
    const scene = this.app.scene as unknown as { build: (...args: never[]) => unknown } | null, port = this.port;
    if (this.timed && (!on || this.timed !== scene)) {
      delete (this.timed as { build?: unknown }).build;
      this.timed = null;
    }
    if (!on || !scene || !port || this.timed) return;
    const build = Object.getPrototypeOf(scene).build as (...args: never[]) => unknown;
    scene.build = (...args: never[]): unknown => {
      const t0 = port.now();
      try {
        return build.apply(scene, args);
      } finally {
        this.sceneMs = port.now() - t0;
      }
    };
    this.timed = scene;
  }

  /**
   * After each frame is drawn, while armed or the panel is on: a picture where one is due, then the frame's row of the
   * record and the panel's. `build` is the ms the app's frame took of `ours`.
   */
  drawn(p: FramePacket, ours: number, width: number, height: number, upload: number, build = 0): void {
    const port = this.port, armed = this.armed, panel = this.app.ui.settings.budget && port ? (this.panel ??= new BudgetPanel()) : null;
    if (!port || (!armed && !panel)) {
      if (this.timed) this.timeScene(false);
      if (this.gpuMode !== 0 && port) port.gpu((this.gpuMode = 0), this.passMs);
      return;
    }
    const t0 = port.now(), e = this.extra, o = this.open;
    this.timeScene(true);
    e.flags = this.afterShot || this.making > 0 ? FLAG_AFTER_SHOT : 0;
    this.afterShot = false;
    e.shotMs = 0;
    if (this.wantShot && o && o.state === "taking") {
      this.wantShot = false;
      e.shotMs = this.take(o, p, width, height);
      e.flags |= FLAG_SHOT;
      this.afterShot = true;
    }
    port.longTasks(this.long);
    e.longTasks = this.long[0]!;
    e.longMs = this.long[1]!;
    // The card by pass while the panel shows it, but on an Apple GPU, where a query between passes ends Metal's render
    // pass, whole; whole too while a note is taken. The record keeps the sum.
    this.apple = /apple/i.test(port.page().card);
    this.gpuMode = panel ? (this.apple ? 1 : 2) : o !== null && o.state === "taking" ? 1 : 0;
    const came = port.gpu(this.gpuMode, this.passMs);
    let gpu = 0;
    for (let i = 0; i < this.passMs.length; i++) gpu += this.passMs[i]!;
    e.gpu = came ? gpu : -1;
    e.build = build;
    e.scene = this.sceneMs;
    e.glDraws = port.glDraws();
    if (panel) {
      panel.frame(build, this.sceneMs, ours - build - upload, upload);
      if (came) panel.passes(this.passMs, this.gpuMode);
    }
    if (!armed) return;
    if (this.heapIn-- <= 0) {
      e.heap = port.heap();
      this.heapIn = HEAP_EVERY;
    }
    this.sampler.sample(this.ring, this.app, p, ours, upload, e);
    this.costMs += port.now() - t0 - e.shotMs;
    this.costFrames++;
  }

  /** Copies the canvas, notes the picture's pose and counts the frame's draws. Returns the ms it took on this thread. */
  private take(o: Open, p: FramePacket, width: number, height: number): number {
    const t0 = this.port!.now(), app = this.app, n = o.shots.length, first = n === 0;
    const { picture } = this.port!.shot(this.wide, first ? THUMB_WIDE : 0);
    o.pictures.push(picture);
    this.making++;
    void picture.then(() => void this.making--, () => void this.making--);
    const cam = app.cam, own = app.session.own, r2 = (v: number): number => Math.round(v * 100) / 100;
    this.canvas[0] = width;
    this.canvas[1] = height;
    if (first) {
      o.head = {
        place: placeOf(app, this.kit), view: viewOf(app), aim: aimOf(app, this.kit), sky: skyOf(app, p), page: pageOf(app, p, this.port!.page(), this.canvas, this.css),
        settings: settingsOf(app), survivor: survivorOf(app),
      };
    }
    o.census.push({ ...census(p, n, app.scene?.assets.table.tris ?? [], (mesh) => app.scene?.assets.manifest.meshes[mesh]?.id ?? String(mesh)), ...this.breakdown() });
    this.flashAt = this.nowMs;
    const ms = this.port!.now() - t0;
    o.shots.push({
      at: Math.round(this.nowMs - o.began), place: [r2(own.x), r2(own.y), r2(own.z)], camera: [r2(cam.x), r2(cam.y), r2(cam.z)], yaw: Math.round(cam.yaw * 1000) / 1000, pitch: Math.round(cam.pitch * 1000) / 1000,
      hour: Math.round(app.sky.hour * 1000) / 1000, frameMs: r2(app["interval"]), draws: p.drawCount, triangles: Math.round(p.triangles), shotMs: r2(ms),
    });
    return ms;
  }

  /**
   * Where the frame went as the panel says it, at a picture: the processor's stages over the last frames, the card's
   * passes where they were timed, and the budget the scene squeezes to.
   */
  private breakdown(): Record<string, unknown> {
    const ring = this.ring, sums = [0, 0, 0, 0];
    let n = 0;
    for (let back = 0; back < 30; back++) {
      const k = ring.row(back);
      if (k < 0) break;
      const base = k * CELLS, own = ring.cells[base + C.own]!, build = ring.cells[base + C.build]!, scene = ring.cells[base + C.scene]!, upload = ring.cells[base + C.upload]!;
      sums[0]! += Math.max(0, build - scene);
      sums[1]! += scene;
      sums[2]! += Math.max(0, own - build - upload);
      sums[3]! += upload;
      n++;
    }
    const r2 = (v: number): number => Math.round((v / Math.max(1, n)) * 100) / 100;
    const b = this.app.scene?.budget, g = this.app.governor;
    return {
      cpu: { frame: r2(sums[0]!), scene: r2(sums[1]!), draw: r2(sums[2]!), uploads: r2(sums[3]!) },
      gpu: this.panel && this.gpuMode === 2 ? this.panel.passTimes() : this.panel && this.gpuMode === 1 ? [{ name: "the whole frame", ms: this.panel.passTimes()[0]?.ms ?? 0 }] : [],
      budget: b ? { triangles: b.triangles, draws: b.draws, squeeze: Math.round(b.squeeze * 100) / 100, least: Math.round(b.least * 100) / 100, crowns: b.last.crowns, ambient: b.last.ambient, level: g.level } : {},
    };
  }

  /** F8: why the mode cannot, or starts a note, or saves the one open, or tries again to send it. Off, F8 is the browser's. */
  key(down: boolean, repeat: boolean): boolean {
    if (!this.app.ui.settings.notes) return false;
    if (down && !repeat) this.press();
    return true;
  }

  /** F8 or the menu's row. */
  press(): void {
    const why = this.notArmed();
    if (!this.app.ui.settings.notes) return;
    if (why !== "") return this.say(`Bug report mode cannot take notes: ${why}.`);
    const o = this.open;
    if (!o) return this.start("note", NOTE_MS_MOST);
    if (o.state !== "saving") void this.save();
  }

  private start(kind: ReportKind, ms: number): void {
    this.open = { kind, began: this.nowMs, wall: Date.now(), ends: this.nowMs + ms, next: this.nowMs + (kind === "perf" ? ms : SHOT_EVERY_MS), shots: [], pictures: [], census: [], text: [], head: {}, state: "taking", why: "" };
    this.wantShot = true;
    this.escAt = -Infinity;
  }

  /** Esc while a note is open: the first press asks, the second within CONFIRM_MS discards. Returns true where it took the press. */
  escape(): boolean {
    if (!this.open) return false;
    // A note on its way to the server is the server's to keep.
    if (this.open.state === "saving") return true;
    if (this.nowMs - this.escAt < CONFIRM_MS) this.discard("discarded");
    else this.escAt = this.nowMs;
    return true;
  }

  private discard(why: string): void {
    const o = this.open;
    if (!o) return;
    this.open = null;
    this.wantShot = false;
    this.escAt = -Infinity;
    this.say(`${o.kind === "perf" ? "Performance record" : "Note"} ${why}: nothing was sent.`);
  }

  /** A line typed in chat while a note is open goes into the note: what the chat shows of it, or null where no note takes it. */
  typed(line: string): string | null {
    const o = this.open;
    if (!o || o.text.length >= TEXT_LINES_MOST) return null;
    const at = Math.round(this.nowMs - o.began);
    o.text.push({ at, line: line.slice(0, TEXT_CHARS_MOST) });
    return `Note ${clockText(at)}: “${line.slice(0, TEXT_CHARS_MOST)}”`;
  }

  /** The console's `perf [seconds]`: a performance record of that long. What the console says. */
  perf(line: string): string {
    const why = this.notArmed(), asked = line.trim().split(/\s+/)[1];
    if (!this.app.ui.settings.notes) return "bug report mode is off: /notes turns it on";
    if (why !== "") return `bug report mode cannot keep a record: ${why}`;
    if (this.open) return "a note is open: F8 saves it first";
    const seconds = asked === undefined ? PERF_SECONDS : Number(asked);
    if (!(seconds >= 1 && seconds <= PERF_SECONDS_MOST)) return `usage: perf [seconds], 1 to ${PERF_SECONDS_MOST}, ${PERF_SECONDS} if none`;
    this.start("perf", seconds * 1000);
    return `keeping a performance record for ${seconds} s, with a picture at each end; F8 ends it sooner, Esc twice discards it`;
  }

  /** Sends the open note as one upload once its pictures are made; on failure keeps it for F8 to try again. */
  async save(): Promise<void> {
    const o = this.open, port = this.port, app = this.app;
    if (!o || !port || o.state === "saving") return;
    o.state = "saving";
    this.wantShot = false;
    const end = this.nowMs;
    const fail = (why: string): void => {
      [o.state, o.why] = ["failed", why];
      this.say(`Report not saved: ${why}. F8 tries again; Esc twice discards it.`);
    };
    let pictures: Picture[];
    try {
      pictures = await Promise.all(o.pictures);
    } catch (err) {
      return fail(`a picture was not made (${err instanceof Error ? err.message : String(err)})`);
    }
    if (pictures.length === 0) return fail("it has no picture yet");
    const from = o.began - BEFORE_MS, summary = this.ring.summary(o.began, end);
    const perf = {
      version: REPORT_VERSION, start: Math.round(o.began), fields: FRAME_FIELDS, frames: this.ring.frames(from, end, o.began), secondFields: SECOND_FIELDS, seconds: this.ring.secondRows(o.began),
      summary: { ...summary, ringMs: this.costFrames > 0 ? Math.round((this.costMs / this.costFrames) * 10000) / 10000 : 0 }, worst: this.ring.worst(o.began, end, 20), census: o.census,
    };
    const shots = o.shots.map((s, n) => ({ ...s, w: pictures[n]!.w, h: pictures[n]!.h }));
    const s = app.session;
    const report: Report = { version: REPORT_VERSION, kind: o.kind, began: o.wall, ms: Math.round(end - o.began), ...o.head, map: { id: s.world?.mapId ?? "" }, build: this.build, shots, text: o.text, voice: { segments: [] } };
    const token = `${s.voice.slot}:${Array.from(s.voice.token, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const files: [string, unknown][] = pictures.map((p) => ["shot", p.jpeg]);
    if (pictures[0]!.thumb) files.push(["thumb", pictures[0]!.thumb]);
    const answer = await port.post("__report", [["token", token], ["report", JSON.stringify(report)], ["perf", JSON.stringify(perf)]], files);
    if (this.open !== o) return;
    if (answer.status !== 200) return fail(answer.status === 0 ? "the server did not answer" : answer.text.trim().slice(0, 200) || `the server answered ${answer.status}`);
    const kept = JSON.parse(answer.text) as { id: number; pictures: number };
    this.open = null;
    this.say(`Saved report ${kept.id} (${kept.pictures} ${kept.pictures === 1 ? "picture" : "pictures"}).`);
  }

  /** The note's line under the compass, its bar toward the next picture, and a picture's flash at the screen's edges. */
  private hud(f: UiFrame, nowMs: number): void {
    const since = nowMs - this.flashAt;
    if (since >= 0 && since < FLASH_MS) {
      const alpha = 0.85 * (1 - since / FLASH_MS), w = f.width, h = f.height;
      f.add(KEY_NOTE + 10, K_PANEL, 0, 0, w, EDGE, S_ICE).alpha = alpha;
      f.add(KEY_NOTE + 11, K_PANEL, 0, h - EDGE, w, EDGE, S_ICE).alpha = alpha;
      f.add(KEY_NOTE + 12, K_PANEL, 0, EDGE, EDGE, h - EDGE * 2, S_ICE).alpha = alpha;
      f.add(KEY_NOTE + 13, K_PANEL, w - EDGE, EDGE, EDGE, h - EDGE * 2, S_ICE).alpha = alpha;
    }
    const o = this.open;
    if (!o) return;
    const at = clockText(nowMs - o.began), n = o.shots.length, pictures = `${n} ${n === 1 ? "picture" : "pictures"}`;
    const what = o.kind === "perf" ? `PERF ${at} of ${clockText(o.ends - o.began)}` : `NOTE ${at}`;
    const asked = nowMs - this.escAt < CONFIRM_MS;
    const line = asked ? `${what}  ·  Esc again discards it` : o.state === "saving" ? `${what}  ·  ${pictures}  ·  saving` : o.state === "failed" ? `${what}  ·  not saved  ·  F8 tries again  ·  Esc discards` : `${what}  ·  ${pictures}  ·  F8 ${o.kind === "perf" ? "ends" : "saves"}  ·  Esc discards`;
    const kit = this.kit, hud = this.app.hud, muted = this.app.ui.settings.muted;
    const w = Math.min(f.width - f.left - f.right - 24, Math.ceil(kit.textWidth(line, S_HUD_HIT)) + 44), h = 36;
    const x = Math.round((f.width - w) / 2), y = Math.max(f.top + 12, hud.compassBottom + 6) + (muted ? 52 : 0);
    kit.glass(f, KEY_NOTE, x, y, w, h);
    f.text(KEY_NOTE + 1, x, y + 6, w, S_HUD_HIT, kit.fitText(line, w - 24, S_HUD_HIT));
    // The bar fills toward the next picture, or a record's end; full while it is sent.
    const span = o.kind === "perf" ? o.ends - o.began : SHOT_EVERY_MS, left = o.kind === "perf" ? o.ends - nowMs : o.next - nowMs;
    const bar = f.add(KEY_NOTE + 2, K_BAR, x + 16, y + h - 8, w - 32, 3, S_OXYGEN);
    bar.value = o.state === "taking" ? Math.max(0, Math.min(1, 1 - left / span)) : 1;
  }
}
