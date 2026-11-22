// What the performance record (notes/ring.ts) takes of each frame, read after it is drawn from what the page already
// keeps: the data utility's row of the frame and its display's interval (assets/frames.ts), the frame's packet, the
// scene's budget, the governor and the session's counters. It reads the app's private fields by name, as the inspectors do (D900), and makes nothing.

import type { App } from "../app.ts";
import type { FramePacket } from "../render/packet.ts";
import { TICK_RATE } from "./copies.ts";
import { C, FLAG_GPU, T, type PerfRing } from "./ring.ts";

/** What the shell and the note know of a frame that the app does not: the GPU's time (-1 for none), the GL calls, long tasks and a picture's cost. */
export interface FrameExtra {
  /** The app's frame (App.frame) and the scene's build within it, in ms. */
  build: number;
  scene: number;
  gpu: number;
  glDraws: number;
  longMs: number;
  longTasks: number;
  shotMs: number;
  flags: number;
  heap: number;
}

/** Bytes in a megabyte. */
const MB = 1048576;

export class FrameSampler {
  /** The session's running counters at the last frame, whose change each frame records. */
  private bytesIn = -1;
  private snapshots = 0;
  private corrections = 0;

  /** Fills `ring`'s sample for the frame just drawn as `p`, and records it. `ours` and `upload` are the shell's ms. */
  sample(ring: PerfRing, app: App, p: FramePacket, ours: number, upload: number, extra: FrameExtra): void {
    const s = ring.sample, f = app.frames, k = f ? f.row(0) : -1, session = app.session, stats = session.stats;
    s[C.interval] = app["interval"];
    s[C.own] = ours;
    s[C.upload] = upload;
    s[C.build] = extra.build;
    s[C.scene] = extra.scene;
    s[C.gpu] = extra.gpu;
    s[C.fetched] = k >= 0 ? f!.fetched[k]! : 0;
    s[C.cached] = k >= 0 ? f!.cached[k]! : 0;
    s[C.uploaded] = k >= 0 ? f!.uploaded[k]! : 0;
    s[C.requests] = k >= 0 ? f!.flying[k]! : 0;
    s[C.waiting] = k >= 0 ? f!.waiting[k]! : 0;
    s[C.cardMB] = k >= 0 ? f!.ledger[k]! / MB : 0;
    s[C.draws] = p.drawCount;
    s[C.triangles] = p.triangles;
    s[C.castTriangles] = p.castTriangles;
    s[C.castDraws] = p.castDraws;
    s[C.cascades] = p.cascadeCount;
    s[C.cascadesDrawn] = p.cascadesDrawn;
    s[C.tiles] = p.tileCount;
    s[C.streetTiles] = p.streetTiles;
    s[C.uploads] = p.assetUploads.length + p.texUploads.length;
    s[C.skipped] = p.skipped;
    s[C.dropped] = p.dropped;
    s[C.glDraws] = extra.glDraws;
    const scene = app.scene, budget = scene ? scene.budget : null;
    s[C.squeeze] = budget ? budget.squeeze : 0;
    s[C.crowns] = budget ? budget.last.crowns : 0;
    s[C.ambient] = budget ? budget.last.ambient : 0;
    s[C.level] = app.governor.level;
    s[C.share] = p.share;
    s[C.world0] = p.worldLevel[0]!;
    s[C.world1] = p.worldLevel[1]!;
    s[C.world2] = p.worldLevel[2]!;
    s[C.rttMs] = (stats.rttTicks * 1000) / TICK_RATE;
    s[C.margin] = stats.margin;
    s[C.bytesIn] = this.bytesIn < 0 ? 0 : stats.bytesIn - this.bytesIn;
    s[C.snapshots] = this.bytesIn < 0 ? 0 : stats.snapshots - this.snapshots;
    s[C.corrections] = this.bytesIn < 0 ? 0 : stats.corrections - this.corrections;
    this.bytesIn = stats.bytesIn;
    this.snapshots = stats.snapshots;
    this.corrections = stats.corrections;
    s[C.longMs] = extra.longMs;
    s[C.shotMs] = extra.shotMs;
    s[C.flags] = extra.flags | (extra.gpu >= 0 ? FLAG_GPU : 0);
    const own = session.own;
    ring.place[0] = own.x;
    ring.place[1] = own.y;
    ring.place[2] = own.z;
    ring.heap = extra.heap;
    ring.longTasks += extra.longTasks;
    if (f) ring.target = f.target.ms;
    const r = scene ? scene.assets.residency.stats : null, t = ring.totals;
    if (r) {
      t[T.requests] = r.requests;
      t[T.failed] = r.failed;
      t[T.evicted] = r.evicted;
    }
    if (scene) {
      t[T.cityMade]! += scene.city ? scene.city.stats.made : 0;
      t[T.blocksMade]! += scene.blocks ? scene.blocks.stats.made : 0;
      t[T.nearMade]! += scene.near ? scene.near.stats.made : 0;
    }
    ring.record(app["nowMs"]);
  }
}
