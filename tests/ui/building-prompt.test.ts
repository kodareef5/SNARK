// Looking at a city piece says its building (client/core/prompts.ts): its name, else its address, else its kind, and under
// it how the piece stands once it is worn.

import { expect, test } from "bun:test";
import { KEY_PROMPT, KEY_PROMPT_UNDER } from "../../client/core/hud/prompt.ts";
import { buildingWord, cityWord } from "../../client/core/prompts.ts";
import { chunkAt } from "../../shared/coords.ts";
import { STAGES, stageOf } from "../../shared/world/breaking.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { ACT_REACH } from "../../shared/world/upkeep.ts";
import { builtCity } from "../fixtures/buildings.ts";
import { rocket } from "../fixtures/city.ts";
import { camp, look, put, screen, shown, until } from "../kit/kit.ts";

const city = builtCity();
const file = writeMap(city.map);

test("a building is told by its name, else its address, else its kind", () => {
  const map = parseMap(file), built = map.buildings!;
  // The first piece of each building, and a crate that is no building's, by where the file put them.
  const word = (i: number): string => {
    const p = city.statics[i]!, chunk = chunkAt(map.dims, p.x, p.z);
    for (let r = map.statics.first[chunk]!; r < map.statics.first[chunk + 1]!; r++) {
      if (map.statics.kinds[map.statics.kind[r]!] === p.kind && Math.abs(map.statics.x[r]! - p.x) < 0.002 && Math.abs(map.statics.y[r]! - p.y) < 0.002 && Math.abs(map.statics.z[r]! - p.z) < 0.002) return buildingWord(built, chunk, r - map.statics.first[chunk]!);
    }
    throw new Error(`no ${p.kind} read back`);
  };
  expect([0, 1, 2].map((b) => word(city.of.indexOf(b)))).toEqual(["Bâoli Tower", "Ocean Drive", "House"]);
  expect([word(0), buildingWord(null, 0, 0), buildingWord(built, 0, 60000)]).toEqual(["", "", ""]);
});

test("the prompt names the building of the piece looked at, and under it how the piece stands", () => {
  const { h, ada } = camp({ place: { map: file, at: () => ({ x: 190, z: 20 }) }, screen: true, god: true });
  const view = screen(h, ada);
  const { reg, world } = h;
  // A blank wall of the tower's ground storey on its south face: stood before, within the prompt's reach.
  const wall = city.statics.filter((p, i) => city.of[i] === 0 && city.storey[i] === 0 && p.kind.includes("_zpanel8_") && p.yaw === 0).sort((a, b) => a.z - b.z)[0]!;
  put(h, ada, { x: wall.x, z: wall.z - (ACT_REACH - 1.5) });
  look(h, ada, { x: wall.x, y: wall.y, z: wall.z });
  expect(until(h, () => shown(view, KEY_PROMPT) !== null, 5)).toBe(true);
  expect([shown(view, KEY_PROMPT), shown(view, KEY_PROMPT_UNDER)]).toEqual(["Bâoli Tower", null]);
  // Worn by a blast, it says so under the name, and the name stays where it was.
  const chunk = chunkAt(world.dims, wall.x, wall.z), t = world.structs.chunks[chunk]!;
  let slot = 0;
  while (Math.abs(t.x[slot]! - wall.x) > 0.01 || Math.abs(t.z[slot]! - wall.z) > 0.01 || Math.abs(t.y[slot]! - wall.y) > 0.01) slot++;
  const placed = world.structs.mapKind(chunk, slot);
  for (let k = 0; k < 40 && stageOf(reg, placed, t.hp[slot]!) === 0; k++) h.host.combat.hitStructure(rocket(reg), chunk * 65536 + slot, wall.x, wall.y, wall.z - 0.3);
  const stands = cityWord(reg, placed, t.kind[slot]!, t.hp[slot]!);
  expect(STAGES.includes(stands)).toBe(true);
  expect(until(h, () => shown(view, KEY_PROMPT_UNDER) !== null, 5)).toBe(true);
  expect([shown(view, KEY_PROMPT), shown(view, KEY_PROMPT_UNDER)]).toEqual(["Bâoli Tower", stands]);
  // Out of reach it says nothing.
  put(h, ada, { x: wall.x, z: wall.z - ACT_REACH - 3 });
  look(h, ada, { x: wall.x, y: wall.y, z: wall.z });
  h.run(300);
  expect(shown(view, KEY_PROMPT)).toBeNull();
});
