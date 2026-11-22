// A bug report (planning/workstreams/bug-notes.md): what a page in bug report mode sends to `__report`, and what the
// server keeps of it. A note is pictures every few seconds while the owner points at something, with the place, the
// view, the hour and how the game ran; a "perf" report is the same record over a set time with a picture at each end.
// Its reader is a coding agent, so the server writes only the fields named here, each cleaned to its kind (cleanReport):
// a report is text an agent reads, and nothing a page sends may stand in it as anything but data.

import { plain } from "./listing.ts";

export const REPORT_VERSION = 1;
export const REPORT_KINDS = ["note", "perf"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** The most one upload carries, in bytes; pictures a report holds; and how long a note runs before it saves itself. */
export const REPORT_BYTES_MOST = 24 * 1024 * 1024;
export const SHOTS_MOST = 40;
export const NOTE_MS_MOST = 90_000;
/** The most the reports folder holds, in bytes, before the server takes no more. */
export const FOLDER_BYTES_MOST = 2 * 1024 * 1024 * 1024;
/** A picture is the canvas at its own size up to this many pixels wide; the thumbnail of the first is this wide. */
export const SHOT_WIDE_MOST = 2560;
export const THUMB_WIDE = 320;
/** Milliseconds between a note's pictures. */
export const SHOT_EVERY_MS = 3000;
/** `/perf`'s seconds when none are given, and its most. */
export const PERF_SECONDS = 20;
export const PERF_SECONDS_MOST = 90;
/** How far back of a note's start its performance record reaches, in ms. */
export const BEFORE_MS = 30_000;
/** Lines the owner may type into a note, and characters a line. */
export const TEXT_LINES_MOST = 100;
export const TEXT_CHARS_MOST = 500;
/** Rows of a performance record by the frame and by the second, at most. */
export const FRAME_ROWS_MOST = 8192;
export const SECOND_ROWS_MOST = 900;

/**
 * What a field may hold: a number, a whole number, a truth, text of at most `text` characters, one of some words, a list
 * of at most `most` of a shape, exactly `numbers` numbers (a point, a size), or a record of named fields.
 */
export type Shape =
  | "number"
  | "int"
  | "bool"
  | { readonly text: number }
  | { readonly oneOf: readonly string[] }
  | { readonly list: Shape; readonly most: number }
  | { readonly numbers: number }
  | { readonly fields: Readonly<Record<string, Shape>> };

const N = "number", I = "int", B = "bool";
const POINT: Shape = { numbers: 3 };
const PAIR: Shape = { numbers: 2 };
const WORD: Shape = { text: 120 };

/** Where the survivor stood: its feet, its chunk and sector, the ground and the water there, and the street under it. */
const PLACE: Shape = {
  fields: {
    x: N, y: N, z: N, chunk: PAIR, sector: PAIR, ground: N, water: N,
    // The stretch nearest (shared/world/streets.ts streetAt): signed metres to its kerb (less than 0 on the road), its
    // type's number and seed, its side's verge and walk in metres and kinds, and whether it is one way or one of a pair.
    street: { fields: { d: N, type: I, seed: I, verge: N, walk: N, vergeKind: WORD, walkKind: WORD, kerbKind: WORD, oneWay: B, paired: B } },
  },
};
/** The camera and the eye: where each is, the camera's yaw and pitch (radians, yaw 0 faces +Z), its field of view in degrees. */
const VIEW: Shape = { fields: { camera: POINT, yaw: N, pitch: N, fov: N, eye: POINT, look: PAIR, third: B, orbit: B, driving: WORD } };
/** What the crosshair is on (client/core/assets/look.ts): what, its id, how far, where, and its mesh, levels and material. */
const AIM: Shape = {
  fields: { what: { oneOf: ["none", "ground", "structure", "node", "body"] }, id: WORD, distance: N, hit: POINT, water: B, mesh: I, meshId: WORD, wanted: I, shown: I, material: I, materialId: WORD, body: I },
};
const SKY: Shape = { fields: { hour: N, sun: POINT, light: N, fog: PAIR } };
const PAGE: Shape = {
  fields: { browser: { text: 300 }, card: { text: 200 }, dpr: N, canvas: PAIR, css: PAIR, tier: WORD, governor: { fields: { level: I, name: WORD } }, share: N, format: WORD, fps: N },
};
const BUILD: Shape = { fields: { commit: { text: 40 }, clean: B, at: { text: 40 } } };
const SHOT: Shape = { fields: { at: N, w: I, h: I, place: POINT, camera: POINT, yaw: N, pitch: N, hour: N, frameMs: N, draws: I, triangles: I, shotMs: N } };

/** A report as a page sends it, in the field `report`. Times are ms from the report's start unless named otherwise. */
export const REPORT_SHAPE: Shape = {
  fields: {
    version: I,
    kind: { oneOf: REPORT_KINDS },
    /** When it began, ms since 1970, and how long it ran. */
    began: N,
    ms: N,
    place: PLACE,
    view: VIEW,
    aim: AIM,
    sky: SKY,
    map: { fields: { id: { text: 64 }, hash: I } },
    build: BUILD,
    page: PAGE,
    settings: { fields: { fov: N, resolution: I, steady: B, finishGloss: N, roadFinish: I, thirdPerson: B, snapshotBytes: I } },
    survivor: { fields: { alive: B, kind: WORD, mode: I, held: WORD, driving: WORD } },
    shots: { list: SHOT, most: SHOTS_MOST },
    text: { list: { fields: { at: N, line: { text: TEXT_CHARS_MOST } } }, most: TEXT_LINES_MOST },
    // Phase 2: the recording as it was made (voice.webm) is the record, and these are when the owner spoke, on the
    // report's clock. A transcript is the reader tool's to add beside it, never in its place.
    voice: { fields: { segments: { list: { fields: { from: N, to: N } }, most: 400 } } },
  },
};

/** One picture's count of the frame's draws (client/core/notes/census.ts): by step and by store, and the largest draws. */
const COUNT: Shape = { fields: { name: WORD, draws: I, triangles: I, instances: I } };
const CENSUS: Shape = {
  fields: {
    shot: I,
    steps: { list: COUNT, most: 8 },
    stores: { list: COUNT, most: 16 },
    largest: { list: { fields: { mesh: WORD, level: I, instances: I, triangles: I, store: WORD, step: WORD } }, most: 20 },
  },
};
/** A performance record (perf.json): frames and seconds as rows under their fields' names, a summary, the worst frames, a census at each picture. */
export const PERF_SHAPE: Shape = {
  fields: {
    version: I,
    /** The page's clock in ms at the report's start, which `at` in the rows counts on. */
    start: N,
    fields: { list: WORD, most: 64 },
    frames: { list: { list: N, most: 64 }, most: FRAME_ROWS_MOST },
    secondFields: { list: WORD, most: 64 },
    seconds: { list: { list: N, most: 64 }, most: SECOND_ROWS_MOST },
    summary: {
      fields: {
        frames: I, left: I, middle: N, p95: N, p99: N, worst: N, over16: N, over33: N, over50: N,
        gpu: { fields: { frames: I, middle: N, p95: N, worst: N } }, heap: N, longTasks: I, longMs: N, ringMs: N,
      },
    },
    worst: { list: { list: N, most: 64 }, most: 20 },
    census: { list: CENSUS, most: SHOTS_MOST },
  },
};

const round = (v: number): number => (Math.abs(v) >= 1e6 ? Math.round(v) : Math.round(v * 10000) / 10000);

/** `raw` as `shape` holds it: known fields only, each of its kind, text plain and cut short; undefined where it cannot be. */
export function clean(raw: unknown, shape: Shape): unknown {
  if (shape === "number") return typeof raw === "number" && Number.isFinite(raw) ? round(raw) : undefined;
  if (shape === "int") return typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : undefined;
  if (shape === "bool") return typeof raw === "boolean" ? raw : undefined;
  if ("text" in shape) return typeof raw === "string" ? plain(raw).slice(0, shape.text) : undefined;
  if ("oneOf" in shape) return typeof raw === "string" && shape.oneOf.includes(raw) ? raw : undefined;
  if ("numbers" in shape) {
    if (!Array.isArray(raw) || raw.length !== shape.numbers || !raw.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
    return raw.map((v: number) => round(v));
  }
  if ("list" in shape) {
    if (!Array.isArray(raw)) return undefined;
    const out: unknown[] = [];
    for (const item of raw.slice(0, shape.most)) {
      const v = clean(item, shape.list);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(shape.fields)) {
    const v = clean((raw as Record<string, unknown>)[key], inner);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** A point, a size: numbers in order. */
export type Point = [number, number, number];

/** A report as REPORT_SHAPE keeps it, every field optional but `kind`, `shots` and `text`. */
export interface Report {
  version?: number;
  kind: ReportKind;
  began?: number;
  ms?: number;
  place?: { x?: number; y?: number; z?: number; chunk?: [number, number]; sector?: [number, number]; ground?: number; water?: number; street?: { d?: number; type?: number; seed?: number; verge?: number; walk?: number; vergeKind?: string; walkKind?: string; kerbKind?: string; oneWay?: boolean; paired?: boolean } };
  view?: { camera?: Point; yaw?: number; pitch?: number; fov?: number; eye?: Point; look?: [number, number]; third?: boolean; orbit?: boolean; driving?: string };
  aim?: { what?: string; id?: string; distance?: number; hit?: Point; water?: boolean; mesh?: number; meshId?: string; wanted?: number; shown?: number; material?: number; materialId?: string; body?: number };
  sky?: { hour?: number; sun?: Point; light?: number; fog?: [number, number] };
  map?: { id?: string; hash?: number };
  build?: ReportBuild;
  page?: { browser?: string; card?: string; dpr?: number; canvas?: [number, number]; css?: [number, number]; tier?: string; governor?: { level?: number; name?: string }; share?: number; format?: string; fps?: number };
  settings?: Record<string, number | boolean>;
  survivor?: { alive?: boolean; kind?: string; mode?: number; held?: string; driving?: string };
  shots: ReportShot[];
  text: { at?: number; line?: string }[];
  voice?: { segments?: { from?: number; to?: number }[] };
}
export interface ReportShot { at?: number; w?: number; h?: number; place?: Point; camera?: Point; yaw?: number; pitch?: number; hour?: number; frameMs?: number; draws?: number; triangles?: number; shotMs?: number }
export interface ReportBuild { commit?: string; clean?: boolean; at?: string }

/** The summary of a performance record (PERF_SHAPE's). Frame times are ms; `over16` and the rest are shares of the frames. */
export interface PerfSummary {
  frames?: number;
  left?: number;
  middle?: number;
  p95?: number;
  p99?: number;
  worst?: number;
  over16?: number;
  over33?: number;
  over50?: number;
  gpu?: { frames?: number; middle?: number; p95?: number; worst?: number };
  heap?: number;
  longTasks?: number;
  longMs?: number;
  ringMs?: number;
}

/** A page's report text as the server keeps it, or why it is not one. */
export function cleanReport(text: string): { report: Report } | { fault: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { fault: "the report is not JSON" };
  }
  const r = clean(raw, REPORT_SHAPE) as Partial<Report> | undefined;
  if (!r) return { fault: "the report is not a record" };
  if (r.kind === undefined) return { fault: `the report names no kind (${REPORT_KINDS.join(" or ")})` };
  return { report: { ...r, kind: r.kind, shots: r.shots ?? [], text: r.text ?? [] } };
}

/** A performance record's text as the server keeps it, or why it is not one. */
export function cleanPerf(text: string): { perf: Record<string, unknown> } | { fault: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { fault: "the performance record is not JSON" };
  }
  const p = clean(raw, PERF_SHAPE) as Record<string, unknown> | undefined;
  return p ? { perf: p } : { fault: "the performance record is not a record" };
}

/**
 * A record as JSON an agent can read: two spaces a level, but a list of numbers, or a list of such lists' rows, one
 * line each, so a few thousand frames are a few thousand lines.
 */
export function readableJson(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) return JSON.stringify(value);
    if (value.length === 0) return "[]";
    const inner = indent + "  ";
    return `[\n${value.map((v) => inner + readableJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const inner = indent + "  ";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${readableJson(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A report's folder name: its id, four figures at least. */
export const reportFolder = (id: number): string => String(id).padStart(4, "0");

/** A picture's file name: shot-01.jpg for the first. */
export const shotFile = (n: number): string => `shot-${String(n + 1).padStart(2, "0")}.jpg`;

/** The width and height of a JPEG, read from its first frame header; null for bytes that are not a JPEG. */
export function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // Fill bytes, and markers that stand alone.
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    // A start of frame: baseline, extended, progressive or lossless, but not a table of colours (C4) or arithmetic's (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = (bytes[at + 5]! << 8) | bytes[at + 6]!, w = (bytes[at + 7]! << 8) | bytes[at + 8]!;
      return w > 0 && h > 0 ? { w, h } : null;
    }
    if (marker === 0xd9 || marker === 0xda || length < 2) return null;
    at += 2 + length;
  }
  return null;
}

/** "0:14" for 14,200 ms. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
