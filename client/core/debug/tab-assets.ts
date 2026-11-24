// The Assets tab: what comes in for the world's models, textures and sounds, what waits, what the card holds, the latest
// requests, and what the crosshair is on. It reads the residency's counters as they stand and the frame ring's seconds.

import { emptyPick, pickLook, plainName } from "../assets/look.ts";
import { inspectMesh, inspectTexture } from "../assets/inspect.ts";
import { RequestLog, requestFrom, requestName, requestTime } from "../assets/requests.ts";
import type { Residency } from "../assets/residency.ts";
import type { DebugBar } from "./debug.ts";
import type { Draw } from "./draw.ts";
import { Paint } from "./paint.ts";
import { D_DIM, D_FAINT, D_MONO, D_MONO_DIM, D_NUM, D_TEXT, D_WARN, D_WELL, FILL_RULE, PALETTE, opaque, WELL } from "./styles.ts";
import type { Tab } from "./tab.ts";
import { bytes, count, rate } from "./words.ts";

/** The chart's image in the debug bar's slots. */
const CHART = 3;
/** Seconds the chart shows. */
const SECONDS = 60;
/** Requests listed. */
const LISTED = 9;
/** The chart's series: network, disk, to the card. */
const SERIES = [PALETTE[0]!, PALETTE[2]!, PALETTE[3]!];

export class AssetsTab implements Tab {
  readonly name = "Assets";
  private readonly chart = new Paint();
  /** The request log and the residency it was made for: a new scene's residency gets a new log. */
  private log: RequestLog | null = null;
  private logOf: Residency | null = null;
  private readonly pick = emptyPick();
  private readonly sums = new Float64Array(4);

  /** Hands the residency a log of its requests while the tab is wanted, and takes it back when not. */
  watch(r: Residency | null): void {
    if (r === this.logOf) return;
    if (this.logOf) this.logOf.log = null;
    this.logOf = r;
    this.log = r ? new RequestLog(r["state"].length) : null;
    if (r) r.log = this.log;
  }

  lay(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number, nowMs: number): void {
    const app = d.app, r = app.scene?.assets.residency ?? null, frames = app.frames;
    this.watch(r);
    if (!r || !frames) {
      draw.text(x, y, w, D_DIM, "No world yet: nothing has been asked for.");
      return;
    }
    // The last second's bytes, as the frame ring has them: network, disk, from the port's memory, to the card.
    const s = this.sums;
    s.fill(0);
    const latest = frames.row(0) >= 0 ? frames.at[frames.row(0)]! : 0;
    for (let back = 0; ; back++) {
      const k = frames.row(back);
      if (k < 0 || latest - frames.at[k]! >= 1000) break;
      s[0]! += frames.fetched[k]!;
      s[1]! += frames.disk[k]!;
      s[2]! += Math.max(0, frames.cached[k]! - frames.disk[k]!);
      s[3]! += frames.uploaded[k]!;
    }
    const col = Math.floor((w - 24) / 3), line = 17;
    let at = y + draw.heading(x, y, col, "COMING IN, LAST SECOND");
    at += draw.pair(x, at, col, "over the network", rate(s[0]!));
    at += draw.pair(x, at, col, "from the disk cache", rate(s[1]!));
    at += draw.pair(x, at, col, "from memory", rate(s[2]!));
    draw.pair(x, at, col, "handed to the card", rate(s[3]!));

    const st = r.stats, cx = x + col + 12;
    at = y + draw.heading(cx, y, col, "WAITING");
    at += draw.pair(cx, at, col, "requests on their way", count(r.flying + (app.sounds?.library.flying ?? 0)));
    at += draw.pair(cx, at, col, "wanted, not yet asked", count(r.wanting()));
    at += draw.pair(cx, at, col, "arrived, not on the card", bytes(r.waiting));
    const failed = st.failed + st.dead;
    draw.pair(cx, at, col, "failed · given up", `${count(st.failed)} · ${count(st.dead)}`, failed > 0 ? D_WARN : D_NUM);

    const mx = cx + col + 12;
    at = y + draw.heading(mx, y, col, "ON THE CARD");
    at += draw.pair(mx, at, col, "assets of their budget", `${bytes(r.ledger)} of ${bytes(r.budget)}`, r.ledger > r.budget ? D_WARN : D_NUM);
    at += draw.pair(mx, at, col, "of them textures", bytes(r.texLedger));
    at += draw.pair(mx, at, col, "kept for the rest", bytes(r.reserved));
    const cache = r.cache;
    draw.pair(mx, at, col, "saved on this device", !cache || cache.mode === "none" ? "nothing" : `${bytes(cache.used)} of ${bytes(cache.limit)}${cache.mode === "memory" ? " in memory" : ""}`);

    // The last minute's bytes a second, stacked: network, disk, to the card.
    const top = y + 5 * line + 10, chartH = 56;
    this.paintChart(d, frames, Math.round(w * d.unit), Math.round(chartH * d.unit));
    draw.box(x, top, w, chartH, D_WELL);
    draw.picture(x, top, w, chartH, d.imageOf(CHART, this.chart.image), 0, 0, true);
    draw.text(x + 6, top + 2, w / 2, D_FAINT, `network, disk and to the card, a second each over ${SECONDS} s`);
    draw.text(x + w - 160, top + 2, 154, D_FAINT, `top ${rate(this.chartTop)}`);

    // The latest requests, newest first, and what the crosshair is on.
    const listTop = top + chartH + 10, half = Math.floor((w - 12) / 2), log = this.log!;
    at = listTop + draw.heading(x, listTop, half, `LATEST REQUESTS (${count(st.requests)} since the world came)`);
    for (let back = 0; back < LISTED && at + line <= y + h; back++) {
      const k = log.row(back);
      if (k < 0) break;
      const got = log.fetched[k]! + log.disk[k]! + log.memory[k]!;
      draw.text(x, at, half - 190, D_MONO, requestName(r, log, k));
      draw.text(x + half - 186, at, 64, D_MONO_DIM, got > 0 ? bytes(got) : "–");
      draw.text(x + half - 118, at, 82, D_MONO_DIM, requestFrom(log, k));
      draw.text(x + half - 34, at, 34, D_MONO_DIM, requestTime(log, k, nowMs));
      at += line;
    }
    if (log.rows === 0) draw.text(x, at, half, D_FAINT, "None since the tab was opened.");
    this.crosshair(d, draw, x + half + 12, listTop, half, y + h - listTop);
  }

  /** The biggest second the chart was scaled to. */
  private chartTop = 0;

  private paintChart(d: DebugBar, frames: NonNullable<DebugBar["app"]["frames"]>, w: number, h: number): void {
    const p = this.chart;
    p.size(w, h);
    p.clear(WELL);
    let top = 64 * 1024;
    for (let back = 0; back < SECONDS; back++) {
      const b = frames.bucket(back);
      if (b >= 0) top = Math.max(top, frames.bucketFetched[b]! + frames.bucketDisk[b]! + frames.bucketUploaded[b]!);
    }
    this.chartTop = top;
    const colW = w / SECONDS, room = h - 14;
    for (let back = 0; back < SECONDS; back++) {
      const b = frames.bucket(back);
      if (b < 0) continue;
      const x = w - (back + 1) * colW;
      let foot = h;
      const parts = [frames.bucketFetched[b]!, frames.bucketDisk[b]!, frames.bucketUploaded[b]!];
      for (let i = 0; i < 3; i++) {
        const ph = (parts[i]! / top) * room;
        if (ph <= 0) continue;
        p.rect(x + 1, foot - ph, colW - 2, ph, opaque(SERIES[i]!, 220));
        foot -= ph;
      }
      if (frames.bucketSlow[b]! > 0) p.rect(x + 1, 0, colW - 2, 3, opaque(0xf06a5f));
    }
    p.rect(0, h - 1, w, 1, opaque(FILL_RULE));
    p.done();
  }

  /** What the crosshair is on: its name, its model's levels, and its textures as the card holds them. */
  private crosshair(d: DebugBar, draw: Draw, x: number, y: number, w: number, h: number): void {
    const app = d.app, r = app.scene?.assets.residency, pick = pickLook(app, this.pick);
    let at = y + draw.heading(x, y, w, "UNDER THE CROSSHAIR");
    const line = (style: number, text: string): void => void (at + 17 <= y + h && (at += draw.text(x, at, w, style, text)));
    if (pick.what === "none") return line(D_DIM, "Nothing within reach of the look.");
    const where = `${pick.distance.toFixed(1)} m${pick.water ? ", under water" : ""}`;
    if (pick.what === "ground") return line(D_TEXT, `The ground · ${where}`);
    line(D_TEXT, `${plainName(pick.id)} · ${pick.what} · ${where}`);
    if (!r || pick.mesh < 0) return line(D_DIM, "Drawn as nothing of its own.");
    const mesh = inspectMesh(r, pick.mesh);
    if (!mesh.known) return line(D_WARN, `Its model's row has not come (page ${mesh.page}, ${mesh.pageState ?? "unknown"}).`);
    const shown = mesh.levels.find((l) => l.level === pick.shown), wanted = mesh.levels.find((l) => l.level === pick.wanted);
    line(D_TEXT, `Model level ${pick.shown < 0 ? "none" : pick.shown} drawn of ${mesh.levels.length}, ${pick.wanted < 0 ? "none" : pick.wanted} wanted${wanted && wanted.why ? ` (waits: ${wanted.why})` : ""}`);
    const level = shown ?? wanted;
    if (!level) return;
    if (level.materials.length === 0) return line(D_DIM, "Flat colours: this level has no textures.");
    const material = level.materials.find((m) => m.material === pick.material) ?? level.materials[0]!;
    line(D_DIM, `${plainName(material.id)}${level.materials.length > 1 && pick.material < 0 ? ` (1 of ${level.materials.length})` : ""}`);
    for (const t of material.maps) {
      if (t < 0) continue;
      const tex = inspectTexture(r, t), wants = tex.wanted > tex.showing ? `, wants ${tex.wanted}` : "";
      line(tex.why ? D_WARN : D_MONO_DIM, `${tex.role.padEnd(7)} ${tex.showing || "none"} px${tex.coming ? `, ${tex.coming} coming` : ""}${wants}${tex.why ? ` (waits: ${tex.why})` : ""}`);
    }
  }
}
