// What bug report mode asks of the page that only a browser has (client/notes/port.ts makes it): the canvas copied as it
// was just drawn, the heap, long tasks, the GPU's time, the GL calls, and the two requests to `__report`. Tests run
// without one.

/** A picture of the canvas, its bytes opaque to the core (a Blob in a browser), and its thumbnail if one was asked for. */
export interface Picture {
  readonly jpeg: unknown;
  readonly w: number;
  readonly h: number;
  readonly thumb: unknown | null;
}

/** An answer to a request: its status, 0 where nothing answered, and its text. */
export interface Answer {
  readonly status: number;
  readonly text: string;
}

export interface NotePort {
  /** The page's clock, in ms, to time what the mode costs. */
  now(): number;
  /**
   * Copies the canvas as it was just drawn, at most `wide` pixels across, and with `thumb` above 0 a thumbnail that
   * wide. It must be called straight after the draw, before the frame is shown. `ms` is what the call took on this
   * thread; the picture comes when it is encoded, off it where the browser can.
   */
  shot(wide: number, thumb: number): { ms: number; picture: Promise<Picture> };
  /** The page's script heap in use, in MB, or 0 where the browser does not say. */
  heap(): number;
  /** Long tasks the browser reported since the last call: how many in `out[0]` and their ms in `out[1]`. */
  longTasks(out: Float64Array): void;
  /** Times the GPU while `on`; the ms of the latest frame whose time came back since the last call, -1 for none. */
  gpu(on: boolean): number;
  /** GL calls the shell made for the latest frame. */
  glDraws(): number;
  /** The browser, the card and the textures' format. */
  page(): { browser: string; card: string; format: string };
  get(path: string): Promise<Answer>;
  /** One multipart POST: text fields, then pictures' bytes by field name, each as a JPEG. */
  post(path: string, fields: readonly (readonly [string, string])[], files: readonly (readonly [string, unknown])[]): Promise<Answer>;
}
