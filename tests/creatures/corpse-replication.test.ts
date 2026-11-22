import { expect, test } from "bun:test";
import { Corpses as Drawn } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { joinClips } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { decodeCorpseCheckpoint } from "../../shared/net/corpse.ts";
import { CMD_CORPSE, RESULT_BUSY, RESULT_INVALID, RESULT_OK, S_CORPSE } from "../../shared/net/protocol.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { BIRD, BIRD_RIG, birdSet } from "../fixtures/bird.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

function camp() {
  const set = birdSet(), mesh = "core:dodo";
  const clips = joinClips([{ ...set, clips: set.clips.map(c => ({ ...c, id: c.id.replace(BIRD, mesh) })) }]);
  const h = new Harness({}, 1, 60, { dev: true, clips, rigs: [{ ...BIRD_RIG, id: mesh }], map: writeMap(flatMap(2)) });
  const s = h.join("witness", { latencyMs: 50, tcp: true }); h.run(700);
  const c = h.client(s)!, ents = h.world.ents;
  ents.setPosition(c.ent, 40, 0, 40); h.run(100);
  return { h, s, c, ents };
}
function killed(h: Harness, x = 42, z = 42, y = 0) {
  const e = h.host.spawnCreature("core:dodo", x, z, 1), ents = h.world.ents;
  if (y) ents.setPosition(e, x, y, z);
  const victim = h.host.records.byPid.get(ents.pid[e]!)!;
  h.host.survival.hurt(victim, 1e6, 0, undefined,
    { victimPid: victim.pid, victimHandle: makeHandle(e, ents.gen[e]!), vx: 8, vy: 5, vz: 1, wx: 1, wy: 2, wz: 3 });
  const b = [...h.host.corpses.bodies.values()].at(-1)!;
  expect(h.host.corpses.motionRevision(b.e)).toBe(1);
  return b;
}

test("a delayed observer receives the current authoritative corpse motion and can request a bounded refresh", () => {
  const { h, s, c, ents } = camp();
  try {
    const body = killed(h), id = makeHandle(body.e, ents.gen[body.e]!); h.run(400);
    const first = s.corpseMotions.get(id)!;
    expect(first).toBeDefined(); expect(decodeCorpseCheckpoint(first.data)).not.toBeNull();
    const drawn = new Drawn(h.world.anims), remote = new RemoteSample();
    remote.count = 1; remote.id[0] = body.e; remote.gen[0] = ents.gen[body.e]!; remote.kind[0] = body.kind; remote.yaw[0] = body.yaw; remote.span[0] = ents.span[body.e]!;
    remote.x[0] = body.x; remote.y[0] = body.y; remote.z[0] = body.z; remote.cue[0] = ents.cue[body.e]!; remote.anim[0] = ents.anim[body.e]!; remote.tick = first.tick;
    drawn.update(remote, h.world, 40, 40, new Map(), s.corpseMotions);
    expect(drawn.list[0]!.motionRevision).toBe(first.revision);
    expect(drawn.list[0]!.fall!.ragdoll.checkpoint()).toEqual(decodeCorpseCheckpoint(first.data)!.state);
    const codes: number[] = []; s.onResult = (_seq, code) => codes.push(code);
    const request = (handle: number) => s.command(CMD_CORPSE, w => { w.u8(1); w.u32(handle); });
    request(id); request(id); h.run(250);
    expect(codes).toEqual([RESULT_OK, RESULT_BUSY]); expect(s.corpseMotions.get(id)!.tick).toBeGreaterThan(first.tick);
    request(makeHandle(body.e, ents.gen[body.e]! + 1)); h.run(200);
    expect(codes.at(-1)).toBe(RESULT_INVALID);
    // A second connection arrives after the original impact. It receives the current state, not the launch again.
    const late = h.join("late-witness", { latencyMs: 80, tcp: true }); h.run(1000);
    ents.setPosition(h.client(late)!.ent, ents.x[c.ent]!, 0, ents.z[c.ent]!); h.run(400);
    expect(late.corpseMotions.get(id)!.tick).toBeGreaterThan(first.tick);
  } finally { h.host.shutdown(); }
});

test("a late client waits for an impact checkpoint's render tick and its first drawn airborne pose matches authority", () => {
  const { h, ents } = camp();
  try {
    const body = killed(h, 42, 42, 60), id = makeHandle(body.e, ents.gen[body.e]!);
    const truth = new Map<number, { x: Float64Array; q: Float64Array }>(), tick = h.server.tick.bind(h.server);
    h.server.tick = () => { tick(); const r = body.fall!.ragdoll; truth.set(h.world.tick, { x: r.x.slice(), q: r.q.slice() }); };
    h.run(1000);
    const late = h.join("first-sight", { latencyMs: 50, tcp: true }), remote = new RemoteSample(), drawn = new Drawn(h.world.anims);
    let waiting = 0, compared = 0;
    h.run(2000, () => {
      if (!late.world) return;
      late.sampleRemote(remote);
      drawn.update(remote, late.world, 42, 42, new Map(), late.corpseMotions);
      const visible = remote.id.subarray(0, remote.count).includes(body.e), motion = late.corpseMotions.get(id);
      if (!visible || !motion) return;
      const shown = drawn.list.find(c => c.id === body.e);
      if (motion.tick > Math.floor(remote.tick)) { expect(shown).toBeUndefined(); waiting++; return; }
      expect(shown?.motionRevision).toBeGreaterThan(0);
      expect(shown!.settling).toBe(false);
      const expected = truth.get(Math.floor(remote.tick))!;
      expect(shown!.fall!.ragdoll.x).toEqual(expected.x);
      expect(shown!.fall!.ragdoll.q).toEqual(expected.q);
      compared++;
    });
    expect(waiting).toBeGreaterThan(0); expect(compared).toBeGreaterThan(30);
    expect(body.y).toBeGreaterThan(30); expect(body.fall!.still).toBe(false);
  } finally { h.host.shutdown(); }
});

test("a visible corpse burst respects the existing reliable window and deferred bodies eventually arrive", () => {
  const { h, s, c, ents } = camp();
  try {
    const bytes = new Map<number, number>(), send = c.conn.send.bind(c.conn);
    c.conn.send = (channel, data) => { const r = new BitReader(data); if (r.u8() === S_CORPSE) bytes.set(h.world.tick, (bytes.get(h.world.tick) ?? 0) + data.length); send(channel, data); };
    const ids: number[] = [];
    for (let i = 0; i < 32; i++) { const b = killed(h, 38 + i % 8, 38 + Math.floor(i / 8)); ids.push(makeHandle(b.e, ents.gen[b.e]!)); }
    h.run(1800);
    expect(ids.every(id => s.corpseMotions.has(id))).toBe(true);
    expect(Math.max(...bytes.values())).toBeLessThanOrEqual(16384);
    expect(bytes.size).toBeGreaterThan(1);
  } finally { h.host.shutdown(); }
});
