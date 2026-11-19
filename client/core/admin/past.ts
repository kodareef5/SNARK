// The survivor log at a moment, worked out on the page from what it holds of a window, so the playhead moves with no
// asking: who was online then by their sessions, where each was between two samples, a tail of where they had just been,
// how many were online across the window, and the window's figures an admin reaches for first.

import { LOG_ALIVE, LOG_DEAD, LOG_OUT, LOG_SPECTATING, type LogMark, type LogPositions, type LogSession, type LogSurvivor, type LogTrack } from "../../../shared/survivor-log.ts";
import { DOT_AWAY, DOT_DEAD, DOT_ONLINE, DOT_OUT, DOT_SPECTATING, drawOrder, type Dot, type MapFrame } from "./frame.ts";

/** The stint of `s` that holds the moment `t`: from its start up to its end, one still going on reaching `end`, the log's. */
export function sessionAt(s: LogSurvivor, t: number, end: number): LogSession | null {
  for (const x of s.sessions) if (x.from <= t && t <= (x.to ?? end)) return x;
  return null;
}

/** The last of ascending `wall` at or before `t`, -1 for none. */
export function sampleBefore(wall: readonly number[], t: number): number {
  let lo = 0;
  let hi = wall.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (wall[mid]! <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** A place at a moment: where, the LOG_ state, and the index of what it sat on in the read's `seats`, 0 for nothing. */
export interface Place {
  x: number;
  z: number;
  state: number;
  seat: number;
}

/**
 * Where a track puts its survivor at `t`. Between two samples no more than `gap` apart it is on the line between them, as
 * far along as the moment is; past the last one, or between two further apart, it is at the earlier. Before the first it
 * is at the first, if that is within `gap`; else nowhere.
 */
export function placeAt(track: LogTrack, t: number, gap: number): Place | null {
  const k = sampleBefore(track.wall, t);
  if (k < 0) return track.wall.length > 0 && track.wall[0]! - t <= gap ? { x: track.x[0]!, z: track.z[0]!, state: track.state[0]!, seat: track.seat[0]! } : null;
  const place = { x: track.x[k]!, z: track.z[k]!, state: track.state[k]!, seat: track.seat[k]! };
  const span = (track.wall[k + 1] ?? Infinity) - track.wall[k]!;
  if (span > gap || span <= 0) return place;
  const f = (t - track.wall[k]!) / span;
  place.x += (track.x[k + 1]! - place.x) * f;
  place.z += (track.z[k + 1]! - place.z) * f;
  return place;
}

/** The track's places from `t - tail` to `t`, x and z by turns, the place at `t` last; none before `since`. */
export function tailOf(track: LogTrack, t: number, tail: number, gap: number, since: number): number[] {
  const out: number[] = [];
  const from = Math.max(since, t - tail);
  // The first sample at or after `from`.
  let k = sampleBefore(track.wall, from);
  if (k < 0 || track.wall[k]! < from) k++;
  for (; k < track.wall.length && track.wall[k]! <= t; k++) out.push(track.x[k]!, track.z[k]!);
  const now = placeAt(track, t, gap);
  if (now) out.push(now.x, now.z);
  return out;
}

const DOT_OF: Readonly<Record<number, number>> = { [LOG_ALIVE]: DOT_ONLINE, [LOG_OUT]: DOT_OUT, [LOG_DEAD]: DOT_DEAD, [LOG_SPECTATING]: DOT_SPECTATING };

/**
 * The map at `t` from a window's reads: every survivor whose session holds the moment, where its track puts it, its state,
 * what it rode and a tail of `tail` ms. One offline then is left off, wherever it was last; `end` is the log's end.
 */
export function frameAt(t: number, survivors: readonly LogSurvivor[], positions: LogPositions, end: number, tail: number): MapFrame {
  const tracks = new Map(positions.tracks.map((x) => [x.pid, x]));
  // Two samples of one walk are a step apart; further apart, the survivor was away or the log was thinned past knowing.
  const gap = positions.step * 2.5;
  const dots: Dot[] = [];
  for (const s of survivors) {
    const session = sessionAt(s, t, end);
    const track = tracks.get(s.pid);
    if (!session || !track) continue;
    const place = placeAt(track, t, gap);
    if (!place) continue;
    dots.push({ pid: s.pid, name: s.name, team: session.team, x: place.x, z: place.z, state: DOT_OF[place.state] ?? DOT_AWAY, riding: positions.seats[place.seat] ?? "", tail: tailOf(track, t, tail, gap, session.from) });
  }
  return { at: t, live: false, dots: drawOrder(dots) };
}

/** A survivor of the window as the table lists it at the playhead. */
export interface PastRow {
  pid: number;
  name: string;
  tribe: string;
  /** Online at the playhead, and then its DOT_ state, what it rode and where it was; NaN where the log holds no place. */
  online: boolean;
  state: number;
  riding: string;
  x: number;
  z: number;
  /** In the window shown: its time online, the stints it began, and its deaths. */
  playMs: number;
  sessions: number;
  deaths: number;
}

/** Every survivor of the window at the playhead `t`: those online then first, then by time online in the window. */
export function rowsAt(t: number, survivors: readonly LogSurvivor[], positions: LogPositions, marks: readonly LogMark[], start: number, end: number, last: number): PastRow[] {
  const tracks = new Map(positions.tracks.map((x) => [x.pid, x]));
  const gap = positions.step * 2.5;
  const rows = survivors.map((s): PastRow => {
    const session = sessionAt(s, t, last);
    const track = tracks.get(s.pid);
    const place = session && track ? placeAt(track, t, gap) : null;
    return {
      pid: s.pid,
      name: s.name,
      tribe: (session ?? s.sessions.at(-1))?.tribe ?? "",
      online: session !== null,
      state: place ? (DOT_OF[place.state] ?? DOT_AWAY) : DOT_ONLINE,
      riding: place ? (positions.seats[place.seat] ?? "") : "",
      x: place ? place.x : NaN,
      z: place ? place.z : NaN,
      playMs: playIn(s, start, end, last),
      sessions: begunIn(s, start, end),
      deaths: marks.filter((m) => m.kind === "death" && m.pid === s.pid && m.wall >= start && m.wall <= end).length,
    };
  });
  return rows.sort((a, b) => Number(b.online) - Number(a.online) || b.playMs - a.playMs || a.name.localeCompare(b.name));
}

/** How many were online at the most in each of `n` equal stretches from `start` to `end`. `last` is the log's end. */
export function onlineCounts(survivors: readonly LogSurvivor[], start: number, end: number, n: number, last: number): number[] {
  const edges: [number, number][] = [];
  for (const s of survivors) for (const x of s.sessions) edges.push([x.from, 1], [x.to ?? last, -1]);
  // An end before a start at the same moment, so one stint following another is not counted twice.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(n).fill(0);
  const width = (end - start) / n;
  let on = 0;
  let e = 0;
  for (; e < edges.length && edges[e]![0] <= start; e++) on += edges[e]![1];
  for (let i = 0; i < n; i++) {
    const stop = start + (i + 1) * width;
    let most = on;
    for (; e < edges.length && edges[e]![0] < stop; e++) {
      on += edges[e]![1];
      most = Math.max(most, on);
    }
    out[i] = most;
  }
  return out;
}

/** Sessions a survivor began from `start` to `end`: a change of tribe goes on the session it changed in. */
export function begunIn(s: LogSurvivor, start: number, end: number): number {
  return new Set(s.sessions.filter((x) => x.began >= start && x.began <= end).map((x) => x.began)).size;
}

/** Milliseconds of a survivor's sessions inside `start` to `end`. */
export function playIn(s: LogSurvivor, start: number, end: number, last: number): number {
  let ms = 0;
  for (const x of s.sessions) ms += Math.max(0, Math.min(x.to ?? last, end) - Math.max(x.from, start));
  return ms;
}

export interface WindowFigures {
  /** Survivors online at any moment of it, stints begun in it, and their time online in all. */
  survivors: number;
  sessions: number;
  playMs: number;
  /** The most online at once, and the first moment of it. */
  peak: number;
  peakAt: number;
  /** Who played most, most first. */
  players: { pid: number; name: string; tribe: string; playMs: number; sessions: number }[];
  deaths: number;
  /** Deaths by their cause, most first, and the admin commands typed. */
  causes: [string, number][];
  commands: number;
}

/** The window's figures: who played and how long, the most online at once, deaths by cause and admin commands. */
export function figures(survivors: readonly LogSurvivor[], marks: readonly LogMark[], start: number, end: number, last: number): WindowFigures {
  const players = survivors
    .map((s) => ({ pid: s.pid, name: s.name, tribe: s.sessions.at(-1)?.tribe ?? "", playMs: playIn(s, start, end, last), sessions: begunIn(s, start, end) }))
    .filter((p) => p.playMs > 0)
    .sort((a, b) => b.playMs - a.playMs || a.name.localeCompare(b.name));
  // The most at once, sweeping the stints' edges inside the window.
  const edges: [number, number][] = [];
  for (const s of survivors) for (const x of s.sessions) if (x.from <= end && (x.to ?? last) >= start) edges.push([Math.max(start, x.from), 1], [Math.min(end, x.to ?? last), -1]);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let on = 0;
  let peak = 0;
  let peakAt = start;
  for (const [t, d] of edges) {
    on += d;
    if (on > peak) [peak, peakAt] = [on, t];
  }
  const inside = marks.filter((m) => m.wall >= start && m.wall <= end);
  const causes = new Map<string, number>();
  for (const m of inside) if (m.kind === "death") causes.set(m.text || "unknown", (causes.get(m.text || "unknown") ?? 0) + 1);
  return {
    survivors: players.length,
    sessions: players.reduce((n, p) => n + p.sessions, 0),
    playMs: players.reduce((n, p) => n + p.playMs, 0),
    peak,
    peakAt,
    players,
    deaths: inside.filter((m) => m.kind === "death").length,
    causes: [...causes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    commands: inside.filter((m) => m.kind === "admin").length,
  };
}
