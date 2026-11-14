// The voice relay. Speech goes through the server so that no player learns another's address. The server never
// decodes an Opus frame. It checks each packet's shape, decides who hears it, and batches it per listener.

import { TICK_RATE } from "../shared/coords.ts";
import { SESSION_ALIVE } from "../shared/net/protocol.ts";
import { AUTH_BYTES, Batch, FLAG_LOOP, KEEP_RANGE, MAX_HEARD, MAX_INTRO_NAME, MODE_TALK, REACH_GLOBAL, REACH_SHIFT, TOKEN_BYTES, VOICE_AUDIO, VOICE_AUTH, VOICE_RANGE, audio, modeOf, parseAudio, seqNewer, writeIntro } from "../shared/voice/packet.ts";
import type { Client, GameServer } from "./game.ts";

/** Packets a speaker may send per second, and in a burst after a pause. Speech takes 50 a second. */
const RATE = 60;
const BURST = 15;
/** Malformed packets tolerated before the socket is closed. */
const MAX_STRIKES = 8;
/** Ticks a socket has to authenticate. */
const AUTH_TICKS = 5 * TICK_RATE;
/** Routes are recomputed every ROUTE_TICKS, for peers that spoke within SPEAKING_TICKS. */
const ROUTE_TICKS = 3;
const SPEAKING_TICKS = 10;

export interface VoiceSocket {
  /** Returns false if the listener is too far behind. The packet is then dropped, not queued. */
  send(data: Uint8Array): boolean;
  close(): void;
}

export class VoicePeer {
  /** Null until the socket has authenticated. */
  client: Client | null = null;
  readonly batch = new Batch();
  /** -1 before the first packet. */
  lastSeq = -1;
  /** Packets it may send right now, as of allowanceAt (milliseconds). */
  allowance = BURST;
  allowanceAt = 0;
  strikes = 0;
  /** The tick it connected on, and the last tick it spoke on. */
  since = 0;
  heardAt = 0;
  /** It has frames waiting for the next flush. */
  waiting = false;
  closed = false;
  /** The mode of its last packet, the peers that are sent its voice, and the tick those were last computed. */
  mode = MODE_TALK;
  readonly routes: VoicePeer[] = [];
  routedAt = -1000;
  /** The speaker slots it is sent, and the entity handle each was last introduced with. */
  readonly hears = new Set<number>();
  readonly introduced = new Map<number, number>();
  /** Scratch for route(): the speakers in reach, and each one's squared distance. */
  readonly near: VoicePeer[] = [];
  readonly nearAt: number[] = [];
  readonly sock: VoiceSocket;

  constructor(sock: VoiceSocket) {
    this.sock = sock;
  }
}

export interface VoiceContext {
  readonly game: GameServer;
  muted(listener: Client, speaker: Client): boolean;
  /** The server rule that every voice is heard everywhere. */
  everywhere(): boolean;
}

export class Voice {
  /** `relayed` counts frames batched, `dropped` batches a slow listener could not take, `routed` full route passes. */
  readonly stats = { packets: 0, relayed: 0, malformed: 0, limited: 0, stale: 0, dropped: 0, routed: 0 };
  readonly peers = new Set<VoicePeer>();
  private readonly bySlot: (VoicePeer | null)[] = [];
  private readonly tokens = new Map<Client, Uint8Array>();
  private readonly waiting: VoicePeer[] = [];
  private readonly speakers: VoicePeer[] = [];
  private readonly encoder = new TextEncoder();
  private readonly intro = new Uint8Array(8 + MAX_INTRO_NAME);
  private readonly ctx: VoiceContext;
  private readonly random: (out: Uint8Array) => void;

  /** `random` must fill the buffer with unguessable bytes. */
  constructor(ctx: VoiceContext, random: (out: Uint8Array) => void) {
    this.ctx = ctx;
    this.random = random;
  }

  /** The token a voice socket proves session `c` with. Made on first use. */
  token(c: Client): Uint8Array {
    let t = this.tokens.get(c);
    if (!t) {
      t = new Uint8Array(TOKEN_BYTES);
      this.random(t);
      this.tokens.set(c, t);
    }
    return t;
  }

  /** Call when a session's connection ends. */
  revoke(c: Client): void {
    this.tokens.delete(c);
    const peer = this.bySlot[c.id];
    if (peer && peer.client === c) this.close(peer);
  }

  peerOf(c: Client): VoicePeer | null {
    const peer = this.bySlot[c.id];
    return peer && peer.client === c ? peer : null;
  }

  connect(sock: VoiceSocket): VoicePeer {
    const peer = new VoicePeer(sock);
    peer.since = this.ctx.game.world.tick;
    this.peers.add(peer);
    return peer;
  }

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

  /** `now` is milliseconds on any steady clock. `data` is not kept. */
  receive(peer: VoicePeer, data: Uint8Array, now: number): void {
    if (peer.closed) return;
    if (!peer.client) {
      // The first packet must authenticate. Anything else closes the socket.
      if (!this.auth(peer, data)) this.close(peer);
      return;
    }
    if (data[0] !== VOICE_AUDIO || !parseAudio(data)) {
      this.stats.malformed++;
      if (++peer.strikes >= MAX_STRIKES) this.close(peer);
      return;
    }
    // Packets over the rate are dropped without a strike.
    const earned = ((now - peer.allowanceAt) * RATE) / 1000;
    peer.allowance = Math.min(BURST, peer.allowance + (earned > 0 ? earned : 0));
    peer.allowanceAt = now;
    if (peer.allowance < 1) {
      this.stats.limited++;
      return;
    }
    peer.allowance -= 1;
    if (peer.lastSeq >= 0 && !seqNewer(audio.seq, peer.lastSeq)) {
      this.stats.stale++;
      return;
    }
    peer.lastSeq = audio.seq;
    peer.heardAt = this.ctx.game.world.tick;
    this.stats.packets++;
    const c = peer.client;
    if (c.closed || !c.active) return;
    // The server sets the reach bits and ignores the ones in the packet.
    const flags = (audio.flags & ~(FLAG_LOOP | (3 << REACH_SHIFT))) | (this.ctx.everywhere() ? REACH_GLOBAL << REACH_SHIFT : 0);
    // FLAG_LOOP sends the frame back to its speaker, for testing a microphone over the whole path.
    if ((audio.flags & FLAG_LOOP) !== 0) this.give(peer, c.id, flags, audio.seq, audio.time, audio.opus);
    if (!this.maySpeak(c)) return;
    // A speaker who starts or changes mode is routed now, not at the next route pass.
    const mode = modeOf(flags);
    const tick = this.ctx.game.world.tick;
    if (mode !== peer.mode || tick - peer.routedAt > ROUTE_TICKS) {
      peer.mode = mode;
      this.routeOne(peer, tick);
    }
    for (const to of peer.routes) if (!to.closed) this.give(to, c.id, flags, audio.seq, audio.time, audio.opus);
  }

  /** Only a living survivor has a position to speak from. The dead and spectators are not heard. */
  private maySpeak(c: Client): boolean {
    return c.active && !c.closed && c.state === SESSION_ALIVE && c.ent >= 0;
  }

  private listens(peer: VoicePeer): boolean {
    return peer.client !== null && peer.client.active && !peer.client.closed;
  }

  /** Squared distance. Each session is at its body, or where it watches from. */
  private apart(a: Client, b: Client): number {
    const dx = a.body.x - b.body.x;
    const dy = a.body.y - b.body.y;
    const dz = a.body.z - b.body.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** A listener already hearing the speaker stays in reach up to KEEP_RANGE times the range. */
  private reaches(speaker: VoicePeer, to: VoicePeer, d2: number): boolean {
    if (this.ctx.everywhere()) return true;
    const r = VOICE_RANGE[speaker.mode]! * (to.hears.has(speaker.client!.id) ? KEEP_RANGE : 1);
    return d2 <= r * r;
  }

  /** Tells a listener which entity a speaker slot is, unless it already knows this body. */
  private introduce(to: VoicePeer, speaker: Client): void {
    const handle = this.ctx.game.world.ents.handleOf(speaker.ent);
    if (to.introduced.get(speaker.id) === handle) return;
    to.introduced.set(speaker.id, handle);
    const name = this.encoder.encode(speaker.name);
    to.sock.send(this.intro.subarray(0, writeIntro(this.intro, speaker.id, handle, name)));
  }

  /** Routes one speaker now, to everyone in reach who has room for another voice. */
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

  /** Recomputes every route. Each listener gets the nearest speakers in reach, up to MAX_HEARD. */
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
        // A voice already heard counts as a little nearer, so the few heard in a moving crowd do not keep changing.
        to.nearAt.push(to.hears.has(c.id) ? d2 / (KEEP_RANGE * KEEP_RANGE) : d2);
      }
      s.routes.length = 0;
      s.routedAt = tick;
    }
    for (const to of this.peers) {
      to.hears.clear();
      const near = to.near;
      const at = to.nearAt;
      // Pick the nearest one at a time. For so few that is the quickest way.
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
    // Constant-time, so timing does not leak where the tokens differ.
    let diff = 0;
    for (let i = 0; i < TOKEN_BYTES; i++) diff |= token[i]! ^ data[3 + i]!;
    if (diff !== 0) return false;
    // One voice socket per session. A new one replaces the old.
    const old = this.bySlot[slot];
    if (old && old !== peer) this.close(old);
    this.bySlot[slot] = peer;
    peer.client = c;
    return true;
  }

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

  /** While true, the process must call `flush` once at the end of the turn. */
  get pending(): boolean {
    return this.waiting.length > 0;
  }

  flush(): void {
    for (const peer of this.waiting) {
      peer.waiting = false;
      this.send(peer);
    }
    this.waiting.length = 0;
  }

  step(tick: number): void {
    for (const peer of this.peers) if (!peer.client && tick - peer.since > AUTH_TICKS) this.close(peer);
    if (tick % ROUTE_TICKS === 0) this.route(tick);
  }
}
