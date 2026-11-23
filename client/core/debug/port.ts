// What the debug bar asks of the page that only a browser has. client/debug/port.ts makes it; tests use a fake.

import type { PassCpu } from "../passes.ts";

/** An answer to a request: its status, 0 where nothing answered, and its text. */
export interface Answer {
  readonly status: number;
  readonly text: string;
}

/** A picture of the canvas, once encoded: a URL the interface can show, its bytes (a Blob in a browser) and size. */
export interface Picture {
  readonly url: string;
  readonly blob: unknown;
  readonly w: number;
  readonly h: number;
  readonly bytes: number;
}

/** A line the page logged or an error it met: when on the page's clock, its LEVEL_ (shared/debug.ts), and its text. */
export interface PageLine {
  at: number;
  level: number;
  text: string;
}

/** One of the browser's long animation frames, where it reports them: when, how long, and its script and layout ms. */
export interface LongFrame {
  at: number;
  ms: number;
  script: number;
  layout: number;
  /** The script that took longest, as the browser names it, or "". */
  source: string;
}

/** The browser, the card, the textures' format, and the display as a number that changes when the page changes screen. */
export interface PageFacts {
  browser: string;
  card: string;
  format: string;
  display: number;
}

export interface DebugPort {
  /** The page's clock, in ms. */
  now(): number;
  /** The wall clock at the page clock's 0, ms since 1970. */
  readonly origin: number;
  /**
   * Copies the canvas as it was just drawn, at most `wide` pixels across, as a JPEG of `quality`. Call it straight after
   * the draw. `ms` is what the call took on this thread; the picture comes once a worker has encoded it.
   */
  shot(wide: number, quality: number): { ms: number; picture: Promise<Picture> };
  /** Frees a picture the bar no longer keeps. */
  drop(picture: Picture): void;
  /** The script heap in use, in MB, or 0 where the browser does not say. */
  heap(): number;
  /** Long tasks since the last call: the count in `out[0]`, their ms in `out[1]`. */
  longTasks(out: Float64Array): void;
  /** Moves the long animation frames reported since the last call into `out`. */
  longFrames(out: LongFrame[]): void;
  /**
   * Times the GPU: `mode` 0 not, 1 the whole frame, 2 each pass (passes.ts PASSES). Fills `out` with the latest frame's
   * times that came back since the last call, and returns whether one came.
   */
  gpu(mode: number, out: Float64Array): boolean;
  /** Turns the renderer's own timing of each pass on or off, and returns what it fills after each draw. */
  passCpu(on: boolean): PassCpu | null;
  /** GL calls of the latest frame, and GL errors the renderer has met since it began. */
  glDraws(): number;
  glErrors(): number;
  page(): PageFacts;
  /** Moves the lines the page logged and the errors it met since the last call into `out`, oldest first. */
  lines(out: PageLine[]): void;
  get(path: string): Promise<Answer>;
  /** One multipart POST: text fields, then files by field name. */
  post(path: string, fields: readonly (readonly [string, string])[], files: readonly (readonly [string, unknown])[]): Promise<Answer>;
}
