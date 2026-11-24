// The debug bar's pictures: when one is taken, and the last few minutes of them kept. One comes every `every` ms, and one
// a lag event asks for once `gap` ms have passed since the last; past `most` the oldest is freed. The port takes and
// frees them (port.ts); a test hands the ring a fake.

import type { DebugPort, Picture } from "./port.ts";

export interface ShotLimits {
  /** The regular picture's interval and the least gap before one asked for, in ms, and the pictures kept. */
  readonly every: number;
  readonly gap: number;
  readonly most: number;
  /** The most pixels across a picture has, and its JPEG quality. */
  readonly wide: number;
  readonly quality: number;
}

/** Ninety pictures, one every 2 s: three minutes. */
export const SHOT_LIMITS: ShotLimits = { every: 2000, gap: 1000, most: 90, wide: 640, quality: 0.8 };

/** Where the picture was taken from, as a capture keeps it beside the picture (shared/report.ts ReportShot). */
export interface ShotPose {
  place: [number, number, number];
  camera: [number, number, number];
  yaw: number;
  pitch: number;
  hour: number;
  frameMs: number;
  draws: number;
  triangles: number;
}

export interface Shot {
  /** When it was taken on the page's clock, in ms, and the number of the frame it shows. */
  at: number;
  frame: number;
  /** What asked for it, or "" for the regular one. */
  why: string;
  picture: Picture;
  /** Where it was taken from, where the bar said. */
  pose: ShotPose | null;
}

export class ShotRing {
  readonly limits: ShotLimits;
  /** Takes none while set, so a measurement is not disturbed. */
  paused = false;
  /** Pictures on their way, pictures that failed, and the bytes of those kept. */
  making = 0;
  failed = 0;
  bytes = 0;
  private readonly port: Pick<DebugPort, "shot" | "drop">;
  private readonly kept: Shot[] = [];
  /** When the last picture was taken, and what asked for the next, "" for nothing. */
  private last = -Infinity;
  private asked = "";
  /** Raised by `clear`: a picture that comes after it is freed, not kept. */
  private round = 0;

  constructor(port: Pick<DebugPort, "shot" | "drop">, limits: ShotLimits = SHOT_LIMITS) {
    this.port = port;
    this.limits = limits;
  }

  /** The pictures kept, oldest first. */
  get shots(): readonly Shot[] {
    return this.kept;
  }

  /** Asks for a picture once the gap allows. The first reason asked stands until a picture is taken. */
  ask(why: string): void {
    if (!this.paused && this.asked === "") this.asked = why || "asked";
  }

  /** Whether a picture is due at `now`, on the page's clock in ms. */
  due(now: number): boolean {
    if (this.paused) return false;
    const since = now - this.last;
    return since >= this.limits.every || (this.asked !== "" && since >= this.limits.gap);
  }

  /**
   * Takes a picture of frame `frame` at `now`, seen from `pose`: call it straight after the draw. Returns the ms it took on
   * this thread.
   */
  take(now: number, frame: number, pose: ShotPose | null = null): number {
    const why = this.asked, round = this.round;
    this.asked = "";
    this.last = now;
    const { ms, picture } = this.port.shot(this.limits.wide, this.limits.quality);
    this.making++;
    void picture.then(
      (p) => {
        this.making--;
        if (round === this.round) this.keep({ at: now, frame, why, picture: p, pose });
        else this.port.drop(p);
      },
      () => {
        this.making--;
        this.failed++;
      },
    );
    return ms;
  }

  /** The picture taken nearest `at`, or null where none is kept. */
  nearest(at: number): Shot | null {
    const k = this.kept;
    if (k.length === 0) return null;
    let lo = 0, hi = k.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (k[mid]!.at < at) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && at - k[lo - 1]!.at <= k[lo]!.at - at ? k[lo - 1]! : k[lo]!;
  }

  /** Frees every picture kept, and any still on its way when it comes. */
  clear(): void {
    for (const s of this.kept) this.port.drop(s.picture);
    this.kept.length = 0;
    this.bytes = 0;
    this.asked = "";
    this.last = -Infinity;
    this.round++;
  }

  /** Keeps a picture in the order taken, though it came out of order, and frees the oldest past `most`. */
  private keep(shot: Shot): void {
    const k = this.kept;
    let i = k.length;
    while (i > 0 && k[i - 1]!.at > shot.at) i--;
    k.splice(i, 0, shot);
    this.bytes += shot.picture.bytes;
    while (k.length > this.limits.most) {
      const old = k.shift()!;
      this.bytes -= old.picture.bytes;
      this.port.drop(old.picture);
    }
  }
}
