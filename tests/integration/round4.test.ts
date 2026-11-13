// Round 4, end to end: one story for each of its parts. What each piece does in
// detail is in the tests beside this one; these tell whether the pieces make a
// game together, through the commands a client sends and what it is sent back.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { JitterBuffer } from "../../client/core/voice/jitter.ts";
import { Downlink } from "../../client/core/voice/listen.ts";
import type { VoicePeer, VoiceSocket } from "../../server/voice.ts";
import { BOX_OPEN, CMD_CLOSE, CMD_FEED, CMD_NAME, CMD_OPEN, CMD_ORDER, ORDER_MATE } from "../../shared/net/protocol.ts";
import { MIND_HUNT } from "../../server/behavior.ts";
import type { EntityRecord } from "../../server/records.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { V_FOOD, V_TORPOR } from "../../shared/sim/vitals.ts";
import { BOX_SELF, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_PLACE, CMD_RESPAWN, CMD_SELECT, CMD_STRUCT, RESULT_LOCKED, RESULT_NOT_YOURS, RESULT_OK, RESULT_TOO_HIGH, SESSION_ALIVE, SESSION_DEAD, TEXT_GLOBAL, TEXT_LOCAL, TEXT_TRIBE } from "../../shared/net/protocol.ts";
import { FOUNDATION_THICK, RISE } from "../../content/building.ts";
import { NO_TARGET } from "../../server/build.ts";
import type { Source } from "../../server/combat.ts";
import { STRUCT_UNITS, TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { SLOPE_TANS, SLOPE_X0, SLOPE_Z0 } from "../../shared/world/proving.ts";
import { ON_TOP } from "../../shared/world/snap.ts";
import { STRUCT_LIGHT, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { STOCK, builder } from "../fixtures/build.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { SWING_TICKS } from "../../shared/sim/weapon.ts";
import { AUDIO_HEADER, FRAME_SAMPLES, MODE_TALK, MODE_YELL, REACH_LOCAL, VOICE_RANGE, flagsOf, writeAudio, writeAuth } from "../../shared/voice/packet.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-round4-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const U = STRUCT_UNITS;

/** What a session has been told since `from`, on one channel. */
const heard = (s: ClientSession, channel: number, from: number): string[] =>
  s.log
    .slice(Math.max(0, s.log.length - (s.logVersion - from)))
    .filter((l) => l.channel === channel)
    .map((l) => l.text);

/** A voice socket as the server sees one, keeping what it was sent. */
class Wire implements VoiceSocket {
  readonly got: Uint8Array[] = [];
  send(data: Uint8Array): boolean {
    this.got.push(data.slice());
    return true;
  }
  close(): void {}
}

test("round 4, social: on a poor link, two survivors found a tribe and cannot hurt each other, write on three channels, and hear each other through the server while they are near and not when they are not", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  // Sixty milliseconds each way, fifteen of jitter, and one snapshot in fifty lost.
  const link = { latencyMs: 60, jitterMs: 15, loss: 0.02 };
  const [ada, bob, cy] = ["ada", "bob", "cy"].map((n) => h.join(n, link)) as [ClientSession, ClientSession, ClientSession];
  const all = [ada, bob, cy];
  h.run(900);
  for (const s of all) h.say(s, "enablecheats", 500);
  const g = flatGround(h, 8, 70);
  const at = { x: g.x + 4, z: g.z + 2 };
  const place = (s: ClientSession, far: number): void => void h.say(s, `tp ${at.x.toFixed(3)} ${(at.z + far).toFixed(3)}`, 500);
  // Ada, Bob a step and a half north of her, and Cy sixty-six metres off: out of earshot of anything said near.
  place(ada, 0);
  place(bob, 1.5);
  place(cy, 66);
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  const punch = (): number => {
    const pilot = h.pilots[0]!;
    pilot.yaw = 0;
    pilot.pitch = Math.atan2(1.25 - 1.62, 1.5);
    h.run(300);
    const before = h.host.combat.hits;
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 10);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(TICK_MS * (SWING_TICKS + 10));
    return h.host.combat.hits - before;
  };

  // Strangers: her fist lands, and hurts.
  const whole = h.host.survival.value(rec(bob), V_HEALTH);
  expect(punch()).toBe(1);
  const hurt = h.host.survival.value(rec(bob), V_HEALTH);
  expect(hurt).toBeLessThan(whole);
  // A tribe: she founds it, asks him face to face, and he joins. Each is shown the other in it.
  expect(h.say(ada, "tribe create Night Shift", 500)[0]).toContain("You founded Night Shift");
  expect(h.say(ada, "tribe invite bob", 500)[0]).toBe("You invited bob.");
  expect(h.say(bob, "tribe accept", 500)[0]).toContain("You joined Night Shift");
  expect([rec(bob).team, rec(cy).team === rec(ada).team]).toEqual([rec(ada).team, false]);
  for (const s of [ada, bob]) expect([s.tribe.name, s.tribe.members.map((m) => m.name)]).toEqual(["Night Shift", ["ada", "bob"]]);
  expect(cy.tribe.name).toBe("");
  // Her fist still lands, and does nothing.
  h.run(1500);
  const before = h.host.survival.value(rec(bob), V_HEALTH);
  punch();
  expect(h.host.survival.value(rec(bob), V_HEALTH)).toBeGreaterThanOrEqual(before);

  // Three channels: everyone; those near; the tribe.
  const marks = (): number[] => all.map((s) => s.logVersion);
  const since = (from: number[], channel: number): string[][] => all.map((s, i) => heard(s, channel, from[i]!));
  let from = marks();
  ada.chat(TEXT_GLOBAL, "hello, island");
  h.run(600);
  expect(since(from, TEXT_GLOBAL)).toEqual([["ada: hello, island"], ["ada: hello, island"], ["ada: hello, island"]]);
  from = marks();
  bob.chat(TEXT_LOCAL, "anyone near?");
  h.run(600);
  expect(since(from, TEXT_LOCAL)).toEqual([["bob: anyone near?"], ["bob: anyone near?"], []]);
  from = marks();
  cy.chat(TEXT_TRIBE, "to mine");
  ada.chat(TEXT_TRIBE, "to ours");
  h.run(600);
  // (Cy has no tribe: what she says to it goes to nobody.)
  expect(since(from, TEXT_TRIBE)).toEqual([["ada: to ours"], ["ada: to ours"], []]);

  // Voice. Each opens a socket to the server with the token it was given; nobody is told where anyone else's is.
  const voice = h.host.voice;
  let now = 100000;
  const wires = all.map((s) => {
    const wire = new Wire();
    const peer: VoicePeer = voice.connect(wire);
    const auth = new Uint8Array(32);
    voice.receive(peer, auth.subarray(0, writeAuth(auth, s.voice.slot, s.voice.token)), now);
    return { wire, peer };
  });
  const noise = new Rng(3);
  const buf = new Uint8Array(AUDIO_HEADER + 64);
  const seqs = all.map(() => 0);
  /** Session `i` says `n` frames, twenty milliseconds apart, as loud as `mode`; the world goes on under it. */
  const say = (i: number, n: number, mode = MODE_TALK): void => {
    for (let k = 0; k < n; k++) {
      const seq = seqs[i]!++;
      const body = new Uint8Array(40);
      for (let b = 2; b < body.length; b++) body[b] = noise.int(256);
      body[0] = 9 << 3;
      body[1] = seq & 0xff;
      voice.receive(wires[i]!.peer, buf.subarray(0, writeAudio(buf, flagsOf(mode, REACH_LOCAL, false, false), seq & 0xffff, seq * FRAME_SAMPLES, body)), now);
      voice.flush();
      now += 20;
      h.run(20);
    }
  };
  const down = all.map(() => new Downlink());
  /** The frames a session has been sent since last asked, by who spoke them. */
  const heardBy = (i: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const packet of wires[i]!.wire.got) {
      down[i]!.receive(packet, (speaker) => {
        const who = all.find((s) => s.voice.slot === speaker)!.name;
        out[who] = (out[who] ?? 0) + 1;
      });
    }
    wires[i]!.wire.got.length = 0;
    return out;
  };
  const hush = (): void => {
    h.run(700);
    all.forEach((_s, i) => heardBy(i));
  };
  expect(VOICE_RANGE[MODE_TALK]).toBe(25);
  hush();
  // Side by side, each hears the other; Cy, far off, hears neither, and nobody hears themselves.
  say(0, 25);
  say(1, 25);
  expect([heardBy(0), heardBy(1), heardBy(2)]).toEqual([{ bob: 25 }, { ada: 25 }, {}]);
  // He walks thirty metres off: her talk no longer reaches him, nor his her. A yell does.
  place(bob, 30);
  hush();
  say(0, 25);
  say(1, 25);
  expect([heardBy(0), heardBy(1), heardBy(2)]).toEqual([{}, {}, {}]);
  say(0, 25, MODE_YELL);
  expect([heardBy(1), heardBy(2)]).toEqual([{ ada: 25 }, {}]);
  // Back beside her, he hears her talk again. This time one frame in fifty is dropped on the way to him, as the server
  // drops what a slow listener cannot take: what he plays has no stall in it, only the lost frames covered over.
  place(bob, 1.5);
  hush();
  say(0, 100);
  const jb = new JitterBuffer();
  const sent = wires[1]!.wire.got;
  const packets = sent.filter((_p, k) => k % 50 !== 17);
  expect(sent.length - packets.length).toBe(2);
  const listen = new Downlink();
  const out = new Float32Array(FRAME_SAMPLES);
  let played = 0;
  for (const packet of packets) {
    listen.receive(packet, (_speaker, _flags, time, body) => jb.push(time, new Float32Array(FRAME_SAMPLES).fill(body[1]! + 1), false));
    if (jb.read(out.fill(0), FRAME_SAMPLES)) played++;
  }
  while (jb.read(out.fill(0), FRAME_SAMPLES)) played++;
  expect(listen.stats.frames).toBe(98);
  expect([jb.stats.restarts, jb.stats.missing, jb.stats.late]).toEqual([0, 2, 0]);
  expect(jb.stats.played).toBe(98);
  expect(played).toBeGreaterThanOrEqual(100);
  // Through all of it the server refused nothing and nobody was sent a frame they should not have had.
  expect([voice.stats.malformed, voice.stats.limited, voice.stats.dropped]).toEqual([0, 0, 0]);
  // And the game itself held up on that link: nothing a client could not read, and the books balance.
  for (const s of all) expect(s.stats.undecodable).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("round 4, building: two of a tribe make and build a two-floor house on a slope, are refused where it would stand too high, shut a stranger out, cook while away, come back to life upstairs, lose a foundation to grenades with what stood on it, and find the rest as it was after a restart", () => {
  const dbPath = join(dir, "building.db");
  const made = builder(["ada", "bob", "cy"], 40, 40, { dbPath });
  let { h } = made;
  const { rowOf, structs, count } = made;
  let [ada, bob, cy] = made.sessions as [ClientSession, ClientSession, ClientSession];
  const rec = (s: ClientSession) => h.host.records.byPid.get(h.client(s)!.pid)!;
  const kindAt = (ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  const hpAt = (ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.hp[ref & 0xffff]!;
  /** Ask for something to be done to a thing built, and say what the server answered. */
  const act = (s: ClientSession, ref: number, action: number): number => {
    let code = -1;
    s.onResult = (seq, c) => void (seq !== 0 && (code = c));
    s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), action === STRUCT_USE && w.u16(0xffff)));
    h.run(150);
    return code;
  };
  /** Take the piece of this name in hand and ask for it in place `socket` of `target`. */
  const put = (s: ClientSession, piece: string, target: number, socket: number, turn = 0, variant = 0): { code: number; ref: number } => made.join(s, piece, target, socket, turn, variant);
  const ok = (s: ClientSession, piece: string, target: number, socket: number, turn = 0, variant = 0): number => {
    const r = put(s, piece, target, socket, turn, variant);
    expect([piece, r.code]).toEqual([piece, RESULT_OK]);
    return r.ref;
  };
  /** Give a survivor one of a thing that is set down by itself, and set it down at (x, z): on the ground, or on top of `target`. */
  const setDown = (s: ClientSession, item: string, x: number, z: number, target = NO_TARGET): number => {
    h.say(s, `give ${item} 1`);
    const inv = s.inventory!;
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + 7), w.u16(0), w.u16(id(item))));
    h.run(100);
    s.command(CMD_SELECT, (w: BitWriter) => w.u8(7));
    h.run(100);
    const before = h.host.build.placed;
    s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(target), target !== NO_TARGET && w.u8(ON_TOP), w.sbits(Math.round(x * U), 32), w.sbits(Math.round(z * U), 32), w.u16(0), target === NO_TARGET && w.sbits(0, 8), w.u8(0)));
    h.run(150);
    expect([item, h.host.build.placed]).toEqual([item, before + 1]);
    return h.host.build.last;
  };

  // A tribe of two; Cy is a stranger.
  h.say(ada, "tribe create Masons");
  h.say(ada, "tribe invite bob");
  expect(h.say(bob, "tribe accept")[0]).toContain("You joined Masons");
  const team = rec(ada).team;
  expect([rec(bob).team, rec(cy).team === team]).toEqual([team, false]);

  // Bob makes a wall as anything is made: he learns it, and it is made of what he has gathered.
  h.say(bob, "addxp 20000");
  for (const [item, n] of [["wood", 40], ["thatch", 10], ["fiber", 7]] as const) h.say(bob, `give ${item} ${n}`);
  bob.command(CMD_LEARN, (w: BitWriter) => w.u16(id("engram-piece_wall_wood")));
  h.run(300);
  bob.command(CMD_CRAFT, (w: BitWriter) => (w.u16(id("make-piece_wall_wood")), w.u8(1)));
  h.run(6000);
  expect([count(bob, "wall"), made.has(bob, "wood"), made.has(bob, "thatch"), made.has(bob, "fiber")]).toEqual([STOCK + 1, 0, 0, 0]);

  // The slope: ten degrees, rising to the north. The house goes across it, its first foundation at the uphill end.
  const hf = h.world.hf;
  // (The strip is eight metres wide and the ground is sampled every two: the house keeps to the six in which every sample is the strip's.)
  const [fx, fz] = [SLOPE_X0 + 4.5, SLOPE_Z0 + 31];
  expect(hf.heightAt(fx, fz + 1.5) - hf.heightAt(fx, fz - 1.5)).toBeCloseTo(3 * SLOPE_TANS[0]!, 2);
  const stand = (s: ClientSession, x: number, z: number, y?: number): void => void h.say(s, y === undefined ? `tp ${x.toFixed(3)} ${z.toFixed(3)}` : `tp ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)}`);
  stand(ada, fx - 1, fz + 5);
  stand(bob, fx - 2.5, fz + 5);
  stand(cy, fx - 4, fz + 6);
  // Turned half way round, so that what the house calls north is downhill. Its top stands just clear of the highest ground under it.
  made.hold(ada, "foundation");
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(fx * U), 32), w.sbits(Math.round(fz * U), 32), w.u16(32768), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  expect(code).toBe(RESULT_OK);
  const sw = h.host.build.last;
  const floor = rowOf(sw)[2]! / U + FOUNDATION_THICK / 2;
  expect(floor - hf.heightAt(fx, fz + 1.5)).toBeGreaterThan(0);
  expect(floor - hf.heightAt(fx, fz + 1.5)).toBeLessThan(0.2);
  const nw = ok(ada, "foundation", sw, 0);
  const se = ok(ada, "foundation", sw, 1);
  const ne = ok(ada, "foundation", nw, 1);
  // All four at one height: the downhill pair stand clear of the ground, by what the slope falls in six metres.
  expect(new Set([sw, nw, se, ne].map((r) => rowOf(r)[2])).size).toBe(1);
  expect(rowOf(nw)[3]! / U).toBeCloseTo(fz - 3, 3);
  expect(floor - hf.heightAt(fx, fz - 4.5)).toBeGreaterThan(1);
  // The doorway is in the uphill wall, where the floor meets the ground; Ada builds the ground floor, the stairs and the floor above.
  const frame = ok(ada, "wall", sw, 2, 0, 1);
  const walls = [ok(ada, "wall", se, 2), ok(ada, "wall", se, 1), ok(ada, "wall", ne, 1), ok(ada, "wall", ne, 0), ok(ada, "wall", nw, 0, 0, 2), ok(ada, "wall", nw, 3), ok(ada, "wall", sw, 3)];
  ok(ada, "stairs", ne, 0, 0);
  const upSW = ok(ada, "ceiling", frame, 1);
  ok(ada, "ceiling", walls[0]!, 1);
  ok(ada, "ceiling", walls[4]!, 1);
  // Bob, of her tribe, builds on what she built: the upper walls (the last of them the one he made) and the roof.
  const upper = [frame, ...walls].map((w) => ok(bob, "wall", w, 0));
  for (const k of [0, 1, 5, 4]) ok(bob, "ceiling", upper[k]!, 1);
  expect(count(bob, "wall")).toBe(STOCK + 1 - 8);
  // Cy may not: it is not her tribe's.
  expect(put(cy, "wall", upper[2]!, 0).code).toBe(RESULT_NOT_YOURS);
  const door = ok(ada, "door", frame, 0);

  // A porch out over the fall of the slope: each foundation stands further clear of the ground, until one would stand too high.
  stand(ada, rowOf(nw)[1]! / U, rowOf(nw)[3]! / U, floor);
  const porch: number[] = [];
  let refused = -1;
  for (let from = nw; refused < 0 && porch.length < 6; ) {
    const r = put(ada, "foundation", from, 0);
    if (r.code === RESULT_OK) {
      porch.push(r.ref);
      from = r.ref;
      stand(ada, rowOf(from)[1]! / U, rowOf(from)[3]! / U, floor);
    } else refused = r.code;
  }
  // Two metres clear is the most: on ten degrees that is the third one out.
  expect([porch.length, refused]).toEqual([2, RESULT_TOO_HIGH]);
  // On the last of the porch, a wall along its west edge and a roof over it.
  const far = porch[1]!;
  const shelter = ok(ada, "wall", far, 1);
  const awning = ok(ada, "ceiling", shelter, 1);

  // In through the doorway from uphill; the door is hers to open, and Bob's; Cy, at the step, finds it locked.
  const ents = h.world.ents;
  const [doorX, doorZ] = [rowOf(frame)[1]! / U, rowOf(frame)[3]! / U];
  stand(cy, doorX - 1.2, doorZ + 2);
  stand(bob, doorX + 1.2, doorZ + 2);
  expect([act(cy, door, STRUCT_USE), kindAt(door)]).toEqual([RESULT_LOCKED, id("door_wood")]);
  expect([act(bob, door, STRUCT_USE), kindAt(door)]).toEqual([RESULT_OK, id("door_open_wood")]);
  stand(ada, doorX, doorZ + 2);
  const pilot = h.pilots[0]!;
  pilot.yaw = Math.PI;
  pilot.pitch = 0;
  pilot.moveZ = 1;
  h.run(900);
  pilot.moveZ = 0;
  h.run(300);
  expect(ents.z[h.ent(ada)]!).toBeLessThan(doorZ - 0.5);
  expect(Math.abs(ents.y[h.ent(ada)]! - floor)).toBeLessThan(0.05);
  expect([act(ada, door, STRUCT_USE), kindAt(door), act(cy, door, STRUCT_USE)]).toEqual([RESULT_OK, id("door_wood"), RESULT_LOCKED]);
  // Up the stairs, which rise downhill from the middle of the house, and she is a storey up.
  stand(ada, rowOf(ne)[1]! / U, rowOf(ne)[3]! / U + 3, floor);
  pilot.yaw = Math.PI;
  h.run(300);
  pilot.moveZ = 1;
  h.run(1500);
  pilot.moveZ = 0;
  h.run(300);
  expect(ents.y[h.ent(ada)]!).toBeGreaterThan(floor + RISE - 0.35);

  // A fire on the ground uphill of the house, with wood and meat on it, lit; and everyone goes away for a minute.
  stand(ada, fx - 1.5, fz + 7.5);
  const fire = setDown(ada, "piece_campfire", fx - 1.5, fz + 6);
  const hearth = h.host.fixtures.ensure(fire);
  h.host.items.mint(hearth, id("wood"), 2);
  h.host.items.mint(hearth, id("meat"), 3);
  expect([act(cy, fire, STRUCT_LIGHT), act(ada, fire, STRUCT_LIGHT), kindAt(fire)]).toEqual([RESULT_NOT_YOURS, RESULT_OK, id("campfire_lit")]);
  // A bed on the upper floor, over the doorway.
  const bed = setDown(ada, "piece_bed", rowOf(upSW)[1]! / U, rowOf(upSW)[3]! / U, upSW);
  const bedTop = h.world.structs.chunks[Math.floor(bed / 65536)]!.y[bed & 0xffff]! + 0.25;
  for (const s of [ada, bob, cy]) stand(s, fx + 150, fz - 150);
  h.run(62000);
  // Nobody was there: the wood burned out when it was due to, and all three pieces are cooked.
  expect([kindAt(fire), h.host.items.inv(hearth).total(id("meat_cooked")), h.host.items.inv(hearth).total(id("meat")), h.host.items.inv(hearth).total(id("wood"))]).toEqual([id("campfire"), 3, 0, 0]);

  // She dies out there, and comes back to life at her bed: upstairs, standing on it.
  h.say(ada, "suicide");
  h.run(300);
  expect(ada.sessionState).toBe(SESSION_DEAD);
  const spawns = h.world.spawns.length;
  expect(ada.respawnPoints.length).toBe(spawns + 1);
  code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  ada.command(CMD_RESPAWN, (w: BitWriter) => w.u8(spawns));
  h.run(600);
  expect([code, ada.sessionState]).toEqual([RESULT_OK, SESSION_ALIVE]);
  expect([Math.abs(ada.own.x - rowOf(upSW)[1]! / U) < 0.5, Math.abs(ada.own.y - bedTop) < 0.1, bedTop - floor > 3]).toEqual([true, true, true]);

  // Grenades on the far foundation of the porch, by the table: 788 to wood each, 15,000 to go through. Nineteen leave it standing.
  stand(bob, rowOf(nw)[1]! / U, rowOf(nw)[3]! / U, floor);
  h.run(500);
  const grenade = id("grenade");
  const [gx, gy, gz] = [rowOf(far)[1]! / U, rowOf(far)[2]! / U, rowOf(far)[3]! / U];
  const src: Source = { by: rec(cy), x: gx, z: gz - 10, item: grenade, base: reg.damage[grenade]!, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  expect([reg.damage[grenade], reg.blast[grenade], reg.maxHp[kindAt(far)]]).toEqual([788, 5, 15000]);
  // (Each lands under its east edge, the far side from the wall, which takes what three metres leave of it.)
  const burst = (): void => h.host.combat.blast(src, gx + 1.4, gy - FOUNDATION_THICK / 2 - 0.05, gz, reg.blast[grenade]!);
  expect(rowOf(shelter)[1]! / U).toBeCloseTo(gx - 1.5, 2);
  for (let k = 0; k < 19; k++) burst();
  h.run(200);
  expect([hpAt(far), kindAt(far) !== 0, kindAt(shelter) !== 0, kindAt(awning) !== 0]).toEqual([15000 - 19 * 788, true, true, true]);
  // The twentieth takes it, and what stood on it falls: the wall, and the roof the wall held. Bob, on the porch's other piece, sees them go.
  const fallen = h.host.build.fallen;
  const houseCount = structs.count;
  burst();
  h.run(1500);
  expect([kindAt(far), kindAt(shelter), kindAt(awning), h.host.build.fallen - fallen, houseCount - structs.count]).toEqual([0, 0, 0, 2, 3]);
  const bobsView = bob.world!.structs.chunks[Math.floor(far / 65536)]!;
  expect([bobsView.kind[far & 0xffff], bobsView.kind[shelter & 0xffff], bobsView.kind[awning & 0xffff], bobsView.kind[porch[0]! & 0xffff] !== 0]).toEqual([0, 0, 0, true]);
  // The rest stands: the house was out of its reach, and the porch's first piece took what its distance left of each.
  expect([hpAt(sw), hpAt(nw) > 0, kindAt(porch[0]!) !== 0, hpAt(porch[0]!) < 15000]).toEqual([15000, true, true, true]);

  // The world stops and starts. Everything is as it was: the house, the door shut and its tribe's, the bed, the fire out with its meat, the tribe; and the books balance.
  expect(h.host.items.audit()).toEqual([]);
  const standing = structs.count;
  const cooked = hearth.pid;
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  [ada, bob, cy] = ["ada", "bob", "cy"].map((n) => h.join(n)) as [ClientSession, ClientSession, ClientSession];
  h.run(900);
  expect(h.host.items.audit()).toEqual([]);
  expect([h.world.structs.count, kindAt(door), kindAt(fire), kindAt(bed), kindAt(far), hpAt(porch[0]!) < 15000]).toEqual([standing, id("door_wood"), id("campfire"), id("bed"), 0, true]);
  expect(h.host.items.inv(h.host.records.byPid.get(cooked)!).total(id("meat_cooked"))).toBe(3);
  expect([ada.tribe.name, bob.tribe.name, cy.tribe.name, rec(bob).team]).toEqual(["Masons", "Masons", "", team]);
  // Still shut to the stranger, still open to the tribe.
  for (const s of [bob, cy]) h.say(s, "enablecheats");
  stand(cy, doorX - 1.2, doorZ + 2);
  stand(bob, doorX + 1.2, doorZ + 2);
  expect([act(cy, door, STRUCT_USE), act(bob, door, STRUCT_USE), kindAt(door)]).toEqual([RESULT_LOCKED, RESULT_OK, id("door_open_wood")]);
  // And Bob, dying, is offered the tribe's bed.
  h.say(bob, "suicide");
  h.run(400);
  expect(bob.respawnPoints.length).toBe(h.world.spawns.length + 1);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  void TICK_RATE;
});

test("round 4, creatures: a survivor is hunted by a raptor; tames a parasaur at the reference's numbers, names it, saddles it and rides it; breeds it; and what hatches is taken, fed, and grows up across a restart, with the books balanced", () => {
  const dbPath = join(dir, "creatures.db");
  let h = new Harness({}, 1, 60, { dev: true, dbPath });
  let ada = h.join("ada");
  h.run(600);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 100, 30);
  const at = { x: g.x + 20, z: g.z + 15 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  let ents = h.world.ents;
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  const pilot = h.pilots[0]!;
  /** Turn to entity `e`, `up` of the way up it. */
  const lookAt = (e: number, up: number): void => {
    const self = h.ent(ada);
    const eye = ents.y[self]! + stanceEye(h.reg.move[ents.kind[self]!]!, 0);
    const [dx, dz] = [ents.x[e]! - ents.x[self]!, ents.z[e]! - ents.z[self]!];
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * up - eye, Math.hypot(dx, dz));
    h.run(200);
  };
  /** Look at it and press the use button. Returns what the server said unasked, or -1. */
  const use = (e: number, up = 0.5): number => {
    lookAt(e, up);
    let told = -1;
    ada.onResult = (seq, c) => void (seq === 0 && (told = c));
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(250);
    return told;
  };
  /** Send a command and say what the server answered. */
  const ask = (op: number, write: (w: BitWriter) => unknown): number => {
    let code = -1;
    ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
    ada.command(op, write);
    h.run(200);
    return code;
  };
  /** Give her some of an item and put all of it into slot `slot` of the creature she has open. */
  const stock = (item: string, n: number, slot: number): void => {
    h.say(ada, `give ${item} ${n}`);
    const inv = ada.inventory!;
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_OPEN, 1), w.varint(slot), w.u16(0), w.u16(id(item))));
    h.run(200);
  };

  // 1. A raptor eighteen metres off sees her, runs her down, and bites. She has the means to end it.
  const raptor = h.host.spawnCreature("core:raptor", at.x + 18, at.z, 5);
  const mind = h.host.creatures.mind;
  const whole = h.host.survival.value(me, V_HEALTH);
  for (let k = 0; k < 100 && h.host.survival.value(me, V_HEALTH) >= whole; k++) h.run(200);
  expect([mind.mind[raptor], mind.targetOf(raptor), mind.hunts >= 1, mind.bites >= 1]).toEqual([MIND_HUNT, h.ent(ada), true, true]);
  expect(h.host.survival.value(me, V_HEALTH)).toBeLessThan(whole);
  expect(Math.hypot(ents.x[raptor]! - ents.x[h.ent(ada)]!, ents.z[raptor]! - ents.z[h.ent(ada)]!)).toBeLessThan(4);
  lookAt(raptor, 0.5);
  expect(h.say(ada, "kill")[0]).toBe("killed core:raptor");
  h.host.survival.refill(me);

  // 2. A parasaur of level 10, knocked out four metres from her, and fed berries. The reference's arithmetic: it needs
  //    1500 + 75 x 10 = 2250; a berry is worth 20 x 4 = 80, so 29 berries; lying there it wants one every 12 seconds;
  //    and 29 of them leave an effectiveness of 1 / (1 + 0.4 x 29 / 80) = 87.3%, which is four more levels.
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  let dolly = h.host.spawnCreature("core:parasaur", at.x, at.z + 4, 10);
  let rec = h.host.records.byPid.get(ents.pid[dolly]!)!;
  mind.stay(dolly, h.world.tick + 60);
  h.host.survival.add(rec, V_TORPOR, rec.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(100);
  const down = h.world.tick;
  expect([rec.out, rec.tame !== null, rec.genome!.level]).toEqual([true, true, 10]);
  expect(use(dolly)).toBe(-1);
  expect(ada.subject).toMatchObject({ taming: true, owned: false, level: 10 });
  stock("berry", 40, 0);
  let wonAt = -1;
  const stay = mind.stay.bind(mind);
  mind.stay = (who, until) => {
    if (until === 0xffffffff && who === dolly && wonAt < 0) wonAt = h.world.tick;
    stay(who, until);
  };
  for (let k = 0; k < 500 && rec.tame; k++) h.run(1000);
  h.run(300);
  mind.stay = stay;
  expect([rec.tame, rec.team, rec.out, h.host.taming.bites, rec.genome!.level, h.host.items.inv(rec).total(id("berry"))]).toEqual([null, me.team, false, 29, 14, 11]);
  expect(rec.te).toBeCloseTo(1 / (1 + (0.4 * 29) / 80), 6);
  expect(Math.abs(wonAt - down - 29 * 12 * TICK_RATE)).toBeLessThan(30);
  expect(ada.tamed.at(-1)).toEqual({ handle: ents.handleOf(dolly), kind: id("parasaur"), level: 14, te: 87 });

  // 3. She names it, and it is called that by everyone.
  expect(ask(CMD_NAME, (w) => (w.u32(ents.handleOf(dolly)), w.string("Dolly")))).toBe(RESULT_OK);
  expect([rec.name, ents.name[dolly]]).toEqual(["Dolly", "Dolly"]);
  ada.tamed.length = 0;

  // 4. A saddle on it, and she rides: her inputs drive it, and nothing the server says corrects where she thought it was.
  if (!ada.open) ask(CMD_OPEN, (w) => w.u32(dolly));
  stock("saddle_parasaur", 1, 5);
  expect(ask(CMD_FEED, (w) => (w.varint(5), w.u16(id("saddle_parasaur"))))).toBe(RESULT_OK);
  expect(rec.saddle).toBe(id("saddle_parasaur"));
  ada.command(CMD_CLOSE);
  h.run(200);
  expect(use(dolly)).toBe(-1);
  expect([h.client(ada)!.drive, ada.driving, ents.seat[h.ent(ada)]]).toEqual([dolly, dolly, dolly + 1]);
  pilot.yaw = Math.PI / 2;
  pilot.pitch = 0;
  h.run(1500);
  const from = { x: ents.x[dolly]!, z: ents.z[dolly]! };
  const corrections = ada.stats.corrections;
  pilot.moveZ = 1;
  h.run(4000);
  pilot.moveZ = 0;
  h.run(600);
  expect(ents.x[dolly]! - from.x).toBeGreaterThan(6);
  expect(Math.abs(ents.z[dolly]! - from.z)).toBeLessThan(2);
  expect([ada.stats.corrections - corrections, ada.own.x, ada.own.z]).toEqual([0, ents.x[dolly]!, ents.z[dolly]!]);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(400);
  expect([h.client(ada)!.drive, ents.driven[dolly], ents.seat[h.ent(ada)]]).toEqual([-1, 0, 0]);

  // 5. A mate for it, of the other sex, had for the asking; both told they may. Half a minute, and there is an egg.
  //    (Hatching five hundred times as fast and growing up a thousand times: ten seconds, and ninety-five.)
  h.say(ada, "rule hatchSpeed 500");
  h.say(ada, "rule matureSpeed 1000");
  const mate = h.host.spawnCreature("core:parasaur", ents.x[dolly]! + 4, ents.z[dolly]! + 1, 12);
  const mateRec = h.host.records.byPid.get(ents.pid[mate]!)!;
  mateRec.genome!.female = !rec.genome!.female;
  mind.stay(mate, h.world.tick + 300);
  h.say(ada, `tp ${(ents.x[dolly]! + 2).toFixed(3)} ${(ents.z[dolly]! - 5).toFixed(3)}`);
  lookAt(mate, 0.5);
  expect(h.say(ada, "forcetame")[0]).toBe("tamed core:parasaur level 12");
  ada.tamed.length = 0;
  expect([ask(CMD_ORDER, (w) => (w.u32(dolly), w.u8(ORDER_MATE))), ask(CMD_ORDER, (w) => (w.u32(mate), w.u8(ORDER_MATE)))]).toEqual([RESULT_OK, RESULT_OK]);
  h.run(32500);
  const breeding = h.host.breeding;
  const laid = [...h.host.records.byPid.values()].filter((r) => r.egg !== null);
  expect([breeding.mated, laid.length >= 1]).toEqual([1, true]);
  const mother = rec.genome!.female ? rec : mateRec;
  const motherEnt = rec.genome!.female ? dolly : mate;
  expect([laid[0]!.genome!.mother, laid[0]!.genome!.father, mother.mateReadyAt > h.world.tick]).toEqual([mother.pid, (rec.genome!.female ? mateRec : rec).pid, true]);
  const egg = laid[0]!;
  const hatchAt = egg.egg!.hatchAt;
  expect(hatchAt - egg.egg!.laidAt).toBe(Math.ceil((5142 * TICK_RATE) / 500));
  // She waits by the egg, on the side away from the mother.
  const off = Math.hypot(egg.x - ents.x[motherEnt]!, egg.z - ents.z[motherEnt]!);
  const [ux, uz] = [(egg.x - ents.x[motherEnt]!) / off, (egg.z - ents.z[motherEnt]!) / off];
  h.say(ada, `tp ${(egg.x + ux * 1.5).toFixed(3)} ${(egg.z + uz * 1.5).toFixed(3)}`);
  while (h.world.tick <= hatchAt + 5) h.run(500);
  let baby = [...h.host.records.byPid.values()].find((r) => r.grown !== 0 && r.x === egg.x && r.z === egg.z)!;
  let babyEnt = h.host.records.entOf.get(baby.pid)!;
  expect([baby.born, baby.team, breeding.unclaimed(baby), baby.genome === egg.genome]).toEqual([hatchAt, 0, true, true]);
  // She takes it, names it, and puts berries in it. It is hers, small, and eating.
  expect(use(babyEnt, 0.08)).toBe(-1);
  expect([baby.team, ada.tamed.at(-1)?.te]).toEqual([me.team, 255]);
  expect(ask(CMD_NAME, (w) => (w.u32(ents.handleOf(babyEnt)), w.string("Pip")))).toBe(RESULT_OK);
  ada.tamed.length = 0;
  expect(use(babyEnt, 0.08)).toBe(-1);
  expect(ada.subject).toMatchObject({ owned: true, breeds: true });
  expect(ada.subject!.stage).toBeLessThan(3);
  stock("berry", 80, 0);
  ada.command(CMD_CLOSE);
  h.run(200);
  // (Hungry as it is, it has one as soon as she shuts it.)
  const stocked = h.host.items.inv(baby).total(id("berry"));
  expect([stocked <= 80, stocked >= 78]).toEqual([true, true]);
  h.run(30000);
  expect(h.host.items.inv(baby).total(id("berry"))).toBeLessThan(stocked);
  expect(h.host.items.audit()).toEqual([]);

  // The world stops and starts with it a third grown. Everything is whose it was and called what it was; the young one is still young, and grows.
  const [dollyPid, matePid, babyPid, grownAt] = [rec.pid, mateRec.pid, baby.pid, baby.grown];
  const before = { born: baby.born, grown: baby.grown, berries: h.host.items.inv(baby).total(id("berry")), food: baby.vitals!.at(V_FOOD, h.world.tick) };
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  const get = (pid: number): EntityRecord => h.host.records.byPid.get(pid)!;
  // (Asked before a tick has passed: it has in it exactly what it had.)
  expect({ born: get(babyPid).born, grown: get(babyPid).grown, berries: h.host.items.inv(get(babyPid)).total(id("berry")), food: get(babyPid).vitals!.at(V_FOOD, h.world.tick) }).toEqual(before);
  ada = h.join("ada");
  h.run(600);
  ents = h.world.ents;
  expect(h.host.items.audit()).toEqual([]);
  rec = get(dollyPid);
  baby = get(babyPid);
  dolly = h.host.records.entOf.get(dollyPid)!;
  babyEnt = h.host.records.entOf.get(babyPid)!;
  const team = get(h.client(ada)!.pid).team;
  expect([rec.name, rec.team, rec.saddle, rec.mating, rec.genome!.level, ents.name[dolly]]).toEqual(["Dolly", team, id("saddle_parasaur"), true, 14, "Dolly"]);
  expect([get(matePid).team, get(matePid).mating]).toEqual([team, true]);
  expect([baby.name, baby.team, ents.team[babyEnt], ents.born[babyEnt], ents.grown[babyEnt]]).toEqual(["Pip", team, team, before.born, before.grown]);
  while (h.world.tick <= grownAt + 5) h.run(500);
  // Grown: full size, a grown one's limits, alive and fed; and it has eaten of what she gave it since.
  // (Any other of the litter, which nobody took, has grown too.)
  expect([baby.born, baby.grown, ents.grown[babyEnt], h.host.breeding.grownUp >= 1, h.host.taming.meals >= 1]).toEqual([0, 0, 0, true, true]);
  expect(h.host.survival.value(baby, V_HEALTH)).toBeGreaterThan(0);
  expect(h.host.survival.value(baby, V_FOOD)).toBeGreaterThan(0);
  expect(h.host.items.inv(baby).total(id("berry"))).toBeLessThan(before.berries);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});
