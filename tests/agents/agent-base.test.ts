// The agent builds a small base and works its stations, through its tools alone, in process.

import { expect, test } from "bun:test";
import { play, type Play } from "../fixtures/agent.ts";
import { flatGround } from "../fixtures/arena.ts";

/** The kind of the piece an id names on the server, by its short name. */
const kindOf = (p: Play, id: string): string => {
  const ref = Number(id.slice(1));
  return p.h.reg.ids[p.h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!]!.slice(5);
};

test("a hut: two foundations, walls round one with a doorframe and a door, and a ceiling over it", async () => {
  const p = play();
  const g = flatGround(p.h, 40, 40);
  for (const line of ["enablecheats", `tp ${g.x + 20} ${g.z + 6}`, "setstat weight 255", "give piece_foundation_wood 2", "give piece_wall_wood 5", "give piece_ceiling_wood 1", "give piece_door_wood 1"]) await p.typed(line);
  const a = (await p.call("place", { item: "piece_foundation_wood", x: g.x + 20, z: g.z + 14 })) as unknown as { state: string; id: string };
  expect(a).toMatchObject({ state: "done", placed: "foundation_wood" });
  expect(await p.call("place", { item: "piece_foundation_wood", on: a.id, side: "north" })).toMatchObject({ state: "done", placed: "foundation_wood" });
  // A wall on each of three sides, and a doorframe on the fourth, facing the way in.
  const walls: string[] = [];
  for (const side of ["west", "east", "north"]) {
    const w = (await p.call("place", { item: "piece_wall_wood", on: a.id, side })) as unknown as { state: string; id: string };
    expect(w).toMatchObject({ state: "done", placed: "wall_wood" });
    walls.push(w.id);
  }
  const frame = (await p.call("place", { item: "piece_wall_wood", as: "doorframe", on: a.id, side: "south" })) as unknown as { id: string };
  expect(kindOf(p, frame.id)).toBe("doorframe_wood");
  // The edge has its wall already, and a door goes only in a frame.
  expect(await p.call("place", { item: "piece_wall_wood", on: a.id, side: "east" })).toMatchObject({ state: "blocked", reason: "something is in the way" });
  expect(await p.call("place", { item: "piece_door_wood", on: walls[0] })).toMatchObject({ state: "refused" });
  const door = (await p.call("place", { item: "piece_door_wood", on: frame.id })) as unknown as { id: string };
  expect(kindOf(p, door.id)).toBe("door_wood");
  const roof = (await p.call("place", { item: "piece_ceiling_wood", on: walls[0], side: "top" })) as unknown as { id: string };
  expect(kindOf(p, roof.id)).toBe("ceiling_wood");
  const at = p.h.world.structs.chunks[Math.floor(Number(roof.id.slice(1)) / 65536)]!;
  const r = Number(roof.id.slice(1)) & 0xffff;
  const f = Number(a.id.slice(1));
  expect([at.x[r], at.z[r]]).toEqual([p.h.world.structs.chunks[Math.floor(f / 65536)]!.x[f & 0xffff], p.h.world.structs.chunks[Math.floor(f / 65536)]!.z[f & 0xffff]]);
  // The door is opened, walked through, and the hut is stood in.
  expect(await p.call("open", { id: door.id })).toMatchObject({ state: "done", now: "door_open_wood" });
  expect(await p.call("go_to", { id: a.id, wait_s: 50 })).toMatchObject({ state: "done" });
  expect(p.h.host.items.audit()).toEqual([]);
});

test("a campfire cooks meat, a mortar grinds sparkpowder, and a forge smelts ore while it burns", async () => {
  const p = play();
  const g = flatGround(p.h, 40, 40);
  for (const line of ["enablecheats", `tp ${g.x + 20} ${g.z + 6}`, "addxp 2000", "give piece_campfire 1", "give piece_mortar 1", "give piece_forge 1", "give wood 20", "give meat 2", "give flint 4", "give stone 2"]) await p.typed(line);
  const fire = (await p.call("place", { item: "piece_campfire", x: g.x + 16, z: g.z + 14 })) as unknown as { id: string };
  expect(await p.call("structure", { id: fire.id, do: "light" })).toMatchObject({ state: "blocked", reason: "not enough points, level or ingredients" });
  expect(await p.call("open", { id: fire.id })).toMatchObject({ state: "done", box: { name: "campfire", size: 3 }, station: { fire: "out" } });
  expect(await p.call("move_item", { from: "self", item: "wood", count: 5, to: "box" })).toMatchObject({ state: "done", moved: "wood" });
  expect(await p.call("move_item", { from: "self", item: "meat", to: "box" })).toMatchObject({ state: "done", moved: "meat" });
  expect(await p.call("structure", { id: fire.id, do: "light" })).toMatchObject({ state: "done" });
  expect(await p.call("structure", { id: fire.id, do: "light" })).toMatchObject({ state: "done", already: "burning" });
  // Cooking takes twenty seconds a piece, one after the other.
  p.run(42000);
  const lit = (await p.call("open", { id: fire.id })) as unknown as { box: { slots: unknown[][] }; station: { fire: string } };
  expect(lit.box.slots.find((s) => s[1] === "meat_cooked")?.[2]).toBe(2);
  expect(lit.station.fire).toMatch(/^burning/);
  expect(await p.call("move_item", { from: "box", item: "meat_cooked", to: "self" })).toMatchObject({ state: "done", moved: "meat_cooked" });
  expect(await p.call("structure", { id: fire.id, do: "put_out" })).toMatchObject({ state: "done" });

  // The mortar makes what is made at it from what lies in it, and the answer says where it lies.
  const mortar = (await p.call("place", { item: "piece_mortar", x: g.x + 24, z: g.z + 14 })) as unknown as { id: string };
  expect(await p.call("craft", { recipe: "sparkpowder", learn: true })).toMatchObject({ state: "blocked" });
  await p.call("open", { id: mortar.id });
  for (const item of ["flint", "stone"]) expect((await p.call("move_item", { from: "self", item, to: "box" })).state).toBe("done");
  const made = await p.call("craft", { recipe: "sparkpowder", count: 2, wait_s: 20 });
  expect(made).toMatchObject({ state: "done", item: "sparkpowder", made: 4, at: mortar.id });

  // The forge's ingot is fired: craft says so, and lit with wood beside the ore, it comes by itself.
  const recipes = JSON.parse((await p.ask("resources/read", { uri: "snark://recipes" }))!.result.contents[0].text);
  const ore = Object.keys(recipes.ingot.needs)[0]!;
  expect(recipes.ingot).toMatchObject({ at: "forge" });
  expect(await p.call("craft", { recipe: "ingot" })).toMatchObject({ state: "refused" });
  await p.typed(`give ${ore} 2`);
  const forge = (await p.call("place", { item: "piece_forge", x: g.x + 20, z: g.z + 20 })) as unknown as { id: string };
  await p.call("open", { id: forge.id });
  for (const item of ["wood", ore]) expect((await p.call("move_item", { from: "self", item, to: "box" })).state).toBe("done");
  expect(await p.call("structure", { id: forge.id, do: "light" })).toMatchObject({ state: "done" });
  p.run(22000);
  const smelted = (await p.call("open", { id: forge.id })) as unknown as { box: { slots: unknown[][] } };
  expect(smelted.box.slots.find((s) => s[1] === "ingot")?.[2]).toBe(1);
  expect(p.h.host.items.audit()).toEqual([]);
});
