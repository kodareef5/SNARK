// A client shown fewer bodies than stand around it keeps those it holds when it steps into the next chunk, and is given
// the nearer ones a few at a time in their place.

import { expect, test } from "bun:test";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CUE_MATING_SHIFT } from "../../shared/anim/pose.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { Harness } from "../fixtures/net.ts";

function shown(s: ClientSession): number {
  const out = new RemoteSample();
  s.sampleRemote(out);
  return out.count;
}

/** 120 dummies in each of two chunks side by side, and a client asking for 100 bodies standing in the first. */
function crowd(asks = 100): { h: Harness; ada: ClientSession; x: number; z: number; ids: () => Set<number> } {
  const h = new Harness({}, 1, 30, { dev: true });
  const ada = h.join("ada");
  h.run(600);
  h.say(ada, "enablecheats");
  const e = h.ent(ada);
  const ents = h.world.ents;
  // The border between the body's chunk and the one east of it.
  const x = (Math.floor(ents.x[e]! / CHUNK_SIZE) + 1) * CHUNK_SIZE;
  const z = (Math.floor(ents.z[e]! / CHUNK_SIZE) + 0.5) * CHUNK_SIZE;
  const dims = h.world.dims;
  const [west, east] = [chunkAt(dims, x - 1, z), chunkAt(dims, x + 1, z)];
  const put = [0, 0];
  for (let i = 0; i < 20000 && (put[0]! < 120 || put[1]! < 120); i++) {
    const side = i % 2;
    if (put[side]! >= 120) continue;
    const px = x + (side === 0 ? -1 : 1) * (2 + ((i * 7.3) % (CHUNK_SIZE - 4)));
    const pz = z - CHUNK_SIZE / 2 + 2 + ((i * 11.9) % (CHUNK_SIZE - 4));
    if (h.host.spawnCreature("core:dummy", px, pz, 1) >= 0) put[side]!++;
  }
  expect(put).toEqual([120, 120]);
  expect([chunkAt(dims, x - 3, z), chunkAt(dims, x + 3, z)]).toEqual([west, east]);
  h.say(ada, `tp ${(x - 3).toFixed(3)} ${z.toFixed(3)}`);
  ada.view(asks, 600);
  h.run(4000);
  const ids = (): Set<number> => {
    const out = new RemoteSample();
    ada.sampleRemote(out);
    return new Set(Array.from(out.id.subarray(0, out.count)));
  };
  return { h, ada, x, z, ids };
}

test("a client shown 100 of 240 bodies keeps at least 80 as it steps into the next chunk", () => {
  const { h, ada, x, z } = crowd();
  expect(shown(ada)).toBe(99);
  h.say(ada, `tp ${(x + 3).toFixed(3)} ${z.toFixed(3)}`, 0);
  let least = shown(ada);
  for (let i = 0; i < 90; i++) {
    h.run(1000 / 30);
    least = Math.min(least, shown(ada));
  }
  expect(least).toBeGreaterThanOrEqual(80);
  expect(shown(ada)).toBe(99);
  expect(ada.stats.undecodable).toBe(0);
});

test("after the step the client is shown the new chunk's bodies, as one standing there from the start is", () => {
  const { h, ada, x, z, ids } = crowd();
  const before = ids();
  h.say(ada, `tp ${(x + 3).toFixed(3)} ${z.toFixed(3)}`, 0);
  h.run(6000);
  const after = ids();
  // Only bodies within reach across the border can keep a seat ahead of this chunk.
  const ents = h.world.ents;
  const own = h.ent(ada);
  let eastward = 0;
  for (const id of after) {
    if (ents.x[id]! > x) eastward++;
    else expect(Math.hypot(ents.x[id]! - ents.x[own]!, ents.y[id]! - ents.y[own]!, ents.z[id]! - ents.z[own]!)).toBeLessThanOrEqual(8);
  }
  expect(after.size).toBe(99);
  expect(eastward).toBeGreaterThanOrEqual(91);
  expect([...after].filter((id) => before.has(id)).length).toBeLessThan(10);
});

test("each crowded viewer keeps nearby bodies across a border ahead of distant motion", () => {
  const { h, ada, x, z } = crowd(64);
  const bob = h.join("bob");
  h.run(700);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${x - 54} ${z}`);
  bob.view(64, 600);
  h.run(1500);
  const ents = h.world.ents, dummy = h.reg.index.get("core:dummy")!;
  const crowdIds: number[] = [], movers: number[] = [];
  for (let e = 0; e < ents.cap; e++) {
    if (ents.kind[e] !== dummy) continue;
    crowdIds.push(e);
    if (ents.x[e]! > x + 12) movers.push(e);
  }
  expect(movers.length).toBeGreaterThan(64);
  const rep = h.server.replication, before = rep.onReplicate;
  const mating: number[] = [];
  rep.onReplicate = (c) => {
    before?.(c);
    for (const e of movers) ents.vx[e] = 1;
    for (const e of mating) ents.cue[e] = 5 << CUE_MATING_SHIFT;
  };
  const verify = (s: ClientSession, other: ClientSession): number[] => {
    const own = h.ent(s);
    const distance = (id: number): number => Math.hypot(ents.x[id]! - ents.x[own]!, ents.y[id]! - ents.y[own]!, ents.z[id]! - ents.z[own]!);
    const near = crowdIds.filter((e) => distance(e) <= 8).sort((a, b) => distance(a) - distance(b) || a - b).slice(0, 8);
    expect(near.length).toBeGreaterThan(0);
    const r = new RemoteSample();
    s.sampleRemote(r);
    const shown = new Set(r.id.subarray(0, r.count));
    expect(shown.size).toBe(63);
    expect(shown.has(h.ent(other))).toBe(true);
    for (const e of near) expect(shown.has(e)).toBe(true);
    expect(movers.some((e) => shown.has(e))).toBe(true);
    expect(s.stats.undecodable).toBe(0);
    return near;
  };
  for (const serverCap of [1024, 64]) {
    expect(h.host.setSetting("ViewCap", String(serverCap))).toBe("");
    h.run(4000);
    const nearAda = verify(ada, bob), nearBob = verify(bob, ada);
    expect(nearAda.some((e) => ents.x[e]! > x)).toBe(true);
    expect(nearBob.some((e) => nearAda.includes(e))).toBe(false);
    mating.push(nearAda[0]!, nearBob[0]!, ...movers);
    h.run(700);
    expect(step(ada, nearAda[0]!)).toBe(1);
    expect(step(bob, nearBob[0]!)).toBe(1);
    mating.length = 0;
  }
  ada.view(2, 600);
  h.run(2000);
  const r = new RemoteSample();
  ada.sampleRemote(r);
  expect(Array.from(r.id.subarray(0, r.count))).toEqual([h.ent(bob)]);
});

test("a view granted 1,024 is held to a cap lowered to 64 at every tick, over a step into the next chunk", () => {
  const { h, ada, x, z } = crowd(1024);
  expect(shown(ada)).toBe(240);
  expect(h.host.setSetting("ViewCap", "64")).toBe("");
  let most = 0;
  for (let i = 0; i < 60; i++) {
    h.run(1000 / 30);
    if (i > 3) most = Math.max(most, shown(ada));
  }
  expect(most).toBe(63);
  h.say(ada, `tp ${(x + 3).toFixed(3)} ${z.toFixed(3)}`, 0);
  for (let i = 0; i < 180; i++) {
    h.run(1000 / 30);
    most = Math.max(most, shown(ada));
  }
  expect(most).toBe(63);
});

/** The mating step `s` holds for `e`, or -1. */
function step(s: ClientSession, e: number): number {
  const r = new RemoteSample();
  s.sampleRemote(r);
  for (let i = 0; i < r.count; i++) if (r.id[i] === e) return (r.cue[i]! >>> CUE_MATING_SHIFT) & 7;
  return -1;
}

test("another tribe's pair at step 5 reads begun, kept over a step or seen through the cone; its own tribe reads 5", () => {
  const { h, ada, x, z } = crowd();
  // Bob's tribe owns the pair. Cat is of none. Both are shown all there is.
  const [bob, cat] = [h.join("bob"), h.join("cat")];
  h.run(2000);
  for (const [s, dz] of [[bob, 2], [cat, -2]] as const) {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(x - 3).toFixed(3)} ${(z + dz).toFixed(3)}`);
    s.view(1024, 600);
  }
  const owner = h.host.records.byPid.get(h.client(bob)!.pid)!;
  expect(h.host.tribes.create(owner, "Lagoon")).toBe("");
  const ents = h.world.ents;
  const pair = (px: number, pz: number): number => {
    for (let k = 0; k < 400; k++) {
      const e = h.host.spawnCreature("core:dodo", px + ((k * 7.7) % 24) - 12, pz + ((k * 5.3) % 24) - 12, 10);
      if (e < 0) continue;
      h.host.taming.give(h.host.records.byPid.get(ents.pid[e]!)!, owner, 1);
      h.host.creatures.mind.stay(e, 0xffffffff);
      return e;
    }
    throw new Error("no room for the pair");
  };
  // One among the west chunk's dummies, and one five chunks off, past the square either view is gathered round.
  const near = pair(x - 8, z - 6);
  let far = -1;
  for (let d = 0; d < 8 && far < 0; d++) {
    try {
      far = pair(x + Math.round(Math.cos((d * Math.PI) / 4)) * 5 * CHUNK_SIZE, z + Math.round(Math.sin((d * Math.PI) / 4)) * 5 * CHUNK_SIZE);
    } catch {}
  }
  expect(far).toBeGreaterThanOrEqual(0);
  const five = (): void => {
    for (const e of [near, far]) ents.cue[e] = ((ents.cue[e]! & ~(7 << CUE_MATING_SHIFT)) | (5 << CUE_MATING_SHIFT)) >>> 0;
  };
  const run = (ms: number): void => {
    for (let t = 0; t < ms; t += 1000 / 30) {
      five();
      h.run(1000 / 30);
    }
  };
  // Bob and Cat see the far one through a cone reaching its chunk.
  const rep = h.server.replication;
  const before = rep.cone;
  const cone = { chunks: Int32Array.of(chunkAt(h.world.dims, ents.x[far]!, ents.z[far]!)), count: 1 };
  const watchers = new Set([h.client(bob), h.client(cat)]);
  rep.cone = (c) => (watchers.has(c) ? cone : (before?.(c) ?? null));
  run(3000);
  expect([step(ada, near), step(cat, near), step(cat, far), step(bob, near), step(bob, far)]).toEqual([1, 1, 1, 5, 5]);
  // Ada steps east: the near one is left out by her cap, kept a while as she has it, and never reads past begun.
  h.say(ada, `tp ${(x + 3).toFixed(3)} ${z.toFixed(3)}`, 0);
  let most = 0;
  for (let i = 0; i < 90; i++) {
    run(1000 / 30);
    most = Math.max(most, step(ada, near));
  }
  expect(most).toBe(1);
  expect([step(cat, far), step(bob, far)]).toEqual([1, 5]);
  rep.cone = before;
});
