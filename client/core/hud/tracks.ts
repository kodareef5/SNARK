// A drone feed's tracking boxes (hud/air-feed.ts): four corner brackets round each survivor and creature in view, from its
// bounds projected on the screen, those the world hides left out, the nearest TRACK_MOST kept. Each is labelled with its
// name or species, level and range, in the colour of how it stands to the viewer. A box locks on with a short shrink and
// jitters a pixel or so, more as the signal falls. The one under the reticle is the lock: it shows what the server tells
// of it (server/overhead.ts looks from the drone's eye), and N marks it (air-feed.ts FEED_KEYS).

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
import { K_BAR, K_PANEL, textWidth, type UiFrame } from "../ui/nodes.ts";
import { STYLES, S_CROSS, S_DARK, S_HEALTH, S_TRACK_NOTE, S_TRACK_OTHER, S_TRACK_TRIBE, S_TRACK_WILD } from "../ui/style.ts";
import type { HudWidget } from "./widget.ts";

/** The boxes' nodes. */
export const KEY_TRACKS = 46400;
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
  title: string;
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

/** Ids boxed lately and when each first showed: a box seen again keeps its lock. */
const SEEN = 64;
const seen = { id: new Int32Array(SEEN).fill(-1), at: new Float64Array(SEEN), kept: new Uint8Array(SEEN) };
const scratch = { keys: new Uint32Array(MAX_VIEW), at: [0, 0, 0], dir: [0, 0, 0] };

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
  return (m.tracks[m.trackCount] ??= { id: 0, gen: 0, index: 0, u0: 0, v0: 0, u1: 0, v1: 0, owner: OWNER_WILD, player: false, far: 0, since: 0, title: "", line: "" });
}

/**
 * Boxes the bodies of `remote` the camera `cam` sees into `m`, nearest first: every survivor and creature but `own` (an
 * entity index, -1 for none) and `driving`, within TRACK_RANGE, wholly or partly on screen and not behind the world. `team`
 * is the viewer's tribe (0 for none), `now` the time in ms. Then finds the track the middle of the view holds.
 */
export function trackBodies(m: TracksModel, cam: Camera, world: CollisionWorld, reg: Registry, remote: RemoteSample, own: number, driving: number, team: number, now: number): void {
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
    const i = keys[k]! % MAX_VIEW, kind = remote.kind[i]!;
    const size = remote.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    const r = reg.bodyRadius[kind]! * size, h = reg.bodyHeight[kind]! * size;
    const x = remote.x[i]!, y = remote.y[i]!, z = remote.z[i]!;
    // The eight corners of its box on screen; one behind the camera leaves it out.
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity, behind = false;
    for (let c = 0; c < 8 && !behind; c++) {
      if (!cam.project(x + (c & 1 ? r : -r), y + (c & 2 ? h : 0), z + (c & 4 ? r : -r), at)) behind = true;
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
      if (d < 0.5 || castWorld(world, cam.x, cam.y, cam.z, dx / d, dy / d, dz / d, d - Math.max(0.3, r)) === HIT_NONE) {
        open = true;
        break;
      }
    }
    if (!open) continue;
    const t = track(m);
    m.trackCount++;
    t.id = remote.id[i]!; t.gen = remote.gen[i]!; t.index = i;
    t.u0 = u0; t.v0 = v0; t.u1 = u1; t.v1 = v1;
    t.player = (remote.flags[i]! & VIEW_FLAG_PLAYER) !== 0;
    t.owner = remote.team[i] === 0 ? (t.player ? OWNER_OTHER : OWNER_WILD) : team !== 0 && remote.team[i] === team ? OWNER_TRIBE : OWNER_OTHER;
    t.far = Math.hypot(x - cam.x, y + h / 2 - cam.y, z - cam.z);
    t.since = lockedSince(t.id, now);
    const id = reg.ids[kind] ?? "", species = id.slice(id.indexOf(":") + 1).replace(/_/g, " ").toUpperCase();
    t.title = remote.name[i] !== "" ? remote.name[i]!.toUpperCase() : species;
    t.line = `LV ${remote.level[i]}  ${Math.round(t.far)} M`;
  }
  for (let k = 0; k < SEEN; k++) if (!seen.kept[k]) seen.id[k] = -1;
  // The lock: the nearest box the middle of the view meets before the world does.
  const d = scratch.dir;
  cam.ray(0.5, 0.5, d);
  let best = castWorld(world, cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, TRACK_RANGE) === HIT_NONE ? TRACK_RANGE : rayHit.t + 0.5;
  for (let k = 0; k < m.trackCount; k++) {
    const i = m.tracks[k]!.index, kind = remote.kind[i]!;
    const size = remote.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, remote.span[i]!, remote.grown[i]!, remote.tick) : 1;
    // A small body far off is hard to hold the middle of the view on: its box is a little wider to the reticle.
    const r = Math.max(reg.bodyRadius[kind]! * size, m.tracks[k]!.far * 0.006), h = reg.bodyHeight[kind]! * size;
    const t = rayBox(cam.x, cam.y, cam.z, d[0]!, d[1]!, d[2]!, remote.x[i]! - r, remote.y[i]!, remote.z[i]! - r, remote.x[i]! + r, remote.y[i]! + h, remote.z[i]! + r);
    if (t < best) {
      best = t;
      m.trackLock = k;
    }
  }
}

const TITLE = [S_TRACK_WILD, S_TRACK_TRIBE, S_TRACK_OTHER];

/** The boxes, into `f` `W` by `H`. */
export function buildTracks(f: UiFrame, m: TracksModel, W: number, H: number): void {
  const now = m.trackNow, shake = 0.6 + 2.4 * (1 - m.trackSignal), beat = Math.floor(now / 90);
  let k = KEY_TRACKS;
  for (let j = 0; j < m.trackCount && j < TRACK_MOST; j++) {
    const t = m.tracks[j]!, lock = j === m.trackLock;
    const grip = Math.min(1, Math.max(0, (now - t.since) / LOCK_MS)), grow = 1 + LOCK_FROM * (1 - grip) * (1 - grip);
    const jx = (feedHash(t.id, beat, 1) - 0.5) * 2 * shake, jy = (feedHash(t.id, beat, 2) - 0.5) * 2 * shake;
    const cx = ((t.u0 + t.u1) / 2) * W + jx, cy = ((t.v0 + t.v1) / 2) * H + jy;
    const hw = Math.max(9, ((t.u1 - t.u0) * W) / 2 + 4) * grow, hh = Math.max(9, ((t.v1 - t.v0) * H) / 2 + 4) * grow;
    const x0 = cx - hw, y0 = cy - hh, x1 = cx + hw, y1 = cy + hh;
    const arm = Math.max(5, Math.min(18, Math.min(hw, hh) * 0.5)), th = lock ? 2 : 1.5;
    const ink = STYLES[TITLE[t.owner]!]!.ink, alpha = (lock ? 1 : 0.8) * (0.35 + 0.65 * grip);
    for (const [px, sx] of [[x0, 1], [x1, -1]] as const) {
      for (const [py, sy] of [[y0, 1], [y1, -1]] as const) {
        const a = f.add(k++, K_PANEL, sx > 0 ? px : px - arm, sy > 0 ? py : py - th, arm, th, S_CROSS);
        const b = f.add(k++, K_PANEL, sx > 0 ? px : px - th, sy > 0 ? py : py - arm, th, arm, S_CROSS);
        a.tint = b.tint = ink;
        a.alpha = b.alpha = alpha;
      }
    }
    if (grip < 1) continue;
    // Its words over the box, or under it near the top of the screen.
    const above = y0 > 30, ty = above ? y0 - 26 : y1 + 3;
    const title = f.text(k++, x0, ty, Math.max(60, textWidth(t.title, TITLE[t.owner]!) + 2), TITLE[t.owner]!, t.title);
    title.alpha = lock ? 1 : 0.9;
    f.text(k++, x0, ty + 13, Math.max(60, textWidth(t.line, S_TRACK_NOTE) + 2), S_TRACK_NOTE, t.line).alpha = lock ? 1 : 0.8;
    if (lock) buildLock(f, m, t, x1 + 8, y0, W);
  }
}

/** The lock's card beside its box: what the server told of it, and N to mark it. */
function buildLock(f: UiFrame, m: TracksModel, t: Track, x: number, y: number, W: number): void {
  const k = KEY_TRACKS + TRACK_MOST * 12;
  const w = 118, left = x + w > W - 8 ? x - w - 16 - (t.u1 - t.u0) * W : x;
  const lines = (m.trackHealth >= 0 ? 1 : 0) + (m.trackTribe !== "" ? 1 : 0) + 1;
  f.add(k, K_PANEL, left, y, w, 8 + lines * 14, S_DARK).alpha = 0.45;
  f.add(k + 1, K_PANEL, left, y, 2, 8 + lines * 14, S_CROSS).tint = STYLES[TITLE[t.owner]!]!.ink;
  let row = y + 4;
  if (m.trackHealth >= 0) {
    f.text(k + 2, left + 7, row, 30, S_TRACK_NOTE, "HP");
    f.add(k + 3, K_BAR, left + 28, row + 5, w - 36, 4, S_HEALTH).value = m.trackHealth;
    row += 14;
  }
  if (m.trackTribe !== "") {
    f.text(k + 4, left + 7, row, w - 10, S_TRACK_OTHER, m.trackTribe.toUpperCase().slice(0, 16));
    row += 14;
  }
  const marked = m.trackNow - m.trackMarkedAt < FEED_MARKED_MS;
  f.text(k + 5, left + 7, row, w - 10, marked ? S_TRACK_OTHER : S_TRACK_NOTE, marked ? "MARKED" : t.player ? "LOCKED" : t.far > DRONE_LOOK ? "TOO FAR TO MARK" : "N  MARK");
}

export const TRACKS: HudWidget<TracksModel> = {
  name: "feed tracks",
  make: () => ({ tracks: [], trackCount: 0, trackLock: -1, trackHealth: -1, trackTribe: "", trackNow: 0, trackSignal: 1, trackMarkedAt: -Infinity }),
  fill(m, c) {
    const a = c.frame, s: ClientSession = c.session, feed = s.airFeed;
    m.trackCount = 0;
    m.trackLock = -1;
    if (!a || !feed.active) return;
    trackBodies(m, a.cam, a.world, a.reg, c.remote, handleIndex(s.ownHandle), s.driving, s.tribe.team, c.nowMs ?? 0);
    m.trackNow = c.nowMs ?? 0;
    m.trackSignal = feed.signal;
    m.trackMarkedAt = a.feed?.markedAt ?? -Infinity;
    const told = s.looked, lock = m.trackLock >= 0 ? m.tracks[m.trackLock]! : null;
    m.trackHealth = lock && told && told.id === lock.id ? told.health : -1;
    m.trackTribe = lock && told && told.id === lock.id ? told.tribe : "";
  },
};
