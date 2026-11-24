// An owned piece's health crosses the wire as a stage, and harm inside a stage is told to nobody.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { Hear } from "../../client/core/sound/bodies.ts";
import { BuildSounds } from "../../client/core/sound/build.ts";
import { CHUNK_SIZE, chunkCx, chunkCz } from "../../shared/coords.ts";
import { S_CHUNK } from "../../shared/net/protocol.ts";
import { KEYS } from "../../shared/sound/cues.ts";
import { STAGE_FULL, healthStage, stageHealth, toldHealth } from "../../shared/world/structures.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** A survivor, its chunk's corner, and a count of the chunk bytes it is sent. */
function watcher(h: Harness, name = "ada"): { s: ClientSession; chunk: number; x0: number; z0: number; bytes: () => number } {
  const s = h.join(name);
  h.run(300);
  const chunk = h.world.ents.chunk[h.ent(s)]!;
  let bytes = 0;
  const end = h.ends[h.ends.length - 1]!;
  const on = end.onMessage!;
  end.onMessage = (ch, d) => {
    if (d[0] === S_CHUNK) bytes += d.length;
    on(ch, d);
  };
  return { s, chunk, x0: chunkCx(h.world.dims, chunk) * CHUNK_SIZE, z0: chunkCz(h.world.dims, chunk) * CHUNK_SIZE, bytes: () => bytes };
}

test("a stage is 255 only at full health, at least 1 while the piece stands, and its health never reads as whole", () => {
  expect([healthStage(10000, 10000), healthStage(9999.99, 10000), healthStage(0.001, 10000), healthStage(5000, 10000)]).toEqual([STAGE_FULL, 254, 1, 127]);
  for (const max of [100, 2500, 10000, 15600]) {
    for (let k = 1; k < 2000; k++) {
      const hp = Math.fround((max * k) / 2000);
      const stage = healthStage(hp, max);
      const told = stageHealth(stage, max);
      expect(stage >= 1 && stage <= 254).toBe(true);
      // The health told is the most its stage covers, so a cost worked from it is never more than the exact one by a stage.
      expect(told < max && told - hp < max / 254 + 1e-3 && (stage === 254 || told >= hp - 1e-3)).toBe(true);
      expect(toldHealth(hp, max)).toBe(told);
    }
  }
});

test("an owned piece reaches a client at its stage's health, and nobody's piece exactly", () => {
  const h = new Harness({ chunkSlotsPerTick: 4096 }, 1, 30);
  const { s, chunk, x0, z0 } = watcher(h);
  const structs = h.world.structs;
  const wall = h.reg.index.get("core:wall")!;
  const max = h.reg.maxHp[wall]!;
  const owned = structs.add(wall, x0 + 5, 200, z0 + 5, 0, 7, max);
  const nobodys = structs.add(wall, x0 + 9, 200, z0 + 5, 0, 0, max);
  structs.damage(owned, max * 0.3001);
  structs.damage(nobodys, max * 0.3001);
  h.run(300);
  const [t, u] = [structs.chunks[chunk]!, s.world!.structs.chunks[chunk]!];
  expect(u.hp[owned & 0xffff]).toBe(toldHealth(t.hp[owned & 0xffff]!, max));
  expect(u.hp[owned & 0xffff]).not.toBe(t.hp[owned & 0xffff]!);
  expect(u.hp[nobodys & 0xffff]).toBe(t.hp[nobodys & 0xffff]!);
  // Mended, it is whole on the client exactly.
  structs.mend(owned, max);
  h.run(300);
  expect(u.hp[owned & 0xffff]).toBe(max);
});

test("a blow inside a stage sends no row and keeps the chunk's version, and is saved", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-stage-"));
  try {
    const dbPath = joinPath(dir, "world.db");
    let h = new Harness({}, 1, 30, { dbPath });
    const { s, chunk, x0, z0, bytes } = watcher(h);
    const wall = h.reg.index.get("core:wall")!;
    const max = h.reg.maxHp[wall]!;
    const ref = h.world.structs.add(wall, x0 + 5, 200, z0 + 5, 0, 7, max);
    h.world.structs.damage(ref, max * 0.5);
    h.run(300);
    const t = h.world.structs.chunks[chunk]!;
    const [version, sent, held] = [t.version, bytes(), s.world!.structs.chunks[chunk]!.hp[ref & 0xffff]!];
    // A hundredth of a stage a blow, twenty times.
    for (let k = 0; k < 20; k++) expect(h.world.structs.damage(ref, max / 25400)).toBeGreaterThan(0);
    h.run(2000);
    const left = t.hp[ref & 0xffff]!;
    expect(left).toBeLessThan(max * 0.5);
    expect([t.version, bytes(), s.world!.structs.chunks[chunk]!.hp[ref & 0xffff]]).toEqual([version, sent, held]);
    // The next blow that leaves the stage is a row.
    h.world.structs.damage(ref, max / 254);
    h.run(300);
    expect([t.version, bytes() > sent, s.world!.structs.chunks[chunk]!.hp[ref & 0xffff]! < held]).toEqual([version + 1, true, true]);
    const exact = t.hp[ref & 0xffff]!;
    h.world.structs.damage(ref, max / 25400);
    h.run(2000);
    h.host.shutdown();
    h = new Harness({}, 1, 30, { dbPath });
    expect(h.world.structs.chunks[chunk]!.hp[ref & 0xffff]).toBe(Math.fround(exact - max / 25400));
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a blow that leaves a stage costs a client under 2 bytes a piece in a run of slots", () => {
  const h = new Harness({ chunkSlotsPerTick: 4096 }, 1, 30);
  const { x0, z0, bytes } = watcher(h);
  const structs = h.world.structs;
  const wall = h.reg.index.get("core:wall")!;
  const max = h.reg.maxHp[wall]!;
  const refs: number[] = [];
  for (let i = 0; i < 200; i++) refs.push(structs.add(wall, x0 + 2 + (i % 20) * 3, 200 + Math.floor(i / 20) * 4, z0 + 5, 0, 7, max));
  h.run(600);
  const before = bytes();
  for (const ref of refs) structs.damage(ref, max / 100);
  h.run(600);
  // Next slot, in place, same kind, the owner named before, not full, a stage: 13 bits. A float in its place made it 37.
  expect((bytes() - before) / refs.length).toBeLessThan(2);
});

test("the attacker hears its blow from the hit once, whether or not a row follows", () => {
  const reg = coreRegistry();
  const wall = reg.index.get("core:wall_wood")!;
  const max = reg.maxHp[wall]!;
  const build = new BuildSounds(reg, () => 0);
  const run = (): [string, number][] => {
    const heard: [string, number][] = [];
    const hear: Hear = (_o, key, _e, _x, _y, _z, _lift, level) => void heard.push([KEYS[key]!.key, level]);
    build.update(0, 0, 0, hear, () => {});
    return heard;
  };
  // No row: the blow stayed inside the stage.
  build.struck(wall, 10, 2, 10, max / 1000);
  expect(run()).toEqual([["hit/wood", 0.504]]);
  // The hit and then its row, a metre and a half off at the piece's middle.
  build.struck(wall, 10, 2, 10, max / 100);
  build.structure(wall, wall, 11, 3, 10.5, max, max * 0.99, -1);
  expect(run()).toEqual([["hit/wood", 0.54]]);
  // The row and then the hit.
  build.structure(wall, wall, 11, 3, 10.5, max * 0.99, max * 0.98, -1);
  expect(run().length).toBe(1);
  build.struck(wall, 10, 2, 10, max / 100);
  expect(run()).toEqual([]);
  // Another's blow is heard from its row, and a blow far from the player's own is its own sound.
  for (let k = 0; k < 30; k++) run();
  build.structure(wall, wall, 11, 3, 10.5, max * 0.98, max * 0.97, -1);
  build.struck(wall, 40, 2, 10, max / 100);
  expect(run().length).toBe(2);
});
