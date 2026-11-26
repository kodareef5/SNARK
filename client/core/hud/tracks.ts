// A drone feed's tracking boxes (hud/air-feed.ts): four corner brackets round each survivor and creature in view, from its
// bounds projected on the screen, those the world hides left out, the nearest TRACK_MOST kept. Each is labelled with its
// name or species, level and range, in the colour of how it stands to the viewer; a label that would cover a nearer one's
// moves, or is left out. A box locks on with a short shrink and jitters a pixel or so, more as the signal falls. The one
// under the reticle is the target: the feed's readout tells what the server says of it (server/overhead.ts looks from
// the drone's eye), and N marks it (air-feed.ts FEED_KEYS).

import type { Registry } from "../../../shared/content/registry.ts";
import { CUE_DEAD } from "../../../shared/anim/pose.ts";
import { handleIndex } from "../../../shared/ids.ts";
import { DRONE_LOOK } from "../../../shared/net/protocol.ts";
import { MAX_VIEW } from "../../../shared/net/view.ts";
import { youngScale } from "../../../shared/sim/breeding.ts";
import { sortU32 } from "../../../shared/sort.ts";
import type { CollisionWorld } from "../../../shared/world/collide.ts";
import { HIT_NONE, castWorld, rayBox, rayHit } from "../../../shared/world/ray.ts";
import { FEED_MARKED_MS } from "../air-feed.ts";
import type { Camera } from "../render/camera.ts";
import { feedHash } from "../render/feed.ts";
import type { ClientSession, RemoteSample } from "../session.ts";
import { K_BAR, K_PANEL, textWidth, type UiFrame, type UiNode } from "../ui/nodes.ts";
import { STYLES, S_CROSS, S_FEED_RIGHT, S_HEALTH, S_TRACK_NOTE, S_TRACK_OTHER, S_TRACK_TRIBE, S_TRACK_WILD } from "../ui/style.ts";
import { band, type HudWidget } from "./widget.ts";

/** The boxes' nodes, and the target's readout's. */
export const KEY_TRACKS = 46400;
const KEY_TARGET = KEY_TRACKS + 380;
/** The most boxes, the farthest a body is boxed (metres), and the rays a frame casts to find what the world hides. */
export const TRACK_MOST = 24;
export const TRACK_RANGE = 700;
export const TRACK_RAYS = 48;
/** Milliseconds a new box takes to lock on, and how much larger it starts. */
export const LOCK_MS = 260;
const LOCK_FROM = 0.7;
const VIEW_FLAG_PLAYER = 4;
const VIEW_FLAG_PROP = 8;
/** How a body stands to the viewer, as hud.ts OWNER_ has it. */
const OWNER_WILD = 0, OWNER_TRIBE = 1, OWNER_OTHER = 2;
/** Heights up a body, in shares of it, a line of sight is tried to. */
const RISES = [0.5, 0.95];
/** A box's words: two lines this tall over it. */
const LABEL_LINE = 13;
/** The most places on the screen a box's words keep off (buildTracks `reserved`). */
const RESERVED_MOST = 8;

export interface Track {
  /** The body's entity index and generation, and its index in the view. */
  id: number;
  gen: number;
  index: number;
  /** Its bounds on the screen, 0 to 1 with y down. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** An OWNER_ value, whether it is a survivor, its metres from the camera, and when its box first showed (ms). */
  owner: number;
  player: boolean;
  far: number;
  since: number;
  /** Its name, or its species where it has none; its species; its level and range. */
  title: string;
  species: string;
  line: string;
}

export interface TracksModel {
  tracks: Track[];
  trackCount: number;
  /** The track under the reticle, or -1; what the server told of it (a share, -1 for none) and its tribe. */
  trackLock: number;
  trackHealth: number;
  trackTribe: string;
  /** The time the boxes are drawn at (ms), and the feed's signal, which shakes them. */
  trackNow: number;
  trackSignal: number;
  trackMarkedAt: number;
}

/** How far a body of a kind reaches from its middle, metres (render/characters.ts reach). */
export interface Reach {
  reach(kind: number): number;
}

/** Ids boxed lately and when each first showed: a box seen again keeps its lock. */
const SEEN = 64;
const seen = { id: new Int32Array(SEEN).fill(-1), at: new Float64Array(SEEN), kept: new Uint8Array(SEEN) };
const scratch = { keys: new Uint32Array(MAX_VIEW), at: [0, 0, 0], dir: [0, 0, 0], labels: new Float64Array((TRACK_MOST + RESERVED_MOST) * 4) };

/** When the box of `id` first showed, `now` for a new one. */
function lockedSince(id: number, now: number): number {
  let free = -1;
  for (let k = 0; k < SEEN; k++) {
    if (seen.id[k] === id) {
      seen.kept[k] = 1;
      return seen.at[k]!;
    }
    if (free < 0 && seen.id[k] === -1) free = k;
  }
  if (free >= 0) {
    seen.id[free] = id;
    seen.at[free] = now;
    seen.kept[free] = 1;
  }
  return now;
}

function track(m: TracksModel): Track {
  return (m.tracks[m.trackCount] ??= { id: 0, gen: 0, index: 0, u0: 0, v0: 0, u1: 0, v1: 0, owner: OWNER_WILD, player: false, far: 0, since: 0, title: "", species: "", line: "" });
}

/** A body's half length along its heading and half width across it, metres: a creature's toward its farthest part, at `size`. */
function halves(reg: Registry, bodies: Reach | null, kind: number, player: boolean, size: number, out: number[]): void {
  const r = reg.bodyRadius[kind]! * size;
  out[0] = player || !bodies ? r : Math.max(r, Math.min(bodies.reach(kind) * 0.7 * size, r * 2.6));
  out[1] = r;
}

const half = [0, 0];

/**
 * Boxes the bodies of `remote` the camera `cam` sees into `m`, nearest first: every survivor and creature but `own` (an
 * entity index, -1 for none) and `driving`, within TRACK_RANGE, wholly or partly on screen and not behind the world. Each
 * box is the body's own, turned with it, as long as `bodies` says its kind reaches. `team` is the viewer's tribe (0 for
 * none), `now` the time in ms. Then finds the track the middle of the view holds.
 */
export function trackBodies(m: TracksModel, cam: Camera, world: CollisionWorld, reg: Registry, remote: RemoteSample, own: number, driving: number, team: number, now: number, bodies: Reach | null = null): void {
  m.trackCount = 0;
  m.trackLock = -1;
  const keys = scratch.keys, at = scratch.at;
  let n = 0;
  for (let i = 0; i < remote.count; i++) {
    if ((remote.flags[i]! & VIEW_FLAG_PROP) !== 0 || (remote.cue[i]! & CUE_DEAD) !== 0 || remote.id[i] === own || remote.id[i] === driving || reg.vehicle[remote.kind[i]!]) continue;
    const far = Math.hypot(remote.x[i]! - cam.x, remote.y[i]! - cam.y, remote.z[i]! - cam.z);
    if (far <= TRACK_RANGE) keys[n++] = Math.min(Math.floor(far * 16), 0xffff) * MAX_VIEW + i;
  }
  sortU32(keys, n);
  for (let k = 0; k < SEEN; k++) seen.kept[k] = 0;
  let rays = 0;
  for (let k = 0; k < n && m.trackCount < TRACK_MOST && rays < TRACK_RAYS; k++) {
    const i = keys[k]! % MAX_VIEW, kind = remote.kind[i]!, player = (remote.flags[i]! & VIEW_FLAG_PLAYER) !== 0;
    const size = remote.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    halves(reg, bodies, kind, player, size, half);
    const h = reg.bodyHeight[kind]! * size, x = remote.x[i]!, y = remote.y[i]!, z = remote.z[i]!;
    const fx = Math.sin(remote.yaw[i]!), fz = Math.cos(remote.yaw[i]!);
    // The eight corners of its box on screen; one behind the camera leaves it out.
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity, behind = false;
    for (let c = 0; c < 8 && !behind; c++) {
      const a = c & 1 ? half[0]! : -half[0]!, b = c & 4 ? half[1]! : -half[1]!;
      if (!cam.project(x + fx * a + fz * b, y + (c & 2 ? h : 0), z + fz * a - fx * b, at)) behind = true;
      else {
        u0 = Math.min(u0, at[0]!); u1 = Math.max(u1, at[0]!);
        v0 = Math.min(v0, at[1]!); v1 = Math.max(v1, at[1]!);
      }
    }
    if (behind || u1 < 0 || u0 > 1 || v1 < 0 || v0 > 1) continue;
    // Seen where a line from the camera reaches its middle, or failing that its top, past the world.
    let open = false;
    for (const rise of RISES) {
      const dx = x - cam.x, dy = y + h * rise - cam.y, dz = z - cam.z, d = Math.hypot(dx, dy, dz);
      rays++;
      if (d < 0.5 || castWorld(world, cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d - Math.max(0.3, half[1]!)) === HIT_NONE) {
        open = true;
        break;
      }
    }
    if (!open) continue;
    const t = track(m);
    m.trackCount++;
    t.id = remote.id[i]!; t.gen = remote.gen[i]!; t.index = i;
    t.u0 = u0; t.v0 = v0; t.u1 = u1; t.v1 = v1;
    t.player = player;
    t.owner = remote.team[i] === 0 ? (player ? OWNER_OTHER : OWNER_WILD) : team !== 0 && remote.team[i] === team ? OWNER_TRIBE : OWNER_OTHER;
    t.far = Math.hypot(x - cam.x, y + h / 2 - cam.y, z - cam.z);
    t.since = lockedSince(t.id, now);
    const id = reg.ids[kind] ?? "";
    t.species = id.slice(id.indexOf(":") + 1).replace(/_/g, " ").toUpperCase();
    t.title = remote.name[i] !== "" ? remote.name[i]!.toUpperCase() : t.species;
    t.line = `LV ${remote.level[i]}  ${Math.round(t.far)} M`;
  }
  for (let k = 0; k < SEEN; k++) if (!seen.kept[k]) seen.id[k] = -1;
  // The target: the nearest box the middle of the view meets before the world does.
  const d = scratch.dir;
  cam.ray(0.5, 0.5, d);
  let best = castWorld(world, cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, TRACK_RANGE) === HIT_NONE ? TRACK_RANGE : rayHit.t + 0.5;
  for (let k = 0; k < m.trackCount; k++) {
    const t = m.tracks[k]!, i = t.index, kind = remote.kind[i]!;
    const size = remote.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    halves(reg, bodies, kind, t.player, size, half);
    // A small body far off is hard to hold the middle of the view on: its box is a little wider to the reticle.
    const r = Math.max(half[0]!, t.far * 0.006), h = reg.bodyHeight[kind]! * size;
    const hit = rayBox(cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, remote.x[i]! - r, remote.y[i]!, remote.z[i]! - r, remote.x[i]! + r, remote.y[i]! + h, remote.z[i]! + r);
    if (hit < best) {
      best = hit;
      m.trackLock = k;
    }
  }
}

const TITLE = [S_TRACK_WILD, S_TRACK_TRIBE, S_TRACK_OTHER];

/** Whether a label's box (x0, y0, x1, y1) meets one of the first `n` placed. */
function meets(n: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const l = scratch.labels;
  for (let k = 0; k < n; k++) if (x0 < l[k * 4 + 2]! && x1 > l[k * 4]! && y0 < l[k * 4 + 3]! && y1 > l[k * 4 + 1]!) return true;
  return false;
}

/**
 * The boxes, into `f` `W` by `H`: the target's first, so its words are placed first, then the rest nearest first. Their
 * words keep off `reserved`, boxes x0, y0, x1, y1 one after another: what the feed's HUD holds there.
 */
export function buildTracks(f: UiFrame, m: TracksModel, W: number, H: number, reserved: readonly number[] = []): void {
  const now = m.trackNow, shake = 0.6 + 2.4 * (1 - m.trackSignal), beat = Math.floor(now / 90);
  let placed = Math.min(RESERVED_MOST, reserved.length >> 2);
  for (let k = 0; k < placed * 4; k++) scratch.labels[k] = reserved[k]!;
  for (let o = -1; o < m.trackCount && o < TRACK_MOST; o++) {
    const j = o < 0 ? m.trackLock : o;
    if (j < 0 || (o >= 0 && j === m.trackLock)) continue;
    const t = m.tracks[j]!, lock = j === m.trackLock;
    let k = KEY_TRACKS + j * 12;
    const grip = Math.min(1, Math.max(0, (now - t.since) / LOCK_MS)), grow = 1 + LOCK_FROM * (1 - grip) * (1 - grip);
    const jx = (feedHash(t.id, beat, 1) - 0.5) * 2 * shake, jy = (feedHash(t.id, beat, 2) - 0.5) * 2 * shake;
    const cx = ((t.u0 + t.u1) / 2) * W + jx, cy = ((t.v0 + t.v1) / 2) * H + jy;
    const hw = Math.max(8, ((t.u1 - t.u0) * W) / 2 + 3) * grow, hh = Math.max(8, ((t.v1 - t.v0) * H) / 2 + 3) * grow;
    const x0 = cx - hw, y0 = cy - hh, x1 = cx + hw, y1 = cy + hh;
    const arm = Math.max(5, Math.min(18, Math.min(hw, hh) * 0.5)), th = lock ? 2 : 1.5;
    const ink = STYLES[TITLE[t.owner]!]!.ink, alpha = (lock ? 1 : 0.8) * (0.35 + 0.65 * grip);
    for (let c = 0; c < 4; c++) {
      const px = c & 1 ? x1 : x0, py = c & 2 ? y1 : y0, sx = c & 1 ? -1 : 1, sy = c & 2 ? -1 : 1;
      const a = f.add(k++, K_PANEL, sx > 0 ? px : px - arm, sy > 0 ? py : py - th, arm, th, S_CROSS);
      const b = f.add(k++, K_PANEL, sx > 0 ? px : px - th, sy > 0 ? py : py - arm, th, arm, S_CROSS);
      a.tint = b.tint = ink;
      a.alpha = b.alpha = alpha;
    }
    // The target's box has a mark at its middle's height on each side.
    if (lock) {
      for (const [px, w] of [[x0 - 6, 5], [x1 + 1, 5]] as const) {
        const n = f.add(k++, K_PANEL, px, cy - 0.75, w, 1.5, S_CROSS);
        n.tint = ink;
        n.alpha = alpha;
      }
    } else k += 2;
    if (grip < 1) continue;
    // Its words over the box, or under it, kept on the screen and off the words already placed; left out where neither fits.
    const wide = Math.max(textWidth(t.title, TITLE[t.owner]!), textWidth(t.line, S_TRACK_NOTE)) + 4;
    const lx = Math.min(W - wide - 6, Math.max(6, x0));
    let ly = -1;
    for (const y of [y0 - 2 * LABEL_LINE - 2, y1 + 3]) {
      if (y < 4 || y + 2 * LABEL_LINE > H - 4 || meets(placed, lx, y, lx + wide, y + 2 * LABEL_LINE)) continue;
      ly = y;
      break;
    }
    if (ly < 0) continue;
    const l = scratch.labels;
    l[placed * 4] = lx; l[placed * 4 + 1] = ly; l[placed * 4 + 2] = lx + wide; l[placed * 4 + 3] = ly + 2 * LABEL_LINE;
    placed++;
    f.text(k++, lx, ly, wide, TITLE[t.owner]!, t.title).alpha = lock ? 1 : 0.9;
    f.text(k++, lx, ly + LABEL_LINE, wide, S_TRACK_NOTE, t.line).alpha = lock ? 1 : 0.8;
  }
}

/**
 * The target's readout, its right edge at `right` and its top at `y`: what it is, its level and range, what the server
 * told of its health and tribe, and N to mark it.
 */
export function buildTarget(f: UiFrame, m: TracksModel, right: number, y: number): void {
  let k = KEY_TARGET;
  const t = m.trackLock >= 0 ? m.tracks[m.trackLock]! : null;
  // Words set to end at `right`.
  const words = (at: number, style: number, text: string): UiNode => {
    const w = textWidth(text, style) + 2;
    return f.text(k++, right - w, at, w, style, text);
  };
  if (!t) {
    words(y, S_FEED_RIGHT, "TGT  ---").alpha = 0.7;
    return;
  }
  const style = TITLE[t.owner]!;
  words(y, S_FEED_RIGHT, `TGT  ${t.title.slice(0, 16)}`);
  const mark = f.add(k++, K_PANEL, right + 5, y + 3, 2, 11, S_CROSS);
  mark.tint = STYLES[style]!.ink;
  words(y + 18, style, `${t.title === t.species ? "" : `${t.species}  `}${t.line}`);
  let row = y + 34;
  if (m.trackHealth >= 0) {
    f.add(k++, K_BAR, right - 110, row + 5, 110, 4, S_HEALTH).value = m.trackHealth;
    f.text(k++, right - 136, row, 24, S_TRACK_NOTE, "HP");
    row += 15;
  }
  if (m.trackTribe !== "") {
    words(row, S_TRACK_OTHER, m.trackTribe.toUpperCase().slice(0, 20));
    row += 15;
  }
  const marked = m.trackNow - m.trackMarkedAt < FEED_MARKED_MS;
  words(row, marked ? S_TRACK_OTHER : S_TRACK_NOTE, marked ? "MARKED" : t.player ? "SURVIVOR" : t.far > DRONE_LOOK ? "TOO FAR TO MARK" : "N  MARK").alpha = marked ? 1 : 0.85;
}

export const TRACKS: HudWidget<TracksModel> = {
  name: "feed tracks",
  bands: [band(KEY_TRACKS, 420)],
  make: () => ({ tracks: [], trackCount: 0, trackLock: -1, trackHealth: -1, trackTribe: "", trackNow: 0, trackSignal: 1, trackMarkedAt: -Infinity }),
  fill(m, c) {
    const a = c.frame, s: ClientSession = c.session, feed = s.airFeed;
    m.trackCount = 0;
    m.trackLock = -1;
    if (!a || !feed.active) return;
    trackBodies(m, a.cam, a.world, a.reg, c.remote, handleIndex(s.ownHandle), s.driving, s.tribe.team, c.nowMs ?? 0, a.scene.characters);
    m.trackNow = c.nowMs ?? 0;
    m.trackSignal = feed.signal;
    m.trackMarkedAt = a.feed?.markedAt ?? -Infinity;
    const told = s.looked, lock = m.trackLock >= 0 ? m.tracks[m.trackLock]! : null;
    m.trackHealth = lock && told && told.id === lock.id ? told.health : -1;
    m.trackTribe = lock && told && told.id === lock.id ? told.tribe : "";
  },
};
