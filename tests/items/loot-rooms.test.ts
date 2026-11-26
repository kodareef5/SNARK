// Loot in rooms (planning/workstreams/loot.md): a counter in a building is searched as a bin is, and what it may hold
// goes by the building it stands in and its storey.

import { expect, test } from "bun:test";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { builtCity } from "../fixtures/buildings.ts";
import { listener } from "../fixtures/module.ts";
import { camp } from "../kit/kit.ts";

const city = builtCity();
const file = writeMap(city.map);

test("a counter on the fifth storey of an office tower rolls the counter's source and the office's, at its storey", () => {
  const heard: string[] = [];
  const watch = listener("roomwatch", [], (m) => m.on("loot.roll", (e) => void heard.push(`${e.data.source} ${e.data.kind} ${e.data.level}`)));
  const { h, ada } = camp({ place: { map: file, at: () => ({ x: 190, z: 20 }) }, god: true, host: { modules: [watch.def] } });
  // The tower is the first building; one of its counters on its fifth storey.
  const i = city.statics.findIndex((p, k) => city.of[k] === 0 && city.storey[k] === 5 && p.kind.includes("_zcounter_"));
  const p = city.statics[i]!;
  expect(i).toBeGreaterThanOrEqual(0);
  const structs = h.world.structs;
  let ref = -1;
  for (const chunk of structs.held) {
    const t = structs.chunks[chunk]!;
    for (let slot = 0; slot < t.mapped; slot++) if (Math.abs(t.x[slot]! - p.x) < 0.01 && Math.abs(t.y[slot]! - p.y) < 0.01 && Math.abs(t.z[slot]! - p.z) < 0.01 && h.reg.ids[t.kind[slot]!] === p.kind) ref = chunk * 65536 + slot;
  }
  expect(h.host.holders.tag(ref)).toBe("counter");
  // Reach and sight are the command's to check; the search itself is asked of the holders.
  const c = h.client(ada)!;
  expect(h.host.holders.start(c, ref)).toBe(RESULT_OK);
  h.run(2100);
  expect(h.host.holders.use(c, ref)).toBe(RESULT_OK);
  h.run(100);
  expect(heard).toEqual(["room/counter static 5", "room/office static 5"]);
  expect(h.host.holders.count).toBe(1);
  expect(h.host.items.audit()).toEqual([]);
});
