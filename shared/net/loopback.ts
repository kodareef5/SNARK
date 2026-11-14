// In-memory transport with virtual time and seeded faults. A whole server and
// many clients run inside one test process with no sockets and no real clock.
//
// A link carries datagrams unless it is `tcp`. Datagrams on the unreliable channel are lost one by one and never wait
// for one another. A tcp link is one stream for both channels, as a WebSocket is: nothing is lost, and a lost segment
// holds back itself and everything behind it until it is sent again. The stream follows TCP with selective
// acknowledgements: a segment is sent again once `dupAcks` later segments are acknowledged, or when the retransmission
// timeout (RFC 6298, at least `minRtoMs`, doubled for each loss of the same segment) runs out. Not modelled: the
// congestion window, delayed acknowledgements, tail loss probes and RACK's earlier detection, and Nagle (sockets set
// TCP_NODELAY), so each message leaves at once in segments of its own.

import { Rng } from "../rng.ts";
import { CH_UNRELIABLE, type Connection, type Listener } from "./transport.ts";

export interface LinkOptions {
  /** One-way. */
  latencyMs?: number;
  /** Extra uniform random delay per message. On the unreliable channel of a datagram link this reorders. A stream keeps its order. */
  jitterMs?: number;
  /** Probability of losing a packet, 0..1. A datagram link loses unreliable messages. A stream loses segments and sends them again. */
  loss?: number;
  /** Mean length of a run of losses. Above 1 losses come in bursts, from a Gilbert-Elliott chain, at the same mean rate. */
  burst?: number;
  /** One TCP stream carries both channels. */
  tcp?: boolean;
  /** Each way, at the narrowest hop, headers included. 0 for no limit. */
  bytesPerSecond?: number;
  /** Bytes the sending kernel holds, those not yet acknowledged included. What does not fit waits in `buffered`. */
  sendBuffer?: number;
  dupAcks?: number;
  minRtoMs?: number;
}

/** Payload of one segment, and the TCP and IP headers each carries on the wire. */
const MSS = 1448;
const HEADERS = 52;
const TCP_DEFAULTS = { bytesPerSecond: 0, sendBuffer: 32 * 1024, dupAcks: 3, minRtoMs: 200 };
/** Before the first round trip is measured. */
const INITIAL_RTO = 1000;

/** Losses on one direction of a path. Independent, or in bursts: a chain that loses everything while it is in its bad state. */
export class LossChain {
  private bad = false;
  /** The chance of entering and of leaving the bad state per packet. */
  private readonly enter: number;
  private readonly leave: number;

  constructor(
    private readonly rng: Rng,
    private readonly loss: number,
    burst: number,
  ) {
    this.leave = burst > 1 ? 1 / burst : 1;
    this.enter = burst > 1 && loss < 1 ? (loss * this.leave) / (1 - loss) : 0;
  }

  lost(): boolean {
    if (this.leave === 1) return this.loss > 0 && this.rng.float() < this.loss;
    this.bad = this.bad ? this.rng.float() >= this.leave : this.rng.float() < this.enter;
    return this.bad;
  }
}

/** One TCP segment. The one that ends a message carries it. A close is a last segment of no bytes. */
interface Segment {
  id: number;
  bytes: number;
  channel: number;
  data: Uint8Array | null;
  ends: boolean;
  close: boolean;
  /** Transmissions so far, the order of the latest among all of this direction's, and when it left. */
  sends: number;
  tx: number;
  sentAt: number;
  /** The latest transmission was lost, and how many later ones the sender has since heard arrived. */
  lost: boolean;
  above: number;
  arrived: boolean;
}

const DELIVER = 0;
const ARRIVE = 1;
const ACK = 2;
const TIMEOUT = 3;

interface Queued {
  at: number;
  seq: number;
  to: LoopbackEnd;
  channel: number;
  /** Null marks the peer closing. It is delivered in order after what the peer sent first. */
  data: Uint8Array | null;
  kind: number;
  seg: Segment | null;
  /** For ACK, the receiver's next undelivered segment when it sent it. For TIMEOUT, the transmission it times. */
  n: number;
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
  /** A stream's sender may refuse a message before it is queued, as a server's socket wrapper does. False skips it. */
  gate: ((channel: number) => boolean) | null = null;
  readonly link: Required<LinkOptions>;
  /** Losses of what this end sends. */
  chain: LossChain;
  /** Until then everything this end sends is lost. */
  downUntil = 0;
  // A stream's sending side: what waits for room in the kernel, what the kernel holds, the wire, and the timer.
  private readonly waiting: Segment[] = [];
  private waitingBytes = 0;
  private readonly flight: Segment[] = [];
  private flightBytes = 0;
  private readonly holes: Segment[] = [];
  private nextId = 0;
  private txCount = 0;
  private wireFree = 0;
  private lastArrive = 0;
  private srtt = 0;
  private rttvar = 0;
  private rto = INITIAL_RTO;
  /** A stream's receiving side: the next of the peer's segments to hand over. */
  private readNext = 0;
  private readonly net: LoopbackNet;

  constructor(net: LoopbackNet, link: Required<LinkOptions>, chain: LossChain) {
    this.net = net;
    this.link = link;
    this.chain = chain;
  }

  /** Bytes sent that the kernel has not taken yet, as WebSocket.getBufferedAmount reads them. Always 0 on a datagram link. */
  get buffered(): number {
    return this.waitingBytes;
  }

  send(channel: number, data: Uint8Array): void {
    if (!this.open) return;
    if (this.gate && !this.gate(channel)) return;
    this.bytesSent += data.length;
    this.packetsSent++;
    if (this.link.tcp) this.queue(channel, data.slice(), false);
    else this.net.enqueue(this, channel, data);
  }

  /** The peer sees everything sent before the close, then the close. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    if (this.link.tcp) this.queue(1, null, true);
    else this.net.enqueueClose(this);
    this.onClose?.();
  }

  /** A WebSocket frame: the channel byte, a header of 2 or 4 bytes, and a mask from a client. */
  private queue(channel: number, data: Uint8Array | null, close: boolean): void {
    let left = close ? 0 : data!.length + 1 + (data!.length < 125 ? 2 : 4) + (this.net.isClient(this) ? 4 : 0);
    do {
      const bytes = left > MSS ? MSS : left;
      left -= bytes;
      const ends = left === 0;
      this.waiting.push({ id: this.nextId++, bytes, channel, data: ends ? data : null, ends, close: ends && close, sends: 0, tx: 0, sentAt: 0, lost: false, above: 0, arrived: false });
      this.waitingBytes += bytes;
    } while (left > 0);
    this.admit();
  }

  private admit(): void {
    const room = this.link.sendBuffer;
    while (this.waiting.length > 0 && (this.flightBytes === 0 || this.flightBytes + this.waiting[0]!.bytes <= room)) {
      const s = this.waiting.shift()!;
      this.waitingBytes -= s.bytes;
      this.flight.push(s);
      this.flightBytes += s.bytes;
      this.transmit(s);
    }
  }

  private transmit(s: Segment): void {
    const net = this.net;
    const link = this.link;
    const now = net.now;
    s.sends++;
    s.tx = ++this.txCount;
    s.sentAt = now;
    let depart = now > this.wireFree ? now : this.wireFree;
    if (link.bytesPerSecond > 0) depart += ((s.bytes + HEADERS) * 1000) / link.bytesPerSecond;
    this.wireFree = depart;
    s.lost = s.bytes > 0 && (now < this.downUntil || this.chain.lost());
    if (s.lost) {
      s.above = 0;
      this.holes.push(s);
      net.schedule(now + this.rto * (1 << (s.sends - 1)), this, TIMEOUT, s, s.tx);
      return;
    }
    let at = depart + link.latencyMs + (link.jitterMs > 0 ? net.random() * link.jitterMs : 0);
    if (at < this.lastArrive) at = this.lastArrive;
    this.lastArrive = at;
    net.schedule(at, this.peer, ARRIVE, s, 0);
  }

  /** At the receiver: hand over what is now in order, and acknowledge. */
  arrive(s: Segment): void {
    if (s.arrived) return;
    s.arrived = true;
    const from = this.peer;
    for (let i = this.readNext - from.firstId(); i < from.flight.length; i++) {
      const next = from.flight[i]!;
      if (!next.arrived) break;
      this.readNext++;
      if (!next.ends || !this.open) continue;
      if (next.close) {
        this.open = false;
        this.onClose?.();
      } else this.onMessage?.(next.channel, next.data!);
    }
    this.net.schedule(this.net.now + this.link.latencyMs, from, ACK, s, this.readNext);
  }

  /** At the sender: the receiver has `s`, and everything before `next`. */
  ack(s: Segment, next: number): void {
    const now = this.net.now;
    if (s.sends === 1) {
      const sample = now - s.sentAt;
      if (this.srtt === 0) {
        this.srtt = sample;
        this.rttvar = sample / 2;
      } else {
        this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - sample);
        this.srtt = 0.875 * this.srtt + 0.125 * sample;
      }
      this.rto = Math.max(this.link.minRtoMs, this.srtt + 4 * this.rttvar);
    }
    const holes = this.holes;
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i]!;
      if (h.tx > s.tx || ++h.above < this.link.dupAcks) continue;
      holes.splice(i--, 1);
      this.transmit(h);
    }
    const flight = this.flight;
    while (flight.length > 0 && flight[0]!.id < next) this.flightBytes -= flight.shift()!.bytes;
    this.admit();
  }

  timeout(s: Segment, tx: number): void {
    if (s.tx !== tx || s.arrived) return;
    const i = this.holes.indexOf(s);
    if (i >= 0) this.holes.splice(i, 1);
    this.transmit(s);
  }

  private firstId(): number {
    return this.flight.length > 0 ? this.flight[0]!.id : this.nextId;
  }
}

export class LoopbackNet implements Listener {
  onConnection: ((conn: Connection) => void) | null = null;
  now = 0;
  private readonly rng: Rng;
  private readonly heap: Queued[] = [];
  private seq = 0;
  private readonly clients = new WeakSet<LoopbackEnd>();

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  /**
   * Returns the client end. The listener receives the server end. With `share`, another connection's client end, both
   * run over one path: the losses of each direction come from one chain, so a burst hits both.
   */
  connect(opts: LinkOptions = {}, share?: LoopbackEnd): LoopbackEnd {
    const link: Required<LinkOptions> = { latencyMs: 0, jitterMs: 0, loss: 0, burst: 1, tcp: false, ...TCP_DEFAULTS, ...defined(opts) };
    const client = new LoopbackEnd(this, link, share?.chain ?? new LossChain(this.rng, link.loss, link.burst));
    const server = new LoopbackEnd(this, link, share?.peer.chain ?? new LossChain(this.rng, link.loss, link.burst));
    client.peer = server;
    server.peer = client;
    this.clients.add(client);
    this.onConnection?.(server);
    return client;
  }

  /** Everything either end sends for the next `ms` is lost, as when a radio link drops out. */
  outage(end: LoopbackEnd, ms: number): void {
    end.downUntil = end.peer.downUntil = this.now + ms;
  }

  isClient(end: LoopbackEnd): boolean {
    return this.clients.has(end);
  }

  random(): number {
    return this.rng.float();
  }

  enqueue(from: LoopbackEnd, channel: number, data: Uint8Array): void {
    const link = from.link;
    let at = this.now + link.latencyMs + (link.jitterMs > 0 ? this.rng.float() * link.jitterMs : 0);
    if (channel === CH_UNRELIABLE) {
      if (from.chain.lost()) return;
    } else {
      if (at < from.lastReliableAt) at = from.lastReliableAt;
      from.lastReliableAt = at;
    }
    this.push({ at, seq: this.seq++, to: from.peer, channel, data: data.slice(), kind: DELIVER, seg: null, n: 0 });
  }

  enqueueClose(from: LoopbackEnd): void {
    let at = this.now + from.link.latencyMs;
    if (at < from.lastReliableAt) at = from.lastReliableAt;
    this.push({ at, seq: this.seq++, to: from.peer, channel: 1, data: null, kind: DELIVER, seg: null, n: 0 });
  }

  schedule(at: number, to: LoopbackEnd, kind: number, seg: Segment, n: number): void {
    this.push({ at, seq: this.seq++, to, channel: 0, data: null, kind, seg, n });
  }

  /** Delivers everything due by `nowMs`, in order. */
  advance(nowMs: number): void {
    const heap = this.heap;
    while (heap.length > 0 && heap[0]!.at <= nowMs) {
      const m = this.pop();
      if (m.at > this.now) this.now = m.at;
      if (m.kind === ARRIVE) m.to.arrive(m.seg!);
      else if (m.kind === ACK) m.to.ack(m.seg!, m.n);
      else if (m.kind === TIMEOUT) m.to.timeout(m.seg!, m.n);
      else if (!m.to.open) continue;
      else if (m.data) m.to.onMessage?.(m.channel, m.data);
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

/** The options given, so that one given as undefined keeps its default. */
function defined(opts: LinkOptions): LinkOptions {
  return Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
}
