// The debug bar's port in a browser (client/core/debug/port.ts says what each part is for). The shell hands it the
// canvas, the renderer, the pass clock and the page's early log (client/shell/early-log.ts) when the bar is first on,
// and it is made once; none of it is in the script the first frame waits for. A picture is the canvas copied as a
// bitmap straight after the draw, while the drawing buffer still holds the frame, encoded as JPEG in a worker
// (shot-worker.ts), and kept as an object URL until the bar drops it.

import { LEVEL_ERROR, LEVEL_INFO } from "../../shared/debug.ts";
import type { Answer, DebugPort, LongFrame, PageLine, Picture } from "../core/debug/port.ts";
import { PASSES, type PassClock, type PassCpu, type QueryGl } from "../core/passes.ts";

/** What the port reads of the shell's renderer. */
export interface DebugRenderer {
  readonly gl: WebGL2RenderingContext;
  passes: PassClock | null;
  /** The page's time in each pass, which the renderer fills after each draw while it is set. */
  cpu?: PassCpu | null;
  readonly drawCalls: number;
  readonly errors: number;
  readonly rendererName: string;
  readonly format: string;
}

/** Lines and long animation frames kept between the bar's reads; past these the oldest go. */
const LINES_MOST = 300, FRAMES_MOST = 120;

interface Encoded { id: number; jpeg: Blob | null; why: string }

/** A long animation frame's entry, which TypeScript's DOM does not have yet. */
interface LongFrameEntry extends PerformanceEntry {
  readonly styleAndLayoutStart: number;
  readonly scripts: readonly { readonly duration: number; readonly sourceURL: string; readonly invoker: string }[];
}

export function debugPort(canvas: HTMLCanvasElement, renderer: DebugRenderer, Clock: new (gl: QueryGl, each: boolean) => PassClock, log: (to: (line: PageLine) => void) => void): DebugPort {
  const lines: PageLine[] = [];
  const keep = (line: PageLine): void => {
    if (lines.push(line) > LINES_MOST) lines.shift();
  };
  const say = (level: number, text: string): void => keep({ at: performance.now(), level, text });
  log(keep);
  canvas.addEventListener("webglcontextlost", () => say(LEVEL_ERROR, "the graphics context was lost"));
  canvas.addEventListener("webglcontextrestored", () => say(LEVEL_INFO, "the graphics context was given back"));
  let glErrors = 0;

  // Long tasks and long animation frames as the browser reports them, a little after each, where it does.
  const long = [0, 0];
  const frames: LongFrame[] = [];
  const observe = (type: string, heard: (e: PerformanceEntry) => void): void => {
    try {
      if (PerformanceObserver.supportedEntryTypes.includes(type)) new PerformanceObserver((list) => list.getEntries().forEach(heard)).observe({ type, buffered: false });
    } catch {}
  };
  observe("longtask", (t) => {
    long[0]!++;
    long[1]! += t.duration;
  });
  observe("long-animation-frame", (entry) => {
    const f = entry as LongFrameEntry;
    let script = 0, longest = 0, source = "";
    for (const s of f.scripts) {
      script += s.duration;
      if (s.duration <= longest) continue;
      longest = s.duration;
      source = s.sourceURL || s.invoker;
    }
    // Style and layout run from their start to the frame's end.
    const layout = f.styleAndLayoutStart > 0 ? Math.max(0, f.startTime + f.duration - f.styleAndLayoutStart) : 0;
    if (frames.push({ at: f.startTime, ms: f.duration, script, layout, source }) > FRAMES_MOST) frames.shift();
  });

  let worker: Worker | null = null, id = 0;
  const waiting = new Map<number, (e: Encoded) => void>();
  const encoder = (): Worker => {
    if (worker) return worker;
    const w = (worker = new Worker("shot-worker.js", { type: "module" }));
    w.onmessage = (e: MessageEvent<Encoded>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    // The pictures it had fail with it, and the next picture starts another.
    w.onerror = (e) => {
      const why = `the pictures' worker failed: ${e.message || "it did not load"}`;
      say(LEVEL_ERROR, why);
      for (const answer of waiting.values()) answer({ id: 0, jpeg: null, why });
      waiting.clear();
      w.terminate();
      worker = null;
    };
    return w;
  };

  let clock: PassClock | null = null, each = false;
  const about = { browser: navigator.userAgent, card: "", format: "", display: 0 };
  const answered = async (r: Promise<Response>): Promise<Answer> => {
    try {
      const res = await r;
      return { status: res.status, text: await res.text() };
    } catch (err) {
      return { status: 0, text: err instanceof Error ? err.message : String(err) };
    }
  };
  return {
    now: () => performance.now(),
    origin: performance.timeOrigin,
    shot(wide, quality) {
      const t0 = performance.now();
      const scale = Math.min(1, wide / canvas.width), w = Math.max(1, Math.round(canvas.width * scale)), h = Math.max(1, Math.round(canvas.height * scale));
      const n = ++id;
      // The bitmap is the canvas as it is now, made at the picture's size; the worker encodes it.
      const bitmap = scale < 1 ? createImageBitmap(canvas, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" }) : createImageBitmap(canvas);
      const picture = bitmap.then((b) => new Promise<Picture>((done, fail) => {
        const to = encoder();
        waiting.set(n, (e) => (e.jpeg ? done({ url: URL.createObjectURL(e.jpeg), blob: e.jpeg, w, h, bytes: e.jpeg.size }) : fail(new Error(e.why))));
        to.postMessage({ id: n, bitmap: b, w, h, quality }, [b]);
      }));
      return { ms: performance.now() - t0, picture };
    },
    drop: (picture) => URL.revokeObjectURL(picture.url),
    heap: () => ((performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576,
    // Called each frame while the bar is on, so it makes nothing.
    longTasks(out) {
      out[0] = long[0]!;
      out[1] = long[1]!;
      long[0] = long[1] = 0;
    },
    longFrames(out) {
      for (const f of frames) out.push(f);
      frames.length = 0;
    },
    gpu(mode, out) {
      // Off, or timed otherwise than asked: the clock goes. A bench page's clock is its own.
      if (clock && (mode === 0 || each !== (mode === 2))) {
        if (renderer.passes === clock) renderer.passes = null;
        clock = null;
      }
      if (mode > 0 && !clock && !renderer.passes) {
        each = mode === 2;
        renderer.passes = clock = new Clock(renderer.gl, each);
      }
      const times = clock ? clock.take() : null;
      if (!times || times.length === 0) return false;
      const last = times[times.length - 1]!;
      out.fill(0);
      for (let i = 0; i < last.length && i < out.length; i++) out[i] = last[i]!;
      return true;
    },
    passCpu(on) {
      if (!on) return (renderer.cpu = null);
      return (renderer.cpu ??= { start: new Float64Array(PASSES.length).fill(NaN), ms: new Float64Array(PASSES.length), began: 0, ended: 0 });
    },
    glDraws: () => renderer.drawCalls,
    glErrors: () => renderer.errors,
    // One record, brought up to date: it is asked for every frame while the bar is on.
    page() {
      about.card = renderer.rendererName;
      about.format = renderer.format;
      about.display = (screen.width * 16384 + screen.height) * 64 + Math.round(devicePixelRatio * 8);
      return about;
    },
    lines(out) {
      const met = renderer.errors - glErrors;
      if (met > 0) say(LEVEL_ERROR, `GL errors: ${met} more, ${renderer.errors} in all`);
      glErrors = renderer.errors;
      for (const line of lines) out.push(line);
      lines.length = 0;
    },
    get: (path) => answered(fetch(path, { cache: "no-store" })),
    post(path, fields, files) {
      const form = new FormData();
      for (const [k, v] of fields) form.append(k, v);
      for (const [k, v] of files) {
        if (v instanceof Blob) form.append(k, v, v.type === "image/jpeg" ? `${k}.jpg` : k);
        else form.append(k, String(v));
      }
      return answered(fetch(path, { method: "POST", body: form }));
    },
  };
}
