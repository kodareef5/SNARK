import { expect, test } from "bun:test";
import { FallCheckpoints } from "../../client/core/fall-checkpoints.ts";
import { REACT_CREATURE_DOWN } from "../../shared/anim/reactions.ts";
import { Corpses } from "../../client/core/ragdoll.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { layCorpse } from "../../shared/anim/corpse.ts";
import { AnimState, CUE_DEAD } from "../../shared/anim/pose.ts";
import { Solved } from "../../shared/anim/skeleton.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { makeHandle } from "../../shared/ids.ts";
import { encodeCorpseCheckpoint } from "../../shared/net/corpse.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { birdAnim } from "../fixtures/bird.ts";

function fixture() {
  const anim = birdAnim(), reg = compileContent(CORE_CONTENT).registry!, dims = { chunksX: 2, chunksZ: 2 };
  const world = { hf: new Heightfield(dims, TERRAIN_CELL, -32, 1 / 256), structs: new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts) };
  const d = layCorpse(anim, false, false, 40, 4, 40, 0, 1, new Solved(anim.rig.bones))!;
  d.launch(7, 3, 0, 1, 2, 0);
  const data = encodeCorpseCheckpoint({ x: 40, y: 4, z: 40, yaw: 0, size: 1, out: false, air: false, awake: true, ticks: 0, state: d.checkpoint() });
  const r = new RemoteSample(); r.count = 1; r.id[0] = 7; r.gen[0] = 3; r.kind[0] = 0;
  r.x[0] = 40; r.y[0] = 4; r.z[0] = 40; r.cue[0] = CUE_DEAD; r.anim[0] = new AnimState().pack(); r.tick = 100;
  const c = new Corpses([anim]), motion = { revision: 1, tick: 100, data };
  const motions = new Map([[makeHandle(7, 3), motion]]), gaits = new Map();
  const frame = () => c.update(r, world, 40, 40, gaits, motions);
  return { c, r, d, world, motions, motion, frame };
}

test("a sparse checkpoint reaches an observer by generation-qualified ID and a reused slot cannot inherit it", () => {
  const { c, r, d, frame } = fixture(); frame();
  expect(c.list[0]!.motionRevision).toBe(1);
  expect(c.list[0]!.fall!.ragdoll.checkpoint()).toEqual(d.checkpoint());
  const old = c.list[0]; r.gen[0] = 4; frame();
  expect(c.list[0]).not.toBe(old);
  expect(c.list[0]!.handle).toBe(makeHandle(7, 4));
  expect(c.list[0]!.motionRevision).toBe(0);
});

test("future checkpoints wait for the render tick and old moving checkpoints request a bounded fresh retry", () => {
  const { c, r, motions, motion, frame } = fixture(); r.tick = 99; frame();
  // Waiting means no speculative local body is drawn before the first authoritative pose is eligible.
  expect(c.list).toHaveLength(0);
  r.tick = 100; frame(); expect(c.list[0]!.motionRevision).toBe(1);
  r.tick = 200; frame();
  expect(c.needsCheckpoint.has(makeHandle(7, 3))).toBe(true);
  expect(c.list[0]!.clock).toBe(100);
  motions.set(makeHandle(7, 3), { ...motion, tick: 200 }); frame();
  expect(c.needsCheckpoint.size).toBe(0); expect(c.list[0]!.clock).toBe(200);
  const old = c.list[0]!.fall!.ragdoll.checkpoint();
  motions.set(makeHandle(7, 3), motion); frame();
  expect(c.list[0]!.fall!.ragdoll.checkpoint()).toEqual(old);
});

test("a stream of future corrections lets a watcher draw each due checkpoint", () => {
  for (const living of [true, false]) {
    const { c, r, world, motion } = fixture(), id = makeHandle(r.id[0]!, r.gen[0]!);
    const motions = new FallCheckpoints();
    if (living) { r.cue[0] = 0; r.react[0] = REACT_CREATURE_DOWN; }
    for (let tick = 100; tick < 124; tick++) {
      motions.set(id, { ...motion, revision: tick - 99, tick });
      r.tick = tick - 4;
      c.update(r, world, 40, 40, new Map(), motions);
      const drawn = living ? c.humans.of(r.id[0]!) : c.list[0];
      if (r.tick < 100) expect(drawn).toBeUndefined();
      else expect(drawn?.motionTick).toBe(r.tick);
    }
    motions.delete(id);
    motions.set(id, { ...motion, tick: 140 });
    expect(motions.atTick(id, 110)?.tick).toBe(140);
  }
});
