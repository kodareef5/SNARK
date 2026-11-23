import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

/** Flat to z = 110, then a straight grade for 140 m. */
function hill(rise: number) {
  const chunks = 6, side = (chunks * CHUNK_SIZE) / TERRAIN_CELL + 1, heights = new Uint16Array(side * side);
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) heights[j * side + i] = Math.round((32 + Math.max(0, Math.min(140, j * TERRAIN_CELL - 110)) * rise) * 256);
  return flatMap(chunks, { heights });
}

/** A driver in a semi at (100, 60) facing +Z, and an air trailer parked behind it with room to back under it. */
function yard(rise = 0, link = {}, dbPath?: string) {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(hill(rise)), ...(dbPath ? { dbPath } : {}) });
  const s = h.join("driver", link); h.run(500);
  const c = h.client(s)!, a = h.world.ents;
  const semi = h.host.spawnVehicle("core:semi", 100, 60, 0, 0);
  const trailer = h.host.spawnVehicle("core:air_trailer", 100, 60 - 2.6 - 3.75 - 1.2, 0, 0);
  const def = h.reg.vehicle[a.kind[semi]!]!, door = [0, 0, 0];
  h.host.urban.door(semi, def.seats[0]!, h.reg.bodyRadius[c.kind]!, door);
  a.setPosition(c.ent, door[0]!, door[1]!, door[2]!);
  expect(h.host.urban.mount(c, semi)).toBe(RESULT_OK);
  h.run(1600);
  return { h, s, c, a, semi, trailer };
}

test("backing the fifth wheel under the kingpin couples the trailer", () => {
  const { h, a, semi, trailer } = yard();
  try {
    expect(h.host.hitches.trailerOf(semi)).toBe(-1);
    h.pilots[0]!.moveZ = -0.4;
    for (let i = 0; i < 60 && h.host.hitches.trailerOf(semi) < 0; i++) h.run(100);
    expect(h.host.hitches.trailerOf(semi)).toBe(trailer);
    h.pilots[0]!.moveZ = 1; h.run(5000);
    expect(a.z[trailer]!).toBeGreaterThan(70);
    expect(a.z[semi]! - a.z[trailer]!).toBeCloseTo(6.35, 0);
  } finally { h.host.shutdown(); }
});

for (const rise of [.12, -.12]) test("a coupled trailer follows its tractor over a grade of " + rise, () => {
  const { h, a, semi, trailer } = yard(rise);
  try {
    h.host.hitches.couple(a.pid[semi]!, a.pid[trailer]!);
    h.pilots[0]!.moveZ = 1;
    for (let i = 0; i < 300 && a.z[semi]! < 200; i++) h.run(100);
    expect(a.z[semi]!).toBeGreaterThan(200);
    expect(a.z[semi]! - a.z[trailer]!).toBeGreaterThan(5.5);
    expect(a.z[semi]! - a.z[trailer]!).toBeLessThan(6.6);
    expect(Math.abs(a.y[trailer]! - (32 + rise * 140 + 32 * 0))).toBeLessThan(40);
  } finally { h.host.shutdown(); }
});

test("a parked pair keeps its hitch through a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-hitch-")), path = join(dir, "world.db");
  const { h: first, a, semi, trailer } = yard(0, {}, path);
  let h = first;
  try {
    const tractorPid = a.pid[semi]!, trailerPid = a.pid[trailer]!;
    h.host.hitches.couple(tractorPid, trailerPid);
    h.pilots[0]!.buttons = BTN_JUMP; h.run(1000);
    h.host.shutdown();
    h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(hill(0)), dbPath: path });
    h.run(300);
    expect(h.host.hitches.trailerPid(tractorPid)).toBe(trailerPid);
    expect(h.host.hitches.trailerOf(h.host.records.entOf.get(tractorPid)!)).toBe(h.host.records.entOf.get(trailerPid)!);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
