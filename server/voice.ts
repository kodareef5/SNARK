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
// Who hears whom is worked out here, over sessions, a few times a second: a
// voice carries as far as it is meant (a whisper, talk, a yell), a listener is
// sent the nearest few speakers and no more, and nobody is sent a speaker
// they have muted. Only a living survivor's voice has a place to carry from.
//
// This file has no sockets of its own: the process gives it something to
// send on (server/main.ts), and tests give it one they can read.

import { TICK_RATE } from "../shared/coords.ts";
import { SESSION_ALIVE } from "../shared/net/protocol.ts";
import { AUTH_BYTES, Batch, FLAG_LOOP, KEEP_RANGE, MAX_HEARD, MAX_INTRO_NAME, MODE_TALK, TOKEN_BYTES, VOICE_AUDIO, VOICE_AUTH, VOICE_RANGE, audio, modeOf, parseAudio, seqNewer, writeIntro } from "../shared/voice/packet.ts";
import type { Client, GameServer } from "./game.ts";

/** Packets a speaker may send in a second, and at once after a pause: 50 a second is what talking takes. */
const RATE = 60;
const BURST = 15;
/** Packets that are not what a client sends, after which the socket is closed. */
const MAX_STRIKES = 8;
/** Ticks a socket has to say whose it is. */
const AUTH_TICKS = 5 * TICK_RATE;
/** Who hears whom is worked out every this many ticks, for whoever has spoken within this many. */
const ROUTE_TICKS = 3;
const SPEAKING_TICKS = 10;

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
  /** How loud its last packet was meant; who is sent what it says; and the tick that was last worked out. */
  mode = MODE_TALK;
  readonly routes: VoicePeer[] = [];
  routedAt = -1000;
  /** The speakers (by slot) it is being sent, and the entity each was last said to be. */
  readonly hears = new Set<number>();
  readonly introduced = new Map<number, number>();
  /** Scratch for working out routes: the speakers in reach of it, and how far (squared) each is. */
  readonly near: VoicePeer[] = [];
  readonly nearAt: number[] = [];
  readonly sock: VoiceSocket;

  constructor(sock: VoiceSocket) {
    this.sock = sock;
  }
}

export interface VoiceContext {
  readonly game: GameServer;
  /** Whether `listener` has asked not to hear `speaker`. */
  muted(listener: Client, speaker: Client): boolean;
}

export class Voice {
  /** Packets taken, frames put in a listener's batch, packets refused for their shape, their rate or their order, batches a slow listener could not take, and times who hears whom was worked out. */
  readonly stats = { packets: 0, relayed: 0, malformed: 0, limited: 0, stale: 0, dropped: 0, routed: 0 };
  readonly peers = new Set<VoicePeer>();
  /** The peer of each session, by its slot. */
  private readonly bySlot: (VoicePeer | null)[] = [];
  private readonly tokens = new Map<Client, Uint8Array>();
  private readonly waiting: VoicePeer[] = [];
  private readonly speakers: VoicePeer[] = [];
  private readonly encoder = new TextEncoder();
  private readonly intro = new Uint8Array(8 + MAX_INTRO_NAME);
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
    const flags = audio.flags & ~FLAG_LOOP;
    // Back to the speaker, if it asked to hear itself: the way to test a microphone, and the whole of the path.
    if ((audio.flags & FLAG_LOOP) !== 0) this.give(peer, c.id, flags, audio.seq, audio.time, audio.opus);
    if (!this.maySpeak(c)) return;
    // To whoever is in reach. Someone who has just begun is not made to wait for the next working-out.
    peer.mode = modeOf(flags);
    const tick = this.ctx.game.world.tick;
    if (tick - peer.routedAt > ROUTE_TICKS) this.routeOne(peer, tick);
    for (const to of peer.routes) if (!to.closed) this.give(to, c.id, flags, audio.seq, audio.time, audio.opus);
  }

  /** Only a living survivor's voice has somewhere to carry from: the dead and those only watching are not heard. */
  private maySpeak(c: Client): boolean {
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0;
  }

  /** Whether a peer is someone voices can be sent to. */
  private listens(peer: VoicePeer): boolean {
    return peer.client !== null && peer.client.active && !peer.client.closed;
  }

  /** How far apart two sessions are, squared: each where its body is, or where it is watching from. */
  private apart(a: Client, b: Client): number {
    const dx = a.body.x - b.body.x;
    const dy = a.body.y - b.body.y;
    const dz = a.body.z - b.body.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Whether `to` is where `speaker`'s voice reaches: within its range, or a little past it if already listening. */
  private reaches(speaker: VoicePeer, to: VoicePeer, d2: number): boolean {
    const r = VOICE_RANGE[speaker.mode]! * (to.hears.has(speaker.client!.id) ? KEEP_RANGE : 1);
    return d2 <= r * r;
  }

  /** Tell a listener who a speaker number is, if it has not been told or the speaker has a new body. */
  private introduce(to: VoicePeer, speaker: Client): void {
    const handle = this.ctx.game.world.ents.handleOf(speaker.ent);
    if (to.introduced.get(speaker.id) === handle) return;
    to.introduced.set(speaker.id, handle);
    const name = this.encoder.encode(speaker.name);
    to.sock.send(this.intro.subarray(0, writeIntro(this.intro, speaker.id, handle, name)));
  }

  /** One speaker's listeners, worked out at once: everyone in reach who has room for another voice. */
  private routeOne(s: VoicePeer, tick: number): void {
    const c = s.client!;
    s.routes.length = 0;
    for (const to of this.peers) {
      if (to === s || !this.listens(to)) continue;
      if (!to.hears.has(c.id) && to.hears.size >= MAX_HEARD) continue;
      if (!this.reaches(s, to, this.apart(c, to.client!)) || this.ctx.muted(to.client!, c)) continue;
      to.hears.add(c.id);
      s.routes.push(to);
      this.introduce(to, c);
    }
    s.routedAt = tick;
  }

  /** Everyone's listeners, worked out afresh: each listener is sent the nearest speakers in reach, up to the most it may hear. */
  private route(tick: number): void {
    const speakers = this.speakers;
    speakers.length = 0;
    for (const p of this.peers) {
      p.near.length = p.nearAt.length = 0;
      if (p.client && tick - p.heardAt <= SPEAKING_TICKS && this.maySpeak(p.client)) speakers.push(p);
      else p.routes.length = 0;
    }
    if (speakers.length === 0) {
      for (const p of this.peers) p.hears.clear();
      return;
    }
    this.stats.routed++;
    for (const s of speakers) {
      const c = s.client!;
      for (const to of this.peers) {
        if (to === s || !this.listens(to)) continue;
        const d2 = this.apart(c, to.client!);
        if (!this.reaches(s, to, d2) || this.ctx.muted(to.client!, c)) continue;
        to.near.push(s);
        // A voice already being heard counts as a little nearer than it is, so that in a crowd on the move the few that are heard do not keep changing.
        to.nearAt.push(to.hears.has(c.id) ? d2 / (KEEP_RANGE * KEEP_RANGE) : d2);
      }
      s.routes.length = 0;
      s.routedAt = tick;
    }
    for (const to of this.peers) {
      to.hears.clear();
      const near = to.near;
      const at = to.nearAt;
      // The nearest few: picked one at a time, which for this few is the quickest way.
      for (let taken = 0; taken < MAX_HEARD && taken < near.length; taken++) {
        let best = taken;
        for (let k = taken + 1; k < near.length; k++) if (at[k]! < at[best]!) best = k;
        const s = near[best]!;
        near[best] = near[taken]!;
        at[best] = at[taken]!;
        near[taken] = s;
        to.hears.add(s.client!.id);
        s.routes.push(to);
        this.introduce(to, s.client!);
      }
    }
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

  /** Once a tick: a socket that has not said whose it is in time is closed, and every few ticks who hears whom is worked out. */
  step(tick: number): void {
    for (const peer of this.peers) if (!peer.client && tick - peer.since > AUTH_TICKS) this.close(peer);
    if (tick % ROUTE_TICKS === 0) this.route(tick);
  }
}
