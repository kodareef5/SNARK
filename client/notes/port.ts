// Bug report mode's port in a browser (client/core/notes/port.ts says what each part is for). The shell hands it the
// canvas and the renderer once the mode is first turned on; none of it is in the script the first frame waits for.
// A picture is the canvas copied as a bitmap straight after the draw, while the drawing buffer still holds the frame,
// and encoded as JPEG in a worker (shot-worker.ts), off the game's thread.

import type { Answer, NotePort, Picture } from "../core/notes/port.ts";
import type { PassClock, QueryGl } from "../core/passes.ts";

/** What the port reads of the shell's renderer. */
export interface NoteRenderer {
  readonly gl: WebGL2RenderingContext;
  passes: PassClock | null;
  readonly drawCalls: number;
  readonly rendererName: string;
  readonly format: string;
}

/** JPEG quality: a city's edges stay crisp at this, and a 2,560-wide picture is about 0.5 MB. */
const QUALITY = 0.85;

interface Encoded { id: number; jpeg: Blob | null; thumb: Blob | null; why: string }

export function notePort(canvas: HTMLCanvasElement, renderer: NoteRenderer, Clock: new (gl: QueryGl, each: boolean) => PassClock): NotePort {
  let worker: Worker | null = null, id = 0;
  const waiting = new Map<number, (e: Encoded) => void>();
  const encoder = (): Worker => {
    if (worker) return worker;
    worker = new Worker("shot-worker.js", { type: "module" });
    worker.onmessage = (e: MessageEvent<Encoded>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    return worker;
  };
  // Long tasks as the browser reports them, a little after each.
  const long = [0, 0];
  try {
    new PerformanceObserver((list) => {
      for (const t of list.getEntries()) {
        long[0]!++;
        long[1]! += t.duration;
      }
    }).observe({ type: "longtask", buffered: false });
  } catch {}
  let clock: PassClock | null = null;
  const json = async (r: Promise<Response>): Promise<Answer> => {
    try {
      const res = await r;
      return { status: res.status, text: await res.text() };
    } catch (err) {
      return { status: 0, text: err instanceof Error ? err.message : String(err) };
    }
  };
  return {
    now: () => performance.now(),
    shot(wide, thumb) {
      const t0 = performance.now();
      const scale = Math.min(1, wide / canvas.width), w = Math.round(canvas.width * scale), h = Math.round(canvas.height * scale);
      const n = ++id;
      // The bitmap is the canvas as it is now; the worker scales and encodes it.
      const bitmap = createImageBitmap(canvas);
      const picture = bitmap.then((b) => new Promise<Picture>((done, fail) => {
        waiting.set(n, (e) => (e.jpeg ? done({ jpeg: e.jpeg, w, h, thumb: e.thumb }) : fail(new Error(e.why))));
        encoder().postMessage({ id: n, bitmap: b, w, h, thumb: thumb > 0 ? [thumb, Math.round((h * thumb) / w)] : null, quality: QUALITY }, [b]);
      }));
      return { ms: performance.now() - t0, picture };
    },
    heap: () => ((performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576,
    // Called each frame while the mode is on, so it makes nothing.
    longTasks(out) {
      out[0] = long[0]!;
      out[1] = long[1]!;
      long[0] = long[1] = 0;
    },
    gpu(on) {
      // A bench page's clock is its own.
      if (on && !clock && !renderer.passes) renderer.passes = clock = new Clock(renderer.gl, false);
      if (!on && clock) {
        if (renderer.passes === clock) renderer.passes = null;
        clock = null;
      }
      const times = clock ? clock.take() : null;
      return times && times.length > 0 ? times[times.length - 1]![0]! : -1;
    },
    glDraws: () => renderer.drawCalls,
    page: () => ({ browser: navigator.userAgent, card: renderer.rendererName, format: renderer.format }),
    get: (path) => json(fetch(path, { cache: "no-store" })),
    post(path, fields, files) {
      const form = new FormData();
      for (const [k, v] of fields) form.append(k, v);
      for (const [k, v] of files) form.append(k, v as Blob, `${k}.jpg`);
      return json(fetch(path, { method: "POST", body: form }));
    },
  };
}
