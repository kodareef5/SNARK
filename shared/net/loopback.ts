// In-memory transport with virtual time and seeded faults. A whole server and
// many clients run inside one test process with no sockets and no real clock.

import { Rng } from "../rng.ts";
import { CH_UNRELIABLE, type Connection, type Listener } from "./transport.ts";

export interface LinkOptions {
  /** One-way delay in milliseconds. */
  latencyMs?: number;
  /** Extra uniform random delay per message. On the unreliable channel this reorders. */
  jitterMs?: number;
  /** Probability of dropping an unreliable message, 0..1. */
  loss?: number;
}

interface Queued {
  at: number;
  seq: number;
  to: LoopbackEnd;
  channel: number;
  /** Null marks the peer closing: delivered in order after what it sent first. */
  data: Uint8Array | null;
}

export class LoopbackEnd implements Connection {
  onMessage: ((channel: number, data: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  open = true;
  peer!: LoopbackEnd;
  bytesSent = 0;
  packetsSent = 0;
  /** Latest scheduled reliable delivery, to keep that channel ordered. */
  lastReliableAt = 0;
  readonly link: Required<LinkOptions>;
  private readonly net: LoopbackNet;

  constructor(net: LoopbackNet, link: Required<LinkOptions>) {
    this.net = net;
    this.link = link;
  }

  send(channel: number, data: Uint8Array): void {
    if (!this.open) return;
    this.bytesSent += data.length;
    this.packetsSent++;
    this.net.enqueue(this, channel, data);
  }

  /** Close this end now. The peer sees everything sent before the close, then the close. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.net.enqueueClose(this);
    this.onClose?.();
  }
}

export class LoopbackNet implements Listener {
  onConnection: ((conn: Connection) => void) | null = null;
  now = 0;
  private readonly rng: Rng;
  private readonly heap: Queued[] = [];
  private seq = 0;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  /** Open a connection. Returns the client end; the listener receives the server end. */
  connect(opts: LinkOptions = {}): LoopbackEnd {
    const link = { latencyMs: opts.latencyMs ?? 0, jitterMs: opts.jitterMs ?? 0, loss: opts.loss ?? 0 };
    const client = new LoopbackEnd(this, link);
    const server = new LoopbackEnd(this, link);
    client.peer = server;
    server.peer = client;
    this.onConnection?.(server);
    return client;
  }

  enqueue(from: LoopbackEnd, channel: number, data: Uint8Array): void {
    const link = from.link;
    let at = this.now + link.latencyMs + (link.jitterMs > 0 ? this.rng.float() * link.jitterMs : 0);
    if (channel === CH_UNRELIABLE) {
      if (link.loss > 0 && this.rng.float() < link.loss) return;
    } else {
      if (at < from.lastReliableAt) at = from.lastReliableAt;
      from.lastReliableAt = at;
    }
    this.push({ at, seq: this.seq++, to: from.peer, channel, data: data.slice() });
  }

  enqueueClose(from: LoopbackEnd): void {
    let at = this.now + from.link.latencyMs;
    if (at < from.lastReliableAt) at = from.lastReliableAt;
    this.push({ at, seq: this.seq++, to: from.peer, channel: 1, data: null });
  }

  /** Move virtual time to `nowMs` and deliver everything due, in order. */
  advance(nowMs: number): void {
    const heap = this.heap;
    while (heap.length > 0 && heap[0]!.at <= nowMs) {
      const m = this.pop();
      if (m.at > this.now) this.now = m.at;
      if (!m.to.open) continue;
      if (m.data) m.to.onMessage?.(m.channel, m.data);
      else {
        m.to.open = false;
        m.to.onClose?.();
      }
    }
    this.now = nowMs;
  }

  get pending(): number {
    return this.heap.length;
  }

  private push(m: Queued): void {
    const h = this.heap;
    let i = h.length;
    h.push(m);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (before(h[p]!, m)) break;
      h[i] = h[p]!;
      i = p;
    }
    h[i] = m;
  }

  private pop(): Queued {
    const h = this.heap;
    const top = h[0]!;
    const last = h.pop()!;
    const n = h.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && before(h[c + 1]!, h[c]!)) c++;
        if (before(last, h[c]!)) break;
        h[i] = h[c]!;
        i = c;
      }
      h[i] = last;
    }
    return top;
  }
}

function before(a: Queued, b: Queued): boolean {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq);
}
