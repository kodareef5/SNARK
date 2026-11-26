// The person stage (client/entry/person-stage.ts) in a page's iframe, reached only by messages: each command posted
// with a number and its answer awaited. The page's body keeps counts a driver reads: stageSent, stageTaken, stageNotes.

import { isStageReply, stageMessage, type StageAnswer, type StageCommand } from "../../shared/people/stage.ts";

type Answered = Exclude<StageAnswer, { kind: "ready" } | { kind: "error" }>;

export class StageLink {
  ready = false;
  private next = 0;
  private sent = 0;
  private taken = 0;
  private notes = 0;
  private readonly waiting = new Map<number, (a: Answered) => void>();
  private readonly body = document.body.dataset;
  private readonly frame: HTMLIFrameElement;

  constructor(frame: HTMLIFrameElement, onReady: () => void, onError: (detail: string) => void, onNotes: (notes: readonly string[]) => void = () => {}) {
    this.frame = frame;
    this.body.stage = "loading";
    addEventListener("message", (e) => {
      if (e.source !== frame.contentWindow || e.origin !== location.origin || !isStageReply(e.data)) return;
      const a = e.data;
      if (a.kind === "ready") {
        this.ready = true;
        this.body.stage = "ready";
        return onReady();
      }
      if (a.kind === "error") {
        this.body.stage = "error";
        return onError(a.detail);
      }
      this.taken++;
      this.body.stageTaken = String(this.taken);
      if (a.kind === "applied" && a.notes.length > 0) {
        this.notes += a.notes.length;
        this.body.stageNotes = String(this.notes);
        onNotes(a.notes);
      }
      const done = a.id === undefined ? undefined : this.waiting.get(a.id);
      if (a.id !== undefined) this.waiting.delete(a.id);
      done?.(a);
    });
  }

  /** Posts a command, answered when the stage has taken it (a picture: once it is drawn). */
  send(c: StageCommand): Promise<Answered> {
    const id = ++this.next;
    this.sent++;
    this.body.stageSent = String(this.sent);
    return new Promise((ok) => {
      this.waiting.set(id, ok);
      this.frame.contentWindow?.postMessage(stageMessage({ ...c, id }), location.origin);
    });
  }

  /** A picture of the person as the stage holds it now, `width` x `height`. */
  async picture(width: number, height: number): Promise<Blob> {
    const a = await this.send({ kind: "picture", width, height });
    if (a.kind !== "picture") throw new Error("The stage answered a picture with something else.");
    return a.png as Blob;
  }
}

/** Calls the people store's routes, its status and JSON, 0 where the call broke off. */
export async function call(path: string, init: RequestInit = {}): Promise<{ status: number; answer: Record<string, unknown> }> {
  try {
    const r = await fetch(path, { cache: "no-store", ...init });
    return { status: r.status, answer: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { status: 0, answer: {} };
  }
}

export const postJson = (path: string, sent: unknown): ReturnType<typeof call> => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
