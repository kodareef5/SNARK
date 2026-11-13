// The voice relay, with real sessions and sockets a test can read.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { JitterBuffer, START_TARGET } from "../../client/core/voice/jitter.ts";
import { Downlink } from "../../client/core/voice/listen.ts";
import { GATE_END, GATE_SEND, Uplink } from "../../client/core/voice/talk.ts";
import type { VoicePeer, VoiceSocket } from "../../server/voice.ts";
import { Rng } from "../../shared/rng.ts";
import { AUDIO_HEADER, FLAG_END, FLAG_LOOP, FRAME_SAMPLES, MODE_TALK, REACH_LOCAL, TOKEN_BYTES, VOICE_AUDIO, flagsOf, writeAudio, writeAuth } from "../../shared/voice/packet.ts";
import { Harness } from "../fixtures/net.ts";

const F = FRAME_SAMPLES;
const TOC = 9 << 3;

/** A voice socket as the server sees one, keeping what it was sent. */
class Wire implements VoiceSocket {
  readonly got: Uint8Array[] = [];
  closed = false;
  /** Set to refuse what is sent, as a listener too far behind does. */
  full = false;
  send(data: Uint8Array): boolean {
    if (this.full) return false;
    this.got.push(data.slice());
    return true;
  }
  close(): void {
    this.closed = true;
  }
}

/** Stand-in Opus: a valid first byte, the frame's number, then noise. */
function opus(rng: Rng, frame: number, n = 40): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 2; i < n; i++) out[i] = rng.int(256);
  out[0] = TOC;
  out[1] = frame & 0xff;
  return out;
}

function setup(names: string[]) {
  const h = new Harness({}, 1, 60, { dev: true });
  const sessions = names.map((n) => h.join(n));
  h.run(600);
  const voice = h.host.voice;
  let now = 0;
  /** Open a voice socket for a session and say whose it is, as its client would. */
  const open = (s: ClientSession, token = s.voice.token): { wire: Wire; peer: VoicePeer } => {
    const wire = new Wire();
    const peer = voice.connect(wire);
    const auth = new Uint8Array(32);
    voice.receive(peer, auth.subarray(0, writeAuth(auth, s.voice.slot, token)), now);
    return { wire, peer };
  };
  /** Send a packet and let 20 ms pass, or as long as is said. */
  const send = (peer: VoicePeer, packet: Uint8Array, ms = 20): void => {
    voice.receive(peer, packet, now);
    now += ms;
  };
  return { h, sessions, voice, open, send, wait: (ms: number) => void (now += ms) };
}

test("a session is given a token for the voice socket, and only that token opens it for that session", () => {
  const { h, sessions, voice, open } = setup(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  // Each was told its speaker number and a token of its own.
  expect(ada.voice.version).toBe(1);
  expect(ada.voice.slot).toBe(h.client(ada)!.id);
  expect(ada.voice.rights & 1).toBe(1);
  expect(ada.voice.token.length).toBe(TOKEN_BYTES);
  expect([...ada.voice.token]).not.toEqual([...bob.voice.token]);
  expect([...ada.voice.token].some((b) => b !== 0)).toBe(true);

  const good = open(ada);
  expect([good.wire.closed, good.peer.client === h.client(ada)]).toEqual([false, true]);
  expect(voice.peerOf(h.client(ada)!)).toBe(good.peer);
  // Another's token, a token of nothing, a slot nobody has: the socket is closed and speaks for no one.
  for (const wrong of [open(ada, bob.voice.token), open(ada, new Uint8Array(TOKEN_BYTES)), open({ voice: { slot: 999, token: ada.voice.token } } as unknown as ClientSession)]) {
    expect([wrong.wire.closed, wrong.peer.client]).toEqual([true, null]);
  }
  expect(voice.peerOf(h.client(ada)!)).toBe(good.peer);
  // Anything but that first packet, before it: closed.
  const mute = new Wire();
  const early = voice.connect(mute);
  voice.receive(early, new Uint8Array([VOICE_AUDIO, 0, 0, 0, 0, 0, 0, 0]), 0);
  expect(mute.closed).toBe(true);
  // A socket that never says whose it is is closed after five seconds.
  const silent = new Wire();
  voice.connect(silent);
  h.run(4000);
  expect(silent.closed).toBe(false);
  h.run(1500);
  expect(silent.closed).toBe(true);
  expect(voice.peers.size).toBe(1);

  // A second socket for the same session takes the place of the first.
  const again = open(ada);
  expect([good.wire.closed, again.wire.closed]).toEqual([true, false]);
  expect(voice.peerOf(h.client(ada)!)).toBe(again.peer);
  // When the session's connection ends, so does its voice socket, and the token with it.
  const token = ada.voice.token;
  ada.close();
  h.run(300);
  expect(again.wire.closed).toBe(true);
  expect(open({ voice: { slot: ada.voice.slot, token } } as unknown as ClientSession).wire.closed).toBe(true);
  // Coming back, it is given a new one, and the old one stays dead.
  const ada2 = h.join("ada");
  h.run(600);
  expect([...ada2.voice.token]).not.toEqual([...token]);
  expect(open(ada2).wire.closed).toBe(false);
  expect(open({ voice: { slot: ada2.voice.slot, token } } as unknown as ClientSession).wire.closed).toBe(true);
});

test("hearing yourself: what a session says with the loop asked for comes back through the server, frame for frame, and plays", () => {
  const { h, sessions, voice, open, send } = setup(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const a = open(ada);
  const b = open(bob);
  const rng = new Rng(6);
  const up = new Uplink();
  up.loop = true;
  // Half a second not talking, then a second of talk, the last frame marked as the end.
  for (let i = 0; i < 25; i++) up.capture(0);
  const said: number[][] = [];
  for (let i = 0; i < 50; i++) {
    up.capture(i === 49 ? GATE_END : GATE_SEND);
    const body = opus(rng, i);
    said.push([...body]);
    send(a.peer, up.encoded(body)!);
    // The process sends what is waiting at the end of each turn.
    expect(voice.pending).toBe(true);
    voice.flush();
    expect(voice.pending).toBe(false);
  }
  expect(voice.stats).toEqual({ packets: 50, relayed: 50, malformed: 0, limited: 0, stale: 0, dropped: 0 });
  // Bob, who is standing beside her, hears nothing yet: this phase only sends a voice back to its owner.
  expect(b.wire.got.length).toBe(0);
  expect(a.wire.got.length).toBe(50);

  // The client's side: the batches are read, each frame "decoded" (here: its number becomes its sound), and played.
  const down = new Downlink();
  const jb = new JitterBuffer();
  const heard: number[] = [];
  const got: number[][] = [];
  let ended = 0;
  for (const packet of a.wire.got) {
    down.receive(packet, (speaker, flags, time, body) => {
      expect(speaker).toBe(ada.voice.slot);
      expect(flags & FLAG_LOOP).toBe(0);
      got.push([...body]);
      if ((flags & FLAG_END) !== 0) ended++;
      jb.push(time, new Float32Array(F).fill(body[1]! + 1), (flags & FLAG_END) !== 0);
    });
    // 20 ms of the listener's clock for each packet.
    const out = new Float32Array(F);
    if (jb.read(out, F)) heard.push(out[F - 1]!);
  }
  const out = new Float32Array(F);
  while (jb.read(out.fill(0), F)) heard.push(out[F - 1]!);
  expect(got).toEqual(said);
  expect(ended).toBe(1);
  expect(down.stats).toEqual({ frames: 50, stale: 0, malformed: 0 });
  // Every frame was played once, in order, after the buffer's wait, and then it stopped.
  expect(heard.filter((v) => v !== 0)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  expect(jb.stats).toEqual({ played: 50, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 });
  expect(heard.findIndex((v) => v !== 0)).toBe(START_TARGET / F);
  // The times it carried count every frame of the microphone's, spoken or not.
  expect(down.speakers.get(ada.voice.slot)!.lastTime).toBe((25 + 49) * F);

  // Without the loop asked for, nothing comes back.
  up.loop = false;
  up.capture(GATE_SEND);
  send(a.peer, up.encoded(opus(rng, 0))!);
  expect(voice.pending).toBe(false);
  expect(h.host.items.audit()).toEqual([]);
});

test("the relay is bounded: no faster than speech, in order, well formed, and a slow listener is skipped, not waited for", () => {
  const { sessions, voice, open, send, wait } = setup(["ada"]);
  const [ada] = sessions as [ClientSession];
  const a = open(ada);
  const rng = new Rng(8);
  const buf = new Uint8Array(AUDIO_HEADER + 300);
  const flags = flagsOf(MODE_TALK, REACH_LOCAL, false, true);
  let seq = 0;
  const packet = (s = seq++, n = 40): Uint8Array => buf.slice(0, writeAudio(buf, flags, s, s * F, opus(rng, s, n)));
  // A hundred at once: fifteen pass, as after a stall; the rest are dropped, and the socket stays open.
  for (let i = 0; i < 100; i++) send(a.peer, packet(), 0);
  expect([voice.stats.packets, voice.stats.limited, a.wire.closed]).toEqual([15, 85, false]);
  // At speech's pace everything passes, for as long as it likes.
  wait(1000);
  for (let i = 0; i < 500; i++) send(a.peer, packet());
  expect([voice.stats.packets, voice.stats.limited]).toEqual([515, 85]);
  // A little faster than speech is allowed; twice as fast is not.
  wait(1000);
  let before = voice.stats.packets;
  for (let i = 0; i < 300; i++) send(a.peer, packet(), 10);
  expect(voice.stats.packets - before).toBeLessThan(200);
  expect(voice.stats.packets - before).toBeGreaterThan(170);

  // A packet that is not newer than the last taken adds nothing: twice the same, or an old one.
  wait(60000);
  const p = packet();
  send(a.peer, p);
  send(a.peer, p);
  send(a.peer, packet(seq - 5));
  expect(voice.stats.stale).toBe(2);
  // Sequence numbers wrap, and going round is still newer; a leap of more than half the way round is not.
  before = voice.stats.packets;
  wait(1000);
  send(a.peer, packet(50000));
  expect(voice.stats.stale).toBe(3);
  send(a.peer, packet(30000));
  send(a.peer, packet(60000));
  seq = 65530;
  for (let i = 0; i < 12; i++) send(a.peer, packet(seq++ & 0xffff));
  expect(voice.stats.packets - before).toBe(14);
  expect(a.peer.lastSeq).toBe(5);

  // What goes out is batches no larger than a packet, however much arrives in a turn.
  voice.flush();
  a.wire.got.length = 0;
  wait(1000);
  seq = 100;
  for (let i = 0; i < 14; i++) send(a.peer, packet(seq++, 200), 0);
  voice.flush();
  expect(a.wire.got.length).toBe(3);
  for (const sent of a.wire.got) expect(sent.length).toBeLessThanOrEqual(1400);
  let frames = 0;
  const down = new Downlink();
  for (const sent of a.wire.got) down.receive(sent, () => frames++);
  expect(frames).toBe(14);
  // A listener that cannot take a batch loses it; the relay does not hold it for later.
  a.wire.full = true;
  wait(1000);
  send(a.peer, packet());
  voice.flush();
  expect(voice.stats.dropped).toBe(1);
  a.wire.full = false;
  a.wire.got.length = 0;
  send(a.peer, packet());
  voice.flush();
  expect(a.wire.got.length).toBe(1);
  frames = 0;
  down.receive(a.wire.got[0]!, () => frames++);
  expect(frames).toBe(1);

  // Things a client never sends: each is refused, and the eighth closes the socket.
  const junk: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([VOICE_AUDIO]),
    new Uint8Array(AUDIO_HEADER + 201).fill(VOICE_AUDIO, 0, 1),
    Uint8Array.from([...packet()].map((v, i) => (i === 1 ? v | 0x80 : v))),
    Uint8Array.from([...packet()].map((v, i) => (i === AUDIO_HEADER ? TOC | 4 : v))),
    new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9]),
    buf.slice(0, writeAuth(buf, ada.voice.slot, ada.voice.token)),
  ];
  const relayed = voice.stats.relayed;
  for (const j of junk) send(a.peer, j);
  expect([voice.stats.malformed, a.wire.closed]).toEqual([7, false]);
  send(a.peer, junk[0]!);
  expect([voice.stats.malformed, a.wire.closed, voice.peers.size]).toEqual([8, true, 0]);
  // After that it is not listened to at all.
  send(a.peer, packet());
  expect(voice.stats.relayed).toBe(relayed);
});
