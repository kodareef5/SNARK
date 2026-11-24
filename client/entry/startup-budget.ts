const MIB = 1024 * 1024;

export interface ConnectionHint {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  addEventListener?(event: "change", changed: () => void): void;
}

export const connectionHint = (): ConnectionHint | undefined => (navigator as Navigator & { connection?: ConnectionHint }).connection;

export function constrainedConnection(hint?: ConnectionHint): boolean {
  return !!hint && (!!hint.saveData || ["slow-2g", "2g", "3g"].includes(hint.effectiveType ?? "") ||
    (hint.downlink !== undefined && hint.downlink < 1.5) || (hint.rtt ?? 0) >= 400);
}

export function startupBudget(hint?: ConnectionHint): number {
  return constrainedConnection(hint) ? 0 : (hint?.downlink ?? 0) >= 4 ? 4 * MIB : 3 * MIB;
}

export function survivorPreview(hint: ConnectionHint | undefined, hidden: boolean, requested: boolean): boolean {
  return !hidden && (requested || !constrainedConnection(hint));
}

interface FileJob {
  url: string;
  rank: number;
  wireLimit: number;
  decodedLimit: number;
  keep?: boolean;
}

interface Warmed {
  bytes: number;
  data: Uint8Array<ArrayBuffer> | null;
}

type Listener = (result: Warmed | null) => void;

interface Work {
  file: FileJob;
  stop: AbortController;
  listeners: Set<Listener>;
  active: boolean;
}

type StartupFetch = (url: string, init: RequestInit & { priority: "low" }) => Promise<Response>;

/** A whole immutable response is reusable across pages. Ranges stay with the asset worker. */
async function warm(fetchFile: StartupFetch, file: FileJob, limit: number, signal: AbortSignal): Promise<Warmed | null> {
  const reply = await fetchFile(file.url, { signal, priority: "low", redirect: "error" });
  const length = Number(reply.headers.get("content-length"));
  if (reply.status !== 200 || length > limit || !reply.body) {
    await reply.body?.cancel();
    return null;
  }
  const reader = reply.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const decoded = length > 0 ? file.decodedLimit : Math.min(file.decodedLimit, limit);
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.length;
    if (read > decoded) {
      await reader.cancel();
      return null;
    }
    if (file.keep) chunks.push(value);
  }
  const data = file.keep ? new Uint8Array(read) : null;
  if (data) for (let offset = 0, i = 0; i < chunks.length; i++) {
    data.set(chunks[i]!, offset);
    offset += chunks[i]!.length;
  }
  return { bytes: length > 0 ? length : read, data };
}

/** Work for one selected world. The last listener to leave cancels the transfer. */
export class StartupQueue {
  private readonly work = new Map<string, Work>();
  private readonly kept = new Map<string, Warmed>();
  private readonly fetchFile: StartupFetch;
  private readonly lanes: number;
  private available: number;
  private active = 0;
  private queued = false;
  private closed = false;

  constructor(fetchFile: StartupFetch, bytes: number, lanes = 2) {
    this.fetchFile = fetchFile;
    this.available = bytes;
    this.lanes = lanes;
  }

  ask(file: FileJob, signal: AbortSignal): Promise<Warmed | null> {
    if (signal.aborted || this.closed) return Promise.resolve(null);
    const cached = this.kept.get(file.url);
    if (cached) return Promise.resolve(cached);
    let job = this.work.get(file.url);
    if (!job) {
      job = { file, stop: new AbortController(), listeners: new Set(), active: false };
      this.work.set(file.url, job);
    }
    const work = job;
    this.schedule();
    return new Promise((resolve) => {
      const done: Listener = (result) => {
        work.listeners.delete(done);
        signal.removeEventListener("abort", cancel);
        resolve(result);
      };
      const cancel = () => {
        done(null);
        if (work.listeners.size === 0) {
          this.work.delete(file.url);
          work.stop.abort();
          this.schedule();
        }
      };
      work.listeners.add(done);
      signal.addEventListener("abort", cancel, { once: true });
    });
  }

  close(): void {
    this.closed = true;
    for (const job of this.work.values()) {
      job.stop.abort();
      for (const listener of job.listeners) listener(null);
    }
    this.work.clear();
    this.kept.clear();
  }

  private schedule(): void {
    if (this.queued || this.closed) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      if (this.closed) return;
      const pending = [...this.work.values()].filter((job) => !job.active).sort((a, b) => b.file.rank - a.file.rank);
      for (const job of pending) {
        if (this.active >= this.lanes) break;
        const limit = Math.min(job.file.wireLimit, this.available);
        if (limit < job.file.wireLimit && this.active > 0) break;
        if (limit > 0) void this.run(job, limit);
        else this.finish(job, null);
      }
    });
  }

  private async run(job: Work, limit: number): Promise<void> {
    job.active = true;
    this.active++;
    this.available -= limit;
    const signal = AbortSignal.any([job.stop.signal, AbortSignal.timeout(8000)]);
    const result = await warm(this.fetchFile, job.file, limit, signal).catch(() => null);
    this.active--;
    if (result) this.available += limit - result.bytes;
    this.finish(job, result);
    this.schedule();
  }

  private finish(job: Work, result: Warmed | null): void {
    const { url } = job.file;
    if (this.work.get(url) !== job) return;
    this.work.delete(url);
    if (result) this.kept.set(url, result);
    for (const listener of job.listeners) listener(result);
  }
}
