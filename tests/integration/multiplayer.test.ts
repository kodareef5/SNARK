import { expect, test } from "bun:test";
import { RemoteSample } from "../../client/core/session.ts";
import { chunkCx, chunkCz } from "../../shared/coords.ts";
import { handleIndex } from "../../shared/ids.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { C_INPUT, PROTOCOL_VERSION, REJECT_CONTENT, REJECT_VERSION, writeHello } from "../../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../../shared/net/transport.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_JUMP, BTN_SPRINT } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { Harness, testKey, type Pilot } from "../fixtures/net.ts";

function wander(p: Pilot, rng: Rng): void {
  p.moveX = rng.range(-1, 1);
  p.moveZ = rng.range(-0.2, 1);
  p.yaw = rng.range(0, 6.283);
  p.buttons = (rng.int(4) === 0 ? BTN_JUMP : 0) | (rng.int(2) === 0 ? BTN_SPRINT : 0);
}

test("two clients join, move, and see each other where the server says they are", () => {
  const h = new Harness();
  const a = h.join("ada", { latencyMs: 40 });
  const b = h.join("bo", { latencyMs: 40 });
  h.run(500);
  expect(a.state).toBe("active");
  expect(b.state).toBe("active");
  expect(h.server.playerCount).toBe(2);

  h.pilots[0]!.moveZ = 1; // ada walks north
  h.pilots[1]!.moveX = 1; // bo strafes
  h.run(3000);
  h.pilots[0]!.moveZ = 0;
  h.pilots[1]!.moveX = 0;
  h.run(1000);

  const ents = h.world.ents;
  const ea = h.ent(a);
  const eb = h.ent(b);
  expect(ents.z[ea]! - 240).toBeGreaterThan(12); // 3 s at 4.5 m/s
  // Each client's prediction of itself equals the authoritative body exactly once at rest.
  expect(a.own.x).toBe(ents.x[ea]!);
  expect(a.own.z).toBe(ents.z[ea]!);
  expect(b.own.x).toBe(ents.x[eb]!);

  // Each sees the other within wire precision (1/256 m).
  const seen = new RemoteSample();
  a.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(seen.id[0]).toBe(handleIndex(b.ownHandle));
  expect(Math.abs(seen.x[0]! - ents.x[eb]!)).toBeLessThan(0.005);
  expect(Math.abs(seen.z[0]! - ents.z[eb]!)).toBeLessThan(0.005);
  b.sampleRemote(seen);
  expect(seen.count).toBe(1);
  expect(Math.abs(seen.z[0]! - ents.z[ea]!)).toBeLessThan(0.005);

  // Both received every structure within interest (3 chunks) by chunk sync, and none beyond.
  for (const s of [a, b]) {
    const e = h.ent(s);
    const cx = chunkCx(h.world.dims, ents.chunk[e]!);
    const cz = chunkCz(h.world.dims, ents.chunk[e]!);
    let expected = 0;
    h.world.structs.chunks.forEach((t, chunk) => {
      const near = Math.abs(chunkCx(h.world.dims, chunk) - cx) <= 3 && Math.abs(chunkCz(h.world.dims, chunk) - cz) <= 3;
      if (t && near) expected += t.live;
    });
    expect(expected).toBeGreaterThan(90);
    expect(s.world!.structs.count).toBe(expected);
  }
});

test("on a clean link, prediction is never corrected", () => {
  const h = new Harness();
  const s = h.join("solo", { latencyMs: 60 });
  h.run(1000);
  const rng = new Rng(5);
  const settled = s.stats.corrections;
  // Roam through structures, slopes and stairs for 40 seconds.
  for (let i = 0; i < 80; i++) {
    wander(h.pilots[0]!, rng);
    h.run(500);
  }
  expect(s.stats.corrections - settled).toBe(0);
  expect(s.stats.undecodable).toBe(0);
  expect(h.server.stats.heldInputs).toBeLessThan(40); // only around the initial clock sync
});

test("a client that joins a world that has been running for a while can move", () => {
  // Round 1 missed this: before any input arrived the server reported a margin
  // of minus its own tick, and the client jumped its clock out of the input window.
  for (const [upMs, latencyMs] of [[100, 0], [1000, 30], [3000, 80], [20000, 150]] as const) {
    const h = new Harness();
    h.run(upMs);
    const s = h.join("late", { latencyMs });
    h.run(1000);
    h.pilots[0]!.moveZ = 1;
    h.run(2000);
    h.pilots[0]!.moveZ = 0;
    h.run(1000);
    const e = h.ent(s);
    expect(h.world.ents.z[e]! - 240).toBeGreaterThan(8);
    expect(s.own.z).toBe(h.world.ents.z[e]!);
    expect(s.stats.clockJumps).toBeLessThanOrEqual(2);
    expect(s.simTick - h.world.tick).toBeLessThan(4 + (latencyMs * 2 * 30) / 1000 + 3);
  }
});

test("a client whose clock has run far ahead is told so and comes back", () => {
  const h = new Harness();
  const s = h.join("skew", { latencyMs: 20 });
  h.run(1000);
  s.tickClock += 300; // ten seconds ahead: every input it sends is outside the server's window
  h.pilots[0]!.moveZ = 1;
  h.run(5000); // about two seconds to come back, then it walks
  h.pilots[0]!.moveZ = 0;
  h.run(1000);
  expect(s.stats.clockJumps).toBeLessThan(6);
  expect(s.simTick - h.world.tick).toBeLessThan(10);
  const e = h.ent(s);
  expect(h.world.ents.z[e]! - 240).toBeGreaterThan(6);
  expect(s.own.z).toBe(h.world.ents.z[e]!);
});

test("under latency, jitter and loss, clients stay playable and converge", () => {
  const h = new Harness({}, 9);
  const link = { latencyMs: 75, jitterMs: 30, loss: 0.05 };
  const sessions = [h.join("p1", link), h.join("p2", link), h.join("p3", link)];
  h.run(1500);
  const rng = new Rng(12);
  let worst = 0;
  const ents = h.world.ents;
  const held0 = h.server.stats.heldInputs;
  for (let i = 0; i < 40; i++) {
    for (const p of h.pilots) wander(p, rng);
    h.run(500, () => {
      // The local body must always be in legal space, even mid-correction.
      for (const s of sessions) {
        const m = h.reg.move[s.ownKind]!;
        if (!capsuleFree(s.world!, s.own.x, s.own.y, s.own.z, m.radius, m.height)) throw new Error("client body in solid");
      }
    });
  }
  for (const p of h.pilots) {
    p.moveX = 0;
    p.moveZ = 0;
    p.buttons = 0;
  }
  h.run(2000);
  for (const s of sessions) {
    const e = h.ent(s);
    worst = Math.max(worst, Math.hypot(s.own.x - ents.x[e]!, s.own.y - ents.y[e]!, s.own.z - ents.z[e]!));
    // 5% loss with 4-fold input redundancy: a missed input needs four losses in a row.
    expect(s.stats.snapshots).toBeGreaterThan(500);
  }
  expect(worst).toBe(0);
  const ticks = 20 * 30 * 3;
  expect((h.server.stats.heldInputs - held0) / ticks).toBeLessThan(0.01);
  const seen = new RemoteSample();
  sessions[0]!.sampleRemote(seen);
  expect(seen.count).toBe(2);
});

test("a hostile client cannot move faster, teleport, or crash the server", () => {
  const h = new Harness();
  const honest = h.join("honest");
  const end = h.net.connect();
  let closed = false;
  end.onClose = () => (closed = true);
  const w = new BitWriter(256);
  writeHello(w, PROTOCOL_VERSION, h.reg.hash, "mallory", 0, testKey("mallory"));
  end.send(CH_RELIABLE, w.bytes());
  h.run(200);
  expect(h.server.playerCount).toBe(2);
  const mallory = h.server.clients.find((c) => c?.name === "mallory")!;
  const ents = h.world.ents;
  const x0 = ents.x[mallory.ent]!;
  const z0 = ents.z[mallory.ent]!;

  const rng = new Rng(666);
  let maxStep = 0;
  for (let i = 0; i < 300; i++) {
    const px = ents.x[mallory.ent]!;
    const pz = ents.z[mallory.ent]!;
    // Every tick: inputs for many future ticks at once, with out-of-range fields,
    // plus garbage, truncated and oversized messages.
    for (let k = 0; k < 6; k++) {
      w.reset();
      w.bits(C_INPUT, 4);
      w.u32(0xffffffff); // ack for a snapshot never sent
      w.u32(h.world.tick + 1 + rng.int(40));
      w.bits(7, 3);
      for (let n = 0; n < 8; n++) {
        if (n > 0) w.bool(false);
        w.sbits(-128, 8);
        w.sbits(127, 8);
        w.u16(rng.int(65536));
        w.sbits(-32768, 16);
        w.u8(0xff);
      }
      end.send(CH_UNRELIABLE, w.bytes());
    }
    const junk = new Uint8Array(rng.int(3) === 0 ? 4000 : rng.int(40));
    for (let n = 0; n < junk.length; n++) junk[n] = rng.int(256);
    end.send(rng.int(2), junk);
    h.run(1000 / 30);
    if (closed) break;
    maxStep = Math.max(maxStep, Math.hypot(ents.x[mallory.ent]! - px, ents.z[mallory.ent]! - pz));
    const m = h.reg.move[ents.kind[mallory.ent]!]!;
    expect(capsuleFree(h.world, ents.x[mallory.ent]!, ents.y[mallory.ent]!, ents.z[mallory.ent]!, m.radius, m.height)).toBe(true);
  }
  // Sprint speed is 7.2 m/s: 0.24 m per tick, however many inputs were sent.
  expect(maxStep).toBeLessThan(0.25);
  expect(Math.hypot(ents.x[mallory.ent]! - x0, ents.z[mallory.ent]! - z0)).toBeLessThan(0.24 * 300);
  // Flooding with malformed messages ends in disconnection, and the honest player is unaffected.
  expect(h.server.stats.malformed).toBeGreaterThan(0);
  for (let i = 0; i < 400 && !closed; i++) {
    end.send(CH_RELIABLE, new Uint8Array([0xff, 0xff]));
    h.run(40);
  }
  expect(closed).toBe(true);
  expect(h.server.playerCount).toBe(1);
  expect(honest.state).toBe("active");
});

test("version and content mismatches are refused with a reason", () => {
  const h = new Harness();
  const reasons: number[] = [];
  for (const [version, hash] of [[PROTOCOL_VERSION + 1, h.reg.hash], [PROTOCOL_VERSION, h.reg.hash ^ 1]] as const) {
    const end = h.net.connect();
    end.onMessage = (_ch, data) => reasons.push(data[0]! >> 4 | (data[1]! << 4) & 0xff);
    const w = new BitWriter(64);
    writeHello(w, version, hash, "x", 0, testKey("x"));
    end.send(CH_RELIABLE, w.bytes());
    h.run(100);
    expect(end.open).toBe(false);
  }
  expect(reasons).toEqual([REJECT_VERSION, REJECT_CONTENT]);
  expect(h.server.playerCount).toBe(0);
});

test("a crowded scene is delivered within the byte budget and still converges", () => {
  const h = new Harness({ snapshotBytes: 300 }, 3, 30);
  const watcher = h.join("watcher");
  h.run(300);
  // 120 server-side bodies milling around the spawn.
  const kind = h.reg.index.get("core:grazer")!;
  const ents = h.world.ents;
  const rng = new Rng(8);
  const herd: number[] = [];
  for (let i = 0; i < 120; i++) herd.push(ents.create(kind, rng.range(236, 276), 0, rng.range(222, 256), 0));
  h.server.onStep = () => {
    for (const e of herd) ents.setPosition(e, ents.x[e]! + rng.range(-0.1, 0.1), 0, ents.z[e]! + rng.range(-0.1, 0.1));
  };
  const before = h.ends[0]!.peer.bytesSent;
  h.run(3000);
  const perSnapshot = (h.ends[0]!.peer.bytesSent - before) / 90;
  expect(perSnapshot).toBeLessThan(300 + 40);
  h.server.onStep = null;
  h.run(2000);
  const seen = new RemoteSample();
  watcher.sampleRemote(seen);
  expect(seen.count).toBe(120);
  for (let i = 0; i < seen.count; i++) {
    const e = seen.id[i]!;
    expect(Math.abs(seen.x[i]! - ents.x[e]!)).toBeLessThan(0.005);
    expect(Math.abs(seen.z[i]! - ents.z[e]!)).toBeLessThan(0.005);
  }
});
