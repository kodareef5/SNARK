// The smaller tools' happy paths and refusals: levelling up, dropping, loading and fitting a weapon, acting on what is
// built, ordering a tame, and carrying, through the protocol, in process.

import { expect, test } from "bun:test";
import { latOf, lonOf } from "../../shared/world/coords.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { play } from "../fixtures/agent.ts";
import { flatGround } from "../fixtures/arena.ts";
import { flatMap } from "../fixtures/map.ts";

test("level_up spends a level point, move_item drops on the ground, and use_item loads, fits and takes in hand", async () => {
  const p = play();
  expect(await p.call("level_up", { stat: "health" })).toEqual({ state: "refused", reason: "you have no level points to spend: they come with each level" });
  expect(await p.call("level_up", { stat: "luck" })).toMatchObject({ state: "refused" });
  for (const line of ["enablecheats", "addxp 200", "kit rifle", "give berry 5"]) await p.typed(line);
  p.run(300);
  const points = p.s.progress.statPoints;
  expect(points).toBeGreaterThan(0);
  expect(await p.call("level_up", { stat: "health" })).toEqual({ state: "done", raised: "health" });
  p.run(300);
  expect(p.s.progress.statPoints).toBe(points - 1);

  expect(await p.call("move_item", { from: "self", item: "berry", count: 2, to: "ground" })).toMatchObject({ state: "done", dropped: "berry", count: 2 });
  expect(p.h.host.items.inv(p.rec).total(p.id("berry"))).toBe(3);
  expect(await p.call("move_item", { from: "box", item: "berry", to: "ground" })).toMatchObject({ state: "refused" });
  expect(await p.call("move_item", { from: "self", item: "stone", to: "box" })).toMatchObject({ state: "refused" });

  expect(await p.call("use_item", { item: "rifle" })).toMatchObject({ state: "done", held: "rifle" });
  expect((await p.call("status")).self).toMatchObject({ held: "rifle" });
  expect(await p.call("use_item", { item: "scope" })).toMatchObject({ state: "done", used: "scope", on: "rifle" });
  expect(await p.call("use_item", { item: "dart_tranq" })).toMatchObject({ state: "done", used: "dart_tranq", loads_into: "rifle" });
  const inv = p.h.host.items.inv(p.rec);
  expect(inv.ammo[inv.item.indexOf(p.id("rifle"))]).toBe(p.id("dart_tranq"));
  expect(await p.call("use_item", { item: "arrow_stone" })).toEqual({ state: "refused", reason: "you carry no arrow_stone" });
  expect(await p.call("use_item", { item: "saddle_raptor" })).toMatchObject({ state: "refused" });
  expect(await p.call("use_item", { item: "nothing at all" })).toMatchObject({ state: "refused" });
});

test("structure locks, sets a PIN, picks up and demolishes, and refuses what does not fit", async () => {
  const p = play();
  const g = flatGround(p.h, 30, 30);
  for (const line of ["enablecheats", `tp ${g.x + 15} ${g.z + 4}`, "give piece_storage_box 2", "give piece_door_wood 1"]) await p.typed(line);
  const box = (await p.call("place", { item: "piece_storage_box", x: g.x + 15, z: g.z + 10 })) as unknown as { id: string };
  const other = (await p.call("place", { item: "piece_storage_box", x: g.x + 19, z: g.z + 10 })) as unknown as { id: string };
  const ref = Number(box.id.slice(1));
  expect(await p.call("structure", { id: box.id, do: "lock" })).toMatchObject({ state: "done" });
  expect(await p.call("structure", { id: box.id, do: "pin", pin: 1234 })).toMatchObject({ state: "done" });
  expect(p.h.host.fixtures.find(ref)!.pin).toBe(1234);
  expect(await p.call("structure", { id: box.id, do: "pin" })).toMatchObject({ state: "refused" });
  expect(await p.call("structure", { id: box.id, do: "light" })).toEqual({ state: "refused", reason: `${box.id} is not something that burns` });
  expect(await p.call("structure", { id: box.id, do: "travel" })).toEqual({ state: "refused", reason: `${box.id} is not a bed` });
  expect(await p.call("structure", { id: box.id, do: "fly" })).toMatchObject({ state: "refused" });
  expect(await p.call("structure", { id: box.id, do: "pick_up" })).toMatchObject({ state: "done" });
  expect(p.h.host.items.inv(p.rec).total(p.id("piece_storage_box"))).toBe(1);
  expect(await p.call("structure", { id: other.id, do: "demolish" })).toMatchObject({ state: "done" });
  const gone = Number(other.id.slice(1));
  expect(p.h.world.structs.chunks[Math.floor(gone / 65536)]!.kind[gone & 0xffff]).toBe(0);
  // A door joins a doorframe, and on open ground it is said where it goes.
  expect(await p.call("place", { item: "piece_door_wood", x: g.x + 15, z: g.z + 15 })).toMatchObject({ state: "refused" });
});

test("order lands, unsaddles and levels a tame, or says why not, and carry picks up, sets down and throws", async () => {
  const p = play();
  const g = flatGround(p.h, 30, 30);
  await p.typed("enablecheats");
  await p.typed(`tp ${g.x + 15} ${g.z + 4}`);
  const e = p.h.host.spawnCreature("core:pteranodon", g.x + 15, g.z + 12, 1);
  const rec = p.h.host.records.byPid.get(p.h.world.ents.pid[e]!)!;
  p.h.host.taming.give(rec, p.rec, 1, "forced");
  rec.saddle = p.id("saddle_pteranodon");
  p.h.host.refreshBody(rec);
  p.run(500);
  const id = `e${e}`;
  expect(await p.call("order", { id, order: "land" })).toMatchObject({ state: "done", ordered: "land" });
  expect(await p.call("order", { id, order: "level", stat: "health" })).toMatchObject({ state: "blocked", reason: "not enough points, level or ingredients" });
  expect(await p.call("order", { order: "unsaddle" })).toMatchObject({ state: "refused", reason: "unsaddle needs the id of one creature" });
  expect(await p.call("order", { id, order: "unsaddle" })).toMatchObject({ state: "done" });
  p.run(300);
  expect(rec.saddle).toBe(0);
  expect(await p.call("order", { id, order: "name", name: "x".repeat(30) })).toMatchObject({ state: "refused" });

  const dodo = p.h.host.spawnCreature("core:dodo", g.x + 10, g.z + 8, 1);
  p.run(300);
  expect(await p.call("carry", {})).toMatchObject({ state: "refused" });
  expect(await p.call("carry", { id: `e${dodo}` })).toMatchObject({ state: "done", holding: "dodo" });
  expect(await p.call("carry", { put: "throw" })).toMatchObject({ state: "done", threw: true });
  expect(await p.call("carry", { put: "down" })).toMatchObject({ state: "blocked" });
  expect(await p.call("carry", { put: "sideways" })).toMatchObject({ state: "refused" });
});

test("status says where the survivor is as the map screen does, and go_to takes a latitude and longitude anywhere on the map, past 100 too", async () => {
  // Ground of 4 chunks a side whose display origin is 192 chunks west and 176 north of its south-east corner: it reads 117.5 to
  // 120 west to east and 107.5 to 110 north to south.
  const dims = { chunksX: 4, chunksZ: 4, frameX: 2048, frameZ: 2048, originX: 2240, originZ: 2224 };
  const p = play({ map: writeMap(flatMap(4, { dims })) });
  const at = async (): Promise<{ x: number; z: number; lat: number; lon: number }> => (await p.call("status")).self as never;
  const was = await at();
  expect([was.lat, was.lon]).toEqual([Math.round(latOf(p.s.world!.hf.dims, was.z) * 10) / 10, Math.round(lonOf(p.s.world!.hf.dims, was.x) * 10) / 10]);
  expect(was.lat > 107.5 && was.lat < 110 && was.lon > 117.5 && was.lon < 120).toBe(true);
  expect(await p.call("go_to", { lat: 109.5, lon: 119.5 })).toMatchObject({ state: "done" });
  const now = await at();
  expect([Math.abs(now.lat - 109.5) < 0.05, Math.abs(now.lon - 119.5) < 0.05]).toEqual([true, true]);
  // Off the map is refused with the map's range, to the tenth status gives.
  expect(await p.call("go_to", { lat: 50, lon: 119 })).toEqual({ state: "refused", reason: "lat must be a number from 107.5 to 110" });
  expect(await p.call("go_to", { lat: 109, lon: 117.4 })).toEqual({ state: "refused", reason: "lon must be a number from 117.5 to 120" });
});
