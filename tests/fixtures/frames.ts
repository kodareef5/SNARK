// Frame traces for the governor (client/core/governor.ts): a clock that hands it frames as a browser would, with the
// frame's time a function of the time and the level drawn, and what it did minute by minute.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { DeviceReport, SoakReport } from "../../client/core/device.ts";
import { Governor, TARGET_MS } from "../../client/core/governor.ts";
import { Rng } from "../../shared/rng.ts";

/** What a frame at `t` ms takes at `level`: its GPU ms, our code's ms, uploads, and its work. */
export interface Frame {
  gpu: number;
  ours?: number;
  busy?: boolean;
  /** What it asked of the card, as the app counts it (governor.ts workMs): 10 unless said. */
  work?: number;
  /** The part of the work crowns near took that they could still give: none unless said. */
  crowns?: number;
  /** A gap before this frame, in ms: a hidden page or a stall. */
  gap?: number;
  /** The display's interval, which a frame is never shorter than: 16.7 ms unless said. */
  display?: number;
}

export interface Minute {
  minute: number;
  /** Median ms between frames, the level at the minute's end and the most it reached in it. */
  median: number;
  level: number;
  most: number;
}

/**
 * Runs `minutes` of frames through a governor on `tier` at `dpr`. A frame's interval is its GPU time rounded up to the
 * display's interval where `quantized`, as a display that shows only whole intervals gives them, else the larger of the
 * two; with a little jitter.
 */
export function run(minutes: number, at: (t: number, level: number) => Frame, o: { tier?: string; dpr?: number; quantized?: boolean; seed?: number; governor?: Governor } = {}): { minutes: Minute[]; governor: Governor } {
  const g = o.governor ?? new Governor();
  const tier = tierOf(o.tier ?? "high");
  const dpr = o.dpr ?? 3;
  const rng = new Rng(o.seed ?? 1);
  const out: Minute[] = [];
  let now = 0;
  let list: number[] = [];
  let most = 0;
  g.tier(tier, true, dpr, now);
  while (now < minutes * 60000) {
    const f = at(now, g.level);
    const display = f.display ?? TARGET_MS;
    const busy = Math.max(f.gpu, f.ours ?? 1);
    let interval = o.quantized ? Math.ceil(busy / display - 1e-6) * display : Math.max(display, busy);
    interval *= 1 + (rng.float() - 0.5) * 0.04;
    interval += f.gap ?? 0;
    now += interval;
    g.tier(tier, true, dpr, now);
    g.frame(now, interval, f.ours ?? 1, f.busy ?? false, f.work ?? 10, f.crowns ?? 0);
    if (f.gap === undefined) list.push(interval);
    most = Math.max(most, g.level);
    if (now >= (out.length + 1) * 60000) {
      list.sort((a, b) => a - b);
      out.push({ minute: out.length + 1, median: Math.round(list[list.length >> 1]! * 10) / 10, level: g.level, most });
      [list, most] = [[], g.level];
    }
  }
  return { minutes: out, governor: g };
}

/**
 * The iPhone's soaks on lit tiers that ran their minutes, from the kept reports (planning/reference/device-reports, D349):
 * what each turned through and each minute's median frame, a minute that held the display's rate read as just inside it.
 */
export function phoneSoaks(): { name: string; tier: string; load: SoakReport["load"]; wood: boolean; points: number[] }[] {
  const dir = join(import.meta.dir, "../../planning/reference/device-reports");
  return readdirSync(dir).flatMap((file) => {
    const r = JSON.parse(readFileSync(join(dir, file), "utf8")) as DeviceReport;
    if (!r.soak || !r.done || r.soak.minutes.length < r.soak.minutesWanted || !r.soak.cascades) return [];
    const l = r.soak.load;
    return [{ name: `${file.slice(0, 19)}, ${r.soak.wood ? "the wood" : `${l.bodies} bodies, ${l.pieces} pieces, ${l.near} rocks near`}`, tier: r.soak.tier, load: l, wood: r.soak.wood === true, points: r.soak.minutes.map((m) => (m.frameMs.median <= 17 ? TARGET_MS * 0.99 : m.frameMs.median)) }];
  });
}

/** A curve through `points`, one a minute from minute 1, held at its ends. */
export function curve(points: readonly number[]): (t: number) => number {
  return (t) => {
    const m = t / 60000 - 0.5;
    if (m <= 0) return points[0]!;
    const i = Math.min(Math.floor(m), points.length - 1);
    const j = Math.min(i + 1, points.length - 1);
    return points[i]! + (points[j]! - points[i]!) * Math.min(1, m - i);
  };
}
