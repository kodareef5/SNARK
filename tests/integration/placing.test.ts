// Bodies are never put inside a node, though nodes load only round players.
import { expect, test } from "bun:test";
import type { EntityRecord } from "../../server/records.ts";
import { CHUNK_SIZE, chunkAt } from "../../shared/coords.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

/** Flat ground of 8 by 8 chunks with an elder oak at A (420, 420), where the map's spawn point is, and one at B (36, 36), 540 m off. */
const A = 420;
const B = 36;
const at = (m: number): number => ((m % CHUNK_SIZE) / CHUNK_SIZE) * 65536;
const oaks = writeMap(
  flatMap(8, {
    nodes: [{ kinds: ["core:oak"], first: Uint32Array.from({ length: 65 }, (_, c) => (c > 0 ? 1 : 0) + (c > 54 ? 1 : 0)), kind: Uint8Array.of(0, 0), x: Uint16Array.of(at(B), at(A)), z: Uint16Array.of(at(B), at(A)), yaw: Uint16Array.of(0, 9000) }],
    spawns: [{ name: "Rock", x: A, z: A, yaw: 0 }],
  }),
);

function world(): Harness {
  const h = new Harness({}, 1, 60, { dev: true, map: oaks });
  const field = h.world.nodeField!;
  expect([field.isLoaded(chunkAt(h.world.dims, A, A)), field.isLoaded(chunkAt(h.world.dims, B, B))]).toEqual([false, false]);
  return h;
}

/** Runs `f` with the nodes of the chunks round (x, z) loaded, as they are for a body there. */
function loaded<T>(h: Harness, x: number, z: number, f: () => T): T {
  const field = h.world.nodeField!;
  const chunk = chunkAt(h.world.dims, x, z);
  field.retain(chunk, 1, 1, () => false);
  const out = f();
  field.retain(chunk, 1, -1, () => false);
  return out;
}

/** Whether entity `e` stands clear of everything there, every node loaded. */
function clear(h: Harness, e: number): boolean {
  const { ents, reg } = h.world;
  const [x, y, z, k] = [ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.kind[e]!];
  return loaded(h, x, z, () => capsuleFree(h.world, x, y, z, reg.bodyRadius[k]!, reg.bodyHeight[k]!));
}

test("a survivor's spawn, an admin's teleport and creature, and an egg are never put inside a tree nobody has loaded", () => {
  const h = world();
  const { ents, hf, reg, dims } = h.world;
  const field = h.world.nodeField!;
  // The spawn point is inside oak A, which loads only once the survivor is in.
  const ada = h.join("ada");
  h.run(500);
  const me = h.ent(ada);
  const p = reg.move[ents.kind[me]!]!;
  expect(field.isLoaded(chunkAt(dims, A, A))).toBe(true);
  expect(capsuleFree(h.world, A, groundUnder(hf, A, A, p.radius), A, p.radius, p.height)).toBe(false);
  expect(clear(h, me)).toBe(true);

  // Oak B is not loaded. An admin's creature is not put there, and a teleport into it is refused.
  expect(field.isLoaded(chunkAt(dims, B, B))).toBe(false);
  expect(h.host.spawnCreature("core:dodo", B, B, 1)).toBe(-1);
  h.say(ada, "enablecheats");
  expect(h.say(ada, `tp ${B} ${B}`)).toEqual(["that spot is inside something"]);

  // A dodo mother stands just far enough from B for an egg, facing away, so the egg she lays behind her would be inside it.
  const egg = reg.breedEgg[reg.index.get("core:dodo")!]!;
  const [er, eh] = [reg.bodyRadius[egg]!, reg.bodyHeight[egg]!];
  const d = loaded(h, B, B, () => {
    let d = 0;
    while (!capsuleFree(h.world, B, groundUnder(hf, B, B + d, er), B + d, er, eh)) d += 0.05;
    return d;
  });
  const mother = h.host.spawnCreature("core:dodo", B, B + d + 0.05, 5);
  const father = h.host.spawnCreature("core:dodo", B + 3, B + d + 1, 5);
  expect([mother >= 0, father >= 0]).toEqual([true, true]);
  ents.yaw[mother] = 0;
  const rec = (e: number): EntityRecord => h.host.records.byPid.get(ents.pid[e]!)!;
  rec(mother).genome!.female = true;
  const before = new Set(h.host.records.byPid.keys());
  (h.host.breeding as unknown as { lay(mother: EntityRecord, father: EntityRecord, e: number): void }).lay(rec(mother), rec(father), mother);
  const eggs = [...h.host.records.byPid.values()].filter((r) => !before.has(r.pid) && r.egg !== null);
  expect(eggs.length).toBeGreaterThan(0);
  for (const r of eggs) expect(clear(h, h.host.records.entOf.get(r.pid)!)).toBe(true);
  expect(field.isLoaded(chunkAt(dims, B, B))).toBe(false);

  // A survivor last seen inside B is not put there.
  const saved = h.host.game.savedPosition!;
  h.host.game.savedPosition = (name) => (name === "bo" ? { x: B, y: hf.heightAt(B, B), z: B, yaw: 0 } : saved(name));
  const bo = h.join("bo");
  h.run(500);
  expect(clear(h, h.ent(bo))).toBe(true);
});
