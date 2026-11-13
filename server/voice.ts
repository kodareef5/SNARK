// The voice relay.
//
// Every word spoken goes through here, so that no player learns another's
// address. A client opens a second socket for voice and proves which session
// it belongs to with a token that session was sent on the game socket. From
// then on it sends Opus frames; the server never decodes one. It checks each
// packet's shape, decides who is to hear it, and puts it in a batch for each
// of them, sent when it is full and at the end of the turn it arrived in.
//
// A packet says nothing of who is speaking or where they are: the server
// knows both from the session, and what a client claims is not asked for.
//
// This file has no sockets of its own: the process gives it something to
// send on (server/main.ts), and tests give it one they can read.

import { TICK_RATE } from "../shared/coords.ts";
import { AUTH_BYTES, Batch, FLAG_LOOP, TOKEN_BYTES, VOICE_AUDIO, VOICE_AUTH, audio, parseAudio, seqNewer } from "../shared/voice/packet.ts";
import type { Client, GameServer } from "./game.ts";

/** Packets a speaker may send in a second, and at once after a pause: 50 a second is what talking takes. */
const RATE = 60;
const BURST = 15;
/** Packets that are not what a client sends, after which the socket is closed. */
const MAX_STRIKES = 8;
/** Ticks a socket has to say whose it is. */
const AUTH_TICKS = 5 * TICK_RATE;

export interface VoiceSocket {
  /** Send one packet now. False if the listener is too far behind to take it: it is dropped, not queued. */
  send(data: Uint8Array): boolean;
  close(): void;
}

export class VoicePeer {
  /** The session this socket speaks and hears for; null until it has said, and proved, which. */
  client: Client | null = null;
  readonly batch = new Batch();
  /** The sequence number of the last packet taken from it; -1 before the first. */
  lastSeq = -1;
  /** Packets it may still send at once, and the time (milliseconds) that was true at. */
  allowance = BURST;
  allowanceAt = 0;
  strikes = 0;
  /** The tick it connected on, and the last tick it spoke on. */
  since = 0;
  heardAt = 0;
  /** It has frames waiting to be sent at the end of this turn. */
  waiting = false;
  closed = false;
  readonly sock: VoiceSocket;

  constructor(sock: VoiceSocket) {
    this.sock = sock;
  }
}

export interface VoiceContext {
  readonly game: GameServer;
}

export class Voice {
  /** Packets taken, frames put in a listener's batch, packets refused for their shape, their rate or their order, and batches a slow listener could not take. */
  readonly stats = { packets: 0, relayed: 0, malformed: 0, limited: 0, stale: 0, dropped: 0 };
  readonly peers = new Set<VoicePeer>();
  /** The peer of each session, by its slot. */
  private readonly bySlot: (VoicePeer | null)[] = [];
  private readonly tokens = new Map<Client, Uint8Array>();
  private readonly waiting: VoicePeer[] = [];
  private readonly ctx: VoiceContext;
  private readonly random: (out: Uint8Array) => void;

  /** `random` fills a buffer with bytes nobody can guess. */
  constructor(ctx: VoiceContext, random: (out: Uint8Array) => void) {
    this.ctx = ctx;
    this.random = random;
  }

  /** The token that lets a socket speak for session `c`: made the first time it is asked for. */
  token(c: Client): Uint8Array {
    let t = this.tokens.get(c);
    if (!t) {
      t = new Uint8Array(TOKEN_BYTES);
      this.random(t);
      this.tokens.set(c, t);
    }
    return t;
  }

  /** A session's connection ended: its token is no good any more, and its voice socket is closed. */
  revoke(c: Client): void {
    this.tokens.delete(c);
    const peer = this.bySlot[c.id];
    if (peer && peer.client === c) this.close(peer);
  }

  /** The peer speaking for a session, or null. */
  peerOf(c: Client): VoicePeer | null {
    const peer = this.bySlot[c.id];
    return peer && peer.client === c ? peer : null;
  }

  /** A socket was opened. It has yet to say whose it is. */
  connect(sock: VoiceSocket): VoicePeer {
    const peer = new VoicePeer(sock);
    peer.since = this.ctx.game.world.tick;
    this.peers.add(peer);
    return peer;
  }

  /** The socket went away. */
  disconnect(peer: VoicePeer): void {
    if (peer.closed) return;
    peer.closed = true;
    this.peers.delete(peer);
    if (peer.client && this.bySlot[peer.client.id] === peer) this.bySlot[peer.client.id] = null;
  }

  private close(peer: VoicePeer): void {
    if (peer.closed) return;
    this.disconnect(peer);
    peer.sock.close();
  }

  /** A packet arrived on a socket at `now` (milliseconds on any steady clock). `data` is not kept. */
  receive(peer: VoicePeer, data: Uint8Array, now: number): void {
    if (peer.closed) return;
    if (!peer.client) {
      // The first thing a socket says is whose it is. Anything else, or a wrong answer, ends it.
      if (!this.auth(peer, data)) this.close(peer);
      return;
    }
    if (data[0] !== VOICE_AUDIO || !parseAudio(data)) {
      this.stats.malformed++;
      if (++peer.strikes >= MAX_STRIKES) this.close(peer);
      return;
    }
    // No faster than speech needs. A burst after a stall is let through; more than that is dropped, not punished.
    const earned = ((now - peer.allowanceAt) * RATE) / 1000;
    peer.allowance = Math.min(BURST, peer.allowance + (earned > 0 ? earned : 0));
    peer.allowanceAt = now;
    if (peer.allowance < 1) {
      this.stats.limited++;
      return;
    }
    peer.allowance -= 1;
    // In order: a packet that is not newer than the last one taken has nothing to add.
    if (peer.lastSeq >= 0 && !seqNewer(audio.seq, peer.lastSeq)) {
      this.stats.stale++;
      return;
    }
    peer.lastSeq = audio.seq;
    peer.heardAt = this.ctx.game.world.tick;
    this.stats.packets++;
    const c = peer.client;
    if (c.closed || !c.active) return;
    // Back to the speaker, if it asked to hear itself: the way to test a microphone, and the whole of the path.
    if ((audio.flags & FLAG_LOOP) !== 0) this.give(peer, c.id, audio.flags & ~FLAG_LOOP, audio.seq, audio.time, audio.opus);
  }

  private auth(peer: VoicePeer, data: Uint8Array): boolean {
    if (data.length !== AUTH_BYTES || data[0] !== VOICE_AUTH) return false;
    const slot = data[1]! | (data[2]! << 8);
    const c = this.ctx.game.clients[slot];
    const token = c ? this.tokens.get(c) : undefined;
    if (!c || !token || !c.active || c.closed) return false;
    // Every byte is compared, so that how long it takes says nothing of where they differ.
    let diff = 0;
    for (let i = 0; i < TOKEN_BYTES; i++) diff |= token[i]! ^ data[3 + i]!;
    if (diff !== 0) return false;
    // One voice socket to a session: a new one takes the place of the old.
    const old = this.bySlot[slot];
    if (old && old !== peer) this.close(old);
    this.bySlot[slot] = peer;
    peer.client = c;
    return true;
  }

  /** Put one frame in a listener's batch, sending what is there first if it would not fit. */
  private give(to: VoicePeer, speaker: number, flags: number, seq: number, time: number, opus: Uint8Array): void {
    if (!to.batch.fits(opus.length)) this.send(to);
    to.batch.add(speaker, flags, seq, time, opus);
    this.stats.relayed++;
    if (!to.waiting) {
      to.waiting = true;
      this.waiting.push(to);
    }
  }

  private send(to: VoicePeer): void {
    if (to.batch.count > 0 && !to.closed && !to.sock.send(to.batch.packet())) this.stats.dropped++;
    to.batch.reset();
  }

  /** Whether any listener has frames waiting: the process calls `flush` once at the end of each turn in which that is so. */
  get pending(): boolean {
    return this.waiting.length > 0;
  }

  /** Send every batch that has something in it. */
  flush(): void {
    for (const peer of this.waiting) {
      peer.waiting = false;
      this.send(peer);
    }
    this.waiting.length = 0;
  }

  /** Once a tick: a socket that has not said whose it is in time is closed. */
  step(tick: number): void {
    for (const peer of this.peers) if (!peer.client && tick - peer.since > AUTH_TICKS) this.close(peer);
  }
}
