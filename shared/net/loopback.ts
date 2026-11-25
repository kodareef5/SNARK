// In-memory transport with virtual time and seeded faults. A whole server and
// many clients run inside one test process with no sockets and no real clock.
//
// A link carries datagrams unless it is `tcp`. Datagrams on the unreliable channel are lost one by one and never wait
// for one another, and the reliable channel is ordered and lossless. A `tcp` link is one stream for both channels, as a
// WebSocket is: nothing is lost, and a lost segment holds back itself and everything behind it until it is sent again.
// The stream follows Linux's TCP; "Transport" in planning/architecture/networking.md says how and what it leaves out.

import { Rng } from "../rng.ts";
import { CH_UNRELIABLE, type Connection, type Listener } from "./transport.ts";

export interface LinkOptions {
  /** One-way. */
  latencyMs?: number;
  /** Extra uniform random delay per packet. Datagrams on the unreliable channel may pass one another; a stream's packets keep their order. */
  jitterMs?: number;
  /** The share of packets lost, 0..1. A datagram link loses unreliable messages; a stream loses segments and sends them again. */
  loss?: number;
  /** Losses in spells that last this long on average, every packet of a spell lost (Gilbert-Elliott). 0 loses packets one by one. */
  burstMs?: number;
  /** One TCP stream carries both channels. */
  tcp?: boolean;
  /** A stream's bytes a second each way, headers included, and how long a queue the narrowest hop keeps before it drops (four packets at least). 0 for no limit. */
  bytesPerSecond?: number;
  queueMs?: number;
  /** What a stream's sending kernel holds: all its bytes until they are acknowledged, and at most `notSent` of them not yet sent. The rest waits in `buffered`. */
  sendBuffer?: number;
  notSent?: number;
}

/** Payload of a full segment, and the IP and TCP headers every packet carries, timestamps included. */
const MSS = 1448;
const HEADERS = 52;
const INITIAL_WINDOW = 10;
/** Before a round trip is measured. Then the smoothed round trip plus four deviations, and never less than it plus MIN_RTO. */
const INITIAL_RTO = 1000;
const MIN_RTO = 200;
const MAX_RTO = 120000;
/** A lost segment with this many sent after it acknowledged is resent at once. With fewer, a quarter of the least round trip later. */
const DUP_THRESH = 3;
/** The window after a loss, of the window before (CUBIC). */
const BETA = 0.7;

/** Losses on one direction of a path: one by one, or in spells from a two-state chain over time. Connections on one path share one. */
export class LossChain {
  private bad = false;
  private at = 0;
  private readonly rng: Rng;
  private readonly loss: number;
  private readonly burstMs: number;
  /** Per millisecond, the rate of leaving the bad state plus that of entering it. */
  private readonly rate: number;

  constructor(rng: Rng, loss: number, burstMs: number) {
    this.rng = rng;
    this.loss = loss;
    this.burstMs = loss < 1 ? burstMs : 0;
    this.rate = this.burstMs > 0 ? 1 / (this.burstMs * (1 - loss)) : 0;
  }

  lost(now: number): boolean {
    if (this.loss <= 0) return false;
    if (this.burstMs <= 0) return this.rng.float() < this.loss;
    const keep = Math.exp(-this.rate * (now - this.at));
    this.at = now;
    const p = this.bad ? this.loss + (1 - this.loss) * keep : this.loss * (1 - keep);
    return (this.bad = this.rng.float() < p);
  }
}

/** One segment: a range of the stream's bytes, and its latest transmission. */
interface Segment {
  id: number;
  start: number;
  end: number;
  /** Its number in this stream, when it left, and whether the path lost it. */
  tx: number;
  sentAt: number;
  sends: number;
  lost: boolean;
  /** Counted in the window. The window was full when it was sent. */
  inPipe: boolean;
  full: boolean;
  /** Segments sent after this one that the sender has heard arrived. */
  above: number;
  arrived: boolean;
  acked: boolean;
}

/** A message ends at a byte of the stream. A close is a last message of one byte (FIN) and no data. */
interface Message {
  end: number;
  channel: number;
  data: Uint8Array | null;
}

const DELIVER = 0;
const ARRIVE = 1;
const ACK = 2;
const TIMEOUT = 3;
const REORDER = 4;
const FLUSH = 5;

/**
 * One direction of a tcp link: the sender's kernel and window, the path, and where the receiver has read to. Segments are
 * cut when they are sent, so what waits for room in the window goes out in full segments, and what is written in one
 * moment leaves together (Linux's autocorking).
 */
class Stream {
  /** Bytes the program has written that the kernel has not taken: WebSocket.getBufferedAmount. */
  buffered = 0;
  wireBytes = 0;
  resent = 0;
  timeouts = 0;
  // Offsets in the stream: written by the program, taken by the kernel, sent at least once, and acknowledged in order.
  private written = 0;
  private kernelEnd = 0;
  private sentEnd = 0;
  private acked = 0;
  private readonly msgs: Message[] = [];
  private msgHead = 0;
  /** Segments from the oldest not acknowledged in order. */
  private segs: Segment[] = [];
  private head = 0;
  private base = 0;
  private nextId = 0;
  /** Transmissions the path lost that the sender has not noticed, and those it has, waiting for room in the window. */
  private readonly missing: Segment[] = [];
  private readonly resend: Segment[] = [];
  private pipe = 0;
  private cwnd = INITIAL_WINDOW;
  private ssthresh = Infinity;
  private grow = 0;
  /** The last segment sent when the window was cut, or -1 outside recovery. After a timeout the window starts again from one. */
  private recover = -1;
  private restart = false;
  private srtt = 0;
  private rttvar = 0;
  private minRtt = Infinity;
  private rto = INITIAL_RTO;
  private backoff = 0;
  /** When the timer runs out, 0 for not running, and the event queued for it: when, and a number that a later one replaces. */
  private rtoAt = 0;
  private timerAt = Infinity;
  private timer = 0;
  private reorderAt = Infinity;
  private flushing = false;
  /** The newest transmission heard to have arrived: its number, and its round trip. */
  private rackTx = 0;
  private rackRtt = 0;
  private txCount = 0;
  private wireFree = 0;
  private lastArrive = 0;
  /** The receiver's next segment to read, and the bytes it holds in order. */
  private readId = 0;
  private readEnd = 0;
  private readonly net: LoopbackNet;
  private readonly from: LoopbackEnd;
  private readonly to: LoopbackEnd;
  private readonly link: Required<LinkOptions>;

  constructor(net: LoopbackNet, from: LoopbackEnd, to: LoopbackEnd) {
    this.net = net;
    this.from = from;
    this.to = to;
    this.link = from.link;
  }

  /** `bytes` is the message as framed on the wire. */
  write(channel: number, data: Uint8Array | null, bytes: number): void {
    this.written += bytes;
    this.buffered += bytes;
    this.msgs.push({ end: this.written, channel, data });
    this.admit();
    if (!this.flushing) {
      this.flushing = true;
      this.net.schedule(this.net.now, FLUSH, this, null, 0);
    }
  }

  flush(): void {
    this.flushing = false;
    this.pump();
  }

  /** At the receiver: hand over what is now in order, and acknowledge. */
  arrive(s: Segment): void {
    s.arrived = true;
    while (this.readId < this.nextId) {
      const n = this.seg(this.readId);
      if (!n.arrived) break;
      this.readId++;
      this.readEnd = n.end;
    }
    const to = this.to;
    const msgs = this.msgs;
    while (this.msgHead < msgs.length && msgs[this.msgHead]!.end <= this.readEnd) {
      const m = msgs[this.msgHead++]!;
      if (!to.open) continue;
      if (m.data) to.onMessage?.(m.channel, m.data);
      else {
        to.open = false;
        to.onClose?.();
      }
    }
    if (this.msgHead > 1024 && this.msgHead * 2 > msgs.length) {
      msgs.splice(0, this.msgHead);
      this.msgHead = 0;
    }
    this.net.schedule(this.net.now + this.link.latencyMs, ACK, this, s, this.readId);
  }

  /** At the sender: `s` arrived, and so did every segment before `next`. */
  ack(s: Segment, next: number): void {
    const now = this.net.now;
    if (!s.acked) {
      s.acked = true;
      if (s.inPipe) {
        s.inPipe = false;
        this.pipe--;
      }
      if (s.sends === 1) this.measure(now - s.sentAt);
      if (s.full && (this.recover < 0 || this.restart)) {
        if (this.cwnd < this.ssthresh) this.cwnd++;
        else if (++this.grow >= this.cwnd) {
          this.grow = 0;
          this.cwnd++;
        }
      }
      if (s.tx > this.rackTx) {
        this.rackTx = s.tx;
        this.rackRtt = now - s.sentAt;
      }
      for (const h of this.missing) if (h.tx < s.tx) h.above++;
    }
    if (next > this.base) {
      while (this.base < next) {
        const h = this.segs[this.head++]!;
        this.base++;
        this.acked = h.end;
        if (h.inPipe) {
          h.inPipe = false;
          this.pipe--;
        }
      }
      if (this.head > 1024 && this.head * 2 > this.segs.length) {
        this.segs = this.segs.slice(this.head);
        this.head = 0;
      }
      if (this.recover >= 0 && this.base > this.recover) {
        this.recover = -1;
        this.restart = false;
      }
      if (this.base < this.nextId) this.arm(now);
      else this.rtoAt = 0;
    }
    this.detect(now);
    this.admit();
    this.pump();
  }

  /** The retransmission timer ran out. */
  timeout(timer: number): void {
    if (timer !== this.timer) return;
    this.timerAt = Infinity;
    const now = this.net.now;
    if (this.rtoAt === 0) return;
    if (now < this.rtoAt) return this.queueTimer();
    this.rtoAt = 0;
    if (this.base >= this.nextId) return;
    this.timeouts++;
    this.backoff++;
    this.ssthresh = Math.max(2, Math.floor(this.cwnd * BETA));
    this.cwnd = 1;
    this.grow = 0;
    this.recover = this.nextId - 1;
    this.restart = true;
    // Everything out is taken for lost and the window starts again. What did arrive is not sent again here.
    for (let id = this.base; id < this.nextId; id++) this.seg(id).inPipe = false;
    this.pipe = 0;
    for (const h of this.missing) this.queueResend(h);
    this.missing.length = 0;
    this.arm(now);
    this.pump();
  }

  /** A loss waiting out its reordering allowance may be due. */
  reorder(): void {
    this.reorderAt = Infinity;
    this.detect(this.net.now);
    this.pump();
  }

  private seg(id: number): Segment {
    return this.segs[this.head + id - this.base]!;
  }

  private measure(rtt: number): void {
    if (this.srtt === 0) {
      this.srtt = rtt;
      this.rttvar = rtt / 2;
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - rtt);
      this.srtt = 0.875 * this.srtt + 0.125 * rtt;
    }
    if (rtt < this.minRtt) this.minRtt = rtt;
    this.rto = Math.min(MAX_RTO, this.srtt + Math.max(MIN_RTO, 4 * this.rttvar));
    this.backoff = 0;
  }

  /** The kernel takes what fits. */
  private admit(): void {
    const room = Math.min(this.link.sendBuffer - (this.kernelEnd - this.acked), this.link.notSent - (this.kernelEnd - this.sentEnd));
    const take = Math.min(this.written - this.kernelEnd, room);
    if (take <= 0) return;
    this.kernelEnd += take;
    this.buffered -= take;
  }

  /** Sends what the window has room for, losses first. */
  private pump(): void {
    while (this.pipe < this.cwnd) {
      if (this.resend.length > 0) {
        this.resent++;
        this.transmit(this.resend.shift()!);
      } else if (this.sentEnd < this.kernelEnd) {
        const end = Math.min(this.sentEnd + MSS, this.kernelEnd);
        const s: Segment = { id: this.nextId++, start: this.sentEnd, end, tx: 0, sentAt: 0, sends: 0, lost: false, inPipe: false, full: false, above: 0, arrived: false, acked: false };
        this.segs.push(s);
        this.sentEnd = end;
        this.transmit(s);
      } else break;
    }
    this.admit();
  }

  private transmit(s: Segment): void {
    const net = this.net;
    const link = this.link;
    const now = net.now;
    const bytes = s.end - s.start + HEADERS;
    s.sends++;
    s.tx = ++this.txCount;
    s.sentAt = now;
    s.above = 0;
    s.inPipe = true;
    this.pipe++;
    // Linux grows the window only while it limits: in slow start once half of it is used, after that once all of it is.
    s.full = this.pipe >= (this.cwnd < this.ssthresh ? this.cwnd / 2 : this.cwnd);
    this.wireBytes += bytes;
    if (this.rtoAt === 0 || (s.sends > 1 && s.id === this.base)) this.arm(now);
    let depart = now;
    let full = false;
    if (link.bytesPerSecond > 0) {
      const start = now > this.wireFree ? now : this.wireFree;
      full = (start - now) * link.bytesPerSecond > Math.max(link.queueMs * link.bytesPerSecond, 4000 * (MSS + HEADERS));
      if (!full) depart = this.wireFree = start + (bytes * 1000) / link.bytesPerSecond;
    }
    s.lost = full || now < this.from.downUntil || this.from.chain.lost(now);
    if (s.lost) {
      this.missing.push(s);
      return;
    }
    let at = depart + link.latencyMs + (link.jitterMs > 0 ? net.random() * link.jitterMs : 0);
    if (at < this.lastArrive) at = this.lastArrive;
    this.lastArrive = at;
    net.schedule(at, ARRIVE, this, s, 0);
  }

  /**
   * RACK (RFC 8985): a transmission is lost once one sent after it has arrived and its round trip has passed, with a
   * quarter of the least round trip to allow for reordering. That allowance is waived in recovery, or once DUP_THRESH
   * later segments have arrived.
   */
  private detect(now: number): void {
    const missing = this.missing;
    let next = Infinity;
    for (let i = 0; i < missing.length; i++) {
      const h = missing[i]!;
      if (h.tx > this.rackTx) continue;
      const due = h.sentAt + this.rackRtt + (this.recover >= 0 || h.above >= DUP_THRESH ? 0 : this.minRtt / 4);
      if (now < due) {
        if (due < next) next = due;
        continue;
      }
      missing.splice(i--, 1);
      if (h.inPipe) {
        h.inPipe = false;
        this.pipe--;
      }
      if (this.recover < 0) {
        this.ssthresh = Math.max(2, Math.floor(this.cwnd * BETA));
        this.cwnd = this.ssthresh;
        this.grow = 0;
        this.recover = this.nextId - 1;
      }
      this.queueResend(h);
    }
    if (next < this.reorderAt) {
      this.reorderAt = next;
      this.net.schedule(next, REORDER, this, null, 0);
    }
  }

  private queueResend(s: Segment): void {
    const r = this.resend;
    let i = r.length;
    while (i > 0 && r[i - 1]!.id > s.id) i--;
    r.splice(i, 0, s);
  }

  /** Starts the timer again from now, backed off by the timeouts in a row. */
  private arm(now: number): void {
    this.rtoAt = now + Math.min(MAX_RTO, this.rto * 2 ** this.backoff);
    if (this.rtoAt < this.timerAt) this.queueTimer();
  }

  private queueTimer(): void {
    this.timerAt = this.rtoAt;
    this.net.schedule(this.rtoAt, TIMEOUT, this, null, ++this.timer);
  }
}

export class LoopbackEnd implements Connection {
  onMessage: ((channel: number, data: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  open = true;
  peer!: LoopbackEnd;
  /** Messages and their bytes as given to `send`, before framing. */
  bytesSent = 0;
  packetsSent = 0;
  /** Latest scheduled reliable delivery on a datagram link, to keep that channel ordered. */
  lastReliableAt = 0;
  /** Asked before each message is sent with what waits in `buffered`, as a server's socket wrapper asks. False skips the message. */
  gate: ((channel: number, buffered: number) => boolean) | null = null;
  /** Until then everything this end sends is lost. */
  downUntil = 0;
  readonly link: Required<LinkOptions>;
  readonly chain: LossChain;
  /** A browser masks what it sends, four bytes a frame. */
  readonly client: boolean;
  /** What this end sends, on a tcp link. */
  out: Stream | null = null;
  private readonly net: LoopbackNet;

  constructor(net: LoopbackNet, link: Required<LinkOptions>, chain: LossChain, client: boolean) {
    this.net = net;
    this.link = link;
    this.chain = chain;
    this.client = client;
  }

  /** Bytes sent that the kernel has not taken yet. Always 0 on a datagram link. */
  get buffered(): number {
    return this.out ? this.out.buffered : 0;
  }

  /** On a tcp link: bytes on the wire, headers and resent segments included, segments resent, and retransmission timeouts. */
  get wire(): { bytes: number; resent: number; timeouts: number } {
    const s = this.out;
    return { bytes: s?.wireBytes ?? 0, resent: s?.resent ?? 0, timeouts: s?.timeouts ?? 0 };
  }

  admit(channel: number): boolean {
    return this.open && (!this.gate || this.gate(channel, this.buffered));
  }

  send(channel: number, data: Uint8Array): void {
    if (!this.admit(channel)) return;
    this.bytesSent += data.length;
    this.packetsSent++;
    // A WebSocket frame: the channel byte, a header of 2 or 4 bytes, and a browser's mask.
    if (this.out) this.out.write(channel, data.slice(), data.length + 1 + (data.length < 125 ? 2 : 4) + (this.client ? 4 : 0));
    else this.net.enqueue(this, channel, data);
  }

  /** The peer sees everything sent before the close, then the close. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    if (this.out) this.out.write(1, null, 1);
    else this.net.enqueueClose(this);
    this.onClose?.();
  }
}

interface Queued {
  at: number;
  seq: number;
  kind: number;
  to: LoopbackEnd | null;
  channel: number;
  /** Null marks the peer closing. It is delivered in order after what the peer sent first. */
  data: Uint8Array | null;
  stream: Stream | null;
  seg: Segment | null;
  next: number;
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

  /**
   * Returns the client end. The listener receives the server end. With `share`, the client end of another connection, both
   * cross one path, so each direction's losses come from one chain: a spell of losses hits both.
   */
  connect(opts: LinkOptions = {}, share?: LoopbackEnd): LoopbackEnd {
    const link: Required<LinkOptions> = { latencyMs: 0, jitterMs: 0, loss: 0, burstMs: 0, tcp: false, bytesPerSecond: 0, queueMs: 100, sendBuffer: 32 * 1024, notSent: Infinity };
    for (const [k, v] of Object.entries(opts)) if (v !== undefined) (link as Record<string, unknown>)[k] = v;
    const client = new LoopbackEnd(this, link, share?.chain ?? new LossChain(this.rng, link.loss, link.burstMs), true);
    const server = new LoopbackEnd(this, link, share?.peer.chain ?? new LossChain(this.rng, link.loss, link.burstMs), false);
    client.peer = server;
    server.peer = client;
    if (link.tcp) {
      client.out = new Stream(this, client, server);
      server.out = new Stream(this, server, client);
    }
    this.onConnection?.(server);
    return client;
  }

  /** Everything either end of the connection sends for the next `ms` is lost, as when a radio link drops out. */
  outage(end: LoopbackEnd, ms: number): void {
    end.downUntil = end.peer.downUntil = this.now + ms;
  }

  random(): number {
    return this.rng.float();
  }

  enqueue(from: LoopbackEnd, channel: number, data: Uint8Array): void {
    const link = from.link;
    let at = this.now + link.latencyMs + (link.jitterMs > 0 ? this.rng.float() * link.jitterMs : 0);
    if (channel === CH_UNRELIABLE) {
      if (this.now < from.downUntil || from.chain.lost(this.now)) return;
    } else {
      if (at < from.lastReliableAt) at = from.lastReliableAt;
      from.lastReliableAt = at;
    }
    this.push({ at, seq: this.seq++, kind: DELIVER, to: from.peer, channel, data: data.slice(), stream: null, seg: null, next: 0 });
  }

  enqueueClose(from: LoopbackEnd): void {
    let at = this.now + from.link.latencyMs;
    if (at < from.lastReliableAt) at = from.lastReliableAt;
    this.push({ at, seq: this.seq++, kind: DELIVER, to: from.peer, channel: 1, data: null, stream: null, seg: null, next: 0 });
  }

  schedule(at: number, kind: number, stream: Stream, seg: Segment | null, next: number): void {
    this.push({ at, seq: this.seq++, kind, to: null, channel: 0, data: null, stream, seg, next });
  }

  /** Delivers everything due by `nowMs`, in order. */
  advance(nowMs: number): void {
    const heap = this.heap;
    while (heap.length > 0 && heap[0]!.at <= nowMs) {
      const m = this.pop();
      if (m.at > this.now) this.now = m.at;
      if (m.kind === ARRIVE) m.stream!.arrive(m.seg!);
      else if (m.kind === ACK) m.stream!.ack(m.seg!, m.next);
      else if (m.kind === TIMEOUT) m.stream!.timeout(m.next);
      else if (m.kind === REORDER) m.stream!.reorder();
      else if (m.kind === FLUSH) m.stream!.flush();
      else if (!m.to!.open) continue;
      else if (m.data) m.to!.onMessage?.(m.channel, m.data);
      else {
        m.to!.open = false;
        m.to!.onClose?.();
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
