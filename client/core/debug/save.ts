// Saving what the debug bar holds (F8, or Save): one upload to the server's `__report` as a capture, which a reader opens
// with tools/reports.ts. It carries the last minutes' pictures and one at full size taken as the save was asked, the
// record of frames and seconds, where a frame's time went, the lag events, the log and the socket's counts.

import { LEVEL_NAMES } from "../../../shared/debug.ts";
import { REPORT_VERSION, type Report, type ReportShot } from "../../../shared/report.ts";
import type { FramePacket } from "../render/packet.ts";
import { census } from "./census.ts";
import type { DebugBar } from "./debug.ts";
import { EVENT_NAMES, EVENTS_KEPT, eventWords, type LagEvent } from "./events.ts";
import { SOURCE_NAMES, ALL_SOURCES, type LogLine } from "./log.ts";
import { aimOf, pageOf, placeOf, settingsOf, skyOf, survivorOf, viewOf } from "./place.ts";
import type { Picture } from "./port.ts";
import type { ShotPose } from "./shots.ts";
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
  /** Where the full picture was taken from. */
  pose: ShotPose;
}

/** The frame the save was asked in: where, what, how it ran, and what it drew. */
export function captureHead(d: DebugBar, p: FramePacket, canvas: readonly number[], css: readonly number[], pose: ShotPose): CaptureHead {
  const app = d.app, port = d.port!, scene = app.scene;
  return {
    at: app.nowMs,
    wall: port.origin + app.nowMs,
    head: { place: placeOf(app), view: viewOf(app), aim: aimOf(app), sky: skyOf(app, p), page: pageOf(app, p, port.page(), canvas, css), settings: settingsOf(app), survivor: survivorOf(app) },
    census: census(p, 0, scene?.assets.table.tris ?? [], (mesh) => scene?.assets.manifest.meshes[mesh]?.id ?? String(mesh)),
    pose,
  };
}

/**
 * Where a frame's time went, for the capture: each slot's name and parent, the mean over the second before `to`, and the
 * slowest frames from `from` (both on the frame clock) that the ring still holds, with the time they reach back to.
 */
function spansRecord(d: DebugBar, from: number, to: number): Record<string, unknown> {
  const spans = d.spans, mean = new SpanFrame(), n = spans.names.length, r2 = (v: number): number => (Number.isNaN(v) ? -1 : Math.round(v * 100) / 100);
  const after = spans.since(to + 0.5);
  spans.mean(after, Math.max(1, spans.since(to - 1000) - after), mean);
  const slow: { at: number; frame: number; start: number[]; ms: number[] }[] = [];
  const rows: number[] = [];
  for (let back = 0; ; back++) {
    const row = spans.row(back);
    if (row < 0 || spans.when[row]! < from) break;
    if (spans.when[row]! <= to) rows.push(row);
  }
  // The ring holds fewer frames than a capture is long: it says how far back it reaches.
  const reach = rows.length > 0 ? spans.when[rows.at(-1)!]! - from : to - from;
  rows.sort((a, b) => spans.ms[b * MOST_SLOTS + LANE_FRAME]! - spans.ms[a * MOST_SLOTS + LANE_FRAME]!);
  for (const row of rows.slice(0, SLOWEST)) {
    const start: number[] = [], ms: number[] = [];
    for (let s = 0; s < n; s++) {
      start.push(r2(spans.start[row * MOST_SLOTS + s]!));
      ms.push(r2(spans.ms[row * MOST_SLOTS + s]!));
    }
    slow.push({ at: Math.round(spans.when[row]! - from), frame: ms[LANE_FRAME]!, start, ms });
  }
  return {
    from: Math.round(reach),
    names: spans.names.slice(0, n),
    parents: Array.from(spans.parents.subarray(0, n)),
    mean: { frames: mean.frames, start: Array.from(mean.start.subarray(0, n), r2), ms: Array.from(mean.ms.subarray(0, n), r2) },
    slowest: slow,
  };
}

/** Builds the capture and sends it. Returns what the bar says of it. */
export async function saveCapture(d: DebugBar, words: string, full: Promise<Picture>, head: CaptureHead): Promise<string> {
  // The capture reaches back CAPTURE_MS, or to when the bar began to record if that is later. Its records are taken
  // here, in the frame the save was asked in, and none holds anything after it. Each says in `window` the part of the
  // capture it holds, in ms from its start, since a ring may let go of what is older before the capture's start.
  const app = d.app, port = d.port!, from = Math.max(head.at - CAPTURE_MS, d.recordingFrom), span = Math.round(head.at - from), perf = d.perf;
  const wallFrom = head.wall - (head.at - from), since = (oldest: number, start: number): number => Math.max(0, Math.min(span, Math.round(oldest - start)));
  const frames = perf.frames(from, head.at, from);
  const perfRecord = {
    version: REPORT_VERSION, start: Math.round(from), window: { from: frames.length > 0 ? since(frames[0]![0]!, 0) : span, to: span }, fields: FRAME_FIELDS, frames,
    secondFields: SECOND_FIELDS, seconds: perf.secondRows(from, from, head.at), summary: { ...perf.summary(from, head.at), ringMs: Math.round(d.costMs * 10000) / 10000 },
    worst: perf.worst(from, head.at, 20), census: [{ ...head.census, shot: -1 }], spans: spansRecord(d, from, head.at), sound: {},
  };
  const lines: LogLine[] = [];
  d.log.read(lines, ALL_SOURCES, 0, d.log.most);
  const log = {
    window: { from: d.log.length >= d.log.most && lines.length > 0 ? since(lines[0]!.at, wallFrom) : 0, to: span },
    lines: lines.filter((l) => l.at >= wallFrom && l.at <= head.wall).map((l) => ({ at: l.at, source: SOURCE_NAMES[l.source], level: LEVEL_NAMES[l.level], text: l.text, count: l.count, tick: l.tick })),
  };
  const list = d.events.list;
  const events = {
    window: { from: list.length >= EVENTS_KEPT ? since(list[0]!.at, from) : 0, to: span },
    events: list.filter((e) => e.end >= from && e.at <= head.at).map((e) => ({
      at: Math.round(e.at - from), end: Math.round(Math.min(e.end, head.at) - from), kind: EVENT_NAMES[e.kind], size: Math.round(e.size * 100) / 100, count: e.count, cause: e.cause,
      top: e.spans ? topSlots(d, e.spans) : [],
    })),
  };
  const net = d.net.record(from, from);
  const chosenAt = d.chosenAt, chosenEvent = d.chosenEvent;
  // The pictures last: those still being made when the save was asked come in before its full one.
  let big: Picture | null = null;
  try {
    big = await full;
  } catch {}
  const ring = d.shots?.shots.filter((s) => s.at >= from && s.at <= head.at) ?? [];
  const pictures = [...ring.map((s) => s.picture), ...(big ? [big] : [])];
  // Each picture with where it was taken from, so one seen a block back still says where that was.
  const shots: ReportShot[] = [...ring.map((s) => ({ at: Math.round(s.at - from), w: s.picture.w, h: s.picture.h, ...(s.pose ?? {}) })), ...(big ? [{ at: span, w: big.w, h: big.h, ...head.pose }] : [])];
  if (big) perfRecord.census[0]!.shot = pictures.length - 1;
  const s = app.session;
  const report: Report = {
    version: REPORT_VERSION, kind: "capture", began: Math.round(wallFrom), ms: span, ...head.head, map: { id: s.world?.mapId ?? "" }, build: d.clientBuild, shots,
    ...(chosenAt >= from && chosenAt <= head.at && shots.length > 0 ? { chosen: chosenOf(chosenAt - from, chosenEvent, shots) } : {}),
    text: words ? [{ at: span, line: words }] : [], voice: { segments: [] },
  };
  const fields: [string, string][] = [
    ["token", d.token()], ["report", JSON.stringify(report)], ["perf", JSON.stringify(perfRecord)],
    ["log", JSON.stringify(log)], ["events", JSON.stringify(events)], ["net", JSON.stringify(net)],
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

/** The moment chosen on the timeline, `at` ms into the capture: when, the picture nearest it, and what happened there. */
function chosenOf(at: number, e: LagEvent | null, shots: readonly ReportShot[]): NonNullable<Report["chosen"]> {
  let shot = 0;
  for (let k = 1; k < shots.length; k++) if (Math.abs(shots[k]!.at! - at) < Math.abs(shots[shot]!.at! - at)) shot = k;
  return { at: Math.round(at), shot, what: e ? eventWords(e) : "a second chosen on the timeline" };
}

/** The slots that took most by themselves in an event's frame, as path and ms. */
function topSlots(d: DebugBar, spans: Float32Array): { slot: string; ms: number }[] {
  const n = d.spans.names.length, own = new Float64Array(n), parents = d.spans.parents;
  for (let s = 0; s < n; s++) if (!Number.isNaN(spans[s]!)) own[s]! += spans[MOST_SLOTS + s]!;
  for (let s = 0; s < n; s++) if (!Number.isNaN(spans[s]!) && parents[s]! >= 0) own[parents[s]!]! -= spans[MOST_SLOTS + s]!;
  const order: number[] = [];
  // The page's own work alone: the card's passes are on another clock.
  for (let s = 0; s < n; s++) if (parents[s]! >= 0 && d.spans.lane(s) === LANE_FRAME && !Number.isNaN(spans[s]!) && own[s]! > 0.05) order.push(s);
  order.sort((a, b) => own[b]! - own[a]!);
  return order.slice(0, 6).map((s) => ({ slot: d.pathOf(s), ms: Math.round(own[s]! * 100) / 100 }));
}
