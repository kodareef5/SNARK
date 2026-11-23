// A stand-in for the debug bar's browser port (client/core/debug/port.ts): pictures that are a JPEG's head at the size
// asked, lines queued by the test, and requests answered by a function the test gives, such as a report store's.

import type { Answer, DebugPort, LongFrame, PageLine, Picture } from "../../client/core/debug/port.ts";
import * as P from "../../shared/net/protocol.ts";
import { codeNames } from "../../shared/debug.ts";
import { jpegHead } from "./jpeg.ts";

export interface FakePort extends DebugPort {
  /** Pictures asked for and freed; lines the page will hand the bar next; what was posted. */
  readonly taken: Picture[];
  readonly dropped: Picture[];
  readonly queued: PageLine[];
  readonly posted: { path: string; fields: Map<string, string>; files: number }[];
}

/** The canvas the fake draws on, in device pixels. */
export const FAKE_CANVAS = [1280, 720] as const;

/** A port whose `post` goes to `answer`, a Request in and a Response out; without one every post is refused. */
export function fakePort(answer: ((req: Request) => Promise<Response>) | null = null): FakePort {
  const taken: Picture[] = [], dropped: Picture[] = [], queued: PageLine[] = [], posted: FakePort["posted"] = [];
  const reply = async (r: Promise<Response>): Promise<Answer> => {
    const res = await r;
    return { status: res.status, text: await res.text() };
  };
  return {
    taken, dropped, queued, posted,
    now: () => performance.now(),
    origin: Date.now() - performance.now(),
    shot(wide) {
      const w = Math.min(wide, FAKE_CANVAS[0]), h = Math.round((w * FAKE_CANVAS[1]) / FAKE_CANVAS[0]), bytes = jpegHead(w, h);
      const picture: Picture = { url: `blob:fake/${taken.length}`, blob: new Blob([bytes], { type: "image/jpeg" }), w, h, bytes: bytes.length };
      taken.push(picture);
      return { ms: 0.1, picture: Promise.resolve(picture) };
    },
    drop: (p) => void dropped.push(p),
    heap: () => 120,
    longTasks(out) {
      out[0] = out[1] = 0;
    },
    longFrames(_out: LongFrame[]) {},
    gpu: () => false,
    passCpu: () => null,
    glDraws: () => 0,
    glErrors: () => 0,
    page: () => ({ browser: "test", card: "a test card", format: "rgba", display: 1 }),
    lines(out) {
      out.push(...queued);
      queued.length = 0;
    },
    get: async (path) => (path === "__debug" ? { status: 200, text: JSON.stringify({ names: codeNames(P) }) } : { status: 404, text: "" }),
    async post(path, fields, files) {
      posted.push({ path, fields: new Map(fields.map(([k, v]) => [k, v])), files: files.length });
      if (!answer) return { status: 404, text: "this port posts nowhere" };
      const form = new FormData();
      for (const [k, v] of fields) form.append(k, v);
      for (const [k, v] of files) form.append(k, v as Blob, `${k}.jpg`);
      const sent = new Response(form), type = sent.headers.get("content-type")!, body = await sent.arrayBuffer();
      return reply(answer(new Request(`http://localhost/${path}`, { method: "POST", body, headers: { "content-type": type, "content-length": String(body.byteLength) } })));
    },
  };
}
