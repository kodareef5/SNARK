// The voice relay, with real sessions and sockets a test can read.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { JitterBuffer, START_TARGET } from "../../client/core/voice/jitter.ts";
import { Downlink } from "../../client/core/voice/listen.ts";
import { GATE_END, GATE_SEND, Uplink } from "../../client/core/voice/talk.ts";
import type { VoicePeer, VoiceSocket } from "../../server/voice.ts";
import { CMD_RESPAWN, SESSION_ALIVE } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { AUDIO_HEADER, FLAG_END, FLAG_LOOP, FRAME_SAMPLES, KEEP_RANGE, MAX_HEARD, MODE_TALK, MODE_WHISPER, MODE_YELL, REACH_GLOBAL, REACH_LOCAL, REACH_TRIBE, TOKEN_BYTES, VOICE_AUDIO, VOICE_INTRO, VOICE_RANGE, flagsOf, reachOf, writeAudio, writeAuth } from "../../shared/voice/packet.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";

const F = FRAME_SAMPLES;
const TOC = 9 << 3;

/** Keeps what the server sent it. */
class Wire implements VoiceSocket {
  readonly got: Uint8Array[] = [];
  closed = false;
  /** Refuses sends, as a listener too far behind does. */
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
  /** Opens a voice socket and authenticates it as the session's client would. */
  const open = (s: ClientSession, token = s.voice.token): { wire: Wire; peer: VoicePeer } => {
    const wire = new Wire();
    const peer = voice.connect(wire);
    const auth = new Uint8Array(32);
    voice.receive(peer, auth.subarray(0, writeAuth(auth, s.voice.slot, token)), now);
    return { wire, peer };
  };
  /** Sends a packet, then advances the voice clock by `ms`. */
  const send = (peer: VoicePeer, packet: Uint8Array, ms = 20): void => {
    voice.receive(peer, packet, now);
    now += ms;
  };
  return { h, sessions, voice, open, send, wait: (ms: number) => void (now += ms) };
}

test("a session is given a token for the voice socket, and only that token opens it for that session", () => {
  const { h, sessions, voice, open } = setup(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  expect(ada.voice.version).toBe(1);
  expect(ada.voice.slot).toBe(h.client(ada)!.id);
  expect(ada.voice.rights & 1).toBe(1);
  expect(ada.voice.token.length).toBe(TOKEN_BYTES);
  expect([...ada.voice.token]).not.toEqual([...bob.voice.token]);
  expect([...ada.voice.token].some((b) => b !== 0)).toBe(true);

  const good = open(ada);
  expect([good.wire.closed, good.peer.client === h.client(ada)]).toEqual([false, true]);
  expect(voice.peerOf(h.client(ada)!)).toBe(good.peer);
  // Wrong: another session's token, an all-zero token, and a slot nobody has.
  for (const wrong of [open(ada, bob.voice.token), open(ada, new Uint8Array(TOKEN_BYTES)), open({ voice: { slot: 999, token: ada.voice.token } } as unknown as ClientSession)]) {
    expect([wrong.wire.closed, wrong.peer.client]).toEqual([true, null]);
  }
  expect(voice.peerOf(h.client(ada)!)).toBe(good.peer);
  // Any packet before the auth packet closes the socket.
  const mute = new Wire();
  const early = voice.connect(mute);
  voice.receive(early, new Uint8Array([VOICE_AUDIO, 0, 0, 0, 0, 0, 0, 0]), 0);
  expect(mute.closed).toBe(true);
  // A socket that never authenticates is closed after five seconds.
  const silent = new Wire();
  voice.connect(silent);
  h.run(4000);
  expect(silent.closed).toBe(false);
  h.run(1500);
  expect(silent.closed).toBe(true);
  expect(voice.peers.size).toBe(1);

  const again = open(ada);
  expect([good.wire.closed, again.wire.closed]).toEqual([true, false]);
  expect(voice.peerOf(h.client(ada)!)).toBe(again.peer);
  // Closing the session closes its voice socket and voids the token.
  const token = ada.voice.token;
  ada.close();
  h.run(300);
  expect(again.wire.closed).toBe(true);
  expect(open({ voice: { slot: ada.voice.slot, token } } as unknown as ClientSession).wire.closed).toBe(true);
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
  // 25 silent frames, then 50 of talk with the last marked as the end.
  for (let i = 0; i < 25; i++) up.capture(0);
  const said: number[][] = [];
  for (let i = 0; i < 50; i++) {
    up.capture(i === 49 ? GATE_END : GATE_SEND);
    const body = opus(rng, i);
    said.push([...body]);
    send(a.peer, up.encoded(body)!);
    // The server flushes pending voice at the end of each turn.
    expect(voice.pending).toBe(true);
    voice.flush();
    expect(voice.pending).toBe(false);
  }
  // Each frame is relayed twice: back to her, and to Bob beside her.
  expect(voice.stats).toEqual({ packets: 50, relayed: 100, malformed: 0, limited: 0, stale: 0, dropped: 0, routed: 0 });
  expect(a.wire.got.length).toBe(50);
  // Bob gets one intro packet naming the speaker before the first frame.
  expect(b.wire.got.length).toBe(51);
  expect(b.wire.got[0]![0]).toBe(VOICE_INTRO);

  // Decoding is faked. A frame's number becomes its sample value.
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
  // Every frame plays once, in order, after the jitter buffer's initial wait.
  expect(heard.filter((v) => v !== 0)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  expect(jb.stats).toEqual({ played: 50, missing: 0, late: 0, restarts: 0, jumps: 0, odd: 0 });
  expect(heard.findIndex((v) => v !== 0)).toBe(START_TARGET / F);
  // Packet times count every microphone frame, sent or not: 25 silent plus 49.
  expect(down.speakers.get(ada.voice.slot)!.lastTime).toBe((25 + 49) * F);

  up.loop = false;
  up.capture(GATE_SEND);
  a.wire.got.length = 0;
  send(a.peer, up.encoded(opus(rng, 0))!);
  voice.flush();
  expect([a.wire.got.length, b.wire.got.length]).toEqual([0, 52]);
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
  // A burst of fifteen is allowed, as after a stall. The rest are dropped.
  for (let i = 0; i < 100; i++) send(a.peer, packet(), 0);
  expect([voice.stats.packets, voice.stats.limited, a.wire.closed]).toEqual([15, 85, false]);
  // At one packet every 20 ms, everything passes.
  wait(1000);
  for (let i = 0; i < 500; i++) send(a.peer, packet());
  expect([voice.stats.packets, voice.stats.limited]).toEqual([515, 85]);
  // A little faster than speech is allowed. Twice as fast is not.
  wait(1000);
  let before = voice.stats.packets;
  for (let i = 0; i < 300; i++) send(a.peer, packet(), 10);
  expect(voice.stats.packets - before).toBeLessThan(200);
  expect(voice.stats.packets - before).toBeGreaterThan(170);

  // A repeated or older sequence number is stale.
  wait(60000);
  const p = packet();
  send(a.peer, p);
  send(a.peer, p);
  send(a.peer, packet(seq - 5));
  expect(voice.stats.stale).toBe(2);
  // Sequence numbers wrap, and a wrap still counts as newer. A jump of more than half the range does not.
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

  // Outgoing batches are at most 1400 bytes, however much arrives in a turn.
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
  // A listener that cannot take a batch loses it. The relay does not hold it for later.
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

  // Each malformed packet is refused, and the eighth closes the socket.
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
  send(a.peer, packet());
  expect(voice.stats.relayed).toBe(relayed);
});

/** Survivors with voice sockets on level ground. The first stands at the spot `place` measures from. */
function crowd(names: string[]) {
  const base = setup(names);
  const { h, sessions, voice, open } = base;
  for (const s of sessions) h.say(s, "enablecheats");
  const g = flatGround(h, 8, 70);
  const at = { x: g.x + 4, z: g.z + 2 };
  /** Puts a survivor `far` metres north of the spot. */
  const place = (s: ClientSession, far: number, side = 0): void => void h.say(s, `tp ${(at.x + side).toFixed(3)} ${(at.z + far).toFixed(3)}`, 200);
  sessions.forEach((s, i) => place(s, i === 0 ? 0 : 1));
  const wires = sessions.map((s) => open(s));
  const rng = new Rng(3);
  const buf = new Uint8Array(AUDIO_HEADER + 64);
  const seqs = sessions.map(() => 0);
  let now = 100000;
  /** Session `who`, or several together, sends `n` frames 20 ms apart while the world runs. */
  const say = (who: number | number[], n = 5, mode = MODE_TALK, reach = REACH_LOCAL, loop = false): void => {
    for (let k = 0; k < n; k++) {
      for (const i of typeof who === "number" ? [who] : who) {
        const seq = seqs[i]!++;
        voice.receive(wires[i]!.peer, buf.subarray(0, writeAudio(buf, flagsOf(mode, reach, false, loop), seq & 0xffff, seq * F, opus(rng, seq))), now);
      }
      voice.flush();
      now += 20;
      h.run(20);
    }
  };
  /** Frames a session received since the last call, counted by speaker's name. */
  const down = sessions.map(() => new Downlink());
  const heardBy = (i: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const packet of wires[i]!.wire.got) {
      down[i]!.receive(packet, (speaker) => {
        const who = sessions.find((s) => s.voice.slot === speaker)!.name;
        out[who] = (out[who] ?? 0) + 1;
      });
    }
    wires[i]!.wire.got.length = 0;
    return out;
  };
  /** Waits until the server forgets who was talking, so that the next talk is routed afresh. */
  const hush = (): void => {
    h.run(600);
    sessions.forEach((_s, i) => heardBy(i));
  };
  return { ...base, at, place, wires, say, heardBy, hush, down };
}

test("a voice carries as far as it is meant: a whisper to those beside you, talk across a camp, a yell across a base", () => {
  const { h, sessions, place, say, heardBy, hush, down } = crowd(["ada", "bob", "cy"]);
  const [ada, bob, cy] = sessions as [ClientSession, ClientSession, ClientSession];
  expect(VOICE_RANGE).toEqual([4, 25, 60]);
  place(bob, 10);
  place(cy, 40);
  hush();
  say(0, 10);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, {}]);
  hush();
  say(0, 10, MODE_YELL);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, { ada: 10 }]);
  hush();
  say(0, 10, MODE_WHISPER);
  expect([heardBy(1), heardBy(2)]).toEqual([{}, {}]);
  place(bob, 3);
  hush();
  say(0, 10, MODE_WHISPER);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, {}]);
  // She hears herself only with the loop flag, which sends nobody else anything more.
  expect(heardBy(0)).toEqual({});
  say(0, 5, MODE_WHISPER, REACH_LOCAL, true);
  expect([heardBy(0), heardBy(1), heardBy(2)]).toEqual([{ ada: 5 }, { ada: 5 }, {}]);
  // The intro gives a listener the speaker's name and the entity handle to place the voice at.
  const said = down[1]!.speakers.get(ada.voice.slot)!;
  expect([said.name, h.world.ents.resolve(said.handle)]).toEqual(["ada", h.ent(ada)]);
  expect(down[2]!.speakers.get(ada.voice.slot)!.name).toBe("ada");
  expect(down[0]!.speakers.get(bob.voice.slot)).toBeUndefined();

  // Once heard, a speaker stays heard out to KEEP_RANGE times the range.
  const r = VOICE_RANGE[MODE_TALK]!;
  place(bob, r + 1);
  hush();
  say(0, 10);
  expect(heardBy(1)).toEqual({});
  place(bob, r - 1);
  say(0, 10);
  expect(heardBy(1).ada).toBeGreaterThanOrEqual(8);
  place(bob, r * KEEP_RANGE - 0.5);
  say(0, 10);
  expect(heardBy(1)).toEqual({ ada: 10 });
  place(bob, r * KEEP_RANGE + 1);
  say(0, 10);
  expect(heardBy(1).ada ?? 0).toBeLessThanOrEqual(3);
  say(0, 10);
  expect(heardBy(1)).toEqual({});
  // Once cut off, he hears her again only inside the range itself.
  place(bob, r * KEEP_RANGE - 0.5);
  say(0, 10);
  expect(heardBy(1)).toEqual({});
  expect(cy.voice.version).toBe(1);
});

test("who is heard: not the muted, not the dead, not those only watching; and whatever a client claims changes nothing", () => {
  const { h, sessions, voice, place, say, heardBy, hush, wires, open } = crowd(["ada", "bob", "cy"]);
  const [ada, bob, cy] = sessions as [ClientSession, ClientSession, ClientSession];
  place(bob, 5);
  place(cy, 45);
  hush();
  // The chat mute also mutes voice.
  h.say(bob, "mute ada");
  say(0, 10);
  say(1, 10);
  expect([heardBy(1), heardBy(0)]).toEqual([{}, { bob: 10 }]);
  h.say(bob, "unmute ada");
  hush();
  say(0, 10);
  expect(heardBy(1)).toEqual({ ada: 10 });

  // The server ignores the reach a packet asks for. Cy, far off, is sent nothing.
  hush();
  for (const reach of [REACH_TRIBE, REACH_GLOBAL]) say(0, 5, MODE_TALK, reach);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, {}]);
  // At 68 m Cy is out of a yell's 60 m reach.
  place(cy, 68);
  hush();
  say(2, 10, MODE_YELL, REACH_GLOBAL, true);
  expect([heardBy(0), heardBy(1), heardBy(2)]).toEqual([{}, {}, { cy: 10 }]);

  // A spectator is not heard but still hears.
  place(cy, 6);
  hush();
  h.say(cy, "spectate");
  say(2, 10);
  say(0, 10);
  expect([heardBy(0), heardBy(1), heardBy(2)]).toEqual([{}, { ada: 10 }, { ada: 10 }]);
  h.say(cy, "stopspectating");
  // The dead are not heard. After a respawn, listeners get a new intro for the new body.
  hush();
  const before = h.ent(bob);
  h.say(bob, "suicide");
  h.run(300);
  say(1, 10);
  expect(heardBy(0)).toEqual({});
  bob.command(CMD_RESPAWN, (w) => (w.u8(0), w.u8(bob.placesList)));
  h.run(600);
  expect(bob.sessionState).toBe(SESSION_ALIVE);
  place(bob, 5);
  hush();
  const intros = (): number => wires[0]!.wire.got.filter((p) => p[0] === VOICE_INTRO).length;
  say(1, 10);
  expect(intros()).toBe(1);
  expect(before).toBeGreaterThanOrEqual(0);
  const told = new Downlink();
  for (const packet of wires[0]!.wire.got) told.receive(packet, () => {});
  expect(h.world.ents.resolve(told.speakers.get(bob.voice.slot)!.handle)).toBe(h.ent(bob));
  // A closed session is sent nothing, even while its body lingers.
  const stale = wires[2]!;
  heardBy(2);
  cy.close();
  h.run(300);
  expect(stale.wire.closed).toBe(true);
  say(0, 10);
  expect(stale.wire.got.filter((p) => p[0] !== VOICE_INTRO).length).toBe(0);
  expect(voice.peers.size).toBe(2);
  expect(open(ada).wire.closed).toBe(false);
});

test("a listener in a crowd is sent the nearest eight speakers and no others", () => {
  const names = ["lis", ...Array.from({ length: 11 }, (_, i) => `s${i}`)];
  const { sessions, place, say, heardBy, hush } = crowd(names);
  // Eleven speakers stand in a line from 2 m to 22 m, all within talk range of the listener.
  for (let i = 1; i < sessions.length; i++) place(sessions[i]!, i * 2);
  const everyone = sessions.map((_s, i) => i).slice(1);
  hush();
  // At first the speakers who began first are heard. After the server has ranked them, the nearest are.
  say(everyone, 10);
  heardBy(0);
  say(everyone, 20);
  const heard = heardBy(0);
  expect(Object.keys(heard).sort()).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
  expect(Object.keys(heard).length).toBe(MAX_HEARD);
  for (const n of Object.values(heard)) expect(n).toBe(20);
  // The furthest speaker (s10) steps right up and displaces the eighth.
  place(sessions[11]!, 1, 1);
  say(everyone, 10);
  heardBy(0);
  say(everyone, 20);
  const now = heardBy(0);
  expect(Object.keys(now).sort()).toEqual(["s0", "s1", "s10", "s2", "s3", "s4", "s5", "s6"]);
  for (const n of Object.values(now)) expect(n).toBe(20);
  // Each listener is ranked by its own distances. The one in the middle hears four on each side.
  heardBy(6);
  say(everyone, 10);
  expect(Object.keys(heardBy(6)).sort()).toEqual(["s1", "s2", "s3", "s4", "s6", "s7", "s8", "s9"]);
});

test("a server may have every voice heard everywhere: no nearer or further, still no more than eight at once, and each frame says so", () => {
  const { h, sessions, place, say, heardBy, hush, wires } = crowd(["ada", "bob", "cy"]);
  const [ada] = sessions as [ClientSession];
  place(sessions[1]!, 10);
  place(sessions[2]!, 68);
  hush();
  const reaches = (i: number): number[] => {
    const out: number[] = [];
    const down = new Downlink();
    for (const packet of wires[i]!.wire.got) down.receive(packet, (_speaker, flags) => out.push(reachOf(flags)));
    return [...new Set(out)];
  };
  // By default frames reach Bob marked REACH_LOCAL, even when the packet asked for REACH_GLOBAL.
  say(0, 10, MODE_WHISPER, REACH_GLOBAL);
  say(0, 10, MODE_TALK, REACH_GLOBAL);
  expect(reaches(1)).toEqual([REACH_LOCAL]);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, {}]);
  // With globalVoiceChat everyone hears even a whisper, and frames are marked REACH_GLOBAL.
  expect(h.say(ada, "setting globalVoiceChat True")[0]).toContain("globalVoiceChat=True");
  hush();
  say(0, 10, MODE_WHISPER);
  expect(reaches(2)).toEqual([REACH_GLOBAL]);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, { ada: 10 }]);
  // The muted are still not heard.
  h.say(sessions[2]!, "mute ada");
  hush();
  say(0, 10);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 10 }, {}]);
  h.say(ada, "setting globalVoiceChat False");
  hush();
  say(0, 10, MODE_YELL);
  expect(heardBy(1)).toEqual({ ada: 10 });
  expect(reaches(1)).toEqual([]);
});
