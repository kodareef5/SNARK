// Saving what the debug bar holds (F8, or Save): one upload to the server's `__report` as a capture, which a reader opens
// with tools/reports.ts. It carries the last minutes' pictures and one at full size taken as the save was asked, the
// record of frames and seconds, where a frame's time went, the lag events, the log and the socket's counts.

import { LEVEL_NAMES } from "../../../shared/debug.ts";
import { REPORT_VERSION, type Report, type ReportShot } from "../../../shared/report.ts";
import type { FramePacket } from "../render/packet.ts";
import { census } from "./census.ts";
import type { DebugBar } from "./debug.ts";
import { EVENT_NAMES } from "./events.ts";
import { SOURCE_NAMES, ALL_SOURCES, type LogLine } from "./log.ts";
import { aimOf, pageOf, placeOf, settingsOf, skyOf, survivorOf, viewOf } from "./place.ts";
import type { Picture } from "./port.ts";
import { FRAME_FIELDS, SECOND_FIELDS } from "./ring.ts";
import { LANE_FRAME, MOST_SLOTS, SpanFrame } from "./spans.ts";

/** How far back a capture reaches, in ms; frames are kept one by one for the last FRAMES_MS of it. */
export const CAPTURE_MS = 180_000;
/** The full picture's widest and its JPEG quality. */
export const FULL_WIDE = 2560, FULL_QUALITY = 0.85;
/** The slowest frames whose times by slot a capture keeps. */
const SLOWEST = 8;

/** What a capture takes of the frame the save was asked in, read straight after its draw. */
export interface CaptureHead {
  at: number;
  wall: number;
  head: Partial<Report>;
  census: ReturnType<typeof census>;
}

/** The frame the save was asked in: where, what, how it ran, and what it drew. */
export function captureHead(d: DebugBar, p: FramePacket, canvas: readonly number[], css: readonly number[]): CaptureHead {
  const app = d.app, port = d.port!, scene = app.scene;
  return {
    at: app.nowMs,
    wall: port.origin + app.nowMs,
    head: { place: placeOf(app), view: viewOf(app), aim: aimOf(app), sky: skyOf(app, p), page: pageOf(app, p, port.page(), canvas, css), settings: settingsOf(app), survivor: survivorOf(app) },
    census: census(p, 0, scene?.assets.table.tris ?? [], (mesh) => scene?.assets.manifest.meshes[mesh]?.id ?? String(mesh)),
  };
}

/** Where a frame's time went, for the capture: each slot's name and parent, the mean over the last second, and the slowest frames. */
function spansRecord(d: DebugBar, from: number): Record<string, unknown> {
  const spans = d.spans, mean = new SpanFrame(), n = spans.names.length, r2 = (v: number): number => (Number.isNaN(v) ? -1 : Math.round(v * 100) / 100);
  spans.mean(0, 60, mean);
  const slow: { at: number; frame: number; start: number[]; ms: number[] }[] = [];
  const rows: number[] = [];
  for (let back = 0; ; back++) {
    const row = spans.row(back);
    if (row < 0 || spans.at[row]! < from) break;
    rows.push(row);
  }
  rows.sort((a, b) => spans.ms[b * MOST_SLOTS + LANE_FRAME]! - spans.ms[a * MOST_SLOTS + LANE_FRAME]!);
  for (const row of rows.slice(0, SLOWEST)) {
    const start: number[] = [], ms: number[] = [];
    for (let s = 0; s < n; s++) {
      start.push(r2(spans.start[row * MOST_SLOTS + s]!));
      ms.push(r2(spans.ms[row * MOST_SLOTS + s]!));
    }
    slow.push({ at: Math.round(spans.at[row]! - from), frame: ms[LANE_FRAME]!, start, ms });
  }
  return {
    names: spans.names.slice(0, n),
    parents: Array.from(spans.parents.subarray(0, n)),
    mean: { frames: mean.frames, start: Array.from(mean.start.subarray(0, n), r2), ms: Array.from(mean.ms.subarray(0, n), r2) },
    slowest: slow,
  };
}

/** Builds the capture and sends it. Returns what the bar says of it. */
export async function saveCapture(d: DebugBar, words: string, full: Promise<Picture>, head: CaptureHead): Promise<string> {
  const app = d.app, port = d.port!, from = head.at - CAPTURE_MS, perf = d.perf;
  let big: Picture | null = null;
  try {
    big = await full;
  } catch {}
  const ring = d.shots?.shots.filter((s) => s.at >= from) ?? [];
  const pictures = [...ring.map((s) => s.picture), ...(big ? [big] : [])];
  const shots: ReportShot[] = [...ring.map((s) => ({ at: Math.round(s.at - from), w: s.picture.w, h: s.picture.h })), ...(big ? [{ at: Math.round(head.at - from), w: big.w, h: big.h }] : [])];
  const s = app.session;
  const report: Report = {
    version: REPORT_VERSION, kind: "capture", began: Math.round(head.wall - CAPTURE_MS), ms: CAPTURE_MS, ...head.head,
    map: { id: s.world?.mapId ?? "" }, build: d.build, shots, text: words ? [{ at: CAPTURE_MS, line: words }] : [], voice: { segments: [] },
  };
  const summary = perf.summary(from, head.at);
  const perfRecord = {
    version: REPORT_VERSION, start: Math.round(from), fields: FRAME_FIELDS, frames: perf.frames(from, head.at, from), secondFields: SECOND_FIELDS, seconds: perf.secondRows(from),
    summary: { ...summary, ringMs: Math.round(d.costMs * 10000) / 10000 }, worst: perf.worst(from, head.at, 20),
    census: [{ ...head.census, shot: pictures.length - 1 }], spans: spansRecord(d, from), sound: {},
  };
  const lines: LogLine[] = [];
  d.log.read(lines, ALL_SOURCES, 0, 2000);
  const log = { lines: lines.filter((l) => l.at >= head.wall - CAPTURE_MS).map((l) => ({ at: l.at, source: SOURCE_NAMES[l.source], level: LEVEL_NAMES[l.level], text: l.text, count: l.count, tick: l.tick })) };
  const events = {
    events: d.events.list.filter((e) => e.end >= from).map((e) => ({
      at: Math.round(e.at - from), end: Math.round(e.end - from), kind: EVENT_NAMES[e.kind], size: Math.round(e.size * 100) / 100, count: e.count, cause: e.cause,
      top: e.spans ? topSlots(d, e.spans) : [],
    })),
  };
  const fields: [string, string][] = [
    ["token", d.token()], ["report", JSON.stringify(report)], ["perf", JSON.stringify(perfRecord)],
    ["log", JSON.stringify(log)], ["events", JSON.stringify(events)], ["net", JSON.stringify(d.net.record(Math.round(CAPTURE_MS / 1000)))],
  ];
  const answer = await port.post("__report", fields, pictures.map((p) => ["shot", p.blob] as const));
  if (answer.status !== 200) return `not saved: ${answer.status === 0 ? "the server did not answer" : answer.text.trim().slice(0, 160) || `the server answered ${answer.status}`}`;
  try {
    const kept = JSON.parse(answer.text) as { id: number; pictures: number };
    return `saved capture ${kept.id} (${kept.pictures} pictures)`;
  } catch {
    return "saved";
  }
}

/** The slots that took most by themselves in an event's frame, as path and ms. */
function topSlots(d: DebugBar, spans: Float32Array): { slot: string; ms: number }[] {
  const n = d.spans.names.length, own = new Float64Array(n), parents = d.spans.parents;
  for (let s = 0; s < n; s++) if (!Number.isNaN(spans[s]!)) own[s]! += spans[MOST_SLOTS + s]!;
  for (let s = 0; s < n; s++) if (!Number.isNaN(spans[s]!) && parents[s]! >= 0) own[parents[s]!]! -= spans[MOST_SLOTS + s]!;
  const order: number[] = [];
  for (let s = 0; s < n; s++) if (parents[s]! >= 0 && !Number.isNaN(spans[s]!) && own[s]! > 0.05) order.push(s);
  order.sort((a, b) => own[b]! - own[a]!);
  return order.slice(0, 6).map((s) => ({ slot: d.pathOf(s), ms: Math.round(own[s]! * 100) / 100 }));
}
