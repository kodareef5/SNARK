// Opt-in diagnostics: a native probe, a developer inspecting prediction, and a development world's record of play, which
// the page sends its server (server/playlog.ts) and tools/play.ts reads. No timers or browser objects.
import type { Body } from "../../shared/sim/character.ts";
import { MARGIN_UNKNOWN } from "../../shared/net/protocol.ts";
import { SESSION_CREATING, SESSION_DEAD, SESSION_SPECTATING } from "../../shared/net/protocol.ts";
import type { App } from "./app.ts";
import type { Residency } from "./assets/residency.ts";
import type { Governor } from "./governor.ts";
import { DRAW_TEXTURED, type FramePacket } from "./render/packet.ts";
import type { ClientSession } from "./session.ts";

export interface PredictionDifference {
  tick: number;
  simulated: number;
  margin: number;
  driving: number;
  distance: number;
  input: readonly number[];
  fields: { name: string; predicted: number | boolean; authoritative: number | boolean }[];
}

/** The format of a PlayReport. */
export const PLAY_VERSION = 1;
/** Milliseconds of the page's clock a report covers. */
export const REPORT_MS = 5000;
/**
 * A frame that comes this long after the one before samples its first tick this late, which on a margin of one tick (the
 * clock's target, session.ts) is past when the server steps it.
 */
export const LONG_FRAME_MS = 50;
/** Of each sort of event a report keeps this many, and counts the rest. */
const KEPT = 32;
/** Fields of one correction a report keeps. */
const FIELDS_KEPT = 12;
/** Snapshots after a long frame that are read for its inputs' coming late, at most. */
const AFTER_SNAPSHOTS = 90;

/** A snapshot whose body was not the one predicted. Ticks are the server's and the page's input ticks, which are one count. */
export interface PlayCorrection {
  /** The snapshot's tick, the snapshot compared before it, and the newest tick the page had simulated. */
  t: number;
  since: number;
  sim: number;
  /** "moved", "state" (other predicted state alone), or "seat" (which body it is or where it sits, which nothing predicts). */
  what: string;
  /** Metres between the body predicted and the server's. */
  d: number;
  /** The kind driven, "" on foot; where; and the margin last reported, in ticks. */
  kind: string;
  x: number;
  y: number;
  z: number;
  m: number;
  /** The first snapshot compared since the body was predicted again (holdGround). */
  resumed: boolean;
  /**
   * What the page held of the chunk it stood in: all its structure rows come (`whole`), how many it held, and whether the
   * page sets the map's own statics down from its copy of the map (the server has been told it holds them).
   */
  whole: boolean;
  rows: number;
  statics: boolean;
  /** The input of the tick: move x and z, buttons, yaw and pitch, as sent. */
  input: number[];
  /** Each field that differed: its name, the page's value and the server's. */
  fields: [string, number | boolean, number | boolean][];
}

/** A frame that came LONG_FRAME_MS or more after the one before. */
export interface PlayFrame {
  /**
   * The first tick not sampled before it, how many it sampled, and how many it never sampled or sent: skipped, or taken
   * from snapshots that came while it stalled.
   */
  t: number;
  n: number;
  skip: number;
  /** Milliseconds since the frame before, and of those, the page's own code in the frame before. */
  ms: number;
  own: number;
  /** Put on the graphics card in the frame before: levels of meshes, textures, and other buffers. */
  up: number;
  tex: number;
  buf: number;
  /** Between the two frames: bytes of art come, parts of the map's ground landed, and statics handed to the session; and art requests under way. */
  got: number;
  ground: number;
  handed: number;
  flying: number;
  /**
   * The least margin of the snapshots after it, 127 until one came: below 1, its inputs reached the server late; and the
   * snapshot from which they were on time again (0 if they never were late, or not within AFTER_SNAPSHOTS).
   */
  after: number;
  back: number;
}

/** The input clock jumped: by how many ticks, and whether because inputs were late (else they were too early). */
export interface PlayJump {
  t: number;
  by: number;
  behind: boolean;
}

/** No snapshot came for this many ms of the page's clock while it drew frames, until the one of tick `t`, `ticks` after the one before. */
export interface PlayGap {
  t: number;
  ms: number;
  ticks: number;
}

/** What a development page measured of itself over REPORT_MS (tools/play.ts reads it beside the server's view). */
export interface PlayReport {
  v: number;
  name: string;
  /** The server's tick at the welcome, which with the name tells one session from another. */
  joined: number;
  /** The report's number in the session, from 0. */
  n: number;
  /** It covers the ticks after `from` up to `to`, and `ms` of the page's clock. */
  from: number;
  to: number;
  ms: number;
  /** Frames drawn, those LONG_FRAME_MS or more after the one before, over 100 and over 250 ms, and the longest. */
  frames: number;
  long: number;
  over100: number;
  over250: number;
  worst: number;
  /** Ticks sampled, ticks skipped, ticks not predicted (the ground within reach not held), and ticks sampled by what was driven ("" on foot). */
  ticks: number;
  skipped: number;
  unheld: number;
  kinds: Record<string, number>;
  /** Snapshots, those adopted whole (the server at or past the page), corrections that moved the body, of other state alone, of seats, and clock jumps. */
  snapshots: number;
  adopted: number;
  moved: number;
  state: number;
  seats: number;
  jumps: number;
  /** The least and most margin the server reported, and the last round trip measured, in ticks. */
  margin: [number, number];
  rtt: number;
  x: number;
  z: number;
  corrections: PlayCorrection[];
  frameList: PlayFrame[];
  jumpList: PlayJump[];
  gaps: PlayGap[];
  /** Stretches of ticks not predicted, first and last. */
  unheldList: [number, number][];
  /**
   * What else the page did, each with the newest tick sampled and the page's clock in ms: the session's state and what it
   * drove, the socket closing and why, the graphics context lost and given back, the tier, each step of the governor,
   * and the texture format, pixel ratio and canvas, once and when they change.
   */
  notes: [number, number, string][];
  /** The page's clock in ms at the report's start. */
  t0: number;
  /** Events past KEPT of a sort, not kept. */
  dropped: number;
}

export class PredictionTrace {
  enabled = false;
  readonly differences: PredictionDifference[] = [];
  dropped = 0;
  adopted = 0;
  furthestAhead = 0;
  longestFrameMs = 0;
  framesOver100ms = 0;
  catchupBatches = 0;
  skippedTicks = 0;
  /** Where a development page's reports go (`start`); null keeps none. */
  private send: ((report: string) => void) | null = null;
  private report: PlayReport | null = null;
  private began = -1;
  private sent = 0;
  private readonly base = { snapshots: 0, corrections: 0, stateCorrections: 0, transitions: 0, clockJumps: 0, unheld: 0, adopted: 0 };
  /** What the frame before put on the card and took of the page's own time, and what had come by then. */
  private own = 0;
  private up = 0;
  private tex = 0;
  private buf = 0;
  private fetched = 0;
  private fetchedThen = 0;
  private flying = 0;
  /** Statics handed to the session, and the ground's changes, as the frame before saw them. */
  handed = 0;
  private handedThen = 0;
  private groundThen = -1;
  /** The long frame whose margin after is being read, and snapshots left to read it from. */
  private pending: PlayFrame | null = null;
  private pendingLeft = 0;
  /** The first tick of the stretch not predicted now, or -1; and the snapshot the body was predicted again from. */
  private openUnheld = -1;
  private resumedAt = -1;
  /** Where the session will be stepped from: the newest tick sampled or skipped, as the frame before left it. */
  private last = -1;
  /** The newest tick and page time seen, which a note is told at. */
  private tick = 0;
  private now = 0;
  /** What was last noted of the session, the tier, the governor, the textures and the canvas. */
  private seen = { state: -1, choosing: -1, kind: -2, tier: "", moved: 0, format: "", dpr: 0, width: 0, height: 0 };

  /** Keeps the record of play from now on, and hands `send` a report every REPORT_MS of the page's clock. */
  start(send: (report: string) => void): void {
    this.enabled = true;
    this.send = send;
  }

  /** Each frame of an active session, after its ticks are sampled: `sampled` from the session's simTick back, and `skipped` after it. */
  frame(elapsed: number, sampled: number, skipped: number, s?: ClientSession, now = 0): void {
    if (!this.enabled) return;
    this.longestFrameMs = Math.max(this.longestFrameMs, elapsed);
    if (elapsed > 100) this.framesOver100ms++;
    if (sampled > 4) this.catchupBatches++;
    this.skippedTicks += skipped;
    if (!this.send || !s) return;
    const r = this.report ?? this.open(s, now, sampled);
    // Ticks the session took from snapshots while the page stalled count with those it skipped.
    const first = this.last >= 0 && this.last < s.simTick - sampled ? this.last + 1 : s.simTick - sampled + 1;
    const taken = s.simTick - sampled + 1 - first;
    this.last = s.simTick + skipped;
    this.tick = s.simTick;
    this.now = now;
    const kind = s.driving >= 0 ? s.own.kind : -1, seen = this.seen;
    if (s.sessionState !== seen.state || s.choosing !== seen.choosing || kind !== seen.kind) {
      const said = ["alive", "dead", "watching", "in the creator"][s.sessionState] ?? String(s.sessionState);
      this.note(`${said}${s.sessionState === SESSION_DEAD ? `, choosing where to rise (${s.choosing})` : ""}${kind >= 0 ? `, driving ${s.registry.defs[kind]?.id ?? kind}` : s.sessionState === SESSION_SPECTATING || s.sessionState === SESSION_CREATING ? "" : ", on foot"}`);
      seen.state = s.sessionState;
      seen.choosing = s.choosing;
      seen.kind = kind;
    }
    r.frames++;
    r.ticks += sampled;
    r.skipped += skipped;
    if (sampled > 0) {
      const kind = s.driving >= 0 ? (s.registry.defs[s.own.kind]?.id ?? String(s.own.kind)) : "";
      r.kinds[kind] = (r.kinds[kind] ?? 0) + sampled;
    }
    if (!s.predicting && this.openUnheld < 0) this.openUnheld = first;
    else if (s.predicting && this.openUnheld >= 0) {
      this.keep(r.unheldList, [this.openUnheld, first]);
      this.openUnheld = -1;
      this.resumedAt = s.latestSnapshot;
    }
    const ground = s.world?.hf.changes.length ?? 0;
    if (elapsed >= LONG_FRAME_MS) {
      r.long++;
      if (elapsed > 100) r.over100++;
      if (elapsed > 250) r.over250++;
      r.worst = Math.max(r.worst, Math.round(elapsed));
      const f: PlayFrame = { t: first, n: sampled, skip: skipped + taken, ms: Math.round(elapsed), own: Math.round(this.own), up: this.up, tex: this.tex, buf: this.buf, got: this.fetched - this.fetchedThen, ground: this.groundThen < 0 ? 0 : (ground - this.groundThen) / 4, handed: this.handed - this.handedThen, flying: this.flying, after: 127, back: 0 };
      if (this.keep(r.frameList, f)) {
        this.pending = f;
        this.pendingLeft = AFTER_SNAPSHOTS;
      }
    }
    this.fetchedThen = this.fetched;
    this.handedThen = this.handed;
    this.groundThen = ground;
    if (now - this.began >= REPORT_MS) this.flush(s, now);
  }

  /**
   * After a frame is drawn: the page's own milliseconds in it and what it drew; the art's residency, the governor, the
   * pixel ratio and the canvas in device pixels.
   */
  page(own: number, packet: FramePacket, r: Residency | undefined, governor: Governor, dpr: number, width: number, height: number): void {
    if (!this.send) return;
    this.own = own;
    this.up = packet.assetUploads.length;
    this.tex = packet.texUploads.length;
    this.buf = packet.uploads.length;
    this.fetched = r?.stats.fetched ?? 0;
    this.flying = r?.flying ?? 0;
    const seen = this.seen, format = r?.format ?? "";
    if (packet.tier.name !== seen.tier) this.note(`tier ${(seen.tier = packet.tier.name)}`);
    if (governor.moved !== seen.moved) {
      seen.moved = governor.moved;
      const step = governor.steps.at(-1);
      if (step) this.note(`governor to level ${step.level}${step.name ? ` (${step.name})` : ""}: ${step.why}`);
    }
    if (format !== seen.format || dpr !== seen.dpr || width !== seen.width || height !== seen.height) {
      Object.assign(seen, { format, dpr, width, height });
      this.note(`textures ${format || "none yet"}, ${dpr} device pixels a CSS pixel, canvas ${width} by ${height}`);
    }
  }

  /** Something the page did, told at the newest tick and time seen. */
  note(text: string): void {
    if (this.report) this.keep(this.report.notes, [this.tick, Math.round(this.now), text]);
  }

  /** The session closed, and why: told, and the report sent now, for no frame follows. */
  closed(s: ClientSession, why: string): void {
    if (!this.report) return;
    this.note(`closed: ${why}`);
    this.flush(s, this.now, false);
  }

  /** A snapshot came: its tick, the margin it reported, and the page's milliseconds and ticks since the one before. */
  snapshot(tick: number, margin: number, gapMs: number, ticks: number): void {
    const r = this.report;
    if (!r) return;
    if (margin !== MARGIN_UNKNOWN) {
      r.margin = [Math.min(r.margin[0], margin), Math.max(r.margin[1], margin)];
      // Snapshots of ticks before the frame's first tell of inputs sent before it.
      const f = this.pending;
      if (f && tick >= f.t) {
        f.after = Math.min(f.after, margin);
        if (margin >= 1 && f.after < 1) f.back = tick;
        if (f.back > 0 || --this.pendingLeft === 0) this.pending = null;
      }
    }
    if (gapMs > 300) this.keep(r.gaps, { t: tick, ms: Math.round(gapMs), ticks });
  }

  jump(tick: number, by: number, behind: boolean): void {
    if (this.report) this.keep(this.report.jumpList, { t: tick, by, behind });
  }

  adopt(tick: number, simulated: number): void {
    if (!this.enabled) return;
    this.adopted++;
    this.furthestAhead = Math.max(this.furthestAhead, tick - simulated);
  }

  record(tick: number, simulated: number, margin: number, driving: number, predicted: Body, authoritative: Body, input: readonly number[]): void {
    if (!this.enabled) return;
    if (this.differences.length === 64) { this.differences.shift(); this.dropped++; }
    this.differences.push({ tick, simulated, margin, driving, distance: distance(predicted, authoritative), input, fields: differing(predicted, authoritative) });
  }

  /** A snapshot of tick `t`, compared after the one of `since`, that was not as predicted, and what the page held where the body was. */
  corrected(s: ClientSession, t: number, since: number, what: string, predicted: Body, authoritative: Body, input: number[], held: { whole: boolean; rows: number; statics: boolean }): void {
    const r = this.report;
    if (!r) return;
    const fields = differing(predicted, authoritative).slice(0, FIELDS_KEPT).map((f): [string, number | boolean, number | boolean] => [f.name, f.predicted, f.authoritative]);
    const kind = s.driving >= 0 ? (s.registry.defs[authoritative.kind]?.id ?? String(authoritative.kind)) : "";
    this.keep(r.corrections, { t, since, sim: s.simTick, what, d: distance(predicted, authoritative), kind, x: round(authoritative.x), y: round(authoritative.y), z: round(authoritative.z), m: s.stats.margin, resumed: since <= this.resumedAt, ...held, input, fields });
  }

  /** Sends what the report holds and, unless the session has ended, begins the next. */
  flush(s: ClientSession, now: number, more = true): void {
    const r = this.report;
    if (!r || !this.send) return;
    const st = s.stats, b = this.base;
    Object.assign(r, { to: s.simTick, ms: Math.round(now - this.began), snapshots: st.snapshots - b.snapshots, moved: st.corrections - b.corrections, state: st.stateCorrections - b.stateCorrections, seats: st.transitions - b.transitions, jumps: st.clockJumps - b.clockJumps, unheld: st.unheld - b.unheld, adopted: this.adopted - b.adopted, rtt: st.rttTicks, x: round(s.own.x), z: round(s.own.z) });
    if (this.openUnheld >= 0) this.keep(r.unheldList, [this.openUnheld, s.simTick]);
    if (r.margin[0] > r.margin[1]) r.margin = [0, 0];
    // A long frame whose inputs' coming is still being read goes in the next report instead.
    const pending = this.pending && more ? r.frameList.indexOf(this.pending) : -1;
    if (pending >= 0) r.frameList.splice(pending, 1);
    this.send(JSON.stringify(r));
    this.report = null;
    if (this.openUnheld >= 0) this.openUnheld = s.simTick + 1;
    if (more) this.open(s, now, 0);
    if (pending >= 0) this.report!.frameList.push(this.pending!);
  }

  private open(s: ClientSession, now: number, sampled: number): PlayReport {
    const st = s.stats;
    Object.assign(this.base, { snapshots: st.snapshots, corrections: st.corrections, stateCorrections: st.stateCorrections, transitions: st.transitions, clockJumps: st.clockJumps, unheld: st.unheld, adopted: this.adopted });
    this.began = now;
    const from = s.simTick - sampled;
    return (this.report = {
      v: PLAY_VERSION, name: s.name, joined: s.joined, n: this.sent++, from, to: from, ms: 0,
      frames: 0, long: 0, over100: 0, over250: 0, worst: 0, ticks: 0, skipped: 0, unheld: 0, kinds: {},
      snapshots: 0, adopted: 0, moved: 0, state: 0, seats: 0, jumps: 0, margin: [127, -127], rtt: 0, x: 0, z: 0,
      corrections: [], frameList: [], jumpList: [], gaps: [], unheldList: [], notes: [], t0: Math.round(now), dropped: 0,
    });
  }

  /** Adds `item` to a report's list, or counts it dropped once the list holds KEPT. */
  private keep<T>(list: T[], item: T): boolean {
    if (list.length >= KEPT) {
      this.report!.dropped++;
      return false;
    }
    list.push(item);
    return true;
  }
}

function distance(a: Body, b: Body): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Millimetres, which a report's places and distances need no finer than. */
function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function differing(predicted: Body, authoritative: Body): PredictionDifference["fields"] {
  const fields: PredictionDifference["fields"] = [];
  for (const name of Object.keys(authoritative) as (keyof Body)[]) {
    const a = predicted[name], b = authoritative[name];
    if ((typeof a === "number" || typeof a === "boolean") && (typeof b === "number" || typeof b === "boolean") && a !== b) fields.push({ name, predicted: a, authoritative: b });
  }
  return fields;
}

/** Called only by an explicit probe request. A timeout can still describe a running page and its residency. */
export function probeProgress(app: App) {
  const s = app.session, r = app.scene?.assets.residency;
  const packet = app.scene?.packet, materials = new Set<string>();
  if (packet) for (let i = 0; i < packet.drawCount; i++) {
    if (packet.drawFlags[i]! & DRAW_TEXTURED) materials.add(app.scene!.assets.table.materials[packet.drawMaterial[i]!]!.id);
  }
  return {
    session: s.state, tick: s.simTick, snapshot: s.latestSnapshot, driving: s.driving,
    stats: { ...s.stats }, prediction: s.prediction,
    position: [s.own.x, s.own.y, s.own.z], speed: Math.hypot(s.own.vx, s.own.vz),
    tier: app.scene?.assets.tier.name, assets: r ? { ...r.stats, flying: r.flying, waiting: r.waiting, ledger: r.ledger, textures: r.textureState() } : null,
    draw: packet ? { count: packet.drawCount, triangles: packet.triangles, lit: packet.lit, materials: [...materials] } : null,
  };
}
